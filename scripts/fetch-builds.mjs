// Resolves the recommended build and the recommended teams for every
// Resonator the desk holds, and writes data/builds.json. Node 20+. No
// dependencies. No API keys.
//
// This is the first file on the desk that is somebody's opinion, and it is
// labelled as one everywhere it surfaces.
//
// Everything else here is a record: a patch has a start date, a weapon has a
// base ATK, an echo rolls a set or it does not. "Run Jinhsi on Celestial Light
// with Jué in the main slot" is a judgement — it depends on the patch, on who
// else you own, on what the current endgame rewards, and two competent people
// can disagree about it. So it is fetched into a file of its own rather than
// folded into resonators.json, it is credited to the people who did the
// judging on every panel that shows it, and it carries the version of the game
// their review was written against. The desk does not average it with anything
// or restate it in its own voice; it shows you Prydwen's build with Prydwen's
// name on it, and links out.
//
// Where it comes from. Prydwen's character pages, one request each, same host
// and the same curl workaround as the weapon and echo fetchers, and the same
// React flight payload walker — see fetch-echoes.mjs for why that is not two
// .replace() calls. Five arrays out of each page:
//
//   echoBuilds      the sonata set to farm, with the main-slot echo that goes
//                   with it — the one whose Echo Skill you actually cast — and
//                   a second echo where the set supports one. A character can
//                   have more than one of these: Shorekeeper has a "Best" on
//                   Rejuvenating Glow and a "Special" on Moonlit Clouds, which
//                   are different builds for different teams rather than a
//                   first and second choice.
//   echoStatBuilds  the cost layout (43311 and so on), the main stat wanted in
//                   each of the five slots, and the substat priority.
//   endgameStats    what those stats should read at level 90 — the thresholds
//                   the priority order is silent about. Not an array but a
//                   paragraph of HTML, and the only field here that is parsed
//                   out of markup rather than read off a form.
//   weaponBuilds    the weapons, ranked, each with the damage share Prydwen
//                   calculates for it against the best one.
//   teams           the comps, three slots deep, where a slot can name more
//                   than one Resonator as alternatives.
//   ratings         every character's name and slug, which is the only place
//                   the slug map comes from. It rides on every character page,
//                   so the first fetch supplies it for all the rest.
//
// Character slugs are Prydwen's, the desk is keyed by name, and the two are
// joined through that ratings array rather than by slugifying a name and
// hoping — "The Shorekeeper" is `the-shorekeeper` and "Rover: Havoc" is not
// anything you would guess.
//
// Nothing is cached to disk here. Echo icons, weapon icons and portraits are
// already on the desk from the other three fetchers, and this file is entirely
// names and prose that point at them.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const CHAR_URL = slug => `https://www.prydwen.gg/wuthering-waves/characters/${slug}`;
const ROSTER = "data/resonators.json";
const OUT = "data/builds.json";
const TIMEOUT_MS = 30000;
/* A courtesy gap between page fetches. Sixty requests to a fan site's origin
   in a burst is the sort of thing that gets a scraper blocked, and this script
   is not in a hurry — it runs by hand, once a patch. */
const GAP_MS = 400;

const curl = (url, extra = []) =>
  run("curl", [
    "--silent", "--show-error", "--fail", "--location", "--compressed",
    "--max-time", String(Math.round(TIMEOUT_MS / 1000)),
    "-A", UA,
    "-H", "Accept-Language: en-GB,en;q=0.9",
    "-e", "https://www.prydwen.gg/",
    ...extra,
    url
  ], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });

async function getText(url) {
  const { stdout } = await curl(url, ["-H", "Accept: text/html,application/xhtml+xml"]);
  return stdout.toString("utf8");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── the flight payload ───────────────────────────────────────────────
   Third copy of this walker in scripts/, and deliberately a copy: no fetcher
   in this directory imports another, and the day Prydwen moves again all three
   want fixing together rather than one of them quietly inheriting a change
   made for a different page. The reasoning is written out once, in
   fetch-echoes.mjs. */
function flightPayload(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,"/g;
  let m;
  while ((m = re.exec(html))) {
    const open = m.index + m[0].length - 1;
    let i = open + 1;
    for (; i < html.length; i++) {
      if (html[i] === "\\") { i++; continue; }
      if (html[i] === '"') break;
    }
    try { out.push(JSON.parse(html.slice(open, i + 1))); } catch { /* not data */ }
  }
  return out.join("");
}

/* The JSON value filed under `key`, walked brace by brace. Unlike the echo
   page, a character page carries prose with braces and brackets in it and
   several arrays under keys that repeat, so this tracks string state as it
   walks — a `}` inside a comment is not the end of anything. */
function valueAt(p, at) {
  const open = p[at];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false;
  for (let i = at; i < p.length; i++) {
    const c = p[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(p.slice(at, i + 1)); } catch { return null; }
    }
  }
  return null;
}
function keyed(p, key) {
  const at = p.indexOf(`"${key}":`);
  return at === -1 ? null : valueAt(p, at + key.length + 3);
}

/* The same, for a field whose value is a string rather than a structure.
   `valueAt` refuses anything that does not open a brace or a bracket, and the
   endgame stat targets arrive as one HTML string. */
function keyedText(p, key) {
  const at = p.indexOf(`"${key}":`);
  if (at === -1) return null;
  const i = at + key.length + 3;
  if (p[i] !== '"') return null;
  let j = i + 1;
  for (; j < p.length; j++) {
    if (p[j] === "\\") { j++; continue; }
    if (p[j] === '"') break;
  }
  try { return JSON.parse(p.slice(i, j + 1)); } catch { return null; }
}

/* ── tidying ──────────────────────────────────────────────────────────
   Prydwen's build text is plain prose — no markup, unlike the echo skills and
   set bonuses — so all this does is trim, drop the placeholder single space
   that stands in for "no comment" on a few rows, and refuse to carry an empty
   string as if it were an answer. */
const text = s => {
  const v = String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return v && v !== "-" ? v : null;
};
/* "100.00%" and "87.90%" are shares against the best option. A few rows carry
   a bare "1" where somebody meant 100%, and one carries "". Anything that is
   not a percentage is dropped rather than reinterpreted — a bar drawn from a
   guess about what a number meant is worse than no bar. */
const share = s => /^\d+(\.\d+)?%$/.test(String(s ?? "").trim()) ? String(s).trim() : null;

/* ── the endgame targets ──────────────────────────────────────────────
   "CRIT Rate: 65-80%+", "Energy Regen: 115-130%+" — the numbers to aim at by
   level 90, written upstream as one HTML list rather than as fields.

   Worth unpicking rather than printing as a paragraph, because of what it
   answers. The substat priority is an order — Energy Regen, then crit, then
   ATK% — and an order alone never says when to stop rolling the first thing
   and start on the second. These are the thresholds that make it actionable,
   so the desk parses them into rows and hangs each one off the stat it belongs
   to in that priority list.

   Only the entities that actually turn up in the source are decoded, and the
   list is left in its own order — which is the game's stat screen order, not a
   ranking, and the priority list is where rank is expressed. */
const decode = s => String(s ?? "")
  .replace(/&(#39|apos|rsquo);/g, "'").replace(/&quot;/g, '"')
  .replace(/&(#8211|ndash);/g, "–").replace(/&(#8212|mdash);/g, "—")
  .replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<")
  .replace(/&amp;/g, "&");
const clean = s => { const v = text(decode(s)); return v; };

/* The `<li>`s of a list, at the top level only. One level of nesting turns up
   here and it means something — a nested list under a stat is the caveat on
   that stat's number, "the lower end assumes Changli on the team" — so it is
   kept with its stat rather than flattened into a sibling row that reads like
   another target. */
function topLevelItems(html) {
  const out = [];
  const re = /<(\/?)(ul|ol|li)\b[^>]*>/gi;
  let depth = 0, at = -1, m;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2].toLowerCase();
    if (tag === "li") {
      if (!closing && at === -1) at = re.lastIndex;
      else if (closing && at !== -1 && depth === 0) { out.push(html.slice(at, m.index)); at = -1; }
    } else if (at !== -1) depth += closing ? -1 : 1;
  }
  return out;
}

function parseTargets(html) {
  if (!html) return [];
  return topLevelItems(html).map(item => {
    const nested = item.match(/<(ul|ol)\b[\s\S]*<\/\1>/i);
    const head = nested ? item.slice(0, item.indexOf(nested[0])) : item;
    /* The figure is bolded and the label is not, which is the separator that
       actually holds. The colon does not: Phrolova's row is written "Energy
       Regen <b>100%</b>" with no colon at all, and splitting on one gave her a
       stat called "Energy Regen 100%" — a label with its own answer baked into
       it, which then matches nothing in the priority list. So the value is
       taken from the bold and the label is whatever is left once it and any
       trailing colon are removed. Colon-splitting is the fallback for the rows
       that bold nothing. */
    const bold = head.match(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const plain = clean(head) || "";
    const value = clean(bold ? bold[2] : plain.slice(plain.indexOf(":") + 1));
    let label = plain;
    if (value && label.endsWith(value)) label = label.slice(0, -value.length);
    label = label.replace(/[\s:]+$/, "");
    const cut = label.indexOf(":");
    const stat = clean(cut === -1 ? label : label.slice(0, cut));
    return stat && value ? { stat, value, note: nested ? clean(nested[0]) : null } : null;
  }).filter(Boolean);
}

/* A comma-separated slug list — how a team slot and a synergy row are both
   written — resolved to the desk's own names. An unknown slug is kept as its
   prettified self rather than dropped: a Resonator announced on Prydwen before
   the desk has a record for them is still the right answer to "who goes in
   this team", and a hole in a three-slot comp reads as a two-person team. */
const pretty = slug => String(slug).split("-")
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function names(list, bySlug) {
  return String(list || "").split(",").map(s => s.trim()).filter(Boolean)
    .map(s => bySlug.get(s) || pretty(s));
}

/* ── the roster ───────────────────────────────────────────────────────
   The desk's own list is what decides who gets fetched. Prydwen's ratings
   array covers characters the desk has no record for — and a build for
   somebody who is not in resonators.json has nowhere on the desk to be shown.
   Matching is on a folded name, because the two sources punctuate differently
   ("Rover: Havoc" against "Rover Havoc") often enough to matter. */
const fold = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function main() {
  const roster = JSON.parse(await readFile(ROSTER, "utf8")).resonators || [];
  if (!roster.length) throw new Error("no roster in " + ROSTER);
  console.log(`${roster.length} Resonators on the desk`);

  /* The slug map rides on any character page, so the first fetch pays for
     itself twice. Which page does not matter, only that it loads — so the
     roster is walked, guessing the obvious slug for each name, until one
     answers. No hardcoded seed: the character who is first alphabetically
     today is not necessarily on Prydwen tomorrow, and a script that dies
     because one page 404s has picked a needless single point of failure. */
  let ratings = null;
  for (const r of roster.slice(0, 8)) {
    const guess = String(r.name).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      ratings = keyed(flightPayload(await getText(CHAR_URL(guess))), "ratings");
      if (Array.isArray(ratings) && ratings.length) {
        console.log(`slug map read off ${CHAR_URL(guess)}`);
        break;
      }
    } catch { /* try the next name */ }
    ratings = null;
    await sleep(GAP_MS);
  }
  if (!Array.isArray(ratings) || !ratings.length) {
    throw new Error("no ratings array on any seed page — the source layout changed, or the host is refusing us");
  }
  const bySlug = new Map();
  const slugFor = new Map();
  for (const c of ratings) {
    const onDesk = roster.find(r => fold(r.name) === fold(c.name));
    bySlug.set(c.slug, onDesk ? onDesk.name : c.name);
    if (onDesk) slugFor.set(onDesk.name, c.slug);
  }
  console.log(`  ${ratings.length} characters listed, ${slugFor.size} of them on the desk`);

  const missing = roster.filter(r => !slugFor.has(r.name)).map(r => r.name);
  if (missing.length) {
    console.log(`${missing.length} on the desk with no page upstream: ${missing.join(", ")}`);
  }

  /* Pull the five arrays out of one character's page. Every one of them is
     optional — an unreleased Resonator has a page with a portrait and nothing
     else on it — and a character with none is simply not written to the file,
     so the view can ask "is there a build for this one" and get a real answer
     rather than an empty shell. */
  function parseChar(payload, slug) {
    const echo = (keyed(payload, "echoBuilds") || []).map(b => ({
      type: text(b.Type) || "Best",
      name: text(b.Set),
      /* A hybrid build — two or three sets at 2 pieces each rather than one at
         5. Written across five numbered fields upstream because it is a form
         somebody fills in; here it is the list it actually is, and absent
         entirely for the ordinary single-set case. */
      mix: [1, 2, 3, 4, 5].map(n => text(b[`Set_small_${n}`])).filter(Boolean),
      share: share(b.Percentage),
      note: text(b.Comment),
      /* The main slot — the echo whose Echo Skill you cast, which is the one
         decision on this panel that changes how the character is played rather
         than what its numbers are. Second entry is an alternative for the same
         set, not a second slot. */
      echoes: [
        { name: text(b.Echo_1), note: text(b.Echo_1_Comment) },
        { name: text(b.Echo_2), note: text(b.Echo_2_Comment) }
      ].filter(e => e.name)
    })).filter(b => b.name || b.mix.length);

    const st = (keyed(payload, "echoStatBuilds") || [])[0];
    /* Two different things and one panel. The stat build says what to roll and
       in what order; the endgame list says how far. They arrive from opposite
       ends of the page — one a form, one a paragraph of HTML — and are kept
       together here because neither is much use to a reader on its own. */
    const targets = parseTargets(keyedText(payload, "endgameStats"));
    const stats = st || targets.length ? {
      /* 43311 and friends: the cost of each of the five slots, in order. Kept
         as the string it is written as — it is read as a shape, not summed. */
      format: st ? text(st.Format) : null,
      slots: st ? [1, 2, 3, 4, 5].map(n => text(st[`Echo_${n}`])) : [],
      substats: st ? text(st.Substats) : null,
      note: st ? text(st.Comments) : null,
      targets
    } : null;

    const weapons = (keyed(payload, "weaponBuilds") || []).map(w => ({
      name: text(w.Weapon),
      /* How many copies of it the ranking assumes. A 5★ at one copy and the
         same 5★ at five are different recommendations. */
      dupes: Number(w.Dupes) || null,
      share: share(w.Percentage),
      note: text(w.Comment)
    })).filter(w => w.name);

    const teams = (keyed(payload, "teams") || []).map(t => ({
      name: text(t.Name) || "Team",
      /* Three slots, each of which may name alternatives. Kept as slots rather
         than flattened to a list of six people: "Verina or Shorekeeper in the
         third seat" is a different statement from "these six work together". */
      slots: [t.Member_1, t.Member_2, t.Member_3]
        .map(m => names(m, bySlug)).filter(s => s.length),
      note: text(t.Comments)
    })).filter(t => t.slots.length);

    if (!echo.length && !stats && !weapons.length && !teams.length) return null;

    /* Which version of the game the recommendation was written against. It is
       the one fact that tells a reader whether to trust it, so a record that
       has it carries it and a record that doesn't says nothing rather than
       implying today. */
    const upd = keyed(payload, "lastUpdate");
    return {
      slug,
      reviewed: upd && (upd.build ?? upd.review) != null
        ? String(upd.build ?? upd.review) : null,
      source: CHAR_URL(slug),
      sets: echo, stats, weapons, teams
    };
  }

  const builds = {};
  let n = 0, withBuild = 0;
  for (const [name, slug] of slugFor) {
    n++;
    try {
      const payload = flightPayload(await getText(CHAR_URL(slug)));
      const rec = parseChar(payload, slug);
      if (rec) { builds[name] = rec; withBuild++; }
      console.log(`  ${String(n).padStart(2)}/${slugFor.size}  ${name.padEnd(22)} ${
        rec ? `${rec.sets.length} set${rec.sets.length === 1 ? "" : "s"}, ${rec.teams.length} team${
          rec.teams.length === 1 ? "" : "s"}${rec.reviewed ? `, v${rec.reviewed}` : ""}` : "nothing published"}`);
    } catch (err) {
      console.log(`  ${String(n).padStart(2)}/${slugFor.size}  ${name.padEnd(22)} FAILED — ${err.message}`);
    }
    await sleep(GAP_MS);
  }

  /* Refuse to overwrite a good file with a bad run. Prydwen turns away
     datacenter IPs outright, and a run from one would otherwise walk the whole
     roster, catch sixty failures and write an empty object over a file that
     took four minutes to build. Same guard fetch-weapons.mjs puts on its own
     count. */
  if (withBuild < Math.min(20, Math.floor(slugFor.size / 2))) {
    throw new Error(`only ${withBuild} builds parsed — refusing to overwrite ${OUT}`);
  }

  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify({
    schema: "wuwa-desk/builds@1.0",
    note: "Recommended builds and teams, per Resonator. This is the one file on the desk that is judgement rather than record: which sonata set to farm, which echo to put in the main slot, what to roll for, which weapons rank where, and which teams to build — all of it somebody's opinion, none of it a fact the game publishes. It is credited to prydwen.gg wherever it is shown and `reviewed` is the game version their write-up was last revised against. `sets[].echoes` is the main slot, the echo whose skill you actually cast. `stats.format` is the cost layout of the five slots and `stats.slots` is the main stat wanted in each. `stats.targets` is what each stat should read on the level-90 stat screen — the thresholds that turn the substat priority from an order into something you can act on, since an order alone never says when to stop rolling one stat and start on the next. `weapons[].share` is the damage share Prydwen calculates against the best option. A team slot holds every Resonator named as an alternative for that seat.",
    credit: "Builds, teams and rankings via prydwen.gg — their judgement, not the desk's",
    source: "https://www.prydwen.gg/wuthering-waves/characters/",
    generated: new Date().toISOString(),
    builds
  }, null, 2) + "\n");

  console.log(`\nwrote ${OUT} — ${withBuild} of ${slugFor.size} Resonators have a build`);
  const noBuild = [...slugFor.keys()].filter(k => !builds[k]);
  if (noBuild.length) console.log(`nothing published yet for: ${noBuild.join(", ")}`);
}

main().catch(err => { console.error(err); process.exit(1); });

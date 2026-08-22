// Drafts a version entry in versions.json from Kuro's own patch announcements.
// Node 20+. No dependencies, no keys.
//
//   node scripts/seed-version.mjs           # whichever version has news and no record
//   node scripts/seed-version.mjs 3.7       # a named one
//   node scripts/seed-version.mjs 3.6 --dry # print, write nothing
//
// versions.json is the desk's spine and the last big thing still typed by
// hand. Most of what goes into it is not judgement though — it is Kuro
// announcing a patch, and they announce it the same way every cycle, in three
// posts the desk already has an article feed for:
//
//   Update Content    the codename and the release date, published for every
//                     version back to 3.1 and the only one of the three that
//                     never goes missing
//   Patch Notes       the new Resonators with their attribute, weapon class
//                     and combat roles, and the new weapons. Not always
//                     published — 3.5 has none — so nothing here depends on it
//   Convene: Phase N  the banner line-up. Every 5-star of that phase, the
//                     convene each runs on, and the phase's own window
//
// So the run is a read of those three and a merge, and the merge is where the
// care goes. Two rules, both borrowed from confirm-dates.mjs, and neither
// bends:
//
//   * A field with a value in it is never touched. Not the codename, not a
//     date, not a banner, and above all not `notes` — the prose there is the
//     desk's own reading of a patch and no script has an opinion about it.
//     This fills blanks and appends what is missing entirely.
//   * A phase that already exists is left whole. Its banners were either
//     written by hand or seeded by an earlier run, and a half-published phase
//     re-parsed mid-cycle would otherwise drop banners Kuro has since added.
//
// What it will not do: `region`, `livestream`, the `keyVisual*` crop values,
// and `notes`. The first two are facts it has no source for and the last two
// are judgement — where to crop a picture, and what a patch means.
//
// Writes nothing when nothing changed, so an idle run produces no commit, and
// once a version is fully written every later run is idle by construction.

import { readFile, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const ARTICLE_URL = id => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;
const VERSIONS = "data/versions.json";
const RESONATORS = "data/resonators.json";
const TIMEOUT_MS = 20000;

const readJson = async p => JSON.parse(await readFile(p, "utf8"));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/* Kuro's article bodies are CMS HTML — <br> for every line break, entities for
   every apostrophe. Same flattener fetch-events.mjs uses, for the same reason:
   every fact in here is "heading line, value line". */
function toText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

const flattenArticles = menu => {
  const out = new Map();
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const title = node.articleTitle || node.title;
    if (node.articleId && title) {
      out.set(String(node.articleId), {
        id: String(node.articleId),
        title: String(title).trim(),
        created: String(node.createTime || node.publishTime || "")
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(menu);
  return [...out.values()];
};

/* Kuro number the phases in Roman, and not always in the same Roman: 3.3's
   Phase II is the single character Ⅱ, everyone else's is two letter I's. */
const ROMAN = { I: 1, II: 2, III: 3, "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3 };

/* ── the three posts ───────────────────────────────────────────────────── */

const updateContentFor = (arts, ver) =>
  arts.find(a => new RegExp(`Update Content \\| Version ${ver}\\b`, "i").test(a.title));
const patchNotesFor = (arts, ver) =>
  arts.find(a => new RegExp(`^Patch Notes for Version ${ver}\\b`, "i").test(a.title));

/* Every convene post that could belong to this version. The one titled
   "[Version 3.6 …Convene: Phase I]" reads like a roll-up and is not: it covers
   a single pair, and the rest of the phase goes up as its own post two days
   later, under a title that names the convene and not the version. So this
   takes anything shaped like a convene post from a window around the patch and
   lets the durations inside decide what belongs — a post's own dates are a
   better statement of which phase it is in than its headline is. */
/* Built from a string rather than written as a literal: the alternation has a
   slash in it — Kuro title the combined post "Featured Resonator/Weapon
   Convene" — and a slash inside a regex literal is one escape away from
   silently ending it. */
const CONVENE_TITLE = new RegExp(
  "Featured (?:Resonator|Weapon)(?:/(?:Resonator|Weapon))? Convene",
  "i"
);

const conveneArticlesFor = (arts, startISO) => {
  const start = Date.parse(startISO || "");
  return arts.filter(a => {
    if (!CONVENE_TITLE.test(a.title)) return false;
    if (!Number.isFinite(start)) return true;
    const t = Date.parse(String(a.created).replace(" ", "T"));
    if (!Number.isFinite(t)) return false;
    const days = (t - start) / 86400000;
    return days >= -21 && days <= 60;
  });
};

/* The codename and the release day, off the Update Content headline. It reads
   `Version 3.6 "Lamplight in Mirage, Sword's Resolve in Heart" Planned for
   Release on August 20 (UTC+8)` — the year is not in it, so it comes off the
   post's own timestamp, which is days before the release and never across a
   new year from it except at a December patch. Hence the rollover guard. */
function parseUpdateContent(article) {
  if (!article) return {};
  const title = article.title;
  const codename = (title.match(/"([^"]+)"|“([^”]+)”/) || []).slice(1).find(Boolean) || null;
  const day = title.match(/Release on\s+([A-Z][a-z]+)\s+(\d{1,2})/);
  let start = null;
  if (day) {
    const postedYear = Number(String(article.created).slice(0, 4)) || new Date().getUTCFullYear();
    const postedMonth = Number(String(article.created).slice(5, 7)) || 1;
    const month = new Date(`${day[1]} 1, 2000`).getMonth() + 1;
    const year = postedMonth === 12 && month === 1 ? postedYear + 1 : postedYear;
    if (month) start = `${year}-${String(month).padStart(2, "0")}-${String(day[2]).padStart(2, "0")}`;
  }
  return { codename, start };
}

/* New Resonators and new weapons, off the patch notes body. The lines read
   `5-Star Resonator: Qingxiao (Aero/Sword)` and, a few lines down,
   `●Combat Roles: Main Damage Dealer, Tune Strain Response`. */
const ROLES = new Map([
  ["main damage dealer", "Main DPS"],
  ["sub-dps", "Sub DPS"],
  ["support", "Support"],
  ["healer", "Healer"],
  ["tank", "Tank"]
]);

function parsePatchNotes(text) {
  const debuts = new Map();
  const re = /(\d)-Star Resonator:\s*([^\n(]+?)\s*\(([^/)]+)\/([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index, m.index + 900);
    const roleLine = after.match(/Combat Roles?:\s*([^\n]+)/);
    /* First recognised role only. Kuro list a headline role and then a
       mechanic — "Main Damage Dealer, Tune Strain Response" — and the second
       is a kit note, not a slot in a team. */
    const role = roleLine
      ? (roleLine[1].split(/[,、]/).map(s => ROLES.get(s.trim().toLowerCase())).find(Boolean) || null)
      : null;
    debuts.set(m[2].trim(), {
      rarity: Number(m[1]),
      attribute: m[3].trim(),
      weapon: m[4].trim(),
      role
    });
  }
  const weapons = new Map();
  const wre = /(\d)-Star Weapon:\s*([^\n(]+?)\s*\(([^)]+)\)/g;
  while ((m = wre.exec(text))) weapons.set(m[2].trim(), { rarity: Number(m[1]), weapon: m[3].trim() });
  return { debuts, weapons };
}

/* One phase, off its roll-up post. The post is a run of blocks, each headed
   `[Convene Name] Featured Resonator Convene` or `… Featured Weapon Convene`,
   each carrying its 5-star and its own duration line. Resonators and weapons
   come out in their published order, and that order is the pairing: Kuro print
   a Resonator's convene and then the weapon convene running beside it. */
function parsePhase(text, articleTitle) {
  /* Segment on the "During the event, 5-Star Resonator: X, 4-Star …" line and
     nothing else, because it is the only thing all of these posts have. The
     `[Convene Name] Featured … Convene` heading does not qualify twice over: a
     post covering one convene carries that name in the article title and never
     in the body, and a post covering several only line-anchors the first. */
  const marks = [...text.matchAll(/(\d)-Star (Resonator|Weapon):\s*(.+?),\s*\d-Star/g)];
  if (!marks.length) return [];

  /* Headings where there are any, so a multi-convene post can attribute each
     block to its own banner. `[X] is a Featured Resonator Convene event
     banner` in the rules further down is not a heading and does not match: the
     bracket has to be followed straight by "Featured". */
  const heads = [...text.matchAll(/\[([^\]]+)\]\s*Featured (Resonator|Weapon) Convene/gi)]
    .map(m => ({ convene: m[1].trim(), kind: m[2], at: m.index }));
  const fromTitle = String(articleTitle || "").match(
    /\[([^\]]+)\]\s*Featured (Resonator|Weapon) Convene/i
  );

  return marks
    .map((m, i) => {
      const from = m.index;
      const body = text.slice(from, i + 1 < marks.length ? marks[i + 1].index : text.length);
      const explicit = body.match(/(\d{4}-\d{2}-\d{2})\s[\d:]+\s*-\s*(\d{4}-\d{2}-\d{2})/);
      /* Phase 1 gives its opening as the words "Version 3.6 update" rather than
         a date, so only the close is readable out of a phase-1 post. */
      const fromUpdate = body.match(/update\s*-\s*(\d{4}-\d{2}-\d{2})/i);
      const head = heads.filter(h => h.at <= from && h.kind === m[2]).pop();
      return {
        convene:
          head?.convene || (fromTitle && fromTitle[2] === m[2] ? fromTitle[1].trim() : null),
        kind: m[2],
        name: m[3].trim(),
        rarity: Number(m[1]),
        start: explicit ? explicit[1] : null,
        end: explicit ? explicit[2] : fromUpdate ? fromUpdate[1] : null
      };
    })
    /* 5-stars only. The 4-star line-up rotates on its own schedule and is not
       what a patch card is answering; versions.json has never carried it. */
    .filter(b => b.rarity === 5);
}

/* ── building the entry ────────────────────────────────────────────────── */

/* Blocks into phases. Everything running in one phase shares one window, and
   the end date is the half of it that is always printed — a phase-1 post gives
   its start as the words "Version 3.6 update" — so the end is the key. Phases
   then number themselves by which window closes first, which is the same order
   they run in and does not depend on Kuro's Roman numerals, which have been
   both `II` and `Ⅱ` across four patches. */
function groupPhases(blocks) {
  const byEnd = new Map();
  for (const b of blocks) {
    if (!b.end) continue;
    (byEnd.get(b.end) || byEnd.set(b.end, []).get(b.end)).push(b);
  }
  return [...byEnd.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([end, group], i) => {
      const seen = new Set();
      const uniq = group.filter(b => {
        const k = `${b.kind}:${b.name}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const of = k => uniq.filter(b => b.kind === k).sort((x, y) => Number(x.article) - Number(y.article));
      return {
        n: i + 1,
        end,
        start: uniq.map(b => b.start).find(Boolean) || null,
        resonators: of("Resonator"),
        weapons: of("Weapon")
      };
    });
}

function buildPhase(n, parsed, ver, roster, notes) {
  const banners = parsed.resonators.map((r, i) => {
    const known = roster.get(r.name.toLowerCase()) || {};
    const debut = notes.debuts.get(r.name) || {};
    /* Signature by position. Kuro publish a Resonator's convene and the weapon
       convene running beside it together — the same post where there is one,
       back-to-back article ids where there are two — so sorting each side by
       article id and zipping pairs them the way they were announced. Zipping
       stops at the shorter side: a phase whose weapon posts have not all gone
       up yet loses a `signature`, which is a blank the next run fills, rather
       than gaining a wrong one, which nothing ever corrects. */
    const sig = parsed.weapons[i];
    const b = {
      name: r.name,
      rarity: 5,
      attribute: debut.attribute || known.attribute || undefined,
      weapon: debut.weapon || known.weapon || undefined,
      role: debut.role || undefined,
      convene: r.convene
    };
    /* New if this patch is the one the roster says they debut in, or if the
       roster has never heard of them — a Resonator too new to be in the
       database is by definition not a rerun. */
    if (!known.version || known.version === ver) b.new = true;
    else b.rerun = true;
    if (sig) b.signature = sig.name;
    return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
  });
  /* Debuts first. Publication order puts whichever convene Kuro posted about
     first at the top, which on 3.6 was the rerun — and the card underneath is
     read as "what is new in this patch", so the new one leads. */
  banners.sort((a, b) => (a.new ? 0 : 1) - (b.new ? 0 : 1));
  const phase = { n, banners };
  if (parsed.start) phase.start = parsed.start;
  if (parsed.end) phase.end = parsed.end;
  return phase;
}

/* ── main ──────────────────────────────────────────────────────────────── */

(async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const wanted = args.find(a => /^\d+\.\d+$/.test(a)) || null;

  const [doc, resonators] = await Promise.all([readJson(VERSIONS), readJson(RESONATORS)]);
  doc.versions ||= [];
  const roster = new Map(
    (resonators.resonators || []).map(r => [String(r.name).toLowerCase(), r])
  );

  const articles = flattenArticles(await getJson(`${BASE}/ArticleMenu.json`));

  /* Which version to draft. Named, or else the newest one Kuro have announced
     that the desk cannot already draw a phase for — a version with a record
     and phases in it is finished as far as this script is concerned.

     A version absent from versions.json only counts if it is *ahead* of
     everything in there. The file carries the arc the desk is watching and
     nothing else; every shipped patch before that lives in archive.json. Left
     to "anything with no record", the no-argument run walks backwards through
     Kuro's whole article history and reinstates 3.4, then 3.3, one retired
     patch per run. */
  const newest = Math.max(0, ...doc.versions.map(v => parseFloat(v.id) || 0));
  const announced = [
    ...new Set(
      articles.map(a => (a.title.match(/Version (\d+\.\d+)/i) || [])[1]).filter(Boolean)
    )
  ].sort((a, b) => parseFloat(b) - parseFloat(a));
  const target =
    wanted ||
    announced.find(v => {
      const rec = doc.versions.find(x => x.id === v);
      if (rec) return !(rec.phases || []).length;
      return parseFloat(v) > newest;
    });

  if (!target) {
    console.log("every announced version already has phases — nothing to draft");
    return;
  }
  console.log(`drafting ${target}\n`);

  const uc = updateContentFor(articles, target);
  const pn = patchNotesFor(articles, target);
  const { codename, start } = parseUpdateContent(uc);
  /* No release date, no phases. Every convene post is titled after its banner
     rather than its version, so the patch window is the only thing that says
     which of them belong here — without it the filter matches all 118 posts
     Kuro have ever published and the draft is nonsense. A version this early
     has a codename at most, and usually not even that. */
  const conveneArts = start ? conveneArticlesFor(articles, start) : [];

  console.log(`  update content : ${uc ? uc.id : "—"}`);
  console.log(`  patch notes    : ${pn ? pn.id : "— (not published)"}`);
  console.log(`  convene posts  : ${start ? conveneArts.length || "—" : "— (no release date yet)"}`);

  if (!uc) {
    console.log("\nnothing announced for this version yet");
    return;
  }

  const notes = pn
    ? parsePatchNotes(toText((await getJson(`${BASE}/article/${pn.id}.json`)).articleContent))
    : { debuts: new Map(), weapons: new Map() };

  /* Every convene block in the window, tagged with the post it came out of so
     the pairing below can follow publication order. */
  const blocks = [];
  for (const a of conveneArts) {
    const body = toText((await getJson(`${BASE}/article/${a.id}.json`)).articleContent);
    for (const b of parsePhase(body, a.title)) blocks.push({ ...b, article: a.id });
  }
  /* A convene that closes before this version opens, or after the next one has
     already started, belongs to a neighbouring patch — the post window has to
     be wide enough to catch a phase-2 notice, so it also catches the next
     patch's phase 1. A patch is two 21-day phases; 50 days clears the second
     phase's close with room and stops well short of the patch after it. */
  const CYCLE_DAYS = 50;
  const lastDay = start
    ? new Date(Date.parse(start) + CYCLE_DAYS * 86400000).toISOString().slice(0, 10)
    : null;
  const inPatch = blocks.filter(
    b => !start || (b.end && b.end >= start && b.end <= lastDay)
  );

  const phases = groupPhases(inPatch).map(p =>
    buildPhase(p.n, p, target, roster, notes)
  );

  /* Phase 1 opens on patch day, which its own post declines to spell out —
     it says "Version 3.6 update". The date is in the Update Content headline. */
  if (phases[0] && !phases[0].start && start) phases[0].start = start;

  let rec = doc.versions.find(v => v.id === target);
  const fresh = !rec;
  if (fresh) {
    rec = { id: target, phases: [] };
    doc.versions.push(rec);
    doc.versions.sort((a, b) => parseFloat(b.id) - parseFloat(a.id));
  }
  rec.phases ||= [];

  const filled = [];
  const fill = (key, value) => {
    if (value == null || value === "" || rec[key]) return;
    rec[key] = value;
    filled.push(key);
  };
  fill("title", codename);
  fill("start", start);
  /* Announced, not live: a version this script can draft is one Kuro have
     posted about, and statusOf() in the desk decides live/past off the dates
     anyway. It only ever writes this into a record that had no status at all. */
  fill("status", "announced");

  for (const p of phases) {
    if (rec.phases.some(e => e.n === p.n)) continue;
    rec.phases.push(p);
    rec.phases.sort((a, b) => a.n - b.n);
    filled.push(`phase ${p.n} (${p.banners.length} banners)`);
  }

  console.log(`\n${JSON.stringify(rec, null, 2)}\n`);

  if (!filled.length) {
    console.log(`${target} is already complete — nothing to write`);
    return;
  }
  console.log(`${fresh ? "new record" : "filled"}: ${filled.join(", ")}`);

  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  doc.updated = new Date().toISOString().slice(0, 10);
  await writeFile(VERSIONS, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`wrote ${VERSIONS}`);
  if (uc) console.log(`source: ${ARTICLE_URL(uc.id)}`);
})();

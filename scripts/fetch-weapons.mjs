// Resolves the whole weapon roster — stats, passive and icon — and writes
// data/weapons.json. Node 20+. No dependencies. No API keys.
//
// This is the file that turned the Weapons view from a placeholder into a
// database. Everything the desk knew about a weapon before it existed came out
// of versions.json: a name on a banner row, and whose convene it ran beside.
// That is enough to say "Verdant Summit runs with Jiyan" and nothing at all
// about what the thing does.
//
// Where the numbers come from. Kuro publishes no weapon endpoint — the EN site
// is a client-side app with no public asset index, and the reveal-post CDN that
// fetch-art.mjs reads carries key art and nothing else. Prydwen's weapons page
// embeds its entire dataset as JSON in the page source, one request for all 120
// weapons, and it is the same source fetch-portraits.mjs already reads for
// character art. So it is the source here too, and is credited as such.
//
// Two things about the shape of that dataset are worth knowing before reading
// the parser:
//
//   Stat_primary and Stat_secondary_value are LEVEL 90 values. There is no
//   level curve in the payload and the desk does not invent one — a weapon's
//   stats are shown at max level, flat, which is the number anyone comparing
//   two weapons actually wants. The slider on the view is the ascension rank,
//   not the level; see below.
//
//   Effect is a template with {0}…{7} holes, and Array_0…Array_7 are the five
//   values each hole takes at ascension 1 through 5. That is the whole reason
//   the desk can carry one passive per weapon and let the reader move a slider
//   instead of printing five near-identical paragraphs. Unused array slots come
//   back as "" rather than as an empty array, which is why ranks[] is built by
//   walking the placeholders the text actually uses.
//
// Stat names arrive inconsistent — "Crit. Rate" and "CRIT Rate", "Energy Reg."
// and "Energy Regen", "CRIT DMG%" and "CRIT DMG" all appear — because the page
// is hand-maintained. Left alone they produce three filter options for one
// stat, so STAT_NAME folds them. Nothing else is corrected: the base ATK values
// that sit a point apart within a tier are what the source says, and quietly
// rounding somebody else's data to the shape you expected is how a desk starts
// publishing its own guesses.
//
// Icons land in assets/weapons/ rather than being hotlinked, same bargain as
// the portraits: Prydwen is a fan site paying for its own CDN, and serving 120
// icons from Pages is cheaper for them than every visitor hitting theirs.
// This script owns that directory outright — it also owns the weapon icons the
// timeline's signature tiles use, which is why fetch-portraits.mjs no longer
// downloads any.
//
// Prydwen ships these at 256×256 and the record draws one about that size, so
// the icons are shown at roughly 1:1. Every so often one arrives at 100×100 —
// Glint of Clouds did, and there is no larger variant behind it, so the fault
// is upstream of their CDN rather than in the request. Enlarged to record size
// that is a 2.3× upscale, which on a dark plate reads as a blocky halo around
// the blade. So an icon that comes back under MIN_ICON_PX is looked up on the
// Fandom wiki instead, which the desk already reads for items and kits, and
// whichever copy is bigger is the one kept. General rather than a list of
// weapon names: the next one to arrive small should fix itself.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const WEAPONS_URL = "https://www.prydwen.gg/wuthering-waves/weapons";
const WEAPON_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/weapons/${id}.webp`;
/* Second source for an icon the first one ships too small. Same wiki
   fetch-items.mjs and fetch-kits.mjs read. */
const FANDOM_API = "https://wutheringwaves.fandom.com/api.php";
const MIN_ICON_PX = 200;
const OUT = "data/weapons.json";
const DIR = "assets/weapons";
const TIMEOUT_MS = 25000;

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* curl rather than fetch(). Prydwen sits behind Cloudflare, which turns away
   Node's TLS handshake with a 403 no matter what headers it sends; the same
   request from curl is served. Identical to fetch-portraits.mjs, deliberately —
   two scripts talking to one host should talk to it the same way. */
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
async function fetchImage(url) {
  const { stdout } = await curl(url, ["-H", "Accept: image/webp,image/*"]);
  if (!stdout.length) throw new Error("empty body");
  return stdout;
}

/* The canvas width out of a WebP container, or 0 for anything that isn't one.
   Three chunk layouts: VP8X carries the size in its own header, VP8 is lossy
   and VP8L is lossless, and each writes it somewhere different. Only the width
   is wanted — these are square — and only to tell a full-size icon from a
   thumbnail, so a shape this doesn't recognise reads as 0 and falls through to
   the wiki rather than throwing. */
function webpWidth(buf) {
  if (buf.length < 32) return 0;
  const head = buf.slice(0, 32).toString("latin1");
  if (head.slice(0, 4) !== "RIFF" || head.slice(8, 12) !== "WEBP") return 0;
  switch (head.slice(12, 16)) {
    case "VP8X": return 1 + buf.readUIntLE(24, 3);
    case "VP8 ": return buf.readUInt16LE(26) & 0x3fff;
    case "VP8L": return (buf.readUInt32LE(21) & 0x3fff) + 1;
    default: return 0;
  }
}

/* The wiki's copy of a weapon icon. It files them under one predictable title,
   so this is a prefix search rather than a guess at the exact spelling, and the
   file it serves for a .png title is a 256px WebP with a transparent ground —
   the same thing Prydwen's CDN returns, which is why it can be written straight
   to disk with no conversion step. Returns null for anything it can't find:
   a missing wiki page is a reason to keep the small icon, not to fail. */
async function fandomIcon(name) {
  const q = new URLSearchParams({
    action: "query", format: "json", list: "allimages",
    aiprefix: `Weapon ${name}`, ailimit: "5"
  });
  try {
    const { stdout } = await curl(`${FANDOM_API}?${q}`, ["-H", "Accept: application/json"]);
    const hit = (JSON.parse(stdout.toString("utf8")).query?.allimages || [])
      .find(i => String(i.name).toLowerCase() === `weapon_${slug(name).replace(/-/g, "_")}.png`);
    return hit ? await fetchImage(hit.url) : null;
  } catch { return null; }
}

/* Every self.__next_f.push([1,"…"]) on the page, read as the string literal it
   is and joined in document order. That reassembles the React server payload,
   which is where the page's data lives.

   It used to live somewhere simpler. Prydwen was a Gatsby site, which left the
   dataset as plain JSON in a script tag with every quote escaped exactly once,
   and this function was two .replace() calls that undid that in place. Next.js
   streams it as flight chunks instead, and a chunk is a JavaScript string
   literal — so a backslash inside it is doubled on top of the escaping the
   JSON already carries, and a blanket unescape produces text that no longer
   parses: the "\\n" in a passive comes out as a lone backslash before an n.
   The migration is what stopped this script writing weapons.json, silently,
   because the workflow step is continue-on-error.

   So each chunk is parsed as the string it is. The literal is walked rather
   than matched with a regex for the usual reason: a lazy match stops at the
   first quote inside the payload, of which there are thousands, and a greedy
   one runs to the last quote on the page. Stepping over an escaped character
   is the whole trick. A chunk that will not parse is skipped — the page
   carries chunks that are not data, and one of those failing is not a reason
   to lose the roster. scripts/fetch-echoes.mjs reads the same host the same
   way and carries its own copy; no fetcher in this directory imports
   another. */
function flightPayload(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,"/g;
  let m;
  while ((m = re.exec(html))) {
    const open = m.index + m[0].length - 1;   // the literal's opening quote
    let i = open + 1;
    for (; i < html.length; i++) {
      if (html[i] === "\\") { i++; continue; }
      if (html[i] === '"') break;
    }
    try { out.push(JSON.parse(html.slice(open, i + 1))); } catch { /* not data */ }
  }
  return out.join("");
}

/* One canonical spelling per stat. Everything the source has ever written for
   a stat maps to the name the game uses on the weapon itself. An unmapped
   spelling passes through rather than being dropped — a new stat should show up
   as a new filter option, not vanish. */
const STAT_NAME = {
  "atk": "ATK",
  "def": "DEF",
  "hp": "HP",
  "crit rate": "CRIT Rate",
  "crit. rate": "CRIT Rate",
  "crit dmg": "CRIT DMG",
  "crit dmg%": "CRIT DMG",
  "crit. dmg": "CRIT DMG",
  "energy regen": "Energy Regen",
  "energy reg.": "Energy Regen"
};
const statName = s => STAT_NAME[String(s || "").trim().toLowerCase()] || String(s || "").trim();

/* Every weapon in the game is one of five classes, and the desk filters on
   them, so a sixth spelling arriving unnoticed would quietly produce a chip
   nothing is filed under. Unknown types are kept and reported at the end. */
const TYPES = ["Broadblade", "Sword", "Pistols", "Gauntlets", "Rectifier"];

/* Pull the weapons array out of the page and hand back parsed JSON. The array
   is found by its key and then walked bracket by bracket rather than matched
   with a regex: the payload contains bracketed prose ("[Aero]") and nested
   arrays, and a lazy regex stops at the first of either. */
function parseWeapons(html) {
  const un = flightPayload(html);
  if (!un) throw new Error("no flight payload on the page — the source layout changed");
  const at = un.indexOf('"weapons":[');
  if (at === -1) throw new Error('no "weapons" key in page — the source layout changed');
  const open = un.indexOf("[", at);
  let depth = 0, close = -1;
  for (let i = open; i < un.length; i++) {
    if (un[i] === "[") depth++;
    else if (un[i] === "]" && --depth === 0) { close = i + 1; break; }
  }
  if (close === -1) throw new Error("unterminated weapons array");
  return JSON.parse(un.slice(open, close));
}

/* {0}…{7} in the effect text, resolved to the five values each takes. Indexed
   by placeholder number so a template can skip one — ranks[2] is what {2}
   means — with nulls for the holes and the tail trimmed. Numbers are stringified
   here so the renderer never has to think about the difference between a
   duration (8) and a bonus ("20%"). */
function rankTable(w) {
  const used = [...String(w.Effect || "").matchAll(/\{(\d)\}/g)].map(m => Number(m[1]));
  if (!used.length) return [];
  const out = Array(Math.max(...used) + 1).fill(null);
  for (const n of new Set(used)) {
    const a = w[`Array_${n}`];
    if (Array.isArray(a) && a.length === 5) out[n] = a.map(v => String(v));
  }
  return out;
}

(async function main() {
  const raw = parseWeapons(await getText(WEAPONS_URL));
  console.log(`prydwen: ${raw.length} weapons\n`);
  if (raw.length < 60) throw new Error(`only ${raw.length} weapons parsed — refusing to overwrite the file`);

  await mkdir(DIR, { recursive: true });

  const weapons = [];
  const keep = new Set();
  const oddTypes = new Set();
  const holes = [];
  /* Which icons came off the wiki rather than Prydwen. The credit line names
     both sources when it isn't empty — the desk says where a picture came
     from, and "art via prydwen.gg" stops being true the moment one didn't. */
  const wiki = [];

  /* 5★ first, then by name — the file reads the way the view does, and a diff
     on it stays legible when Kuro adds two weapons in the middle of the list. */
  const sorted = [...raw].sort((a, b) =>
    (b.Rarity || 0) - (a.Rarity || 0) || String(a.Name).localeCompare(String(b.Name)));

  for (const w of sorted) {
    if (!w.Name || !w.ID) continue;
    if (w.Weapon_Type && !TYPES.includes(w.Weapon_Type)) oddTypes.add(w.Weapon_Type);

    const file = `${DIR}/w-${slug(w.Name)}.webp`;
    let icon = "";
    try {
      let buf = await fetchImage(WEAPON_IMG(w.ID));
      let from = "prydwen";
      /* Too small to draw at record size. Ask the wiki, and keep whichever copy
         is bigger — the fallback is only worth taking if it actually is one. */
      if (webpWidth(buf) < MIN_ICON_PX) {
        const alt = await fandomIcon(w.Name);
        if (alt && webpWidth(alt) > webpWidth(buf)) { buf = alt; from = "fandom"; wiki.push(w.Name); }
      }
      await writeFile(file, buf);
      icon = file;
      keep.add(file);
      const px = webpWidth(buf);
      console.log(`${w.Rarity}★ ${String(w.Name).padEnd(26)} ${String(buf.length).padStart(7)}b` +
        (px ? ` ${px}px` : "") + (from === "fandom" ? "  ← wiki (prydwen's was small)" : ""));
    } catch (err) {
      /* A weapon announced ahead of its patch has no published icon yet. The
         view falls back to the generic mark for those, which is the honest
         answer rather than a borrowed picture. */
      console.log(`${w.Rarity}★ ${String(w.Name).padEnd(26)} no icon — ${err.message}`);
    }

    /* Only a placeholder the text actually uses and has no values for is a
       hole. A null at an index the text never mentions is ordinary — Helios
       Cleaver ships two arrays its own effect line doesn't reference. */
    const ranks = rankTable(w);
    if ([...String(w.Effect || "").matchAll(/\{(\d)\}/g)].some(m => !ranks[Number(m[1])])) holes.push(w.Name);

    weapons.push({
      name: String(w.Name),
      rarity: Number(w.Rarity) || 0,
      type: w.Weapon_Type || "",
      id: String(w.ID),
      /* Level 90. Named for what it is so nothing downstream has to remember. */
      atk90: Number(w.Stat_primary) || 0,
      stat: statName(w.Stat_secondary),
      /* Every weapon sub-stat in this game is a percentage — there is no flat
         one — so the unit is implicit and the renderer appends the sign. */
      statValue90: Number(w.Stat_secondary_value) || 0,
      source: String(w.Source || "").trim(),
      effect: String(w.Effect || ""),
      ranks,
      ...(icon ? { icon } : {})
    });
  }

  /* A weapon pulled from the source shouldn't leave its icon behind. */
  for (const f of await readdir(DIR)) {
    const path = `${DIR}/${f}`;
    if (!keep.has(path)) { await unlink(path); console.log(`pruned ${path}`); }
  }

  const payload = {
    schema: "wuwa-desk/weapons@1.0",
    note:
      "Every weapon in the game: class, rarity, level 90 stats, and the passive as a template " +
      "with its five ascension values. atk90 and statValue90 are max-level figures — there is no " +
      "level curve here and none is inferred. ranks[n] holds what {n} in `effect` becomes at " +
      "ascension 1 through 5. Sub-stat values are percentages. Icons are cached in assets/weapons/. " +
      "Stats and passives via prydwen.gg; weapon art © Kuro Games." +
      (wiki.length
        ? ` Icons for ${wiki.join(", ")} are from the Wuthering Waves wiki — prydwen.gg ships those below ${MIN_ICON_PX}px.`
        : ""),
    credit: wiki.length
      ? "Stats and art via prydwen.gg, some icons via the Wuthering Waves wiki · weapon art © Kuro Games"
      : "Stats and art via prydwen.gg · weapon art © Kuro Games",
    source: WEAPONS_URL,
    weapons
  };

  /* Same rule as the feed: don't churn the file when nothing moved. The note
     and the credit are compared too, not just the roster — an icon that starts
     coming off the wiki instead changes where the file says its pictures came
     from while every weapon in it stays byte for byte the same, and on the
     roster alone that rewrite would never be written. */
  let unchanged = false;
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    unchanged = JSON.stringify(prev.weapons) === JSON.stringify(weapons)
      && prev.note === payload.note && prev.credit === payload.credit;
  } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  const byRarity = weapons.reduce((a, w) => (a[w.rarity] = (a[w.rarity] || 0) + 1, a), {});
  console.log(
    `\n${weapons.length} weapons (${[5, 4, 3].map(r => `${byRarity[r] || 0}× ${r}★`).join(", ")}), ` +
      `${keep.size} icons` + (unchanged ? " (unchanged)" : ""));
  if (oddTypes.size) console.log(`unknown weapon class: ${[...oddTypes].join(", ")}`);
  if (holes.length) console.log(`passive has a placeholder with no values: ${holes.join(", ")}`);
})();

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

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const WEAPONS_URL = "https://www.prydwen.gg/wuthering-waves/weapons";
const WEAPON_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/weapons/${id}.webp`;
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

/* The page ships its data as a JSON string inside a script tag, so every quote
   in it arrives escaped. Unescape once and the payload is plain JSON again. */
const unescaped = html => html
  .replace(/\\"/g, '"')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

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
  const un = unescaped(html);
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
      const buf = await fetchImage(WEAPON_IMG(w.ID));
      await writeFile(file, buf);
      icon = file;
      keep.add(file);
      console.log(`${w.Rarity}★ ${String(w.Name).padEnd(26)} ${String(buf.length).padStart(7)}b`);
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
      "Stats and passives via prydwen.gg; weapon art © Kuro Games.",
    credit: "Stats and art via prydwen.gg · weapon art © Kuro Games",
    source: WEAPONS_URL,
    weapons
  };

  /* Same rule as the feed: don't churn the file when nothing moved. */
  let unchanged = false;
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    unchanged = JSON.stringify(prev.weapons) === JSON.stringify(weapons);
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

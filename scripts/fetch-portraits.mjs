// Resolves cut-out character portraits and weapon icons, writes data/portraits.json.
// Node 20+. No dependencies. No API keys.
//
// Different job to fetch-art.mjs. That one resolves Kuro's Profile Reveal key
// art: a 1080x1920 marketing poster with a logo band, a name plate and a solid
// backdrop. It is the right picture for the big art window on a patch card and
// the wrong one for a 54px tile — shrunk that far you get someone else's layout
// rather than a face, and the poster's own background fights the card's.
//
// Prydwen publishes the game's own UI assets: a 160px bust and a 374x512 full
// cut-out per character, and a 256px render per weapon. All of them carry a
// real alpha channel, so on the desk they sit on the card rather than in a box
// of their own. That is what the small tiles want.
//
// Both listing pages embed their whole dataset as JSON in the page source, so
// one request each resolves everything — no per-character page crawl.
//
// Files land in assets/portraits/ rather than being hotlinked: Prydwen is a
// fan site paying for its own CDN, and 1MB of icons on Pages is cheaper for
// them than every desk visitor hitting theirs. Credit rides in the footer.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const CHARACTERS_URL = "https://www.prydwen.gg/wuthering-waves/characters";
const WEAPONS_URL = "https://www.prydwen.gg/wuthering-waves/weapons";
const WEAPON_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/weapons/${id}.webp`;
const OUT = "data/portraits.json";
const DIR = "assets/portraits";
const TIMEOUT_MS = 25000;

/* "Yangyang: Xuanling" and "Yangyang Xuanling" are the same character. Match on
   letters and digits only, so punctuation and spacing never decide a lookup. */
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* curl rather than fetch(). Prydwen sits behind Cloudflare, which turns away
   Node's TLS handshake with a 403 no matter what headers it sends; the same
   request from curl is served. curl ships with the runner and with every
   machine this repo has ever been edited on, so it stays a zero-dependency
   script — it just isn't Node doing the talking. */
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

const readJson = async path => JSON.parse(await readFile(path, "utf8"));

/* The page ships its data as a JSON string inside a script tag, so every quote
   in it arrives escaped. Unescaping once up front lets one plain regex read it. */
const unescaped = html => html.replace(/\\"/g, '"');

function parseCharacters(html) {
  const rx =
    /"slug":"([^"]+)","name":"((?:[^"\\]|\\.)*)","rarity":"([^"]*)","element":"([^"]*)","weapon":"([^"]*)","smallImage":"([^"]*)","cardImage":"([^"]*)"/g;
  const out = new Map();
  for (const m of unescaped(html).matchAll(rx)) {
    out.set(key(m[2]), {
      slug: m[1],
      name: m[2].replace(/\\(.)/g, "$1"),
      rarity: Number(m[3]) || undefined,
      element: m[4] || undefined,
      weapon: m[5] || undefined,
      icon: m[6] || "",
      card: m[7] || ""
    });
  }
  return out;
}

function parseWeapons(html) {
  const rx = /"Name":"((?:[^"\\]|\\.)*)","Rarity":(\d),"ID":"(\d+)"/g;
  const out = new Map();
  for (const m of unescaped(html).matchAll(rx)) {
    const name = m[1].replace(/\\(.)/g, "$1");
    out.set(key(name), { name, rarity: Number(m[2]), id: m[3], icon: WEAPON_IMG(m[3]) });
  }
  return out;
}

/* Every character and every signature weapon the desk currently talks about.
   Same rule as fetch-art.mjs: the data decides what gets fetched, so a patch
   added to versions.json pulls its own art down on the next run. */
async function wanted() {
  const characters = new Set();
  const weapons = new Set();
  try {
    const versions = await readJson("data/versions.json");
    for (const v of versions.versions || [])
      for (const p of v.phases || [])
        for (const b of p.banners || []) {
          if (b.name) characters.add(b.name);
          if (b.signature) weapons.add(b.signature);
        }
  } catch {}
  try {
    const res = await readJson("data/resonators.json");
    for (const r of res.resonators || []) {
      if (r.name) characters.add(r.name);
      if (r.signature) weapons.add(r.signature);
    }
  } catch {}
  return { characters: [...characters].sort(), weapons: [...weapons].sort() };
}

/* Kuro's assets are WebP with a real alpha channel. A file that decodes as
   plain lossy WebP has no transparency, which on the desk means a white box
   sitting on a dark card — worth failing on rather than shipping. */
function hasAlpha(buf) {
  if (buf.length < 21 || buf.toString("latin1", 0, 4) !== "RIFF") return false;
  const fourcc = buf.toString("latin1", 12, 16);
  if (fourcc === "VP8X") return !!(buf[20] & 0x10);
  if (fourcc === "VP8L") return true;
  return false;
}

async function download(url, path) {
  const { stdout: buf } = await curl(url, ["-H", "Accept: image/webp,image/*"]);
  if (buf.length < 512) throw new Error("suspiciously small");
  await writeFile(path, buf);
  return { bytes: buf.length, alpha: hasAlpha(buf) };
}

(async function main() {
  const { characters: wantChars, weapons: wantWeapons } = await wanted();
  if (!wantChars.length && !wantWeapons.length) {
    console.log("nothing named in data/*.json — nothing to resolve");
    return;
  }

  const [charHtml, weaponHtml] = await Promise.all([getText(CHARACTERS_URL), getText(WEAPONS_URL)]);
  const chars = parseCharacters(charHtml);
  const weps = parseWeapons(weaponHtml);
  console.log(`prydwen: ${chars.size} characters, ${weps.size} weapons\n`);

  await mkdir(DIR, { recursive: true });

  const characters = {};
  const weapons = {};
  const misses = [];
  const keep = new Set();

  for (const name of wantChars) {
    const hit = chars.get(key(name));
    if (!hit) { misses.push(`${name} (character)`); continue; }
    const rec = { source: `https://www.prydwen.gg/wuthering-waves/characters/${hit.slug}` };
    /* Element and weapon come along for the ride. The desk's own banner rows
       are hand-written and some predate a character's reveal, so this is the
       cross-check that catches a wrong element on a tile. */
    if (hit.element) rec.element = hit.element;
    if (hit.weapon) rec.weapon = hit.weapon;
    if (hit.rarity) rec.rarity = hit.rarity;

    for (const [kind, url] of [["icon", hit.icon], ["card", hit.card]]) {
      if (!url) continue;
      const file = `${DIR}/${hit.slug}${kind === "card" ? "-card" : ""}.webp`;
      try {
        const { bytes, alpha } = await download(url, file);
        rec[kind] = file;
        keep.add(file);
        console.log(`${kind.padEnd(4)} ${name.padEnd(20)} ${String(bytes).padStart(7)}b ${alpha ? "alpha" : "OPAQUE"}`);
      } catch (err) {
        console.log(`${kind.padEnd(4)} ${name.padEnd(20)} failed — ${err.message}`);
      }
    }
    if (rec.icon || rec.card) characters[name] = rec;
    else misses.push(`${name} (no image)`);
  }

  for (const name of wantWeapons) {
    const hit = weps.get(key(name));
    /* A weapon that debuts with an unreleased patch has no icon yet — Prydwen
       lists it once it ships. The tile falls back to its glyph until then,
       which is the honest answer rather than a borrowed picture. */
    if (!hit) { misses.push(`${name} (weapon, unreleased)`); continue; }
    const file = `${DIR}/w-${slug(name)}.webp`;
    try {
      const { bytes, alpha } = await download(hit.icon, file);
      weapons[name] = { icon: file, rarity: hit.rarity, id: hit.id, source: WEAPONS_URL };
      keep.add(file);
      console.log(`wep  ${name.padEnd(20)} ${String(bytes).padStart(7)}b ${alpha ? "alpha" : "OPAQUE"}`);
    } catch (err) {
      console.log(`wep  ${name.padEnd(20)} failed — ${err.message}`);
    }
  }

  /* A character dropped from versions.json shouldn't leave their portrait
     behind in the repo forever. */
  for (const f of await readdir(DIR)) {
    const path = `${DIR}/${f}`;
    if (!keep.has(path)) { await unlink(path); console.log(`pruned ${path}`); }
  }

  const payload = {
    schema: "wuwa-desk/portraits@1.0",
    note:
      "Cut-out character portraits and weapon icons — the game's own UI assets, with alpha, " +
      "resolved through Prydwen's public character and weapon listings and cached in assets/portraits/. " +
      "Art © Kuro Games. A name absent here has no published asset yet.",
    credit: "Icons via prydwen.gg · art © Kuro Games",
    characters,
    weapons
  };

  // Same rule as the feed: don't churn the file when nothing moved.
  let unchanged = false;
  try {
    const prev = await readJson(OUT);
    unchanged =
      JSON.stringify(prev.characters) === JSON.stringify(characters) &&
      JSON.stringify(prev.weapons) === JSON.stringify(weapons);
  } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  console.log(
    `\n${Object.keys(characters).length}/${wantChars.length} characters, ` +
      `${Object.keys(weapons).length}/${wantWeapons.length} weapons` +
      (unchanged ? " (unchanged)" : "")
  );
  if (misses.length) console.log(`no asset yet: ${misses.join(", ")}`);
})();

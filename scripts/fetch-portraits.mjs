// Resolves character art — bust and card — and writes data/portraits.json.
// Node 20+. No dependencies. No API keys.
//
// Weapon icons used to be this script's other half. They live in
// scripts/fetch-weapons.mjs now, which resolves all 120 of them alongside the
// stats and passives the Weapons view is built out of, rather than the 36 that
// happen to be somebody's signature.
//
// Two sizes per character, because the desk asks two different questions:
//
//   icon  160px bust      — a 54px banner tile. Head only, already centred.
//   card  374x512 cut-out — waist-up. Every frame bigger than a thumbnail.
//
// Both carry a real alpha channel, so on the desk they stand on the card rather
// than in a box of their own.
//
// A third size used to be resolved here: the 2048x2048 illustration at the foot
// of a Prydwen character page, under "Gallery", which the desk preferred
// everywhere it existed. It is gone, and the reason is consistency. That slot
// holds one image but two kinds of picture — before a character releases it is
// a standing render, after they release Prydwen tends to swap in the Resonance
// Liberation splash, a painted scene with the character inside it at a tenth of
// the size. The splash is a composition; cropping it to a 4:5 panel produces a
// picture of somebody's elbow, so those had to be detected and dropped. Which
// left the desk with two populations: whoever released most recently drawn from
// a full-body square, everyone before them from the waist-up card, and a
// character silently changing from one to the other on release day. The square
// also had to be zoomed back in at every size to find a face — a different
// hand-tuned scale on a record, in the drawer, on a patch card, on a phone.
// The card is sharper than nothing, identical for all sixty, already cropped to
// what the desk shows, and stable. That is the better trade.
//
// The listing page embeds its whole dataset as JSON in the page source, so one
// request resolves every bust and card for every character.
//
// Files land in assets/portraits/ rather than being hotlinked: Prydwen is a
// fan site paying for its own CDN, and serving the art from Pages is cheaper
// for them than every desk visitor hitting theirs. Credit rides in the footer.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const CHARACTERS_URL = "https://www.prydwen.gg/wuthering-waves/characters";
const OUT = "data/portraits.json";
const DIR = "assets/portraits";
const TIMEOUT_MS = 25000;

/* "Yangyang: Xuanling" and "Yangyang Xuanling" are the same character. Match on
   letters and digits only, so punctuation and spacing never decide a lookup. */
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
   in it arrives escaped. Unescaping once up front lets one plain regex read it.
   The \uXXXX escapes have to come out too: Prydwen writes an ampersand as
   &, so "Lux & Umbra" reached the matcher as "Lux u0026 Umbra", keyed to
   something no lookup could ever ask for, and Galbrena's signature weapon was
   filed as unreleased for as long as the name had an & in it. */
const unescaped = html => html
  .replace(/\\"/g, '"')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

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

/* Every character the desk currently talks about. Same rule as fetch-art.mjs:
   the data decides what gets fetched, so a patch added to versions.json pulls
   its own art down on the next run. */
async function wanted() {
  const characters = new Set();
  try {
    const versions = await readJson("data/versions.json");
    for (const v of versions.versions || [])
      for (const p of v.phases || [])
        for (const b of p.banners || [])
          if (b.name) characters.add(b.name);
  } catch {}
  try {
    const res = await readJson("data/resonators.json");
    for (const r of res.resonators || [])
      if (r.name) characters.add(r.name);
  } catch {}
  return [...characters].sort();
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

async function fetchImage(url) {
  const { stdout: buf } = await curl(url, ["-H", "Accept: image/webp,image/*"]);
  if (buf.length < 512) throw new Error("suspiciously small");
  return buf;
}

async function download(url, path) {
  const buf = await fetchImage(url);
  await writeFile(path, buf);
  return { bytes: buf.length, alpha: hasAlpha(buf) };
}

(async function main() {
  const wantChars = await wanted();
  if (!wantChars.length) {
    console.log("nothing named in data/*.json — nothing to resolve");
    return;
  }

  const chars = parseCharacters(await getText(CHARACTERS_URL));
  console.log(`prydwen: ${chars.size} characters\n`);

  await mkdir(DIR, { recursive: true });

  const characters = {};
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

  /* A character dropped from versions.json shouldn't leave their portrait
     behind in the repo forever. This also sweeps out the w-*.webp icons this
     script used to write — scripts/fetch-weapons.mjs owns weapon art now, and
     keeps it in assets/weapons/ where all 120 of them live rather than the 36
     that happen to be somebody's signature — and the *-full.webp gallery
     renders, from back when the desk drew its newest characters from those. */
  for (const f of await readdir(DIR)) {
    const path = `${DIR}/${f}`;
    if (!keep.has(path)) { await unlink(path); console.log(`pruned ${path}`); }
  }

  const payload = {
    schema: "wuwa-desk/portraits@1.0",
    note:
      "Character art at two sizes — 160px bust and 374x512 waist-up card. " +
      "Both cut-outs with alpha, resolved through Prydwen's public character listing and cached " +
      "in assets/portraits/. Art © Kuro Games. " +
      "A name absent here has no published asset yet. " +
      "Weapon icons moved to data/weapons.json and assets/weapons/.",
    credit: "Art via prydwen.gg · art © Kuro Games",
    characters
  };

  /* Same rule as the feed: don't churn the file when nothing moved. Everything
     but the timestamp is compared, not just the characters — when this script
     stopped writing a `weapons` key, comparing one field left the old one
     sitting in the file with nothing to refresh it. */
  let unchanged = false;
  try {
    const { updated, ...prev } = await readJson(OUT);
    unchanged = JSON.stringify(prev) === JSON.stringify(payload);
  } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  console.log(
    `\n${Object.keys(characters).length}/${wantChars.length} characters` +
      (unchanged ? " (unchanged)" : "")
  );
  if (misses.length) console.log(`no asset yet: ${misses.join(", ")}`);
})();

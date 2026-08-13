// Resolves character art — bust, card and gallery — plus weapon icons, and
// writes data/portraits.json. Node 20+. No dependencies. No API keys.
//
// Three sizes per character, because the desk asks three different questions:
//
//   icon  160px bust        — a 54px banner tile. Head only, already centred.
//   card  374x512 cut-out   — waist-up. The old stand-in for the big art panel.
//   full  2048x2048 cut-out — the official full-body illustration. The picture
//                             at the foot of a Prydwen character page, under
//                             "Gallery", and now the desk's artwork everywhere
//                             the frame is bigger than a thumbnail.
//
// The card image was doing the full picture's job and it shows: 374px of source
// stretched across a 360px-wide art panel is soft, and it sat beside patches
// whose art happened to be hand-placed at 750px and read as a different site.
// One source for every character fixes both.
//
// All three carry a real alpha channel, so on the desk they stand on the card
// rather than in a box of their own.
//
// One catch, and it is the reason for alphaShare() below. That gallery slot
// holds one image but two kinds of picture. Before a character releases it is a
// standing render — one figure, head at the top, clear air either side. After
// they release Prydwen tends to swap in the Resonance Liberation splash: a wide
// painted scene with the character somewhere inside it at a tenth of the size.
// The first is a portrait and can be cropped like one. The second is a
// composition, and cropping it to a 4:5 panel produces a picture of somebody's
// elbow. Nothing on the page says which is which, so the file does: a standing
// figure's alpha plane is one smooth silhouette and costs 6-19% of the file,
// while a scene's is a lace of glow and shards across the whole canvas and
// costs 38-49%. Scenes are measured, logged and dropped — the desk falls back to
// the waist-up card for those characters, which is a cut-out portrait and frames
// like every other record. A splash painted inside a closed shape measures like
// a silhouette and slips through; see SCENES below.
//
// Where does the gallery picture come from? Kuro's own EN site is a client-side
// app with no public asset index, and the reveal-post CDN that fetch-art.mjs
// reads only ever carries the 1080x1920 marketing poster — logo band, name
// plate, painted backdrop, no alpha. The cut-out illustration is not published
// anywhere upstream that can be resolved from a URL, so Prydwen is the source
// and is credited as such.
//
// Both listing pages embed their whole dataset as JSON in the page source, so
// one request each resolves the busts, the cards and every weapon. The gallery
// picture is the exception — it appears only on a character's own page — but
// its URL is derived from the same slug, so the page is fetched only when the
// derived URL misses.
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
const WEAPONS_URL = "https://www.prydwen.gg/wuthering-waves/weapons";
const CHARACTER_URL = slug => `https://www.prydwen.gg/wuthering-waves/characters/${slug}`;
const WEAPON_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/weapons/${id}.webp`;
const FULL_IMG = slug => `https://cdn.prydwen.gg/images/wuthering-waves/characters/${slug}_full.webp`;
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

/* What share of the file the alpha plane costs. A WebP with transparency keeps
   it in its own ALPH chunk, and the chunk table is readable without decoding a
   single pixel: four bytes of id, four of length, skip, repeat.

   It is a shape measurement in disguise. A cut-out standing figure has one
   smooth closed silhouette, which is cheap; a painted scene full of soft glow
   and scattered debris has an alpha plane nearly as expensive as its colour
   plane. Across the desk's current cast the two sit at 6-19% and 38-49% with
   nothing in between, so the line is drawn at 28% — the middle of the gap. */
function alphaShare(buf) {
  if (buf.toString("latin1", 0, 4) !== "RIFF") return 0;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString("latin1", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === "ALPH") return size / buf.length;
    o += 8 + size + (size & 1); // chunks are padded to an even length
  }
  return 0;
}
const SCENE_ALPHA = 0.28;

/* One correction the measurement cannot make on its own. Iuno's gallery picture
   is a Liberation splash painted inside a circle — a disc of scene on an
   otherwise empty square — so its alpha plane is one smooth closed curve and
   costs 23% of the file, on the portrait side of the line, while every scene the
   threshold was drawn against is a ragged full-canvas spray at 38-49%. The
   nearest genuine render measures 19%, which leaves no room to move the line.
   Named here with the number instead, so the next one is a one-line edit rather
   than a re-tuned heuristic. Keyed by Prydwen slug, the same key everything
   else in this file is fetched by. */
const SCENES = new Set(["iuno"]);

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

/* The gallery picture. Prydwen names it after the character's own slug, which
   is the same slug the listing page just handed us, so the ordinary case costs
   one request and no HTML. Reading the page is the fallback rather than the
   rule: it is 300KB of markup to learn a URL we can usually derive, but it is
   the only thing that still works if they ever rename the file — and the tag is
   marked `class="full-image"`, so it is a stable thing to look for. */
async function galleryUrl(slug) {
  try {
    await curl(FULL_IMG(slug), ["-I"]);
    return FULL_IMG(slug);
  } catch {}
  const html = await getText(CHARACTER_URL(slug));
  const m = html.match(/class="full-image"[^>]*\ssrc="([^"]+)"/);
  if (!m) throw new Error("no gallery image on the character page");
  return m[1];
}

/* Measured before it is written, so a scene never lands in the repo: it is 600KB
   the desk has no frame for, and rehosting a fan site's bandwidth for a picture
   nothing renders is the wrong way round. */
async function resolveGallery(slug, path) {
  const url = await galleryUrl(slug);
  const buf = await fetchImage(url);
  const share = alphaShare(buf);
  if (SCENES.has(slug) || share >= SCENE_ALPHA) return { url, share, scene: true, named: SCENES.has(slug) };
  await writeFile(path, buf);
  return { url, share, scene: false, bytes: buf.length, alpha: hasAlpha(buf) };
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
    /* The big one, last, and never fatal: a character Prydwen has a stub page
       for has a bust and a card long before anyone has drawn the illustration,
       and a released one may have a scene there instead of a portrait. Either
       way the art panel loses a sharper picture, not a picture. */
    const fullFile = `${DIR}/${hit.slug}-full.webp`;
    try {
      const g = await resolveGallery(hit.slug, fullFile);
      const pct = `${(g.share * 100).toFixed(0)}% alpha`;
      if (g.scene) {
        rec.gallery = "scene";
        console.log(`full ${name.padEnd(20)} ${" ".repeat(7)}  scene — ${pct}${g.named ? ", named in SCENES" : ""}, not a portrait`);
      } else {
        rec.full = fullFile;
        rec.gallery = "render";
        rec.fullSource = g.url;
        keep.add(fullFile);
        console.log(`full ${name.padEnd(20)} ${String(g.bytes).padStart(7)}b ${g.alpha ? "alpha" : "OPAQUE"} · ${pct}`);
      }
    } catch (err) {
      console.log(`full ${name.padEnd(20)} failed — ${err.message}`);
    }

    if (rec.icon || rec.card || rec.full) characters[name] = rec;
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
      "Character art at three sizes — 160px bust, 374x512 card, 2048x2048 gallery render — " +
      "and weapon icons. All cut-outs with alpha, resolved through Prydwen's public character and " +
      "weapon listings and cached in assets/portraits/. Art © Kuro Games. " +
      "gallery:\"scene\" means Prydwen's gallery holds the Resonance Liberation splash rather than " +
      "a standing render — no portrait to crop, so the desk falls back to the waist-up card. " +
      "A name absent here has no published asset yet.",
    credit: "Art via prydwen.gg · art © Kuro Games",
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

// Gives every weapon on the desk a full-size icon, from the GitHub runner.
// Node 20+. No dependencies.
//
//   node scripts/fetch-weapon-icons.mjs
//
// fetch-weapons.mjs owns the weapon roster and its icons, but it starts from
// Prydwen's weapons *page*, and Prydwen answers GitHub Actions with a 403 — so
// on the cron it never gets as far as a picture. Twice that left patch day on
// the placeholder glyph: 3.7's Blooming Jadehaven and Unspoken Rue were beta
// records with no icon at all until somebody ran it at home.
//
// The page is only needed for the stats. The icon itself sits on Prydwen's
// image CDN under the game's own weapon id, and a beta record out of
// fetch-client-files.mjs already carries that id — so the icon can be had
// without the page, the moment Prydwen lists the weapon. This does exactly
// that, and nothing else:
//
//   - a weapon (live or beta) with no icon on disk gets the client's own icon
//     by id off nanoka's asset host, else Prydwen's by id, else the wiki's by
//     name;
//   - a weapon whose icon is under MIN_ICON_PX is offered all three again and
//     keeps whichever is biggest, the client's on a tie. Prydwen often ships a
//     new weapon at 100px, and not always the game's picture: 3.7's Blooming
//     Jadehaven and Unspoken Rue went up as close crops of some other render.
//     The client file is the icon the game draws, at 256px, from the beta on.
//
// Weapons already at full size cost nothing — no request is made for them.
// It writes only the icon files (assets/weapons/w-<slug>.webp, the same path
// fetch-weapons.mjs uses, so a weapon keeps its icon through release), their
// manifest lines, and `icon` on the records that were missing one. Stats and
// everything else stay where their own fetchers put them.

import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AssetCache } from "./lib/assets.mjs";
import { writeIfChanged } from "./lib/out.mjs";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";
const WEAPON_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/weapons/${id}.webp`;
/* The client's UI texture, as nanoka.cc extracts it. No build in the path. */
const CLIENT_IMG = id =>
  `https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconWeapon/T_IconWeapon${id}_UI.webp`;
const FANDOM_API = "https://wutheringwaves.fandom.com/api.php";
/* Same floor as fetch-weapons.mjs: the record draws an icon about 256px. */
const MIN_ICON_PX = 200;
const DIR = "assets/weapons";
const LIVE = "data/weapons.json";
const BETA = "data/clientfiles.json";

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const iconFile = name => `${DIR}/w-${slug(name)}.webp`;

/* curl, not fetch(): Prydwen's Cloudflare turns away Node's TLS handshake. */
async function download(url, accept = "image/webp,image/*") {
  const { stdout } = await run("curl", [
    "--silent", "--show-error", "--fail", "--location", "--compressed", "--max-time", "25",
    "-A", UA, "-H", "Accept-Language: en-GB,en;q=0.9", "-e", "https://www.prydwen.gg/",
    "-H", `Accept: ${accept}`, url
  ], { maxBuffer: 16 * 1024 * 1024, encoding: "buffer" });
  if (!stdout.length) throw new Error("empty body");
  return stdout;
}

/* Canvas width of a WebP, 0 for anything else. Same reader as fetch-weapons.mjs. */
function webpWidth(buf) {
  if (!buf || buf.length < 32) return 0;
  const head = buf.slice(0, 32).toString("latin1");
  if (head.slice(0, 4) !== "RIFF" || head.slice(8, 12) !== "WEBP") return 0;
  switch (head.slice(12, 16)) {
    case "VP8X": return 1 + buf.readUIntLE(24, 3);
    case "VP8 ": return buf.readUInt16LE(26) & 0x3fff;
    case "VP8L": return (buf.readUInt32LE(21) & 0x3fff) + 1;
    default: return 0;
  }
}

async function onDisk(file) {
  try { await stat(file); return await readFile(file); } catch { return null; }
}

/* The wiki files every weapon icon as "Weapon <Name>.png" and serves it as a
   256px transparent WebP — see fetch-weapons.mjs. */
async function fandom(name) {
  const q = new URLSearchParams({
    action: "query", format: "json", list: "allimages", aiprefix: `Weapon ${name}`, ailimit: "5"
  });
  const body = await download(`${FANDOM_API}?${q}`, "application/json");
  const want = `weapon_${slug(name).replace(/-/g, "_")}.png`;
  const hit = (JSON.parse(body.toString("utf8")).query?.allimages || [])
    .find(i => String(i.name).toLowerCase() === want);
  if (!hit) throw new Error("no wiki file");
  return { url: hit.url, buf: await download(hit.url) };
}

(async function main() {
  const live = JSON.parse(await readFile(LIVE, "utf8"));
  const beta = JSON.parse(await readFile(BETA, "utf8").catch(() => '{"weapons":[]}'));
  const liveNames = new Set((live.weapons || []).map(w => slug(w.name)));
  /* A beta record for a name the live file now has is on its way out, and its
     icon is the live one's. */
  const all = [
    ...(live.weapons || []).map(w => ({ w, doc: live })),
    ...(beta.weapons || []).filter(w => !liveNames.has(slug(w.name))).map(w => ({ w, doc: beta }))
  ];

  const cache = await AssetCache.open();
  const touched = new Set();
  let checked = 0, improved = 0;

  for (const { w, doc } of all) {
    const file = iconFile(w.name);
    const have = await onDisk(file);
    const px = webpWidth(have);
    /* Kept whether or not it is replaced below: writing one icon into
       assets/weapons makes cache.save() drop every manifest line in there this
       run did not keep, and fetch-weapons.mjs then re-downloads the lot. */
    if (have) await cache.reuse(file);
    if (have && px >= MIN_ICON_PX) {
      if (!w.icon) { w.icon = file; touched.add(doc); }
      continue;
    }
    checked++;

    const tries = [];
    let best = null;
    for (const [from, get] of [
      ["client", async () => { const url = CLIENT_IMG(w.id); return { url, buf: await download(url) }; }],
      ["prydwen", async () => { const url = WEAPON_IMG(w.id); return { url, buf: await download(url) }; }],
      ["wiki", () => fandom(w.name)]
    ]) {
      if (from !== "wiki" && !w.id) continue;
      try {
        const got = await get();
        const gpx = webpWidth(got.buf);
        tries.push(`${from} ${gpx || "?"}px`);
        if (gpx > (best ? webpWidth(best.buf) : px)) best = got;
      } catch (err) {
        tries.push(`${from} ${String(err.message).match(/error: (\d{3})/)?.[1] || err.message.split("\n")[0]}`);
      }
    }

    if (best) {
      await cache.put(file, best.url, best.buf);
      if (w.icon !== file) { w.icon = file; touched.add(doc); }
      improved++;
      console.log(`${String(w.name).padEnd(26)} ${px ? `${px}px -> ` : "none -> "}${webpWidth(best.buf)}px   (${tries.join(", ")})`);
    } else {
      console.log(`${String(w.name).padEnd(26)} ${px ? `kept ${px}px` : "still none"}   (${tries.join(", ")})`);
    }
  }

  await cache.save();
  const stamp = new Date().toISOString();
  if (touched.has(live)) await writeIfChanged(LIVE, { ...live, updated: stamp });
  if (touched.has(beta)) await writeIfChanged(BETA, { ...beta, updated: stamp });
  console.log(`\n${all.length} weapons, ${checked} missing or under ${MIN_ICON_PX}px, ${improved} improved`);
})().catch(err => {
  console.error(`fetch-weapon-icons failed: ${err.message}`);
  process.exitCode = 1;
});

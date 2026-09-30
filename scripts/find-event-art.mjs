// Finds the event banners inside a Kuro article image, prints crop coordinates.
// Node 20+. No dependencies. Run by hand, not by cron.
//
//   node scripts/find-event-art.mjs 5310
//
// Why this exists: for a patch that has not shipped, Kuro publishes the events
// as ONE tall infographic — a banner per event stacked down a single JPEG, with
// the name, window and rewards set beside each. They only cut the banners into
// posts of their own once the patch is live, which is what fetch-events.mjs
// reads. So between the preview broadcast and patch day, the art exists and is
// public, but only as a region of a sheet.
//
// The desk hotlinks those regions: Kuro's CDN is Alibaba OSS, which takes
// `image/crop` on the query string, so `art.crop` in data/events.json asks the
// CDN for the banner rather than this repo copying the file and cutting it up.
// Nothing is rehosted, and the crop is credited to the post it comes from.
//
// This script does the tedious half: it pulls every image in the article,
// converts each to a small BMP through the same CDN (no image library needed —
// OSS will hand you raw-ish pixels if you ask for BMP), finds the bands that
// are photographs rather than page background, and prints a ready-to-paste
// `art` block per band along with a preview URL to eyeball first.
//
// On its own it cannot say which band is which event: the infographic is
// pixels, so the names are not machine-readable. Open the preview URLs, match
// them to the events, paste the coordinates in. Ten minutes a patch.
//
//   node scripts/find-event-art.mjs --apply [articleId]
//
// does that half too, on Windows. It reads the sheet with the OCR engine that
// ships with Windows 10/11 (scripts/lib/ocr.ps1: nothing to install, no key,
// no account), finds each event's title, cuts the banner under it and writes
// the crop into data/events.json. With no id it takes the newest Update
// Content post, then the Version Preview post, for the patch on the desk.
// It only fills an event with no art, or one still on a crop out of an earlier
// post; a notice's own banner and a crop already taken from this post are left
// alone. Anything it cannot place is printed, not guessed. The event-art job in
// update-feeds.yml runs it every cycle on GitHub's Windows runner, which carries
// the same engine and is free on a public repo.

import { getJson, getBuffer } from "./lib/net.mjs";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const ARTICLE_URL = id => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;

/* The page's own frame runs a couple of pixels inside each banner. Trim it. */
const INSET_X = 18;
const INSET_Y = 14;
/* Bands shorter than this are reward icons and section rules, not artwork. */
const MIN_BAND = 260;
/* Row detail above this reads as a photograph; a page background with text on
   it sits well below it, because the text only touches a few columns. */
const DETAIL = 26;

const APPLY = process.argv.includes("--apply");
const article = process.argv.slice(2).find(a => /^\d+$/.test(a));
if (!article && !APPLY && !process.argv.includes("--self-test")) {
  console.error("usage: node scripts/find-event-art.mjs <articleId>   (e.g. 5310)\n" +
    "       node scripts/find-event-art.mjs --apply [articleId]");
  process.exit(1);
}

/* User agent, timeout and retries, out of scripts/lib/net.mjs. */
const get = (url, as = "json") =>
  as === "json" ? getJson(url, { timeout: 30000 }) : getBuffer(url, { timeout: 30000 });

/* OSS will render any image as a 24-bit BMP, which is a header and then rows of
   BGR bottom-up — parseable in ten lines, and the whole reason this needs no
   dependency. */
function rowDetail(bmp) {
  const w = bmp.readInt32LE(18);
  const h = bmp.readInt32LE(22);
  const off = bmp.readUInt32LE(10);
  const stride = Math.floor((24 * w + 31) / 32) * 4;
  const out = [];
  for (let y = 0; y < h; y++) {
    const src = off + (h - 1 - y) * stride;
    let sum = 0;
    const lum = new Array(w);
    for (let x = 0; x < w; x++) {
      const i = src + x * 3;
      lum[x] = bmp[i + 2] * 0.299 + bmp[i + 1] * 0.587 + bmp[i] * 0.114;
      sum += lum[x];
    }
    const mean = sum / w;
    let v = 0;
    for (let x = 0; x < w; x++) v += (lum[x] - mean) ** 2;
    out.push(Math.sqrt(v / w));
  }
  return { w, h, detail: out };
}

function bands(detail, scale) {
  const on = detail.map(v => (v > DETAIL ? 1 : 0));
  for (let i = 1; i < on.length - 1; i++) if (!on[i] && on[i - 1] && on[i + 1]) on[i] = 1;
  const runs = [];
  let start = -1;
  for (let y = 0; y < on.length; y++) {
    if (on[y] && start < 0) start = y;
    if ((!on[y] || y === on.length - 1) && start >= 0) {
      const a = Math.round(start * scale), b = Math.round(y * scale);
      if (b - a >= MIN_BAND) runs.push([a, b]);
      start = -1;
    }
  }
  return runs;
}

const cropUrl = (url, c, w = 760) =>
  `${url}?x-oss-process=image/crop,x_${c.x},y_${c.y},w_${c.w},h_${c.h}/resize,w_${w}/quality,q_78`;

async function main() {
  const post = await get(`${BASE}/article/${article}.json`);
  console.log(`${post.articleTitle}\n`);

  const images = [...String(post.articleContent || "").matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map(m => m[1])
    .filter(u => /\.(jpe?g|png|webp)$/i.test(u));

  for (const [i, url] of images.entries()) {
    const info = await get(`${url}?x-oss-process=image/info`);
    const W = Number(info.ImageWidth.value), H = Number(info.ImageHeight.value);
    /* A sheet is many times taller than it is wide. A single banner or a key
       visual is not, and has nothing to cut out of it. */
    if (H < W * 3) {
      console.log(`image ${i}: ${W}x${H} — not a stacked sheet, skipped`);
      continue;
    }

    const bmp = await get(`${url}?x-oss-process=image/resize,w_120/format,bmp`, "buffer");
    const { w, h, detail } = rowDetail(bmp);
    const found = bands(detail, H / h);

    console.log(`\nimage ${i}: ${W}x${H} — ${found.length} band(s)\n${url}`);
    found.forEach(([a, b], n) => {
      const c = { x: INSET_X * 4 + 6, y: a + INSET_Y, w: W - (INSET_X * 4 + 6) * 2, h: b - a - INSET_Y * 2 };
      /* Bands at the very top of a sheet are its header art, not an event. */
      const header = a < H * 0.06 ? "   (header art?)" : "";
      console.log(`\n  band ${n}${header}`);
      console.log(`  "crop": { "x": ${c.x}, "y": ${c.y}, "w": ${c.w}, "h": ${c.h} }`);
      console.log(`  preview: ${cropUrl(url, c)}`);
    });
  }

  console.log(`
Open the previews, match each band to its event, and paste the crop into that
event's "art" in data/events.json alongside the sheet's url, the post it came
from and "© Kuro Games". fetch-events.mjs keeps hand-written art when Kuro's
own list supersedes the entry, so this survives patch day.`);
}

/* ── --apply ─────────────────────────────────────────────────────────── */

const EVENTS = "data/events.json";
const VERSIONS = "data/versions.json";
const OCR = join(dirname(fileURLToPath(import.meta.url)), "lib", "ocr.ps1");

/* The engine reads up to 10000px a side; a sheet runs to 17000. Read it in
   slices that overlap by more than a title is tall, so none is cut in half. */
const SLICE = 4000, OVERLAP = 300;
/* Titles are set around 60-70px tall, a long one smaller (3.7's "Beyond the
   Waves: Land of Xuanfang" read at 43); body copy, dates and reward labels
   never above 33. Height alone tells them apart. */
const TITLE_MIN_H = 40;

/* Every event frame on the sheet is the same drawing: a gold border with a
   square block at each corner, 4px inside the picture's top edge and 6px
   inside its bottom one. The border's outer rule sits at x=63 and runs the
   frame's full height, so it can be read whatever the picture inside is —
   which is the point: the row-detail scan above loses a banner's dark edge
   into the page background (3.7's Gifts of Waking Moon and Artisan's Search
   both came back short), and the border never does. */
const RULE_X = 63;
const CORNER = [5, 10];
const TOP_IN = 4, BOTTOM_IN = 6;
/* The desk's crops stop short of the frame's inner shading, same as the
   hand-cut ones: 20px off the top, 21 off the bottom, 78px each side. */
const CROP = { x: 78, w: 924, top: 20, bottom: 21 };

const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/* OCR drops or swaps the odd letter — "Artisan's" reads as "Artisan s", an
   "l" as an "I". Edit distance over the squashed names, as a share of the
   name's length, forgives that without letting two real names meet. */
function similar(a, b) {
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

/* A title line can carry the subtitle beside it ("Cubie Wars Leisure Event"),
   so a name that is the start of the line counts as well as one that is
   close to the whole line. */
function matchName(line, names) {
  const k = key(line);
  let best = null;
  for (const name of names) {
    const n = key(name);
    const score = k.startsWith(n) ? 1 : Math.max(similar(k, n), similar(k.slice(0, n.length), n));
    if (score >= 0.85 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name || null;
}

function ocrFile(path) {
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", OCR, path],
      { maxBuffer: 16 << 20, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim().split("\n")[0]));
        try { resolve(JSON.parse(String(stdout || "[]").replace(/[\u0000-\u001f]/g, " ")) || []); }
        catch (e) { reject(e); }
      });
  });
}

/* Every line of text on the sheet, in sheet coordinates. */
async function readSheet(url, W, H, dir) {
  const lines = [];
  for (let y = 0; y < H; y += SLICE - OVERLAP) {
    const h = Math.min(SLICE, H - y);
    const file = join(dir, `slice-${y}.jpg`);
    await writeFile(file, await get(`${url}?x-oss-process=image/crop,x_0,y_${y},w_${W},h_${h}/quality,q_92`, "buffer"));
    for (const l of await ocrFile(file)) {
      const at = { ...l, y: l.y + y };
      /* The overlap reads the same line twice. */
      if (!lines.some(o => o.text === at.text && Math.abs(o.y - at.y) < 20)) lines.push(at);
    }
    if (y + h >= H) break;
  }
  return lines.sort((a, b) => a.y - b.y);
}

/* Runs of gold down the border rule between two rows of the sheet. */
async function goldRuns(url, y0, y1) {
  const bmp = await get(`${url}?x-oss-process=image/crop,x_${RULE_X},y_${y0},w_1,h_${y1 - y0}/format,bmp`, "buffer");
  const w = bmp.readInt32LE(18), h = bmp.readInt32LE(22), off = bmp.readUInt32LE(10);
  const stride = Math.floor((24 * w + 31) / 32) * 4;
  const runs = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    let gold = false;
    if (y < h) {
      const i = off + (h - 1 - y) * stride;
      const [b, g, r] = [bmp[i], bmp[i + 1], bmp[i + 2]];
      gold = r > 90 && g > 60 && r > b + 25;
    }
    if (gold && start < 0) start = y;
    if (!gold && start >= 0) { runs.push([y0 + start, y0 + y]); start = -1; }
  }
  return runs;
}

/* The picture between a title and the first line of text after it, or null
   when the border does not read as one frame. */
async function frameUnder(url, from, to) {
  if (to - from < 200) return null;
  const corners = (await goldRuns(url, from, to)).filter(([a, b]) => b - a >= CORNER[0] && b - a <= CORNER[1]);
  if (corners.length < 2) return null;
  const top = corners[0][0] - TOP_IN, bottom = corners.at(-1)[1] + BOTTOM_IN;
  if (bottom - top < 250 || bottom - top > 900) return null;
  return { top, bottom };
}

/* "2026-10-22 10:00 - 2026-11-09 03:59 (server time)", "Version 3.7 Update -
   2026-11-11 03:59", "Permanently available after the Version 3.7 update".
   OCR runs the day into the hour now and then ("2026-11-1103:59"), which the
   optional space allows for. */
function parseWindow(text) {
  if (/permanently available/i.test(text)) return { permanent: true };
  const at = [...text.matchAll(/(\d{4})-(\d{2})-(\d{2})\s*(\d{2}):(\d{2})/g)]
    .map(m => `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  if (/version\s*\d+\.\d+\s*update\s*-/i.test(text) && at.length === 1) return { withPatch: true, end: at[0] };
  if (at.length === 2) return { start: at[0], end: at[1] };
  return null;
}

async function findPosts(version, menu) {
  const posts = menu
    .filter(a => new RegExp(`Version\\s+${version.replace(".", "\\.")}\\s*["“”]`, "i").test(a.articleTitle || ""))
    .filter(a => /Update Content|Version Preview/i.test(a.articleTitle));
  /* Update Content first: it draws every event, where the preview draws one
     or two. Newest first within each. */
  const rank = a => (/Update Content/i.test(a.articleTitle) ? 0 : 1);
  return posts.sort((a, b) => rank(a) - rank(b) || String(b.startTime).localeCompare(String(a.startTime)));
}

async function apply() {
  const doc = JSON.parse(await readFile(EVENTS, "utf8"));
  const versions = JSON.parse(await readFile(VERSIONS, "utf8")).versions || [];
  const today = new Date().toISOString().slice(0, 10);

  /* The patch on the desk that events are being written for: the newest one
     that is live or announced. A beta patch has no Kuro post to read. */
  const target = versions
    .filter(v => v.status === "live" || v.status === "announced")
    .sort((a, b) => parseFloat(b.id) - parseFloat(a.id))[0];
  if (!target) { console.log("no live or announced version on the desk"); return; }

  let posts;
  if (article) {
    const p = await get(`${BASE}/article/${article}.json`);
    posts = [{ articleId: Number(article), articleTitle: p.articleTitle, startTime: p.createTime }];
  } else {
    const menu = await get(`${BASE}/ArticleMenu.json`);
    posts = await findPosts(target.id, Array.isArray(menu) ? menu : Object.values(menu).flat());
  }
  if (!posts.length) { console.log(`${target.id}: Kuro have posted no preview or Update Content yet`); return; }

  const mine = doc.events.filter(e => e.version === target.id);
  /* What may be written: nothing drawn yet, or — when reading the Update
     Content sheet — a crop out of the preview, which draws its few events
     tighter and smaller. Never the other way round, and never a notice's own
     banner, which has no crop. */
  const open = (e, post) => !e.art ||
    (!!e.art.crop && /Update Content/i.test(post.articleTitle) && /Version Preview/i.test(e.art.title || ""));

  const dir = await mkdtemp(join(tmpdir(), "event-art-"));
  const done = new Set();
  let wrote = 0;
  try {
    for (const post of posts) {
      const src = ARTICLE_URL(post.articleId);
      const wanted = mine.filter(e => !done.has(e.name) && open(e, post));
      if (!wanted.length) continue;
      console.log(`${post.articleId}  ${String(post.articleTitle).trim()}`);

      const full = await get(`${BASE}/article/${post.articleId}.json`);
      const images = [...String(full.articleContent || "").matchAll(/<img[^>]+src="([^"]+)"/gi)]
        .map(m => m[1]).filter(u => /\.(jpe?g|png|webp)$/i.test(u));

      for (const url of images) {
        const info = await get(`${url}?x-oss-process=image/info`);
        const W = Number(info.ImageWidth.value), H = Number(info.ImageHeight.value);
        if (H < W * 3) continue;

        const lines = await readSheet(url, W, H, dir);
        const titles = lines.filter(l => l.h >= TITLE_MIN_H);
        for (const [i, t] of titles.entries()) {
          const name = matchName(t.text, wanted.filter(e => !done.has(e.name)).map(e => e.name));
          if (!name) continue;
          const below = t.y + t.h + 40;
          const nextText = lines.find(l => l.y > below)?.y ?? H;
          const frame = await frameUnder(url, t.y + t.h, Math.min(nextText, H));
          if (!frame) { console.log(`  ${name}: title read, frame not found under it — left alone`); continue; }

          const e = mine.find(x => x.name === name);
          e.art = {
            url,
            crop: { x: CROP.x, y: frame.top + CROP.top, w: CROP.w, h: frame.bottom - frame.top - CROP.top - CROP.bottom },
            title: String(post.articleTitle).trim(),
            source: src,
            published: String(post.startTime || "").slice(0, 10),
            credit: "© Kuro Games",
            note: "Kuro's own event banner, cut automatically out of the events sheet in this post until the event's own notice carries it."
          };

          /* The window printed under the banner, where the entry has none.
             A date somebody already wrote is theirs and stays. */
          const end = titles[i + 1]?.y ?? H;
          const when = lines.filter(l => l.y > frame.bottom && l.y < end).map(l => parseWindow(l.text)).find(Boolean);
          if (when && !e.start && !e.end && !e.permanent) {
            if (when.permanent) e.permanent = true;
            if (when.start) { e.start = when.start; delete e.startsWithPatch; }
            if (when.withPatch) e.startsWithPatch = true;
            if (when.end) e.end = when.end;
          }

          done.add(name);
          wrote++;
          console.log(`  ${name.padEnd(36)} y ${e.art.crop.y} h ${e.art.crop.h}` +
            (when ? `  ${when.permanent ? "permanent" : `${when.start || "with patch"} → ${when.end}`}` : ""));
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const still = mine.filter(e => !e.art).map(e => e.name);
  if (still.length) console.log(`\nno art yet: ${still.join(", ")}`);
  if (wrote) {
    doc.updated = new Date().toISOString();
    await writeFile(EVENTS, JSON.stringify(doc, null, 2) + "\n");
    console.log(`\n${wrote} event${wrote === 1 ? "" : "s"} written to ${EVENTS}`);
  } else {
    console.log(`\nnothing to write (${today})`);
  }
}

/* --self-test: read one known title strip off the 3.7 sheet and say whether the
   OCR engine is there and reading. The event-art job runs it every cycle,
   because --apply only calls the engine on the one day a sheet has events
   left to draw, and a runner image that lost its OCR language should show up
   on an ordinary Tuesday, not on patch day. */
const SELF_TEST = {
  url: "https://hw-media-cdn-mingchao.kurogame.com/object/1790524800000/b307u53274ngsynr6w-1790578044718.jpg",
  crop: "x_0,y_900,w_1080,h_300",
  expect: "Cubie Wars"
};

async function selfTest() {
  const dir = await mkdtemp(join(tmpdir(), "event-art-"));
  try {
    let buf;
    try {
      buf = await get(`${SELF_TEST.url}?x-oss-process=image/crop,${SELF_TEST.crop}/quality,q_92`, "buffer");
    } catch (err) {
      /* Kuro taking an old picture down is not the engine failing. */
      console.log(`self-test image unavailable (${err.message}) — engine not checked`);
      return;
    }
    const file = join(dir, "self-test.jpg");
    await writeFile(file, buf);
    const lines = await ocrFile(file);
    const read = lines.map(l => l.text).join(" | ");
    if (!lines.some(l => key(l.text).includes(key(SELF_TEST.expect)))) {
      throw new Error(`OCR read "${read || "nothing"}", expected "${SELF_TEST.expect}"`);
    }
    console.log(`OCR engine ok — read "${read}"`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

(process.argv.includes("--self-test") ? selfTest : APPLY ? apply : main)().catch(err => {
  console.error(`find-event-art failed: ${err.message}`);
  process.exitCode = 1;
});

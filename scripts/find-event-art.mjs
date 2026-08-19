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
// The half it cannot do is say which band is which event: the infographic is
// pixels, so the names are not machine-readable. Open the preview URLs, match
// them to the events, paste the coordinates in. Ten minutes a patch.

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";
const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";

/* The page's own frame runs a couple of pixels inside each banner. Trim it. */
const INSET_X = 18;
const INSET_Y = 14;
/* Bands shorter than this are reward icons and section rules, not artwork. */
const MIN_BAND = 260;
/* Row detail above this reads as a photograph; a page background with text on
   it sits well below it, because the text only touches a few columns. */
const DETAIL = 26;

const article = process.argv[2];
if (!article) {
  console.error("usage: node scripts/find-event-art.mjs <articleId>   (e.g. 5310)");
  process.exit(1);
}

const get = async (url, as = "json") => {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return as === "json" ? r.json() : Buffer.from(await r.arrayBuffer());
};

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

(async function main() {
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
})();

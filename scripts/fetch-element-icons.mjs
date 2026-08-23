// The six attribute glyphs, off Kuro's own art.
//
// The desk drew its own elements for a year. They were reasonable marks — a
// snowflake, a bolt, a flame — and every one of them was wrong, because an
// element is not a mark the desk gets to invent. It is the one icon on a
// Resonator record a reader can check against the client in about a second,
// and a wind swirl where the game draws a plume reads as a mistake about the
// character rather than a liberty taken with an icon. The colours were off the
// same way: a muted mint next to Aero's #55FFB5 is simply some other green.
//
// So both come from the client here. The Wuthering Waves Wiki on Fandom hosts
// the attribute badges Kuro ships — a white glyph on a coloured disc at 768px,
// plus a flat 128px cut-out of the glyph in the element's own colour. This
// script:
//
//   1. pulls both for all six elements,
//   2. samples the flat cut-out for the colour ATTR_COLOUR should carry,
//   3. lifts the white glyph out of the badge, traces its outline, and fits it
//      to the 16x16 box the sprite in index.html is drawn in,
//   4. rewrites the <g id="i-e-*"> run in index.html in place.
//
// The trace is a marching-squares outline of the glyph mask, rounded off with
// Chaikin, thinned with Ramer-Douglas-Peucker and re-drawn as Catmull-Rom
// cubics — the glyphs are all curve, so a polygon of the same point count reads
// as a facetted approximation of the shape rather than the shape.
//
// Scaling is relative to the *disc*, not to each glyph's own bounding box. The
// six are not the same size in the client — the snowflake spans wider than the
// Havoc spiral — and normalising each one to the full box would flatten a
// difference the game draws on purpose.
//
//   node scripts/fetch-element-icons.mjs
//
// Not on a schedule: there have been six elements since launch and their art
// has not moved. Run it if Kuro redraws one, or if a seventh ever ships — and
// paste the colours it prints into ATTR_COLOUR in assets/app.js.

import { writeFile, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://wutheringwaves.fandom.com/api.php";
const HTML = "index.html";
const TIMEOUT_MS = 25000;

/* Sprite order, which is the order the six read in as a row. */
const ELEMENTS = ["Glacio", "Fusion", "Electro", "Aero", "Spectro", "Havoc"];

/* Trace settings. Chaikin passes take the staircase off the pixel outline, the
   RDP tolerance is in source pixels, and the area floor drops the specks a
   threshold always leaves behind. Tuned against the six at 13px, which is the
   smallest the desk ever draws them. */
const SMOOTH = 4;
const EPS = 4.5;
const MIN_AREA = 60;
/* The disc is 511px across in every badge; 17.1 puts the widest glyph just
   inside the 16 box with a hair of margin for the curve fit. */
const BOX_PER_DISC = 17.1;
/* White glyph, coloured disc — anything this bright and this opaque is glyph. */
const GLYPH = (r, g, b, a) => a > 140 && r > 205 && g > 205 && b > 205;
const DISC = (r, g, b, a) => a > 200;

/* ── fetch ─────────────────────────────────────────────────────────
   Fandom content-negotiates to WebP unless you ask for the original, and this
   script has a PNG decoder in it and no WebP one. ?format=original settles it. */
async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}
async function getPng(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/png" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("not a PNG");
  return buf;
}

async function fileUrls(titles) {
  const j = await getJson(`${API}?${new URLSearchParams({
    action: "query", titles: titles.join("|"), prop: "imageinfo", iiprop: "url", format: "json"
  })}`);
  const out = new Map();
  for (const p of Object.values(j.query?.pages || {})) {
    if (!p.imageinfo) throw new Error(`no such file on the wiki: ${p.title}`);
    out.set(p.title.replace(/^File:/, "").replace(/ /g, "_"),
      `${p.imageinfo[0].url.split("/revision/")[0]}?format=original`);
  }
  return out;
}

/* ── PNG → RGBA ────────────────────────────────────────────────────
   Enough of the format for what the wiki serves: 8-bit, non-interlaced, any of
   the five colour types. Nothing here needs a dependency. */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "PLTE") pal = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ctype === 0) r = g = b = out[i];
    else if (ctype === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (ctype === 3) {
      const ix = out[i];
      r = pal[ix * 3]; g = pal[ix * 3 + 1]; b = pal[ix * 3 + 2];
      if (trns && ix < trns.length) a = trns[ix];
    } else if (ctype === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, data: rgba };
}

const px = (img, i) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]];

function bounds(img, test) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < img.w * img.h; i++) {
    if (!test(...px(img, i))) continue;
    const x = i % img.w, y = (i / img.w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < x0) throw new Error("nothing matched");
  return { x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2,
           span: Math.max(x1 - x0 + 1, y1 - y0 + 1) };
}

/* The flat cut-out is one colour over its whole glyph, so the first opaque
   pixel is the answer — averaged anyway, in case a future icon is shaded. */
function glyphColour(img) {
  let n = 0, R = 0, G = 0, B = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const [r, g, b, a] = px(img, i);
    if (a < 250) continue;
    R += r; G += g; B += b; n++;
  }
  if (!n) throw new Error("no opaque pixels");
  return "#" + [R / n, G / n, B / n].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ── mask → closed outlines ────────────────────────────────────────
   Every cell edge with a filled cell on one side and an empty one on the other
   is a boundary segment; directing each so the filled side is consistent lets
   them be chained into closed loops without any case table. Holes come out as
   loops of their own, which is what fill-rule="evenodd" wants. */
function outlines(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const key = (x, y) => x * 100000 + y;
  const edges = new Map();
  const add = (ax, ay, bx, by) => {
    const k = key(ax, ay);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([bx, by]);
  };
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      if (y < h) {
        const l = at(x - 1, y), r = at(x, y);
        if (l !== r) (r ? add(x, y, x, y + 1) : add(x, y + 1, x, y));
      }
      if (x < w) {
        const t = at(x, y - 1), b = at(x, y);
        if (t !== b) (t ? add(x, y, x + 1, y) : add(x + 1, y, x, y));
      }
    }
  }
  const loops = [];
  for (const [k, list] of edges) {
    while (list.length) {
      const start = [Math.floor(k / 100000), k % 100000];
      const loop = [start];
      let cur = list.shift();
      while (cur && (cur[0] !== start[0] || cur[1] !== start[1])) {
        loop.push(cur);
        const next = edges.get(key(cur[0], cur[1]));
        if (!next?.length) { cur = null; break; }
        cur = next.shift();
      }
      if (cur) loops.push(loop);
    }
  }
  return loops;
}

const area = pts => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const b = pts[(i + 1) % pts.length];
    a += pts[i][0] * b[1] - b[0] * pts[i][1];
  }
  return Math.abs(a) / 2;
};

function chaikin(pts, passes) {
  let p = pts;
  for (let n = 0; n < passes; n++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
      q.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    p = q;
  }
  return p;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts.at(-1)];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/* RDP on a closed loop collapses it — first and last point are the same, so
   every vertex measures zero from the line between them. Cut at the vertex
   furthest from the start and thin the two halves. */
function simplify(loop, eps) {
  let far = 0, fd = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  return [
    ...rdp(loop.slice(0, far + 1), eps).slice(0, -1),
    ...rdp([...loop.slice(far), loop[0]], eps).slice(0, -1)
  ];
}

function curvePath(pts, scale, centre) {
  const n = pts.length;
  const P = i => pts[((i % n) + n) % n];
  const f = v => {
    const s = (v * scale + centre).toFixed(2).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
  };
  let d = `M${f(P(0)[0])} ${f(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}`
      + ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}`
      + ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

function trace(badge) {
  const mask = new Uint8Array(badge.w * badge.h);
  for (let i = 0; i < mask.length; i++) if (GLYPH(...px(badge, i))) mask[i] = 1;

  const disc = bounds(badge, DISC);
  const scale = BOX_PER_DISC / disc.span;
  /* Area floor is quoted at 128px, where the six are legible; scale it with the
     art so the same specks drop out whatever size the wiki is serving. */
  const floor = MIN_AREA * (badge.w / 128) ** 2;

  return outlines(mask, badge.w, badge.h)
    .filter(l => area(l) >= floor)
    .sort((a, b) => area(b) - area(a))
    .map(loop => simplify(chaikin(loop, SMOOTH), EPS))
    .filter(pts => pts.length >= 3)
    .map(pts => curvePath(pts.map(([x, y]) => [x - disc.cx, y - disc.cy]), scale, 8))
    .join("");
}

/* ── index.html ────────────────────────────────────────────────────
   The sprite is hand-written apart from these six, so the rewrite is bounded by
   the comment that heads them and the one that heads the kit slots below. */
async function writeSprite(blocks) {
  const html = await readFile(HTML, "utf8");
  const nl = html.includes("\r\n") ? "\r\n" : "\n";
  const lines = html.split(nl);
  const from = lines.findIndex(l => l.includes("<!-- The six elements"));
  const to = lines.findIndex(l => l.includes("<!-- The six kit slots"));
  if (from < 0 || to < 0 || to <= from) throw new Error("element block not found in " + HTML);

  /* Keep the comment that heads the block — it is prose about why these are
     traced rather than drawn, and no part of it comes out of the art. */
  const head = lines.slice(from, from + 1 + lines.slice(from).findIndex(l => l.includes("-->")));
  const body = blocks.map(([id, d]) =>
    `    <g id="${id}"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></g>`);

  lines.splice(from, to - from, ...head, ...body, "");
  const out = lines.join(nl);
  if (out === html) { console.log("unchanged"); return; }
  await writeFile(HTML, out);
  console.log(`${HTML}: six element glyphs rewritten`);
}

/* ── run ───────────────────────────────────────────────────────────*/
const titles = ELEMENTS.flatMap(e => [`File:${e}.png`, `File:${e}_Icon.png`]);
const urls = await fileUrls(titles);

const blocks = [];
const colours = [];
for (const e of ELEMENTS) {
  const badge = decodePng(await getPng(urls.get(`${e}.png`)));
  const flat = decodePng(await getPng(urls.get(`${e}_Icon.png`)));
  const d = trace(badge);
  if (!d) throw new Error(`traced nothing for ${e}`);
  blocks.push([`i-e-${e.toLowerCase()}`, d]);
  colours.push([e.toLowerCase(), glyphColour(flat)]);
  console.log(`${e.padEnd(8)} ${String(d.length).padStart(5)} chars  ${colours.at(-1)[1]}`);
}

await writeSprite(blocks);
console.log("\nATTR_COLOUR (assets/app.js):");
console.log("  " + colours.map(([k, v]) => `${k}:"${v}"`).join(", "));

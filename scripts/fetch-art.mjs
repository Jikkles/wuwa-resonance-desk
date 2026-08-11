// Resolves official character key art, writes data/art.json.
// Node 20+. No dependencies. No API keys.
//
// Kuro publishes a "Profile Reveal" article per character on their own EN site,
// and the first image in it is the official key art card — the one with the
// name, rarity and role on it. That art is Kuro's own promotional material,
// served from Kuro's own CDN, and we link to it rather than copying it here.
// Nothing datamined, nothing rehosted.
//
// So the desk shows a plate for a character until Kuro reveals them, and picks
// up the real art within 6 hours of the reveal post going live. No manual step.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const ARTICLE_URL = id => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;
const OUT = "data/art.json";
const TIMEOUT_MS = 20000;

/* Kuro's reveal posts, best first. Titles read
   "Profile Reveal | Futures' Tithe — Hiyuki". */
const REVEAL_PATTERNS = [
  { rx: /^profile reveal/i, rank: 0 },
  { rx: /^resonator review/i, rank: 1 },
  { rx: /^post-lament anthropocene: stars intertwined/i, rank: 2 }
];

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const readJson = async path => JSON.parse(await readFile(path, "utf8"));

/* Every character the desk currently talks about. */
async function wantedNames() {
  const names = new Set();
  try {
    const versions = await readJson("data/versions.json");
    for (const v of versions.versions || [])
      for (const p of v.phases || [])
        for (const b of p.banners || []) if (b.name) names.add(b.name);
  } catch {}
  try {
    const res = await readJson("data/resonators.json");
    for (const r of res.resonators || []) if (r.name) names.add(r.name);
  } catch {}
  return [...names];
}

/* Match on the trailing name segment, so "Astral Mapping — Mornye" resolves to
   Mornye and not to whoever else the epithet happens to mention. */
function findReveal(articles, name) {
  const lower = name.toLowerCase();
  const candidates = [];
  for (const a of articles) {
    const title = String(a.articleTitle || "");
    if (!new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title)) continue;
    const pattern = REVEAL_PATTERNS.find(p => p.rx.test(title));
    if (!pattern) continue;
    // The name should be the last thing in the title, after "|" or a dash.
    const tail = title.split(/[|—–-]/).pop().trim().toLowerCase();
    candidates.push({ article: a, rank: pattern.rank + (tail === lower ? 0 : 0.5) });
  }
  candidates.sort(
    (x, y) => x.rank - y.rank || Date.parse(y.article.startTime) - Date.parse(x.article.startTime)
  );
  return candidates[0]?.article;
}

/* "Profile Reveal | Futures' Tithe — Hiyuki" -> "Futures' Tithe" */
function epithetFrom(title, name) {
  const afterBar = String(title).split("|").slice(1).join("|");
  const withoutName = afterBar.replace(new RegExp(`[—–-]\\s*${name}\\s*$`, "i"), "");
  return withoutName.trim().replace(/[—–-]\s*$/, "").trim();
}

async function artFor(id) {
  const article = await getJson(`${BASE}/article/${id}.json`);
  const images = [...String(article.articleContent || "").matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map(m => m[1])
    .filter(u => /^https:\/\/[^"]+\.(jpe?g|png|webp)$/i.test(u));
  return { url: images[0], article };
}

(async function main() {
  const names = await wantedNames();
  if (!names.length) {
    console.log("no character names in data/*.json — nothing to resolve");
    return;
  }

  let previous = {};
  try {
    previous = (await readJson(OUT)).art || {};
  } catch {}

  const menu = await getJson(`${BASE}/ArticleMenu.json`);
  const art = {};
  const misses = [];

  for (const name of names.sort()) {
    const reveal = findReveal(menu, name);
    if (!reveal) {
      // Keep anything resolved on an earlier run rather than dropping it.
      if (previous[name]) art[name] = previous[name];
      else misses.push(name);
      continue;
    }
    // Already resolved from this same article? Don't refetch it.
    if (previous[name]?.articleId === reveal.articleId && previous[name]?.url) {
      art[name] = previous[name];
      console.log(`cached   ${name.padEnd(12)} ${previous[name].url.slice(-28)}`);
      continue;
    }
    try {
      const { url, article } = await artFor(reveal.articleId);
      if (!url) throw new Error("no image in article body");
      art[name] = {
        url,
        epithet: epithetFrom(article.articleTitle, name) || undefined,
        articleId: reveal.articleId,
        articleTitle: article.articleTitle,
        source: ARTICLE_URL(reveal.articleId),
        published: String(reveal.startTime || "").slice(0, 10),
        credit: "© Kuro Games"
      };
      console.log(`resolved ${name.padEnd(12)} ${url.slice(-28)}`);
    } catch (err) {
      if (previous[name]) art[name] = previous[name];
      else misses.push(`${name} (${err.message})`);
    }
  }

  await mkdir("data", { recursive: true });
  const payload = {
    schema: "wuwa-desk/art@1.0",
    note:
      "Official key art from Kuro's own Profile Reveal posts, hotlinked from Kuro's CDN. " +
      "Not rehosted, not datamined. Characters with no reveal post yet are absent by design.",
    art
  };

  // Same rule as the feed: don't churn the file when nothing moved.
  let unchanged = false;
  try {
    const prev = await readJson(OUT);
    unchanged = JSON.stringify(prev.art) === JSON.stringify(art);
  } catch {}

  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  console.log(
    `\n${Object.keys(art).length}/${names.length} characters have art` +
      (unchanged ? " (unchanged)" : "")
  );
  if (misses.length) console.log(`awaiting reveal: ${misses.join(", ")}`);
})();

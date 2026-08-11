// Pulls headline feeds that need no authentication, writes data/feed.json.
// Runs in GitHub Actions (server-side, so no CORS problem).
// Node 20+. No dependencies. No API keys.
//
// What comes out of here is a LEAD LIST, not the product. Nothing written to
// feed.json carries a confidence tier — tiering is a human call and lives in
// data/news.json. This file just says "something happened, go look".
//
// Every endpoint below was probed from a datacenter IP before being added.
// Reddit is the one known flake: it 403s datacenter ranges intermittently, so
// it is marked optional and a failure there does not fail the run.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const OUT = "data/feed.json";
const MAX_ITEMS = 180;
const MAX_PER_SOURCE = 40; // so one chatty feed can't drown the rest
const MAX_AGE_DAYS = 120;
const TIMEOUT_MS = 20000;
const RETRIES = 2;

/* Titles matching this get flagged `hot` — worth a human look for tiering. */
const HOT = /\b(\d\.\d\b|leak|beta|datamin|banner|convene|resonator|kit|preview|broadcast|trailer|version|前瞻|测试|角色|版本|公告)/i;

/* Broad feeds get a relevance gate; scoped feeds (YouTube, Reddit) don't need one. */
const RELEVANT = /wuthering\s*waves|wuwa|鸣潮/i;

/* Google News matches the phrase anywhere, which drags in stock tickers and
   golf reports. Gate on the outlet instead — games press only. */
const PRESS_OUTLETS = [
  "beebom", "dexerto", "destructoid", "dualshockers", "eurogamer", "finalweapon",
  "gamereactor", "gamerant", "game rant", "gamesradar", "gamespace", "gamingonphone",
  "gematsu", "ign", "inven global", "ixbt", "massively overpowered", "mmobomb",
  "mmo culture", "mmoculture", "mmorpg", "mmos.com", "niche gamer", "notebookcheck",
  "noisy pixel", "opencritic", "pc gamer", "pcgamesn", "pocket gamer", "pocket tactics",
  "pocketgamer", "polygon", "prydwen", "push square", "rpg site", "rpgsite",
  "screenrant", "screen rant", "siliconera", "sportskeeda", "thegamer", "the gamer",
  "touch arcade", "trusted reviews", "vg247", "windows central", "wotpack"
];
const fromGamesPress = outlet =>
  !!outlet && PRESS_OUTLETS.some(o => outlet.toLowerCase().includes(o));

/* ------------------------------------------------------------------ net -- */

async function getText(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "*/*", ...(init.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const getJson = async (url, init) => JSON.parse(await getText(url, init));

/* --------------------------------------------------------------- parsing -- */

function decode(text) {
  return String(text ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml, name) =>
  xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

function toIso(value) {
  if (!value) return "";
  const d = new Date(typeof value === "number" ? value : String(value).trim());
  return isNaN(d) ? "" : d.toISOString();
}

/* Atom: <entry> blocks, link as href attribute. */
function parseAtom(xml) {
  return xml.split(/<entry[\s>]/).slice(1).map(entry => ({
    title: decode(tag(entry, "title")),
    url: entry.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "",
    date: toIso(decode(tag(entry, "published")) || decode(tag(entry, "updated")))
  }));
}

/* RSS 2.0: <item> blocks, link as element text. */
function parseRss(xml) {
  return xml.split(/<item[\s>]/).slice(1).map(item => ({
    title: decode(tag(item, "title")),
    url: decode(tag(item, "link")) || item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "",
    date: toIso(decode(tag(item, "pubDate")) || decode(tag(item, "dc:date"))),
    source: decode(tag(item, "source")) || ""
  }));
}

/* --------------------------------------------------------------- sources -- */
/* Each source returns raw items; the runner normalises, filters and tags. */

const SOURCES = [
  {
    id: "kuro-en",
    name: "Kuro Games (official EN)",
    kind: "official",
    lang: "en",
    // Static JSON the official site's news page reads. No key, no CORS, no SPA.
    async fetch() {
      const list = await getJson(
        "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json"
      );
      return list.map(a => ({
        title: decode(a.articleTitle),
        // startTime is local Kuro time (UTC+8) with no offset marker.
        date: toIso(`${String(a.startTime || a.createTime).replace(" ", "T")}+08:00`),
        url: `https://wutheringwaves.kurogames.com/en/main/news/detail/${a.articleId}`
      }));
    }
  },
  {
    id: "kurobbs",
    name: "Kurobbs (official CN)",
    kind: "official",
    lang: "zh",
    // Kuro's own CN community. Announcements land here before the EN site.
    async fetch() {
      const body = await getJson("https://api.kurobbs.com/forum/companyEvent/findEventList", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ gameId: "3", pageIndex: "1", pageSize: "30" }).toString()
      });
      if (body.code !== 200) throw new Error(`kurobbs code ${body.code}: ${body.msg || ""}`);
      return (body.data?.list || []).map(p => ({
        title: decode(p.postTitle),
        date: toIso(Number(p.publishTime || p.firstPublishTime)),
        url: `https://www.kurobbs.com/mc/post/${p.postId}`
      }));
    }
  },
  {
    id: "youtube",
    name: "Wuthering Waves (YouTube)",
    kind: "video",
    lang: "en",
    async fetch() {
      const xml = await getText(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UC0Bi5KMcECRVYis5Gb_ZYZQ"
      );
      return parseAtom(xml);
    }
  },
  {
    id: "reddit-leaks",
    name: "r/WutheringWavesLeaks",
    kind: "community",
    lang: "en",
    optional: true, // Reddit 403s datacenter IPs on and off.
    group: "reddit", // and 429s if the two subs are hit in parallel
    async fetch() {
      return parseAtom(await getText("https://www.reddit.com/r/WutheringWavesLeaks/new/.rss"));
    }
  },
  {
    id: "reddit-main",
    name: "r/WutheringWaves",
    kind: "community",
    lang: "en",
    optional: true,
    group: "reddit",
    async fetch() {
      return parseAtom(await getText("https://www.reddit.com/r/WutheringWaves/new/.rss"));
    }
  },
  {
    id: "google-news",
    name: "Google News",
    kind: "press",
    lang: "en",
    gate: true,
    // Aggregates the outlets that would each need their own scraper otherwise
    // (Gematsu, MMORPG.com, Eurogamer, IGN, Sportskeeda...). Sportskeeda's own
    // RSS sits behind an AWS WAF challenge, so this is the way in.
    async fetch() {
      const xml = await getText(
        "https://news.google.com/rss/search?q=%22Wuthering+Waves%22+when:30d&hl=en-US&gl=US&ceid=US:en"
      );
      return parseRss(xml)
        .filter(item => fromGamesPress(item.source))
        .map(item => ({
          ...item,
          // Google appends " - Outlet" to every headline.
          title: item.title.replace(/\s+-\s+[^-]{2,40}$/, ""),
          via: item.source
        }));
    }
  },
  {
    id: "mmoculture",
    name: "MMO Culture",
    kind: "press",
    lang: "en",
    gate: true,
    async fetch() {
      return parseRss(await getText("https://mmoculture.com/tag/wuthering-waves/feed/"));
    }
  }
];

/* ---------------------------------------------------------------- runner -- */

function normalise(raw, src) {
  const title = String(raw.title || "").trim();
  const url = String(raw.url || "").trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;
  if (title.length < 6 || url.length > 400) return null;
  if (src.gate && !RELEVANT.test(title)) return null;
  return {
    title,
    url,
    date: raw.date || "",
    source: raw.via || src.name,
    sourceId: src.id,
    kind: src.kind,
    lang: src.lang,
    hot: HOT.test(title)
  };
}

async function runSource(src) {
  const started = Date.now();
  try {
    const raw = await src.fetch();
    const items = raw.map(r => normalise(r, src)).filter(Boolean);
    return { src, items, status: "ok", ms: Date.now() - started };
  } catch (err) {
    return {
      src,
      items: [],
      status: src.optional ? "skipped" : "failed",
      error: err.message,
      ms: Date.now() - started
    };
  }
}

/* Same key rules as a human eye: same link, or same headline reprinted. */
const dedupeKey = item =>
  `${item.url.replace(/[?#].*$/, "").replace(/\/$/, "")}` +
  `|${item.title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "")}`;

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return null;
  }
}

/* Sources sharing a `group` hit one host, so run those serially — Reddit
   answers two parallel requests from the same IP with a 429. */
async function runAll() {
  const groups = new Map();
  for (const src of SOURCES) {
    const key = src.group ?? src.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(src);
  }
  const batches = await Promise.all(
    [...groups.values()].map(async group => {
      const out = [];
      for (const src of group) {
        if (out.length) await new Promise(r => setTimeout(r, 2000));
        out.push(await runSource(src));
      }
      return out;
    })
  );
  const byId = new Map(batches.flat().map(r => [r.src.id, r]));
  return SOURCES.map(src => byId.get(src.id));
}

(async function main() {
  const results = await runAll();

  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const byKey = new Map();

  for (const { items } of results) {
    const fresh = items
      .filter(item => !item.date || Date.parse(item.date) >= cutoff)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, MAX_PER_SOURCE);
    for (const item of fresh) {
      const key = dedupeKey(item);
      const seen = byKey.get(key);
      // Official beats press when the same story shows up twice.
      if (!seen || (seen.kind !== "official" && item.kind === "official")) byKey.set(key, item);
    }
  }

  const items = [...byKey.values()]
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title))
    .slice(0, MAX_ITEMS);

  // Report what each source actually contributed, not what it returned — a
  // source with 662 rows of back catalogue contributing 24 recent ones should
  // read as 24, or the strip in the UI doesn't add up to the headline count.
  const kept = {};
  for (const item of items) kept[item.sourceId] = (kept[item.sourceId] || 0) + 1;

  const sources = results.map(({ src, items: got, status, error, ms }) => ({
    id: src.id,
    name: src.name,
    kind: src.kind,
    lang: src.lang,
    status,
    count: kept[src.id] || 0,
    fetched: got.length,
    ms,
    ...(error ? { error } : {})
  }));

  const errors = results
    .filter(r => r.status === "failed")
    .map(r => `${r.src.id}: ${r.error}`);

  const payload = { sources, errors, items };

  // The workflow commits only when the file changes, so keep `fetched` pinned
  // unless the content actually moved — otherwise every run is a junk commit.
  // `ms` and `fetched` wobble every run without meaning anything changed.
  const stable = p => JSON.stringify({
    sources: (p.sources || []).map(({ ms, fetched, ...rest }) => rest),
    errors: p.errors || [],
    items: p.items || []
  });
  const prev = await readExisting();
  const unchanged = !!prev && stable(prev) === stable(payload);

  await mkdir("data", { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        schema: "wuwa-desk/feed@2.0",
        fetched: unchanged ? prev.fetched : new Date().toISOString(),
        note: "Auto-fetched headlines. Unvetted, untiered — a lead list, not the record.",
        ...payload
      },
      null,
      2
    ) + "\n"
  );

  for (const s of sources) {
    console.log(
      `${s.status.padEnd(7)} ${s.id.padEnd(14)} ${String(s.count).padStart(3)} kept ` +
        `of ${String(s.fetched).padStart(3)}  ${s.ms}ms` +
        (s.error ? `  — ${s.error}` : "")
    );
  }
  console.log(`\nwrote ${items.length} items${unchanged ? " (unchanged)" : ""}`);

  // Only hard-fail when every non-optional source is down — that means the
  // runner lost network or every endpoint moved, not a normal bad day.
  const required = results.filter(r => !r.src.optional);
  if (required.length && required.every(r => r.status === "failed")) {
    console.error("\nall required sources failed");
    process.exit(1);
  }
})();

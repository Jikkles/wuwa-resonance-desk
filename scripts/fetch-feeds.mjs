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

import { writeIfChanged } from "./lib/out.mjs";

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

/* How long to wait before asking again. A server that says how long it wants
   is obeyed, up to a ceiling — 429 is the one status where guessing is rude,
   and Reddit asks for tens of seconds from a datacenter range. Otherwise 2s
   then 8s, with jitter.

   The old rule was a flat 800ms, 1.6s and no reading of `Retry-After`, which
   is how r/WutheringWaves spent a month contributing nothing: all three tries
   landed inside the same rate-limit window, so the retries were three ways of
   receiving the same 429. lib/net.mjs already got this right; this file keeps
   its own reader (it retries a 403, where everywhere else a 403 is Prydwen
   meaning it) and so never inherited the fix. */
function retryWait(attempt, retryAfter) {
  const asked = Number(retryAfter);
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, 45) * 1000;
  return Math.round(2000 * 4 ** attempt * (0.85 + Math.random() * 0.3));
}

async function getText(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let retryAfter = null;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "*/*", ...(init.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!res.ok) {
        retryAfter = res.headers.get("retry-after");
        // Nobody is going to read this body; undici holds the socket until
        // someone does.
        await res.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, retryWait(attempt, retryAfter)));
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

/* Two seconds was the gap, and it was not one. Serialising the group stopped
   the two subs racing each other, which was the bug it was written for, but
   Reddit rate-limits a datacenter range over a window measured in tens of
   seconds — so the second request arrived inside the first one's window and
   got a 429 nearly every time. Thirty seconds costs a run half a minute it
   spends waiting on other hosts anyway. */
const GROUP_GAP_MS = 30000;

/* Which member of a group goes first, rotated on the six-hour cadence this job
   runs at. With a fixed order the first source spends whatever budget the host
   is willing to give and the last one always pays for it: r/WutheringWavesLeaks
   is declared first, and across the last 28 runs it came back with 25 rows
   every single time while r/WutheringWaves — two seconds behind it — got a 429
   on 25 of them. Rotating cannot conjure a second budget, but it makes a rate
   limit fall on the two subs by turns instead of quietly retiring one of them. */
const rotate = group => {
  const shift = Math.floor(Date.now() / 216e5) % group.length; // 6h buckets
  return [...group.slice(shift), ...group.slice(0, shift)];
};

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
      for (const src of rotate(group)) {
        if (out.length) await new Promise(r => setTimeout(r, GROUP_GAP_MS));
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

  // Every source that did not come back, not just the ones allowed to fail the
  // run. `optional` decides whether a dead source stops the build; it should
  // never have decided whether anybody gets told about it. r/WutheringWaves
  // returned nothing on 25 of the last 28 runs and this list was empty on all
  // 25, because a skipped source recorded a status and no error in the one
  // field a person reads — so a source that had been down for a month and a
  // source that had never existed looked exactly alike. The methodology drawer
  // already draws it amber; this is the half that reaches the run log.
  const errors = results
    .filter(r => r.status !== "ok")
    .map(r => `${r.src.id}: ${r.error}${r.src.optional ? " (optional)" : ""}`);

  for (const s of sources) {
    console.log(
      `${s.status.padEnd(7)} ${s.id.padEnd(14)} ${String(s.count).padStart(3)} kept ` +
        `of ${String(s.fetched).padStart(3)}  ${s.ms}ms` +
        (s.error ? `  — ${s.error}` : "")
    );
  }

  // Said once, plainly, after the table. A step that ends green and a source
  // that has silently contributed nothing since August look identical in a
  // scroll-back of eighteen lines; they should not.
  if (errors.length) console.warn(`\n${errors.length} source(s) down:\n  ${errors.join("\n  ")}`);

  // Every source down is the runner having lost its network, not the internet
  // having run out of Wuthering Waves news — and the file this run would write
  // is an empty feed. That used to be written and then reported: the process
  // exited 1, the workflow's commit step runs on always(), and a blank
  // feed.json went to the live desk to sit there until the next cycle. Refuse
  // first, write second. Yesterday's headlines are worth more than none.
  const required = results.filter(r => !r.src.optional);
  if (required.length && required.every(r => r.status === "failed")) {
    console.error("\nall required sources failed — keeping the feed that is already there");
    process.exit(1);
  }

  // How long each source took and how many rows it handed over are a report on
  // the run, not a fact about the feed — nothing on the desk reads either, and
  // both move every six hours whether or not a single headline did. Pinning
  // `fetched` was half of the fix and the file still churned, because the
  // wobbling numbers went on being written underneath it. So they are dropped
  // from the comparison AND from what is written: the sources list keeps its
  // name, status and kept-count, which is exactly what the methodology drawer
  // draws, and the timings stay in the run's own log where they are useful.
  const reported = sources.map(({ ms, fetched, ...rest }) => rest);
  const wrote = await writeIfChanged(
    OUT,
    {
      schema: "wuwa-desk/feed@2.0",
      fetched: new Date().toISOString(),
      note: "Auto-fetched headlines. Unvetted, untiered — a lead list, not the record.",
      sources: reported,
      errors,
      items
    },
    ["fetched"]
  );

  console.log(`\n${items.length} items${wrote ? " written" : " — unchanged, not rewritten"}`);
})();

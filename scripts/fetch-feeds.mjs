// Pulls headline feeds that need no authentication, writes data/feed.json.
// Runs in GitHub Actions (server-side, so no CORS problem).
// Node 20+. No dependencies. No API keys.
//
// Reddit's public .json API blocks datacenter IPs (403 from Actions runners),
// and its OAuth route now requires an age-verified account. Not worth it —
// Reddit is downstream of everything here anyway. We try its RSS endpoint
// since it costs nothing, but the feed works fine without it.

import { writeFile, mkdir } from "node:fs/promises";

// YouTube channel IDs — the UC... string, not the @handle.
// Find it: open the channel, view-source, search for "channelId".
const YOUTUBE_CHANNELS = [
  // { name: "Wuthering Waves Official", id: "UC..." },
];

// Optimistic, unauthenticated. If Reddit 403s these, they're skipped quietly.
const REDDIT_RSS = [
  { name: "r/WutheringWavesLeaks", url: "https://www.reddit.com/r/WutheringWavesLeaks/new/.rss" },
  { name: "r/WutheringWaves",      url: "https://www.reddit.com/r/WutheringWaves/new/.rss" }
];

const UA = "wuwa-resonance-desk/1.0 (personal aggregator)";

const items = [];
const errors = [];

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}

function tag(chunk, name) {
  const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

function unescapeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// Atom feeds — YouTube and Reddit both use this shape.
function parseAtom(xml, source, kind) {
  return xml.split("<entry>").slice(1).map(e => ({
    source,
    kind,
    title: unescapeXml(tag(e, "title")),
    url: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
    date: (tag(e, "published") || tag(e, "updated")).slice(0, 10)
  })).filter(i => i.title && i.url);
}

for (const ch of YOUTUBE_CHANNELS) {
  try {
    const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
    items.push(...parseAtom(xml, ch.name, "youtube"));
  } catch (e) {
    errors.push(`youtube ${ch.name}: ${e.message}`);
  }
}

for (const sub of REDDIT_RSS) {
  try {
    const xml = await getText(sub.url);
    items.push(...parseAtom(xml, sub.name, "reddit"));
  } catch (e) {
    errors.push(`reddit ${sub.name}: ${e.message} (expected — Reddit blocks datacenter IPs)`);
  }
}

items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

await mkdir("data", { recursive: true });
await writeFile("data/feed.json", JSON.stringify({
  schema: "wuwa-desk/feed@1.0",
  fetched: new Date().toISOString(),
  errors,
  items: items.slice(0, 200)
}, null, 2) + "\n");

console.log(`wrote ${items.length} items, ${errors.length} errors`);
if (errors.length) console.error(errors.join("\n"));
if (!YOUTUBE_CHANNELS.length) {
  console.log("note: no YouTube channels configured — add IDs to YOUTUBE_CHANNELS for this to do anything useful");
}

// Pulls the sources that don't block bots, writes data/feed.json.
// Runs in GitHub Actions (server-side, so no CORS problem).
// Node 20+. No dependencies.

import { writeFile, mkdir } from "node:fs/promises";

const YOUTUBE_CHANNELS = [
  // Add channel IDs (the UC... string, not the @handle).
  // Find it: view-source on the channel page, search for "channelId".
  // { name: "Wuthering Waves Official", id: "UC..." },
];

const REDDIT = [
  { name: "r/WutheringWavesLeaks", url: "https://www.reddit.com/r/WutheringWavesLeaks/new.json?limit=25" },
  { name: "r/WutheringWaves", url: "https://www.reddit.com/r/WutheringWaves/new.json?limit=25" }
];

const UA = "wuwa-resonance-desk/1.0 (personal aggregator)";

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

async function youtube(ch) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
  return xml.split("<entry>").slice(1).map(e => ({
    source: ch.name,
    kind: "youtube",
    title: tag(e, "title"),
    url: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
    date: tag(e, "published").slice(0, 10)
  }));
}

async function reddit(sub) {
  const j = await getJSON(sub.url);
  return (j.data?.children || []).map(c => c.data).map(d => ({
    source: sub.name,
    kind: "reddit",
    title: d.title,
    url: "https://www.reddit.com" + d.permalink,
    date: new Date(d.created_utc * 1000).toISOString().slice(0, 10),
    score: d.score,
    flair: d.link_flair_text || null
  }));
}

const items = [];
const errors = [];

for (const ch of YOUTUBE_CHANNELS) {
  try { items.push(...await youtube(ch)); }
  catch (e) { errors.push(`youtube:${ch.name}: ${e.message}`); }
}

for (const sub of REDDIT) {
  try { items.push(...await reddit(sub)); }
  catch (e) { errors.push(`reddit:${sub.name}: ${e.message}`); }
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

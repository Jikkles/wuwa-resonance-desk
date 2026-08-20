// Resolves the game's permanent events, writes data/permanents.json.
// Node 20+. No dependencies. No API keys.
//
// Everything else on the events page comes from Kuro's own EN posts, because
// everything else on the events page is a thing with a window — announced in a
// notice, run for a fortnight, gone. A permanent event has no window and gets
// no notice. It was announced once, in a patch that shipped anything up to two
// years ago, and Kuro's news feed stopped carrying that post long before this
// desk existed. fetch-events.mjs reads a hundred days back; Echo Hunters has
// been in the game since launch day, 2024-05-23.
//
// So this one reads the wiki, which is the only place the whole list exists:
//
//   Category:Permanent Events  →  every page the wiki files as permanent
//   {{Event}} infobox          →  the dates, the type, the requirement
//   {{Description}}            →  Kuro's own blurb, quoted on the page
//   {{Event Rewards}}          →  the payout, item by item
//
// The category is not the filter, though. It carries 37 pages and 18 of them
// have a real closing date on the infobox — the wiki files an event there when
// the *mode* it added stays in the game, which is a different claim from the
// event still being open. A Glimpse of Xuanfang is in that category and closed
// on 2026-08-19, which the desk knows because Kuro said so in the 3.5 notice.
// `time_end = none` is the field that actually means what this file means, and
// it is what the filter reads. 19 events, launch day to now.
//
// Art is downloaded rather than hotlinked, same as the reward icons and the
// portraits: these are Kuro's own event banners, hosted by Fandom, and a page
// that fetches 19 pictures from a wiki CDN on every load is a page borrowing
// somebody's bandwidth. They come down at 720px, which is the width the tile
// asks for, and land in assets/events.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://wutheringwaves.fandom.com/api.php";
const WIKI = t => `https://wutheringwaves.fandom.com/wiki/${encodeURIComponent(String(t).replace(/ /g, "_"))}`;
const CATEGORY = "Permanent Events";
const OUT = "data/permanents.json";
const DIR = "assets/events";
const TIMEOUT_MS = 25000;
/* Fandom's own cap for a multi-title query. */
const BATCH = 50;
/* What the widest tile asks for. The originals run to 1920 and 330KB, which is
   a megabyte and a half of banner nobody displays at that size. */
const IMG_WIDTH = 720;

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/png,image/webp,image/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty body");
  return buf;
}

/* Fandom's infoboxes are `|field = value` down one template call, the same
   shape fetch-items.mjs reads. */
const field = (text, key) =>
  (new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|}]*)`, "i").exec(text || "")?.[1] || "").trim();

/* Wikitext down to the sentence underneath it. Descriptions are Kuro's own
   blurb pasted into a {{Description}} call, so they carry the CMS's line
   breaks and whatever links an editor hung off a proper noun since. */
function plain(src) {
  return String(src || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    /* {{Quest|Xuanling Sings}} and friends: the payload is the last field. */
    .replace(/\{\{[^{}|]*\|([^{}]*)\}\}/g, (_, inner) => inner.split("|").pop())
    .replace(/\{\{[^{}]*\}\}/g, "")
    /* [[Page|shown]] and [[Page]]. */
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* The {{Description}} block, which is free text and so may run to several
   lines and carry nested templates. Matched by counting braces rather than by
   a lazy `.*?`, which stops at the first `}}` a nested call puts in the way. */
function description(src) {
  const at = String(src || "").indexOf("{{Description|");
  if (at < 0) return "";
  let depth = 0;
  for (let i = at; i < src.length - 1; i++) {
    if (src.startsWith("{{", i)) { depth++; i++; continue; }
    if (src.startsWith("}}", i)) {
      depth--;
      if (!depth) return plain(src.slice(at + 14, i));
      i++;
    }
  }
  return "";
}

/* The payout, as the one comma-separated line the desk's reward parser reads.
   The wiki writes it `|Astrite=1600 |Lustrous Tide=40`, with `sort` and `type`
   in among the items as instructions to its own table template. */
function rewards(src) {
  const block = /\{\{Event Rewards([\s\S]*?)\}\}/i.exec(src || "")?.[1];
  if (!block) return "";
  const out = [];
  for (const m of block.matchAll(/\|\s*([^|=\n]+?)\s*=\s*([^|\n}]*)/g)) {
    const name = m[1].trim();
    const qty = m[2].trim();
    if (/^(sort|type|delim|mode|notes?)$/i.test(name)) continue;
    if (!name || !qty) continue;
    /* Thousands separators come off here rather than being left for the
       reader's parser. That parser splits the line on commas — it has to, it
       is reading Kuro's prose — so "Shell Credit=180,000" left alone becomes
       a reward called "Shell Credit x180" and another called "000". */
    out.push(`${name} x${qty.replace(/(?<=\d),(?=\d{3}\b)/g, "")}`);
  }
  return out.join(", ");
}

/* Kuro publishes in server time and the desk renders every clock in the
   reader's own zone, so a date without an offset is a date that moves. The
   wiki writes "2024-05-23 10:00" with the offset in its own field, sometimes
   blank — and when it is blank the answer is still UTC+8, because that is the
   only clock Kuro dates anything in. */
function isoStart(text) {
  const raw = field(text, "time_start");
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(raw);
  if (!m) return null;
  return `${m[1]}T${m[2] || "10:00"}:00+08:00`;
}

/* What kind of thing it is, in the words the tile has room for. The wiki files
   these under `group` and `group2`, where group is usually the literal word
   "Permanent" — which the tile already says in its own chip and does not need
   twice — and group2 is the useful half: Login, Early Access, Photo
   Collection. Where neither says anything, it is an event. */
function kindOf(text) {
  const g1 = field(text, "group");
  const g2 = field(text, "group2");
  const pick = g2 || (/^permanent$/i.test(g1) ? "" : g1);
  return pick || "Event";
}

/* Fandom serves a scaled copy off the image's own path, so the 1920px original
   never has to cross the wire. */
const scaled = (url, w) =>
  `${url.replace(/\/revision\/latest.*$/, "")}/revision/latest/scale-to-width-down/${w}`;

const extOf = url => (/\.(png|jpe?g|webp)(?=\/|\?|$)/i.exec(url)?.[1] || "png").toLowerCase();

const readJson = async path => JSON.parse(await readFile(path, "utf8"));

(async () => {
  await mkdir(DIR, { recursive: true });

  let previous = { events: [] };
  try { previous = await readJson(OUT); } catch {}

  const listing = await getJson(
    `${API}?action=query&format=json&formatversion=2&list=categorymembers` +
    `&cmtitle=Category:${encodeURIComponent(CATEGORY)}&cmlimit=200`);
  const titles = (listing.query?.categorymembers || []).map(m => m.title);
  console.log(`Category:${CATEGORY} — ${titles.length} pages\n`);

  const pages = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const j = await getJson(
      `${API}?action=query&format=json&formatversion=2&redirects=1` +
      `&prop=pageimages|revisions&piprop=original&rvprop=content&rvslots=main` +
      `&titles=${encodeURIComponent(titles.slice(i, i + BATCH).join("|"))}`);
    for (const p of j.query?.pages || []) {
      if (p.missing) continue;
      pages.push({ title: p.title, text: p.revisions?.[0]?.slots?.main?.content || "", image: p.original?.source || "" });
    }
  }

  const events = [];
  const keep = new Set();
  let closed = 0;

  for (const p of pages) {
    /* The whole filter. See the note at the top: the category is a claim about
       the mode, this field is a claim about the event. */
    if (!/^none$/i.test(field(p.text, "time_end"))) { closed++; continue; }

    const name = field(p.text, "name") || p.title;
    const detail = description(p.text);
    const version = /^\d+\.\d+$/.test(field(p.text, "ltd_during")) ? field(p.text, "ltd_during") : "";

    let art = null;
    if (p.image) {
      const file = `${DIR}/${slug(name)}.${extOf(p.image)}`;
      try {
        await writeFile(file, await getBuffer(scaled(p.image, IMG_WIDTH)));
        keep.add(file);
        art = {
          url: file,
          /* Every one of these carries the event's name set across it — that
             is what an in-game event banner is — and they run anywhere from
             4:1 to 16:9. A tile that fills itself from one crops the sides,
             and the sides are where the name is: "Tales of the Isles" comes
             out as "les of the Isles", which reads as a broken image rather
             than as a crop. Same flag, same reason, as the double-drop title
             strips in events.json. */
          nameplate: true,
          source: WIKI(p.title),
          credit: "© Kuro Games, via the Wuthering Waves Wiki on Fandom"
        };
      } catch (err) {
        console.log(`${name.padEnd(34)} art failed: ${err.message}`);
      }
    }

    events.push({
      id: `perm-${slug(name)}`,
      name,
      kind: kindOf(p.text),
      version,
      section: "Permanent",
      permanent: true,
      start: isoStart(p.text),
      end: null,
      summary: detail.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || "",
      detail,
      rewards: rewards(p.text),
      eligibility: plain(field(p.text, "requirements")),
      art,
      /* An in-game fact off the wiki, which is where the desk already gets
         banner history and kit text. Not "Kuro said so in a post" — nobody has
         a post any more — but not a leak either, and the record says which. */
      confidence: "official",
      origin: "wiki",
      source: WIKI(p.title)
    });

    console.log(`${name.padEnd(34)} ${art ? "art" : "no art"}` +
      `  ${(isoStart(p.text) || "").slice(0, 10)}  ${kindOf(p.text)}`);
  }

  events.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));

  /* Banners for events that are no longer on the list — an event the wiki has
     since re-filed, or one whose picture was renamed. Nothing else writes to
     this directory, so anything not claimed above is dead weight. */
  for (const f of await readdir(DIR).catch(() => [])) {
    const path = `${DIR}/${f}`;
    if (!keep.has(path)) { await unlink(path).catch(() => {}); console.log(`removed ${path}`); }
  }

  const payload = {
    schema: "wuwa-desk/permanents@1.0",
    note:
      "Events with no closing date, read off the Wuthering Waves Wiki on Fandom — the only place the " +
      "whole list exists, because Kuro's news feed no longer carries the posts that announced them. " +
      "Membership is `time_end = none` on the wiki's own event infobox, not the Permanent Events " +
      "category, which also holds limited events whose mode was kept. Banners are Kuro's own art, " +
      "downloaded from the wiki at 720px rather than hotlinked.",
    credit: "Event data and banners via wutheringwaves.fandom.com · © Kuro Games",
    source: WIKI(CATEGORY),
    events
  };

  let unchanged = false;
  try { unchanged = JSON.stringify(previous.events) === JSON.stringify(events); } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  console.log(
    `\n${events.length} permanent events, ${events.filter(e => e.art).length} with art, ` +
    `${closed} category pages skipped for having a closing date` +
    (unchanged ? " (unchanged)" : ""));
})();

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
//   {{Event Rewards}}          →  the payout, item by item, standing layer only
//
// The category is not the filter, and neither is any other field on the page.
// This was tried twice. The category itself carries 37 pages, which is three
// times the list. `time_end = none` — no closing date on the infobox — gives
// 19, and it is wrong in both directions at once: it lets in the game's
// onboarding ramp, three Login tracks and three Next Stop: <region> passes
// that are open forever because they are there for whoever installs the game
// next year, and it keeps out sixteen of the twenty-two events actually on the
// tab, every one of which has a real closing date on the wiki. Dreaming Deep
// closed on 2025-08-27 and is on the tab today.
//
// That is not the wiki being wrong. The two lists are answers to different
// questions. The wiki's date is the event's — the fortnight its rewards were
// running — and the tab is Kuro's claim about the *mode*: the content stayed
// in the game after the run ended, so the entry stays in the menu. Nothing on
// the page separates a mode Kuro kept from one it retired, because that is a
// decision taken in the client and never written down anywhere the wiki reads.
//
// So the list below is the filter, and it is a list of names because the thing
// it is copying is a list of names — read off the Permanent tab in game, where
// it is the only place it exists. TAB is the membership; the wiki is still
// where every fact about each one comes from. The category is still fetched,
// now only to audit: a name that has left it has probably been renamed, and a
// page that has joined it is a candidate for the next time the tab is opened.
// Both get printed. This file is short and the game changes it about once a
// patch, which is the same cadence versions.json is edited by hand on.
//
// Art is downloaded rather than hotlinked, same as the reward icons and the
// portraits: these are Kuro's own event banners, hosted by Fandom, and a page
// that fetches 19 pictures from a wiki CDN on every load is a page borrowing
// somebody's bandwidth. They come down at 720px, which is the width the tile
// asks for, and land in assets/events. The exception is a page whose banner
// the wiki names and has never had uploaded — see ART_FALLBACK, which reaches
// past it to Kuro's own post for the one event in that state.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://wutheringwaves.fandom.com/api.php";
const WIKI = t => `https://wutheringwaves.fandom.com/wiki/${encodeURIComponent(String(t).replace(/ /g, "_"))}`;
const CATEGORY = "Permanent Events";
/* The Permanent tab, in the order the game lists it — newest run at the top.
   Read off the client on 2026-08-21. Wiki page titles, which are the event's
   full name; the tab truncates most of them to fit its own rail. */
const TAB = [
  "Lament Recon: Tacet Crisis",
  "Mingshen Notices",
  "Star Bouncing",
  "Soar to the Beat",
  "Peaks of Prestige: Rekindled Duel",
  "Stranger Things in Honami",
  "Tidal Defense Simulator",
  "Dreaming Deep",
  "Cube, Cubic n Cubie",
  "Shape of Yesterday",
  "A Glimpse of Xuanfang",
  "Into the Land of Paradox",
  "Whispers Between Stars",
  "Lahai-Roi Pioneers",
  "Operation: Frontier Renewal",
  "Phantasma Dreamland",
  "All Out! Towards the Peaks of Prestige",
  "Banners Never Fall",
  "Your Summer Will Never Wither",
  "Old Man and the Whale",
  "Tales of the Isles",
  "Somnium Labyrinth"
];
const OUT = "data/permanents.json";
const DIR = "assets/events";
const TIMEOUT_MS = 25000;
/* Fandom's own cap for a multi-title query. */
const BATCH = 50;
/* What the widest tile asks for. The originals run to 1920 and 330KB, which is
   a megabyte and a half of banner nobody displays at that size. */
const IMG_WIDTH = 720;

/* Banners the wiki names but does not have.

   Every page in TAB declares its banner as `|image = <Name>.jpg` in the
   infobox, and Fandom's PageImages hands the file over. Except where nobody
   ever uploaded it: "Soar to the Beat" is a {{Stub}} whose infobox names
   Soar to the Beat.jpg and whose Soar to the Beat.jpg is a red link, so the
   query comes back with no image and the tile has drawn the desk's "no banner
   on the wiki" plate ever since. That plate was telling the truth about the
   wiki and the wrong thing about the event, because Kuro published the banner
   themselves: it is the first band of the events sheet in the Version 3.2
   update-content post.

   So it is shown the way events.json shows a banner that only exists inside a
   sheet — a crop, hotlinked off Kuro's own CDN, nothing rehosted. The numbers
   normally come from scripts/find-event-art.mjs; this band it walks straight
   past, because it is a photograph of deep space and sits under the detail
   threshold that tells artwork from page background, so the rectangle was
   measured by hand off the same BMP the script reads.

   This table fills a gap and is not a preference. It is consulted only when
   the wiki has nothing, so the day somebody uploads the file the wiki's own
   copy takes over — which is the right way round for a list whose every other
   fact is read off that page. It should shrink over time, not grow. */
const ART_FALLBACK = {
  "Soar to the Beat": {
    url: "https://hw-media-cdn-mingchao.kurogame.com/object/1773676800000/av3wvgr92tan616qne-1773734931852.jpg",
    crop: { x: 110, y: 988, w: 864, h: 456 },
    title: 'Wuthering Waves Update Content | Version 3.2 "Resolution to Illuminate the Shadows" Planned for Release on March 19th (UTC+8)',
    source: "https://wutheringwaves.kurogames.com/en/main/news/detail/4418",
    published: "2026-03-17",
    credit: "© Kuro Games",
    note: "Kuro's own banner for the event, cropped out of the Version 3.2 update-content sheet. The wiki's page names a banner file that was never uploaded."
  }
};

/* One sentence, and where that sentence is long, as much of it as fits — cut
   at a space rather than through a word. A bare slice(0, 160) gave "expedition
   into this long-isol", which looks like the data is damaged. */
function clip(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\u2014-]+$/, "") + "…";
}

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
   in among the items as instructions to its own table template.

   Which call, though — {{Event Rewards}} is not one call per page. The wiki
   puts one in every row of a task table, so a page can carry thirty of them,
   one per song cleared or floor beaten; it splits a payout under one
   ==Total Rewards== heading; and where a page has no total at all, the halves
   sit loose in the body. Reading the first match answers all of that wrong: it
   read one line of one table on the pages whose tasks come first — 50 Astrite
   off "complete 4 tracks" for Soar to the Beat.

   And *which half*, which matters more here than anywhere else on the desk.
   An event pays two layers. The limited-time layer ran for the fortnight the
   event was live and is gone; the standing layer — the wiki calls it Permanent
   Rewards, or Standard Rewards, or on Tidal Defense Simulator a Field Supply —
   is what the mode still hands out. Every event on this list has finished its
   run, by definition: the tab is the game's list of modes it kept. So the
   number a tile owes the reader is the standing layer alone. Somnium Labyrinth
   paid 1,200 Astrite in its day and pays 400 now.

   So: where the page separates the two, take the standing side. Where it does
   not, it has given no grounds to split and the total stands. */
const TOTAL_HEADING = /^=+\s*Total Rewards\s*=+\s*$/m;
const INSTRUCTION = /^(sort|type|delim|mode|notes?)$/i;
/* "Limited-Time Rewards", "Limited-time Task Rewards", "Limited Supply" — the
   wiki has three spellings for the layer that expired and one word in common. */
const LIMITED = /\blimited\b/i;

/* A quantity, or nothing. `Shell Credit=` and `Special Cube Cookie=?` are the
   wiki saying it does not know yet; a reward reading "x?" on the tile would be
   the desk saying it on the wiki's behalf. */
function qtyOf(raw) {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* The page's headings with their offsets, so a reward call can be placed in the
   structure the page argues in rather than just in its byte order. */
function headings(src) {
  return [...String(src).matchAll(/^(=+)\s*([^=\n]+?)\s*=+\s*$/gm)]
    .map(m => ({ at: m.index, depth: m[1].length, name: m[2] }))
    .filter(h => h.depth >= 2);
}

/* The headings standing over a point in the page, outermost first. */
function pathAt(heads, at) {
  const stack = [];
  for (const h of heads) {
    if (h.at > at) break;
    stack.length = h.depth - 2;
    stack[h.depth - 2] = h.name;
  }
  return stack.filter(Boolean).join(" > ");
}

/* The event's own currency, by the wiki's own classification: a block tagged
   `type = Event Items` is the Stamps a level track is bought with, the Coins
   an anniversary hands round to be spent in its shop. That is what the player
   moves through the event, not what the event pays, and Star Bouncing's task
   rows hand out 500 of them fifty at a time. Named once in the tagged block
   and then struck off the whole page. */
function currencyOf(src) {
  const names = new Set();
  for (const b of String(src).matchAll(/\{\{Event Rewards([\s\S]*?)\}\}/gi)) {
    if (!/\|\s*type\s*=\s*Event Items/i.test(b[1])) continue;
    for (const m of b[1].matchAll(/\|\s*([^|=\n]+?)\s*=/g)) {
      const name = m[1].trim();
      if (name && !INSTRUCTION.test(name)) names.add(name);
    }
  }
  return names;
}

/* One more of something, where a count for it is known. A reward the wiki lists
   without a number is still a reward: the standing half of Somnium Labyrinth is
   written `|Astrite=400 |Malleable Elite Class Echo I |Malleable Elite Class
   Echo II |Premium Resonance Potion |Premium Energy Core`, four of those five
   with no quantity against them, and dropping them for it left that tile
   reading "400 Astrite" and nothing else. The renderer already draws a reward
   with no count — it hangs the count badge on `qty` being set — so the honest
   shape is the item with the number missing, not the item missing. */
function bump(map, name, qty) {
  const was = map.get(name);
  if (typeof was === "number") { if (qty != null) map.set(name, was + qty); }
  else map.set(name, qty);
}

/* Every {{Event Rewards}} call `keep` accepts, added up item by item, in the
   order the page first mentions each. */
function mergeBlocks(src, currency, keep = () => true) {
  const out = new Map();
  for (const b of String(src).matchAll(/\{\{Event Rewards([\s\S]*?)\}\}/gi)) {
    if (!keep(b.index) || /\|\s*type\s*=\s*Event Items/i.test(b[1])) continue;
    /* Split rather than match a `key=value` pair, so that a bare `|Item` is
       read as an item with no count instead of not being read at all. */
    for (const param of b[1].split("|")) {
      const eq = param.indexOf("=");
      const name = (eq < 0 ? param : param.slice(0, eq)).trim();
      if (!name || INSTRUCTION.test(name) || currency.has(name)) continue;
      bump(out, name, eq < 0 ? null : qtyOf(param.slice(eq + 1)));
    }
  }
  return out;
}

/* {{Card List|delim=;|Astrite*40;Premium Tuner*50}} — how the older pages write
   a table cell, and the only place Tales of the Isles states a payout at all:
   its Total Rewards block totals the 4,200 Stamps the track is bought with and
   says nothing about the 490 Astrite the track pays. */
function mergeCardLists(src, currency, keep = () => true) {
  const out = new Map();
  for (const m of String(src).matchAll(/\{\{Card List\s*\|([^{}]*)\}\}/gi)) {
    if (!keep(m.index)) continue;
    const parts = m[1].split("|").filter(Boolean);
    const delim = (parts.find(p => /^\s*delim\s*=/i.test(p)) || "=;").split("=").pop().trim() || ";";
    for (const part of parts) {
      if (/^\s*[A-Za-z]\w*\s*=/.test(part)) continue;
      for (const one of part.split(delim)) {
        const [name, qty] = one.split("*").map(s => (s || "").trim());
        const n = qtyOf(qty);
        if (name && n != null && !currency.has(name)) out.set(name, (out.get(name) || 0) + n);
      }
    }
  }
  return out;
}

/* Two statements of the same payout, neither of them complete, and the larger
   figure per item.

   The rows are arithmetic and the total is somebody typing the arithmetic out,
   so where they part company one of them has dropped something. Both
   directions happen on the same list. Soar to the Beat's rows come to 800
   Astrite against a stated 740 — and every other line of that total, the Shell
   Credit, the Tuners, all three potions, reconciles to the row exactly, so it
   is the total that is one task row short. Star Bouncing goes the other way:
   its total names a Phantom and 60,000 Shell Credit that no row on the page
   mentions. Taking the larger says what both agree the event pays at least. */
function likelier(stated, rows) {
  const out = new Map(stated);
  for (const [name, qty] of rows) {
    const was = out.get(name);
    if (typeof was === "number") { if (qty != null) out.set(name, Math.max(was, qty)); }
    else out.set(name, qty);
  }
  return out;
}

const line = map =>
  [...map].map(([name, qty]) => (qty == null ? name : `${name} x${qty}`)).join(", ");

function rewards(src) {
  const text = String(src || "");
  const heads = headings(text);
  const currency = currencyOf(text);
  const at = text.search(TOTAL_HEADING);
  const expired = i => LIMITED.test(pathAt(heads, i));

  /* Both places a page can draw the line, in the order they are worth trusting.
     Some pages divide the total itself into a Limited-time block and a
     Permanent one — Somnium Labyrinth, Cube, Your Summer — and the wiki has
     done the adding up for each half. The rest leave the total undivided and
     divide the task tables above it instead, which is Soar to the Beat, Star
     Bouncing, Tidal Defense and the Card List pages. */
  for (const within of [
    i => at >= 0 && i >= at,
    i => at < 0 || i < at
  ]) {
    const some = (fn, limited) => fn(text, currency, i => within(i) && expired(i) === limited);
    /* Only a scope that states both halves has split anything. A scope with no
       limited-time side has not said this event has one, and its content is
       just the payout — read it by the ordinary route below rather than
       announcing it as the standing half. */
    if (!some(mergeBlocks, true).size && !some(mergeCardLists, true).size) continue;
    const standing = some(mergeBlocks, false);
    if (standing.size) return line(standing);
    const cards = some(mergeCardLists, false);
    if (cards.size) return line(cards);
  }

  /* No split stated. Everything the page says, added up. */
  const stated = mergeBlocks(text, currency, i => at < 0 || i >= at);
  const rows = at < 0 ? new Map() : mergeBlocks(text, currency, i => i < at);
  const out = stated.size || rows.size ? likelier(stated, rows) : mergeCardLists(text, currency);

  /* Thousands separators came off in qtyOf rather than being left for the
     reader's parser. That parser splits this line on commas — it has to, it is
     reading Kuro's prose the rest of the time — so "Shell Credit=180,000" left
     alone becomes a reward called "Shell Credit x180" and another "000". */
  return line(out);
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
   twice — and group2 is the useful half: Photo Collection, Combat,
   Exploration. Where neither says anything, it is an event. */
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
  const category = new Set((listing.query?.categorymembers || []).map(m => m.title));
  console.log(`Category:${CATEGORY} — ${category.size} pages, ${TAB.length} of them on the tab\n`);

  const titles = TAB;
  const missing = [];
  const pages = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const j = await getJson(
      `${API}?action=query&format=json&formatversion=2&redirects=1` +
      `&prop=pageimages|revisions&piprop=original&rvprop=content&rvslots=main` +
      `&titles=${encodeURIComponent(titles.slice(i, i + BATCH).join("|"))}`);
    for (const p of j.query?.pages || []) {
      /* A name on the list that the wiki has no page for. Almost always a
         rename rather than a deletion, so it is worth saying out loud — the
         alternative is an event quietly falling off the desk. */
      if (p.missing) { missing.push(p.title); continue; }
      pages.push({ title: p.title, text: p.revisions?.[0]?.slots?.main?.content || "", image: p.original?.source || "" });
    }
  }

  const events = [];
  const keep = new Set();

  /* No filter here. Every page fetched is on the tab, because the tab is what
     was fetched. */
  for (const p of pages) {
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
    /* Kuro's own, where the wiki has nothing to give. See ART_FALLBACK: this
       runs after the download rather than instead of it, so a failed fetch of
       a picture the wiki does have falls through to it too. */
    if (!art && ART_FALLBACK[name]) art = structuredClone(ART_FALLBACK[name]);

    events.push({
      id: `perm-${slug(name)}`,
      name,
      kind: kindOf(p.text),
      version,
      section: "Permanent",
      permanent: true,
      start: isoStart(p.text),
      /* Not the wiki's `time_end`, on the ten of these that have one. That
         date closed the event's reward run; the tab is the game still listing
         the mode afterwards, and "permanent" on this desk means the thing is
         there when you log in tonight. Carrying the wiki's date would have the
         record say a permanent event ended eleven months ago. */
      end: null,
      summary: clip(detail.split(/(?<=[.!?])\s/)[0], 160),
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
      "The game's own Permanent tab, copied by hand from the client on 2026-08-20 and then read off " +
      "the Wuthering Waves Wiki on Fandom for the dates, the blurb, the payout and the banner. The " +
      "list is names rather than a filter because nothing on the wiki reproduces it: the tab is " +
      "Kuro's claim that a mode stayed in the game, and the wiki's dates are the event's reward run, " +
      "so ten of these twelve have a closing date on the wiki and are in the menu today. The desk " +
      "carries them as permanent — no closing date — which is what the tab asserts. " +
      "The reward line is what the mode still pays, not what it paid when it ran: every event here " +
      "has finished its run, and an event pays two layers — a limited-time one that expired with it " +
      "and a standing one the wiki files as Permanent Rewards, Standard Rewards or a Field Supply. " +
      "Where a page separates the two the standing side is taken, so Somnium Labyrinth reads 400 " +
      "Astrite rather than the 1,200 it paid in its fortnight. Where a page states no such split " +
      "the total stands, because the wiki has given no grounds to divide it — All Out! Towards the " +
      "Peaks of Prestige is the awkward one, filing its whole payout under Limited-Time Rewards " +
      "with no standing section to fall back to, so its 1,200 is the run's figure and overstates " +
      "what is left. Banners are Kuro's own art, downloaded from the wiki at 720px rather than " +
      "hotlinked, except where the wiki names a banner file nobody ever uploaded — Soar to the " +
      "Beat is the one, and its picture is cropped live out of Kuro's own Version 3.2 " +
      "update-content post instead.",
    credit: "Event data and banners via wutheringwaves.fandom.com · © Kuro Games",
    source: WIKI(CATEGORY),
    events
  };

  /* Did anything actually change. The whole payload, not just the events: the
     note in this file's header is prose written a few lines up, and a gate
     that only watches the events lets an edit to it sit in the script while
     the shipped file goes on saying the old thing. `updated` is excluded
     because it is this comparison's answer, not part of its question — count
     it and every run differs from the last, which is the no-op commit the gate
     exists to prevent. */
  const settled = o => JSON.stringify({ ...o, updated: undefined });
  let unchanged = false;
  try { unchanged = settled(previous) === settled(payload); } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  console.log(
    `\n${events.length} of ${TAB.length} permanent events, ` +
    `${events.filter(e => e.art).length} with art` +
    (unchanged ? " (unchanged)" : ""));

  /* The audit. Neither of these is an error — the first is usually a rename
     and the second is usually an event whose mode Kuro retired — but both are
     the wiki telling you the tab is worth opening again. */
  for (const t of missing) console.log(`  ! on the list, no page on the wiki: ${t}`);
  for (const t of TAB.filter(t => !category.has(t) && !missing.includes(t)))
    console.log(`  ! on the list, no longer in Category:${CATEGORY}: ${t}`);
  const unlisted = [...category].filter(t => !TAB.includes(t)).sort();
  if (unlisted.length) {
    console.log(`\n${unlisted.length} category pages not on the tab. The six-strong onboarding ramp is` +
      ` here on purpose; the rest are modes Kuro retired, or pages the wiki keeps and the game does` +
      ` not. Worth reading when a patch has just shipped:`);
    for (const t of unlisted) console.log(`  - ${t}`);
  }
})();

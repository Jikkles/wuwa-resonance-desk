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
// asks for, and land in assets/events.

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
   one per song cleared or floor beaten; it splits a payout in half under one
   ==Total Rewards== heading, a Limited-time block for the fortnight the event
   ran and a Permanent block for what the mode still pays; and where a page has
   no total at all, both halves sit loose in the body. Reading the first match
   answers all three wrong. It read one line of one table on the pages whose
   tasks come first — 50 Astrite off "complete 4 tracks" for Soar to the Beat,
   against 740 — and on the pages that split it read the limited-time half and
   dropped the permanent one, which is the half a permanent event is on this
   list for.

   So: add the calls up rather than pick one, and add up both statements the
   page makes — its stated total and its own task rows. */
const TOTAL_HEADING = /^=+\s*Total Rewards\s*=+\s*$/m;
const INSTRUCTION = /^(sort|type|delim|mode|notes?)$/i;

/* A quantity, or nothing. `Shell Credit=` and `Special Cube Cookie=?` are the
   wiki saying it does not know yet; a reward reading "x?" on the tile would be
   the desk saying it on the wiki's behalf. */
function qtyOf(raw) {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
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

/* Every {{Event Rewards}} call in `scope`, added up item by item, in the order
   the page first mentions each. */
function mergeBlocks(scope, currency) {
  const out = new Map();
  for (const b of String(scope).matchAll(/\{\{Event Rewards([\s\S]*?)\}\}/gi)) {
    if (/\|\s*type\s*=\s*Event Items/i.test(b[1])) continue;
    for (const m of b[1].matchAll(/\|\s*([^|=\n]+?)\s*=\s*([^|\n}]*)/g)) {
      const name = m[1].trim();
      const qty = qtyOf(m[2]);
      if (!name || INSTRUCTION.test(name) || currency.has(name) || qty == null) continue;
      out.set(name, (out.get(name) || 0) + qty);
    }
  }
  return out;
}

/* {{Card List|delim=;|Astrite*40;Premium Tuner*50}} — how the older pages
   write a table cell, and the only place Tales of the Isles states a payout at
   all: its Total Rewards block totals the 4,200 Stamps the track is bought
   with and says nothing about the 490 Astrite the track pays.

   Read last, and only where a page has no {{Event Rewards}} to read. Half the
   list writes both, and on those the card rows are the same rewards restated. */
function mergeCardLists(src, currency) {
  const out = new Map();
  for (const m of String(src).matchAll(/\{\{Card List\s*\|([^{}]*)\}\}/gi)) {
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
   mentions. Taking the larger says what both agree the event pays at least,
   which is the most either statement supports. */
function likelier(stated, rows) {
  const out = new Map(stated);
  for (const [name, qty] of rows) out.set(name, Math.max(out.get(name) || 0, qty));
  return out;
}

function rewards(src) {
  const text = String(src || "");
  const at = text.search(TOTAL_HEADING);
  const currency = currencyOf(text);
  const stated = mergeBlocks(at < 0 ? text : text.slice(at), currency);
  const rows = at < 0 ? new Map() : mergeBlocks(text.slice(0, at), currency);
  const out = stated.size || rows.size ? likelier(stated, rows) : mergeCardLists(text, currency);

  /* Thousands separators came off in qtyOf rather than being left for the
     reader's parser. That parser splits this line on commas — it has to, it is
     reading Kuro's prose the rest of the time — so "Shell Credit=180,000" left
     alone becomes a reward called "Shell Credit x180" and another "000". */
  return [...out].map(([name, qty]) => `${name} x${qty}`).join(", ");
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
      "carries them as permanent — no closing date — which is what the tab asserts. Banners are " +
      "Kuro's own art, downloaded from the wiki at 720px rather than hotlinked.",
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

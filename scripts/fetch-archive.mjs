// Every patch the game has shipped and every event that ran in it, back to
// launch. Writes data/archive.json. Node 20+. No dependencies. No API keys.
//
// The desk has always been a forward-looking thing. versions.json carries the
// arc it is watching — the live patch, the announced one, the rumoured one —
// and events.json is written off Kuro's news feed, which reaches a hundred
// days back and no further. Both are the right shape for the question "what
// should I do this fortnight". Neither can answer "what was 2.3".
//
// That question is worth answering, though, and the Timeline's Past window is
// where it belongs: a patch that has shipped is a closed record, and the
// interesting thing about a closed record is what was in it. The character
// half of that the desk already holds — resonators.json carries every convene
// run since 1.0, keyed by resonator — so what was missing was the events, and
// the patch's own name and window.
//
// Both are on the wiki:
//
//   Category:In-Game Events  →  every event the game has run, ~240 pages
//   {{Event}} infobox        →  ltd_during, the version it ran in, and dates
//   Version/<id>             →  the patch's name, its window, Kuro's post
//
// `ltd_during` is the field that files an event under a patch, and it is a
// list — "2.3;2.4;2.5" for a mode that stayed open across three. An event goes
// under the first one, which is the patch it shipped in and the patch whose
// record it belongs to. Where the field is blank, the event's start date is
// matched against the version windows instead, which is the same answer by a
// longer route.
//
// Downloads no art, and still ends up with a picture per patch.
//
// 240 event banners is 15MB for a view that is a list of names and dates, and
// the handful worth showing — this patch's, last patch's — are already in
// events.json with Kuro's own. That has not changed. What has is the patch's
// own key visual, and it turns out the archive was already one link away from
// all nineteen of them: the wiki's Version page carries `link`, Kuro's patch
// notes post, and every one of those posts opens on the version's key art. So
// the notice is read as well as recorded, and the one image in it becomes the
// patch's `keyVisual` — hotlinked from Kuro's CDN, credited to the post it
// came from, nothing copied here. See keyVisualFor().
//
// The archive links every event back to its wiki page and, where the infobox
// has one, to Kuro's own notice.

import { writeFile, readFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://wutheringwaves.fandom.com/api.php";
const WIKI = t => `https://wutheringwaves.fandom.com/wiki/${encodeURIComponent(String(t).replace(/ /g, "_"))}`;
const CATEGORY = "In-Game Events";
/* Where the wiki keeps its patch pages. The category is a mixed bag — it holds
   several hundred item and quest pages besides — so the patches are the
   members whose title is Version/<number>. */
const VERSIONS = "Version";
const OUT = "data/archive.json";
const TIMEOUT_MS = 25000;
/* Fandom's own cap for a multi-title query. */
const BATCH = 50;

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/* Kuro's own site, read as JSON. The website is a client-side app, so the HTML
   at the news URL carries no article in it — the body arrives from here, keyed
   by the same id the public URL ends in. */
const ARTICLE = id =>
  `https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/article/${id}.json`;

/* One patch's key visual. `articleContent` is HTML, and on a patch notes post
   it holds exactly one <img>: the version's key art, above the letter. Later
   sections are text — Kuro cuts the event banners into posts of their own and
   does not repeat them here — so first image is not a guess, it is the only
   one. A post that has none returns null rather than the desk inventing a
   crop, and the caller says so on the run.

   Hotlinked, not copied: the URL is Kuro's CDN and the credit names the post
   it came from, the same arrangement versions.json has always used for the
   live patch's poster. */
async function keyVisualFor(v) {
  const id = (v.notice || "").match(/detail\/(\d+)/)?.[1];
  if (!id) return null;
  let body;
  try { body = (await getJson(ARTICLE(id))).articleContent || ""; }
  catch (e) { console.warn(`  ${v.id} — patch notes unreadable (${e.message})`); return null; }
  const url = body.match(/<img[^>]+src="([^"]+)"/i)?.[1];
  if (!url) return null;
  return {
    url,
    source: v.notice,
    title: `Version ${v.id} key visual`,
    credit: "© Kuro Games"
  };
}

/* Landscape enough to be a banner. Kuro's event notices carry two kinds of
   image and they are never close: the banner is 16:9 to the pixel, 1920x1080
   or 3840x2160, and everything else in the post is a rules infographic — one
   tall column of text and reward icons, 1080 wide by anything from three to
   eleven thousand tall. Anything past this line is the first kind. */
const BANNER_MIN_RATIO = 1.4;

/* The CDN is Alibaba OSS, which will describe an image without sending it. */
async function imageRatio(url) {
  if (!/(^|\.)kurogame\.com\//.test(url)) return 0;
  try {
    const j = await getJson(`${url}?x-oss-process=image/info`);
    const w = Number(j.ImageWidth?.value), h = Number(j.ImageHeight?.value);
    return w > 0 && h > 0 ? w / h : 0;
  } catch { return 0; }
}

/* One event's banner, out of Kuro's own notice for it.
 *
 * Sixty-four of the archive's events have a notice on their wiki page, and the
 * post behind it opens on the event's banner the same way a patch notes post
 * opens on the version's key art. Two thirds of them hold that one image and
 * nothing else. The rest run the rules sheets underneath it, so the image is
 * chosen by shape rather than by position: first one that is landscape.
 *
 * Position alone would have been wrong in both directions. Some posts lead
 * with the rules sheet and carry the banner second; a few — Tidal Defense
 * Simulator, Phantasma Dreamland — are sheets all the way down and have no
 * banner at all, and those return null rather than putting a 1080x7500 column
 * of reward tables in a 16:9 thumbnail.
 *
 * Only the first few images are measured. A banner that has not appeared by
 * the fourth is not the subject of the post.
 */
async function eventArtFor(e) {
  const id = (e.notice || "").match(/detail\/(\d+)/)?.[1];
  if (!id) return null;
  let body;
  try { body = (await getJson(ARTICLE(id))).articleContent || ""; } catch { return null; }
  const imgs = [...body.matchAll(/<img[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  for (const url of imgs.slice(0, 4))
    if (await imageRatio(url) >= BANNER_MIN_RATIO)
      return { url, source: e.notice, credit: "© Kuro Games" };
  return null;
}

/* `|field = value` down one template call, the same shape every other wiki
   reader on the desk uses. */
const field = (text, key) =>
  (new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|}]*)`, "i").exec(text || "")?.[1] || "").trim();

/* Kuro publishes in server time and the desk renders every clock in the
   reader's own zone, so a date without an offset is a date that moves. The
   wiki writes "2025-04-29 11:00" and leaves the offset field blank more often
   than not — and when it is blank the answer is still UTC+8, because that is
   the only clock Kuro dates anything in. */
function iso(raw, fallbackTime) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(String(raw || "").trim());
  if (!m) return null;
  return `${m[1]}T${m[2] || fallbackTime}:00+08:00`;
}

/* What kind of thing it was, in the words a row has space for. `group` is
   usually the useful half here — Combat, Leisure, Exploration — and where the
   wiki has filed it as Permanent, group2 carries the real answer. */
function kindOf(text) {
  const g1 = field(text, "group");
  const g2 = field(text, "group2");
  const pick = /^permanent$/i.test(g1) ? (g2 || "") : (g1 || g2);
  return pick || "Event";
}

/* The versions an event ran in, oldest first. Semicolons on the wiki, and the
   occasional stray comma. */
const during = text =>
  field(text, "ltd_during")
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(s => /^\d+\.\d+$/.test(s));

const num = id => parseFloat(id) || 0;

async function pages(titles, props) {
  const out = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const j = await getJson(
      `${API}?action=query&format=json&formatversion=2&redirects=1` +
      `&prop=${props}&rvprop=content&rvslots=main` +
      `&titles=${encodeURIComponent(titles.slice(i, i + BATCH).join("|"))}`);
    for (const p of j.query?.pages || []) {
      if (p.missing) continue;
      out.push({ title: p.title, text: p.revisions?.[0]?.slots?.main?.content || "" });
    }
  }
  return out;
}

(async () => {
  let previous = { versions: [] };
  try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  /* ── every in-game event ────────────────────────────────────────── */
  const listing = await getJson(
    `${API}?action=query&format=json&formatversion=2&list=categorymembers&cmtype=page` +
    `&cmtitle=Category:${encodeURIComponent(CATEGORY)}&cmlimit=500`);
  const titles = (listing.query?.categorymembers || []).map(m => m.title);
  console.log(`Category:${CATEGORY} — ${titles.length} pages`);

  const events = [];
  for (const p of await pages(titles, "revisions")) {
    /* A page in the category with no {{Event}} infobox is a subpage — the
       film list under Dreaming Deep, the cameo roles under it. Not an event. */
    if (!/\{\{Event\b/i.test(p.text)) continue;
    events.push({
      title: p.title,
      name: field(p.text, "name") || p.title,
      kind: kindOf(p.text),
      versions: during(p.text),
      start: iso(field(p.text, "time_start"), "10:00"),
      end: iso(field(p.text, "time_end"), "03:59"),
      /* Kuro's own notice, where the wiki has kept the link. This is the one
         thing the archive can offer that the desk has nowhere else: the post
         that announced a patch two years ago, which the news feed dropped. */
      notice: /^https?:\/\//.test(field(p.text, "link")) ? field(p.text, "link") : "",
      wiki: WIKI(p.title)
    });
  }
  console.log(`${events.length} with an event infobox`);

  /* ── every patch, read in its own right ─────────────────────────── */
  /* Not derived from the events. Only a third of the event pages carry
     ltd_during at all, so a version list built out of that field is a third of
     the game's history and the other two thirds have nowhere to be filed. */
  const vListing = await getJson(
    `${API}?action=query&format=json&formatversion=2&list=categorymembers&cmtype=page` +
    `&cmtitle=Category:${encodeURIComponent(VERSIONS)}&cmlimit=500`);
  const vTitles = (vListing.query?.categorymembers || [])
    .map(m => m.title)
    .filter(t => /^Version\/\d+\.\d+$/.test(t));
  console.log(`Category:${VERSIONS} — ${vTitles.length} patch pages`);

  const versions = new Map();
  for (const p of await pages(vTitles, "revisions")) {
    const id = field(p.text, "version") || p.title.replace(/^Version\//, "");
    versions.set(id, {
      id,
      title: field(p.text, "title") || "",
      start: iso(field(p.text, "date"), "11:00"),
      end: iso(field(p.text, "date_end"), "03:59"),
      /* Kuro's own version notice, first of the several the infobox lists. */
      notice: /^https?:\/\//.test(field(p.text, "link")) ? field(p.text, "link") : "",
      source: WIKI(p.title),
      events: []
    });
  }
  /* A closing date for the patches that have none. Two thirds of these pages
     carry `date` and leave `date_end` blank, which leaves the archive drawing
     "29 Apr" where every other row reads "29 Apr → 12 Jun" — and the missing
     half is not unknown, it is the next patch's start. A patch ends when its
     successor begins; that is not an inference about this game, it is what a
     patch is. Only ever filled in, never overwritten: where the wiki states an
     end, the wiki wins. */
  const ordered = [...versions.values()]
    .filter(v => v.start)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  let derived = 0;
  ordered.forEach((v, i) => {
    const next = ordered[i + 1];
    if (!v.end && next) { v.end = next.start; v.endDerived = true; derived++; }
  });
  console.log(`${versions.size} of ${vTitles.length} patch pages read, ` +
    `${derived} closing dates taken from the next patch's start`);

  /* ── file each event under the patch it shipped in ──────────────── */
  /* Two thirds of these have no ltd_during and are filed on their start date
     instead, against the patch windows just read.

     The window each event is measured against is the patch's own start and the
     *next* patch's start, not the `date_end` on its infobox. Several patch
     pages have no date_end at all, and read literally that is a patch which
     never ended — 2.1 has no closing date on the wiki and swallowed every
     event of the next four patches when this was written the obvious way.
     Consecutive starts cannot have that problem: one patch ends when the next
     begins, which is true of this game by construction.

     Compared on the day rather than the timestamp, because the two clocks do
     not agree to the hour. The wiki dates a patch from its maintenance window
     — 2.3 opens at 11:00 — and dates the events inside it from 10:00, so an
     event that shipped *with* a patch reads as an hour older than the patch it
     shipped in, and lands in the one before. */
  const day = s => String(s || "").slice(0, 10);
  const windows = [...versions.values()]
    .filter(v => v.start)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const inWindow = start => {
    for (let i = windows.length - 1; i >= 0; i--) {
      const next = windows[i + 1];
      if (day(start) >= day(windows[i].start) && (!next || day(start) < day(next.start)))
        return windows[i].id;
    }
    return "";
  };

  let undated = 0;
  for (const e of events) {
    /* The first version it ran in. A mode that stayed open lists three or
       four; the record that matters is the patch that introduced it. Where the
       field is blank, the start date decides. */
    const id = e.versions[0] || (e.start ? inWindow(e.start) : "");
    const v = versions.get(id);
    if (!v) { undated++; continue; }
    v.events.push({
      id: `arc-${slug(e.name)}`,
      name: e.name,
      kind: e.kind,
      start: e.start,
      end: e.end,
      /* An event whose ltd_during named more than one patch stayed open past
         the one it shipped in, which is the difference between "you missed it"
         and "it is still there". The record says how long rather than making
         the reader compare two dates against a patch window. */
      ran: e.versions.length > 1 ? e.versions.join(", ") : "",
      notice: e.notice,
      source: e.wiki
    });
  }

  for (const v of versions.values())
    v.events.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")) ||
      a.name.localeCompare(b.name));

  /* The patch's key visual, out of Kuro's own patch notes. Nineteen of the
     twenty-one patches carry a `link` on their wiki page and every one of
     those posts opens on the version's key art — one image in the body, the
     same image the desk shows for the live patch, so an archived record can be
     laid out exactly like a current one instead of being the version that has
     no picture.

     Reused from the previous file whenever it is already there for the same
     notice, so a routine run costs nothing and only a patch the archive has
     not seen before makes a request. */
  const seen = new Map((previous.versions || []).map(v => [v.id, v]));
  let fetched = 0, missing = 0;
  for (const v of versions.values()) {
    const was = seen.get(v.id);
    if (was?.keyVisual?.url && was.keyVisual.source === v.notice) { v.keyVisual = was.keyVisual; continue; }
    const art = await keyVisualFor(v);
    if (art) { v.keyVisual = art; fetched++; } else if (v.notice) missing++;
  }
  if (fetched || missing)
    console.log(`\nKey visuals — ${fetched} read from Kuro's patch notes` +
      (missing ? `, ${missing} with a notice that carried no image` : ""));

  /* And the same again per event, off each event's own notice. Cached against
     the previous file by the notice URL, so this costs sixty-odd requests once
     and one per newly-filed event after that — the wiki adds a `link` to a page
     long after the event has closed, so the misses are worth retrying, but only
     the misses. */
  let evArt = 0, evNone = 0, evKept = 0;
  for (const v of versions.values())
    for (const e of v.events) {
      const was = (seen.get(v.id)?.events || []).find(x => x.id === e.id);
      if (was?.art?.url && was.art.source === e.notice) { e.art = was.art; evKept++; continue; }
      if (!e.notice) continue;
      const art = await eventArtFor(e);
      if (art) { e.art = art; evArt++; } else evNone++;
    }
  if (evArt || evNone || evKept)
    console.log(`Event banners — ${evArt + evKept} of ${
      [...versions.values()].reduce((n, v) => n + v.events.length, 0)} events` +
      (evNone ? `, ${evNone} whose notice is rules sheets with no banner in it` : ""));

  const list = [...versions.values()].sort((a, b) => num(b.id) - num(a.id));

  const payload = {
    schema: "wuwa-desk/archive@1.0",
    note:
      "Every patch the game has shipped and every event that ran in it, read off the Wuthering Waves " +
      "Wiki on Fandom. The desk's own calendars only reach as far back as Kuro's news feed does, which " +
      "is a hundred days; this is the record behind that. Events are filed under the first version " +
      "their `ltd_during` names, which is the patch they shipped in. Nothing here is rehosted: each " +
      "patch carries its key visual, read out of Kuro's own patch notes post, and an event carries " +
      "its banner where Kuro published a notice for it — both hotlinked from Kuro's CDN and credited " +
      "to the post they came from. An event with no notice, or whose notice is rules sheets and no " +
      "banner, carries no art, which is most of them.",
    credit: "Version and event history via wutheringwaves.fandom.com · © Kuro Games",
    source: WIKI(`Category:${CATEGORY}`),
    versions: list
  };

  let unchanged = false;
  try { unchanged = JSON.stringify(previous.versions) === JSON.stringify(list); } catch {}
  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  const filed = list.reduce((n, v) => n + v.events.length, 0);
  console.log(
    `\n${list.length} patches, ${filed} events filed` +
    (undated ? `, ${undated} skipped for naming no version` : "") +
    (unchanged ? " (unchanged)" : ""));
  for (const v of list)
    console.log(`  ${v.id.padEnd(5)} ${(v.title || "—").slice(0, 40).padEnd(42)}` +
      `${String(v.events.length).padStart(2)} events  ${(v.start || "").slice(0, 10)}`);
})();

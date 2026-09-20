// Keeps versions.json in step with Kuro's own version notices. Node 20+. No
// dependencies, no keys. Reads the same static article CDN fetch-events.mjs and
// fetch-art.mjs already read.
//
// Why this exists. Everything else on the desk fetches itself; the patch
// timeline did not. A version was written into versions.json by hand weeks
// early off leaks, and the day Kuro announced it — title, date, key visual,
// banner lineup, all of it — nothing on the desk moved until somebody watched
// the broadcast and edited the file. The 3.7 preview went up on 19 September
// and the desk was still calling 3.7 an untitled beta with no phases on the
// 20th, while four green data runs a day went past underneath it. That is the
// one moment in a six-week cycle when the desk is most wrong and most read.
//
// Kuro publish the facts across three article shapes, arriving at three times.
//
//   1. The version preview, about ten days out. Its title is the whole of the
//      machine-readable part:
//
//        Wuthering Waves Version Preview | Version 3.7 "Prism's Illusion,
//        Heart's Illumination" Scheduled for Release on September 30th (UTC+8)
//
//      Version number, version title, release date. The body is six images and
//      no text — Kuro set the entire preview as infographics — so the first
//      16:9 frame in it is the key visual and there is nothing else to read.
//
//   2. The phase's Featured Convene notice, about a day before the phase
//      opens. All text, and exact:
//
//        [Version 3.6 Featured Resonator/Weapon Convene: Phase I]
//        [False Promise for Tomorrow] Featured Resonator Convene
//        During the event, 5-Star Resonator: Denia, 4-Star Resonators: ...
//        ✦Duration✦
//        After the Version 3.6 update - 2026-09-10 09:59 (server time)
//
//   3. The debut convene, a few hours after that one and in its own post:
//
//        [Wind of Transcendence] Featured Resonator Convene
//
//      This is the shape that makes the job more than one regex. The numbered
//      notice in (2) carries the *reruns* only — the new Resonator of the
//      patch and their signature weapon get a post each, with no version and
//      no phase number anywhere in the title. Reading only the numbered notice
//      gets you a phase 1 with Denia on it and no Qingxiao, which is worse
//      than no phase at all. What ties them together is the duration: every
//      convene in a phase runs the identical window, so the numbered notice is
//      read first to learn which window is which phase, and the loose posts
//      are then filed by the window they claim.
//
// Between them, the preview gets the patch onto the timeline as an announced,
// dated, illustrated record, and the convene notices confirm the phase dates
// and fill in the banners. What is left is the gap nothing here can close: the
// lineup is announced at the broadcast, and announced only as a picture.
// Nothing on Kuro's site says "Phase 1: Hsin, Chisa, Iuno" in text until (2),
// ten days later. That is what the alert at the bottom is for — it does not
// guess, it says a human has to go and look.
//
// What it will not do:
//
//   * Overwrite a value a human wrote. A blank is filled, a date flagged
//     `estimated_*` is replaced by the confirmed one, a `provisional` key
//     visual gives way to the real one. Anything else that disagrees is
//     reported and left, which is confirm-dates.mjs's rule and the same
//     reasoning: a fetcher contradicting a person is worth a person looking
//     at, not a silent correction.
//   * Delete a banner, or a phase. A notice that doesn't mention someone the
//     desk has listed is reported. Deleting would make a parsing failure look
//     like a lineup change.
//   * Resurrect a retired patch. The window reaches back far enough to catch a
//     preview the desk missed, which means it also sees notices for versions
//     that have since been archived out of versions.json. Older than the
//     newest record on the desk is not written at all.
//   * Touch `notes`. Those are written, not fetched.
//
// Writes nothing when nothing changed, so an idle run produces no commit.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getJson as json } from "./lib/net.mjs";
import { writeIfChanged } from "./lib/out.mjs";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const ARTICLE_URL = id => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;
const VERSIONS = "data/versions.json";
const RESONATORS = "data/resonators.json";
const TIMEOUT_MS = 20000;

/* Far enough back to carry the live patch, the one being announced, and a
   preview the desk slept through. Further than that is reading announcements
   about patches that have already been archived. */
const LOOKBACK_DAYS = 120;

const ISSUE_TITLE = "Kuro published it as pictures — needs a human";
const MARK = /<!-- desk-lineup: (.*?) -->/;
const EVENTS = "data/events.json";
const DRY = process.argv.includes("--dry-run") || !process.env.GITHUB_ACTIONS;

const run = promisify(execFile);
const getJson = url => json(url, { timeout: TIMEOUT_MS });
const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* "3.10" is later than "3.7", which string comparison gets backwards and the
   desk will meet the moment Kuro stop at .9. */
const cmpVer = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

/* Same flattening fetch-events.mjs does, and for the same reason: Kuro's
   bodies are CMS HTML where every field is "heading line, value line". */
function toText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

const imagesIn = html =>
  [...String(html || "").matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map(m => m[1])
    .filter(u => /^https:\/\/[^"]+\.(jpe?g|png|webp)(\?|$)/i.test(u));

/* The key visual is a 16:9 frame and the rest of a preview post is infographic
   — 1080 wide by five to eight thousand tall. Asking the CDN for the shape is
   free: Kuro's host is Alibaba OSS and `image/info` answers without anyone
   pulling down the file. fetch-events.mjs uses the same trick with a wider
   window, because it is sorting pictures from pages; this wants one specific
   aspect and can afford to be strict. */
const KEY_VISUAL_RATIO = [1.6, 2.0];

async function firstKeyVisual(html) {
  for (const url of imagesIn(html)) {
    try {
      const info = await getJson(`${url}${url.includes("?") ? "&" : "?"}x-oss-process=image/info`);
      const w = Number(info?.ImageWidth?.value), h = Number(info?.ImageHeight?.value);
      if (!w || !h) continue;
      const r = w / h;
      if (r >= KEY_VISUAL_RATIO[0] && r <= KEY_VISUAL_RATIO[1]) return url;
    } catch { /* another host, or a CDN that declined to measure */ }
  }
  return null;
}

/* ---------- article titles ---------- */

/* Both shapes Kuro has used, and they differ by more than wording:
     Wuthering Waves Version Preview | Version 3.7 "…" Scheduled for Release on September 30th (UTC+8)
     Wuthering Waves Version Preview | Version 3.6 "…"
     Wuthering Waves Update Content  | Version 3.5 "…" Planned for Release on July 10 (UTC+8)
   3.6's preview carried no date at all, so the date is optional and its
   absence is not a parse failure — it leaves `start` for a human, or for the
   Update Content post that follows two days before release. */
const PREVIEW = /\bVersion\s+(\d+\.\d+)\s*["“”](.+?)["“”]/i;
/* Two posts match that, and the difference matters for the event art. "Version
   Preview" is the broadcast one, ten days out, and it illustrates the patch —
   story, area, Resonators, weapons. "Update Content" is the quiet one two days
   before release, and it is the one carrying the events sheet: a banner per
   event stacked down a single tall JPEG. 3.6's was article 5310, whose second
   sheet is 1080x12145 with nine bands in it, and every 3.6 event on the desk
   crops its art out of exactly that. So an announced patch whose events have
   no pictures is waiting on this post and nothing else. */
const UPDATE_CONTENT = /Update\s+Content/i;
const RELEASE_ON = /(?:Scheduled|Planned)\s+for\s+Release\s+on\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i;

const MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];

/* Kuro write the release date without a year. The article's own publication
   year is right except across New Year, where a late-December preview dates a
   January patch — so a month that has gone backwards rolls forward. */
function releaseDate(title, publishedISO) {
  const m = RELEASE_ON.exec(title || "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const pub = new Date(publishedISO);
  const year = pub.getUTCFullYear() + (month < pub.getUTCMonth() ? 1 : 0);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

/* [Version 3.6 Featured Resonator/Weapon Convene: Phase Ⅱ] — the numeral is
   the CJK Roman block (U+2160+) on Kuro's EN site and plain ASCII on some
   posts, so read both. */
const PHASE_NOTICE =
  /\[\s*Version\s+(\d+\.\d+)\s+Featured\s+Resonator\/Weapon\s+Convene:\s*Phase\s*([ⅠⅡⅢⅣⅤIViv]+)\s*\]/i;
/* And the loose one, which is a convene name and nothing else. */
const LOOSE_NOTICE = /^\s*\[([^\]]+)\]\s*Featured\s+(Resonator|Weapon)\s+Convene\s*$/i;

const ROMAN = { "ⅰ": 1, "ⅱ": 2, "ⅲ": 3, "ⅳ": 4, "ⅴ": 5, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
const phaseNumber = s => ROMAN[String(s || "").toLowerCase()] ?? null;

/* ---------- convene bodies ---------- */

const CONVENE_HEAD = /\[([^\]]+)\]\s*Featured\s+(Resonator|Weapon)\s+Convene/g;
const FIVE_STAR_RESONATOR = /5-Star\s+Resonator:\s*([^,\n]+)/i;
const FIVE_STAR_WEAPON = /5-Star\s+Weapon:\s*([^,\n]+)/i;

/* The two shapes a convene duration comes in. Phase 2 has both ends as dates;
   phase 1 opens with the patch itself and says so in words, which is not a
   missing date but a pointer at one the version record already holds. */
const BOTH_DATES = /(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}\s*[-–—]\s*(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/;
const AFTER_UPDATE = /Version\s+(\d+\.\d+)\s+update\s*[-–—]\s*(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/i;

/* A window, and the string that identifies it. Two convenes belong to the same
   phase exactly when they claim the same window, which is what lets a loose
   post be filed without a phase number in it. */
function parseWindow(chunk) {
  const both = BOTH_DATES.exec(chunk);
  if (both) return { start: both[1], end: both[2], id: `${both[1]}|${both[2]}` };
  const after = AFTER_UPDATE.exec(chunk);
  if (after) return { withPatch: after[1], end: after[2], id: `v${after[1]}|${after[2]}` };
  return null;
}

/* A standalone post is one convene and nothing else: the name is in the title,
   the body opens with its one 5-star line and carries one duration. It does
   not repeat its own heading the way a phase notice does — [Azure Oath]
   mentions its name only inside the rules, and [Voices on Azure Feathers] only
   in a sentence about the Waveband. So this reads the body whole and takes the
   name from the title, rather than hunting for a heading that isn't there.
   (Two of these posts do happen to contain a line the heading pattern matches.
   Reading them the other way worked for 3.6 and silently dropped 3.5, which is
   the worse failure: a debut Resonator missing from a phase looks exactly like
   a phase that didn't have one.) */
function parseSingle(convene, kind, text) {
  const window = parseWindow(text);
  const out = { resonators: [], weapons: [], window, disagreed: false };
  if (kind === "resonator") {
    const who = FIVE_STAR_RESONATOR.exec(text);
    if (who) out.resonators.push({ name: who[1].trim(), convene, window });
  } else {
    const what = FIVE_STAR_WEAPON.exec(text);
    if (what) out.weapons.push({ name: what[1].trim(), convene, window });
  }
  return out;
}

/* A phase notice covers several convenes, each its own block headed by its
   bracketed name. Slice at the headings rather than trying to match a block in
   one expression — the rules text between them is long, varies, and is none of
   our business. That rules text repeats the heading verbatim ("[X] is a
   Featured Resonator Convene event banner"), so a head identical to the one
   before it is that repeat and folds back into the same block. */
function parseConvenes(text) {
  const all = [...text.matchAll(CONVENE_HEAD)].map(m => ({
    convene: m[1].trim(), kind: m[2].toLowerCase(), at: m.index
  }));
  const heads = all.filter((h, i) =>
    i === 0 || h.convene !== all[i - 1].convene || h.kind !== all[i - 1].kind);

  const resonators = [], weapons = [], windows = new Map();
  for (let i = 0; i < heads.length; i++) {
    const chunk = text.slice(heads[i].at, heads[i + 1]?.at ?? text.length);
    const window = parseWindow(chunk);
    if (window) windows.set(window.id, window);

    if (heads[i].kind === "resonator") {
      const who = FIVE_STAR_RESONATOR.exec(chunk);
      if (who) resonators.push({ name: who[1].trim(), convene: heads[i].convene, window });
    } else {
      const what = FIVE_STAR_WEAPON.exec(chunk);
      if (what) weapons.push({ name: what[1].trim(), convene: heads[i].convene, window });
    }
  }

  /* Every convene in one phase runs the same window. Two answers in one post
     means the body is not shaped the way this reads it, and a half-parsed date
     is worse than none. */
  const distinct = [...windows.values()];
  return {
    resonators, weapons,
    window: distinct.length === 1 ? distinct[0] : null,
    disagreed: distinct.length > 1
  };
}

/* ---------- writing ---------- */

const report = [];
const say = line => { report.push(line); console.log(line); };

/* The desk's own floor. A notice about anything below it is history — the
   patch has been archived out of versions.json on purpose and re-adding it
   from a six-week-old announcement would put a finished patch back on the
   timeline. */
function versionRecord(doc, id, floor) {
  const v = doc.versions.find(x => x.id === id);
  if (v) return v;
  if (cmpVer(id, floor) < 0) {
    say(`  ${id}: retired from the desk — notice ignored`);
    return null;
  }
  /* A version nobody has written down yet. The cadence puts a beta record in
     three weeks before the preview, so it should not happen — but dropping
     Kuro's own announcement because the file was behind is the wrong way
     round. */
  const fresh = { id, title: "", status: "announced", phases: [], notes: "" };
  doc.versions.push(fresh);
  say(`  ${id}: no record on the desk — created one`);
  return fresh;
}

function applyPreview(doc, { version, title, start, published, keyVisual, articleId, floor }) {
  const v = versionRecord(doc, version, floor);
  if (!v) return false;
  let touched = false;

  if (!v.title && title) { v.title = title; touched = true; say(`  ${version}: title "${title}"`); }
  else if (v.title && title && v.title !== title)
    say(`  ${version}: title differs — desk "${v.title}", Kuro "${title}" (left alone)`);

  if (!v.start && start) { v.start = start; touched = true; say(`  ${version}: start ${start}`); }
  else if (v.start && start && v.start !== start)
    say(`  ${version}: start differs — desk ${v.start}, Kuro ${start} (left alone)`);

  if (!v.livestream && published) { v.livestream = published; touched = true; say(`  ${version}: livestream ${published}`); }

  /* A record written off leaks carries a stand-in picture flagged provisional
     — a drip card, usually. The real preview key visual retires it. */
  if (keyVisual && (!v.keyVisual?.url || v.keyVisual.provisional)) {
    v.keyVisual = {
      url: keyVisual,
      source: ARTICLE_URL(articleId),
      title: `Version ${version} Preview key visual`,
      credit: "© Kuro Games"
    };
    touched = true;
    say(`  ${version}: key visual from the preview post`);
  }

  /* The shell reads status off the dates, except that a version marked beta
     stays beta however well dated it is — that flag is the human saying "none
     of this is announced yet", and Kuro have now said otherwise. */
  if (v.status === "beta") { v.status = "announced"; touched = true; say(`  ${version}: beta → announced`); }

  return touched;
}

function applyPhase(doc, { version, n, convenes, window, disagreed, roster, floor }) {
  const v = versionRecord(doc, version, floor);
  if (!v) return false;
  let touched = false;

  let phase = (v.phases ||= []).find(p => p.n === n);
  if (!phase) {
    phase = { n, banners: [] };
    v.phases.push(phase);
    v.phases.sort((a, b) => a.n - b.n);
    touched = true;
    say(`  ${version} phase ${n}: no record — created one`);
  }

  if (disagreed) say(`  ${version} phase ${n}: convenes claim different windows — dates skipped`);
  else if (window) {
    /* Phase 1 opens with the patch, and the version's own start is that date.
       It is the same fact written twice, so the notice confirms the phase
       boundary without ever printing it. */
    const confirmed = {
      start: window.start || (window.withPatch === version ? v.start : null),
      end: window.end
    };
    for (const [field, flag] of [["start", "estimated_start"], ["end", "estimated_end"]]) {
      if (!confirmed[field]) continue;
      if (!phase[field] || phase[flag]) {
        if (phase[field] !== confirmed[field] || phase[flag]) {
          phase[field] = confirmed[field];
          delete phase[flag];
          touched = true;
          say(`  ${version} phase ${n}: ${field} ${confirmed[field]} confirmed`);
        }
      } else if (phase[field] !== confirmed[field]) {
        say(`  ${version} phase ${n}: ${field} differs — desk ${phase[field]}, Kuro ${confirmed[field]} (left alone)`);
      }
    }
  }

  /* The featured weapon of a convene is joined to its Resonator by the desk's
     own record of whose signature it is, because the notice does not join them
     — the weapon convene is a separate block with a separate name. */
  const featured = new Set(convenes.weapons.map(w => key(w.name)));
  const seen = new Set();

  for (const r of convenes.resonators) {
    seen.add(key(r.name));
    let b = (phase.banners ||= []).find(x => key(x.name) === key(r.name));
    const who = roster.get(key(r.name));
    if (!b) {
      b = {
        name: r.name,
        rarity: 5,
        ...(who?.attribute ? { attribute: who.attribute } : {}),
        ...(who?.weapon ? { weapon: who.weapon } : {}),
        ...(who?.role ? { role: who.role } : {}),
        ...(who?.version === version ? { new: true } : { rerun: true })
      };
      phase.banners.push(b);
      touched = true;
      say(`  ${version} phase ${n}: ${r.name} added`);
    }
    if (!b.convene) { b.convene = r.convene; touched = true; say(`  ${version} phase ${n}: ${r.name} on [${r.convene}]`); }
    else if (b.convene !== r.convene)
      say(`  ${version} phase ${n}: ${r.name}'s convene differs — desk "${b.convene}", Kuro "${r.convene}" (left alone)`);

    if (!b.signature && who?.signature && featured.has(key(who.signature))) {
      b.signature = who.signature;
      touched = true;
      say(`  ${version} phase ${n}: ${r.name}'s ${who.signature} is on the weapon banner`);
    }
  }

  const orphans = convenes.weapons
    .map(w => w.name)
    .filter(name => !(phase.banners || []).some(b => key(b.signature) === key(name)));
  if (orphans.length) say(`  ${version} phase ${n}: featured weapons with no banner behind them — ${orphans.join(", ")}`);

  const missing = (phase.banners || []).filter(b => !seen.has(key(b.name))).map(b => b.name);
  if (missing.length) say(`  ${version} phase ${n}: on the desk but not in the notices — ${missing.join(", ")} (left alone)`);

  return touched;
}

/* ---------- the half a fetcher cannot do ---------- */

/* Kuro announce the banner lineup at the broadcast and announce it as a
   picture: six infographics with no text behind them. The convene notices put
   it in text eventually, but not until the day before each phase opens, which
   is ten days after everyone has read about it somewhere else. So an announced
   patch with no banners on it is a real hole in the desk with a known fix and
   a known deadline, which is exactly the shape of thing patch-day-alert.mjs
   turned into an issue. The log line it replaces went unread for four days. */
function lineupGaps(doc) {
  const today = new Date().toISOString().slice(0, 10);
  return doc.versions
    .filter(v => v.start && v.start >= today && v.status !== "beta")
    .filter(v => !(v.phases || []).some(p => (p.banners || []).length))
    .map(v => ({ id: v.id, title: v.title, start: v.start }));
}

/* The same problem one step later, and the same answer. Kuro name a patch's
   events on the broadcast and draw them in the Update Content post, so between
   the two the desk carries the names with its own plate where a banner would
   go. That is the intended look for an event nobody has drawn yet — but once
   the sheet is out, those plates are just a job nobody did.
//
   Only while the patch is still unreleased. After it ships, each event gets a
   notice of its own with its own banner, and fetch-events.mjs takes it from
   there without anyone being asked. */
function eventArtGaps(doc, events, updatePosts) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const v of doc.versions) {
    if (!v.start || v.start < today) continue;
    const post = updatePosts.get(v.id);
    if (!post) continue;
    const bare = (events.events || [])
      .filter(e => e.version === v.id && !e.art)
      .map(e => e.name);
    if (bare.length) out.push({ id: v.id, articleId: post, names: bare });
  }
  return out;
}

async function gh(...args) {
  const { stdout } = await run("gh", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function issueBody({ lineup, eventArt }) {
  const lines = [];

  if (eventArt.length) {
    lines.push(
      "## Event banners are out",
      "",
      "Kuro have published the events sheet for these — a banner per event stacked down one tall",
      "JPEG in the Update Content post — and the desk is still drawing its own plate instead.",
      "");
    for (const g of eventArt) {
      lines.push(
        `- **${g.id}** — article ${g.articleId}, ${g.names.length} event${g.names.length > 1 ? "s" : ""} with no art: ` +
        g.names.map(n => `\`${n}\``).join(", "));
    }
    lines.push(
      "",
      "```bash",
      ...eventArt.map(g => `node scripts/find-event-art.mjs ${g.articleId}`),
      "```",
      "",
      "That prints a paste-ready `art` block and a preview URL per band. Open the previews, match",
      "each band to its event, and paste the crop into that event's `art` in `data/events.json`.",
      "The names are pixels, so the matching is the part that has to be done by eye — everything",
      "either side of it is done. Trim a band that takes in the gold section title above the frame",
      "or Kuro's own name plate inside it, or set `art.nameplate` so the desk doesn't draw a second",
      "title over the first.",
      "",
      "An event Kuro genuinely haven't drawn keeps the plate. That is the intended look, not a gap.",
      "");
  }

  if (lineup.length) {
    if (eventArt.length) lines.push("## Banner lineup", "");
    lines.push(
      "Kuro have announced these, and the desk has the patch but not the banners.",
      "",
      ...lineup.map(g => `- **${g.id}**${g.title ? ` "${g.title}"` : ""} — releases ${g.start}`),
      "");
  }

  return lines.concat(lineupTail(lineup, eventArt)).join("\n");
}

function lineupTail(lineup, eventArt) {
  const tail = [];
  if (lineup.length) tail.push(
    "The lineup is only on the preview infographics — Kuro publish no text version of it until the",
    "Featured Resonator/Weapon Convene notice, which goes up about a day before each phase opens.",
    "`fetch-version-notices.mjs` reads that notice and fills the phases in by itself when it lands,",
    "but that is too late to be useful. Until then someone has to read the pictures.",
    "",
    "For each phase, add to that version's `phases` in `data/versions.json`:",
    "",
    "```json",
    '{ "n": 1, "start": "", "end": "", "estimated_end": true, "banners": [',
    '  { "name": "", "rarity": 5, "attribute": "", "weapon": "", "role": "",',
    '    "new": true, "convene": "", "signature": "" }',
    "] }",
    "```",
    "",
    "A returning Resonator takes `rerun: true` instead of `new`, and keeps the same `convene` name as",
    "their last run — `runs` in `data/resonators.json` has it, and it has never changed for anyone.",
    "Phase dates read off the broadcast are estimates until the convene notices confirm them, so flag",
    "them `estimated_start` / `estimated_end` and let the fetcher clear the flags.",
    "",
    "Then add the announcement to `data/news.json` at `official`.",
    "");
  tail.push(
    "This issue closes itself once every version above is dealt with.",
    "",
    "<!-- desk-lineup: " +
      [...lineup.map(g => `lineup=${g.id}`), ...eventArt.map(g => `art=${g.id}`)].join("; ") +
      " -->");
  return tail;
}

async function raise(gaps) {
  /* One flat list of what is outstanding, for the marker and the "also waiting
     now" comment. A version can be on it twice for two different reasons. */
  const items = [
    ...gaps.lineup.map(g => `lineup=${g.id}`),
    ...gaps.eventArt.map(g => `art=${g.id}`)
  ];

  if (DRY) {
    if (items.length) console.log(`\n--dry-run: would open or update "${ISSUE_TITLE}" with:\n\n${issueBody(gaps)}`);
    else console.log(`\n--dry-run: would close "${ISSUE_TITLE}" if it is open`);
    return;
  }

  /* Listed and matched on the exact title, not searched for: the search index
     lags a new issue by minutes and a duplicate is the noise this is for. */
  const open = JSON.parse(await gh("issue", "list", "--state", "open", "--limit", "200",
    "--json", "number,title,body")).find(i => i.title === ISSUE_TITLE);

  if (!items.length) {
    if (open) {
      await gh("issue", "close", String(open.number),
        "--comment", "Everything Kuro published as a picture has been read off it now — closing.");
      console.log(`closed #${open.number}`);
    }
    return;
  }

  const next = issueBody(gaps);
  if (!open) {
    console.log(`opened ${(await gh("issue", "create", "--title", ISSUE_TITLE, "--body", next)).trim()}`);
    return;
  }
  if (open.body.trim() === next.trim()) { console.log(`#${open.number} already says this`); return; }

  const before = new Set((open.body.match(MARK)?.[1] || "").split("; ").filter(Boolean));
  const arrived = items.filter(i => !before.has(i));
  await gh("issue", "edit", String(open.number), "--body", next);
  if (arrived.length)
    await gh("issue", "comment", String(open.number), "--body",
      `Also waiting now: ${arrived.map(i => `**${i}**`).join("; ")}.`);
  console.log(`updated #${open.number}` + (arrived.length ? `, new: ${arrived.join(", ")}` : ""));
}

/* ---------- main ---------- */

(async function main() {
  const doc = await readJson(VERSIONS);
  const roster = new Map((await readJson(RESONATORS)).resonators.map(r => [key(r.name), r]));
  /* Nothing older than the newest patch the desk carries gets written. */
  const floor = doc.versions.map(v => v.id).sort(cmpVer).at(-1) || "0.0";

  const menu = await getJson(`${BASE}/ArticleMenu.json`);
  const articles = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.articleId && node.articleTitle) articles.push(node);
    Object.values(node).forEach(v => { if (v && typeof v === "object") walk(v); });
  })(menu);

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400e3).toISOString().slice(0, 10);
  const recent = articles
    .filter(a => (a.startTime || "").slice(0, 10) >= cutoff)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  const previews = recent.filter(a => PREVIEW.test(a.articleTitle));
  /* The newest Update Content post per version — the one carrying the events
     sheet. `recent` is oldest-first, so the last write wins. */
  const updatePosts = new Map();
  for (const a of previews)
    if (UPDATE_CONTENT.test(a.articleTitle))
      updatePosts.set(PREVIEW.exec(a.articleTitle)[1], a.articleId);
  const numbered = recent.filter(a => PHASE_NOTICE.test(a.articleTitle));
  const loose = recent.filter(a => LOOSE_NOTICE.test(a.articleTitle));
  console.log(`${recent.length} articles in the window: ${previews.length} preview, ` +
    `${numbered.length} phase notice, ${loose.length} single convene`);

  let touched = false;

  for (const a of previews) {
    const m = PREVIEW.exec(a.articleTitle);
    const version = m[1];
    const published = String(a.startTime || "").slice(0, 10);
    say(`preview: ${version} (article ${a.articleId}, ${published})`);

    /* The body is only fetched for its pictures, and only when the desk still
       needs one — a version already carrying a real key visual costs nothing
       to skip, and skips half a dozen CDN measurements with it. */
    const existing = doc.versions.find(v => v.id === version);
    let keyVisual = null;
    if (!existing?.keyVisual?.url || existing.keyVisual.provisional) {
      const full = await getJson(`${BASE}/article/${a.articleId}.json`);
      keyVisual = await firstKeyVisual(full.articleContent);
      if (!keyVisual) say(`  ${version}: no 16:9 frame in the preview post`);
    }

    touched = applyPreview(doc, {
      version,
      title: m[2].trim(),
      start: releaseDate(a.articleTitle, `${String(a.startTime).replace(" ", "T")}Z`),
      published, keyVisual, articleId: a.articleId, floor
    }) || touched;
  }

  /* The numbered notices first, because they are the only thing that says
     which window is which phase, and the loose posts are filed by window. */
  const phases = new Map();   // "3.6|1" -> { version, n, resonators, weapons, window, disagreed }
  const byWindow = new Map(); // window id -> the same object

  for (const a of numbered) {
    const m = PHASE_NOTICE.exec(a.articleTitle);
    const version = m[1], n = phaseNumber(m[2]);
    if (!n) { say(`convene: ${version} — unreadable phase numeral "${m[2]}"`); continue; }

    const full = await getJson(`${BASE}/article/${a.articleId}.json`);
    const parsed = parseConvenes(toText(full.articleContent));
    const slot = {
      version, n,
      resonators: [...parsed.resonators],
      weapons: [...parsed.weapons],
      window: parsed.window,
      disagreed: parsed.disagreed
    };
    phases.set(`${version}|${n}`, slot);
    if (parsed.window) byWindow.set(parsed.window.id, slot);
  }

  /* The debut convene and its weapon, each in a post of its own with no
     version and no phase on it. The window it claims is the phase it is in. */
  for (const a of loose) {
    const m = LOOSE_NOTICE.exec(a.articleTitle);
    const full = await getJson(`${BASE}/article/${a.articleId}.json`);
    const parsed = parseSingle(m[1].trim(), m[2].toLowerCase(), toText(full.articleContent));
    const slot = parsed.window && byWindow.get(parsed.window.id);
    if (!slot) {
      say(`convene: "${a.articleTitle.trim()}" — no phase notice claims its window (skipped)`);
      continue;
    }
    slot.resonators.push(...parsed.resonators);
    slot.weapons.push(...parsed.weapons);
  }

  for (const slot of [...phases.values()].sort((a, b) =>
    cmpVer(a.version, b.version) || a.n - b.n)) {
    say(`convene: ${slot.version} phase ${slot.n} — ` +
      `${slot.resonators.map(r => r.name).join(", ") || "no 5-star Resonator lines"}`);
    if (!slot.resonators.length) continue;
    touched = applyPhase(doc, {
      version: slot.version, n: slot.n,
      convenes: { resonators: slot.resonators, weapons: slot.weapons },
      window: slot.window, disagreed: slot.disagreed, roster, floor
    }) || touched;
  }

  if (!report.length) console.log("nothing Kuro has published that the desk did not already have");

  if (touched) {
    doc.updated = new Date().toISOString().slice(0, 10);
    console.log(await writeIfChanged(VERSIONS, doc) ? "versions.json written" : "versions.json unchanged");
  } else {
    console.log("versions.json unchanged");
  }

  const events = await readJson(EVENTS).catch(() => ({ events: [] }));
  const gaps = {
    lineup: lineupGaps(doc),
    eventArt: eventArtGaps(doc, events, updatePosts)
  };

  if (gaps.lineup.length) console.log(`\nannounced with no banner lineup: ${gaps.lineup.map(g => g.id).join(", ")}`);
  else console.log("\nevery announced version has its banner lineup");

  if (gaps.eventArt.length)
    for (const g of gaps.eventArt)
      console.log(`${g.id}: events sheet is out (article ${g.articleId}), ${g.names.length} events still on the desk's plate`);
  else console.log("no events waiting on a sheet Kuro has already published");

  await raise(gaps).catch(err => console.log(`alert not raised: ${err.message}`));
})().catch(err => {
  console.error(`fetch-version-notices failed: ${err.message}`);
  process.exitCode = 1;
});

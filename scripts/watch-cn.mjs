// Watches Kuro's own CN community for a Resonator the desk has never heard of.
// Node 20+. No dependencies. No API keys.
//
// Why this exists. Everything the desk knows about a character is automatic
// once it knows the name: fetch-art.mjs resolves the key art within six hours
// of the reveal post, fetch-kits.mjs fills the sheet the day the wiki gets a
// page, and pullTargets() in the app puts them in the pull calculator the
// moment they are filed against a planned patch. The one thing nothing
// automates is learning the name in the first place — fetch-kits builds its
// roster from the wiki's character category, so a character with no wiki page
// is never created, only preserved, and fetch-art only resolves art for names
// the data already holds.
//
// Kuro's English news feed cannot close that gap, and it is worth being exact
// about why rather than assuming: every one of the 86 reveal-shaped posts in
// their EN article menu names a character the desk already had. The EN feed is
// a lagging indicator. Hsin has no English Profile Reveal to this day and has
// been on the desk since 26 August, because the announcement that mattered was
// a Kurobbs post six weeks ahead of it.
//
// So this reads the CN side, which is the same endpoint fetch-feeds.mjs
// already pulls headlines from, and asks one question of it: does a
// profile-preview headline name somebody the roster cannot account for?
//
// It does NOT translate, and it does not write to the database. A Chinese name
// is matched against `nameCN`, which fetch-kits.mjs reads off the wiki's
// {{Other Languages}} block — so the answer is a lookup against Kuro's own
// name for a character, not a transliteration guessed here. The English name
// for somebody genuinely new cannot be sourced at the moment they are
// announced (Kuro publish it weeks later), and inventing one would put a name
// on the desk that nothing stands behind. Reporting the gap is the honest
// half, and it is the half that was missing.
//
// Exits 0 whether or not it finds anything. A new Resonator is news, not a
// broken build, and a red run for it would train the eye to ignore red runs.

import { readFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://api.kurobbs.com/forum/companyEvent/findEventList";
const POST_URL = id => `https://www.kurobbs.com/mc/post/${id}`;
const RESONATORS = "data/resonators.json";
const VERSIONS = "data/versions.json";
const TIMEOUT_MS = 20000;
/* Kuro's own board for Wuthering Waves. Thirty posts is about six weeks of it,
   which is one patch cycle — far enough back that a name announced just after
   the last run is still in the window. */
const GAME_ID = "3";
const PAGE_SIZE = 30;

/* The headline shapes that introduce a Resonator, and nothing else does.
   Same technique translate-signals.mjs uses on the other side of this feed: a
   marker is structural, so it can be matched without reading the language.
   `共鸣者档案前瞻 | 心` is the profile preview and the one that lands first;
   `角色档案` and `档案公开` are the older wordings, kept because the archive
   is read too and Kuro have changed the phrasing once already. */
const MARKERS = [
  /共鸣者档案前瞻/,
  /角色档案前瞻/,
  /档案公开/
];

/* Everything after the last separator in the headline. Kuro write these as
   `<marker> | <name>` with a full-width or ASCII bar, and occasionally with a
   dash. Nothing else is ever appended, so the tail is the name. */
const SEPARATORS = /[|｜│—–\-]/;

async function getJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json,*/*", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const readJson = async path => JSON.parse(await readFile(path, "utf8"));

const hasCJK = s => /[一-鿿]/.test(String(s || ""));

/* The name out of a headline the markers matched. Null rather than a guess
   when the tail is not a name: a marker with nothing after it is Kuro writing
   about the feature rather than announcing somebody, and half a headline is
   not a character. */
function nameFrom(title) {
  const parts = String(title).split(SEPARATORS);
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1].trim().replace(/[「」《》【】\[\]()（）]/g, "").trim();
  /* Chinese, and short. A personal name is one to four characters; anything
     longer is a subtitle that happened to sit after a bar. */
  return hasCJK(tail) && [...tail].length <= 6 ? tail : null;
}

(async () => {
  const [res, ver] = await Promise.all([readJson(RESONATORS), readJson(VERSIONS)]);

  /* What the desk can account for. Both names, because a character can be on
     the desk under an English name with no CN name yet — the hand-written
     records for an unreleased Resonator have no wiki page behind them to read
     one off. Matching either is what stops this reporting Hsin every day for
     six weeks after somebody has already dealt with her. */
  const known = new Set();
  for (const r of res.resonators || []) {
    if (r.name) known.add(String(r.name).toLowerCase());
    if (r.nameCN) known.add(String(r.nameCN));
  }
  /* And the banner rows, which carry names for a patch whose Resonators are
     scheduled but whose records have not been written yet. */
  for (const v of ver.versions || [])
    for (const p of v.phases || [])
      for (const b of p.banners || []) if (b.name) known.add(String(b.name).toLowerCase());

  const withCN = (res.resonators || []).filter(r => r.nameCN).length;
  console.log(`roster: ${(res.resonators || []).length} Resonators, ${withCN} with a Chinese name to match on`);
  if (!withCN) {
    console.log(
      "\nNo record carries `nameCN`, so every CN headline below will read as new.\n" +
      "Run scripts/fetch-kits.mjs first — it reads the name off the wiki's\n" +
      "{{Other Languages}} block. Reporting anyway, but treat it as unfiltered.");
  }

  let body;
  try {
    body = await getJson(API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ gameId: GAME_ID, pageIndex: "1", pageSize: String(PAGE_SIZE) }).toString()
    });
  } catch (err) {
    /* Kurobbs is a Chinese host and turns runners away often enough that this
       must not be an error. The desk loses one cycle of a watch, which is a
       different thing from the desk being wrong. */
    console.log(`kurobbs unreachable (${err.message}) — nothing watched this run`);
    return;
  }
  if (body.code !== 200) {
    console.log(`kurobbs code ${body.code}: ${body.msg || ""} — nothing watched this run`);
    return;
  }

  const posts = body.data?.list || [];
  const reveals = posts.filter(p => MARKERS.some(rx => rx.test(p.postTitle || "")));
  console.log(`kurobbs: ${posts.length} posts, ${reveals.length} of them profile previews\n`);

  const news = [];
  for (const p of reveals) {
    const when = new Date(Number(p.publishTime || p.firstPublishTime));
    const date = isNaN(when) ? "?" : when.toISOString().slice(0, 10);
    const name = nameFrom(p.postTitle);
    const held = name && known.has(name);
    console.log(`  ${date}  ${held ? "known  " : name ? "NEW    " : "unread "}  ${String(name || "—").padEnd(8)} ${p.postTitle}`);
    if (name && !held) news.push({ name, date, title: p.postTitle, url: POST_URL(p.postId) });
  }

  if (!news.length) {
    console.log("\nNothing new. Every Resonator Kuro has announced on the CN side is on the desk.");
    return;
  }

  /* The whole output of this script. Deliberately a paragraph a person reads
     rather than a file something else consumes: what happens next is somebody
     deciding a rarity, a patch and a confidence tier off the leaks, and that
     is the judgement the desk exists to have made by a human. */
  console.log(`\n${"=".repeat(64)}`);
  console.log(`${news.length} Resonator${news.length > 1 ? "s" : ""} announced on Kurobbs that the desk does not hold:\n`);
  for (const n of news) console.log(`  ${n.name}   announced ${n.date}\n    ${n.url}\n`);
  console.log("Add each to data/resonators.json with the English name the community");
  console.log("has settled on, `nameCN` set to the string above so this stops");
  console.log("reporting them, and a confidence tier that says where the rest came");
  console.log("from. The pull calculator picks them up on the next load.");
  console.log("=".repeat(64));
})();

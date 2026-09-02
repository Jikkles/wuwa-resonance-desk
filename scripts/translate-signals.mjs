// Fills in English for non-English signal headlines, into data/translations.json.
// Node 20+. No dependencies, no keys, no translation service.
//
// The desk shows a Chinese headline with a language badge when it has no
// English for it, which is honest but not useful, and the file that held the
// English was hand-written. That could never keep up: feed.json is a rolling
// window and an item drops off it in about a week, so every line typed by hand
// had a shelf life shorter than the gap between sessions. By the time this
// script was written all 31 hand-written lines pointed at items that had
// already rolled off, and all 29 Chinese signals then on the desk were showing
// raw Chinese. The file was doing nothing at all.
//
// It does NOT translate. Kuro publish most of these notices in English
// themselves, on the same website fetch-events.mjs already reads, so the job
// is to *find* the English rather than invent it — the desk's usual rule that
// a fact comes from a source and anything else is a guess. Two ways in, in
// order of how much they can be trusted:
//
//   A. Kuro's own English title. Chinese community posts and English website
//      articles are separate systems with separate ids, so there is no join
//      key — but the notices are structural. "档案公开" is a Profile Reveal
//      and nothing else is; "[X]角色活动唤取" is a Featured Resonator Convene.
//      Match the marker, require the version number to agree where the title
//      carries one, allow a few days of drift (the English post can lead the
//      Chinese one by up to three), and accept only when exactly one English
//      article fits. One candidate is a match; two is a coincidence.
//
//   B. Built from what the desk already holds. A handful of headlines are
//      pure formula with a name in them, and the desk holds the English for
//      that name: versions.json knows a patch's codename, and resonators.json
//      knows a Resonator's, keyed by the Chinese one Kuro publishes them
//      under. Nothing is translated here either — the fixed half of each
//      formula is Kuro's own English title for the series, run verbatim, and
//      the variable half is looked up.
//
//      This is the only way in for a post about a Resonator who has not
//      shipped, which is the case that matters most. Kuro's English run of a
//      character serial covers who is out; the Chinese one is weeks ahead of
//      it, so for the two names a reader most wants there is no English post
//      for strategy A to find.
//
// Anything neither can answer is left alone, and the desk goes on showing the
// original with its badge. A wrong English line is worse than no English line:
// it reads as authoritative and there is nothing to tell you it isn't.
//
// Hand-written lines are never touched. The script only rewrites entries it
// wrote itself, which it tracks in `generated` — so a line corrected by hand
// stops being the script's business the moment it is corrected.
//
// Writes nothing when nothing changed, so an idle run produces no commit.

import { readFile, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const FEED = "data/feed.json";
const VERSIONS = "data/versions.json";
/* Kuro's own name for each Resonator, which is the join key between a Chinese
   headline and a name the desk can print. See chineseName() in fetch-kits.mjs. */
const RESONATORS = "data/resonators.json";
const OUT = "data/translations.json";
const TIMEOUT_MS = 20000;

/* How far the English post may sit from the Chinese one. Measured against the
   3.6 cycle: the convene notices landed the same day, the Resonator Review one
   day apart, the Profile Reveal and the update-content post three days apart —
   English first in every case where they differed. Five days each way covers
   that with room, and is still far short of the six weeks between patches, so
   a marker that recurs every cycle cannot collide with its own last outing. */
const DRIFT_DAYS = 5;

const readJson = async p => JSON.parse(await readFile(p, "utf8"));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/* ── A. Kuro's own English ─────────────────────────────────────────────── */

/* Chinese marker → the phrase Kuro use in the English title for the same kind
   of post. Every pair here was read off a matched pair in the 3.6 cycle rather
   than translated — the Chinese 档案公开 post about 清宵 and the English
   "Profile Reveal | Heart Sword — Qingxiao" are the same notice.
//
   Order matters: the combined Resonator/Weapon convene has to be tested before
   either of the single ones, or it matches the Resonator rule and picks up the
   wrong article. Longest marker first is the rule, and the array is in that
   order deliberately — do not sort it. */
const MARKERS = [
  ["角色/武器活动唤取", "Featured Resonator/Weapon Convene"],
  ["角色活动唤取", "Featured Resonator Convene"],
  ["武器活动唤取", "Featured Weapon Convene"],
  /* The lore serials. Kuro run several under one banner — 寰宇人类注疏 is
     "Post-Lament Anthropocene", with 72 English entries behind it — so the
     banner on its own is far too broad to match on: it would put a post about
     an enemy under a post about a character and the date window would not
     notice. Each sub-series is listed instead, which is specific enough that a
     hit is the same notice rather than the same family. */
  ["寰宇人类注疏：纪世通鉴", "Post-Lament Anthropocene: Comprehensive Mirror for Historians"],
  ["寰宇人类注疏：群星交错", "Post-Lament Anthropocene: Stars Intertwined"],
  ["版本内容说明", "Update Content"],
  ["档案公开", "Profile Reveal"],
  ["档案回顾", "Resonator Review"],
  ["活动预告", "Event Preview"]
];

const versionIn = s => (String(s || "").match(/(\d+\.\d+)/) || [])[1] || null;
const dayOf = s => {
  const t = Date.parse(String(s || "").replace(" ", "T"));
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
};

/* Every article in the English menu, flattened. The menu nests by category and
   repeats entries across them, so ids are deduped on the way out. */
function flattenArticles(menu) {
  const out = new Map();
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const title = node.articleTitle || node.title;
    if (node.articleId && title) {
      out.set(String(node.articleId), {
        id: String(node.articleId),
        title: String(title).trim(),
        day: dayOf(node.createTime || node.publishTime)
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(menu);
  return [...out.values()];
}

/* The English article for a Chinese headline, or null if the answer is not
   unambiguous. Declining is the common case and the correct one. */
function officialEnglish(item, articles) {
  const marker = MARKERS.find(([cn]) => item.title.includes(cn));
  if (!marker) return null;
  const [, en] = marker;

  const day = dayOf(item.date);
  if (day == null) return null;
  const ver = versionIn(item.title);

  const hits = articles.filter(a => {
    if (!a.title.includes(en)) return false;
    if (a.day == null || Math.abs(a.day - day) > DRIFT_DAYS) return false;
    /* A version in the Chinese title has to be in the English one too. Without
       this, "[Version 3.6 …Convene: Phase I]" and the next patch's Phase I are
       the same string to this matcher whenever the two land inside the drift
       window. A Chinese title with no version number asks nothing of the
       English one — plenty of notices carry none. */
    if (ver && !a.title.includes(ver)) return false;
    return true;
  });

  return hits.length === 1 ? hits[0].title : null;
}

/* ── B. Built from the desk's own record ───────────────────────────────── */

/* Pure formula, and every word of the English is either fixed or comes out of
   versions.json. Kept deliberately short: a pattern belongs here only when the
   whole headline is accounted for, because a rule that renders half a headline
   and leaves the rest in Chinese produces a line that is worse than the
   original it replaced. */
const BUILT = [
  {
    re: /^(\d+\.\d+)版本已知问题及更新说明$/,
    en: (m, desk) => `Version ${m[1]} known issues and update notes`
  },
  {
    /* 《鸣潮》3.6版本「蜃云灯影，凡尘剑心」全平台活动开启！ — the codename in
       the quotes is the one versions.json already carries in English. */
    re: /^《鸣潮》\s*(\d+\.\d+)\s*版本[「『"](.+?)[」』"]全平台活动开启/,
    en: (m, desk) => {
      const codename = desk.codenames.get(m[1]);
      return codename
        ? `Wuthering Waves Version ${m[1]} "${codename}" is live on all platforms`
        : null;
    }
  },
  {
    /* 《寰宇人类注疏：群星交错》——心 — the character serial, and the one
       headline shape on this board that is about a Resonator nobody has heard
       of yet.

       Strategy A cannot answer it, and the reason is the whole point: the
       English run of this serial only covers Resonators who have shipped, so
       for the two the desk most wants named there is no English post to find.
       Both halves are still sourced. "Post-Lament Anthropocene: Stars
       Intertwined | X" is Kuro's own English title, run verbatim 31 times, and
       the name comes out of the roster's `nameCN`, which fetch-kits reads off
       the wiki's {{Other Languages}} block. Nothing here is translated; the
       formula is assembled from two things Kuro has published separately.

       Declines when the name is not on the roster, which is the honest answer:
       a Resonator the desk has never heard of has no English name that
       anything stands behind, and inventing one is what scripts/watch-cn.mjs
       exists to ask a person to do instead. */
    re: /^《寰宇人类注疏：群星交错》\s*[—–\-]+\s*(.+?)\s*$/,
    en: (m, desk) => {
      const en = desk.cnNames.get(m[1].trim());
      return en ? `Post-Lament Anthropocene: Stars Intertwined | ${en}` : null;
    }
  }
];

function builtEnglish(item, desk) {
  for (const { re, en } of BUILT) {
    const m = item.title.match(re);
    if (m) return en(m, desk);
  }
  return null;
}

/* ── main ──────────────────────────────────────────────────────────────── */

(async function main() {
  const [feed, versions, roster, doc] = await Promise.all([
    readJson(FEED),
    readJson(VERSIONS).catch(() => ({ versions: [] })),
    readJson(RESONATORS).catch(() => ({ resonators: [] })),
    readJson(OUT).catch(() => ({
      schema: "wuwa-desk/translations@1.0",
      titles: {},
      generated: []
    }))
  ]);

  doc.titles ||= {};
  doc.generated ||= [];
  const mine = new Set(doc.generated);

  /* Everything the formulas in BUILT are allowed to draw on: the desk's own
     record, and nothing else. A rule that needs a word which is not in here is
     a rule that would be translating. */
  const desk = {
    codenames: new Map(
      (versions.versions || []).filter(v => v.id && v.title).map(v => [v.id, v.title])
    ),
    cnNames: new Map(
      (roster.resonators || []).filter(r => r.nameCN && r.name).map(r => [r.nameCN, r.name])
    )
  };

  const items = (feed.items || feed.entries || []).filter(
    i => i.url && i.title && i.lang && i.lang !== "en"
  );
  /* Only what the desk cannot already say. An entry a human wrote is final —
     it is not in `mine`, so it never reaches the resolvers below. */
  const todo = items.filter(i => !doc.titles[i.url] || mine.has(i.url));

  let articles = [];
  if (todo.length) {
    try {
      articles = flattenArticles(await getJson(`${BASE}/ArticleMenu.json`));
    } catch (err) {
      /* No English menu, no strategy A. Strategy B needs nothing from the
         network, so the run still does its half rather than failing. */
      console.warn(`! article menu unreachable (${err.message}) — official titles skipped`);
    }
  }

  let added = 0, changed = 0;
  const declined = [];

  for (const item of todo) {
    const en = officialEnglish(item, articles) || builtEnglish(item, desk);
    if (!en) {
      if (!doc.titles[item.url]) declined.push(item.title);
      continue;
    }
    if (doc.titles[item.url] === en) continue;
    if (doc.titles[item.url]) changed++; else added++;
    doc.titles[item.url] = en;
    mine.add(item.url);
    console.log(`  ${item.title}\n    → ${en}`);
  }

  console.log(
    `\n${items.length} non-English signals · ${added} translated, ${changed} updated, ` +
    `${declined.length} left in the original`
  );

  if (!added && !changed) {
    console.log("nothing to write");
    return;
  }

  doc.generated = [...mine].sort();
  doc.note =
    "English for non-English signal headlines, keyed by the item URL. feed.json is " +
    "machine-written and rolls every 6 hours, so translations cannot live there. Lines " +
    "listed in `generated` were resolved by scripts/translate-signals.mjs — from Kuro's " +
    "own English article title for the same notice where one exists, otherwise built " +
    "from the desk's own record. Every other line is hand-written and the script will " +
    "not overwrite it, so correcting one by hand makes it permanent. Game terms use the " +
    "English client's names (星声 = Astrite, 玄方地界 = Land of Xuanfang). Anything " +
    "without an entry here shows its original headline with a language badge.";
  doc.updated = new Date().toISOString().slice(0, 10);

  await writeFile(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`wrote ${OUT}`);
})();

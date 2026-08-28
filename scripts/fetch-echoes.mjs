// Resolves the whole echo roster — class, cost, sonata sets, echo skill and
// icon — plus the sonata set effects, and writes data/echoes.json. Node 20+.
// No dependencies. No API keys.
//
// The Echoes view is the third database on the desk and the first one the game
// does not hand you as a list. A Resonator has a page in the client and a
// weapon has a card; an echo is a monster you have already killed, and what
// anyone actually wants to know about it — which sonata sets it can roll, what
// its skill does at rank 5, and what it costs to slot — is spread across the
// data terminal, the tuning screen and the monster itself.
//
// Where it comes from. Same source and the same bargain as fetch-weapons.mjs:
// Prydwen's echoes page carries the whole dataset in its own page source, one
// request for all 181 echoes and all 34 sonata sets, and it is credited as
// such. Kuro publish no echo endpoint at all — not even the thin one the news
// site exposes — so there is no first-party option to prefer.
//
// THE PAYLOAD MOVED. Prydwen was a Gatsby site and is now a Next.js one, and
// the two hide their data differently. Gatsby left it as plain JSON inside a
// script tag with every quote escaped once, which is why fetch-weapons.mjs
// could unescape the whole page with two .replace() calls and index into it.
// Next.js streams it as React flight chunks — self.__next_f.push([1,"…"]) —
// where the payload is a JavaScript string literal, so a backslash inside it
// is doubled on top of the escaping the JSON already carries. Unescaping that
// with a blanket replace produces text that no longer parses: "\\n" in a skill
// description comes out as a lone backslash before an n. So the chunks are
// read as string literals, by JSON.parse, and joined back into one payload
// before anything looks for a key in it. flightPayload() below is that.
// fetch-weapons.mjs carries its own copy of the same walker — it broke on the
// same migration and was fixed the same way, and no fetcher in this directory
// imports another.
//
// Two things about the shape of the echo records:
//
//   Rarity is a class index, not a star rating. -1 is an echo the source has
//   not classified, 0 is Common, 1 is Elite, 2 is Overlord, 3 is Calamity —
//   and the cost the game charges to slot one follows from the class: 1, 3, 4
//   and 4 respectively. CLASSES below is that table, and it is the only thing
//   in this file inferred rather than read. The 19 unclassified records are
//   boss parts and set dressing — Fog Lionarch: Head, the six Kernel Puppets —
//   which are real echoes with real skills and no cost published anywhere, so
//   they are kept with a null cost rather than dropped.
//
//   Skill_1…Skill_5 are the echo's rank, which is its star rarity, 1 through
//   5. Rank 1 is all zeroes for most of the roster because most echoes do not
//   drop at 1★, and the source's own page opens on rank 2 for that reason. The
//   values are positional against the {0}…{9} holes in Echo_skill, so ranks[n]
//   here is what {n} becomes at each of the five ranks — the same shape
//   weapons.json uses for ascension, so the view can carry one template and a
//   slider instead of five near-identical paragraphs per echo.
//
// Icons land in assets/echoes/ rather than being hotlinked, same bargain as
// the portraits and the weapon icons: Prydwen is a fan site paying for its own
// CDN, and serving 215 files from Pages is cheaper for them than every visitor
// hitting theirs. Echo renders are filed under the monster id and sonata
// crests under the sonata id, which is why this script owns two directories.

import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const ECHOES_URL = "https://www.prydwen.gg/wuthering-waves/echoes";
const ECHO_IMG = id => `https://cdn.prydwen.gg/images/wuthering-waves/monsters/${id}.webp`;
const SET_IMG  = id => `https://cdn.prydwen.gg/images/wuthering-waves/icons/set_${id}.webp`;
const OUT = "data/echoes.json";
const DIR = "assets/echoes";
const SET_DIR = "assets/echoes/sets";
const TIMEOUT_MS = 25000;

/* curl rather than fetch(). Prydwen sits behind Cloudflare, which turns away
   Node's TLS handshake with a 403 no matter what headers it sends; the same
   request from curl is served. Identical to fetch-weapons.mjs and
   fetch-portraits.mjs, deliberately — three scripts talking to one host should
   talk to it the same way. */
const curl = (url, extra = []) =>
  run("curl", [
    "--silent", "--show-error", "--fail", "--location", "--compressed",
    "--max-time", String(Math.round(TIMEOUT_MS / 1000)),
    "-A", UA,
    "-H", "Accept-Language: en-GB,en;q=0.9",
    "-e", "https://www.prydwen.gg/",
    ...extra,
    url
  ], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });

async function getText(url) {
  const { stdout } = await curl(url, ["-H", "Accept: text/html,application/xhtml+xml"]);
  return stdout.toString("utf8");
}
async function fetchImage(url) {
  const { stdout } = await curl(url, ["-H", "Accept: image/webp,image/*"]);
  if (!stdout.length) throw new Error("empty body");
  return stdout;
}

/* ── the flight payload ───────────────────────────────────────────────
   Every self.__next_f.push([1,"…"]) on the page, read as the string literal it
   is and joined in document order. That reassembles the React server payload,
   which is where the page's data lives now.

   The string is walked rather than matched with a regex for the usual reason:
   a lazy match stops at the first quote inside the payload, of which there are
   thousands, and a greedy one runs to the last quote on the page. Stepping
   over an escaped character is the whole trick. A chunk that will not parse is
   skipped rather than thrown on — the page carries chunks that are not data,
   and one of them failing is not a reason to lose the roster. */
function flightPayload(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,"/g;
  let m;
  while ((m = re.exec(html))) {
    const open = m.index + m[0].length - 1;   // the literal's opening quote
    let i = open + 1;
    for (; i < html.length; i++) {
      if (html[i] === "\\") { i++; continue; }
      if (html[i] === '"') break;
    }
    try { out.push(JSON.parse(html.slice(open, i + 1))); } catch { /* not data */ }
  }
  return out.join("");
}

/* The array filed under `key` in the payload, walked bracket by bracket rather
   than matched with a regex: echo descriptions contain bracketed prose and the
   records contain nested arrays, and a lazy regex stops at the first of
   either. */
function jsonArrayAt(payload, key) {
  const at = payload.indexOf(`"${key}":[`);
  if (at === -1) throw new Error(`no "${key}" key in payload — the source layout changed`);
  const open = payload.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < payload.length; i++) {
    if (payload[i] === "[") depth++;
    else if (payload[i] === "]" && --depth === 0) return JSON.parse(payload.slice(open, i + 1));
  }
  throw new Error(`unterminated ${key} array`);
}

/* ── markup ───────────────────────────────────────────────────────────
   Both the skill text and the set bonuses arrive as HTML, and the desk is not
   putting somebody else's markup into innerHTML. So the vocabulary is fixed
   here, at the point the data is written, and the renderer can trust what it
   gets: bold, and bold in an element's colour. Everything else — the <u>, the
   <p>, the stray <br /> — is either a paragraph break or noise.

   Order matters. The tags that survive are parked on sentinels first, then
   every remaining tag is stripped, then entities are decoded, then the whole
   string is escaped, and only then do the sentinels become tags again. Decode
   first and an &lt; in the prose becomes a bracket the strip pass reads as
   markup; escape first and every tag on the page survives as visible text. */
const ELEMENTS = ["Aero", "Glacio", "Fusion", "Electro", "Spectro", "Havoc"];

const ENTITIES = {
  "&apos;": "'", "&quot;": '"', "&amp;": "&", "&nbsp;": " ",
  "&lt;": "<", "&gt;": ">", "&#39;": "'"
};

/* Where a surviving tag waits between the strip pass and the escape pass.
   Control characters, because they cannot occur in the source text — a
   readable marker like [[b]] is something the prose could legitimately
   contain, and one day would. */
const B_OPEN = "\u0001", B_SEP = "\u0002", B_CLOSE = "\u0003";

function cleanMarkup(src) {
  let s = String(src || "");
  /* Paragraph and line breaks become the two-character escape the rest of the
     desk already splits skill prose on — see effectHtml in app.js, which reads
     both that and a real newline. */
  s = s.replace(/<\/p>\s*<p>/gi, "\\n\\n").replace(/<br\s*\/?>/gi, "\\n");
  /* Bold, carrying the element name where the source marked one. */
  s = s.replace(/<strong class="([A-Za-z]+)"\s*>/gi, (_, cls) =>
    B_OPEN + (ELEMENTS.includes(cls) ? cls.toLowerCase() : "") + B_SEP);
  s = s.replace(/<(?:strong|b)\s*>/gi, B_OPEN + B_SEP)
       .replace(/<\/(?:strong|b)\s*>/gi, B_CLOSE);
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&[a-z#0-9]+;/gi, e => ENTITIES[e.toLowerCase()] ?? e);
  /* Whatever an entity just produced is text, not markup — escaped here, while
     the only tags left in the string are still parked on their sentinels. */
  s = s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  s = s.replace(new RegExp(B_OPEN + "([a-z]*)" + B_SEP, "g"),
                (_, el) => el ? `<b class="e-${el}">` : "<b>")
       .replace(new RegExp(B_CLOSE, "g"), "</b>");
  return s.replace(/[ \t]+(?=\\n)/g, "").trim();
}

/* ── classes ──────────────────────────────────────────────────────────
   The source's Rarity index, and what the game charges to slot one. Cost is
   the only field on this page the desk derives rather than reads, and it is
   derivable because the two move together: every Common echo costs 1, every
   Elite 3, and both 4-cost classes cost 4. An index this table does not know
   is kept with a null class rather than guessed at — a sixth one arriving
   should show up as a gap, not as a wrong number. */
const CLASSES = {
  "-1": { name: null,        cost: null },
  "0":  { name: "Common",    cost: 1 },
  "1":  { name: "Elite",     cost: 3 },
  "2":  { name: "Overlord",  cost: 4 },
  "3":  { name: "Calamity",  cost: 4 }
};

/* {0}…{9} in the skill text, resolved to the five values each takes across the
   echo's ranks. Indexed by placeholder number so a template can skip one —
   ranks[3] is what {3} means, whatever ranks[2] is doing — with nulls for the
   holes it never fills. A rank whose array is shorter than the template needs
   contributes a null for the values it does not have, and the view prints "?"
   there rather than reaching for a number from the wrong slot. */
function rankTable(e) {
  const used = [...String(e.Echo_skill || "").matchAll(/\{(\d)\}/g)].map(m => Number(m[1]));
  if (!used.length) return [];
  const out = Array(Math.max(...used) + 1).fill(null);
  for (const n of new Set(used)) {
    out[n] = [1, 2, 3, 4, 5].map(r => {
      const v = e[`Skill_${r}`]?.[n];
      return v == null || v === "" ? null : String(v);
    });
  }
  return out;
}

/* The lowest rank this echo actually drops at. Most of the roster has a rank-1
   column of zeroes because most echoes do not exist at 1★, and a slider that
   opens on a row of 0% is a slider that looks broken. Read off the values
   rather than assumed from the class: Common echoes do drop at low ranks and
   some of them have real numbers there. An echo with no scaling values at all
   — a pure buff, or one of the unclassified boss parts — has no rank to find,
   and returns 1 so the slider still spans the whole range. */
function minRank(ranks) {
  const filled = ranks.filter(Boolean);
  if (!filled.length) return 1;
  for (let r = 0; r < 5; r++) {
    if (filled.some(vals => {
      const v = vals[r];
      return v != null && !/^0(\.0+)?%?$/.test(v);
    })) return r + 1;
  }
  return 1;
}

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ── icons ────────────────────────────────────────────────────────────
   One file per echo and one per sonata set, written under the id the source
   files it by. Failures are counted and reported rather than thrown on: an
   icon that will not come down is a card with a glyph on it, which the view
   already draws for an echo with no published render, and it is not a reason
   to lose 181 records. */
async function cacheIcons(dir, jobs) {
  await mkdir(dir, { recursive: true });
  const written = new Set();
  let ok = 0, failed = [];
  for (const { file, url } of jobs) {
    try {
      await writeFile(`${dir}/${file}`, await fetchImage(url));
      written.add(file);
      ok++;
    } catch { failed.push(file); }
  }
  return { written, ok, failed };
}

/* Files under a directory this script owns that nothing in the roster points
   at any more — an echo renamed upstream, or one that has been withdrawn.
   Removed rather than left: a directory that only ever grows is a directory
   nobody can tell the live half of. */
async function sweep(dir, keep) {
  let stale = 0;
  for (const f of await readdir(dir).catch(() => [])) {
    if (f.endsWith(".webp") && !keep.has(f)) { await unlink(`${dir}/${f}`); stale++; }
  }
  return stale;
}

/* ── main ─────────────────────────────────────────────────────────── */
async function main() {
  console.log(`fetching ${ECHOES_URL}`);
  const payload = flightPayload(await getText(ECHOES_URL));
  if (!payload) throw new Error("no flight payload on the page — the source layout changed");

  const rawEchoes = jsonArrayAt(payload, "echoes");
  const rawSets   = jsonArrayAt(payload, "echoSets");
  console.log(`parsed ${rawEchoes.length} echoes, ${rawSets.length} sonata sets`);

  const sonata = rawSets
    .map(s => ({
      id: Number(s.sonata_id),
      name: String(s.name || "").trim(),
      slug: s.slug || slug(s.name),
      /* Two shapes of set. The standard ones pay at 2 and 5 pieces; the five
         "compact" ones pay once, at 3, and are the sets built for the 3-echo
         loadouts. Stored as the piece counts the set actually has rather than
         as three fixed fields, so the view prints what exists instead of
         printing "3-piece: —" 29 times. */
      pieces: [[2, s.bonus_2], [3, s.bonus_3], [5, s.bonus_5]]
        .filter(([, html]) => String(html || "").trim())
        .map(([n, html]) => ({ n, text: cleanMarkup(html) })),
      /* The name the set shipped under before it was renamed. Two of them have
         one, and anyone who learned the game a year ago is searching for it. */
      alias: String(s.aliases || "").trim() || null,
      icon: `${SET_DIR}/set_${Number(s.sonata_id)}.webp`
    }))
    .filter(s => Number.isFinite(s.id) && s.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const known = new Set(sonata.map(s => s.id));
  const echoes = rawEchoes
    .map(e => {
      const cls = CLASSES[String(e.Rarity)] || CLASSES["-1"];
      const ranks = rankTable(e);
      return {
        name: String(e.Name || "").trim(),
        slug: e.Slug || slug(e.Name),
        id: String(e.ID || ""),
        class: cls.name,
        cost: cls.cost,
        /* Sonata ids the echo can roll, filtered to the ones the set list
           actually knows — an id with no set behind it would be a crest the
           view cannot draw and a filter nothing is filed under. */
        sonata: (e.Sonata_Group || []).map(Number).filter(n => known.has(n)),
        skill: cleanMarkup(e.Echo_skill),
        ranks,
        minRank: minRank(ranks),
        icon: `${DIR}/${String(e.ID || "")}.webp`
      };
    })
    .filter(e => e.name && e.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  /* Reported, not corrected. An echo filed under no class is a real record
     with a real skill and no published cost, and the view has a table for
     them; the count is here so a class index appearing out of nowhere is
     visible in the log rather than discovered on the page. */
  const unclassed = echoes.filter(e => !e.class);
  if (unclassed.length) {
    console.log(`${unclassed.length} echoes carry no class or cost upstream:`);
    console.log(`  ${unclassed.map(e => e.name).join(", ")}`);
  }
  const orphans = echoes.filter(e => !e.sonata.length).map(e => e.name);
  if (orphans.length) console.log(`${orphans.length} echoes roll no known sonata set`);

  console.log(`caching ${echoes.length} echo icons`);
  const eIcons = await cacheIcons(DIR, echoes.map(e => ({ file: `${e.id}.webp`, url: ECHO_IMG(e.id) })));
  console.log(`caching ${sonata.length} sonata crests`);
  const sIcons = await cacheIcons(SET_DIR, sonata.map(s => ({ file: `set_${s.id}.webp`, url: SET_IMG(s.id) })));

  /* An icon that did not come down leaves no path behind. The card draws its
     glyph plate for a null, and a path to a file that is not there draws a
     broken image — the desk would rather say it has no picture than pretend. */
  for (const e of echoes) if (!eIcons.written.has(`${e.id}.webp`)) e.icon = null;
  for (const s of sonata) if (!sIcons.written.has(`set_${s.id}.webp`)) s.icon = null;

  const stale = await sweep(DIR, eIcons.written) + await sweep(SET_DIR, sIcons.written);

  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify({
    schema: "wuwa-desk/echoes@1.0",
    note: "Every echo in the game: class, slot cost, the sonata sets it can roll, and its echo skill as a template with the five values each hole takes across ranks 1–5. ranks[n] holds what {n} in `skill` becomes at each rank; a null is a value the source does not publish and the view prints as ?. minRank is the lowest rank the echo has real numbers at — most of the roster starts at 2. Cost is derived from class (Common 1, Elite 3, Overlord 4, Calamity 4) and is the only field here not read from the source; an echo the source has not classified carries null for both. Sonata set bonuses are the same data, cleaned to bold-only markup. Icons are cached in assets/echoes/. Stats and text via prydwen.gg; echo art © Kuro Games.",
    credit: "Echo and sonata data via prydwen.gg · echo art © Kuro Games",
    source: ECHOES_URL,
    generated: new Date().toISOString(),
    sonata,
    echoes
  }, null, 2) + "\n");

  console.log(`wrote ${OUT} — ${echoes.length} echoes, ${sonata.length} sets`);
  console.log(`icons: ${eIcons.ok} echo, ${sIcons.ok} crest, ${stale} stale removed`);
  if (eIcons.failed.length || sIcons.failed.length) {
    console.log(`no icon for: ${[...eIcons.failed, ...sIcons.failed].join(", ")}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

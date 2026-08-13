// Builds the resonator database: who everyone is, what their kit does, and
// every banner they have ever headlined. Node 20+. No dependencies, no keys.
//
// Writes two files, split on how often they are read:
//
//   data/resonators.json  the index — identity, debut patch, rerun patches.
//                         Loaded on every page view, so it stays small.
//   data/kits.json        the kit text — six skills, two inherents and the
//                         full six-node Resonance Chain per character. ~300KB,
//                         so app.js fetches it the first time a record opens
//                         and never on first paint.
//
// Three sources, each used for the one thing it is actually authoritative on:
//
//   Fandom character page   The infobox is the game's own character sheet:
//                           rarity, attribute, weapon, role, epithet, nation,
//                           release date. Structured, and it covers the
//                           4-stars and the four Rovers that the leak sites
//                           never bother writing up.
//   Fandom convene pages    One page per banner, named <Convene>/<start date>,
//                           carrying its 5-star, its dates and the version it
//                           shipped in. Sorted by date this is the complete
//                           debut-and-rerun history — the thing the desk shows
//                           in the corner of every record.
//   Prydwen character page  The kit. Skill names and full descriptions, laid
//                           out in a stable `skill-header` / `skill-details`
//                           pair, plus the six Sequence Nodes under
//                           "Resonance Chain (Dupes)".
//
// Nothing here overwrites a hand-written field. `summary`, `kit`, `sources`,
// `confidence`, `convene`, `signature`, `accessory` and `status` are the desk's
// own editorial and survive every run — the merge only fills blanks and
// refreshes the two things that are facts rather than judgements, `debut` and
// `reruns`. That matters because the desk's whole claim is that a human decided
// what tier each statement sits at, and a scraper cannot make that call.
//
// Kit confidence is set once, on the same rule: a character whose debut patch
// has already shipped has a kit that is in the live client, and the live client
// is Kuro's own word, so it lands `official`. Anyone still unreleased keeps
// whatever tier a human last gave them — Prydwen's pre-release pages are stubs
// with no skill blocks at all, so there is nothing to scrape for them anyway.

import { writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const WIKI = "https://wutheringwaves.fandom.com/api.php";
const PRYDWEN_LIST = "https://www.prydwen.gg/wuthering-waves/characters";
const PRYDWEN_CHAR = slug => `https://www.prydwen.gg/wuthering-waves/characters/${slug}`;
const OUT_INDEX = "data/resonators.json";
const OUT_KITS = "data/kits.json";
const TIMEOUT_MS = 30000;
const CONCURRENCY = 5;

/* Same rule as fetch-portraits.mjs: match on letters and digits only, so
   "Rover (Havoc)", "Rover-Havoc" and "Rover Havoc" are one character, and
   "Yangyang: Xuanling" survives the colon the desk writes it with. */
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* The two names that normalising alone can't reconcile — the wiki files the
   Shorekeeper without her article, and the desk (like the game) keeps it. */
const ALIAS = { shorekeeper: "theshorekeeper" };
const ckey = s => ALIAS[key(s)] || key(s);

/* curl rather than fetch(): Prydwen sits behind Cloudflare, which turns away
   Node's TLS handshake with a 403 no matter what headers it sends. The wiki
   would be happy with fetch(), but one transport for both keeps the retry and
   timeout behaviour identical across sources. */
const curl = (url, extra = []) =>
  run("curl", [
    "--silent", "--show-error", "--fail", "--location", "--compressed",
    "--max-time", String(Math.round(TIMEOUT_MS / 1000)),
    "-A", UA,
    "-H", "Accept-Language: en-GB,en;q=0.9",
    ...extra,
    url
  ], { maxBuffer: 64 * 1024 * 1024 });

/* One run is ~140 requests across three hosts, and at that volume a reset is
   routine rather than exceptional — Fandom in particular drops a connection
   every few batches. Retrying three times with a widening gap turns the whole
   job from "usually fails somewhere" into one that finishes. A 404 is not
   worth retrying: curl --fail reports it as 22, and a page that isn't there
   won't be there in two seconds either. */
async function getText(url, extra = []) {
  for (let attempt = 1; ; attempt++) {
    try { return (await curl(url, extra)).stdout; }
    catch (err) {
      if (err.code === 22 || attempt >= 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}
const getJson = async url => JSON.parse(await getText(url));
const readJson = async path => JSON.parse(await readFile(path, "utf8"));

/* Run tasks a few at a time. 60 character pages at 40KB each is 2.4MB from a
   fan site's CDN; five in flight is quick without being rude. */
async function pool(items, worker, n = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const at = i++;
      try { out[at] = await worker(items[at], at); }
      catch (err) { out[at] = { error: err.message }; }
    }
  }));
  return out;
}

/* ── wikitext ────────────────────────────────────────────────────── */

/* Wiki markup down to the sentence underneath it. Order matters: references
   and nested templates go first so their innards never survive as loose text,
   then links collapse to their display half, then the type formatting. */
function stripWiki(s) {
  let t = String(s || "");
  /* Unreleased characters' pages are written in full and then commented out
     until the patch lands, so a comment block here is a whole article's worth
     of text that is not meant to be read yet. */
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "");
  t = t.replace(/\{\{[Ll]ang\|[^}]*?(?:zh|ja|ko)=([^}|]*)[^}]*\}\}/g, "$1");
  /* `{{W|miko}}` is a Wikipedia link and its text is a word in the sentence,
     so deleting the template outright leaves "She is a and member of the
     Special Response Force". Link templates keep their display text — the last
     positional argument — and only then does everything else get dropped. */
  t = t.replace(/\{\{[Ww](?:ikipedia)?\|([^{}]*)\}\}/g, (m, args) => {
    const positional = args.split("|").filter(a => !a.includes("="));
    return positional[positional.length - 1] || "";
  });
  /* `{{Rubi|Loong|Dragon}}` is a ruby annotation — "Loong" is the word in the
     sentence and "Dragon" the gloss printed above it. The base text is the
     first argument here, not the last, which is why it needs its own rule. */
  t = t.replace(/\{\{Rubi\|([^{}|]*)[^{}]*\}\}/gi, "$1");
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  t = t.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1");
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1").replace(/\[https?:\/\/\S+\]/g, "");
  t = t.replace(/'''?/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
}

/* Pull one template out of a page and split it into named parameters. Counts
   braces and brackets so a `{{Lang}}` or a piped `[[link|label]]` inside a
   value never gets read as the end of that value. */
function template(wikitext, name) {
  const open = wikitext.indexOf(`{{${name}`);
  if (open < 0) return null;
  let depth = 0, end = open;
  for (let i = open; i < wikitext.length; i++) {
    if (wikitext.startsWith("{{", i)) { depth++; i++; }
    else if (wikitext.startsWith("}}", i)) { depth--; i++; if (!depth) { end = i + 1; break; } }
  }
  const body = wikitext.slice(open + 2 + name.length, end - 2);

  const params = {};
  let buf = "", brace = 0, bracket = 0;
  const flush = () => {
    const eq = buf.indexOf("=");
    if (eq > 0) params[buf.slice(0, eq).trim()] = buf.slice(eq + 1).trim();
    buf = "";
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (body.startsWith("{{", i)) brace++;
    else if (body.startsWith("}}", i)) brace--;
    else if (body.startsWith("[[", i)) bracket++;
    else if (body.startsWith("]]", i)) bracket--;
    if (c === "|" && !brace && !bracket) flush();
    else buf += c;
  }
  flush();
  return params;
}

/* Fandom caps a content query at 50 titles, so batch and flatten. */
async function wikitextFor(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${WIKI}?action=query&prop=revisions&rvslots=main&rvprop=content` +
      `&format=json&formatversion=2&titles=${batch.map(encodeURIComponent).join("|")}`;
    const j = await getJson(url);
    for (const p of j.query?.pages || []) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (text) out.set(p.title, text);
    }
  }
  return out;
}

async function categoryMembers(category) {
  const url = `${WIKI}?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(category)}` +
    `&cmlimit=500&cmnamespace=0&format=json&formatversion=2`;
  return (await getJson(url)).query?.categorymembers?.map(m => m.title) || [];
}

/* ── fandom: characters ──────────────────────────────────────────── */

/* The infobox `role` reads "Main Damage Dealer; Resonance Skill Damage" — a
   role and then the sub-stat it scales. The desk's cards have room for one
   short label, so keep the first clause and shorten the mouthful. */
const ROLE_SHORT = {
  "main damage dealer": "Main DPS",
  "sub damage dealer": "Sub DPS",
  "support": "Support",
  "healer": "Healer",
  "concerto efficiency": "Support",
  "shielder": "Shielder"
};
function role(raw) {
  const first = stripWiki(raw).split(";")[0].trim();
  return ROLE_SHORT[first.toLowerCase()] || first;
}

/* First n sentences. Abbreviations aren't a risk here — this is marketing prose
   about swordsmen, not citations — so splitting on a full stop is enough. */
function sentences(text, n) {
  const parts = String(text).match(/[^.!?]+[.!?]+/g);
  return parts ? parts.slice(0, n).join(" ").trim() : String(text).trim();
}

function parseCharacter(title, wikitext) {
  /* The four Rover forms are subpages of one character and carry a stripped
     infobox — attribute, role, release date, nothing else, because everything
     else is shared and lives on the parent page. Falling back to it is what
     puts the protagonist in the database at all; rarity, weapon and the blurb
     come from Prydwen's listing and the parent page in the merge below. */
  const box = template(wikitext, "Resonator Infobox") || template(wikitext, "Rover Infobox");
  if (!box) return null;

  /* `{{Change History|1.0}}` at the foot is the wiki's record of which patch
     introduced the page, and it is the only debut a standard-pool Resonator
     has — Verina and Encore have never headlined a banner, so the convene
     history says nothing about them. Some pages write it
     `{{Change History|introduced=1.0|3.5}}`, where the trailing number is the
     one that means released. */
  const ch = wikitext.match(/\{\{Change History\|(?:introduced=[^|}]*\|)?([0-9]+\.[0-9]+)/);

  /* The page opens `{{Intro/Resonator|Name}} She is the second daughter of…`.
     The template expands to a stock "X is a playable Resonator" line, which
     says nothing; the prose after it is the character. */
  const intro = wikitext.match(/\{\{Intro\/Resonator[^}]*\}\}/);
  let summary = "";
  if (intro) {
    /* Half the roster puts that prose on the same line as the template and
       half puts it two lines down, so read to the next section heading and
       take the first paragraph with anything in it. */
    const after = wikitext.slice(intro.index + intro[0].length).split(/\n==/)[0];
    summary = after.split(/\n\s*\n/).map(stripWiki).find(p => p.length >= 25) || "";
  }
  /* Failing that, Kuro's own blurb. Every page quotes the character's write-up
     from the official site under "Official Introduction", and the Rover — who
     has no lore paragraph, being the player — has only this. It is several
     sentences where the wiki's own line is one, so it is the fallback rather
     than the first choice, and it gets trimmed to its opening sentences. */
  if (!summary) {
    const official = wikitext.match(/==\s*Official Introduction\s*==\s*\{\{Quote\|([\s\S]*?)\|\[?https?:/);
    if (official) summary = sentences(stripWiki(official[1]), 2);
  }
  /* And failing that, the lead section, which is where the Rover's write-up
     lives — the protagonist gets neither of the above, being the player rather
     than a character with a bio. The stock "X is a Resonator in Wuthering
     Waves" opener is skipped: it is a definition, not a description. */
  if (!summary) {
    summary = wikitext.split(/\n==/)[0].split(/\n\s*\n/).map(stripWiki).find(p =>
      p.length >= 40 &&
      /* The infobox sits in this section too, and an image gallery inside it
         leaves pipes and equals signs behind that the template stripper can't
         reach. Prose has neither, so that is the test. */
      !/[{}|=]/.test(p) &&
      !/\bis an? [^.]{0,40}Resonator\b/i.test(p)) || "";
  }
  return {
    title,
    name: stripWiki(box.name) || title,
    epithet: stripWiki(box.title) || undefined,
    rarity: Number(box.rarity) || undefined,
    attribute: stripWiki(box.attribute) || undefined,
    weapon: stripWiki(box.weapon) || undefined,
    role: box.role ? role(box.role) : undefined,
    /* Where they are from. Most sheets say `nation`; the 1.0 cast predates
       that field and only carries `birthplace`, which for them is the same
       answer written in the older style. */
    nation: stripWiki(box.nation) || stripWiki(box.birthplace) || undefined,
    releaseDate: stripWiki(box.releaseDate) || undefined,
    /* `obtain` names the banner they debuted on. The standard pool's five say
       plain "Convene" instead, which is the sheet's way of saying they are
       always available — worth carrying, because it is the reason they have no
       debut banner and no reruns to list. */
    standard: /^convene$/i.test(stripWiki(box.obtain) || "") || undefined,
    debut: ch?.[1] || undefined,
    summary: summary || undefined
  };
}

/* ── fandom: banner history ──────────────────────────────────────── */

/* One convene page per banner run. The 5-star it featured, when it ran, and
   the version it shipped in — the last from `{{Change History|3.5}}` at the
   foot, which is how the wiki records what patch a page was introduced by. */
function parseConvene(title, wikitext) {
  const box = template(wikitext, "Convene");
  const pool = template(wikitext, "Convene/Pool");
  if (!box || !pool) return null;
  const ch = wikitext.match(/\{\{Change History\|(?:introduced=[^|}]*\|)?([0-9]+\.[0-9]+)/);
  const date = title.split("/")[1] || "";
  return {
    convene: title.split("/")[0],
    version: ch?.[1] || "",
    start: (stripWiki(box.time_start) || date).slice(0, 10),
    end: (stripWiki(box.time_end) || "").slice(0, 10),
    link: stripWiki(box.link) || "",
    five: stripWiki(pool.resonator_5_F || "").split(";").map(s => s.trim()).filter(Boolean),
    fours: stripWiki(pool.resonator_4_F || "").split(";").map(s => s.trim()).filter(Boolean)
  };
}

/* Every banner each character has headlined, oldest first. A 4-star's rate-up
   runs count too — for them a "rerun" is a featured slot on somebody else's
   banner, and that is still the answer to "when could I last pull them". */
/* A handful of convene pages never got their `{{Change History}}` footer, so
   they know when they ran but not which patch that was. Banners all turn over
   on the same day a phase opens, so a sibling that starts on the same date has
   the answer — and if every banner from that day is missing it too, the run is
   still listed, just without a patch number against it. */
function fillVersions(convenes) {
  const byDate = new Map();
  for (const c of convenes) if (c.version && !byDate.has(c.start)) byDate.set(c.start, c.version);
  for (const c of convenes) if (!c.version) c.version = byDate.get(c.start) || "";
  return convenes;
}

function bannerHistory(convenes) {
  const runs = new Map();
  const add = (name, run) => {
    const k = ckey(name);
    if (!runs.has(k)) runs.set(k, []);
    runs.get(k).push(run);
  };
  for (const c of convenes) {
    if (!c) continue;
    for (const n of c.five) add(n, { version: c.version, convene: c.convene, start: c.start, end: c.end, featured: 5 });
    for (const n of c.fours) add(n, { version: c.version, convene: c.convene, start: c.start, end: c.end, featured: 4 });
  }
  for (const list of runs.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return runs;
}

/* ── prydwen: kits ───────────────────────────────────────────────── */

const decode = s => String(s)
  .replace(/<!--\s*-->/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&rsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”");

/* Paragraph HTML to text the desk can render without trusting a byte of it.
   Bold and underline survive as `**x**` and `__x__` markers rather than tags:
   the renderer escapes the whole string first and only then turns the markers
   back into elements, so the multipliers stay legible and nothing from a
   scraped page can reach innerHTML as markup. */
function inline(html) {
  const marked = String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<(?:b|strong)>/gi, B0).replace(/<\/(?:b|strong)>/gi, B1)
    .replace(/<u>/gi, U0).replace(/<\/u>/gi, U1)
    .replace(/<[^>]+>/g, "");
  return decode(marked)
    .replace(BOLD, emphasis("**"))
    .replace(UNDER, emphasis("__"))
    .replace(STRAY, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* The four sentinels the tags become. They are control characters so that no
   skill description can contain one, and they are built rather than typed so
   the source of this file stays plain ASCII. */
const [B0, B1, U0, U1] = [1, 2, 3, 4].map(n => String.fromCharCode(n));
const STRAY = new RegExp("[" + B0 + "-" + U1 + "]", "g");
const pair = (a, b) => new RegExp(a + "(\\s*)([^" + b + "]*?)(\\s*)" + b, "g");
const BOLD = pair(B0, B1);
const UNDER = pair(U0, U1);

/* Kuro bolds the trailing space as often as not - "<b>2 </b>strikes" - so the
   marker closes inside the padding rather than fossilising it, and emphasis
   that turns out to hold nothing but whitespace is dropped entirely. */
const emphasis = m => (_, before, text, after) =>
  text ? before + m + text + m + after : " ";

/* A skill body is a run of <p>. Some of them are nothing but a bold label —
   "Heavy Attack", "Mid-air Attack - Customary Greetings" — and those are
   headings for the paragraphs that follow, not prose. Splitting on them keeps
   a Basic Attack entry readable instead of one twelve-sentence block. */
function blocks(html) {
  const out = [];
  let cur = null;
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const raw = m[1];
    const text = inline(raw);
    if (!text) continue;
    const heading = /^\*\*[^*]+\*\*$/.test(text);
    if (heading) {
      cur = { h: text.slice(2, -2), p: [] };
      out.push(cur);
    } else {
      if (!cur) { cur = { p: [] }; out.push(cur); }
      cur.p.push(text);
    }
  }
  return out.filter(b => b.p.length || b.h);
}

const SKILL_SLOT = {
  "basic attack": "basic",
  "resonance skill": "skill",
  "resonance liberation": "liberation",
  "forte circuit": "forte",
  "intro skill": "intro",
  "outro skill": "outro"
};

/* The page repeats one shape for all fourteen entries — eight skills then six
   Sequence Nodes — so slicing on the header and reading to the next one gets
   every body without having to balance a single div. The multiplier accordion
   that trails each skill is cut off: it is empty in the served HTML, filled in
   by the client from a table the desk has no room for. */
function parseKit(html) {
  const parts = html.split('<div class="skill-header">');
  const skills = {};
  const inherent = [];
  const extra = [];
  const chain = [];

  for (const part of parts.slice(1)) {
    const head = part.match(/^<div class="skill-icon[^"]*">([\s\S]*?)<\/div><div class="skill-info"><p class="skill-name">([\s\S]*?)<\/p>/);
    if (!head) continue;
    const kind = decode(head[1]).trim();
    const name = decode(head[2]).trim();
    /* Where this skill's text stops. Splitting the page on the header leaves
       the final segment running to the end of the document, which on a
       reviewed character swallows Prydwen's write-up — several paragraphs of
       "at long last, the highly-anticipated…" filed as a Sequence Node. Two
       boundaries close it: the multiplier accordion that trails each skill,
       and `content-header`, the page's own divider between sections. */
    const body = part.slice(head[0].length)
      .split(/<div class="(?:pw-accordion|content-header|section-analysis)/)[0];
    const b = blocks(body);
    if (!b.length) continue;

    const slot = SKILL_SLOT[kind.toLowerCase()];
    /* One slot, one skill — except where Prydwen labels two blocks the same
       way, as it does with Luuk Herssen's pair of Forte Circuits. Overwriting
       lost the first one silently, so a second claimant on a taken slot goes
       to `extra` and gets rendered under its own heading. Better a kit with an
       oddly-named section than a kit missing a section. */
    if (slot && !skills[slot]) skills[slot] = { name, blocks: b };
    else if (slot) extra.push({ kind, name, blocks: b });
    else if (/^inherent/i.test(kind)) inherent.push({ name, blocks: b });
    else if (/^s[1-6]$/i.test(kind)) chain.push({ n: Number(kind.slice(1)), name, blocks: b });
  }

  chain.sort((a, b) => a.n - b.n);
  return { skills, inherent, extra, chain };
}

/* Prydwen fills an unannounced character's element and weapon with the literal
   string "Unknown" so their card still lays out. On the desk an absent field
   renders as nothing at all, which says the same thing without pretending
   "Unknown" is an attribute alongside Aero and Havoc. */
const known = v => (v && v !== "Unknown" && v !== "TBA" ? v : undefined);

function parseRoster(html) {
  const rx = /"slug":"([^"]+)","name":"((?:[^"\\]|\\.)*)","rarity":"([^"]*)","element":"([^"]*)","weapon":"([^"]*)"/g;
  const out = [];
  for (const m of html.replace(/\\"/g, '"').matchAll(rx)) {
    out.push({
      slug: m[1],
      name: m[2].replace(/\\(.)/g, "$1"),
      rarity: Number(m[3]) || undefined,
      element: m[4] || undefined,
      weapon: m[5] || undefined
    });
  }
  return out;
}

/* ── merge ───────────────────────────────────────────────────────── */

const cmpVer = (a, b) => {
  const [am, an] = String(a).split(".").map(Number);
  const [bm, bn] = String(b).split(".").map(Number);
  return am - bm || an - bn;
};

const isRover = r => (/^Rover\b/.test(r.name) ? 1 : 0);

/* One sortable string per Resonator, oldest debut first.
   A released character sorts on the day they arrived. One who hasn't yet has
   no date, so they sort on their announced patch behind a `9` — every real
   date starts with a `2`, so the unreleased land after the whole timeline
   rather than in 1970. Someone with no announced patch either (Suoming) gets
   `9.9` and sits last of all, which is exactly what is known about them. */
function debutKey(r){
  return r.released || r.runs?.[0]?.start || `9${r.version || "9.9"}`;
}

/* Everything up to and including the version that is live has shipped. */
function shipped(current) {
  return v => !!v && cmpVer(v, current) <= 0;
}

(async function main() {
  const versions = await readJson("data/versions.json").catch(() => ({}));
  const current = versions.current || "0.0";
  const prev = await readJson(OUT_INDEX).catch(() => ({ resonators: [] }));

  /* Roster: the union of the two wiki categories — one lists the four Rover
     forms, the other the characters announced but not yet playable — keyed
     against Prydwen's list, which is what the art fetcher works from. */
  const [playable, all, listHtml] = await Promise.all([
    categoryMembers("Playable Resonators"),
    categoryMembers("Resonators"),
    getText(PRYDWEN_LIST, ["-e", "https://www.prydwen.gg/", "-H", "Accept: text/html"])
  ]);
  /* "Rover" itself stays in the fetch but out of the database: it is the
     parent page the four elemental forms hang off, and the only place their
     shared blurb is written. */
  const titles = [...new Set([...playable, ...all])].filter(t => t !== "Resonator");
  const roster = parseRoster(listHtml);
  const bySlug = new Map(roster.map(r => [ckey(r.name), r]));
  console.log(`wiki: ${titles.length} resonator pages · prydwen: ${roster.length} listed\n`);

  const pages = await wikitextFor(titles);
  const roverParent = parseCharacter("Rover", pages.get("Rover") || "") || {};
  const chars = titles.filter(t => t !== "Rover")
    .map(t => parseCharacter(t, pages.get(t) || "")).filter(Boolean);

  /* Banner history. 71 convene pages at the time of writing, each one banner
     run; sorted by date they give every character's debut and every rerun. */
  const convTitles = await categoryMembers("Featured Resonator Convenes");
  const convPages = await wikitextFor(convTitles);
  const convenes = fillVersions(convTitles.map(t => parseConvene(t, convPages.get(t) || "")).filter(Boolean));
  const history = bannerHistory(convenes);
  console.log(`convenes: ${convenes.length} banner runs, ${history.size} characters with a run`);

  const noVersion = convenes.filter(c => !c.version).map(c => c.convene);
  if (noVersion.length) console.log(`no version on: ${[...new Set(noVersion)].join(", ")}`);

  /* Kits, from Prydwen, one page each. A character with no published kit yet
     has a stub page and parses to nothing, which is the correct answer. */
  const targets = chars.filter(c => bySlug.has(ckey(c.name)));
  const kitPages = await pool(targets, async c => {
    const slug = bySlug.get(ckey(c.name)).slug;
    const html = await getText(PRYDWEN_CHAR(slug), ["-e", PRYDWEN_LIST, "-H", "Accept: text/html"]);
    return { name: c.name, slug, ...parseKit(html) };
  });

  const kits = {};
  const isShipped = shipped(current);
  const index = [];
  const byName = new Map(prev.resonators?.map(r => [ckey(r.name), r]) || []);
  const used = new Set();

  for (const c of chars) {
    const listed = bySlug.get(ckey(c.name));
    const old = byName.get(ckey(c.name)) || {};
    const rover = /^Rover/.test(c.title) ? roverParent : {};
    used.add(ckey(c.name));
    /* The desk's own spelling wins where it already has one — portraits.json
       and every hand-written banner row are keyed to it. */
    const name = old.name || listed?.name || c.name;

    const runs = history.get(ckey(c.name)) || [];
    const fiveRuns = runs.filter(r => r.featured === 5 || c.rarity !== 5);
    /* Debut is the earlier of the two things that can mean it: the first
       banner they headlined, and the patch the wiki says introduced them.
       For a limited 5-star those agree. For a 4-star they don't — Baizhi was
       in the game from launch and first got a rate-up in 1.1 — and the answer
       to "when did they debut" is the day you could first have them, so the
       earlier wins and 1.1 becomes the first entry in her rate-up list.
       Standard-pool and the Rover forms have no convene at all and rest on the
       wiki alone. A hand-written version only stands when neither exists,
       which is the unreleased case and exactly what it is for — it
       deliberately does not win, because `version` used to mean "the patch
       this record is about" and had Aemeath at 3.5 for a rerun. */
    const debut = [fiveRuns[0]?.version, c.debut].filter(Boolean).sort(cmpVer)[0]
      || old.version || "";
    /* Reruns are the patches you could pull them in *after* the debut one. A
       4-star often takes a second rate-up slot inside their own debut patch,
       and listing that patch as a rerun of itself reads as an error. */
    const reruns = [...new Set(fiveRuns.slice(1).map(r => r.version).filter(Boolean))]
      .filter(v => v !== debut);

    const kit = kitPages.find(k => k && ckey(k.name) === ckey(c.name));
    const hasKit = kit && Object.keys(kit.skills || {}).length >= 4;
    if (hasKit) kits[name] = { slug: kit.slug, skills: kit.skills, inherent: kit.inherent, chain: kit.chain, ...(kit.extra?.length ? { extra: kit.extra } : {}) };

    /* Old record first so nothing hand-written is lost, then the wiki fills
       the blanks. `version`, `reruns` and `runs` are the exception — they are
       dates and patch numbers, not judgements, so the scrape is the truth. */
    const rec = {
      ...old,
      name,
      rarity: old.rarity ?? c.rarity ?? listed?.rarity,
      attribute: old.attribute || known(c.attribute) || known(listed?.element),
      weapon: old.weapon || known(c.weapon) || known(listed?.weapon),
      role: old.role || c.role,
      region: old.region || c.nation || rover.nation,
      epithet: old.epithet || c.epithet || rover.epithet,
      summary: old.summary || c.summary || rover.summary,
      version: debut || undefined,
      status: old.status || (isShipped(debut) ? "released" : "announced"),
      convene: old.convene || fiveRuns[0]?.convene,
      released: old.released || c.releaseDate,
      /* Always obtainable, so the corner badge says so instead of showing a
         rerun list that would always be empty. */
      standard: old.standard || c.standard,
      /* Whether kits.json holds a kit for them. The index is loaded on every
         page view and the kit file only on demand, so without this the cards
         would have to claim "no kit" for everybody until somebody opened a
         record — or the desk would have to load a megabyte to draw a badge. */
      hasKit: hasKit || undefined,
      reruns: reruns.length ? reruns : undefined,
      runs: runs.length ? runs.map(({ featured, ...r }) => r) : undefined
    };

    /* Identity is the wiki's character sheet, which is the shipped game for
       anyone released. Kit likewise — but only once the patch is out; before
       that a human's tier stands, because there is nothing on the page yet. */
    rec.confidence = {
      identity: old.confidence?.identity || (isShipped(debut) ? "official" : "reported"),
      kit: hasKit && isShipped(debut) ? "official" : old.confidence?.kit
    };
    if (!rec.confidence.kit) delete rec.confidence.kit;

    for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
    index.push(rec);
  }

  /* A record the wiki has no page for — someone teased in a poster and nowhere
     else yet — is the desk's alone and stays exactly as written. */
  for (const r of prev.resonators || []) if (!used.has(ckey(r.name))) index.push(r);

  /* Chronological by debut, which is the order the game introduced them and
     the order every community banner chart is drawn in. Sorting by version and
     then by name got the within-patch order wrong — Zani and Ciaccona both
     debuted in 2.3, but Zani was Phase 1 and Ciaccona Phase 2, and only the
     date knows that. The four Rover forms are pulled to the end: they are one
     character in four elements rather than four debuts, so threading them
     through the timeline by release date separates them for no reason. */
  index.sort((a, b) => (isRover(a) - isRover(b)) || debutKey(a).localeCompare(debutKey(b)));

  const today = new Date().toISOString().slice(0, 10);
  await writeFile(OUT_INDEX, JSON.stringify({
    schema: "wuwa-desk/resonators@1.1",
    updated: today,
    note:
      "Identity, debut patch and rerun history per Resonator. Kit text lives in kits.json — " +
      "it is ten times the size and only a record that has been opened needs it. " +
      "Identity and banner history via wutheringwaves.fandom.com; kit via prydwen.gg.",
    resonators: index
  }, null, 2) + "\n");

  await writeFile(OUT_KITS, JSON.stringify({
    schema: "wuwa-desk/kits@1.0",
    updated: today,
    note:
      "Six skills, two Inherent Skills and the six-node Resonance Chain per Resonator, as they " +
      "read in the live client. Text carries **bold** and __underline__ markers rather than " +
      "markup — the desk escapes the string before turning those back into elements. " +
      "Skill descriptions via prydwen.gg; skills © Kuro Games.",
    credit: "Kit text via prydwen.gg · © Kuro Games",
    kits
  }, null, 2) + "\n");

  const withKit = Object.keys(kits).length;
  const withDebut = index.filter(r => r.version).length;
  console.log(`\n${index.length} records · ${withKit} with a full kit · ${withDebut} with a debut patch`);
  const gaps = index.filter(r => !kits[r.name]).map(r => r.name);
  if (gaps.length) console.log(`no kit published yet: ${gaps.join(", ")}`);
})();

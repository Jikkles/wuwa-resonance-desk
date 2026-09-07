// Reads the beta client's own data tables and writes data/clientfiles.json —
// the things that exist in the game files and nowhere the desk already looks.
// Node 20+. No dependencies. No API keys.
//
// Why this file exists. Every other fetcher in here reads a source that only
// knows about shipped content: Prydwen writes a weapon page when the weapon is
// out, the wiki writes a sonata set when people can farm it, Kuro's news feed
// announces a patch when the broadcast happens. That is the correct default —
// it is also why the desk had a hole in exactly the place a reader planning a
// pull is standing.
//
// The hole was visible on the desk before it was fixed. versions.json names
// Thousandfold Deliverance as Jingran's signature on the 3.6 timeline; opening
// it got a record that said "No passive published for this one yet", because
// the weapon database is Prydwen and Prydwen has no page for an unshipped
// weapon. The timeline promised a name the database could not answer for.
//
// The beta client can answer for it. Kuro ships the stat curves, the passive
// template and its five ascension values into the client the moment a weapon
// enters beta — weeks before it ships, and long before any fan site writes it
// up. That is the same class of evidence the desk already files under
// `datamined`: real numbers, pre-balance.
//
// Where it is read from. Kuro publishes no data endpoint, and unpacking a beta
// client is not something a GitHub Action can do. nanoka.cc datamines each beta
// build and serves the extracted tables as static JSON, one file per entity
// type per build, at static.nanoka.cc/ww/<build>/. Those are the raw client
// tables — the id-keyed ones, with the game's own numeric enums for element and
// weapon class still in them — rather than anybody's write-up, which is what
// makes them worth reading: there is no editorial layer between this and the
// files, so there is nothing to disagree with, only to translate.
//
// What it refuses to do:
//
//   It never touches data/weapons.json or data/echoes.json. Both of those are
//   rebuilt wholesale by their own fetchers — fetch-weapons.mjs does not merge,
//   it replaces — so a beta record written into either would survive exactly
//   until the next run. They stay in a file of their own, and app.js merges
//   them in at read time under a marker that says where they came from.
//
//   It never overwrites a shipped record. Anything the live sources already
//   carry is dropped here, whatever the client says about it. Prydwen's numbers
//   are post-balance and the beta's are not; when the two disagree about a
//   weapon that has already shipped, the shipped one is right.
//
//   It never invents the link between a weapon and its holder. The desk works
//   that out for itself from resonators.json and the timeline, the same way it
//   does for every shipped weapon.
//
//   It reports rather than writes for characters and, well, anything else it
//   finds a gap in. A Resonator in the client files and not in the roster is a
//   thing for a person to look at, not for this to file.
//
// Two numeric conventions in the client tables, both worth knowing before
// reading the parser. A stat entry carries either `is_percent`, in which case
// the value is basis points and 2430 means 24.3%, or `is_ratio`, in which case
// it is a fraction and 0.72225 means 72.2%. And the ATK on the level-90 row is
// a half — 587.5, 412.5 — which the client rounds up for display. Prydwen
// truncates the same figure instead, which is the whole of why its 5★ base ATK
// column reads 587 where this one reads 588.

import { writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

/* The site names the build it is serving in its own page source; the static
   host has no index and 404s every build but the current one, so the version
   has to be read rather than guessed. */
const SITE = "https://ww.nanoka.cc/";
const BASE = build => `https://static.nanoka.cc/ww/${build}`;
const OUT = "data/clientfiles.json";
/* Kit text goes to a file of its own for the same reason kits.json is separate
   from resonators.json: it is an order of magnitude bigger than everything
   around it, and nobody arriving at the timeline reads a word of it. app.js
   loads clientfiles.json in the boot set and this one only when a record is
   opened, exactly as it already does for the shipped kits. */
const KIT_OUT = "data/clientkits.json";
const TIMEOUT_MS = 30000;

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* curl rather than fetch(), same as every other fetcher here that talks to a
   host behind a CDN. */
const curl = url =>
  run("curl", [
    "--silent", "--show-error", "--fail", "--location", "--compressed",
    "--max-time", String(Math.round(TIMEOUT_MS / 1000)),
    "-A", UA,
    "-H", "Accept-Language: en-GB,en;q=0.9",
    url
  ], { maxBuffer: 64 * 1024 * 1024 });

const getText = async url => (await curl(url)).stdout;
const getJSON = async url => JSON.parse(await getText(url));

/* The game's own enums. Both are dense and both have been stable since launch,
   but an index this table does not know is kept as null rather than guessed
   at — a seventh element should show up on the desk as a gap, not as Havoc. */
const ELEMENTS = {1: "Glacio", 2: "Fusion", 3: "Electro", 4: "Aero", 5: "Spectro", 6: "Havoc"};
const WCLASSES = {1: "Broadblade", 2: "Sword", 3: "Pistols", 4: "Gauntlets", 5: "Rectifier"};

/* One canonical spelling per stat, matching what fetch-weapons.mjs writes, so
   the Weapons view's stat filter does not grow a second "Crit. Rate" chip next
   to its "CRIT Rate" one. */
const STAT_NAME = {
  "atk": "ATK", "def": "DEF", "hp": "HP",
  "crit. rate": "CRIT Rate", "crit rate": "CRIT Rate",
  "crit. dmg": "CRIT DMG", "crit dmg": "CRIT DMG",
  "energy regen": "Energy Regen"
};
const statName = s => STAT_NAME[String(s || "").trim().toLowerCase()] || String(s || "").trim();

/* Weapons whose id starts 8008 are the Somnoire projections — event-mode
   copies that exist only inside one activity, have no stats and cannot be
   pulled. They are in the same table as the real ones and are not weapons in
   the sense this desk's Weapons view means, so they never leave this script. */
const isProjection = id => String(id).startsWith("8008");

const esc = s => String(s).replace(/[<>&]/g, c => ({"<": "&lt;", ">": "&gt;", "&": "&amp;"}[c]));

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* The same key, minus a leading definite article, for comparing names against
   the roster. The client's character table files her as Shorekeeper and every
   English source the desk reads — Kuro's own included — calls her The
   Shorekeeper, so on a plain `norm` she reads as a Resonator nobody has ever
   written up. Roster names only: a weapon called The Something would be a
   different weapon from Something, whereas no two Resonators differ by an
   article. */
const rosterKey = s => norm(String(s || "").replace(/^the\s+/i, ""));

/* The client's level-90 row, read out of the last ascension band. `stats` is
   keyed by ascension and then by level, the bands overlap at their seams
   (band 5 ends at 80, band 6 starts there), and only the top of the last one
   is wanted — every figure on the Weapons view is a level 90 figure. */
function maxLevelStats(w) {
  const bands = Object.keys(w.stats || {}).map(Number).sort((a, b) => a - b);
  if (!bands.length) return null;
  const band = w.stats[String(bands[bands.length - 1])];
  const lv = Math.max(...Object.keys(band).map(Number));
  return band[String(lv)] || null;
}

/* Basis points or a fraction, to the percentage the desk prints. One decimal,
   which is what the game shows and what fetch-weapons.mjs already writes. */
function pct(stat) {
  const v = Number(stat.value) || 0;
  const n = stat.is_ratio ? v * 100 : stat.is_percent ? v / 100 : v;
  return Math.round(n * 10) / 10;
}

/* Kuro writes two pieces of client-side markup into passive text that the
   English client resolves before drawing it, and both have to go before the
   string is any use to a renderer that only knows about {n} holes.

   <SapTag=X>{n}</SapTag> marks a number the client will want to agree with a
   noun. The tag id X is not the placeholder number — Thousandfold Deliverance
   has tag A wrapping {10} — so the wrappers are read first, into a map of tag
   id to the placeholder it sits on.

   {Cus:Sap,S=stack P=stacks SapTag=X} is that noun: singular or plural
   depending on the number tag X wrapped. Resolved here at fetch time against
   the ascension-1 value, which is exact rather than approximate because every
   count Kuro has ever put a Sap tag on is flat across all five ascensions —
   a passive says "up to 6 times" at S1 and at S5. A count that did move would
   make the word rank-dependent and the template is not, so that case takes the
   plural and is reported, rather than silently picking a rank's word and
   printing it at the other four. */
function resolvePassive(effect, param) {
  let s = String(effect || "");
  const wrapped = new Map();
  let varied = false;

  for (const m of s.matchAll(/<SapTag=([A-Za-z0-9]+)>(.*?)<\/SapTag>/g)) {
    const hole = m[2].match(/\{(\d+)\}/);
    if (hole) wrapped.set(m[1], Number(hole[1]));
  }

  s = s.replace(/\{Cus:Sap,\s*S=(\S+)\s+P=(\S+)\s+SapTag=([A-Za-z0-9]+)\}/g, (_, one, many, tag) => {
    const vals = param?.[wrapped.get(tag)];
    if (!Array.isArray(vals) || !vals.length) return many;
    if (new Set(vals).size > 1) { varied = true; return many; }
    return Number(vals[0]) === 1 ? one : many;
  });

  /* The wrappers themselves carry nothing once the noun beside them is
     settled — the number inside is an ordinary {n} hole. */
  s = s.replace(/<\/?SapTag(?:=[A-Za-z0-9]+)?>/g, "");
  return {effect: s.trim(), varied};
}

/* {n} in the effect text, resolved to the five values it takes at ascension 1
   through 5 — the same shape fetch-weapons.mjs builds, indexed by placeholder
   number with nulls for the holes the template skips, so the renderer needs to
   know nothing about where a record came from. */
function rankTable(effect, param) {
  const used = [...String(effect || "").matchAll(/\{(\d+)\}/g)].map(m => Number(m[1]));
  if (!used.length) return [];
  const out = Array(Math.max(...used) + 1).fill(null);
  for (const n of new Set(used)) {
    const a = param?.[n];
    if (Array.isArray(a) && a.length === 5) out[n] = a.map(v => String(v));
  }
  return out;
}

/* A sonata bonus, from the client's plain sentence to the marked-up one the
   Echoes view draws. Two jobs: put each {n} back as the value it stands for,
   bolded the way every other set on that page bolds its numbers, and mark the
   element word so sonataSection can take the set's accent off its own text —
   which is how the desk colours every set it already has, rather than from a
   table of set names to elements that would need a line adding per patch. */
const ELEMENT_WORDS = Object.values(ELEMENTS);
const ELEMENT_RE = new RegExp(`\\b(${ELEMENT_WORDS.join("|")})\\b`, "g");

function bonusText(desc, param) {
  /* Escaped first: everything after this point deliberately writes tags into
     the string, so a bracket that arrived in Kuro's own prose has to have
     stopped being markup before then. */
  let s = esc(String(desc || ""));
  /* Elements before values, which is what lets both passes be a plain replace
     with no sentinel to park a half-finished mark on. A value can contain an
     element name — nothing stops Kuro writing one — and marking the elements
     while every value is still an unexpanded {n} hole means the element pass
     can never reach inside one. The reverse order needs sentinels; this does
     not, and fetch-echoes.mjs only carries them because it is unpicking real
     markup rather than writing it. */
  s = s.replace(ELEMENT_RE, (_, el) => `<b class="e-${el.toLowerCase()}">${el}</b>`);
  return s.replace(/\{(\d+)\}/g, (m, n) => {
    const v = param?.[Number(n)];
    return v == null ? m : `<b>${esc(v)}</b>`;
  });
}

/* ── kits ─────────────────────────────────────────────────────────────
   The client carries every Resonator's whole kit, and for one who has not
   shipped that is the only place it exists: prydwen.gg writes a page on
   release and the wiki writes one after that, so a beta Resonator's record on
   this desk has been leak prose and nothing else, at `reported` confidence,
   while Kuro's own text sat in the files.

   The skill tree is 17 nodes. Nine carry a skill and eight are the flat
   Crit. Rate / ATK bonuses, which are node_type 4 and are not prose. The nine
   map onto the six skills, two Inherent Skills and one extra slot that
   kits.json already stores, and the mapping was not guessed: it was read off
   Qingxiao, whose kit the desk already had from prydwen.gg, and then checked
   against seven more. Node id, type and coordinate agree on every character
   tried, so all three are validated and a tree that does not match is refused
   rather than filed under the wrong headings. */
const KIT_SLOTS = {
  1:  {slot: "basic",      type: 2, coord: 1},
  2:  {slot: "skill",      type: 2, coord: 2},
  3:  {slot: "liberation", type: 2, coord: 3},
  4:  {slot: "inherent",   type: 3, coord: 2},
  5:  {slot: "inherent",   type: 3, coord: 3},
  6:  {slot: "intro",      type: 2, coord: 4},
  7:  {slot: "forte",      type: 1, coord: 1},
  8:  {slot: "outro",      type: 3, coord: 1},
  17: {slot: "extra",      type: 3, coord: 1}
};
const SKILL_SLOTS = ["basic", "skill", "liberation", "forte", "intro", "outro"];

/* The client's colour names for the six attributes. Kuro named these before
   the English build settled on Electro and Havoc, so the tags still read
   Thunder and Dark. */
const ELEMENT_COLOUR = {
  Thunder: "Electro", Dark: "Havoc", Wind: "Aero",
  Light: "Spectro", Fire: "Fusion", Ice: "Glacio"
};

/* {Cus:Ipt,Touch=tap PC=press Gamepad=press} — one instruction written three
   ways for the client to pick from by input device. The desk is a web page, so
   it takes the PC form; the other two say the same thing and carrying all
   three would be noise. */
const resolveInput = s =>
  s.replace(/\{Cus:Ipt,[^}]*?PC=([^\s}]+)[^}]*\}/g, (_, pc) => pc);

/* Inline marks. Both decisions are about matching what the desk already shows
   for the other 57 Resonators rather than about what the client stores.

   Attribute colours become __underline__, which is the mark kits.json already
   uses for them and kitText() in app.js already renders.

   <color=Highlight> is dropped. The client highlights every defined term it
   mentions — in one Qingxiao sentence that is "Basic Attack - Stringblade
   Stage 1", "Stage 4" and "Sheathed Stance" — and emphasis on everything marks
   nothing. prydwen.gg does not carry it, so the desk has never shown it, and a
   beta record that suddenly did would read as a different kind of thing rather
   than as the same kind of thing earlier.

   Applied innermost-out: the colour pattern only matches a run with no tag
   inside it, so repeating it until the string stops changing unwraps
   <color=Highlight><te>Tune Break</te></color> in the right order without
   needing a parser. */
function marks(s) {
  let out = String(s).replace(/<te\s+href=\d+>(.*?)<\/te>/g, "$1");
  let prev;
  do {
    prev = out;
    out = out.replace(/<color=(\w+)>([^<]*)<\/color>/g, (_, tag, t) => {
      if (!t.trim()) return t;
      const mark = ELEMENT_COLOUR[tag] ? "__" : "";
      /* Already carrying this mark from an inner tag — a second pair around it
         would close in the wrong place. */
      return !mark || t.includes(mark) ? t : mark + t + mark;
    });
  } while (out !== prev);
  /* Anything the list above does not know loses its tag and keeps its words. A
     colour Kuro adds next patch should read as plain text, never as markup. */
  return out.replace(/<[^>]*>/g, "");
}

/* One description to the blocks kits.json stores: an optional heading and the
   paragraphs under it. The client writes those headings as
   <size=40><color=Title>Heavy Attack</color></size> on a line of their own,
   and they are the sub-abilities — without them a Basic Attack entry is one
   unreadable twelve-sentence paragraph, which is the same reason app.js
   renders `h` at all. prydwen.gg flattens them away; this keeps them, so a
   beta record is better organised than a shipped one rather than worse. */
function toBlocks(desc, param) {
  let s = resolvePassive(desc, param).effect;
  s = resolveInput(s);
  s = s.replace(/\{(\d+)\}/g, (m, n) => {
    const v = param?.[Number(n)];
    /* Bolded, which is what prydwen.gg does to the same numbers and therefore
       what the rest of kits.json looks like. Derived rather than guessed: a
       {n} is a value the client itself marked as one, so this bolds every
       figure and never a number that happened to be in the prose. */
    return v == null ? m : `**${v}**`;
  });

  const parts = s.split(/<size=\d+>\s*<color=Title>(.*?)<\/color>\s*<\/size>/g);
  const blocks = [];
  const push = (h, body) => {
    const p = marks(body).split("\n").map(x => x.trim()).filter(Boolean);
    if (p.length || h) blocks.push({...(h ? {h: marks(h).trim()} : {}), p});
  };
  push(null, parts[0] || "");
  for (let i = 1; i < parts.length; i += 2) push(parts[i], parts[i + 1] || "");
  return blocks.filter(b => b.h || b.p.length);
}

/* Node 17 holds a character's extra passive, and for most of the roster that
   is the Tune Break node — one paragraph about filling a target's Off-Tune
   Level, identical word for word between Hsin and Verina because it belongs to
   the Rectifier class rather than to either of them. Every character has one,
   kits.json carries it for nobody, and printing it on the two beta records
   would put a line on them that marks nothing and reads like a mechanic.
   Qingxiao's node 17 is a real Forte Circuit and is kept.

   Worth knowing outside this function: that boilerplate is where the leaks'
   "Tune Break system rendered as Harmony" came from. */
const isTuneBreak = name => /^Tune Break\b/i.test(String(name || "").trim());

function buildKit(detail) {
  const tree = detail.skill_trees || {};
  for (const [id, want] of Object.entries(KIT_SLOTS)) {
    const n = tree[id];
    if (!n || !n.skill) throw new Error(`node ${id} missing`);
    if (n.node_type !== want.type || n.coordinate !== want.coord)
      throw new Error(`node ${id} is type ${n.node_type}/${n.coordinate}, expected ${want.type}/${want.coord}`);
  }
  const chainIds = Object.keys(detail.chains || {}).map(Number).sort((a, b) => a - b);
  if (chainIds.length !== 6) throw new Error(`${chainIds.length} Resonance Chain nodes, expected 6`);

  const skills = {};
  for (const slot of SKILL_SLOTS) {
    const id = Object.keys(KIT_SLOTS).find(k => KIT_SLOTS[k].slot === slot);
    const s = tree[id].skill;
    skills[slot] = {name: String(s.name || ""), blocks: toBlocks(s.desc, s.param)};
  }

  const inherent = [4, 5].map(id => ({
    name: String(tree[id].skill.name || ""),
    blocks: toBlocks(tree[id].skill.desc, tree[id].skill.param)
  }));

  const chain = chainIds.map(n => ({
    n,
    name: String(detail.chains[n].name || ""),
    blocks: toBlocks(detail.chains[n].desc, detail.chains[n].param)
  }));

  const x = tree[17].skill;
  const extra = isTuneBreak(x.name) ? [] : [{
    kind: "Forte Circuit",
    name: String(x.name || ""),
    blocks: toBlocks(x.desc, x.param)
  }];

  return {
    slug: slug(detail.name),
    skills, inherent, chain,
    ...(extra.length ? {extra} : {})
  };
}

(async function main() {
  const page = await getText(SITE);
  const build = (page.match(/static\.nanoka\.cc\/ww\/([0-9][0-9.]*)\//) || [])[1];
  if (!build) throw new Error("no build version in the source page — the site layout changed");
  console.log(`beta build ${build}\n`);

  const [cWeapons, cChars, cSonata] = await Promise.all([
    getJSON(`${BASE(build)}/weapon.json`),
    getJSON(`${BASE(build)}/character.json`),
    getJSON(`${BASE(build)}/sonata.json`)
  ]);
  console.log(`client tables: ${Object.keys(cWeapons).length} weapons, ` +
    `${Object.keys(cChars).length} characters, ${Object.keys(cSonata).length} sonata sets`);

  /* A table that came back short is a fetch that half worked, and writing the
     difference out would read on the desk as Kuro having deleted a hundred
     weapons. */
  if (Object.keys(cWeapons).length < 100 || Object.keys(cChars).length < 50)
    throw new Error("client tables came back short — refusing to write");

  const shippedWeapons = JSON.parse(await readFile("data/weapons.json", "utf8")).weapons || [];
  const shippedEchoes = JSON.parse(await readFile("data/echoes.json", "utf8"));
  const roster = JSON.parse(await readFile("data/resonators.json", "utf8")).resonators || [];

  const haveWeapon = new Set(shippedWeapons.map(w => norm(w.name)));
  const haveSonata = new Set((shippedEchoes.sonata || [])
    .flatMap(s => [norm(s.name), norm(s.alias)]).filter(Boolean));
  const haveResonator = new Set(roster.map(r => rosterKey(r.name)));
  /* Keyed the tolerant way, because none of these three files spell a name
     quite the same: the client files say "Rover: Electro" and "Shorekeeper"
     where kits.json says "Rover (Electro)" and the roster says "The
     Shorekeeper". On an exact match every Rover reads as a Resonator nobody
     has ever written a kit for. */
  const haveKit = new Set(Object.keys(
    JSON.parse(await readFile("data/kits.json", "utf8")).kits || {}).map(rosterKey));
  /* The roster's spelling of a name, which is the one app.js looks a kit up
     by — and the one thing that collapses the client's two rows per Rover
     element down to the single record the desk holds. */
  const rosterName = new Map(roster.map(r => [rosterKey(r.name), r.name]));

  /* ── weapons the live sources have no row for ─────────────────── */
  const weapons = [];
  const varied = [];
  for (const [id, w] of Object.entries(cWeapons)) {
    if (isProjection(id) || haveWeapon.has(norm(w.en))) continue;

    const detail = await getJSON(`${BASE(build)}/en/weapon/${id}.json`);
    const stats = maxLevelStats(detail) || [];
    const atk = stats.find(s => s.name === "ATK");
    const sub = stats.find(s => s.name !== "ATK");

    const passive = resolvePassive(detail.effect, detail.param);
    if (passive.varied) varied.push(w.en);

    weapons.push({
      name: String(detail.name || w.en),
      rarity: Number(detail.rarity) || Number(w.rank) || 0,
      type: WCLASSES[detail.type] || WCLASSES[w.type] || "",
      id: String(id),
      /* The client's own rounding, not Prydwen's truncation — see the header. */
      atk90: atk ? Math.round(Number(atk.value)) : 0,
      stat: sub ? statName(sub.name) : "",
      statValue90: sub ? pct(sub) : 0,
      /* Where a shipped weapon's `source` says which convene pool it drops
         from. That is not knowable yet, and saying so is more use than an
         empty chip. */
      source: "Beta client files",
      /* The passive's own name, which the client carries and Prydwen's page
         does not. Kept because a beta weapon has no icon on the desk and no
         convene history, so the record is thin without it — and because it is
         the one thing on the record that is not a number. */
      effectName: String(detail.effect_name || ""),
      effect: passive.effect,
      ranks: rankTable(passive.effect, detail.param)
    });
    console.log(`  weapon  ${w.en} — ${detail.rarity}★ ${WCLASSES[detail.type] || "?"}`);
  }

  /* ── sonata sets the live sources have no row for ─────────────── */
  const sonata = [];
  for (const s of Object.values(cSonata)) {
    const name = s.name?.en;
    if (!name || haveSonata.has(norm(name))) continue;
    sonata.push({
      id: Number(s.id),
      name,
      slug: String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      pieces: Object.entries(s.set || {})
        .map(([n, v]) => ({n: Number(n), text: bonusText(v.en?.desc, v.en?.param)}))
        .filter(p => p.text)
        .sort((a, b) => a.n - b.n),
      alias: null
    });
    console.log(`  sonata  ${name}`);
  }

  /* ── kits for the Resonators no live source has written up ────── */
  const kits = {};
  const kitFails = [];
  const extraKept = [];
  for (const [id, c] of Object.entries(cChars)) {
    /* On the roster, so the desk knows who they are, and with no kit from
       prydwen.gg or the wiki. That is exactly the unshipped ones — the moment
       either source writes a page, fetch-kits.mjs fills the slot and this
       stops producing a record for them. */
    const key = rosterKey(c.en);
    if (!c.en || !haveResonator.has(key) || haveKit.has(key) || kits[rosterName.get(key)]) continue;
    const name = rosterName.get(key);
    try {
      const detail = await getJSON(`${BASE(build)}/en/character/${id}.json`);
      const kit = buildKit(detail);
      kits[name] = kit;
      if (kit.extra) extraKept.push(`${name} (${kit.extra[0].name})`);
      const lines = [...Object.values(kit.skills), ...kit.inherent, ...kit.chain]
        .reduce((a, g) => a + g.blocks.reduce((b, x) => b + x.p.length, 0), 0);
      console.log(`  kit     ${name} — 6 skills, 2 inherent, 6 chain, ${lines} paragraphs`);
    } catch (e) {
      /* A tree this does not recognise is a layout change, and filing its
         nodes under the wrong headings would be worse than having no kit —
         the record already knows how to say it has none. */
      kitFails.push(`${name}: ${e.message}`);
    }
  }

  /* ── everything else, reported and not written ────────────────── */
  const resonators = Object.values(cChars)
    .filter(c => c.en && !haveResonator.has(rosterKey(c.en)))
    /* The client carries two rows for each Rover element and the roster
       carries one, and one of the two always matches by name. */
    .filter((c, i, a) => a.findIndex(x => rosterKey(x.en) === rosterKey(c.en)) === i)
    .map(c => ({
      name: c.en,
      rarity: Number(c.rank) || 0,
      attribute: ELEMENTS[c.element] || null,
      weapon: WCLASSES[c.weapon] || null,
      epithet: c.nickname || "",
      summary: String(c.desc || "").replace(/<[^>]*>/g, "")
    }));

  const payload = {
    schema: "wuwa-desk/clientfiles@1.0",
    note:
      "What the beta client's data tables carry that no live source does yet. Every record here is " +
      "datamined: real client numbers, taken before Kuro has finished balancing them, and subject to " +
      "change or to being cut before the patch ships. Nothing in this file is ever merged into " +
      "weapons.json or echoes.json — those are rebuilt wholesale from live sources and would drop it " +
      "on the next run — so app.js merges it at read time and marks every record it draws from here. " +
      "A record the live sources already carry is dropped rather than written, whatever the beta says " +
      "about it: post-balance numbers win. `resonators` is a report rather than data — a character in " +
      "the client files with no roster record is something for a person to write up, not for a fetcher " +
      "to file. Base ATK is the client's own rounding of a level-90 figure that ends in .5, which is " +
      "why it can read one higher than prydwen.gg's truncation of the same number.",
    credit: "Client data tables via nanoka.cc · © Kuro Games",
    source: SITE,
    build,
    weapons,
    sonata,
    resonators
  };

  let unchanged = false;
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    unchanged = prev.build === build && prev.note === payload.note
      && JSON.stringify(prev.weapons) === JSON.stringify(weapons)
      && JSON.stringify(prev.sonata) === JSON.stringify(sonata)
      && JSON.stringify(prev.resonators) === JSON.stringify(resonators);
  } catch {}
  if (!unchanged)
    await writeFile(OUT, JSON.stringify({...payload, updated: new Date().toISOString()}, null, 2) + "\n");

  const kitPayload = {
    schema: "wuwa-desk/clientkits@1.0",
    note:
      "Kit text for the Resonators no live source has written up yet, read out of the beta client's " +
      "own skill trees. Same six skills, two Inherent Skills and six Resonance Chain nodes that " +
      "kits.json stores, in the same shape and with the same **bold** and __underline__ markers, so " +
      "app.js can draw one without knowing where it came from — plus the sub-ability headings the " +
      "client writes and prydwen.gg flattens away. Never merged into kits.json: that file is filled " +
      "by prydwen.gg and the wiki, and the moment either writes a page for one of these, this record " +
      "should lose to it. Numbers are the client's, taken before Kuro has finished balancing them. " +
      "The Tune Break node every Resonator carries is dropped — it is one paragraph about Off-Tune " +
      "Level, identical between everyone who holds the same weapon class, and it describes the class " +
      "rather than the character.",
    credit: "Kit text via nanoka.cc's datamine of the beta client · skills © Kuro Games",
    source: SITE,
    build,
    kits
  };

  let kitsUnchanged = false;
  try {
    const prev = JSON.parse(await readFile(KIT_OUT, "utf8"));
    kitsUnchanged = prev.build === build && prev.note === kitPayload.note
      && JSON.stringify(prev.kits) === JSON.stringify(kits);
  } catch {}
  if (!kitsUnchanged)
    await writeFile(KIT_OUT, JSON.stringify({...kitPayload, updated: new Date().toISOString()}, null, 2) + "\n");

  console.log(
    `\n${weapons.length} unshipped weapons, ${sonata.length} unshipped sonata sets, ` +
    `${Object.keys(kits).length} unwritten kits` +
    (unchanged && kitsUnchanged ? " (unchanged)" : ""));
  if (kitFails.length) console.log(`kit refused: ${kitFails.join("; ")}`);
  /* Only the exception is worth a line. Almost every Resonator's extra slot is
     the shared Tune Break node and gets dropped; one that holds something else
     is a Forte Circuit the desk is now carrying. */
  if (extraKept.length) console.log(`extra passive kept: ${extraKept.join(", ")}`);
  if (resonators.length)
    console.log(`in the client files with no roster record: ${resonators.map(r => r.name).join(", ")}`);
  else
    console.log(`roster is level with the ${build} client files`);
  if (varied.length)
    console.log(`passive count moves with ascension, plural assumed: ${varied.join(", ")}`);
})();

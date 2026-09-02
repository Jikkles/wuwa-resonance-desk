/* Resonance Desk — presentation layer.
   Reads data/*.json, renders seven views into one dashboard shell.
   No build step, no framework: render whole panels to innerHTML, bind by
   delegation, so a re-render never leaves a stale listener behind. */
"use strict";

/* Fallback data so the page still draws when opened straight off disk —
   browsers block file:// fetch. Over http, data/*.json wins. */
const FALLBACK = {
  versions:   {updated:"", current:"", versions:[]},
  news:       {updated:"", confidenceTiers:{}, entries:[]},
  resonators: {updated:"", resonators:[]},
  weapons:    {updated:"", weapons:[]},
  echoes:     {generated:"", sonata:[], echoes:[]},
  feed:       {fetched:"", sources:[], errors:[], items:[]},
  events:     {updated:"", events:[]},
  permanents: {updated:"", events:[]},
  archive:    {updated:"", versions:[]},
  items:      {items:{}},
  astrite:    {baseline:null, versions:{}},
  art:        {art:{}},
  portraits:  {characters:{}},
  translations: {titles:{}}
};

const TIERS = ["official","datamined","reported","rumour"];
const TIER_LABEL = {official:"Official", datamined:"Datamined", reported:"Reported", rumour:"Rumour"};
const TIER_MEANS = {
  official:  "Confirmed by Kuro",
  datamined: "Beta client data",
  reported:  "Leaker claim",
  rumour:    "Unverified"
};
const TIER_STRENGTH = {official:4, datamined:3, reported:2, rumour:1};
const TIER_CONF = {official:"Confirmed", datamined:"High", reported:"Medium", rumour:"Low"};

const KIND_LABEL = {official:"Official", video:"Video", community:"Community", press:"Press"};

/* A mark per fetcher, so the terminal reads as sources rather than a wall of
   names. Keyed on sourceId first — Google News carries a dozen different
   press outlets under one id — then by kind for anything unmapped. */
const SOURCE_ICON = {
  "kuro-en":"i-kuro", kurobbs:"i-kuro", youtube:"i-youtube",
  "reddit-leaks":"i-reddit", "reddit-main":"i-reddit",
  "google-news":"i-press", mmoculture:"i-press"
};
const KIND_ICON = {official:"i-kuro", video:"i-youtube", community:"i-comm", press:"i-press"};

/* Attribute drives each card's accent so a banner row reads at a glance. These
   six are Kuro's own — sampled off the client's attribute icons, the same
   artwork scripts/fetch-element-icons.mjs traces the glyphs from — rather than
   picked to sit on the desk's dark ground. A muted approximation of Aero reads
   as some other green next to the game, and the element is the one fact on a
   Resonator a reader already knows the colour of. */
const ATTR_COLOUR = {
  aero:"#55FFB5", glacio:"#41AEFB", fusion:"#F0744E",
  electro:"#B46BFF", spectro:"#F8E56C", havoc:"#E649A6"
};

/* The three rarity colours, the same three the Weapons page heads its tables
   in. They live in the stylesheet as --rar on .wpanel, and here as well because
   a weapon record with no element has to fall back to one inline — two thirds
   of the database is nobody's signature, and a record accented in the site
   accent says nothing about what you opened. Kept beside ATTR_COLOUR so the
   two lists that colour the desk are in one place.

   They used to be described as borrowed from the electro and glacio accents,
   which stopped being true when those took the client's own hexes. They are
   the gacha ramp on their own terms now — gold, purple, blue, the three the
   game prints a pull in — and deliberately quieter than an element, because a
   rarity heads a whole table where an element accents one record. */
const RAR_COLOUR = {5:"#E3AC55", 4:"#B98BE0", 3:"#78BFE8"};

/* Nav order, top to bottom and left to right, in one place: the rail, the tab
   strip, the mobile dock, the command palette and the ←/→ tab cycling all read
   this array. `soon` marks a view that is navigable but has no data behind it
   yet — it draws the work-in-progress panel and carries a badge instead of a
   count, so the promise is visible before you click rather than after.
   `short` is the dock's label; six items across a phone will not take
   "Live Signals". */
const VIEWS = [
  {id:"timeline",   label:"Timeline",     icon:"i-timeline"},
  {id:"resonators", label:"Resonators",   icon:"i-res"},
  {id:"weapons",    label:"Weapons",      icon:"i-weapon"},
  {id:"echoes",     label:"Echoes",       icon:"i-echo"},
  {id:"events",     label:"Events",       icon:"i-events"},
  /* Under Events, because it answers the other half of the same question. The
     Events view says what the patch pays; this says what the patch costs. */
  {id:"pulls",      label:"Pull calculator", icon:"i-pulls", short:"Pulls"},
  {id:"intel",      label:"Intel",        icon:"i-intel"},
  {id:"signals",    label:"Live Signals", icon:"i-signals", warn:"Unverified", short:"Signals"}
];

let DATA = {};
/* Primary axis per view lives in chips at the top of the panel; the secondary
   axes (ver/cat/weapon/src) are the quick-filter selects. All of them are one
   flat bag so a filter control never has to know which view it is in. */
const S = {
  view:"timeline", sigLimit:60, drawer:null,
  /* The open event record's pictures, and which one the frame is showing.
     Lives here rather than in the markup because the thumbnails repaint the
     frame in place — see paintReel. */
  reel:[], reelAt:0,
  /* Which rail item has its filter list unfolded. An accordion of one: opening
     a view opens its list and closes whatever was open, and clicking the view
     you are already on folds it away. Null is "all folded". */
  railOpen:"timeline",
  /* Skill cards open condensed — first sentence of every paragraph — and the
     toggle in the Skills header swaps them to the client's full text. A kit is
     five thousand words; the default has to be the one you can scan. */
  kitSimple:true,
  /* Which half of a Resonator record you are looking at — "kit" or "build".
     Unlike kitSimple and the two sliders, this one does NOT persist between
     records: every record opens on the kit and drawerResonator resets it. The
     kit is what the character *is* and the build is what somebody thinks you
     should do about it, so the record has to open on the first — a record that
     opens on advice is a record that has answered a question you did not ask
     yet. Kept on S rather than in the markup so the toggle survives the
     redraws that happen inside an open record. */
  rtab:"kit",
  /* Weapon ascension, 1–5. Not a filter — it doesn't change which weapons you
     can see, only what the passive says — so it sits outside VIEW_FILTERS and
     Reset leaves it alone. The stats never move with it: those are level 90,
     full stop. */
  rank:1,
  /* Echo rank, 1–5, and the same bargain as the ascension slider above: not a
     filter, so Reset leaves it alone, and it persists between one record and
     the next. It opens at 5 rather than at 1 because an echo's rank is its
     star rarity — everything anyone farms is rank 5, and rank 1 is a column of
     zeroes for two thirds of the roster. */
  erank:5,
  when:"all",   // timeline
  tier:"all",   // intel
  kind:"all",   // signals
  elem:"all",   // resonators
  wtype:"all",  // weapons
  /* Echoes. A sonata set id, or "all". Unlike every other filter on the desk
     this one is not drawn in the rail — the sonata index at the top of the
     view is the control, because the sets are the page's own headings and a
     34-item list in a 250px rail is not a filter anyone would use. */
  eset:"all",
  /* The pull calculator's whole form. It lives on S rather than being read off
     the inputs on every keystroke for one reason: the answer repaints while
     you are still typing in the box that changed it, and a repaint that
     replaced the input would take the caret with it. So the fields write here,
     only #pull-out is redrawn, and the form is left standing.
     Not persisted — nothing on the desk is, and a calculator that remembered
     an Astrite figure from three patches ago would be worse than an empty one.
     It does survive navigating away and back, because S does. */
  pull:{
    want:[],                 /* target keys, "r:<name>" and "w:<name>" */
    astrite:0, radiant:0, forging:0,
    pity:0, guaranteed:false, wpity:0
  }
};
/* Which of those a view actually reads — drives Reset, and stops a stale
   element filter from silently narrowing a list you have navigated away from. */
const VIEW_FILTERS = {
  timeline:["when"], intel:["tier"],
  signals:["kind"], resonators:["elem"],
  weapons:["wtype"], echoes:["eset"],
  /* Every view needs a row here even with nothing in it — filtersOn() and
     Reset both index this table unguarded. */
  events:[], pulls:[]
};

/* ── helpers ─────────────────────────────────────────────────────── */
const $  = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DAY = 86400000;

/* ── fit ─────────────────────────────────────────────────────────────
   Type that takes the room it is given and no more.

   Every size in the stylesheet is the size that suits the longest string that
   can land in that box, which makes it the wrong size for every other string:
   "Jinhsi" is set at the size "Yangyang: Xuanling" needed and sits in its card
   half empty. The cqi clamps answer one half of this — they know how wide the
   box turned out to be — but no clamp can know how long the name in it turned
   out to be, and length is the thing that actually decides whether a name fits.

   So the stylesheet goes on setting the base size, and this grows it from
   there. Mark an element data-fit and it may take up to 1.6x what the CSS gave
   it, settling on the largest size that still fits its box. A short name takes
   the whole allowance, a long one takes what the box leaves it, and nothing
   ever escapes, because the fit is measured rather than predicted from a
   character count and an assumed glyph width.

     data-fit="2"       a different ceiling.
     data-fit="1.6 .8"  a floor under the CSS size as well, for a box that must
                        not be overrun even when the base size overruns it.
     data-fit-lines="2" the box has no height of its own to overflow, so "fits"
                        means "wraps to no more than two lines" instead.
     data-fit-in=".x"   the type is not what gets clipped — a two-line name at
                        a bigger size is a taller name, and what falls off the
                        bottom is the chips under it. Fit is then a question
                        about the tile, so name the tile.

   Reads and writes run in lockstep across every marked element rather than one
   element at a time: all the sizes written, one reflow, all the fits read. Done
   per element it is a forced reflow each, and a banner row alone is thirty. */
const FIT_STEPS = 5;
const FIT_MAX = 1.6;

function fitBox(el, lines, box){
  if(el.scrollWidth > el.clientWidth + 1) return false;
  if(el.scrollHeight > el.clientHeight + 1) return false;
  if(lines){
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 0;
    if(lh && el.scrollHeight > lh * lines + 1) return false;
  }
  if(box && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) return false;
  return true;
}

function fitAll(root = document){
  const els = [...root.querySelectorAll("[data-fit]")];
  if(!els.length) return;

  /* Back to the CSS size before anything is measured. On a resize the base is
     a cqi clamp that has just resolved to a different number, and growing from
     the last pass's answer instead ratchets the type up again every time the
     window moves. */
  for(const el of els) el.style.fontSize = "";

  const jobs = els.map(el => {
    const [up, down] = String(el.dataset.fit || "").split(/[\s,]+/).map(Number);
    const base = parseFloat(getComputedStyle(el).fontSize) || 16;
    const lo = base * (down > 0 ? down : 1);
    return {
      el, lo, mid: lo, best: lo, done: false,
      hi: base * (up > 0 ? up : FIT_MAX),
      lines: Number(el.dataset.fitLines) || 0,
      box: el.dataset.fitIn ? el.closest(el.dataset.fitIn) : null
    };
  });

  /* The ceiling first. Most names clear it outright, and those want the
     ceiling itself rather than the number a halving converges towards. */
  for(const j of jobs) j.el.style.fontSize = `${j.hi}px`;
  for(const j of jobs) if(fitBox(j.el, j.lines, j.box)){ j.best = j.hi; j.done = true; }

  for(let i = 0; i < FIT_STEPS; i++){
    for(const j of jobs){
      if(j.done) continue;
      j.mid = (j.lo + j.hi) / 2;
      j.el.style.fontSize = `${j.mid}px`;
    }
    for(const j of jobs){
      if(j.done) continue;
      if(fitBox(j.el, j.lines, j.box)){ j.best = j.mid; j.lo = j.mid; }
      else j.hi = j.mid;
    }
  }
  /* Nothing fitted even at the floor keeps the floor — the box clips it, which
     is the same thing the stylesheet alone would have done. */
  for(const j of jobs) j.el.style.fontSize = `${j.best.toFixed(2)}px`;
}

/* Every caller wants the same thing — one pass, after the frame the new markup
   landed in — and several of them fire together on a single view change. */
let fitQueued = 0;
function fitSoon(){
  if(fitQueued) return;
  fitQueued = requestAnimationFrame(() => { fitQueued = 0; fitAll(); });
}

function attrStyle(a){
  const c = ATTR_COLOUR[String(a||"").toLowerCase()];
  return c ? ` style="--attr:${c}"` : "";
}
function fmtDate(d){
  if(!d) return "";
  const dt = new Date(d);
  return isNaN(dt) ? String(d)
    : dt.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
}
function fmtShort(d){
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
}
function fmtClock(d){
  const dt = new Date(d);
  if(isNaN(dt)) return "";
  const today = new Date();
  const sameDay = dt.toDateString() === today.toDateString();
  return sameDay
    ? dt.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})
    : fmtShort(dt);
}
function fmtTime(d){
  const dt = new Date(d);
  return isNaN(dt) ? "—" : dt.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
}
/* Every clock on the page is the reader's own local time, which is worth
   saying out loud on a site about a game with staggered regional maintenance —
   "22:04" means nothing until you know whose 22:04. */
function tzLabel(){
  const mins = -new Date().getTimezoneOffset();
  const h = Math.trunc(Math.abs(mins) / 60), m = Math.abs(mins) % 60;
  return `UTC${mins < 0 ? "−" : "+"}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}
/* Whole days from today to d. Negative once it's in the past. */
function daysTo(d){
  const dt = new Date(d);
  if(isNaN(dt)) return null;
  const a = new Date(); a.setHours(0,0,0,0);
  const b = new Date(dt); b.setHours(0,0,0,0);
  return Math.round((b - a) / DAY);
}
/* Third argument for the words an s does not pluralise. Only "echoes" needs it
   so far, and a table header that reads "34 echos" is the kind of thing a
   reader notices before anything else on the page. */
const plural = (n, w, many) => `${n} ${n === 1 ? w : (many || w + "s")}`;

/* ── data accessors ──────────────────────────────────────────────── */
const versions   = () => DATA.versions?.versions || [];
const entries    = () => DATA.news?.entries || [];
const resonators = () => DATA.resonators?.resonators || [];
const weapons    = () => DATA.weapons?.weapons || [];
/* The echo roster and the sonata sets it rolls, from one file. They are two
   lists and one subject: a sonata set with no echoes under it is a bonus
   nobody can build, and an echo with no set is a slot with no reason to be
   filled, so neither is worth loading without the other. */
const echoes     = () => DATA.echoes?.echoes || [];
const sonataSets = () => DATA.echoes?.sonata || [];
/* The event calendar. Named for the game's events, not the DOM's — this file
   already has an events section and it binds clicks.

   Two files behind it, because a permanent event is a different kind of fact
   from a limited one and comes from somewhere else. events.json is Kuro's own
   posts and covers what is running now; permanents.json is the wiki's list of
   everything with no closing date, going back to launch day, because Kuro's
   news feed stopped carrying those posts years ago. Merged here rather than at
   the two call sites so that a card, a record and a search all see one list.

   Where both files hold the same event — a patch's permanent addition, which
   Kuro announced in an overview this desk still reads — Kuro's own entry is
   the one that survives, and takes the wiki's banner if it hasn't got one of
   its own. Kuro's words about a Kuro event, the only picture anyone has.

   The wiki fills blanks and never overwrites, same rule confirm-dates.mjs
   works to. Kuro's overview dates a permanent addition as "after the version
   update" and the desk resolves that to nothing; the wiki has the day it
   opened, to the minute, so a record that would have said "no closing date"
   and stopped can say when it arrived instead. */
const eventKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const gameEvents = () => {
  const perm = new Map((DATA.permanents?.events || []).map(e => [eventKey(e.name), e]));
  const kuro = (DATA.events?.events || []).map(e => {
    const p = perm.get(eventKey(e.name));
    if(!p) return e;
    perm.delete(eventKey(e.name));
    return {...e, permanent:true, art:e.art || p.art, start:e.start || p.start};
  });
  return [...kuro, ...perm.values()];
};

/* ── the archive ─────────────────────────────────────────────────────
   data/archive.json, written by scripts/fetch-archive.mjs off the wiki: every
   patch the game has shipped, its name, its window, and what ran in it. The
   desk's own two calendars reach as far back as Kuro's news feed does, which is
   a hundred days, and no further — this is the record behind them, and it is
   what the Timeline's Past window is made of.

   It is deliberately thin. No art, no blurb, no reward lines: a patch that
   closed a year ago is not something you can act on, and the question it
   answers — what was 2.3 — is a list of names and dates. The live patch and the
   one before it are in events.json with Kuro's own pictures, and where both
   hold the same event the desk's own record wins. See patchEvents(). */
const archive   = () => DATA.archive?.versions || [];
const archiveOf = id => archive().find(v => v.id === id) || null;

/* Every convene that ran in a patch, read out of the resonators rather than off
   the timeline. versions.json carries phases for the two or three patches it is
   watching; resonators.json carries every run every character has ever had,
   which is the same history from the other end and reaches launch day. The same
   trick weaponRuns() plays to give a 1.0 weapon a convene history. */
function patchBanners(id){
  const out = [];
  /* One row per character, not one per run. A 4-star is featured in both halves
     of a patch, so its run history carries two rows for the same version, and
     an undeduped strip drew Chixia three times in a line. The archive row
     answers "who ran in 2.6", which is a set. */
  const seen = new Set();
  for(const r of resonators())
    for(const run of r.runs || [])
      if(run.version === id && !seen.has(r.name)){
        seen.add(r.name);
        out.push({
          name:r.name, attribute:r.attribute, weapon:r.weapon, rarity:r.rarity,
          convene:run.convene, start:run.start, end:run.end,
          /* A debut is a run in the patch the character was released in. */
          new: run.version === r.version, rerun: run.version !== r.version
        });
      }
  return out;
}

/* Those runs grouped back into the patch's phases. A phase is a window, so two
   characters sharing a window are in the same half of the patch — which is the
   only definition available this far back and also the correct one: it is what
   a phase is. */
function patchPhases(id){
  const rows = new Map();
  for(const b of patchBanners(id)){
    const key = `${b.start || ""}|${b.end || ""}`;
    if(!rows.has(key)) rows.set(key, {start:b.start, end:b.end, banners:[]});
    rows.get(key).banners.push(b);
  }
  return [...rows.values()]
    .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")))
    .map((p, i) => ({...p, n:i + 1}));
}

/* A patch versions.json has never heard of, in the shape the version drawer
   reads. That file holds three; the archive holds twenty-one, and the eighteen
   that exist only there still have to open when their row is clicked. */
function archivePatch(id){
  const a = archiveOf(id);
  if(!a) return null;
  return {
    id:a.id, title:a.title, start:a.start, end:a.end,
    /* The patch's own key art, read out of Kuro's patch notes by
       scripts/fetch-archive.mjs. It arrives in the same shape versions.json
       uses for the live patch, so the record draws it with the same branch and
       an archived patch stops being the one that has no picture. */
    keyVisual:a.keyVisual || null,
    phases:patchPhases(id), source:a.source, notice:a.notice, archived:true
  };
}

/* Everything that ran in a patch, the desk's own records first. gameEvents()
   has Kuro's words and Kuro's pictures and reaches back a hundred days; the
   archive has names and dates and reaches to launch. Where both hold the same
   event the desk's own wins and the archive fills in behind it. */
function patchEvents(id){
  const own = gameEvents().filter(e => e.version === id);
  const seen = new Set(own.map(e => eventKey(e.name)));
  return [...own, ...(archiveOf(id)?.events || []).filter(e => !seen.has(eventKey(e.name)))];
}
const signals    = () => [...(DATA.feed?.items || [])].sort((a,b) => (b.date||"").localeCompare(a.date||""));

/* Signals arrive in whatever language the source publishes in — about a fifth
   of them are Kurobbs CN. feed.json is machine-written and replaced every six
   hours, so the English lives in translations.json keyed by URL, and the
   original stays one hover away. Untranslated items show as published. */
function headline(i){
  const en = DATA.translations?.titles?.[i.url];
  return en ? {text:en, original:i.title, translated:true} : {text:i.title, original:"", translated:false};
}

/* A patch's own dates, read raw — no inference, no reference to any other
   version. statusOf() needs a window before the statuses exist, so this one
   cannot be patchWindow(): that fills a missing end from the *next* version,
   which is a question about statuses, and asking it here would close a loop. */
function versionWindow(v){
  const last = (v?.phases || []).slice(-1)[0];
  return {
    start: v?.start || last?.start || "",
    end:   last?.end || "",
    est:   !!last?.estimated_end
  };
}

/* `status` in versions.json used to be hand-set, which meant the desk called
   3.5 current until someone edited a string — at midnight, on the day a patch
   drops, which is the one moment the timeline is actually being read. The
   dates were already sitting in the same object saying otherwise, so the
   string was a second copy of a fact the file already carried, and the copy
   went stale. Now it is derived, and the JSON's own value survives only where
   arithmetic has nothing to say.

   Two rules, and the split between them is the desk's usual one — a date is a
   fact, a tier is a judgement:

   - **Live and past are computed.** Both are pure date arithmetic against
     today, so they flip on the reader's own midnight with no commit, no bot
     and no six-hour cron lag.
   - **Beta is never upgraded.** `beta` → `announced` means "Kuro has announced
     this", which is a confidence call on a par with the intel tiers, and no
     amount of arithmetic earns it. A beta patch with a projected start stays
     beta until a human says otherwise — then flips itself on the day.

   A patch retires on the firmer of two signals: a later version has actually
   started, or its own *confirmed* end has passed. An estimated end never
   retires anything — 3.6's phase 2 end is a guess, and a guess that runs short
   must not blank the timeline mid-patch. So a patch outstaying its estimate
   keeps the lights on until its successor turns up, which is both the safer
   failure and the likelier truth. */
function statusOf(v){
  if(!v) return "";
  const {start, end, est} = versionWindow(v);
  if(!start) return v.status || "";                    /* undated — 3.7 stays beta */
  if(daysTo(start) > 0) return v.status === "beta" ? "beta" : "announced";
  const superseded = versions().some(o =>
    o !== v && o.start && cmpVer(o.id, v.id) > 0 && daysTo(o.start) <= 0);
  if(superseded) return "past";
  if(end && !est && daysTo(end) < 0) return "past";
  return "live";
}

const liveVersion   = () => versions().find(v => statusOf(v) === "live");
const nextVersion   = () => versions().find(v => statusOf(v) === "announced");
const futureVersion = () => versions().find(v => statusOf(v) === "beta");

/* The patch running now, by number. `current` in versions.json is the same
   fact as "which version is live", so it is read off the live patch and the
   file's own field is only a fallback for a desk with no dated versions at
   all. It drives the New/Upcoming flags on all sixty resonator cards, so
   letting it drift from the timeline used to mis-flag the whole grid.

   The middle term matters more than it looks. If a patch has a confirmed end
   that has passed and no successor has been added yet, statusOf() retires it
   and there is no live version — and falling straight to the file's field
   there would answer with the patch *before* it, walking the whole grid's
   flags backwards a version. The newest patch that has actually started is
   never wrong in that direction, and it is the same rule deriveCurrent() in
   scripts/fetch-kits.mjs uses to decide when a kit becomes official. */
const currentVersion = () =>
  liveVersion()?.id
  || [...versions()]
       .filter(v => { const s = versionWindow(v).start; return s && daysTo(s) <= 0; })
       .sort((a, b) => cmpVer(b.id, a.id))[0]?.id
  || DATA.versions?.current || "";

function resonatorFor(name){
  const k = String(name||"").toLowerCase();
  return resonators().find(r => r.name.toLowerCase() === k) || {};
}
function artFor(name){ return (DATA.art?.art || {})[name] || null; }

/* Cut-outs, as opposed to artFor()'s posters. Kuro's reveal art is a 1080x1920
   marketing card — logo band, name plate, its own backdrop — which is the right
   picture at 400px and the wrong one at 54px, where you get a tiny poster
   instead of a face. portraits.json holds the character cut out of any backdrop
   at two sizes — `icon` for a tile, `card` waist-up — so a tile shows the
   character and nothing else: no plate, no second background inside the
   card's. See scripts/fetch-portraits.mjs. */
/* Kit text is a megabyte — six skills, two Inherent Skills and six Resonance
   Chain nodes for sixty Resonators, in full. That is ten times the rest of the
   desk put together, and on a first visit to the timeline none of it gets
   read, so it is the one file not in the boot set. The first record you open
   fetches it; every record after that is instant, and the promise is cached
   rather than the result so opening two in quick succession still fetches
   once. Nothing here blocks: the record draws immediately and the kit fills
   in underneath it. */
let KITS = null, kitsInFlight = null;
function loadKits(){
  if(KITS) return Promise.resolve(KITS);
  if(!kitsInFlight) kitsInFlight = load("kits").then(d => (KITS = d?.kits || {}));
  return kitsInFlight;
}
function kitFor(name){
  if(!KITS) return null;
  const k = String(name||"").toLowerCase();
  return KITS[name] || Object.entries(KITS).find(([n]) => n.toLowerCase() === k)?.[1] || null;
}

/* Builds and teams, on the same terms as the kit and for the same reason: a
   third of a megabyte that nobody arriving at the timeline reads, wanted only
   once a record is open. The first record you open fetches it and every one
   after that is instant.

   It is also the one file on the desk that is somebody's opinion rather than a
   record — which sonata set to farm, what to put in the main slot, who to
   build a team around. That is why it is a file of its own rather than more
   fields on resonators.json, and why every panel drawn from it carries
   Prydwen's name and the game version their write-up was last revised
   against. See scripts/fetch-builds.mjs. */
let BUILDS = null, buildsInFlight = null;
function loadBuilds(){
  if(BUILDS) return Promise.resolve(BUILDS);
  if(!buildsInFlight) buildsInFlight = load("builds").then(d => (BUILDS = d?.builds || {}));
  return buildsInFlight;
}
function buildFor(name){
  if(!BUILDS) return null;
  const k = String(name||"").toLowerCase();
  return BUILDS[name] || Object.entries(BUILDS).find(([n]) => n.toLowerCase() === k)?.[1] || null;
}

function portraitFor(name){ return (DATA.portraits?.characters || {})[name] || null; }
/* The weapon database, by name. Case-insensitive, because a weapon's name
   reaches this from three different hand-written places — a banner row's
   `signature`, a resonator record's, and the palette — and one of them will
   eventually disagree about a capital. */
function weaponFor(name){
  const k = String(name||"").toLowerCase();
  return weapons().find(w => w.name.toLowerCase() === k) || null;
}
/* Kept as its own name because half the desk asks this the narrow way: a tile
   only wants the picture and the rarity, and doesn't care that the record
   behind it now carries stats and a passive too. */
const weaponArtFor = weaponFor;

/* Echoes are addressed by name like everything else on the desk, because a
   name is what the palette matches and what a link between two records is
   written in. The id is in the record and is only the icon's filename.

   Two of them differ by nothing a lowercase comparison can see — Jué and Jue
   do not both exist, but "Fog Lionarch" and "Fog Lionarch: Head" do, and an
   accidental prefix match would open the wrong one — so this is an equality
   test and never a startsWith. */
function echoFor(name){
  const k = String(name||"").toLowerCase();
  return echoes().find(e => e.name.toLowerCase() === k) || null;
}
/* A sonata set by its id, which is what an echo record carries, or by its name,
   which is what a link and the palette carry. One lookup for both: the two
   never collide, because an id is a number and a name is not. */
function sonataFor(key){
  if(key == null) return null;
  const n = Number(key);
  if(Number.isFinite(n) && String(key).trim() !== "")
    return sonataSets().find(s => s.id === n) || null;
  const k = String(key).toLowerCase();
  return sonataSets().find(s =>
    s.name.toLowerCase() === k || String(s.alias || "").toLowerCase() === k) || null;
}
/* Every echo that can roll a set, in the order the grid shows them. The set
   record has no list of its own — the link is written on the echo, once, which
   is the direction the source publishes it in and the only direction that
   cannot go stale against itself. */
const echoesInSet = id => echoes().filter(e => (e.sonata || []).includes(Number(id)));

/* Whose signature a weapon is. The resonator records carry the link in that
   direction, so this is that map read backwards, falling back to the timeline's
   banner rows for a weapon whose holder hasn't got a record yet. */
function sigHolderFor(name){
  const k = String(name||"").toLowerCase();
  return resonators().find(r => String(r.signature||"").toLowerCase() === k)?.name
    || allWeapons().find(w => w.name.toLowerCase() === k)?.holder
    || "";
}
/* Both of these used to name the site the picture was resolved from. The
   copyright is the part that has to be on the page; which fan wiki the file
   came through is bookkeeping, and it was sitting under every portrait on the
   desk. The README still records where the art pipeline reads from. */
const PORTRAIT_CREDIT = "Character art © Kuro Games";

/* Banner rows carry framing hints for the shared key visual, so a resonator
   card can borrow the crop its banner row already defines. */
function bannerFor(name){
  const k = String(name||"").toLowerCase();
  for(const v of versions())
    for(const p of v.phases || [])
      for(const b of p.banners || [])
        if(b.name.toLowerCase() === k) return {...b, phase:p.n, keyVisual:v.keyVisual, version:v.id};
  return null;
}
const newsFor = id => entries().filter(e => e.version === id)
  .sort((a,b) => (b.date||"").localeCompare(a.date||""));

/* Intel entries carry no art of their own, and none is invented for them: a
   row borrows a face the desk already holds, when one of its tags names a
   resonator with art. Only then — the version key visual was tried here first
   and made eight consecutive rows show the same washed-out crop, which is
   decoration pretending to be information. Everything else gets a plate. */
function intelArt(e){
  for(const t of e.tags || []){
    const r = resonatorFor(t);
    if(r.name){
      const f = figure({name:r.name, ...(bannerFor(r.name) || {})});
      if(f.image) return {url:f.image, poster:f.poster, cutout:f.cutout, alt:r.name};
    }
  }
  return null;
}

/* A banner's signature weapon. Kuro runs the weapon convene alongside the
   character one, so it belongs beside the character on the card. Already in
   the data as `signature` — on the banner row first, falling back to the
   resonator record. A banner with neither shows no weapon rather than a
   guessed one. */
const signatureFor = b => b.signature || resonatorFor(b.name).signature || "";

/* Everywhere a weapon runs. Reruns mean the same weapon comes back with its
   character, so this is a list, not a single hit. */
function weaponRuns(name){
  const k = String(name||"").toLowerCase();
  const out = [];
  const seen = new Set();
  /* One row per version per character. The timeline is richer where it
     reaches — it knows the phase and whether the patch is live — so it goes
     first and wins the key. */
  const add = r => {
    const id = `${r.version}|${r.name}`;
    if(seen.has(id)) return;
    seen.add(id);
    out.push(r);
  };
  for(const v of versions())
    for(const p of v.phases || [])
      for(const b of p.banners || [])
        if(signatureFor(b).toLowerCase() === k)
          add({...b, phase:p.n, version:v.id, start:p.start, end:p.end, status:statusOf(v)});
  /* versions.json only carries the arc the desk is currently watching — two
     patches — so on its own it makes every weapon older than that a dead end,
     and the signature weapon card on a 1.0 Resonator's record links nowhere.
     The Resonator's own run history goes back to launch, and a weapon convene
     runs beside the character banner, so it is the same list read from the
     other end. */
  for(const r of resonators())
    if(String(r.signature || "").toLowerCase() === k)
      for(const run of r.runs || [])
        add({
          name:r.name, attribute:r.attribute, weapon:r.weapon,
          version:run.version, convene:run.convene, start:run.start, end:run.end,
          new: run.version === r.version
        });
  return out.sort((a, b) => cmpVer(b.version, a.version));
}

/* Every distinct signature weapon the timeline knows about, for the palette. */
function allWeapons(){
  const seen = new Map();
  for(const v of versions())
    for(const p of v.phases || [])
      for(const b of p.banners || []){
        const s = signatureFor(b);
        if(s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), {name:s, holder:b.name, version:v.id});
      }
  return [...seen.values()];
}

/* When the desk last wrote anything about this resonator — read off the intel
   entries tagged with their name, so it reports desk activity rather than the
   JSON's mtime. A record nobody has learned anything new about doesn't get a
   fresh date just because the file was touched. */
function lastIntelFor(name){
  const k = String(name||"").toLowerCase();
  return entries()
    .filter(e => (e.tags || []).some(t => String(t).toLowerCase() === k))
    .map(e => e.date).sort().pop() || "";
}

const tierCounts = () => entries().reduce((a,e) => (a[e.confidence] = (a[e.confidence]||0)+1, a), {});

/* When a patch runs, start to finish. The end is the last phase's end date if
   we have one; failing that, a live patch ends when the next one starts, which
   is an inference and is flagged as one. One definition, because the HUD, the
   patch card and the progress track all have to agree on the same number. */
function patchWindow(v){
  if(!v) return null;
  const last = (v.phases || []).slice(-1)[0];
  const start = v.start ? new Date(v.start) : last?.start ? new Date(last.start) : null;
  let end = last?.end ? new Date(last.end) : null;
  let est = !!last?.estimated_end;
  if(!end && statusOf(v) === "live"){
    const n = nextVersion();
    if(n?.start){ end = new Date(n.start); est = true; }
  }
  return start && end && end > start ? {start, end, est} : null;
}

/* ── shared fragments ────────────────────────────────────────────── */
function icon(id, size = 14){
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><use href="#${id}"/></svg>`;
}
function tierBadge(tier, solid){
  const t = TIERS.includes(tier) ? tier : "rumour";
  return `<span class="tier t-${t}${solid ? " solid" : ""}"><i class="dot"></i><span>${TIER_LABEL[t]}</span></span>`;
}
function confMeter(tier){
  const t = TIERS.includes(tier) ? tier : "rumour";
  const n = TIER_STRENGTH[t];
  return `<span class="conf t-${t}"><span class="k">Confidence</span>
    <span class="meter">${[1,2,3,4].map(i => `<i class="${i<=n?"on":""}"></i>`).join("")}</span>
    <b>${TIER_CONF[t]}</b></span>`;
}

/* Identity and kit confirm independently — Kuro announces who a character is
   long before their numbers stop moving in the beta. An unlabelled badge on a
   card reads as a verdict on the whole character, which is how a confirmed
   Resonator ends up looking like a rumour. Always say which claim it covers. */
function confidenceRows(r){
  const id = r.confidence?.identity;
  const kit = r.confidence?.kit;
  /* Two ways to have a kit on file: the full skill breakdown in kits.json, or
     the desk's own written notes for someone whose skills aren't published
     yet. `hasKit` is a flag on the index rather than a lookup, because the kit
     file is loaded on demand and a card must not have to wait for it. */
  const known = r.hasKit || r.kit?.length;
  return `<div class="ctiers">
    ${id ? `<div><span class="label">Identity</span>${tierBadge(id, id === "official")}</div>` : ""}
    <div><span class="label">Kit</span>${known
      ? tierBadge(kit, kit === "official")
      : `<span class="pill">Not published</span>`}</div>
  </div>`;
}

/* Resolve the best available image for a banner row or resonator.
   Precedence: hand-set image → waist-up card → reveal key art → crop of the
   patch key visual → typographic plate.

   The 2048px gallery illustration used to sit at the top of this list, for the
   sharpness: the card is 374px wide and gets stretched across a 360px panel.
   It was the wrong trade. Prydwen only holds a standing render for a character
   in the window before they release — after that the slot is swapped for the
   Resonance Liberation splash, which is a composition rather than a portrait
   and gets dropped — so the picture a character was drawn with changed
   underneath them on release day, and at any moment the newest six on the desk
   were the six framed differently from the other fifty. It is a full-body
   square besides, so every frame that used it had to zoom back in to find a
   face: 1.3x on a record, 1.86x in the drawer, 1.92x on a patch card, each one
   tuned by hand. The waist-up card is already cropped to the picture the desk
   wants, it is the same picture for every character, and it never changes. */
function figure(b){
  const r = resonatorFor(b.name);
  const art = artFor(b.name);
  const port = portraitFor(b.name);
  const own = b.image || r.image;
  /* Last in the list, so it resolves only when everything above it missed —
     including the card. The framing hints on a banner row are cut for one
     picture, the patch key visual, and they are numbers like `scale(1.72)` at
     `left 50%`: correct on the 16:9 group shot they were measured against, and
     on a waist-up portrait they walk the character clean off the panel. So the
     hints and the picture they were written for stand or fall together, and a
     row keeps its `keyVisual*` keys harmlessly once Prydwen lists the
     character — which is the point of them dropping out on their own. */
  const shared = !own && !art && !port?.card && b.keyVisual && b.keyVisualFocus ? b.keyVisual : null;
  /* The waist-up card now outranks Kuro's reveal poster, where it used to sit
     below it. The poster is the one picture on the desk that is not a cut-out —
     logo band, name plate, its own painted backdrop — so the eight characters
     who had one were the eight who looked like they belonged to a different
     site, standing in boxes in a grid where everyone else stands on the card.
     Sharpness was the argument for the poster and it is real; consistency wins
     it, because a record grid is read across, not one card at a time. The
     poster stays as the fallback for anyone Prydwen has no portrait for at all,
     and its epithet and credit are still read off it either way. */
  const image = own || port?.card || art?.url || shared?.url;
  const cutout = (!!own && image === own && (b.imageStyle || r.imageStyle) === "cutout")
              || (!!port && image === port.card);
  /* A 16:9 key visual in a 4:5 box has no vertical overflow, so object-position
     can only frame horizontally — zoom picks the height. */
  const style = shared
    ? ` style="object-position:${esc(b.keyVisualFocus)};transform:scale(${Number(b.keyVisualZoom)||1});transform-origin:${esc(b.keyVisualOrigin||"50% 50%")}"`
    : "";
  return {
    image, cutout, style,
    /* What a 54px tile shows, when we hold one. Resolved separately from the
       big picture above so the two never have to compromise on one crop. */
    icon: port?.icon || null,
    glyph: r.nameCN || b.name?.slice(0,1) || "?",
    /* A hand-set `imageCredit` is credited whatever the picture is. This used to
       be gated behind `cutout` along with the portrait credit, which was right
       for the portraits — the credit line names Prydwen, and it should not be
       named for a file that came from somewhere else — and wrong for the two
       drip cards the desk rehosts, which are Kuro's own marketing art sitting
       uncredited on the only page that shows them. The gate belongs on the
       fallback, not on the override. */
    credit: own && image === own ? (b.imageCredit || r.imageCredit || null)
          : cutout ? PORTRAIT_CREDIT
          : null,
    source: art && image === art?.url ? art : shared,
    shared: !!shared,
    /* Kuro's Profile Reveal posters are a fixed 1080x1920 template — logo top,
       name plate bottom, face around a fifth of the way down. Flagging them
       lets the small thumbnails crop to the head instead of shrinking the
       whole poster to 38px. */
    poster: !!art && image === art.url,
    epithet: art?.epithet || ""
  };
}

/* Full-size art panel, shared by character cards, resonator records and the drawer. */
function artPanel(b, extra = ""){
  const f = figure(b);
  const cls = f.cutout ? " has-cutout" : f.image ? " has-art" : "";
  /* A cut-out is alpha to its edges, so something has to stand behind it, and
     for a long time that was the card's flat tint — a character posed against
     nothing. The ground is now the same picture, blurred and enlarged: the
     patch cards already do this in `.fig-wash`, it is the same file so it
     costs no second request, and it is the only fill that can never disagree
     with the figure standing on it. Element-coloured light was the other
     candidate and is the wrong one, for the reason written on .fig-cell — it
     is colour the artist did not put there. */
  const wash = f.cutout
    ? `<img class="cwash" src="${esc(f.image)}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
    : "";
  const inner = f.image
    ? `${wash}<img src="${esc(f.image)}" alt="${esc(b.name)}" loading="lazy" decoding="async"${f.style}>`
    : `<span class="glyph">${esc(f.glyph)}</span>`;
  return `<div class="cart${cls}">${inner}${extra}</div>`;
}
function creditLine(b){
  const f = figure(b);
  if(f.credit) return `<div class="ccredit">${esc(f.credit)}</div>`;
  if(f.source) return `<div class="ccredit">${f.shared ? "Detail from" : "Key art"} ${esc(f.source.credit)} — ${esc(f.source.articleTitle || f.source.title || "")}</div>`;
  return "";
}

/* Banner thumbnail used inside the patch cards. `showWeapon:false` is for the
   paired layout, where the weapon class has moved onto the signature weapon's
   own row — a resonator's class and the class of the weapon running beside
   them are the same fact, and printing it twice was what pushed "RECTIFIER"
   onto a second line and made every tile in a column a different height. */
function thumb(b, {showWeapon = true, showPhase = true, showNew = false,
                   showAttr = true, fitName = true} = {}){
  const f = figure(b);
  const r = resonatorFor(b.name);
  const attr = b.attribute || r.attribute;
  const unknown = !b.name || b.name === "???";
  /* The cut-out bust first. It is drawn for exactly this size — head centred,
     background already gone — so it sits on the tile's own element gradient
     instead of bringing a second background along. Everything else here is a
     crop of something bigger and needs the framing hacks below. */
  const inner = f.icon
    ? `<img class="bust" src="${esc(f.icon)}" alt="" loading="lazy" decoding="async">`
    : f.image
    ? `<img class="${f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async"${f.style}>`
    : `<span class="g">${esc(unknown ? "?" : f.glyph)}</span>`;
  /* Only label new/rerun when the data actually says so — an unflagged banner
     row is unknown, not a rerun. */
  const fallback = b.new ? "New" : b.rerun ? "Rerun" : "";
  const weapon = b.weapon || r.weapon;
  /* The phase used to be stamped across the foot of the picture, which put a
     grey bar over the one part of a 54px tile worth looking at. It is metadata,
     so it goes where the rest of the metadata is — first in the row, because
     "which half of the patch" is what you scan a banner list for. */
  /* The card lists the whole patch, so some of these windows have closed. The
     chip says which, and greys itself when that phase is over — enough to stop
     a finished banner reading as one you can still pull, without dimming the
     character, who is no less part of the patch for it. */
  /* Off inside a phase column, where the column heading already says which
     phase this is and a chip on every tile would only repeat it five times. */
  const phase = showPhase && b.phase
    ? `<i class="ph${b.past ? " past" : ""}"${b.past ? ` title="Phase ${esc(b.phase)} has ended"` : ""}>P${esc(b.phase)}</i>`
    : "";
  /* A debut, marked on the tile. Grouping used to carry this — one column of
     new characters, one of reruns — and once the columns became phases the
     distinction had nothing left to ride on. Only debuts are marked: "new" is
     the exception worth flagging, and stamping RERUN on the other three tiles
     is three labels to say "ordinary". */
  const debut = showNew && b.new ? `<i class="new">New</i>` : "";
  /* The element as a word, which is not the same question as the element as a
     colour. The archive strip turns this off and keeps the tint: down a list of
     twenty patches the chip is the same six words repeated two hundred times,
     while the glow behind each face still says the same thing at a glance and
     costs no line. Everywhere else the word is what the row is scanned for. */
  const elem = showAttr && attr ? `<i class="attr">${esc(attr)}</i>` : "";
  const meta = b.rarity || attr
    ? `${phase}${debut}${b.rarity ? `<i class="rar">${esc(b.rarity)}★</i>` : ""}${elem}${
        weapon && showWeapon ? `<i class="wep">${esc(weapon)}</i>` : ""}`
    : `${phase}${debut}${fallback ? `<i class="rar">${fallback}</i>` : ""}`;
  /* Clickable in its own right, and the innermost [data-act] wins over the
     card's — so a face opens that resonator's record while the rest of the
     card still opens the version. This is the path to the full kit now that
     the landing view doesn't carry a screen of character panels. An unnamed
     banner has no record to open, so it stays inert. */
  const act = unknown ? "" : ` role="button" tabindex="0" data-act="resonator" data-id="${esc(b.name)}"`;
  /* Name and meta in their own box so the patch cards can set them beside the
     face instead of under it — one wide row per banner fills the column, where
     a centred stack left most of it empty. */
  return `<div class="bmini${unknown ? " unknown" : ""}"${attrStyle(attr)}${act}>
    <div class="thumb${f.icon ? " bust" : f.cutout ? " cut" : ""}">${inner}</div>
    <span class="bwho">
      ${/* Fitted, the name grows until it fills the tile and nothing is ever
            cut. Unfitted it is one fixed size on a track it may overrun, so it
            ellipsises — and an ellipsised name needs somewhere to say the rest,
            which is what the title is for. "Yangyang: Xuanling" is a real name
            and "Yangyan…" tells you nothing on its own. */""}
      <b${fitName ? ` data-fit="1.5 .8"` : ` title="${esc(b.name || "")}"`}>${esc(b.name || "???")}</b>
      <span class="bmeta">${meta}</span>
    </span>
  </div>`;
}

/* A banner as a card rather than a thumbnail: the character down the left, and
   beside them the three things you actually want off a banner — who they are,
   what their signature weapon is, and what they play as.

   This is the version record's strip only. On a patch card the same banner is a
   54px tile and has to be, because three of them sit in a column 130px wide;
   in the record there is a full modal to spend and a tile was spending it on
   white space. The tiles are still `thumb()` and still what the timeline draws.

   The one repeated fact left out is the phase. Every card in a strip is under a
   heading naming the phase and its dates, and a P1 chip on all three of them is
   the heading said three more times. */
function bannerCard(b){
  const f = figure(b);
  const r = resonatorFor(b.name);
  const attr = b.attribute || r.attribute;
  const unknown = !b.name || b.name === "???";
  /* No `icon` branch, unlike the tile: the cut-out bust is a 54px asset and
     this frame is three times that. The waist-up card is what figure() puts
     first anyway, and it is drawn for exactly this — a standing figure in a
     tall box. */
  const inner = f.image
    ? `<img class="${f.cutout ? "cut" : f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async"${f.style}>`
    : `<span class="g">${esc(unknown ? "?" : f.glyph)}</span>`;
  /* Debut or return, stamped on the picture. Both are printed here where the
     tile only marks debuts: a tile is one of five in a column and RERUN on four
     of them is noise, but a card is one of three and the strip is the patch's
     banner list — "is this her first run" is the question it exists to answer. */
  const flag = b.new ? `<i class="bflag new">New</i>` : b.rerun ? `<i class="bflag">Rerun</i>` : "";
  /* The whole tag list where there is one, not the one-word compression of it.
     This card is the version record's banner strip, and on an unannounced patch
     it is the first place a reader meets either Resonator — "Main DPS" alone
     there is the desk answering a question about rotations that nobody has
     published an answer to. See roleTagPanel(). The value column wraps, so a
     five-item list costs two lines and no layout. */
  const facts = [["Element", attr],
                 ["Weapon", b.weapon || r.weapon],
                 ["Role", r.roleTags?.length ? r.roleTags.join(" · ") : (r.role || b.role)],
                 ["Convene", b.convene]].filter(([, v]) => v);
  /* Same rule as the tile: the innermost [data-act] wins, so the card opens the
     Resonator and the weapon inside it opens the weapon. An unnamed banner —
     a phase the leaks know the shape of but not the name — has no record to
     open and stays inert. */
  const act = unknown ? "" : ` role="button" tabindex="0" data-act="resonator" data-id="${esc(b.name)}" aria-label="${esc(b.name)} — Resonator record"`;
  const rarity = b.rarity || r.rarity;
  return `<div class="bcard${unknown ? " unknown" : ""}"${attrStyle(attr)}${act}>
    <div class="bcard-art${f.cutout ? " cut" : ""}">${inner}${flag}</div>
    <div class="bcard-b">
      <div class="bcard-h">
        <b data-fit="1.7" data-fit-lines="1">${esc(b.name || "???")}</b>
        ${rarity ? `<span class="bcard-r">${esc(rarity)}★</span>` : ""}
        ${r.epithet ? `<span class="bcard-ep">${esc(r.epithet)}</span>` : ""}
      </div>
      ${sigWeaponCard(b.signature || r.signature)}
      ${facts.length ? `<div class="bcard-facts">${facts.map(([k, v]) =>
        `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

/* The weapon's own render, when portraits.json has resolved one. A weapon that
   debuts with an unreleased patch has no published icon yet, and gets the
   generic mark rather than a borrowed picture — same rule as everywhere else
   on the desk: show what is known, say nothing you can't source. */
function weaponIcon(name, size = 17){
  const w = weaponArtFor(name);
  return w?.icon
    ? `<span class="wicon has-art"><img src="${esc(w.icon)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="wicon">${icon("i-weapon", size)}</span>`;
}

/* ── rail ────────────────────────────────────────────────────────────
   Every view's primary filter axis, one entry per view, unfolding under its
   own name in the rail. This is the whole filter surface above 860px: it
   replaced the chip strip that headed each panel, which said the view's name a
   second time forty pixels from the rail item already saying it and held the
   content a header's height down the page.

   Values come off the data, not out of a list — an element or a weapon class
   nothing is filed under would be a filter that can only ever empty the page.
   A view with no entry here (Events, Live Signals) is a plain nav item: Events
   has nothing to filter yet, and Signals' kind row still heads its own panel,
   where the warning bar means it was never the bare strip the others were. */
const RAIL_FILTERS = {
  timeline: {
    scope:"when", label:"Window",
    items: () => [["all","All"], ["current","Current"], ["upcoming","Upcoming"], ["past","Past"]]
  },
  resonators: {
    scope:"elem", label:"Element",
    items: () => [["all","All"]].concat(
      [...new Set(resonators().map(r => r.attribute).filter(Boolean))].map(e => [e, e]))
  },
  weapons: {
    scope:"wtype", label:"Class",
    items: () => [["all","All"]].concat(
      WTYPES.filter(t => weapons().some(w => w.type === t)).map(t => [t, t]))
  },
  /* No entry for Echoes, deliberately. Its axis is the sonata set, there are
     34 of them, and a 34-item disclosure list in a 250px rail is a scrollbar
     inside a nav. The sets are that view's own headings instead, indexed as
     tiles at the top of the page, and the tile is the filter — see
     sonataIndex(). Echoes is a plain nav item like Events. */
  /* Tier carries counts and its own colours — it is the legend and the filter
     at once, which is what the standalone "Filter by tier" group was for
     before it became Intel's own list. */
  intel: {
    scope:"tier", label:"Confidence", tiered:true,
    items: () => {
      const c = tierCounts();
      return [["all", "All", entries().length]]
        .concat(TIERS.map(t => [t, TIER_LABEL[t], c[t] || 0, `t-${t}`]));
    }
  }
};

/* One button, rendered into the rail and into the panel's mobile filter bar
   from the same row of the same spec — both carry data-act=railfilter and go
   through one handler, so the two copies cannot disagree about what is on. */
function filterBtn(view, f, [k, label, n, cls], cl){
  return `<button class="${cl} ${cls || ""}" data-act="railfilter" data-view="${view}"
          data-scope="${f.scope}" data-id="${esc(k)}" aria-pressed="${S[f.scope] === k}">
    ${cls ? `<i class="dot"></i>` : ""}<span>${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ""}
  </button>`;
}

/* The list under a nav item. Always in the DOM and hidden when folded, so
   aria-controls always resolves to something. */
function railSub(v){
  const f = RAIL_FILTERS[v.id];
  if(!f) return "";
  const open = S.railOpen === v.id;
  return `<div class="subnav${f.tiered ? " tiered" : ""}" id="sub-${v.id}" role="group"
       aria-label="${esc(f.label)}"${open ? "" : " hidden"}>
    ${f.items().map(it => filterBtn(v.id, f, it, "sublink")).join("")}
  </div>`;
}

/* The same controls again, inside the panel, for the widths where the rail has
   collapsed to a strip carrying only the brand. Exactly one of the two is
   visible at any width — see .fbar in the stylesheet. */
function fbar(view){
  const f = RAIL_FILTERS[view];
  if(!f) return "";
  return `<div class="fbar">
    <div class="chips${f.tiered ? " tiered" : ""}">${
      f.items().map(it => filterBtn(view, f, it, "")).join("")}</div>
  </div>`;
}

/* The view's own name, first line of the stage, one per view. When the panel
   headers came off, the page lost the only thing that said where you are
   without looking at the rail — and a page whose first element is a patch card
   or a grid of portraits reads as content that started mid-sentence.

   It is the overarching view only: "Resonators", never "Resonators — Electro".
   Which filter is on is said by the lit item in the rail's own list, and a
   title that changes as you filter is a title you have to re-read. Small, one
   line, no box: it is a label on the page, not another header band. */
function pageTitle(id){
  const v = VIEWS.find(x => x.id === id);
  return `<h1 class="pagetitle">${esc(v?.label || "")}</h1>`;
}

function renderRail(){
  /* A nav, not a tablist — a tab cannot own a disclosure list. The tab-<id>
     ids stay: the panels are labelled by them. aria-current is what the dock
     styles off too, and it renders from the same VIEWS array. */
  $("#rail-nav").innerHTML = VIEWS.map(v => {
    const f = RAIL_FILTERS[v.id];
    const open = !!f && S.railOpen === v.id;
    return `<div class="navitem${open ? " open" : ""}">
      <button class="navlink" id="tab-${v.id}" data-act="view" data-id="${v.id}"
              aria-current="${S.view === v.id}"
              ${f ? `aria-expanded="${open}" aria-controls="sub-${v.id}"` : ""}>
        ${icon(v.icon, 19)}<span>${v.label}</span>
        ${navBadge(v)}
        ${f ? `<span class="caret" aria-hidden="true">${icon("i-caret", 11)}</span>` : ""}
      </button>
      ${railSub(v)}
    </div>`;
  }).join("");

  /* Everywhere the desk reads from, at the foot of the rail. These are all
     outbound now: the three saved views that used to head the list — patch
     notes, banner history, hot signals — were a view plus a filter, and the
     rail's own nav grew those filters as disclosure lists underneath each
     view. A shortcut to a control that is two rows above it is furniture.

     What is left is the four sources, each with the mark of where it goes, so
     the destination reads before the label does — the desk's own diamond for
     Kuro, and the site's mark for the rest. Nothing here is a page that
     doesn't exist: a link that goes nowhere is worse than no link. */
  $("#rail-links").innerHTML = [
    ["Official news",   "i-kuro",    "https://wutheringwaves.kurogames.com/en/main/news"],
    ["Kuro on YouTube", "i-youtube", "https://www.youtube.com/channel/UC0Bi5KMcECRVYis5Gb_ZYZQ"],
    /* Main sub above the leak sub, in the same order the desk trusts them. */
    ["Subreddit",       "i-reddit",  "https://www.reddit.com/r/WutheringWaves/"],
    ["Leak subreddit",  "i-reddit",  "https://www.reddit.com/r/WutheringWavesLeaks/"]
  ].map(([label, ic, href]) =>
    `<a class="tierlink" href="${href}" target="_blank" rel="noopener">
       ${icon(ic, 14)}<span class="t">${label}</span><span class="n out">↗</span></a>`
  ).join("");

  $("#dock").innerHTML = VIEWS.map(v => `
    <button data-act="view" data-id="${v.id}" aria-current="${S.view === v.id}">
      ${icon(v.icon, 17)}<span>${v.short || v.label}</span>
    </button>`).join("");
}

/* Right-hand mark on a nav item, in precedence order: the standing warning
   Live Signals carries, then the unbuilt flag. Both say something you need
   before you open the view. The record counts that used to sit here said
   nothing you'd act on — sixty is how many Resonators exist either way — and
   four figures down one edge read as a scoreboard. Each view still counts
   itself in its own words once you are in it. */
function navBadge(v){
  if(v.warn) return `<span class="warn">${v.warn}</span>`;
  if(v.soon) return `<span class="soon">Soon</span>`;
  return "";
}

/* Static once the data is in — the legend can't change without a reload. */
function renderLegend(){
  $("#foot-legend").innerHTML = TIERS.map(t =>
    `<span class="t-${t}" title="${esc(TIER_MEANS[t])}"><i class="dot"></i>${TIER_LABEL[t]}</span>`
  ).join("");
}

/* ── hud ─────────────────────────────────────────────────────────── */
function renderHud(){
  const feed = DATA.feed || {};
  $("#hud-updated").textContent = feed.fetched ? `${fmtTime(feed.fetched)} ${tzLabel()}` : "—";
  $("#hud-online").style.opacity = feed.fetched ? "" : ".5";
}

/* Kuro's CDN is Alibaba OSS and takes a resize on the query string. The
   original 3.5 key visual is 3840x2160 and 4MB — fine as the poster it is,
   absurd for a picture shown a thousand pixels wide inside a modal. At the
   width we actually draw it and q72 the same image is a couple of hundred KB
   and nothing of the difference is visible. Any other host is left alone. */
function cdnWidth(url, w){
  return /(^|\.)kurogame\.com\//.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}x-oss-process=image/resize,w_${w}/quality,q_72`
    : url;
}

/* ── timeline ────────────────────────────────────────────────────── */

/* Every banner in the patch, in phase order, each row flagged with whether its
   window has closed. The card used to show only what you could still pull,
   which on a patch in its back half meant its debut headliner had vanished
   from its own card — 3.5 is Yangyang: Xuanling's patch whether or not her
   phase has ended. The phase chip and the run bar say where today is; the
   `past` flag lets a closed phase read as closed rather than as current. */
function allPhases(v){
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return (v.phases || []).map(p => {
    const past = !!p.end && new Date(p.end) < today;
    const rows = (p.banners || []).map(b => ({...b, phase:p.n, past, keyVisual:v.keyVisual}));
    return {
      n: p.n, past,
      range: [p.start ? fmtShort(p.start) : "", p.end ? fmtShort(p.end) : ""].filter(Boolean).join(" → "),
      est: !!(p.estimated_start || p.estimated_end),
      banners: rows
    };
  });
}

/* The patch's debut characters, as the card's picture. One fills the frame; two
   split it down the middle, which is what a patch card for a two-debut patch
   should look like.

   Only a cut-out can be halved. A reveal poster is a whole composition —
   framing, backdrop, the character placed inside it — and cutting one down the
   middle crops someone else's layout rather than showing a character. So a
   patch with two debuts is drawn from cut-outs even where a poster exists for
   them, and a patch with one lets the poster fill the frame. */
function cardFigures(v){
  if(!v) return [];
  const debuts = allPhases(v).flatMap(p => p.banners).filter(b => b.new);
  /* A patch too far out to have banner rows still has characters flagged for it
     in the resonator database — the same list the card prints under "Teased for
     this patch", and the only faces the version has. Drawing the card with them
     is a weaker claim than a debut and it is made in the right place: the tile
     underneath carries the tier, and the card is already stamped Highly
     speculative. The alternative was a screen of rings above a name we know. */
  const subjects = debuts.length ? debuts : resonators().filter(r => r.version === v.id);
  return subjects.map(b => {
    const f = figure(b);
    const src = f.cutout ? f.image : portraitFor(b.name)?.card || null;
    return src ? {src, name:b.name} : null;
  }).filter(Boolean).slice(0, 2);
}

/* The layer behind the head band. Only ever a single debut's own poster now:
   the patch key visual went, because it is a marketing image with the version
   name set across it in type, and behind two cut-outs you read "LAMPLIGHT IN
   MIRAGE" through the gap between them rather than a setting. The pair carry
   their own ground instead — see .fig-cell. */
function cardArt(v){
  if(!v) return "";
  const debuts = allPhases(v).flatMap(p => p.banners).filter(b => b.new);
  if(cardFigures(v).length >= 2) return "";
  const flat = debuts.map(b => figure(b)).find(f => f.image && !f.cutout);
  if(!flat) return "";
  return `<div class="pcard-art${flat.poster ? " poster" : ""}">
    <img class="bg" src="${esc(flat.image)}" alt="" loading="lazy" decoding="async">
  </div>`;
}

function patchCard(v, role){
  if(!v){
    return `<article class="pcard is-future">
      <div class="pcard-stage">
        <div class="rings"></div>
        <div class="pcard-head">
          <div class="pcard-top"><span class="pill future">Future</span></div>
          <div class="pcard-main">
            <div class="pcard-num" style="color:var(--fg-3)">?</div>
            <div class="pcard-idtext">
              <div class="pcard-title">Beyond the horizon</div>
              <div class="pcard-dates">No version announced</div>
            </div>
          </div>
        </div>
        <div class="pcard-window"></div>
      </div>
      <div class="pcard-body">
        <div class="pcard-note">Nothing past the current cycle has surfaced yet. Beta datamines usually
          land first — they show up under Intel the moment they're worth writing up.</div>
      </div>
    </article>`;
  }

  const phases = allPhases(v);
  const banners = phases.flatMap(p => p.banners);
  const days = v.start ? daysTo(v.start) : null;
  /* A patch that has happened shows its own key visual instead of its debuts.
     Kuro paints one 16:9 picture per version with the whole cast of it inside
     and the codename set into the art, and for a patch you have played — or
     are playing — that is a better answer to "what is this version" than two
     cut-outs on a gradient. It is the image the game wore, and the faces are
     in it anyway.

     The Upcoming card keeps its figures, and the split is tense-shaped rather
     than arbitrary: a patch nobody has played is a promise about who you can
     pull, so the faces are the fact and the calendar is the question. A live
     or closed one is a thing that exists, and the picture Kuro shipped with it
     is the truest single image of it. The archive rows below already stand on
     the same art for the same reason.

     Falls back to the figures when there is no key visual on file, so nothing
     here depends on art.json having resolved. */
  const kv = (role === "live" || role === "past") && v.keyVisual?.url ? v.keyVisual : null;
  /* No separate background layer: the painting fills the stage on its own, and
     the head band is lifted onto it rather than sitting above it — see
     .pcard.kv .pcard-head. A blurred wash was carried here for a while and was
     covered by the picture in every case that mattered. */
  const art = kv ? "" : cardArt(v);
  const figs = kv ? [] : cardFigures(v);
  /* Held rather than called inline, because the head band asks it two
     questions: draw yourself, and did you draw anything — a patch with no
     window has no bar, and that is the one case the dates still have to be
     printed as type. */
  const bar = track(v, role);

  const state = role === "live"
    ? `<span class="pill live">Current</span>`
    : role === "next" ? `<span class="pill next">Upcoming</span>`
    : role === "past" ? `<span class="pill">Ended</span>`
    : `<span class="pill future">Future</span>`;

  let status = "";
  if(role === "live"){
    const left = patchWindow(v) ? daysTo(patchWindow(v).end) : null;
    status = `<div class="pcard-state"><span class="pulse t-official">Live</span>
      ${left != null && left > 0 ? `<span style="color:var(--fg-3)">${plural(left, "day")} remaining</span>` : ""}</div>`;
  }else if(role === "past"){
    const end = patchWindow(v)?.end;
    status = `<div class="pcard-state"><span style="color:var(--fg-3)">${
      end ? `Closed ${fmtShort(end)}` : "Closed"}</span></div>`;
  }else if(days != null){
    status = `<div class="pcard-state">${days > 0 ? `<span class="t-datamined">In ${plural(days, "day")}</span>`
      : `<span class="t-datamined">Launching now</span>`}</div>`;
  }else{
    /* No dates, no art, no banners — say why the card is nearly empty rather
       than leaving a hole and letting it read as something failing to load.
       This is also the whole of the Upcoming pill's hedge: the patch after the
       live one is usually a beta with nothing confirmed about it, and it now
       sits in the Upcoming slot like an announced patch would. What separates
       them is this line, which an announced patch never reaches — it has a
       start date, so it is caught by the branch above and says "In 12 days"
       instead. */
    status = `<div class="pcard-state"><span style="color:var(--fg-3)">Highly speculative</span></div>`;
  }

  const rows = [];
  /* A column per phase, in phase order — which is the order the debuts are
     drawn in above, so the second column of tiles sits under the character its
     first tile names. Debuts and reruns used to be the two columns, which read
     as an answer to "what is new" but put phase 2's headliner beside phase 1's
     reruns: two characters you cannot pull in the same fortnight, side by side,
     under a picture of somebody else. Who runs alongside whom is the fact you
     scan a patch card for, and now the columns are it. Four fit a cell; say so
     rather than silently dropping the rest. */
  /* Character over weapon in one tile, split by a rule. The weapon convene runs
     alongside the character banner in game and is a separate pull, so it keeps
     a click target of its own rather than being a footnote under the portrait —
     but it is that character's weapon, and on a card carrying five banners two
     free-floating tiles each cost a stacked pair of rows to say so. */
  /* One banner, read left to right: the character, who they are, what runs
     beside them, and the weapon itself. The two halves used to be stacked —
     portrait row over weapon row, split by a rule — which spent the card's
     whole width on a 44px face and then spent another row saying the weapon
     was that character's. Side by side, the same facts fit one row, and both
     pictures get to be three times the size they were.

     Four cells on a two-row grid: the art down the left spanning both, the
     name and its chips top-middle, the weapon name under them, and the weapon
     icon down the right spanning both. Both pictures run flush to the tile's
     edges — a portrait inset by nine pixels of padding is a portrait wasting
     the only space it has. */
  const pair = b => {
    const sig = signatureFor(b);
    const r = resonatorFor(b.name);
    const cls = b.weapon || r.weapon;
    const f = figure(b);
    const unknown = !b.name || b.name === "???";
    /* The waist-up card first, the 54px bust second — the opposite of the
       thumbnail's order, and for the reason bannerCard gives: the bust is cut
       for a small square and this box is now tall enough to want the picture
       that was drawn standing. */
    const art = f.image
      ? `<img class="${f.cutout ? "cut" : f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async"${f.style}>`
      : f.icon
      ? `<img class="bust" src="${esc(f.icon)}" alt="" loading="lazy" decoding="async">`
      : `<span class="g">${esc(unknown ? "?" : f.glyph)}</span>`;
    const attr = b.attribute || r.attribute;
    /* Two halves, two targets, and nothing smaller than a half. The tile used
       to hand out a click zone per element — portrait, name, weapon name,
       weapon icon — which is four things to aim at on a 250px tile and no way
       to tell from looking which of them went where. Now the left side is the
       Resonator and the right side is the weapon, each one element, each one
       tab stop, and each lighting up under the mouse so the answer to "where
       does this go" is visible before you click.

       The weapon's class label is gone with it. It was there because a
       signature weapon is by definition its holder's class, so the label
       carried two facts at once — but neither of them is a fact anybody came
       to a patch card for, and the space is the weapon's name. */
    const who = unknown ? "" : ` role="button" tabindex="0" data-act="resonator" data-id="${esc(b.name)}"` +
      ` aria-label="${esc(b.name)} — Resonator record"`;
    /* The element rides the tile itself, not just its halves — the tile is lit
       in it at rest, so a column of banners reads as a row of elements before
       you read a single name. */
    return `<div class="bpair${unknown ? " unknown" : ""}"${attrStyle(attr)}>
      <div class="bp-left"${who}>
        <div class="bp-art${f.cutout ? " cut" : ""}${f.icon && !f.image ? " bust" : ""}">${art}</div>
        <div class="bp-who">
          <b data-fit="1.35 .74" data-fit-in=".bpair">${esc(b.name || "???")}</b>
          <span class="bmeta">${b.new ? `<i class="new">New</i>` : ""}${
            b.rarity ? `<i class="rar">${esc(b.rarity)}★</i>` : ""}${
            attr ? `<i class="attr">${esc(attr)}</i>` : ""}</span>
        </div>
      </div>
      ${sig
        ? `<button class="bp-right" data-act="weapon" data-id="${esc(sig)}"
                   aria-label="${esc(sig)} — weapon record"
                   title="${esc(sig)} — signature weapon, runs alongside ${esc(b.name)}">
             <span class="bp-wep">${esc(sig)}</span>
             <span class="bp-wic">${weaponIcon(sig, 26)}</span>
           </button>`
        : `<div class="bp-right empty">
             <span class="bp-wep">No weapon listed</span>
             <span class="bp-wic">${weaponIcon(null, 26)}</span>
           </div>`}
    </div>`;
  };
  const strip = list => list.length
    ? `<div class="bstrip rows">${list.slice(0, 4).map(pair).join("")}${
        list.length > 4 ? `<span class="bmini-more">+${list.length - 4}</span>` : ""}</div>`
    : `<div class="bnone">—</div>`;

  /* Debut first, then the reruns running beside them — the headliner is why
     the phase is the phase, and it is the one drawn above the column. A stable
     sort keeps the data's own order inside each group. */
  const inPhaseOrder = list => [...list].sort((a, b) => (b.new ? 1 : 0) - (a.new ? 1 : 0));

  /* The phase dates come back here, on the heading, now that a column *is* a
     phase — one line, in the place that has to be labelled anyway. They were
     dropped as a legend under the old split, where they restated the head band
     for no gain; earning back "when can I pull this" is a different trade. */
  const cols = phases.filter(p => p.banners.length);
  if(cols.length) rows.push([null, `<div class="pcard-split" style="--cols:${cols.length}">
    ${cols.map((p, i) => `<div class="ps-col${i ? " div" : ""}">
      <div class="ps-head label${p.past ? " past" : ""}">Phase ${esc(p.n)}${
        p.range ? `<span class="ps-when">${esc(p.range)}${p.est ? " est" : ""}</span>` : ""}</div>
      ${strip(inPhaseOrder(p.banners))}
    </div>`).join("")}
  </div>`]);
  /* A patch this far out has no banner rows, but the resonator database may
     already carry characters flagged for it — the only concrete thing known
     about the version, and it was going unshown while the card sat empty. */
  if(!banners.length){
    const teased = resonators().filter(r => r.version === v.id);
    if(teased.length) rows.push(["Teased for this patch",
      `<div class="bstrip rows">${teased.slice(0, 3).map(r => thumb({
        name:r.name, rarity:r.rarity, attribute:r.attribute, weapon:r.weapon
      })).join("")}</div>`]);
  }
  /* No key events row. The same entries, tiered and dated, are the Recent intel
     panel one scroll down and the whole Intel view one click away — on the card
     they were a third copy, and the two lines they cost came straight off the
     picture. The card answers "who is in this patch"; Intel answers "what has
     been said about it". */
  /* Notes fill whatever's left on a thin card. Shown whenever there are no
     banners, not only when the card is otherwise empty — on a future patch the
     note is usually the most substantial thing known about it. */
  if(!banners.length && v.notes) rows.push(["What we know",
    `<p class="pcard-notes">${esc(v.notes)}</p>`]);

  const cellHtml = rows.length
    ? `<div class="pcard-rows">${rows.map(([k, h]) =>
        `<div class="pcard-row">${k ? `<div class="label">${k}</div>` : ""}${h}</div>`).join("")}</div>`
    : "";

  /* Two blocks, and the boundary between them is the whole layout. The stage is
     the artwork's own space: the picture fills it, and the only thing allowed
     over it is the head band across the top, which is deliberate — the version
     number wants a dark strip behind it and the top of a character card is
     usually sky. Everything else — the banner grid, the events, the footer —
     lives in the body underneath, on solid ground, where it covers nothing.
     Before this the rows were an 80%-opaque slab sitting on the lower half of
     the picture, so a busy patch quietly ate its own art. */
  return `<article class="pcard is-${role}${kv ? " kv" : ""}" role="button" tabindex="0" data-act="version" data-id="${esc(v.id)}"
           aria-label="Version ${esc(v.id)} detail">
    <div class="pcard-stage">
      <!-- Rings only when there is neither a poster nor a figure — a patch we
           know nothing about yet. They are a held signal, not a backdrop. -->
      ${art || (kv || figs.length ? "" : `<div class="rings"></div>`)}
      <!-- One rail across the top: state, codename, where the patch is in its
           run. The codename moved up here off its own line under the number —
           it is a designation, the same kind of thing as the pill beside it,
           and the gap between "Current" and "Live" was the width of it.

           The dates went with it. They were printed twice: once as a line of
           type here and once as the ends of the run bar directly above, which
           is the same two dates doing a job the bar does better, because the
           bar also says where today falls between them. So the line is drawn
           only when there is no bar to have said it — an undated patch, where
           "Dates unknown" is the honest thing to print and nothing else is
           printing it. -->
      <div class="pcard-head">
        <div class="pcard-top">${state}${
          v.title ? `<div class="pcard-title">${esc(v.title)}</div>` : ""}${status}</div>
        ${bar}
        <div class="pcard-main">
          <div class="pcard-num">${esc(v.id)}</div>
          ${bar ? "" : `<div class="pcard-idtext">
            <div class="pcard-dates">${[v.start ? fmtDate(v.start) : "", versionEnd(v)].filter(Boolean).join(" — ") || "Dates unknown"}</div>
          </div>`}
        </div>
      </div>
      <!-- The clear part, and where the debut figures live. Putting them in
           here rather than behind the whole stage is what keeps a head out of
           the head band's shadow: this box *is* the space below the band, so a
           figure framed to it can't be framed into the dark. -->
      <div class="pcard-window">${kv
        ? `<div class="pcard-kv">
             <img src="${esc(cdnWidth(kv.url, 1800))}"
                  alt="${esc(kv.title || `Version ${v.id} key visual`)}" decoding="async">
           </div>`
        : figs.length
        ? `<div class="figs n${figs.length}">${figs.map(f =>
            `<div class="fig-cell">
               <img class="fig-wash" src="${esc(f.src)}" alt="" aria-hidden="true" loading="lazy" decoding="async">
               <img class="fig" src="${esc(f.src)}" alt="${esc(f.name)}" loading="lazy" decoding="async">
             </div>`).join("")}</div>`
        : ""}</div>
    </div>
    <div class="pcard-body">
      ${cellHtml}
      <div class="pcard-foot">View details ${icon("i-arrow", 12)}</div>
    </div>
  </article>`;
}

/* Where the patch is in its own run: one bar, split at each phase boundary,
   with a marker on today. This is the whole content of a live patch card when
   versions.json has no phases for it yet — a real thing we know, rather than a
   hole where the banner grid would be. */
function track(v, role){
  const win = patchWindow(v);
  if(!win) return "";
  const {start, end, est} = win;
  const phases = (v.phases || []).filter(p => p.start);

  const total = end - start;
  const at = d => Math.min(Math.max((new Date(d) - start) / total * 100, 0), 100);
  const now = Date.now();
  const here = role === "live" ? at(now) : 0;

  const days = Math.round(total / DAY);
  const gone = Math.max(Math.round((Math.min(now, end) - start) / DAY), 0);
  const mid = role === "live"
    ? `Day ${gone} of ${days}`
    : `${plural(days, "day")}${phases.length > 1 ? ` · ${phases.length} phases` : ""}`;

  return `<div class="track">
    <div class="track-bar">
      <i class="track-fill" style="width:${here.toFixed(1)}%"></i>
      ${phases.slice(1).map(p => `<i class="track-div" style="left:${at(p.start).toFixed(1)}%"></i>`).join("")}
      ${role === "live" ? `<i class="track-now" style="left:${here.toFixed(1)}%"></i>` : ""}
    </div>
    <div class="track-k">
      <span>${fmtShort(start)}</span>
      <span class="mid">${mid}</span>
      <span>${fmtShort(end)}${est ? ` <em>est</em>` : ""}</span>
    </div>
  </div>`;
}

/* The patch's own end date if we have one, otherwise the next patch's start
   stands in — flagged, because it's inferred from the 42-day cycle. */
function versionEnd(v){
  const last = (v.phases || []).slice(-1)[0];
  if(last?.end) return fmtDate(last.end) + (last.estimated_end ? " (est)" : "");
  return "";
}

/* The preview broadcast for a version, on Kuro's own English channel.

   Read off the signal feed rather than typed into versions.json: the fetcher
   already pulls that channel every six hours, and the broadcast lands in it
   under a title Kuro writes the same way every patch — "Wuthering Waves
   Version 3.6 Preview Special Broadcast". So the link is a fact the desk
   already holds, and a patch whose stream has not aired yet resolves to
   nothing and prints no link, which is the correct thing to say about a video
   that does not exist.

   `livestreamUrl` on the version overrides it, for the one case this cannot
   cover: a patch old enough that its broadcast has rolled off the end of a
   150-item feed. */
function streamVideo(v){
  if(v.livestreamUrl) return v.livestreamUrl;
  const id = String(v.id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if(!id) return "";
  return (DATA.feed?.items || []).find(i =>
    i.sourceId === "youtube" && i.lang === "en" &&
    new RegExp(`(^|\\D)${id}(\\D|$)`).test(i.title || "") &&
    /preview|special/i.test(i.title || "") &&
    /broadcast|program|programme|stream/i.test(i.title || "")
  )?.url || "";
}

/* Which bucket a version falls in. One definition — the chips and the card row
   have to agree or the filter looks broken. */
const bucketOf = v => statusOf(v) === "live" ? "current"
  : (statusOf(v) === "announced" || statusOf(v) === "beta") ? "upcoming" : "past";
/* Announced and beta are both "next" — the same merge the row above makes, and
   the same one bucketOf has always made. A patch the Upcoming chip lists ought
   to say Upcoming on its own pill; it said Future, which read as a third
   category the filter did not have. What is still unknown about it is said in
   the status line under the pill, not by demoting where it sits. */
const roleOf = v => statusOf(v) === "live" ? "live"
  : (statusOf(v) === "announced" || statusOf(v) === "beta") ? "next"
  /* A shipped patch is not a future one. Nothing rendered a card for a closed
     patch until the Past window started doing it, so "anything that is not live
     or announced" quietly meant "beta" — and 3.5, six weeks over, came up
     labelled Future with "Launching now" under it, because its start date is in
     the past and the branch that says so is the one for a patch about to open. */
  : statusOf(v) === "past" ? "past" : "future";

function renderTimeline(){
  const live = liveVersion(), next = nextVersion(), future = futureVersion();

  const rank = v => statusOf(v) === "live" ? 0 : statusOf(v) === "announced" ? 1 : statusOf(v) === "beta" ? 2 : 3;
  const inWindow = v => S.when === "all" || bucketOf(v) === S.when;
  const list = [...versions()].filter(inWindow)
    .sort((a, b) => rank(a) - rank(b) || parseFloat(b.id) - parseFloat(a.id));

  /* Now and Next, two cards across, narrowing to whichever the chips asked
     for. The filter has to change the thing directly underneath it — it used
     to sit on this panel and quietly re-filter a lane list two thousand pixels
     further down, which reads as a button that does nothing. */
  /* One upcoming slot, not two. This used to be Now / Next / Future, where
     Next held the announced patch and Future held the beta one — but those two
     are never both populated in practice. The moment a patch ships, the one
     after it is a beta rumour and stays that way until Kuro's preview
     broadcast a month later, at which point it becomes the announced patch and
     the beta slot moves on to the version after. So the row spent every day of
     every cycle drawing one real card and one placeholder reading "nothing
     past the current cycle has surfaced yet" — printed directly beside a
     populated 3.7 card, which is a plain falsehood.

     Now the second slot is simply "the next patch", whichever of the two it
     is, and it is labelled Upcoming either way. How much of it to believe is
     not the pill's job: an unannounced patch still says Highly speculative
     under it, and its tiles still carry their own confidence. Where it sits in
     the calendar and how sure we are about it are two different facts, and
     the card has always had two places to put them. */
  const cards = S.when === "all"
    ? [[live, "live"], [next || future, "next"]]
    : list.map(v => [v, roleOf(v)]);

  const body = cards.length
    ? `<div class="hero${S.when === "all" ? (cards.length === 2 ? " pair" : "") : " narrow"}">${
        cards.map(([v, r]) => patchCard(v, r)).join("")}</div>`
    /* Nothing to say here on Past: the archive below is the answer to that
       window, and an empty box directly above twenty patches reads as a page
       that has failed rather than as one with a card missing. versions.json
       only carries the arc the desk is watching, so a Past window with no card
       in it is the ordinary state and not a hole. */
    : S.when === "past" ? ""
    : `<div class="empty">No patch in this window.</div>`;

  /* The band under the cards. Everywhere but Past that is the event grid; on
     Past it is the archive, and it skips whichever patches are already drawn as
     cards above it so the same patch is not on the page twice. */
  const band = S.when === "past"
    ? archivePanel(new Set(cards.map(([v]) => v?.id).filter(Boolean)))
    : eventPanel();

  /* No panel header. It was the view's name plus the window filter and the
     layout toggle, all of which now sit in the rail — what heads the page is
     the one-line title above the stack. The bar below only appears once the
     rail has collapsed and taken the filters with it. */
  const hero = `<div class="panel">
    ${fbar("timeline")}
    ${body ? `<div class="panel-b">${body}</div>` : ""}
  </div>`;

  /* Dashboard duo */
  const recent = [...entries()].sort((a, b) => (b.date||"").localeCompare(a.date||"")).slice(0, 3);
  const sigs = signals().slice(0, 5);
  const duo = `<div class="duo">
    <div class="panel">
      <div class="panel-h"><h2>Recent intel</h2><span class="sub">Curated &amp; tiered</span>
        <div class="right"><button class="more" data-act="view" data-id="intel">View all ${icon("i-arrow", 12)}</button></div></div>
      <div class="panel-b flush">${recent.map(e => intelCard(e, true)).join("") || `<div class="empty">No entries yet.</div>`}</div>
    </div>
    <div class="panel">
      <div class="panel-h"><h2>Live signals</h2><span class="sub">Unverified automated</span>
        <div class="right"><button class="more" data-act="view" data-id="signals">View all ${icon("i-arrow", 12)}</button></div></div>
      <div class="panel-b flush"><div class="term mini">${sigs.map(signalRow).join("") || `<div class="empty">Fetcher has not run.</div>`}</div></div>
    </div>
  </div>`;

  $("#p-timeline").innerHTML = `<div class="stack">${pageTitle("timeline")}${hero}${band}${duo}</div>`;
}

/* ── event calendar ──────────────────────────────────────────────────
   Events are the one part of a patch you can miss by not logging in, so they
   get a band of their own on the landing view, between the patch cards that
   say what is coming and the intel that says what has been claimed about it.

   data/events.json is written by scripts/fetch-events.mjs off Kuro's own EN
   posts — the per-patch Content Overview for the list and the exact windows,
   each event's own notice for its banner art and its reward line. Two things
   about that drive everything below.

   First, the picture is the event's own 16:9 banner with its name set across
   it, or there is no picture. The desk does not borrow a face for an event —
   a Resonator poster standing in for an event reads as that Resonator's event,
   which is a lie the caption underneath cannot undo. An event Kuro has not
   published a notice for yet draws a plate, and the plate goes away by itself
   the day the notice lands.

   Second, because the banner already carries the name, the name goes *under*
   the picture rather than over it. Set over the top it is the same words twice
   in two typefaces, and on the plate tiles it was the only words at all.

   Windows are real now: Kuro publishes them in server time (UTC+8) and the
   file keeps the offset, so every clock here is the reader's own. What is
   still missing is the announced-but-unwritten-up patch — 3.6's events are
   hand-written from the preview broadcast and carry no dates, because Kuro
   does not publish them until patch day. Those inherit the patch window and
   say so. */

/* Chronological, in the order you would actually meet these: what is running,
   soonest to close first — that is the one you are about to lose — then what
   has not opened yet, soonest to open first, then the permanent additions,
   which are not going anywhere, and finally what has already closed.

   Nothing sorts by importance. The headline event keeps its double-width tile
   but takes its place in the queue like everything else: a band whose order is
   partly the calendar and partly an editorial judgement is a band you cannot
   read the calendar off. */
const EVENT_ORDER = {live:0, soon:1, permanent:2, past:3};
function eventList(){
  const at = (ev, which) => String(eventWindow(ev)[which] || "");
  return [...gameEvents()].sort((a, b) => {
    const ra = EVENT_ORDER[eventState(a).kind], rb = EVENT_ORDER[eventState(b).kind];
    if(ra !== rb) return ra - rb;
    if(ra === 0) return at(a, "end").localeCompare(at(b, "end"));
    if(ra === 1) return at(a, "start").localeCompare(at(b, "start"));
    /* Closed events read newest first — the far end of the list is the far
       end of the patch. */
    if(ra === 3) return at(b, "end").localeCompare(at(a, "end"));
    return a.name.localeCompare(b.name);
  });
}

/* When it runs, and whose dates those are. An event with its own window uses
   it; one Kuro has not dated yet inherits its patch's and is flagged, so a
   card can say "patch window" rather than presenting a patch's dates as an
   event's own. */
function eventWindow(ev){
  if(ev.start || ev.end) return {start:ev.start || "", end:ev.end || "", inherited:false, est:false};
  const v = versions().find(x => x.id === ev.version);
  const win = v ? patchWindow(v) : null;
  return win
    ? {start:win.start, end:win.end, inherited:true, est:win.est}
    : {start:"", end:"", inherited:true, est:false};
}

/* The state chip, and the most useful line on the tile: whether it is on, and
   for how much longer. A running event is worth a colour; one closing inside a
   week is worth the warning colour, because that is the fact on the card you
   have to act on today rather than next week. */
function eventState(ev){
  if(ev.permanent) return {kind:"permanent", cls:"perm", text:"Permanent"};
  /* Kuro dates a patch's login track from "the Version 3.6 update" rather than
     a clock time, and the update lands at 04:00 server time — which is the
     evening before, most of the way round the world. Taken literally that has
     the desk calling an event Running while the patch card beside it still says
     the patch is a day out. The patch's own state wins: one page cannot hold
     two answers to whether 3.6 has started. */
  if(ev.startsWithPatch){
    const v = versions().find(x => x.id === ev.version);
    if(v && statusOf(v) !== "live"){
      const d = v.start ? daysTo(v.start) : null;
      return {kind:"soon", cls:"soon", text:d == null ? "Upcoming" : d <= 0 ? "Starts today" : `In ${plural(d, "day")}`};
    }
  }
  const {start, end, inherited} = eventWindow(ev);
  const now = Date.now();
  const t = d => d ? new Date(d).getTime() : null;

  if(end && t(end) < now) return {kind:"past", cls:"", text:"Ended"};
  if(start && t(start) > now){
    const d = daysTo(start);
    return {kind:"soon", cls:"soon", text:d == null ? "Upcoming" : d <= 0 ? "Starts today" : `In ${plural(d, "day")}`};
  }
  if(!start && !end) return {kind:"soon", cls:"soon", text:"Upcoming"};
  /* Running, and how much of it is left. The countdown used to appear only
     inside the closing week and every other running event carried the word
     "Running", which answers a question nobody arrives with: eight events are
     on, they are all running, and the thing a reader wants off the band is
     which of them closes first. Eight identical green chips cannot say it, and
     the tile already had the room. So the number is always on, and what the
     last week adds is the warning colour rather than the fact itself.

     Inherited dates are the patch's, so they cannot carry a countdown to this
     event's own close — that number would be invented, and the chip says the
     state on its own. */
  const left = end && !inherited ? daysTo(end) : null;
  if(left == null) return {kind:"live", cls:"live", text:"Running"};
  if(left <= 0) return {kind:"live", cls:"warn", text:"Ends today"};
  return {kind:"live", cls:left <= 7 ? "warn" : "live", text:`${plural(left, "day")} left`};
}

/* What the event pays in Astrite, off the reward line Kuro publishes with it.
   Two shapes to read: a hand-written entry lists rewards one to an array slot
   ("Astrite x1200"), and a fetched one keeps Kuro's own sentence with the
   whole reward table in it. Both put the number next to the word.

   Null, not zero, when there is no reward line at all — half the events on a
   shipped patch never got one, and a tile reading "0 Astrite" states something
   Kuro has not said. No badge is the honest version of not knowing. */
function astriteFrom(ev){
  const text = Array.isArray(ev.rewards) ? ev.rewards.join(", ") : String(ev.rewards || "");
  if(!text) return null;
  const m = /astrite\s*[x×]?\s*([\d][\d,]*)/i.exec(text)
         || /([\d][\d,]*)\s*[x×]?\s*astrite/i.exec(text);
  if(!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
const astriteLabel = n => `${n.toLocaleString("en-GB")} Astrite`;

/* The stone itself, rather than the desk's drawing of it. Kuro's own item art
   is already on disk — fetch-items.mjs pulls it off the wiki along with every
   other thing an event pays, and the reward grid has been showing it all
   along. There was never a reason for the badge on the tile to be the only
   place Astrite appeared as a glyph.

   The inline `i-astrite` in index.html stays as the fallback: it is what draws
   in the moment before items.json lands, and for anyone whose fetch of it
   failed. Nothing here depends on the picture being there. */
const astriteMark = (size = 12) => {
  const art = itemFor("Astrite")?.icon;
  /* Sized inline. The badge on a tile sits inside .ev-pic, whose `img` rule
     fills the box — it is written for the event banner behind it, and it wins
     on specificity over anything a class on this one can say. */
  return art
    ? `<img class="astrite-pic" src="${esc(art)}" alt=""
           style="width:${size}px;height:${size}px" loading="lazy" decoding="async">`
    : icon("i-astrite", size);
};

/* ── what a patch pays ────────────────────────────────────────────── */
/* An estimate of the Astrite a patch hands out, which is the one number a
   reader opens a version record to plan against: the banner strip says who is
   running, and this says whether you can afford them.

   It is the one figure on the desk nobody publishes. Kuro announces the
   banners, the dates and the events, and never once says what the patch is
   worth — so unlike every other number here it cannot be fetched, only
   modelled. data/astrite.json holds that model: a baseline drawn from the
   community calculation the file credits, and a per-version block that
   overrides any part of it once a patch turns out to differ.

   Two things are computed rather than stored, because the file would go stale
   on both:

   - **The patch's length.** Taken off the version's own window, not the
     baseline's — 3.5 ran 40 days and 3.6 runs 42, and the daily line is 60 a
     day whichever it is.
   - **The recurring difference.** A patch two days longer is two days of
     dailies and no more story quests, so only the per-day and per-week lines
     move the totals. Rounded to the nearest hundred afterwards: this is an
     estimate, and a total reading 12,834 claims a precision it does not have.

   Null when the file is missing, or when a patch has neither a window nor a
   baseline length to fall back on — the panel is dropped rather than drawn
   over numbers that stand for nothing. */
function astritePlan(v){
  const cfg  = DATA.astrite;
  const base = cfg?.baseline;
  if(!v || !base?.tracks?.length || !base?.lines?.length) return null;

  const over = cfg.versions?.[v.id] || {};
  const {start, end} = versionWindow(v);
  const dated = start && end ? Math.round((new Date(end) - new Date(start)) / DAY) : 0;
  const days  = dated > 0 ? dated : (over.days || base.days || 0);
  if(!days) return null;
  const baseDays = over.days || base.days || days;

  /* A version's `lines` is a patch over the baseline's, keyed by line id: an
     object refines that line, `null` drops it — a patch that opens no new
     region pays no exploration Astrite — and an id the baseline has never
     heard of is a line only this patch has. */
  const edits = over.lines || {};
  const lines = [
    ...base.lines.filter(l => edits[l.id] !== null).map(l => ({...l, ...(edits[l.id] || {})})),
    ...Object.entries(edits)
      .filter(([id, l]) => l && !base.lines.some(b => b.id === id))
      .map(([id, l]) => ({id, ...l}))
  ];

  const weeks  = Math.round(days / 7);
  const months = Math.max(1, Math.floor(days / 30));
  const runs   = l => l.per === "day" ? days : l.per === "week" ? weeks : l.per === "month" ? months : 1;
  const mid    = l => l.astrite ?? (l.range ? (l.range[0] + l.range[1]) / 2 : 0);

  /* One line does not have to be modelled at all, because the desk already
     knows the answer. `desk:"events"` says: events.json carries Kuro's own
     reward line for every event that has been announced, and a published sum
     beats a community range every time — 3.6's events pay 3,400 between them,
     which is a fact rather than an estimate and is drawn as one.

     It falls back to the range on a patch whose events nobody has announced,
     which is every patch at the point a reader most wants this figure. */
  const priced = lines.map(l => {
    if(l.desk !== "events") return l;
    const evs  = patchEvents(v.id);
    const paid = evs.filter(e => astriteFrom(e));
    if(!paid.length) return l;
    const sum  = paid.reduce((n, e) => n + astriteFrom(e), 0);
    const lo   = l.range ? l.range[0] : Number(l.astrite) || 0;
    const hi   = l.range ? l.range[1] : Number(l.astrite) || 0;

    /* Published beats modelled, but only upwards. A reward line is a floor and
       not a total: the desk holds one for five of 3.6's eight events and none
       at all for the two that are only a double-drop window. Letting the sum
       stand as the answer wherever it exists would make a patch the desk knows
       something about look poorer than one it knows nothing about — which is
       exactly backwards, and 3.5 is the patch that proves it.

       So the sum raises the low end and is the whole answer only once it has
       overtaken the high one, which is where it has stopped being a floor. */
    const whole = sum >= hi;
    return {...l,
      whole, published: paid.length,
      range:   whole ? null : [Math.max(lo, sum), hi],
      astrite: whole ? sum  : null,
      note: whole
        ? `Kuro's own reward lines, across ${plural(paid.length, "event")}`
        : `At least ${numFmt(sum)} published, across ${paid.length} of ${plural(evs.length, "event")} — the rest carry no reward line yet`};
  });

  /* What one extra day of this patch is worth, off the lines that actually
     repeat. A range counts at its midpoint, the same figure the line renders. */
  const perDay = priced.reduce((n, l) =>
    n + (l.per === "day" ? mid(l) : l.per === "week" ? mid(l) / 7 : 0), 0);
  const shift  = (days - baseDays) * perDay;
  const round  = n => Math.round(n / 100) * 100;
  const cost   = Number(cfg.pullCost) || 160;

  /* Every line multiplied out for this patch — 42 dailies, 6 weekly clears,
     one region. `low` and `high` are the two ends of a range and the same
     figure twice for a fixed line, so everything downstream adds them the same
     way without asking which shape it was given. */
  const out = priced.map(l => {
    const n    = runs(l);
    const low  = (l.range ? l.range[0] : Number(l.astrite) || 0) * n;
    const high = (l.range ? l.range[1] : Number(l.astrite) || 0) * n;
    return {...l, runs:n, low, high, mid:(low + high) / 2};
  });

  const tracks = base.tracks.map(t => {
    const astrite = Math.max(0, round((Number(t.astrite) || 0) + shift));
    /* Astrite buys pulls at 160; a Radiant Tide is a limited pull already.
       Lustrous and Forging are the standard and the weapon banner, which is
       a different budget — they are shown, and not counted in this figure. */
    return {...t, astrite, pulls: Math.floor(astrite / cost) + (Number(t.tides?.radiant) || 0)};
  });

  /* The lines gathered into the handful of things a patch actually pays you
     for, because that is the shape a reader plans against. "The events are
     worth three thousand and they all expire" is a decision; fourteen rows of
     arithmetic in source order is a spreadsheet, and nobody reads a spreadsheet
     to work out whether they can afford a banner. */
  const gdefs  = over.groups || base.groups || [];
  const filed  = new Set();
  const total  = ls => ({
    low:  ls.reduce((n, l) => n + l.low,  0),
    high: ls.reduce((n, l) => n + l.high, 0),
    mid:  ls.reduce((n, l) => n + l.mid,  0)
  });
  const groups = gdefs.map(g => {
    const gl = out.filter(l => l.group === g.id);
    gl.forEach(l => filed.add(l));
    return {...g, lines:gl, ...total(gl)};
  }).filter(g => g.lines.length);

  /* A line the file files under nothing, or under a group it never defined. It
     still counts towards the total, so it still gets a row rather than quietly
     going missing from the one panel whose whole job is adding up. */
  const loose = out.filter(l => !filed.has(l));
  if(loose.length) groups.push({id:"other", label:"Everything else", lines:loose, ...total(loose)});

  const counted = out.reduce((n, l) => n + l.mid, 0);

  return {
    days, baseDays,
    /* No window on the version at all — 3.7 is a beta with a drip card and no
       dates — so what comes back is the shape of a patch rather than this
       patch's own arithmetic, and the panel says so. */
    modelled: !dated,
    /* And the other half of that, which is a separate question and was going
       unsaid. `modelled` is about the patch's *length*; this is about its
       *total*. The baseline is one patch's arithmetic — `from` names which,
       and the source line names the article — so on every other patch the
       headline is that patch's figure carried across, adjusted only for how
       many days this one runs. Two patches of the same length therefore read
       the same to the Astrite, which is honest only if the panel admits where
       the number came from. `versions` is the file's way of saying a patch has
       been looked at on its own; without an entry, it has not been. */
    from: base.from || null,
    carried: !!base.from && base.from !== v.id && !cfg.versions?.[v.id],
    lines: out,
    groups,
    tracks,
    counted,
    /* The lines have never added up to the headline and were never meant to:
       the community figure is a total, and what gets itemised is the biggest
       dozen sources rather than every one of them. The difference is drawn as
       its own segment instead of being spread across the lines to make the sum
       come out — an estimate massaged into balancing is just an estimate that
       has stopped saying where it is unsure.

       This residual absorbs whatever the desk learns, and that is deliberate
       rather than an oversight to tidy up later. Kuro's published rewards put
       3.6's events at 3,400 against the model's 2,000, so `counted` rises and
       this shrinks — 530 on 3.6 where 3.7 has 1,930 — while both patches go on
       reading ~13,000. The alternative was to fix the residual at the
       baseline's own remainder and let the itemised lines drive the total,
       which would put 3.6 at ~14,400. It was considered and turned down: the
       source article is 3.6's own, so a total that already counts 3.6's events
       would then count them twice, and the community's figure is the thing
       being cited. The headline is theirs and moves only with patch length. */
    gap: Math.max(0, (tracks[0]?.astrite || 0) - counted),
    source:   over.source   || cfg.source   || null,
    sources:  over.sources  || cfg.sources  || [],
    excludes: over.excludes || base.excludes || [],
    note:     over.note     || cfg.note     || ""
  };
}

const TIDE_LABEL = {radiant:"Radiant", lustrous:"Lustrous", forging:"Forging"};
const numFmt = n => Number(n).toLocaleString("en-GB");
/* A count in the file is either a figure or a range: 7, or [10, 15]. */
const tideList = (t, runs = 1) => Object.entries(t || {})
  .filter(([, n]) => n)
  .map(([k, n]) => `${Array.isArray(n) ? `${n[0] * runs}–${n[1] * runs}` : n * runs} ${TIDE_LABEL[k] || k}`)
  .join(" · ");

/* One income line as it reads in the list: a fixed figure, a range, or — where
   the line pays no Astrite at all, which is what the Battle Pass track and the
   Coral shop are — the tides it pays instead. A line can be both: the events
   line pays Astrite *and* Tides, and the Astrite is the part that belongs in
   the column of numbers. */
function astriteAmount(l){
  if(l.range) return `${numFmt(l.range[0] * l.runs)} – ${numFmt(l.range[1] * l.runs)}`;
  const n = (Number(l.astrite) || 0) * l.runs;
  return n ? numFmt(n) : tideList(l.tides, l.runs);
}

/* A subtotal, which is a range whenever anything under it was one. */
const astriteSpan = (low, high) =>
  low === high ? numFmt(low) : `${numFmt(low)} – ${numFmt(high)}`;

/* The panel, under the patch's poster. The F2P figure is the headline because
   it is the floor every account clears to; a reader on a subscription finds
   their own row two lines below it.

   Only for a patch that has not closed. An estimate of what a patch will pay
   is planning; the same panel over a patch that ended in April is a guess at a
   number the reader already lived through. */
function astritePanel(v, status){
  if(status === "past" || v?.archived) return "";
  const p = astritePlan(v);
  if(!p) return "";
  const [head, ...rest] = p.tracks;

  const tides = tideList(head.tides);
  const foot = [
    p.modelled
      ? `Modelled on a ${p.baseDays}-day patch — ${esc(v.id)} has no window yet.`
      : `Scaled to this patch's ${p.days} days.`,
    /* Said out loud, because the number is otherwise indistinguishable from
       one worked out for this patch: two patches of the same length read the
       same to the Astrite, and until this line the only thing separating them
       was a sentence about the calendar. */
    p.carried
      ? `The total itself is ${esc(p.from)}'s — nobody has published one for ${esc(v.id)}, so this is that model carried across.`
      : "",
    esc(p.note)
  ].filter(Boolean).join(" ");

  return `<div class="dsec aest">
    <div class="dsec-h">
      <span class="label">Estimated Astrite this patch</span>
      <span class="aest-tag" title="Not a Kuro figure. Nobody publishes what a patch pays — this is the community's arithmetic on a full clear.">estimate</span>
    </div>

    <button class="aest-hero" data-act="open" data-id="astrite:${esc(v.id)}"
            aria-label="Break down the ${numFmt(head.astrite)} Astrite estimate for version ${esc(v.id)}">
      ${astriteMark(46)}
      <span class="aest-fig">
        <b>~${numFmt(head.astrite)}</b>
        <span>Astrite — ${esc(head.label)}</span>
      </span>
      <span class="aest-pulls">
        <b>≈ ${head.pulls}</b>
        <span>limited pulls</span>
      </span>
      <span class="aest-go">${icon("i-arrow", 14)}</span>
    </button>
    ${tides ? `<div class="aest-tides" title="Tides come on top of the Astrite. A Radiant Tide is a limited convene, so those are already in the pull count; Lustrous is the standard banner and Forging the weapon one, which is a different budget and is not.">
      <span>plus</span>${esc(tides)} Tides</div>` : ""}

    ${rest.length ? `<div class="aest-tracks">${rest.map(t => `
      <div>
        <span>${esc(t.label)}</span>
        <b>~${numFmt(t.astrite)}</b>
        <em>≈ ${t.pulls} pulls</em>
      </div>`).join("")}</div>` : ""}

    <button class="aest-more" data-act="open" data-id="astrite:${esc(v.id)}">
      <span>Where the figure comes from</span>
      <em>${p.lines.length} lines · ${p.groups.length} groups</em>
      ${icon("i-arrow", 12)}
    </button>

    ${/* No source link here. The panel already has one control for "where did
          this number come from", and it is the row above — the full breakdown,
          which carries the sources itself under a heading that says so. A
          second link beside it sent you off the desk to read one of them
          instead, which is the wrong of the two answers to offer first. */""}
    <p class="aest-foot">${foot}</p>
  </div>`;
}

/* Kuro's own banner, or nothing. There is no fallback picture by design — see
   the note at the top of this section. */
/* An event's picture, wherever the desk happens to hold one.

   Its own is the answer whenever it has one: that is Kuro's post and Kuro's
   banner, and it is what everything out of events.json carries. archive.json
   carries none at all, and deliberately — it is the wiki's list of names and
   dates for every patch since launch, and two hundred and thirty banners is
   not what that file is for.

   So an archived event borrows one. A permanent mode has a banner in
   permanents.json and also ran for the first time in some patch, which is the
   row the archive filed it under; matched on the name, that row can show the
   picture the desk already holds. It resolves for about one archived event in
   ten — the rest get the plate, the same as an intel row with no face. The
   index is rebuilt when the events file behind it changes and not otherwise,
   because a version record asks this once per row. */
let EVENT_ART = null, EVENT_ART_OF = null;
function eventArtIndex(){
  if(EVENT_ART && EVENT_ART_OF === DATA.events) return EVENT_ART;
  EVENT_ART_OF = DATA.events;
  EVENT_ART = new Map();
  for(const e of gameEvents()) if(e.art?.url) EVENT_ART.set(eventKey(e.name), e.art);
  return EVENT_ART;
}
const eventArt = ev =>
  ev.art?.url ? ev.art : eventArtIndex().get(eventKey(ev.name)) || null;

/* What the plate says where there is no banner. For a patch's own events the
   answer is that Kuro has not written the notice yet, and the plate goes away
   by itself the day it lands. For a permanent event it never will: that list is
   read off the wiki, the wiki has no picture for this one, and "not published
   yet" about a mode that shipped in 3.2 is a promise the desk cannot keep. */
const plateNote = ev => ev.permanent ? "No banner on the wiki" : "Banner not published yet";

/* Where an unreleased patch's banners live. Kuro publishes them as one tall
   infographic — a banner per event stacked down a single JPEG — and only cuts
   them into posts of their own once the patch is live. `art.crop` is that
   banner's rectangle inside the sheet, and this hands the crop to Kuro's own
   CDN rather than copying the file and cutting it up here: Alibaba OSS takes
   crop and resize on the query string, so what comes back is Kuro's image,
   from Kuro's host, of the region we asked for. scripts/find-event-art.mjs is
   where the numbers come from. */
function artUrl(art, w){
  const c = art.crop;
  if(!c || !/(^|\.)kurogame\.com\//.test(art.url)) return cdnWidth(art.url, w);
  return art.url
    + `?x-oss-process=image/crop,x_${c.x},y_${c.y},w_${c.w},h_${c.h}`
    + `/resize,w_${w}/quality,q_78`;
}

function eventCard(ev){
  const art = eventArt(ev);
  const st = eventState(ev);
  const past = st.kind === "past";
  const astrite = astriteFrom(ev);
  return `<article class="ev${ev.headline ? " head" : ""}${past ? " past" : ""}" role="button" tabindex="0"
           data-act="event" data-id="${esc(ev.id)}"
           aria-label="${esc(ev.name)} — ${esc(ev.kind || "Event")}${ev.version ? `, version ${esc(ev.version)}` : ""}, ${esc(st.text)}${astrite ? `, ${astriteLabel(astrite)}` : ""}">
    <div class="ev-pic">
      ${art
        /* A banner is 16:9 and the tile is about 2:1, so the tile crops the
           sides. `art.focus` is for the banners that carry their name plate at
           one end — frame the art, not half a word. */
        /* A banner that carries its own name plate is shown whole rather than
           filled to the tile. Those are the double-drop title strips — 3:1, the
           event name set across them — and a 1.6:1 tile cropping the sides of
           one slices the name in half, which reads as a bug rather than as a
           crop. Everything else is art and fills the tile. */
        ? `<img class="${art.nameplate ? "plate" : ""}"
               src="${esc(artUrl(art, ev.headline ? 1200 : 760))}" alt="" loading="lazy" decoding="async"
               ${art.focus && !art.nameplate ? `style="object-position:${esc(art.focus)}"` : ""}>`
        /* The plate. Not a picture standing in for one: the desk's own mark,
           dimmed, saying there is nothing to show yet. */
        : `<div class="ev-plate" aria-hidden="true"><span>${esc(plateNote(ev))}</span></div>`}
      <div class="ev-top">
        <span class="ev-state ${st.cls}">${esc(st.text)}</span>
        ${/* Most of the permanent list predates any patch this desk holds a
              record of — an empty pill is worse than no pill. */
          ev.version ? `<span class="pill ver">${esc(ev.version)}</span>` : ""}
      </div>
      ${/* Big. This is the number the page is scanned for — "what is this
            fortnight worth" is answered by adding up eight of these — and at
            12px it was a footnote in the corner of a picture, legible only if
            you had already decided to read it. The glyph does the work: a
            stone you can pick out across the grid without reading a digit. */
        astrite ? `<span class="ev-astrite" title="Astrite from this event">
        ${astriteMark(40)}<b>${astrite.toLocaleString("en-GB")}</b></span>` : ""}
    </div>
    <div class="ev-cap">
      <span class="ev-kind">${esc(ev.kind || "Event")}</span>
      <h3>${esc(ev.name)}</h3>
      ${ev.headline && ev.summary ? `<p>${esc(ev.summary)}</p>` : ""}
    </div>
  </article>`;
}

/* The band on the timeline: everything that is on and everything that is
   coming, in that order, however many rows that takes. It was capped at six
   with a View all button, which is the wrong trade for this particular list —
   a patch runs eight or nine events, they are the things you can miss by not
   logging in, and a tile is 200px. Six of nine with a button is a reader
   counting what is behind the cut.

   What it does drop is the closed ones. This is the band for planning the week
   and an event that ended is not part of that; the Events view keeps them,
   grouped by patch, which is where a finished patch belongs. */
function eventPanel(){
  /* This patch and the ones after it, and nothing older. A permanent event
     from a shipped patch is still playable — Shape of Yesterday will be there
     next year — but it is not part of the current cycle, and on a band about
     what to do this fortnight it is a tile that never changes and never goes
     away. The Events view keeps it, filed under the patch it shipped in. */
  const floor = parseFloat(liveVersion()?.id);
  /* And the window chips above it. They used to move the three patch cards and
     leave this band alone, which reads as a filter that does nothing: the band
     is the longest thing on the page, it sits directly under the chips, and it
     was answering a different question from the one just asked. Now Current is
     what is on tonight and Upcoming is what is not on yet. Past renders no band
     at all — see renderTimeline, where the archive takes its place. */
  const wanted = S.when === "current" ? ["live", "warn", "permanent"]
    : S.when === "upcoming" ? ["soon"]
    : ["live", "warn", "soon", "permanent"];
  const shown = eventList().filter(e =>
    wanted.includes(eventState(e).kind) &&
    (isNaN(floor) || parseFloat(e.version) >= floor));
  const count = kind => shown.filter(e => eventState(e).kind === kind).length;
  /* Says what the parts of the list are, so its order is stated rather than
     inferred from the chips — and the tally has to add up to the tiles under
     it, which is why the permanent ones are in it. */
  const sub = [[count("live") + count("warn"), "running"], [count("soon"), "upcoming"], [count("permanent"), "permanent"]]
    .filter(([k]) => k).map(([k, w]) => `${k} ${w}`).join(" · ") || "Nothing scheduled";
  /* Summed off the tiles below it, so it is the same claim they are making and
     not a second one. An event whose reward line Kuro has not published adds
     nothing rather than a guess, which is why this is "listed". */
  const astrite = shown.reduce((n, e) => n + (astriteFrom(e) || 0), 0);
  return `<div class="panel">
    <div class="panel-h"><h2>Events</h2><span class="sub">${esc(sub)}</span>
      ${astrite ? `<span class="sub astrite" title="Astrite listed across these events. An event Kuro has not published a reward line for counts as nothing.">
        ${astriteMark(16)}${astriteLabel(astrite)}</span>` : ""}</div>
    <div class="panel-b">${shown.length
      ? `<div class="evgrid">${shown.map(eventCard).join("")}</div>`
      : `<div class="empty">${S.when === "current" ? "Nothing running right now."
          : S.when === "upcoming" ? "Nothing announced past the events already running."
          : "Nothing running, and nothing announced yet."}</div>`}</div>
  </div>`;
}

/* ── the archive band ────────────────────────────────────────────────
   What the Past window shows instead of the event band. Two reasons it is not
   the same tiles greyed out. The first is that a closed event is not a thing
   you can do — the Events view has made that argument for a while and drops
   them for it. The second is that this is a different question: Past is not
   "what did I miss last fortnight", it is "what was 2.3", and that is answered
   by the patch, not by nine tiles from it.

   So it is a patch per row, newest first, each one carrying the convenes that
   ran in it and a count of its events, and each one opening the version record
   where the events are listed in full. The rows go back to launch because
   resonators.json and archive.json both do. */
function archivePanel(already){
  const live = currentVersion();
  const rows = archive().filter(v =>
    !already.has(v.id) && (!live || cmpVer(v.id, live) < 0));
  if(!rows.length) return `<div class="panel">
    <div class="panel-h"><h2>Archive</h2></div>
    <div class="panel-b"><div class="empty">No closed patch on record yet.</div></div>
  </div>`;
  const events = rows.reduce((n, v) => n + (v.events?.length || 0), 0);
  return `<div class="panel">
    <div class="panel-h"><h2>Archive</h2>
      <span class="sub">${rows.length} patches · ${plural(events, "event")}</span>
      <div class="right"><span class="sub">Every patch the game has shipped</span></div></div>
    <div class="panel-b flush">${rows.map(archiveRow).join("")}</div>
  </div>`;
}

/* The order a patch's cast reads in: the debuts first, then by rarity.

   Date order is what a banner list wants when the question is "what can I pull
   this fortnight", and that is a calendar. It answers nothing here. In the
   archive strip the patch closed months ago and nothing in it is pullable; in
   a phase strip every card in the strip shares one window by definition, so
   sorting them by a date they all hold in common is sorting them by nothing.
   What is left in both places is "who was in it", and that is led by who was
   new. Rarity second, because a 5-star debut and a 4-star rerun are not the
   same size of fact.

   sort() is stable, so anything these two rules tie on keeps the order it
   arrived in — the resonators' own run order in the archive, versions.json's
   hand-written order in a phase. */
const castOrder = bs => [...bs].sort((a, b) =>
  (b.new ? 1 : 0) - (a.new ? 1 : 0) || (b.rarity || 0) - (a.rarity || 0));

/* Who a patch is remembered as. The 4-stars are dropped from both places that
   look back at one — the archive strip and the phase strips in a version
   record — and it is not a space saving, it is the same edit as dropping the
   element chip. A 4-star rerun is not a fact about a patch: every patch has
   five or six of them, they are the same faces over and over down the list,
   and Yuanwu appearing in nine consecutive rows says nothing about any of the
   nine. Two to six 5-stars is what actually distinguished one patch from the
   next, and at that count they can be shown large enough to recognise.

   The rarity is read off the resonator where the banner row has not got one:
   versions.json writes it by hand and the archive's rows are built from run
   history, so only one of the two sources carries it. */
const isFive = b => (b.rarity || resonatorFor(b.name).rarity) === 5;

function archiveRow(v){
  const bs = castOrder(patchBanners(v.id).filter(isFive));
  const n = v.events?.length || 0;
  const win = [v.start ? fmtShort(v.start) : "", v.end ? fmtShort(v.end) : ""]
    .filter(Boolean).join(" → ") || "Undated";
  /* The patch's own key art, behind the row. Not as a band above it: nineteen
     posters at their own 16:9 is a page you scroll rather than a record you
     read, which is the argument that kept this list to type in the first
     place. As a ground it costs no height at all — the row is already as tall
     as the faces standing in it — and it is the same move the timeline's patch
     cards make, where the version block and the banner tiles sit on the art
     rather than beside it.

     A wide row crops a 16:9 poster to a horizontal band through its middle,
     which for every one of these is where Kuro put the characters. Scrimmed
     hard, because eight lines of 10px mono have to stay readable over it and
     the faces in front are the subject — see .arcp-kv. */
  const kv = v.keyVisual?.url
    ? `<div class="arcp-kv" aria-hidden="true">
         <img src="${esc(cdnWidth(v.keyVisual.url, 1400))}" alt="" loading="lazy" decoding="async">
       </div>`
    : "";
  return `<article class="arcp${kv ? " arted" : ""}" role="button" tabindex="0" data-act="version" data-id="${esc(v.id)}"
           aria-label="Version ${esc(v.id)}${v.title ? ` — ${esc(v.title)}` : ""}, ${win}">
    ${kv}
    <div class="arcp-h">
      <span class="arcp-v">${esc(v.id)}</span>
      <div class="arcp-t">
        ${v.title ? `<b>${esc(v.title)}</b>` : `<b class="thin">No codename on record</b>`}
        <span>${esc(win)}</span>
      </div>
      <span class="arcp-n">${n ? plural(n, "event") : "no events on record"}</span>
      <span class="arrow">${icon("i-arrow", 12)}</span>
    </div>
    ${bs.length
      /* The wrapping strip of faces, not the one-per-row list the patch cards
         use. Nineteen patches of four-line lists is a page twenty thousand
         pixels tall — the archive is a list of patches, and inside a row the
         convenes are a line of faces you scan, not four rows you read. */
      /* One track per convene was the first answer here, back when the strip
         carried the 4-stars too and every patch had eight to twelve of them.
         With only the debut class left a patch has two to six, and a track per
         convene would set a two-character patch at three times the size of a
         six-character one. The tracks are a fixed width now — see
         .arcp .bstrip.wide — which is what makes every face in the archive the
         same size as every other, whatever the patch it belongs to. */
      ? `<div class="bstrip wide">${bs.map(b => thumb(b, {
          showPhase:false, showNew:true, showWeapon:false,
          /* The tint stays, the word goes; and the name is one fixed size
             rather than fitted per box — see .arcp .bstrip.wide. */
          showAttr:false, fitName:false})).join("")}</div>`
      /* A patch with no convene in it is a real thing — 1.2 ran a rerun the
         desk has no run record for — and saying so is better than an empty
         strip that reads as a loading failure. */
      : `<div class="arcp-none">No convene on record for this patch</div>`}
  </article>`;
}

/* One event as a row rather than a tile. The tiles are for the fortnight you
   are in: a picture, a state chip and a number you can act on. A patch that
   closed a year ago wants the list instead — what ran, what kind of thing it
   was, and when. A row the desk holds a record for opens that record; a row
   that exists only in the archive links out to where it came from, because
   there is nothing here for it to open. */
function eventRow(ev, showArt){
  const known = !String(ev.id || "").startsWith("arc-");
  const win = ev.permanent ? "Permanent"
    : ev.start || ev.end
      ? `${ev.start ? fmtShort(ev.start) : "—"} → ${ev.end ? fmtShort(ev.end) : "—"}`
      : "";
  /* The banner, where the desk holds one for this event.

     Two rules, and the second is the one that matters. Within a list that is
     showing pictures, every row gets the slot whether or not it resolves —
     otherwise two rows of thirteen are pictures and the other eleven start
     their text at a different x, which reads as a rendering fault; the ones
     that miss get the desk's own rings, the same mark it shows anywhere else
     it has no picture.

     Whether the list shows pictures at all is decided once, by the patch, and
     that is `showArt`. A patch the desk holds nothing for is most of them —
     archive.json has no banners and the permanent modes only cover about one
     archived event in ten — and turning the column on regardless would trade a
     tight list of names and dates for a column of identical rings pretending
     to be a gallery. Nothing to show, nothing shown. */
  const art = showArt ? eventArt(ev) : null;
  const pic = !showArt ? "" : `<span class="pev-art">${art
    ? `<img src="${esc(artUrl(art, 320))}" alt="" loading="lazy" decoding="async"${
        art.focus && !art.nameplate ? ` style="object-position:${esc(art.focus)}"` : ""}>`
    : `<span class="ev-plate" aria-hidden="true"></span>`}</span>`;
  const inner = `${pic}<span class="pev-k">${esc(ev.kind || "Event")}</span>
    <b class="pev-n">${esc(ev.name)}</b>
    <span class="pev-d">${esc(win)}</span>
    <span class="arrow">${icon("i-arrow", 12)}</span>`;
  return known
    ? `<span class="pev" role="button" tabindex="0" data-act="event" data-id="${esc(ev.id)}">${inner}</span>`
    : `<a class="pev" href="${esc(ev.notice || ev.source || "#")}" target="_blank" rel="noopener"
         title="${esc(ev.notice ? "Kuro's own notice for this event" : "This event on the wiki")}">${inner}</a>`;
}

/* The view. The same cards, grouped by patch instead of capped — one panel per
   version, live patch first, then everything the game keeps.

   What it does not carry is a closed event. This was an archive for a while,
   and an archive is the wrong thing for it to be: a patch's events all end on
   the same Tuesday, so the day a patch turns over, the top of this page became
   nine tiles greyed out and the new patch sat under them. Nothing on a closed
   event is actionable — you cannot go and do it — and the desk keeps no
   history of one anywhere else, so there is nothing here for it to be the
   index of. It falls off the page when it closes, and the patch it belonged to
   falls off with the last of them.

   Permanent events are pulled out into their own section rather than filed
   under the patch that shipped them. They have no deadline, which is the one
   thing the patch panels are sorted by, and half of them predate any patch the
   desk holds a record of. See gameEvents() for where that list comes from. */
function renderEvents(){
  const permanent = [], groups = [];
  for(const ev of eventList()){
    if(ev.permanent){ permanent.push(ev); continue; }
    if(eventState(ev).kind === "past") continue;
    const row = groups.find(g => g.id === ev.version);
    if(row) row.items.push(ev);
    else groups.push({id:ev.version, items:[ev]});
  }
  /* eventList sorts by what is running, which mixes the patches; the view is
     grouped, so the groups themselves go in patch order. */
  groups.sort((a, b) => {
    const rank = id => {
      const s = statusOf(versions().find(v => v.id === id) || {});
      return s === "live" ? 0 : s === "announced" ? 1 : s === "beta" ? 2 : 3;
    };
    return rank(a.id) - rank(b.id) || parseFloat(b.id) - parseFloat(a.id);
  });

  const sections = groups.map(({id, items}) => {
    const v = versions().find(x => x.id === id);
    const status = v ? statusOf(v) : "";
    const win = v ? patchWindow(v) : null;
    const dated = items.filter(e => e.start || e.end || e.permanent).length;
    return `<div class="panel">
      <div class="panel-h">
        <h2>${esc(id)}${v?.title ? ` — ${esc(v.title)}` : ""}</h2>
        <span class="sub">${plural(items.length, "event")}${dated ? "" : " · undated"}</span>
        <div class="right">
          ${status ? `<span class="pill ${status === "live" ? "live" : status === "announced" ? "next" : "future"}">${esc(status)}</span>` : ""}
          ${win ? `<span class="sub">${fmtShort(win.start)} → ${fmtShort(win.end)}${win.est ? " est" : ""}</span>` : ""}
          <button class="more" data-act="version" data-id="${esc(id)}">Patch ${icon("i-arrow", 12)}</button>
        </div>
      </div>
      <div class="panel-b"><div class="evgrid">${items.map(eventCard).join("")}</div></div>
    </div>`;
  }).join("");

  /* Newest first: the far end of this list is launch day 2024, and the thing
     a reader has most plausibly not done yet is the one that arrived last.

     No headline tile. That flag is Kuro's patch having one big event at its
     centre, which is a true thing about a fortnight and a meaningless one
     about a two-year list — a permanent event that happened to be its patch's
     headline is not the headline of *this* section, and taking double the
     width says it is. */
  const standing = [...permanent]
    .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")))
    .map(e => e.headline ? {...e, headline:false} : e);
  /* Same claim the patch panels make, summed off the same tiles. */
  const permAstrite = standing.reduce((n, e) => n + (astriteFrom(e) || 0), 0);
  const permSection = standing.length ? `<div class="panel">
    <div class="panel-h">
      <h2>Permanent</h2>
      <span class="sub">${plural(standing.length, "event")} · no closing date</span>
      <div class="right">
        ${permAstrite ? `<span class="sub astrite" title="Astrite listed across the permanent events. One with no published reward line counts as nothing.">
          ${astriteMark(16)}${astriteLabel(permAstrite)}</span>` : ""}
      </div>
    </div>
    <div class="panel-b"><div class="evgrid">${standing.map(eventCard).join("")}</div></div>
  </div>` : "";

  const src = DATA.events?.updated ? fmtDate(DATA.events.updated) : "";
  $("#p-events").innerHTML = `<div class="stack">
    ${pageTitle("events")}
    ${sections || `<div class="panel"><div class="empty">Nothing running, and nothing announced yet.</div></div>`}
    ${permSection}
    <div class="panel"><div class="panel-f">
      <span class="tier-note">Read off Kuro's own patch notes and event notices${src ? `, last ${esc(src)}` : ""} — windows in your own timezone, art only where Kuro has published a banner. A patch Kuro has announced but not yet written up carries what the preview broadcast said and no dates, because there are none to carry. An event that has closed drops off this page; nothing here is an archive. The permanent list comes from the Wuthering Waves Wiki on Fandom instead — Kuro's news feed no longer carries the posts that announced the older ones.</span>
    </div></div>
  </div>`;
}

/* Kuro publishes windows in server time and events.json keeps the offset, so
   these render in whatever zone the reader is in — which is the whole reason
   the offset is kept rather than the date being flattened on the way in. */
function eventTimes(ev){
  const {start, end, inherited, est} = eventWindow(ev);
  const one = d => `${fmtDate(d)}${inherited ? "" : `, ${fmtTime(d)}`}`;
  if(ev.permanent) return "Permanent";
  if(!start && !end) return "Not announced";
  return [start ? one(start) : "", end ? one(end) : ""].filter(Boolean).join(" → ") + (est ? " (est)" : "");
}

/* ── the event record ──────────────────────────────────────────────
   What a tile opens onto. Every other record on the desk is a page of facts
   with a picture on it; this one is the other way round, because an event is
   something you look at before it is something you read — the question a
   reader arrives with is *what is this and what does it pay*, and both of
   those answer better as pictures than as prose.

   So: Kuro's banner across the top with the name, the window and the state set
   into it; their own screenshots of the mode under it; and the rewards as the
   items themselves rather than as the sentence Kuro listed them in.

   Nothing in here is invented. No frame that Kuro did not publish, no icon
   that isn't the game's own, and an event they have written a name and nothing
   else for collapses to the name — the plates below are what that looks like. */

/* Twin of `rewardTokens` in scripts/fetch-items.mjs, and they have to stay
   one: that script decides which names get an icon fetched, this one decides
   which name is looked up when the record draws. Change one, change the other.

   Two shapes arrive. A hand-written entry lists rewards one to an array slot
   ("Astrite x1200"); a fetched one keeps Kuro's own sentence with the whole
   table in it. Both put the count after the word and the qualifier in
   brackets, which is the only reason one reader can take both. */
const REWARD_DASH  = /\s+[—–-]\s+/;
const REWARD_MORE  = /^(and\s+)?other\s+(materials|rewards)$/i;
const REWARD_BONUS = /^double\b.*\brewards$/i;

function rewardTokens(rewards){
  const raw = Array.isArray(rewards)
    ? rewards.filter(Boolean).map(String)
    /* Commas, except the ones inside a bracketed qualifier. */
    : String(rewards || "").trim().replace(/\.\s*$/, "").split(/,(?![^(]*\))/);

  return raw.map(s => {
    let name = String(s).trim().replace(/^and\s+/i, "").replace(/\.\s*$/, "");
    if(!name) return null;
    /* "and other materials" is Kuro declining to finish the list, and "Double
       Tacet Suppression rewards" is a multiplier on somebody else's table.
       Neither is a thing with an icon, and both are worth showing as what they
       are rather than being dropped for not fitting the grid. */
    if(REWARD_MORE.test(name))  return {kind:"more", name};
    if(REWARD_BONUS.test(name)) return {kind:"bonus", name};

    let qty = null, tag = null;
    const q = /\s*[x×]\s*([\d][\d,]*)\s*$/i.exec(name);
    if(q){ qty = Number(q[1].replace(/,/g, "")); name = name.slice(0, q.index).trim(); }
    /* "(Title)", "(Event Sigil)", "(Event Avatar)" — what kind of thing it is,
       which the tile shows as a badge rather than as part of the name. */
    const t = /\(([^()]+)\)\s*$/.exec(name);
    if(t){ tag = t[1].trim(); name = name.slice(0, t.index).trim(); }
    /* Kuro writes the same compound both ways depending who typed the post.
       One spelling, so both find the same icon. */
    name = name.replace(REWARD_DASH, " — ");
    return name ? {kind:"item", name, qty, tag} : null;
  }).filter(Boolean);
}

const itemFor = name => DATA.items?.items?.[name] || null;

/* One reward, as the thing itself. `page` in items.json names which half of a
   compound is the item and which is the qualifier — Kuro puts the qualifier on
   the left in "Phantom — Myriad Snare: Rustfire Chassis" and on the right in
   "Forgery Premium Supply — Lahai-Roi" — so the tile can set the item large
   and the qualifier under it instead of running 40 characters across a 150px
   card. */
function rewardTile(t){
  if(t.kind === "bonus")
    return `<div class="loot wide">
      <span class="loot-pic glyph">${icon("i-events", 22)}</span>
      <span class="loot-t"><b>${esc(t.name)}</b>
        <em>A multiplier on another mode's table, not a payout of its own</em></span>
    </div>`;
  if(t.kind === "more")
    return `<div class="loot wide">
      <span class="loot-pic glyph">${icon("i-info", 22)}</span>
      <span class="loot-t"><b>And other materials</b>
        <em>Where Kuro's own reward line stops. The rest is only in the game.</em></span>
    </div>`;

  const it = itemFor(t.name);
  const halves = t.name.split(" — ");
  let main = t.name, sub = "";
  if(halves.length === 2){
    /* The half the wiki answered under is the item; the other one qualifies it.
       With no icon resolved there is nothing to go on, so keep Kuro's order. */
    const itemFirst = !it?.page || it.page.startsWith(halves[0]);
    main = itemFirst ? halves[0] : halves[1];
    sub  = itemFirst ? halves[1] : halves[0];
  }
  main = main.replace(/^["“](.+)["”]$/, "$1");

  const hint = [it?.type, it?.description].filter(Boolean).join(" — ");
  return `<div class="loot${it?.rarity ? ` r${it.rarity}` : ""}"${hint ? ` title="${esc(hint)}"` : ""}>
    <span class="loot-pic">${it?.icon
      ? `<img src="${esc(it.icon)}" alt="" loading="lazy" decoding="async">`
      /* Nobody has an icon for a title or an event avatar — they are a line of
         text and a picture the game never hands out as an item. The plate says
         which kind of thing it is rather than borrowing a picture of another. */
      : `<span class="loot-plate">${esc(t.tag || "No icon")}</span>`}</span>
    <span class="loot-t">
      <b>${esc(main)}</b>
      ${sub ? `<em>${esc(sub)}</em>` : ""}
    </span>
    <span class="loot-f">
      ${t.qty ? `<span class="loot-q">×${t.qty.toLocaleString("en-GB")}</span>` : ""}
      ${t.tag && it?.icon ? `<span class="loot-tag">${esc(t.tag)}</span>` : ""}
    </span>
  </div>`;
}

/* Every picture Kuro has published of this event, banner first. The banner is
   the poster; what follows it is the mode actually being played, which is the
   only place that exists — the overview post has no pictures and the
   infographic is a poster too. `media` is empty for most events and the reel
   just doesn't draw; it fills in by itself the day the notice lands. */
function eventFrames(ev){
  const art = eventArt(ev);
  const out = [];
  if(art) out.push({
    full: artUrl(art, 1600), thumb: artUrl(art, 320),
    cap: art.note || art.title || `${ev.name} — event banner`,
    credit: art.credit || "", source: art.source || ""
  });
  for(const m of ev.media || []) out.push({
    full: cdnWidth(m.url, 1600), thumb: cdnWidth(m.url, 320),
    cap: m.title || `${ev.name} — Kuro Games`,
    credit: m.credit || "", source: m.source || ""
  });
  return out;
}

/* Swap the frame under the reel. Repaints rather than redrawing: the whole
   record is one innerHTML write, and rebuilding it to change an `src` would
   throw away the reader's scroll position halfway down a page of rewards. */
function paintReel(i){
  const wrap = $(".evr-reel");
  const f = (S.reel || [])[i];
  if(!wrap || !f) return;
  S.reelAt = i;
  const img = wrap.querySelector(".evr-frame img");
  img.src = f.full;
  img.alt = f.cap;
  wrap.querySelector(".evr-cap-t").textContent = f.cap + (f.credit ? ` — ${f.credit}` : "");
  const a = wrap.querySelector(".evr-cap a");
  if(a){ a.href = f.source || "#"; a.hidden = !f.source; }
  wrap.querySelectorAll(".evr-thumb").forEach((b, n) =>
    b.setAttribute("aria-current", String(n === i)));
}

/* The gate on an event, as a number. Kuro writes it as a sentence and the
   sentence is kept — this is only what the dial reads. */
const unionLevel = ev => Number(/union\s+level\s+(\d+)/i.exec(ev.eligibility || "")?.[1]) || null;

function drawerEvent(id){
  const ev = gameEvents().find(x => x.id === id);
  if(!ev) return;
  const tier = TIERS.includes(ev.confidence) ? ev.confidence : "rumour";
  const art = eventArt(ev);
  const win = eventWindow(ev);
  const st = eventState(ev);
  const v = versions().find(x => x.id === ev.version);
  const intel = ev.intel ? entries().find(e => e.id === ev.intel) : null;
  const astrite = astriteFrom(ev);
  const loot = rewardTokens(ev.rewards);
  const ul = unionLevel(ev);

  const frames = eventFrames(ev);
  S.reel = frames;
  S.reelAt = 0;

  /* Does this banner already say the event's name?
     It decides the whole hero. A picture with no name on it can carry the
     record's own title in a gradient across it, which is the look. One that
     already has Kuro's name plate on it cannot — a second title over the top
     is two titles fighting, and whichever loses is the one that gets cut in
     half. Those are shown whole instead, beside the title rather than under
     it. Same judgement the tiles have always made.

     A standalone notice banner always has its name on it; that is what makes
     it a notice banner. A crop out of the update-content sheet usually doesn't
     — Kuro draws those as art, which is the only reason a band of the sheet
     can be cut out and used at all — but the utility events get a title strip
     rather than a picture, so `art.nameplate` overrides the default either
     way, and is set by hand alongside `art.crop`. */
  const plated = !!art && (art.nameplate ?? !art.crop);

  const pic = art
    ? `<div class="evr-pic">
        <img src="${esc(artUrl(art, 1600))}" alt="${esc(ev.name)} event banner" decoding="async"
             ${art.focus ? `style="object-position:${esc(art.focus)}"` : ""}>
      </div>`
    /* The same resonance rings the tile draws when Kuro has published no
       banner — the desk's own mark for a thing it knows is coming and has
       nothing to show of, rather than a second way of saying it. */
    : `<div class="evr-pic none">
        <div class="ev-plate" aria-hidden="true"><span>${esc(plateNote(ev))}</span></div>
      </div>`;

  const dates = ev.permanent
    /* A permanent event has no window, but it does have a day it arrived, and
       that is the useful half: it says whether this is something you have had
       two years to get round to or something that landed with the patch. */
    ? `<span class="evr-perm">Permanent${ev.start ? ` — in the game since ${esc(fmtDate(ev.start))}` : " — no closing date"}</span>`
    : win.start || win.end
      ? `<span class="evr-range">
          <b>${esc(win.start ? fmtDate(win.start) : "—")}</b>
          ${win.start && !win.inherited ? `<i>${esc(fmtTime(win.start))}</i>` : ""}
          <span class="evr-to">${icon("i-arrow", 12)}</span>
          <b>${esc(win.end ? fmtDate(win.end) : "—")}</b>
          ${win.end && !win.inherited ? `<i>${esc(fmtTime(win.end))}</i>` : ""}
          ${win.est ? `<span class="evr-est">est</span>` : ""}
        </span>`
      : `<span class="evr-perm">Kuro has not dated this one yet</span>`;

  /* The four facts that decide whether to open the game tonight, on one line
     under the picture. Same numbers as the strip on the tile, said in full. */
  const strip = [
    ["i-timeline", "Runs", eventTimes(ev)],
    ["i-events", "Mode", ev.kind || "Event"],
    ["i-info", "Whose dates", ev.permanent
      ? "Opened once and never closes"
      : win.inherited
        ? `Patch ${ev.version}'s — the event's own are not out`
        : "The event's own, in your clock"],
    /* Half the permanent list is older than any patch the desk keeps a record
       of — Echo Hunters has been in the game since launch day — so the slot
       says when it arrived instead of naming a patch nothing can link to. */
    ["i-kuro", "Patch", v?.title ? `${v.id} — ${v.title}` : ev.version
      || (ev.start ? `Not recorded — arrived ${fmtDate(ev.start)}` : "Not recorded")]
  ];

  /* Only when there is more than one picture. The hero is already showing the
     banner; a reel of exactly that frame, six inches lower, is the same
     photograph printed twice and reads as a mistake rather than as a gallery.
     Most events are in that state today and the record simply gives the width
     to the writing — the reel appears by itself the day Kuro's own notice for
     the event lands with its screenshots in it. */
  const reel = frames.length > 1 ? `<figure class="evr-reel">
    <div class="evr-frame">
      <img src="${esc(frames[0].full)}" alt="${esc(frames[0].cap)}" loading="lazy" decoding="async">
    </div>
    ${frames.length > 1 ? `<div class="evr-thumbs" role="group" aria-label="Pictures of this event">
      ${frames.map((f, i) => `<button class="evr-thumb" data-act="reel" data-id="${i}"
        aria-current="${i === 0}" aria-label="Picture ${i + 1} of ${frames.length}">
        <img src="${esc(f.thumb)}" alt="" loading="lazy" decoding="async"></button>`).join("")}
    </div>` : ""}
    <figcaption class="evr-cap"><span class="evr-cap-t">${esc(frames[0].cap)}${
      frames[0].credit ? ` — ${esc(frames[0].credit)}` : ""}</span>
      <a href="${esc(frames[0].source || "#")}" target="_blank" rel="noopener"${
        frames[0].source ? "" : " hidden"}>Source</a></figcaption>
  </figure>` : "";

  /* The reel is the left column and the writing is the right one, so an event
     with no picture at all doesn't leave a hole where one would have been —
     the prose takes the width instead. */
  const about = `<div class="evr-about">
    <span class="label">What it is</span>
    ${ev.detail ? `<p>${esc(ev.detail)}</p>` : ev.summary ? `<p>${esc(ev.summary)}</p>`
      : `<p class="evr-thin">Kuro has announced this one by name and written nothing else about it yet.</p>`}
  </div>`;

  const facts = [
    ["Kind", ev.kind || "Event"],
    ["Filed under", ev.section || "Special Events"],
    ["Confidence", TIER_LABEL[tier]],
    ["Written by",
      ev.origin === "kuro" ? "Kuro's own post, read by the fetcher"
      /* The permanent list. Kuro announced these too, years ago in most cases,
         and the news feed no longer carries the post — so the wiki is the
         record, and the record says so rather than implying a post the desk
         could go and show you. */
      : ev.origin === "wiki" ? "The Wuthering Waves Wiki on Fandom"
      : "Hand, off a broadcast"]
  ];

  openDrawer("Event", `<div class="drawer-b evrec">
    <header class="evr-hero${plated ? " plated" : ""}${art ? "" : " bare"}">
      ${pic}
      <div class="evr-copy">
        <div class="meta">
          ${tierBadge(tier, tier === "official")}
          ${ev.version ? `<span class="pill ver">${esc(ev.version)}</span>` : ""}
          ${ev.kind ? `<span class="pill">${esc(ev.kind)}</span>` : ""}
          <span class="ev-state ${st.cls}">${esc(st.text)}</span>
        </div>
        <h2>${esc(ev.name)}${ev.nameCN ? `<span class="cjk">${esc(ev.nameCN)}</span>` : ""}</h2>
        ${ev.summary ? `<p class="evr-sum">${esc(ev.summary)}</p>` : ""}
        <div class="evr-when">
          <span class="evr-dates">${icon("i-timeline", 13)}${dates}</span>
        </div>
        ${ev.source ? `<a class="evr-cta" href="${esc(ev.source)}" target="_blank" rel="noopener">
          ${esc(ev.origin === "kuro" ? "Kuro's event notice"
              : ev.origin === "wiki" ? "This event on the wiki"
              : "Kuro's version preview")}
          ${icon("i-arrow", 13)}</a>` : ""}
      </div>
    </header>

    <div class="evr-strip">
      ${strip.map(([ic, k, val]) => `<div>${icon(ic, 15)}
        <span><em>${esc(k)}</em><b>${esc(val)}</b></span></div>`).join("")}
    </div>

    <div class="evr-mid${reel ? "" : " solo"}">${reel}${about}</div>

    ${loot.length ? `<section class="dsec evr-loot">
      <div class="dsec-h"><span class="label">What it pays</span>
        ${astrite ? `<span class="ev-astrite inline">${astriteMark(18)}
          <b>${astriteLabel(astrite)}</b></span>` : ""}</div>
      <div class="lootgrid">${loot.map(rewardTile).join("")}</div>
      <p class="tier-note">${ev.origin === "wiki"
        ? "The wiki's reward table for this event, item by item."
        : "Kuro's own reward line, item by item."} Item art © Kuro Games, via the
        Wuthering Waves Wiki on Fandom.</p>
    </section>` : ""}

    <div class="evr-cols">
      <div class="evr-box">
        <span class="label">Event details</span>
        <div class="dgear">${facts.map(([k, val]) =>
          `<div><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join("")}</div>
      </div>

      <div class="evr-box">
        <span class="label">Who can play it</span>
        ${ul ? `<div class="evr-gate">
          <span class="evr-dial" aria-hidden="true"><b>${ul}</b></span>
          <span class="evr-gate-t"><em>Union Level</em><b>${ul} and up</b></span>
        </div>` : ""}
        ${ev.eligibility
          ? `<p>${esc(ev.eligibility)}</p>`
          : `<p class="evr-thin">Kuro has not published a requirement for this one.</p>`}
      </div>

      <div class="evr-box">
        <span class="label">Where this comes from</span>
        ${ev.source ? `<a class="dsrc" href="${esc(ev.source)}" target="_blank" rel="noopener">
          <span class="lang">EN</span>${esc(ev.origin === "kuro"
            ? "Kuro Games — official notice" : "Kuro Games — version preview")}
          <span class="arrow">${icon("i-arrow", 13)}</span></a>` : ""}
        ${intel ? `<span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(intel.id)}">
          <i class="dot t-${esc(intel.confidence)}" style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></i>
          ${esc(intel.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>` : ""}
        <span class="dsrc" role="button" tabindex="0" data-act="version" data-id="${esc(ev.version)}">
          Version ${esc(ev.version)} — its banners, phases and everything else in it
          <span class="arrow">${icon("i-arrow", 13)}</span></span>
      </div>
    </div>
  </div>`, `event:${ev.id}`);
}

/* ── pull calculator ──────────────────────────────────────────────
   The Events view says what a patch pays. This says what it costs, which is
   the same question from the other end and the one a reader actually arrives
   with: I want her and her weapon, I have fifteen thousand — is that enough?

   Kuro publishes the guarantee and has never published the curve, and that
   split is the whole design of this view.

   Published, in the Convene Details attached to every banner: a 5-star is
   guaranteed within 80 Convenes on both limited banners; the featured
   Resonator is a 50/50 on the first 5-star and guaranteed on the next if that
   one loses; the Featured Weapon Convene has no 50/50 at all, so the 5-star it
   gives you is always the weapon on the poster. Pity and the guarantee carry
   from one Featured Resonator Convene to the next, and are never shared with
   the weapon banner, which keeps a counter of its own.

   Not published, and never has been: the rate curve that makes most 5-stars
   arrive well before 80. Everyone agrees it starts climbing around 66 and
   nobody outside Kuro knows the shape of it.

   So every figure on this page is the guarantee arithmetic and nothing else —
   the pull at which the outcome stops being a question. That is a ceiling and
   not a prediction, and the page says so. It is also the number worth
   budgeting against: a plan built on the average is a plan that fails half
   the time, and the reader asking this question is the reader who does not
   want to be 60 pulls short on the last day of a phase. */
const CONVENE = {
  pity:80,      /* 5-star guaranteed within 80 Convenes, both limited banners */
  soft:66       /* where the rate is agreed to start climbing — quoted, never summed */
};

const intOf    = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, intOf(v)));

/* ── the odds ─────────────────────────────────────────────────────
   Everything else on this view is arithmetic over numbers Kuro publishes.
   This is not, and it is labelled twice because of it.

   The *shape* of the curve is the community's and always has been: a flat 0.8%
   until the rate starts climbing around 66, then a ramp to a certain 5-star at
   80. Kuro has never published it and probably never will.

   The *scale* is not guesswork, though, and this is the part that makes the
   block defensible. Kuro does publish a comprehensive probability — 1.8%,
   which is one over the average number of Convenes a 5-star takes — and that
   single figure pins the one free parameter in the model. A 2% step per pull
   from 66 puts the average at 55.60 Convenes, or 1.7985%, against Kuro's
   1.80%. Steeper ramps overshoot: 4% a pull, the figure most calculators use,
   lands at 1.84% and quietly makes everybody luckier than Kuro says they are.

   So: assumed shape, fitted scale, and a model either way. The worst case
   above it is the number a reader can actually hold Kuro to. */
const CONVENE_RAMP = 0.02;

function fiveStarRate(n){
  if(n >= CONVENE.pity) return 1;
  return n < CONVENE.soft ? 0.008 : Math.min(1, 0.008 + CONVENE_RAMP * (n - CONVENE.soft + 1));
}

/* P(the next 5-star lands exactly n pulls from now), given the pity already
   carried into it. Index 0 is left empty so these convolve as pull counts. */
function fiveStarDist(carried){
  const out = [0];
  let alive = 1;
  for(let n = 1; n + carried <= CONVENE.pity; n++){
    const p = alive * fiveStarRate(n + carried);
    out[n] = p;
    alive -= p;
  }
  return out;
}

/* Two independent waits add by convolution, which is what lets the whole plan
   be one distribution: lose a 50/50 and you are waiting for a second 5-star,
   chase two characters and you are waiting for both. */
function convolve(a, b){
  const out = new Array(a.length + b.length - 1).fill(0);
  for(let i = 0; i < a.length; i++){
    if(!a[i]) continue;
    for(let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}
function mixDist(a, wa, b, wb){
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for(let i = 0; i < out.length; i++) out[i] = (a[i] || 0) * wa + (b[i] || 0) * wb;
  return out;
}

/* The patches worth planning against: the one running now, the one Kuro has
   announced, and the beta.

   The beta used to be left out on the grounds that a 3.7 banner list is a
   rumour and a rumour in a budget is worse than nothing. That was the right
   worry and the wrong conclusion. The thing a reader saves for is the patch
   after this one, and by the time Kuro publishes a banner list the saving has
   already had to happen. What the desk shows for it is not a rumour either:
   Kuro reveals the next patch's Resonators long before their banners, and
   those two names are tagged `identity: official` in the database. So the
   patch goes in, with what is actually known about it and nothing more. */
const pullPatches = () => [liveVersion(), nextVersion(), futureVersion()].filter(Boolean);

/* One row per 5-star banner: the Resonator, and the weapon Kuro runs beside
   them. Both are targets and they cost differently, which is the reason this
   view is not a single number — the weapon is 80 pulls flat and the character
   can be twice that. */
/* The weapon convene that runs beside a 5-star banner, named where the desk
   knows the name and a placeholder where it does not.

   The placeholder is a real claim and worth being clear about what it rests
   on. Kuro has never once run a 5-star Resonator banner without a Featured
   Weapon Convene beside it — 3.6 runs two featured weapons against Phase 1's
   two banners and three against Phase 2's three, and every patch on the
   archive does the same. So the *existence* of the convene is a pattern with
   no exceptions and the eighty pulls it costs are as certain as anything else
   on this page. Only the name is missing, and a name is not what a budget is
   made of.

   Keyed on the holder rather than on the weapon, so it cannot collide with a
   real weapon and cannot survive one: the day the signature is recorded this
   returns the genuine article under its own key and the placeholder is gone. */
function sigTarget(holder, w){
  if(w && w.rarity === 5)
    return {key:`w:${w.name}`, kind:"weapon", name:w.name, icon:w.icon || "", holder};
  return {
    key:`w:?${holder}`, kind:"weapon", name:`${holder}'s signature`,
    icon:"", holder, unnamed:true
  };
}

function pullTargets(){
  const out = [];
  for(const v of pullPatches()){
    const status = statusOf(v);
    /* Every 5-star this patch has a banner row for, closed phases included.
       Built before anything is emitted because the teased pass below needs it,
       and a name in a phase that has already run is still a name Kuro has
       scheduled — leaving it out here would resurrect Phase 1's debut as an
       unscheduled Resonator the day Phase 1 closed. */
    const scheduled = new Set();
    for(const p of v.phases || [])
      for(const b of p.banners || [])
        if(b.name) scheduled.add(b.name.toLowerCase());

    for(const p of v.phases || []){
      /* A phase that has closed is not a plan, it is a regret. Phase 1 drops
         off this page the day it ends, which is also the day its pity stops
         being worth carrying anywhere except into Phase 2 — where the reader
         still standing on this view is now aiming. */
      if(p.end && daysTo(p.end) < 0) continue;
      for(const b of p.banners || []){
        if(b.rarity !== 5 || !b.name || b.name === "???") continue;
        /* A brand-new character's signature is named on the banner row weeks
           before it is in weapons.json, so a weapon the file has never heard
           of is taken at its word and counted as a 5-star: Kuro has not once
           run a 5-star Resonator banner without one beside it. */
        const w = b.signature ? (weaponFor(b.signature) || {name:b.signature, rarity:5}) : null;
        out.push({
          version:v.id, status, phase:p.n, banner:b,
          window:{start:p.start, end:p.end, est:!!(p.estimated_start || p.estimated_end)},
          res:{key:`r:${b.name}`, kind:"resonator", name:b.name, holder:b.name},
          weap:sigTarget(b.name, w)
        });
      }
    }

    /* Everyone the database files against this patch who has no banner row
       yet. For 3.7 that is Hsin and Suoming: Kuro has named them and named
       nothing else about the patch, so they are the whole line-up as far as
       anybody knows, and a reader saving for them is saving now rather than
       when the banner list lands.

       This is also what makes the announcement automatic. The moment Kuro
       publishes a phase — with the debut and whichever reruns Kuro puts beside
       it — those rows come in through the loop above, `scheduled` catches the
       names, and each one stops being drawn here. A patch mid-announcement
       shows both halves at once: Phase 1 as Kuro published it, and whoever is
       still only teased under it. Nothing here needs editing for any of that.

       The weapon is a placeholder until it has a name — see sigTarget(). */
    for(const r of resonators()){
      if(r.version !== v.id || r.rarity !== 5) continue;
      if(!r.name || scheduled.has(r.name.toLowerCase())) continue;
      const w = r.signature ? (weaponFor(r.signature) || {name:r.signature, rarity:5}) : null;
      out.push({
        version:v.id, status, phase:null,
        banner:{name:r.name, rarity:5, attribute:r.attribute, weapon:r.weapon, new:true},
        window:null,
        res:{key:`r:${r.name}`, kind:"resonator", name:r.name, holder:r.name},
        weap:sigTarget(r.name, w)
      });
    }
  }
  return out;
}

/* What the picked targets cost, walked in the order the patch runs them.

   The order is not cosmetic. Pity carries, so the second character you chase
   starts from whatever the first one left — which is zero, because securing
   one is what resets the counter. Walking Phase 2 before Phase 1 would hand
   the carried pity to the wrong banner and undercount the bill.

   Two counters, never one: the Resonator convene and the weapon convene keep
   their own, and neither can spend the other's. So the two runs are walked
   separately and only the money is added at the end. */
function pullPlan(){
  const cost = Number(DATA.astrite?.pullCost) || 160;
  const P = S.pull;
  const want = new Set(P.want);
  const picked = [];
  for(const t of pullTargets()){
    if(t.res  && want.has(t.res.key))  picked.push({...t.res,  version:t.version, phase:t.phase});
    if(t.weap && want.has(t.weap.key)) picked.push({...t.weap, version:t.version, phase:t.phase});
  }
  if(!picked.length) return null;

  const legs = [];
  let pity = clampInt(P.pity, 0, CONVENE.pity - 1), guar = !!P.guaranteed;
  for(const t of picked.filter(x => x.kind === "resonator")){
    const first = CONVENE.pity - pity;
    const extra = guar ? 0 : CONVENE.pity;
    legs.push({...t, carried:pity, guar, first, extra, lucky:first, worst:first + extra});
    /* Whichever way the 50/50 went, the 5-star that ended this leg reset the
       counter and spent the guarantee. The next character starts from nothing,
       and that is true of the lucky run and the unlucky one alike. */
    pity = 0; guar = false;
  }
  let wpity = clampInt(P.wpity, 0, CONVENE.pity - 1);
  for(const t of picked.filter(x => x.kind === "weapon")){
    const first = CONVENE.pity - wpity;
    legs.push({...t, carried:wpity, guar:true, first, extra:0, lucky:first, worst:first});
    wpity = 0;
  }

  const radiant = Math.max(0, intOf(P.radiant));
  const forging = Math.max(0, intOf(P.forging));
  const held    = Math.max(0, intOf(P.astrite));

  /* Tides are pulls already owned, and each kind buys one banner and not the
     other — Radiant is the Resonator convene, Forging the weapon one. So they
     come off their own side of the bill before anything is priced in Astrite.
     Counting them as one pool would let seven Forging Tides pay for a
     character, which is not a thing the game lets you do. */
  const bill = k => {
    const char = legs.filter(l => l.kind === "resonator").reduce((n, l) => n + l[k], 0);
    const weap = legs.filter(l => l.kind === "weapon").reduce((n, l) => n + l[k], 0);
    const paid = Math.max(0, char - radiant) + Math.max(0, weap - forging);
    const astrite = paid * cost;
    return {
      char, weap, paid, astrite,
      pulls: char + weap,
      tides: (char + weap) - paid,
      short: Math.max(0, astrite - held),
      spare: Math.max(0, held - astrite)
    };
  };

  /* The same walk as the legs above, in distributions rather than in ceilings.
     Win the 50/50 and the first 5-star is the one you wanted; lose it and you
     are waiting for a second, which is those two waits convolved. */
  let dist = [1];
  let dp = clampInt(P.pity, 0, CONVENE.pity - 1), dg = !!P.guaranteed;
  for(const t of picked.filter(x => x.kind === "resonator")){
    const first = fiveStarDist(dp);
    dist = convolve(dist, dg ? first : mixDist(first, .5, convolve(first, fiveStarDist(0)), .5));
    dp = 0; dg = false;
  }
  let dw = clampInt(P.wpity, 0, CONVENE.pity - 1);
  for(const t of picked.filter(x => x.kind === "weapon")){
    dist = convolve(dist, fiveStarDist(dw));
    dw = 0;
  }
  const cum = [];
  for(let i = 0, run = 0; i < dist.length; i++){ run += dist[i]; cum[i] = run; }
  const quantile = q => { for(let i = 0; i < cum.length; i++) if(cum[i] >= q) return i; return cum.length - 1; };
  /* Pooled rather than split by banner, unlike the bill above. Astrite really
     is fungible between the two convenes; the Tides are not, so a plan leaning
     hard on Tides is a shade worse than this says. It is a modelled figure read
     to the nearest per cent, and splitting it would be false precision. */
  const afford = Math.floor(held / cost) + radiant + forging;

  /* What the patches these targets run in are estimated to pay, so the
     shortfall can be read against the income rather than against nothing. The
     free-to-play track, because that is the floor and a floor is what a
     worst-case figure deserves to be compared with. */
  const patches = [...new Set(legs.map(l => l.version))]
    .map(id => versions().find(v => v.id === id))
    .filter(Boolean)
    .map(v => ({v, plan:astritePlan(v)}))
    .filter(x => x.plan?.tracks?.length);

  return {
    cost, legs, held, radiant, forging, patches,
    income: patches.reduce((n, x) => n + (Number(x.plan.tracks[0].astrite) || 0), 0),
    worst: bill("worst"),
    lucky: bill("lucky"),
    odds: {
      afford,
      chance: cum[Math.min(afford, cum.length - 1)] || 0,
      median: quantile(.5),
      high:   quantile(.9)
    }
  };
}

/* ── the picker ───────────────────────────────────────────────────── */
function pullCard(t, want){
  const r = resonatorFor(t.banner.name);
  const f = figure(t.banner);
  const face = f.icon
    ? `<img src="${esc(f.icon)}" alt="" loading="lazy" decoding="async">`
    : f.image
    ? `<img class="wide" src="${esc(f.image)}" alt="" loading="lazy" decoding="async"${f.style}>`
    : `<span class="g">${esc(f.glyph)}</span>`;
  const attr = t.banner.attribute || r.attribute;
  const run  = t.banner.new ? "New" : t.banner.rerun ? "Rerun" : "";

  /* The card is a third of the picker's column, so every word on it has to
     earn the room. `title` carries the full name for the few weapons that
     still run past the box. */
  const row = (tg, fig, name, sub) => `
    <button class="ptg" data-act="pulltarget" data-id="${esc(tg.key)}"
            aria-pressed="${want.has(tg.key)}" title="${esc(name)}">
      <span class="ptg-fig">${fig}</span>
      <span class="ptg-t"><b>${esc(name)}</b><em>${esc(sub)}</em></span>
      <span class="ptg-box">${icon("i-check", 11)}</span>
    </button>`;

  /* Element and debut, and not the weapon class. Which weapon a Resonator
     swings is a fact about building them, not about whether you want them, and
     it was the word that pushed "FUSION · BROADBLADE · NEW" past the edge of
     the card on every Broadblade in the patch. The record carries it. */
  return `<div class="ptc"${attrStyle(attr)}>
    ${row(t.res, face, t.banner.name,
          [attr, run].filter(Boolean).join(" · ") || "Resonator")}
    ${t.weap ? row(t.weap,
        t.weap.icon
          ? `<img class="wpn" src="${esc(t.weap.icon)}" alt="" loading="lazy" decoding="async">`
          : `<span class="g">${icon("i-weapon", 15)}</span>`,
        t.weap.name, t.weap.unnamed ? "Not announced" : "Signature") : ""}
  </div>`;
}

/* ── the answer ───────────────────────────────────────────────────── */
/* Why a leg costs what it costs, in a sentence. This is the part that makes
   the page a calculator rather than an oracle: 150 on its own is a number to
   be trusted or not, and "70 to the first 5-star, 80 more if that one loses
   the 50/50" is arithmetic a reader can check against their own account. */
function pullWhy(l){
  const from = l.carried
    ? ` (${CONVENE.pity} less the ${l.carried} you are already in)`
    : "";
  if(l.kind === "weapon")
    return `Weapon convene · ${plural(l.first, "pull")} to the guaranteed 5★${from} — this banner has no 50/50, so that 5★ is the weapon`;
  if(l.guar)
    return `Resonator convene · ${plural(l.first, "pull")} to your next 5★${from}, and the guarantee you are holding makes it the featured one`;
  return `Resonator convene · ${plural(l.first, "pull")} to the first 5★${from}, then ${l.extra} more if that one loses the 50/50`;
}

function pullOut(){
  const p = pullPlan();
  if(!p) return `<div class="panel"><div class="empty">
    Pick a Resonator or a weapon above, and this works out the most that securing it can cost.
  </div></div>`;

  const w = p.worst, k = p.lucky;
  const pullsFor = n => Math.ceil(n / p.cost);

  /* The headline is what you still have to find, not what the whole thing
     costs. Those are different numbers and only one of them is a decision: the
     bill is a fact about the banner, the shortfall is a fact about you, and
     the reader who opened this view already knows they want her. A hero
     reading 30,400 made everybody do the same subtraction by hand against a
     figure printed two rows below it.

     The bill is still the anchor, on a summary strip under it that also
     carries what you hold, what your Tides already cover, and the same
     arithmetic with the coin landing right. That last one is a real number —
     it is the 50/50 going your way — but it is a hope, and a hope does not get
     the big type. Folding all three in here is also what collapsed three
     stacked blocks into one, which is most of how this page got shorter. */
  const need = `<div class="phero${w.short ? " short" : " ok"}">
    <div class="phero-top">
      ${astriteMark(40)}
      <span class="phero-fig">
        <b>${numFmt(w.short)}</b><span>Astrite you still need · worst case</span></span>
      ${/* "to guarantee", not "to find": this is the shortfall against the
           worst case, so buying it is the point at which the outcome stops
           being a question rather than the point at which you have enough to
           try. The whole panel is that distinction. */""}
      <span class="phero-pulls">${w.short
        ? `<b>${numFmt(pullsFor(w.short))}</b><span>pulls to guarantee</span>`
        : `<b>${numFmt(w.spare)}</b><span>Astrite to spare</span>`}</span>
    </div>
    <div class="phero-sum">
      <span><em>Total cost</em><b>${numFmt(w.astrite)}</b> · ${plural(w.pulls, "pull")}</span>
      <span><em>You hold</em><b>${numFmt(p.held)}</b></span>
      ${w.tides ? `<span><em>Tides cover</em><b>${numFmt(w.tides)}</b> ${w.tides === 1 ? "pull" : "pulls"}</span>` : ""}
      ${k.pulls !== w.pulls
        ? `<span><em>If the 50/50 lands</em><b>${numFmt(k.astrite)}</b> · ${plural(k.pulls, "pull")}</span>` : ""}
    </div>
  </div>`;

  /* The other lens on the same total, and the only block on the page that is
     not a guarantee. Read against the pulls you can afford today, because
     "62% with what you are holding" is a decision and "62% eventually" is not.

     Rounded to whole per cent and clamped at both ends: a model fitted to a
     figure Kuro published to two significant figures has no business printing
     99.7%, and a reader who sees 100% will hold the page to it. */
  const o = p.odds;
  /* Once you can afford the worst case the answer is not "almost certain", it
     is certain — that is what the guarantee means, and it is the one place the
     model and the published rule meet. Everywhere else it is clamped: a curve
     fitted to a figure Kuro gave to two significant figures has no business
     printing 99.7%, and a reader who sees 100% will hold the page to it. */
  const pctOf = v => o.afford >= w.pulls ? "100"
    : v >= .995 ? "&gt;99" : v < .005 && v > 0 ? "&lt;1" : String(Math.round(v * 100));
  const odds = `<div class="podds">
    <div class="podds-h">
      <span class="label">Chance of getting there</span>
      <span class="aest-tag">Modelled, not published</span>
    </div>
    <div class="podds-b">
      <b>${pctOf(o.chance)}<i>%</i></b>
      <span>with the ${plural(o.afford, "pull")} you can afford today</span>
      <span class="podds-bar" role="presentation">
        <i style="width:${(Math.max(0, Math.min(1, o.chance)) * 100).toFixed(1)}%"></i></span>
    </div>
    <div class="podds-m">
      <span><em>Half get there by</em><b>${numFmt(o.median)}</b> pulls</span>
      <span><em>Nine in ten by</em><b>${numFmt(o.high)}</b> pulls</span>
    </div>
    <p class="podds-f">A model, not a promise, and the one thing on this page you cannot hold Kuro to.
      The ${CONVENE.pity}-Convene guarantee is published and so is the 1.8% comprehensive rate; the curve
      between them never has been, so the shape here is the community's, scaled until it reproduces
      that 1.8%. It describes the shape of your luck. It does not predict it, and no percentage on it
      is a reason to expect anything — the worst case above is the only figure here that is certain.</p>
  </div>`;

  /* The working. The "worst case, everything" row that used to close this list
     went when the hero grew a total: a summed row directly under a summed
     headline is the same number twice, and this page was asked to get shorter.
     What it carried that the hero does not — how the pulls split across the two
     convenes — is a caption on the list now rather than a row in it. */
  const sides = [
    w.char ? `${plural(w.char, "pull")} on the Resonator convene` : "",
    w.weap ? `${plural(w.weap, "pull")} on the weapon convene` : ""
  ].filter(Boolean).join(" · ");

  /* The figure sits against the name, on the name's own line, and the sentence
     that produced it runs underneath. It used to be pinned to the right edge of
     the panel, which on a wide screen left a metre of empty rule between
     "Qingxiao" and the number of pulls Qingxiao costs. */
  const legs = `<ul class="plegs">${p.legs.map(l => `
    <li class="pleg${l.kind === "weapon" ? " wpn" : ""}">
      <span class="pleg-h">
        <b>${esc(l.name)}</b>
        <span class="pleg-n"><b>${numFmt(l.worst)}</b><span>pulls</span></span>
      </span>
      <em>${pullWhy(l)}</em>
    </li>`).join("")}
  </ul>
  ${/* Only once there are enough rows that adding them up is work. On two legs
       the split is the two numbers above it, read in order. */""}
  ${p.legs.length > 2 ? `<div class="plegs-f">${sides}</div>` : ""}`;

  /* Read against what the patch pays, which the desk already models — the one
     comparison that turns a shortfall into a decision. It is an estimate and
     is labelled as one everywhere else on the desk, so it is labelled as one
     here, and the row opens the same breakdown the version record does. */
  const income = p.patches.length ? (() => {
    const names = p.patches.map(x => x.v.id);
    const gap   = Math.max(0, w.short - p.income);
    const line  = !w.short
      ? `You do not need it for this.`
      : gap
      ? `${numFmt(gap)} short even so — ${plural(pullsFor(gap), "pull")}.`
      : `Covers it, with ${numFmt(p.income - w.short)} over.`;
    return `<button class="pincome" data-act="open" data-id="astrite:${esc(names[0])}">
      <span class="label">${names.length > 1 ? `${names.join(" and ")} pay` : `${names[0]} pays`}
        <em>free-to-play clear · estimate</em></span>
      <b>~${numFmt(p.income)}</b>
      <span class="pincome-l">${line}</span>
      <span class="pincome-go">${icon("i-arrow", 13)}</span>
    </button>`;
  })() : "";

  return `<div class="panel">
    <div class="panel-h"><h2>What you need</h2>
      <span class="sub">${plural(p.legs.length, "target")}</span>
      <div class="right"><span class="aest-tag warn">Worst case scenario</span></div>
    </div>
    <div class="panel-b">
      ${/* The ceiling and the odds side by side, because they are one thought:
           what it costs at worst, and how likely you are to pay less. Stacked,
           the hero sat in the left half of a wide panel with nothing beside it
           and the odds were a scroll below — so the three figures a reader
           actually came for were never on screen together. */""}
      <div class="pband">${need}${odds}</div>
      ${legs}
      ${income}
    </div>
    ${/* In this panel's own footer rather than a panel of its own. Every other
         view's caveat gets a card at the foot of the page because it is about
         the whole page; this one is about these figures, it sits directly
         under them, and a separate panel for one sentence was 100px of the
         height this view was asked to give back. */""}
    <div class="panel-f">
      ${/* This used to end "so nothing here averages it", which stopped being
           true the moment the odds block landed. The line the reader needs is
           not that nothing is modelled — it is which half is. */""}
      <span class="tier-note">The ${CONVENE.pity}-Convene guarantee and the 50/50 are Kuro's, published on every banner, and everything outside the dashed box is worked from them alone. Inside it is a model. Ceilings are certain; odds are not.</span>
    </div>
  </div>`;
}

/* The one hint under a field that is arithmetic rather than a label, so the
   one that goes stale the moment you type. Repainted with the answer. */
function pullBuys(){
  const cost = Number(DATA.astrite?.pullCost) || 160;
  const held = Math.max(0, intOf(S.pull.astrite));
  return held
    ? `${plural(Math.floor(held / cost), "pull")} at ${cost}`
    : `${cost} a pull`;
}

function paintPullOut(){
  const el = $("#pull-out");
  if(el) el.innerHTML = pullOut();
  const n = $("#pull-count");
  if(n) n.textContent = plural(S.pull.want.length, "target");
  const buys = $("#pf-h-astrite");
  if(buys) buys.textContent = pullBuys();
}

function renderPulls(){
  const rows = pullTargets();
  const want = new Set(S.pull.want);
  const P = S.pull;

  /* Grouped the way the patch runs, because that is the order you spend in:
     Phase 1 opens before Phase 2, and what you carry into the second is
     whatever the first left you.

     The patch is the outer heading and the phase the inner one, rather than
     one flat list of "3.6 Phase 1" and "3.6 Phase 2" headings. Both phases
     belong to the same forty-two days and the same Astrite income, and
     printing the patch's title twice said they were two different things. */
  const groups = [];
  for(const t of rows){
    let g = groups.find(x => x.version === t.version);
    if(!g) groups.push(g = {version:t.version, status:t.status, phases:[]});
    let ph = g.phases.find(x => x.n === t.phase);
    if(!ph) g.phases.push(ph = {n:t.phase, window:t.window, items:[]});
    ph.items.push(t);
  }
  /* Announced phases first, then whoever has no phase. A null sorts to the end
     rather than to the front, which is where "not scheduled yet" belongs. */
  for(const g of groups)
    g.phases.sort((a, b) => (a.n ?? 99) - (b.n ?? 99));

  /* Version number and state, and not the patch's title. "Lamplight in Mirage,
     Sword's Resolve in Heart" is eight words of poetry that wrapped to two
     lines in half a stage, and on a page about what a banner costs it is the
     one thing on the heading nobody is reading. The Timeline carries it. */
  const picker = groups.length ? groups.map(g => {
    /* Said once, on the patch nobody has a banner list for. Without it the two
       revealed Resonators read as the confirmed line-up, and the thing a
       reader most needs to know about 3.7 is that the reruns beside them are
       still unknown — which is Astrite this figure is not asking for yet. */
    const unscheduled = g.phases.some(ph => ph.n == null);
    return `<div class="pgrp">
      <div class="pgrp-h">
        <span class="label">Version ${esc(g.version)}</span>
        <span class="pill ${g.status === "live" ? "live" : g.status === "announced" ? "next" : "future"}">${esc(g.status)}</span>
      </div>
      ${g.phases.map(ph => `<div class="pph">
        <div class="pph-h">
          <span class="sub">${ph.n == null ? "Revealed, not scheduled" : `Phase ${ph.n}`}</span>
          ${ph.window?.start && ph.window?.end
            ? `<span class="sub when">${fmtShort(ph.window.start)} → ${fmtShort(ph.window.end)}${ph.window.est ? " est" : ""}</span>` : ""}
        </div>
        <div class="pcards">${ph.items.map(t => pullCard(t, want)).join("")}</div>
      </div>`).join("")}
      ${unscheduled ? `<p class="pgrp-n">Kuro has named these Resonators and nothing else about the patch —
        no dates, no phases, and no reruns. Whoever is announced beside them lands here on its own.
        Their weapon convenes are certain to run and are not named yet: budget the ${CONVENE.pity} pulls
        against a placeholder, and it takes the real name the day Kuro gives it one.</p>` : ""}
    </div>`;
  }).join("") : `<div class="empty">No 5★ banner is open or announced, so there is nothing to plan for yet.</div>`;

  /* `item` names the entry in items.json whose icon heads the field. The three
     things you hold are objects the game draws, and the desk already caches
     Kuro's own art for them — a labelled box saying ASTRITE next to a labelled
     box saying RADIANT TIDES is three words of mono doing a job three pictures
     do faster. `glyph` is what a field takes instead when there is no art to
     draw: pity is a count the game keeps about you rather than a thing you own,
     so it gets a sprite in the same figure, which is the difference stated
     rather than a fifth tile built to a different shape. */
  const field = (k, label, hint, item, attrs = "", glyph = "") => {
    const art = item && itemFor(item)?.icon;
    return `<label class="pf">
      <span class="pf-top">
        <span class="pf-fig${art ? "" : " glyph"}">${art
          ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">`
          : icon(glyph, 21)}</span>
        <span class="pf-k">${esc(label)}</span>
      </span>
      <span class="pf-in">
        <input type="number" inputmode="numeric" min="0" step="1" autocomplete="off"
               data-pull="${k}" value="${P[k] || ""}" placeholder="0"${attrs}>
      </span>
      <em class="pf-h" id="pf-h-${k}">${hint}</em>
    </label>`;
  };

  /* The two controls sit side by side above the answer rather than stacked
     over it. Three full-width panels put the figure a reader is changing the
     inputs to watch below the fold, so every keystroke was typed blind and
     confirmed by scrolling. Picking and pricing are one gesture, and this is
     the layout that lets a screen hold both ends of it. Collapses to one
     column at 1180, where the columns stop being wide enough to be two. */
  $("#p-pulls").innerHTML = `<div class="stack">
    ${pageTitle("pulls")}

    <div class="play">
      <div class="panel">
        <div class="panel-h"><h2>What you're after</h2>
          <span class="sub" id="pull-count">${plural(S.pull.want.length, "target")}</span>
          <div class="right">
            <button class="more" data-act="pullreset">Clear ${icon("i-arrow", 12)}</button>
          </div>
        </div>
        <div class="panel-b">${picker}</div>
      </div>

      <div class="panel">
        ${/* "Type what you have", not "Empty means none". The panel is the only
             one on the desk that does nothing until you fill it in, and the
             sub-heading is the first thing read after the title, so it says
             what to do here before it says what a blank box means. */""}
        <div class="panel-h"><h2>Where you stand</h2>
          <span class="sub">Type what you have · empty means none</span>
        </div>
        <div class="panel-b">
          <div class="pfset">
            <span class="label">What you hold</span>
            <div class="pfields">
              ${/* One word each, now that each carries Kuro's own art. "RADIANT
                   TIDES" is thirteen tracked-out mono characters and it wrapped
                   the moment an icon took 23px off the line, which left the
                   three boxes you hold taller than the two you don't. The
                   picture says which tide it is faster than the second word
                   did, and the hint under it still names the banner. */""}
              ${field("astrite", "Astrite", pullBuys(), "Astrite")}
              ${field("radiant", "Radiant", "Resonator convene", "Radiant Tide")}
              ${field("forging", "Forging", "Weapon convene", "Forging Tide")}
            </div>
          </div>
          <div class="pfset">
            <span class="label">Where your pity stands</span>
            <div class="pfields">
              ${/* "Resonator", not "Resonator pity" — the heading over the row
                   already says pity, and the longer label was the one string
                   here wide enough to wrap a tile and leave the two boxes
                   different heights. */""}
              ${field("pity",  "Resonator", `Since your last 5★`, null, ` max="${CONVENE.pity - 1}"`, "i-pulls")}
              ${field("wpity", "Weapon", `Counts on its own`, null, ` max="${CONVENE.pity - 1}"`, "i-weapon")}
            </div>
            <button class="pguar" data-act="pullguar" aria-pressed="${!!P.guaranteed}">
              <span class="ptg-box">${icon("i-check", 11)}</span>
              <span class="ptg-t"><b>I lost the last 50/50</b>
                <em>Your next 5★ is guaranteed featured — ${CONVENE.pity} pulls off the worst case.</em></span>
            </button>
          </div>
        </div>
      </div>

      ${/* Inside the grid rather than under it, so a wide screen can lift it
           into a third column beside the controls instead of leaving it in a
           row of its own with a screen's width of nothing either side. It
           spans both columns at every narrower width — see .play. */""}
      <div id="pull-out">${pullOut()}</div>
    </div>
  </div>`;
}

/* ── intel ───────────────────────────────────────────────────────── */
function chips(scope, items, active){
  return items.map(([k, label, n, cls]) =>
    `<button data-act="filter" data-scope="${scope}" data-id="${k}" aria-pressed="${active === k}" class="${cls || ""}">
      ${cls ? `<i class="dot"></i>` : ""}${label}${n != null ? `<span class="n">${n}</span>` : ""}
    </button>`).join("");
}

/* ── filters ─────────────────────────────────────────────────────────
   Every view's filter is now its rail axis and nothing else. A Quick filters
   panel used to stand in the aside — and again inline once the aside dropped
   — carrying a select per view for a second axis: version and category on
   Intel, weapon on Resonators, source on Signals, sub-stat on Weapons. It
   went with the panel. One filter surface is the point of moving them into
   the rail; a second one in the opposite margin, in a different control, was
   the arrangement the rail replaced, still standing. */
const filtersOn = () => VIEW_FILTERS[S.view].filter(k => S[k] !== "all");

/* An empty list should say which control emptied it, and undo itself. */
function emptyWhy(what){
  const on = filtersOn();
  if(!on.length) return `Nothing here yet.`;
  const names = {tier:"confidence", kind:"kind", elem:"element",
                 when:"window", wtype:"class", eset:"sonata"};
  return `No ${what} matches this ${on.map(k => names[k]).join(" + ")} filter.
    <button class="more" data-act="reset" style="margin-left:10px">Reset ${icon("i-arrow", 12)}</button>`;
}

function intelCard(e, mini){
  const tier = TIERS.includes(e.confidence) ? e.confidence : "rumour";
  const unverified = tier === "reported" || tier === "rumour";
  const srcs = (e.sources || []).map(s => `<span><span class="lang">${esc((s.lang || "??").toUpperCase())}</span>${esc(s.name)}</span>`).join("");
  const art = intelArt(e);
  /* Small on purpose. The picture is a landmark for finding a row again on a
     second pass, not the reason to read it — the headline is. Every row gets
     the slot whether or not art resolved, so the headlines stay on one left
     edge; an entry with no face to show falls back to a plate carrying the
     version it's about, in its own confidence colour. */
  const fig = art
    ? `<div class="ithumb${art.cutout ? " cut" : ""}">
         <img class="${art.poster ? "poster" : ""}" src="${esc(art.url)}" alt="${esc(art.alt)}"
              loading="lazy" decoding="async"></div>`
    : `<div class="ithumb plate" aria-hidden="true"><span>${esc(e.version || e.category || "—")}</span></div>`;

  return `<article class="intel t-${tier}${unverified ? " unverified" : ""}${mini ? " mini" : ""} has-art"
           role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
    ${fig}
    <div class="itext">
      <div class="intel-h">
        ${tierBadge(tier, tier === "official")}
        <span class="when">${fmtDate(e.date)}</span>
        ${e.version ? `<span class="pill ver">${esc(e.version)}</span>` : ""}
        ${!mini && e.category ? `<span class="pill">${esc(e.category)}</span>` : ""}
        ${e.outcome === "confirmed" ? `<span class="outcome ok">✓ turned out right</span>` : ""}
        ${e.outcome === "superseded" ? `<span class="outcome no">✕ was wrong</span>` : ""}
      </div>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.body)}</p>
      ${mini ? "" : `<div class="intel-f">
        ${srcs ? `<div class="srcs">${srcs}</div>` : ""}
        ${confMeter(tier)}
      </div>`}
    </div>
  </article>`;
}

/* Tier is the whole filter, because it is the question the desk exists to
   answer. Version and category were selects beside it and went with the Quick
   filters panel — both are printed on every card, and an entry's version is a
   click away in the patch drawer, which lists its own intel. */
function intelList(){
  let list = [...entries()].sort((a, b) => (b.date||"").localeCompare(a.date||""));
  if(S.tier !== "all") list = list.filter(e => e.confidence === S.tier);
  return list;
}

function renderIntel(){
  const list = intelList();

  /* Panel header gone, same bargain as the timeline: the tier row it carried
     is the list under Intel in the rail — which is also where "Filter by tier"
     used to sit as a group of its own, one rail section away from the view it
     filtered. The methodology link stays in the footer, where you land after
     reading rather than before. */
  $("#p-intel").innerHTML = `<div class="stack">
    ${pageTitle("intel")}
    <div class="panel">
      ${fbar("intel")}
      <div class="panel-b flush">
        ${list.length ? `<div class="intel-list">${list.map(e => intelCard(e)).join("")}</div>`
          : `<div class="empty">${emptyWhy("intel")}</div>`}
      </div>
      <div class="panel-f"><button class="more" data-act="open" data-id="methodology">How the tiers work ${icon("i-arrow", 12)}</button></div>
    </div>
  </div>`;
}

/* ── signals ─────────────────────────────────────────────────────── */
function signalRow(i){
  const h = headline(i);
  /* The mark is the fastest read in the row — you scan for the Kuro diamond to
     find the one official post in forty community threads. Coloured by kind so
     it carries the same information as the badge at the far end of the row. */
  const mark = SOURCE_ICON[i.sourceId] || KIND_ICON[i.kind] || "i-comm";
  return `<a class="sig ${i.hot ? "hot" : ""}" href="${esc(i.url)}" target="_blank" rel="noopener"
     ${h.translated ? `title="${esc(h.original)}"` : ""}>
    <span class="t">${fmtClock(i.date)}</span>
    <span class="src">
      <i class="smark ${esc(i.kind || "")}">${icon(mark, 13)}</i>
      <span class="sname"><b>${esc(i.source || "")}</b></span>
    </span>
    <span class="head">${esc(h.text)}${
      h.translated ? `<em class="orig">${esc(h.original)}</em>` : ""}</span>
    <span class="flags">
      ${h.translated ? `<span class="lang tr">${esc((i.lang || "").toUpperCase())}→EN</span>`
        : i.lang && i.lang !== "en" ? `<span class="lang">${esc(i.lang.toUpperCase())}</span>` : ""}
      ${i.hot ? `<span class="hotflag">Hot</span>` : ""}
      <span class="kind ${esc(i.kind)}">${esc(KIND_LABEL[i.kind] || i.kind || "")}</span>
    </span>
  </a>`;
}

function renderSignals(){
  const feed = DATA.feed || {};
  const all = signals();
  const counts = all.reduce((a, i) => (a[i.kind] = (a[i.kind]||0)+1, a), {});

  let list = all;
  if(S.kind === "hot") list = list.filter(i => i.hot);
  else if(S.kind !== "all") list = list.filter(i => i.kind === S.kind);
  const shown = list.slice(0, S.sigLimit);

  const filters = chips("kind",
    [["all", "All", all.length], ["hot", "Hot", all.filter(i => i.hot).length]]
      .concat(Object.keys(KIND_LABEL).filter(k => counts[k]).map(k => [k, KIND_LABEL[k], counts[k]])),
    S.kind);

  const ok = (feed.sources || []).filter(s => s.status === "ok").length;

  /* The panel header keeps the run status and the kind chips but not the name:
     the page title above the stack says "Live Signals" already, and the two
     would sit a header's height apart saying the same two words. */
  $("#p-signals").innerHTML = `<div class="stack">
    ${pageTitle("signals")}
    <div class="panel sigpanel">
      <div class="panel-h">
        <span class="sub">Last run ${feed.fetched ? esc(fmtDate(feed.fetched)) + " " + esc(fmtTime(feed.fetched)) : "—"} · ${ok}/${(feed.sources||[]).length} sources</span>
        <div class="right chips">${filters}</div>
      </div>
      <div class="warnbar">
        Unverified automated signals
        <span>Raw headlines pulled every 6 hours. Nothing here is tiered or read — it's a lead list. Anything that survives a read gets written up under Intel.</span>
      </div>
      <div class="panel-b flush">
        ${shown.length ? `<div class="term">${shown.map(signalRow).join("")}</div>`
          : `<div class="empty">${all.length ? emptyWhy("signal") : "No signals yet — the fetcher has not run."}</div>`}
      </div>
      ${list.length > shown.length ? `<div class="panel-f">
        <button class="more" data-act="morelogs">Show more — ${list.length - shown.length} older ${icon("i-arrow", 12)}</button>
      </div>` : ""}
    </div>
  </div>`;
}

/* ── resonators ──────────────────────────────────────────────────── */
/* ★★★★★ rather than "5★". Rarity is the one attribute you compare across a
   whole grid at once, and five marks read as more than four without being
   parsed. Screen readers get the number, not sixty stars. */
function stars(n){
  const r = Number(n);
  return r > 0 && r <= 5
    ? `<span class="stars" role="img" aria-label="${r} star">${"★".repeat(r)}<i>${"★".repeat(5 - r)}</i></span>`
    : "";
}

/* ── kit rendering ───────────────────────────────────────────────── */

/* Skill text arrives from the scraper as plain strings carrying `**bold**` and
   `__underline__` where Kuro's own copy emphasised a number or an element. The
   escape runs first and the markers are turned into elements second, so the
   only tags that can ever reach innerHTML are the two this function writes —
   a scraped page cannot inject anything through here. */
function kitText(s){
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_]+)__/g, "<u>$1</u>");
}

/* A skill body is blocks, each optionally headed — "Heavy Attack", "Dodge
   Counter". Those headings are the sub-abilities, and without them a Basic
   Attack entry is one unreadable twelve-sentence paragraph. */
function kitBody(blocks){
  return (blocks || []).map(b => `
    ${b.h ? `<h5>${kitText(b.h)}</h5>` : ""}
    ${(b.p || []).map(p => `<p>${kitText(p)}</p>`).join("")}`).join("");
}

/* The end of the first sentence, on a string that still carries its `**` and
   `__` markers. A plain split on ". " cuts "lasts for **1.5s.**" in half and
   trips over every abbreviation, so the stop only counts when what follows it
   — past any closing marker — is whitespace and then a capital or a quote,
   which is what the start of the next sentence actually looks like. */
function firstSentence(s){
  const t = String(s || "").trim();
  const re = /[.!?]+(?:\*\*|__)*\s+/g;
  let m;
  while((m = re.exec(t))){
    const rest = t.slice(re.lastIndex).replace(/^(?:\*\*|__)+/, "");
    if(/^["“'(]?[A-Z]/.test(rest)) return t.slice(0, m.index + 1);
  }
  return t;
}

/* How many lines a condensed card is allowed. Cutting each paragraph to its
   first sentence is not enough on its own: a Forte Circuit is forty paragraphs
   where an Outro Skill is one, so trimming alone leaves a card ten times the
   height of the card beside it and the grid is a column with three holes in
   it. Five lines is about what fits before a card stops being scannable. */
const GIST_LINES = 5;

/* Condensed skill text: headings kept, every paragraph cut to its opening
   sentence, and the card stopped at GIST_LINES. What was dropped is counted
   and handed back with the html rather than printed inside it — the card turns
   that count into its own way in to the full text, and the chain nodes print it
   as a note. A summary that quietly loses thirty lines of a kit is worse than
   no summary either way. */
function kitGist(blocks){
  let used = 0, cut = 0;
  const html = (blocks || []).map(b => {
    const ps = b.p || [];
    const take = Math.max(0, Math.min(ps.length, GIST_LINES - used));
    cut += ps.length - take;
    used += take;
    /* No heading over nothing — once the budget is spent the whole block goes,
       its paragraphs counted into `cut` on the way out. */
    if(!take) return "";
    return `${b.h ? `<h5>${kitText(b.h)}</h5>` : ""}
      ${ps.slice(0, take).map(p => `<p>${kitText(firstSentence(p))}</p>`).join("")}`;
  }).join("");
  return {html, cut};
}

/* Game order, not file order: this is the sequence the in-game Resonator
   screen lists them in, and the order they come up in a rotation. Each slot
   carries the desk's own mark for it — see the sprite in index.html for why
   these are drawn rather than lifted out of the client. */
const KIT_ORDER = [
  ["basic", "Basic Attack", "i-k-basic"], ["skill", "Resonance Skill", "i-k-skill"],
  ["forte", "Forte Circuit", "i-k-forte"], ["liberation", "Resonance Liberation", "i-k-lib"],
  ["intro", "Intro Skill", "i-k-intro"], ["outro", "Outro Skill", "i-k-outro"]
];
const KIT_ICON = Object.fromEntries(KIT_ORDER.map(([k, , ic]) => [k, ic]));

/* One skill, one card. These used to be <details> in a single column, closed,
   because a full kit laid flat buried everything under it. In the grid they
   are open cards instead and the Simplified toggle is what keeps them short —
   six boxes you can read across beats six rows you have to click.

   `slot` is how the card finds its own full text again when the reader asks
   for it: the kit is already in memory, so opening one card is a lookup and an
   innerHTML rather than a redraw of the whole record. */
function kitEntry(label, s, simple = S.kitSimple, slot = "", ic = "") {
  if(!s) return "";
  const g = simple ? kitGist(s.blocks) : {html: kitBody(s.blocks), cut: 0};
  return `<article class="skill" id="sk-${esc(slot)}" data-slot="${esc(slot)}">
    <header class="skill-h">
      ${ic ? `<span class="skill-i">${icon(ic, 19)}</span>` : ""}
      <span class="skill-hh"><span class="skill-k">${esc(label)}</span><b>${esc(s.name)}</b></span>
    </header>
    <div class="skill-t">${g.html}</div>
    ${g.cut && slot ? `<button class="skill-more" data-act="skillfull">
      <span>View details</span><em>+${g.cut} line${g.cut === 1 ? "" : "s"}</em>
      ${icon("i-arrow", 12)}</button>` : ""}
  </article>`;
}

/* The Resonance Chain stays shut. Six nodes are six duplicates away for almost
   everyone reading, so it is reference rather than the record — and native
   disclosure survives a re-render, takes the keyboard, and is findable by the
   browser's own in-page search for nothing. */
function chainEntry(label, s, simple = S.kitSimple){
  if(!s) return "";
  const g = simple ? kitGist(s.blocks) : {html: kitBody(s.blocks), cut: 0};
  return `<details class="skill">
    <summary><span class="skill-k">${esc(label)}</span><b>${esc(s.name)}</b></summary>
    <div class="skill-t">${g.html}${g.cut
      ? `<p class="gist-more">+${g.cut} more line${g.cut === 1 ? "" : "s"} — switch off Simplified for the full text.</p>`
      : ""}</div>
  </details>`;
}

/* Which blocks a card is holding back, found from the slot it wrote into its
   own markup. The kit is already loaded — this record cannot have drawn
   without it — so opening one card costs a lookup rather than a fetch. */
function skillBlocks(name, slot){
  const kit = kitFor(name);
  if(!kit || !slot) return null;
  const [kind, i] = String(slot).split(":");
  if(kind === "inherent") return kit.inherent?.[Number(i)]?.blocks;
  if(kind === "extra") return kit.extra?.[Number(i)]?.blocks;
  return kit.skills?.[kind]?.blocks;
}

/* The rotation, as a rotation. Six names in the order you press them, which is
   the one thing a kit page is asked for that a grid of six equal cards does not
   say — a reader arriving at a Resonator wants the shape of the loop before
   they want four thousand words about it. Each node jumps to its own card, so
   the band is a table of contents rather than a picture of one. */
function kitFlow(kit){
  const nodes = KIT_ORDER
    .map(([k, label, ic]) => kit.skills?.[k] ? {k, label, ic, name: kit.skills[k].name} : null)
    .filter(Boolean);
  /* One or two slots is not a rotation, it is a fragment of a scrape. */
  if(nodes.length < 3) return "";
  return `<div class="dsec"><span class="label">Combat kit</span>
    <ol class="kflow">${nodes.map(n => `<li>
      <button data-act="kitjump" data-id="${esc(n.k)}">
        <span class="kflow-i">${icon(n.ic, 24)}</span>
        <em>${esc(n.label)}</em>
        <b>${esc(n.name)}</b>
      </button>
    </li>`).join("")}</ol></div>`;
}

function kitPanel(kit){
  if(!kit) return "";
  const simple = S.kitSimple;
  const skills = KIT_ORDER
    .map(([k, label, ic]) => kitEntry(label, kit.skills?.[k], simple, k, ic)).join("");
  /* Prydwen occasionally labels two blocks with the same slot name — a second
     Forte Circuit where the Intro Skill should be. The scraper keeps both
     rather than letting one overwrite the other, and the spare lands here. */
  const extra = (kit.extra || [])
    .map((e, i) => kitEntry(e.kind, e, simple, `extra:${i}`, KIT_ICON[String(e.kind || "").toLowerCase().includes("forte") ? "forte" : "skill"])).join("");
  /* Their own section rather than cards seven and eight of the grid: passives
     are a different kind of thing to the six slots you press, and folded in
     among them they read as skills you have somehow never found the button for. */
  const inherent = (kit.inherent || [])
    .map((s, i) => kitEntry("Inherent Skill", s, simple, `inherent:${i}`, "i-role")).join("");
  const chain = (kit.chain || [])
    .map(n => chainEntry(`S${n.n}`, {name:n.name, blocks:n.blocks}, simple)).join("");

  return `
    ${kitFlow(kit)}
    <div class="dsec"><div class="dsec-h"><span class="label">Skills</span>${kitModeToggle(simple)}</div>
      <!-- Two columns for the full text rather than three. Condensed, the cards
           are five lines each and three across reads as a grid; at full length
           a third of the panel is a 38-character measure for a wall of prose. -->
      <div class="skills grid${simple ? "" : " wide"}">${skills}${extra}</div>
    </div>
    ${inherent ? `<div class="dsec"><span class="label">Inherent Skills</span>
      <div class="skills grid duo">${inherent}</div>
    </div>` : ""}
    ${chain ? `<div class="dsec"><span class="label">Resonance Chain</span>
      <div class="skills chain">${chain}</div>
      <p class="tier-note" style="margin-top:12px">Each node needs a duplicate of the Resonator. S6 is six.</p>
    </div>` : ""}`;
}

/* The Simplified switch. aria-pressed carries the state — it is one control
   with two positions, not two radio buttons — and the label names what you get
   now, not what clicking would do, because a toggle that renames itself under
   the cursor is the oldest way to make a switch unreadable. */
function kitModeToggle(simple){
  return `<button class="kitmode" data-act="kitmode" aria-pressed="${simple}"
    title="${simple ? "Show the full skill text from the client" : "Cut every paragraph to its first sentence"}">
    <i aria-hidden="true"></i><span>Simplified</span>
  </button>`;
}

/* ── debut and reruns ────────────────────────────────────────────── */

/* The badge in the top-right corner of every record: the patch they debuted
   in, and — on hover, or on focus — every patch their banner has come back
   for since. Reruns are the question this database is actually asked most
   often, and they are a list of two-character strings, so they cost a tooltip
   rather than a row of the card.

   The same numbers are written out as plain rows inside the record itself, so
   nothing here is the only way to reach them. A tooltip that opens on hover
   has no equivalent on a touchscreen, and this one is decoration over data
   that is already on the page rather than the data itself. */
/* Whether their debut patch has actually shipped. Patch numbers are two
   integers, not decimals — 3.10 follows 3.9 — so they compare componentwise or
   not at all. */
function cmpVer(a, b){
  const [am, an] = String(a).split(".").map(Number);
  const [bm, bn] = String(b).split(".").map(Number);
  return (am - bm) || (an - bn);
}
function hasDebuted(r){
  const live = currentVersion();
  return !!(r.version && live && cmpVer(r.version, live) <= 0);
}

/* Reruns are a 5★ question. A 4★ is rate-up filler on nearly every banner that
   runs — nine to twelve appearances each, and climbing by two a patch — so the
   list is a wall of patch numbers that takes a paragraph to say "they come back
   constantly". Their badge keeps the debut patch, drops the `+n` count, and the
   tooltip says the debut and stops there. */
function debutBadge(r){
  const v = r.version;
  if(!v) return "";
  const filler = String(r.rarity) === "4";
  const reruns = filler ? [] : r.reruns || [];
  const tip = filler ? ""
    : r.standard ? "Standard pool — always available"
    : reruns.length ? `Rerun in ${reruns.join(", ")}`
    : hasDebuted(r) ? "No rerun yet"
    : "Not released yet";
  return `<span class="debut" role="note" aria-label="Debut ${esc(v)}${tip ? `. ${esc(tip)}` : ""}">
    <b>${esc(v)}</b>${reruns.length ? `<i>+${reruns.length}</i>` : ""}
    <span class="debut-tip" aria-hidden="true">
      <em>Debut</em>${esc(v)}
      ${filler ? "" : `<span class="debut-runs">${r.standard
        ? `<em>Pool</em>Standard`
        : reruns.length
        ? `<em>${reruns.length === 1 ? "Rerun" : "Reruns"}</em>${reruns.map(x => `<i>${esc(x)}</i>`).join("")}`
        : hasDebuted(r)
        ? `<em>Reruns</em>None yet`
        : `<em>Status</em>Unreleased`}</span>`}
    </span>
  </span>`;
}

/* The grid is sixty Resonators and grows by two a patch, so a card is a
   portrait and a name and nothing else. Everything the old card carried — the
   summary, the element, the role, the two confidence rows, the kit count — is
   in the record one click away, and printing it sixty times over turned a
   roster into six screens of small print nobody reads. What survives earns its
   place at a glance: the art identifies them, the accent is their element, and
   the corner is the patch they debuted in. */
/* The opposite corner to the debut badge, and only two patches earn one: the
   one running now and anything past it. "New" and "Upcoming" are the two
   questions a roster sorted newest-first is opened with, and they are the two
   the patch number alone makes you do arithmetic to answer. Every earlier
   debut is simply in the game — a flag on fifty-six of sixty cards marks
   nothing. */
function releaseFlag(r){
  const live = currentVersion();
  if(!r.version || !live) return "";
  const d = cmpVer(r.version, live);
  return d > 0 ? `<i class="flag up">Upcoming</i>`
       : d === 0 ? `<i class="flag new">New</i>`
       : "";
}

function recordCard(r){
  const b = bannerFor(r.name) || {};
  return `<article class="rec" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}"${attrStyle(r.attribute)}>
    ${artPanel({name:r.name, ...b}, releaseFlag(r) + debutBadge(r))}
    <h3 class="rec-n">${esc(r.name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h3>
  </article>`;
}

/* Rover is one character in four elements, not four debuts. Threading the
   forms through the timeline by release date scatters them across two years
   of grid for no reason, so they go to the end as a set. */
const isRover = r => (/^Rover\b/.test(r.name) ? 1 : 0);

/* A released Resonator sorts on the day they arrived; one who hasn't yet has no
   date, so they sort on their announced patch behind a `9` — every real date
   starts with a `2`, so the unreleased sit at the newest end of the run rather
   than the oldest, which is where an announced character belongs. Both halves
   are zero-padded, because a patch number is two integers and not a decimal:
   unpadded, 3.10 sorts behind 3.6 and the next character to be announced lands
   in the middle of the grid. */
function debutKey(r){
  const dated = r.released || r.runs?.[0]?.start;
  if(dated) return dated;
  const [maj, min] = String(r.version || "99.99").split(".");
  return `9${String(maj).padStart(2, "0")}.${String(min ?? 0).padStart(2, "0")}`;
}
/* Newest debut first: what's next and what just landed are the two things this
   database is opened for, and both were four screens down when it ran oldest
   first. Rover is the exception the comparator handles before the dates — one
   character in four elements, not four debuts, so the set goes to the end. */
const byNewest = (a, b) => (isRover(a) - isRover(b)) || debutKey(b).localeCompare(debutKey(a));

/* One table per rarity, 5★ above 4★. This is what retired the 5★/4★ chips: the
   answer they gave is the shape of the page now, both halves readable at once
   instead of a toggle between two states of one grid. The element and weapon
   filters still cross both, so one table can empty while the other fills — and
   the count says "12 of 48" rather than just "12" whenever that happens. */
function recordTable(title, rows, total, {under = "", foot = ""} = {}){
  return `<div class="panel">
    <div class="panel-h">
      <h2>${title}</h2>
      <span class="sub">${plural(rows.length, "record")}${rows.length === total ? "" : ` of ${total}`} · newest debut first</span>
    </div>
    ${under}
    <div class="panel-b">
      ${rows.length ? `<div class="rgrid">${rows.map(recordCard).join("")}</div>`
        : `<div class="empty">${emptyWhy("record")}</div>`}
    </div>
    ${foot ? `<div class="panel-f"><span class="tier-note">${foot}</span></div>` : ""}
  </div>`;
}

function renderResonators(){
  const all = [...resonators()].sort(byNewest);
  let list = all;
  if(S.elem !== "all") list = list.filter(r => r.attribute === S.elem);

  const rows  = rarity => list.filter(r => String(r.rarity) === rarity);
  const total = rarity => all.filter(r => String(r.rarity) === rarity).length;

  /* Every table keeps its own header, 5★ included. It went when the element
     chips came off it, on the reasoning that the top of the page needs no
     label — but the header is not the view's name, it is the rarity divider,
     and with it gone the 5★ set was the one table on the desk that had to be
     inferred from the fact that a 4★ header appeared later. The page's own
     name is the title above the stack now, so the two no longer collide. */
  $("#p-resonators").innerHTML = `<div class="stack">
    ${pageTitle("resonators")}
    ${recordTable("5★ Resonators", rows("5"), total("5"), {
      under: fbar("resonators"),
      foot: "Kit detail on unreleased resonators is pre-balance — multipliers routinely shift between beta phases."
    })}
    ${recordTable("4★ Resonators", rows("4"), total("4"))}
  </div>`;
}

/* ── weapons ─────────────────────────────────────────────────────────
   Same shape as the Resonators view — one table per rarity, a chip row for the
   primary axis, a select for the second — and for the same reason: both halves
   of a roster readable at once beats a toggle between two states of one grid.
   Three tables here rather than two, because 3★ weapons exist and a database
   that quietly omits a third of the game is not a database.

   The one control this view has that no other does is the ascension slider.
   Every weapon's passive is written once, with holes in it, and the five values
   each hole takes are what ascension moves — so the desk carries the template
   and the reader carries the slider, instead of the page printing five nearly
   identical paragraphs per weapon and asking you to find the one you meant.

   Stats do not move with it. atk90 and the sub-stat are level 90 figures and
   the column headers say so: comparing two weapons is the reason anyone opens
   this page, and a comparison at level 43 is a comparison of two grinds. */
const WTYPES = ["Broadblade", "Sword", "Pistols", "Gauntlets", "Rectifier"];

/* The passive, resolved to one ascension. The scaling values are the reason
   the sentence is worth reading twice, so they are set apart rather than run
   into the prose — move the slider and what changes is visible without
   re-reading the paragraph to find it. */
function effectHtml(w, rank){
  const i = Math.min(5, Math.max(1, rank || 1)) - 1;
  const fill = s => esc(s).replace(/\{(\d)\}/g, (_, n) => {
    const vals = w.ranks?.[Number(n)];
    /* A hole the source shipped no values for. Say so rather than print a
       number from the wrong slot — the whole desk runs on that rule. */
    return vals ? `<b class="wval">${esc(vals[i])}</b>` : `<b class="wval na">?</b>`;
  });

  /* Kuro writes the longest passives as a paragraph and then a list, and the
     break reaches the desk as the two characters backslash-n rather than as a
     newline — so printed as one string it reads "gain the following effects:\n-
     This Aero DMG Bonus…" with the escape in the middle of the sentence. Split
     on either form. A run of parts that all open with a dash is the list Kuro
     wrote, so it is set as one; anything else stays paragraphs, because a
     bullet drawn on a sentence that isn't one is an invented claim about
     structure. */
  const parts = String(w.effect || "").split(/\\n|\n/).map(s => s.trim()).filter(Boolean);
  if(!parts.length) return `<span class="wnone">No passive.</span>`;
  const [lead, ...rest] = parts;
  const listed = rest.length && rest.every(s => /^[-–•]/.test(s));
  return `<p>${fill(lead)}</p>` + (!rest.length ? ""
    : listed
      ? `<ul class="weff-l">${rest.map(s =>
          `<li>${fill(s.replace(/^[-–•]\s*/, ""))}</li>`).join("")}</ul>`
      : rest.map(s => `<p>${fill(s)}</p>`).join(""));
}

/* 1–5, and it redraws nothing. A full re-render would rebuild the input the
   thumb is currently being dragged on, which ends the drag — so the numbers are
   repainted in place and the slider is left standing. It queries the document
   rather than the record, so the rank stays put between one record and the
   next: set it once and every weapon you open after that is already there. */
function paintRank(){
  document.querySelectorAll("[data-eff]").forEach(el => {
    const w = weaponFor(el.dataset.eff);
    if(w) el.innerHTML = effectHtml(w, S.rank);
  });
  document.querySelectorAll("[data-ranklabel]").forEach(el => el.textContent = `S${S.rank}`);
  document.querySelectorAll("[data-ranktick]").forEach(el =>
    el.classList.toggle("on", Number(el.dataset.ranktick) === S.rank));
  document.querySelectorAll("[data-rank]").forEach(el => {
    el.value = S.rank;
    el.setAttribute("aria-valuetext", `Ascension ${S.rank} of 5`);
  });
}

/* The five stops, drawn as five stops and now named as well. The control used
   to be a track with the live rank beside it, which told you where the thumb
   was standing and nothing about the four places it could go — on a slider
   with five positions and no scale, S3 is a reading rather than a position.
   The row under the track is the scale, so the whole range is legible without
   dragging it.

   The <label> wraps the input rather than pointing at an id: the record can
   hold only one of these, but the palette and the drawer both rebuild markup
   from scratch, and an id that has to stay unique across that is a bug waiting
   for the second one. */
function ascendBar(){
  return `<label class="ascend">
    <span class="ascend-h">
      <span class="label">Ascension</span>
      <output class="ascend-v" data-ranklabel>S${S.rank}</output>
    </span>
    <input type="range" min="1" max="5" step="1" value="${S.rank}" data-rank
           aria-label="Weapon ascension" aria-valuetext="Ascension ${S.rank} of 5">
    <span class="ascend-ticks" aria-hidden="true">${[1, 2, 3, 4, 5].map(n =>
      `<i data-ranktick="${n}"${n === S.rank ? ` class="on"` : ""}>S${n}</i>`).join("")}</span>
  </label>`;
}

/* A weapon card is the weapon's own render, its name, and the two figures that
   are the only reason anyone compares one to another. Nothing else — the class,
   the source, whose signature it is and the whole passive are in the record one
   click away, and printing any of that 120 times over turns a database into a
   wall of small print. Same bargain the resonator grid struck.

   The stats stay on the card rather than following the passive into the record.
   They are two numbers, they are what the grid is scanned for, and they are
   fixed: level 90, always, whatever the ascension slider is doing. */
function weaponCard(w){
  return `<article class="rec wrec" role="button" tabindex="0" data-act="weapon" data-id="${esc(w.name)}">
    <!-- has-art is what turns off the concentric-ring plate .cart draws behind
         a card with no picture. A weapon with no published icon yet keeps it. -->
    <div class="cart wart${w.icon ? " has-art" : ""}">${w.icon
      ? `<img src="${esc(w.icon)}" alt="${esc(w.name)}" loading="lazy" decoding="async">`
      : `<span class="wart-g">${icon("i-weapon", 34)}</span>`}</div>
    <div class="wrec-b">
      <h3>${esc(w.name)}</h3>
      <span class="wrec-s">
        <b>${w.atk90 || "—"}</b> ATK${w.statValue90
          ? ` · <b>${esc(w.statValue90)}%</b> ${esc(w.stat)}` : ""}
      </span>
    </div>
  </article>`;
}

function weaponTable(title, rows, total, {under = "", foot = ""} = {}){
  const r = String(title).charAt(0);
  return `<div class="panel wpanel r-${r}">
    <div class="panel-h">
      <h2>${title}</h2>
      <span class="sub">${plural(rows.length, "weapon")}${rows.length === total ? "" : ` of ${total}`} · by class</span>
    </div>
    ${under}
    <div class="panel-b">
      ${rows.length ? `<div class="rgrid wgrid">${rows.map(weaponCard).join("")}</div>`
        : `<div class="empty">${emptyWhy("weapon")}</div>`}
    </div>
    ${foot ? `<div class="panel-f"><span class="tier-note">${foot}</span></div>` : ""}
  </div>`;
}

/* Class first, then name. With no filter on, that groups the five classes into
   five runs you can scan past — where a flat alphabetical list interleaves them
   and scatters the four Broadblades you actually use across three rows. */
const byClassThenName = (a, b) =>
  (WTYPES.indexOf(a.type) - WTYPES.indexOf(b.type)) || a.name.localeCompare(b.name);

function renderWeapons(){
  const all = [...weapons()].sort(byClassThenName);
  let list = all;
  if(S.wtype !== "all") list = list.filter(w => w.type === S.wtype);

  const rows  = rarity => list.filter(w => String(w.rarity) === rarity);
  const total = rarity => all.filter(w => String(w.rarity) === rarity).length;

  /* Class moved to the rail with every other view's primary axis — see
     RAIL_FILTERS, which reads the classes off the data for the same reason
     this used to: a class nothing is filed under would be a filter that can
     only ever empty the page. The 5★ header stays behind, as on Resonators:
     three rarities down the page need three dividers, and the gold edge that
     bands this table belongs on the header carrying the word "5★" rather than
     on the panel it heads. */
  $("#p-weapons").innerHTML = `<div class="stack">
    ${pageTitle("weapons")}
    ${weaponTable("5★ Weapons", rows("5"), total("5"), {
      under: fbar("weapons"),
      foot: "Stats are level 90 throughout. Open a weapon for its passive and the ascension slider."
    })}
    ${weaponTable("4★ Weapons", rows("4"), total("4"))}
    ${weaponTable("3★ Weapons", rows("3"), total("3"))}
  </div>`;
}

/* ── echoes ──────────────────────────────────────────────────────────
   One page, and it is organised the way the game asks you to think.

   A Resonator has a page in the client and a weapon has a card; an echo is a
   monster you have already killed, and the four things anyone wants to know
   about it — which sonata sets it can roll, what its skill does at rank 5,
   what it costs to slot, and where to go and find the thing — are spread
   across the data terminal, the tuning screen, the map and the creature.

   Sonata is the spine. Nobody farms a Lampylumen Myriad; they farm Freezing
   Frost and take whichever body carries it. So the sets are the index at the
   top of the page, the roster below is one section per set, and clicking a set
   at the top narrows the page to that section. There is no drawer on a sonata
   set and no filter list in the rail — an echo view whose organising idea is
   the sonata set does not also need a rail axis, and a set is a heading you
   scroll to rather than a dialog you dismiss.

   The cost of this shape, stated plainly: an echo that rolls three sets is
   drawn three times, so 181 echoes make about 360 cards. That is the honest
   rendering of a many-to-many, and every alternative — filing each echo under
   one "primary" set, or listing the sets as text on a flat grid — either
   invents a fact or buries the one you came for.

   What is deliberately not here yet: main-stat pools, sub-stat weights, and
   which echo a given Resonator should run. Those are judgements rather than
   records, they want a file of their own with a source on every line, and this
   is the database that goes under them. */

/* Class, most expensive first. Not a filter any more — the sonata sets took
   that job — but still what orders a section and what a card says under its
   name, because two classes share the 4-cost price and are not the same
   thing. */
const ECLASSES = ["Calamity", "Overlord", "Elite", "Common"];

/* A one-line gloss on what a class *is*, for the record. This is the one thing
   on the view that is general game knowledge rather than a fetched fact, and
   it is written to describe the class rather than the echo — the echo's own
   answer to "where" is its `where` block, off the wiki, right underneath. */
const ECLASS_MEANS = {
  Common:   "An ordinary overworld enemy — the most common thing you will absorb.",
  Elite:    "An elite overworld enemy, marked on the map and worth stopping for.",
  Overlord: "A field boss. It stands in one place and comes back.",
  Calamity: "A weekly boss, fought in its own arena."
};

/* The element a sonata set reads in, taken off the set's own bonus text rather
   than from a table — fetch-echoes.mjs keeps the element mark the source wrote
   on the words it wrote it on, so Freezing Frost says Glacio in its own
   2-piece line and the section can be lit from that. Sets that buff a mechanic
   rather than an element — Moonlit Clouds, Rejuvenating Glow — name none, and
   take the site accent, which is correct: they are not anybody's element. */
function sonataElem(s){
  const m = (s?.pieces || []).map(p => p.text).join(" ").match(/class="e-([a-z]+)"/);
  return m ? m[1] : null;
}
const sonataStyle = s => attrStyle(sonataElem(s));

/* The echo skill, resolved to one rank.

   The text arrives already sanitised — fetch-echoes.mjs strips it to bold and
   bold-in-an-element-colour at the point the data is written, precisely so
   this does not have to choose between escaping the markup Kuro wrote into a
   skill ("CD: 15s" in bold) and putting somebody else's HTML into innerHTML.
   So the prose goes in as it stands and only the filled values are escaped.

   Same split as a weapon passive, and the same reason: Kuro writes the long
   ones as a paragraph and then a list, and the break reaches the desk as the
   two characters backslash-n rather than as a newline. A run of parts that all
   open with a dash is the list Kuro wrote and is set as one; anything else
   stays paragraphs. */
function echoSkillHtml(e, rank){
  const i = Math.min(5, Math.max(1, rank || 1)) - 1;
  const fill = s => s.replace(/\{(\d)\}/g, (_, n) => {
    const v = e.ranks?.[Number(n)]?.[i];
    /* A hole the source ships no value for at this rank. Say so rather than
       print a number from a rank the reader did not ask for. */
    return v == null ? `<b class="wval na">?</b>` : `<b class="wval">${esc(v)}</b>`;
  });
  const parts = String(e.skill || "").split(/\\n|\n/).map(s => s.trim()).filter(Boolean);
  if(!parts.length) return `<span class="wnone">No skill published for this one.</span>`;
  const [lead, ...rest] = parts;
  const listed = rest.length && rest.every(s => /^[-–•]/.test(s));
  return `<p>${fill(lead)}</p>` + (!rest.length ? ""
    : listed
      ? `<ul class="weff-l">${rest.map(s =>
          `<li>${fill(s.replace(/^[-–•]\s*/, ""))}</li>`).join("")}</ul>`
      : rest.map(s => `<p>${fill(s)}</p>`).join(""));
}

/* Which rank an open record is actually showing. S.erank is one number across
   the whole desk — set it once and every echo you open after that is already
   there — but an echo that does not drop below rank 2 has nothing to show at
   rank 1, so the record floors it at the lowest rank the source publishes
   numbers for. The slider's own min moves with it, so the thumb cannot be
   dragged to a position the record would then ignore. */
const erankOf = e => Math.max(Number(e?.minRank) || 1, S.erank);

/* Repaints the open record in place rather than redrawing it — a redraw would
   rebuild the input the thumb is being dragged on, which ends the drag. Same
   arrangement as paintRank, and deliberately a second function rather than a
   parameterised one: the two sliders mean different things, move different
   text, and sharing them would tie the weapon record's ascension to the echo
   record's rank the first time both are on screen. */
function paintERank(){
  document.querySelectorAll("[data-eskill]").forEach(el => {
    const e = echoFor(el.dataset.eskill);
    if(e) el.innerHTML = echoSkillHtml(e, erankOf(e));
  });
  document.querySelectorAll("[data-eranklabel]").forEach(el => {
    const e = echoFor(el.dataset.eranklabel);
    el.textContent = `R${e ? erankOf(e) : S.erank}`;
  });
  document.querySelectorAll("[data-eranktick]").forEach(el => {
    const e = echoFor(el.dataset.for || "");
    el.classList.toggle("on", Number(el.dataset.eranktick) === (e ? erankOf(e) : S.erank));
    el.classList.toggle("off", !!e && Number(el.dataset.eranktick) < (Number(e.minRank) || 1));
  });
  document.querySelectorAll("[data-erank]").forEach(el => {
    const e = echoFor(el.dataset.erank);
    const r = e ? erankOf(e) : S.erank;
    el.value = r;
    el.setAttribute("aria-valuetext", `Rank ${r} of 5`);
  });
}

/* The five stops, named, with the ones this echo never drops at greyed rather
   than removed — that an echo starts at rank 2 is a fact about the echo, and a
   slider that silently spans a different range on every record is a control
   the reader has to re-read each time. */
function erankBar(e){
  const r = erankOf(e), min = Number(e.minRank) || 1;
  return `<label class="ascend">
    <span class="ascend-h">
      <span class="label">Rank</span>
      <output class="ascend-v" data-eranklabel="${esc(e.name)}">R${r}</output>
    </span>
    <input type="range" min="${min}" max="5" step="1" value="${r}" data-erank="${esc(e.name)}"
           aria-label="Echo rank" aria-valuetext="Rank ${r} of 5">
    <span class="ascend-ticks" aria-hidden="true">${[1, 2, 3, 4, 5].map(n =>
      `<i data-eranktick="${n}" data-for="${esc(e.name)}"
          class="${n === r ? "on" : ""}${n < min ? " off" : ""}">R${n}</i>`).join("")}</span>
  </label>`;
}

/* Three is the cap on a card's crest row. It was four while the card was twice
   this wide; on a 125px cell a fourth 11px mark and a "+n" beside it leave the
   class nothing to be clipped down to. Most echoes roll one or two sets, so
   three is past the common case either way — and Hecate, which rolls seven,
   was never going to fit whatever the cap was. Past the cap the row says how
   many more there are and the record lists them all. */
const CREST_MAX = 3;

function crests(ids, size = 11){
  const list = (ids || []).map(sonataFor).filter(Boolean);
  if(!list.length) return `<span class="ecrest-none" title="Rolls no sonata set">—</span>`;
  const shown = list.slice(0, CREST_MAX), rest = list.length - shown.length;
  return `<span class="ecrests">${shown.map(s => s.icon
    ? `<img src="${esc(s.icon)}" alt="" title="${esc(s.name)}" width="${size}" height="${size}"
           loading="lazy" decoding="async">`
    : `<i class="ecrest-g" title="${esc(s.name)}"${sonataStyle(s)}>${icon("i-sonata", size)}</i>`
  ).join("")}${rest
    ? `<i class="ecrest-n" title="${esc(list.slice(CREST_MAX).map(s => s.name).join(", "))}">+${rest}</i>`
    : ""}</span>`;
}

/* One echo. The picture, the name, and the two facts the grid is scanned for:
   what it costs, and what else it rolls. The class is on the card because two
   classes share the 4-cost price and the section header cannot say which; the
   crests are there because inside a Freezing Frost section, what you want to
   know about a body is what *else* it can be. The skill, the rank scaling and
   where to find it are in the record one click away, on the same bargain the
   weapon grid struck. */
function echoCard(e){
  const cost = e.cost ? `<b class="ecost">${e.cost}◆</b>` : `<b class="ecost na">—</b>`;
  return `<article class="rec erec" role="button" tabindex="0" data-act="echo" data-id="${esc(e.name)}">
    <div class="cart eart${e.icon ? " has-art" : ""}">${e.icon
      ? `<img src="${esc(e.icon)}" alt="${esc(e.name)}" loading="lazy" decoding="async">`
      : `<span class="wart-g">${icon("i-echo", 34)}</span>`}</div>
    <div class="wrec-b">
      <h3>${esc(e.name)}</h3>
      <!-- The class is in a span of its own rather than a bare text node so
           it can be the thing that clips when the line runs out of room. A
           text node between two elements is an anonymous flex item, and
           text-overflow has nothing to hang on.
           (No backticks in here: this comment is inside a template literal.) -->
      <span class="wrec-s erec-s">
        ${cost}<span class="ecls">${esc(e.class || "Unclassified")}</span>
        ${crests(e.sonata)}
      </span>
    </div>
  </article>`;
}

/* ── the sonata index ─────────────────────────────────────────────
   The tiles at the top. Each one is the filter for its own section below, not
   a link to a dialog: the thing you want after clicking Freezing Frost is
   eleven echoes, and eleven echoes will not fit in a modal that then has to be
   dismissed before you can act on any of them.

   Clicking the lit tile clears back to all, which is the same gesture the rail
   uses to fold a view's filter list — one control, two directions. */
function sonataTile(s){
  const on = String(S.eset) === String(s.id);
  const n = echoesInSet(s.id).length;
  /* A toggle, so the id it sends is "all" once it is the one that is on.
     Clicking the lit set to clear it is the same gesture the rail uses to fold
     an open filter list, and doing it here rather than in setSonata keeps the
     set links inside an echo record as plain navigation — following a link to
     the set you are already looking at should take you to it, not empty the
     page. */
  return `<button class="stile${on ? " on" : ""}" data-act="eset" data-id="${on ? "all" : s.id}"
          data-set="${s.id}" aria-pressed="${on}"${sonataStyle(s)}>
    <span class="stile-c">${s.icon
      ? `<img src="${esc(s.icon)}" alt="" loading="lazy" decoding="async">`
      : icon("i-sonata", 22)}</span>
    <span class="stile-t">
      <b data-fit="1.05" data-fit-lines="2">${esc(s.name)}</b>
      <span class="stile-m">${s.pieces.map(p => `${p.n}pc`).join(" · ") || "—"}
        <i>${n}</i></span>
    </span>
  </button>`;
}

function sonataIndex(){
  const sets = sonataSets();
  const on = S.eset !== "all" ? sonataFor(S.eset) : null;
  return `<div class="panel spanel">
    <div class="panel-h">
      <h2>Sonata effects</h2>
      <span class="sub">${on
        ? `showing <b class="accent">${esc(on.name)}</b> below`
        : `${plural(sets.length, "set")} · pick one to narrow the roster`}</span>
      ${on ? `<button class="more" data-act="eset" data-id="all">All sets ${icon("i-close", 11)}</button>` : ""}
    </div>
    <div class="panel-b">
      ${sets.length ? `<div class="sgrid">${sets.map(sonataTile).join("")}</div>`
        : `<div class="empty">No sonata data loaded.</div>`}
    </div>
    <div class="panel-f"><span class="tier-note">
      Standard sets pay at 2 and 5 pieces; the five compact sets pay once, at 3. An echo
      that rolls more than one set appears under each of them.
    </span></div>
  </div>`;
}

/* ── the roster, one section per set ──────────────────────────────
   The set's bonuses ride in the section header rather than in a record of
   their own. They are two sentences, they are the reason the section exists,
   and putting them behind a click would mean reading the answer in one place
   and acting on it in another. */
function sonataSection(s, rows){
  const el = sonataElem(s);
  return `<div class="panel epanel"${sonataStyle(s)}>
    <div class="panel-h ssec-h">
      <span class="ssec-c">${s.icon
        ? `<img src="${esc(s.icon)}" alt="" loading="lazy" decoding="async">`
        : icon("i-sonata", 20)}</span>
      <h2>${esc(s.name)}</h2>
      <span class="sub">${plural(rows.length, "echo", "echoes")}${
        s.alias ? ` · was ${esc(s.alias)}` : ""}${el ? ` · ${esc(el)}` : ""}</span>
      <!-- The way out, in the header you were just scrolled to. The index at
           the top of the page carries the same control, and by the time the
           page has narrowed to one section that control is above the fold
           behind you — which makes it the wrong place for it to be the only
           one. (No backticks in here: this is inside a template literal.) -->
      ${S.eset === "all" ? "" :
        `<button class="more" data-act="eset" data-id="all" data-set="${s.id}">
           All sets ${icon("i-close", 11)}</button>`}
    </div>
    <div class="ssec-b">${s.pieces.length
      ? s.pieces.map(p => `<div class="sbonus">
          <span class="sbonus-n">${p.n}<i>pc</i></span>
          <div class="sbonus-t">${p.text}</div>
        </div>`).join("")
      : `<p class="wr-thin">No bonus text published for this set yet.</p>`}</div>
    <div class="panel-b">
      ${rows.length ? `<div class="rgrid wgrid egrid">${rows.map(echoCard).join("")}</div>`
        : `<div class="empty">Nothing in the database rolls this one yet.</div>`}
    </div>
  </div>`;
}

/* Cost first, then class within it, then name. That puts Calamity above
   Overlord inside a section — the two are the same price and not the same
   thing — and leaves the rest alphabetical, which is how you find a name you
   already know. */
const byCostThenName = (a, b) =>
  ((b.cost || 0) - (a.cost || 0)) ||
  (ECLASSES.indexOf(a.class) - ECLASSES.indexOf(b.class)) ||
  a.name.localeCompare(b.name);

/* Narrow the roster to one set, or back to all. Three callers — a tile, a link
   inside an echo record, and the command palette — so it lives here rather than
   inside the click handler.

   It closes any open record, because this is the one filter on the desk that
   can be reached from inside a drawer: leaving the record standing over a page
   that has just changed underneath it would hide the only thing the click did. */
function setSonata(id){
  const narrowing = !(id == null || id === "all");
  S.eset = narrowing ? String(id) : "all";
  /* All the way out, trail and all. This is leaving the drawer for a page, not
     backing out of one panel into the one underneath it — coming back here
     from the Echoes view would be going forward again. */
  closeDrawer(true);
  if(S.view !== "echoes") setView("echoes");
  else draw("echoes");

  /* Land on the section, not on the index that sent you there. The sets sit
     above the roster because that is the order you read the page in, but it
     means the one section a click leaves standing is below thirty-four tiles —
     and a control whose effect is off the bottom of the screen reads as a
     control that did nothing. So a pick scrolls; clearing back to all does
     not, because "all" is the state the top of the page already describes.

     Same gesture the kit band uses to jump to a skill card. Focus is put back
     on the tile by the caller with preventScroll, or the browser would drag
     the page back up to it and undo this. */
  if(narrowing) document.querySelector("#p-echoes .epanel")
    ?.scrollIntoView({block:"start", behavior:"smooth"});
}

function renderEchoes(){
  const sets = sonataSets();
  const shown = S.eset === "all" ? sets : sets.filter(s => String(s.id) === String(S.eset));

  /* An echo that rolls nothing at all. There are none today — every record on
     file names at least one set — but a new body arriving before its sonata
     data does would otherwise be in the database and on no page, which is the
     one failure mode a database view must not have. */
  const loose = [...echoes()].filter(e => !(e.sonata || []).length).sort(byCostThenName);

  $("#p-echoes").innerHTML = `<div class="stack">
    ${pageTitle("echoes")}
    ${sonataIndex()}
    ${shown.map(s => sonataSection(s, [...echoesInSet(s.id)].sort(byCostThenName))).join("")}
    ${S.eset === "all" && loose.length ? `<div class="panel epanel">
      <div class="panel-h">
        <h2>No sonata set</h2>
        <span class="sub">${plural(loose.length, "echo", "echoes")} · rolls nothing on file</span>
      </div>
      <div class="panel-b"><div class="rgrid wgrid egrid">${loose.map(echoCard).join("")}</div></div>
    </div>` : ""}
  </div>`;
}

/* ── the echo record ─────────────────────────────────────────────────
   Same two-column shape as the weapon record, and reusing its classes rather
   than growing a parallel set: a picture, a block of prose and a rail of
   facts is one layout, and it is already built, measured and responsive.

   What goes in the rail is what the grid could not say — the rank scaling,
   where the creature stands, and the other sets this body can roll. There is
   no sonata record any more; a set is a section of the page, and a link to one
   from here closes the record and takes you to it. */

/* Where to go and kill it. Off the wiki's enemy infobox, and everything in it
   is optional — a Nightmare variant has one dungeon and no region chain, a
   Reminiscence echo has no enemy page at all — so each row draws only if it
   has something to say, and the block itself disappears rather than standing
   there labelled and empty. */
function echoWhere(e){
  const w = e.where;
  const cls = e.class ? `<p class="ewhere-m">${esc(ECLASS_MEANS[e.class] || "")}</p>` : "";
  /* No location, and therefore no class gloss either. "A field boss, it stands
     in one place" is a sentence about where Overlords are, and printing it
     directly above "the wiki has no location for this one" is the record
     arguing with itself — which is exactly what it did before this line. The
     class is still stated, as a pill, at the top of the record. */
  if(!w) return `<section class="wr-intel">
    <span class="label">Where to find it</span>
    <p class="wr-thin">The wiki has no location for this one. Most of the Reminiscence
      echoes are fought inside a mode rather than standing somewhere on the map.</p>
  </section>`;

  /* Nation › Region › Subregion, or the single location a Nightmare variant
     gets instead. Joined with a mark rather than a comma so it reads as a
     path narrowing rather than as a list of three equal places. */
  const path = [w.nation, w.region, w.subregion].filter(Boolean);
  const rows = [
    ["Found in", path.length ? path.join(" › ") : w.location],
    ["Family", [w.family, w.group].filter(Boolean).join(" · ")],
    ["Also drops", w.drops]
  ].filter(([, v]) => v);

  return `<section class="wr-intel">
    <span class="label">Where to find it</span>
    ${cls}
    <div class="ewhere">${rows.map(([k, v]) =>
      `<div><span class="k">${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
    ${w.wiki ? `<a class="dsrc" href="${esc(w.wiki)}" target="_blank" rel="noopener">
      ${icon("i-book", 14)}Wiki page<span class="arrow">${icon("i-arrow", 13)}</span></a>` : ""}
  </section>`;
}

function drawerEcho(name){
  const e = echoFor(name);
  if(!e) return;

  const sets = (e.sonata || []).map(sonataFor).filter(Boolean);
  /* The record's accent. An echo has no element of its own, so where every set
     it rolls reads in one element, that wins: an echo that only ever appears
     in Freezing Frost is a Glacio echo in every practical sense. Failing that,
     the creature's own damage type off the wiki, which is the next most
     honest thing on file. Failing both, the site accent. */
  const elems = [...new Set(sets.map(sonataElem).filter(Boolean))];
  const accent = (elems.length === 1 ? attrStyle(elems[0]) : "")
    || attrStyle(e.where?.element);

  const setList = sets.length ? `<section class="wr-intel">
    <span class="label">Sonata sets — ${sets.length}</span>
    <div class="wr-intel-l">${sets.map(s => `
      <span class="dsrc" role="button" tabindex="0" data-act="eset" data-id="${s.id}">
        ${s.icon ? `<img class="dsrc-c" src="${esc(s.icon)}" alt="" width="17" height="17"
                        loading="lazy" decoding="async">` : `<i class="dot"></i>`}
        ${esc(s.name)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div>
  </section>` : "";

  openDrawer("Echo record", `<div class="drawer-b wrec-r erec-r"${accent}>
    <div class="wr-main">
      <header class="wr-head bare">
        <div class="wr-id">
          <div class="meta">
            <span class="pill">${esc(e.class || "Unclassified")}</span>
            ${e.cost ? `<span class="pill ver">${e.cost}-cost</span>` : ""}
            ${Number(e.minRank) > 1 ? `<span class="pill">Rank ${e.minRank}+</span>` : ""}
          </div>
          <h2>${esc(e.name)}</h2>
        </div>
      </header>

      <div class="wr-body">
        <!-- The creature at the size it was drawn. Squared plate: an echo
             render is the square card the game files the creature under,
             background and all.
             (No backticks in here: this comment is inside a template literal.) -->
        <figure class="wr-art">${e.icon
          ? `<img src="${esc(e.icon)}" alt="${esc(e.name)}" decoding="async">`
          : `<span class="wr-art-g">${icon("i-echo", 56)}</span>`}</figure>

        <section class="wr-eff">
          <span class="label">Echo skill <em data-eranklabel="${esc(e.name)}">R${erankOf(e)}</em></span>
          <div class="weff" data-eskill="${esc(e.name)}">${echoSkillHtml(e, erankOf(e))}</div>
        </section>
      </div>
    </div>
    <aside class="wr-rail">
      <h3 class="wr-rail-h">Rank, place and sets</h3>
      <div class="wr-lv">
        <span class="label">Skill values by rank</span>
        ${erankBar(e)}
      </div>
      ${echoWhere(e)}
      ${setList}
    </aside>
  </div>`, `echo:${e.name}`);
}

/* ── aside ───────────────────────────────────────────────────────── */
function renderAside(){
  const feed = DATA.feed || {};
  const all = signals();
  const next = nextVersion();
  const days = next?.start ? daysTo(next.start) : null;
  const counts = tierCounts();

  /* Featured = the debut you can actually pull right now: a new resonator on a
     phase of the live patch that has not closed yet.

     Read off the live patch rather than the next one. For most of a cycle the
     next patch has no banners published — nothing is announced until Kuro says
     so — so the old line found nothing, fell through to resonators()[0], and
     the panel spent weeks at a time featuring Aalto, who is first in the file
     alphabetically and has not run since 1.0. It only ever showed the right
     face in the few days between an announcement and a release.

     Falls forward to the next patch's debut once every phase of the live one
     has closed, which is the window where "right now" really is next week,
     and only then to the newest record. */
  const debuts = v => (v?.phases || []).flatMap(p =>
    (p.banners || []).filter(b => b.new && b.name && b.name !== "???")
      .map(b => ({name:b.name, closed: !!p.end && daysTo(p.end) < 0})));
  const live = liveVersion();
  const featName = (debuts(live).find(b => !b.closed)
    || debuts(next)[0] || debuts(live)[0])?.name;
  const feat = (featName && resonatorFor(featName).name)
    ? resonatorFor(featName) : resonators()[0];

  /* Live version, next patch and entry count are already answered by the patch
     timeline this panel sits beside — in full, with dates and banners, rather
     than as three numbers. Repeating them here spent a whole panel saying
     nothing new; what's left is the part the timeline doesn't carry: the shape
     of the tier split and the feed's volume. */
  const glance = `<div class="panel">
    <div class="mini-h"><h3>At a glance</h3></div>
    <div class="mini-b"><div class="glance">
      <div class="glance-row">Official / datamined <b>${(counts.official||0)} / ${(counts.datamined||0)}</b></div>
      <div class="glance-row">Reported / rumour <b>${(counts.reported||0)} / ${(counts.rumour||0)}</b></div>
      <div class="glance-row">Signals captured <b>${all.length}</b></div>
      <div class="glance-row">Flagged hot <b>${all.filter(i => i.hot).length}</b></div>
      ${days != null && days > 0
        ? `<div class="glance-row">${esc(next.id)} in <b class="accent">${plural(days, "day")}</b></div>` : ""}
    </div></div>
  </div>`;

  const featSeen = feat ? lastIntelFor(feat.name) : "";
  /* The whole panel opens the record, not just the button at the foot of it.
     Everything in here is about one Resonator and has one place to go — the
     face, the name, the tier badges — so the frame is the target and "View
     profile" is the label on it rather than the only live pixel. Same rule as
     every other card on the desk: role=button on the frame, and the keydown
     handler turns Enter and Space into a click. */
  const featured = feat ? `<div class="panel feat"${attrStyle(feat.attribute)}
    role="button" tabindex="0" data-act="resonator" data-id="${esc(feat.name)}"
    aria-label="${esc(feat.name)} — Resonator record">
    <div class="mini-h"><h3>Featured resonator</h3>
      ${feat.version ? `<span class="pill ver">${esc(feat.version)}</span>` : ""}</div>
    ${artPanel({name:feat.name, ...(bannerFor(feat.name) || {})})}
    <div class="feat-b">
      <h3>${esc(feat.name)}</h3>
      ${feat.nameCN ? `<div class="cjk">${esc(feat.nameCN)}</div>` : ""}
      <div class="rec-attrs">
        ${stars(feat.rarity)}
        ${feat.attribute ? `<b>${esc(feat.attribute)}</b>` : ""}
        ${feat.weapon ? `<span>${esc(feat.weapon)}</span>` : ""}
      </div>
      ${feat.role ? `<div class="rec-role">${esc(feat.role)}</div>` : ""}
      ${confidenceRows(feat)}
      ${featSeen ? `<div class="rec-when" style="margin-top:11px">Last intel ${fmtDate(featSeen)}</div>` : ""}
      ${/* Not a <button> any more: the card around it is already the button,
           and a second one inside would be a second tab stop and a second
           thing to announce for the same destination. It stays as the
           affordance — the panel needs somewhere to say it is clickable. */""}
      <span class="btn">View profile ${icon("i-arrow", 12)}</span>
    </div>
  </div>` : "";

  /* A Source health panel stood here, listing every fetcher by name with a
     status dot. It is build diagnostics — useful to whoever runs the workflow,
     which is one person, and meaningless to everyone reading the desk. The run
     summary in the Live Signals header is what a reader actually needs. */

  $("#aside").innerHTML = glance + featured;
}

/* ── drawer ──────────────────────────────────────────────────────── */
let lastFocus = null;

/* ── where you came from ──────────────────────────────────────────
   Records open other records. A build names its main-slot echo, an echo names
   the sets it rolls, a Resonator names their signature weapon — and every one
   of those replaces the panel you were reading. Before this, closing the echo
   you had opened from Zhezhi's build dropped you on the page behind both, and
   the way back to Zhezhi was to search for her again.

   So the drawer keeps a trail. Opening a record while one is already up pushes
   the old one; closing pops back to it instead of dismissing, and the header
   carries a labelled way back so the behaviour is visible rather than
   something you find out by pressing Escape.

   Kept as (kind, id) rather than as saved markup: replaying dispatch() rebuilds
   the panel from current data, so a record you return to is not a stale
   snapshot of one — and it costs two strings per level instead of a document.

   `drawerSeq` is how the stack knows a click actually opened something. Half
   the openers bail — drawerEcho on a name it has no record for, drawerWeapon
   on a weapon with neither a row nor a convene — and pushing the current panel
   on a call that turned out to be a no-op would put a duplicate in the trail
   and make Back do nothing. */
let drawerTrail = [], drawerNow = null, drawerSeq = 0;
const DRAWER_MAX = 12;

/* What to call the panel underneath, on the way back to it. Ids are display
   names for most kinds and internal for two, so those two are looked up. */
function drawerLabel(kind, id){
  if(kind === "intel") return entries().find(e => e.id === id)?.title || "intel";
  if(kind === "event") return gameEvents().find(e => e.id === id)?.name || "event";
  if(kind === "version") return `Version ${id}`;
  if(kind === "open") return String(id).startsWith("astrite:") ? "Astrite estimate" : "Methodology";
  return String(id || "");
}

/* `id` names what the drawer is currently showing. Only the resonator record
   needs it — it is the one panel that finishes drawing after an await, and it
   has to know whether the reader has moved on before answering. */
function openDrawer(kind, html, id = null){
  S.drawer = id;
  drawerSeq++;
  $("#drawer-kind").textContent = kind;
  $("#drawer-body").innerHTML = html;
  paintDrawerBack();
  const d = $("#drawer");
  if(d.hidden){
    lastFocus = document.activeElement;
    d.hidden = false;
    document.body.style.overflow = "hidden";
  }
  d.querySelector(".drawer-panel").scrollTop = 0;
  d.querySelector(".drawer-panel").focus();
  fitSoon();
}

/* The back control lives in the drawer's own header, beside the kind label,
   because that is the one strip every panel shares — putting it inside a
   record would mean seven renderers each remembering to draw it. */
function paintDrawerBack(){
  const slot = $("#drawer-back");
  if(!slot) return;
  const prev = drawerTrail[drawerTrail.length - 1];
  slot.innerHTML = prev
    ? `<button class="drawer-backb" data-act="drawerback">
         ${icon("i-arrow", 12)}<span>${esc(prev.label)}</span></button>`
    : "";
}

/* Pops one level, or closes when there is nothing to pop back to. `all` skips
   the trail entirely, for the two places that are navigating away from the
   drawer rather than backing out of it — picking a sonata set, which leaves
   for the Echoes page, and any redraw that replaces the view underneath. */
function closeDrawer(all){
  const d = $("#drawer");
  if(d.hidden){ drawerTrail = []; drawerNow = null; return; }
  if(!all && drawerTrail.length){
    const prev = drawerTrail.pop();
    drawerNow = prev;
    /* Straight to the opener rather than through dispatch(), which is what
       pushes onto the trail — going back must not record itself as a step
       forward. */
    reopenDrawer(prev.kind, prev.id);
    /* And back onto the half you left it on. Every record opens on the kit,
       which is right when you asked for the record and wrong when you are
       returning to one: you were reading a build, you followed an echo out of
       it, and the way back should not quietly be somewhere else. Coming back
       is not opening. */
    if(prev.kind === "resonator" && prev.tab === "build") showRecordTab("build");
    return;
  }
  drawerTrail = [];
  drawerNow = null;
  S.drawer = null;
  d.hidden = true;
  document.body.style.overflow = "";
  lastFocus?.focus?.();
}

/* `box` puts the same list in a framed panel instead of a ruled section, for
   the records that set it beside something else rather than under everything. */
function sourceList(sources, box){
  if(!sources?.length) return "";
  return `<div class="${box ? "dpanel" : "dsec"}"><span class="label">Sources</span>
    <div style="display:grid;gap:8px">${sources.map(s => s.url
      ? `<a class="dsrc" href="${esc(s.url)}" target="_blank" rel="noopener">
           <span class="lang">${esc((s.lang || "??").toUpperCase())}</span>${esc(s.name)}
           <span class="arrow">${icon("i-arrow", 13)}</span></a>`
      : `<span class="dsrc"><span class="lang">${esc((s.lang || "??").toUpperCase())}</span>${esc(s.name)}</span>`
    ).join("")}</div></div>`;
}

function drawerIntel(id){
  const e = entries().find(x => x.id === id);
  if(!e) return;
  const tier = TIERS.includes(e.confidence) ? e.confidence : "rumour";
  openDrawer("Intel entry", `<div class="drawer-b">
    <div class="meta">
      ${tierBadge(tier, tier === "official")}
      <span class="pill">${fmtDate(e.date)}</span>
      ${e.version ? `<span class="pill ver">${esc(e.version)}</span>` : ""}
      ${e.category ? `<span class="pill">${esc(e.category)}</span>` : ""}
    </div>
    <h2>${esc(e.title)}</h2>
    <div class="t-${tier}" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      ${confMeter(tier)}<span class="tier-note">${esc(TIER_MEANS[tier])}</span>
    </div>
    <p>${esc(e.body)}</p>
    ${e.outcome === "confirmed" ? `<p class="outcome ok" style="margin-top:14px">✓ Later confirmed officially.</p>` : ""}
    ${e.outcome === "superseded" ? `<p class="outcome no" style="margin-top:14px">✕ Superseded — this one did not hold up.</p>` : ""}
    ${e.tags?.length ? `<div class="dsec"><span class="label">Tags</span>
      <div class="chips">${e.tags.map(t => `<button data-act="noop">${esc(t)}</button>`).join("")}</div></div>` : ""}
    ${sourceList(e.sources)}
    <div class="dsec"><span class="label">What this tier means</span>
      <p style="margin:0">${esc(DATA.news?.confidenceTiers?.[tier] || TIER_MEANS[tier])}</p></div>
  </div>`);
}

/* The signature weapon, as a card rather than a row of the record. It is the
   one line in there that goes somewhere — the weapon has its own panel — and a
   link buried in a column of plain facts reads as another fact. Clickable once
   the desk holds anything to show: a record in the weapon database, or a
   convene on the timeline. Before the Weapons view existed only the second
   counted, which left the card on a 1.0 Resonator's record dead. */
function sigWeaponCard(wname){
  if(!wname) return "";
  const w = weaponFor(wname);
  const live = !!w || weaponRuns(wname).length > 0;
  const art = w?.icon
    ? `<img src="${esc(w.icon)}" alt="" loading="lazy" decoding="async">`
    : icon("i-weapon", 20);
  const inner = `<span class="wcard-art">${art}</span>
    <span class="wcard-t">
      <span class="label">Signature weapon</span>
      <b data-fit="1.45" data-fit-lines="1">${esc(wname)}</b>
    </span>
    ${w?.rarity ? `<span class="wcard-r">${esc(w.rarity)}★</span>` : ""}
    ${live ? `<span class="arrow">${icon("i-arrow", 13)}</span>` : ""}`;
  return live
    ? `<button class="wcard" data-act="weapon" data-id="${esc(wname)}">${inner}</button>`
    : `<div class="wcard is-flat">${inner}</div>`;
}

/* The same weapon, at the size the record has room for. On a banner row a
   signature is one line among five and the 40px icon is a bullet; on the
   record it is the only other object on the page, and Kuro draws these — the
   art is the reason anyone recognises a weapon at all. So the picture leads and
   the name sits under it, the way the game's own inventory shows one. */
function sigWeaponBig(wname){
  if(!wname) return "";
  const w = weaponFor(wname);
  const live = !!w || weaponRuns(wname).length > 0;
  const inner = `
    <span class="wsig-h">
      <span class="label">Signature weapon</span>
      ${w?.rarity ? `<span class="wsig-r">${esc(w.rarity)}★</span>` : ""}
    </span>
    <span class="wsig-art">${w?.icon
      ? `<img src="${esc(w.icon)}" alt="${esc(wname)}" loading="lazy" decoding="async">`
      /* Announced ahead of its patch and not drawn yet. The generic mark at the
         same size, rather than a borrowed picture of somebody else's weapon. */
      : icon("i-weapon", 48)}</span>
    <b>${esc(wname)}</b>
    <span class="wsig-f">
      ${w?.type ? `<span>${esc(w.type)}</span>` : ""}
      ${live ? `<span class="arrow">${icon("i-arrow", 13)}</span>` : ""}
    </span>`;
  return live
    ? `<button class="wsig" data-act="weapon" data-id="${esc(wname)}">${inner}</button>`
    : `<div class="wsig is-flat">${inner}</div>`;
}

/* ── the resonator record ──────────────────────────────────────────
   Built the same way the event record is, and for the same reason: the picture
   is the thing you arrive at, so it holds the page rather than sitting in a box
   on it. Kuro's key art runs down the right of the hero with the name, the
   element and the state set into it; the signature weapon and the banner they
   run on sit in the far column, on the art; the seven facts everybody actually
   opens a record for are a strip under it; then the kit — the rotation as a
   rotation, and then the six cards.

   What went is the tall 4:5 art panel across the full width of the panel. A
   1500px modal with a 400px cut-out centred in it is a portrait in a field, and
   everything the record has to say started below the fold. */

const ATTR_ICON = {
  glacio:"i-e-glacio", fusion:"i-e-fusion", electro:"i-e-electro",
  aero:"i-e-aero", spectro:"i-e-spectro", havoc:"i-e-havoc"
};
function attrIcon(a, size = 14){
  const id = ATTR_ICON[String(a || "").toLowerCase()];
  return id ? icon(id, size) : "";
}

/* Rarity as the game draws it. The corner chip said "5★" in mono, which is the
   same fact at a size nobody reads first — and the one thing a reader wants off
   a Resonator before the name is whether they are a five. */
function rarityStars(n){
  const r = Number(n) || 0;
  if(!r) return "";
  return `<span class="rr-stars" role="img" aria-label="${r} star">${
    Array.from({length:r}, () => `<i>★</i>`).join("")}</span>`;
}

/* Debut, first release, and whether they have ever come back — the three dates
   a record is opened for, in that order.

   Reruns are a 5★ question. A 4★ is rate-up filler on nearly every banner that
   runs, so the same list that reads as a history for a limited Resonator reads
   as a wall of patch numbers for them; their badge already drops the count for
   this reason and so does this. */
function releaseHistory(r){
  if(!r.version && !r.released) return "";
  const filler = String(r.rarity) === "4";
  const reruns = filler ? [] : r.reruns || [];
  const debuted = hasDebuted(r);

  const back = r.standard ? "Standard pool"
    : filler ? "Rate-up filler"
    : reruns.length ? `${plural(reruns.length, "rerun")}`
    : debuted ? "None yet"
    : "Unreleased";
  const backSub = r.standard ? "Always available"
    : filler ? "On most banners that run"
    : reruns.length ? `Latest ${reruns[reruns.length - 1]}`
    : debuted ? "Has not come back" : "No banner yet";

  return `<div class="dpanel rr-hist">
    <span class="label">Release history</span>
    <ol class="rr-steps">
      <li><b>${esc(r.version || "—")}</b><em>Debut patch</em></li>
      <li><b>${r.released ? esc(fmtDate(r.released)) : "—"}</b><em>First release</em></li>
      <li class="${reruns.length || r.standard ? "on" : ""}"><b>${esc(back)}</b><em>${esc(backSub)}</em></li>
    </ol>
    ${reruns.length ? `<div class="rr-runs">${reruns.map(v =>
      `<button class="pill ver" data-act="version" data-id="${esc(v)}">${esc(v)}</button>`).join("")}</div>` : ""}
  </div>`;
}

/* The one thing a record for an unreleased Resonator has to say before anything
   else on it can be read safely.

   The tiers have always been on this page — a badge on the identity, another
   over the kit notes — and they are the right way to grade a single claim once
   a reader knows to look for one. What they cannot do is answer the question
   somebody arrives on an unreleased record already asking, which is how much of
   this is real. A character three weeks from beta gets the same strip of facts,
   the same headings and the same confident type as one who shipped a year ago:
   the tiers are the fine print, the layout is the headline, and the headline is
   wrong. So it is said once, in words, at the top.

   Three tiers rather than the usual two. Identity, role and kit confirm at
   different moments — the drip card and profile card settle attribute, weapon
   and rarity within days of each other, the role tag turns up in a leak group's
   spreadsheet weeks before Kuro says it, and the kit is not final until the last
   beta phase — so a record with one badge on it is grading whichever of the
   three the reader happened to be looking at. */
function unreleasedNote(r){
  if(!r.name || hasDebuted(r)) return "";
  const rows = [
    ["Identity", r.confidence?.identity, "Attribute, weapon, rarity"],
    ["Role", r.confidence?.role, "Where they play in a team"],
    ["Kit", r.confidence?.kit, "Skills, scaling, mechanics"]
  ].filter(([, t]) => t);
  return `<div class="rr-unrel">
    <div class="rr-unrel-h">
      <span class="pill future">Not released yet</span>
      ${r.version ? `<span class="tier-note">Debuts in version ${esc(r.version)}</span>` : ""}
    </div>
    <p>Kuro has not shipped ${esc(r.name)}. Anything on this page not marked
    <b>Official</b> is pre-release reporting — leaker claims, beta files, community
    translation — and any of it can change or turn out to be wrong before release
    day. Roles get rewritten, multipliers move between beta phases, and the names
    for new mechanics stay fan translations until the English client ships its
    own.</p>
    ${rows.length ? `<div class="rr-unrel-t">${rows.map(([k, t, sub]) => `<div>
      <span class="label">${esc(k)}</span>
      <span title="${esc(TIER_MEANS[t] || "")}">${tierBadge(t, t === "official")}</span>
      <em>${esc(sub)}</em>
    </div>`).join("")}</div>` : ""}
  </div>`;
}

/* The role tags as the source actually has them.

   Kuro gives a Resonator a list — "Main Damage Dealer; Basic Attack Damage;
   Electro DMG Amplification; ..." — and fetch-kits.mjs keeps the first clause,
   because a card has room for one short label and for a character whose kit has
   shipped that label is the whole answer. Nobody needs the tag list to know how
   Jingran plays.

   Before release it is the opposite. The tag list is the only thing anybody has,
   and the first clause on its own is the most misleading part of it: a Main DPS
   tag establishes that a Resonator can hold the on-field slot, not that they
   will — Phoebe carries it and is played as Zani's buffer — and the tags beside
   it are the ones that say where the damage actually comes from. Compressing
   five tags to one and printing it in the same type as the element was the desk
   asserting a rotation nobody has published. So the list goes back. */
function roleTagPanel(r){
  const tags = r.roleTags;
  if(!tags?.length) return "";
  const t = r.confidence?.role;
  return `<div class="rr-tags">
    <div class="rr-tags-h">
      <span class="label">Role tags</span>
      ${t ? tierBadge(t, t === "official") : ""}
    </div>
    <div class="rr-tags-l">${tags.map((x, i) =>
      `<span class="rr-tag${i ? "" : " lead"}">${esc(x)}</span>`).join("")}</div>
    <p>Kuro tags a Resonator with several of these, and the Role tile above keeps
    the first — the whole answer for a character whose kit has shipped, and not
    the whole answer before one has. A <b>Main DPS</b> tag establishes that a
    Resonator can hold the on-field slot, not that they are the one who will:
    Phoebe carries it and is played as Zani's buffer. The tags beside it are what
    say where the damage is meant to come from.</p>
  </div>`;
}

function drawerResonator(name){
  const r = resonatorFor(name);
  const b = bannerFor(name) || {};
  if(!r.name && !b.name) return;
  /* Every record opens on the kit. See S.rtab — the kit is what the character
     is, the build is what somebody thinks you should do about it, and the
     second is not the thing to answer with before it has been asked. */
  S.rtab = "kit";
  const f = figure({name, ...b});
  const kitTier = r.confidence?.kit;
  const sig = r.signature || b.signature;
  const attr = r.attribute || b.attribute;
  const rarity = r.rarity || b.rarity;
  const version = r.version || b.version;
  const convene = r.convene || b.convene;

  /* The seven facts, as a strip. These were a label-and-value table in the far
     column, where seven two-word rows put the label at one edge of a 440px box
     and the value at the other and nothing was readable as a set. Across the
     record they are seven tiles you take in at once, which is what "at a
     glance" has to mean to be worth the words. */
  const glance = [
    ["Element", attr, attr ? attrIcon(attr, 22) : icon("i-res", 22), "attr"],
    ["Weapon", r.weapon || b.weapon, icon("i-weapon", 22)],
    /* Role carries a tier of its own, where the other six do not, because it is
       the one tile on the strip that can be somebody's guess. Element, weapon
       and rarity come off Kuro's profile card; the dates come off the calendar.
       "Main DPS" on an unreleased Resonator comes off a leak group's tag list,
       and printed in the same type as the other six it reads as the same kind
       of fact. Drawn only when it is not official — a released character's role
       is the game's own answer and needs no grading. */
    ["Role", r.role || b.role, icon("i-role", 22), "", r.confidence?.role, r.roleTags?.length],
    ["Region", r.region, icon("i-region", 22)],
    ["Debut", version ? `Version ${version}` : "", icon("i-timeline", 22)],
    ["Released", r.released ? fmtDate(r.released) : (hasDebuted(r) ? "" : "Not yet"), icon("i-timeline", 22)],
    ["Reruns", r.standard ? "Standard pool"
      : String(r.rarity) === "4" ? "Rate-up filler"
      : r.reruns?.length ? plural(r.reruns.length, "rerun")
      : hasDebuted(r) ? "None yet" : "", icon("i-rerun", 22)]
  ].filter(([, v]) => v);

  /* The far column of the hero is the signature weapon and nothing else. It is
     the only other object on this page — a thing Kuro drew, that the reader
     wants to look at — so it gets the column at a size worth looking at, and
     everything that is a fact about the Resonator rather than an object goes
     where the facts are. Skipped when they have no signature, and the art takes
     that width instead: an empty box standing beside the name is worse than the
     room it was holding.

     Which banner they run on used to be the second card up here. It is a line
     of text and a link, it was reading as an object beside a picture of one,
     and it belongs with the writing. */
  const rail = sigWeaponBig(sig);
  const runsOn = convene ? `<div class="rr-runs-on">
    <span class="label">Runs on</span>
    ${version
      ? `<button data-act="version" data-id="${esc(version)}">
          <b>${esc(convene)}</b><em>Version ${esc(version)} — the whole patch</em>
          <span class="arrow">${icon("i-arrow", 13)}</span></button>`
      : `<b>${esc(convene)}</b>`}
  </div>` : "";

  openDrawer("Resonator record", `<div class="drawer-b rrec"${attrStyle(attr)}>
    <header class="rr-hero${f.image ? "" : " bare"}${rail ? " railed" : ""}">
      ${f.image
        ? `<div class="rr-pic${f.cutout ? " cut" : ""}">
             ${f.cutout
               ? `<img class="rr-wash" src="${esc(f.image)}" alt="" aria-hidden="true" decoding="async">`
               : ""}
             <img src="${esc(f.image)}" alt="${esc(name)}" decoding="async"${f.style}>
           </div>`
        /* No picture resolved. The desk's own rings, same as everywhere else,
           and the initial the grid already falls back to. */
        : `<div class="rr-pic none"><div class="ev-plate" aria-hidden="true">
             <span>No art published yet</span></div>
             <span class="rr-glyph">${esc(f.glyph)}</span></div>`}
      <div class="rr-copy">
        ${attr ? `<div class="rr-elem">${attrIcon(attr, 26)}<span>${esc(attr)}</span></div>` : ""}
        ${rarityStars(rarity)}
        <h2>${esc(name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h2>
        ${f.epithet || r.epithet ? `<div class="cepithet">${esc(f.epithet || r.epithet)}</div>` : ""}
        <div class="meta">
          ${r.confidence?.identity ? tierBadge(r.confidence.identity, r.confidence.identity === "official") : ""}
          ${r.status ? `<span class="pill">${esc(r.status)}</span>` : ""}
          ${b.phase ? `<span class="pill">Phase ${esc(b.phase)}</span>` : ""}
        </div>
        ${r.summary ? `<p class="rr-sum">${esc(r.summary)}</p>`
          : `<p class="rr-sum evr-thin">No written record yet — identity only.</p>`}
        ${runsOn}
      </div>
      ${rail ? `<aside class="rr-rail">${rail}</aside>` : ""}
      ${debutBadge(r)}
    </header>
    ${creditLine({name, ...b})}
    ${unreleasedNote(r)}

    ${glance.length ? `<div class="rr-glance">
      ${glance.map(([k, v, ic, cls, tier, tags]) => `<div class="${cls || ""}">
        <span class="rr-g-i">${ic}</span>
        <em>${esc(k)}</em><b>${esc(v)}</b>
        ${tier && tier !== "official"
          ? `<span class="rr-g-tier t-${esc(tier)}" title="${esc(TIER_MEANS[tier] || "")}">${
              esc(TIER_LABEL[tier] || "")}${
              /* "1 of 5 tags" is the whole point of the line. The tile prints one
                 word where the source has a list, and a reader who only sees the
                 word reads it as the finding rather than as the first item of
                 one. Says so on the tile, and the panel underneath has the rest. */
              tags > 1 ? ` · 1 of ${tags} tags` : ""}</span>`
          : ""}
      </div>`).join("")}
    </div>` : ""}
    ${roleTagPanel(r)}

    ${recordTabs()}

    <!-- Both halves of the record, both in the DOM, one of them hidden. The
         toggle is a hidden flip rather than a redraw: the kit is a lazy
         megabyte and the build is a lazy third of one, and swapping tabs twice
         should not cost two fetches or throw away where you had scrolled to.
         (No backticks in here: this comment is inside a template literal.) -->
    <div id="kittab"${S.rtab === "kit" ? "" : " hidden"}>
      ${r.kit?.length ? `<div class="dsec">
        <span class="label">Kit notes — ${TIER_MEANS[kitTier] || "Unverified"}</span>
        <div style="margin-bottom:12px">${tierBadge(kitTier, kitTier === "official")}</div>
        <ul>${r.kit.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
        <p class="tier-note" style="margin-top:14px">Pre-balance. Multipliers and mechanics
        routinely shift between beta phases.</p>
      </div>` : ""}

      <div id="kitwrap"><div class="dsec"><span class="label">Skills</span>
        <p style="margin:0;color:var(--fg-3)">Loading kit…</p></div></div>
    </div>

    <div id="buildtab"${S.rtab === "build" ? "" : " hidden"}>
      <div id="buildwrap"><div class="dsec"><span class="label">Builds and teams</span>
        <p style="margin:0;color:var(--fg-3)">Loading builds…</p></div></div>
    </div>

    <div class="rr-cols">
      ${releaseHistory(r)}
      ${sourceList(r.sources, true)}
    </div>
  </div>`, `resonator:${name}`);

  /* The record is on screen already; these drop the kit and the build in
     underneath when their files land. Guarded on the drawer still showing this
     Resonator, because a megabyte over a slow connection is long enough to
     open a record, read the summary and click through to somebody else before
     it arrives.

     Only the half you are looking at is fetched, and a record always opens on
     the kit — so builds.json is not requested until somebody asks for it, and
     then only once. */
  fillKit(name);
}

/* What goes in #kitwrap once kits.json is in hand. Three outcomes, and each
   one says something different: a kit, a character whose kit is not published
   anywhere yet, or a file that would not load. */
function fillKit(name){
  return loadKits().then(() => {
    const wrap = $("#kitwrap");
    if(!wrap || S.drawer !== `resonator:${name}`) return;
    const kit = kitFor(name);
    wrap.innerHTML = kit
      ? kitPanel(kit) + `<p class="kit-credit">Skill text as it reads in the live client. Skills © Kuro Games.</p>`
      : `<div class="dsec"><span class="label">Skills</span>
          <p style="margin:0;color:var(--fg-3)">No kit published yet — nothing has been drawn from the
          client for this Resonator.</p></div>`;
  }).catch(() => {
    const wrap = $("#kitwrap");
    if(wrap) wrap.innerHTML = `<div class="dsec"><span class="label">Skills</span>
      <p style="margin:0;color:var(--fg-3)">Kit data did not load.</p></div>`;
  });
}
/* ── builds and teams ────────────────────────────────────────────────
   The other half of a Resonator record, behind the toggle under the glance
   strip. The kit says what the character does; this says what to put on them
   and who to stand them next to.

   It is the one thing on the desk that is a judgement rather than a record. A
   patch has a start date and a weapon has a base ATK; "run Qingxiao on Heart
   of Evil's Purge with Calamity Effigy in the main slot" depends on the patch,
   on who else you own, on what the current endgame rewards, and two competent
   people can disagree about it. So it is fetched into a file of its own, it is
   never restated in the desk's own voice, and every panel here carries whose
   opinion it is and which version of the game they last revised it against —
   at the top, where you read it before the advice, not in a footer after you
   have acted on it.

   Deliberately not a second grid of cards. Everything on this panel points at
   something the desk already holds a record for — an echo, a sonata set, a
   weapon, a Resonator — so every name here is a way into that record, and the
   panel itself is prose and figures rather than another wall of pictures. */

/* The main-slot echo, drawn at the size a decision deserves. This is the one
   line on the panel that changes how the character is played rather than what
   their numbers are: it is the echo whose skill you actually cast, and picking
   a different one changes the rotation. */
function buildEchoRow(e, i = 0){
  const rec = echoFor(e.name);
  const inner = `<span class="be-art">${rec?.icon
    ? `<img src="${esc(rec.icon)}" alt="" loading="lazy" decoding="async">`
    : icon("i-echo", 20)}</span>
    <span class="be-t">
      <span class="label">${i ? "Or in the main slot" : "Main slot"}</span>
      <b>${esc(e.name)}</b>
      ${rec?.cost ? `<em>${rec.cost}◆ ${esc(rec.class || "")}</em>` : ""}
    </span>
    ${rec ? `<span class="arrow">${icon("i-arrow", 13)}</span>` : ""}`;
  return `<div class="be-row">
    ${rec
      ? `<button class="be-echo" data-act="echo" data-id="${esc(e.name)}">${inner}</button>`
      : `<span class="be-echo dead">${inner}</span>`}
    ${e.note ? `<p class="be-note">${esc(e.note)}</p>` : ""}
  </div>`;
}

/* One recommended set. A character can have more than one and they are not a
   first and second choice — Shorekeeper's are a damage build and a support
   build, which is why the upstream label ("Best", "Special") is printed as it
   stands rather than turned into a rank. */
function buildSet(s){
  const set = sonataFor(s.name);
  const pieces = set?.pieces?.map(p => `${p.n}pc`).join(" · ");
  const crest = set?.icon
    ? `<img src="${esc(set.icon)}" alt="" loading="lazy" decoding="async">`
    : icon("i-sonata", 22);

  /* The hybrid case. A compact set fills three slots and the other two are a
     2-piece of your choosing, so the source writes the partners as groups of
     interchangeable sets — and that is what they are printed as. Each group is
     one 2-piece decision, not a list of things to wear at once. */
  const mix = s.mix?.length ? `<div class="bset-mix">
    <span class="label">Best combined with your choice of</span>
    ${s.mix.map(group => `<div class="bset-mix-r"><i>2pc</i>${
      group.split(",").map(n => n.trim()).filter(Boolean).map(n => {
        const g = sonataFor(n);
        return `<button class="bset-chip" data-act="eset" data-id="${g ? g.id : "all"}"
                title="Show this set on the Echoes page"${
          g ? sonataStyle(g) : ""}>${g?.icon
            ? `<img src="${esc(g.icon)}" alt="" loading="lazy" decoding="async">` : ""}${esc(n)}</button>`;
      }).join("")}</div>`).join("")}
  </div>` : "";

  /* Two columns, and the split is by subject rather than by size: the left is
     the set — what it is, what it does, what you may pair it with — and the
     right is what you do about it, which is the echo that goes in the main
     slot and the share this whole build is worth. Stacked, the set's paragraph
     ran the full width of a wide modal and pushed the one clickable thing on
     the block below the fold; side by side they are the same height and the
     block is read in one look.

     A set with neither a share nor a main-slot echo has nothing to put in the
     right column, so it does not get one — an empty pane beside a paragraph is
     worse than a paragraph. */
  /* Only the first echo goes in the column. A set that names an alternative
     for the main slot — twenty of them do — puts two cards and two paragraphs
     against one short set description, and the column that wins by six hundred
     characters leaves the other one looking abandoned. The alternative spans
     the full width underneath instead, where the same words take half the
     height, and it reads in the order it is meant to: this set, this echo, or
     failing that, this one. */
  const [lead, ...extra] = s.echoes;

  /* How wide the left column gets, from how much there is to put in it. Two
     paragraphs of unequal length side by side end at unequal heights, and the
     shorter one leaves a hole inside the block's border — Shorekeeper's set is
     three hundred characters against nine hundred, which is four lines against
     twelve. Height falls as width rises, so a column weighted by its own
     content lands both at roughly the same depth.

     Counting characters, not measuring. Both columns are the same face at
     roughly the same size, so lines-per-character is near enough equal on the
     two sides for the ratio to come out right; the echo card is the one thing
     with a height and no prose in it, and 190 is about what it costs in the
     same currency. Measuring properly would mean laying the block out, reading
     it back and laying it out again, which is a reflow per set block to save
     half a line.

     Clamped on both sides, because it is a nudge rather than a solver: the
     header needs room for a set name whatever the paragraph under it is doing,
     and at the far end a column narrow enough to break "Rejuvenating" would be
     buying a flush bottom edge with a worse read. Within those bounds it takes
     the worst blocks from twelve lines of slack to two. */
  const lChars = String(s.note || "").length + (s.mix || []).join(" ").length;
  const rChars = lead ? String(lead.note || "").length + 190 : 0;
  const grow = rChars ? Math.min(1.9, Math.max(0.5, (lChars + 40) / rChars)) : 1.15;
  const right = `<div class="bset-rh${s.share ? "" : " none"}">${s.share
    ? `<span class="bset-p" title="Damage share against the best option">${esc(s.share)}</span>`
    : ""}</div>${lead ? buildEchoRow(lead) : ""}`;
  const split = Boolean(s.share || s.echoes.length);

  return `<div class="bset${split ? " bset--split" : ""}"${set ? sonataStyle(set) : ""}>
    <div class="bset-l"${split ? ` style="flex-grow:${grow.toFixed(2)}"` : ""}>
      <div class="bset-h">
        <button class="bset-c" data-act="eset" data-id="${set ? set.id : "all"}"
                title="Show this set on the Echoes page">${crest}</button>
        <div class="bset-n">
          <b>${esc(s.name)}</b>
          <span class="bset-m">${[s.type, pieces].filter(Boolean).map(esc).join(" · ")}</span>
        </div>
      </div>
      ${s.note ? `<p class="bset-note">${esc(s.note)}</p>` : ""}
      ${mix}
    </div>
    ${split ? `<div class="bset-r">${right}</div>` : ""}
    ${extra.length ? `<div class="bset-x">${
      extra.map((e, i) => buildEchoRow(e, i + 1)).join("")}</div>` : ""}
  </div>`;
}

/* The five slots, with the cost of each read off the format string. "43311" is
   how the source writes a layout and it is a shape rather than a number — the
   first slot is the 4-cost, which is the one the main echo goes in, and that
   is why the two are on the same panel. A format the desk cannot read five
   costs out of drops the badges rather than guessing at them. */
/* A substat name, folded to something two sources can be compared on. The
   priority list writes what you roll ("ATK%", "Flat HP", "CRIT RATE") and the
   endgame list writes what it adds up to ("ATK", "HP", "CRIT Rate"), and the
   two are the same stat under different names.

   Folded whole and matched whole, never on a substring: "Liberation ATK DMG%"
   contains "ATK" and is a different stat from it, and hanging a total-ATK
   target off that row would be a plain lie. The parenthetical goes too — it is
   a condition on the rolling ("Until Satisfied"), not part of the name. */
const statKey = s => String(s || "").toLowerCase()
  .replace(/\([^)]*\)/g, " ").replace(/[%]/g, " ")
  .replace(/\b(?:flat|bonus)\b/g, " ")
  .replace(/\s+/g, " ").trim();

/* "Energy Regen (Until Satisfied) > CRIT Rate = CRIT DMG > ATK%" as the tiers
   it is: split on ">" for rank, and on "=" or "≥" inside a tier for the stats
   that share that rank. The joiner is kept rather than normalised — "≥" is a
   lean and "=" is a tie, and the source means the difference. */
function substatTiers(s){
  return String(s || "").split(">").map(g => g.trim()).filter(Boolean).map(g => {
    const parts = g.split(/\s*([=≥])\s*/);
    const out = [];
    for(let i = 0; i < parts.length; i += 2){
      const raw = (parts[i] || "").trim();
      if(!raw) continue;
      const m = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      out.push({name:(m ? m[1] : raw).trim(), when:m ? m[2].trim() : null, tie:i ? parts[i - 1] : null});
    }
    return out;
  }).filter(t => t.length);
}

/* The priority, as a list with the number to stop at beside each line.
   The order alone never answered the question a reader actually has — roll
   Energy Regen first, yes, but how much of it is enough before crit is worth
   more? — and the endgame targets are exactly that answer, so they are drawn
   on the rows they belong to rather than as a second list further down.

   A target is claimed by the first row that folds to it, and claimed once. Two
   rows fold to ATK on most builds ("ATK%" then "ATK") and printing the same
   1800-2500 twice would read as two separate goals. Whatever no row claims is
   still printed, under the list — HP and DEF matter to a build that never
   rolls for them, and a target with nowhere to go is not a target to drop. */
function buildSubstats(st){
  const tiers = substatTiers(st.substats);
  const targets = (st.targets || []).map(t => ({...t, key:statKey(t.stat)}));
  const taken = new Set();
  const notes = [];

  const rows = tiers.map((tier, i) => tier.map((x, j) => {
    const hit = targets.find(t => !taken.has(t) && t.key === statKey(x.name));
    if(hit){
      taken.add(hit);
      if(hit.note) notes.push({stat:x.name, note:hit.note});
    }
    return `<li class="bsub${j ? " tied" : ""}">
      <span class="bsub-r">${j ? esc(x.tie || "=") : i + 1}</span>
      <span class="bsub-n"><b>${esc(x.name)}</b>${
        x.when ? `<em>${esc(x.when)}</em>` : ""}</span>
      ${hit ? `<span class="bsub-v">${esc(hit.value)}</span>` : ""}
    </li>`;
  }).join("")).join("");

  const rest = targets.filter(t => !taken.has(t));
  for(const t of rest) if(t.note) notes.push({stat:t.stat, note:t.note});

  if(!rows && !targets.length) return "";
  return `<div class="bsubs">
    <span class="label">Substat priority</span>
    ${targets.length ? `<p class="bsubs-cap">Roll top down. The figure beside a stat is
      where it is enough — a level 90 stat screen, out of combat with the character in the
      party, so some of your own buffs will not be in it.</p>` : ""}
    ${rows ? `<ol class="bsubl">${rows}</ol>` : ""}
    ${rest.length ? `<div class="bsub-rest">
      <span class="label">Also worth reaching</span>
      <div>${rest.map(t => `<span class="bsub-chip"><b>${esc(t.stat)}</b>${esc(t.value)}</span>`).join("")}</div>
    </div>` : ""}
    ${notes.map(n => `<p class="bsub-fn"><b>${esc(n.stat)}</b> — ${esc(n.note)}</p>`).join("")}
  </div>`;
}

function buildStats(st){
  const costs = /^\d{5}$/.test(String(st.format || "")) ? String(st.format).split("") : null;
  const rows = (st.slots || []).map((v, i) => v ? `<div class="bstat">
    <span class="bstat-c" title="${costs ? `${costs[i]}-cost echo` : `Slot ${i + 1}`}">${costs ? costs[i] : i + 1}</span>
    <b>${esc(v)}</b>
  </div>` : "").join("");
  return `<div class="dsec">
    <span class="label">Main stats${st.format ? ` — ${esc(st.format)}` : ""}</span>
    ${rows ? `<div class="bstats">${rows}</div>` : ""}
    ${buildSubstats(st)}
    ${st.note ? `<p class="bset-note">${esc(st.note)}</p>` : ""}
  </div>`;
}

/* The weapon ranking. Kept to a row apiece — name, how many copies it assumes,
   and the damage share — because the desk already holds a record for every one
   of them and the note is one hover or one click away. The signature is
   usually first and already has a card at the top of the record; what this
   answers is the other question, which is what to use instead. */
function buildWeapons(list){
  return `<div class="dsec"><span class="label">Weapons — ${list.length} ranked</span>
    <div class="bweps">${list.map((w, i) => {
      const rec = weaponFor(w.name);
      const inner = `<span class="bw-n">${i + 1}</span>
        <span class="bw-art">${rec?.icon
          ? `<img src="${esc(rec.icon)}" alt="" loading="lazy" decoding="async">`
          : icon("i-weapon", 16)}</span>
        <b>${esc(w.name)}</b>
        ${w.dupes > 1 ? `<em>S${w.dupes}</em>` : ""}
        ${w.share ? `<span class="bw-p">${esc(w.share)}</span>` : ""}`;
      return rec
        ? `<button class="bwep" data-act="weapon" data-id="${esc(w.name)}"
                   title="${esc(w.note || "")}">${inner}</button>`
        : `<span class="bwep dead" title="${esc(w.note || "")}">${inner}</span>`;
    }).join("")}</div>
  </div>`;
}

/* A team. Three seats, and a seat can name more than one Resonator — which is
   the whole reason the slots are kept as slots rather than flattened to a list
   of six names. "Verina or Shorekeeper in the third seat" is a different
   statement from "these six work together", and the second one is not true. */
/* One name in a seat, at a size worth looking at. The waist-up cut-out rather
   than the 54px tile: this is the one panel where the answer is "these three
   people", and three faces you recognise across a row is the whole point of
   drawing it rather than listing it. */
function buildWho(who){
  const r = resonatorFor(who);
  const f = figure({name:who});
  const art = f.image || f.icon;
  const inner = `<span class="bwho-a${art ? "" : " none"}">${art
    ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">`
    : `<i>${esc(String(who).slice(0, 1))}</i>`}</span>
    <span class="bwho-n">${esc(who)}</span>`;
  return r.name
    ? `<button class="bwho" data-act="resonator" data-id="${esc(who)}"${
        attrStyle(r.attribute)}>${inner}</button>`
    : `<span class="bwho dead">${inner}</span>`;
}

/* A team, as columns. One column per seat, and the alternatives for a seat
   stacked inside its own column under an "or".

   This was a single wrapping row with the seats separated by a "+", and the
   fault with it is what a wrap does to the meaning: once "Mornye or Ciaccona
   or The Shorekeeper" runs past the end of a line, which seat the "or" belongs
   to stops being visible and the row reads as six interchangeable people. A
   column cannot wrap into its neighbour, so the grouping holds at every width
   — and it stops being ambiguous exactly where the old layout stopped being
   readable.

   No "+" between the columns any more. Three columns of a bordered block are
   already one thing; the plus was doing work the layout now does. */
function buildTeams(list){
  return `<div class="dsec"><span class="label">Teams — ${list.length}</span>
    <div class="bteams">${list.map(t => `<div class="bteam">
      <div class="bteam-h"><b>${esc(t.name)}</b></div>
      <div class="bteam-s" style="--seats:${t.slots.length}">${t.slots.map(slot =>
        `<div class="bseat">${slot.map(buildWho)
          .join(`<span class="bslot-or"><i></i>or<i></i></span>`)}</div>`).join("")}</div>
      ${t.note ? `<p class="bset-note">${esc(t.note)}</p>` : ""}
    </div>`).join("")}</div>
  </div>`;
}

/* The whole panel, and the caveat is the first thing in it rather than the
   last: this is advice, the reader is about to spend a week of waveplate on
   it, and what it is and is not are what decide whether to follow it.

   It says what the panel is worth, not where it came from — the desk credits
   its sources in the README, in each data file's own `credit` field and in the
   Methodology drawer, and stopped printing a bibliography on the page itself
   a long time ago. What a reader standing here actually needs to know is that
   these are dependable general-purpose answers rather than a solved optimum,
   and the version they were last written against, which is the one thing that
   tells them whether the advice has gone stale. */
function buildPanel(name, b){
  return `<div class="bwrap">
    <div class="bcredit">
      ${icon("i-info", 14)}
      <span>Not a solved answer. These are general-purpose builds and teams that hold up
        across most content — for one specific fight, or for the roster you actually own,
        something else may well be better.${
        b.reviewed ? ` Last reviewed against <b>version ${esc(b.reviewed)}</b>.` : ""}</span>
    </div>

    ${b.sets?.length ? `<div class="dsec">
      <span class="label">Echo set${b.sets.length > 1 ? "s" : ""} — ${b.sets.length}</span>
      <div class="bsets">${b.sets.map(buildSet).join("")}</div>
    </div>` : ""}

    ${b.stats ? buildStats(b.stats) : ""}
    ${b.teams?.length ? buildTeams(b.teams) : ""}
    ${b.weapons?.length ? buildWeapons(b.weapons) : ""}
  </div>`;
}

/* Drops the build in underneath the record once builds.json lands, on exactly
   the terms fillKit works to — including the guard on the drawer still showing
   the Resonator that asked for it, because a third of a megabyte over a slow
   connection is long enough to open a record and click through to somebody
   else before it arrives. */
function fillBuild(name){
  return loadBuilds().then(() => {
    const wrap = $("#buildwrap");
    if(!wrap || S.drawer !== `resonator:${name}`) return;
    const b = buildFor(name);
    wrap.innerHTML = b
      ? buildPanel(name, b)
      : `<div class="dsec"><span class="label">Builds and teams</span>
          <p style="margin:0;color:var(--fg-3)">Nothing published yet. Nobody writes a build for a
          Resonator who has not shipped — the numbers move until the patch does.</p></div>`;
    fitSoon();
  }).catch(() => {
    const wrap = $("#buildwrap");
    if(wrap) wrap.innerHTML = `<div class="dsec"><span class="label">Builds and teams</span>
      <p style="margin:0;color:var(--fg-3)">Build data did not load.</p></div>`;
  });
}

/* The toggle. Two buttons rather than a tablist: what it switches is the lower
   half of a record, the two halves are not panels of equal weight, and a
   tablist promises arrow-key navigation between siblings that this does not
   have. Both halves stay in the DOM — the switch is a `hidden` flip, so the
   kit does not re-fetch and neither side loses its place when you come back. */
/* Shows one half of a record. A `hidden` flip on two sections that are both
   already in the DOM — no redraw, so neither half re-fetches and neither loses
   where you had scrolled to. The half being shown for the first time fills
   itself; the guard inside fillKit/fillBuild makes the repeat calls free.

   Its own function because two things switch tabs: the toggle, and coming back
   to a record you left on the build half. */
function showRecordTab(id, scroll){
  S.rtab = id === "build" ? "build" : "kit";
  const cur = String(S.drawer || "");
  const kitOn = S.rtab === "kit";
  document.getElementById("kittab")?.toggleAttribute("hidden", !kitOn);
  document.getElementById("buildtab")?.toggleAttribute("hidden", kitOn);
  document.querySelectorAll('[data-act="rtab"]').forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.id === S.rtab)));
  if(cur.startsWith("resonator:")){
    const who = cur.slice(10);
    if(kitOn) fillKit(who); else fillBuild(who);
  }
  if(scroll) document.querySelector(".rr-tabs")?.scrollIntoView({block:"start", behavior:"smooth"});
}

function recordTabs(){
  return `<div class="rr-tabs" role="group" aria-label="What to show below">
    ${[["kit", "Combat kit"], ["build", "Builds and teams"]].map(([id, label]) =>
      `<button data-act="rtab" data-id="${id}" aria-pressed="${S.rtab === id}">${label}</button>`).join("")}
  </div>`;
}

function drawerVersion(id){
  /* versions.json for the arc the desk is watching; the archive for the
     eighteen patches behind it, which have no record in that file and are
     assembled out of the wiki's patch page and the resonators' own run
     history. Either way what comes back has an id, a window and phases, which
     is everything below this line reads. */
  const v = versions().find(x => x.id === id) || archivePatch(id);
  if(!v) return;
  const status = statusOf(v);
  const role = status === "live" ? "live" : status === "announced" ? "next" : "future";
  const news = newsFor(v.id);
  /* The 5-stars, debuts first — see castOrder() and isFive(). Every card in a
     phase shares the phase's window, so the order they arrived in encodes
     nothing and the reader is left to find the debut among six reruns. A phase
     with nothing left is dropped rather than drawn as a heading over a gap;
     no patch since launch has run one, but a heading with no strip under it is
     a worse thing to ship than a branch that never fires. */
  const phases = (v.phases || []).map(p => ({...p, cast:castOrder((p.banners || []).filter(isFive))}))
    .filter(p => p.cast.length)
    .map(p => `
    <div class="dsec">
      <span class="label">Phase ${p.n} — ${[p.start ? fmtDate(p.start) : "", p.end ? fmtDate(p.end) : ""].filter(Boolean).join(" → ")}
        ${p.estimated_start || p.estimated_end ? " (est)" : ""}</span>
      <div class="bstrip cards">${p.cast.map(b =>
        bannerCard({...b, phase:p.n, keyVisual:v.keyVisual})).join("")}</div>
    </div>`).join("");

  /* A patch Kuro has named the cast of but not the banner order. versions.json
     holds no phases for one — inventing two so the record has headings would be
     asserting a split nobody has published, and the phase a Resonator lands in
     is the whole of what a reader budgets against — but the Resonator database
     already carries whoever is flagged for the version, and they are the
     substance of the patch. So: the same cards a phase strip draws, under a
     heading that says what is missing rather than a date that is made up.

     The timeline's patch card has shown these as tiles for a while. The record
     it opens was the one place still showing an empty page for the version the
     desk has the most to say about. */
  const teased = phases ? "" : (() => {
    const cast = castOrder(resonators().filter(x => x.version === v.id && isFive(x)));
    if(!cast.length) return "";
    return `<div class="dsec">
      <span class="label">Announced for this patch — ${cast.length}</span>
      <div class="bstrip cards">${cast.map(r => bannerCard({
        name:r.name, rarity:r.rarity, attribute:r.attribute, weapon:r.weapon, new:true
      })).join("")}</div>
      <p class="tier-note" style="margin-top:14px">Banner order and phase dates are
      not published. Kuro has said who is in this version, not when either of them
      runs — and the roles on these cards are pre-release reporting, not Kuro's own
      line. Open a record for what is confirmed and what is not.</p>
    </div>`;
  })();

  /* The patch's key visual, between the two dates that bracket it. It used to
     be the page backdrop, where it was blurred to weather and credited in a
     footer — here it is a picture: shown whole, at the size it was drawn to be
     looked at, captioned with what it is and linked back to the Kuro post it
     came off. The version record is the one place on the desk where the whole
     subject is this patch, so it is the one place the poster belongs.

     Sized at 1800: the figure is capped at 1120px, so this is that width with
     enough over it to stay sharp on a 2x screen — the poster is the one image
     in the record big enough for the upscale to show. */
  const kv = v.keyVisual?.url ? `
    <figure class="dkv">
      <img src="${esc(cdnWidth(v.keyVisual.url, 1800))}" alt="${esc(v.keyVisual.title || `Version ${v.id} key visual`)}" loading="lazy" decoding="async">
      <figcaption>
        ${esc(v.keyVisual.title || `Version ${v.id} key visual`)}
        ${v.keyVisual.credit ? ` — ${esc(v.keyVisual.credit)}` : ""}
        ${v.keyVisual.source ? `<a href="${esc(v.keyVisual.source)}" target="_blank" rel="noopener">Source</a>` : ""}
      </figcaption>
    </figure>` : "";

  /* The preview stream, up on the status row rather than down among the dates.
     It is not the same kind of fact as launch and end: those two are the window
     the patch runs in, and this is a broadcast that happened once, a fortnight
     before any of it. As a row in that list it read as a third date in the
     patch's own calendar. Up here it reads as what it is — the announcement,
     next to the status it announced — and it can carry the link, which is the
     part you actually want from it. */
  const stream = v.livestream ? (() => {
    const url = streamVideo(v);
    return `<span class="vstream">
      <span class="label">Preview stream</span>
      <b>${fmtDate(v.livestream)}</b>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">
        ${icon("i-youtube", 13)}Watch on YouTube</a>` : ""}
    </span>`;
  })() : "";

  /* What ran in the patch, under who ran in it. The banner strip above answers
     "who is in this patch" and this is the other half of the same question —
     which until now could only be had from the Events view, and that view drops
     a patch on the day it closes. On an archived patch it is the whole record:
     no art, no reward lines, just what ran and when, each row linking to Kuro's
     own notice where the wiki kept the link. */
  const evs = patchEvents(id);
  /* Asked once for the whole list rather than once per row: the column is a
     property of the patch, not of the event standing in it. See eventRow(). */
  const evArt = evs.some(e => eventArt(e));
  const events = evs.length ? `<div class="dsec">
    <span class="label">Events in this patch — ${evs.length}</span>
    <div class="pevlist${evArt ? " arted" : ""}">${evs.map(e => eventRow(e, evArt)).join("")}</div>
  </div>` : "";

  /* An archived patch has no key visual, no preview stream and no notes — the
     desk was not watching when it shipped. What it does have is where the
     record came from, which on a two-year-old patch is the only way back to
     what Kuro actually said about it. */
  const arcSource = v.archived && (v.notice || v.source) ? `<div class="dsec">
    <span class="label">Where this record comes from</span>
    <a class="dsrc" href="${esc(v.notice || v.source)}" target="_blank" rel="noopener">
      ${esc(v.notice ? "Kuro's own version notice" : "This patch on the Wuthering Waves Wiki")}
      <span class="arrow">${icon("i-arrow", 13)}</span></a>
  </div>` : "";

  openDrawer("Version", `<div class="drawer-b">
    <div class="meta">
      <span class="pill ${role === "live" ? "live" : role === "next" ? "next" : "future"}">${esc(status)}</span>
      ${v.region ? `<span class="pill">${esc(v.region)}</span>` : ""}
      ${stream}
    </div>
    <h2>${esc(v.id)}${v.title ? ` — ${esc(v.title)}` : ""}</h2>
    <div class="dgear" style="margin-bottom:6px">
      ${v.start ? `<div><span>Launch</span><b>${fmtDate(v.start)}</b></div>` : ""}
      ${kv}
      ${versionEnd(v) ? `<div><span>Ends</span><b>${versionEnd(v)}</b></div>` : ""}
    </div>
    ${astritePanel(v, status)}
    ${v.notes ? `<div class="vnote" style="margin-top:16px">${esc(v.notes)}</div>` : ""}
    ${phases}
    ${teased}
    ${events}
    ${arcSource}
    ${news.length ? `<div class="dsec"><span class="label">Intel on this version — ${news.length}</span>
      <div style="display:grid;gap:8px">${news.map(e => `
        <span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
          <i class="dot t-${esc(e.confidence)}" style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></i>
          ${esc(e.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div></div>` : ""}
  </div>`);
}

/* ── the estimate, taken apart ────────────────────────────────────── */
/* The panel in the version record answers "can I afford them". This answers
   the question a reader asks about half a second later, which is "off what?"

   It is a fair question and it deserves a whole panel, because the headline is
   the one figure on the desk nobody published. Everything else here is Kuro's
   own — dates, banners, reward lines — and this is arithmetic. Arithmetic that
   will not show its working is a rumour with a number on it.

   Three things this tries to do that a flat list of fourteen rows did not:

   - **Group it.** "The events are worth three thousand and every one of them
     expires" is a decision a reader can act on. Fourteen rows in source order
     is a spreadsheet, and nobody reads a spreadsheet to work out whether they
     can afford a banner.
   - **Show the shape.** One bar, six colours: what share of a patch is paid
     for turning up, what share for clearing, what share you forfeit by
     missing the window. That is the part worth knowing and it is invisible in
     a column of figures.
   - **Admit the gap.** The lines have never summed to the headline. Rather
     than quietly inflating them until they do, the difference is drawn.

   It opens as a drawer over the version record rather than unfolding inside
   it: six groups, three tracks and a list of what the figure deliberately
   ignores is a page, and a page set under the patch poster pushes the phases
   and the events off the screen. The drawer's own back control puts the record
   one click behind it either way. */
function drawerAstrite(id){
  const v = versions().find(x => x.id === id) || archivePatch(id);
  const p = v && astritePlan(v);
  if(!p) return;

  const head  = p.tracks[0];
  const whole = head?.astrite || 1;
  const pct   = n => Math.round(n / whole * 100);
  const cost  = Number(DATA.astrite?.pullCost) || 160;

  /* The bar and the sections read off one list, so a group is the same colour
     in both. The remainder is a segment like any other — it is a real third of
     this patch's figure, and leaving it out would make the bar lie by exactly
     as much as it is worth. */
  const groups = p.groups.map((g, i) => ({...g, tone:String(i % 6)}));
  const segs   = [
    ...groups.filter(g => g.mid > 0),
    ...(p.gap > 0 ? [{id:"gap", label:"Not itemised", mid:p.gap, tone:"gap"}] : [])
  ];

  /* One line. The runs multiplier and the note sit under the label rather than
     beside it, because "Daily activity quests × 42" with "60 a day" behind it
     is the whole of what the row has to say and it says it in the order you
     would ask: what, how often, how much. */
  const lineRow = l => `<li>
    <span class="agrp-lab">
      <b>${esc(l.label)}</b>${l.runs > 1 ? `<i>× ${l.runs}</i>` : ""}
      ${l.whole ? `<span class="agrp-pub"
        title="Not modelled. This is the sum of the reward lines Kuro published with the events themselves.">published</span>` : ""}
      ${l.note ? `<em>${esc(l.note)}</em>` : ""}
    </span>
    <span class="agrp-amt${l.range || Number(l.astrite) ? "" : " wrap"}">
      <b>${esc(astriteAmount(l))}</b>
      ${l.tides && (l.astrite || l.range) ? `<em>+ ${esc(tideList(l.tides, l.runs))}</em>` : ""}
    </span>
  </li>`;

  const section = g => `<section class="agrp" data-tone="${g.tone}">
    <div class="agrp-h">
      <b>${esc(g.label)}</b>
      ${g.mid > 0
        ? `<span class="agrp-n">${esc(astriteSpan(g.low, g.high))}</span><em>${pct(g.mid)}%</em>`
        : `<em class="agrp-off">Tides only</em>`}
    </div>
    ${g.blurb ? `<p class="agrp-b">${esc(g.blurb)}</p>` : ""}
    <ol class="agrp-l">${g.lines.map(lineRow).join("")}</ol>
  </section>`;

  const gap = p.gap > 0 ? `<section class="agrp" data-tone="gap">
    <div class="agrp-h">
      <b>Not itemised</b>
      <span class="agrp-n">~${numFmt(Math.round(p.gap / 50) * 50)}</span><em>${pct(p.gap)}%</em>
    </div>
    <p class="agrp-b">The lines above come to about ${numFmt(Math.round(p.counted / 50) * 50)}, and the
    community's total is ${numFmt(whole)}. The difference is everything an infographic stops short of —
    login mail, the odd one-off buried in a web event, the small change nobody bothers to itemise. It is
    left standing as a gap rather than folded into the lines above it, because a breakdown that has been
    massaged into balancing has stopped saying where it is unsure.</p>
  </section>` : "";

  const tides = tideList(head?.tides);
  const srcs  = p.sources?.length ? p.sources : p.source ? [p.source] : [];
  /* What one more day of this patch is worth, which is the only thing a
     changed window can move. The recurring lines are already multiplied out,
     so this is them back over the length that multiplied them. */
  const daily = Math.round(p.lines.reduce((n, l) =>
    n + (l.per === "day" || l.per === "week" ? l.mid : 0), 0) / Math.max(1, p.days));

  openDrawer("Astrite estimate", `<div class="drawer-b">
    <div class="meta">
      <span class="pill ver">${esc(v.id)}</span>
      <span class="pill">${p.modelled ? `modelled on ${p.baseDays} days` : plural(p.days, "day")}</span>
      <span class="aest-tag">estimate</span>
    </div>
    <h2>Where the ${numFmt(whole)} Astrite comes from</h2>
    <p>${esc(p.note)}</p>

    <div class="asum">
      ${astriteMark(38)}
      <div class="aest-fig">
        <b>~${numFmt(whole)}</b>
        <span>Astrite — ${esc(head?.label || "full clear")}</span>
      </div>
      <div class="aest-pulls">
        <b>≈ ${head?.pulls || 0}</b>
        <span>limited pulls</span>
      </div>
    </div>

    <div class="abar" role="img" aria-label="${esc(segs.map(s =>
      `${s.label} ${pct(s.mid)} per cent`).join(", "))}">${segs.map(s => `
      <span data-tone="${s.tone}" style="flex:${Math.max(1, Math.round(s.mid))}"
            title="${esc(s.label)} — ${numFmt(Math.round(s.mid))} Astrite, ${pct(s.mid)}%"></span>`).join("")}</div>
    <div class="akey">${segs.map(s => `
      <span data-tone="${s.tone}"><i></i>${esc(s.label)}<b>${pct(s.mid)}%</b></span>`).join("")}</div>

    <div class="agrps">${groups.map(section).join("")}${gap}</div>

    ${tides ? `<div class="dsec">
      <span class="label">And the Tides, which are not Astrite</span>
      <p style="margin:0 0 10px">A full clear also pays <b>${esc(tides)}</b> Tides. Radiant is a limited
      convene and is already counted in the pull figure above; Lustrous buys the standard banner and
      Forging the weapon one, which are a different budget and are not.</p>
    </div>` : ""}

    <div class="dsec"><span class="label">The same patch, on the paid tracks</span>
      <div class="atrk">${p.tracks.map((t, i) => `
        <div${i ? "" : ` class="on"`}>
          <span>${esc(t.label)}</span>
          <b>~${numFmt(t.astrite)}</b>
          <em>≈ ${t.pulls} pulls</em>
        </div>`).join("")}</div>
      <p class="agrp-b">A pull is ${cost} Astrite, and every Radiant Tide is one on top. The subscription
      and the pass move the total and change nothing about the lines above — they are the same patch,
      cleared the same way, with a standing order on top of it.</p>
    </div>

    ${p.excludes?.length ? `<div class="dsec"><span class="label">What this figure does not count</span>
      <ul class="aexcl">${p.excludes.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}

    <div class="dsec"><span class="label">How the days were worked out</span>
      <p style="margin:0">${p.modelled
        ? `${esc(v.id)} has no window yet, so the recurring lines run at the shape of a standard
           ${p.baseDays}-day patch. Dates will move them and nothing else: a day is worth about
           ${numFmt(daily)} Astrite of dailies and weeklies, and every other line on this page is paid
           once whether the patch runs five weeks or seven.`
        : `Taken off this patch's own window — ${plural(p.days, "day")} — rather than off a
           standard-length one. Only the per-day, per-week and per-month lines scale with it; a longer
           patch is more dailies and the same story quests.`}</p>
    </div>

    ${srcs.length ? `<div class="dsec"><span class="label">Where the lines come from</span>
      <div style="display:grid;gap:10px">${srcs.map(s => `<div>
        <a class="dsrc" href="${esc(s.url)}" target="_blank" rel="noopener">
          ${esc(s.credit || "Source")}${s.title ? ` — ${esc(s.title)}` : ""}
          <span class="arrow">${icon("i-arrow", 13)}</span></a>
        ${s.note ? `<p class="asrc-n">${esc(s.note)}</p>` : ""}</div>`).join("")}</div>
    </div>` : ""}

    <div class="dsec">
      <span class="dsrc" role="button" tabindex="0" data-act="version" data-id="${esc(v.id)}">
        Back to the ${esc(v.id)} record<span class="arrow">${icon("i-arrow", 13)}</span></span>
    </div>
  </div>`);
}

/* A weapon record. It used to be assembled entirely out of banner rows — the
   desk held no weapon data, so a weapon was defined by whose convene it ran
   beside, and one that had never had a convene had no record at all. It has
   stats and a passive now, so that is what this is: the class, the stats, and
   the passive under a slider. Either half can be missing — the two 3.7
   signatures have a convene and no stats yet.

   The convene history that used to sit here is gone. It is a list of patch
   numbers for the one weapon in four that has any, and the resonator it belongs
   to carries the same run history in full — so the holder's name in the
   sentence above is the link to it, and that is the whole navigation this
   record needs.

   ── the layout ──
   It was one column for a while: chips, a 168px render, the name, the two
   figures, the passive, the intel, each one set across the full width of a
   1620px panel. Every part of that is the wrong shape for the width. A sword
   drawn on the diagonal inside a wide short band is cropped to a hilt; a
   passive is 400 characters and got a 190-character line; and the two numbers
   the record is actually opened for — is this weapon's ATK worth the pulls —
   were three sections down, below the fold on a laptop.

   So it takes the shape the resonator record already uses, for the reason that
   one gives: the name and the one sentence about it across the top, the object
   and what it does beneath, and every figure or link in a rail down the right
   behind a rule. The eye goes picture → passive → numbers, and the numbers are
   in the corner they are in on every other page of every other database.

   This is the layout for all 121 weapons, not for the good ones. Every record
   in weapons.json carries an icon, a passive, an ATK and a sub-stat — there is
   no partial case in the file — so the only parts that can be absent are the
   holder's sentence, which two thirds of the database has no holder for, and
   the intel list, which nearly none of them has. Each drops out on its own and
   moves nothing else: no summary and the name takes the whole top; no rail at
   all and the main column takes the whole panel. */
function drawerWeapon(name){
  const w = weaponFor(name);
  const runs = weaponRuns(name);
  if(!w && !runs.length) return;

  const k = String(name).toLowerCase();
  const mentions = entries()
    .filter(e => `${e.title} ${e.body}`.toLowerCase().includes(k) ||
                 (e.tags || []).some(t => String(t).toLowerCase() === k))
    .sort((a, b) => (b.date||"").localeCompare(a.date||""));
  /* Holder for the accent colour: a signature weapon takes its resonator's
     element, which is how it is coloured everywhere else on the desk. */
  const holderName = runs[0]?.name || sigHolderFor(name);
  const holder = holderName ? resonatorFor(holderName) : {};

  /* Nobody's signature, so there is no element to take. Rarity instead, which
     is the fact the Weapons page already sorts and colours the whole database
     by — a 5★ opens gold, a 3★ opens blue, and neither opens in the site
     accent looking like every other panel on the desk. */
  const rarity = Number(w?.rarity) || 0;
  const accent = attrStyle(runs[0]?.attribute || holder.attribute)
    || (RAR_COLOUR[rarity] ? ` style="--attr:${RAR_COLOUR[rarity]}"` : "");

  /* The holder's name is the link out of here, now that the convene list has
     gone. Their record carries the same run history in full, and this is one
     word rather than a section. With no holder there is no sentence: the desk
     knows the class, the rarity and the source, all three are chips two lines
     up, and writing them out again as prose would be the record padding
     itself. The name takes the width instead. */
  const summary = holderName ? `<p class="wr-sum">Signature weapon for
    <b class="wholder" role="button" tabindex="0" data-act="resonator" data-id="${esc(holderName)}">${esc(holderName)}</b>,
    and its convene runs alongside their banner.</p>` : "";

  const intel = mentions.length ? `<section class="wr-intel">
    <span class="label">Related intel — ${mentions.length}</span>
    <div class="wr-intel-l">${mentions.map(e => `
      <span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
        <i class="dot t-${esc(e.confidence)}"></i>
        ${esc(e.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div>
  </section>` : "";

  /* The rail is the record's figures and its ways out, and it only exists if
     there is one of either. A weapon the timeline has a convene for and the
     database has no row for — the two 3.7 signatures — with no intel written
     about it yet has neither, and gets no empty column standing beside the
     picture.

     The slider sits up here rather than on the passive it changes. It is
     against the rule's edge, a hand's width from the text, and it belongs with
     "stats and progression" — which is what an ascension is — rather than
     hanging off a heading. The passive carries the live rank in its own
     heading so the two are visibly wired together. */
  const rail = (w || intel) ? `<aside class="wr-rail">
    <h3 class="wr-rail-h">Stats and progression</h3>
    ${w ? `<div class="wr-lv">
      <span class="label">Stats at level 90</span>
      ${ascendBar()}
    </div>
    <div class="wstats">
      <div><span class="k">Base ATK</span><b>${w.atk90 || "—"}</b></div>
      <div><span class="k">${esc(w.stat || "Sub-stat")}</span><b>${w.statValue90 ? esc(w.statValue90) + "%" : "—"}</b></div>
    </div>` : ""}
    ${intel}
  </aside>` : "";

  openDrawer("Weapon record", `<div class="drawer-b wrec-r${rail ? "" : " norail"}"${accent}>
    <div class="wr-main">
      <header class="wr-head${summary ? "" : " bare"}">
        <div class="wr-id">
          <div class="meta">
            <span class="pill">${esc(w?.type || holder.weapon || runs[0]?.weapon || "Weapon")}</span>
            ${rarity ? `<span class="pill ver">${rarity}★</span>` : ""}
            ${w?.source ? `<span class="pill">${esc(w.source)}</span>` : ""}
            ${runs.some(r => r.status === "live") ? `<span class="pill live">Running now</span>` : ""}
          </div>
          <h2>${esc(name)}</h2>
        </div>
        ${summary}
      </header>

      <div class="wr-body">
        <!-- The render at the size it was drawn for, which is most of what the
             desk can show you about a weapon. Squared rather than the old wide
             band: Kuro draws these on the diagonal, corner to corner, and a
             short landscape box crops a greatsword to its grip.
             (No backticks in here: this comment is inside a template literal.) -->
        <figure class="wr-art">${w?.icon
          ? `<img src="${esc(w.icon)}" alt="${esc(name)}" decoding="async">`
          : `<span class="wr-art-g">${icon("i-weapon", 56)}</span>`}</figure>

        <section class="wr-eff">
          <span class="label">Passive${w ? ` <em data-ranklabel>S${S.rank}</em>` : ""}</span>
          ${w ? `<div class="weff" data-eff="${esc(w.name)}">${effectHtml(w, S.rank)}</div>`
            : `<p class="wr-thin">No passive published for this one yet. It has a convene on the
               timeline and no row in the weapon database — stats and passive land when the
               patch does.</p>`}
        </section>
      </div>
    </div>
    ${rail}
  </div>`);
}

function drawerMethodology(){
  const tiers = DATA.news?.confidenceTiers || {};
  const srcs = DATA.feed?.sources || [];
  openDrawer("Methodology", `<div class="drawer-b">
    <h2>How the desk works</h2>
    <p>Two pipelines, deliberately kept apart. <b>Live Signals</b> is a machine telling you something
    happened. <b>Intel</b> is a person deciding what it was worth. A cron job can't tell a datamine
    from someone guessing, so nothing it fetches carries a tier.</p>
    <div class="dsec"><span class="label">Confidence tiers</span>
      <div style="display:grid;gap:14px">${TIERS.map(t => `
        <div>
          <div style="margin-bottom:6px">${tierBadge(t, t === "official")}</div>
          <div style="font-size:.78rem;color:var(--fg-2);line-height:1.6">${esc(tiers[t] || TIER_MEANS[t])}</div>
        </div>`).join("")}</div>
    </div>
    <div class="dsec"><span class="label">Automated sources — every 6 hours</span>
      <div style="display:grid;gap:8px">${srcs.map(s => `
        <span class="dsrc"><i class="dot" style="width:6px;height:6px;border-radius:50%;flex:none;background:${
          s.status === "ok" ? "var(--t-official)" : s.status === "skipped" ? "var(--amber)" : "var(--t-rumour)"}"></i>
          ${esc(s.name)}<span class="arrow" style="font-family:var(--mono);font-size:.625rem">${esc(s.status)} · ${s.count}</span></span>`).join("")
        || `<span class="dsrc">No source report yet.</span>`}</div>
    </div>
    <div class="dsec"><span class="label">Art</span>
      <p style="margin:0">Official key art is resolved from Kuro's own Profile Reveal posts and hotlinked from
      their CDN, credited back to the source post. Pre-release art from beta files is labelled as such on the
      card. All of it is © Kuro Games and used unofficially.</p>
    </div>
    <!-- The one place on the page that says where the databases come from. The
         panels themselves stopped carrying a byline for the same reason the
         footer's bibliography went: a credit repeated on every card is
         furniture, and a reader who wants to know where a number came from
         comes looking. The builds are worth naming here in particular, because
         they are the one thing on the desk that is judgement rather than
         record.
         (No backticks in here: this comment is inside a template literal.) -->
    <div class="dsec"><span class="label">Databases</span>
      <p style="margin:0">Weapon stats and passives, the echo roster and its sonata sets, and the
      recommended builds and teams are all resolved from
      <a href="https://www.prydwen.gg/wuthering-waves/" target="_blank" rel="noopener">prydwen.gg</a>.
      Echo locations, the Resonator roster, kits, event history and reward items come from the
      <a href="https://wutheringwaves.fandom.com/" target="_blank" rel="noopener">Wuthering Waves wiki</a>.
      The builds are the only thing on the desk that is somebody's judgement rather than a
      published fact, and every one of them says so where it is shown.</p>
    </div>
  </div>`);
}

/* ── command palette ─────────────────────────────────────────────── */
let cmdItems = [], cmdIdx = 0;

function openCmd(){
  const c = $("#cmd");
  if(!c.hidden) return;
  lastFocus = document.activeElement;
  c.hidden = false;
  document.body.style.overflow = "hidden";
  const input = $("#cmd-input");
  input.value = "";
  runCmd("");
  input.focus();
}
function closeCmd(){
  const c = $("#cmd");
  if(c.hidden) return;
  c.hidden = true;
  if($("#drawer").hidden) document.body.style.overflow = "";
  lastFocus?.focus?.();
}

function cmdIndex(){
  const out = [];
  VIEWS.forEach(v => out.push({
    group:"Views", label:v.label, hint:v.soon ? "View · not built" : "View", act:["view", v.id], tier:null
  }));
  versions().forEach(v => out.push({
    group:"Versions", label:`${v.id}${v.title ? " — " + v.title : ""}`, hint:statusOf(v), act:["version", v.id], tier:null
  }));
  resonators().forEach(r => out.push({
    group:"Resonators", label:`${r.name}${r.nameCN ? " " + r.nameCN : ""}`,
    hint:[r.rarity ? r.rarity + "★" : "", r.attribute].filter(Boolean).join(" "), act:["resonator", r.name], tier:null
  }));
  /* The whole database when it has loaded. allWeapons() is the fallback for
     file://, where nothing fetches and the only weapons the page knows about
     are the ones named on a banner row in the bundled versions data. */
  (weapons().length
    ? weapons().map(w => ({name:w.name, hint:[`${w.rarity}★`, w.type].filter(Boolean).join(" ")}))
    : allWeapons().map(w => ({name:w.name, hint:`${w.holder} · ${w.version}`})))
    .forEach(w => out.push({group:"Weapons", label:w.name, hint:w.hint, act:["weapon", w.name], tier:null}));
  /* Sets before bodies. Somebody typing "frost" almost always wants Freezing
     Frost, and picking it here lands on the Echoes view narrowed to that set —
     its bonuses and everything that rolls it, on the page rather than in a
     dialog. Searching by the old name works too, which is the point of
     carrying the alias at all. */
  sonataSets().forEach(s => out.push({
    group:"Sonata sets", label:s.name,
    hint:[s.pieces.map(p => `${p.n}pc`).join("/"), s.alias].filter(Boolean).join(" · "),
    act:["eset", String(s.id)], tier:null
  }));
  echoes().forEach(e => out.push({
    group:"Echoes", label:e.name,
    hint:[e.cost ? `${e.cost}-cost` : "", e.class].filter(Boolean).join(" ") || "Unclassified",
    act:["echo", e.name], tier:null
  }));
  gameEvents().forEach(ev => out.push({
    group:"Events", label:ev.name, hint:[ev.version, ev.kind].filter(Boolean).join(" · "),
    act:["event", ev.id], tier:ev.confidence
  }));
  entries().forEach(e => out.push({
    group:"Intel", label:e.title, hint:fmtShort(e.date), act:["intel", e.id], tier:e.confidence
  }));
  signals().slice(0, 60).forEach(i => out.push({
    group:"Signals", label:headline(i).text, hint:i.source, act:["url", i.url], tier:null
  }));
  return out;
}

function runCmd(q){
  const query = q.trim().toLowerCase();
  const all = cmdIndex();
  cmdItems = (query
    ? all.filter(x => x.label.toLowerCase().includes(query) || (x.hint || "").toLowerCase().includes(query))
    : all.filter(x => x.group === "Views" || x.group === "Versions" || x.group === "Resonators")
  ).slice(0, 40);
  cmdIdx = 0;

  let html = "", group = "";
  cmdItems.forEach((x, i) => {
    if(x.group !== group){ group = x.group; html += `<div class="grp label">${group}</div>`; }
    html += `<button class="cmd-item" role="option" data-i="${i}" aria-selected="${i === cmdIdx}">
      ${x.tier ? `<i class="dot t-${x.tier}"></i>` : icon("i-arrow", 13)}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label)}</span>
      ${x.hint ? `<span class="kbd">${esc(x.hint)}</span>` : ""}
    </button>`;
  });
  $("#cmd-res").innerHTML = html || `<div class="empty">Nothing matches.</div>`;
}

function moveCmd(step){
  if(!cmdItems.length) return;
  cmdIdx = (cmdIdx + step + cmdItems.length) % cmdItems.length;
  $("#cmd-res").querySelectorAll(".cmd-item").forEach(b =>
    b.setAttribute("aria-selected", Number(b.dataset.i) === cmdIdx));
  $("#cmd-res").querySelector(`[data-i="${cmdIdx}"]`)?.scrollIntoView({block:"nearest"});
}

function runCmdItem(i){
  const x = cmdItems[i];
  if(!x) return;
  closeCmd();
  const [kind, id] = x.act;
  if(kind === "url") window.open(id, "_blank", "noopener");
  else if(kind === "view") setView(id);
  else dispatch(kind, id);
}

/* ── routing ─────────────────────────────────────────────────────── */
/* Keyed by view id and in VIEWS' order. setView falls back to timeline for
   anything missing here, so this table is also what makes a view real. */
const RENDER = {
  timeline: renderTimeline,
  resonators: renderResonators,
  weapons: renderWeapons,
  echoes: renderEchoes,
  events: renderEvents,
  pulls: renderPulls,
  intel: renderIntel,
  signals: renderSignals
};

function setView(id, focus){
  if(!RENDER[id]) id = "timeline";
  S.view = id;
  /* Arriving at a view unfolds its filters. They are the view's own controls,
     and a list that has to be opened by a second click before you can see what
     the page can be narrowed by is a list nobody finds. */
  S.railOpen = id;
  VIEWS.forEach(v => { document.getElementById(`p-${v.id}`).hidden = v.id !== id; });
  /* Rebuilds the nav, its filter lists and the dock — aria-current, the open
     item and every count come out of S and the data in one pass. */
  renderRail();
  draw(id);
  /* Timeline is the landing view, so it keeps the bare URL — no #timeline
     hanging off the address bar on arrival. replaceState can throw on
     file://, which is exactly where the URL doesn't matter anyway. */
  const hash = id === "timeline" ? "" : "#" + id;
  if(location.hash !== hash){
    try{ history.replaceState(null, "", location.pathname + location.search + hash); }
    catch{ /* file:// — leave the URL alone */ }
  }
  if(focus) document.getElementById(`tab-${id}`)?.focus();
  window.scrollTo({top:0, behavior:"instant"});
}

function draw(id){
  try{ RENDER[id](); }catch(err){ console.error(`render ${id} failed`, err); }
  try{ renderAside(); }catch(err){ console.error("aside failed", err); }
  fitSoon();
}

function dispatch(kind, id){
  /* Redraws the kit in place. The preference lives on S rather than in the
     markup, so the next record you open is already in the mode you chose —
     flipping it back on every character is the whole reason a toggle like this
     gets abandoned. */
  if(kind === "kitmode"){
    S.kitSimple = !S.kitSimple;
    const cur = String(S.drawer || "");
    /* The toggle is inside the markup it just replaced, so the keyboard is
       standing on a removed node by the time this resolves. Put it back on the
       new one — otherwise focus falls to <body> and Tab restarts at the top. */
    if(cur.startsWith("resonator:")) fillKit(cur.slice(10)).then(() => $(".kitmode")?.focus());
    return;
  }
  /* Kit or build. A `hidden` flip on two sections that are both already in the
     DOM — no redraw, so neither half re-fetches and neither loses where you
     had scrolled to. The half being shown for the first time fills itself; the
     guard inside fillKit/fillBuild makes the repeat calls free. */
  if(kind === "rtab"){
    if(S.rtab === id) return;
    /* The panel above is what changed, and it is off the top of the screen by
       the time anyone reaches this toggle in a long record — so this call
       scrolls, and the one closeDrawer() makes on the way back does not. */
    showRecordTab(id, true);
    return;
  }
  /* One step back down the trail. */
  if(kind === "drawerback"){ closeDrawer(); return; }
  /* Not a record — a sonata set is a section of the Echoes page, so picking
     one out of the palette navigates and narrows rather than opening a
     dialog, and that is leaving the drawer rather than backing out of it. */
  if(kind === "eset"){ setSonata(id); return; }

  /* Everything else opens a panel, so it is a step forward: remember where we
     were, then go. See drawerTrail — the seq check is what stops an opener
     that bailed from leaving a duplicate in the trail. */
  /* The tab is read here, before the opener runs, because opening a record
     resets it — going from one record to another would otherwise remember the
     new record's kit tab as the old record's state. */
  const was = drawerNow, wasTab = S.rtab, seq = drawerSeq;
  reopenDrawer(kind, id);
  if(drawerSeq === seq) return;                       // nothing opened
  if(was && !(was.kind === kind && was.id === id)){
    drawerTrail.push({...was, tab:wasTab});
    if(drawerTrail.length > DRAWER_MAX) drawerTrail.shift();
  }
  drawerNow = {kind, id, label: drawerLabel(kind, id)};
  paintDrawerBack();
}

/* The bare openers, with no trail bookkeeping. Called by dispatch() on the way
   forward and by closeDrawer() on the way back, which is the whole reason it
   is a function of its own: going back must not record itself as a step. */
function reopenDrawer(kind, id){
  if(kind === "intel") drawerIntel(id);
  else if(kind === "resonator") drawerResonator(id);
  else if(kind === "version") drawerVersion(id);
  else if(kind === "weapon") drawerWeapon(id);
  else if(kind === "echo") drawerEcho(id);
  else if(kind === "event") drawerEvent(id);
  else if(kind === "open" && id === "methodology") drawerMethodology();
  /* "open" is the drawer that belongs to no record. The astrite breakdown
     carries which patch it is for in its id, because the same panel is a
     different page for every version. */
  else if(kind === "open" && String(id).startsWith("astrite:")) drawerAstrite(String(id).slice(8));
}

/* ── events ──────────────────────────────────────────────────────── */
function bind(){
  document.addEventListener("click", e => {
    /* data-close="all" is the scrim. Clicking the page outside a panel means
       "get me out", where the × in the panel's own header means "close this
       one" — and with a trail behind it those are different requests. */
    const closer = e.target.closest("[data-close]");
    if(closer){ closeDrawer(closer.dataset.close === "all"); closeCmd(); return; }

    const cmd = e.target.closest(".cmd-item");
    if(cmd){ runCmdItem(Number(cmd.dataset.i)); return; }

    const el = e.target.closest("[data-act]");
    if(!el) return;
    const {act, id, scope} = el.dataset;

    /* Both copies of a rail control — the rail's and the panel's mobile bar —
       are replaced by the redraw that follows the click, so the keyboard is
       left standing on a removed node. Put it back on the replacement, in the
       copy it was clicked in; the other one is hidden at this width. */
    const home = el.closest(".rail") ? ".rail " : ".fbar ";
    const back = sel => document.querySelector(home + sel)?.focus();

    if(act === "search"){ openCmd(); }
    else if(act === "view"){
      /* Clicking the view you are already on folds its filter list away and
         back. Anything else navigates, which opens its own. */
      if(S.view === id && RAIL_FILTERS[id] && el.closest(".rail")){
        S.railOpen = S.railOpen === id ? null : id;
        renderRail();
        document.getElementById(`tab-${id}`)?.focus();
      }
      else setView(id);
    }
    /* The primary axis, from the rail or from the panel bar. */
    else if(act === "railfilter"){
      const view = el.dataset.view;
      S[scope] = id;
      S.sigLimit = 60;
      if(S.view !== view) setView(view);
      else { renderRail(); draw(view); }
      back(`[data-act="railfilter"][data-view="${view}"][data-scope="${scope}"][aria-pressed="true"]`);
    }
    else if(act === "filter"){ S[scope] = id; S.sigLimit = 60; draw(S.view); }
    /* A sonata set, from its tile at the top of the Echoes view or from a link
       inside an echo record. Clicking the set that is already on clears back
       to all, which is the gesture the rail already uses to fold a view's own
       filter list — one control, both directions.

       It closes any open record and navigates, because this is the one filter
       on the desk that can be reached from inside a drawer: leaving the record
       standing over a page that has just changed underneath it would hide the
       only thing the click did. */
    else if(act === "eset"){
      /* The tile's own set, read before the redraw replaces it. data-id is the
         action's payload — "all" on the tile that is currently on, because it
         is a toggle — and data-set is which tile this is, which is the one the
         keyboard has to be put back on either way. Falls back to the panel
         when the click came from inside a record, where there was no tile. */
      const back = el.dataset.set;
      setSonata(id);
      (document.querySelector(`.stile[data-set="${back}"]`)
        || document.getElementById("p-echoes"))?.focus?.({preventScroll:true});
    }
    /* Reset clears the primary axis too, and that one is drawn in the rail. */
    else if(act === "reset"){
      VIEW_FILTERS[S.view].forEach(k => S[k] = "all");
      S.sigLimit = 60;
      renderRail();
      draw(S.view);
    }
    else if(act === "morelogs"){ S.sigLimit += 60; draw("signals"); }
    else if(act === "reel"){ paintReel(Number(id)); }
    /* A condensed skill card asking for the rest of itself. Repaints the one
       card rather than redrawing the kit: the Simplified toggle is a preference
       about the whole record and this is not — it is one card, opened, and
       redrawing would shut it again along with everything else already open. */
    else if(act === "skillfull"){
      const card = el.closest(".skill");
      const who = String(S.drawer || "");
      const blocks = who.startsWith("resonator:")
        ? skillBlocks(who.slice(10), card?.dataset.slot) : null;
      if(card && blocks){
        card.querySelector(".skill-t").innerHTML = kitBody(blocks);
        card.classList.add("full");
        el.remove();
      }
    }
    /* The combat-kit band is a table of contents for the cards under it. */
    else if(act === "kitjump"){
      const card = document.getElementById(`sk-${id}`);
      if(card){
        card.scrollIntoView({block:"center", behavior:"smooth"});
        card.classList.remove("lit");
        /* Restart the highlight even when the same node is clicked twice. */
        void card.offsetWidth;
        card.classList.add("lit");
      }
    }
    /* The pull calculator's three controls. All of them repaint the answer and
       none of them redraws the page: the form is standing above #pull-out with
       a caret in one of its boxes, and replacing it to flip one aria-pressed
       would take the caret with it. So the clicked control is corrected in
       place and only the answer is rebuilt. */
    else if(act === "pulltarget"){
      const want = S.pull.want;
      const at = want.indexOf(id);
      if(at < 0) want.push(id); else want.splice(at, 1);
      el.setAttribute("aria-pressed", at < 0);
      paintPullOut();
    }
    else if(act === "pullguar"){
      S.pull.guaranteed = !S.pull.guaranteed;
      el.setAttribute("aria-pressed", S.pull.guaranteed);
      paintPullOut();
    }
    /* Clear is the one that does redraw, because it has to put every number
       box back to empty and there is nothing to preserve. */
    else if(act === "pullreset"){
      S.pull = {want:[], astrite:0, radiant:0, forging:0, pity:0, guaranteed:false, wpity:0};
      draw("pulls");
      document.querySelector('[data-act="pullreset"]')?.focus();
    }
    else if(act === "noop"){ /* decorative */ }
    else dispatch(act, id);
  });

  /* The ascension slider. `input` rather than `change` so the passives track a
     drag instead of jumping when the thumb is let go — and it repaints rather
     than redraws, because redrawing would replace the input mid-drag. */
  document.addEventListener("input", e => {
    /* The calculator's number boxes. Written straight onto S and answered on
       the keystroke, so the figure moves as you type rather than when you tab
       out — the whole point of the view is trying figures against each other.

       The clamp is written back into the box only when it actually bit. A
       control that rewrote every keystroke would fight you halfway through
       typing 15000; one that silently held a value the box does not show
       would be worse. */
    const pf = e.target.closest("[data-pull]");
    if(pf){
      const k = pf.dataset.pull;
      const max = pf.max ? Number(pf.max) : Number.MAX_SAFE_INTEGER;
      const raw = Math.floor(Number(pf.value) || 0);
      const val = Math.min(max, Math.max(0, raw));
      if(pf.value !== "" && raw !== val) pf.value = val;
      S.pull[k] = val;
      paintPullOut();
      return;
    }
    const r = e.target.closest("[data-rank]");
    if(r){
      S.rank = Math.min(5, Math.max(1, Number(r.value) || 1));
      paintRank();
      return;
    }
    /* The echo record's rank slider, on the same terms. Its own state and its
       own repaint: an ascension and a rank are different numbers about
       different things, and the two records can be opened one after the other
       without either moving the other's control. */
    const er = e.target.closest("[data-erank]");
    if(er){
      S.erank = Math.min(5, Math.max(1, Number(er.value) || 1));
      paintERank();
    }
  });

  /* Cards are role=button, so Enter/Space have to act like a click. */
  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){ closeCmd(); closeDrawer(); return; }

    if((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)){ e.preventDefault(); openCmd(); return; }
    if(e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){ e.preventDefault(); openCmd(); return; }

    if(!$("#cmd").hidden){
      if(e.key === "ArrowDown"){ e.preventDefault(); moveCmd(1); }
      else if(e.key === "ArrowUp"){ e.preventDefault(); moveCmd(-1); }
      else if(e.key === "Enter"){ e.preventDefault(); runCmdItem(cmdIdx); }
      return;
    }

    const t = e.target;
    if((e.key === "Enter" || e.key === " ") && t?.getAttribute?.("role") === "button" && t.dataset.act){
      e.preventDefault(); t.click(); return;
    }
    /* Arrow keys walk the rail's view list. Up/down are the axis that matches
       what you see — left/right stay bound because they were the keys for two
       years and cost nothing to keep. Bound to the rail's own buttons, not to
       every [data-act=view]: the dock is a row of six on a phone and the arrow
       keys are not how anyone drives it. */
    if(t?.closest?.(".rail .navlink")){
      const step = /^Arrow(Right|Down)$/.test(e.key) ? 1 : /^Arrow(Left|Up)$/.test(e.key) ? -1 : 0;
      const i = VIEWS.findIndex(v => v.id === S.view);
      if(step){ e.preventDefault(); setView(VIEWS[(i + step + VIEWS.length) % VIEWS.length].id, true); }
      if(e.key === "Home"){ e.preventDefault(); setView(VIEWS[0].id, true); }
      if(e.key === "End"){ e.preventDefault(); setView(VIEWS[VIEWS.length-1].id, true); }
    }
  });

  $("#cmd-input").addEventListener("input", e => runCmd(e.target.value));
  addEventListener("hashchange", () => setView(location.hash.slice(1) || "timeline"));
  /* Every box a fitted name sits in is sized off the window one way or
     another, so a size the last width allowed is not a size this one does. */
  addEventListener("resize", fitSoon);
  /* DM Sans arriving replaces the metrics every fit was measured against —
     the fallback is narrower, and names measured in it overrun once it goes. */
  document.fonts?.ready.then(fitSoon);
}

/* ── boot ────────────────────────────────────────────────────────── */
async function load(name){
  try{
    const r = await fetch(`data/${name}.json`, {cache:"no-store"});
    if(!r.ok) throw new Error(r.status);
    return await r.json();
  }catch{
    return FALLBACK[name];
  }
}

(async function(){
  const names = ["versions","news","resonators","weapons","echoes","feed","art","portraits","translations","events","permanents","items","archive","astrite"];
  const loaded = await Promise.all(names.map(load));
  DATA = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));

  renderRail();
  renderHud();
  renderLegend();
  bind();
  setView(location.hash.slice(1) || "timeline");
})();

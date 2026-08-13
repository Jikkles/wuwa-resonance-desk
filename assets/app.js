/* Resonance Desk — presentation layer.
   Reads data/*.json, renders four views into one dashboard shell.
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
  feed:       {fetched:"", sources:[], errors:[], items:[]},
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

/* Attribute drives each card's accent so a banner row reads at a glance. */
const ATTR_COLOUR = {
  aero:"#7FD4B0", glacio:"#78BFE8", fusion:"#E8734A",
  electro:"#B98BE0", spectro:"#E8C24A", havoc:"#D4557A"
};

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
  {id:"events",     label:"Events",       icon:"i-events",  soon:true},
  {id:"intel",      label:"Intel",        icon:"i-intel"},
  {id:"signals",    label:"Live Signals", icon:"i-signals", warn:"Unverified", short:"Signals"}
];

let DATA = {};
/* Primary axis per view lives in chips at the top of the panel; the secondary
   axes (ver/cat/weapon/src) are the quick-filter selects. All of them are one
   flat bag so a filter control never has to know which view it is in. */
const S = {
  view:"timeline", sigLimit:60, drawer:null,
  /* Skill cards open condensed — first sentence of every paragraph — and the
     toggle in the Skills header swaps them to the client's full text. A kit is
     five thousand words; the default has to be the one you can scan. */
  kitSimple:true,
  /* Weapon ascension, 1–5. Not a filter — it doesn't change which weapons you
     can see, only what the passive says — so it sits outside VIEW_FILTERS and
     Reset leaves it alone. The stats never move with it: those are level 90,
     full stop. */
  rank:1,
  when:"all", tlMode:"cards",      // timeline
  tier:"all", ver:"all", cat:"all", // intel
  kind:"all", src:"all",           // signals
  elem:"all", weapon:"all",        // resonators
  wtype:"all", wstat:"all"         // weapons
};
/* Which of those a view actually reads — drives Reset, and stops a stale
   element filter from silently narrowing a list you have navigated away from. */
const VIEW_FILTERS = {
  timeline:["when"], intel:["tier","ver","cat"],
  signals:["kind","src"], resonators:["elem","weapon"],
  weapons:["wtype","wstat"],
  /* Every view needs a row here even with nothing in it — filtersOn() and
     Reset both index this table unguarded. */
  events:[]
};

/* ── helpers ─────────────────────────────────────────────────────── */
const $  = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DAY = 86400000;

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
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ── data accessors ──────────────────────────────────────────────── */
const versions   = () => DATA.versions?.versions || [];
const entries    = () => DATA.news?.entries || [];
const resonators = () => DATA.resonators?.resonators || [];
const weapons    = () => DATA.weapons?.weapons || [];
const signals    = () => [...(DATA.feed?.items || [])].sort((a,b) => (b.date||"").localeCompare(a.date||""));

/* Signals arrive in whatever language the source publishes in — about a fifth
   of them are Kurobbs CN. feed.json is machine-written and replaced every six
   hours, so the English lives in translations.json keyed by URL, and the
   original stays one hover away. Untranslated items show as published. */
function headline(i){
  const en = DATA.translations?.titles?.[i.url];
  return en ? {text:en, original:i.title, translated:true} : {text:i.title, original:"", translated:false};
}

const liveVersion   = () => versions().find(v => v.status === "live");
const nextVersion   = () => versions().find(v => v.status === "announced");
const futureVersion = () => versions().find(v => v.status === "beta");

function resonatorFor(name){
  const k = String(name||"").toLowerCase();
  return resonators().find(r => r.name.toLowerCase() === k) || {};
}
function artFor(name){ return (DATA.art?.art || {})[name] || null; }

/* Cut-outs, as opposed to artFor()'s posters. Kuro's reveal art is a 1080x1920
   marketing card — logo band, name plate, its own backdrop — which is the right
   picture at 400px and the wrong one at 54px, where you get a tiny poster
   instead of a face. portraits.json holds the character cut out of any backdrop
   at three sizes — `icon` for a tile, `card` waist-up, `full` the 2048px
   illustration — so a tile shows the character and nothing else: no plate, no
   second background inside the card's. See scripts/fetch-portraits.mjs. */
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
const GALLERY_CREDIT = "Character art © Kuro Games";

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
      if(f.image) return {url:f.image, poster:f.poster, cutout:f.cutout, full:f.full, alt:r.name};
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
          add({...b, phase:p.n, version:v.id, start:p.start, end:p.end, status:v.status});
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
  if(!end && v.status === "live"){
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
   Precedence: hand-set image → gallery illustration → reveal key art → crop of
   the patch key visual → waist-up card → typographic plate. */
function figure(b){
  const r = resonatorFor(b.name);
  const art = artFor(b.name);
  const port = portraitFor(b.name);
  const own = b.image || r.image;
  /* The gallery illustration is the desk's artwork now, for everyone who has
     one. It ranks above Kuro's own reveal poster deliberately: the poster is a
     finished composition — logo band, name plate, painted backdrop — so a row
     of them reads as a row of adverts, and every one is a different layout. It
     ranks above the patch key visual for the same reason in reverse: a crop of
     a group shot is a picture of a patch, not of a person. What it fixes first
     is sharpness. The card below is 374px wide and was being stretched across
     a 360px panel; this is 2048px and cut out, so the art window and a
     hand-placed picture no longer look like two different sites.

     Absent for characters whose Prydwen gallery holds the Resonance Liberation
     splash instead of a standing render — a composition, not a portrait, and
     there is no crop of it that is a picture of the character. Those fall
     through to the poster, which is what they were using anyway. The fetcher
     decides and says so in portraits.json; see scripts/fetch-portraits.mjs. */
  const gallery = !own ? port?.full || null : null;
  const shared = !own && !gallery && !art && b.keyVisual && b.keyVisualFocus ? b.keyVisual : null;
  /* The waist-up card now outranks Kuro's reveal poster, where it used to sit
     below it. The poster is the one picture on the desk that is not a cut-out —
     logo band, name plate, its own painted backdrop — so the eight characters
     who had one were the eight who looked like they belonged to a different
     site, standing in boxes in a grid where everyone else stands on the card.
     Sharpness was the argument for the poster and it is real; consistency wins
     it, because a record grid is read across, not one card at a time. The
     poster stays as the fallback for anyone Prydwen has no portrait for at all,
     and its epithet and credit are still read off it either way. */
  const image = own || gallery || port?.card || art?.url || shared?.url;
  const cutout = (!!own && image === own && (b.imageStyle || r.imageStyle) === "cutout")
              || !!gallery
              || (!!port && image === port.card);
  /* A 16:9 key visual in a 4:5 box has no vertical overflow, so object-position
     can only frame horizontally — zoom picks the height. */
  const style = shared
    ? ` style="object-position:${esc(b.keyVisualFocus)};transform:scale(${Number(b.keyVisualZoom)||1});transform-origin:${esc(b.keyVisualOrigin||"50% 50%")}"`
    : "";
  return {
    image, cutout, style,
    /* The gallery illustration is a 2048x2048 square with the figure standing
       head-near-the-top, feet-at-the-bottom and clear air either side. Every
       other picture here is already cropped to something. Flagging it lets the
       CSS frame a full body instead of inheriting a crop meant for a bust. */
    full: !!gallery,
    /* What a 54px tile shows, when we hold one. Resolved separately from the
       big picture above so the two never have to compromise on one crop. */
    icon: port?.icon || null,
    glyph: r.nameCN || b.name?.slice(0,1) || "?",
    credit: !cutout ? null
          : own ? (b.imageCredit || r.imageCredit || null)
          : gallery ? GALLERY_CREDIT
          : PORTRAIT_CREDIT,
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
  const cls = f.full ? " has-cutout has-full" : f.cutout ? " has-cutout" : f.image ? " has-art" : "";
  const inner = f.image
    ? `<img src="${esc(f.image)}" alt="${esc(b.name)}" loading="lazy" decoding="async"${f.style}>`
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
function thumb(b, {showWeapon = true, showPhase = true, showNew = false} = {}){
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
  const meta = b.rarity || attr
    ? `${phase}${debut}${b.rarity ? `<i class="rar">${esc(b.rarity)}★</i>` : ""}${attr ? `<i class="attr">${esc(attr)}</i>` : ""}${
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
      <b>${esc(b.name || "???")}</b>
      <span class="bmeta">${meta}</span>
    </span>
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

/* ── rail ────────────────────────────────────────────────────────── */
function renderRail(){
  /* These are the tablist: the horizontal strip that used to own role=tab is
     gone, so the ids, aria-controls and roving tabindex live here. aria-current
     stays alongside aria-selected because the dock renders from the same
     VIEWS array and styles off it, and setView sets it on every [data-act=view]
     in one pass. */
  $("#rail-nav").innerHTML = VIEWS.map(v => `
    <button class="navlink" role="tab" id="tab-${v.id}" data-act="view" data-id="${v.id}"
            aria-selected="${S.view === v.id}" aria-controls="p-${v.id}"
            aria-current="${S.view === v.id}" tabindex="${S.view === v.id ? 0 : -1}">
      ${icon(v.icon)}<span>${v.label}</span>
      ${navBadge(v)}
    </button>`).join("");

  const counts = tierCounts();
  $("#rail-tiers").innerHTML = TIERS.map(t => `
    <button class="tierlink" data-act="tier" data-id="${t}" title="${esc(TIER_MEANS[t])}">
      <i class="dot t-${t}"></i><span>${TIER_LABEL[t]}</span><span class="n">${counts[t] || 0}</span>
    </button>`).join("");

  /* Two kinds of shortcut, told apart by the mark on the right. The first
     three are saved views — a filter combination you'd otherwise have to set
     by hand — and the rest leave the site. Nothing here is a page that doesn't
     exist: a link that goes nowhere is worse than no link. */
  $("#rail-links").innerHTML = [
    ["Patch notes",    {view:"intel",    set:{tier:"official", cat:"all", ver:"all"}}],
    ["Banner history", {view:"timeline", set:{when:"past"}}],
    ["Hot signals",    {view:"signals",  set:{kind:"hot", src:"all"}}],
    ["Official news",  {href:"https://wutheringwaves.kurogames.com/en/main/news"}],
    ["Kuro on YouTube",{href:"https://www.youtube.com/channel/UC0Bi5KMcECRVYis5Gb_ZYZQ"}],
    /* Main sub above the leak sub, in the same order the desk trusts them. */
    ["Subreddit",      {href:"https://www.reddit.com/r/WutheringWaves/"}],
    ["Leak subreddit", {href:"https://www.reddit.com/r/WutheringWavesLeaks/"}]
  ].map(([label, to]) => to.href
    ? `<a class="tierlink" href="${to.href}" target="_blank" rel="noopener">
         <span>${label}</span><span class="n out">↗</span></a>`
    : `<button class="tierlink" data-act="jump" data-id="${esc(to.view)}"
               data-set="${esc(JSON.stringify(to.set))}">
         <span>${label}</span><span class="n out">${icon("i-arrow", 11)}</span></button>`
  ).join("");

  $("#dock").innerHTML = VIEWS.map(v => `
    <button data-act="view" data-id="${v.id}" aria-current="${S.view === v.id}">
      ${icon(v.icon, 17)}<span>${v.short || v.label}</span>
    </button>`).join("");
}

/* Right-hand mark on a nav item, in precedence order: the standing warning
   Live Signals carries, then the unbuilt flag, then the record count. A view
   with nothing behind it has no count worth printing — a bare 0 next to
   Weapons reads as "no weapons exist" rather than "not written yet". */
function navBadge(v){
  if(v.warn) return `<span class="warn">${v.warn}</span>`;
  if(v.soon) return `<span class="soon">Soon</span>`;
  return railCount(v.id);
}
function railCount(id){
  const n = id === "intel" ? entries().length
          : id === "signals" ? signals().length
          : id === "resonators" ? resonators().length
          : id === "weapons" ? weapons().length
          : versions().length;
  return `<span class="n">${n}</span>`;
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
   original 3.5 key visual is 3840x2160 and 4MB — fine as a poster, absurd as
   a page background, and doubly absurd for one we blur past recognition. At
   1440 wide and q72 the same image is about 210KB, and after a 60px blur no
   pixel of the difference survives. Any other host is left alone. */
function cdnWidth(url, w){
  return /(^|\.)kurogame\.com\//.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}x-oss-process=image/resize,w_${w}/quality,q_72`
    : url;
}

/* The live patch's key visual, behind the whole desk.

   It is a marketing image — the game logo across one corner, the version name
   set in display type across the middle — which is exactly why it was taken
   off the patch cards, where it sat behind two cut-outs and you read
   "LAMPLIGHT IN MIRAGE" through the gap between them. None of that survives
   the treatment in .backdrop: at this blur it is weather, not a poster, and
   what is left is the patch's own palette — 3.5's gold and deep blue — under
   a page that is otherwise unrelieved charcoal.

   Decorative, so it is loaded last and faded in, and the class only lands once
   the bytes are actually here. A slow connection gets the desk on the ground
   it has always had rather than a half-painted picture. */
function renderBackdrop(){
  const el = $("#backdrop");
  const url = liveVersion()?.keyVisual?.url;
  if(!el || !url) return;
  const src = cdnWidth(url, 1440);
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url("${src}")`;
    el.classList.add("in");
  };
  img.src = src;
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
    return src ? {src, name:b.name, full:f.full} : null;
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
  const art = cardArt(v);
  const figs = cardFigures(v);

  const state = role === "live"
    ? `<span class="pill live">Current</span>`
    : role === "next" ? `<span class="pill next">Upcoming</span>`
    : `<span class="pill future">Future</span>`;

  let status = "";
  if(role === "live"){
    const left = patchWindow(v) ? daysTo(patchWindow(v).end) : null;
    status = `<div class="pcard-state"><span class="pulse t-official">Live</span>
      ${left != null && left > 0 ? `<span style="color:var(--fg-3)">${plural(left, "day")} remaining</span>` : ""}</div>`;
  }else if(days != null){
    status = `<div class="pcard-state">${days > 0 ? `<span class="t-datamined">In ${plural(days, "day")}</span>`
      : `<span class="t-datamined">Launching now</span>`}</div>`;
  }else if(role === "future"){
    /* No dates, no art, no banners — say why the card is nearly empty rather
       than leaving a hole and letting it read as something failing to load. */
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
  const pair = b => {
    const sig = signatureFor(b);
    const r = resonatorFor(b.name);
    const cls = b.weapon || r.weapon;
    /* The element rides the tile itself, not just its two halves — the tile is
       lit in it at rest, so a column of banners reads as a row of elements
       before you read a single name. */
    return `<div class="bpair"${attrStyle(b.attribute || r.attribute)}>${thumb(b, {showWeapon:false, showPhase:false, showNew:true})}${sig
      ? `<button class="wtile" data-act="weapon" data-id="${esc(sig)}"${attrStyle(b.attribute || resonatorFor(b.name).attribute)}
                title="Signature weapon — runs alongside ${esc(b.name)}">
           ${weaponIcon(sig)}
           <span class="wtext"><b>${esc(sig)}</b></span>
           <!-- The class, not the word "Signature". A signature weapon is by
                definition the resonator's own class, so one label carries both
                facts — and it is the fact you sort a roster by. -->
           ${cls ? `<span class="wsub">${esc(cls)}</span>` : ""}
         </button>`
      : `<div class="wtile empty">
           <span class="wsub">No weapon listed</span>
           ${cls ? `<span class="wsub" style="margin-left:auto">${esc(cls)}</span>` : ""}
         </div>`}</div>`;
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
  return `<article class="pcard is-${role}" role="button" tabindex="0" data-act="version" data-id="${esc(v.id)}"
           aria-label="Version ${esc(v.id)} detail">
    <div class="pcard-stage">
      <!-- Rings only when there is neither a poster nor a figure — a patch we
           know nothing about yet. They are a held signal, not a backdrop. -->
      ${art || (figs.length ? "" : `<div class="rings"></div>`)}
      <!-- Status and the run bar ride the top rail; the version number and its
           codename sit side by side underneath. Stacked the other way round,
           the number was buried under four lines of metadata. -->
      <div class="pcard-head">
        <div class="pcard-top">${state}${status}</div>
        ${track(v, role)}
        <div class="pcard-main">
          <div class="pcard-num">${esc(v.id)}</div>
          <div class="pcard-idtext">
            ${v.title ? `<div class="pcard-title">${esc(v.title)}</div>` : ""}
            <div class="pcard-dates">${[v.start ? fmtDate(v.start) : "", versionEnd(v)].filter(Boolean).join(" — ") || "Dates unknown"}</div>
          </div>
        </div>
      </div>
      <!-- The clear part, and where the debut figures live. Putting them in
           here rather than behind the whole stage is what keeps a head out of
           the head band's shadow: this box *is* the space below the band, so a
           figure framed to it can't be framed into the dark. -->
      <div class="pcard-window">${figs.length
        ? `<div class="figs n${figs.length}">${figs.map(f =>
            `<div class="fig-cell">
               <img class="fig${f.full ? " full" : ""}" src="${esc(f.src)}" alt="${esc(f.name)}" loading="lazy" decoding="async">
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

function versionBlock(v){
  const role = v.status === "live" ? "live" : v.status === "announced" ? "next" : "future";
  const lanes = (v.phases || []).map(p => {
    const bs = (p.banners || []).map(b => ({...b, phase:p.n}));
    const range = [p.start ? fmtShort(p.start) : "", p.end ? fmtShort(p.end) : ""].filter(Boolean).join(" → ");
    const est = p.estimated_start || p.estimated_end ? ` <span class="est">est</span>` : "";
    return `<div class="lane">
      <div class="lane-k"><b>Phase ${p.n}</b><span>${range}${est}</span></div>
      <div class="lane-track">${bs.map(b => {
        const r = resonatorFor(b.name);
        const attr = b.attribute || r.attribute;
        const f = figure({...b, keyVisual:v.keyVisual});
        const bits = [b.rarity || r.rarity ? (b.rarity || r.rarity) + "★" : "", attr, b.weapon || r.weapon].filter(Boolean).join(" · ");
        return `<span class="btag ${b.new ? "new" : ""}"${attrStyle(attr)}>
          <i class="av">${f.image
            ? `<img class="${f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async">`
            : esc(f.glyph)}</i>
          <span class="who">${esc(b.name)}</span>
          <span class="bits">${esc(bits)}</span>
          ${b.new ? `<span class="new-flag">New</span>` : b.rerun ? `<span class="bits">Rerun</span>` : ""}
        </span>`;
      }).join("") || `<span class="btag"><span class="bits">To be confirmed</span></span>`}</div>
    </div>`;
  }).join("");

  return `<article class="vblock is-${role}">
    <div class="vhead">
      <span class="vnum">${esc(v.id)}</span>
      <span class="pill ${role === "live" ? "live" : role === "next" ? "next" : "future"}">${esc(v.status)}</span>
      ${v.title ? `<span class="vtitle">${esc(v.title)}</span>` : ""}
      <button class="more" style="margin-left:auto" data-act="version" data-id="${esc(v.id)}">Detail ${icon("i-arrow", 12)}</button>
    </div>
    <div class="vmeta">
      ${v.start ? `<span>Launch <b>${fmtDate(v.start)}</b></span>` : ""}
      ${v.livestream ? `<span>Preview <b>${fmtDate(v.livestream)}</b></span>` : ""}
      ${v.region ? `<span>Region <b>${esc(v.region)}</b></span>` : ""}
      <span>Intel <b>${newsFor(v.id).length}</b></span>
    </div>
    ${lanes ? `<div class="lanes">${lanes}</div>` : ""}
    ${v.notes ? `<div class="vnote">${esc(v.notes)}</div>` : ""}
  </article>`;
}

/* Which bucket a version falls in. One definition — the chips, the card row and
   the lane list all have to agree or the filter looks broken. */
const bucketOf = v => v.status === "live" ? "current"
  : (v.status === "announced" || v.status === "beta") ? "upcoming" : "past";
const roleOf = v => v.status === "live" ? "live" : v.status === "announced" ? "next" : "future";

function renderTimeline(){
  const live = liveVersion(), next = nextVersion(), future = futureVersion();

  const rank = v => v.status === "live" ? 0 : v.status === "announced" ? 1 : v.status === "beta" ? 2 : 3;
  const inWindow = v => S.when === "all" || bucketOf(v) === S.when;
  const list = [...versions()].filter(inWindow)
    .sort((a, b) => rank(a) - rank(b) || parseFloat(b.id) - parseFloat(a.id));

  /* Now / Next / Future as three cards across, narrowing to whichever the
     chips asked for. The filter has to change the thing directly underneath
     it — it used to sit on this panel and quietly re-filter a lane list two
     thousand pixels further down, which reads as a button that does nothing. */
  const cards = S.when === "all"
    ? [[live, "live"], [next, "next"], [future, "future"]]
    : list.map(v => [v, roleOf(v)]);

  const body = S.tlMode === "list"
    ? (list.length ? `<div class="vlist">${list.map(versionBlock).join("")}</div>`
                   : `<div class="empty">No patch in this window.</div>`)
    : (cards.length ? `<div class="hero${S.when === "all" ? "" : " narrow"}">${
        cards.map(([v, r]) => patchCard(v, r)).join("")}</div>`
                    : `<div class="empty">No patch in this window.</div>`);

  const hero = `<div class="panel">
    <div class="panel-h">
      <h2>Patch timeline</h2><span class="sub">${S.when === "all" ? "Now / Next / Future" : plural(list.length, "patch")}</span>
      <div class="right">
        <div class="chips">${chips("when", [
          ["all","All"], ["current","Current"], ["upcoming","Upcoming"], ["past","Past"]
        ], S.when)}</div>
        <div class="seg">${[["cards","i-grid","Card view"], ["list","i-rows","Lane view"]].map(([m, ic, lbl]) =>
          `<button data-act="tlmode" data-id="${m}" aria-pressed="${S.tlMode === m}" title="${lbl}" aria-label="${lbl}">${icon(ic, 14)}</button>`
        ).join("")}</div>
      </div>
    </div>
    <div class="panel-b${S.tlMode === "list" ? " flush" : ""}">${body}</div>
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

  $("#p-timeline").innerHTML = `<div class="stack">${hero}${duo}</div>`;
}

/* ── intel ───────────────────────────────────────────────────────── */
function chips(scope, items, active){
  return items.map(([k, label, n, cls]) =>
    `<button data-act="filter" data-scope="${scope}" data-id="${k}" aria-pressed="${active === k}" class="${cls || ""}">
      ${cls ? `<i class="dot"></i>` : ""}${label}${n != null ? `<span class="n">${n}</span>` : ""}
    </button>`).join("");
}

/* ── quick filters ───────────────────────────────────────────────────
   Every view's primary axis is a chip row in its panel header — tier on
   Intel, kind on Signals, element on Resonators. These are the secondary
   axes: too many values to spend a chip each on, so they get selects.
   Options are read off the data, so a category nothing is filed under never
   appears and can't produce an empty list. */
function filterSpec(){
  const uniq = xs => [...new Set(xs.filter(Boolean))];
  const byVer = (a, b) => parseFloat(b) - parseFloat(a);
  if(S.view === "intel") return [
    {k:"ver",    label:"Version",  all:"All versions",   opts:uniq(entries().map(e => e.version)).sort(byVer)},
    {k:"cat",    label:"Category", all:"All categories", opts:uniq(entries().map(e => e.category)).sort()}
  ];
  if(S.view === "resonators") return [
    {k:"weapon", label:"Weapon",   all:"All weapons",    opts:uniq(resonators().map(r => r.weapon)).sort()}
  ];
  if(S.view === "signals") return [
    {k:"src",    label:"Source",   all:"All sources",    opts:uniq(signals().map(i => i.source)).sort()}
  ];
  /* Class is the chip row on Weapons — five values, and it is the question the
     view is opened with. Sub-stat is the second axis: "which Broadblade gives
     crit rate" is the next question after it, and six more chips across the
     same header would have made the two rows indistinguishable. */
  if(S.view === "weapons") return [
    {k:"wstat",  label:"Sub-stat", all:"All sub-stats",  opts:uniq(weapons().map(w => w.stat)).sort()}
  ];
  /* Timeline's now/next/past chips are the whole filter — there is no second
     axis worth inventing for three patches. */
  return [];
}

const filtersOn = () => VIEW_FILTERS[S.view].filter(k => S[k] !== "all");

/* Rendered twice on purpose: into the aside on desktop, and inline under the
   panel header at the widths where the aside is gone. Both write to the same
   state through the same delegated handler, and every draw() rebuilds both, so
   they cannot drift apart. */
function quickFilters(inline){
  const spec = filterSpec();
  if(!spec.length) return "";
  const rows = spec.map(f => `
    <label class="qf-row">
      <span class="label">${f.label}</span>
      <select data-sel="${f.k}" aria-label="${f.label}" class="${S[f.k] === "all" ? "" : "on"}">
        <option value="all"${S[f.k] === "all" ? " selected" : ""}>${f.all}</option>
        ${f.opts.map(o => `<option value="${esc(o)}"${S[f.k] === o ? " selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </label>`).join("");
  const on = filtersOn().length;
  const body = `<div class="qf">${rows}
    <button class="btn qf-reset" data-act="reset"${on ? "" : " disabled"}>
      ${icon("i-close", 11)} Reset filters${on ? ` (${on})` : ""}
    </button></div>`;

  return inline
    ? `<div class="qf-inline">${body}</div>`
    : `<div class="panel qf-panel"><div class="mini-h"><h3>Quick filters</h3></div>${body}</div>`;
}

/* An empty list should say which control emptied it, and undo itself. */
function emptyWhy(what){
  const on = filtersOn();
  if(!on.length) return `Nothing here yet.`;
  const names = {tier:"confidence", ver:"version", cat:"category", kind:"kind",
                 src:"source", elem:"element", weapon:"weapon", when:"window",
                 wtype:"class", wstat:"sub-stat"};
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
    ? `<div class="ithumb${art.cutout ? " cut" : ""}${art.full ? " full" : ""}">
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

/* Tier is the chip row because it is the question the desk exists to answer.
   Version and category are the quick-filter selects — narrower questions, and
   there are too many categories to spend a chip each on. */
function intelList(){
  let list = [...entries()].sort((a, b) => (b.date||"").localeCompare(a.date||""));
  if(S.tier !== "all") list = list.filter(e => e.confidence === S.tier);
  if(S.ver  !== "all") list = list.filter(e => e.version === S.ver);
  if(S.cat  !== "all") list = list.filter(e => e.category === S.cat);
  return list;
}

function renderIntel(){
  const counts = tierCounts();
  const list = intelList();

  const filters = chips("tier",
    [["all", "All", entries().length]].concat(TIERS.map(t => [t, TIER_LABEL[t], counts[t] || 0, `t-${t}`])),
    S.tier);

  $("#p-intel").innerHTML = `<div class="stack">
    <div class="panel">
      <div class="panel-h">
        <h2>Intel</h2><span class="sub">Read, judged, tiered by hand</span>
        <div class="right chips tiered">${filters}</div>
      </div>
      ${quickFilters(true)}
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
  if(S.src !== "all") list = list.filter(i => i.source === S.src);
  const shown = list.slice(0, S.sigLimit);

  const filters = chips("kind",
    [["all", "All", all.length], ["hot", "Hot", all.filter(i => i.hot).length]]
      .concat(Object.keys(KIND_LABEL).filter(k => counts[k]).map(k => [k, KIND_LABEL[k], counts[k]])),
    S.kind);

  const ok = (feed.sources || []).filter(s => s.status === "ok").length;

  $("#p-signals").innerHTML = `<div class="stack">
    <div class="panel sigpanel">
      <div class="panel-h">
        <h2>Live signals</h2>
        <span class="sub">Last run ${feed.fetched ? esc(fmtDate(feed.fetched)) + " " + esc(fmtTime(feed.fetched)) : "—"} · ${ok}/${(feed.sources||[]).length} sources</span>
        <div class="right chips">${filters}</div>
      </div>
      <div class="warnbar">
        Unverified automated signals
        <span>Raw headlines pulled every 6 hours. Nothing here is tiered or read — it's a lead list. Anything that survives a read gets written up under Intel.</span>
      </div>
      ${quickFilters(true)}
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
   and said out loud — a summary that quietly loses thirty lines of a kit is
   worse than no summary, and the count is also the argument for the toggle. */
function kitGist(blocks){
  let used = 0, cut = 0;
  const body = (blocks || []).map(b => {
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
  return body + (cut
    ? `<p class="gist-more">+${cut} more line${cut === 1 ? "" : "s"} — switch off Simplified for the full text.</p>`
    : "");
}

/* One skill, one card. These used to be <details> in a single column, closed,
   because a full kit laid flat buried everything under it. In the grid they
   are open cards instead and the Simplified toggle is what keeps them short —
   six boxes you can read across beats six rows you have to click. */
function kitEntry(label, s, simple = S.kitSimple){
  if(!s) return "";
  return `<article class="skill">
    <header class="skill-h"><span class="skill-k">${esc(label)}</span><b>${esc(s.name)}</b></header>
    <div class="skill-t">${simple ? kitGist(s.blocks) : kitBody(s.blocks)}</div>
  </article>`;
}

/* The Resonance Chain stays shut. Six nodes are six duplicates away for almost
   everyone reading, so it is reference rather than the record — and native
   disclosure survives a re-render, takes the keyboard, and is findable by the
   browser's own in-page search for nothing. */
function chainEntry(label, s, simple = S.kitSimple){
  if(!s) return "";
  return `<details class="skill">
    <summary><span class="skill-k">${esc(label)}</span><b>${esc(s.name)}</b></summary>
    <div class="skill-t">${simple ? kitGist(s.blocks) : kitBody(s.blocks)}</div>
  </details>`;
}

/* Game order, not file order: this is the sequence the in-game Resonator
   screen lists them in, and the order they come up in a rotation. */
const KIT_ORDER = [
  ["basic", "Basic Attack"], ["skill", "Resonance Skill"],
  ["forte", "Forte Circuit"], ["liberation", "Resonance Liberation"],
  ["intro", "Intro Skill"], ["outro", "Outro Skill"]
];

function kitPanel(kit){
  if(!kit) return "";
  const simple = S.kitSimple;
  const skills = KIT_ORDER.map(([k, label]) => kitEntry(label, kit.skills?.[k], simple)).join("");
  /* Prydwen occasionally labels two blocks with the same slot name — a second
     Forte Circuit where the Intro Skill should be. The scraper keeps both
     rather than letting one overwrite the other, and the spare lands here. */
  const extra = (kit.extra || []).map(e => kitEntry(e.kind, e, simple)).join("");
  /* Their own section rather than cards seven and eight of the grid: passives
     are a different kind of thing to the six slots you press, and folded in
     among them they read as skills you have somehow never found the button for. */
  const inherent = (kit.inherent || [])
    .map(s => kitEntry("Inherent Skill", s, simple)).join("");
  const chain = (kit.chain || [])
    .map(n => chainEntry(`S${n.n}`, {name:n.name, blocks:n.blocks}, simple)).join("");

  return `
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
  const live = DATA.versions?.current;
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
function recordCard(r){
  const b = bannerFor(r.name) || {};
  return `<article class="rec" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}"${attrStyle(r.attribute)}>
    ${artPanel({name:r.name, ...b}, debutBadge(r))}
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
function recordTable(title, rows, total, {right = "", under = "", foot = ""} = {}){
  return `<div class="panel">
    <div class="panel-h">
      <h2>${title}</h2>
      <span class="sub">${plural(rows.length, "record")}${rows.length === total ? "" : ` of ${total}`} · newest debut first</span>
      ${right ? `<div class="right chips">${right}</div>` : ""}
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
  const elems = [...new Set(all.map(r => r.attribute).filter(Boolean))];
  let list = all;
  if(S.elem !== "all") list = list.filter(r => r.attribute === S.elem);
  if(S.weapon !== "all") list = list.filter(r => r.weapon === S.weapon);

  /* No count on the All chip any more. It carried the whole roster, and now it
     sits in the 5★ table's header next to that table's own count — "All 60"
     over "48 records" reads as an arithmetic error. Each table counts itself. */
  const filters = chips("elem",
    [["all", "All"]].concat(elems.map(e => [e, e])),
    S.elem);
  const rows  = rarity => list.filter(r => String(r.rarity) === rarity);
  const total = rarity => all.filter(r => String(r.rarity) === rarity).length;

  /* The chips and the selects head the 5★ table rather than getting a strip of
     their own — they are the top of the view either way, and a filter bar in an
     empty panel above two tables is a third panel to explain. */
  $("#p-resonators").innerHTML = `<div class="stack">
    ${recordTable("5★ Resonators", rows("5"), total("5"), {
      right: filters,
      under: quickFilters(true),
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

/* Which holes in a passive actually scale, and where each one lands in the
   ascension table. The table drops the holes the source shipped no values for,
   so the two cannot share an index — and a grid of percentages you can't map
   back onto the sentence above it is a grid of unlabelled percentages. */
const scaleRows = w => (w.ranks || []).filter(Boolean);
const hasScale = w => scaleRows(w).some(r => new Set(r).size > 1);
function rankKeys(w){
  const out = {};
  let i = 0;
  (w.ranks || []).forEach((vals, n) => { if(vals) out[n] = ++i; });
  return out;
}

/* The passive, resolved to one ascension. The scaling values are the reason
   the sentence is worth reading twice, so they are set apart rather than run
   into the prose — move the slider and what changes is visible without
   re-reading the paragraph to find it. `keyed` numbers them to match the
   ascension table, and is only for the record, where that table exists. */
function effectHtml(w, rank, keyed){
  const i = Math.min(5, Math.max(1, rank || 1)) - 1;
  const keys = keyed ? rankKeys(w) : null;
  return esc(w.effect || "").replace(/\{(\d)\}/g, (_, n) => {
    const vals = w.ranks?.[Number(n)];
    /* A hole the source shipped no values for. Say so rather than print a
       number from the wrong slot — the whole desk runs on that rule. */
    if(!vals) return `<b class="wval na">?</b>`;
    return `<b class="wval">${esc(vals[i])}${keys ? `<sup>${keys[Number(n)]}</sup>` : ""}</b>`;
  }) || `<span class="wnone">No passive.</span>`;
}

/* 1–5, and it redraws nothing. A full re-render would rebuild the input the
   thumb is currently being dragged on, which ends the drag — so the numbers are
   repainted in place and the slider is left standing. Every copy of the control
   is updated, not just the one that moved: the view has one and an open record
   has another, and two sliders showing different ranks for the same weapon is
   worse than having only one of them. */
function paintRank(){
  document.querySelectorAll("[data-eff]").forEach(el => {
    const w = weaponFor(el.dataset.eff);
    if(w) el.innerHTML = effectHtml(w, S.rank, "effKeyed" in el.dataset);
  });
  document.querySelectorAll("[data-ranklabel]").forEach(el => el.textContent = `S${S.rank}`);
  document.querySelectorAll("[data-rank]").forEach(el => {
    el.value = S.rank;
    el.setAttribute("aria-valuetext", `Ascension ${S.rank} of 5`);
  });
  document.querySelectorAll("[data-rankcol]").forEach(el =>
    el.classList.toggle("on", Number(el.dataset.rankcol) === S.rank));
}

function ascendBar(){
  return `<div class="ascend">
    <label class="ascend-c">
      <span class="label">Ascension</span>
      <input type="range" min="1" max="5" step="1" value="${S.rank}" data-rank
             aria-label="Weapon ascension" aria-valuetext="Ascension ${S.rank} of 5">
      <output class="ascend-v" data-ranklabel>S${S.rank}</output>
    </label>
    <span class="ascend-note">Scales every passive below. Stats are level 90 and do not move with it.</span>
  </div>`;
}

function weaponRow(w){
  const holder = sigHolderFor(w.name);
  /* Where it comes from, and whose it is. Both are one line because neither is
     worth a column: most weapons have one or the other, few have both. */
  const sub = [w.source, holder ? `${holder}'s signature` : ""].filter(Boolean).join(" · ");
  return `<div class="wrow" role="button" tabindex="0" data-act="weapon" data-id="${esc(w.name)}">
    <span class="wr-art">${w.icon
      ? `<img src="${esc(w.icon)}" alt="" loading="lazy" decoding="async">`
      : icon("i-weapon", 18)}</span>
    <span class="wr-n"><b>${esc(w.name)}</b>${sub ? `<i>${esc(sub)}</i>` : ""}</span>
    <span class="wr-c">${esc(w.type)}</span>
    <span class="wr-atk">${w.atk90 || "—"}</span>
    <span class="wr-sub"><b>${w.statValue90 ? esc(w.statValue90) + "%" : "—"}</b><i>${esc(w.stat)}</i></span>
    <span class="wr-eff" data-eff="${esc(w.name)}">${effectHtml(w, S.rank)}</span>
  </div>`;
}

/* Column labels, and the only place the rank is named beside the passive. With
   three tables down the page the slider is off-screen by the time you reach the
   3★ list, and a column of numbers whose ascension you have to scroll up to
   check is a column of numbers you cannot trust. */
function weaponHead(){
  return `<div class="wrow whead" aria-hidden="true">
    <span></span><span>Weapon</span><span>Class</span>
    <span>ATK<i>Lv 90</i></span><span>Sub-stat<i>Lv 90</i></span>
    <span>Passive<i>at <b data-ranklabel>S${S.rank}</b></i></span>
  </div>`;
}

function weaponTable(title, rows, total, {right = "", under = "", foot = ""} = {}){
  const r = String(title).charAt(0);
  return `<div class="panel wpanel r-${r}">
    <div class="panel-h">
      <h2>${title}</h2>
      <span class="sub">${plural(rows.length, "weapon")}${rows.length === total ? "" : ` of ${total}`} · by class</span>
      ${right ? `<div class="right chips">${right}</div>` : ""}
    </div>
    ${under}
    <div class="panel-b flush">
      ${rows.length ? `<div class="wtable">${weaponHead()}${rows.map(weaponRow).join("")}</div>`
        : `<div class="empty">${emptyWhy("weapon")}</div>`}
    </div>
    ${foot ? `<div class="panel-f"><span class="tier-note">${foot}</span></div>` : ""}
  </div>`;
}

/* Class first, then name. With no filter on, that groups the five classes into
   five runs you can scan past — where a flat alphabetical list interleaves them
   and makes you read the class column on every row to find the one you use. */
const byClassThenName = (a, b) =>
  (WTYPES.indexOf(a.type) - WTYPES.indexOf(b.type)) || a.name.localeCompare(b.name);

function renderWeapons(){
  const all = [...weapons()].sort(byClassThenName);
  let list = all;
  if(S.wtype !== "all") list = list.filter(w => w.type === S.wtype);
  if(S.wstat !== "all") list = list.filter(w => w.stat === S.wstat);

  /* Only the classes the data actually holds, in the game's own order rather
     than alphabetically — a class with nothing filed under it would be a chip
     that can only ever empty the page. */
  const present = WTYPES.filter(t => all.some(w => w.type === t));
  const filters = chips("wtype", [["all", "All"]].concat(present.map(t => [t, t])), S.wtype);

  const rows  = rarity => list.filter(w => String(w.rarity) === rarity);
  const total = rarity => all.filter(w => String(w.rarity) === rarity).length;

  $("#p-weapons").innerHTML = `<div class="stack">
    ${weaponTable("5★ Weapons", rows("5"), total("5"), {
      right: filters,
      under: `${ascendBar()}${quickFilters(true)}`,
      foot: "Stats are level 90. Ascension moves the passive only — the numbers in bold are what it changes."
    })}
    ${weaponTable("4★ Weapons", rows("4"), total("4"))}
    ${weaponTable("3★ Weapons", rows("3"), total("3"))}
  </div>`;
}

/* ── unbuilt views ───────────────────────────────────────────────────
   Events is in the navigation before it is in the data. That is deliberate —
   the shape of the desk is being settled first — but a nav item that opens onto
   nothing is a broken link with extra steps, so it states what it is going to
   hold. The copy is the specification: when the view is built, this entry comes
   out and the panel below it goes in, which is exactly what Weapons just did. */
const WIP = {
  events: {
    title:"Event calendar",
    line:"Limited events in the live patch: what they pay out, and how long is left to claim it.",
    plan:[
      "Running and announced events with their open and close times, in your timezone",
      "Astrite, Sequence and weapon rewards totalled per event",
      "Redemption codes, with the ones that have already expired struck out",
      "A warning on anything closing inside a week — the same countdown the timeline runs"
    ]
  }
};

function renderWIP(id){
  const v = VIEWS.find(x => x.id === id);
  const w = WIP[id];
  $(`#p-${id}`).innerHTML = `<div class="stack">
    <div class="panel">
      <div class="panel-h">
        <h2>${esc(w.title)}</h2><span class="sub">Not built yet</span>
      </div>
      <div class="panel-b">
        <div class="wip">
          <span class="wip-mark">${icon(v.icon, 30)}</span>
          <h3>Work in progress</h3>
          <p>${esc(w.line)}</p>
          <ul class="wip-plan">${w.plan.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
          <button class="btn" data-act="view" data-id="timeline">Back to the timeline ${icon("i-arrow", 12)}</button>
        </div>
      </div>
      <div class="panel-f">
        <span class="tier-note">This page is a placeholder. Nothing here is sourced yet, because there is nothing here yet.</span>
      </div>
    </div>
  </div>`;
}

/* ── aside ───────────────────────────────────────────────────────── */
function renderAside(){
  const feed = DATA.feed || {};
  const all = signals();
  const next = nextVersion();
  const days = next?.start ? daysTo(next.start) : null;
  const counts = tierCounts();

  /* Featured = the next new resonator on the schedule, else the newest record. */
  const featName = (next?.phases || []).flatMap(p => (p.banners || []).filter(b => b.new))[0]?.name;
  const feat = featName ? resonatorFor(featName) : resonators()[0];

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
  const featured = feat ? `<div class="panel feat"${attrStyle(feat.attribute)}>
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
      <button class="btn" data-act="resonator" data-id="${esc(feat.name)}">View profile ${icon("i-arrow", 12)}</button>
    </div>
  </div>` : "";

  /* A Source health panel stood here, listing every fetcher by name with a
     status dot. It is build diagnostics — useful to whoever runs the workflow,
     which is one person, and meaningless to everyone reading the desk. The run
     summary in the Live Signals header is what a reader actually needs. */

  $("#aside").innerHTML = quickFilters(false) + glance + featured;
}

/* ── drawer ──────────────────────────────────────────────────────── */
let lastFocus = null;

/* `id` names what the drawer is currently showing. Only the resonator record
   needs it — it is the one panel that finishes drawing after an await, and it
   has to know whether the reader has moved on before answering. */
function openDrawer(kind, html, id = null){
  S.drawer = id;
  $("#drawer-kind").textContent = kind;
  $("#drawer-body").innerHTML = html;
  const d = $("#drawer");
  if(d.hidden){
    lastFocus = document.activeElement;
    d.hidden = false;
    document.body.style.overflow = "hidden";
  }
  d.querySelector(".drawer-panel").scrollTop = 0;
  d.querySelector(".drawer-panel").focus();
}
function closeDrawer(){
  const d = $("#drawer");
  if(d.hidden) return;
  S.drawer = null;
  d.hidden = true;
  document.body.style.overflow = "";
  lastFocus?.focus?.();
}

function sourceList(sources){
  if(!sources?.length) return "";
  return `<div class="dsec"><span class="label">Sources</span>
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
      <b>${esc(wname)}</b>
    </span>
    ${w?.rarity ? `<span class="wcard-r">${esc(w.rarity)}★</span>` : ""}
    ${live ? `<span class="arrow">${icon("i-arrow", 13)}</span>` : ""}`;
  return live
    ? `<button class="wcard" data-act="weapon" data-id="${esc(wname)}">${inner}</button>`
    : `<div class="wcard is-flat">${inner}</div>`;
}

function drawerResonator(name){
  const r = resonatorFor(name);
  const b = bannerFor(name) || {};
  if(!r.name && !b.name) return;
  const f = figure({name, ...b});
  const kitTier = r.confidence?.kit;
  const sig = r.signature || b.signature;
  /* Debut and reruns are written out in full here, not just hung off the
     corner badge's tooltip — this is the record, and a patch history you can
     only reach by holding a mouse still is not in the record. The signature
     weapon is the one row that left: it is the card above this list now. */
  const gear = [["Convene", r.convene || b.convene],
                ["Accessory", r.accessory], ["Weapon", r.weapon || b.weapon], ["Role", r.role || b.role],
                ["Region", r.region], ["Debut", r.version || b.version],
                /* "None yet" only once they have actually had a banner to not
                   come back from — on an unreleased Resonator it reads as a
                   fact about their history rather than the absence of one. */
                ["Reruns", r.standard ? "Standard pool — always available"
                  : r.reruns?.length ? r.reruns.join(", ")
                  : hasDebuted(r) ? "None yet" : ""],
                ["Released", r.released ? fmtDate(r.released) : ""]].filter(([, v]) => v);

  openDrawer("Resonator record", `
    <div class="dart"${attrStyle(r.attribute || b.attribute)}>
      ${artPanel({name, ...b}, `${r.rarity || b.rarity ? `<span class="rank">${esc(r.rarity || b.rarity)}★</span>` : ""}
        ${debutBadge(r)}
        <span class="attrline">${r.attribute || b.attribute ? `<b>${esc(r.attribute || b.attribute)}</b>` : ""}</span>`)}
      ${creditLine({name, ...b})}
    </div>
    <div class="drawer-b"${attrStyle(r.attribute || b.attribute)}>
      <!-- Who they are on the left, what they are on the right. The record used
           to run the full width under the summary, which put eight two-word
           rows across a thousand pixels with the label at one edge and the
           value at the other. Side by side, both columns are a readable width
           and the panel opens on everything the card could not hold. -->
      <div class="rlay">
        <div class="rlay-main">
          <h2>${esc(name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h2>
          ${f.epithet ? `<div class="cepithet" style="margin:-4px 0 12px">${esc(f.epithet)}</div>` : ""}
          <div class="meta">
            ${r.confidence?.identity ? tierBadge(r.confidence.identity, r.confidence.identity === "official") : ""}
            ${r.status ? `<span class="pill">${esc(r.status)}</span>` : ""}
            ${b.phase ? `<span class="pill">Phase ${esc(b.phase)}</span>` : ""}
          </div>
          ${r.summary ? `<p>${esc(r.summary)}</p>` : `<p>No written record yet — identity only.</p>`}
          ${r.kit?.length ? `<div class="dsec">
            <span class="label">Kit notes — ${TIER_MEANS[kitTier] || "Unverified"}</span>
            <div style="margin-bottom:12px">${tierBadge(kitTier, kitTier === "official")}</div>
            <ul>${r.kit.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
            <p style="font-size:12px;color:var(--fg-3);margin-top:14px">Pre-balance. Multipliers and mechanics
            routinely shift between beta phases.</p>
          </div>` : ""}
        </div>
        <div class="rlay-side">
          ${sigWeaponCard(sig)}
          ${gear.length ? `<div class="dpanel"><span class="label">Record</span>
            <div class="dgear">${gear.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>` : ""}
        </div>
      </div>
      <div id="kitwrap"><div class="dsec"><span class="label">Skills</span>
        <p style="margin:0;color:var(--fg-3)">Loading kit…</p></div></div>
      ${sourceList(r.sources)}
    </div>`, `resonator:${name}`);

  /* The record is on screen already; this drops the kit in underneath when the
     file lands. Guarded on the drawer still showing this Resonator, because a
     megabyte over a slow connection is long enough to open a record, read the
     summary and click through to somebody else before it arrives. */
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
function drawerVersion(id){
  const v = versions().find(x => x.id === id);
  if(!v) return;
  const role = v.status === "live" ? "live" : v.status === "announced" ? "next" : "future";
  const news = newsFor(v.id);
  const phases = (v.phases || []).map(p => `
    <div class="dsec">
      <span class="label">Phase ${p.n} — ${[p.start ? fmtDate(p.start) : "", p.end ? fmtDate(p.end) : ""].filter(Boolean).join(" → ")}
        ${p.estimated_start || p.estimated_end ? " (est)" : ""}</span>
      <div class="bstrip">${(p.banners || []).map(b => thumb({...b, phase:p.n, keyVisual:v.keyVisual})).join("")}</div>
    </div>`).join("");

  openDrawer("Version", `<div class="drawer-b">
    <div class="meta">
      <span class="pill ${role === "live" ? "live" : role === "next" ? "next" : "future"}">${esc(v.status)}</span>
      ${v.region ? `<span class="pill">${esc(v.region)}</span>` : ""}
    </div>
    <h2>${esc(v.id)}${v.title ? ` — ${esc(v.title)}` : ""}</h2>
    <div class="dgear" style="margin-bottom:6px">
      ${v.start ? `<div><span>Launch</span><b>${fmtDate(v.start)}</b></div>` : ""}
      ${v.livestream ? `<div><span>Preview stream</span><b>${fmtDate(v.livestream)}</b></div>` : ""}
      ${versionEnd(v) ? `<div><span>Ends</span><b>${versionEnd(v)}</b></div>` : ""}
    </div>
    ${v.notes ? `<div class="vnote" style="margin-top:16px">${esc(v.notes)}</div>` : ""}
    ${phases}
    ${news.length ? `<div class="dsec"><span class="label">Intel on this version — ${news.length}</span>
      <div style="display:grid;gap:8px">${news.map(e => `
        <span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
          <i class="dot t-${esc(e.confidence)}" style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></i>
          ${esc(e.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div></div>` : ""}
  </div>`);
}

/* Every value a passive takes, all five at once. The slider answers "what does
   it do at mine"; this answers "is it worth getting to four", which is the
   question the slider cannot show you because it only ever displays one column.
   The current ascension's column is marked and moves with the slider — see
   paintRank, which owns [data-rankcol]. */
function rankScale(w){
  if(!hasScale(w)) return "";
  const rows = scaleRows(w);
  return `<div class="dsec"><span class="label">Ascension scaling</span>
    <div class="wscale">
      <div class="wscale-r wscale-h">
        <span></span>${[1,2,3,4,5].map(n =>
          `<span data-rankcol="${n}" class="${n === S.rank ? "on" : ""}">S${n}</span>`).join("")}
      </div>
      ${rows.map((vals, i) => `<div class="wscale-r">
        <span class="wscale-k">${i + 1}</span>
        ${vals.map((v, n) => `<span data-rankcol="${n + 1}" class="${n + 1 === S.rank ? "on" : ""}">${esc(v)}</span>`).join("")}
      </div>`).join("")}
    </div>
  </div>`;
}

/* A weapon record. It used to be assembled entirely out of banner rows — the
   desk held no weapon data, so a weapon was defined by whose convene it ran
   beside, and one that had never had a convene had no record at all. It has
   stats and a passive now, so the two halves are both here: what the thing does
   comes from weapons.json, and where you could get it still comes from the
   timeline. Either half can be missing. */
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

  openDrawer("Weapon record", `<div class="drawer-b"${attrStyle(runs[0]?.attribute || holder.attribute)}>
    <div class="meta">
      <span class="pill">${esc(w?.type || holder.weapon || runs[0]?.weapon || "Weapon")}</span>
      ${w?.rarity ? `<span class="pill ver">${esc(w.rarity)}★</span>` : ""}
      ${w?.source ? `<span class="pill">${esc(w.source)}</span>` : ""}
      ${runs.some(r => r.status === "live") ? `<span class="pill live">Running now</span>` : ""}
    </div>
    ${w?.icon ? `<div class="wbig"><img src="${esc(w.icon)}" alt="${esc(name)}" decoding="async"></div>` : ""}
    <h2>${esc(name)}</h2>
    ${holderName ? `<p>Signature weapon for <b>${esc(holderName)}</b>. Kuro runs the weapon convene
      alongside the character banner, so it is available for the same window.</p>` : ""}

    ${w ? `<div class="dsec"><span class="label">Stats at level 90</span>
      <div class="wstats">
        <div><span class="k">Base ATK</span><b>${w.atk90 || "—"}</b></div>
        <div><span class="k">${esc(w.stat || "Sub-stat")}</span><b>${w.statValue90 ? esc(w.statValue90) + "%" : "—"}</b></div>
      </div></div>` : ""}

    ${w ? `<div class="dsec"><span class="label">Passive</span>
      ${ascendBar()}
      <p class="weff" data-eff="${esc(w.name)}"${hasScale(w) ? " data-eff-keyed" : ""}
         style="margin:12px 0 0">${effectHtml(w, S.rank, hasScale(w))}</p>
    </div>${rankScale(w)}` : ""}

    ${runs.length ? `<div class="dsec"><span class="label">Runs alongside</span>
      <div style="display:grid;gap:8px">${runs.map(r => `
        <span class="dsrc" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}">
          <span class="lang">${esc(r.version)}</span>${esc(r.name)}${r.phase ? ` — phase ${esc(r.phase)}` : ""}
          ${r.new ? "· debut" : "· rerun"}
          <span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div>
    </div>` : ""}

    ${mentions.length ? `<div class="dsec"><span class="label">Intel mentioning it — ${mentions.length}</span>
      <div style="display:grid;gap:8px">${mentions.map(e => `
        <span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
          <i class="dot t-${esc(e.confidence)}" style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></i>
          ${esc(e.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div></div>`
      : `<div class="dsec"><span class="label">Intel mentioning it</span>
         <p style="margin:0;color:var(--fg-3)">Nothing written up yet.</p></div>`}
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
          <div style="font-size:12.5px;color:var(--fg-2);line-height:1.6">${esc(tiers[t] || TIER_MEANS[t])}</div>
        </div>`).join("")}</div>
    </div>
    <div class="dsec"><span class="label">Automated sources — every 6 hours</span>
      <div style="display:grid;gap:8px">${srcs.map(s => `
        <span class="dsrc"><i class="dot" style="width:6px;height:6px;border-radius:50%;flex:none;background:${
          s.status === "ok" ? "var(--t-official)" : s.status === "skipped" ? "var(--amber)" : "var(--t-rumour)"}"></i>
          ${esc(s.name)}<span class="arrow" style="font-family:var(--mono);font-size:10px">${esc(s.status)} · ${s.count}</span></span>`).join("")
        || `<span class="dsrc">No source report yet.</span>`}</div>
    </div>
    <div class="dsec"><span class="label">Art</span>
      <p style="margin:0">Official key art is resolved from Kuro's own Profile Reveal posts and hotlinked from
      their CDN, credited back to the source post. Pre-release art from beta files is labelled as such on the
      card. All of it is © Kuro Games and used unofficially.</p>
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
    group:"Versions", label:`${v.id}${v.title ? " — " + v.title : ""}`, hint:v.status, act:["version", v.id], tier:null
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
  events: () => renderWIP("events"),
  intel: renderIntel,
  signals: renderSignals
};

function setView(id, focus){
  if(!RENDER[id]) id = "timeline";
  S.view = id;
  VIEWS.forEach(v => {
    document.getElementById(`p-${v.id}`).hidden = v.id !== id;
    const tab = document.getElementById(`tab-${v.id}`);
    if(tab){ tab.setAttribute("aria-selected", v.id === id); tab.tabIndex = v.id === id ? 0 : -1; }
  });
  document.querySelectorAll("[data-act='view']").forEach(b =>
    b.setAttribute("aria-current", b.dataset.id === id));
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
  if(kind === "intel") drawerIntel(id);
  else if(kind === "resonator") drawerResonator(id);
  else if(kind === "version") drawerVersion(id);
  else if(kind === "weapon") drawerWeapon(id);
  else if(kind === "open" && id === "methodology") drawerMethodology();
}

/* ── events ──────────────────────────────────────────────────────── */
function bind(){
  document.addEventListener("click", e => {
    if(e.target.closest("[data-close]")){ closeDrawer(); closeCmd(); return; }

    const cmd = e.target.closest(".cmd-item");
    if(cmd){ runCmdItem(Number(cmd.dataset.i)); return; }

    const el = e.target.closest("[data-act]");
    if(!el) return;
    const {act, id, scope} = el.dataset;

    if(act === "search"){ openCmd(); }
    else if(act === "view"){ setView(id); }
    else if(act === "tier"){ S.tier = id; S.ver = S.cat = "all"; setView("intel"); }
    else if(act === "filter"){ S[scope] = id; S.sigLimit = 60; draw(S.view); }
    else if(act === "reset"){ VIEW_FILTERS[S.view].forEach(k => S[k] = "all"); S.sigLimit = 60; draw(S.view); }
    /* A rail shortcut is a view plus a filter combination — set the filters
       before switching, or setView draws the old ones first and the list
       visibly re-filters a frame later. */
    else if(act === "jump"){
      try{ Object.assign(S, JSON.parse(el.dataset.set || "{}")); }catch{ /* ignore a malformed shortcut */ }
      S.sigLimit = 60;
      setView(id);
    }
    else if(act === "tlmode"){ S.tlMode = id; draw("timeline"); }
    else if(act === "morelogs"){ S.sigLimit += 60; draw("signals"); }
    else if(act === "noop"){ /* decorative */ }
    else dispatch(act, id);
  });

  /* Quick-filter selects. One listener for both copies of the control — the
     aside's and the inline one — since they carry the same data-sel. */
  document.addEventListener("change", e => {
    const sel = e.target.closest("[data-sel]");
    if(!sel) return;
    const key = sel.dataset.sel;
    const inAside = !!sel.closest(".aside");
    S[key] = sel.value;
    S.sigLimit = 60;
    draw(S.view);
    /* The draw replaces the select that fired this, so put the caret back on
       its replacement — otherwise a keyboard user is dumped at the top of the
       document every time they narrow the list. */
    document.querySelector(`${inAside ? ".aside " : ".qf-inline "}[data-sel="${key}"]`)?.focus();
  });

  /* The ascension slider. `input` rather than `change` so the passives track a
     drag instead of jumping when the thumb is let go — and it repaints rather
     than redraws, because redrawing would replace the input mid-drag. */
  document.addEventListener("input", e => {
    const r = e.target.closest("[data-rank]");
    if(!r) return;
    S.rank = Math.min(5, Math.max(1, Number(r.value) || 1));
    paintRank();
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
    /* Arrow keys walk the tablist, as a tablist should. The list runs down the
       rail now rather than across the stage, so up/down are the axis that
       matches what you see — left/right stay bound because they were the keys
       for two years and cost nothing to keep. */
    if(t?.getAttribute?.("role") === "tab"){
      const step = /^Arrow(Right|Down)$/.test(e.key) ? 1 : /^Arrow(Left|Up)$/.test(e.key) ? -1 : 0;
      const i = VIEWS.findIndex(v => v.id === S.view);
      if(step){ e.preventDefault(); setView(VIEWS[(i + step + VIEWS.length) % VIEWS.length].id, true); }
      if(e.key === "Home"){ e.preventDefault(); setView(VIEWS[0].id, true); }
      if(e.key === "End"){ e.preventDefault(); setView(VIEWS[VIEWS.length-1].id, true); }
    }
  });

  $("#cmd-input").addEventListener("input", e => runCmd(e.target.value));
  addEventListener("hashchange", () => setView(location.hash.slice(1) || "timeline"));
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
  const names = ["versions","news","resonators","weapons","feed","art","portraits","translations"];
  const loaded = await Promise.all(names.map(load));
  DATA = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));

  renderRail();
  renderHud();
  renderLegend();
  bind();
  setView(location.hash.slice(1) || "timeline");
  /* Last, and after the view is up: it is scenery, and it competes with the
     card art for the same connection. */
  renderBackdrop();
})();

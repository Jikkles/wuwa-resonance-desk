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
  feed:       {fetched:"", sources:[], errors:[], items:[]},
  art:        {art:{}},
  portraits:  {characters:{}, weapons:{}},
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

const VIEWS = [
  {id:"timeline",   label:"Timeline",     icon:"i-timeline"},
  {id:"intel",      label:"Intel",        icon:"i-intel"},
  {id:"signals",    label:"Live Signals", icon:"i-signals", warn:"Unverified"},
  {id:"resonators", label:"Resonators",   icon:"i-res"}
];

let DATA = {};
/* Primary axis per view lives in chips at the top of the panel; the secondary
   axes (ver/cat/weapon/src) are the quick-filter selects. All of them are one
   flat bag so a filter control never has to know which view it is in. */
const S = {
  view:"timeline", sigLimit:60, drawer:null,
  when:"all", tlMode:"cards",      // timeline
  tier:"all", ver:"all", cat:"all", // intel
  kind:"all", src:"all",           // signals
  elem:"all", weapon:"all"         // resonators
};
/* Which of those a view actually reads — drives Reset, and stops a stale
   element filter from silently narrowing a list you have navigated away from. */
const VIEW_FILTERS = {
  timeline:["when"], intel:["tier","ver","cat"],
  signals:["kind","src"], resonators:["elem","weapon"]
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
   instead of a face. portraits.json holds the game's own UI assets with their
   alpha intact, so a tile shows the character and nothing else: no plate, no
   second background inside the card's. See scripts/fetch-portraits.mjs. */
function portraitFor(name){ return (DATA.portraits?.characters || {})[name] || null; }
function weaponArtFor(name){ return (DATA.portraits?.weapons || {})[name] || null; }
const PORTRAIT_CREDIT = "Character art © Kuro Games · icon via prydwen.gg";

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
  for(const v of versions())
    for(const p of v.phases || [])
      for(const b of p.banners || [])
        if(signatureFor(b).toLowerCase() === k)
          out.push({...b, phase:p.n, version:v.id, start:p.start, end:p.end, status:v.status});
  return out;
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
  return `<div class="ctiers">
    ${id ? `<div><span class="label">Identity</span>${tierBadge(id, id === "official")}</div>` : ""}
    <div><span class="label">Kit</span>${r.kit?.length
      ? tierBadge(kit, kit === "official")
      : `<span class="pill">No kit notes</span>`}</div>
  </div>`;
}

/* Resolve the best available image for a banner row or resonator.
   Precedence: hand-set image → reveal key art → crop of the patch key visual →
   typographic plate. The crop drops out on its own once a reveal card exists. */
function figure(b){
  const r = resonatorFor(b.name);
  const art = artFor(b.name);
  const port = portraitFor(b.name);
  const own = b.image || r.image;
  const shared = !own && !art && b.keyVisual && b.keyVisualFocus ? b.keyVisual : null;
  /* The cut-out card is last, not first: it is 374x512 of UI asset and it will
     stand in for anyone, which is exactly why it must not displace a real key
     visual. It fills the holes — a character Kuro has teased but not revealed
     — where the alternative was a letter on a gradient. */
  const image = own || art?.url || shared?.url || port?.card;
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
    credit: cutout ? (b.imageCredit || r.imageCredit || (port && image === port.card ? PORTRAIT_CREDIT : null)) : null,
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
  /* The unverified flag rides the nav item itself, not just the tab strip —
     it should be readable before you click into the view, not after. */
  $("#rail-nav").innerHTML = VIEWS.map(v => `
    <button class="navlink" data-act="view" data-id="${v.id}" aria-current="${S.view === v.id}">
      ${icon(v.icon)}<span>${v.label}</span>
      ${v.warn ? `<span class="warn">${v.warn}</span>` : railCount(v.id)}
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
      ${icon(v.icon, 17)}<span>${v.label === "Live Signals" ? "Signals" : v.label}</span>
    </button>`).join("");
}
function railCount(id){
  const n = id === "intel" ? entries().length
          : id === "signals" ? signals().length
          : id === "resonators" ? resonators().length
          : versions().length;
  return `<span class="n">${n}</span>`;
}

/* Static once the data is in — the legend can't change without a reload. */
function renderLegend(){
  $("#foot-legend").innerHTML = TIERS.map(t =>
    `<span class="t-${t}" title="${esc(TIER_MEANS[t])}"><i class="dot"></i>${TIER_LABEL[t]}</span>`
  ).join("");
}

function renderTabs(){
  $("#tabs").innerHTML = VIEWS.map(v => `
    <button role="tab" id="tab-${v.id}" data-act="view" data-id="${v.id}"
            aria-selected="${S.view === v.id}" aria-controls="p-${v.id}"
            tabindex="${S.view === v.id ? 0 : -1}">
      ${icon(v.icon, 17)}${v.label}${v.warn ? `<span class="warn">${v.warn}</span>` : ""}
    </button>`).join("");
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
  return allPhases(v).flatMap(p => p.banners).filter(b => b.new).map(b => {
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
                 src:"source", elem:"element", weapon:"weapon", when:"window"};
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
      <div class="srcstrip">${(feed.sources || []).map(s =>
        `<span class="srcpill ${esc(s.status)}" title="${esc(s.error || s.status)}"><i class="dot"></i>${esc(s.name)} ${s.count}</span>`
      ).join("") || `<span class="srcpill">No source report</span>`}</div>
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

function recordCard(r){
  const b = bannerFor(r.name) || {};
  const seen = lastIntelFor(r.name);
  return `<article class="rec" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}"${attrStyle(r.attribute)}>
    ${artPanel({name:r.name, ...b}, `${r.version ? `<span class="phase">${esc(r.version)}</span>` : ""}`)}
    <div class="rec-b">
      <h3>${esc(r.name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h3>
      <div class="rec-attrs">
        ${stars(r.rarity)}
        ${r.attribute ? `<b>${esc(r.attribute)}</b>` : ""}
        ${r.weapon ? `<span>${esc(r.weapon)}</span>` : ""}
      </div>
      ${r.summary ? `<p class="rec-sum">${esc(r.summary)}</p>` : ""}
      ${r.role ? `<div class="rec-role">${esc(r.role)}</div>` : ""}
      <div class="rec-foot">${confidenceRows(r)}</div>
      ${r.kit?.length || seen ? `<div class="rec-meta">
        ${r.kit?.length ? `<span>${plural(r.kit.length, "kit note")}</span>` : ""}
        ${seen ? `<span>Last intel ${fmtShort(seen)}</span>` : ""}
      </div>` : ""}
      <div class="rec-more">View profile ${icon("i-arrow", 12)}</div>
    </div>
  </article>`;
}

function renderResonators(){
  const all = resonators();
  const elems = [...new Set(all.map(r => r.attribute).filter(Boolean))];
  let list = all;
  if(S.elem === "5" || S.elem === "4") list = list.filter(r => String(r.rarity) === S.elem);
  else if(S.elem !== "all") list = list.filter(r => r.attribute === S.elem);
  if(S.weapon !== "all") list = list.filter(r => r.weapon === S.weapon);

  const filters = chips("elem",
    [["all", "All", all.length], ["5", "5★"], ["4", "4★"]].concat(elems.map(e => [e, e])),
    S.elem);

  $("#p-resonators").innerHTML = `<div class="stack">
    <div class="panel">
      <div class="panel-h">
        <h2>Resonator database</h2><span class="sub">${plural(all.length, "record")} · kit confidence per entry</span>
        <div class="right chips">${filters}</div>
      </div>
      ${quickFilters(true)}
      <div class="panel-b">
        ${list.length ? `<div class="rgrid">${list.map(recordCard).join("")}</div>`
          : `<div class="empty">${emptyWhy("record")}</div>`}
      </div>
      <div class="panel-f"><span class="tier-note">Kit detail on unreleased resonators is pre-balance — multipliers routinely shift between beta phases.</span></div>
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

  const health = `<div class="panel">
    <div class="mini-h"><h3>Source health</h3></div>
    <div class="srcstrip">${(feed.sources || []).map(s =>
      `<span class="srcpill ${esc(s.status)}" title="${esc(s.error || s.status)}"><i class="dot"></i>${esc(s.name)}</span>`
    ).join("") || `<span class="srcpill">No report</span>`}</div>
  </div>`;

  $("#aside").innerHTML = quickFilters(false) + glance + featured + health;
}

/* ── drawer ──────────────────────────────────────────────────────── */
let lastFocus = null;

function openDrawer(kind, html){
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

function drawerResonator(name){
  const r = resonatorFor(name);
  const b = bannerFor(name) || {};
  if(!r.name && !b.name) return;
  const f = figure({name, ...b});
  const kitTier = r.confidence?.kit;
  const gear = [["Signature weapon", r.signature || b.signature], ["Convene", r.convene || b.convene],
                ["Accessory", r.accessory], ["Weapon", r.weapon || b.weapon], ["Role", r.role || b.role],
                ["Region", r.region], ["Debut", r.version || b.version]].filter(([, v]) => v);

  openDrawer("Resonator record", `
    <div class="dart"${attrStyle(r.attribute || b.attribute)}>
      ${artPanel({name, ...b}, `${r.rarity || b.rarity ? `<span class="rank">${esc(r.rarity || b.rarity)}★</span>` : ""}
        <span class="attrline">${r.attribute || b.attribute ? `<b>${esc(r.attribute || b.attribute)}</b>` : ""}</span>`)}
      ${creditLine({name, ...b})}
    </div>
    <div class="drawer-b"${attrStyle(r.attribute || b.attribute)}>
      <h2>${esc(name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h2>
      ${f.epithet ? `<div class="cepithet" style="margin:-4px 0 12px">${esc(f.epithet)}</div>` : ""}
      <div class="meta">
        ${r.confidence?.identity ? tierBadge(r.confidence.identity, r.confidence.identity === "official") : ""}
        ${r.status ? `<span class="pill">${esc(r.status)}</span>` : ""}
        ${b.phase ? `<span class="pill">Phase ${esc(b.phase)}</span>` : ""}
      </div>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : `<p>No written record yet — identity only.</p>`}
      ${gear.length ? `<div class="dsec"><span class="label">Record</span>
        <div class="dgear">${gear.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>` : ""}
      <div class="dsec">
        <span class="label">Kit ${r.kit?.length ? `— ${TIER_MEANS[kitTier] || "Unverified"}` : ""}</span>
        ${r.kit?.length
          ? `<div style="margin-bottom:12px">${tierBadge(kitTier, kitTier === "official")}</div>
             <ul>${r.kit.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
             <p style="font-size:12px;color:var(--fg-3);margin-top:14px">Pre-balance. Multipliers and mechanics
             routinely shift between beta phases.</p>`
          : `<p style="margin:0;color:var(--fg-3)">Nothing in the files yet.</p>`}
      </div>
      ${sourceList(r.sources)}
    </div>`);
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

/* There is no weapon database — a weapon is defined by whose banner it runs
   beside and what the desk has written about it. Both are already on hand, so
   the record is assembled rather than stored. */
function drawerWeapon(name){
  const runs = weaponRuns(name);
  if(!runs.length) return;
  const k = name.toLowerCase();
  const mentions = entries()
    .filter(e => `${e.title} ${e.body}`.toLowerCase().includes(k) ||
                 (e.tags || []).some(t => String(t).toLowerCase() === k))
    .sort((a, b) => (b.date||"").localeCompare(a.date||""));
  const holder = resonatorFor(runs[0].name);

  const wart = weaponArtFor(name);
  openDrawer("Weapon convene", `<div class="drawer-b"${attrStyle(runs[0].attribute || holder.attribute)}>
    <div class="meta">
      <span class="pill">${esc(holder.weapon || runs[0].weapon || "Weapon")}</span>
      ${wart?.rarity ? `<span class="pill ver">${esc(wart.rarity)}★</span>` : ""}
      ${runs.some(r => r.status === "live") ? `<span class="pill live">Running now</span>` : ""}
    </div>
    ${wart?.icon ? `<div class="wbig"><img src="${esc(wart.icon)}" alt="${esc(name)}" decoding="async"></div>` : ""}
    <h2>${esc(name)}</h2>
    <p>Signature weapon for <b>${esc(runs[0].name)}</b>. Kuro runs the weapon convene
    alongside the character banner, so it is available for the same window.</p>
    <div class="dsec"><span class="label">Runs alongside</span>
      <div style="display:grid;gap:8px">${runs.map(r => `
        <span class="dsrc" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}">
          <span class="lang">${esc(r.version)}</span>${esc(r.name)} — phase ${esc(r.phase)}
          ${r.new ? "· debut" : "· rerun"}
          <span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div>
    </div>
    ${mentions.length ? `<div class="dsec"><span class="label">Intel mentioning it — ${mentions.length}</span>
      <div style="display:grid;gap:8px">${mentions.map(e => `
        <span class="dsrc" role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
          <i class="dot t-${esc(e.confidence)}" style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></i>
          ${esc(e.title)}<span class="arrow">${icon("i-arrow", 13)}</span></span>`).join("")}</div></div>`
      : `<div class="dsec"><span class="label">Intel mentioning it</span>
         <p style="margin:0;color:var(--fg-3)">Nothing written up yet — only the banner listing.</p></div>`}
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
  VIEWS.forEach(v => out.push({group:"Views", label:v.label, hint:"View", act:["view", v.id], tier:null}));
  versions().forEach(v => out.push({
    group:"Versions", label:`${v.id}${v.title ? " — " + v.title : ""}`, hint:v.status, act:["version", v.id], tier:null
  }));
  resonators().forEach(r => out.push({
    group:"Resonators", label:`${r.name}${r.nameCN ? " " + r.nameCN : ""}`,
    hint:[r.rarity ? r.rarity + "★" : "", r.attribute].filter(Boolean).join(" "), act:["resonator", r.name], tier:null
  }));
  allWeapons().forEach(w => out.push({
    group:"Weapons", label:w.name, hint:`${w.holder} · ${w.version}`, act:["weapon", w.name], tier:null
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
const RENDER = {
  timeline: renderTimeline, intel: renderIntel,
  signals: renderSignals, resonators: renderResonators
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
    /* Arrow keys walk the tablist, as a tablist should. */
    if(t?.getAttribute?.("role") === "tab"){
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
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
  const names = ["versions","news","resonators","feed","art","portraits","translations"];
  const loaded = await Promise.all(names.map(load));
  DATA = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));

  renderRail();
  renderTabs();
  renderHud();
  renderLegend();
  bind();
  setView(location.hash.slice(1) || "timeline");
  /* Last, and after the view is up: it is scenery, and it competes with the
     card art for the same connection. */
  renderBackdrop();
})();

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
const S = {view:"timeline", tier:"all", kind:"all", when:"all", elem:"all", sigLimit:60, drawer:null};

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
  const own = b.image || r.image;
  const shared = !own && !art && b.keyVisual && b.keyVisualFocus ? b.keyVisual : null;
  const image = own || art?.url || shared?.url;
  const cutout = !!own && image === own && (b.imageStyle || r.imageStyle) === "cutout";
  /* A 16:9 key visual in a 4:5 box has no vertical overflow, so object-position
     can only frame horizontally — zoom picks the height. */
  const style = shared
    ? ` style="object-position:${esc(b.keyVisualFocus)};transform:scale(${Number(b.keyVisualZoom)||1});transform-origin:${esc(b.keyVisualOrigin||"50% 50%")}"`
    : "";
  return {
    image, cutout, style,
    glyph: r.nameCN || b.name?.slice(0,1) || "?",
    credit: cutout ? (b.imageCredit || r.imageCredit) : null,
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

/* 74px banner thumbnail used inside the patch cards. */
function thumb(b){
  const f = figure(b);
  const r = resonatorFor(b.name);
  const attr = b.attribute || r.attribute;
  const unknown = !b.name || b.name === "???";
  const inner = f.image
    ? `<img class="${f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async"${f.style}>`
    : `<span class="g">${esc(unknown ? "?" : f.glyph)}</span>`;
  /* Only label new/rerun when the data actually says so — an unflagged banner
     row is unknown, not a rerun. */
  const fallback = b.new ? "New" : b.rerun ? "Rerun" : "";
  const meta = b.rarity || attr
    ? `${b.rarity ? `<i class="rar">${esc(b.rarity)}★</i>` : ""}${attr ? `<i class="attr">${esc(attr)}</i>` : ""}`
    : fallback ? `<i class="rar">${fallback}</i>` : "";
  return `<div class="bmini${unknown ? " unknown" : ""}"${attrStyle(attr)}>
    <div class="thumb${f.cutout ? " cut" : ""}">${inner}${b.phase ? `<span class="ph">P${b.phase}</span>` : ""}</div>
    <b>${esc(b.name || "???")}</b>
    <span class="bmeta">${meta}</span>
  </div>`;
}

/* ── rail ────────────────────────────────────────────────────────── */
function renderRail(){
  $("#rail-nav").innerHTML = VIEWS.map(v => `
    <button class="navlink" data-act="view" data-id="${v.id}" aria-current="${S.view === v.id}">
      ${icon(v.icon)}<span>${v.label}</span>${railCount(v.id)}
    </button>`).join("");

  const counts = tierCounts();
  $("#rail-tiers").innerHTML = TIERS.map(t => `
    <button class="tierlink" data-act="tier" data-id="${t}" title="${esc(TIER_MEANS[t])}">
      <i class="dot t-${t}"></i><span>${TIER_LABEL[t]}</span><span class="n">${counts[t] || 0}</span>
    </button>`).join("");

  $("#rail-links").innerHTML = [
    ["Official news", "https://wutheringwaves.kurogames.com/en/main/news"],
    ["Kuro on YouTube", "https://www.youtube.com/channel/UC0Bi5KMcECRVYis5Gb_ZYZQ"],
    ["Leak subreddit", "https://www.reddit.com/r/WutheringWavesLeaks/"]
  ].map(([label, href]) => `
    <a class="tierlink" href="${href}" target="_blank" rel="noopener">
      <span>${label}</span><span class="n" style="border:0">↗</span>
    </a>`).join("");

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

function renderTabs(){
  $("#tabs").innerHTML = VIEWS.map(v => `
    <button role="tab" id="tab-${v.id}" data-act="view" data-id="${v.id}"
            aria-selected="${S.view === v.id}" aria-controls="p-${v.id}"
            tabindex="${S.view === v.id ? 0 : -1}">
      ${icon(v.icon)}${v.label}${v.warn ? `<span class="warn">${v.warn}</span>` : ""}
    </button>`).join("");
}

/* ── hud ─────────────────────────────────────────────────────────── */
function renderHud(){
  const live = liveVersion(), next = nextVersion();
  const feed = DATA.feed || {};

  $("#hud-updated").textContent = feed.fetched ? fmtTime(feed.fetched) : "—";
  $("#hud-online").style.opacity = feed.fetched ? "" : ".5";

  $("#m-live").textContent = DATA.versions?.current || live?.id || "—";
  $("#m-entries").textContent = entries().length || "—";
  $("#m-updated").textContent = DATA.news?.updated ? fmtDate(DATA.news.updated) : "—";

  const days = next?.start ? daysTo(next.start) : null;
  $("#m-next").textContent = next?.id || "—";
  $("#m-next-k").textContent = days == null ? "Not announced"
    : days > 0 ? `In ${plural(days, "day")}` : days === 0 ? "Launches today" : "Live now";

  const win = patchWindow(live);
  const bar = $("#m-progress"), key = $("#m-progress-k");
  if(win){
    const total = Math.round((win.end - win.start) / DAY);
    const gone = Math.min(Math.max(Math.round((Date.now() - win.start) / DAY), 0), total);
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.round(gone / total * 100)}%`;
    key.innerHTML = `Day ${gone} of ${total} · <b style="display:inline">${plural(total - gone, "day")} left</b>`;
  }else{
    bar.hidden = true;
    key.textContent = live?.start ? `Live since ${fmtDate(live.start)}` : "";
  }
}

/* ── timeline ────────────────────────────────────────────────────── */

/* Banners you can still pull. A phase that has already ended is history — it
   belongs in the full timeline below, not on the card telling you what's on
   right now. Falls back to the last phase if the whole patch has run out, so
   the card never empties. */
function livePhases(v){
  const phases = v.phases || [];
  if(!phases.length) return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = phases.filter(p => !p.end || new Date(p.end) >= today);
  const use = open.length ? open : phases.slice(-1);
  return use.map(p => {
    const rows = (p.banners || []).map(b => ({...b, phase:p.n, keyVisual:v.keyVisual}));
    return {
      n: p.n,
      range: [p.start ? fmtShort(p.start) : "", p.end ? fmtShort(p.end) : ""].filter(Boolean).join(" → "),
      est: !!(p.estimated_start || p.estimated_end),
      fresh: rows.filter(b => b.new),
      reruns: rows.filter(b => !b.new),
      banners: rows
    };
  });
}
const liveBanners = v => livePhases(v).flatMap(p => p.banners);

/* The most recent debut on this patch, for the card's backdrop — the newest
   character you can actually pull right now. */
function newestDebutArt(v){
  const debuts = (v.phases || [])
    .flatMap(p => (p.banners || []).filter(b => b.new).map(b => ({...b, start:p.start})))
    .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
  for(const b of debuts){
    const f = figure({...b, keyVisual:v.keyVisual});
    if(f.image) return {url:f.image, poster:f.poster, name:b.name};
  }
  return null;
}

function patchCard(v, role){
  if(!v){
    return `<article class="pcard is-future">
      <div class="rings"></div>
      <div class="pcard-top"><span class="pill future">Future</span></div>
      <div class="pcard-main">
        <div class="pcard-num" style="color:var(--fg-3)">?</div>
        <div class="pcard-title">Beyond the horizon</div>
        <div class="pcard-dates">No version announced</div>
      </div>
      <div class="pcard-note">Nothing past the current cycle has surfaced yet. Beta datamines usually
        land first — they show up under Intel the moment they're worth writing up.</div>
    </article>`;
  }

  const openPhases = livePhases(v);
  const banners = openPhases.flatMap(p => p.banners);
  const fresh = banners.filter(b => b.new);
  const reruns = banners.filter(b => !b.new);
  const events = newsFor(v.id).slice(0, 3);
  const days = v.start ? daysTo(v.start) : null;
  /* A live patch shows the newest debut's own art; an upcoming one has no
     debut art yet, so it falls back to the patch key visual. */
  const face = role === "live" ? newestDebutArt(v) : null;
  const f = face || v.keyVisual;

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
  }

  const rows = [];
  /* Debuts and reruns are different decisions — a debut is now or never, a
     rerun comes round again — so they get their own columns. Rows are phases,
     because what you actually want to know is who runs alongside whom: a row
     reads as "this is phase 1". Three fit a cell; say so rather than silently
     dropping the rest. */
  const strip = list => list.length
    ? `<div class="bstrip">${list.slice(0, 4).map(thumb).join("")}${
        list.length > 4 ? `<span class="bmini-more">+${list.length - 4}</span>` : ""}</div>`
    : `<div class="bnone">—</div>`;

  if(banners.length) rows.push([null, `<div class="pcard-split">
    <div class="ps-head label l">New character${fresh.length === 1 ? "" : "s"}</div>
    <div class="ps-head label r">Rerun${reruns.length === 1 ? "" : "s"}</div>
    ${openPhases.map(p => `
      <div class="ps-phase">
        <span class="n">Phase ${p.n}</span><i></i>
        ${p.range ? `<span class="when">${p.range}${p.est ? ` <em>est</em>` : ""}</span>` : ""}
      </div>
      <div class="ps-cell l">${strip(p.fresh)}</div>
      <div class="ps-cell r">${strip(p.reruns)}</div>`).join("")}
  </div>`]);
  if(events.length) rows.push([
    "Key events",
    `<div class="evlist">${events.slice(0, banners.length ? 2 : 3).map(e => `<div class="evrow t-${esc(e.confidence)}">
      <i class="dot"></i><span class="what" style="color:var(--fg-2)">${esc(e.title)}</span>
      <span class="when">${fmtShort(e.date)}</span></div>`).join("")}</div>`
  ]);
  if(!rows.length && v.notes) rows.push(["Status", `<p style="margin:0;font-size:12px;color:var(--fg-2)">${esc(v.notes)}</p>`]);

  const cellHtml = rows.length
    ? `<div class="pcard-rows">${rows.map(([k, h]) =>
        `<div class="pcard-row">${k ? `<div class="label">${k}</div>` : ""}${h}</div>`).join("")}</div>`
    : "";

  return `<article class="pcard is-${role}" role="button" tabindex="0" data-act="version" data-id="${esc(v.id)}"
           aria-label="Version ${esc(v.id)} detail">
    ${f?.url
      ? `<div class="pcard-art${face?.poster ? " poster" : ""}">
           <img src="${esc(f.url)}" alt="" loading="lazy" decoding="async"></div>`
      : `<div class="rings"></div>`}
    <div class="pcard-top">${state}</div>
    <div class="pcard-main">
      <div class="pcard-num">${esc(v.id)}</div>
      ${v.title ? `<div class="pcard-title">${esc(v.title)}</div>` : ""}
      <div class="pcard-dates">${[v.start ? fmtDate(v.start) : "", versionEnd(v)].filter(Boolean).join(" — ") || "Dates unknown"}</div>
      ${status}
      ${track(v, role)}
    </div>
    ${cellHtml}
    <div class="pcard-foot">View details ${icon("i-arrow", 12)}</div>
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

function characterCard(b){
  const r = resonatorFor(b.name);
  const f = figure(b);
  const attribute = b.attribute || r.attribute;
  const rarity = b.rarity || r.rarity;
  const kit = r.kit || [];
  const kitTier = r.confidence?.kit;
  const gear = [
    ["Signature", b.signature || r.signature],
    ["Convene", b.convene || r.convene],
    ["Accessory", r.accessory]
  ].filter(([, v]) => v);

  const overlay = `
    ${rarity ? `<span class="rank">${esc(rarity)}★</span>` : ""}
    <span class="phase">Phase ${esc(b.phase)}</span>
    <span class="attrline">
      ${attribute ? `<b>${esc(attribute)}</b>` : ""}
      ${b.weapon || r.weapon ? `<span>${esc(b.weapon || r.weapon)}</span>` : ""}
      ${b.role || r.role ? `<span>${esc(b.role || r.role)}</span>` : ""}
    </span>`;

  return `<article class="ccard" role="button" tabindex="0" data-act="resonator" data-id="${esc(b.name)}"${attrStyle(attribute)}>
    ${artPanel(b, overlay)}
    ${creditLine(b)}
    <div class="cbody">
      <h3>${esc(b.name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h3>
      ${b.window ? `<div class="cwhen">${esc(b.window)}</div>` : ""}
      ${f.epithet ? `<div class="cepithet">${esc(f.epithet)}</div>` : ""}
      ${r.summary || b.note ? `<p class="csum">${esc(r.summary || b.note)}</p>` : ""}
      ${gear.length ? `<div class="cgear">${gear.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
      <div class="cknow">
        <div class="cknow-h">
          <span class="label">What we know</span>
          ${kit.length ? tierBadge(kitTier) : ""}
        </div>
        ${kit.length
          ? `<ul>${kit.slice(0, 3).map(k => `<li>${esc(k)}</li>`).join("")}</ul>`
          : `<div class="none">Nothing in the files yet — identity only.</div>`}
        <div class="cmore">Full record ${icon("i-arrow", 12)}</div>
      </div>
    </div>
  </article>`;
}

function rerunCard(b){
  const r = resonatorFor(b.name);
  const attr = b.attribute || r.attribute;
  const f = figure(b);
  const bits = [b.rarity || r.rarity ? (b.rarity || r.rarity) + "★" : "", attr, b.weapon || r.weapon, b.role || r.role]
    .filter(Boolean).join(" · ");
  return `<article class="recard" role="button" tabindex="0" data-act="resonator" data-id="${esc(b.name)}"${attrStyle(attr)}>
    <div class="g">${f.image
      ? `<img class="${f.poster ? "poster" : ""}" src="${esc(f.image)}" alt="" loading="lazy" decoding="async">`
      : esc(f.glyph)}</div>
    <div class="who"><strong>${esc(b.name)}</strong><span>${esc(bits || "Rerun")} · P${esc(b.phase)}</span></div>
    <span class="pill">Rerun</span>
  </article>`;
}

function renderTimeline(){
  const live = liveVersion(), next = nextVersion(), future = futureVersion();

  /* Hero */
  const hero = `<div class="panel">
    <div class="panel-h">
      <h2>Patch timeline</h2><span class="sub">Now / Next / Future</span>
      <div class="right chips">${chips("when", [
        ["all","All"], ["current","Current"], ["upcoming","Upcoming"], ["past","Past"]
      ], S.when)}</div>
    </div>
    <div class="panel-b"><div class="hero">
      ${patchCard(live, "live")}
      ${patchCard(next, "next")}
      ${patchCard(future, "future")}
    </div></div>
  </div>`;

  /* Next-patch resonators */
  const phases = next?.phases || [];
  const rows = phases.flatMap((p, i) => (p.banners || []).map(b => ({
    ...b, phase:p.n ?? i+1, keyVisual:next.keyVisual,
    window: p.start ? `From ${fmtShort(p.start)}${p.estimated_start ? " (est)" : ""}` : ""
  })));
  const fresh = rows.filter(b => b.new), reruns = rows.filter(b => b.rerun);

  const upcoming = next ? `<div class="panel">
    <div class="panel-h">
      <h2>Next up — new resonators</h2>
      <span class="sub">${esc(next.id)}${next.start ? ` · ${fmtDate(next.start)}` : ""}</span>
    </div>
    <div class="panel-b">
      <div class="cgrid">${fresh.map(characterCard).join("") || `<div class="empty">No confirmed new characters yet.</div>`}</div>
      ${reruns.length ? `<div style="margin-top:20px">
        <div class="label" style="margin-bottom:10px">Also rerunning — ${plural(reruns.length, "banner")}</div>
        <div class="rerow">${reruns.map(rerunCard).join("")}</div>
      </div>` : ""}
    </div>
  </div>` : "";

  /* Full version list */
  const rank = v => v.status === "live" ? 0 : v.status === "announced" ? 1 : v.status === "beta" ? 2 : 3;
  const bucket = v => v.status === "live" ? "current" : (v.status === "announced" || v.status === "beta") ? "upcoming" : "past";
  const list = [...versions()]
    .filter(v => S.when === "all" || bucket(v) === S.when)
    .sort((a, b) => rank(a) - rank(b) || parseFloat(a.id) - parseFloat(b.id));

  const full = `<div class="panel">
    <div class="panel-h"><h2>All versions</h2><span class="sub">${plural(list.length, "patch")} · banners by phase</span></div>
    <div class="panel-b flush">
      ${list.length ? `<div class="vlist">${list.map(versionBlock).join("")}</div>`
        : `<div class="empty">Nothing in this window.</div>`}
    </div>
  </div>`;

  /* Dashboard duo */
  const recent = [...entries()].sort((a, b) => (b.date||"").localeCompare(a.date||"")).slice(0, 4);
  const sigs = signals().slice(0, 6);
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

  $("#p-timeline").innerHTML = `<div class="stack">${hero}${upcoming}${full}${duo}</div>`;
}

/* ── intel ───────────────────────────────────────────────────────── */
function chips(scope, items, active){
  return items.map(([k, label, n, cls]) =>
    `<button data-act="filter" data-scope="${scope}" data-id="${k}" aria-pressed="${active === k}" class="${cls || ""}">
      ${cls ? `<i class="dot"></i>` : ""}${label}${n != null ? `<span class="n">${n}</span>` : ""}
    </button>`).join("");
}

function intelCard(e, mini){
  const tier = TIERS.includes(e.confidence) ? e.confidence : "rumour";
  const unverified = tier === "reported" || tier === "rumour";
  const srcs = (e.sources || []).map(s => `<span><span class="lang">${esc((s.lang || "??").toUpperCase())}</span>${esc(s.name)}</span>`).join("");
  return `<article class="intel t-${tier}${unverified ? " unverified" : ""}${mini ? " mini" : ""}"
           role="button" tabindex="0" data-act="intel" data-id="${esc(e.id)}">
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
  </article>`;
}

function renderIntel(){
  const counts = tierCounts();
  let list = [...entries()].sort((a, b) => (b.date||"").localeCompare(a.date||""));
  if(S.tier !== "all") list = list.filter(e => e.confidence === S.tier);

  const filters = chips("tier",
    [["all", "All", entries().length]].concat(TIERS.map(t => [t, TIER_LABEL[t], counts[t] || 0, `t-${t}`])),
    S.tier);

  $("#p-intel").innerHTML = `<div class="stack">
    <div class="panel">
      <div class="panel-h">
        <h2>Intel</h2><span class="sub">Read, judged, tiered by hand</span>
        <div class="right chips tiered">${filters}</div>
      </div>
      <div class="panel-b flush">
        ${list.length ? `<div class="intel-list">${list.map(e => intelCard(e)).join("")}</div>`
          : `<div class="empty">Nothing at this confidence level.</div>`}
      </div>
      <div class="panel-f"><button class="more" data-act="open" data-id="methodology">How the tiers work ${icon("i-arrow", 12)}</button></div>
    </div>
  </div>`;
}

/* ── signals ─────────────────────────────────────────────────────── */
function signalRow(i){
  const h = headline(i);
  return `<a class="sig ${i.hot ? "hot" : ""}" href="${esc(i.url)}" target="_blank" rel="noopener"
     ${h.translated ? `title="${esc(h.original)}"` : ""}>
    <span class="t">${fmtClock(i.date)}</span>
    <span class="src"><b>${esc(i.source || "")}</b><i>${esc(KIND_LABEL[i.kind] || i.kind || "")}</i></span>
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

  $("#p-signals").innerHTML = `<div class="stack">
    <div class="panel">
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
      <div class="panel-b flush">
        ${shown.length ? `<div class="term">${shown.map(signalRow).join("")}</div>`
          : `<div class="empty">${all.length ? "Nothing in this category." : "No signals yet — the fetcher has not run."}</div>`}
      </div>
      ${list.length > shown.length ? `<div class="panel-f">
        <button class="more" data-act="morelogs">Show more — ${list.length - shown.length} older ${icon("i-arrow", 12)}</button>
      </div>` : ""}
    </div>
  </div>`;
}

/* ── resonators ──────────────────────────────────────────────────── */
function recordCard(r){
  const b = bannerFor(r.name) || {};
  return `<article class="rec" role="button" tabindex="0" data-act="resonator" data-id="${esc(r.name)}"${attrStyle(r.attribute)}>
    ${artPanel({name:r.name, ...b}, `${r.rarity ? `<span class="rank">${esc(r.rarity)}★</span>` : ""}
      ${r.version ? `<span class="phase">${esc(r.version)}</span>` : ""}`)}
    <div class="rec-b">
      <h3>${esc(r.name)}${r.nameCN ? `<span class="cjk">${esc(r.nameCN)}</span>` : ""}</h3>
      <div class="rec-attrs">
        ${r.attribute ? `<b>${esc(r.attribute)}</b>` : ""}
        ${r.weapon ? `<span>${esc(r.weapon)}</span>` : ""}
      </div>
      ${r.summary ? `<p class="rec-sum">${esc(r.summary)}</p>` : ""}
      ${r.role ? `<div class="rec-role">${esc(r.role)}</div>` : ""}
      <div class="rec-foot">
        ${confidenceRows(r)}
        ${r.kit?.length ? `<span class="rec-when">${plural(r.kit.length, "note")}</span>` : ""}
      </div>
    </div>
  </article>`;
}

function renderResonators(){
  const all = resonators();
  const elems = [...new Set(all.map(r => r.attribute).filter(Boolean))];
  let list = all;
  if(S.elem === "5" || S.elem === "4") list = list.filter(r => String(r.rarity) === S.elem);
  else if(S.elem !== "all") list = list.filter(r => r.attribute === S.elem);

  const filters = chips("elem",
    [["all", "All", all.length], ["5", "5★"], ["4", "4★"]].concat(elems.map(e => [e, e])),
    S.elem);

  $("#p-resonators").innerHTML = `<div class="stack">
    <div class="panel">
      <div class="panel-h">
        <h2>Resonator database</h2><span class="sub">${plural(all.length, "record")} · kit confidence per entry</span>
        <div class="right chips">${filters}</div>
      </div>
      <div class="panel-b">
        ${list.length ? `<div class="rgrid">${list.map(recordCard).join("")}</div>`
          : `<div class="empty">No records match.</div>`}
      </div>
      <div class="panel-f"><span class="tier-note">Kit detail on unreleased resonators is pre-balance — multipliers routinely shift between beta phases.</span></div>
    </div>
  </div>`;
}

/* ── aside ───────────────────────────────────────────────────────── */
function renderAside(){
  const feed = DATA.feed || {};
  const all = signals();
  const live = liveVersion(), next = nextVersion();
  const days = next?.start ? daysTo(next.start) : null;
  const counts = tierCounts();

  /* Featured = the next new resonator on the schedule, else the newest record. */
  const featName = (next?.phases || []).flatMap(p => (p.banners || []).filter(b => b.new))[0]?.name;
  const feat = featName ? resonatorFor(featName) : resonators()[0];

  const glance = `<div class="panel">
    <div class="mini-h"><h3>At a glance</h3></div>
    <div class="mini-b"><div class="glance">
      <div class="glance-row">Live version <b class="accent">${esc(DATA.versions?.current || live?.id || "—")}</b></div>
      <div class="glance-row">Next patch <b>${days == null ? "—" : days > 0 ? plural(days, "day") : "now"}</b></div>
      <div class="glance-row">Curated entries <b>${entries().length}</b></div>
      <div class="glance-row">Official / datamined <b>${(counts.official||0)} / ${(counts.datamined||0)}</b></div>
      <div class="glance-row">Signals captured <b>${all.length}</b></div>
      <div class="glance-row">Flagged hot <b>${all.filter(i => i.hot).length}</b></div>
    </div></div>
  </div>`;

  const featured = feat ? `<div class="panel feat"${attrStyle(feat.attribute)}>
    <div class="mini-h"><h3>Featured resonator</h3></div>
    ${artPanel({name:feat.name, ...(bannerFor(feat.name) || {})},
      feat.rarity ? `<span class="rank">${esc(feat.rarity)}★</span>` : "")}
    <div class="feat-b">
      <h3>${esc(feat.name)}</h3>
      ${feat.nameCN ? `<div class="cjk">${esc(feat.nameCN)}</div>` : ""}
      <div class="rec-attrs">
        ${feat.attribute ? `<b>${esc(feat.attribute)}</b>` : ""}
        ${feat.weapon ? `<span>${esc(feat.weapon)}</span>` : ""}
        ${feat.role ? `<span>${esc(feat.role)}</span>` : ""}
      </div>
      ${confidenceRows(feat)}
      <button class="btn" data-act="resonator" data-id="${esc(feat.name)}">View profile ${icon("i-arrow", 12)}</button>
    </div>
  </div>` : "";

  const health = `<div class="panel">
    <div class="mini-h"><h3>Source health</h3></div>
    <div class="srcstrip">${(feed.sources || []).map(s =>
      `<span class="srcpill ${esc(s.status)}" title="${esc(s.error || s.status)}"><i class="dot"></i>${esc(s.name)}</span>`
    ).join("") || `<span class="srcpill">No report</span>`}</div>
  </div>`;

  $("#aside").innerHTML = glance + featured + health;
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
    else if(act === "tier"){ S.tier = id; setView("intel"); }
    else if(act === "filter"){ S[scope] = id; if(scope === "kind") S.sigLimit = 60; draw(S.view); }
    else if(act === "morelogs"){ S.sigLimit += 60; draw("signals"); }
    else if(act === "noop"){ /* decorative */ }
    else dispatch(act, id);
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
  const names = ["versions","news","resonators","feed","art","translations"];
  const loaded = await Promise.all(names.map(load));
  DATA = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));

  renderRail();
  renderTabs();
  renderHud();
  bind();
  setView(location.hash.slice(1) || "timeline");
})();

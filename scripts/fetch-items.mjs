// Reward icons.
//
// Kuro writes an event's rewards as a line of prose — "Astrite x1200, Modifier,
// Premium Tuner, Forgery Premium Supply - Lahai-Roi" — and the desk used to
// print it back as a bulleted list, which is the shape the sentence arrived in
// rather than the shape the question comes in. The question is *what does this
// event pay*, and that is answered by the things themselves.
//
// So: split the line into items (this script and app.js agree on how — see
// `rewardTokens` below and its twin in app.js), resolve each one against the
// Wuthering Waves Wiki on Fandom, cache the icon under assets/items/ and write
// the map to data/items.json. The renderer then does a plain lookup on the name
// as it appears in the reward line; an item nobody has an icon for falls back to
// a typed plate, same rule as everywhere else on the desk.
//
// Fandom is the same source the resonator database reads, and the item art on it
// is Kuro's own, pulled out of the game. Icons are cached here rather than
// hotlinked because static.wikia.nocookie.net rewrites its revision URLs.
//
//   node scripts/fetch-items.mjs
//
// Only writes when something changed. Prunes icons no reward line mentions.

import { writeFile, readFile, mkdir, readdir, unlink } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const API = "https://wutheringwaves.fandom.com/api.php";
const WIKI = t => `https://wutheringwaves.fandom.com/wiki/${encodeURIComponent(String(t).replace(/ /g, "_"))}`;
const EVENTS = "data/events.json";
const OUT = "data/items.json";
const DIR = "assets/items";
const TIMEOUT_MS = 25000;
/* Fandom's own cap for a multi-title query. */
const BATCH = 50;

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}
async function getBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/png,image/webp,image/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty body");
  return buf;
}

/* ── the reward line ───────────────────────────────────────────────
   THIS IS THE TWIN OF `rewardTokens` IN assets/app.js. The two have to agree:
   this one decides which names get an icon fetched, that one decides which name
   is looked up at render time. Change one, change the other.

   Two shapes arrive. A hand-written entry lists rewards one to an array slot
   ("Astrite x1200"); a fetched one keeps Kuro's own sentence with the whole
   table in it. Both put the count after the word and the qualifier in brackets. */
const DASH = /\s+[—–-]\s+/;
const MORE = /^(and\s+)?other\s+(materials|rewards)$/i;
const BONUS = /^double\b.*\brewards$/i;

function rewardTokens(rewards) {
  const raw = Array.isArray(rewards)
    ? rewards.filter(Boolean).map(String)
    /* Commas, except the ones inside a bracketed qualifier. */
    : String(rewards || "").trim().replace(/\.\s*$/, "").split(/,(?![^(]*\))/);

  return raw.map(s => {
    let name = String(s).trim().replace(/^and\s+/i, "").replace(/\.\s*$/, "");
    if (!name) return null;
    /* "Double Tacet Suppression rewards" is a multiplier on somebody else's
       table, not a thing with an icon. */
    if (MORE.test(name)) return { kind: "more", name };
    if (BONUS.test(name)) return { kind: "bonus", name };

    let qty = null, tag = null;
    const q = /\s*[x×]\s*([\d][\d,]*)\s*$/i.exec(name);
    if (q) { qty = Number(q[1].replace(/,/g, "")); name = name.slice(0, q.index).trim(); }
    /* "(Title)", "(Event Sigil)", "(Event Avatar)" — what kind of thing it is,
       which the tile shows as a badge rather than as part of the name. */
    const t = /\(([^()]+)\)\s*$/.exec(name);
    if (t) { tag = t[1].trim(); name = name.slice(0, t.index).trim(); }
    /* Kuro writes the same compound both ways depending who typed the post.
       One spelling, so both key the same icon. */
    name = name.replace(DASH, " — ");
    return name ? { kind: "item", name, qty, tag } : null;
  }).filter(Boolean);
}

/* Which wiki page an item name might live under, best guess first. Kuro's
   reward lines qualify a generic item with the region it drops in ("Forgery
   Premium Supply — Lahai-Roi", where the page is the supply) and qualify a
   specific one with what it is ("Phantom — Myriad Snare: Rustfire Chassis",
   where the page is the echo). Try the whole name, then either half. */
function candidates(name) {
  const out = [name];
  const parts = name.split(" — ");
  if (parts.length === 2) out.push(parts[0].trim(), parts[1].trim());
  /* Titles arrive in Kuro's own quotation marks. */
  const bare = name.replace(/^["“](.+)["”]$/, "$1").trim();
  if (bare !== name) out.push(bare);
  return [...new Set(out.filter(Boolean))];
}

/* Fandom's item infoboxes are `|field = value` down one template call. */
const field = (text, key) =>
  (new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|}]+)`, "i").exec(text || "")?.[1] || "").trim();

async function lookup(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const j = await getJson(
      `${API}?action=query&format=json&formatversion=2&redirects=1` +
      `&prop=pageimages|revisions&piprop=original&rvprop=content&rvslots=main` +
      `&titles=${encodeURIComponent(batch.join("|"))}`);
    /* A redirect answers under its target's name, so carry the map back. */
    for (const r of j.query?.redirects || []) out.set(r.from, { alias: r.to });
    for (const r of j.query?.normalized || []) out.set(r.from, { alias: r.to });
    for (const p of j.query?.pages || []) {
      if (p.missing) { out.set(p.title, null); continue; }
      const text = p.revisions?.[0]?.slots?.main?.content || "";
      out.set(p.title, {
        title: p.title,
        image: p.original?.source || "",
        rarity: Number(field(text, "rarity")) || 0,
        type: field(text, "type") || field(text, "class") || "",
        description: field(text, "description")
      });
    }
  }
  /* Resolve the alias hops now, so callers only ever see one level. */
  for (const [k, v] of out) if (v?.alias) out.set(k, out.get(v.alias) ?? null);
  return out;
}

(async () => {
  await mkdir(DIR, { recursive: true });

  const events = JSON.parse(await readFile(EVENTS, "utf8")).events || [];
  const names = new Set();
  for (const ev of events)
    for (const t of rewardTokens(ev.rewards))
      if (t.kind === "item") names.add(t.name);

  const wanted = [...names].sort();
  console.log(`${wanted.length} distinct reward items across ${events.length} events\n`);

  /* One query covering every candidate spelling of every name, then pick per name. */
  const pages = await lookup([...new Set(wanted.flatMap(candidates))]);

  const items = {};
  const keep = new Set();
  const missing = [];

  for (const name of wanted) {
    const hit = candidates(name).map(c => pages.get(c)).find(p => p?.image);
    if (!hit) { missing.push(name); console.log(`${name.padEnd(44)} no wiki page`); continue; }

    const file = `${DIR}/${slug(name)}.png`;
    try {
      const buf = await getBuffer(hit.image);
      await writeFile(file, buf);
      keep.add(file);
      items[name] = {
        icon: file,
        /* Which half of a compound name is the thing itself. Kuro qualifies a
           generic item with where it drops ("Forgery Premium Supply — Lahai-Roi")
           and a specific one with what it is ("Phantom — Myriad Snare: Rustfire
           Chassis"), so the qualifier is on the left in one and the right in the
           other. The page that answered is the thing; the renderer sets the rest
           underneath it in smaller type. */
        page: hit.title,
        ...(hit.rarity ? { rarity: hit.rarity } : {}),
        ...(hit.type ? { type: hit.type } : {}),
        ...(hit.description ? { description: hit.description } : {}),
        wiki: WIKI(hit.title)
      };
      console.log(`${name.padEnd(44)} ${hit.rarity ? hit.rarity + "★" : "  "} ${String(buf.length).padStart(7)}b  ${hit.title}`);
    } catch (err) {
      missing.push(name);
      console.log(`${name.padEnd(44)} icon failed — ${err.message}`);
    }
  }

  /* An item no reward line mentions any more shouldn't leave its icon behind. */
  for (const f of await readdir(DIR)) {
    const path = `${DIR}/${f}`;
    if (!keep.has(path)) { await unlink(path); console.log(`pruned ${path}`); }
  }

  const payload = {
    schema: "wuwa-desk/items@1.0",
    note:
      "Icons for the things events pay out, keyed by the item's name exactly as it appears in " +
      "an events.json reward line — the renderer strips the count and the bracketed qualifier " +
      "and looks up what's left. Resolved against the Wuthering Waves Wiki on Fandom, which " +
      "carries Kuro's own extracted item art; cached under assets/items/ rather than hotlinked " +
      "because Fandom rewrites its revision URLs. An item with no entry here draws a typed " +
      "plate instead — the desk shows what it has and borrows nothing.",
    credit: "Item art © Kuro Games · via the Wuthering Waves Wiki on Fandom (CC BY-SA)",
    source: "https://wutheringwaves.fandom.com/wiki/Items",
    items
  };

  let unchanged = false;
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    unchanged = JSON.stringify(prev.items) === JSON.stringify(items);
  } catch {}
  if (!unchanged)
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");

  console.log(`\n${Object.keys(items).length} icons${unchanged ? " (unchanged)" : ""}` +
    (missing.length ? `\nno icon: ${missing.join(", ")}` : ""));
})();

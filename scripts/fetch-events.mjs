// Resolves the limited-time event calendar, writes data/events.json.
// Node 20+. No dependencies. No API keys.
//
// Two of Kuro's own EN posts carry the whole calendar between them, and the
// desk needs both because neither is complete on its own:
//
//   1. The per-patch **Content Overview** ("Version 3.5 … Content Overview"),
//      published on patch day. Under "New Events and Gameplay" it lists every
//      event in the version with its name, its kind, a paragraph of flavour and
//      an exact duration in server time. It carries no per-event art — the post
//      is one header image and several thousand words.
//
//   2. The standalone **event notices** ("[Lament Recon: Tacet Crisis] Combat
//      Event", "Event Preview | […]"). One event each, and the first image in
//      the body is that event's own 16:9 banner — the picture with the event's
//      name set across it. This is the only place event art exists: Kuro draws
//      no key visual for an event until they announce it on its own. Anything
//      landscape after it is a screenshot of the mode being played, and becomes
//      the reel on the event record — but most notices carry only the whole
//      post over again as one tall infographic, and those are dropped by shape
//      rather than shown as a thumbnail of a page. See isLandscape.
//
// So the overview says what is running and when, the notice says what it looks
// like and what it pays, and this script matches them on the bracketed name.
// Anything the notices haven't covered yet gets no art rather than a borrowed
// picture — see the plate in app.css. Nothing here is rehosted: art is
// hotlinked from Kuro's CDN, same as the character key art.
//
// Times come back as ISO with +08:00 on them, because Kuro's "server time" is
// UTC+8 and the desk renders every clock in the reader's own zone.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

const BASE = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en";
const ARTICLE_URL = id => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;
const OUT = "data/events.json";
const TIMEOUT_MS = 20000;

/* How far back to read the news. Two patches is enough to carry the live one
   and the one before it — the desk shows the current calendar, not an archive,
   and every article past this is a fetch that resolves nothing. */
const LOOKBACK_DAYS = 100;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const readJson = async path => JSON.parse(await readFile(path, "utf8"));

/* Kuro's article bodies are HTML written in a CMS: <br> for every line break,
   entities for every apostrophe, and the ✦ bullet as a heading marker. Flatten
   to lines, because every field in here is "heading line, value line". */
function toText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&times;/g, "x")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

const imagesIn = html =>
  [...String(html || "").matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map(m => m[1])
    .filter(u => /^https:\/\/[^"]+\.(jpe?g|png|webp)(\?|$)/i.test(u));

/* Which of a notice's pictures are pictures.
   A notice runs its 16:9 banner first and then, as often as not, the whole
   post again as a single tall infographic — 1080x3738, the duration and the
   eligibility and the reward table set as type down a poster. The desk already
   holds every one of those facts as data, and one in a 16:9 frame is a
   thumbnail of a page. So the reel takes landscape frames only, and asks the
   CDN for the shape rather than guessing from the filename: Kuro's host is
   Alibaba OSS and `image/info` answers with the dimensions for free, without
   pulling down four megabytes to measure it here. */
const LANDSCAPE = [1.25, 2.5];

async function isLandscape(url) {
  try {
    const info = await getJson(`${url}${url.includes("?") ? "&" : "?"}x-oss-process=image/info`);
    const w = Number(info?.ImageWidth?.value), h = Number(info?.ImageHeight?.value);
    if (!w || !h) return false;
    const r = w / h;
    return r >= LANDSCAPE[0] && r <= LANDSCAPE[1];
  } catch {
    /* Any other host, or a CDN that declined to answer. Unmeasured is not
       shown — the reel is small enough that one page of type in it undoes it. */
    return false;
  }
}

/* "2026-07-11 10:00" in Kuro's server time. The offset is the point: without it
   every clock on the desk would be an hour or nine out for whoever is reading. */
function isoAt8(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(s || "");
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}:00+08:00`;
}

/* One duration line, in the four shapes Kuro writes it in:
     2026-07-11 10:00 - 2026-08-19 11:59 (server time)
     After the Version 3.5 update - 2026-08-19 03:59 (server time)
     Permanently available after the Version 3.5 update
     From now until 2026-08-19 23:59 (UTC+8)                       */
function parseWhen(value) {
  const s = String(value || "").replace(/\((server time|UTC\+8)\)/gi, "").trim();
  if (/permanent/i.test(s)) return { permanent: true };

  const halves = s.split(/\s+[-–—]\s+|\s+until\s+/i);
  const out = {};
  const first = halves[0] || "";
  const second = halves[1] || "";

  if (/after the version|from now/i.test(first)) out.withPatch = true;
  else if (isoAt8(first)) out.start = isoAt8(first);

  if (isoAt8(second)) out.end = isoAt8(second);
  /* "From now until <date>" puts the only date in the first half. */
  else if (out.withPatch && isoAt8(first) && !out.start) out.end = isoAt8(first);

  return out;
}

/* "✦Duration✦" then the value on the next line, or "✦Duration: value" on one.
   Both shapes appear in the same post, so read both. */
function field(text, name) {
  const rx = new RegExp(`^[✦\\s]*${name}[✦:\\s]*(.*)$`, "im");
  const m = rx.exec(text);
  if (!m) return "";
  if (m[1].trim()) return m[1].trim();
  const after = text.slice(m.index + m[0].length).split("\n").find(l => l.trim());
  return (after || "").trim();
}

/* ── the per-patch overview ──────────────────────────────────────────
   Blocks under "New Events and Gameplay", each headed by a bracketed name and
   a kind, then flavour, then a duration. Section headers — [Special Events],
   [New Gameplay], [H5 Web Event] — separate the in-game calendar from the two
   kinds of thing that are not really events, which is why they are kept. */
function eventsFromOverview(article, version) {
  const text = toText(article.articleContent);
  const from = text.search(/✦New Events and Gameplay✦/i);
  if (from < 0) return [];
  const to = text.indexOf("✦New Store Arrivals✦", from);
  const block = text.slice(from, to < 0 ? undefined : to);

  const out = [];
  let cur = null;
  let section = "Special Events";
  const push = () => { if (cur?.name) out.push(cur); cur = null; };

  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || /^✦New Events and Gameplay✦$/i.test(line)) continue;

    const sec = /^\[(Special Events|New Gameplay|H5 Web Events?|Limited-Time Events?)\]$/i.exec(line);
    if (sec) { push(); section = sec[1]; continue; }

    if (/^✦\s*Duration/i.test(line)) {
      if (cur) cur.when = parseWhen(line.replace(/^[✦\s]*Duration[✦:\s]*/i, ""));
      continue;
    }
    if (/^[✦※]/.test(line)) continue;

    const head = /^\[([^\]]+)\]\s*(.*)$/.exec(line) || /^"([^"]+)"\s*(.*Event.*)$/.exec(line);
    if (head) {
      push();
      cur = { name: head[1].trim(), kind: head[2].trim(), section, version, desc: [] };
      continue;
    }
    if (cur) cur.desc.push(line);
  }
  push();
  return out;
}

/* ── standalone notices ──────────────────────────────────────────────
   The art, and usually the rewards. Two title shapes carry an event name in
   brackets; everything else on the news page — convenes, maintenance, profile
   reveals, outfit drops — is explicitly not one of these and is skipped by the
   title test rather than by fetching it and finding out. */
const NOTICE_TITLE = [
  /^Event Preview\s*\|\s*\[([^\]]+)\]/i,
  /^\[([^\]]+)\]\s+.*\bEvent\b/i
];
const NOT_A_NOTICE =
  /Featured (Resonator|Weapon) Convene|Reverb (Resonator|Weapon) Convene|Convene:|Maintenance|Profile Reveal|Resonator Review|Post-Lament|Content Overview|Version Preview|Update Content|FAQ|Bundle|Outfit|Winners Reveal/i;

function noticeName(title) {
  if (NOT_A_NOTICE.test(title)) return null;
  for (const rx of NOTICE_TITLE) {
    const m = rx.exec(title);
    if (m) return m[1].trim();
  }
  return null;
}

async function parseNotice(article, name) {
  const text = toText(article.articleContent);
  const durationLine = field(text, "Duration");
  const imgs = imagesIn(article.articleContent);
  return {
    name,
    art: imgs[0] || null,
    /* Whatever else in the post is a picture rather than a page — see
       isLandscape. When a notice carries a real screenshot of the mode being
       played this is where it comes from, and the event record shows them as a
       reel; when it carries nothing but the banner and the poster, which is
       most of them, the list comes back empty and no reel draws. */
    shots: (await Promise.all(imgs.slice(1).map(async u => (await isLandscape(u)) ? u : null)))
      .filter(Boolean),
    when: durationLine ? parseWhen(durationLine) : null,
    rewards: field(text, "Rewards") || "",
    eligibility: field(text, "Eligibility") || "",
    /* The first non-heading paragraph is the event's own blurb. The overview's
       is usually better written, so this is only a fallback. */
    blurb: text.split("\n").map(l => l.trim()).find(l => l && !/^[✦※\[]/.test(l)) || ""
  };
}

/* Names are matched between two posts written by different people: brackets,
   smart quotes and the odd trailing exclamation mark all move. */
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const slug = s =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/* Which patch a date falls in. The desk already knows every window; an event
   is filed under the version it opens in, which is the version whose banner
   list it ran beside. */
function versionFor(versions, when, fallback) {
  const at = when?.start || when?.end;
  if (!at) return fallback;
  const t = Date.parse(at);
  for (const v of versions) {
    const start = Date.parse(v.start || "");
    const last = (v.phases || []).slice(-1)[0];
    const end = Date.parse(last?.end || "") || Infinity;
    if (t >= start && t <= end) return v.id;
  }
  return fallback;
}

(async function main() {
  const versionsFile = await readJson("data/versions.json").catch(() => ({ versions: [] }));
  const versions = versionsFile.versions || [];
  const patchStart = Object.fromEntries(versions.map(v => [v.id, v.start || ""]));

  let previous = { events: [] };
  try { previous = await readJson(OUT); } catch {}

  const menu = await getJson(`${BASE}/ArticleMenu.json`);
  const since = Date.now() - LOOKBACK_DAYS * 86400000;
  const recent = menu.filter(a => Date.parse(a.startTime || "") >= since);

  /* Overviews first: they are the list, and the notices are decoration on it. */
  const overviews = recent.filter(a => /Content Overview/i.test(a.articleTitle || ""));
  const parsed = [];
  for (const a of overviews) {
    const version = /version\s+(\d+\.\d+)/i.exec(a.articleTitle || "")?.[1];
    try {
      const full = await getJson(`${BASE}/article/${a.articleId}.json`);
      const rows = eventsFromOverview(full, version);
      rows.forEach(r => (r.overviewId = a.articleId));
      parsed.push(...rows);
      console.log(`overview ${version || "?"}  ${rows.length} events`);
    } catch (err) {
      console.log(`overview ${a.articleId} failed: ${err.message}`);
    }
  }

  /* Then the notices, for art and rewards. */
  const notices = new Map();
  for (const a of recent) {
    const name = noticeName(String(a.articleTitle || ""));
    if (!name) continue;
    try {
      const full = await getJson(`${BASE}/article/${a.articleId}.json`);
      const n = await parseNotice(full, name);
      n.articleId = a.articleId;
      n.articleTitle = full.articleTitle;
      n.published = String(a.startTime || "").slice(0, 10);
      notices.set(key(name), n);
      console.log(`notice   ${name.padEnd(34)} ${n.art ? "art" : "no art"}` +
        (n.shots.length ? `, ${n.shots.length} screenshot${n.shots.length === 1 ? "" : "s"}` : ""));
    } catch (err) {
      console.log(`notice   ${a.articleId} failed: ${err.message}`);
    }
  }

  /* Merge. An event known only from a notice still counts — that is how a
     patch's events show up between the preview broadcast and patch day, when
     no overview exists yet. */
  const byKey = new Map();
  for (const row of parsed) byKey.set(key(row.name), { overview: row });
  for (const [k, n] of notices) {
    const hit = byKey.get(k) || {};
    hit.notice = n;
    byKey.set(k, hit);
  }

  /* Hand-written entries, by every name they answer to. A patch written in
     from the preview broadcast carries art nobody else has yet — Kuro
     publishes an unreleased patch's banners as one infographic, and whoever
     wrote the entry cut the coordinates out of it. When Kuro's own list
     lands and supersedes the entry, that art has to come with it: the
     overview has no pictures, and dropping them would take the calendar
     backwards on patch day. */
  const handByKey = new Map();
  for (const e of previous.events || []){
    if (e.origin !== "hand") continue;
    for (const nm of [e.name, ...(e.alias || [])]) handByKey.set(key(nm), e);
  }

  const events = [];
  for (const [k, { overview, notice }] of byKey) {
    /* [New Gameplay] is a section of permanent systems that Kuro files beside
       the events because they ship together. This is a calendar; a permanent
       menu addition has no window and nothing to miss. */
    if (overview && /New Gameplay/i.test(overview.section)) continue;
    const name = overview?.name || notice?.name;
    const hand = handByKey.get(k) || handByKey.get(key(name));
    const when = overview?.when?.start || overview?.when?.end
      ? overview.when
      : notice?.when || overview?.when || {};
    const version = versionFor(versions, when, overview?.version);
    /* "After the Version 3.5 update" is a real start date once you know when
       the patch opened — resolve it rather than printing Kuro's phrasing. */
    const start = when.start || (when.withPatch && version && patchStart[version]
      ? `${patchStart[version]}T04:00:00+08:00` : null);

    const desc = (overview?.desc || []).join(" ").trim() || notice?.blurb || "";
    const kind = (overview?.kind || "").replace(/\s*Event$/i, "").trim()
      || (notice?.articleTitle?.match(/\]\s*(.+?)(,|$)/)?.[1] || "").replace(/\s*Event.*$/i, "").trim()
      || "Event";

    /* Outside every window the desk knows about. Kuro's news page still
       carries the last two patches' notices, and an event that closed before
       the current patch opened is an archive the desk does not keep. */
    if (!version) continue;

    events.push({
      id: `${version}-${slug(name)}`,
      name,
      kind,
      version,
      section: overview?.section || "Special Events",
      permanent: !!when.permanent,
      start,
      end: when.end || null,
      summary: desc.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || "",
      detail: desc,
      rewards: notice?.rewards || hand?.rewards || "",
      eligibility: notice?.eligibility || hand?.eligibility || "",
      /* Only ever Kuro's own event banner. No stand-ins: a tile with no art
         draws a plate, which is honest, and the plate goes away by itself the
         day Kuro publishes the notice. */
      art: notice?.art
        ? {
            url: notice.art,
            title: notice.articleTitle,
            source: ARTICLE_URL(notice.articleId),
            published: notice.published,
            credit: "© Kuro Games"
          }
        : hand?.art || null,
      /* The reel. Kuro's own screenshots out of the notice, in the order the
         post ran them, hotlinked from the same CDN the banner is. A hand entry
         may carry its own — a preview broadcast sometimes shows a mode weeks
         before the notice exists — and keeps them until a notice supersedes
         it, same rule as the art above. */
      ...(() => {
        const media = notice
          ? (notice.shots || []).map(url => ({
              url,
              title: notice.articleTitle,
              source: ARTICLE_URL(notice.articleId),
              credit: "© Kuro Games"
            }))
          : hand?.media || [];
        /* Absent rather than empty. Most notices are a banner and nothing else,
           and a `"media": []` on every one of them is a field that only ever
           says no. */
        return media.length ? { media } : {};
      })(),
      confidence: "official",
      origin: "kuro",
      source: notice?.articleId
        ? ARTICLE_URL(notice.articleId)
        : overview?.overviewId ? ARTICLE_URL(overview.overviewId) : null
    });
  }

  /* Hand-written entries survive. They are how an announced-but-unwritten-up
     event — everything between a preview broadcast and patch day — gets onto
     the calendar at all, and the fetcher must not silently delete somebody's
     writing. One that Kuro has since published under the same name loses to
     the real article, which is the whole point of it being here. */
  const fetchedKeys = new Set(events.map(e => key(e.name)));
  const kept = (previous.events || []).filter(e =>
    e.origin === "hand" &&
    ![e.name, ...(e.alias || [])].some(nm => fetchedKeys.has(key(nm)))
  );

  const all = [...events, ...kept].sort((a, b) => {
    const av = parseFloat(a.version) || 0, bv = parseFloat(b.version) || 0;
    if (av !== bv) return bv - av;
    return String(a.start || "").localeCompare(String(b.start || ""));
  });

  /* One headline per patch: the first Special Event that has art, else the
     first Special Event. It is the double-width tile on the desk, and a patch
     is built around one big event — a row of equal tiles says otherwise. */
  for (const version of new Set(all.map(e => e.version))) {
    const pool = all.filter(e => e.version === version && e.section === "Special Events");
    /* A hand-written entry that already claims the slot keeps it — whoever
       wrote the patch in before Kuro published it knows which event it is
       built around, and that is a judgement, not something to read off a
       list. Otherwise the first one carrying Kuro's own banner takes it. */
    const pick = pool.find(e => e.headline) || pool.find(e => e.art) || pool[0];
    pool.forEach(e => { delete e.headline; });
    if (pick) pick.headline = true;
  }

  await mkdir("data", { recursive: true });
  const payload = {
    schema: "wuwa-desk/events@1.0",
    note:
      "Limited-time events, read off Kuro's own EN posts: the per-patch Content Overview for the " +
      "list, dates and flavour, and each event's own notice for its banner art, screenshots and " +
      "rewards. Art is hotlinked from Kuro's CDN, never rehosted. `media` is the notice's other " +
      "pictures where they are landscape — a screenshot of the mode, not the post set as a poster. " +
      "An event with no notice yet has no art by design. " +
      "Times carry +08:00 because Kuro publishes them in server time.",
    events: all
  };

  let unchanged = false;
  try {
    unchanged = JSON.stringify(previous.events) === JSON.stringify(all);
  } catch {}

  if (!unchanged) {
    await writeFile(OUT, JSON.stringify({ ...payload, updated: new Date().toISOString() }, null, 2) + "\n");
  }

  const withArt = all.filter(e => e.art).length;
  const shots = all.reduce((n, e) => n + (e.media?.length || 0), 0);
  console.log(
    `\n${all.length} events, ${withArt} with Kuro's own art, ${shots} screenshots, ` +
      `${kept.length} hand-written kept` +
      (unchanged ? " (unchanged)" : "")
  );
})();

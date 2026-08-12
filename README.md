# Resonance Desk

Wuthering Waves patch timeline, leak feed and resonator database. Static site, no build step.

## Layout

```
index.html                     shell markup — rail, HUD, panels, drawer, palette
assets/app.css                 all styling
assets/app.js                  reads the JSON, renders every view
data/versions.json             patch timeline + banner phases
data/news.json                 curated leak/news entries
data/resonators.json           character kit database
data/feed.json                 auto-fetched headlines (written by Actions)
data/art.json                  resolved official key art (written by Actions)
data/translations.json         English for non-English signal headlines
assets/characters/             hosted character art
scripts/fetch-feeds.mjs        the headline fetcher
scripts/fetch-art.mjs          the key art resolver
.github/workflows/update-feeds.yml   cron, every 6h
```

Four views:

| View | Source | Tiered? |
|---|---|---|
| Timeline | `versions.json` + `resonators.json` + `art.json` | — |
| Intel | `news.json` | yes, by hand |
| Live Signals | `feed.json` | **no** — raw lead list |
| Resonators | `resonators.json` | yes, per kit |

The split matters. Live Signals is a machine telling you something happened; Intel is
you deciding what it was worth. A cron job can't judge whether a post is a datamine or
a guy guessing, so nothing it fetches carries a tier — which is why the two look
different on purpose: Intel is card-and-tier, Signals is a raw terminal log behind a
hatched "unverified" bar.

### Translating the signal feed

About a fifth of captured signals are Kurobbs CN. `feed.json` is machine-written and
replaced every 6 hours, so translations can't live in it — they live in
`data/translations.json`, keyed by the item URL:

```jsonc
"https://www.kurobbs.com/mc/post/1536324402000961536": "Post-Lament Anthropocene: …"
```

The row then shows English with the original underneath and a `ZH→EN` badge; anything
without an entry shows as published with a plain language badge. Game terms use the
**English client's** names — 星声 is Astrite, 玄方地界 is Land of Xuanfang, 穗穗 is
Suisui. Adding new ones is part of a desk update, same as tiering an entry.

Character names get checked against Kuro's own EN article titles rather than community
spelling — that's how `Yuno` was caught and corrected to **Iuno**.

### The shell

Persistent left rail (nav + tier counts + methodology), a HUD strip carrying live
patch progress and feed status, and a sticky tab strip. Below 860px the rail collapses
to a brand bar and the tabs become a bottom dock.

Clicking anything — a patch card, an intel entry, a resonator, a banner thumbnail —
opens a right-side **drawer** rather than navigating away, so the list you were reading
stays put behind it. `Ctrl/⌘+K` or `/` opens a **command palette** over versions,
resonators, intel and the last 60 signals.

No framework and no build step. Each view renders its whole panel to `innerHTML` and
every click is caught by one delegated `[data-act]` handler on `document`, so a
re-render can't leave a stale listener behind.

### The character cards

The Timeline view leads with a Now / Next / Future card row, then big panels for the
new characters on the next `announced` patch, plus a rerun row. Banner rows in
`versions.json` are matched by `name` against `resonators.json`, so the kit list ("what
we know") and its confidence tier come from the resonator record — don't duplicate that
into `versions.json`.

### Where the art comes from

`scripts/fetch-art.mjs` resolves it, no manual step. Kuro publishes a **Profile
Reveal** post per character on their own EN news site, and the first image in it is
the official key art card. The script finds that post by character name, pulls the
image URL, and writes `data/art.json`. The page hotlinks it from Kuro's CDN and
credits it back to the source post.

So a character shows a typographic plate until Kuro reveals them, then picks up real
art within 6 hours of the reveal going live. Characters absent from `art.json` are
absent by design — it means no reveal post exists yet.

Those reveal posters are a fixed template — 1080×1920, game logo at the top, name plate
at the bottom, face about a fifth of the way down. Shrunk into a 38px or 62px thumbnail
that reads as a tiny poster rather than a portrait, so the small thumbs pin the crop to
the top of the frame and zoom onto the head (`img.poster` in `app.css`). It's one rule
for every character because it's one template — don't add per-character framing for
these. Per-character framing is only needed for **key visual** crops, where several
characters share one wide image.

**Before the reveal**, you can crop a character out of the patch key visual, which Kuro
publishes with the version preview and which usually shows the new characters. Put the
image on the version and the framing on the banner row:

```jsonc
// versions.json — on the version
"keyVisual": { "url": "…", "source": "…", "title": "…", "credit": "© Kuro Games" }

// on the banner row
"keyVisualFocus":  "left 50%",   // object-position — frames horizontally
"keyVisualZoom":   1.72,         // a 16:9 visual in a 4:5 box has no vertical
"keyVisualOrigin": "47% 19%"     // overflow, so zoom picks the height
```

All three are needed together: `keyVisualFocus` alone can only frame left/right, because
`object-fit: cover` on a 16:9 source in a 4:5 box overflows horizontally only. Zoom in
until the poster's own title and logo fall outside the crop.

Full precedence: `banner.image` → `resonator.image` → resolved reveal art → key visual
crop → plate. The key visual crop drops out on its own the moment a real reveal card
exists, so you don't have to go back and clean it up. `"nameCN"` on a resonator becomes
the plate glyph when there's no image at all.

### Hosted character art

Full-body cutouts live in `assets/characters/<name>.webp` and win over everything else.
Point a resonator at one:

```jsonc
"image": "assets/characters/qingxiao.webp",
"imageStyle": "cutout",                      // transparent PNG/WebP, not a full-bleed photo
"imageCredit": "Character art © Kuro Games · pre-release, from 3.6 beta files"
```

`imageStyle: "cutout"` switches the panel to `object-fit: contain` with the figure
standing on the base, keeps the resonance rings and attribute glow visible behind it,
and lightens the scrim so the legs don't grey out. Without it the image is treated as
full-bleed and cropped.

Prep before committing one: trim the fully-transparent margins and downscale to ~1100px
on the long edge. Untrimmed 2048² files are roughly double the size for no visible gain
at the ~490px the card actually renders.

Never hotlink another fan site's CDN for these — it leeches their bandwidth and breaks
the moment they rename a file. Download it into `assets/`.

## Setup

```bash
git init && git add -A
git commit -m "feat: resonance desk v1"
git branch -M main
git remote add origin git@github.com:Jikkles/wuwa-resonance-desk.git
git push -u origin main
```

1. Settings → Pages → deploy from `main` / root.
2. Settings → Actions → General → Workflow permissions → **Read and write**. Without this the bot commit fails.
3. Add more YouTube channels to `SOURCES` in `scripts/fetch-feeds.mjs`. The `UC...` string, not the `@handle` — find it in the channel page source.

Opening `index.html` straight off disk works but the JSON won't load (browsers block `file://` fetch), so every panel falls back to empty. Serve the folder to preview locally — `python3 -m http.server`, or `npx serve`.

Run the fetcher by hand with `node scripts/fetch-feeds.mjs` — it prints kept/fetched
counts per source and only writes when something changed.

## Confidence tiers

The whole point of the desk. Every entry gets one.

| Tier | Colour | Confidence | Means |
|---|---|---|---|
| `official` | green | Confirmed (4/4) | Kuro said it. Livestream, patch notes, in-client notice. |
| `datamined` | blue | High (3/4) | Pulled from beta client files. Real numbers, pre-balance. |
| `reported` | amber | Medium (2/4) | Leaker with a track record. No file evidence attached. |
| `rumour` | red | Low (1/4) | Single source or contested. |

Tier colour is load-bearing, not decoration: it drives the rail on every intel card,
the filter chips, the dots in the palette and the confidence meter. The two unverified
tiers also get a hatched rail instead of a solid one, so "someone claimed this" reads
differently from "this is in the files" at a glance. The `.t-*` classes sit at the very
bottom of `app.css` on purpose — they have to win on source order against component
defaults of equal specificity.

Set `"outcome": "confirmed"` on an old entry once official confirmation lands — the
entry marks it, which is how you build a visible track record for each source over time.

## Sources

**Automated** (in `fetch-feeds.mjs`, all no-key, all probed from a datacenter IP):

| Source | Endpoint | Notes |
|---|---|---|
| Kuro Games EN | `hw-media-cdn-mingchao.kurogame.com/.../en/ArticleMenu.json` | The static JSON the official news page itself reads. `startTime` is UTC+8. |
| Kurobbs (CN) | `POST api.kurobbs.com/forum/companyEvent/findEventList` (`gameId=3`) | Kuro's own CN community. Lands here before global. |
| YouTube | `youtube.com/feeds/videos.xml?channel_id=UC0Bi5KMcECRVYis5Gb_ZYZQ` | Official channel. |
| Reddit | `/r/WutheringWavesLeaks` + `/r/WutheringWaves` `.rss` | **Optional** — 403/429s datacenter IPs at random. Never fails the run. |
| Google News | RSS search, `"Wuthering Waves"` | Gated to a games-press outlet allowlist, or you get stock tickers and golf. |
| MMO Culture | `mmoculture.com/tag/wuthering-waves/feed/` | |

Dead ends, so nobody re-tries them: **Sportskeeda**'s RSS sits behind an AWS WAF
challenge (Google News surfaces their articles anyway), **Prydwen** is Cloudflare-
gated, **encore.moe** and both Kuro sites are SPAs that return an empty shell to a
scraper, and **hakush.in** wouldn't resolve.

Items get `kind` (`official` / `video` / `community` / `press`) and a `hot` flag for
titles mentioning a version number, leak, banner, kit and so on — that's the "worth a
look" filter in the UI, and it's a keyword match, not a judgement.

The fetcher only bumps `fetched` when the content actually changed, so an idle cycle
produces no commit. Note that scheduled workflows auto-disable after 60 days of no
repo activity — if the feed genuinely goes quiet that long, push anything to reset it.

**Manual only** — these block bots hard, and translation is the actual work:
- NGA 鸣潮 board (bbs.nga.cn) — CN beta discussion heartland
- Bilibili — search 鸣潮 爆料 / 前瞻
- 百度贴吧 鸣潮吧, Weibo
- Arca.live 명조 채널, DCInside 명조 갤러리 — Korean side
- nanoka.cc

## Rules

- Character art is hosted in `assets/characters/`, including pre-release art pulled from
  beta files. This is a deliberate call: it's Kuro's IP, it's the thing that gets fan sites
  taken down, and the project accepts that risk. Every such image carries an `imageCredit`
  saying so on the card. If the risk calculus ever changes, delete the `image` fields and
  the cards fall back to official key art on their own.
- Everything else still links out rather than being copied — sources, articles, threads.
- Never promote a `reported` entry to `official` without an actual Kuro source.
- Beta multipliers shift between phases. Say so on every kit entry.

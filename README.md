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
data/portraits.json            character art + weapon icon map (written by Actions)
data/translations.json         English for non-English signal headlines
assets/portraits/              cached busts, cut-outs and gallery illustrations
scripts/fetch-feeds.mjs        the headline fetcher
scripts/fetch-art.mjs          the key art resolver
scripts/fetch-portraits.mjs    the character art + weapon icon resolver
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

Each signal row leads with a **source mark** keyed off `sourceId` (falling back to
`kind`), coloured by kind — so finding the one official post in forty community threads
is a colour-and-shape task rather than a reading task. The mark replaced the kind
caption that used to sit under the source name: mark, caption and the badge at the end
of the row were three printings of the same word.

Intel rows carry a **thumbnail**, and it is never invented. A tag naming a resonator
lends that resonator's art; everything else gets a plate showing the entry's version in
its own tier colour. The version key visual was tried as a middle fallback and made
eight consecutive rows show the same washed-out crop — decoration pretending to be
information. Every row keeps the slot either way, so the headlines stay on one left
edge.

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

Persistent left rail (nav + tier counts + saved views + methodology), a HUD strip
carrying live patch progress and feed status, and a sticky tab strip. Below 860px the
rail collapses to a brand bar and the tabs become a bottom dock.

Clicking anything — a patch card, an intel entry, a resonator, a banner thumbnail —
opens a right-side **drawer** rather than navigating away, so the list you were reading
stays put behind it. `Ctrl/⌘+K` or `/` opens a **command palette** over versions,
resonators, intel and the last 60 signals.

Every button on the page dispatches through the single delegated `[data-act]` handler.
Any other attribute is a button that silently does nothing — which is exactly what the
rail's Methodology link was until it was moved onto `data-act="open"`.

### Filters

Two tiers of control, and the split is deliberate:

- **Chips** in each panel header carry the view's *primary* axis — tier on Intel, kind
  on Signals, element and rarity on Resonators, now/next/past on Timeline. These are
  the questions the desk exists to answer, so they're always visible and pre-counted.
- **Quick-filter selects** carry the secondary axes: version and category on Intel,
  weapon on Resonators, source on Signals. Too many values to spend a chip each on.
  Options are read off the data, so a category nothing is filed under never appears.

The selects render **twice** — into the aside on desktop, and inline under the panel
header below 1340px where the aside is gone. Both copies write to the same `S` state
through the same delegated handler and both are rebuilt on every `draw()`, so they
cannot drift. `VIEW_FILTERS` says which axes a view actually reads, which is what Reset
clears and what the empty state names when a filter has emptied a list.

The rail's first three quick links are **saved views** — a view plus a filter
combination, applied before the switch so the list never visibly re-filters a frame
later. They're arrow-marked; the external links below them are ↗-marked. Nothing in
that list points at a page that doesn't exist.

No framework and no build step. Each view renders its whole panel to `innerHTML` and
every click is caught by one delegated `[data-act]` handler on `document`, so a
re-render can't leave a stale listener behind.

### The landing view fits a screen

Timeline is Now / Next / Future across the top and the intel + signals duo underneath.
That is the whole page — roughly 1560px at 1080p, where it used to be about 4500.

What went, and where it went instead:

- **The full-screen character panels.** Every character on them is a face on a patch
  card, and clicking that face opens the resonator drawer, which already carried the
  same summary, gear and kit list. A screen of panels to say what a drawer says on
  demand is the definition of a page that doesn't fit.
- **The All-versions lane list.** Still there, behind the card/lane toggle in the panel
  header — the same `versionBlock` renderer, same filters.
- **A banner row per phase.** One debut/rerun split now covers the whole patch; the
  phase is a chip on each tile. Per-phase bands were most of the height, at 450px for a
  two-phase patch.
- **The phase-date legend under the split.** It restated the run the head band already
  prints in full and the track already draws — three renderings of the same dates on one
  card, and every line came off the artwork.
- **The key events list on each card.** The same entries, tiered and dated, are the
  Recent intel panel one scroll down and the whole Intel view one click away. The card
  answers *who is in this patch*; Intel answers *what has been said about it*.

The `when` chips filter the card row and the lane list — whichever is on screen. They
used to sit on this panel and quietly re-filter a list two thousand pixels further
down, which reads as a button that does nothing.

**Banner thumbnails are clickable** and their `[data-act]` is the innermost one, so a
face opens that resonator while the rest of the card opens the version. That is the
route to a full kit now, so don't remove it.

Banner rows in `versions.json` are matched by `name` against `resonators.json`, so the
kit list ("what we know") and its confidence tier come from the resonator record —
don't duplicate that into `versions.json`.

### Signature weapons

Kuro runs the weapon convene alongside the character banner, so it sits alongside the
character on the card: a pair of equal tiles, character left and weapon right, each
opening its own drawer. It reads at the same weight as the character because it is a
separate pull, not a footnote on one.

`.bpair` is a flex row with `flex-wrap`, and that is the whole responsive story — side
by side on a wide card, stacked on a narrow one, no media query. Two gotchas if you
touch it: the base `.bmini` rule sets `flex:none; width:var(--thumb)` and sits **later**
in the file, so `.bstrip.rows .bmini` has to spell out `flex` and `width` or the
character tile collapses to thumbnail width; and the weapon tile's subtitle says only
"Signature" because the weapon type is already on the character tile beside it.

**The name is already in the data**: `signature` on the banner row in `versions.json`,
falling back to the resonator record. `signatureFor()` is the one accessor. Nine of the
ten banner rows currently carry one; Denia's is missing, and that row simply shows no
weapon. **Don't fill it in from memory** — a wrong weapon name is exactly the kind of
error the tier system exists to prevent. Add it to `versions.json` from a Kuro source
and it appears.

There is no weapon database and there doesn't need to be one. `drawerWeapon()` assembles
the record from what's on hand: `weaponRuns()` finds every banner the weapon runs beside
(reruns mean that's a list), and the intel entries that name it come from a text match
over titles, bodies and tags. Weapons are in the command palette too.

### The art gets its own space

The patch card is a poster with a caption, not a picture with a table over it. The
picture owns a band of the card — **`.pcard-stage`** — and the only thing that ever
sits on it is the head band across the top. Everything else is below the fold of that
band, in **`.pcard-body`**.

So the card reads as three parts: **head** over the picture, **window** onto the
picture, **body** under it. The head used to sit at the *bottom* of the art, which is
where the character's face is — so the version number landed across a face and the top
of the card was empty. It moved up; then the rows followed it out of the picture
altogether.

The head is itself three lines, in this order for a reason:

1. **Status rail** — the state pill left, live/countdown right. Both are status, so
   they share a line.
2. **Run bar** — where the patch is in its own cycle.
3. **Identity** — the version number, with the codename and dates *beside* it rather
   than under it. Stacked, four lines of metadata sat below the number and pushed the
   whole band down over the character's face; alongside, they cost one line and the
   number gets to be 57px.

**The card is two blocks and the boundary between them is the whole layout.**
`.pcard-stage` is the artwork's own space: the picture fills it and the *only* thing
allowed over it is that head band, which is deliberate — the number wants a dark strip
behind it and the top of a character card is usually sky. Everything else — the banner
grid, the events, the footer — lives in `.pcard-body` underneath, on solid ground,
covering nothing. The rows used to be an 80%-opaque slab lying on the lower half of the
picture, so a busy patch quietly ate its own art.

The stage has both a floor and a ceiling (`min-height` / `max-height`) and that pairing
is the point. Three cards in a row are all as tall as the busiest one and that slack has
to go somewhere: without the floor, a patch running five banners letterboxes its own
art; without the ceiling, a quiet patch beside a busy one gets a picture twice its
neighbour's height. The stage also outgrows the body 6:1, so slack becomes picture
rather than a band of empty card above the footer — and anything past the ceiling spills
back into the body, because flex freezes an item at its max and redistributes the rest.

Both the reveal poster and the cutouts are shifted down with a transform into that
window, because neither has vertical overflow for `object-position` to work with, and
their faces otherwise sit behind the head band. The poster also gets zoomed past Kuro's
name plate and role bullets along its bottom edge. Retune that transform if you change
the stage height — a crop that frames a torso at 450px frames a chin at 330px.

The backdrop is the patch's **debut characters**, not a generic key visual. Most patches
run two, and two split the frame down the middle.

**Only a cut-out can be halved.** A reveal poster is a whole composition — framing,
backdrop, the character placed inside it — and cutting one down the middle crops
someone else's layout rather than showing a character. So `cardArt()` draws a two-debut
patch from cut-outs *even where a poster exists* for those characters (which is what
`portraits.json` is for), and lets a single debut's poster fill the frame instead.

**The figures live inside `.pcard-window`, not behind the whole stage**, and that one
choice is what keeps a face out of the head band's shadow. The window *is* the space
below the band, so a figure framed to fill it cannot be framed into the dark. Framing
against the full stage put every head under the dark strip and no amount of nudging
fixed it, because the band's height moves with the codename's line count. `.figs` then
bleeds ~78px *above* the window so the picture still runs behind the band and the band
still reads as something laid over art — the bleed is clipped by the stage.

They're `object-fit: cover` at a chest-up crop. `contain` was tried and shrinks a
waist-up UI card to a stamp in the middle of the frame; this crop puts the head just
under the band and the shoulders across the middle of the window.

Behind each one is **its own character's element colour** — a pool at the foot, a wash
up the lower third, a dark ground under both, and the same hue again over the picture's
feet so the figure sits *in* the light rather than in front of it. This is the card's
only colour and it does real work: Denia's half reads Fusion-orange before you've read
a word of the tile below.

Two backdrops were tried and dropped. Standing the pair on one of their *own* posters
put Suisui in front of a washed-out Suisui. The **patch key visual** is worse: it is a
marketing image with the version name set across it in type, so behind two cut-outs you
read "LAMPLIGHT IN MIRAGE" through the gap between them. A single debut with a poster
and no partner still gets that poster full-bleed (`cardArt()`); everything else is
figures on colour (`cardFigures()`).

The figures sit at `z-index:1` inside `.pcard-art`, which puts them **above** that
element's scrim but still below `.pcard-head`. The scrim exists to push the key visual
back; painting it over the characters as well left two silhouettes you could barely make
out.

Legibility in the head band comes from a wash and text shadow, **not blur** — a
`backdrop-filter` was tried and reads as smeared rather than atmospheric, which defeats
the point of putting art there. Below the band nothing needs rescuing at all, which is
why `.pcard-art::after` is now a hairline of shade at the very bottom: it only has to
land the crop on the body rather than stop dead against it.

**Each banner is one tile, not two.** Character over weapon, split by a rule inside a
shared border. The weapon convene is a separate pull and keeps its own click target, but
it is *that character's* weapon — and two free-floating tiles cost a stacked pair of
rows each, which across five banners is half a screen of card for a distinction the rule
makes just as well. The class label (`RECTIFIER`, `SWORD`) lives on the weapon row, not
in the character's meta: a signature weapon is by definition its holder's class, so one
label carries both facts and the meta line stops wrapping.

**The tile is lit in its element at rest, not on hover.** Ten tiles are most of what you
look at on this page, and putting the one piece of colour they carry behind a mouse
means the page is grey every time you aren't touching it — hover then adds a brighter
border and a drop of glow. `.bpair` declares `--attr: var(--fg-3)` as a fallback, which
matters: inline styles win over it, so a known element still paints itself, but a
character whose element nobody has announced (Suoming) would otherwise compute every
`color-mix()` against an undefined var and lose its border and background entirely.

A tile gets that chrome from `.bpair`, its wrapper. `.bstrip.rows > .bmini` — the child
combinator — catches the ones with *no* wrapper, which is the teased list on a future
patch, where there is no banner to pair a character to.

The phase is a **chip in the meta row**, not a bar across the foot of the portrait.
Stamped on the picture it put a grey slab over the one part of a 44px tile worth
looking at.

**The card lists the whole patch, not just what's still pullable.** It used to show only
open phases, which on a patch in its back half meant its debut headliner vanished from
its own card — 3.5 is Yangyang: Xuanling's patch whether or not her phase has ended. A
closed phase greys its chip and dashes the border (`.ph.past`); the character is not
dimmed, because a finished banner is still part of the patch. The run bar in the head
band is what says where today sits.

A patch with no banners yet — 3.7 — fills its card from the resonator database instead,
listing anything flagged for that version plus the version notes. Otherwise the card is
a large empty box, and empty space is the thing this layout exists to avoid.

On a phone the three cards become a snap-scrolling carousel — stacked, they were a
thousand pixels before the first headline. The debut/rerun split collapses to one
column there, and the four grid children get **explicit `grid-row`s**: source order is
head-l, head-r, cell-l, cell-r, so left to itself a single column stacks both headings
together and files every debut under "Reruns".

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
at the bottom, face about a fifth of the way down. That is the right picture for a
400px art window and the wrong one for a 44px tile, where you get a tiny poster rather
than a portrait.

So the small tiles use a different asset entirely. `scripts/fetch-portraits.mjs`
resolves the game's own UI art — a 160px bust and a 374×512 waist-up cut-out per
character, a 256px render per weapon — through **Prydwen's** public character and weapon
listings, which embed their whole dataset as JSON in the page source (one request each,
no per-character crawl). All of it carries a real alpha channel, which is the point: a
cut-out sits *on* the card, over the tile's own element gradient, instead of bringing a
second background inside the first. The script asserts that alpha is present and says
so per file when it runs.

The same script also resolves the **gallery illustration** — the 2048×2048 picture at
the foot of a character's own Prydwen page — and that is what the big art panels use
now. The 374px cut-out was being stretched across a 360px-wide panel and sat beside
patches whose art happened to be hand-placed at 750px, so half the desk looked like a
different site. This is one source for everybody, cut out, at eight times the pixels.
Its URL is derived from the character's slug; the page is only fetched when that misses.

That gallery slot holds two different kinds of picture, though. Before a character
releases it is a standing render — one figure, head at the top, clear air either side —
and that crops like a portrait. After release Prydwen tends to swap in the Resonance
Liberation splash: a wide painted scene with the character somewhere inside it at a
tenth of the size, which has no crop that is a picture of the character. Nothing on the
page distinguishes them, so the file does. A standing figure's alpha plane is one smooth
silhouette and costs 6–19% of the file; a scene's is a lace of glow and debris across
the whole canvas and costs 38–49%. The script reads the `ALPH` chunk length straight out
of the WebP container — no decoding, no dependency — draws the line at 28%, and logs
scenes as `gallery: "scene"` without keeping them. Those characters fall back to Kuro's
reveal poster, which is a portrait and is already sharp.

The files are cached into `assets/portraits/` rather than hotlinked — Prydwen is a fan
site paying for its own CDN. Credit rides in the page footer. Note that Prydwen is
behind Cloudflare, which 403s Node's `fetch` no matter what headers it sends; the script
shells out to `curl` for that reason, and it is still dependency-free.

A weapon debuting with an unreleased patch has no published icon yet and falls back to
the generic weapon mark — same rule as everywhere else here: show what is known.

Precedence, then, is: hand-set image → Prydwen gallery illustration → Kuro reveal poster
→ crop of the patch key visual → Prydwen waist-up cut-out, for the big art; and the
cut-out bust first for anything small.
Per-character framing is only ever needed for **key visual** crops, where several
characters share one wide image — never for the posters or the cut-outs, which are each
one template and get one rule.

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

Full precedence: `banner.image` → `resonator.image` → Prydwen gallery illustration →
resolved reveal art → key visual crop → waist-up cut-out → plate. The key visual crop drops out on its own the moment a real reveal card
exists, so you don't have to go back and clean it up. `"nameCN"` on a resonator becomes
the plate glyph when there's no image at all.

### Overriding the art for one character

A hand-set image wins over everything, including the gallery illustration. Point a
resonator (or a banner row) at a file you have added to the repo:

```jsonc
"image": "assets/characters/qingxiao.webp",
"imageStyle": "cutout",                      // transparent PNG/WebP, not a full-bleed photo
"imageCredit": "Character art © Kuro Games · pre-release, from 3.6 beta files"
```

Use it sparingly. Qingxiao and Jingran were carried this way through the 3.6 beta, when
the fetcher only had a 374px cut-out to offer; the gallery illustration is sharper than
either, so both overrides went and nothing is hand-placed today.

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

### Bump the asset version when you touch CSS or JS

`index.html` references `assets/app.css?v=N` and `assets/app.js?v=N`. **Bump `N` on both
whenever either file changes.** GitHub Pages serves assets with `max-age=600`, and
browsers hold them longer than that, so without the bump a deploy can look like nothing
happened — the new HTML loads against yesterday's stylesheet. The query string changes
the URL, which is the only thing a cache reliably keys on. `index.html` and the JSON
under `data/` are re-fetched normally, so they need no such treatment.

## Confidence tiers

The whole point of the desk. Every entry gets one.

| Tier | Colour | Confidence | Means |
|---|---|---|---|
| `official` | green | Confirmed (4/4) | Kuro said it. Livestream, patch notes, in-client notice. |
| `datamined` | blue | High (3/4) | Pulled from beta client files. Real numbers, pre-balance. |
| `reported` | amber | Medium (2/4) | Leaker with a track record. No file evidence attached. |
| `rumour` | red | Low (1/4) | Single source or contested. |

Tier colour is load-bearing, not decoration: it drives the rail on every intel card,
the intel plate, the filter chips, the dots in the palette, the confidence meter and
the footer legend. The two unverified tiers also get a hatched rail instead of a solid
one, so "someone claimed this" reads differently from "this is in the files" at a
glance. The `.t-*` classes sit at the very bottom of `app.css` on purpose — they have
to win on source order against component defaults of equal specificity.

The legend is repeated in the footer of every view, because that's where you end up
after reading something and wanting to know what its colour meant.

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

- Character art is cached into `assets/portraits/` by the fetcher, and a hand-set override
  may be added under `assets/characters/`. This is a deliberate call: it's Kuro's IP, it's
  the thing that gets fan sites taken down, and the project accepts that risk. Every such
  image carries a credit line on the card. If the risk calculus ever changes, delete the
  `image` fields and the cached files and the cards fall back to hotlinked key art on
  their own.
- Everything else still links out rather than being copied — sources, articles, threads.
- Never promote a `reported` entry to `official` without an actual Kuro source.
- Beta multipliers shift between phases. Say so on every kit entry.

# Resonance Desk

Wuthering Waves patch timeline, leak feed and resonator database. Static site, no build step.

## Layout

```
index.html                     shell markup — rail, HUD, panels, drawer, palette
assets/app.css                 all styling
assets/app.js                  reads the JSON, renders every view
data/versions.json             patch timeline + banner phases
data/news.json                 curated leak/news entries
data/resonators.json           resonator index — identity, debut, reruns
data/kits.json                 skills + Resonance Chains, loaded on demand
data/weapons.json              weapon database — stats, passives (written by Actions)
data/feed.json                 auto-fetched headlines (written by Actions)
data/art.json                  resolved official key art (written by Actions)
data/portraits.json            character art map (written by Actions)
data/translations.json         English for non-English signal headlines
assets/portraits/              cached busts, cut-outs and gallery illustrations
assets/weapons/                cached weapon icons
scripts/fetch-feeds.mjs        the headline fetcher
scripts/fetch-art.mjs          the key art resolver
scripts/fetch-portraits.mjs    the character art resolver
scripts/fetch-weapons.mjs      the weapon stat, passive and icon resolver
scripts/fetch-kits.mjs         the roster, kit and banner-history builder
.github/workflows/update-feeds.yml   cron, every 6h
```

Five views:

| View | Source | Tiered? |
|---|---|---|
| Timeline | `versions.json` + `resonators.json` + `art.json` | — |
| Intel | `news.json` | yes, by hand |
| Live Signals | `feed.json` | **no** — raw lead list |
| Resonators | `resonators.json` + `kits.json` | yes, per kit |
| Weapons | `weapons.json` | — |

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

Persistent left rail (nav + saved views + methodology). The rail **is** the navigation —
there was a horizontal tab strip across the stage too, listing the same six views 40px to
its right, and it went. It is also the filter surface: each view's primary axis unfolds
as a list under its own name when you open it, an accordion of one, so Timeline carries
all/current/upcoming/past, Resonators its elements, Weapons its classes and Intel the
four confidence tiers with their counts. Clicking the view you are already on folds its
list away and back. Below 860px the rail collapses to a brand bar, the nav becomes a
bottom dock and the filters reappear inside the panel — see below.

A plain nav rather than a tablist, which is what it was until the items grew disclosure
lists: a tab cannot own one. The `tab-<id>` ids stayed, because the panels are labelled
by them.

The HUD — search, feed status, page title — is the first panel of the **aside** rather
than a band across the top, so a view starts level with the top of the page instead of a
header's height below it. `.body` is a two-row grid and only the right column uses row
one; the views span both. Below 1340px the aside is gone, and the same markup flattens
back into a right-aligned strip above the stage. It stays first in the DOM either way —
Tab should reach Search before the page.

Clicking anything — a patch card, an intel entry, a resonator, a banner thumbnail —
opens a right-side **drawer** rather than navigating away, so the list you were reading
stays put behind it. `Ctrl/⌘+K` or `/` opens a **command palette** over versions,
resonators, intel and the last 60 signals.

Every button on the page dispatches through the single delegated `[data-act]` handler.
Any other attribute is a button that silently does nothing — which is exactly what the
rail's Methodology link was until it was moved onto `data-act="open"`.

### Filters

One control, in one place: **the rail's filter lists**, carrying each view's single axis
— tier on Intel, element on Resonators, class on Weapons, now/next/past on Timeline
(`RAIL_FILTERS`). These are the questions the desk exists to answer. They used to be a
chip strip across the top of every panel, in a header that said the view's name a second
time and held the content a header's height down the page; both went. Signals is the
exception, and keeps its kind chips in its own header: it has a hatched warning bar under
them, so that header was never the bare strip the others were. Events has nothing to
filter yet. Values are read off the data, so an element or a class nothing is filed under
is never a filter that can only empty the page.

A **Quick filters** panel used to stand in the aside — and again inline once the aside
dropped — carrying a select per view for a second axis: version and category on Intel,
weapon on Resonators, sub-stat on Weapons, source on Signals. It went. One filter surface
is the whole point of moving them into the rail, and a second one in the opposite margin,
in a different kind of control, was the arrangement the rail replaced, still standing.
What those selects answered is on the cards themselves — every intel entry prints its
version and category, every weapon its sub-stat.

The ascension slider is neither, which is part of why it lives in the weapon record
rather than on the view: it doesn't change which weapons you can see, only what one
passive says. It sits outside `VIEW_FILTERS` and Reset leaves it alone. In the record it
rides the *stats* heading rather than the passive's — the band of empty column beside the
summary — with the line it changes directly under it either way.

The filter renders **twice**, and exactly one copy is visible at any width: into the rail
on desktop, and into the panel's `.fbar` below 860px, where the rail is gone. Both write
to the same `S` state through the same delegated handler and are rebuilt on every
`draw()`, so they cannot drift.
`VIEW_FILTERS` says which axes a view actually reads, which is what Reset clears and what
the empty state names when a filter has emptied a list.

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
- **The All-versions lane list.** Gone with the card/lane toggle that reached it. It was
  a second rendering of the same patches the cards already draw, and one of the two had
  to be the answer to "what is in this patch" — the cards are.
- **A banner row per phase.** One debut/rerun split now covers the whole patch; the
  phase is a chip on each tile. Per-phase bands were most of the height, at 450px for a
  two-phase patch.
- **The phase-date legend under the split.** It restated the run the head band already
  prints in full and the track already draws — three renderings of the same dates on one
  card, and every line came off the artwork.
- **The key events list on each card.** The same entries, tiered and dated, are the
  Recent intel panel one scroll down and the whole Intel view one click away. The card
  answers *who is in this patch*; Intel answers *what has been said about it*.

The `when` chips filter the card row directly. They used to sit on this panel and
quietly re-filter a list two thousand pixels further down, which reads as a button that
does nothing.

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
falling back to the resonator record. `signatureFor()` is the one accessor. Every 5★
Resonator that has a signature weapon now carries one, and the ten that don't, don't
have one: Calcharo, Encore, Jianxin, Lingyang and Verina are standard-pool characters
whose best options are the permanent-convene 5★s, three of the four Rovers were never
given one, and Hsin and Suoming are 3.7 teases with nothing published yet. Aero Rover is
the exception among the Rovers — Bloodpact's Pledge is free from the 2.2 questline
rather than a convene, so its card shows without a link.

**Don't fill one in from memory** — a wrong weapon name is exactly the kind of error the
tier system exists to prevent. The mapping was resolved from Prydwen and cross-checked
two ways before it was written down: the build comments on the character pages name
their owner in prose ("Qiuyuan's Signature gives the same stats as…"), and the weapon IDs
are `210TSSSR`, where `T` is the weapon class, `SSS` is release order within it and `R`
is 6 for a limited signature against 5 for a permanent-convene 5★. Pairing the `…6`
weapons to the limited characters of that class in debut order reproduces the prose
attributions exactly — including the off-by-one in Swords that turned out to be Aero
Rover holding `21020046`.

There *is* a weapon database now — see below — and `drawerWeapon()` reads it for the
class, the stats and the passive. Either half can be missing: a 3★ crafting sword has
stats and no convene, and the two 3.7 signatures Prydwen hasn't listed yet have a convene
and no stats, so every section of the record is conditional.

The convene history the record used to list is gone. It was patch numbers for the one
weapon in four that has any, and the resonator it belongs to carries the same run history
in full — so the holder's name in the opening sentence is a `data-act="resonator"` link
and that is the whole navigation the record needs. `weaponRuns()` still runs, for the
accent colour and the "running now" pill. Weapons are in the command palette too.

`weaponRuns()` reads both ends of the same fact. `versions.json` is the arc the desk is
currently watching — two patches — so on its own it made every weapon older than that a
dead end, and a 1.0 Resonator's signature card linked nowhere. The Resonator's own `runs`
history goes back to launch, and a weapon convene runs beside the character banner, so
the second pass fills in from there; the timeline wins the key where both know a version,
because only it knows the phase and whether the patch is live.

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
character — through **Prydwen's** public character listing, which embeds its whole
dataset as JSON in the page source (one request, no per-character crawl). Weapon icons
come from the same host and used to come from this script; they are
`scripts/fetch-weapons.mjs`'s job now, which resolves all 120 of them alongside the
stats rather than the 36 that happen to be somebody's signature. All of it carries a
real alpha channel, which is the point: a
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
scenes as `gallery: "scene"` without keeping them. Those characters fall back to the
waist-up cut-out, which is a portrait and frames like every other record.

The measurement has one blind spot, and it is named rather than tuned around. Iuno's
splash is painted inside a circle — a disc of scene on an otherwise empty square — so
its alpha plane is one smooth closed curve costing 23%, on the portrait side of the
line, while the nearest genuine standing render measures 19%. There is no room left to
move the threshold, so `SCENES` in the fetcher lists the slug outright. Add to it when a
gallery picture gets through that clearly isn't a portrait; the run logs every
percentage, so you can see which way a new character fell.

The files are cached into `assets/portraits/` rather than hotlinked — Prydwen is a fan
site paying for its own CDN. This README is where that is recorded; the page itself no
longer names its data sources under the art, only the © Kuro Games it has to. Prydwen is
behind Cloudflare, which 403s Node's `fetch` no matter what headers it sends; the script
shells out to `curl` for that reason, and it is still dependency-free.

A weapon debuting with an unreleased patch has no published icon yet and falls back to
the generic weapon mark — same rule as everywhere else here: show what is known.

Precedence, then, is: hand-set image → Prydwen gallery illustration → Prydwen waist-up
cut-out → Kuro reveal poster → crop of the patch key visual, for the big art; and the
cut-out bust first for anything small.

The cut-out sits above the reveal poster, where it used to sit below it. The poster is
the one picture here that isn't a cut-out — logo band, name plate, its own painted
backdrop — so the handful of characters holding one were the handful that looked like
they came from a different site, standing in boxes in a grid where everyone else stands
on the card. Sharpness was the argument for ranking the poster first and it is a real
one; consistency wins it, because a record grid is read across rather than one card at a
time. The poster is still the fallback for anyone Prydwen has no portrait for at all,
and its epithet and credit are read off it either way.
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
waist-up cut-out → resolved reveal art → key visual crop → plate. The key visual crop
drops out on its own the moment Prydwen lists the character, so you don't have to go
back and clean it up. `"nameCN"` on a resonator becomes the plate glyph when there's no
image at all.

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

## The resonator database

`node scripts/fetch-kits.mjs` builds the whole roster — sixty Resonators including the
four Rover forms — and writes two files, split on how often they get read.

`data/resonators.json` is the index: who someone is, the patch they debuted in, and
every patch their banner has come back for. It's ~90KB and loads on every page view.

`data/kits.json` is the kit text: Basic Attack, Resonance Skill, Forte Circuit,
Resonance Liberation, Intro Skill, Outro Skill, both Inherent Skills and all six
Resonance Chain nodes, per character, in full. It's a megabyte, nobody reading the
timeline needs a word of it, so **app.js doesn't load it at boot** — the first record
you open fetches it and every record after that is instant. Anything added to the
Resonators view that needs kit text has to go through `loadKits()`, not `DATA`.

Three sources, each used for the one thing it's actually authoritative on:

| Source | Gives | Why that one |
|---|---|---|
| Fandom character page | rarity, attribute, weapon, role, epithet, nation, release date, blurb | The infobox is the game's own character sheet, and it covers the 4-stars and the Rovers that the leak sites never write up |
| Fandom convene pages | debut patch, rerun patches, banner dates | One page per banner run, named `<Convene>/<start date>`, carrying its 5-star and the version it shipped in. Sorted by date, that's the complete history |
| Prydwen character page | the kit | Skill names and full descriptions in a stable `skill-header` / `skill-details` pair, plus the six Sequence Nodes |

### It doesn't overwrite your writing

`summary`, `kit`, `sources`, `confidence`, `convene`, `signature`, `accessory` and
`status` are the desk's editorial and survive every run. The merge only fills blanks.
The exceptions are `version` and `reruns`, which are patch numbers rather than
judgements, so the banner history wins — that's what fixed Aemeath carrying `3.5` for a
rerun when she debuted in `3.1`.

Kit confidence is set on one rule: a character whose debut patch has already shipped
has a kit that's in the live client, and the live client is Kuro's own word, so it lands
`official`. Anyone still unreleased keeps whatever tier a human gave them — their
Prydwen page is a stub with no skill blocks at all, so there's nothing to scrape anyway.

### The grid is a contact sheet

A record card is a portrait, a name and the debut badge. Nothing else — no
summary, no element, no role, no confidence rows, no kit count. All of it is in
the record one click away, and printing it sixty times turned a roster into six
screens of small print nobody read. What's left earns its place at a glance: the
art identifies them, the card's accent is their element, the corner is their
debut patch.

The grid is **two tables**: every 5-star above every 4-star. That split is what
retired the 5★/4★ filter chips — the answer they gave is the shape of the page
now, and both halves are readable at once instead of being two states of one
grid you toggle between. The element and weapon filters still cross both tables,
so one can empty while the other fills; each table counts itself, and says "12 of
48" rather than bare "12" whenever a filter is narrowing it.

Cards are ordered **newest debut first**. What ships next and what just landed
are the two things this database gets opened for, and both were four screens down
when it ran oldest-first. Characters with an announced patch but no release date
sort ahead of everyone, which is where an unreleased character belongs.

The sort key is the release date, not the version — Zani and Ciaccona both
debuted in 2.3, but Zani was Phase 1 and Ciaccona Phase 2, and only the date
knows that. Sorting by version and then by name got it backwards. Undated
characters fall back to their patch number, zero-padded, because a patch number
is two integers and not a decimal: unpadded, 3.10 sorts behind 3.6 and the next
character announced lands in the middle of the grid.

Debut itself is the *earlier* of two things that can mean it: the first banner
they headlined, and the patch the wiki says introduced them. For a limited
5-star those agree. For a 4-star they don't — Baizhi was in the game from launch
and first got a rate-up in 1.1 — and the answer to "when did they debut" is the
day you could first have them, so 1.1 becomes the first entry in her rate-up
list instead.

The four Rover forms go to the end as a set. Rover is one character in four
elements, not four debuts, and threading them through by release date scattered
them across two years of grid. (Prydwen publishes one shared portrait for all
four, so those tiles are deliberately identical — only the element accent and
the debut badge differ.)

### Debut and reruns in the corner

The badge top-right of every record card is the debut patch, with `+n` counting reruns;
hover or focus it and it names them. Reruns are the question this database gets asked
most and they're a list of two-character strings, so they cost a tooltip rather than a
row of the card.

Reruns are a 5-star question, though, so only 5-stars carry them. A 4-star is rate-up
filler on nearly every banner that runs — nine to twelve appearances each, climbing by
two a patch — so the list is a wall of patch numbers that takes a paragraph to say "they
come back constantly". Their badge keeps the debut patch, drops the `+n`, and the
tooltip stops after the debut.

The same numbers are written out as plain rows inside the record, and the tooltip is
hidden entirely under `@media (hover:none)`. A tooltip that only opens by holding a
mouse still must never be the only route to a fact.

### Markers, not markup

Kit text carries `**bold**` and `__underline__` where Kuro's copy emphasised a number or
an element. `kitText()` escapes the string **first** and turns the markers into elements
**second**, so the only tags that reach `innerHTML` are the two it writes itself. Scraped
text is untrusted input; keep it that way if you touch this.

## The weapon database

120 weapons — 46 5★, 43 4★, 31 3★ — in `data/weapons.json`, written by
`scripts/fetch-weapons.mjs` on the same 6-hour cron as everything else.

### A contact sheet, same as the resonator grid

Big art, name underneath, everything else one click away. It reuses `.rec` and `.rgrid`
outright rather than restating them, so the two databases stay one idea — only the art
treatment (`.wart`) and the stat line under the name (`.wrec-s`) are its own.

It was built as a six-column table first, with the passive clamped into the last column,
and that was the wrong call. Every fact was on the page and nothing was worth looking
at: 120 rows of dense small print, which is a spreadsheet, and a spreadsheet is what a
record you can open exists to avoid. The card carries the name and the two level 90
figures — the only numbers anyone compares one weapon to another on — and the class, the
source, whose signature it is and the whole passive live in the record.

A weapon render is an object on transparent ground, not a portrait, so `.wart` contains
and centres it with padding rather than cropping it to fill, and replaces `.cart`'s
vignette with a floor for it to stand on. The 4:5 frame is the resonator card's, kept so
the two grids line up when you move between them. `has-art` is set on the frame when an
icon resolved — that is what suppresses the concentric-ring plate `.cart` draws behind a
card with no picture, which is exactly what a weapon with no published icon yet should
still get.

Three panels, one per rarity, same reasoning as the Resonators split — every rarity
readable at once beats a toggle between three states of one list. Cards sort **class then
name**: with no filter on that groups the five classes into five runs you can scan past,
where a flat alphabetical list scatters the four Broadblades you actually use across
three rows.

Rarity is the only colour on this view. The element accent that carries the rest of the
desk means nothing on a weapon, so `--rar` takes the accent slot per panel and the cards
feed it straight into `--attr`, which is what `.rec`'s hover, name colour and art
gradient are already wired to. All three values are already in the palette (5★ is the
desk's amber, 4★ and 3★ are the electro and glacio attribute colours), so no new hue
enters the system to say something the system already says.

### Stats are level 90, full stop

`atk90` and `statValue90` are max-level figures and the card and record both say so.
There is no level curve in the source and none is inferred: comparing two weapons is the
reason anyone opens this page, and a comparison at level 43 is a comparison of two
grinds. Every weapon sub-stat in this game is a percentage — there is no flat one — so
the unit is implicit in the data and the renderer appends the sign.

### The ascension slider

A weapon's passive is one sentence with holes in it. `effect` carries the template with
`{0}`…`{7}` in it and `ranks[n]` carries the five values `{n}` takes at ascension 1
through 5, so the desk stores one passive per weapon and the reader moves a slider —
instead of the page printing five nearly identical paragraphs each and asking you to
find the one you meant.

It lives **in the record**, beside the one thing it changes, which is also where Prydwen
puts it. It was a strip across the top of the view while the passives were on the cards;
when those moved into the record it followed them.

Three things about it are load-bearing:

- **It repaints, it doesn't redraw.** `paintRank()` rewrites the `[data-eff]` elements in
  place. A `draw()` would rebuild the `<input>` the thumb is currently being dragged on,
  which ends the drag mid-gesture.
- **`input`, not `change`.** The passive tracks the drag rather than jumping when the
  thumb is let go.
- **`S.rank` is global and `paintRank()` queries the document, not the record.** Set the
  rank on one weapon and every weapon you open after it is already there, which is the
  whole point when what you are doing is comparing two of them.

The record used to carry the full S1–S5 table as well, with its rows keyed to
superscripts in the sentence above. It came out: for the one number in it anyone acts on
it was a grid of unlabelled percentages, and the slider answers the same question by
being moved.

### Where the numbers come from

Kuro publishes no weapon endpoint. Prydwen's weapons page embeds its entire dataset as
JSON in the page source — one request for all 120 — and it is the same host
`fetch-portraits.mjs` already reads, so it is the source here too and is credited as
such. Same Cloudflare caveat, same `curl` workaround, still dependency-free.

Two things are cleaned up on the way in and one deliberately isn't. Stat **names** are
folded by `STAT_NAME`: the page is hand-maintained and ships "Crit. Rate" and "CRIT
Rate", "Energy Reg." and "Energy Regen", "CRIT DMG%" and "CRIT DMG", which left alone
produce three filter options for one stat. Unused array slots come back as `""` rather
than as an empty array, so `ranks[]` is built by walking the placeholders the text
actually uses. What is **not** corrected is the base ATK values that sit a point apart
inside a tier — 412/413/414/415 for the same class of 5★ — because that is what the
source says, and quietly rounding somebody else's data to the shape you expected is how
a desk starts publishing its own guesses.

The script refuses to overwrite the file if it parses fewer than 60 weapons, and reports
any weapon class it doesn't recognise rather than dropping it.

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

- Character art is cached into `assets/portraits/` and weapon icons into `assets/weapons/`
  by the fetchers, and a hand-set override
  may be added under `assets/characters/`. This is a deliberate call: it's Kuro's IP, it's
  the thing that gets fan sites taken down, and the project accepts that risk. Every such
  image carries a `© Kuro Games` line on the card. If the risk calculus ever changes, delete the
  `image` fields and the cached files and the cards fall back to hotlinked key art on
  their own.
- Everything else still links out rather than being copied — sources, articles, threads.
- Never promote a `reported` entry to `official` without an actual Kuro source.
- Beta multipliers shift between phases. Say so on every kit entry.

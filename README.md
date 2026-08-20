# Resonance Desk

Wuthering Waves patch timeline, leak feed and resonator database. Static site, no build step.

## Layout

```
index.html                     shell markup — rail, HUD, panels, drawer, palette
assets/app.css                 all styling
assets/app.js                  reads the JSON, renders every view
data/versions.json             patch timeline + banner phases
data/news.json                 curated leak/news entries
data/events.json               event calendar (written by Actions)
data/resonators.json           resonator index — identity, debut, reruns
data/kits.json                 skills + Resonance Chains, loaded on demand
data/weapons.json              weapon database — stats, passives (written by Actions)
data/feed.json                 auto-fetched headlines (written by Actions)
data/art.json                  resolved official key art (written by Actions)
data/portraits.json            character art map (written by Actions)
data/translations.json         English for non-English signal headlines
assets/portraits/              cached busts and waist-up cut-outs
assets/weapons/                cached weapon icons
scripts/fetch-feeds.mjs        the headline fetcher
scripts/fetch-art.mjs          the key art resolver
scripts/fetch-events.mjs       the event calendar builder
scripts/find-event-art.mjs     finds event banners inside Kuro's patch infographics
scripts/fetch-portraits.mjs    the character art resolver
scripts/fetch-weapons.mjs      the weapon stat, passive and icon resolver
scripts/fetch-kits.mjs         the roster, kit and banner-history builder
scripts/confirm-dates.mjs      retires estimated phase dates once they're known
.github/workflows/update-feeds.yml   cron, every 6h — feed, art, events, portraits, weapons
.github/workflows/update-kits.yml    cron, daily — resonators.json + kits.json
```

Six views:

| View | Source | Tiered? |
|---|---|---|
| Timeline | `versions.json` + `resonators.json` + `art.json` | — |
| Events | `events.json` + `versions.json` (patch windows) | yes, per event |
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

Persistent left rail (nav + quick links). The rail **is** the navigation —
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

Every view opens on its own name — one small mono line above the stack, drawn by
`pageTitle()` off the same `VIEWS` array the rail renders from. It is the overarching view
and nothing else: "Resonators", never "Resonators — Electro". Which filter is on is said
by the lit item in the rail's list, and a title that changes as you filter is a title you
have to re-read. Signals is the one panel whose own header used to say the view's name
too; it now carries only its run status and kind chips.

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
Methodology link was until it was moved onto `data-act="open"`.

**About the desk** — the standing description and that Methodology link — sits centred at
the foot of the page, directly above the copyright strip. It was a boxed card in the rail,
competing with the filters for a column that is otherwise all controls; it is orientation
you read once, so it goes where you finish rather than where you steer.

### Filters

One control, in one place: **the rail's filter lists**, carrying each view's single axis
— tier on Intel, element on Resonators, class on Weapons, now/next/past on Timeline
(`RAIL_FILTERS`). These are the questions the desk exists to answer. They used to be a
chip strip across the top of every panel, in a header that said the view's name a second
time and held the content a header's height down the page; both went, and the view's name
is the one-line page title above the stack instead. Signals is the exception, and keeps
its kind chips in its own header: it has a hatched warning bar under them, so that header
was never the bare strip the others were. Events has nothing to filter yet — one axis would be the patch, and the view is already grouped by it. Values are read off the data, so an element or a class nothing is filed under
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

The rail's tail is four **outbound links** — official news, Kuro's YouTube, and the two
subreddits — each carrying the mark of the site it opens. It used to be headed by three
*saved views* (a view plus a filter, applied before the switch so the list never
re-filtered a frame later); those went when the nav grew its own filter lists, because a
shortcut to a control two rows above it is furniture. The `jump` action went with them.
Nothing in that list points at a page that doesn't exist.

No framework and no build step. Each view renders its whole panel to `innerHTML` and
every click is caught by one delegated `[data-act]` handler on `document`, so a
re-render can't leave a stale listener behind.

### The landing view fits a screen

Timeline is Now / Next / Future across the top, the event band under it and the intel +
signals duo at the foot. That is the whole page — roughly 1750px at 1080p, where it used
to be about 4500. The band earns its height by being pictures: an event has a name, a kind
and a state, and nothing else worth printing at that size.

**The band is two rows of large tiles rather than one strip of small ones.** Each tile is a
fifth of the band and the headline takes two of those fifths, so a patch of eight events
comes out as the headline plus three, then four. Five slots to a row rather than four is
what makes that two rows and not three — the headline counts twice, so eight events is nine
slots, and four across leaves one stranded on a third row. The short row grows into what is
left, which is why this is a wrapping flex and not a grid: a grid would leave the hole.

The one banner shape that does not fill its tile is the double-drop title strip. Those are
3:1, with the event name set across them, and a 1.6:1 tile cropping the sides of one slices
the name in half — so an `art.nameplate` banner is shown whole on its own ground instead.

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

**Each banner is one tile, not two, and it reads across rather than down.** The
character down the left, the weapon down the right, and the words between them: name and
chips on the top line, the weapon it runs beside on the second. The weapon convene is a
separate pull and keeps its own click target, but it is *that character's* weapon — and
two free-floating tiles cost a stacked pair of rows each, which across five banners is
half a screen of card for a distinction the tile makes on its own.

It was a stack — portrait row over weapon row, split by a rule — and the stack was the
thing wasting the tile. A row 300px wide spent all of it on a 44px face, then spent a
second row underneath saying whose weapon it was, with the weapon's name at the opposite
end of the tile from the weapon.

**Two halves, and nothing smaller than a half.** The left half is the Resonator —
portrait, name, chips — and opens their record. The right half is the weapon — its name
against its picture — and opens the weapon's. Each half is one element, one tab stop, and
lights under the mouse, so which record a click will open is answerable before you click.
An earlier cut handed out a target per element, which is four things to aim at on a 250px
tile and no way to tell from looking where any of them went.

**The portrait gets 62px instead of 44**, flush to the tile's edges on three sides,
because a portrait inset by the tile's padding is a portrait giving a third of itself
back. The weapon's picture is 42px, which is what its half can afford now that the class
label is gone. That label (`RECTIFIER`, `SWORD`) carried two facts at once — a signature
weapon is by definition its holder's class — but neither is a fact anyone came to a patch
card for, and the space is the weapon's name.

**The tile asks about its own width, not the window's.** Two phase columns put it at
254px on a 1500px screen and 630px on a tablet, which is the same tile in two situations
no media query can tell apart — so `.bpair` is a `container-type: inline-size` and the
weapon's name sits beside its picture above 330px and above it below that. Under 330px
there is room for one of the two names on a line, and the failure mode of insisting on
both is `Thousanc` / `Deliveran` beside `Qing…`.

**The weapon drawer's own picture is `.wbig`, not `.wsig`.** The latter is the signature
*card* on a resonator record — a framed row whose `.wsig-art` box does the sizing — and a
bare `<img>` dropped into it has nothing constraining it at all, so the drawer opened on a
1000px render of a sword. Worth knowing because the two class names are one letter apart
and the CSS gives no error either way; the symptom is a weapon record you have to scroll.
Beware backticks inside those template literals, too: one in a comment ends the string
early, and `` `.wsig-art` `` in a note about this very bug is what made `drawerWeapon`
throw `art is not defined`.

**The strip fills the card.** Cards sit in one grid row and are all as tall as the
busiest, so the quiet one used to end its banner list two thirds of the way down and
leave a band of nothing above the footer. The tiles grow into it instead, capped at
104px so that a phase with one banner beside a phase with four doesn't draw a single
200px tile. Most of that slack came from one place: a future patch's `notes` is a
paragraph of accumulated leak history, and unclamped it ran to 950px in a 210px column,
stretching the row to 1437px. It is held to fourteen lines now — the whole note is a
click away on the version record, which is where a thousand words of provenance belongs.

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

The waist-up cut-out is the picture in every frame bigger than a tile: the record grid,
the record's own art panel, the drawer, the patch cards. One asset, one crop rule,
sixty characters.

It used to be two. The script also pulled the **gallery illustration** — the 2048×2048
picture at the foot of a character's own Prydwen page — and the big panels preferred it
wherever it existed, because 374px stretched across a 360px panel is soft. That is
gone, and consistency is why. The gallery slot holds two different kinds of picture
depending on when you ask. Before a character releases it is a standing render — one
figure, head at the top, clear air either side — which crops like a portrait. After
release Prydwen tends to swap in the Resonance Liberation splash: a wide painted scene
with the character somewhere inside it at a tenth of the size, with no crop that is a
picture of the character. Those had to be detected and dropped, which left the desk
with two populations at all times — whoever released most recently drawn from a
full-body square, everyone before them from the waist-up card — and a character
silently changing from one to the other on release day. The square is a whole standing
figure besides, so every frame that used it had to zoom back in to find a face, at a
different hand-tuned scale on a record, in the drawer, on a patch card and on a phone.
The card is identical for all sixty, already cropped to what the desk shows, and never
changes underneath anyone. That is the better trade, and it is why the newest six
characters no longer look like they came from somewhere else.

The files are cached into `assets/portraits/` rather than hotlinked — Prydwen is a fan
site paying for its own CDN. This README is where that is recorded; the page itself no
longer names its data sources under the art, only the © Kuro Games it has to. Prydwen is
behind Cloudflare, which 403s Node's `fetch` no matter what headers it sends; the script
shells out to `curl` for that reason, and it is still dependency-free.

A weapon debuting with an unreleased patch has no published icon yet and falls back to
the generic weapon mark — same rule as everywhere else here: show what is known.

Precedence, then, is: hand-set image → Prydwen waist-up cut-out → Kuro reveal poster →
crop of the patch key visual, for the big art; and the cut-out bust first for anything
small.

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

Full precedence: `banner.image` → `resonator.image` → Prydwen waist-up cut-out →
resolved reveal art → key visual crop → plate. The key visual crop
drops out on its own the moment Prydwen lists the character, so you don't have to go
back and clean it up. `"nameCN"` on a resonator becomes the plate glyph when there's no
image at all.

### Overriding the art for one character

A hand-set image wins over everything, including the fetched cut-out. Point a
resonator (or a banner row) at a file you have added to the repo:

```jsonc
"image": "assets/characters/qingxiao.webp",
"imageStyle": "cutout",                      // transparent PNG/WebP, not a full-bleed photo
"imageCredit": "Character art © Kuro Games · pre-release, from 3.6 beta files"
```

Use it sparingly. Qingxiao and Jingran were carried this way through the 3.6 beta,
before Prydwen listed them at all; the moment the fetcher could resolve a cut-out for
each, both overrides went, and nothing is hand-placed today.

`imageStyle: "cutout"` switches the panel to `object-fit: contain` with the figure
standing on the base, keeps the resonance rings and attribute glow visible behind it,
and lightens the scrim so the legs don't grey out. Without it the image is treated as
full-bleed and cropped.

Prep before committing one: trim the fully-transparent margins and downscale to ~1100px
on the long edge. Untrimmed 2048² files are roughly double the size for no visible gain
at the ~490px the card actually renders.

Never hotlink another fan site's CDN for these — it leeches their bandwidth and breaks
the moment they rename a file. Download it into `assets/`.

## The event calendar

`data/events.json`, written by `scripts/fetch-events.mjs` off two of Kuro's own EN posts,
because neither carries the whole thing:

| Post | What it has | What it hasn't |
|---|---|---|
| Version *x.y* **Content Overview**, on patch day | every event in the patch, its kind, a paragraph of flavour, an exact window in server time | any per-event art — the post is one header image and several thousand words |
| The per-event **notice** (`[Lament Recon: Tacet Crisis] Combat Event`, `Event Preview \| […]`) | the event's own 16:9 banner, its reward line | only exists for the events Kuro chooses to announce separately |

So the overview says what is running and when, the notice says what it looks like and what
it pays, and the fetcher matches them on the bracketed name. Windows keep the `+08:00`
Kuro publishes them in, so every clock the desk draws is the reader's own — which is what
makes "Ends in 2 days" a fact rather than a guess about whose midnight.

**The picture is the event's own banner or there is no picture** — cropped out of Kuro's update-content sheet when that is the only place it exists yet (see below). This is the rule the
first cut of this view got wrong: it borrowed a Resonator's key art for events that had
none, and a poster of Qingxiao above the words "The Strings Remember" reads as *her*
event, which no caption underneath can undo. An event with no notice yet draws the same
resonance rings a patch card draws when it has no key visual — the desk's existing mark
for a thing it knows is coming and has nothing to show of — and the rings go away by
themselves the day the notice lands.

Because Kuro's banner already has the event's name set across it, the desk's own name for
it sits in a bar *under* the picture rather than over it.

### Hand-written entries survive the fetcher

Between a preview broadcast and patch day, Kuro has announced a patch's events by name and
published nothing else about them: no dates, no art, no notice. Those go in by hand with
`"origin": "hand"`, and `fetch-events.mjs` keeps any hand entry whose name it does not
find in Kuro's own posts. The day Kuro publishes the real thing under the same name, the
fetched entry wins — that is the point of the flag.

A hand entry carries `version`, `name`, `kind`, `summary`, `detail`, `rewards`,
`eligibility`, its `source` and, optionally, `intel` — the id of the `news.json` entry the
claim came from, which renders in the drawer as a link into that entry. `alias` lists any
other name Kuro might bracket it under, so the fetcher supersedes it cleanly when the real
post lands. `startsWithPatch` marks the login track Kuro dates from "the Version x.y
update" rather than a clock time: it takes the patch's own state, so the desk cannot call
an event running while the patch card beside it still says the patch is a day out. An entry
with no dates at all inherits the patch window and says whose dates it is showing.

`headline: true` marks the patch's flagship — the double-width tile, at most one per patch.
A hand entry that claims it keeps it; otherwise the fetcher gives it to the first Special
Event carrying Kuro's own banner.

### Where an unreleased patch's banners come from

Kuro does not publish an event's banner as a file of its own until the patch is live.
Before that, the art exists in exactly one place: the **Update Content** post, as a single
tall infographic with a banner per event stacked down it, each beside its own window and
reward table. (That sheet is what gets reposted to Reddit whenever someone asks what is in
the next patch.)

So a hand-written entry can carry art after all — as a rectangle of that sheet:

```json
"art": {
  "url": "https://hw-media-cdn-mingchao.kurogame.com/object/…/k70f13…jpg",
  "crop": { "x": 78, "y": 1112, "w": 918, "h": 494 },
  "focus": "0% 50%",
  "nameplate": true,
  "title": "Wuthering Waves Update Content | Version 3.6 …",
  "source": "https://wutheringwaves.kurogames.com/en/main/news/detail/5310",
  "credit": "© Kuro Games",
  "note": "Kuro's own event banner, cropped out of the Version 3.6 update-content infographic — the only place they have published it so far."
}
```

`artUrl()` in `app.js` turns `crop` into `x-oss-process=image/crop,…/resize,…` on the
image URL. Kuro's CDN is Alibaba OSS, which does the cropping and the resizing itself, so
the desk asks that host for that region of that file — nothing is copied here and nothing
is cut up locally. `note` replaces the caption in the drawer, so the picture says what it
is a crop of. `focus` sets `object-position` for the two-per-patch banners that set their
name across one end and would otherwise lose half a word to the tile's own crop.

`nameplate` is those same banners said out loud, for the event record. The utility events —
the double drops — get a title strip out of Kuro's design team rather than a picture, and
the record shows those whole instead of laying its own title across them. It defaults to
false for a crop and true for a standalone notice banner, so it is only ever written on the
exceptions; two a patch, and you see which they are while you are matching previews to
events anyway.

`scripts/find-event-art.mjs <articleId>` does the measuring:

```
node scripts/find-event-art.mjs 5310
```

It pulls every image in the post, asks the CDN to re-render each as a small BMP (which is
how it reads pixels without an image library), finds the bands that are photographs rather
than page background, and prints a ready-to-paste `crop` plus a preview URL for each. What
it cannot do is name them — the sheet is pixels, so the event names are not machine
readable. Open the previews, match them up, paste them in. Ten minutes a patch.

None of this survives contact with a real notice, and it should not: the moment Kuro posts
`[Chord Cleansing] Limited-Time Echo Double Drop Event` as its own article, the fetcher
takes the standalone banner from it instead.

### The event record

A tile opens onto the one record on the desk built around a picture. Every other record
here is a page of facts with art on it; an event is the other way round, because what a
reader arrives with — *what is this, is it on, what does it pay* — is answered faster by a
banner, a row of item icons and four numbers than by any arrangement of the same words.

Top to bottom: Kuro's banner with the name, the window and the state set into it; the four
facts that decide whether to open the game tonight; what it is; what it pays; and then the
three boxes — what kind of thing it is, who can play it, where the desk got it.

**The hero holds two shapes of banner and behaves differently for each**, because the two
are different pictures:

| Art | What Kuro put on it | What the hero does |
|---|---|---|
| a `crop` out of the update-content infographic | usually nothing — Kuro draws those as art, which is the only reason a band of that sheet can be cut out and used at all | fills the right two-thirds and dissolves into the panel across its own left edge, with the record's title lying in the gradient |
| a standalone notice banner, or any crop flagged `"nameplate": true` | the event's name across it, in the game's display face, usually with the Wuthering Waves wordmark in a corner | shown whole, `object-fit: contain`, sitting beside the record's title rather than under it |

Which is the same judgement the tiles have always made — Kuro's banner says the name, so the
desk doesn't say it again over the top. The default falls out of `art.crop`, which the
calendar already records; `art.nameplate` overrides it, and in practice is written on the
two double-drop events a patch whose banner is a title strip rather than a picture.

An event with no banner at all draws the resonance rings, same as the tile.

### Rewards are the things, not the sentence

Kuro publishes a reward line as prose — `Astrite x1200, Space and Blake Bloom Medal (Event
Sigil), Modifier, Premium Tuner, Forgery Premium Supply - Lahai-Roi, and other materials.`
— and the record used to print it back as a bulleted list, which is the shape the sentence
arrived in rather than the shape the question comes in.

`rewardTokens()` splits it: the count off the end (`x1200`), the qualifier out of the
brackets (`(Event Sigil)`), one spelling for the dash Kuro writes three ways. What is left
is the item's name, and `data/items.json` maps that name to an icon:

```bash
node scripts/fetch-items.mjs
```

It reads every reward line in `events.json` and `permanents.json`, resolves each name
against the Wuthering Waves Wiki on Fandom — the same source the resonator database reads
— and caches the icon under `assets/items/`. Cached rather than hotlinked, unlike
everything from Kuro's own CDN, because Fandom rewrites its revision URLs.

The Astrite total gets its own mark on the tile, and it is deliberately large: a 40px
crystal in the corner of the picture, with the figure beside it. This is the one number
the page is scanned for — what a fortnight is worth is eight of these added up — and at
the 12px it started as, it was a footnote legible only once you had already decided to
read it. The stone carries across the grid; the figure is set smaller than it so the
badge doesn't read as a price tag. Only shown where Kuro published a reward line — see
`astriteFrom()`, which returns null rather than zero, because a tile reading `0 Astrite`
states something nobody said.

**It is Kuro's own item art, not a drawing of it.** `assets/items/astrite.png` has been
on disk all along — `fetch-items.mjs` pulls it with everything else an event pays, and
the reward grid has been showing it since the day that script was written. There was
never a reason for the badge to be the only place Astrite appeared as a glyph.
`astriteMark()` returns the picture where `items.json` has resolved and falls back to the
inline `i-astrite` otherwise, which is what draws in the moment before the JSON lands.
It is sized inline, because the badge sits inside `.ev-pic`, whose `img` rule fills the
box for the event banner behind it and wins over anything a class on the mark can say.

Two details worth knowing:

- **`page` says which half of a compound name is the item.** Kuro qualifies a generic item
  with where it drops (`Forgery Premium Supply — Lahai-Roi`) and a specific one with what
  it is (`Phantom — Myriad Snare: Rustfire Chassis`), so the qualifier is on the left in
  one and on the right in the other. The half the wiki answered under is the thing; the
  card sets the other one under it in smaller type.
- **A reward with no icon gets a plate naming its kind, not a borrowed picture.** Titles
  and event avatars have no item art because the game never hands them over as items — the
  card says `TITLE` and stops there.

`rewardTokens()` exists twice, once in `app.js` and once in `fetch-items.mjs`, and the two
have to agree: the script decides which names get an icon fetched, the renderer decides
which name is looked up when the record draws. Change one, change the other. Both files
say so where they are defined.

Rarity comes off the same wiki page and lights the icon's ground rather than being printed
as a number — it is the game's own grading and the only thing on a card that ranks one
reward against another.

### The reel, and why it is usually empty

`media` on an event is the rest of the pictures out of its notice, and the record shows
them as a reel under the banner — the frame, a strip of thumbnails, and the caption and
source swapping with it.

**It only draws when there is more than one picture.** The hero is already showing the
banner; a reel of exactly that frame six inches lower is the same photograph printed twice.

**And most notices have nothing to put in it.** A notice runs its 16:9 banner and then, as
often as not, the whole post over again as a single tall infographic — 1080×3738, the
duration and the eligibility and the reward table set as type down a poster. The desk holds
every one of those facts as data already, and one in a 16:9 frame is a thumbnail of a page.
So `isLandscape()` asks Kuro's CDN for the shape of each image before keeping it — their
host is Alibaba OSS and `x-oss-process=image/info` answers with the dimensions for free —
and anything outside roughly 1.25:1 to 2.5:1 is dropped.

Today that leaves every event with one picture and no reel. It fills in by itself the first
time Kuro puts a screenshot of a mode in its own notice, which is what the shape test is
there to be ready for.

### What it deliberately drops

- **Anything outside the desk's own patch windows.** Kuro's news page still carries the
  last two patches' notices, and an event that closed before the current patch opened is
  an archive, not a calendar.
- **The `[New Gameplay]` section of the overview**, which is permanent systems shipping
  alongside the events. A permanent menu addition has no window and nothing to miss.
- **Closed events, from the Events view.** This one used to keep them, grouped under the
  patch they ran in, and that is the wrong shape for the page: a patch's events all end on
  the same Tuesday, so the morning a patch turned over, the top of the page was nine tiles
  greyed out and the new patch sat underneath them. Nothing about a closed event is
  actionable and the desk keeps no history of one anywhere else, so there is nothing here
  for the entry to be the index of. An event drops off the day it closes, and its patch
  goes with the last of them.

Still not built: redemption codes.

### Permanent events

`data/permanents.json`, written by `scripts/fetch-permanents.mjs`, and the one calendar
that does not come from Kuro. A permanent event has no window and gets no notice: it was
announced once, in a patch that shipped up to two years ago, and Kuro's news feed stopped
carrying that post long before this desk existed. `fetch-events.mjs` reads a hundred days
back; Echo Hunters has been in the game since launch day, 2024-05-23.

So this half reads the wiki — `Category:Permanent Events`, the `{{Event}}` infobox for the
dates and the type, `{{Description}}` for Kuro's own blurb, `{{Event Rewards}}` for the
payout. **The category is not the filter.** It holds 37 pages and 18 of them have a real
closing date on the infobox, because the wiki files an event there when the *mode* it
added stays in the game — which is a different claim from the event still being open. A
Glimpse of Xuanfang is in that category and closed on 2026-08-19, which the desk knows
because Kuro said so. `time_end = none` is the field that means what this file means, and
it is what the first filter reads.

The second filter is about who the event is for. Six of the nineteen that pass are the
game's own onboarding: three **Login** tracks paying out for turning up on consecutive
days, and three **Next Stop: \<region\>** passes that skip a returning player forward to the
current map. Those never close because they are not events, they are a ramp — the game
keeps them open for whoever installs it next year. The in-game Permanent tab does not list
them and neither does this. The wiki labels both groups itself, in `group2`, so the filter
is that label rather than a list of names to keep up to date. 13 events, launch day to now.

The banners come down at 720px into `assets/events/` rather than being hotlinked, the same
call the reward icons and the portraits make — these are Kuro's own event banners, hosted
by Fandom, and a page fetching a dozen pictures off a wiki CDN on every load is a page borrowing
somebody's bandwidth. Every one of them carries the event's name set across it, so they are
shown whole in the tile rather than filled to it, same flag and same reason as the
double-drop title strips: a 1.6:1 tile cropping a 4:1 banner turns *Tales of the Isles*
into *les of the Isles*, which reads as a broken image rather than as a crop.

The two lists are merged in `gameEvents()` so that a card, a record and a search all see
one calendar. Where both files hold the same event — a patch's permanent addition, which
Kuro announced in an overview the desk still reads — Kuro's own entry wins and takes the
wiki's banner if it hasn't got one: Kuro's words about a Kuro event, and the only picture
anyone has. Permanent events are pulled out of the patch panels into a section of their
own, because they have no deadline, which is the one thing the patch panels sort by, and
half of them predate any patch the desk holds a record of. The record says
`The Wuthering Waves Wiki on Fandom` under "Written by" rather than implying a post the
desk could go and show you.
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

### The record

Built the same way the event record is, and for the same reason: the picture is what a
reader arrives at, so it holds the page rather than sitting in a box on it.

What this replaced was a 4:5 art panel across the full width of the modal with everything
the record had to say underneath it. At 1500px that is a 400px cut-out standing in a field,
and the name, the element and the kit all started below the fold.

Top to bottom now:

| Band | What's in it |
|---|---|
| **Hero** | Kuro's art down the middle, dissolving into the panel; element, rarity, name, epithet, confidence, status and which banner they run on set into the left; the signature weapon on the far side, picture first and name under it |
| **At a glance** | Element, weapon, role, region, debut, released, reruns — seven tiles |
| **Combat kit** | The six slots in the order you press them, each jumping to its own card |
| **Skills** | The six cards, then the Inherent Skills, then the Resonance Chain |
| **Release history / Sources** | Debut → first release → whether they have ever come back, beside where the desk got any of it |

**The art has two shapes and the hero knows which.** A cut-out — a bust on a transparent
ground, which is what `portraits.json` resolves for nearly everyone — is `object-fit:
contain` and stands at its own proportions with a fade at the foot. Anything else is a
crop, `cover`, anchored high, because Kuro draws these as portraits and the half worth
showing is the top. Where the hero carries a rail the picture stops before it, and fades
on that side too: a cover crop cut off square against a glass card reads as the card
standing on a photograph that ran out.

Where the picture starts and stops is two custom properties on the hero — `--pic-l` and
`--pic-r` — rather than four selectors fighting over `inset`. The breakpoints move the
rail, so all they have to move is the numbers.

**The rail is the signature weapon and nothing else.** It is the only other object on the
page — a thing Kuro drew, that a reader wants to look at — so it gets the column at a size
worth looking at: the picture leads and the name sits under it, the way the game shows one
in an inventory. Everything that is a fact about the Resonator rather than an object goes
where the facts are, which is why the banner they run on moved into the copy.

The rail is skipped entirely for anyone with no signature, and the art takes that width
instead — ten of the sixty are in that state, and an empty box standing beside the name is
worse than the room it was holding.

### Elements and kit slots are drawn here

`index.html` carries a glyph for each of the six elements and each of the six kit slots.
Both sets are the desk's own marks, not the client's: these render at 13px beside a name
and at 56px in the rotation band, and the game's own attribute icons are painted 128px
badges with a bevel on them. Each glyph inherits `currentColor`, which the record sets to
`--attr`, so a Glacio record's marks are Glacio-coloured without a second table of hex to
keep in step.

The same mark appears at three sizes — the element beside the name, in the At a glance
tile, and in the sprite the grid card already uses — so they read as one thing.

### One card out of Simplified

The **Simplified** toggle is still what keeps six skill cards to a grid: every paragraph
cut to its first sentence, every card stopped at five lines, and the count of what was
dropped shown rather than swallowed.

That count is now the card's own way out. A condensed card carries `View details · +25
lines`, and clicking it swaps that one card to the full text — the kit is already in
memory, so it costs a lookup and an `innerHTML`, not a redraw. The toggle is a preference
about the whole record; this is a reader who wants this skill and not the other five, and
redrawing on it would shut every other card they had already opened.

`kitGist()` returns `{html, cut}` for this reason: the card turns the count into a button,
and a Resonance Chain node — still a `<details>`, still shut — prints it as a note.

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

Run any fetcher by hand — each prints what it kept and only writes when something
changed. `node scripts/fetch-feeds.mjs` for the headlines; `node scripts/fetch-kits.mjs`
for the roster and kits, which is the slow one at ~140 requests across two hosts and is
worth running manually on patch day rather than waiting for the daily cron.

### Bump the asset version when you touch CSS or JS

`index.html` references `assets/app.css?v=N` and `assets/app.js?v=N`. **Bump `N` on both
whenever either file changes.** GitHub Pages serves assets with `max-age=600`, and
browsers hold them longer than that, so without the bump a deploy can look like nothing
happened — the new HTML loads against yesterday's stylesheet. The query string changes
the URL, which is the only thing a cache reliably keys on. `index.html` and the JSON
under `data/` are re-fetched normally, so they need no such treatment.

## What updates itself, and what doesn't

Two crons and one derived field between them cover everything that is a fact. What's
left is the editorial, which is the part worth your time.

**Automatic, no commit needed** — computed in the browser on every page load:

- Which patch is `live`, `announced` or `past`, and therefore which one is "current"
- Phase open/closed state, the progress marker, "Day 14 of 42", "In 6 days"
- The New / Upcoming corner flags across the whole resonator grid
- Every clock, in the reader's own timezone

**Automatic, by cron** — `update-feeds.yml` every 6h, `update-kits.yml` daily:

| Writes | From | Works from Actions? |
|---|---|---|
| `feed.json` | six news sources | yes |
| `art.json` | Kuro's reveal posts | yes |
| `events.json` — the calendar, its windows and its banners | Kuro's patch notes and event notices | yes |
| `permanents.json` + `assets/events/` — everything the game keeps, and its banners | Fandom's `Category:Permanent Events` | yes |
| `items.json` + `assets/items/` — reward icons | Fandom, off the reward lines in both calendars | yes |
| `resonators.json` — identity, debut, reruns | Fandom | yes |
| phase dates in `versions.json` | Fandom convene pages, once a phase has run | yes |
| `kits.json` — skill text | Prydwen | **no — run locally** |
| `portraits.json` + `assets/portraits/` | Prydwen galleries | **no — run locally** |
| `weapons.json` + `assets/weapons/` | Prydwen weapon pages | **no — run locally** |

All of them are driven off the names already in `versions.json`, so writing a banner row
is what queues that character's art, portrait, weapon and kit. You never hand-place an
image — but see below for which half of that arrives on its own.

### Prydwen does not serve GitHub Actions

**Prydwen returns a flat 403 to a datacenter IP.** Not a challenge page, not a rate
limit — a refusal, in under a second, every time. The same fetch from a home connection
is served normally. It's their bandwidth and their call, and there is nothing here that
tries to get around it.

The practical consequences, because they are easy to miss:

- `fetch-portraits.mjs` and `fetch-weapons.mjs` **have never once succeeded in a
  scheduled run.** They are marked `continue-on-error`, which paints the step green in
  the Actions UI whatever happens, so this failed silently for a long time. Everything
  in `assets/portraits/`, `assets/weapons/` and `data/weapons.json` got there from a
  local run.
- `fetch-kits.mjs` splits along the same line and carries on with the half it can reach.
  From Actions it builds the full index off the wiki — identity, debut, rerun history,
  and the convene dates `confirm-dates.mjs` needs — and leaves `kits.json` exactly as it
  found it, logging which characters are waiting on a local run. It exits 0: a wiki
  refresh is a real result, not a failure.

So the daily cron keeps the timeline and the banner history current on its own, and
**new characters' kit text, portraits and weapon icons need one local run** — realistically
on patch day, when you're editing `news.json` anyway:

```bash
node scripts/fetch-kits.mjs && node scripts/confirm-dates.mjs
node scripts/fetch-portraits.mjs
node scripts/fetch-weapons.mjs
```

**Still yours**, and no script will ever do it: `news.json` entries and their tiers,
`outcome` on a leak that resolved, `translations.json`, and the `keyVisual*` crop values.

### Estimated dates retire themselves

A patch is written up weeks before it ships, so its phase boundaries start as arithmetic
on past patch lengths and carry `estimated_start` / `estimated_end`, which render as
"(est)". Kuro confirms them later, and somebody used to have to go and edit the file.

They don't. Every banner has a convene page on the wiki carrying its real start and end,
`fetch-kits.mjs` already parses those into each Resonator's `runs`, and a phase is
exactly the window its banners ran in — so `confirm-dates.mjs` reconciles them back into
`versions.json`. It fetches nothing; it reads what the kit builder just wrote, which is
why it runs immediately after it.

The catch is that it is retrospective: a phase's dates are confirmed once that phase has
started, not when Kuro announces them. It closes the estimate out mid-patch rather than
ahead of time, which is worth having but is not a reason to skip reading the notice.

Three rules keep it off your writing:

- An estimate is replaced by a confirmed date, and a blank is filled. That's the job.
- **A date not marked estimated is never overwritten.** If the wiki disagrees with
  something you wrote down as confirmed, that wants a human, so it's reported and left
  alone.
- **A phase's banners must agree unanimously.** Two convenes claiming different windows
  is a parsing problem, not a confirmation, so the phase is skipped.

### The timeline keeps its own time

`status` in `versions.json` used to be hand-set, which meant the desk called 3.5 current
until somebody edited a string — at midnight, on the day a patch drops, which is the one
moment the timeline is actually being read. The dates sat in the same object saying
otherwise. So `statusOf()` in `app.js` derives it, and `versions.json`'s own value now
only survives where arithmetic has nothing to say:

- **Live and past are computed** from `start` and the last phase's `end`, against the
  reader's own clock. A patch flips at their midnight, with no commit and no cron lag.
- **`beta` is never upgraded.** `beta` → `announced` means "Kuro has announced this",
  which is a confidence call on a par with the intel tiers, and no amount of date
  arithmetic earns it. A beta patch with a projected start stays beta until you say
  otherwise — and then flips itself on the day.
- **An estimated end never retires a patch.** A patch goes `past` when a later one has
  actually started, or when its own *confirmed* end has passed. 3.6's phase 2 end is a
  guess, and a guess that runs short must not blank the timeline mid-patch.

`current` is read off the live patch the same way. The `current` and `status` fields are
kept in the file as a fallback for a desk with no dated versions at all — they are no
longer the source of truth, so don't bother maintaining them.

`scripts/fetch-kits.mjs` carries a copy of this rule in `deriveCurrent()`, because that
is what decides when a kit is promoted to `official`, and the two must agree — otherwise
a character can read as released on the grid next to a kit still marked pre-release.
**Change the rule and you change it in both places.** A shared module would be tidier
and would cost the project its no-build-step property, which is a bad trade for fifteen
lines.

### The kit builder refuses to write a thin file

`pool()` records a blocked page as an error and carries on, so before the guards below a
blocked run would have reached the end, built an empty `kits` object and written it over
636KB of kit text. Four things now stop that:

1. **Prydwen being unreachable is handled, not fatal.** A 403 on the roster means the
   kit half is skipped entirely — no kit pages are even attempted — and the run
   continues on wiki data. See above.
2. **The kit map merges over what's on disk** rather than being rebuilt from nothing, so
   a page that failed keeps yesterday's kit and only a page that actually parsed
   replaces one. `hasKit` counts a carried-over kit, so a bad run can't strip the badge
   off sixty cards either.
3. **A roster that arrives but parses to nothing aborts the run.** Being handed a page
   and making no sense of it is a different thing from being turned away — it's how a
   parser goes quietly stale — so that one fails loudly.
4. **Any shrinkage aborts the run.** Kits and records only ever get added, so a fall in
   either count means the markup changed, and yesterday's file is worth more than
   today's.

A run that trips 3 or 4 exits non-zero and writes nothing, so the job goes red and the
data is untouched. One consequence of the merge worth knowing: `kits.json` is additive
now, so renaming a character in `resonators.json` leaves their old kit behind under the
old key. It's inert — nothing looks it up — but delete it if you're tidying.

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

- Character art is cached into `assets/portraits/`, weapon icons into `assets/weapons/` and
  reward item icons into `assets/items/`
  by the fetchers, and a hand-set override
  may be added under `assets/characters/`. This is a deliberate call: it's Kuro's IP, it's
  the thing that gets fan sites taken down, and the project accepts that risk. Every such
  image carries a `© Kuro Games` line on the card. If the risk calculus ever changes, delete the
  `image` fields and the cached files and the cards fall back to hotlinked key art on
  their own.
- Everything else still links out rather than being copied — sources, articles, threads.
- Never promote a `reported` entry to `official` without an actual Kuro source.
- Beta multipliers shift between phases. Say so on every kit entry.

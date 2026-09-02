# Resonance Desk

## [→ Open the live desk](https://jikkles.github.io/wuwa-resonance-desk/)

`jikkles.github.io/wuwa-resonance-desk`

Wuthering Waves patch timeline, leak feed and resonator database. A static site — no
build step, no dependencies. Push to `main` and GitHub Pages serves it.

## What's on it

| View | Shows |
|---|---|
| Timeline | every patch, its phases and its banners |
| Events | the event calendar, patch by patch |
| Pull calculator | what a patch pays, what it costs, and the odds |
| Intel | curated leaks, each with a confidence tier |
| Live Signals | raw auto-fetched headlines, untiered |
| Resonators | the roster — identity, kit, builds and teams |
| Weapons | stats and passives at level 90 |
| Echoes | echoes, sonata sets and where to farm them |

Intel is you deciding what a leak was worth; Signals is a cron job telling you something
happened. That is why only one of the two carries tiers.

## Confidence tiers

Every intel entry gets one. The colour is load-bearing — it drives the card rail, the
filters, the palette dots and the footer legend.

| Tier | Confidence | Means |
|---|---|---|
| `official` | 4/4 | Kuro said it — livestream, patch notes, in-client notice |
| `datamined` | 3/4 | Beta client files. Real numbers, pre-balance |
| `reported` | 2/4 | Leaker with a track record, no file evidence |
| `rumour` | 1/4 | Single source, or contested |

Never promote to `official` without an actual Kuro source. Set `"outcome": "confirmed"`
on an old entry once confirmation lands — that is how each source builds a visible track
record.

## The files

```
index.html      shell markup — rail, HUD, panels, drawer, palette
assets/app.css  all styling
assets/app.js   reads the JSON, renders every view
data/*.json     the data
scripts/*.mjs   the fetchers that write most of it
```

**Yours to write** — no script will ever touch these:

| File | What you write |
|---|---|
| `data/news.json` | intel entries and their tiers |
| `data/versions.json` | a patch's `notes`, and the `keyVisual*` crop values |
| `data/events.json` | events Kuro has named but not yet published (`"origin": "hand"`) |

Everything else — roster, kits, builds, weapons, echoes, events, art, portraits, the
headline feed, the patch archive — is fetched. The fetchers only ever fill blanks: a
field with a value in it survives every run.

## Working on it

Serve the folder rather than opening `index.html` off disk. Browsers block `file://`
fetch, so every panel falls back to empty:

```bash
npx serve
```

**Bump `?v=N` on both `assets/app.css` and `assets/app.js` in `index.html` whenever you
touch either file.** Pages caches them for longer than a deploy takes, so without the
bump a change can look like nothing happened.

Two crons keep the data current — every 6h for the feed, art and events, daily for the
roster and archive. Prydwen refuses GitHub Actions with a flat 403, so **kits, portraits,
weapons, echoes and builds need a local run**, realistically on patch day:

```bash
node scripts/fetch-kits.mjs && node scripts/confirm-dates.mjs
node scripts/fetch-portraits.mjs
node scripts/fetch-weapons.mjs
node scripts/fetch-echoes.mjs
node scripts/fetch-builds.mjs
```

Each prints what it kept and only writes when something changed.

## Art

Character art, weapon icons, echo renders and reward icons are cached into `assets/` by
the fetchers. It is Kuro's IP and the project accepts that risk — every card carries a
`© Kuro Games` line. Everything else links out rather than being copied.

## The long version

[docs/design-notes.md](docs/design-notes.md) — why each view looks the way it does, how
every fetcher works and what it refuses to do, where the numbers come from, and the
mistakes that shaped all of it.

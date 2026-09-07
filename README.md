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
| Weapons | stats and passives at level 90, shipped and beta |
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

## Beta client records

The Weapons, Echoes and Resonators views also draw things that are only in the beta
client — a weapon Kuro has built and not shipped, a sonata set that exists with nothing
rolling it, the whole kit of a Resonator nobody has written up. Those are marked **Beta**
on the card and **Datamined** in the record, and say in as many words that the numbers
are pre-balance.

| File | Holds | Loaded |
|---|---|---|
| `data/clientfiles.json` | unshipped weapons and sonata sets | at boot |
| `data/clientkits.json` | kits for Resonators no live source has written up | on demand, with `kits.json` |

Separate files rather than rows in `weapons.json`, `echoes.json` and `kits.json` because
those are filled by fetchers that would drop or outrank a beta row. `assets/app.js`
merges at read time and a name the live sources already carry always wins — so the moment
Prydwen or the wiki publishes a page, the beta record stops being drawn.

The kit importer reads the client's 17-node skill tree. The mapping from node to slot was
read off a Resonator the desk already had a kit for and checked against seven more, and a
tree that doesn't match is refused rather than filed under the wrong headings. It keeps
the sub-ability headings the client writes and Prydwen flattens away, so a beta kit is
better organised than a shipped one. It drops the Tune Break node — every Resonator has
one and it's identical between everyone holding the same weapon class.

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
headline feed, the patch archive, the beta client records — is fetched. The fetchers only
ever fill blanks: a field with a value in it survives every run.

## Working on it

Serve the folder rather than opening `index.html` off disk. Browsers block `file://`
fetch, so every panel falls back to empty:

```bash
npx serve
```

**Bump `?v=N` on both `assets/app.css` and `assets/app.js` in `index.html` whenever you
touch either file.** Pages caches them for longer than a deploy takes, so without the
bump a change can look like nothing happened.

Two crons keep the data current — every 6h for the feed, art, events and beta client
records, daily for the roster and archive. Prydwen refuses GitHub Actions with a flat
403, so **kits, portraits, weapons, echoes and builds need a local run**, realistically
on patch day:

```bash
node scripts/fetch-kits.mjs && node scripts/confirm-dates.mjs
node scripts/fetch-portraits.mjs
node scripts/fetch-weapons.mjs
node scripts/fetch-echoes.mjs
node scripts/fetch-builds.mjs
node scripts/fetch-client-files.mjs
```

`fetch-client-files.mjs` runs on the 6h cron too, but it reads `weapons.json` and
`echoes.json` to decide what is unshipped — so after a local weapons or echoes run,
run it again or it will keep listing something that has since landed.

Each prints what it kept and only writes when something changed.

## Art

Character art, weapon icons, echo renders and reward icons are cached into `assets/` by
the fetchers. It is Kuro's IP and the project accepts that risk — every card carries a
`© Kuro Games` line. Everything else links out rather than being copied.

## The long version

[docs/design-notes.md](docs/design-notes.md) — why each view looks the way it does, how
every fetcher works and what it refuses to do, where the numbers come from, and the
mistakes that shaped all of it.

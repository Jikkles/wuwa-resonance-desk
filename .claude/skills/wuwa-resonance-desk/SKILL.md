---
name: wuwa-resonance-desk
description: Maintain Tom's Wuthering Waves Resonance Desk — the patch timeline, leak feed and resonator database at data/*.json. Use whenever Tom says "run the wuwa update", "update the resonance desk", "update the wuwa desk", "add this to the desk", "new beta leaks", or attaches versions.json / news.json / resonators.json from the desk. Also trigger when Tom pastes a Chinese or Korean leak post, Bilibili link, NGA thread, Arca.live post or screenshot and wants it translated into a desk entry, or asks to promote leaks to official after a Kuro broadcast.
---

# WuWa Resonance Desk

Single-file HTML shell reading three JSON files. The shell is rarely touched — the work is almost always in `data/`.

## Files

| File | Holds |
|---|---|
| `data/versions.json` | Patch timeline, banner phases, dates |
| `data/news.json` | Curated entries — the feed |
| `data/resonators.json` | Character kit database |
| `data/feed.json` | Auto-fetched headlines. **Never hand-edit** — Actions overwrites it |

Every run updates the `updated` field on any file it touches. Date format is `YYYY-MM-DD` throughout.

## Confidence is the whole point

Every entry gets exactly one tier. This is what makes the desk worth more than a Sportskeeda article.

| Tier | Shows as | Means |
|---|---|---|
| `official` | **Confirmed by Kuro** (solid red) | Kuro said it. Livestream, patch notes, in-client notice, drip marketing. |
| `datamined` | **Beta files** (green) | From beta client files. Real numbers, pre-balance. |
| `reported` | **Leaker claim** (blue) | Leaker with a track record. No file evidence attached. |
| `rumour` | **Unverified** (grey) | Single source or contested. |

Each entry also carries a left stripe in its tier colour, so the feed reads at a glance.

**Rules that don't bend:**

- Never promote to `official` without an actual Kuro source. An aggregator reporting on the broadcast is fine; an aggregator reporting on a leaker is not.
- Every `datamined` kit entry says multipliers are pre-balance somewhere in the body.
- Roadmap claims more than two versions out cap at `reported`, however confident the source sounds.
- Contradicting sources → take the later datamine, and log the earlier entry as `outcome: "superseded"` rather than deleting it.

## Track record

`outcome` is what compounds. When a leak resolves, set it on the **original entry** — don't rewrite the body, don't change the date.

- `"confirmed"` — official confirmation landed and it was right
- `"superseded"` — later data replaced it

Over a few patches this builds a visible hit rate per source. Deleting wrong entries destroys that, so don't.

## Cadence

Four sessions per version, ~6 week cycle:

1. **Beta opens** (~3 weeks pre-patch) — heaviest. Kits, banner order, materials. Everything lands `datamined` or `reported`. Add the incoming version to `versions.json` with `status: "beta"`.
2. **Beta phase 2** — reconcile changed multipliers. Mark superseded entries.
3. **Preview broadcast** (~1 week pre-patch) — promote to `official`, set `outcome` on leaks that held, flip `status` to `announced`, fill real dates.
4. **Patch day** — previous version `status` → nothing/archived, new version → `live`, update `current`, add the next version as `beta`.

Between those: ad-hoc single entries.

## Translating CN/KR sources

The reason the desk exists. When Tom pastes a Bilibili, NGA, Arca.live, DCInside or Weibo post:

- Translate the substance, not word-for-word. Game terms use the **English client's** names, not literal translations — 共鸣解放 is Resonance Liberation, not "resonance release".
- Keep the original site name in `sources[].name` and set `lang` to `zh` / `ko` / `ja`. The desk badges it.
- If the post is a leaker relaying someone else's datamine, that's `reported`, not `datamined`. Only actual file evidence earns the `datamined` tier.
- Note when CN community sentiment diverges from EN — that's genuinely useful signal the English sites don't carry.

## Schema notes

`news.json` entry:

```json
{
  "id": "2026-08-07-36-preview",
  "date": "2026-08-07",
  "version": "3.6",
  "category": "banner|kit|weapon|event|system|story|qol|cosmetic|meta",
  "confidence": "official|datamined|reported|rumour",
  "title": "",
  "body": "",
  "tags": [],
  "sources": [{ "name": "", "lang": "en", "url": "" }],
  "outcome": "confirmed|superseded"
}
```

`id` convention is `date-version-slug`. Must be unique — new entries append, never overwrite.

`resonators.json` carries split confidence: `{ "identity": "official", "kit": "datamined" }`. Identity (attribute, weapon, rarity) usually confirms via drip marketing well before the kit does, so these move independently.

## Artwork

Character art has one source: **the picture at the foot of that character's Prydwen page, under
"Gallery"** — e.g. `https://www.prydwen.gg/wuthering-waves/characters/yangyang-xuanling`. It is the
official 2048x2048 illustration with a real alpha channel, and it is what every art panel on the
desk uses. Don't hand-place a picture found elsewhere; run the fetcher.

```
node scripts/fetch-portraits.mjs
```

It resolves `https://cdn.prydwen.gg/images/wuthering-waves/characters/<slug>_full.webp` from the
slug, falls back to scraping `class="full-image"` off the character page, and writes
`assets/portraits/<slug>-full.webp` plus a record in `data/portraits.json`. Nothing manual, and a
character added to `versions.json` or `resonators.json` pulls their own art on the next run.

Two things to know about that gallery slot:

- **It holds two kinds of picture.** Before release it is a standing render of the character. After
  release Prydwen often swaps in the Resonance Liberation splash — a wide painted scene with the
  character small inside it. A scene has no crop that is a picture of the character, so the fetcher
  measures it (a scene's alpha plane costs 38-49% of the file, a standing render's 6-19%), logs it
  as `gallery: "scene"`, and doesn't keep it. Those characters fall back to Kuro's reveal poster
  from `fetch-art.mjs`, which is already a portrait. This is why the desk's art is not uniformly
  from one place, and it is working as intended.
- **Nothing upstream is a better source.** Kuro's own site is a client-side app with no public asset
  index, and their reveal-post CDN only carries the 1080x1920 marketing poster. Prydwen is where the
  cut-out illustration lives, and the footer credits them.

To override for one character, set `image` / `imageStyle: "cutout"` / `imageCredit` on their entry
in `resonators.json` — that beats everything. Use it sparingly; it goes stale.

## Rules

- Don't host datamined art or client assets. Link out. That's what gets these sites taken down.
- Body copy is plain and declarative. No "leaks say" hedging in the text — the tier already does that job.
- Estimated dates get `estimated_start` / `estimated_end` booleans, which render as `(est)`.
- After editing, validate: `node -e "JSON.parse(require('fs').readFileSync('data/news.json','utf8'))"`.
- If working over attachments rather than Claude Code, remind Tom the browser caches nothing but he does need to actually commit and push the returned files.

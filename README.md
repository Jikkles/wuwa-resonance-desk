# Resonance Desk

Wuthering Waves patch timeline, leak feed and resonator database. Static site, no build step.

## Layout

```
index.html                     shell — reads the JSON, renders four tabs
data/versions.json             patch timeline + banner phases
data/news.json                 curated leak/news entries
data/resonators.json           character kit database
data/feed.json                 auto-fetched headlines (written by Actions)
scripts/fetch-feeds.mjs        the fetcher
.github/workflows/update-feeds.yml   cron, every 6h
```

Four tabs:

| Tab | Source | Tiered? |
|---|---|---|
| Timeline | `versions.json` + `resonators.json` | — |
| Feed | `news.json` | yes, by hand |
| Auto Feed | `feed.json` | **no** — raw lead list |
| Resonators | `resonators.json` | yes, per kit |

The split matters. Auto Feed is a machine telling you something happened; Feed is you
deciding what it was worth. A cron job can't judge whether a post is a datamine or a
guy guessing, so nothing it fetches carries a tier.

### The hero cards

The Timeline tab opens with big panels for the new Resonators on the next `announced`
patch, plus a rerun row. Banner rows in `versions.json` are matched by `name` against
`resonators.json`, so the kit list ("what we know") and its confidence tier come from
the resonator record — don't duplicate that into `versions.json`.

Cards render a typographic plate by default. Add `"image": "<url>"` to a banner or a
resonator to swap in real art — official key art only, per the rules below. `"nameCN"`
on a resonator is used as the plate glyph when there's no image.

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

Opening `index.html` straight off disk works but the JSON won't load (browsers block `file://` fetch). Run `python3 -m http.server` in the folder to preview locally.

Run the fetcher by hand with `node scripts/fetch-feeds.mjs` — it prints kept/fetched
counts per source and only writes when something changed.

## Confidence tiers

The whole point of the desk. Every entry gets one.

| Tier | Shows as | Means |
|---|---|---|
| `official` | Confirmed by Kuro | Kuro said it. Livestream, patch notes, in-client notice. |
| `datamined` | Beta files | Pulled from beta client files. Real numbers, pre-balance. |
| `reported` | Leaker claim | Leaker with a track record. No file evidence attached. |
| `rumour` | Unverified | Single source or contested. |

Set `"outcome": "confirmed"` on an old entry once official confirmation lands — the feed marks it, which is how you build a visible track record for each source over time.

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

- Don't host datamined art or client assets. Link out. That's what gets these sites taken down.
- Never promote a `reported` entry to `official` without an actual Kuro source.
- Beta multipliers shift between phases. Say so on every kit entry.

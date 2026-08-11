# Resonance Desk

Wuthering Waves patch timeline, leak feed and resonator database. Static site, no build step.

## Layout

```
index.html                     shell — reads the JSON, renders three tabs
data/versions.json             patch timeline + banner phases
data/news.json                 curated leak/news entries
data/resonators.json           character kit database
data/feed.json                 auto-fetched headlines (written by Actions)
scripts/fetch-feeds.mjs        the fetcher
.github/workflows/update-feeds.yml   cron, every 6h
```

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
3. Add YouTube channel IDs to `scripts/fetch-feeds.mjs`. The `UC...` string, not the `@handle` — find it in the channel page source.

Opening `index.html` straight off disk works but the JSON won't load (browsers block `file://` fetch). Run `python3 -m http.server` in the folder to preview locally.

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

**Automated** (in `fetch-feeds.mjs`):
- r/WutheringWavesLeaks and r/WutheringWaves via `/new.json`
- YouTube RSS for official and leak channels

**Worth automating next:**
- 库街区 / kurobbs.com — Kuro's official CN community. Announcements land here before global. Highest-value feed on the list and entirely legitimate.
- Official global news page

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

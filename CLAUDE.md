# Resonance Desk — working notes for Claude

## Git

**Commit and push straight to `main`. Do not create a branch, and do not open a PR.**

This overrides the default "if on the default branch, branch first" behaviour. The desk
is a single-author static site deployed from `main` — every commit in the history lands
there, including the automated `chore: refresh data` runs from `.github/`. A feature
branch does not deploy, so it is not a safer version of the same thing, it is just an
extra merge standing between a change and the live site.

Push without asking each time. Still worth a sentence in the reply saying what was
pushed.

Other git habits here:

- Conventional-commit subjects in lower case — `feat:`, `fix:`, `chore:` — written as a
  claim about the desk rather than a description of the edit. "fix: show the whole role
  tag list, not the first word of it", not "fix: update roleTags rendering".
- One commit per change. If a session produced two unrelated changes, split them.
- The body is for the reasoning that is not obvious from the diff: what the old
  behaviour got wrong, and why this is the right correction. Skip it when the subject
  already says everything.

## Beta client data is a stopgap, never the destination

**Pull kits, weapons and sonata sets out of the beta client whenever they exist, and let
the live sources take them back the moment they publish.** That is the standing policy,
not a one-off — a Resonator or a weapon should never sit on this desk with nothing behind
it just because it has not shipped.

`node scripts/fetch-client-files.mjs` does the pulling. It runs on the 6h cron, so new
beta content arrives on its own; run it by hand after any local `fetch-kits.mjs` or
`fetch-weapons.mjs` run, because it decides what is unwritten by diffing against those
files.

The handover is already enforced in code, in two places, and neither should be loosened:

- The fetcher only writes a record for a name the live file has no entry for.
- `loadKits()` and `mergeBeta()` in `assets/app.js` merge live-first, so even a stale beta
  record loses to a published one.

**The half that is not automatic**: Prydwen returns a flat 403 to GitHub Actions, so
`fetch-kits.mjs`, `fetch-weapons.mjs` and `fetch-builds.mjs` only ever deliver from a local
run. A Resonator can therefore go live while the desk is still drawing their beta kit and
beta signature weapon. `scripts/patch-day-alert.mjs` runs last in the feeds job and opens
the GitHub issue **"Patch day: released Resonators still on beta data"** when that happens
— it names who, lists the exact fetchers to run, comments when a new name joins, and closes
itself once the live data has been pushed. The fix it asks for is always this shape:

```bash
node scripts/fetch-kits.mjs && node scripts/fetch-weapons.mjs && \
  node scripts/fetch-builds.mjs && node scripts/fetch-client-files.mjs
```

Then rewrite that Resonator's hand-written `kit` notes in `resonators.json` against the
live kit: they were written from leaks, no fetcher touches them, and once the kit tier is
official they read as Kuro's word. `node scripts/patch-day-alert.mjs` on its own prints the
same report locally without touching the issue.

There is deliberately no wiki fallback for weapons: the wiki's stats module holds level 1
figures (the desk shows level 90 and infers no curve) and lagged days behind release.
Beta text is pre-balance: multipliers move and mechanics get cut between the beta and the
live build, which is the whole reason the live version has to win.

Every record drawn from beta files must say so — the `Beta` flag, the `Datamined` pill, the
note over the skills. Do not add a beta record anywhere that cannot carry one of those.

## Preview day is the desk's other patch day

Kuro's preview broadcast lands on a Friday evening CN time, about ten days before the
patch — in practice the second Friday before release, though the reliable signal is the
article, not the calendar. It is the single biggest data drop of the cycle: version title,
release date, key visual, both phases of banners, every featured weapon, the event list
and the QoL notes, all at once.

`node scripts/fetch-version-notices.mjs` takes most of that on its own, off the 6h cron,
and `--dry-run` prints the report without touching the issue. It reads three article
shapes off Kuro's static article CDN — the version preview, the numbered Featured Convene
notice, and the standalone debut convene that the numbered one leaves out — and fills
`versions.json` from them, flipping `beta` → `announced` and retiring a `provisional` key
visual for the real one.

**The half that is not automatic**: the banner lineup is announced as six infographics
with no text under them. Nothing on Kuro's site names Phase 1's Resonators in words until
the convene notice, a day before that phase opens. So the fetcher opens the issue
**"Version preview: banner lineup still needs a human"**, and the work it is asking for is
always this shape:

- Fill `phases` in `versions.json` from the infographic. A returning Resonator's `convene`
  is already in their `runs` in `resonators.json` — the name has never changed for anyone,
  so look it up rather than reading it off a screenshot.
- Phase dates read off the broadcast are estimates. Flag them `estimated_start` /
  `estimated_end` and let the convene notice clear the flags.
- Write the announcement into `news.json` at `official`, and set `outcome` on the leaks it
  resolved — `confirmed` where they held, `superseded` where the broadcast overrode them.

**Events are the same job again.** Kuro name a patch's events on the broadcast and publish
each one's notice only around patch day, so `fetch-events.mjs` has nothing to fetch for
ten days. Do not leave the calendar showing the old patch: write them into
`data/events.json` by hand with `origin: "hand"`, which is what that flag is for — the
fetcher keeps hand entries and hands each slot over the moment Kuro's own notice appears
under the same name.

The banner art is already public, inside the preview infographic rather than as files.
`node scripts/find-event-art.mjs <articleId>` prints crop coordinates for every band in
it; open the preview URLs, match band to event, paste the crop in. An event Kuro has not
illustrated gets no `art` — the desk draws its own plate, which is the intended look, not
a borrowed picture. Trim a band that includes the gold section title above the frame or
Kuro's own name plate inside it, or set `art.nameplate` so the desk doesn't draw a second
title over the first.

## Checking visual changes

Layout bugs are invisible in the source. Serve the repo and drive it with Playwright.
The desk is deliberately build-step-free, so **do not add a dependency to it for a
screenshot** — that rule holds everywhere.

*On Tom's Windows desktop*: there is no Python, so `python -m http.server` hits the
Microsoft Store shim — write a small Node static server into the scratchpad instead. And
Playwright is installed in the Test Project folder, not in this repo, so throwaway
scripts go there and get deleted afterwards. Session memory has the details.

*Anywhere else — phone, cloud, a fresh checkout* — none of the above paths exist. Use
whatever static server and browser automation that environment actually has, or say
plainly that the change has not been looked at rather than claiming it has.

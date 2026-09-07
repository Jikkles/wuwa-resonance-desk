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
`fetch-kits.mjs` and `fetch-weapons.mjs` only ever run locally. A Resonator can therefore
go live while the desk is still drawing their beta kit. `fetch-client-files.mjs` shouts
about exactly that — `RELEASED and still on the beta kit: <name>` — and the fix is:

```bash
node scripts/fetch-kits.mjs && node scripts/fetch-client-files.mjs
```

Watch for that line on patch day. Beta text is pre-balance: multipliers move and mechanics
get cut between the beta and the live build, which is the whole reason the live version
has to win.

Every record drawn from beta files must say so — the `Beta` flag, the `Datamined` pill, the
note over the skills. Do not add a beta record anywhere that cannot carry one of those.

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

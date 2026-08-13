// Replaces estimated phase dates in versions.json with confirmed ones.
// Node 20+. No dependencies, no keys, no network — it reads what
// fetch-kits.mjs already fetched.
//
// A patch is written into versions.json weeks before it ships, so its phase
// boundaries start life as arithmetic on past patch lengths and carry
// `estimated_start` / `estimated_end`, which the desk renders as "(est)".
// Kuro confirms them later and somebody has to go and edit the file.
//
// They don't have to. Every banner has a convene page on the wiki carrying its
// real start and end, fetch-kits.mjs already parses those into each
// Resonator's `runs`, and a phase is exactly the window its banners ran in. So
// once a phase has actually started, the confirmed dates are already sitting in
// resonators.json and this reconciles them back.
//
// The rule is the project's usual one — a date is a fact, a tier is a
// judgement — with one edge sanded off it:
//
//   * An estimated date is replaced by a confirmed one. That is the whole job.
//   * A blank is filled.
//   * A date NOT marked estimated is never overwritten. If the wiki disagrees
//     with something a human wrote down as confirmed, that is worth a human
//     looking at, not a silent correction — so it is reported and left alone.
//   * Banners in a phase have to agree unanimously. A phase where two convenes
//     claim different windows is not a confirmation, it is a parsing problem.
//
// Writes nothing when nothing changed, so an idle run produces no commit.

import { readFile, writeFile } from "node:fs/promises";

const VERSIONS = "data/versions.json";
const RESONATORS = "data/resonators.json";

const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* The window a phase's banners actually ran in, or null if the wiki can't say.
   Every banner on the phase that has a run recorded for this version must
   agree; one dissenter and we decline to answer. */
function confirmedWindow(phase, version, runsByName) {
  const windows = [];
  for (const b of phase.banners || []) {
    const runs = runsByName.get(key(b.name)) || [];
    const run = runs.find(r => r.version === version && r.start && r.end);
    if (run) windows.push(`${run.start}|${run.end}`);
  }
  if (!windows.length) return null;
  const distinct = [...new Set(windows)];
  if (distinct.length > 1) {
    console.log(`  phase ${phase.n}: convenes disagree (${distinct.join(" vs ")}) — skipped`);
    return null;
  }
  const [start, end] = distinct[0].split("|");
  return { start, end };
}

(async function main() {
  const versionsDoc = await readJson(VERSIONS);
  const resonators = (await readJson(RESONATORS)).resonators || [];

  const runsByName = new Map();
  for (const r of resonators) if (r.runs?.length) runsByName.set(key(r.name), r.runs);

  const changes = [];
  const conflicts = [];

  for (const v of versionsDoc.versions || []) {
    for (const p of v.phases || []) {
      const win = confirmedWindow(p, v.id, runsByName);
      if (!win) continue;

      for (const edge of ["start", "end"]) {
        const flag = `estimated_${edge}`;
        const had = p[edge];
        /* Only an estimate or a blank is ours to touch. */
        if (had && !p[flag]) {
          if (had !== win[edge]) conflicts.push(`${v.id} phase ${p.n} ${edge}: file says ${had}, wiki says ${win[edge]}`);
          continue;
        }
        if (had === win[edge] && !p[flag]) continue;
        const wasEst = !!p[flag];
        p[edge] = win[edge];
        delete p[flag];
        /* An estimate that happened to be right still counts as a change: the
           "(est)" marker comes off the date on the page. */
        changes.push(`${v.id} phase ${p.n} ${edge}: ${had || "(blank)"} → ${win[edge]}${wasEst ? " (was est)" : ""}`);
      }
    }
  }

  for (const c of conflicts) console.log(`conflict — left alone: ${c}`);

  if (!changes.length) {
    console.log("no estimated dates to confirm");
    return;
  }

  for (const c of changes) console.log(`confirmed: ${c}`);
  versionsDoc.updated = new Date().toISOString().slice(0, 10);
  await writeFile(VERSIONS, JSON.stringify(versionsDoc, null, 2) + "\n");
  console.log(`\n${changes.length} date(s) confirmed in ${VERSIONS}`);
})();

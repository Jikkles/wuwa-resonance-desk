// scripts/lib/out.mjs — write the file only when the file changed.
//
// The README has said "each prints what it kept and only writes when something
// changed" for a long time, and four of the fetchers did not do it. kits.json
// and resonators.json were rewritten on every daily run with nothing in the
// diff but their own `updated` date — three quarters of a megabyte committed
// and a Pages deploy triggered, every day, to record that yesterday's kits are
// still yesterday's kits. `git log -- data/kits.json` could not tell you when a
// kit last actually moved, which is the one question that log exists to answer.
//
// The ones that did check mostly checked too little. fetch-items.mjs compared
// `items` and nothing else, so editing the `note` the file carries — the
// sentence that explains the data to anyone reading it — changed the script
// and never reached the file. Comparing the whole document minus its timestamp
// is both the stricter test and the simpler one.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/* `volatile` names the fields that move on their own — the run stamp, and
   nothing else. They are dropped from both sides of the comparison and kept in
   what gets written, so a real change carries a fresh timestamp and a no-op
   leaves the old one in place. */
export async function writeIfChanged(file, doc, volatile = ["updated"]) {
  const settled = o => {
    const copy = { ...o };
    for (const k of volatile) delete copy[k];
    return JSON.stringify(copy);
  };

  let prev = null;
  try { prev = JSON.parse(await readFile(file, "utf8")); } catch { /* first run */ }
  if (prev && settled(prev) === settled(doc)) return false;

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(doc, null, 2) + "\n");
  return true;
}

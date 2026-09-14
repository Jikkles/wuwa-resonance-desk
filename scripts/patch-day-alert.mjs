// Raises a GitHub issue when a released Resonator is still being drawn off
// beta data. Node 20+. No dependencies. Uses the `gh` CLI the runner ships with.
//
// Why this exists. Prydwen returns a flat 403 to GitHub Actions, so the kit,
// the weapon stats and the builds for a new Resonator only ever arrive from a
// local run. Until then the beta client records hold the slot, which is the
// design — but on patch day that slot is holding pre-balance text for somebody
// who is out. fetch-client-files.mjs has always said so, as a line in the log
// of a step that is not allowed to fail, and Jingran sat on his beta kit for
// four days with that line printed every six hours into runs that went green.
// A warning nobody is shown is not a warning.
//
// So this reads the files the desk is actually serving, after every fetch step
// has run, and asks three questions of each released Resonator:
//
//   kit      still in clientkits.json    → fetch-kits.mjs has not had a page
//   weapon   signature still in clientfiles.json → fetch-weapons.mjs likewise
//   builds   no row in builds.json       → fetch-builds.mjs likewise
//
// and keeps one open issue in step with the answer. It is opened when the list
// first has a name on it, commented on when a new name joins (an edit to the
// body notifies nobody), and closed once a local run has handed everything
// over. Four runs a day with nothing new do nothing.
//
// There is no wiki fallback to try first, and it is worth knowing why. The
// wiki's kit pages are already read by fetch-kits.mjs on the daily job. Its
// weapon data is not usable in place of Prydwen's: the stats module carries
// level 1 figures where the desk shows level 90 and deliberately infers no
// curve, and it lagged — Thousandfold Deliverance still had no stats entry four
// days after it shipped. Builds are Prydwen's own judgement and have no
// substitute at all. A person with a home connection is the fix; this is what
// tells them.
//
// Exits 0 either way, like watch-cn.mjs: a Resonator going live is news, not a
// broken build. Outside Actions (or with --dry-run) it prints the report and
// what it would have done to the issue, and touches nothing.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TITLE = "Patch day: released Resonators still on beta data";
/* The machine-readable half of the issue body. Names are compared against it
   to tell a new arrival from one the issue already carries. */
const MARK = /<!-- desk-alert: (.*?) -->/;
const DRY = process.argv.includes("--dry-run") || !process.env.GITHUB_ACTIONS;

const load = async f => JSON.parse(await readFile(f, "utf8"));
const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function gh(...args) {
  const { stdout } = await run("gh", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function body(items, steps) {
  const lines = [
    "These have shipped, and the desk is still drawing them from the beta client files or has " +
    "nothing live for them yet. " +
    "Prydwen refuses GitHub Actions, so the live data needs a run from a home connection.",
    "",
    ...items.map(i => `- **${i.name}** — ${i.what.join(", ")}`),
    "",
    "Run, then commit and push:",
    "",
    "```bash",
    `${steps.join(" && \\\n  ")}`,
    "```",
    ""
  ];
  const withKit = items.filter(i => i.what.includes("kit")).map(i => i.name);
  if (withKit.length)
    lines.push(
      `Then rewrite the hand-written \`kit\` notes in resonators.json for ${withKit.join(", ")} ` +
      "against the live kit — they were written from leaks, and no fetcher touches them.",
      "");
  lines.push(
    "This issue closes itself once every name above has been handed over.",
    "",
    `<!-- desk-alert: ${items.map(i => `${i.name}=${i.what.join("+")}`).join("; ")} -->`);
  return lines.join("\n");
}

(async function main() {
  const [roster, clientKits, clientFiles, builds] = await Promise.all([
    load("data/resonators.json"),
    load("data/clientkits.json"),
    load("data/clientfiles.json"),
    load("data/builds.json")
  ]);

  /* Same test fetch-client-files.mjs uses: the roster's own status once it
     flips, and before that a release date that has passed. */
  const today = new Date().toISOString().slice(0, 10);
  const out = (roster.resonators || [])
    .filter(r => r.status === "released" || (r.released && r.released <= today));

  const betaKit = new Set(Object.keys(clientKits.kits || {}).map(key));
  const betaWeapon = new Set((clientFiles.weapons || []).map(w => key(w.name)));
  const haveBuild = new Set(Object.keys(builds.builds || {}).map(key));

  const items = [];
  for (const r of out) {
    const what = [];
    if (betaKit.has(key(r.name))) what.push("kit");
    if (r.signature && betaWeapon.has(key(r.signature))) what.push(`signature weapon (${r.signature})`);
    if (!haveBuild.has(key(r.name))) what.push("builds");
    if (what.length) items.push({ name: r.name, what });
  }

  const steps = [
    items.some(i => i.what.includes("kit")) && "node scripts/fetch-kits.mjs",
    items.some(i => i.what.some(w => w.startsWith("signature"))) && "node scripts/fetch-weapons.mjs",
    items.some(i => i.what.includes("builds")) && "node scripts/fetch-builds.mjs",
    /* Always last: it decides what to drop by diffing against the files the
       steps above just wrote. */
    "node scripts/fetch-client-files.mjs"
  ].filter(Boolean);

  if (items.length) {
    console.log("released and still on beta data:");
    for (const i of items) console.log(`  ${i.name.padEnd(20)} ${i.what.join(", ")}`);
  } else {
    console.log("every released Resonator is on live data");
  }

  if (DRY) {
    if (items.length) console.log(`\n--dry-run: would open or update "${TITLE}" with:\n\n${body(items, steps)}`);
    else console.log(`\n--dry-run: would close "${TITLE}" if it is open`);
    return;
  }

  /* Listed and matched on the exact title rather than searched for: the search
     index can lag a new issue by minutes, and a second issue for the same
     patch day is exactly the noise this is meant to cut through. */
  const open = JSON.parse(await gh("issue", "list", "--state", "open", "--limit", "200",
    "--json", "number,title,body")).find(i => i.title === TITLE);

  if (!items.length) {
    if (open) {
      await gh("issue", "close", String(open.number),
        "--comment", "Every released Resonator is on live data now — closing.");
      console.log(`closed #${open.number}`);
    }
    return;
  }

  const next = body(items, steps);
  if (!open) {
    const url = (await gh("issue", "create", "--title", TITLE, "--body", next)).trim();
    console.log(`opened ${url}`);
    return;
  }
  if (open.body.trim() === next.trim()) {
    console.log(`#${open.number} already says this`);
    return;
  }

  /* By name, not by what is outstanding: a Resonator whose weapon has been
     handed over but whose kit has not is progress, and must not be announced
     as a new arrival. */
  const before = new Set((open.body.match(MARK)?.[1] || "").split("; ")
    .map(e => e.split("=")[0]).filter(Boolean));
  const arrived = items.filter(i => !before.has(i.name));
  await gh("issue", "edit", String(open.number), "--body", next);
  if (arrived.length)
    await gh("issue", "comment", String(open.number), "--body",
      `Also waiting now: ${arrived.map(i => `**${i.name}** (${i.what.join(", ")})`).join("; ")}.`);
  console.log(`updated #${open.number}` + (arrived.length ? `, new: ${arrived.map(i => i.name).join(", ")}` : ""));
})().catch(err => {
  /* A failed alert must not read as a failed data run. It still says why. */
  console.log(`alert not raised: ${err.message}`);
});

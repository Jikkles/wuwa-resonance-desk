// scripts/lib/assets.mjs — don't download a picture the repo already has.
//
// Five fetchers cache art under assets/, and every one of them re-downloaded
// every file on every run. On the six-hourly cron that is ninety-eight images
// a cycle from Fandom — four hundred a day, for a set of pictures that changes
// when Kuro ships a patch. Run the local half too and it is four hundred and
// fifty more, most of a patch cycle's traffic spent confirming that an icon
// drawn in 2024 is still the icon it was.
//
// It also churned the repo. `assets/items/deep-dreams-film-festival.png` moved
// twice in one day in September without the item changing, because a re-fetch
// of the same URL came back re-encoded, and a binary diff on a PNG is a commit
// nobody can read and a Pages deploy nobody needed.
//
// What makes skipping safe is the shape of the URLs. Fandom hands out
// revision-scoped image URLs — the `cb=` stamp moves when the file is
// re-uploaded — and Prydwen's are content-hashed by its build. So a URL that
// has not changed is a file that has not changed, and the manifest below is
// just a record of which URL each cached file came from. A URL that moves is a
// fresh download; a file that has gone missing off disk is a fresh download;
// and `DESK_REFRESH_ASSETS=1` in the environment ignores the manifest and
// re-fetches the lot, which is the escape hatch for the day one of those two
// hosts starts serving from a stable URL after all.

import { readFile, writeFile, mkdir, stat, unlink, readdir } from "node:fs/promises";

const MANIFEST = "assets/.sources.json";
const REFRESH = !!process.env.DESK_REFRESH_ASSETS;

const NOTE =
  "Which URL each cached file under assets/ was downloaded from, so a fetcher can " +
  "skip a picture it already has. Fandom and Prydwen both serve art from URLs that " +
  "move when the art moves, so a matching URL means a matching file. Written by " +
  "scripts/lib/assets.mjs; delete it, or set DESK_REFRESH_ASSETS=1, to force every " +
  "fetcher to download everything again.";

const exists = p => stat(p).then(() => true, () => false);

export class AssetCache {
  constructor(files) {
    this.files = files;              // path -> { url, bytes }
    this.kept = new Set();           // paths this run still wants
    this.byUrl = new Map();          // one download per URL per run
    this.hit = 0;
    this.fetched = 0;
    this.failed = 0;
  }

  static async open() {
    let files = {};
    try {
      const doc = JSON.parse(await readFile(MANIFEST, "utf8"));
      if (doc && typeof doc.files === "object") files = doc.files;
    } catch { /* no manifest yet — the first run downloads everything */ }
    return new AssetCache(files);
  }

  /* The one call site every fetcher wants. `download` is the script's own
     downloader — curl for the Prydwen three, plain fetch for the rest — so
     this never has an opinion about how a host is talked to.

     It does not throw. Four answers, and every caller wants to tell them
     apart in its log:

       cached   the manifest and the disk agree, nothing was asked for
       fetched  downloaded and written
       kept     the download failed and a copy is already on disk
       failed   the download failed and there is nothing to fall back on

     `kept` is the one that is new behaviour rather than new wording. These
     scripts used to drop a record's icon the moment a fetch failed, and then
     prune the perfectly good file underneath it — so a five-second Fandom
     wobble cost the desk a picture it already had, and the next run downloaded
     it again. A transient failure should cost nothing. */
  async get(file, url, download) {
    this.kept.add(file);

    const known = this.files[file];
    const onDisk = await exists(file);
    if (!REFRESH && known?.url === url && onDisk) {
      this.hit++;
      return { status: "cached", bytes: known.bytes || 0 };
    }

    try {
      /* Three reward items share one wiki page, so three files want the same
         bytes. Ask once — and hold the promise rather than the result, so two
         callers running in parallel share the one request instead of racing to
         start a second before the first has landed. */
      let pending = this.byUrl.get(url);
      if (!pending) {
        this.fetched++;
        pending = download(url);
        this.byUrl.set(url, pending);
      }
      let buf;
      try {
        buf = await pending;
      } catch (err) {
        /* A URL that failed must not stay memoised as a rejected promise for
           the rest of the run: a later file pointing at it deserves its own
           attempt, with its own retries. */
        this.byUrl.delete(url);
        this.fetched--;
        throw err;
      }
      await writeFile(file, buf);
      this.files[file] = { url, bytes: buf.length };
      /* The bytes come back with the result on a fetch and only on a fetch.
         fetch-portraits.mjs checks a webp for an alpha channel and
         fetch-weapons.mjs measures one to decide whether Prydwen's copy is big
         enough to draw — both questions about a picture that just arrived, and
         neither worth reading two hundred files off disk to re-ask. */
      return { status: "fetched", bytes: buf.length, buf };
    } catch (err) {
      this.failed++;
      if (onDisk) return { status: "kept", bytes: known?.bytes || 0, error: err };
      this.kept.delete(file);
      return { status: "failed", bytes: 0, error: err };
    }
  }

  /* For the one fetcher that picks between two sources. fetch-weapons.mjs asks
     Prydwen first, measures what comes back, and falls back to the wiki when
     the icon is too small to draw — so the URL a cached file came from is not
     something the caller can predict before it fetches. This hands the recorded
     URL back instead: a file already on disk is kept as it is, and the host in
     the URL is what the credit line reads to decide whether to name the wiki.

     Changing the rule that picked the source — the minimum width, say — does
     not re-run the choice, because nothing here re-reads the file. That is what
     DESK_REFRESH_ASSETS=1 is for. */
  async reuse(file) {
    const known = this.files[file];
    if (REFRESH || !known?.url || !(await exists(file))) return null;
    this.kept.add(file);
    this.hit++;
    return known.url;
  }

  /* A download the caller made itself, filed as if this had made it. Same
     fetcher, one extra step in the middle. */
  async put(file, url, buf) {
    this.kept.add(file);
    await writeFile(file, buf);
    this.files[file] = { url, bytes: buf.length };
    this.fetched++;
  }

  /* A file the run decided it no longer wants. Called by the sweeps that
     already unlink stale art, so the manifest doesn't outlive what it
     describes. */
  forget(file) {
    this.kept.delete(file);
    delete this.files[file];
  }

  /* Everything under `dir` that this run did not keep, removed — the sweep
     every one of these fetchers hand-rolled, with the manifest kept in step.
     `match` filters to the extensions the caller owns, because assets/echoes
     holds a subdirectory it does not. */
  async sweep(dir, match = () => true) {
    let stale = 0;
    for (const f of await readdir(dir).catch(() => [])) {
      const path = `${dir}/${f}`;
      if (!match(f) || this.kept.has(path)) continue;
      /* A directory, or a file that went away between the listing and here.
         assets/echoes holds the sonata crests in a subdirectory of its own. */
      const st = await stat(path).catch(() => null);
      if (!st?.isFile()) continue;
      await unlink(path);
      this.forget(path);
      /* Named, not just counted. Every one of these scripts announced its own
         prunes before this was shared, and a picture leaving the repo is worth
         a line in the log it left from. */
      console.log(`pruned ${path}`);
      stale++;
    }
    return stale;
  }

  /* Written only when it moved, for the same reason everything else here is:
     the workflow commits whatever changed, and a manifest that rewrites itself
     every run would put back exactly the junk commit this file exists to stop.

     Entries for files nothing kept are dropped — but only when the run
     actually looked at that directory. A manifest is shared by five scripts
     and any one of them running alone must not forget the other four's work,
     so pruning is keyed on the directories this run wrote into. */
  async save() {
    const touched = new Set([...this.kept].map(f => f.slice(0, f.lastIndexOf("/"))));
    const files = {};
    for (const [path, rec] of Object.entries(this.files).sort(([a], [b]) => a.localeCompare(b))) {
      const dir = path.slice(0, path.lastIndexOf("/"));
      if (touched.has(dir) && !this.kept.has(path)) continue;
      files[path] = rec;
    }

    const doc = JSON.stringify({ note: NOTE, files }, null, 2) + "\n";
    let prev = "";
    try { prev = await readFile(MANIFEST, "utf8"); } catch {}
    if (prev === doc) return false;
    await mkdir("assets", { recursive: true });
    await writeFile(MANIFEST, doc);
    return true;
  }

  /* One line for the run's log, so a cache that has quietly stopped working is
     visible rather than merely fast. */
  get summary() {
    return `art: ${this.fetched} downloaded, ${this.hit} already cached` +
      (this.failed ? `, ${this.failed} would not come down` : "") +
      (REFRESH ? " (refresh forced)" : "");
  }
}

// scripts/lib/net.mjs — the plumbing every fetcher had its own copy of.
//
// Ten scripts in this directory each carried a version of the same twelve
// lines: a user agent, an AbortSignal.timeout, `if (!res.ok) throw`. Identical
// everywhere, and identical in what they got wrong — none of them retried. A
// Fandom 503 or a runner hiccup at the wrong second lost a whole step for six
// hours, and the desk's answer to "the wiki was briefly busy" was the same as
// its answer to "the wiki has changed shape": drop the data and try again
// after lunch.
//
// This is deliberately the only thing that is shared. fetch-builds.mjs says
// why the three Prydwen payload walkers are three copies rather than one
// import, and that reasoning holds: a parser belongs to the page it reads, and
// the day a source moves, all of its readers want looking at together. Nothing
// about a timeout or a backoff belongs to a page. Prydwen is not here at all —
// those three scripts talk through curl, because Cloudflare turns Node's TLS
// handshake away, and that is a property of the host rather than of HTTP.

const UA =
  "Mozilla/5.0 (compatible; wuwa-resonance-desk/2.0; +https://github.com/Jikkles/wuwa-resonance-desk)";

/* Worth trying again: the request never reached a decision, or it reached one
   that says "not now" rather than "not ever". A 403 or a 404 is an answer —
   Prydwen refusing a runner, an item with no wiki page — and asking three
   times makes the run slower without making it righter. */
const AGAIN = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 800ms, 1.6s, 3.2s, with a little jitter so two scripts that failed on the
   same outage don't come back in lockstep. A Retry-After wins outright — it is
   the server saying how long it wants, and 429 is the one status where
   guessing is rude. */
function backoff(attempt, retryAfter) {
  const asked = Number(retryAfter);
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, 30) * 1000;
  return Math.round(800 * 2 ** attempt * (0.85 + Math.random() * 0.3));
}

/* One request, with the retries. Returns the Response — callers that want a
   body use the two helpers under this. A non-ok response has its body
   cancelled before the throw: undici keeps the socket open for a body nobody
   read, and a script that throws away sixty 404s would otherwise sit on sixty
   half-finished connections until the process exits. */
export async function request(url, opts = {}) {
  const {
    accept = "*/*",
    timeout = 25000,
    retries = 2,
    headers = {},
    /* Kurobbs answers a list query over POST. Retrying it is safe for the same
       reason it is a query at all — it asks for a page of a board and changes
       nothing — and nothing else here sends a body. */
    method = "GET",
    body
  } = opts;

  for (let attempt = 0; ; attempt++) {
    let res = null, err = null;
    try {
      res = await fetch(url, {
        method,
        ...(body === undefined ? {} : { body }),
        headers: { "User-Agent": UA, Accept: accept, ...headers },
        signal: AbortSignal.timeout(timeout)
      });
    } catch (e) {
      err = e;
    }

    if (res?.ok) return res;
    if (res) {
      await res.body?.cancel().catch(() => {});
      err = new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      err.status = res.status;
    }

    const worthRetrying = !res || AGAIN.has(res.status);
    if (!worthRetrying || attempt >= retries) throw err;
    await sleep(backoff(attempt, res?.headers.get("retry-after")));
  }
}

/* Two helpers, not three. fetch-feeds.mjs keeps its own text reader and its own
   retry rule on purpose: it retries a 403, because Reddit turns datacenter
   ranges away intermittently and asking again is how that gets through, where
   everywhere else a 403 is Prydwen saying no and meaning it. */
export async function getJson(url, opts = {}) {
  const res = await request(url, { accept: "application/json,*/*", ...opts });
  return res.json();
}

/* An empty body is a failure rather than a zero-byte file: every caller here
   is downloading a picture, and a picture with nothing in it draws as a broken
   image on a card that would otherwise have drawn its own glyph plate. */
export async function getBuffer(url, opts = {}) {
  const res = await request(url, { accept: "image/png,image/webp,image/*,*/*", ...opts });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty body");
  return buf;
}

/* Run `work` over `items`, `limit` of them in flight. Every caller of this is
   downloading independent files from one host, where the whole cost is waiting
   — four at a time turns four minutes of round trips into one, and is still
   politer than a browser opening a page. Order is preserved in the results;
   the work is not started in order beyond that, and no caller cares.

   Deliberately not used for the Prydwen page walks: fetch-builds.mjs puts a
   courtesy gap between its sixty requests on purpose, and a fan site that
   already declines to serve datacenter traffic is not the place to find out
   how many parallel connections it tolerates. */
export async function pool(items, limit, work) {
  const list = [...items];
  const out = new Array(list.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await work(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, runner));
  return out;
}

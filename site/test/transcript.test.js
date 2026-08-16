import test from "node:test";
import assert from "node:assert";

import {
  parseTimedText,
  fetchTranscript,
  TranscriptError,
  createCache,
} from "../lib/transcript.js";

// --- Fixtures -----------------------------------------------------------

const SRV3 = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
<body>
<p t="1000" d="2000"><s>Hello</s><s t="500"> brave</s><s t="1200"> world</s></p>
<p t="3500" d="1500"><s>Good&amp;bye</s><s t="400"> now</s></p>
</body>
</timedtext>`;

// srv1: phrase-level only, no <s> children, seconds not milliseconds.
const SRV1 = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
<text start="1" dur="2">Hello brave world</text>
<text start="3.5" dur="1.5">Good&amp;bye now</text>
</transcript>`;

// --- parseTimedText: srv3 ----------------------------------------------

test("parseTimedText reads srv3 phrases with start and duration", () => {
  const { phrases } = parseTimedText(SRV3);
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[0], {
    start: 1,
    dur: 2,
    text: "Hello brave world",
  });
  assert.equal(phrases[1].start, 3.5);
  assert.equal(phrases[1].dur, 1.5);
});

test("parseTimedText reads srv3 per-word timing as phrase start plus offset", () => {
  const { hasWordTiming, words } = parseTimedText(SRV3);
  assert.equal(hasWordTiming, true);
  assert.equal(words.length, 5);
  assert.deepEqual(words[0], { start: 1, text: "Hello", p: 0 });
  assert.deepEqual(words[1], { start: 1.5, text: "brave", p: 0 });
  assert.deepEqual(words[2], { start: 2.2, text: "world", p: 0 });
  // Second phrase's words are offset from that phrase's own start.
  assert.equal(words[3].p, 1);
  assert.equal(words[3].start, 3.5);
  assert.equal(words[4].start, 3.9);
});

test("parseTimedText decodes HTML entities in caption text", () => {
  const { phrases } = parseTimedText(SRV3);
  assert.equal(phrases[1].text, "Good&bye now");
});

// --- parseTimedText: srv1 fallback -------------------------------------

test("parseTimedText reads srv1 phrases when there are no srv3 <p> tags", () => {
  const { phrases } = parseTimedText(SRV1);
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[0], { start: 1, dur: 2, text: "Hello brave world" });
  assert.equal(phrases[1].text, "Good&bye now");
});

test("parseTimedText reports no word timing for srv1", () => {
  const { hasWordTiming, words } = parseTimedText(SRV1);
  assert.equal(hasWordTiming, false);
  assert.deepEqual(words, []);
});

test("parseTimedText returns no phrases for junk input", () => {
  assert.deepEqual(parseTimedText("not xml at all").phrases, []);
  assert.deepEqual(parseTimedText("").phrases, []);
});

test("parseTimedText skips phrases that hold only whitespace", () => {
  const xml = `<p t="0" d="500"><s>   </s></p><p t="600" d="500"><s>real</s></p>`;
  const { phrases } = parseTimedText(xml);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].text, "real");
});

// --- fetchTranscript: failure classification ---------------------------

// Builds a fake fetch that answers the InnerTube player call with `player`,
// and any timed-text call with `timedText`.
function fakeFetch({ player, timedText }) {
  return async (url) => {
    if (String(url).includes("/youtubei/")) return respond(player);
    return respond(timedText);
  };
}

function respond(spec) {
  if (typeof spec === "function") return spec();
  const { status = 200, body = "" } = spec || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}

const PLAYER_OK = {
  body: JSON.stringify({
    playabilityStatus: { status: "OK" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://example.test/timedtext?x=1",
            languageCode: "en",
            kind: "asr",
          },
        ],
      },
    },
  }),
};

test("fetchTranscript returns parsed segments on the happy path", async () => {
  const data = await fetchTranscript("abc", {
    fetchImpl: fakeFetch({ player: PLAYER_OK, timedText: { body: SRV3 } }),
  });
  assert.equal(data.hasWordTiming, true);
  assert.equal(data.phrases.length, 2);
});

test("fetchTranscript raises no_transcript when the video has no caption tracks", async () => {
  const player = {
    body: JSON.stringify({ playabilityStatus: { status: "OK" }, captions: {} }),
  };
  await assert.rejects(
    () => fetchTranscript("abc", { fetchImpl: fakeFetch({ player }) }),
    (err) => err instanceof TranscriptError && err.code === "no_transcript",
  );
});

test("fetchTranscript raises unavailable when the video is not playable", async () => {
  const player = {
    body: JSON.stringify({
      playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Private video" },
    }),
  };
  await assert.rejects(
    () => fetchTranscript("abc", { fetchImpl: fakeFetch({ player }) }),
    (err) => err instanceof TranscriptError && err.code === "unavailable",
  );
});

test("fetchTranscript raises upstream_failed when InnerTube returns an error status", async () => {
  const player = { status: 500, body: "server error" };
  await assert.rejects(
    () =>
      fetchTranscript("abc", { fetchImpl: fakeFetch({ player }), retries: 0 }),
    (err) => err instanceof TranscriptError && err.code === "upstream_failed",
  );
});

test("fetchTranscript raises upstream_failed when InnerTube returns non-JSON", async () => {
  const player = { status: 200, body: "<html>bot check</html>" };
  await assert.rejects(
    () =>
      fetchTranscript("abc", { fetchImpl: fakeFetch({ player }), retries: 0 }),
    (err) => err instanceof TranscriptError && err.code === "upstream_failed",
  );
});

test("fetchTranscript raises upstream_failed when the network call throws", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () => fetchTranscript("abc", { fetchImpl, retries: 0 }),
    (err) => err instanceof TranscriptError && err.code === "upstream_failed",
  );
});

// --- fetchTranscript: srv3 -> srv1 downgrade ---------------------------

test("fetchTranscript falls back to srv1 when srv3 comes back empty", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("/youtubei/")) return respond(PLAYER_OK);
    calls.push(u);
    // The srv3 request yields nothing usable; the plain request works.
    if (u.includes("fmt=srv3")) return respond({ body: "<timedtext/>" });
    return respond({ body: SRV1 });
  };

  const data = await fetchTranscript("abc", { fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /fmt=srv3/);
  assert.doesNotMatch(calls[1], /fmt=srv3/);
  assert.equal(data.hasWordTiming, false);
  assert.equal(data.phrases.length, 2);
});

test("fetchTranscript raises no_transcript when both formats are empty", async () => {
  const fetchImpl = fakeFetch({
    player: PLAYER_OK,
    timedText: { body: "<timedtext/>" },
  });
  await assert.rejects(
    () => fetchTranscript("abc", { fetchImpl, retries: 0 }),
    (err) => err instanceof TranscriptError && err.code === "no_transcript",
  );
});

// --- fetchTranscript: retry --------------------------------------------

test("fetchTranscript retries a failed InnerTube call once before giving up", async () => {
  let attempts = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/youtubei/")) {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNRESET");
      return respond(PLAYER_OK);
    }
    return respond({ body: SRV3 });
  };

  const data = await fetchTranscript("abc", { fetchImpl, retryDelayMs: 0 });
  assert.equal(attempts, 2);
  assert.equal(data.phrases.length, 2);
});

// --- Track selection ----------------------------------------------------

test("fetchTranscript prefers the English auto-generated track for word timing", async () => {
  let requested = null;
  const player = {
    body: JSON.stringify({
      playabilityStatus: { status: "OK" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: "https://example.test/de", languageCode: "de" },
            { baseUrl: "https://example.test/en-manual", languageCode: "en" },
            {
              baseUrl: "https://example.test/en-asr",
              languageCode: "en",
              kind: "asr",
            },
          ],
        },
      },
    }),
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("/youtubei/")) return respond(player);
    requested = String(url);
    return respond({ body: SRV3 });
  };

  await fetchTranscript("abc", { fetchImpl });
  assert.match(requested, /en-asr/);
});

// --- Cache --------------------------------------------------------------

test("cache returns a stored value and drops the oldest past its limit", () => {
  const cache = createCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3); // "b" is now the least recently used
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

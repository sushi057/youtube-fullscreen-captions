const test = require("node:test");
const assert = require("node:assert");

// The route's job is to turn a TranscriptError code into the right status and
// to answer from cache the second time. Both are checked against a stubbed
// transcript module so no test ever touches YouTube.
const transcript = require("../transcript");

const realFetch = transcript.fetchTranscript;

function stubFetchTranscript(impl) {
  transcript.fetchTranscript = impl;
}

test.afterEach(() => {
  transcript.fetchTranscript = realFetch;
});

// server.js captures fetchTranscript at require time, so each test stubs first
// and then loads a fresh copy of the app (which also gives it an empty cache).
async function startServer() {
  delete require.cache[require.resolve("../server")];
  const app = require("../server");
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        server,
        url: (p) => `http://127.0.0.1:${port}${p}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test("a missing video id is a client error", async () => {
  const s = await startServer();
  const res = await fetch(s.url("/api/transcript"));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "missing_video_id" });
  await s.close();
});

test("a video with no captions answers 404 no_transcript", async () => {
  stubFetchTranscript(async () => {
    throw new transcript.TranscriptError("no_transcript");
  });
  const s = await startServer();
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "no_transcript");
  await s.close();
});

test("a broken upstream answers 502, not 404", async () => {
  stubFetchTranscript(async () => {
    throw new transcript.TranscriptError("upstream_failed");
  });
  const s = await startServer();
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "upstream_failed");
  await s.close();
});

test("an unplayable video answers 404 unavailable", async () => {
  stubFetchTranscript(async () => {
    throw new transcript.TranscriptError("unavailable");
  });
  const s = await startServer();
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "unavailable");
  await s.close();
});

test("an unexpected error is reported as an upstream failure", async () => {
  stubFetchTranscript(async () => {
    throw new TypeError("something else broke");
  });
  const s = await startServer();
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 502);
  await s.close();
});

test("a second request for the same video is served from cache", async () => {
  let calls = 0;
  stubFetchTranscript(async () => {
    calls += 1;
    return {
      hasWordTiming: true,
      phrases: [{ start: 0, dur: 1, text: "hi" }],
      words: [],
    };
  });
  const s = await startServer();

  const first = await (await fetch(s.url("/api/transcript?v=abc"))).json();
  const second = await (await fetch(s.url("/api/transcript?v=abc"))).json();

  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.phrases, first.phrases);
  await s.close();
});

test("a failed fetch is not cached", async () => {
  let calls = 0;
  stubFetchTranscript(async () => {
    calls += 1;
    throw new transcript.TranscriptError("upstream_failed");
  });
  const s = await startServer();
  await fetch(s.url("/api/transcript?v=abc"));
  await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(calls, 2);
  await s.close();
});

test("health reports degraded when the upstream is broken", async () => {
  stubFetchTranscript(async () => {
    throw new transcript.TranscriptError("upstream_failed", "boom");
  });
  const s = await startServer();
  const res = await fetch(s.url("/api/health"));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.upstream, "upstream_failed");
  await s.close();
});

test("health reports ok when the upstream answers", async () => {
  stubFetchTranscript(async () => ({
    hasWordTiming: true,
    phrases: [{ start: 0, dur: 1, text: "hi" }],
    words: [],
  }));
  const s = await startServer();
  const res = await fetch(s.url("/api/health"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
  await s.close();
});

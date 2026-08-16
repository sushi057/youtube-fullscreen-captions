import test from "node:test";
import assert from "node:assert";

// The route's job is to turn a TranscriptError code into the right status and
// to answer from cache the second time. The app factory accepts an injected
// fetcher, so no test ever touches YouTube.
import { TranscriptError } from "../lib/transcript.js";
import { createApp } from "../app-factory.js";

async function startServer(fetchTranscript) {
  const app = createApp({ fetchTranscript });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        url: (p) => `http://127.0.0.1:${port}${p}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test("a missing video id is a client error", async () => {
  const s = await startServer(async () => {
    throw new TranscriptError("no_transcript");
  });
  const res = await fetch(s.url("/api/transcript"));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "missing_video_id" });
  await s.close();
});

test("a video with no captions answers 404 no_transcript", async () => {
  const s = await startServer(async () => {
    throw new TranscriptError("no_transcript");
  });
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "no_transcript");
  await s.close();
});

test("a broken upstream answers 502, not 404", async () => {
  const s = await startServer(async () => {
    throw new TranscriptError("upstream_failed");
  });
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "upstream_failed");
  await s.close();
});

test("an unplayable video answers 404 unavailable", async () => {
  const s = await startServer(async () => {
    throw new TranscriptError("unavailable");
  });
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "unavailable");
  await s.close();
});

test("an unexpected error is reported as an upstream failure", async () => {
  const s = await startServer(async () => {
    throw new TypeError("something else broke");
  });
  const res = await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(res.status, 502);
  await s.close();
});

test("a second request for the same video is served from cache", async () => {
  let calls = 0;
  const s = await startServer(async () => {
    calls += 1;
    return {
      hasWordTiming: true,
      phrases: [{ start: 0, dur: 1, text: "hi" }],
      words: [],
    };
  });

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
  const s = await startServer(async () => {
    calls += 1;
    throw new TranscriptError("upstream_failed");
  });
  await fetch(s.url("/api/transcript?v=abc"));
  await fetch(s.url("/api/transcript?v=abc"));
  assert.equal(calls, 2);
  await s.close();
});

test("health reports degraded when the upstream is broken", async () => {
  const s = await startServer(async () => {
    throw new TranscriptError("upstream_failed", "boom");
  });
  const res = await fetch(s.url("/api/health"));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.upstream, "upstream_failed");
  await s.close();
});

test("health reports ok when the upstream answers", async () => {
  const s = await startServer(async () => ({
    hasWordTiming: true,
    phrases: [{ start: 0, dur: 1, text: "hi" }],
    words: [],
  }));
  const res = await fetch(s.url("/api/health"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
  await s.close();
});

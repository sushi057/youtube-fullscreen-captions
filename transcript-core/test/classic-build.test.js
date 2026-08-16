import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// The content script cannot import ES modules, so `npm run sync` also emits a
// classic-script build of the shared module that assigns one global.
//
// This matters because the fetch must happen in the content script: it runs on
// youtube.com, so the call to YouTube's API is same-origin. From a service
// worker the same call carries `Origin: chrome-extension://<id>`, and YouTube
// answers 403.
const source = readFileSync(
  new URL("../../extension/vendor/transcript-classic.js", import.meta.url),
  "utf8",
);

function loadCore() {
  return new Function(`${source}; return TranscriptCore;`)();
}

test("the classic build is valid script syntax and exposes one global", () => {
  const core = loadCore();
  assert.equal(typeof core.fetchTranscript, "function");
  assert.equal(typeof core.parseTimedText, "function");
  assert.equal(typeof core.createCache, "function");
  assert.equal(typeof core.cutRange, "function");
  assert.equal(typeof core.TranscriptError, "function");
});

test("the classic build carries no module syntax", () => {
  assert.doesNotMatch(source, /^export\s/m);
  assert.doesNotMatch(source, /^import\s/m);
});

test("the classic build parses timed text the same way the module does", () => {
  const core = loadCore();
  const xml = '<p t="1000" d="2000"><s>Hello</s><s t="500"> world</s></p>';
  const parsed = core.parseTimedText(xml);
  assert.equal(parsed.hasWordTiming, true);
  assert.equal(parsed.phrases[0].text, "Hello world");
  assert.equal(parsed.words[1].start, 1.5);
});

test("the classic build fetches and classifies failures", async () => {
  const core = loadCore();
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    async json() {
      throw new Error("not json");
    },
    async text() {
      return "denied";
    },
  });
  await assert.rejects(
    () => core.fetchTranscript("abc", { fetchImpl, retries: 0 }),
    (err) => err.code === "upstream_failed",
  );
});

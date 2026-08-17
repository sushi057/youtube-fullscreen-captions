import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// feed.js is a classic script assigning one global. Loading it by evaluation
// keeps a single copy of the code under test.
const source = readFileSync(
  new URL("../../extension/feed.js", import.meta.url),
  "utf8",
);
const CaptionFeed = new Function(`${source}; return CaptionFeed;`)();

test("runs on the home feed", () => {
  assert.equal(CaptionFeed.runsOn("/"), true);
});

test("runs on subscriptions and search", () => {
  assert.equal(CaptionFeed.runsOn("/feed/subscriptions"), true);
  assert.equal(CaptionFeed.runsOn("/results"), true);
});

test("stays off the watch page, where the toolbar button already lives", () => {
  assert.equal(CaptionFeed.runsOn("/watch"), false);
});

test("stays off shorts, channels, and playlists, which are out of scope", () => {
  assert.equal(CaptionFeed.runsOn("/shorts/abc123"), false);
  assert.equal(CaptionFeed.runsOn("/@someone"), false);
  assert.equal(CaptionFeed.runsOn("/playlist"), false);
  assert.equal(CaptionFeed.runsOn("/feed/history"), false);
});

test("reads the video id from a watch link", () => {
  assert.equal(CaptionFeed.videoIdFrom("/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("reads the video id from an absolute watch link", () => {
  assert.equal(
    CaptionFeed.videoIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90"),
    "dQw4w9WgXcQ",
  );
});

test("ignores a link that carries no video id", () => {
  assert.equal(CaptionFeed.videoIdFrom("/watch?list=PL123"), null);
  assert.equal(CaptionFeed.videoIdFrom("/@someone"), null);
});

test("ignores a shorts link, so no icon appears on one", () => {
  assert.equal(CaptionFeed.videoIdFrom("/shorts/dQw4w9WgXcQ"), null);
});

test("survives a missing or malformed href", () => {
  assert.equal(CaptionFeed.videoIdFrom(null), null);
  assert.equal(CaptionFeed.videoIdFrom(""), null);
  assert.equal(CaptionFeed.videoIdFrom("::not a url::"), null);
});

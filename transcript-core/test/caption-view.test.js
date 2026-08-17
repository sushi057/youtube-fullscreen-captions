import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// caption-view.js is a classic script that assigns one global, because Chrome
// content scripts cannot import modules. Loading it here by evaluation keeps a
// single copy of the code under test.
const source = readFileSync(
  new URL("../../extension/caption-view.js", import.meta.url),
  "utf8",
);
const CaptionView = new Function(`${source}; return CaptionView;`)();

const WORDS = [
  { start: 1, text: "Never" },
  { start: 2, text: "gonna" },
  { start: 3, text: "give" },
  { start: 4, text: "you" },
  { start: 5, text: "up." },
  { start: 6, text: "Never" },
];

test("flatten uses real word timing when the transcript has it", () => {
  const words = CaptionView.flatten({
    hasWordTiming: true,
    words: [{ start: 2, text: "hi" }],
    phrases: [{ start: 0, dur: 4, text: "ignored" }],
  });
  assert.deepEqual(words, [{ start: 2, text: "hi" }]);
});

test("flatten spreads a phrase's words across its duration when timing is absent", () => {
  const words = CaptionView.flatten({
    hasWordTiming: false,
    words: [],
    phrases: [{ start: 10, dur: 3, text: "one two three" }],
  });
  assert.deepEqual(
    words.map((w) => w.text),
    ["one", "two", "three"],
  );
  assert.equal(words[0].start, 10);
  assert.equal(words[1].start, 11);
  assert.equal(words[2].start, 12);
});

test("flatten gives a phrase with no duration a usable pace", () => {
  const words = CaptionView.flatten({
    hasWordTiming: false,
    words: [],
    phrases: [{ start: 0, dur: 0, text: "one two" }],
  });
  assert.equal(words.length, 2);
  assert.ok(words[1].start > words[0].start);
});

test("lastIndexBefore finds the word being spoken", () => {
  assert.equal(CaptionView.lastIndexBefore(WORDS, 3.5), 2);
  assert.equal(CaptionView.lastIndexBefore(WORDS, 1), 0);
  assert.equal(CaptionView.lastIndexBefore(WORDS, 0.5), -1);
  assert.equal(CaptionView.lastIndexBefore(WORDS, 99), 5);
});

test("search finds every match, ignoring case", () => {
  const index = CaptionView.buildSearchIndex(WORDS);
  assert.deepEqual(CaptionView.search(index, "never"), [0, 5]);
});

test("search matches a phrase that spans several words, counting it once", () => {
  const index = CaptionView.buildSearchIndex(WORDS);
  assert.deepEqual(CaptionView.search(index, "gonna give you"), [1]);
});

test("search returns nothing for an absent phrase or an empty query", () => {
  const index = CaptionView.buildSearchIndex(WORDS);
  assert.deepEqual(CaptionView.search(index, "zzzqqq"), []);
  assert.deepEqual(CaptionView.search(index, "   "), []);
});

test("one channel is shown as it is written", () => {
  assert.deepEqual(CaptionView.channelLabel(1, "Rick Astley"), {
    text: "Rick Astley",
    title: "",
  });
});

test("two channels keep YouTube's own wording, conjunction and all", () => {
  assert.deepEqual(
    CaptionView.channelLabel(2, "Chris Williamson and Alex Hormozi"),
    { text: "Chris Williamson and Alex Hormozi", title: "" },
  );
});

test("more than two are counted, with the full list kept for the tooltip", () => {
  assert.deepEqual(CaptionView.channelLabel(3, "A, B and C"), {
    text: "3 channels",
    title: "A, B and C",
  });
  assert.deepEqual(CaptionView.channelLabel(7, "A, B, C, D, E, F and G"), {
    text: "7 channels",
    title: "A, B, C, D, E, F and G",
  });
});

test("the cut-off can be moved", () => {
  assert.deepEqual(CaptionView.channelLabel(3, "A, B and C", 3), {
    text: "A, B and C",
    title: "",
  });
});

test("no name means no label at all", () => {
  assert.equal(CaptionView.channelLabel(2, ""), null);
  assert.equal(CaptionView.channelLabel(2, "   "), null);
  assert.equal(CaptionView.channelLabel(0, null), null);
});

test("an unknown count falls back to showing the text", () => {
  assert.deepEqual(CaptionView.channelLabel(0, "Rick Astley"), {
    text: "Rick Astley",
    title: "",
  });
});

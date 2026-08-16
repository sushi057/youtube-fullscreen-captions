import test from "node:test";
import assert from "node:assert";

import { cutRange } from "../lib/transcript.js";

const WORDS = [
  { start: 1, text: "We're", p: 0 },
  { start: 1.5, text: "no", p: 0 },
  { start: 2, text: "strangers", p: 0 },
  { start: 3, text: "to", p: 1 },
  { start: 3.5, text: "love.", p: 1 },
];

test("cutRange keeps the words inside the range, inclusive of the start", () => {
  const cut = cutRange(WORDS, 1.5, 3);
  assert.deepEqual(
    cut.words.map((w) => w.text),
    ["no", "strangers", "to"],
  );
  assert.equal(cut.text, "no strangers to");
});

test("cutRange reports the true start and end of what it cut", () => {
  const cut = cutRange(WORDS, 1.4, 3.1);
  assert.equal(cut.start, 1.5);
  assert.equal(cut.end, 3);
});

test("cutRange accepts a reversed range", () => {
  const cut = cutRange(WORDS, 3, 1.5);
  assert.equal(cut.text, "no strangers to");
});

test("cutRange returns nothing when no word falls in the range", () => {
  const cut = cutRange(WORDS, 10, 20);
  assert.deepEqual(cut.words, []);
  assert.equal(cut.text, "");
  assert.equal(cut.start, 10);
  assert.equal(cut.end, 20);
});

test("cutRange stops at the end of the transcript", () => {
  const cut = cutRange(WORDS, 3, 999);
  assert.equal(cut.text, "to love.");
  assert.equal(cut.end, 3.5);
});

test("cutRange treats a missing word list as empty", () => {
  const cut = cutRange([], 0, 5);
  assert.deepEqual(cut.words, []);
  assert.equal(cut.text, "");
});

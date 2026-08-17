import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// intent.js is a classic script that assigns one global, because Chrome
// content scripts cannot import modules. Loading it by evaluation keeps a
// single copy of the code under test.
const source = readFileSync(
  new URL("../../extension/intent.js", import.meta.url),
  "utf8",
);
const CaptionIntent = new Function(`${source}; return CaptionIntent;`)();

// A stand-in for sessionStorage. The real one is not available under node.
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}

test("take returns true for the video that was remembered", () => {
  const store = fakeStorage();
  CaptionIntent.remember(store, "abc123");
  assert.equal(CaptionIntent.take(store, "abc123"), true);
});

test("take clears the note, so a reload does not reopen the overlay", () => {
  const store = fakeStorage();
  CaptionIntent.remember(store, "abc123");
  CaptionIntent.take(store, "abc123");
  assert.equal(CaptionIntent.take(store, "abc123"), false);
  assert.equal(store.size(), 0);
});

test("take returns false for a different video, and still clears", () => {
  const store = fakeStorage();
  CaptionIntent.remember(store, "abc123");
  assert.equal(CaptionIntent.take(store, "zzz999"), false);
  assert.equal(CaptionIntent.take(store, "abc123"), false);
});

test("take returns false when nothing was remembered", () => {
  assert.equal(CaptionIntent.take(fakeStorage(), "abc123"), false);
});

test("remember refuses an empty video id", () => {
  const store = fakeStorage();
  assert.equal(CaptionIntent.remember(store, ""), false);
  assert.equal(store.size(), 0);
});

test("a storage that throws never breaks the caller", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(CaptionIntent.remember(broken, "abc123"), false);
  assert.equal(CaptionIntent.take(broken, "abc123"), false);
});

test("a missing storage never breaks the caller", () => {
  assert.equal(CaptionIntent.remember(null, "abc123"), false);
  assert.equal(CaptionIntent.take(null, "abc123"), false);
});

test("peek reports the note without consuming it", () => {
  const store = fakeStorage();
  CaptionIntent.remember(store, "abc123");
  assert.equal(CaptionIntent.peek(store, "abc123"), true);
  // Still there: the curtain peeks early, the overlay takes it later.
  assert.equal(CaptionIntent.peek(store, "abc123"), true);
  assert.equal(CaptionIntent.take(store, "abc123"), true);
});

test("peek says no for a different video, and leaves the note alone", () => {
  const store = fakeStorage();
  CaptionIntent.remember(store, "abc123");
  assert.equal(CaptionIntent.peek(store, "zzz999"), false);
  assert.equal(CaptionIntent.take(store, "abc123"), true);
});

test("peek survives a missing or broken storage", () => {
  assert.equal(CaptionIntent.peek(null, "abc123"), false);
  assert.equal(
    CaptionIntent.peek(
      {
        getItem: () => {
          throw new Error("denied");
        },
      },
      "abc123",
    ),
    false,
  );
});

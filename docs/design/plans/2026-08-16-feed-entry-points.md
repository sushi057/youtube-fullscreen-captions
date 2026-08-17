# Feed Entry Points Implementation Plan

**Goal:** Put a hover icon on YouTube feed and search thumbnails that takes the user straight into Caption Mode for that video.

**Architecture:** A new content script (`feed.js`) marks each thumbnail once and adds an icon into the thumbnail's hover overlay. Clicking it writes an intent note to `sessionStorage` and does a full page load of `/watch?v=…`. The existing watch-page script (`content.js`) reads that note on startup and opens the overlay. The note format lives in a third small file (`intent.js`) that both scripts load, so writer and reader cannot drift.

**Tech Stack:** Plain classic scripts (no bundler, no modules — Chrome content scripts cannot import). Chrome Manifest V3. Tests with `node --test`.

**Spec:** `docs/design/specs/2026-08-16-feed-entry-points-design.md`

## Global Constraints

- **Classic scripts only.** Every extension file is a classic script assigning exactly one global via an IIFE. No `import`, no `export`, no `module.exports`. This is the existing pattern in `caption-view.js` and `overlay.js`.
- **Full page load, not SPA navigation.** The manifest matches `*://www.youtube.com/watch*`. Chrome does **not** re-inject content scripts on a YouTube SPA navigation, so a click that SPA-navigates from the feed to a watch page would leave `content.js` never running. The click handler must therefore set `window.location.href`, and must `preventDefault()` YouTube's own anchor.
- **Tests live in `transcript-core/test/`** and load extension files by evaluation, following `transcript-core/test/caption-view.test.js`. `npm test` at the repo root already runs them.
- **Formatting:** `npm run format` (Prettier) and `npm run lint` (ESLint) must both pass before every commit.
- **Deviation from the spec, deliberate:** the spec named two new files. This plan adds a third, `extension/intent.js`, because the note's key and shape are shared by two scripts that load separately. One definition, two consumers.
- **The spec's out-of-scope list holds:** no sidebar, no channel pages, no playlists, no Shorts, no caption pre-check.

---

### Task 1: The intent note

The shared handoff between the feed script and the watch script. Pure logic, fully testable, no DOM.

**Files:**

- Create: `extension/intent.js`
- Test: `transcript-core/test/intent.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces: global `CaptionIntent` with:
  - `CaptionIntent.remember(storage, videoId)` → `boolean` (true if written)
  - `CaptionIntent.take(storage, videoId)` → `boolean` (true if a note for this video was present; always clears the note)

- [ ] **Step 1: Write the failing test**

Create `transcript-core/test/intent.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test transcript-core/test/intent.test.js`

Expected: FAIL, because `extension/intent.js` does not exist — the `readFileSync` call throws `ENOENT`.

- [ ] **Step 3: Write the implementation**

Create `extension/intent.js`:

```js
// The note the feed page leaves for the watch page.
//
// Clicking Caption Mode on a feed thumbnail is a navigation, not a toggle: the
// feed script dies and the watch script starts fresh with the overlay closed.
// This module is the one place that says what that note looks like, so the
// writer and the reader cannot drift apart.
//
// sessionStorage rather than a URL parameter: a parameter would stay in the
// address bar and leak into any link the user copies.

// eslint-disable-next-line no-unused-vars
const CaptionIntent = (() => {
  const KEY = "caption-mode:open";

  // Storage can be missing or refuse to answer (private mode, blocked
  // third-party storage). None of that is worth breaking a click over, so
  // every path here degrades to "no note".
  function remember(storage, videoId) {
    if (!storage || !videoId) return false;
    try {
      storage.setItem(KEY, videoId);
      return true;
    } catch {
      return false;
    }
  }

  // Reading a note consumes it. Clearing happens even on a mismatch, so a
  // stale note cannot fire later on an unrelated video.
  function take(storage, videoId) {
    if (!storage) return false;
    try {
      const noted = storage.getItem(KEY);
      if (noted === null) return false;
      storage.removeItem(KEY);
      return Boolean(videoId) && noted === videoId;
    } catch {
      return false;
    }
  }

  return { remember, take };
})();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test transcript-core/test/intent.test.js`

Expected: PASS, 7 tests.

- [ ] **Step 5: Confirm the whole suite and the linters are clean**

Run: `npm test && npm run lint && npm run format:check`

Expected: all pass. If Prettier objects, run `npm run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add extension/intent.js transcript-core/test/intent.test.js
git commit -m "Add the note the feed page leaves for the watch page"
```

---

### Task 2: The watch page acts on the note

Wire `intent.js` into the existing watch-page script, so arriving with a note opens the overlay.

**Files:**

- Modify: `extension/manifest.json`
- Modify: `extension/content.js:77-92` (the `start` function)
- Test: manual, plus the existing suite

**Interfaces:**

- Consumes: `CaptionIntent.take(storage, videoId)` from Task 1.
- Produces: nothing for later tasks. Task 3 relies only on `CaptionIntent.remember`.

- [ ] **Step 1: Load `intent.js` on the watch page**

In `extension/manifest.json`, add `"intent.js"` to the existing content script's `js` array. It must come **before** `content.js`, because `content.js` will call it. The array becomes:

```json
"js": [
  "vendor/transcript-classic.js",
  "caption-view.js",
  "overlay.js",
  "intent.js",
  "content.js"
]
```

- [ ] **Step 2: Act on the note at startup**

In `extension/content.js`, add this function directly above `function start()`:

```js
// The feed page leaves a note when the user clicks Caption Mode on a
// thumbnail. Chrome does not re-inject content scripts on YouTube's own SPA
// navigations, so that click is always a full page load, and this runs once as
// the watch page comes up.
function openIfRequested() {
  const id = getVideoId();
  if (!id) return;
  let store = null;
  try {
    store = window.sessionStorage;
  } catch {
    return; // storage blocked; the user simply lands on the normal page
  }
  if (CaptionIntent.take(store, id)) CaptionOverlay.toggle();
}
```

- [ ] **Step 3: Call it once, after the button is in place**

In `extension/content.js`, inside `start()`, add the call immediately after the existing `CaptionOverlay.prefetch();` line, so the transcript is already warming when the overlay opens:

```js
function start() {
  injectButton();
  // Warm the transcript before anyone asks for it, so opening is instant.
  CaptionOverlay.prefetch();
  openIfRequested();
```

Leave the rest of `start()` unchanged. Do **not** call `openIfRequested` from the `yt-navigate-finish` handler: an SPA navigation within YouTube never carries a fresh note, and calling it there would risk reopening the overlay on an unrelated video.

- [ ] **Step 4: Verify by hand**

There is no feed icon yet, so simulate the note. Load the unpacked extension, open any YouTube video, and in the page console run:

```js
sessionStorage.setItem(
  "caption-mode:open",
  new URLSearchParams(location.search).get("v"),
);
location.reload();
```

Expected: the page reloads and the overlay opens by itself, with the video playing behind it.

Then reload once more without setting the key.

Expected: the normal watch page, overlay closed. This proves the note is consumed.

- [ ] **Step 5: Confirm the suite and linters are clean**

Run: `npm test && npm run lint && npm run format:check`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/content.js
git commit -m "Open Caption Mode on arrival when the feed asked for it"
```

---

### Task 3: The feed script's pure logic

Everything `feed.js` decides without touching the DOM: which pages it runs on, and how to read a video id out of a thumbnail link. Written and tested before any icon exists.

**Files:**

- Create: `extension/feed.js`
- Test: `transcript-core/test/feed.test.js`

**Interfaces:**

- Consumes: `CaptionIntent.remember` from Task 1 (used in Task 4, not here).
- Produces: global `CaptionFeed` with:
  - `CaptionFeed.runsOn(pathname)` → `boolean`
  - `CaptionFeed.videoIdFrom(href)` → `string | null`
  - Task 4 adds `CaptionFeed.decorate(root)` and `CaptionFeed.start()` to this same global.

- [ ] **Step 1: Write the failing test**

Create `transcript-core/test/feed.test.js`:

```js
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// feed.js is a classic script assigning one global. Loading it by evaluation
// keeps a single copy of the code under test. It is loaded with a stub for the
// browser globals it touches at definition time.
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test transcript-core/test/feed.test.js`

Expected: FAIL, because `extension/feed.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `extension/feed.js`. This task writes only the pure half; Task 4 fills in the DOM half.

```js
// Caption Mode's second entry point: an icon on feed thumbnails.
//
// This script never opens the overlay. The overlay drives the watch page's own
// <video>, and a feed page has no player — only muted hover previews. So the
// icon navigates to the watch page and leaves a note for the script there.

// eslint-disable-next-line no-unused-vars
const CaptionFeed = (() => {
  // Only the two surfaces the design asks for. Everything else — the watch
  // page, shorts, channels, playlists, history — is out of scope, and an
  // unknown path is treated as out of scope too.
  const PATHS = ["/", "/feed/subscriptions", "/results"];

  function runsOn(pathname) {
    return PATHS.includes(pathname);
  }

  // The id comes from the thumbnail's own link, never from page state, because
  // one feed holds many videos. A shorts link has no `v` parameter, so it
  // falls out here without a special case.
  function videoIdFrom(href) {
    if (!href) return null;
    try {
      const url = new URL(href, "https://www.youtube.com");
      if (url.pathname !== "/watch") return null;
      return url.searchParams.get("v") || null;
    } catch {
      return null;
    }
  }

  return { runsOn, videoIdFrom };
})();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test transcript-core/test/feed.test.js`

Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm the suite and linters are clean**

Run: `npm test && npm run lint && npm run format:check`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add extension/feed.js transcript-core/test/feed.test.js
git commit -m "Decide which feed pages get an icon, and read ids from links"
```

---

### Task 4: The icon on the thumbnail

The DOM half: build the icon, place it in the hover overlay, handle the click, and keep it alive as YouTube re-renders.

**Files:**

- Modify: `extension/feed.js`
- Create: `extension/feed.css`
- Modify: `extension/manifest.json`

**Interfaces:**

- Consumes: `CaptionFeed.runsOn`, `CaptionFeed.videoIdFrom` from Task 3; `CaptionIntent.remember` from Task 1.
- Produces: nothing later depends on this.

- [ ] **Step 1: Add the DOM half to `feed.js`**

In `extension/feed.js`, inside the IIFE and directly above the `return` statement, add:

```js
const MARK = "data-caption-mode";
const BTN_CLASS = "caption-mode-thumb-btn";

// The same closed-caption glyph as the watch-page toolbar button, so both
// entry points read as one feature.
const GLYPH =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-8 ' +
  "7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 " +
  "1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 " +
  '1 .45 1 1v1z"/></svg>';

// Chrome does not re-inject content scripts on YouTube's SPA navigations, so
// the watch-page script only runs on a real page load. The click must
// therefore be a full navigation, and YouTube's own anchor must be stopped.
function onClick(event, videoId) {
  event.preventDefault();
  event.stopPropagation();
  try {
    CaptionIntent.remember(window.sessionStorage, videoId);
  } catch {
    // Storage blocked. The user still gets the video, just not the overlay.
  }
  window.location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function buildButton(videoId) {
  const btn = document.createElement("button");
  btn.className = BTN_CLASS;
  btn.type = "button";
  btn.title = "Open in Caption Mode";
  btn.setAttribute("aria-label", "Open in Caption Mode");
  btn.innerHTML = GLYPH;
  btn.addEventListener("click", (e) => onClick(e, videoId));
  return btn;
}

// One icon per thumbnail, ever. The mark is what makes a re-scan cheap and
// stops a second icon appearing when YouTube re-renders around us.
function decorateThumb(thumb) {
  if (thumb.hasAttribute(MARK)) return;
  const link = thumb.querySelector("a#thumbnail[href]");
  const videoId = videoIdFrom(link && link.getAttribute("href"));
  if (!videoId) return; // no id yet, or not a video: leave it unmarked
  thumb.setAttribute(MARK, "1");

  const btn = buildButton(videoId);
  // YouTube's own hover buttons (Watch Later, queue) live in this slot and
  // hold the top-right corner. Sit to their left rather than on top.
  const slot = thumb.querySelector("#hover-overlays");
  if (slot) {
    if (slot.childElementCount > 0) btn.classList.add(`${BTN_CLASS}--shift`);
    slot.appendChild(btn);
  } else {
    thumb.appendChild(btn);
  }
}

function decorate(root) {
  const scope = root && root.querySelectorAll ? root : document;
  for (const thumb of scope.querySelectorAll("ytd-thumbnail")) {
    decorateThumb(thumb);
  }
}
```

Then change the `return` line to expose the new entry points:

```js
return { runsOn, videoIdFrom, decorate, start };
```

- [ ] **Step 2: Add the lifecycle, and only run on the right pages**

Still inside the IIFE, directly above the `return`, add:

```js
// YouTube replaces feed contents on navigation, on infinite scroll, and on
// filter-chip changes. Re-scanning is cheap because every thumbnail we have
// already handled carries the mark.
let scheduled = false;
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (runsOn(window.location.pathname)) decorate(document);
  });
}

function start() {
  scheduleScan();
  document.addEventListener("yt-navigate-finish", scheduleScan);
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
```

At the very bottom of the file, **after** the IIFE closes, add:

```js
// Guarded because the tests load this file by evaluation, with no DOM.
if (typeof document !== "undefined") CaptionFeed.start();
```

- [ ] **Step 3: Run the existing tests and confirm they still pass**

Run: `node --test transcript-core/test/feed.test.js`

Expected: PASS, still 9 tests. If it fails with `document is not defined`, the guard in Step 2 is missing.

- [ ] **Step 4: Write the styles**

Create `extension/feed.css`:

```css
/* The Caption Mode icon on a feed thumbnail.
   It borrows YouTube's own hover-overlay vocabulary: hidden until the pointer
   is over the thumbnail, dark translucent chip, top-right corner. */
.caption-mode-thumb-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  /* Hidden means unreachable: no stray click, no tab stop. */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.1s ease-in;
}

/* YouTube's own buttons hold the corner, so step aside for them. */
.caption-mode-thumb-btn--shift {
  right: 40px;
}

.caption-mode-thumb-btn svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}

.caption-mode-thumb-btn:hover {
  background: rgba(0, 0, 0, 0.85);
}

ytd-thumbnail:hover .caption-mode-thumb-btn,
.caption-mode-thumb-btn:focus-visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.caption-mode-thumb-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
```

- [ ] **Step 5: Register the feed script in the manifest**

In `extension/manifest.json`, add a second entry to the `content_scripts` array, after the existing watch-page entry:

```json
{
  "matches": ["*://www.youtube.com/*"],
  "js": ["intent.js", "feed.js"],
  "css": ["feed.css"],
  "run_at": "document_idle"
}
```

`intent.js` must come first, because `feed.js` calls `CaptionIntent.remember`. The match is the whole origin because YouTube's SPA changes the path without reloading; `CaptionFeed.runsOn` is what limits the script to the two surfaces, and it is re-checked on every scan.

- [ ] **Step 6: Playtest, following the spec's verification list**

Load the unpacked extension from `extension/`, then on a logged-in YouTube session check each of these:

1. **Home grid** — hover a thumbnail. The icon appears in the top-right, left of YouTube's own buttons. It disappears when the pointer leaves.
2. **Click it** — the browser navigates to the watch page and the overlay opens by itself, with audio playing.
3. **Back** — returns to the feed. Hovering still shows icons, and there is exactly one per thumbnail.
4. **Search results** (`/results?search_query=…`) — same behaviour on the wide list rows.
5. **Infinite scroll** — scroll far down the home feed. Newly loaded thumbnails get icons too.
6. **Filter chips** — click a chip on the home feed. The replaced thumbnails get icons, and no thumbnail ends up with two.
7. **A video with no captions** — click through to one. The overlay opens and shows "This video has no captions."
8. **Watch page** — confirm no icons appear on the sidebar thumbnails, and the toolbar button still works.

Take a screenshot of the hovered thumbnail and compare it against YouTube's own hover buttons for size and alignment.

- [ ] **Step 7: Confirm the suite and linters are clean**

Run: `npm test && npm run lint && npm run format:check`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add extension/feed.js extension/feed.css extension/manifest.json
git commit -m "Show a Caption Mode icon when a feed thumbnail is hovered"
```

---

## Notes for the reviewer

- **Why a full page load and not SPA navigation.** This is the single most likely thing to get "cleaned up" into a bug. Chrome injects content scripts on document load. YouTube's in-page navigation never triggers that, so if the click is allowed to SPA-navigate, `content.js` never runs on the destination and the overlay never opens. The `preventDefault()` plus `window.location.href` is load-bearing.
- **Why the mark is an attribute, not a class.** YouTube rewrites class lists on its own elements during re-render. An unusual data attribute survives.
- **Known limitation.** `CaptionFeed.runsOn` matches exact paths. If YouTube adds a feed surface, the icon silently does not appear there. That is the intended failure: degrade to normal YouTube.

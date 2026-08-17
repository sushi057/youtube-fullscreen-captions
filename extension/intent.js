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

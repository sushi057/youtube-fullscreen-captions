// The black screen that covers the watch page while Caption Mode loads.
//
// Clicking the icon in the feed is a navigation, and the overlay cannot open
// until YouTube has built its player. That left about a second of ordinary
// watch page on show — the thing the user was trying to skip.
//
// So this runs at document_start, before YouTube paints anything, and paints
// black immediately. The overlay takes the curtain down as it opens, and the
// two look like one screen because the curtain holds the overlay's own chrome
// in the places the real chrome will appear.
//
// It draws only when the feed left a note for this video. Arriving at a watch
// page any other way is left alone.

const CaptionCurtain = (() => {
  const ID = "caption-mode-curtain";
  // Marks the document while the curtain is up, so the stylesheet can keep the
  // player from painting through it.
  const CURTAIN_UP = "cm-curtain";

  // If the overlay never opens — no player, no captions, a script that threw —
  // the curtain must not leave the user staring at black. This matches the
  // deadline the watch script waits for the player.
  const GIVE_UP_MS = 20000;

  function wanted() {
    const id = new URLSearchParams(window.location.search).get("v");
    if (!id) return false;
    try {
      return CaptionIntent.peek(window.sessionStorage, id);
    } catch {
      return false;
    }
  }

  function build() {
    const el = document.createElement("div");
    el.id = ID;
    // The same furniture as the overlay, in the same places: a title and
    // channel at the top, a control bar at the bottom. Filling in beats
    // being replaced.
    el.innerHTML =
      '<div class="cmc-badge">' +
      '<div class="cmc-line cmc-title"></div>' +
      '<div class="cmc-line cmc-author"></div>' +
      "</div>" +
      '<div class="cmc-bar">' +
      '<div class="cmc-dot"></div>' +
      '<div class="cmc-dot"></div>' +
      '<div class="cmc-dot"></div>' +
      '<div class="cmc-line cmc-seek"></div>' +
      "</div>";
    return el;
  }

  function remove() {
    document.documentElement.classList.remove(CURTAIN_UP);
    const el = document.getElementById(ID);
    if (el) el.remove();
  }

  // document_start runs before <body> exists, so the curtain starts on <html>
  // and moves into <body> the moment there is one. Waiting for DOMContentLoaded
  // was far too late: YouTube had drawn its player by then, and a curtain
  // hanging off <html> loses to it.
  function moveIntoBody(el) {
    if (!document.body || el.parentElement === document.body) return false;
    document.body.appendChild(el);
    return true;
  }

  function raise() {
    if (!wanted()) return;
    if (document.getElementById(ID)) return;
    const el = build();
    document.documentElement.classList.add(CURTAIN_UP);
    (document.body || document.documentElement).appendChild(el);

    if (!moveIntoBody(el)) {
      const watcher = new MutationObserver(() => {
        if (moveIntoBody(el)) watcher.disconnect();
      });
      watcher.observe(document.documentElement, { childList: true });
      // The parser can finish before the observer is even reached.
      document.addEventListener("DOMContentLoaded", () => {
        moveIntoBody(el);
        watcher.disconnect();
      });
    }

    setTimeout(remove, GIVE_UP_MS);
  }

  return { raise, remove };
})();

if (typeof document !== "undefined") CaptionCurtain.raise();

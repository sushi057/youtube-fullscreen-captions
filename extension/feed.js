// Caption Mode's second entry point: an icon on feed thumbnails.
//
// This script never opens the overlay. The overlay drives the watch page's own
// <video>, and a feed page has no player — only muted hover previews. So the
// icon navigates to the watch page and leaves a note for the script there.

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

  const MARK = "data-caption-mode";
  const BTN_CLASS = "caption-mode-thumb-btn";
  const HOST_CLASS = "caption-mode-host";

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
    window.location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(
      videoId,
    )}`;
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

  // YouTube is mid-migration between two thumbnail markups, and which one an
  // account gets varies. The old one is <ytd-thumbnail> with an #hover-overlays
  // slot; the new one is <yt-lockup-view-model>, which has no such slot. Keying
  // off the thumbnail link covers both, and survives the next rename of the
  // wrapper element.
  const THUMB_LINKS =
    "a#thumbnail[href], a.ytLockupViewModelContentImage[href]";

  // One icon per link, ever. The mark is what makes a re-scan cheap and stops
  // a second icon appearing when YouTube re-renders around us.
  function decorateLink(link) {
    if (link.hasAttribute(MARK)) return;
    const videoId = videoIdFrom(link.getAttribute("href"));
    if (!videoId) return; // no id yet, or not a video: leave it unmarked
    link.setAttribute(MARK, "1");

    const btn = buildButton(videoId);
    // The old markup has a slot built for exactly this, and YouTube's own
    // hover buttons (Watch Later, queue) already hold its top-right corner.
    // Sit to their left rather than on top.
    const thumb = link.closest("ytd-thumbnail");
    const slot = thumb && thumb.querySelector("#hover-overlays");
    let host;
    if (slot) {
      if (slot.childElementCount > 0) btn.classList.add(`${BTN_CLASS}--shift`);
      slot.appendChild(btn);
      host = thumb;
    } else {
      // The new markup has no slot, so the link itself becomes the frame.
      link.appendChild(btn);
      host = link;
    }
    // The icon is positioned against this box, and revealed by hovering it.
    host.classList.add(HOST_CLASS);
  }

  function decorate(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const link of scope.querySelectorAll(THUMB_LINKS)) {
      decorateLink(link);
    }
  }

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

  return { runsOn, videoIdFrom, decorate, start };
})();

// Guarded because the tests load this file by evaluation, with no DOM.
if (typeof document !== "undefined") CaptionFeed.start();

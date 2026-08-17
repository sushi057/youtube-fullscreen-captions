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
  const ITEM_CLASS = "caption-mode-item";

  // The whole feed card, across both markups and both feed layouts.
  const ITEMS =
    "ytd-rich-item-renderer, ytd-video-renderer, yt-lockup-view-model";

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
    btn.innerHTML = CaptionGlyph.svg();
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
    // The old markup has a slot built for exactly this.
    const thumb = link.closest("ytd-thumbnail");
    const slot = thumb && thumb.querySelector("#hover-overlays");
    let host;
    if (slot) {
      slot.appendChild(btn);
      host = thumb;
    } else {
      // The new markup has no slot, so the link itself becomes the frame.
      link.appendChild(btn);
      host = link;
    }
    // The icon is positioned against this box.
    host.classList.add(HOST_CLASS);

    // But it is revealed by hovering the whole card, not the thumbnail. Moving
    // the pointer toward the icon makes YouTube swap its inline preview over
    // the thumbnail, which changes the hover target underneath the user and
    // made the icon vanish just as they reached for it. The card stays put.
    const card = link.closest(ITEMS) || host;
    card.classList.add(ITEM_CLASS);
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

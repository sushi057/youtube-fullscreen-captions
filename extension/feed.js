// Caption Mode's second entry point: an icon over feed thumbnails.
//
// This script never opens the overlay. The overlay drives the watch page's own
// <video>, and a feed page has no player — only muted hover previews. So the
// icon navigates to the watch page and leaves a note for the script there.
//
// The icon is ONE element on <body>, positioned over whichever thumbnail the
// pointer is on. It is not placed inside the thumbnail, and that is the whole
// design: YouTube swaps its inline preview player into the hovered thumbnail,
// re-renders the subtree, and applies `contain` and `overflow: hidden` to it.
// Anything living in there gets covered, clipped, or thrown away the moment
// the preview starts. Nothing on <body> can be touched by any of that.

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

  // A feed card, across both of YouTube's thumbnail markups and both layouts.
  const CARDS =
    "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, " +
    "yt-lockup-view-model";

  // The picture within a card, used to place the icon. The card is wider than
  // the picture in list layouts, so the picture is what we measure.
  const PICTURES = "ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail";

  const BTN_ID = "caption-mode-feed-btn";

  let btn = null;
  let currentId = null;
  let currentCard = null;

  function build() {
    const b = document.createElement("button");
    b.id = BTN_ID;
    b.type = "button";
    b.title = "Open in Caption Mode";
    b.setAttribute("aria-label", "Open in Caption Mode");
    b.innerHTML = CaptionGlyph.svg();
    b.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!currentId) return;
      try {
        CaptionIntent.remember(window.sessionStorage, currentId);
      } catch {
        // Storage blocked. The user still gets the video, just not the overlay.
      }
      // A full page load, not an SPA navigation: Chrome does not re-inject
      // content scripts on YouTube's own in-page navigations, so the watch
      // script would never run and the overlay would never open.
      window.location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(
        currentId,
      )}`;
    });
    document.body.appendChild(b);
    return b;
  }

  function hide() {
    currentId = null;
    currentCard = null;
    if (btn) btn.style.display = "none";
  }

  // Is the pointer still over the card the icon belongs to? This is asked by
  // position, not by DOM ancestry, because YouTube's inline preview player
  // covers the thumbnail while living outside the card in the DOM. Asking
  // "which card is this element in?" answers "none" for the preview, and the
  // icon would hide itself the instant the preview appeared.
  function stillOverCard(x, y) {
    if (!currentCard || !currentCard.isConnected) return false;
    const r = currentCard.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function showOver(card) {
    const link = card.querySelector('a[href*="/watch?v="]');
    const videoId = videoIdFrom(link && link.getAttribute("href"));
    if (!videoId) return hide();

    const picture = card.querySelector(PICTURES) || card;
    const r = picture.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) return hide(); // collapsed or off-screen

    if (!btn) btn = build();
    currentId = videoId;
    currentCard = card;
    btn.style.top = `${Math.round(r.top + 8)}px`;
    btn.style.left = `${Math.round(r.left + 8)}px`;
    btn.style.display = "flex";
  }

  function onPointerOver(event) {
    if (!runsOn(window.location.pathname)) return hide();
    const target = event.target;
    if (btn && (target === btn || btn.contains(target))) return; // reaching it
    const card = target.closest && target.closest(CARDS);
    if (card) showOver(card);
    else if (!stillOverCard(event.clientX, event.clientY)) hide();
  }

  function start() {
    // One delegated listener, so nothing needs re-attaching when YouTube
    // re-renders the feed on scroll, on a filter chip, or on navigation.
    document.addEventListener("mouseover", onPointerOver, true);
    // A fixed position goes stale the moment the page moves under it. Not in
    // the capture phase: that would also catch scrolling inside YouTube's own
    // widgets, which does not move the feed at all.
    window.addEventListener("scroll", hide);
    document.addEventListener("yt-navigate-finish", hide);
  }

  return { runsOn, videoIdFrom, start, hide };
})();

// Guarded because the tests load this file by evaluation, with no DOM.
if (typeof document !== "undefined") CaptionFeed.start();

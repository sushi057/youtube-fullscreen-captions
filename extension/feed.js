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

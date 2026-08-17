// Caption Mode for YouTube — injects a launcher button into the watch-page
// action row (next to Like / Dislike / Share) that toggles the caption overlay
// on this page.

const BUTTON_ID = "caption-mode-btn";

function getVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

function openCaptionMode() {
  if (!getVideoId()) return;
  CaptionOverlay.toggle();
}

function buildButton() {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.className = "caption-mode-btn";
  btn.type = "button";
  btn.title = "Open in Caption Mode";
  // Icon + label to match YouTube's native action buttons (Share, Download…).
  btn.innerHTML =
    CaptionGlyph.svg("caption-mode-icon") +
    '<span class="caption-mode-text">Caption Mode</span>';
  btn.addEventListener("click", openCaptionMode);
  return btn;
}

// The action row holding Like/Dislike/Share. YouTube renders it lazily and
// re-renders on SPA navigation, so we look it up fresh each time.
function findActionRow() {
  return document.querySelector(
    "ytd-watch-metadata #actions-inner #top-level-buttons-computed, " +
      "ytd-watch-metadata #top-level-buttons-computed",
  );
}

// Copy the resolved look of a real YouTube tonal button onto ours, whatever
// the theme/version resolves it to. The pills carry a subtle vertical gradient
// in background-image, so the background color alone is not enough: it leaves
// our pill flat and darker at the top than its neighbours.
function styleLikeNativeButton(btn) {
  const native = document.querySelector(
    "ytd-watch-metadata button.yt-spec-button-shape-next--tonal, " +
      "ytd-watch-metadata .yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal",
  );
  if (!native) return;
  const style = getComputedStyle(native);
  const bg = style.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)") btn.style.backgroundColor = bg;
  if (style.backgroundImage && style.backgroundImage !== "none") {
    btn.style.backgroundImage = style.backgroundImage;
  }
  // Match the pill geometry too, so ours lines up with the row.
  if (style.height) btn.style.height = style.height;
  if (style.borderRadius) btn.style.borderRadius = style.borderRadius;
}

function injectButton() {
  if (!getVideoId()) return;
  if (document.getElementById(BUTTON_ID)) return; // already present
  const row = findActionRow();
  if (!row) return;
  const btn = buildButton();
  styleLikeNativeButton(btn);
  row.appendChild(btn);
}

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
  if (!CaptionIntent.take(store, id)) return;

  // The player is not in the page yet when this script first runs, and the
  // overlay needs it: it drives the watch page's own <video> instead of making
  // one, and open() gives up quietly when there is none. Opening straight away
  // therefore dropped the request and left the user on the plain watch page.
  const deadline = Date.now() + 20000;
  const tryOpen = () => {
    if (CaptionOverlay.isOpen()) return;
    if (CaptionOverlay.hasVideo()) {
      CaptionOverlay.open();
      return;
    }
    if (Date.now() < deadline) setTimeout(tryOpen, 100);
  };
  tryOpen();
}

// Re-inject on initial load, on YouTube SPA navigation, and whenever the
// action row is (re)rendered.
function start() {
  injectButton();
  // Warm the transcript before anyone asks for it, so opening is instant.
  CaptionOverlay.prefetch();
  openIfRequested();

  document.addEventListener("yt-navigate-finish", () => {
    CaptionOverlay.prefetch();
    // Old button belongs to the previous video's DOM; clean up just in case.
    const stale = document.getElementById(BUTTON_ID);
    if (stale) stale.remove();
    injectButton();
  });

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });
}

start();

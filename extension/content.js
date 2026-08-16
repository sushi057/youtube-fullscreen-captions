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
  // Material "closed caption" glyph: a filled white box with "CC" cut out.
  btn.innerHTML =
    '<svg class="caption-mode-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm-8 ' +
    "7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 " +
    "1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 " +
    '1 .45 1 1v1z"/></svg>' +
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

// Read the exact background color of a real YouTube tonal button so ours
// matches precisely, whatever the theme/version resolves it to.
function nativeButtonBg() {
  const native = document.querySelector(
    "ytd-watch-metadata button.yt-spec-button-shape-next--tonal, " +
      "ytd-watch-metadata .yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal",
  );
  if (!native) return null;
  const bg = getComputedStyle(native).backgroundColor;
  return bg && bg !== "rgba(0, 0, 0, 0)" ? bg : null;
}

function injectButton() {
  if (!getVideoId()) return;
  if (document.getElementById(BUTTON_ID)) return; // already present
  const row = findActionRow();
  if (!row) return;
  const btn = buildButton();
  const bg = nativeButtonBg();
  if (bg) btn.style.backgroundColor = bg;
  row.appendChild(btn);
}

// Re-inject on initial load, on YouTube SPA navigation, and whenever the
// action row is (re)rendered.
function start() {
  injectButton();
  // Warm the transcript before anyone asks for it, so opening is instant.
  CaptionOverlay.prefetch();

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

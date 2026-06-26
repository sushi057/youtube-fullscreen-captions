// Caption Mode for YouTube — injects a launcher button into the watch-page
// action row (next to Like / Dislike / Share) that opens the current video
// in the Caption Mode website.

// TODO: point this at your real site once it's deployed.
const CAPTION_MODE_SITE = "http://localhost:3000";

const BUTTON_ID = "caption-mode-btn";

function getVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

function getCurrentTime() {
  // The page can hold several <video> tags (hover previews, mini-player, ads).
  // The real watch-page player is the one inside #movie_player.
  const video =
    document.querySelector("#movie_player video.html5-main-video") ||
    document.querySelector("#movie_player video");
  if (!video || !isFinite(video.currentTime)) return 0;
  return Math.floor(video.currentTime);
}

function openCaptionMode() {
  const videoId = getVideoId();
  if (!videoId) return;
  const url = new URL(CAPTION_MODE_SITE);
  url.searchParams.set("v", videoId);
  url.searchParams.set("t", String(getCurrentTime()));
  window.open(url.toString(), "_blank", "noopener");
}

function buildButton() {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.className = "caption-mode-btn";
  btn.type = "button";
  btn.title = "Open in Caption Mode";
  btn.textContent = "Caption Mode";
  btn.addEventListener("click", openCaptionMode);
  return btn;
}

// The action row holding Like/Dislike/Share. YouTube renders it lazily and
// re-renders on SPA navigation, so we look it up fresh each time.
function findActionRow() {
  return document.querySelector(
    "ytd-watch-metadata #actions-inner #top-level-buttons-computed, " +
    "ytd-watch-metadata #top-level-buttons-computed"
  );
}

function injectButton() {
  if (!getVideoId()) return;
  if (document.getElementById(BUTTON_ID)) return; // already present
  const row = findActionRow();
  if (!row) return;
  row.appendChild(buildButton());
}

// Re-inject on initial load, on YouTube SPA navigation, and whenever the
// action row is (re)rendered.
function start() {
  injectButton();

  document.addEventListener("yt-navigate-finish", () => {
    // Old button belongs to the previous video's DOM; clean up just in case.
    const stale = document.getElementById(BUTTON_ID);
    if (stale) stale.remove();
    injectButton();
  });

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });
}

start();

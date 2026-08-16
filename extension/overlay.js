// The black layer over the watch page.
//
// It creates no player. The watch page already has one, so the overlay reads
// and drives that video element. This is why embeds' rules — blocked autoplay,
// ads inside the frame, videos that refuse to embed — do not apply here.

// eslint-disable-next-line no-unused-vars
const CaptionOverlay = (() => {
  const ROOT_ID = "caption-mode-overlay";
  const MAX_LINES = 4;
  const TICK_MS = 100;

  const FAILURE_MESSAGES = {
    no_transcript: "This video has no captions.",
    unavailable: "This video is private, removed, or blocked in your region.",
    upstream_failed:
      "YouTube's caption service isn't responding. Try again in a moment.",
  };

  let root = null;
  let video = null;
  let words = [];
  let pages = [];
  let pageOfWord = [];
  let searchIndex = null;
  let mode = "flow";
  let timer = null;
  let foundWord = -1;
  // render cache
  let lastPage = -1;
  let lastWi = -1;
  let lastMode = "";
  let lastFound = -1;

  // The page holds several <video> tags (hover previews, the mini-player, ads).
  // The watch page's real player is the one inside #movie_player.
  function findVideo() {
    return (
      document.querySelector("#movie_player video.html5-main-video") ||
      document.querySelector("#movie_player video")
    );
  }

  function videoId() {
    return new URLSearchParams(window.location.search).get("v");
  }

  function build() {
    const el = document.createElement("div");
    el.id = ROOT_ID;
    el.innerHTML = `
      <div class="cm-badge">
        <div class="cm-title-line"><span class="cm-dot"></span><span class="cm-title"></span></div>
        <div class="cm-author"></div>
      </div>
      <div class="cm-stage"><div class="cm-caption caption"></div></div>
      <div class="cm-status"></div>
    `;
    return el;
  }

  function showStatus(msg) {
    const el = root.querySelector(".cm-status");
    el.textContent = msg;
    el.classList.add("visible");
  }

  function setTitle() {
    const title = document.querySelector(
      "ytd-watch-metadata #title h1 yt-formatted-string, h1.ytd-watch-metadata",
    );
    const author = document.querySelector("ytd-channel-name #text a");
    if (title) {
      root.querySelector(".cm-title").textContent = title.textContent.trim();
    }
    if (author) {
      root.querySelector(".cm-author").textContent = author.textContent.trim();
    }
  }

  // A transcript never changes once published, so this needs a ceiling but no
  // expiry. One fetch per video per page session.
  const cache = TranscriptCore.createCache(50);

  // The fetch happens here, in the content script, because this code runs on
  // youtube.com and so the call to YouTube's API is same-origin. The same call
  // from a service worker carries `Origin: chrome-extension://<id>`, and
  // YouTube answers 403.
  async function loadTranscript() {
    const id = videoId();
    let data = cache.get(id);

    if (!data) {
      try {
        data = await TranscriptCore.fetchTranscript(id);
        cache.set(id, data);
      } catch (err) {
        const code =
          err instanceof TranscriptCore.TranscriptError
            ? err.code
            : "upstream_failed";
        console.error(`Caption Mode: transcript ${code} — ${err.message}`);
        showStatus(FAILURE_MESSAGES[code] || FAILURE_MESSAGES.upstream_failed);
        return false;
      }
    }

    words = CaptionView.flatten(data);
    if (!words.length) {
      showStatus(FAILURE_MESSAGES.no_transcript);
      return false;
    }
    searchIndex = CaptionView.buildSearchIndex(words);
    return true;
  }

  function computePages() {
    const stage = root.querySelector(".cm-stage");
    const packed = CaptionView.packPages(
      words,
      root,
      stage.clientWidth,
      MAX_LINES,
    );
    pages = packed.pages;
    pageOfWord = packed.pageOfWord;
  }

  function render() {
    if (!root || !words.length || !pages.length) return;
    const now = video.currentTime;
    const wi = CaptionView.lastIndexBefore(words, now);
    const curWi = Math.max(0, wi);
    const pageIdx = pageOfWord[curWi] ?? 0;

    if (
      pageIdx === lastPage &&
      wi === lastWi &&
      mode === lastMode &&
      foundWord === lastFound
    ) {
      return;
    }
    const grew = pageIdx === lastPage && mode === lastMode && wi > lastWi;
    lastPage = pageIdx;
    lastWi = wi;
    lastMode = mode;
    lastFound = foundWord;

    CaptionView.renderPage(
      root.querySelector(".cm-caption"),
      words,
      pages[pageIdx],
      { wi, mode, grew, found: foundWord },
    );
  }

  function rerender() {
    lastPage = -1;
    lastWi = -1;
    lastMode = "";
    lastFound = -1;
    render();
  }

  // The times of the first and last word on the page being read. This is what
  // a share link carries.
  function currentPageRange() {
    if (!words.length || !pages.length) return null;
    const wi = Math.max(
      0,
      CaptionView.lastIndexBefore(words, video.currentTime),
    );
    const page = pages[pageOfWord[wi] ?? 0];
    return { start: words[page.start].start, end: words[page.end].start };
  }

  async function open() {
    if (root) return;
    video = findVideo();
    if (!video) return;
    root = build();
    document.body.appendChild(root);
    document.body.classList.add("cm-open");
    setTitle();

    const ok = await loadTranscript();
    if (!ok) return;
    computePages();
    rerender();
    timer = setInterval(render, TICK_MS);
  }

  function close() {
    if (!root) return;
    clearInterval(timer);
    timer = null;
    root.remove();
    root = null;
    video = null;
    words = [];
    pages = [];
    pageOfWord = [];
    searchIndex = null;
    foundWord = -1;
    document.body.classList.remove("cm-open");
  }

  function toggle() {
    if (root) close();
    else open();
  }

  function isOpen() {
    return Boolean(root);
  }

  // The caption text is also a control: click a word to move the audio to it.
  document.addEventListener("click", (e) => {
    if (!root) return;
    const span = e.target.closest("#caption-mode-overlay .word");
    if (span && span.dataset.i !== undefined) {
      video.currentTime = words[parseInt(span.dataset.i, 10)].start;
      rerender();
      return;
    }
    if (e.target.closest("#caption-mode-overlay")) {
      if (video.paused) video.play();
      else video.pause();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!root) return;
    if (e.code === "Space" && !e.target.closest("input")) {
      e.preventDefault();
      e.stopPropagation(); // YouTube also listens for Space
      if (video.paused) video.play();
      else video.pause();
    }
  });

  // Escape leaves. The overlay never pauses on the way out, so toggling it
  // never interrupts the audio.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root) close();
  });

  // YouTube does not reload between videos. The overlay closes rather than
  // re-fetching in place, which keeps its state simple.
  document.addEventListener("yt-navigate-finish", () => close());

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!root || !words.length) return;
      computePages();
      rerender();
    }, 200);
  });

  return {
    open,
    close,
    toggle,
    isOpen,
    currentPageRange,
    getVideo: () => video,
  };
})();

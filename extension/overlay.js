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
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
  let speedMenuOpen = false;
  let seeking = false;
  let hideTimer = null;
  let matches = [];
  let matchAt = -1;
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
      <div class="cm-search hidden">
        <input class="cm-search-input" type="text" placeholder="Search transcript"
               autocomplete="off" spellcheck="false" aria-label="Search transcript" />
        <span class="cm-search-count"></span>
      </div>
      <div class="cm-controls">
        <div class="cm-scrim"></div>
        <div class="cm-bar">
          <button class="cm-ico cm-playpause" type="button" aria-label="Play or pause">
            <svg class="cm-icon-pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            <svg class="cm-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="cm-ico cm-back" type="button" aria-label="Back 10 seconds">
            <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>
          </button>
          <button class="cm-ico cm-fwd" type="button" aria-label="Forward 10 seconds">
            <svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/></svg>
          </button>
          <div class="cm-seek-wrap">
            <span class="cm-cur-time">0:00</span>
            <div class="cm-seek-track">
              <div class="cm-seek-bg"></div>
              <div class="cm-seek-fill"></div>
              <div class="cm-seek-knob"></div>
            </div>
            <span class="cm-dur-time">0:00</span>
          </div>
          <button class="cm-pill cm-mode" type="button" aria-label="Caption mode">
            <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z"/></svg>
            <span class="cm-mode-label">Flow</span>
          </button>
          <div class="cm-speed-wrap">
            <div class="cm-speed-menu hidden"></div>
            <button class="cm-speed-btn" type="button" aria-label="Playback speed">1&times;</button>
          </div>
          <div class="cm-vol-wrap">
            <button class="cm-ico cm-small cm-mute" type="button" aria-label="Mute">
              <svg viewBox="0 0 24 24">
                <path d="M4 9v6h4l5 5V4L8 9H4z"/>
                <path class="cm-wave1" d="M15.5 8.2a1 1 0 0 1 1.4.1 5.5 5.5 0 0 1 0 7.4 1 1 0 1 1-1.5-1.32 3.5 3.5 0 0 0 0-4.76 1 1 0 0 1 .1-1.42z"/>
                <path class="cm-wave2" d="M18 5.4a1 1 0 0 1 1.4.06 9.2 9.2 0 0 1 0 13.08 1 1 0 1 1-1.46-1.36 7.2 7.2 0 0 0 0-10.36A1 1 0 0 1 18 5.4z"/>
              </svg>
            </button>
            <div class="cm-vol-track">
              <div class="cm-vol-bg"></div>
              <div class="cm-vol-fill"></div>
              <div class="cm-vol-knob"></div>
            </div>
          </div>
          <button class="cm-ico cm-fullscreen" type="button" aria-label="Fullscreen">
            <svg viewBox="0 0 24 24"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/></svg>
          </button>
          <button class="cm-share" type="button">Copy link to this page</button>
        </div>
      </div>
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

  // --- Search -----------------------------------------------------------

  function goToMatch(index) {
    if (!matches.length) return;
    matchAt = (index + matches.length) % matches.length;
    root.querySelector(".cm-search-count").textContent =
      `${matchAt + 1} / ${matches.length}`;
    foundWord = matches[matchAt];
    // Seek rather than only scroll: the box shows one page at a time, so the
    // way to look at a match is to move playback to it.
    video.currentTime = words[foundWord].start;
    rerender();
  }

  function runSearch(query) {
    const count = root.querySelector(".cm-search-count");
    matches = CaptionView.search(searchIndex, query);
    matchAt = -1;

    if (!query.trim()) {
      count.textContent = "";
      count.classList.remove("none");
      foundWord = -1;
      rerender();
      return;
    }
    count.classList.toggle("none", matches.length === 0);
    if (!matches.length) {
      count.textContent = "no matches";
      foundWord = -1;
      rerender();
      return;
    }
    // Start from whatever is playing now, so "next" moves forward from here.
    const now = Math.max(
      0,
      CaptionView.lastIndexBefore(words, video.currentTime),
    );
    const ahead = matches.findIndex((w) => w >= now);
    goToMatch(ahead === -1 ? 0 : ahead);
  }

  function setSearch(open) {
    const bar = root.querySelector(".cm-search");
    const input = root.querySelector(".cm-search-input");
    bar.classList.toggle("hidden", !open);
    root.classList.toggle("cm-searching", open);
    if (open) {
      input.focus();
      input.select();
      wake();
    } else {
      input.blur();
      foundWord = -1;
      rerender();
    }
  }

  function wireSearch() {
    const input = root.querySelector(".cm-search-input");
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setSearch(false);
      else if (e.key === "Enter") {
        e.preventDefault();
        goToMatch(matchAt + (e.shiftKey ? -1 : 1));
      }
      e.stopPropagation(); // typing must not reach YouTube's own shortcuts
    });
  }

  // --- Sharing ----------------------------------------------------------

  // The overlay cannot import the shared module, so the link is built here
  // from the same rule buildShareUrl implements and its tests cover:
  // hundredths, and no trailing slash on the site url.
  function shareUrl(range) {
    const base = CAPTION_MODE_CONFIG.siteUrl.replace(/\/+$/, "");
    const a = Math.round(range.start * 100) / 100;
    const b = Math.round(range.end * 100) / 100;
    return `${base}/s?v=${encodeURIComponent(videoId())}&a=${a}&b=${b}`;
  }

  function wireShare() {
    const btn = root.querySelector(".cm-share");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const range = currentPageRange();
      if (!range) return;
      await navigator.clipboard.writeText(shareUrl(range));
      btn.textContent = "Link copied";
      btn.classList.add("cm-copied");
      setTimeout(() => {
        btn.textContent = "Copy link to this page";
        btn.classList.remove("cm-copied");
      }, 1600);
      wake();
    });
  }

  // --- Controls ---------------------------------------------------------

  function formatTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function togglePlay() {
    if (video.paused) video.play();
    else video.pause();
    wake();
  }

  function setIdle(idle) {
    if (idle && speedMenuOpen) return;
    root.querySelector(".cm-controls").classList.toggle("idle", idle);
    root.querySelector(".cm-badge").style.opacity = idle ? "0" : "0.85";
    root.classList.toggle("cm-hide-cursor", idle);
  }

  function wake() {
    if (!root) return;
    setIdle(false);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setIdle(true), 2600);
  }

  function updateVolumeUI() {
    const eff = video.muted ? 0 : video.volume;
    const fill = eff * 104;
    root.querySelector(".cm-vol-fill").style.width = `${fill}px`;
    root.querySelector(".cm-vol-knob").style.left =
      `${Math.max(0, fill - 6)}px`;
    root.querySelector(".cm-wave1").style.opacity = eff > 0.15 ? "1" : "0.25";
    root.querySelector(".cm-wave2").style.opacity = eff > 0.55 ? "1" : "0.25";
    root.classList.toggle("cm-muted", video.muted || video.volume === 0);
  }

  function updateSeek() {
    const dur = video.duration || 0;
    root.querySelector(".cm-cur-time").textContent = formatTime(
      video.currentTime,
    );
    root.querySelector(".cm-dur-time").textContent = formatTime(dur);
    if (!seeking && dur > 0) {
      const pct = Math.max(0, Math.min(100, (video.currentTime / dur) * 100));
      root.querySelector(".cm-seek-fill").style.width = `${pct}%`;
      root.querySelector(".cm-seek-knob").style.left = `${pct}%`;
    }
    root.classList.toggle("cm-paused", video.paused);
  }

  function buildSpeedMenu() {
    const menu = root.querySelector(".cm-speed-menu");
    menu.innerHTML = "";
    for (const v of SPEEDS) {
      const b = document.createElement("button");
      b.className =
        "cm-speed-opt" + (v === video.playbackRate ? " active" : "");
      b.textContent = `${v}×`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        video.playbackRate = v;
        root.querySelector(".cm-speed-btn").textContent = `${v}×`;
        setSpeedMenu(false);
        wake();
      });
      menu.appendChild(b);
    }
  }

  function setSpeedMenu(open) {
    speedMenuOpen = open;
    root.querySelector(".cm-speed-menu").classList.toggle("hidden", !open);
    if (open) buildSpeedMenu();
  }

  function setMode(next) {
    mode = next;
    root.querySelector(".cm-mode-label").textContent =
      mode === "flow" ? "Flow" : "Phrase";
    rerender();
    wake();
  }

  function ratioFromEvent(e, track) {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  function wireControls() {
    const on = (sel, ev, fn) =>
      root.querySelector(sel).addEventListener(ev, (e) => {
        e.stopPropagation(); // the overlay's own click toggles play
        fn(e);
      });

    on(".cm-playpause", "click", togglePlay);
    on(".cm-back", "click", () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
      rerender();
      wake();
    });
    on(".cm-fwd", "click", () => {
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
      rerender();
      wake();
    });
    on(".cm-mode", "click", () => setMode(mode === "flow" ? "phrase" : "flow"));
    on(".cm-speed-btn", "click", () => setSpeedMenu(!speedMenuOpen));
    on(".cm-mute", "click", () => {
      video.muted = !video.muted;
      updateVolumeUI();
      wake();
    });
    on(".cm-fullscreen", "click", () => {
      if (!document.fullscreenElement) root.requestFullscreen?.();
      else document.exitFullscreen?.();
      wake();
    });

    const volTrack = root.querySelector(".cm-vol-track");
    volTrack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const apply = (ev) => {
        const ratio = ratioFromEvent(ev, volTrack);
        video.volume = ratio;
        video.muted = ratio === 0;
        updateVolumeUI();
      };
      apply(e);
      const up = () => {
        window.removeEventListener("pointermove", apply);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", apply);
      window.addEventListener("pointerup", up);
      wake();
    });

    const seekTrack = root.querySelector(".cm-seek-track");
    seekTrack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      seeking = true;
      let ratio = ratioFromEvent(e, seekTrack);
      const preview = (ev) => {
        ratio = ratioFromEvent(ev, seekTrack);
        const pct = ratio * 100;
        root.querySelector(".cm-seek-fill").style.width = `${pct}%`;
        root.querySelector(".cm-seek-knob").style.left = `${pct}%`;
        root.querySelector(".cm-cur-time").textContent = formatTime(
          ratio * (video.duration || 0),
        );
      };
      preview(e);
      const up = () => {
        window.removeEventListener("pointermove", preview);
        window.removeEventListener("pointerup", up);
        if (video.duration > 0) {
          video.currentTime = ratio * video.duration;
          rerender();
        }
        seeking = false;
      };
      window.addEventListener("pointermove", preview);
      window.addEventListener("pointerup", up);
      wake();
    });

    root.addEventListener("mousemove", wake);
  }

  async function open() {
    if (root) return;
    video = findVideo();
    if (!video) return;
    root = build();
    document.body.appendChild(root);
    document.body.classList.add("cm-open");
    setTitle();
    wireControls();
    wireSearch();
    wireShare();
    updateVolumeUI();
    root.querySelector(".cm-speed-btn").textContent = `${video.playbackRate}×`;
    wake();

    const ok = await loadTranscript();
    if (!ok) return;
    computePages();
    rerender();
    timer = setInterval(() => {
      render();
      updateSeek();
    }, TICK_MS);
  }

  function close() {
    if (!root) return;
    clearTimeout(hideTimer);
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
    matches = [];
    matchAt = -1;
    document.body.classList.remove("cm-open");
  }

  function toggle() {
    if (root) close();
    else open();
  }

  function isOpen() {
    return Boolean(root);
  }

  document.addEventListener("click", (e) => {
    if (!root) return;
    if (e.target.closest("#caption-mode-overlay")) {
      if (video.paused) video.play();
      else video.pause();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!root) return;
    if (e.key === "/" && !e.target.closest("input")) {
      e.preventDefault();
      e.stopPropagation();
      setSearch(true);
      return;
    }
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
    if (e.key !== "Escape" || !root) return;
    if (root.classList.contains("cm-searching")) setSearch(false);
    else close();
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

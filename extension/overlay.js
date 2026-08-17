// The black layer over the watch page.
//
// It creates no player. The watch page already has one, so the overlay reads
// and drives that video element. This is why embeds' rules — blocked autoplay,
// ads inside the frame, videos that refuse to embed — do not apply here.

// eslint-disable-next-line no-unused-vars
const CaptionOverlay = (() => {
  const ROOT_ID = "caption-mode-overlay";
  const MAX_LINES = 4;
  // Fullscreen gives back the browser's chrome, so one more line fits. The
  // height cap still applies: at the largest text this asks for more than the
  // box has, and the packer simply keeps what fits.
  const MAX_LINES_FULLSCREEN = 5;
  const TICK_MS = 100;
  const SAVE_EVERY_MS = 5000;
  const SPEEDS = [1, 1.25, 1.75, 2];

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
  let seeking = false;
  let hideTimer = null;
  let matches = [];
  let matchAt = -1;
  let videoListeners = null;
  // Which video the overlay was opened for, so a navigation event that names
  // the same video is not mistaken for leaving it.
  let openedFor = null;
  let typeMenuOpen = false;
  let phrases = [];
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

  // --- Remembering where you were ---------------------------------------

  // Kept in localStorage on youtube.com, so it survives a reload and costs no
  // storage permission. Positions are small and few, so they are never pruned.
  const POSITION_KEY = "captionMode:position:";
  // Below this, there is nothing worth resuming; near the end, resuming would
  // drop you at the credits.
  const RESUME_FLOOR_S = 20;
  const RESUME_TAIL_S = 15;
  // Only resume when the video is still at its start. If YouTube already put
  // the viewer somewhere — its own resume, or a t= link — that wins.
  const RESUME_ONLY_BEFORE_S = 5;

  function savePosition() {
    if (!video || !videoId()) return;
    const at = video.currentTime;
    const dur = video.duration || 0;
    if (at < RESUME_FLOOR_S) return;
    if (dur && at > dur - RESUME_TAIL_S) {
      // Finished, near enough. Forget it rather than resume at the end.
      try {
        localStorage.removeItem(POSITION_KEY + videoId());
      } catch {
        /* storage can be disabled; losing a position is not worth an error */
      }
      return;
    }
    try {
      localStorage.setItem(POSITION_KEY + videoId(), String(Math.floor(at)));
    } catch {
      /* ignore */
    }
  }

  function resumePosition() {
    if (video.currentTime > RESUME_ONLY_BEFORE_S) return;
    let saved = null;
    try {
      saved = localStorage.getItem(POSITION_KEY + videoId());
    } catch {
      return;
    }
    const at = Number(saved);
    if (!Number.isFinite(at) || at < RESUME_FLOOR_S) return;
    const dur = video.duration || 0;
    if (dur && at > dur - RESUME_TAIL_S) return;
    video.currentTime = at;
  }

  function build() {
    const el = document.createElement("div");
    el.id = ROOT_ID;
    el.innerHTML = `
      <div class="cm-badge">
        <div class="cm-title-line">
          <span class="cm-title"></span>
        </div>
        <div class="cm-author"></div>
      </div>
      <button class="cm-exit" type="button" aria-label="Exit Caption Mode">
        <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3z"/></svg>
        <span class="cm-exit-label">Esc</span>
      </button>
      <div class="cm-stage"><div class="cm-caption caption"></div></div>
      <div class="cm-status"></div>
      <div class="cm-search hidden">
        <input class="cm-search-input" type="text" placeholder="Search transcript"
               autocomplete="off" spellcheck="false" aria-label="Search transcript" />
        <span class="cm-search-count"></span>
      </div>
      <aside class="cm-panel hidden" aria-label="Full transcript">
        <div class="cm-panel-head">
          <input class="cm-panel-search" type="text" placeholder="Search the transcript"
                 autocomplete="off" spellcheck="false" aria-label="Search the transcript" />
          <span class="cm-panel-count"></span>
          <button class="cm-panel-close" type="button" aria-label="Close transcript">&times;</button>
        </div>
        <div class="cm-panel-body"></div>
      </aside>
      <div class="cm-controls">
        <div class="cm-scrim"></div>
        <div class="cm-bar">
          <button class="cm-ico cm-playpause" type="button" aria-label="Play or pause">
            <svg class="cm-icon-pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            <svg class="cm-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="cm-ico cm-back" type="button" aria-label="Back 10 seconds">
            <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><path d="M10.9 16H10v-3.3L9 13v-.7l1.8-.6h.1V16zm4.68-1.34c0 .35-.04.65-.11.9s-.18.46-.32.62-.3.27-.5.34-.41.1-.65.1-.45-.03-.65-.1-.37-.19-.51-.34-.25-.36-.33-.62-.12-.55-.12-.9v-.74c0-.35.04-.65.11-.9s.18-.46.32-.62.3-.27.5-.34.42-.1.66-.1.45.03.65.1.37.19.51.34.25.36.33.62.12.55.12.9v.74zm-.85-.86c0-.21-.01-.39-.04-.53s-.07-.26-.13-.35-.13-.15-.21-.19-.19-.06-.3-.06-.21.02-.3.06-.16.1-.22.19-.1.21-.13.35-.04.32-.04.53v.97c0 .21.01.39.04.54s.07.26.13.35.13.16.22.2.19.06.3.06.21-.02.3-.06.16-.1.21-.2.1-.21.12-.35.04-.33.04-.54v-.97z"/></svg>
          </button>
          <button class="cm-ico cm-fwd" type="button" aria-label="Forward 10 seconds">
            <svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><path d="M10.9 16H10v-3.3L9 13v-.7l1.8-.6h.1V16zm4.68-1.34c0 .35-.04.65-.11.9s-.18.46-.32.62-.3.27-.5.34-.41.1-.65.1-.45-.03-.65-.1-.37-.19-.51-.34-.25-.36-.33-.62-.12-.55-.12-.9v-.74c0-.35.04-.65.11-.9s.18-.46.32-.62.3-.27.5-.34.42-.1.66-.1.45.03.65.1.37.19.51.34.25.36.33.62.12.55.12.9v.74zm-.85-.86c0-.21-.01-.39-.04-.53s-.07-.26-.13-.35-.13-.15-.21-.19-.19-.06-.3-.06-.21.02-.3.06-.16.1-.22.19-.1.21-.13.35-.04.32-.04.53v.97c0 .21.01.39.04.54s.07.26.13.35.13.16.22.2.19.06.3.06.21-.02.3-.06.16-.1.21-.2.1-.21.12-.35.04-.33.04-.54v-.97z"/></svg>
          </button>
          <div class="cm-seek-wrap">
            <span class="cm-cur-time">0:00</span>
            <div class="cm-seek-track">
              <div class="cm-seek-bg"></div>
              <div class="cm-seek-fill"></div>
              <div class="cm-seek-knob"></div>
            </div>
            <span class="cm-dur-time" role="button" tabindex="0"
                  title="Show time left">0:00</span>
          </div>
          <button class="cm-pill cm-mode" type="button" aria-label="Caption mode">
            <svg class="cm-icon-flow" viewBox="0 0 24 24"><path d="M3 8.2c1.6-2.1 3.2-3.1 4.8-3.1 2.4 0 3.6 2 5.1 3.6 1 1.1 2 1.7 3 1.7 1.1 0 2.1-.7 3.1-2l2 1.5c-1.6 2.1-3.2 3.1-4.8 3.1-2.4 0-3.6-2-5.1-3.6-1-1.1-2-1.7-3-1.7-1.1 0-2.1.7-3.1 2L3 8.2zm0 8c1.6-2.1 3.2-3.1 4.8-3.1 2.4 0 3.6 2 5.1 3.6 1 1.1 2 1.7 3 1.7 1.1 0 2.1-.7 3.1-2l2 1.5c-1.6 2.1-3.2 3.1-4.8 3.1-2.4 0-3.6-2-5.1-3.6-1-1.1-2-1.7-3-1.7-1.1 0-2.1.7-3.1 2l-2-1.5z"/></svg>
            <svg class="cm-icon-phrase" viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.4L5 21.2V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2.5 4.4a1 1 0 0 0 0 2h11a1 1 0 0 0 0-2h-11zm0 4a1 1 0 0 0 0 2h6.5a1 1 0 0 0 0-2H6.5z"/></svg>
            <span class="cm-mode-label">Flow</span>
          </button>
          <button class="cm-speed-btn" type="button" aria-label="Playback speed">1&times;</button>
          <div class="cm-type-wrap">
            <div class="cm-type-menu hidden"></div>
            <button class="cm-ico cm-small cm-type-btn" type="button" aria-label="Text options">
              <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.48.48 0 0 0 13.9 2h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.71 8.47a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>
            </button>
          </div>
          <button class="cm-ico cm-small cm-transcript-btn" type="button" aria-label="Show full transcript">
            <svg viewBox="0 0 24 24"><path d="M3 5h18v2H3V5zm0 4h12v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z"/></svg>
          </button>
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

  // Opening from the feed beats the watch page to its own metadata: the title
  // and channel are rendered after this first runs, so a single read finds
  // nothing and the badge stays blank. Opening from the toolbar button never
  // showed this, because by then the page had long since settled. So keep
  // looking for a short while, and stop as soon as both are in hand.
  function setTitle(until) {
    if (!root) return;
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
    if (title && author) return;
    const deadline = until || Date.now() + 15000;
    if (Date.now() < deadline) setTimeout(() => setTitle(deadline), 200);
  }

  // A transcript never changes once published, so this needs a ceiling but no
  // expiry. One fetch per video per page session.
  const cache = TranscriptCore.createCache(50);

  // The fetch happens here, in the content script, because this code runs on
  // youtube.com and so the call to YouTube's API is same-origin. The same call
  // from a service worker carries `Origin: chrome-extension://<id>`, and
  // YouTube answers 403.
  // Fetching costs about 800ms, and it used to run when the overlay opened,
  // so every open paid it. Starting it as soon as the watch page loads means
  // the answer is usually already here by the time anyone clicks.
  let pending = null;

  function prefetch() {
    const id = videoId();
    if (!id || cache.get(id) || pending) return;
    pending = TranscriptCore.fetchTranscript(id)
      .then((data) => {
        cache.set(id, data);
        return data;
      })
      .catch(() => null) // the real error is reported when the overlay opens
      .finally(() => {
        pending = null;
      });
  }

  async function loadTranscript() {
    const id = videoId();
    let data = cache.get(id);

    if (!data && pending) await pending; // a prefetch is already in flight
    data = data || cache.get(id);

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

    phrases = data.phrases || [];
    words = CaptionView.flatten(data);
    if (!words.length) {
      showStatus(FAILURE_MESSAGES.no_transcript);
      return false;
    }
    searchIndex = CaptionView.buildSearchIndex(words);
    return true;
  }

  function maxLines() {
    return document.fullscreenElement === root
      ? MAX_LINES_FULLSCREEN
      : MAX_LINES;
  }

  function computePages() {
    const stage = root.querySelector(".cm-stage");
    const packed = CaptionView.packPages(
      words,
      root.querySelector(".cm-caption"),
      maxLines(),
      stage.clientHeight,
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

  // --- Controls ---------------------------------------------------------

  // Hours get their own field, the way every player writes them. Without this
  // a half-hour into a two-hour talk read as 103:18.
  function formatTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
  }

  // The right-hand number answers either "how long is this?" or "how much is
  // left?". Clicking it swaps which, as YouTube's own does.
  let showRemaining = false;

  function setTimeLabels(cur, dur) {
    root.querySelector(".cm-cur-time").textContent = formatTime(cur);
    root.querySelector(".cm-dur-time").textContent = showRemaining
      ? `-${formatTime(Math.max(0, dur - cur))}`
      : formatTime(dur);
  }

  function togglePlay() {
    if (video.paused) video.play();
    else video.pause();
    wake();
  }

  function setIdle(idle) {
    root.querySelector(".cm-controls").classList.toggle("idle", idle);
    root.querySelector(".cm-badge").style.opacity = idle ? "0" : "0.85";
    // The way out dims but never disappears, unlike the rest of the chrome.
    // Everything else can hide, because Escape is not enough on its own.
    root.querySelector(".cm-exit").style.opacity = idle ? "0.25" : "0.9";
    root.classList.toggle("cm-hide-cursor", idle);
  }

  // Paused means the viewer stopped to do something. Hiding the controls then
  // takes away the very buttons they stopped for, so the chrome stays up until
  // playback runs again.
  function wake() {
    if (!root) return;
    setIdle(false);
    clearTimeout(hideTimer);
    if (video && video.paused) return;
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
    setTimeLabels(video.currentTime, dur);
    if (!seeking && dur > 0) {
      const pct = Math.max(0, Math.min(100, (video.currentTime / dur) * 100));
      root.querySelector(".cm-seek-fill").style.width = `${pct}%`;
      root.querySelector(".cm-seek-knob").style.left = `${pct}%`;
    }
    root.classList.toggle("cm-paused", video.paused);
  }

  // One button that steps through the speeds, rather than a menu to open and
  // aim at. A rate YouTube set that is not on the list rounds up to the next
  // one, so the button never appears stuck.
  function cycleSpeed() {
    const at = SPEEDS.indexOf(video.playbackRate);
    const next =
      at === -1
        ? (SPEEDS.find((s) => s > video.playbackRate) ?? SPEEDS[0])
        : SPEEDS[(at + 1) % SPEEDS.length];
    video.playbackRate = next;
    updateSpeedLabel();
    wake();
  }

  function setMode(next) {
    mode = next;
    root.querySelector(".cm-mode-label").textContent =
      mode === "flow" ? "Flow" : "Phrase";
    root.classList.toggle("cm-mode-phrase", mode === "phrase");
    rerender();
    wake();
  }

  function ratioFromEvent(e, track) {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  // --- Reading options --------------------------------------------------

  // Few choices on purpose. Free control over size and face is a settings
  // screen; this is a reading tool, so each option has one clear reason.
  // Each face carries its own weight. A serif at the sans's 800 reads as a
  // slab; the same page in Georgia needs far less to hold the same colour.
  const FONTS = [
    {
      id: "sans",
      label: "Sans",
      stack: '"Archivo", "Roboto", sans-serif',
      weight: 800,
    },
    {
      id: "serif",
      label: "Serif",
      stack: 'Georgia, "Times New Roman", serif',
      weight: 500,
    },
    {
      id: "mono",
      label: "Mono",
      stack: '"Roboto Mono", Consolas, monospace',
      weight: 600,
    },
    {
      id: "dyslexic",
      label: "Dyslexic",
      stack: '"OpenDyslexic", "Comic Sans MS", "Trebuchet MS", sans-serif',
      weight: 700,
    },
  ];
  const SIZES = [
    { id: "s", label: "Small", scale: 0.75 },
    { id: "m", label: "Medium", scale: 1 },
    { id: "l", label: "Large", scale: 1.3 },
  ];
  // Off-white first, because reading white-on-black for an hour is what the
  // rest of these are an answer to.
  const COLORS = [
    { id: "cream", label: "Off white", value: "#f2ede3" },
    { id: "white", label: "White", value: "#ffffff" },
    { id: "amber", label: "Amber", value: "#ffcf5c" },
    { id: "green", label: "Green", value: "#8ce39a" },
    { id: "blue", label: "Blue", value: "#7fc4ff" },
    { id: "pink", label: "Pink", value: "#ff9ec4" },
  ];
  const TYPE_KEY = "captionMode:type";

  let typeChoice = { font: "sans", size: "m", color: "cream" };

  function loadTypeChoice() {
    try {
      const raw = localStorage.getItem(TYPE_KEY);
      if (raw) typeChoice = { ...typeChoice, ...JSON.parse(raw) };
    } catch {
      /* a bad or blocked value just means the defaults */
    }
  }

  function applyTypeChoice() {
    const font = FONTS.find((f) => f.id === typeChoice.font) || FONTS[0];
    const size = SIZES.find((s) => s.id === typeChoice.size) || SIZES[1];
    const color = COLORS.find((c) => c.id === typeChoice.color) || COLORS[0];
    root.style.setProperty("--cm-font", font.stack);
    root.style.setProperty("--cm-weight", String(font.weight));
    root.style.setProperty("--cm-scale", String(size.scale));
    root.style.setProperty("--cm-color", color.value);
    try {
      localStorage.setItem(TYPE_KEY, JSON.stringify(typeChoice));
    } catch {
      /* ignore */
    }
    // The face and size decide how much text fits, so the pages must be
    // measured again before anything is drawn.
    if (words.length) {
      computePages();
      rerender();
    }
  }

  function buildTypeMenu() {
    const menu = root.querySelector(".cm-type-menu");
    menu.innerHTML = "";

    const row = (title, items, key, kind = "") => {
      const group = document.createElement("div");
      group.className = "cm-type-group";
      const label = document.createElement("div");
      label.className = "cm-type-label";
      label.textContent = title;
      group.appendChild(label);
      const opts = document.createElement("div");
      opts.className = "cm-type-opts" + (kind ? ` cm-opts-${kind}` : "");
      for (const item of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className =
          "cm-type-opt" +
          (kind ? ` cm-type-${kind}` : "") +
          (typeChoice[key] === item.id ? " active" : "");
        if (kind === "swatch") {
          b.style.background = item.value;
          b.title = item.label;
          b.setAttribute("aria-label", item.label);
        } else {
          b.textContent = item.label;
        }
        if (item.stack) b.style.fontFamily = item.stack;
        if (item.weight) b.style.fontWeight = String(item.weight);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          typeChoice = { ...typeChoice, [key]: item.id };
          applyTypeChoice();
          buildTypeMenu();
          wake();
        });
        opts.appendChild(b);
      }
      group.appendChild(opts);
      menu.appendChild(group);
    };

    row("Font", FONTS, "font", "font");
    row("Size", SIZES, "size", "size");
    row("Colour", COLORS, "color", "swatch");
  }

  function setTypeMenu(open) {
    typeMenuOpen = open;
    root.querySelector(".cm-type-menu").classList.toggle("hidden", !open);
    if (open) buildTypeMenu();
  }

  // --- Full transcript --------------------------------------------------

  // A reference you consult without losing your place: the captions keep
  // playing behind it, and closing returns you exactly where you were.
  function buildPanel() {
    const body = root.querySelector(".cm-panel-body");
    body.innerHTML = "";
    const frag = document.createDocumentFragment();
    phrases.forEach((p, i) => {
      const line = document.createElement("button");
      line.type = "button";
      line.className = "cm-line";
      line.dataset.i = i;
      const time = document.createElement("span");
      time.className = "cm-line-time";
      time.textContent = formatTime(p.start);
      const text = document.createElement("span");
      text.className = "cm-line-text";
      text.textContent = p.text;
      line.append(time, text);
      frag.appendChild(line);
    });
    body.appendChild(frag);
  }

  function filterPanel(query) {
    const q = query.trim().toLowerCase();
    const count = root.querySelector(".cm-panel-count");
    let shown = 0;
    for (const line of root.querySelectorAll(".cm-line")) {
      const text = phrases[Number(line.dataset.i)].text.toLowerCase();
      const hit = !q || text.includes(q);
      line.classList.toggle("cm-hidden", !hit);
      if (hit) shown += 1;
    }
    count.textContent = q ? `${shown} line${shown === 1 ? "" : "s"}` : "";
    count.classList.toggle("none", Boolean(q) && shown === 0);
  }

  // Keeps the line being spoken in view while the panel is open.
  function markPanelPosition() {
    const panel = root.querySelector(".cm-panel");
    if (panel.classList.contains("hidden") || !phrases.length) return;
    const at = CaptionView.lastIndexBefore(phrases, video.currentTime);
    const idx = Math.max(0, at);
    const prev = root.querySelector(".cm-line.current");
    if (prev && Number(prev.dataset.i) === idx) return;
    if (prev) prev.classList.remove("current");
    const line = root.querySelector(`.cm-line[data-i="${idx}"]`);
    if (line) {
      line.classList.add("current");
      line.scrollIntoView({ block: "center" });
    }
  }

  function setPanel(open) {
    const panel = root.querySelector(".cm-panel");
    panel.classList.toggle("hidden", !open);
    root.classList.toggle("cm-paneled", open);
    // The panel takes width from the caption box, so what fits on a page
    // changes. Without this the text keeps its old, now too-wide, pages.
    if (words.length) {
      computePages();
      rerender();
    }
    if (open) {
      if (!panel.dataset.built) {
        buildPanel();
        panel.dataset.built = "1";
      }
      markPanelPosition();
      root.querySelector(".cm-panel-search").focus();
      wake();
    }
  }

  function wirePanel() {
    const panel = root.querySelector(".cm-panel");
    const input = root.querySelector(".cm-panel-search");

    panel.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("input", () => filterPanel(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setPanel(false);
      e.stopPropagation();
    });
    root
      .querySelector(".cm-panel-close")
      .addEventListener("click", () => setPanel(false));

    // A transcript line is a place in the video, so clicking one goes there.
    panel.addEventListener("click", (e) => {
      const line = e.target.closest(".cm-line");
      if (!line) return;
      video.currentTime = phrases[Number(line.dataset.i)].start;
      rerender();
    });
  }

  // --- Fullscreen -------------------------------------------------------

  // Fullscreen paints only the fullscreen element's subtree. The overlay is a
  // child of <body>, so if YouTube takes fullscreen on #movie_player the
  // captions stop being drawn — fixed position and a maximal z-index make no
  // difference. So the overlay must be the element that goes fullscreen.
  function toggleFullscreen() {
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {});
    wake();
  }

  // If something else takes fullscreen while the overlay is open — YouTube's
  // own shortcut reaching the page another way — leave it, so the reader gets
  // the captions back instead of staring at a video they cannot see past.
  document.addEventListener("fullscreenchange", () => {
    if (!root) return;
    const fs = document.fullscreenElement;
    if (fs && fs !== root && !root.contains(fs)) {
      document.exitFullscreen?.();
      return;
    }
    // The box changed size and the line budget with it.
    if (words.length) {
      computePages();
      rerender();
    }
  });

  // Buttons and keys drive the same three steps, so they can never disagree.
  function nudgeTime(seconds) {
    const dur = video.duration || 0;
    video.currentTime = Math.max(
      0,
      Math.min(dur || Infinity, video.currentTime + seconds),
    );
    rerender();
    wake();
  }

  function nudgeVolume(delta) {
    video.volume = Math.max(0, Math.min(1, video.volume + delta));
    if (video.volume > 0) video.muted = false;
    updateVolumeUI();
    wake();
  }

  function toggleMute() {
    video.muted = !video.muted;
    updateVolumeUI();
    wake();
  }

  function updateSpeedLabel() {
    root.querySelector(".cm-speed-btn").textContent = `${video.playbackRate}×`;
  }

  // YouTube's own player also changes this video: its controls still work
  // underneath, ads start and end, and it restores volume. Listening to the
  // element keeps the overlay honest instead of guessing between ticks.
  function followVideo() {
    const sync = () => {
      if (!root) return;
      updateSeek();
      updateVolumeUI();
      updateSpeedLabel();
      // A pause anywhere — this overlay, YouTube's own keys — must bring the
      // controls back and hold them; a play restarts the hide timer.
      wake();
    };
    for (const ev of [
      "play",
      "pause",
      "volumechange",
      "ratechange",
      "seeked",
      "durationchange",
      "loadedmetadata",
    ]) {
      video.addEventListener(ev, sync);
    }
    videoListeners = sync;
  }

  function wireControls() {
    const on = (sel, ev, fn) =>
      root.querySelector(sel).addEventListener(ev, (e) => {
        e.stopPropagation(); // the overlay's own click toggles play
        fn(e);
      });

    // The launcher button is on the page underneath, so the overlay must carry
    // its own way out. Escape works too, and the button says so.
    on(".cm-exit", "click", close);
    on(".cm-playpause", "click", togglePlay);
    on(".cm-back", "click", () => nudgeTime(-10));
    on(".cm-fwd", "click", () => nudgeTime(10));
    on(".cm-mode", "click", () => setMode(mode === "flow" ? "phrase" : "flow"));
    on(".cm-speed-btn", "click", cycleSpeed);
    on(".cm-type-btn", "click", () => setTypeMenu(!typeMenuOpen));
    on(".cm-transcript-btn", "click", () =>
      setPanel(root.querySelector(".cm-panel").classList.contains("hidden")),
    );
    on(".cm-dur-time", "click", () => {
      showRemaining = !showRemaining;
      root.querySelector(".cm-dur-time").title = showRemaining
        ? "Show total time"
        : "Show time left";
      updateSeek();
      wake();
    });
    on(".cm-mute", "click", toggleMute);
    on(".cm-fullscreen", "click", toggleFullscreen);

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
        const dur = video.duration || 0;
        setTimeLabels(ratio * dur, dur);
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
    openedFor = videoId();
    root = build();
    document.body.appendChild(root);
    document.body.classList.add("cm-open");
    setTitle();
    wireControls();
    wireSearch();
    wirePanel();
    loadTypeChoice();
    applyTypeChoice();
    resumePosition();
    updateVolumeUI();
    updateSpeedLabel();
    // Paint the controls now. They used to wait for the render timer, which
    // starts only after the transcript loads, so the play icon showed the
    // wrong state at first and never updated at all if the fetch failed.
    updateSeek();
    followVideo();
    wake();

    const ok = await loadTranscript();
    // A close during the fetch leaves nothing to render into.
    if (!ok || !root) return;
    computePages();
    rerender();
    let sinceSave = 0;
    timer = setInterval(() => {
      render();
      updateSeek();
      markPanelPosition();
      // Saving every tick would write ten times a second for no gain.
      if ((sinceSave += TICK_MS) >= SAVE_EVERY_MS) {
        sinceSave = 0;
        savePosition();
      }
    }, TICK_MS);
  }

  function close() {
    if (!root) return;
    savePosition();
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    clearTimeout(hideTimer);
    clearInterval(timer);
    if (videoListeners) {
      for (const ev of [
        "play",
        "pause",
        "volumechange",
        "ratechange",
        "seeked",
        "durationchange",
        "loadedmetadata",
      ]) {
        video.removeEventListener(ev, videoListeners);
      }
      videoListeners = null;
    }
    timer = null;
    root.remove();
    root = null;
    video = null;
    words = [];
    phrases = [];
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

  // Click-to-pause belongs to the reading area only. It used to be the whole
  // layer, so a miss between two buttons in the control bar paused the video.
  const CHROME = ".cm-controls, .cm-panel, .cm-search, .cm-exit, .cm-badge";

  document.addEventListener("click", (e) => {
    if (!root) return;
    if (!e.target.closest("#caption-mode-overlay")) return;
    if (e.target.closest(CHROME)) return;
    togglePlay();
  });

  // keydown targets are not always Elements, so closest() needs a guard.
  const inTextField = (target) =>
    target instanceof Element && target.closest("input, textarea");

  // Capture phase on window, so this runs before YouTube's own handlers.
  // A bubble listener on document is not enough: YouTube registers first, and
  // stopPropagation cannot cancel a listener on the same node that already
  // ran. stopImmediatePropagation then keeps the key from going any further.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!root) return;
      if (e.key === "/" && !inTextField(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSearch(true);
        return;
      }
      if (inTextField(e.target)) return; // typing owns the keyboard

      const keys = {
        Space: togglePlay,
        ArrowLeft: () => nudgeTime(-10),
        ArrowRight: () => nudgeTime(10),
        ArrowUp: () => nudgeVolume(0.05),
        ArrowDown: () => nudgeVolume(-0.05),
        KeyM: toggleMute,
        // YouTube binds f and t too. Taking f keeps fullscreen on the overlay
        // rather than the player, which would hide the captions.
        KeyF: toggleFullscreen,
      };
      const action = keys[e.code];
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      action();
    },
    true,
  );

  // Escape leaves. The overlay never pauses on the way out, so toggling it
  // never interrupts the audio.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !root) return;
      e.stopImmediatePropagation();
      if (typeMenuOpen) setTypeMenu(false);
      else if (root.classList.contains("cm-paneled")) setPanel(false);
      else if (root.classList.contains("cm-searching")) setSearch(false);
      else close();
    },
    true,
  );

  // YouTube does not reload between videos. The overlay closes rather than
  // re-fetching in place, which keeps its state simple.
  // Close only when the page has moved to a different video. This event also
  // fires once as a watch page finishes its first load, which used to close an
  // overlay that had just been opened by a click from the feed.
  document.addEventListener("yt-navigate-finish", () => {
    if (root && videoId() !== openedFor) close();
  });

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
    prefetch,
    isOpen,
    currentPageRange,
    getVideo: () => video,
    // The watch page builds its player after this script first runs, and open()
    // gives up quietly when the player is missing. Callers that must not lose
    // the request ask this first and wait.
    hasVideo: () => Boolean(findVideo()),
  };
})();

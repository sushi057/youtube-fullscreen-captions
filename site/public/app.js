// Caption Player — hidden YouTube audio + large word-by-word / phrase captions.
// Visual design ported from the Claude Design "Caption Player" component.

const params = new URLSearchParams(location.search);
const videoId = params.get("v");
const startAt = parseInt(params.get("t"), 10) || 0;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// DOM
const stageEl = document.getElementById("caption");
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("mode-badge");
const titleEl = document.getElementById("title");
const authorEl = document.getElementById("author");
const controlsEl = document.getElementById("controls");
const playPauseBtn = document.getElementById("playpause");
const modeBtn = document.getElementById("mode-toggle");
const modeLabel = document.getElementById("mode-label");
const speedBtn = document.getElementById("speed-btn");
const speedMenu = document.getElementById("speed-menu");
const muteBtn = document.getElementById("mute");
const wave1 = document.getElementById("wave1");
const wave2 = document.getElementById("wave2");
const volTrack = document.getElementById("vol-track");
const volFill = document.getElementById("vol-fill");
const volKnob = document.getElementById("vol-knob");
const fullscreenBtn = document.getElementById("fullscreen");
const seekTrack = document.getElementById("seek-track");
const seekFill = document.getElementById("seek-fill");
const seekKnob = document.getElementById("seek-knob");
const searchEl = document.getElementById("search");
const searchInput = document.getElementById("search-input");
const searchCount = document.getElementById("search-count");
const curTimeEl = document.getElementById("cur-time");
const durTimeEl = document.getElementById("dur-time");

const MAX_LINES = 4; // caption box packs words up to this many lines per page

// State
let player = null;
let phrases = [];
let allWords = []; // flat [{ start, text }] in playback order
let pages = []; // [{ start, end }] word-index ranges that fill the box
let pageOfWord = []; // pageOfWord[wordIndex] = page index
let mode = "flow"; // 'flow' | 'phrase'
let volume = 100; // 0..100
let muted = false;
let speedMenuOpen = false;
let ready = false;
let seeking = false;
let hideTimer = null;
// search
let searchOpen = false;
let searchHaystack = ""; // whole transcript, lowercased
let searchWordAt = []; // searchWordAt[charIndex] = index into allWords
let matches = []; // word indexes that begin a match
let matchAt = -1; // position within `matches`
let foundWord = -1; // word index to highlight, or -1
// render cache
let lastPage = -1;
let lastWi = -1;
let lastMode = "";
let lastFound = -1;

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add("visible");
}

// --- Transcript ---------------------------------------------------------

// "No captions" and "YouTube is not answering" are different problems. The
// second one is temporary, so it must not read like a dead end.
const FAILURE_MESSAGES = {
  no_transcript: "This video has no captions.",
  unavailable: "This video is private, removed, or blocked in your region.",
  upstream_failed:
    "YouTube's caption service isn't responding. Try again in a moment.",
};

async function loadTranscript() {
  try {
    const res = await fetch(`/api/transcript?v=${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showStatus(
        FAILURE_MESSAGES[body.error] || FAILURE_MESSAGES.upstream_failed,
      );
      return false;
    }
    const data = await res.json();
    phrases = data.phrases || [];
    if (!phrases.length) {
      showStatus("No captions available for this video.");
      return false;
    }

    // Flatten to a single word stream. Use real word timing when present;
    // otherwise spread each phrase's words evenly across its duration so flow
    // mode still works.
    allWords = [];
    if (data.hasWordTiming && (data.words || []).length) {
      allWords = data.words.map((w) => ({ start: w.start, text: w.text }));
    } else {
      for (const p of phrases) {
        const toks = p.text.split(/\s+/).filter(Boolean);
        const dur = p.dur > 0 ? p.dur : toks.length * 0.3;
        toks.forEach((t, k) =>
          allWords.push({
            start: p.start + (dur * k) / Math.max(1, toks.length),
            text: t,
          }),
        );
      }
    }
    return true;
  } catch (err) {
    console.error("transcript fetch failed:", err);
    showStatus("Couldn't reach the Caption Mode server.");
    return false;
  }
}

// --- Rendering ----------------------------------------------------------

function lastIndexBefore(arr, now, key = "start") {
  let lo = 0;
  let hi = arr.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= now) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// Group all words into pages that each fill the caption box (up to MAX_LINES).
// Measured against an offscreen probe matching the caption's width and font.
function computePages() {
  pages = [];
  pageOfWord = [];
  if (!allWords.length) return;

  const probe = document.createElement("div");
  probe.className = "caption";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.width = `${stageEl.clientWidth}px`;
  document.body.appendChild(probe);

  const lineH = parseFloat(getComputedStyle(probe).lineHeight) || 60;
  const maxH = lineH * MAX_LINES + lineH * 0.15;

  let start = 0;
  for (let i = 0; i < allWords.length; i++) {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = allWords[i].text + " ";
    probe.appendChild(span);
    if (probe.scrollHeight > maxH && i > start) {
      // This word overflows the box → it begins the next page.
      probe.removeChild(span);
      pages.push({ start, end: i - 1 });
      start = i;
      probe.innerHTML = "";
      probe.appendChild(span);
    }
  }
  pages.push({ start, end: allWords.length - 1 });
  document.body.removeChild(probe);

  pages.forEach((p, idx) => {
    for (let i = p.start; i <= p.end; i++) pageOfWord[i] = idx;
  });
}

function renderStage(now) {
  if (!allWords.length || !pages.length) return;

  const wi = lastIndexBefore(allWords, now); // current spoken word, -1 before start
  const curWi = Math.max(0, wi);
  const pageIdx = pageOfWord[curWi] ?? 0;
  const page = pages[pageIdx];

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

  // Render the whole page so the box keeps a stable shape; in flow mode the
  // not-yet-spoken words are invisible (space reserved) and reveal as spoken.
  stageEl.innerHTML = "";
  for (let i = page.start; i <= page.end; i++) {
    const span = document.createElement("span");
    const shown = mode === "phrase" || i <= wi;
    const animate = mode === "flow" && grew && i === wi;
    span.className =
      "word" +
      (shown ? "" : " hidden") +
      (animate ? " new" : "") +
      (i === foundWord ? " found" : "");
    span.dataset.i = i; // makes the word clickable as a seek target
    span.textContent = allWords[i].text + " ";
    stageEl.appendChild(span);
  }
}

function rerender() {
  lastPage = -1;
  lastWi = -1;
  lastMode = "";
  lastFound = -1;
  if (player && ready) renderStage(player.getCurrentTime());
}

// --- Seeking to a word --------------------------------------------------

// Words carry their own timing, so the caption text is also a seek control:
// click a word and the audio moves to where that word is spoken.
function seekToWord(i) {
  if (!player || !ready) return;
  const word = allWords[i];
  if (!word) return;
  player.seekTo(word.start, true);
  rerender();
}

stageEl.addEventListener("click", (e) => {
  const span = e.target.closest(".word");
  if (!span || span.dataset.i === undefined) return;
  // Stop the page-wide click handler from also toggling play.
  e.stopPropagation();
  seekToWord(parseInt(span.dataset.i, 10));
  wake();
});

// --- Transcript search --------------------------------------------------

// One lowercased string of the whole transcript, plus a map back from any
// character to the word it belongs to. Built once, so searching is a plain
// indexOf scan however long the video is.
function buildSearchIndex() {
  const parts = [];
  searchWordAt = [];
  let pos = 0;
  allWords.forEach((w, i) => {
    const text = w.text.toLowerCase();
    for (let k = 0; k < text.length; k++) searchWordAt[pos + k] = i;
    parts.push(text);
    pos += text.length;
    searchWordAt[pos] = i; // the joining space belongs to the word before it
    pos += 1;
  });
  searchHaystack = parts.join(" ");
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  matches = [];
  matchAt = -1;
  if (!q) {
    searchCount.textContent = "";
    searchCount.classList.remove("none");
    setFound(-1);
    return;
  }

  let from = 0;
  for (;;) {
    const hit = searchHaystack.indexOf(q, from);
    if (hit === -1) break;
    const wordIndex = searchWordAt[hit];
    // A query spanning several words still counts once, at its first word.
    if (matches[matches.length - 1] !== wordIndex) matches.push(wordIndex);
    from = hit + 1;
  }

  searchCount.classList.toggle("none", matches.length === 0);
  if (!matches.length) {
    searchCount.textContent = "no matches";
    setFound(-1);
    return;
  }
  // Start from whatever is playing now, so "next" moves forward from here.
  const now = Math.max(0, lastIndexBefore(allWords, player.getCurrentTime()));
  const ahead = matches.findIndex((w) => w >= now);
  matchAt = ahead === -1 ? 0 : ahead;
  goToMatch(matchAt);
}

function setFound(wordIndex) {
  foundWord = wordIndex;
  rerender();
}

function goToMatch(index) {
  if (!matches.length) return;
  matchAt = (index + matches.length) % matches.length;
  searchCount.textContent = `${matchAt + 1} / ${matches.length}`;
  const wordIndex = matches[matchAt];
  foundWord = wordIndex;
  // Seek rather than only scroll: the caption box shows one page at a time,
  // so the way to look at a match is to move playback to it.
  seekToWord(wordIndex);
}

function setSearch(open) {
  searchOpen = open;
  searchEl.classList.toggle("hidden", !open);
  document.body.classList.toggle("searching", open);
  if (open) {
    searchInput.focus();
    searchInput.select();
    wake();
  } else {
    searchInput.blur();
    setFound(-1);
  }
}

searchInput.addEventListener("input", () => runSearch(searchInput.value));

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setSearch(false);
  } else if (e.key === "Enter") {
    e.preventDefault();
    goToMatch(matchAt + (e.shiftKey ? -1 : 1));
  }
  e.stopPropagation(); // typing must not reach the page shortcuts
});

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function updateSeek(now) {
  const dur = player.getDuration ? player.getDuration() : 0;
  curTimeEl.textContent = formatTime(now);
  durTimeEl.textContent = formatTime(dur);
  if (!seeking && dur > 0) {
    const pct = Math.max(0, Math.min(100, (now / dur) * 100));
    seekFill.style.width = `${pct}%`;
    seekKnob.style.left = `${pct}%`;
  }
}

function tick() {
  if (!player || typeof player.getCurrentTime !== "function") return;
  const now = player.getCurrentTime();
  renderStage(now);
  updateSeek(now);
}

// --- Controls -----------------------------------------------------------

function togglePlay() {
  if (!player) return;
  const st = player.getPlayerState();
  if (st === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
  wake();
}

function setIdle(idle) {
  if (idle && speedMenuOpen) return;
  controlsEl.classList.toggle("idle", idle);
  badgeEl.style.opacity = idle ? "0" : "0.85";
  document.body.classList.toggle("hide-cursor", idle);
}

function wake() {
  setIdle(false);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setIdle(true), 2600);
}

function updateVolumeUI() {
  const eff = muted ? 0 : volume / 100;
  const fill = eff * 104;
  volFill.style.width = `${fill}px`;
  volKnob.style.left = `${Math.max(0, fill - 6)}px`;
  if (wave1) wave1.style.opacity = eff > 0.15 ? "1" : "0.25";
  if (wave2) wave2.style.opacity = eff > 0.55 ? "1" : "0.25";
  document.body.classList.toggle("muted", muted || volume === 0);
}

function applyVolume() {
  if (!player) return;
  if (muted || volume === 0) player.mute();
  else {
    player.unMute();
    player.setVolume(volume);
  }
  updateVolumeUI();
}

function buildSpeedMenu() {
  speedMenu.innerHTML = "";
  const cur = player ? player.getPlaybackRate() : 1;
  for (const v of SPEEDS) {
    const b = document.createElement("button");
    b.className = "speed-opt" + (v === cur ? " active" : "");
    b.textContent = `${v}×`;
    b.addEventListener("click", () => {
      if (player) player.setPlaybackRate(v);
      speedBtn.textContent = `${v}×`;
      setSpeedMenu(false);
      wake();
    });
    speedMenu.appendChild(b);
  }
}

function setSpeedMenu(open) {
  speedMenuOpen = open;
  speedMenu.classList.toggle("hidden", !open);
  if (open) buildSpeedMenu();
}

function setMode(next) {
  mode = next;
  modeLabel.textContent = mode === "flow" ? "Flow" : "Phrase";
  rerender();
  wake();
}

// Show the video title + author in the top badge (available once playing).
function setTitle() {
  const data = player && player.getVideoData ? player.getVideoData() : null;
  if (!data) return;
  if (data.title) titleEl.textContent = data.title;
  if (data.author) authorEl.textContent = data.author;
  if (data.title) {
    document.title = data.author
      ? `${data.title} — ${data.author}`
      : data.title;
  }
}

// Wiring
playPauseBtn.addEventListener("click", togglePlay);
modeBtn.addEventListener("click", () =>
  setMode(mode === "flow" ? "phrase" : "flow"),
);
speedBtn.addEventListener("click", () => setSpeedMenu(!speedMenuOpen));

muteBtn.addEventListener("click", () => {
  muted = !muted;
  applyVolume();
  wake();
});

function setVolFromEvent(e) {
  const r = volTrack.getBoundingClientRect();
  let ratio = (e.clientX - r.left) / r.width;
  ratio = Math.max(0, Math.min(1, ratio));
  volume = Math.round(ratio * 100);
  muted = ratio === 0;
  applyVolume();
}

volTrack.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  setVolFromEvent(e);
  const move = (ev) => setVolFromEvent(ev);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  wake();
});

function seekFromEvent(e) {
  const r = seekTrack.getBoundingClientRect();
  let ratio = (e.clientX - r.left) / r.width;
  ratio = Math.max(0, Math.min(1, ratio));
  const pct = ratio * 100;
  seekFill.style.width = `${pct}%`;
  seekKnob.style.left = `${pct}%`;
  const dur = player ? player.getDuration() : 0;
  if (dur > 0) curTimeEl.textContent = formatTime(ratio * dur);
  return ratio;
}

seekTrack.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  seeking = true;
  let ratio = seekFromEvent(e);
  const move = (ev) => {
    ratio = seekFromEvent(ev);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const dur = player ? player.getDuration() : 0;
    if (dur > 0) {
      player.seekTo(ratio * dur, true);
      rerender();
    }
    seeking = false;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  wake();
});

fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
  wake();
});

// Click anywhere (outside the control bar) toggles play/pause.
document.addEventListener("click", (e) => {
  if (!ready) return;
  if (e.target.closest("#controls")) return;
  if (e.target.closest("#search")) return;
  togglePlay();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "/") {
    e.preventDefault();
    setSearch(true);
  } else if (e.key === "Escape" && searchOpen) {
    setSearch(false);
  }
});

document.addEventListener("mousemove", wake);

// --- YouTube player -----------------------------------------------------

window.onYouTubeIframeAPIReady = function () {
  if (!videoId) {
    showStatus(
      "No video specified. Open this page from the Caption Mode button.",
    );
    return;
  }
  document.body.classList.add("paused");
  player = new YT.Player("player", {
    videoId,
    playerVars: { autoplay: 0, controls: 0, start: startAt, rel: 0 },
    events: { onReady: onPlayerReady, onStateChange: onStateChange },
  });
};

async function onPlayerReady() {
  const ok = await loadTranscript();
  if (!ok) return;
  applyVolume();
  speedBtn.textContent = `${player.getPlaybackRate()}×`;
  setTitle();
  ready = true;
  buildSearchIndex();
  computePages();
  rerender();
  wake();
  setInterval(tick, 100);
}

// Re-pack pages when the viewport (and thus the box width/font) changes.
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!ready) return;
    computePages();
    rerender();
  }, 200);
});

function onStateChange(e) {
  const playing = e.data === YT.PlayerState.PLAYING;
  document.body.classList.toggle("paused", !playing);
  if (playing) setTitle(); // title data is reliably present once playing
}

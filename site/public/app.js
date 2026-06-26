// Caption Mode frontend: hidden YouTube player + large scrolling captions,
// with phrase-level and word-for-word modes, plus playback controls.

const WORDS_PAGE_PHRASES = 3; // phrases shown per word-mode page

const params = new URLSearchParams(location.search);
const videoId = params.get("v");
const startAt = parseInt(params.get("t"), 10) || 0;

const captionsEl = document.getElementById("captions");
const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");
const controlsEl = document.getElementById("controls");
const volumeEl = document.getElementById("volume");
const speedEl = document.getElementById("speed");
const modeBtn = document.getElementById("mode-toggle");
const seekEl = document.getElementById("seek");
const curTimeEl = document.getElementById("cur-time");
const durTimeEl = document.getElementById("dur-time");
const playPauseBtn = document.getElementById("playpause");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const likeBtn = document.getElementById("like");
const loopBtn = document.getElementById("loop");

let loopOn = false;
let seeking = false;

let player = null;
let phrases = [];
let words = [];
let phraseWords = []; // phraseWords[pi] = [{ gi, text }]
let mode = "phrase"; // 'phrase' | 'word'
let lastPhrase = -1;
let lastWord = -1;
let ready = false;

function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add("visible");
}

// --- Transcript ---------------------------------------------------------

async function loadTranscript() {
  try {
    const res = await fetch(`/api/transcript?v=${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      showStatus("No captions available for this video.");
      return false;
    }
    const data = await res.json();
    phrases = data.phrases || [];
    words = data.words || [];
    if (!phrases.length) {
      showStatus("No captions available for this video.");
      return false;
    }

    // Group words by their phrase for word-mode rendering.
    phraseWords = [];
    words.forEach((w, gi) => {
      (phraseWords[w.p] ||= []).push({ gi, text: w.text });
    });

    // Word-for-word is the default when the video has per-word timing.
    if (data.hasWordTiming && words.length) {
      mode = "word";
      modeBtn.disabled = false;
      modeBtn.textContent = "Word-for-word";
    } else {
      mode = "phrase";
      modeBtn.disabled = true; // no word data → can't switch
      modeBtn.textContent = "Phrase";
    }
    return true;
  } catch (err) {
    showStatus("Couldn't load captions. Is the server running?");
    return false;
  }
}

// --- Lookup helpers -----------------------------------------------------

function lastIndexBefore(arr, now) {
  let lo = 0;
  let hi = arr.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].start <= now) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// --- Rendering ----------------------------------------------------------

// Phrase mode: the centered three-zone scroll with context lines.
function makePhraseLine(pi, distance) {
  const div = document.createElement("div");
  div.className =
    "line " + (distance === 0 ? "current" : distance === 1 ? "near" : "far");
  div.textContent = phrases[pi].text;
  return div;
}

function renderPhrase(pi) {
  captionsEl.className = "";
  captionsEl.innerHTML = "";

  const above = document.createElement("div");
  above.className = "above";
  for (let i = pi - 2; i < pi; i++) {
    if (i < 0) continue;
    above.appendChild(makePhraseLine(i, Math.abs(i - pi)));
  }

  const current = makePhraseLine(pi, 0);

  const below = document.createElement("div");
  below.className = "below";
  for (let i = pi + 1; i <= pi + 2; i++) {
    if (i >= phrases.length) continue;
    below.appendChild(makePhraseLine(i, Math.abs(i - pi)));
  }

  captionsEl.append(above, current, below);
}

// Word mode: a left-aligned teleprompter that reveals words one at a time,
// keeping the current phrase plus the previous two for context.
function renderWord(wi) {
  captionsEl.className = "word-mode";
  captionsEl.innerHTML = "";
  if (wi < 0) wi = 0;

  // Phrases are grouped into fixed pages; a page reveals word by word, then the
  // next page starts over from its first word.
  const pi = words[wi] ? words[wi].p : 0;
  const pageStart = Math.floor(pi / WORDS_PAGE_PHRASES) * WORDS_PAGE_PHRASES;
  let startWi = wi;
  while (startWi > 0 && words[startWi - 1].p >= pageStart) startWi--;

  const flow = document.createElement("div");
  flow.className = "wordflow";
  for (let i = startWi; i <= wi; i++) {
    const span = document.createElement("span");
    span.className = i === wi ? "w newword" : "w";
    span.textContent = words[i].text + " ";
    flow.appendChild(span);
  }
  captionsEl.appendChild(flow);
}

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
    seekEl.value = String(Math.round((now / dur) * 1000));
  }
}

function tick() {
  if (!player || typeof player.getCurrentTime !== "function") return;
  const now = player.getCurrentTime();
  updateSeek(now);

  if (mode === "word") {
    const wi = lastIndexBefore(words, now);
    if (wi !== lastWord) {
      lastWord = wi;
      renderWord(wi);
    }
  } else {
    const pi = Math.max(0, lastIndexBefore(phrases, now));
    if (pi !== lastPhrase) {
      lastPhrase = pi;
      renderPhrase(pi);
    }
  }
}

function renderForTime(now) {
  lastPhrase = -1;
  lastWord = -1;
  tick(); // forces a fresh render at the current position
}

// --- Playback controls --------------------------------------------------

function togglePlay() {
  if (!player) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

// Click anywhere (except the control bar) toggles play/pause.
document.addEventListener("click", (e) => {
  if (!ready) return;
  if (e.target.closest("#controls")) return;
  togglePlay();
});

volumeEl.addEventListener("input", () => {
  if (player) player.setVolume(Number(volumeEl.value));
});

speedEl.addEventListener("change", () => {
  if (player) player.setPlaybackRate(Number(speedEl.value));
});

modeBtn.addEventListener("click", () => {
  if (modeBtn.disabled) return;
  mode = mode === "word" ? "phrase" : "word";
  modeBtn.textContent = mode === "word" ? "Word-for-word" : "Phrase";
  renderForTime(player.getCurrentTime());
});

// Transport buttons.
playPauseBtn.addEventListener("click", togglePlay);

prevBtn.addEventListener("click", () => {
  if (player) player.seekTo(Math.max(0, player.getCurrentTime() - 10), true);
});

nextBtn.addEventListener("click", () => {
  if (player) player.seekTo(player.getCurrentTime() + 10, true);
});

likeBtn.addEventListener("click", () => likeBtn.classList.toggle("active"));

loopBtn.addEventListener("click", () => {
  loopOn = !loopOn;
  loopBtn.classList.toggle("active", loopOn);
});

// Seek bar: scrub without fighting the tick loop.
seekEl.addEventListener("input", () => {
  seeking = true;
  const dur = player.getDuration();
  if (dur > 0) curTimeEl.textContent = formatTime((seekEl.value / 1000) * dur);
});

seekEl.addEventListener("change", () => {
  const dur = player.getDuration();
  if (dur > 0) {
    player.seekTo((seekEl.value / 1000) * dur, true);
    renderForTime((seekEl.value / 1000) * dur);
  }
  seeking = false;
});

// Auto-hide the control bar when the mouse is idle.
let idleTimer;
function wakeControls() {
  controlsEl.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => controlsEl.classList.add("idle"), 2500);
}
document.addEventListener("mousemove", wakeControls);

// --- YouTube IFrame player ---------------------------------------------

window.onYouTubeIframeAPIReady = function () {
  if (!videoId) {
    showStatus("No video specified. Open this page from the Caption Mode button.");
    return;
  }
  player = new YT.Player("player", {
    videoId,
    playerVars: { autoplay: 0, controls: 0, start: startAt, rel: 0 },
    events: { onReady: onPlayerReady, onStateChange: onStateChange },
  });
};

async function onPlayerReady() {
  const ok = await loadTranscript();
  if (!ok) return;
  renderForTime(startAt); // show captions behind the blurred play overlay
  ready = true;
  wakeControls();
  setInterval(tick, 120);
}

function onStateChange(e) {
  const playing = e.data === YT.PlayerState.PLAYING;
  // Overlay and play/pause icon both reflect playing vs. paused.
  overlayEl.classList.toggle("hidden", playing);
  controlsEl.classList.toggle("playing", playing);

  if (e.data === YT.PlayerState.ENDED && loopOn) {
    player.seekTo(0, true);
    player.playVideo();
  }
}

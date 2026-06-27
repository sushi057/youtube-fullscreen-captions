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
const curTimeEl = document.getElementById("cur-time");
const durTimeEl = document.getElementById("dur-time");

// State
let player = null;
let phrases = [];
let phraseWords = []; // phraseWords[pi] = [{ start, text }]
let mode = "flow"; // 'flow' | 'phrase'
let volume = 100; // 0..100
let muted = false;
let speedMenuOpen = false;
let ready = false;
let seeking = false;
let hideTimer = null;
// render cache
let lastPi = -1;
let lastRevealed = -1;
let lastMode = "";

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
    if (!phrases.length) {
      showStatus("No captions available for this video.");
      return false;
    }

    // Build per-phrase word lists. Use real word timing when present;
    // otherwise spread each phrase's words evenly across its duration so
    // flow mode still works.
    phraseWords = phrases.map(() => []);
    if (data.hasWordTiming && (data.words || []).length) {
      for (const w of data.words) {
        (phraseWords[w.p] ||= []).push({ start: w.start, text: w.text });
      }
    } else {
      phrases.forEach((p, pi) => {
        const toks = p.text.split(/\s+/).filter(Boolean);
        const dur = p.dur > 0 ? p.dur : toks.length * 0.3;
        phraseWords[pi] = toks.map((t, k) => ({
          start: p.start + (dur * k) / Math.max(1, toks.length),
          text: t,
        }));
      });
    }
    return true;
  } catch (err) {
    showStatus("Couldn't load captions. Is the server running?");
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

function renderStage(now) {
  if (!phrases.length) return;
  const pi = Math.max(0, lastIndexBefore(phrases, now));
  const pw = phraseWords[pi] || [];

  // How many words are revealed. In flow mode this grows with the audio; in
  // phrase mode the whole phrase is shown at once.
  const revealed =
    mode === "flow" ? pw.filter((w) => w.start <= now).length || 1 : pw.length;

  if (pi === lastPi && revealed === lastRevealed && mode === lastMode) return;
  const grew = pi === lastPi && mode === lastMode && revealed > lastRevealed;
  lastPi = pi;
  lastRevealed = revealed;
  lastMode = mode;

  // Always render the full phrase; hide not-yet-spoken words (space reserved)
  // so the caption keeps a stable multi-line shape instead of reflowing.
  stageEl.innerHTML = "";
  for (let i = 0; i < pw.length; i++) {
    const span = document.createElement("span");
    const shown = mode === "phrase" || i < revealed;
    span.className =
      "word" + (shown ? "" : " hidden") + (grew && i === revealed - 1 ? " new" : "");
    // Trailing space is a real line-break opportunity — without it the words
    // run together as one unbreakable line that overflows.
    span.textContent = pw[i].text + " ";
    stageEl.appendChild(span);
  }
}

function rerender() {
  lastPi = -1;
  lastRevealed = -1;
  lastMode = "";
  if (player && ready) renderStage(player.getCurrentTime());
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
    document.title = data.author ? `${data.title} — ${data.author}` : data.title;
  }
}

// Wiring
playPauseBtn.addEventListener("click", togglePlay);
modeBtn.addEventListener("click", () => setMode(mode === "flow" ? "phrase" : "flow"));
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
  togglePlay();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  }
});

document.addEventListener("mousemove", wake);

// --- YouTube player -----------------------------------------------------

window.onYouTubeIframeAPIReady = function () {
  if (!videoId) {
    showStatus("No video specified. Open this page from the Caption Mode button.");
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
  rerender();
  wake();
  setInterval(tick, 100);
}

function onStateChange(e) {
  const playing = e.data === YT.PlayerState.PLAYING;
  document.body.classList.toggle("paused", !playing);
  if (playing) setTitle(); // title data is reliably present once playing
}

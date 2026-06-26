const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// YouTube's InnerTube (ANDROID) player endpoint returns caption track URLs that
// are NOT POT-gated, unlike the ones scraped from the watch page HTML.
const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const INNERTUBE_CLIENT_VERSION = "20.10.38";
const INNERTUBE_UA = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

app.use(express.static(path.join(__dirname, "public")));

// --- Caption fetching ---------------------------------------------------

async function getCaptionTracks(videoId) {
  const resp = await fetch(INNERTUBE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": INNERTUBE_UA },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: INNERTUBE_CLIENT_VERSION,
        },
      },
      videoId,
    }),
  });
  const data = await resp.json();
  return (
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  );
}

// Prefer English, and among English prefer the auto-generated ("asr") track,
// since only asr tracks carry per-word timing for word-for-word mode.
function pickTrack(tracks) {
  const en = tracks.filter((t) => (t.languageCode || "").startsWith("en"));
  const pool = en.length ? en : tracks;
  return pool.find((t) => t.kind === "asr") || pool[0];
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

// Parse srv3 timed-text XML into phrase- and word-level data.
//   <p t="startMs" d="durMs"><s>word</s><s t="offsetMs"> word2</s>...</p>
function parseSrv3(xml) {
  const phrases = [];
  const words = [];
  let hasWordTiming = false;

  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let p;
  while ((p = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(p[1], 10);
    const inner = p[3];

    // Collect <s> segments with their per-word offsets.
    const segs = [];
    const sRegex = /<s([^>]*)>([^<]*)<\/s>/g;
    let s;
    while ((s = sRegex.exec(inner)) !== null) {
      const offMatch = s[1].match(/\bt="(\d+)"/);
      const off = offMatch ? parseInt(offMatch[1], 10) : 0;
      if (offMatch) hasWordTiming = true;
      const text = decodeEntities(s[2]);
      segs.push({ off, text });
    }

    let phraseText;
    if (segs.length) {
      phraseText = segs.map((x) => x.text).join("").replace(/\s+/g, " ").trim();
    } else {
      phraseText = decodeEntities(inner.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
    }
    if (!phraseText) continue;

    const pi = phrases.length;
    phrases.push({ start: startMs / 1000, dur: parseInt(p[2], 10) / 1000, text: phraseText });

    for (const seg of segs) {
      const w = seg.text.replace(/\s+/g, " ").trim();
      if (!w) continue;
      words.push({ start: (startMs + seg.off) / 1000, text: w, p: pi });
    }
  }

  return { hasWordTiming, phrases, words };
}

async function fetchData(videoId) {
  const tracks = await getCaptionTracks(videoId);
  if (!tracks.length) throw new Error("no_tracks");
  const track = pickTrack(tracks);
  const res = await fetch(`${track.baseUrl}&fmt=srv3`, {
    headers: { "User-Agent": INNERTUBE_UA },
  });
  const xml = await res.text();
  const data = parseSrv3(xml);
  if (!data.phrases.length) throw new Error("empty");
  return data;
}

app.get("/api/transcript", async (req, res) => {
  const videoId = req.query.v;
  if (!videoId || typeof videoId !== "string") {
    return res.status(400).json({ error: "missing_video_id" });
  }
  try {
    const data = await fetchData(videoId);
    return res.json({ videoId, ...data });
  } catch (err) {
    console.error(`transcript fetch failed for ${videoId}: ${err.message}`);
    return res.status(404).json({ error: "no_transcript" });
  }
});

app.listen(PORT, () => {
  console.log(`Caption Mode running at http://localhost:${PORT}`);
});

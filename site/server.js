const path = require("path");
const express = require("express");

const {
  fetchTranscript,
  createCache,
  TranscriptError,
} = require("./transcript");

const app = express();
const PORT = process.env.PORT || 3000;

// Transcripts are immutable once published, so the cache needs a ceiling but
// no expiry. It also keeps popular videos working through a partial YouTube
// outage, since a cached answer never touches the upstream at all.
const CACHE_MAX = 500;
const cache = createCache(CACHE_MAX);

// A video with captions, used only to check that the upstream path still works.
const HEALTH_CHECK_VIDEO = process.env.HEALTH_CHECK_VIDEO || "jNQXAC9IVRw";

// How each failure reaches the browser. Keeping "the video has no captions"
// apart from "YouTube is not answering" is the whole point: the second one is
// temporary, and telling a user otherwise sends them away for good.
const FAILURES = {
  no_transcript: { status: 404, error: "no_transcript" },
  unavailable: { status: 404, error: "unavailable" },
  upstream_failed: { status: 502, error: "upstream_failed" },
};

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/transcript", async (req, res) => {
  const videoId = req.query.v;
  if (!videoId || typeof videoId !== "string") {
    return res.status(400).json({ error: "missing_video_id" });
  }

  const cached = cache.get(videoId);
  if (cached) return res.json({ videoId, cached: true, ...cached });

  try {
    const data = await fetchTranscript(videoId);
    cache.set(videoId, data);
    return res.json({ videoId, cached: false, ...data });
  } catch (err) {
    const code = err instanceof TranscriptError ? err.code : "upstream_failed";
    const failure = FAILURES[code] || FAILURES.upstream_failed;
    console.error(`transcript ${code} for ${videoId}: ${err.message}`);
    return res.status(failure.status).json({ error: failure.error });
  }
});

// Tells you the YouTube caption path broke before your users do.
app.get("/api/health", async (_req, res) => {
  const started = Date.now();
  try {
    const data = await fetchTranscript(HEALTH_CHECK_VIDEO, { retries: 0 });
    return res.json({
      status: "ok",
      upstream: "reachable",
      phrases: data.phrases.length,
      hasWordTiming: data.hasWordTiming,
      cacheSize: cache.size,
      ms: Date.now() - started,
    });
  } catch (err) {
    const code = err instanceof TranscriptError ? err.code : "upstream_failed";
    return res.status(503).json({
      status: "degraded",
      upstream: code,
      detail: err.message,
      cacheSize: cache.size,
      ms: Date.now() - started,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Caption Mode running at http://localhost:${PORT}`);
  });
}

module.exports = app;

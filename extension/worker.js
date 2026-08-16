// Fetches transcripts on the overlay's behalf.
//
// MV3 content scripts hold no cross-origin privileges; the service worker
// does. So the overlay asks, and this answers. The extension therefore needs
// no backend at all: every call goes to youtube.com, where the extension
// already runs.

import {
  fetchTranscript,
  createCache,
  TranscriptError,
} from "./vendor/transcript.js";

// A transcript never changes once published, so this needs a ceiling but no
// expiry. One fetch per video per browser session.
const cache = createCache(200);

async function handle(videoId) {
  const cached = cache.get(videoId);
  if (cached) return { ok: true, data: cached };

  try {
    const data = await fetchTranscript(videoId);
    cache.set(videoId, data);
    return { ok: true, data };
  } catch (err) {
    const code = err instanceof TranscriptError ? err.code : "upstream_failed";
    console.error(`transcript ${code} for ${videoId}: ${err.message}`);
    return { ok: false, code };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "transcript") return false;
  handle(msg.videoId).then(sendResponse);
  return true; // keeps the message channel open for the async answer
});

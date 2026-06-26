# Caption Mode for YouTube

Watch YouTube on a blank black screen with large, focus-friendly captions — no
video, no distractions. A browser extension adds a **Caption Mode** button to
the YouTube watch page; clicking it opens the companion website, which plays the
video's audio and shows the spoken words as captions.

Two caption presentations:

- **Phrase mode** — a calm, centered three-line scroll (previous / current /
  next), current line bright.
- **Word-for-word mode** — a left-aligned teleprompter that reveals one word at
  a time, a few phrases per page. Default whenever the video has per-word
  timing.

The site also has a media-player control panel: seek bar, play/pause, ±10s,
loop, volume, playback speed, and a phrase/word toggle.

## Repository layout

```
extension/   MV3 browser extension — injects the launcher button (desktop YouTube)
site/        Node + static frontend — the blank-screen caption player
```

## Running the site locally

```bash
cd site
npm install
npm start          # http://localhost:3000
```

Open a video directly to test:

```
http://localhost:3000/?v=VIDEO_ID&t=START_SECONDS
```

The frontend loads a hidden YouTube IFrame player (audio only) and fetches the
transcript from the backend.

### How captions are fetched

`site/server.js` exposes `GET /api/transcript?v=VIDEO_ID`. It calls YouTube's
InnerTube (ANDROID) player API to obtain non–token-gated caption track URLs,
fetches the `srv3` timed-text, and returns both phrase-level and word-level
segments:

```json
{ "videoId": "...", "hasWordTiming": true, "phrases": [...], "words": [...] }
```

Videos without captions return `404 { "error": "no_transcript" }`, which the
frontend shows as a friendly message.

## Installing the extension (desktop Chrome)

1. Visit `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Open any `youtube.com/watch?v=...` page and click **Caption Mode** in the
   action row.

The extension opens `CAPTION_MODE_SITE/?v=ID&t=SECONDS`. Point it at your
deployment by editing `CAPTION_MODE_SITE` at the top of
`extension/content.js` (defaults to `http://localhost:3000` for development).

## Notes / limits

- Desktop YouTube only for now.
- Word-for-word timing comes from auto-generated (`asr`) captions; videos with
  only manually-authored subtitles fall back to phrase mode.
- The transcript source depends on YouTube's internal APIs and can change.

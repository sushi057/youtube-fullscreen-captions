# Caption Mode for YouTube

Read a YouTube video as large captions on a black screen. The audio keeps
playing. The video, the thumbnails, the comments, and the sidebar go away.

It is for the times you want what was said, not what was shown: talks, lectures,
interviews, podcasts. It is also for reading in a quiet room, at your own speed,
without a video competing for your attention.

![Caption Mode reading a video](docs/images/overlay.png)

## Install

The extension needs no server, no account, and no configuration.

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.

That is all. Open YouTube and the two entry points below are there.

Chrome, Edge, Brave, and other Chromium browsers all work. Desktop only.

## Use it

**From a video.** Click **Caption Mode** in the row of buttons under the player,
next to Share.

![The Caption Mode button under the player](docs/images/toolbar-button.png)

**From the feed.** Put the pointer on any video in the home feed or in search
results. A small icon appears at the top-left of the picture. One click takes
you straight into Caption Mode for that video.

![The icon on a feed thumbnail](docs/images/feed-icon.png)

Press `Escape` to leave. The audio never stops when you enter or leave, so you
can move in and out of Caption Mode in the middle of a sentence.

## While you read

The captions are a control, not only text.

- **Click any word** to move the audio to that word.
- **Press `/`** to search the transcript. `Enter` finds the next match,
  `Shift`+`Enter` the previous one, `Escape` closes the search.
- **Open the full transcript** from the control bar to read ahead or jump.

### Keyboard

| Key       | Action                |
| --------- | --------------------- |
| `Escape`  | Leave Caption Mode    |
| `Space`   | Play or pause         |
| `←` / `→` | Back or forward 10s   |
| `↑` / `↓` | Volume                |
| `M`       | Mute                  |
| `F`       | Fullscreen            |
| `/`       | Search the transcript |

These win over YouTube's own shortcuts while Caption Mode is open, so `F` makes
the captions fullscreen rather than the player behind them.

### Reading options

The control bar has a text button. It sets:

- **Font** — Sans, Serif, Mono, or Dyslexic
- **Size** — Small, Medium, Large
- **Colour** — Off white, White, Amber, Green, Blue, Pink

Your choice is remembered. So is your position in each video: come back later
and Caption Mode resumes where you stopped.

### Two ways to read

- **Flow** — several lines at once, the current one bright. Good for following
  an argument.
- **Word for word** — one word revealed at a time, like a teleprompter. Good for
  pacing yourself. It needs per-word timing, which comes from YouTube's
  auto-generated captions.

Switch between them from the control bar.

## How it works

Caption Mode draws a black layer over the watch page. It creates no player of
its own — it reads and drives the video already on the page.

That is the whole design, and it is why the awkward parts of a normal embed do
not apply: no blocked autoplay, no ads on a black screen with no controls, no
video that refuses to embed, and never two players fighting over your speakers.

Captions come from YouTube's own caption tracks, fetched from the page itself.
Auto-generated (`asr`) tracks are preferred, because only those carry per-word
timing.

Clicking the icon in the feed is a navigation: it records what you asked for,
loads the watch page, and opens Caption Mode as that page arrives. You never see
the watch page, because the black layer is already over it.

## Limits

- Desktop YouTube only.
- Videos with no captions cannot be read. Caption Mode says so and gets out of
  your way.
- Videos with only hand-written subtitles fall back to flow mode, because those
  tracks carry no per-word timing.
- Captions come from YouTube's internal API, which YouTube can change.

## The companion site

`site/` is a small server and page that plays a video with captions **without**
the extension. It exists for sharing a video with someone who has not installed
anything.

You do not need it for daily use. The extension does not call it.

```bash
cd site
npm install
npm start          # http://localhost:3000
```

`GET /api/transcript?v=VIDEO_ID` returns phrase-level and word-level segments.
`GET /api/health` fetches a known-good video and answers `503` when the caption
path is broken, so you learn about an outage before your users do.

## Repository layout

```
extension/         The extension. This is the product.
transcript-core/   Caption fetching and parsing, shared, with the tests
site/              The companion site, for people without the extension
docs/              Design notes and plans
```

`transcript-core/` is the source of truth for caption handling. `npm run sync`
copies it into the extension and the site, because neither can load a file from
outside its own folder and this repository has no bundler.

## Development

```bash
npm install        # eslint + prettier only, no runtime dependencies
npm test           # transcript parsing, failure handling, cache, feed logic
npm run lint
npm run format     # or format:check
```

Tests use the built-in Node test runner. No framework, and no network.

After changing extension files, open `chrome://extensions` and press **Reload**
on Caption Mode. Chrome does not pick up new files on its own.

## License

[MIT](LICENSE)

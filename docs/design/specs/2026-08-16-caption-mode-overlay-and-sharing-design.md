# Caption Mode: in-page overlay and stateless sharing

Date: 2026-08-16
Status: approved for planning

## Purpose

Caption Mode plays a YouTube video's audio on a black screen and shows large
captions. Today it does this on a companion website that creates a hidden
YouTube embed.

This design moves daily reading into the YouTube page itself, and gives the
website a new job: showing caption sequences that people share.

## Why change

The current design has one structural weakness. The site does not use YouTube's
real player. It creates a second, hidden embed player. Embeds follow different
rules than the watch page:

- Browsers block embed audio until the user clicks on the page.
- Ads play inside the embed, on a black screen with no controls.
- Creators can disable embedding. Those videos fail after the user has already
  left YouTube, on a page with no way back.
- The YouTube tab keeps its own player, so two audio sources can overlap.

An overlay on the watch page has none of these problems. It creates no player.
It draws a black layer over the page and reads the video already playing there.

A second change comes from the sharing feature. A share link must work for
people who have not installed the extension. Only the website can do that.

## Product shape

Two surfaces, each with one job.

| Surface           | Job                           | Needs a server |
| ----------------- | ----------------------------- | -------------- |
| Extension overlay | Where you read, every day     | No             |
| Website (Vercel)  | Where a shared sequence lives | Yes            |

The website also keeps its existing player page, as the path for people who
have not installed the extension.

## Decisions already made

1. Build in this order: shared module, overlay, share button, website.
2. Share links carry no server state. No database.
3. The share button copies a link. The link carries an image preview.
4. Storage for shared sequences is out of scope until broken links are a real
   complaint.

## Architecture

### Component map

```
transcript-core/        Fetch + parse YouTube captions. No platform calls.
  |
  |-- extension/worker.js     Service worker. Fetches on the overlay's behalf.
  |     |
  |     `-- extension/overlay/  Black layer + captions on the watch page.
  |
  `-- site/api/               Vercel functions. Transcript + share pages.
        |
        `-- site/public/      Existing player page, and the new share page.
```

### The shared module

`transcript-core` holds every assumption about YouTube's internal APIs. It is
the only place that knows about InnerTube, `srv3`, or `srv1`. When YouTube
changes, one file is repaired.

It must run in both Node and the browser, so it may use only `fetch`, string
handling, and regular expressions. No Node built-ins. It takes a `fetchImpl`
so callers can supply their own.

**Where it lives.** One ES module file at the repository root, in
`transcript-core/`. An extension cannot load a file from outside its own
folder, and Vercel cannot import from outside its project folder. So a small
`npm run sync` script copies the file into `extension/` and `site/`, and CI
fails if a copy differs from the source. This keeps one authority without
adding a bundler.

The service worker declares `"type": "module"` so it can import the file
directly. The content script receives its data by message, so it never imports
the module at all.

Its interface stays as built today:

- `parseTimedText(xml)` returns `{ hasWordTiming, phrases, words }`.
- `fetchTranscript(videoId, options)` returns the same, or throws
  `TranscriptError` with a code of `no_transcript`, `unavailable`, or
  `upstream_failed`.
- `createCache(max)` returns a least-recently-used cache.

The existing tests move with it and must keep passing unchanged. That is the
check that the extraction changed no behaviour.

### The overlay

A content script on `*://www.youtube.com/watch*`.

**Timing source.** The page's own video element, found at
`#movie_player video.html5-main-video`. The overlay reads `currentTime` on a
timer and calls `play()`, `pause()`, `currentTime =`, and `playbackRate =`.
It creates no player of its own.

**Structure.** A single container element appended to `document.body`, with a
high `z-index`, fixed position, and opaque black background. Inside it sit the
caption stage, the control bar, and the search bar — the same elements the
site's player page already uses, so the existing CSS carries over.

**Entering and leaving.** The existing action-row button toggles the overlay.
Escape leaves. Leaving removes the container and restores the page. The video
keeps playing in both directions, so toggling never interrupts audio.

**The video behind the overlay.** It keeps playing and keeps decoding, covered
by an opaque layer. This is the reliable choice. Hiding YouTube's player risks
YouTube pausing or misbehaving, and the cost is only some decoding work.

**SPA navigation.** YouTube does not reload between videos. On
`yt-navigate-finish` the overlay closes and clears its transcript. The user
opens it again on the new video. This is simpler than re-fetching in place, and
it matches what the button already does.

**Reused behaviour.** Click-to-seek, `/` search, page packing, and the flow and
phrase modes all carry over from the player page unchanged.

### Fetching transcripts without a server

The transcript calls go to `youtube.com`, and the extension already runs there.
So no backend is involved.

MV3 content scripts do not hold cross-origin privileges. The service worker
does. So:

1. The content script sends `{ type: "transcript", videoId }` through
   `chrome.runtime.sendMessage`.
2. The service worker calls `fetchTranscript` from `transcript-core` and
   answers with the transcript, or with an error code.
3. The service worker holds the same LRU cache, so a video is fetched once per
   browser session.

The manifest gains `host_permissions` for `*://*.youtube.com/*` and a
`background.service_worker` entry.

### Sharing

**What is shared.** One page of captions. The player already packs words into
pages that fill the caption box, so a page is one to four lines of speech. That
is the right size for a quote, and it needs no selection interface.

**The link.**

```
https://<site>/s?v=VIDEO_ID&a=START_SECONDS&b=END_SECONDS
```

Nothing is stored. The video ID determines the transcript, and the two times
cut the range out of it. Links cost nothing to keep and cannot expire.

The known trade-off: if the creator deletes the video or replaces its captions,
the link degrades. The share page must handle that plainly — see error
handling below.

**The share button.** In the overlay's control bar. It copies the link to the
clipboard and confirms briefly. It does not open a dialog.

### The share page

A server-rendered page at `/s`. It fetches the transcript for `v`, cuts the
words between `a` and `b`, and shows:

- the caption text, in the same large typography on black,
- the video title and channel,
- the timestamp,
- a link that opens YouTube at `a` seconds.

**Link preview.** The page declares Open Graph and Twitter card tags pointing
at `/api/og`, which draws the same quote as an image. This is what makes the
caption visible in Twitter, Discord, Slack, and iMessage before anyone clicks.

The image must degrade safely: if the transcript cannot be fetched, it draws
the site name rather than failing, because a broken preview image breaks the
whole card.

### Moving the site to Vercel

Express becomes Vercel functions:

| Now                   | After                    |
| --------------------- | ------------------------ |
| `GET /api/transcript` | `site/api/transcript.js` |
| `GET /api/health`     | `site/api/health.js`     |
| static `site/public/` | unchanged, served static |
| new                   | `site/api/og.js`         |
| new                   | `site/api/share.js`      |

The share page is a function, not a static file, because its Open Graph tags
differ for every link. A rewrite in `vercel.json` maps `/s` to
`site/api/share.js`, so the public link stays short.

The cache stays in memory. Vercel functions are short-lived, so the cache helps
only within an instance's life. That is acceptable: it still absorbs repeated
loads of the same share link, which is the traffic shape sharing produces.

Hobby plan is free and covers non-commercial use. If the project ever charges,
it needs Pro. No storage service is added.

## Error handling

The three transcript failures already have codes. Each surface states them
plainly, and never reports a temporary failure as a permanent one.

| Code              | Overlay                                       | Share page                           |
| ----------------- | --------------------------------------------- | ------------------------------------ |
| `no_transcript`   | "This video has no captions."                 | "This video no longer has captions." |
| `unavailable`     | "This video is private, removed, or blocked." | Same, plus the link to YouTube.      |
| `upstream_failed` | "YouTube isn't responding. Try again."        | Same, and the page invites a reload. |

The share page always shows the YouTube link, even when the transcript fails.
That way a degraded link still carries the user somewhere useful.

## Testing

**`transcript-core`** keeps its current tests, unchanged. They cover parsing in
both formats, the three failure codes, the `srv3` to `srv1` downgrade, retry,
and the cache. Passing them after the move is the proof that the extraction was
faithful.

**Share range cutting** gets its own unit tests: a range that starts mid-phrase,
a range past the end of the transcript, a reversed range, and a range with no
words in it.

**The overlay** is verified by driving a real YouTube watch page in headless
Chrome with the extension loaded: open the overlay, confirm captions advance
with the video, click a word and confirm the video seeks, search and confirm
the match, then leave and confirm the page is restored.

**The share page** is verified by rendering it headless for a known video and
reading the screenshot, plus a check that the Open Graph tags point at a URL
that returns an image.

## Out of scope

- Mobile. The overlay is a desktop extension. Phones come much later.
- Stored share snapshots, accounts, and history.
- Selecting a range longer than one caption page.
- Languages other than the current English preference.
- Any change to the reading experience itself: typography controls, session
  timers, and bookmarks are all separate work.

## Risks

- **YouTube changes its page structure.** The overlay depends on finding the
  video element and the action row. Both lookups already exist in the content
  script and are re-run on navigation. A failure is visible and repairable.
- **YouTube changes InnerTube.** Unchanged in kind from today, but now one file
  serves both surfaces, so the repair is single.
- **Chrome Web Store review.** The extension gains `host_permissions` for
  youtube.com and a service worker. Both are ordinary for this kind of tool,
  and the permission matches the stated purpose.

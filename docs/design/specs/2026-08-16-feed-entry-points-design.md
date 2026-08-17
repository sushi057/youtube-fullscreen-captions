# Caption Mode: entry points in the YouTube feed

Date: 2026-08-16
Status: approved for planning

## Purpose

Today Caption Mode has one entry point: a button in the watch page action row.
The user must already be on a video to find it.

This design adds a second entry point. A small icon appears on a feed
thumbnail when the pointer is over it. One click takes the user straight into
Caption Mode for that video.

The goal is browsing. The user scans the feed, sees something worth listening
to, and starts reading it without first landing on the watch page.

## The constraint that shapes everything

The overlay creates no player. It draws a black layer over the watch page and
drives the `<video>` element already inside `#movie_player` (`overlay.js:1-5`).

This is deliberate. It is why the overlay avoids every embed problem: blocked
autoplay, ads inside the frame, and videos that refuse to embed.

Feed pages have no `#movie_player`. They have hover-preview players, which are
muted, short, and not usefully seekable. So a true popup over the feed is not
possible without creating our own player, which would undo the reason the
overlay exists.

The feed icon therefore navigates. It does not open an overlay in place.

## Decisions already made

1. Clicking the icon goes to `/watch?v=…`, and the overlay opens as that page
   lands. The user never sees the watch page, because the overlay covers it.
   Back returns to the feed.
2. The icon appears on hover only. An always-visible badge on 40 thumbnails is
   too crowded.
3. Two surfaces first: the home and subscriptions grid, and search results.
   The watch-page sidebar, channel pages, and playlists come later.
4. Shorts are out of scope. They rarely have a transcript.
5. No pre-check for captions. The icon appears on every eligible thumbnail. A
   video with no transcript shows the existing `no_transcript` message
   (`overlay.js:19`) after the user arrives.
6. The handoff between pages uses `sessionStorage`, not a URL parameter. A URL
   parameter would stay in the address bar and leak into any copied link.

## Why decision 5 is cheap

The transcript picker prefers auto-generated (`asr`) tracks
(`vendor/transcript-classic.js:148-153`), because only those carry per-word
timing. Auto-generated captions are the normal case, not an exception.

"No transcript" therefore means the uploader disabled captions, or the video is
too new for YouTube to have run speech recognition. That set is small, so the
dead-end click is rare.

## Architecture

Three parts. Two are new files; one is a small edit.

### 1. `extension/feed.js` and `extension/feed.css` (new)

A second content script, matched to the feed surfaces. It has one job: put an
icon on thumbnails and record the user's intent before navigating.

It does **not** load `overlay.js`, `caption-view.js`, or the transcript vendor.
The feed page never opens an overlay and never fetches a transcript, so it
needs none of that code. This keeps the feed script small and keeps the two
surfaces from tangling.

The manifest gains a second `content_scripts` entry:

| Field     | Value                                                         |
| --------- | ------------------------------------------------------------- |
| `matches` | the YouTube origin, filtered in code to feed and search paths |
| `js`      | `feed.js`                                                     |
| `css`     | `feed.css`                                                    |

The existing watch-page entry is unchanged.

### 2. The icon

It sits in the thumbnail's hover overlay slot, the same corner YouTube uses for
Watch Later and the queue button. It uses the same closed-caption glyph as the
toolbar button, so the two entry points read as one feature.

Placement rule: top-right by default. If YouTube's own overlay buttons already
occupy that corner, sit to their left rather than on top of them.

It is hidden until the thumbnail is hovered, and it is not focusable when
hidden.

### 3. The edit to `extension/content.js`

Clicking the icon is a navigation. The feed script dies, the watch page loads,
and `content.js` starts fresh with the overlay closed. Nothing would otherwise
tell it that the user asked for Caption Mode.

So the two scripts pass a note:

- Before navigating, `feed.js` writes "open Caption Mode for video X" into
  `sessionStorage`.
- On startup, `content.js` reads the note. If it names the current video, it
  clears the note and opens the overlay once.

The note is cleared before the overlay opens, so a later reload of the same
page does not re-open it.

This is the only change to existing code, in `start()` at `content.js:77`.

## Data flow

```
feed page                          watch page
---------                          ----------
hover thumbnail
  -> icon appears
click icon
  -> write intent to sessionStorage
  -> navigate to /watch?v=X
                                   content.js starts
                                     -> inject toolbar button
                                     -> read intent
                                     -> matches X? clear it, open overlay
                                   overlay attaches to #movie_player
```

## Keeping the icons alive

YouTube is a single-page application. It replaces feed contents on navigation,
on infinite scroll, and on filter-chip changes. The watch-page script already
handles this with a `MutationObserver` plus the SPA navigation event
(`content.js:77-92`). The feed script follows the same pattern.

Two rules keep this cheap on a long feed:

- Mark each thumbnail once, and skip anything already marked. Re-running the
  scan must never produce a second icon.
- Read the video id from the thumbnail's own link, not from page state.

## Failure handling

| Case                               | Behaviour                                      |
| ---------------------------------- | ---------------------------------------------- |
| Video has no transcript            | Existing `no_transcript` message after arrival |
| Thumbnail has no usable video id   | No icon on that thumbnail                      |
| YouTube changes its renderer names | No icon; the watch page button still works     |
| `sessionStorage` unavailable       | Navigation still happens; overlay stays closed |

Every failure degrades to normal YouTube. Nothing blocks the user.

## Verification

The extension has no automated tests; `npm test` covers `transcript-core` and
`site` only. Verification for this work is therefore:

1. `npm run lint` and `npm run format:check` pass.
2. A manual playtest on a real logged-in YouTube session, covering: the home
   grid, search results, infinite scroll, a filter-chip change, and a
   back-navigation from the overlay to the feed.
3. One deliberate click on a video with no captions, to confirm the message.

## Out of scope

- The watch-page sidebar, channel pages, and playlists.
- Shorts.
- Any pre-check of caption availability.
- The transcript picker's language choice. It prefers English and otherwise
  takes the first listed track. That is existing behaviour and this design does
  not change it.

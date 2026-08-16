# transcript-core

Every assumption about YouTube's internal APIs lives in `transcript.js`. When
YouTube changes, this is the file to repair.

It runs in three places: Node (the site's tests), a Chrome service worker, and
a browser page. So it may use only `fetch`, strings, and regular expressions.
No Node built-ins.

`npm run sync` copies it into `extension/vendor/` and `site/lib/`. **Never edit
those copies.** `npm run sync:check` fails when a copy has drifted.

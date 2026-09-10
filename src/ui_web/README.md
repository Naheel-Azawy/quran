# Quran Reader — web UI (`src/ui_web`)

This directory is the web front-end of the Quran project. It's built by
webpack and is normally driven by the **top-level Makefile**, not run
standalone — see `web`, `web-serve` and `web-push` in `../../Makefile`.

## How it fits into the top-level build

```
make web
```

does, in order:

1. Builds `quran.wasm` straight into `build/web/quran.wasm` via `emcc`
   (the Makefile's own rule — nothing here touches this file).
2. Runs `npm install` in this directory if needed.
3. Runs `npm run build` here, which invokes webpack. Webpack writes
   `index.html`, `bundle.js`, `style.css`, `sw.js`, `version`, and
   `res/` (manifest, icons, fonts, the tafsir edition list) directly
   into that same `build/web/` directory, alongside `quran.wasm`.

The two build steps share `build/web/` but neither manages the other's
files — webpack's `clean` is intentionally off so it never deletes
`quran.wasm`.

You can also run webpack directly from here for iterating on the UI
(the wasm file needs to already exist in `build/web/` from a previous
`make web`, or copied there manually, for the app to actually load):

```sh
npm install
npm run build       # -> ../../build/web/
npm start           # dev server on http://localhost:8080
npm run watch       # rebuild on change, no server
```

## Getting the missing assets

A few binary assets referenced by the app aren't part of this source
tree — copy them into `public/res/` before building:

```
public/res/icon.png
public/res/icon144.png
public/res/header.svg
public/res/aya.svg
public/res/editions.json
public/res/fonts/me_quran.ttf   (and the other font files style.css expects)
```

(`quran.wasm` is *not* one of these — it's built by the Makefile
directly into `build/web/`, see above.)

## Source layout

All application code lives in `src/` as ES modules and is bundled by
webpack into a single `bundle.js`. Each file owns one concern:

| File | Responsibility |
|---|---|
| `app.js` | Entry point — boots everything and wires the modules together |
| `icons.js` | The small UI-chrome SVG icons, injected into `data-icon` elements |
| `wasm-loader.js` | Generic emscripten-style wasm loader |
| `quran-engine.js` | Bridges to `quran.wasm`: page text, ayah text, full-text search |
| `quran-index.js` | Builds and holds the sura/page/ayah index derived from the engine |
| `render.js` | Turns one page of engine output into the on-screen markup |
| `viewpager.js` | The swipeable pager widget |
| `navigation.js` | Sura index list, jump-to-page, and search UI |
| `audio.js` | Recitation playback: servers/readers, crossfaded auto-advance |
| `tafsir.js` | Tafsir/translation servers, edition list, edition picker panel |
| `consent.js` | The "connect to an external server?" confirmation dialog |
| `panels.js` | Overlay-panel chrome (open/close), theme, and page sizing |
| `text-utils.js` | Small shared string helpers (Arabic digits, header parsing, etc.) |

`public/` holds everything that isn't a JS module:

- `index.html` — a template; webpack injects the built `<script>` tag
- `style.css` — served from the site root (`build/web/style.css`)
- `sw.js` — the service worker; loaded directly by the browser
- `res/` — manifest, icons, fonts, and the tafsir edition list; copied
  verbatim to `build/web/res/`

`quran.wasm` is deliberately **not** under `public/` at all — it's a
build artifact of the C/emscripten toolchain, produced straight into
`build/web/` by the top-level Makefile.

## Caching / versioning

Every `npm run build` generates a unique version string (this
package's `version` field + the build timestamp) that is:

1. Substituted into `sw.js`'s initial `cacheName`.
2. Written as-is to `build/web/version`.

The service worker periodically re-fetches `version` (bypassing the
HTTP cache) and compares it to the cache it's holding; a mismatch means
a new build was deployed, so it force-refetches every cached asset
(also bypassing the HTTP cache) and re-registers itself. This means a
new `make web` is always picked up automatically, without needing to
remember to bump a version number by hand.

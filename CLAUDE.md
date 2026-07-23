# CLAUDE.md — Mask Vids

Project-specific guidance for working on this repo. See [`README.md`](README.md) for
what the app does from a user's perspective.

## Architecture

Everything lives in three files, no build step, no dependencies:

- `index.html` — markup only.
- `style.css` — CSS custom properties for theming (`--c-*` tokens), no framework.
- `app.js` — the entire application in a single IIFE.

Keep it that way. Don't introduce a bundler, framework, or npm dependency unless
explicitly asked — the whole point of this project is that it runs from `file://`
with a double-click.

## Key concepts in `app.js`

- **WebGL1** (`canvas.getContext('webgl')`), one program, one dynamically-built
  fragment shader (`buildFragmentSrc(nSlots)`). GLSL ES 1.00 can't dynamically
  index a `sampler2D[]` array portably, so texture selection is done via an
  unrolled `if/else` chain (`unrolledPick`) instead.
- **`coverUv()`** (in the shader) implements CSS `object-fit: cover`-style
  cropping per texture, driven by independent aspect-ratio uniforms
  (`uAspectA/B/Mask` vs `uCanvasAspect`). This is what makes mismatched aspect
  ratios (mask vs. video vs. output frame) crop instead of stretch — see
  `updateOutputResolution()` for how `CANVAS_ASPECT` and canvas resolution are
  derived (`Auto` follows the smaller source; fixed 1:1/16:9/9:16 modes reshape
  around the first loaded source's long edge).
- **Mask interpretation is shape-based, not color-based.** `labelIslandsSVG()`
  parses the mask SVG with `DOMParser`, treats each `circle/ellipse/rect/path/
  polygon/polyline/line` (excluding ones inside `defs/clipPath/mask/pattern/
  symbol/marker`) as a candidate "island", and rasterizes each one alone to
  build a per-pixel label buffer. Shapes covering ≥98% of the canvas or with
  zero rendered pixels are excluded (treated as background). `assignIslandVideos()`
  then maps islands to Video A/B based on **fill color count**: 1 distinct
  color → shape-vs-background mode (all islands → A, background → B); exactly
  2 → first-appearing → A, second → B; anything else falls back to
  shape-vs-background.
- **Time displacement / clone architecture.** Each island can be assigned a
  "time group" (`assignRandomGroups`, shuffle-without-replacement so islands
  don't repeat a group until every group has been used once). A 2-channel
  texture (`texIslandInfo`, R=group, G=showsA, `NEAREST` filtered — never
  `LINEAR`, or group indices would interpolate across island boundaries) drives
  per-pixel texture selection in the shader. Each video side gets
  `n - 1` hidden `<video>` clones (`makeCloneManager`, where `n` is the
  current "Time groups" slider value — *not* `N_SLOTS`, the hardware-derived
  max), each seeked to `(i / n) * duration` before playing; slot 0 always
  aliases the main `texA`/`texB` (no clone needed). Only ever create as many
  clones as `n` actually needs — each one is a concurrent video decoder, and
  over-creating them (e.g. always `N_SLOTS - 1`) is wasted decode load, felt
  worst on Safari (see below).
  `N_SLOTS` itself is derived from `MAX_TEXTURE_IMAGE_UNITS` at startup,
  clamped to `[1, 8]` (`[1, 4]` on Safari — see gotchas).
  - A static-image side has nothing to time-shift and never gets clones — its
    islands must always resolve to group 0 (see the `!aIsImage`/`!bIsImage`
    guards in `updateIslandTexture()`). If you touch group assignment, keep
    this invariant: an image-backed side pinned to a nonzero group will sample
    an empty/black clone texture.
  - Both sides get clones whenever time displacement is on, even in
    shape-vs-background mode, because `Invert` can swap which side actually
    shows the per-shape variety at any time.
- **Images as an alternative to video** in either slot (`aIsImage`/`bIsImage`
  flags). An image is uploaded to its texture once on load, never re-uploaded
  per frame, contributes no duration to recording auto-stop, and is skipped by
  `setPlaying()`/clone creation.
- **Multiple images = per-tile variety instead of video clones.** Dropping
  more than one image on a side (`loadImagesFromFiles`) wrap-fills *all*
  `N_SLOTS` texture slots by cycling through the dropped images (not just as
  many slots as images) — this is required, not cosmetic: an island's group
  index is written once and can be read by *either* side's slot array after
  Invert (see the comment in `updateIslandTexture`), so every slot must hold
  valid content regardless of how many images that particular side has.
  `aImageCount`/`bImageCount` exist only for the dropzone's `+N` badge, not
  for gating group assignment.

## Known browser gotchas already worked around here

- **`file://` blocks `fetch()`/XHR of local files.** Mask presets are inlined
  as literal `<svg>` markup inside each preset `<button>` (not fetched from
  `presets/`), specifically so the app keeps working when opened by
  double-click instead of through a server. Don't reintroduce a `fetch()` for
  anything that needs to work offline.
- **SVG intrinsic sizing.** An `<svg>` with only a `viewBox` (no `width`/
  `height`) can rasterize (`Image().naturalWidth/Height`) inconsistently vs.
  one with explicit dimensions. The displayed preset `<svg>` intentionally has
  no `width`/`height` (so it scales cleanly via CSS in the thumbnail), but
  `loadPresetFromButton()` clones it and adds explicit `width`/`height`
  (derived from the viewBox) before turning it into a mask file — that's what
  keeps rasterization aligned. Don't "simplify" this by adding width/height
  directly to the displayed SVG; it breaks the thumbnail's CSS-driven sizing.
- **`[hidden]` vs. custom `display` rules** need `.dz-preview[hidden] { display:
  none; }` — equal-specificity CSS can otherwise leave a "hidden" preview
  rendering as an empty box.
- **`canvas.captureStream`/`MediaRecorder`** MIME support varies; always go
  through `pickRecorderMime()`'s fallback chain rather than hardcoding a type,
  and never rename `.webm` bytes to a `.mp4` extension.
- **Safari's concurrent video-decode pool is much smaller than Chromium's.**
  `MAX_TEXTURE_IMAGE_UNITS` doesn't capture this — a texture-unit-only cap let
  Safari spin up as many `<video>` clones as Chrome, well past what it can
  decode in hardware, falling back to slow software decode. `isSafari` (UA
  sniffing, checked before `N_SLOTS` is computed) caps it lower and shows a
  small warning banner (`#safari-warning`) over the canvas.

## Testing / verification

This project has no test suite. Verify changes by actually running the app in a
browser:

1. `preview_start` (a `.claude/launch.json` config serves the folder via
   `python3 -m http.server`), then use the Claude Preview MCP tools.
2. For anything involving video/mask files, synthesize test assets in-page via
   `preview_eval` (canvas + `MediaRecorder` for a fake video, inline SVG string
   for a fake mask) rather than relying on real media files — this is the
   pattern used throughout this project's history. Use animated/varying pixel
   content and ≥1s duration; very short/static recordings can produce
   corrupt/near-zero-duration blobs.
2. Check `preview_console_logs` (level: error) after every meaningful
   interaction — this codebase has caught real bugs this way (e.g. an
   `assignRandomGroups` bug that only showed up as a black region, not a
   thrown error).
3. Take a screenshot to confirm the visual result actually matches intent, not
   just "no crash".
4. Always test file:// behavior for anything touching mask loading or presets,
   since that's this app's primary distribution model (see gotchas above).

## Where to track work

- Log newly implemented features in [`CHANGELOG.md`](CHANGELOG.md).
- Log known bugs / requested-but-not-yet-done work in [`BACKLOG.md`](BACKLOG.md).

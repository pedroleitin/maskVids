# Changelog — Mask Vids

History of implemented features, most recent first. The project has no git
history yet, so dates below are approximate (per work session), not release
tags.

## 2026-07-06

- **Configurable output aspect ratio**: new `Auto / 1:1 / 16:9 / 9:16` selector
  in the sidebar. `Auto` keeps the previous behavior (follows the smaller of
  the two loaded sources); the fixed modes crop (fill/cover, never stretch)
  using the first loaded video as the resolution base, reshaped to the chosen
  ratio.
- **Static images in the Video A/B slots**: the Video A and Video B dropzones
  now accept both video and image files (`accept="video/*,image/*"`). An image
  behaves like a single-frame "video": no playback, no time-displacement
  clones, texture uploaded once on load.
- **Fix**: with Time Displacement on, a static-image side could be randomly
  assigned a nonzero time group with no matching clone, showing black instead
  of the image. Fixed by always pinning image-backed sides to group 0 (the
  only slot aliased to the real texture).

## 2026-07-03

- **Mask interpreted by shape, not color**: one shape color = shape-vs-background
  mode (shapes show A, background shows B); two distinct colors = two-color
  mode (first color → A, second → B). Auto-detected, no manual toggle.
- **Clickable mask presets**: 4 thumbnails in the sidebar (a logo, a shapes
  mask, a two-color checker, a single-color checker), inlined as `<svg>`
  directly in the HTML (not fetched) so they keep working when `index.html`
  is opened directly (`file://`), without a server.
- **Time displacement per mask island**: each shape in the mask can show the
  video at a different point in time than the others, creating a temporal
  mosaic effect. A "time groups" slider (2–8) controls how many distinct time
  offsets exist; the effect is independent for Video A and Video B.
- **"Invert mask" renamed to "Invert"**; fixed a bug where inverting during
  time displacement didn't show the effect on the newly-selected video
  (clones were missing for the side that had just become the foreground).
- **Download the mixed output as a video** (MP4 with WebM fallback via
  `MediaRecorder` + `canvas.captureStream`), with bitrate scaled to resolution
  and auto-stop at the longer video's duration.
- **Circular play/pause button** that follows the mouse when hovering the
  output video (replaced the timeline scrubber, which was removed on request).
- **Fixed 16:9 previews** for video/mask thumbnails in the sidebar; removed
  divider lines between sections.

## 2026-07-01

- Initial version: drag-and-drop mask (SVG/image) and two videos (A and B),
  with the mask controlling which video shows where.
- Fill/cover-crop for videos and mask with an aspect ratio different from
  their container (never stretched).
- Visual redesign inspired by [grid.leit.in](https://grid.leit.in/): color
  palette via custom properties, light/dark theme, Outfit typography.
- Videos autoplay as soon as they're dropped, without needing the mask or the
  other video loaded first; removed the audio toggle.
- Entire site translated to English.

# Mask Vids

A single-page, dependency-free WebGL video mixer. Drop two videos (or images) and an
SVG mask, and the mask's *shapes* decide which one shows where — no build step, no
server required.

## Running it

Just double-click `index.html`. Everything (WebGL shaders, UI, file handling) runs
client-side from a single `app.js`, so it works straight from the filesystem
(`file://`) as well as from any static server.

To serve it locally instead (e.g. for testing on other devices on your network):

```bash
python3 -m http.server 8743
```

## How the mask works

The mask is always an **SVG**. Color doesn't matter — only shape does:

- **One shape color** (e.g. black shapes on transparent/white background): the
  shapes reveal **Video A**, the untouched background reveals **Video B**.
- **Two distinct shape colors**: the first color to appear in the SVG document
  reveals **Video A**, the second reveals **Video B**.
- Anything else (0 or 3+ colors, colors that can't be parsed) falls back to the
  one-shape-color behavior.

Four ready-made presets are included as clickable thumbnails (a logo shape, a
shapes-on-background mask, and two checkerboard variants).

## Features

- **Video or image in either slot.** Video A/B dropzones accept video files or
  static images; a static image behaves like a single, non-playing frame.
- **Fill/cover cropping.** Mismatched aspect ratios between mask, Video A, and
  Video B never stretch — each is cropped independently to fill its frame
  (like CSS `object-fit: cover`).
- **Aspect ratio control.** Output frame is `Auto` (follows the smaller of the
  two loaded sources), `1:1`, `16:9`, or `9:16`. Fixed modes still base their
  resolution on the first loaded video, just reshaped to the chosen ratio.
- **Invert.** Swaps which side of the mask shows Video A vs. Video B.
- **Time displacement.** Each shape ("island") in the mask can show the video
  at a different point in time than its neighbors, creating a temporal mosaic
  effect. Adjustable via a "time groups" slider (how many distinct time
  offsets to spread across the islands), independently for Video A and Video B.
- **Playback controls.** A Play/Pause button, plus a circular play/pause button
  that follows the mouse when hovering the output canvas.
- **Download.** Exports the live mix as a video file (`MediaRecorder` +
  `canvas.captureStream`), preferring MP4 and falling back to WebM depending on
  browser support. Resolution matches the current output frame; duration
  auto-stops at the longer of the two source videos.
- **Light/dark theme**, persisted in `localStorage`.

## Project structure

```
index.html   Markup: dropzones, presets, toggles, sidebar, footer controls.
style.css    All styling (CSS custom properties for theming, no framework).
app.js       Entire application logic (single IIFE, no build step).
presets/     Archival copies of the inline SVG mask presets shown in the UI.
```

There is no bundler, package manager, or dependency of any kind — `index.html`
loads `style.css` and `app.js` directly.

## Docs

- [`CLAUDE.md`](CLAUDE.md) — architecture notes and conventions for AI coding agents.
- [`CHANGELOG.md`](CHANGELOG.md) — history of implemented features.
- [`BACKLOG.md`](BACKLOG.md) — known bugs and planned improvements, not yet implemented.

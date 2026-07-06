# Copilot instructions — Mask Vids

Repository-specific conventions for AI code suggestions in this project. See
[`README.md`](README.md) for what the app does and [`CLAUDE.md`](CLAUDE.md) for a
deeper architecture writeup — this file is the short version.

## Constraints

- **No build step, no dependencies.** The app is exactly three files
  (`index.html`, `style.css`, `app.js`) plus static assets. Never suggest
  adding a bundler, package.json, npm package, or framework — it must keep
  running by double-clicking `index.html` from the filesystem.
- **No `fetch()`/XHR of local project files.** The app is opened via `file://`
  as its primary use case, where local fetches are blocked by the browser.
  Anything that must work offline (e.g. mask presets) is inlined directly in
  `index.html`/`app.js`, not loaded from a separate file at runtime.
- **WebGL1 / GLSL ES 1.00 only.** No dynamic sampler-array indexing — texture
  selection is done via unrolled `if/else` chains (`unrolledPick` in `app.js`).
  Keep new shader logic compatible with this.

## Conventions

- All application logic stays in the single IIFE in `app.js`. Don't split it
  into modules or add `<script type="module">` — there's no server guaranteed
  to serve the right MIME types when opened via `file://`.
- Styling uses CSS custom properties (`--c-bg`, `--c-panel`, `--c-text`,
  `--c-accent`, etc., overridden under `[data-theme="dark"]`). Reuse these
  tokens instead of hardcoding colors.
- Comments explain *why*, not *what* — only add one where behavior would
  otherwise be surprising (see the existing comments in `app.js` for the bar
  to match, e.g. around `coverUv`, the island/time-displacement pipeline, and
  the `file://` preset-loading workaround).
- No test suite exists. If you change behavior, it needs to be manually
  verified in a real browser (see `CLAUDE.md`'s "Testing / verification"
  section) — don't mark something done based on it merely compiling/parsing.

## Where to record changes

- Implemented features → [`CHANGELOG.md`](CHANGELOG.md).
- Known bugs / not-yet-done work → [`BACKLOG.md`](BACKLOG.md).

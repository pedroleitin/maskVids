# Backlog — Mask Vids

Known bugs and improvement ideas not yet implemented. Each item has a quick note
on what changes technically, with no commitment to scope until it's actually
discussed/planned. Implemented items get removed from here and get an entry in
[`CHANGELOG.md`](CHANGELOG.md) instead.

- [ ] **Unchecking "Time displacement" resets video playback.**
  Bug to investigate: turning the toggle off calls `cloneManagerA.destroy()` /
  `cloneManagerB.destroy()`, which should only touch their own internal clones,
  not the main `videoA`/`videoB` elements — but in practice playback seems to
  restart. Check whether clone creation/destruction is affecting the original
  elements indirectly (e.g. via a shared `currentSrc`), or whether the "reset"
  is only a visual artifact of the texture switching back to slot 0.

- [ ] **Test Download with the new aspect-ratio crops (1:1, 16:9, 9:16).**
  `startRecording`/`pickBitrate` already use `canvas.width`/`canvas.height`,
  which reflect whichever fixed mode is selected — just needs a real-world
  check that the exported file actually comes out with the correct crop (not
  the "Auto" resolution) for each of the 3 fixed ratios.

- [ ] **Update the aspect ratio when swapping the video already loaded in a slot.**
  `updateOutputResolution()` currently re-runs on the new video's
  `loadedmetadata`, so in "Auto" mode the ratio should follow the swap — needs
  confirmation that this actually happens (and doesn't stay stuck on the
  previous video's ratio) when dropping a new video on top of an already-filled
  slot.

- [ ] **"Clear" button to reset loaded mask/videos.**
  There's currently no way to reset the app without reloading the page. Needs
  to: revoke active `ObjectURL`s, destroy time-displacement clones, empty
  `dz-a`/`dz-b`/`dz-mask` back to their placeholder state, and reset
  `state`/`aIsImage`/`bIsImage`/`islandLabelCache`.

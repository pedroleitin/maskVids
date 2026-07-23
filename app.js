(() => {
  const canvas = document.getElementById('output');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false }) ||
             canvas.getContext('experimental-webgl');
  const statusEl = document.getElementById('status');
  const btnPlayPause = document.getElementById('btn-playpause');
  const btnDownload = document.getElementById('btn-download');
  const downloadLabel = document.getElementById('btn-download-label');
  const hoverPlayBtn = document.getElementById('hover-play-btn');
  const hoverPlayIcon = document.getElementById('hover-play-icon');
  const PLAY_ICON = '<polygon points="6,4 20,12 6,20"/>';
  const PAUSE_ICON = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  const videoA = document.getElementById('preview-a');
  const videoB = document.getElementById('preview-b');
  const imageA = document.getElementById('preview-a-img');
  const imageB = document.getElementById('preview-b-img');

  const state = { mask: null, videoA: false, videoB: false, playing: false, recording: false };
  // Video A/B slots can each hold either a <video> or a static <img> instead —
  // these track which one is currently active per side.
  let aIsImage = false;
  let bIsImage = false;
  // How many images were dropped on an image-mode side (1 = single static
  // image, no per-tile variety; >1 = one of these fills each time-group slot).
  let aImageCount = 0;
  let bImageCount = 0;

  function setPlaying(playing) {
    state.playing = playing;
    if (playing) {
      if (!aIsImage) videoA.play().catch(() => {});
      if (!bIsImage) videoB.play().catch(() => {});
    } else {
      if (!aIsImage) videoA.pause();
      if (!bIsImage) videoB.pause();
    }
    cloneManagerA.setPlaying(playing);
    cloneManagerB.setPlaying(playing);
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
    hoverPlayIcon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  }

  function wireToggle(id, onChange) {
    const btn = document.getElementById(id);
    let checked = false;
    function render() {
      btn.setAttribute('aria-checked', String(checked));
      const thumb = btn.querySelector('.toggle-thumb');
      thumb.style.left = checked ? '20px' : '2px';
      thumb.style.backgroundColor = checked ? 'var(--c-text)' : 'transparent';
      thumb.style.border = checked ? 'none' : '3px solid var(--c-text)';
    }
    btn.addEventListener('click', () => {
      checked = !checked;
      render();
      onChange(checked);
    });
    render();
    return { get checked() { return checked; } };
  }

  const invertToggle = wireToggle('invert-toggle', () => {});

  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const SUN_PATH = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const MOON_PATH = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeIcon.innerHTML = theme === 'dark' ? SUN_PATH : MOON_PATH;
    localStorage.setItem('maskvids-theme', theme);
  }
  applyTheme(localStorage.getItem('maskvids-theme') || 'light');
  themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  // ---------- Time-displacement hardware capability ----------
  // Reserve 1 texture unit for the island-info texture; the rest is split
  // evenly between the Video A and Video B time-shifted slot arrays (both
  // sides can now get per-shape displacement, needed for two-color masks).
  // Safari's concurrent video-decode pool is much smaller than Chromium's —
  // texture units don't capture that limit, so cap it separately there.
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const maxTexUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  const N_SLOTS = Math.max(1, Math.min(isSafari ? 4 : 8, Math.floor((maxTexUnits - 1) / 2)));
  if (isSafari) document.getElementById('safari-warning').hidden = false;
  const timeDisplacementSupported = N_SLOTS >= 2;

  const timeDisplacementToggleBtn = document.getElementById('time-displacement-toggle');
  const timeGroupsRow = document.getElementById('time-groups-row');
  const timeGroupsSlider = document.getElementById('time-groups-slider');
  const timeGroupsValue = document.getElementById('time-groups-value');

  timeGroupsSlider.max = String(N_SLOTS);
  if (Number(timeGroupsSlider.value) > N_SLOTS) timeGroupsSlider.value = String(N_SLOTS);
  timeGroupsValue.textContent = timeGroupsSlider.value;

  if (!timeDisplacementSupported) {
    timeDisplacementToggleBtn.disabled = true;
    timeDisplacementToggleBtn.title = 'Not supported on this device (not enough texture units)';
  }

  function setStatus() {
    btnPlayPause.disabled = !(state.videoA || state.videoB);
    updateDownloadButton();
    if (state.recording) return;
    if (!state.mask || !state.videoA || !state.videoB) {
      const missing = [];
      if (!state.mask) missing.push('mask');
      if (!state.videoA) missing.push('Video A');
      if (!state.videoB) missing.push('Video B');
      statusEl.textContent = 'Missing: ' + missing.join(', ') + '.';
    } else {
      statusEl.textContent = 'Mixing.';
    }
  }

  // ---------- WebGL setup ----------
  const vertexSrc = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      vUv.y = 1.0 - vUv.y;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  function unrolledPick(prefix, nSlots) {
    if (nSlots === 1) return `  color = texture2D(${prefix}0, uv).rgb;`;
    const lines = [];
    for (let i = 0; i < nSlots; i++) {
      if (i === 0) lines.push(`  if (group == 0) { color = texture2D(${prefix}0, uv).rgb; }`);
      else if (i === nSlots - 1) lines.push(`  else { color = texture2D(${prefix}${i}, uv).rgb; }`);
      else lines.push(`  else if (group == ${i}) { color = texture2D(${prefix}${i}, uv).rgb; }`);
    }
    return lines.join('\n');
  }

  function buildFragmentSrc(nSlots) {
    const aDecls = [];
    const bDecls = [];
    for (let i = 0; i < nSlots; i++) {
      aDecls.push(`uniform sampler2D uVideoA${i};`);
      bDecls.push(`uniform sampler2D uVideoB${i};`);
    }
    const groupDenom = Math.max(1, nSlots - 1).toFixed(1);
    return `
      precision mediump float;
      varying vec2 vUv;
      ${aDecls.join('\n      ')}
      ${bDecls.join('\n      ')}
      uniform sampler2D uIslandInfo;
      uniform bool uInvert;
      uniform bool uTimeDisplacement;
      uniform bool uMaskLoaded;
      uniform float uFallbackForeground;
      uniform float uAspectA;
      uniform float uAspectB;
      uniform float uAspectMask;
      uniform float uCanvasAspect;
      uniform bool uPanA;
      uniform bool uPanB;

      vec2 coverUv(vec2 uv, float texAspect, float canvasAspect) {
        vec2 scale = texAspect > canvasAspect
          ? vec2(canvasAspect / texAspect, 1.0)
          : vec2(1.0, texAspect / canvasAspect);
        return (uv - 0.5) * scale + 0.5;
      }

      // For a side with a single static image (nothing to switch between),
      // "displacement" instead pans/zooms the sample window per group, like a
      // displacement map — same image, different crop per island. Zooming in
      // first (0.6) leaves enough margin that the pan offset (±0.175) never
      // reaches outside the original crop.
      vec2 panUv(vec2 uv, int group) {
        float g = float(group) + 1.0;
        float ox = fract(sin(g * 12.9898) * 43758.5453) - 0.5;
        float oy = fract(sin(g * 78.233) * 43758.5453) - 0.5;
        vec2 zoomed = (uv - 0.5) * 0.6 + 0.5;
        return zoomed + vec2(ox, oy) * 0.35;
      }

      vec3 pickA(int group, vec2 uv) {
        vec3 color = vec3(0.0);
        ${unrolledPick('uVideoA', nSlots)}
        return color;
      }

      vec3 pickB(int group, vec2 uv) {
        vec3 color = vec3(0.0);
        ${unrolledPick('uVideoB', nSlots)}
        return color;
      }

      void main() {
        vec2 uvA = coverUv(vUv, uAspectA, uCanvasAspect);
        vec2 uvB = coverUv(vUv, uAspectB, uCanvasAspect);
        vec2 uvMask = coverUv(vUv, uAspectMask, uCanvasAspect);

        // Before a mask is loaded, show whichever video is actually available
        // instead of a black screen while the shader waits for real mask data.
        float isForeground = uFallbackForeground;
        int group = 0;
        if (uMaskLoaded) {
          // R = per-shape time group (only meaningful when uTimeDisplacement is
          // on); shared by both videos since only whichever one a pixel shows
          // (per G) actually reads it. G = 1.0 shows Video A, 0.0 shows Video B.
          vec2 info = texture2D(uIslandInfo, uvMask).rg;
          isForeground = info.g;
          if (uInvert) isForeground = 1.0 - isForeground;
          if (uTimeDisplacement) {
            group = int(info.r * ${groupDenom} + 0.5);
          }
        }

        if (uPanA) uvA = panUv(uvA, group);
        if (uPanB) uvB = panUv(uvB, group);

        vec3 colorA = pickA(group, uvA);
        vec3 colorB = pickB(group, uvB);
        gl_FragColor = vec4(mix(colorB, colorA, isForeground), 1.0);
      }
    `;
  }

  function compileShader(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, buildFragmentSrc(N_SLOTS)));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const uIslandInfo = gl.getUniformLocation(program, 'uIslandInfo');
  const uInvert = gl.getUniformLocation(program, 'uInvert');
  const uTimeDisplacement = gl.getUniformLocation(program, 'uTimeDisplacement');
  const uMaskLoaded = gl.getUniformLocation(program, 'uMaskLoaded');
  const uFallbackForeground = gl.getUniformLocation(program, 'uFallbackForeground');
  const uAspectA = gl.getUniformLocation(program, 'uAspectA');
  const uAspectB = gl.getUniformLocation(program, 'uAspectB');
  const uAspectMask = gl.getUniformLocation(program, 'uAspectMask');
  const uCanvasAspect = gl.getUniformLocation(program, 'uCanvasAspect');
  const uPanA = gl.getUniformLocation(program, 'uPanA');
  const uPanB = gl.getUniformLocation(program, 'uPanB');
  const uVideoASlots = [];
  const uVideoBSlots = [];
  for (let i = 0; i < N_SLOTS; i++) {
    uVideoASlots.push(gl.getUniformLocation(program, `uVideoA${i}`));
    uVideoBSlots.push(gl.getUniformLocation(program, `uVideoB${i}`));
  }

  let CANVAS_ASPECT = 1280 / 720;
  const aspect = { a: CANVAS_ASPECT, b: CANVAS_ASPECT, mask: CANVAS_ASPECT };

  function createTexture(filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));
    return tex;
  }

  const texA = createTexture();
  const texB = createTexture();
  const texIslandInfo = createTexture(gl.NEAREST);

  // Slot 0 on each side reuses the plain video texture (the non-displaced
  // path); slots 1..N_SLOTS-1 are populated by time-shifted clones when
  // that side actually has islands using per-shape displacement.
  const slotTexA = [texA];
  const slotTexB = [texB];
  for (let i = 1; i < N_SLOTS; i++) {
    slotTexA.push(createTexture());
    slotTexB.push(createTexture());
  }

  function resizeCanvasTo(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  // ---------- Time-displacement state ----------
  let timeDisplacementEnabled = false;
  let maskSource = null; // { off, svgText }
  let islandLabelCache = null; // { labels, islandCount, islandVideo, w, h }

  function makeCloneManager(sourceVideo, slotTex) {
    let clones = [];
    function destroy() {
      for (const el of clones) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.remove();
      }
      clones = [];
    }
    // n = number of time groups actually in use (the "Time groups" slider),
    // not N_SLOTS (the hardware-derived max). Only n-1 clones are ever
    // sampled by the shader, so creating more than that just burns decode
    // capacity for nothing — Safari in particular has a low concurrent
    // hardware video-decode limit and falls back to slow software decode
    // past it, which is what made time displacement sluggish there.
    function create(n) {
      destroy();
      const url = sourceVideo.currentSrc || sourceVideo.src;
      if (!url) return;
      for (let i = 1; i < n; i++) {
        const clone = document.createElement('video');
        clone.src = url;
        clone.loop = true;
        clone.muted = true;
        clone.playsInline = true;
        clone.style.display = 'none';
        document.body.appendChild(clone);
        clone.addEventListener('loadedmetadata', () => {
          const dur = clone.duration || 0;
          if (dur > 0) {
            try { clone.currentTime = (i / n) * dur; } catch (e) {}
          }
          if (state.playing) clone.play().catch(() => {});
        }, { once: true });
        clones.push(clone);
      }
    }
    function uploadTextures() {
      for (let i = 0; i < clones.length; i++) {
        const el = clones[i];
        if (el.readyState >= el.HAVE_CURRENT_DATA) {
          gl.bindTexture(gl.TEXTURE_2D, slotTex[i + 1]);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        }
      }
    }
    return {
      create,
      destroy,
      uploadTextures,
      setPlaying(playing) {
        for (const el of clones) {
          if (playing) el.play().catch(() => {});
          else el.pause();
        }
      },
    };
  }

  const cloneManagerA = makeCloneManager(videoA, slotTexA);
  const cloneManagerB = makeCloneManager(videoB, slotTexB);

  // ---------- Island detection (SVG shapes only) ----------
  // Each drawn shape is a candidate "island". A shape whose rendered coverage
  // is ~the whole canvas is treated as a background fill, not an island, so
  // the real background stays untouched. A shape with zero rendered pixels
  // (e.g. fill="none") is skipped entirely.
  function normalizeColor(colorStr) {
    if (!colorStr || colorStr === 'none') return null;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    try {
      ctx.fillStyle = colorStr;
    } catch (e) {
      return null;
    }
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `${r},${g},${b},${a}`;
  }

  // Decides which video each island shows based on its fill color, ignoring
  // color entirely unless the mask uses exactly two distinct shape colors:
  //  - 1 color (or colors couldn't be read): every island shows Video A, the
  //    untouched background shows Video B (shape vs. background mode).
  //  - 2 colors: the first color to appear in the document shows Video A, the
  //    second shows Video B (two-color mode) — the untouched background (if
  //    any) still defaults to Video B.
  //  - 0 or 3+ colors: falls back to shape vs. background mode.
  function assignIslandVideos(islandColors) {
    const islandVideo = new Uint8Array(islandColors.length).fill(1);
    const distinct = [];
    for (const c of islandColors) {
      if (c !== null && !distinct.includes(c)) distinct.push(c);
    }
    if (distinct.length === 2) {
      const videoByColor = new Map([[distinct[0], 1], [distinct[1], 0]]);
      for (let i = 0; i < islandColors.length; i++) {
        const c = islandColors[i];
        islandVideo[i] = c !== null ? videoByColor.get(c) : 1;
      }
    }
    return islandVideo;
  }

  async function labelIslandsSVG(svgText, w, h) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    const allShapes = Array.from(root.querySelectorAll('circle,ellipse,rect,path,polygon,polyline,line'));
    // Exclude shapes that only exist to define a clip-path/mask/pattern/symbol —
    // they aren't actually rendered as visible islands, just referenced by id.
    const candidateShapes = allShapes.filter(el => !el.closest('defs,clipPath,mask,pattern,symbol,marker'));
    const labels = new Int32Array(w * h).fill(-1);
    if (candidateShapes.length === 0) {
      return { labels, islandCount: 0, islandVideo: new Uint8Array(0), w, h };
    }
    const viewBox = root.getAttribute('viewBox');
    const viewBoxAttr = viewBox ? ` viewBox="${viewBox}"` : '';

    let islandCount = 0;
    const islandColors = [];
    for (const shapeEl of candidateShapes) {
      const originalFill = shapeEl.getAttribute('fill');
      const shape = shapeEl.cloneNode(true);
      shape.setAttribute('fill', '#ffffff');
      shape.removeAttribute('stroke');
      const singleSvg = `<svg xmlns="http://www.w3.org/2000/svg"${viewBoxAttr} width="${w}" height="${h}">${shape.outerHTML}</svg>`;
      const blob = new Blob([singleSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = url;
        });
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let covered = 0;
        for (let p = 0; p < w * h; p++) {
          if (data[p * 4 + 3] > 10) covered++;
        }
        if (covered === 0 || covered / (w * h) >= 0.98) continue;
        const idx = islandCount++;
        islandColors.push(normalizeColor(originalFill));
        for (let p = 0; p < w * h; p++) {
          if (data[p * 4 + 3] > 10) labels[p] = idx;
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const islandVideo = assignIslandVideos(islandColors);
    return { labels, islandCount, islandVideo, w, h };
  }

  // Random assignment, re-shuffled every call, works for any number of islands.
  // Draws without replacement from a shuffled pool of group indices so islands
  // only repeat a group once every available slot has been used at least once
  // (e.g. 5 islands / 6 groups always end up 5 distinct groups, not a coin flip).
  function assignRandomGroups(islandCount, n) {
    const islandToGroup = new Int32Array(Math.max(1, islandCount));
    let pool = [];
    for (let i = 0; i < islandCount; i++) {
      if (pool.length === 0) {
        pool = Array.from({ length: n }, (_, k) => k);
        for (let k = pool.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1));
          const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
        }
      }
      islandToGroup[i] = pool.pop();
    }
    return islandToGroup;
  }

  function currentGroupCount() {
    return Math.max(1, Math.min(N_SLOTS, Number(timeGroupsSlider.value)));
  }

  function updateIslandTexture() {
    if (!islandLabelCache) return;
    const n = currentGroupCount();
    const { labels, islandCount, islandVideo, w, h } = islandLabelCache;

    // Bucket the islands mapped to A and the ones mapped to B independently,
    // so each side gets its own well-spread set of random time offsets.
    const aIslands = [];
    const bIslands = [];
    for (let i = 0; i < islandCount; i++) {
      (islandVideo[i] === 1 ? aIslands : bIslands).push(i);
    }
    // An island's group is written once and may end up read by EITHER side's
    // slot array (Invert flips which side every island reads from, globally,
    // at render time) — so it must be valid on both. Image sides handle this
    // by wrap-filling all N_SLOTS with their images (see loadImagesFromFiles),
    // and video sides always create clones for the same shared `n` on both
    // sides, so any group in [0, n) is safe to assign regardless of source.
    const aGroups = timeDisplacementEnabled ? assignRandomGroups(aIslands.length, n) : null;
    const bGroups = timeDisplacementEnabled ? assignRandomGroups(bIslands.length, n) : null;
    const islandToGroup = new Int32Array(Math.max(1, islandCount));
    aIslands.forEach((islandIdx, k) => { islandToGroup[islandIdx] = aGroups ? aGroups[k] : 0; });
    bIslands.forEach((islandIdx, k) => { islandToGroup[islandIdx] = bGroups ? bGroups[k] : 0; });

    const denom = Math.max(1, N_SLOTS - 1);
    const buf = new Uint8Array(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const lbl = labels[p];
      const isFg = lbl >= 0;
      const showsA = isFg && islandVideo[lbl] === 1;
      const group = isFg ? islandToGroup[lbl] : 0;
      buf[p * 4] = Math.round((group / denom) * 255);
      buf[p * 4 + 1] = showsA ? 255 : 0;
      buf[p * 4 + 2] = 0;
      buf[p * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, texIslandInfo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  }

  // Creates/destroys clones for both sides whenever time displacement is on.
  // Both need to be ready even in shape-vs-background (single-color) mode,
  // since toggling Invert can swap which video actually shows the per-shape
  // time variety — without this, the swapped-to side would have no clone
  // textures to sample from.
  function refreshClonesForCurrentMask() {
    if (!islandLabelCache) return;
    // A static image has nothing to time-shift, so it never gets clones.
    if (timeDisplacementEnabled && state.videoA && !aIsImage) cloneManagerA.create(currentGroupCount());
    else cloneManagerA.destroy();
    if (timeDisplacementEnabled && state.videoB && !bIsImage) cloneManagerB.create(currentGroupCount());
    else cloneManagerB.destroy();
  }

  async function processIslandsForCurrentMask() {
    if (!maskSource) return;
    statusEl.textContent = 'Processing mask…';
    islandLabelCache = await labelIslandsSVG(maskSource.svgText, maskSource.off.width, maskSource.off.height);
    updateIslandTexture();
    refreshClonesForCurrentMask();
    setStatus();
  }

  const timeDisplacementToggle = wireToggle('time-displacement-toggle', (checked) => {
    timeDisplacementEnabled = checked;
    timeGroupsRow.hidden = !checked;
    if (checked) {
      updateIslandTexture();
      refreshClonesForCurrentMask();
    } else {
      cloneManagerA.destroy();
      cloneManagerB.destroy();
    }
  });

  timeGroupsSlider.addEventListener('input', () => {
    timeGroupsValue.textContent = timeGroupsSlider.value;
  });
  timeGroupsSlider.addEventListener('change', () => {
    if (timeDisplacementEnabled && islandLabelCache) {
      updateIslandTexture();
      refreshClonesForCurrentMask();
    }
  });

  function render() {
    // Static images are uploaded once when they load (see loadImageFromFile);
    // no need to re-upload every frame like a playing video's changing frames.
    if (!aIsImage && videoA.readyState >= videoA.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, texA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoA);
    }
    if (!bIsImage && videoB.readyState >= videoB.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, texB);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoB);
    }
    cloneManagerA.uploadTextures();
    cloneManagerB.uploadTextures();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texIslandInfo);
    gl.uniform1i(uIslandInfo, 0);

    for (let i = 0; i < N_SLOTS; i++) {
      gl.activeTexture(gl.TEXTURE0 + 1 + i);
      gl.bindTexture(gl.TEXTURE_2D, slotTexA[i]);
      gl.uniform1i(uVideoASlots[i], 1 + i);

      gl.activeTexture(gl.TEXTURE0 + 1 + N_SLOTS + i);
      gl.bindTexture(gl.TEXTURE_2D, slotTexB[i]);
      gl.uniform1i(uVideoBSlots[i], 1 + N_SLOTS + i);
    }

    gl.uniform1i(uInvert, invertToggle.checked ? 1 : 0);
    gl.uniform1i(uTimeDisplacement, timeDisplacementEnabled ? 1 : 0);
    // A single static image has nothing to switch between, so displacement
    // pans/zooms within it instead (see panUv in the shader). A side with
    // multiple images keeps the existing per-tile distinct-image behavior.
    gl.uniform1i(uPanA, timeDisplacementEnabled && aIsImage && aImageCount <= 1 ? 1 : 0);
    gl.uniform1i(uPanB, timeDisplacementEnabled && bIsImage && bImageCount <= 1 ? 1 : 0);
    gl.uniform1i(uMaskLoaded, state.mask ? 1 : 0);
    gl.uniform1f(uFallbackForeground, state.videoA ? 1 : (state.videoB ? 0 : 1));
    gl.uniform1f(uAspectA, aspect.a);
    gl.uniform1f(uAspectB, aspect.b);
    gl.uniform1f(uAspectMask, aspect.mask);
    gl.uniform1f(uCanvasAspect, CANVAS_ASPECT);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  resizeCanvasTo(1280, 720);

  // Output resolution follows the SMALLER of the two sources (no point
  // upscaling past what the smaller one actually has), while recording
  // duration (see startRecording) follows the LONGER of the two videos.
  function dimsA() {
    return aIsImage
      ? { w: imageA.naturalWidth, h: imageA.naturalHeight }
      : { w: videoA.videoWidth, h: videoA.videoHeight };
  }
  function dimsB() {
    return bIsImage
      ? { w: imageB.naturalWidth, h: imageB.naturalHeight }
      : { w: videoB.videoWidth, h: videoB.videoHeight };
  }

  const FIXED_ASPECT_RATIOS = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 };
  let aspectMode = 'auto';

  function updateOutputResolution() {
    const a = dimsA();
    const b = dimsB();
    const hasA = a.w > 0 && a.h > 0;
    const hasB = b.w > 0 && b.h > 0;
    if (!hasA && !hasB) return;

    if (aspectMode === 'auto') {
      let w, h;
      if (hasA && hasB) {
        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        if (areaA <= areaB) { w = a.w; h = a.h; }
        else { w = b.w; h = b.h; }
      } else if (hasA) {
        w = a.w; h = a.h;
      } else {
        w = b.w; h = b.h;
      }
      CANVAS_ASPECT = w / h;
      resizeCanvasTo(w, h);
      return;
    }

    // Fixed ratio: crop-to-fill (handled per-source by coverUv in the shader).
    // The base resolution still comes from the first available video, so we
    // don't downscale/upscale past what the source actually offers.
    const ratio = FIXED_ASPECT_RATIOS[aspectMode];
    const base = hasA ? a : b;
    const longEdge = Math.max(base.w, base.h);
    let w, h;
    if (ratio >= 1) { w = longEdge; h = Math.round(longEdge / ratio); }
    else { h = longEdge; w = Math.round(longEdge * ratio); }
    CANVAS_ASPECT = w / h;
    resizeCanvasTo(w, h);
  }

  document.getElementById('aspect-ratio-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    document.querySelectorAll('#aspect-ratio-group .segment').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
    aspectMode = btn.dataset.aspect;
    updateOutputResolution();
  });

  videoA.addEventListener('loadedmetadata', () => {
    if (aIsImage) return;
    aspect.a = videoA.videoWidth / videoA.videoHeight;
    updateOutputResolution();
  });
  videoB.addEventListener('loadedmetadata', () => {
    if (bIsImage) return;
    aspect.b = videoB.videoWidth / videoB.videoHeight;
    updateOutputResolution();
  });

  // ---------- File loading ----------
  function isSvgFile(file) {
    return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  }

  async function loadMaskFromFile(file) {
    if (!isSvgFile(file)) {
      statusEl.textContent = 'Only SVG files are supported for the mask.';
      return;
    }
    const svgText = await file.text();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.naturalWidth || 512;
      off.height = img.naturalHeight || 512;
      const ctx = off.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, off.width, off.height);
      ctx.drawImage(img, 0, 0, off.width, off.height);
      URL.revokeObjectURL(url);
      aspect.mask = off.width / off.height;

      const preview = document.getElementById('preview-mask');
      preview.src = off.toDataURL();
      preview.hidden = false;
      document.querySelector('#dz-mask .dz-placeholder').hidden = true;
      document.getElementById('dz-mask').classList.add('filled');

      state.mask = true;
      maskSource = { off, svgText };
      setStatus();

      processIslandsForCurrentMask();
    };
    img.onerror = () => {
      statusEl.textContent = 'Could not load that SVG as a mask.';
    };
    img.src = url;
  }

  function isImageFile(file) {
    return file.type.startsWith('image/');
  }

  function loadVideoFromFile(file, videoEl, imgEl, dzId, key, setIsImage) {
    setIsImage(false);
    imgEl.hidden = true;
    imgEl.removeAttribute('src');
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.loop = true;
    videoEl.muted = true;
    videoEl.hidden = false;
    document.querySelector(`#${dzId} .dz-placeholder`).hidden = true;
    document.getElementById(dzId).classList.add('filled');
    videoEl.load();
    videoEl.addEventListener('loadeddata', () => {
      state[key] = true;
      setStatus();
      setPlaying(true);
      if (timeDisplacementEnabled && islandLabelCache) {
        refreshClonesForCurrentMask();
      }
    }, { once: true });
  }

  // coverUv() in the shader crops using ONE aspect ratio per side (aspect.a/
  // aspect.b), applied uniformly to every slot texture of that side — there's
  // no per-slot aspect uniform. So if images 1..N-1 have a different native
  // aspect ratio than image 0 (the one aspect.a/aspect.b gets set from),
  // they'd be cropped with the wrong window and appear shifted inside their
  // tile. Fixed by pre-cropping every image to image 0's aspect ratio here,
  // via canvas 2D, before upload — every slot texture then truly has the
  // aspect the shader assumes, regardless of the source images' own sizes.
  function cropToAspect(img, targetAspect) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const imgAspect = iw / ih;
    let sx, sy, sw, sh;
    if (imgAspect > targetAspect) {
      sh = ih; sw = ih * targetAspect; sx = (iw - sw) / 2; sy = 0;
    } else {
      sw = iw; sh = iw / targetAspect; sx = 0; sy = (ih - sh) / 2;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  // One or more dropped images fill the same time-group slot textures used
  // by video time displacement — image 0 goes in slot 0 (the plain/no-effect
  // path, same as a single static image always did), images 1..N-1 go in the
  // remaining slots instead of being populated by seeked video clones. No
  // playback, no clones: each texture is uploaded once, here, and never again.
  function loadImagesFromFiles(files, videoEl, imgEl, dzId, key, setIsImage, setImageCount) {
    videoEl.pause();
    videoEl.hidden = true;
    videoEl.removeAttribute('src');
    const slotTex = key === 'videoA' ? slotTexA : slotTexB;
    const count = Math.min(files.length, N_SLOTS);
    const urls = files.slice(0, count).map(f => URL.createObjectURL(f));
    Promise.all(urls.map(url => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }))).then((images) => {
      const refAspect = images[0].naturalWidth / images[0].naturalHeight;
      // Wrap-fill every slot (not just the loaded ones) by cycling through
      // the images, so a group index assigned on the OTHER side (see the
      // comment in updateIslandTexture) never lands on an empty texture.
      for (let i = 0; i < N_SLOTS; i++) {
        const source = images[i % images.length];
        const cropped = i === 0 ? source : cropToAspect(source, refAspect);
        gl.bindTexture(gl.TEXTURE_2D, slotTex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cropped);
      }
      urls.slice(1).forEach(URL.revokeObjectURL);

      setIsImage(true);
      setImageCount(count);
      imgEl.src = urls[0];
      imgEl.hidden = false;
      document.querySelector(`#${dzId} .dz-placeholder`).hidden = true;
      document.getElementById(dzId).classList.add('filled');
      const badge = document.getElementById(`${dzId}-badge`);
      if (badge) {
        badge.hidden = count <= 1;
        badge.textContent = '+' + count;
      }

      if (key === 'videoA') aspect.a = images[0].naturalWidth / images[0].naturalHeight;
      else aspect.b = images[0].naturalWidth / images[0].naturalHeight;
      updateOutputResolution();

      state[key] = true;
      setStatus();
      updateIslandTexture();
      refreshClonesForCurrentMask();
    }).catch(() => {
      statusEl.textContent = 'Could not load one of the images.';
    });
  }

  function loadMediaFromFile(files, videoEl, imgEl, dzId, key, setIsImage, setImageCount) {
    if (files.length > 1 && files.every(isImageFile)) {
      loadImagesFromFiles(files, videoEl, imgEl, dzId, key, setIsImage, setImageCount);
    } else if (isImageFile(files[0])) {
      loadImagesFromFiles([files[0]], videoEl, imgEl, dzId, key, setIsImage, setImageCount);
    } else {
      setIsImage(false);
      setImageCount(0);
      const badge = document.getElementById(`${dzId}-badge`);
      if (badge) badge.hidden = true;
      loadVideoFromFile(files[0], videoEl, imgEl, dzId, key, setIsImage);
    }
  }

  function handleDrop(kind, files) {
    if (!files || files.length === 0) return;
    if (kind === 'mask') {
      loadMaskFromFile(files[0]);
    } else if (kind === 'videoA') {
      loadMediaFromFile(files, videoA, imageA, 'dz-a', 'videoA', (v) => { aIsImage = v; }, (n) => { aImageCount = n; });
    } else if (kind === 'videoB') {
      loadMediaFromFile(files, videoB, imageB, 'dz-b', 'videoB', (v) => { bIsImage = v; }, (n) => { bImageCount = n; });
    }
  }

  function wireDropzone(dzId, fileInputId, kind) {
    const dz = document.getElementById(dzId);
    const input = document.getElementById(fileInputId);

    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleDrop(kind, Array.from(input.files)));

    ['dragenter', 'dragover'].forEach(evt =>
      dz.addEventListener(evt, e => {
        e.preventDefault();
        dz.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      dz.addEventListener(evt, e => {
        e.preventDefault();
        dz.classList.remove('dragover');
      })
    );
    dz.addEventListener('drop', e => {
      handleDrop(kind, Array.from(e.dataTransfer.files));
    });
  }

  wireDropzone('dz-mask', 'file-mask', 'mask');
  wireDropzone('dz-a', 'file-a', 'videoA');
  wireDropzone('dz-b', 'file-b', 'videoB');

  // Presets are inlined <svg> markup right inside each button (not fetched
  // from a separate file) so they work even when index.html is opened
  // directly as a local file, where fetch() of local files is blocked.
  // The displayed <svg> intentionally has no width/height attributes (just a
  // viewBox) so it scales cleanly to fit the small thumbnail via CSS. But the
  // mask-loading pipeline reads naturalWidth/naturalHeight off the rasterized
  // image, so a clone with explicit width/height (derived from the viewBox)
  // is what actually gets turned into the mask file — without that, the
  // browser falls back to a default intrinsic size and every shape ends up
  // rasterized at a slightly different, misaligned resolution.
  function loadPresetFromButton(btn) {
    const svgEl = btn.querySelector('svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
      const viewBox = (clone.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      if (viewBox.length === 4) {
        clone.setAttribute('width', String(viewBox[2]));
        clone.setAttribute('height', String(viewBox[3]));
      }
    }
    const svgText = '<?xml version="1.0" encoding="UTF-8"?>' + clone.outerHTML;
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const filename = btn.dataset.presetName || 'preset.svg';
    const file = new File([blob], filename, { type: 'image/svg+xml' });
    handleDrop('mask', [file]);
  }

  document.querySelectorAll('.preset-thumb').forEach(btn => {
    btn.addEventListener('click', () => loadPresetFromButton(btn));
  });

  btnPlayPause.addEventListener('click', () => {
    setPlaying(!state.playing);
  });

  canvas.addEventListener('click', () => {
    if (!btnPlayPause.disabled) setPlaying(!state.playing);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (btnPlayPause.disabled) {
      hoverPlayBtn.classList.remove('visible');
      return;
    }
    hoverPlayBtn.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    hoverPlayBtn.classList.add('visible');
  });

  canvas.addEventListener('mouseleave', () => {
    hoverPlayBtn.classList.remove('visible');
  });

  // ---------- Download ----------
  function pickRecorderMime() {
    const candidates = [
      { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' },
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return null;
  }
  const RECORDER_FORMAT = pickRecorderMime();
  if (!RECORDER_FORMAT) {
    btnDownload.title = "Video export isn't supported in this browser";
  }

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordTimeoutId = null;

  function updateDownloadButton() {
    btnDownload.disabled = !(state.videoA || state.videoB) || !RECORDER_FORMAT;
  }

  // A higher bitrate than the browser default, scaled to the actual output
  // resolution (roughly 0.2 bits/pixel/frame at 30fps), clamped to a sane range.
  function pickBitrate() {
    const raw = canvas.width * canvas.height * 30 * 0.2;
    return Math.round(Math.min(20_000_000, Math.max(2_000_000, raw)));
  }

  function startRecording() {
    const stream = canvas.captureStream(30);
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: RECORDER_FORMAT.mime,
      videoBitsPerSecond: pickBitrate(),
    });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start();
    state.recording = true;
    btnDownload.classList.add('recording');
    downloadLabel.textContent = 'Stop & save';
    statusEl.textContent = RECORDER_FORMAT.ext === 'mp4'
      ? 'Recording… will save as MP4.'
      : 'Recording… will save as WebM (MP4 not supported in this browser).';

    // Auto-stop after the LONGER of the two videos' durations, so the export
    // captures at least one full loop of the longest clip. Falls back to
    // manual stop only (click the button again) if no valid duration exists.
    const durA = isFinite(videoA.duration) ? videoA.duration : 0;
    const durB = isFinite(videoB.duration) ? videoB.duration : 0;
    const recordSeconds = Math.max(durA, durB);
    if (recordSeconds > 0) {
      recordTimeoutId = setTimeout(() => {
        if (state.recording) stopRecording();
      }, recordSeconds * 1000);
    }
  }

  function stopRecording() {
    if (recordTimeoutId) {
      clearTimeout(recordTimeoutId);
      recordTimeoutId = null;
    }
    mediaRecorder.stop();
    state.recording = false;
    btnDownload.classList.remove('recording');
    downloadLabel.textContent = 'Download';
  }

  function saveRecording() {
    const blob = new Blob(recordedChunks, { type: RECORDER_FORMAT.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `mask-vids-${stamp}.${RECORDER_FORMAT.ext}`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    recordedChunks = [];
    setStatus();
  }

  btnDownload.addEventListener('click', () => {
    if (!state.recording) startRecording();
    else stopRecording();
  });

  setStatus();
})();

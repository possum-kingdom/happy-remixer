// Happy Remixer — content script
// Injects (a) a launcher chip, (b) a side-panel composer for input, and
// (c) a TikTok-native fullscreen viewer that renders the remix as a
// native-looking TikTok video: mirrored playback, animated overlays,
// right-side action rail, bottom-left handle/caption/hashtags/music.

(() => {
  if (window.__happyRemixerLoaded) return;
  window.__happyRemixerLoaded = true;

  const PANEL_WIDTH = 380;
  const TAP_GAP_MS = 240;        // single-vs-double tap window

  let host = null;
  let shadow = null;
  let panelOpen = false;
  let viewerOpen = false;
  let currentVideoEl = null;
  let lastUrl = location.href;
  let lastPrompt = '';
  let currentRemix = null;
  let mirrorStream = null;
  let overlayRaf = 0;
  let playPauseInterval = 0;
  let engagementInterval = 0;
  let savedSourceVolume = null;
  let savedSourceMuted = null;
  let mirrorMuted = false;
  let mirrorPausedByUser = false;
  let lastTapAt = 0;
  let pendingSingleTap = 0;
  let suppressNextClick = false;
  let longPressTimer = 0;
  let longPressActive = false;

  // ============================================================
  // Bootstrapping
  // ============================================================

  function isTikTok() {
    return /^https?:\/\/(www\.)?tiktok\.com\//.test(location.href);
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'happy-remixer-root';
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = SHADOW_TEMPLATE;
    wireUp();
  }

  function findVideo() {
    // Pick the largest visible video on the page (works on /@user/video/123,
    // /foryou, /explore, profile pages, embeds — any layout with a player).
    const vids = [...document.querySelectorAll('video')];
    let best = null;
    let bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 200) continue;
      // Must be on-screen-ish
      if (r.bottom < 0 || r.top > innerHeight) continue;
      // Must have decoded
      if (!v.videoWidth) continue;
      const area = r.width * r.height;
      if (area > bestArea) { best = v; bestArea = area; }
    }
    return best;
  }

  function tick() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (panelOpen) togglePanel(false);
      if (viewerOpen) closeViewer();
    }
    if (!isTikTok()) {
      setLauncherVisible(false);
      return;
    }
    ensureHost();
    const v = findVideo();
    if (v) {
      // If the source video swapped while the viewer is open (user navigated
      // to a new video without a URL change), reset the viewer's mirror.
      if (viewerOpen && v !== currentVideoEl) {
        currentVideoEl = v;
        stopMirror();
        startMirror();
      } else {
        currentVideoEl = v;
      }
      setLauncherVisible(true);
    } else {
      setLauncherVisible(false);
    }
  }

  setInterval(tick, 800);
  tick();

  // ============================================================
  // Launcher
  // ============================================================

  function setLauncherVisible(show) {
    if (!shadow) return;
    const l = shadow.getElementById('launcher');
    if (l) l.style.display = show ? 'flex' : 'none';
  }

  // ============================================================
  // Wiring
  // ============================================================

  function wireUp() {
    const launcher = shadow.getElementById('launcher');
    const closeBtn = shadow.getElementById('close-btn');
    const promptInput = shadow.getElementById('prompt-input');
    const sendBtn = shadow.getElementById('send-btn');
    const settingsLink = shadow.getElementById('open-settings');

    launcher.addEventListener('click', () => togglePanel(!panelOpen));
    closeBtn.addEventListener('click', () => togglePanel(false));
    sendBtn.addEventListener('click', () => runRemix(promptInput.value));
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runRemix(promptInput.value);
    });
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'open-options' });
    });

    shadow.querySelectorAll('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const preset = el.getAttribute('data-preset');
        const prompts = {
          captions: 'Generate the catchiest possible caption + 5–6 timed text overlays that hook in the first second.',
          remix: 'Suggest a creative remix concept that flips the video — different angle, parody, or reaction. Caption + overlay script that lands the new angle.',
          edits: 'Suggest concrete edit beats with timestamps as overlays. Each overlay should describe one cut, speed change, zoom, or text reveal.',
          hashtags: 'Pick the strongest 8 hashtags for this video. Caption explains the strategy. Top 3 hashtags should also appear as overlays.',
          voiceover: 'Write a voiceover that completely re-frames the video — same visuals, totally new meaning. Each overlay = one line of voiceover with its timestamp.',
          analyze: 'Analyze this video — what is happening, who is the audience, what makes it work or not. Use overlays to surface the key takeaways.',
        };
        promptInput.value = prompts[preset] || '';
        promptInput.focus();
      });
    });
  }

  function togglePanel(open) {
    panelOpen = open;
    const panel = shadow.getElementById('panel');
    panel.classList.toggle('open', open);
    updateHostPointer();
    if (open) {
      try { currentVideoEl && currentVideoEl.pause(); } catch (_) {}
      hydratePreview();
    }
  }

  function updateHostPointer() {
    if (!host) return;
    host.style.pointerEvents = (panelOpen || viewerOpen) ? 'auto' : 'none';
  }

  function hydratePreview() {
    const meta = shadow.getElementById('meta');
    const c = shadow.getElementById('thumb-canvas');
    if (!currentVideoEl) {
      meta.textContent = 'No video found.';
      return;
    }
    const url = location.href;
    const m = url.match(/\/@([^/]+)\/video\/(\d+)/);
    const author = m ? '@' + m[1] : '—';
    const dur = currentVideoEl.duration;
    meta.innerHTML = `
      <div class="meta-row"><span class="k">creator</span><span class="v">${escapeHtml(author)}</span></div>
      <div class="meta-row"><span class="k">duration</span><span class="v">${isFinite(dur) ? dur.toFixed(1) + 's' : '—'}</span></div>
      <div class="meta-row"><span class="k">size</span><span class="v">${currentVideoEl.videoWidth}×${currentVideoEl.videoHeight}</span></div>
    `;
    const ctx = c.getContext('2d');
    try {
      const ratio = currentVideoEl.videoWidth / currentVideoEl.videoHeight;
      const drawW = c.height * ratio;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(currentVideoEl, (c.width - drawW) / 2, 0, drawW, c.height);
    } catch (e) {
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }

  // ============================================================
  // Frame capture for vision
  // ============================================================

  async function captureFrames(n = 4) {
    if (!currentVideoEl) return [];
    const v = currentVideoEl;
    const dur = isFinite(v.duration) ? v.duration : 5;
    const wasPaused = v.paused;
    const wasMuted = v.muted;
    const t0 = v.currentTime;
    v.muted = true;

    const w = 512;
    const h = Math.round(512 * (v.videoHeight / Math.max(1, v.videoWidth)));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const frames = [];

    for (let i = 0; i < n; i++) {
      const t = (dur * (i + 0.5)) / n;
      try {
        await seek(v, t);
        ctx.drawImage(v, 0, 0, w, h);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
        const b64 = await blobToBase64(blob);
        frames.push({ time: t, data: b64, mediaType: 'image/jpeg' });
      } catch (_) {}
    }
    try { await seek(v, t0); } catch (_) {}
    v.muted = wasMuted;
    if (!wasPaused) { try { await v.play(); } catch (_) {} }
    return frames;
  }

  function seek(video, time) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => { cleanup(); resolve(); };
      const onErr = (e) => { cleanup(); reject(e); };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onErr);
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onErr, { once: true });
      try { video.currentTime = time; } catch (e) { reject(e); }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.slice(r.result.indexOf(',') + 1));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ============================================================
  // Run remix
  // ============================================================

  async function runRemix(prompt) {
    if (!prompt || !prompt.trim()) {
      flashStatus('Type or pick a remix idea first.', 'warn');
      return;
    }
    lastPrompt = prompt;
    const status = shadow.getElementById('status');
    const send = shadow.getElementById('send-btn');
    send.disabled = true;
    status.className = 'status';
    status.innerHTML = '<span class="spinner"></span> Capturing frames…';

    try {
      const frames = await captureFrames(4);
      status.innerHTML = '<span class="spinner"></span> Asking Claude…';
      const meta = {
        url: location.href,
        duration: currentVideoEl?.duration ?? null,
        size: currentVideoEl ? `${currentVideoEl.videoWidth}x${currentVideoEl.videoHeight}` : null,
      };
      const resp = await chrome.runtime.sendMessage({ type: 'remix', prompt, frames, meta });
      if (resp?.error) {
        if (viewerOpen) flashViewerToast('⚠️ ' + resp.error);
        else { status.className = 'status err'; status.textContent = resp.error; }
        return;
      }
      currentRemix = resp.remix;
      status.textContent = '';
      togglePanel(false);
      openViewer(resp.remix);
    } catch (e) {
      const msg = String(e?.message || e);
      if (viewerOpen) flashViewerToast('⚠️ ' + msg);
      else { status.className = 'status err'; status.textContent = msg; }
    } finally {
      send.disabled = false;
    }
  }

  function flashStatus(msg, kind = 'ok') {
    const s = shadow.getElementById('status');
    if (!s) return;
    s.textContent = msg;
    s.className = 'status ' + kind;
    setTimeout(() => { if (s.textContent === msg) s.textContent = ''; }, 2400);
  }

  // ============================================================
  // TikTok-native viewer
  // ============================================================

  function openViewer(remix) {
    if (!remix || !currentVideoEl) return;
    viewerOpen = true;
    mirrorPausedByUser = false;

    // Silence the source so the mirror plays the audio (no doubling).
    try {
      savedSourceVolume = currentVideoEl.volume;
      savedSourceMuted = currentVideoEl.muted;
      currentVideoEl.volume = 0;
      currentVideoEl.muted = true;
    } catch (_) {}

    const v = shadow.getElementById('viewer');
    v.classList.add('open');
    shadow.getElementById('stage').classList.remove('paused');
    updateHostPointer();

    populateInfo(remix);
    buildOverlays(remix);
    startMirror();
    bindViewerEvents();
    startEngagementTicker();
    hideTikTokRail(true);
  }

  function closeViewer() {
    viewerOpen = false;
    const v = shadow.getElementById('viewer');
    v.classList.remove('open');
    stopMirror();
    cancelAnimationFrame(overlayRaf);
    overlayRaf = 0;
    if (playPauseInterval) { clearInterval(playPauseInterval); playPauseInterval = 0; }
    if (engagementInterval) { clearInterval(engagementInterval); engagementInterval = 0; }
    if (pendingSingleTap) { clearTimeout(pendingSingleTap); pendingSingleTap = 0; }

    // Restore source audio.
    try {
      if (currentVideoEl && savedSourceVolume != null) {
        currentVideoEl.volume = savedSourceVolume;
        currentVideoEl.muted = !!savedSourceMuted;
      }
    } catch (_) {}
    savedSourceVolume = null;
    savedSourceMuted = null;

    hideTikTokRail(false);
    updateHostPointer();
  }

  function startEngagementTicker() {
    if (engagementInterval) clearInterval(engagementInterval);
    engagementInterval = setInterval(() => {
      if (!viewerOpen) return;
      bumpCount('v-like-count', 1 + Math.floor(Math.random() * 4));
      if (Math.random() < 0.6) bumpCount('v-comments-count', 1);
      if (Math.random() < 0.45) bumpCount('v-saves-count', 1 + Math.floor(Math.random() * 2));
      if (Math.random() < 0.35) bumpCount('v-shares-count', 1);
    }, 1800);
  }

  function bumpCount(id, by) {
    const el = shadow.getElementById(id);
    if (!el) return;
    const cur = parseHuman(el.textContent);
    el.textContent = humanCount(cur + by);
  }

  function populateInfo(r) {
    shadow.getElementById('v-handle').textContent = r.handle;
    shadow.getElementById('v-caption').textContent = r.caption;
    const tagsEl = shadow.getElementById('v-hashtags');
    tagsEl.innerHTML = '';
    for (const t of r.hashtags) {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = '#' + t;
      tagsEl.appendChild(s);
    }
    shadow.getElementById('v-music-name').textContent = r.music;
    // Seeded engagement varies per remix so nothing feels static.
    const seed = (r.handle + r.caption).split('').reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
    const rnd = (n) => ((seed >> n) & 0xffff) / 0xffff;
    shadow.getElementById('v-like-count').textContent     = humanCount(80_000 + Math.floor(rnd(0)  * 950_000));
    shadow.getElementById('v-comments-count').textContent = humanCount(  900 + Math.floor(rnd(2)  *  18_000));
    shadow.getElementById('v-shares-count').textContent   = humanCount(  400 + Math.floor(rnd(4)  *  12_000));
    shadow.getElementById('v-saves-count').textContent    = humanCount(2_500 + Math.floor(rnd(6)  *  46_000));
    const heart = shadow.getElementById('btn-like');
    heart.classList.remove('liked');
  }

  function buildOverlays(r) {
    const layer = shadow.getElementById('overlay-layer');
    layer.innerHTML = '';
    const overlays = (r.overlays || []).map((o, i) => {
      const el = document.createElement('div');
      el.className = `ov ov-${o.style || 'body'}`;
      // Stagger words for a TikTok-style word-by-word reveal
      const words = String(o.text).split(/\s+/);
      el.innerHTML = words
        .map((w, wi) => `<span class="w" style="--wd:${wi * 60}ms">${escapeHtml(w)}</span>`)
        .join(' ');
      // Rotate placement so they don't all stack
      const positions = ['p-top', 'p-mid', 'p-low', 'p-mid-up'];
      el.classList.add(positions[i % positions.length]);
      layer.appendChild(el);
      return { time: o.time, el };
    });
    // compute end times: until next overlay's time, capped to +2.5s
    for (let i = 0; i < overlays.length; i++) {
      const next = overlays[i + 1];
      const end = next ? Math.min(next.time, overlays[i].time + 2.6) : overlays[i].time + 2.6;
      overlays[i].end = end;
    }
    // start animation loop (also drives the progress bar)
    cancelAnimationFrame(overlayRaf);
    const fill = shadow.getElementById('progress-fill');
    const loop = () => {
      const v = currentVideoEl;
      const t = v?.currentTime ?? 0;
      const dur = v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      for (const o of overlays) {
        const visible = t >= o.time && t < o.end;
        if (visible !== o.el.classList.contains('on')) {
          o.el.classList.toggle('on', visible);
        }
      }
      if (fill) fill.style.transform = `scaleX(${dur ? Math.min(1, t / dur) : 0})`;
      overlayRaf = requestAnimationFrame(loop);
    };
    overlayRaf = requestAnimationFrame(loop);
  }

  function startMirror() {
    const m = shadow.getElementById('mirror');
    m.muted = mirrorMuted;
    try {
      if (typeof currentVideoEl.captureStream === 'function') {
        mirrorStream = currentVideoEl.captureStream();
        m.srcObject = mirrorStream;
      } else if (currentVideoEl.currentSrc) {
        m.src = currentVideoEl.currentSrc;
      }
    } catch (_) {
      try { m.src = currentVideoEl.currentSrc || ''; } catch (_) {}
    }
    // make sure source keeps playing — TikTok may pause when covered
    try { currentVideoEl.play().catch(() => {}); } catch (_) {}
    if (!playPauseInterval) {
      playPauseInterval = setInterval(() => {
        if (!viewerOpen || !currentVideoEl) return;
        if (currentVideoEl.paused && !mirrorPausedByUser) {
          currentVideoEl.play().catch(() => {});
        }
      }, 700);
    }
    try { m.play().catch(() => {}); } catch (_) {}
  }

  function stopMirror() {
    const m = shadow.getElementById('mirror');
    try { m.pause(); } catch (_) {}
    try { m.removeAttribute('src'); m.srcObject = null; m.load(); } catch (_) {}
    if (mirrorStream) {
      try { mirrorStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      mirrorStream = null;
    }
  }

  function bindViewerEvents() {
    const v = shadow.getElementById('viewer');
    const stage = shadow.getElementById('stage');
    const closeBtn = shadow.getElementById('viewer-close');
    closeBtn.onclick = closeViewer;

    // Stage tap handler — single tap = pause/play, double tap = like.
    stage.onclick = (e) => {
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (!currentVideoEl) return;
      const now = Date.now();
      if (now - lastTapAt < TAP_GAP_MS) {
        // double-tap → like, cancel the pending pause/play
        if (pendingSingleTap) { clearTimeout(pendingSingleTap); pendingSingleTap = 0; }
        lastTapAt = 0;
        triggerLike(true, e.clientX, e.clientY);
        spawnFloatingHeart(e.clientX, e.clientY);
        return;
      }
      lastTapAt = now;
      pendingSingleTap = setTimeout(() => {
        pendingSingleTap = 0;
        togglePlayback();
      }, TAP_GAP_MS);
    };

    // Action rail
    shadow.getElementById('btn-like').onclick = (e) => {
      e.stopPropagation();
      triggerLike();
    };
    shadow.getElementById('btn-comment').onclick = (e) => {
      e.stopPropagation();
      showSheet(currentRemix?.summary || 'No notes for this remix.');
    };
    shadow.getElementById('btn-reremix').onclick = (e) => {
      e.stopPropagation();
      reRemixVariant();
    };
    shadow.getElementById('btn-save').onclick = (e) => {
      e.stopPropagation();
      saveRemix();
    };
    shadow.getElementById('btn-music').onclick = (e) => {
      e.stopPropagation();
      flashViewerToast('🎵 ' + (currentRemix?.music || ''));
    };

    // Mute toggle
    shadow.getElementById('btn-mute').onclick = (e) => {
      e.stopPropagation();
      toggleMute();
    };

    // Tap-to-copy on the info row (handle / caption / hashtags / music)
    shadow.getElementById('v-handle').onclick = (e) => {
      e.stopPropagation();
      const t = e.currentTarget.textContent;
      copyText(t);
      flashViewerToast(`Copied ${t} · invented by AI`);
    };
    shadow.getElementById('v-caption').onclick = (e) => {
      e.stopPropagation();
      copyText(e.currentTarget.textContent);
      flashViewerToast('Copied caption');
    };
    shadow.getElementById('v-hashtags').onclick = (e) => {
      e.stopPropagation();
      const tag = e.target.closest('.tag');
      if (tag) {
        copyText(tag.textContent);
        flashViewerToast(`Copied ${tag.textContent}`);
      } else {
        const all = currentRemix?.hashtags?.map((h) => '#' + h).join(' ') || '';
        if (all) { copyText(all); flashViewerToast('Copied all hashtags'); }
      }
    };

    // Long-press the stage = 2× speed (TikTok native)
    bindLongPress(stage);

    // Sheet close
    shadow.getElementById('sheet-close').onclick = (e) => {
      e.stopPropagation();
      shadow.getElementById('sheet').classList.remove('open');
    };

    // Keyboard + swipe (only bind once)
    if (!v.__keysBound) {
      v.__keysBound = true;
      document.addEventListener('keydown', (e) => {
        if (!viewerOpen) return;
        switch (e.key) {
          case 'Escape': closeViewer(); break;
          case ' ':
            e.preventDefault();
            togglePlayback();
            break;
          case 'ArrowUp':
            e.preventDefault();
            reRemixVariant();
            break;
          case 'm': case 'M':
            toggleMute();
            break;
          case 'l': case 'L':
            triggerLike(true);
            break;
        }
      });
      // Wheel-swipe up to re-remix
      v.addEventListener('wheel', (e) => {
        if (!viewerOpen) return;
        if (e.deltaY < -45) {
          if (Date.now() - (v.__lastWheelAt || 0) > 800) {
            v.__lastWheelAt = Date.now();
            reRemixVariant();
          }
        }
      }, { passive: true });
    }
  }

  function bindLongPress(stage) {
    if (stage.__lpBound) return;
    stage.__lpBound = true;

    const start = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressActive = false;
      longPressTimer = setTimeout(() => {
        longPressTimer = 0;
        longPressActive = true;
        if (currentVideoEl) currentVideoEl.playbackRate = 2;
        stage.classList.add('fast');
      }, 280);
    };
    const end = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = 0; }
      if (longPressActive) {
        longPressActive = false;
        if (currentVideoEl) currentVideoEl.playbackRate = 1;
        stage.classList.remove('fast');
        suppressNextClick = true;
      }
    };

    stage.addEventListener('mousedown', start);
    stage.addEventListener('mouseup', end);
    stage.addEventListener('mouseleave', end);
    stage.addEventListener('touchstart', start, { passive: true });
    stage.addEventListener('touchend', end);
    stage.addEventListener('touchcancel', end);
  }

  function copyText(text) {
    try { navigator.clipboard.writeText(text); } catch (_) {}
  }

  function togglePlayback() {
    if (!currentVideoEl) return;
    const stage = shadow.getElementById('stage');
    if (currentVideoEl.paused) {
      mirrorPausedByUser = false;
      currentVideoEl.play().catch(() => {});
      stage.classList.remove('paused');
    } else {
      mirrorPausedByUser = true;
      currentVideoEl.pause();
      stage.classList.add('paused');
    }
  }

  function triggerLike(forceLike = false, _x, _y) {
    const btn = shadow.getElementById('btn-like');
    const cur = btn.classList.contains('liked');
    const wantLiked = forceLike ? true : !cur;
    btn.classList.toggle('liked', wantLiked);
    const c = shadow.getElementById('v-like-count');
    const base = parseHuman(c.textContent);
    c.textContent = humanCount(wantLiked === cur ? base : (wantLiked ? base + 1 : base - 1));
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  }

  function spawnFloatingHeart(clientX, clientY) {
    const layer = shadow.getElementById('hearts-layer');
    if (!layer) return;
    // Hearts are positioned inside hearts-layer, so use ITS rect — not the stage's,
    // because hearts-layer is centered with width: min(420px, 100vw).
    const r = layer.getBoundingClientRect();
    const x = (clientX ?? r.left + r.width / 2) - r.left;
    const y = (clientY ?? r.top + r.height / 2) - r.top;
    // Clamp inside the layer so the heart doesn't drift off if the click was outside it.
    const cx = Math.max(28, Math.min(r.width - 28, x));
    const cy = Math.max(28, Math.min(r.height - 28, y));
    const h = document.createElement('div');
    h.className = 'fheart';
    h.style.left = cx + 'px';
    h.style.top = cy + 'px';
    h.style.setProperty('--rot', (Math.random() * 50 - 25) + 'deg');
    h.innerHTML = `<svg viewBox="0 0 32 32" width="68" height="68"><path d="M16 27s-9-5.7-12.4-11.6C1 10.6 4 5 9 5c3 0 5 2 7 4 2-2 4-4 7-4 5 0 8 5.6 5.4 10.4C25 21.3 16 27 16 27z" fill="#ff0050"/></svg>`;
    layer.appendChild(h);
    setTimeout(() => h.remove(), 1100);
  }

  function toggleMute() {
    const m = shadow.getElementById('mirror');
    mirrorMuted = !mirrorMuted;
    try { m.muted = mirrorMuted; } catch (_) {}
    shadow.getElementById('btn-mute').classList.toggle('muted', mirrorMuted);
  }

  function reRemixVariant() {
    if (!lastPrompt) {
      flashViewerToast('No prompt to re-remix.');
      return;
    }
    flashViewerToast('Remixing again…');
    runRemix(lastPrompt + '\n\n(Give me a different angle than before.)');
  }

  function showSheet(text) {
    const s = shadow.getElementById('sheet');
    shadow.getElementById('sheet-body').textContent = text;
    s.classList.add('open');
  }

  function saveRemix() {
    if (!currentRemix) return;
    const md = renderRemixMarkdown(currentRemix, lastPrompt);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remix-${Date.now()}.md`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    flashViewerToast('Saved as Markdown');
  }

  function flashViewerToast(text) {
    const t = shadow.getElementById('music-toast');
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  function renderRemixMarkdown(r, prompt) {
    const lines = [];
    lines.push(`# ${r.handle}`);
    lines.push('');
    lines.push(`> ${prompt}`);
    lines.push('');
    lines.push(`**Caption:** ${r.caption}`);
    lines.push('');
    lines.push(`**Hashtags:** ${r.hashtags.map((h) => '#' + h).join(' ')}`);
    lines.push('');
    lines.push(`**Music:** ${r.music}`);
    lines.push('');
    lines.push('## Overlays');
    for (const o of r.overlays) {
      lines.push(`- \`${o.time.toFixed(2)}s\` (${o.style}) — ${o.text}`);
    }
    if (r.summary) {
      lines.push('');
      lines.push('## Notes');
      lines.push(r.summary);
    }
    return lines.join('\n');
  }

  // ============================================================
  // Hide TikTok's own action rail while our viewer is open so the
  // page chrome doesn't bleed through. (Best-effort; selectors drift.)
  // ============================================================

  let pageHidden = false;
  function hideTikTokRail(hide) {
    if (hide === pageHidden) return;
    pageHidden = hide;
    document.documentElement.classList.toggle('happy-remixer-blackout', hide);
  }

  // Inject a tiny page stylesheet for blackout mode
  (function injectPageStyles() {
    const s = document.createElement('style');
    s.textContent = `
      html.happy-remixer-blackout body { overflow: hidden !important; }
    `;
    document.documentElement.appendChild(s);
  })();

  // ============================================================
  // Helpers
  // ============================================================

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function humanCount(n) {
    n = Math.max(0, Math.round(n));
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(n);
  }
  function parseHuman(s) {
    s = String(s).trim();
    const m = s.match(/^([\d.]+)([KM])?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = (m[2] || '').toUpperCase();
    return Math.round(n * (u === 'M' ? 1e6 : u === 'K' ? 1e3 : 1));
  }

  // ============================================================
  // Shadow DOM template
  // ============================================================

  const SHADOW_CSS = `
    :host, * { box-sizing: border-box; }

    /* ======= Launcher ======= */
    #launcher {
      position: fixed; right: 22px; bottom: 22px;
      display: flex; align-items: center; gap: 8px;
      padding: 11px 16px 11px 13px; border: none;
      background: linear-gradient(135deg, #ff0050 0%, #8a2be2 100%);
      color: white; border-radius: 999px;
      font: 600 14px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      letter-spacing: -0.01em;
      box-shadow: 0 8px 22px rgba(255, 0, 80, 0.35), 0 2px 6px rgba(0,0,0,0.2);
      cursor: pointer; user-select: none;
      pointer-events: auto;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #launcher:hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 12px 28px rgba(255, 0, 80, 0.45); }
    #launcher:active { transform: translateY(0) scale(0.98); }

    /* ======= Composer side panel ======= */
    #panel {
      position: fixed; top: 14px; right: 14px; bottom: 14px;
      width: ${PANEL_WIDTH}px; max-width: calc(100vw - 28px);
      background: rgba(20, 20, 24, 0.78);
      backdrop-filter: blur(28px) saturate(160%);
      -webkit-backdrop-filter: blur(28px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3);
      color: #f3f3f5;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      transform: translateX(calc(100% + 24px));
      transition: transform .35s cubic-bezier(0.2, 0.8, 0.25, 1);
      display: flex; flex-direction: column;
      overflow: hidden;
      pointer-events: auto;
    }
    #panel.open { transform: translateX(0); }
    header.head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo {
      width: 28px; height: 28px; border-radius: 8px;
      background: conic-gradient(from 220deg, #ff0050, #ff6b00, #8a2be2, #ff0050);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
    }
    .title .t1 { font-weight: 700; letter-spacing: -0.01em; }
    .title .t2 { font-size: 11.5px; opacity: 0.6; margin-top: 1px; }
    #close-btn {
      width: 28px; height: 28px; border-radius: 8px;
      border: none; background: rgba(255,255,255,0.06); color: #f3f3f5;
      cursor: pointer; display: grid; place-items: center;
    }
    #close-btn:hover { background: rgba(255,255,255,0.12); }
    .preview { padding: 14px 16px 8px; }
    #thumb-canvas {
      width: 100%; height: auto; aspect-ratio: 16/9;
      border-radius: 12px; background: #0b0b0d;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .meta { margin-top: 10px; display: grid; gap: 4px; }
    .meta-row { display: flex; justify-content: space-between; font-size: 12px; }
    .meta-row .k { opacity: 0.55; }
    .meta-row .v { font-variant-numeric: tabular-nums; opacity: 0.95; }
    .presets { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px 4px; }
    .chip {
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04); color: #f3f3f5;
      padding: 6px 10px; border-radius: 999px;
      font: 600 12px/1 inherit; letter-spacing: -0.005em; cursor: pointer;
      transition: background .12s ease, border-color .12s ease;
    }
    .chip:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.18); }
    .composer { padding: 10px 16px 12px; }
    #prompt-input {
      width: 100%; min-height: 70px; resize: vertical;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; padding: 10px 12px;
      color: #f3f3f5; font: inherit; outline: none;
    }
    #prompt-input:focus { border-color: rgba(255, 0, 80, 0.55); box-shadow: 0 0 0 4px rgba(255, 0, 80, 0.12); }
    .composer-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
    .primary {
      background: linear-gradient(135deg, #ff0050 0%, #8a2be2 100%);
      color: white; border: none;
      padding: 9px 16px; border-radius: 10px;
      font: 600 13px/1 inherit; cursor: pointer;
      box-shadow: 0 4px 14px rgba(255, 0, 80, 0.35);
    }
    .primary:hover { filter: brightness(1.05); }
    .primary:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
    .status { padding: 6px 16px 18px; font-size: 12.5px; min-height: 22px; opacity: 0.85; }
    .status.err { color: #ff8a96; opacity: 1; }
    .status.warn { color: #ffd479; opacity: 1; }
    .spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.18);
      border-top-color: #ff0050; animation: spin 0.7s linear infinite;
      display: inline-block; vertical-align: -2px; margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: #ff8aa3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { opacity: 0.55; font-size: 12.5px; }

    /* ======= TikTok-native viewer ======= */
    #viewer {
      position: fixed; inset: 0;
      background: #000;
      opacity: 0; visibility: hidden;
      transition: opacity .25s ease;
      pointer-events: none;
      color: #fff;
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    }
    #viewer.open { opacity: 1; visibility: visible; pointer-events: auto; }

    #stage {
      position: absolute; inset: 0;
      display: grid; place-items: center;
      cursor: pointer;
    }
    #mirror {
      max-height: 100%;
      max-width: min(420px, 100vw);
      aspect-ratio: 9/16;
      width: auto; height: 100%;
      object-fit: cover;
      border-radius: 0;
      background: #111;
      box-shadow: 0 30px 80px rgba(0,0,0,0.7);
    }
    @media (min-width: 700px) {
      #mirror {
        height: calc(100vh - 32px); max-height: calc(100vh - 32px);
        border-radius: 14px;
      }
    }

    #stage.paused::after {
      content: "";
      position: absolute; left: 50%; top: 50%;
      width: 88px; height: 88px;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.45);
      border-radius: 50%;
      backdrop-filter: blur(8px);
    }
    #stage.paused::before {
      content: "";
      position: absolute; left: 50%; top: 50%;
      width: 0; height: 0;
      transform: translate(-30%, -50%);
      border-left: 22px solid white;
      border-top: 14px solid transparent;
      border-bottom: 14px solid transparent;
      z-index: 2;
    }

    /* close button */
    #viewer-close {
      position: absolute; top: 14px; left: 14px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(8px);
      border: none; color: #fff; cursor: pointer;
      display: grid; place-items: center;
      z-index: 10;
    }
    #viewer-close:hover { background: rgba(255,255,255,0.22); }

    /* overlay caption layer (centered on stage) */
    #overlay-layer {
      position: absolute;
      left: 50%; top: 0; bottom: 0;
      transform: translateX(-50%);
      width: min(420px, 100vw);
      pointer-events: none;
      overflow: hidden;
    }
    @media (min-width: 700px) {
      #overlay-layer { height: calc(100vh - 32px); top: 16px; bottom: 16px; }
    }

    .ov {
      position: absolute; left: 50%;
      transform: translate(-50%, 8px);
      max-width: 90%;
      text-align: center;
      color: #fff;
      text-shadow: 0 1px 0 rgba(0,0,0,0.45), 0 4px 18px rgba(0,0,0,0.55);
      letter-spacing: -0.005em;
      opacity: 0;
      transition: opacity .25s ease, transform .35s cubic-bezier(0.2, 0.8, 0.25, 1);
    }
    .ov.on { opacity: 1; transform: translate(-50%, 0); }
    .ov .w {
      display: inline-block;
      transform: translateY(8px) scale(0.9);
      opacity: 0;
      transition: transform .35s cubic-bezier(0.2, 0.8, 0.25, 1),
                  opacity .35s ease;
      transition-delay: var(--wd, 0ms);
      margin: 0 0.18em;
    }
    .ov.on .w { transform: translateY(0) scale(1); opacity: 1; }
    .ov-title { font-weight: 800; font-size: 36px; line-height: 1.05; }
    .ov-body { font-weight: 700; font-size: 24px; line-height: 1.1; }
    .ov-subtitle { font-weight: 600; font-size: 18px; line-height: 1.15; opacity: 0.95; }
    .ov-emoji { font-size: 64px; line-height: 1; }
    .ov.p-top { top: 14%; }
    .ov.p-mid-up { top: 30%; }
    .ov.p-mid { top: 44%; }
    .ov.p-low { top: 62%; }

    /* right-side action rail */
    #rail {
      position: absolute; right: 12px; bottom: 80px;
      display: flex; flex-direction: column; gap: 18px;
      z-index: 5;
    }
    @media (min-width: 700px) {
      #rail {
        right: calc(50vw - 230px);
        bottom: 60px;
      }
    }
    .rail-btn {
      background: transparent; border: none; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      color: #fff;
      font: 600 12px/1 inherit;
    }
    .rail-btn .icon-bg {
      width: 48px; height: 48px; border-radius: 50%;
      background: rgba(0,0,0,0.28);
      backdrop-filter: blur(6px);
      display: grid; place-items: center;
      transition: transform .15s ease, background .15s ease;
    }
    .rail-btn:hover .icon-bg { background: rgba(0,0,0,0.45); transform: scale(1.04); }
    .rail-btn.pop .icon-bg { animation: pop .35s cubic-bezier(0.2, 0.8, 0.25, 1); }
    @keyframes pop {
      0%   { transform: scale(0.7); }
      60%  { transform: scale(1.18); }
      100% { transform: scale(1); }
    }
    .rail-btn.liked .icon-bg svg path { fill: #ff0050; stroke: #ff0050; }
    .rail-btn .label { font-size: 11.5px; opacity: 0.95; }

    /* music disc spinning */
    .music-btn .icon-bg {
      background: linear-gradient(135deg, #2a1c1f, #1a1014);
      animation: spin-slow 6s linear infinite;
    }
    @keyframes spin-slow { to { transform: rotate(360deg); } }
    .music-btn:hover .icon-bg { animation-play-state: running; }

    /* bottom-left info */
    #info {
      position: absolute; left: 12px; bottom: 22px;
      max-width: min(360px, calc(100vw - 100px));
      z-index: 5;
      display: flex; flex-direction: column; gap: 6px;
      text-shadow: 0 1px 0 rgba(0,0,0,0.4), 0 2px 12px rgba(0,0,0,0.45);
    }
    @media (min-width: 700px) {
      #info { left: calc(50vw - 200px); }
    }
    #v-handle {
      font-weight: 700; letter-spacing: -0.01em; font-size: 15.5px;
    }
    #v-caption {
      font-size: 14px; line-height: 1.3;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    #v-hashtags { display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .tag {
      font-size: 13.5px; opacity: 0.95;
      color: #fff;
    }
    #v-music {
      display: flex; align-items: center; gap: 6px;
      font-size: 12.5px; opacity: 0.92;
      margin-top: 2px;
    }
    #v-music svg { flex: 0 0 auto; }
    #v-music-name {
      white-space: nowrap; overflow: hidden;
      max-width: 250px; text-overflow: ellipsis;
    }

    /* mute button (top-right) */
    #btn-mute {
      position: absolute; top: 14px; right: 14px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(0,0,0,0.32);
      backdrop-filter: blur(8px);
      border: none; color: #fff; cursor: pointer;
      display: grid; place-items: center;
      z-index: 10;
    }
    #btn-mute:hover { background: rgba(0,0,0,0.5); }
    #btn-mute .ic-off { display: none; }
    #btn-mute.muted .ic-on { display: none; }
    #btn-mute.muted .ic-off { display: block; }

    /* floating hearts on double-tap */
    #hearts-layer {
      position: absolute; left: 50%; top: 0; bottom: 0;
      transform: translateX(-50%);
      width: min(420px, 100vw);
      pointer-events: none;
      overflow: hidden;
      z-index: 8;
    }
    @media (min-width: 700px) {
      #hearts-layer { height: calc(100vh - 32px); top: 16px; bottom: 16px; }
    }
    .fheart {
      position: absolute;
      transform: translate(-50%, -50%) scale(0) rotate(var(--rot, 0deg));
      animation: fheart 1s cubic-bezier(0.2, 0.8, 0.25, 1) forwards;
      filter: drop-shadow(0 4px 14px rgba(255, 0, 80, 0.5));
    }
    @keyframes fheart {
      0%   { transform: translate(-50%, -50%) scale(0)   rotate(var(--rot, 0deg)); opacity: 0; }
      18%  { transform: translate(-50%, -50%) scale(1.2) rotate(var(--rot, 0deg)); opacity: 1; }
      35%  { transform: translate(-50%, -50%) scale(1.0) rotate(var(--rot, 0deg)); opacity: 1; }
      100% { transform: translate(-50%, -130%) scale(0.85) rotate(var(--rot, 0deg)); opacity: 0; }
    }

    /* progress bar (bottom of stage) */
    #progress {
      position: absolute;
      left: 50%;
      bottom: 0;
      width: min(420px, 100vw);
      height: 3px;
      background: rgba(255,255,255,0.18);
      transform: translateX(-50%);
      z-index: 6;
    }
    @media (min-width: 700px) {
      #progress {
        bottom: 16px;
        border-radius: 0 0 14px 14px;
      }
    }
    #progress-fill {
      width: 100%; height: 100%;
      background: linear-gradient(90deg, #ff0050, #ff6b00);
      transform-origin: left center;
      transform: scaleX(0);
    }

    /* 2× speed badge (long-press) */
    #speed-badge {
      position: absolute;
      top: 56px; left: 50%;
      transform: translateX(-50%) translateY(-8px) scale(0.92);
      background: rgba(0,0,0,0.62);
      backdrop-filter: blur(8px);
      color: #fff;
      padding: 6px 14px; border-radius: 999px;
      font: 700 13px/1 inherit;
      letter-spacing: 0.02em;
      opacity: 0;
      transition: opacity .15s ease, transform .2s cubic-bezier(0.2, 0.8, 0.25, 1);
      pointer-events: none;
      z-index: 11;
    }
    #stage.fast ~ #speed-badge {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }

    /* tappable info row */
    #v-handle, #v-caption, .tag { cursor: pointer; }
    #v-handle:active, #v-caption:active, .tag:active { opacity: 0.7; }

    /* sheet (for "comments"/notes) */
    #sheet {
      position: absolute; left: 0; right: 0; bottom: 0;
      max-height: 60%;
      background: rgba(28, 28, 32, 0.96);
      backdrop-filter: blur(28px) saturate(160%);
      border-top: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px 18px 0 0;
      transform: translateY(100%);
      transition: transform .3s cubic-bezier(0.2, 0.8, 0.25, 1);
      padding: 14px 18px 22px;
      z-index: 6;
      color: #f3f3f5;
      overflow-y: auto;
    }
    #sheet.open { transform: translateY(0); }
    #sheet-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
    }
    #sheet-head .h {
      font-weight: 700; letter-spacing: -0.01em;
    }
    #sheet-close {
      background: rgba(255,255,255,0.08); border: none; color: #fff;
      width: 28px; height: 28px; border-radius: 50%;
      cursor: pointer;
      display: grid; place-items: center;
    }
    #sheet-body {
      font-size: 14px; line-height: 1.55;
      white-space: pre-wrap;
      opacity: 0.95;
    }

    /* music toast */
    #music-toast {
      position: absolute; left: 50%; top: 24px;
      transform: translateX(-50%) translateY(-12px);
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(8px);
      padding: 8px 14px; border-radius: 999px;
      font-size: 13px;
      opacity: 0; transition: opacity .25s ease, transform .25s ease;
      pointer-events: none;
      z-index: 12;
      color: #fff;
    }
    #music-toast.show {
      opacity: 1; transform: translateX(-50%) translateY(0);
    }
  `;

  // SVG icon helpers (so we can keep markup tidy)
  const SVG_HEART = `<svg viewBox="0 0 32 32" width="26" height="26"><path d="M16 27s-9-5.7-12.4-11.6C1 10.6 4 5 9 5c3 0 5 2 7 4 2-2 4-4 7-4 5 0 8 5.6 5.4 10.4C25 21.3 16 27 16 27z" fill="#fff" stroke="#fff" stroke-width="0"/></svg>`;
  const SVG_COMMENT = `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#fff" stroke-width="2.2"><path d="M27 18.5c0 5-4.9 9-11 9-1.7 0-3.3-.3-4.7-.8L5 28l1.3-5.4C5.5 21 5 19.5 5 18c0-5 4.9-9 11-9s11 4 11 9z"/></svg>`;
  const SVG_REREMIX = `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 7l4 4-4 4"/><path d="M26 11H10a6 6 0 0 0-6 6"/><path d="M10 25l-4-4 4-4"/><path d="M6 21h16a6 6 0 0 0 6-6"/></svg>`;
  const SVG_SAVE = `<svg viewBox="0 0 32 32" width="26" height="26" fill="#fff"><path d="M9 5h14v22l-7-4-7 4z"/></svg>`;
  const SVG_MUSIC = `<svg viewBox="0 0 32 32" width="22" height="22" fill="#fff"><path d="M22 4l-9 2v13.2A4.5 4.5 0 1 0 15 23V11l7-1.6V18.2A4.5 4.5 0 1 0 24 22V4z"/></svg>`;
  const SVG_MUSIC_SMALL = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" opacity=".95"><path d="M11 2l-5 1v8.2A2.4 2.4 0 1 0 7 13V6l3-.6V9.7A2.4 2.4 0 1 0 12 12V2z"/></svg>`;
  const SVG_CLOSE = `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const SVG_SMILEY = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#fff"/>
    <circle cx="8.6" cy="10" r="1.5" fill="#1a1410"/>
    <circle cx="15.4" cy="10" r="1.5" fill="#1a1410"/>
    <path d="M7.6 13.6 Q12 18.3 16.4 13.6" stroke="#1a1410" stroke-width="1.7" fill="none" stroke-linecap="round"/>
  </svg>`;

  const SHADOW_TEMPLATE = `
    <style>${SHADOW_CSS}</style>

    <button id="launcher" title="Remix with AI">${SVG_SMILEY}<span>Remix</span></button>

    <aside id="panel" aria-label="Happy Remixer composer">
      <header class="head">
        <div class="brand">
          <div class="logo"></div>
          <div class="title">
            <div class="t1">Happy Remixer</div>
            <div class="t2">remix this video with AI</div>
          </div>
        </div>
        <button id="close-btn" aria-label="Close" title="Close">${SVG_CLOSE}</button>
      </header>

      <section class="preview">
        <canvas id="thumb-canvas" width="380" height="214"></canvas>
        <div id="meta" class="meta"></div>
      </section>

      <section class="presets">
        <button class="chip" data-preset="captions">Captions</button>
        <button class="chip" data-preset="remix">Remix concept</button>
        <button class="chip" data-preset="edits">Edit ideas</button>
        <button class="chip" data-preset="hashtags">Hashtags</button>
        <button class="chip" data-preset="voiceover">New voiceover</button>
        <button class="chip" data-preset="analyze">Analyze</button>
      </section>

      <section class="composer">
        <textarea id="prompt-input" placeholder="What do you want to remix? (⌘↩ to send)"></textarea>
        <div class="composer-row">
          <a href="#" id="open-settings" class="muted">Settings</a>
          <button id="send-btn" class="primary">Remix ✨</button>
        </div>
      </section>

      <section class="status" id="status"></section>
    </aside>

    <!-- TikTok-native fullscreen viewer -->
    <section id="viewer" aria-label="Remix viewer">
      <div id="stage">
        <video id="mirror" playsinline autoplay></video>
      </div>

      <div id="overlay-layer"></div>
      <div id="hearts-layer"></div>
      <div id="speed-badge">2× speed</div>

      <button id="viewer-close" aria-label="Close" title="Close (Esc)">${SVG_CLOSE}</button>
      <button id="btn-mute" aria-label="Mute" title="Mute (M)">
        <svg class="ic-on" viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 8a5 5 0 0 1 0 8" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
        <svg class="ic-off" viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 8l6 8M22 8l-6 8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>

      <div id="progress"><div id="progress-fill"></div></div>

      <div id="rail">
        <button class="rail-btn" id="btn-like" aria-label="Like">
          <span class="icon-bg">${SVG_HEART}</span>
          <span class="label" id="v-like-count">0</span>
        </button>
        <button class="rail-btn" id="btn-comment" aria-label="Notes">
          <span class="icon-bg">${SVG_COMMENT}</span>
          <span class="label" id="v-comments-count">0</span>
        </button>
        <button class="rail-btn" id="btn-reremix" aria-label="Re-remix">
          <span class="icon-bg">${SVG_REREMIX}</span>
          <span class="label">remix</span>
        </button>
        <button class="rail-btn" id="btn-save" aria-label="Save">
          <span class="icon-bg">${SVG_SAVE}</span>
          <span class="label" id="v-saves-count">0</span>
        </button>
        <button class="rail-btn music-btn" id="btn-music" aria-label="Music">
          <span class="icon-bg">${SVG_MUSIC}</span>
          <span class="label">sound</span>
        </button>
      </div>

      <div id="info">
        <div id="v-handle"></div>
        <div id="v-caption"></div>
        <div id="v-hashtags"></div>
        <div id="v-music">${SVG_MUSIC_SMALL}<span id="v-music-name"></span></div>
      </div>

      <aside id="sheet" aria-label="Remix notes">
        <div id="sheet-head">
          <div class="h">Notes</div>
          <button id="sheet-close" aria-label="Close">${SVG_CLOSE}</button>
        </div>
        <div id="sheet-body"></div>
      </aside>

      <div id="music-toast"></div>
    </section>
  `;
})();

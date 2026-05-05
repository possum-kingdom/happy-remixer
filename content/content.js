// Happy Remixer — content script
// Detects TikTok video pages, injects a floating "Remix" button, and mounts
// the remix panel in a shadow root so TikTok's CSS can't touch it.

(() => {
  if (window.__happyRemixerLoaded) return;
  window.__happyRemixerLoaded = true;

  const VIDEO_URL_RE = /\/@[^/]+\/video\/\d+/;
  const PANEL_WIDTH = 420;

  let host = null;          // shadow host element
  let shadow = null;        // shadow root
  let panelOpen = false;
  let currentVideoEl = null;
  let lastUrl = location.href;

  // --- bootstrapping --------------------------------------------------------

  function isVideoPage() {
    return VIDEO_URL_RE.test(location.pathname);
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'happy-remixer-root';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = SHADOW_TEMPLATE;
    wireUpPanel();
  }

  function findVideo() {
    // TikTok renders the active video as a <video> inside the feed item.
    // Pick the largest visible video.
    const vids = [...document.querySelectorAll('video')];
    let best = null;
    let bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 100 && r.height > 100) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  function tick() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // navigation — close panel if open
      if (panelOpen) togglePanel(false);
    }
    if (!isVideoPage()) {
      setLauncherVisible(false);
      return;
    }
    ensureHost();
    const v = findVideo();
    if (v) {
      currentVideoEl = v;
      setLauncherVisible(true);
    } else {
      setLauncherVisible(false);
    }
  }

  setInterval(tick, 800);
  tick();

  // --- launcher button ------------------------------------------------------

  function setLauncherVisible(show) {
    if (!shadow) return;
    const launcher = shadow.getElementById('launcher');
    if (launcher) launcher.style.display = show ? 'flex' : 'none';
  }

  // --- panel control --------------------------------------------------------

  function wireUpPanel() {
    const launcher = shadow.getElementById('launcher');
    const closeBtn = shadow.getElementById('close-btn');
    const promptInput = shadow.getElementById('prompt-input');
    const sendBtn = shadow.getElementById('send-btn');
    const settingsLink = shadow.getElementById('open-settings');

    launcher.addEventListener('click', () => togglePanel(!panelOpen));
    closeBtn.addEventListener('click', () => togglePanel(false));
    sendBtn.addEventListener('click', () => runRemix(promptInput.value));
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        runRemix(promptInput.value);
      }
    });
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'open-options' });
    });

    // chip presets
    shadow.querySelectorAll('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const preset = el.getAttribute('data-preset');
        const prompts = {
          captions: 'Generate 5 alternative captions/hooks in different styles (witty, dramatic, educational, deadpan, viral).',
          remix: 'Suggest a creative remix concept — a different angle, parody, or duet idea that would go viral. Include a 30-second script.',
          edits: 'Suggest 3 specific edit ideas with timestamps (cuts, speed changes, text overlays, transitions). Be concrete.',
          hashtags: 'Generate 12 highly relevant hashtags + 3 trending sound suggestions for this video.',
          voiceover: 'Write a 25-second voiceover script that completely changes the meaning of the video — same visuals, totally different vibe.',
          analyze: 'Describe what is happening in this video in detail, the vibe, the audience, and what makes it work (or not).',
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
    host.style.pointerEvents = open ? 'auto' : 'none';
    // launcher always clickable
    const launcher = shadow.getElementById('launcher');
    if (launcher) launcher.style.pointerEvents = 'auto';

    if (open) {
      // pause TikTok video when panel opens so it's not playing in the background
      try { currentVideoEl && currentVideoEl.pause(); } catch (_) {}
      hydrateVideoPreview();
    }
  }

  // --- preview + frame capture ---------------------------------------------

  async function hydrateVideoPreview() {
    const meta = shadow.getElementById('meta');
    const thumbCanvas = shadow.getElementById('thumb-canvas');
    if (!currentVideoEl) {
      meta.textContent = 'No video found.';
      return;
    }
    const url = location.href;
    const m = url.match(/\/@([^/]+)\/video\/(\d+)/);
    const author = m ? '@' + m[1] : '—';
    const id = m ? m[2] : '—';
    const dur = currentVideoEl.duration;
    meta.innerHTML = `
      <div class="meta-row"><span class="k">creator</span><span class="v">${escapeHtml(author)}</span></div>
      <div class="meta-row"><span class="k">video id</span><span class="v">${escapeHtml(id)}</span></div>
      <div class="meta-row"><span class="k">duration</span><span class="v">${isFinite(dur) ? dur.toFixed(1) + 's' : '—'}</span></div>
      <div class="meta-row"><span class="k">size</span><span class="v">${currentVideoEl.videoWidth}×${currentVideoEl.videoHeight}</span></div>
    `;

    // draw current frame to thumb
    const ctx = thumbCanvas.getContext('2d');
    const w = thumbCanvas.width;
    const h = thumbCanvas.height;
    try {
      const ratio = currentVideoEl.videoWidth / currentVideoEl.videoHeight;
      const drawW = h * ratio;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(currentVideoEl, (w - drawW) / 2, 0, drawW, h);
    } catch (e) {
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Capture N frames from the video element by seeking and drawing to canvas.
  async function captureFrames(n = 4) {
    if (!currentVideoEl) return [];
    const v = currentVideoEl;
    const dur = isFinite(v.duration) ? v.duration : 5;
    const wasPaused = v.paused;
    const wasMuted = v.muted;
    const t0 = v.currentTime;
    v.muted = true;

    const frames = [];
    const canvas = new OffscreenCanvas(512, Math.round(512 * v.videoHeight / Math.max(1, v.videoWidth)));
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < n; i++) {
      const t = (dur * (i + 0.5)) / n;
      try {
        await seek(v, t);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
        const b64 = await blobToBase64(blob);
        frames.push({ time: t, data: b64, mediaType: 'image/jpeg' });
      } catch (e) {
        // skip frame on error
      }
    }
    // restore
    try { await seek(v, t0); } catch (_) {}
    v.muted = wasMuted;
    if (!wasPaused) { try { await v.play(); } catch (_) {} }
    return frames;
  }

  function seek(video, time) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onErr);
        resolve();
      };
      const onErr = (e) => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onErr);
        reject(e);
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onErr, { once: true });
      try { video.currentTime = time; } catch (e) { reject(e); }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result;
        const i = s.indexOf(',');
        resolve(s.slice(i + 1));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // --- video capture (record current playback to webm) ---------------------

  async function recordCurrentVideo() {
    if (!currentVideoEl) return null;
    const v = currentVideoEl;
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (!dur) return null;
    if (typeof v.captureStream !== 'function') return null;

    const stream = v.captureStream();
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));

    v.muted = false;
    v.currentTime = 0;
    await v.play();
    rec.start();

    await new Promise((r) => setTimeout(r, dur * 1000 + 250));
    rec.stop();
    await done;
    return new Blob(chunks, { type: 'video/webm' });
  }

  // --- AI run ---------------------------------------------------------------

  async function runRemix(prompt) {
    if (!prompt || !prompt.trim()) {
      flashStatus('Type or pick a remix idea first.', 'warn');
      return;
    }
    const out = shadow.getElementById('output');
    const send = shadow.getElementById('send-btn');
    out.innerHTML = '<div class="spinner"></div><div class="muted">Capturing frames…</div>';
    send.disabled = true;
    try {
      const frames = await captureFrames(4);
      out.innerHTML = '<div class="spinner"></div><div class="muted">Asking Claude…</div>';
      const meta = {
        url: location.href,
        duration: currentVideoEl?.duration ?? null,
        size: currentVideoEl ? `${currentVideoEl.videoWidth}x${currentVideoEl.videoHeight}` : null,
      };
      const resp = await chrome.runtime.sendMessage({
        type: 'remix',
        prompt,
        frames,
        meta,
      });
      if (resp?.error) {
        out.innerHTML = `<div class="err">${escapeHtml(resp.error)}</div>`;
        return;
      }
      renderResult(resp.text || '');
    } catch (e) {
      out.innerHTML = `<div class="err">${escapeHtml(String(e?.message || e))}</div>`;
    } finally {
      send.disabled = false;
    }
  }

  function renderResult(text) {
    const out = shadow.getElementById('output');
    out.innerHTML = `
      <div class="result">${markdownLite(text)}</div>
      <div class="row">
        <button class="ghost-btn" id="copy-btn">Copy</button>
        <button class="ghost-btn" id="dl-text-btn">Save as .md</button>
        <button class="ghost-btn" id="dl-vid-btn">Download video</button>
      </div>
      <div class="status" id="status"></div>
    `;
    shadow.getElementById('copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      flashStatus('Copied.');
    });
    shadow.getElementById('dl-text-btn').addEventListener('click', () => {
      downloadText(text, `remix-${Date.now()}.md`);
      flashStatus('Saved markdown.');
    });
    shadow.getElementById('dl-vid-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      flashStatus('Recording playback (this takes the full video duration)…');
      try {
        const blob = await recordCurrentVideo();
        if (!blob) {
          flashStatus('Could not capture this video.', 'err');
        } else {
          downloadBlob(blob, `tiktok-${Date.now()}.webm`);
          flashStatus('Saved video.');
        }
      } catch (err) {
        flashStatus(String(err?.message || err), 'err');
      } finally {
        e.target.disabled = false;
      }
    });
  }

  function flashStatus(msg, kind = 'ok') {
    const s = shadow.getElementById('status');
    if (!s) return;
    s.textContent = msg;
    s.className = 'status ' + kind;
    setTimeout(() => { if (s.textContent === msg) s.textContent = ''; }, 2400);
  }

  function downloadText(text, name) {
    const blob = new Blob([text], { type: 'text/markdown' });
    downloadBlob(blob, name);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // --- helpers --------------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function markdownLite(s) {
    // Tiny markdown: code blocks, **bold**, *italic*, headings, bullets, line breaks.
    let t = escapeHtml(s);
    t = t.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    t = t.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // bullets
    t = t.replace(/(^|\n)([-*] .+(\n[-*] .+)*)/g, (m, lead, block) => {
      const items = block.split('\n').map((l) => l.replace(/^[-*] /, '')).map((l) => `<li>${l}</li>`).join('');
      return `${lead}<ul>${items}</ul>`;
    });
    // numbered
    t = t.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, lead, block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^\d+\. /, '')).map((l) => `<li>${l}</li>`).join('');
      return `${lead}<ol>${items}</ol>`;
    });
    t = t.replace(/\n\n/g, '<br><br>');
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  // --- shadow template ------------------------------------------------------

  const SHADOW_CSS = `
    :host, * { box-sizing: border-box; }
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
    #launcher svg { display: block; }

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

    header {
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
      border: none; background: rgba(255,255,255,0.06);
      color: #f3f3f5; cursor: pointer;
      display: grid; place-items: center;
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

    .presets {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px 16px 4px;
    }
    .chip {
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: #f3f3f5;
      padding: 6px 10px; border-radius: 999px;
      font: 600 12px/1 inherit; letter-spacing: -0.005em;
      cursor: pointer; transition: background .12s ease, border-color .12s ease;
    }
    .chip:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.18); }

    .composer { padding: 10px 16px 12px; }
    #prompt-input {
      width: 100%; min-height: 64px; resize: vertical;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; padding: 10px 12px;
      color: #f3f3f5; font: inherit; outline: none;
    }
    #prompt-input:focus { border-color: rgba(255, 0, 80, 0.55); box-shadow: 0 0 0 4px rgba(255, 0, 80, 0.12); }
    .composer-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 8px;
    }
    .primary {
      background: linear-gradient(135deg, #ff0050 0%, #8a2be2 100%);
      color: white; border: none;
      padding: 9px 16px; border-radius: 10px;
      font: 600 13px/1 inherit; cursor: pointer;
      box-shadow: 0 4px 14px rgba(255, 0, 80, 0.35);
    }
    .primary:hover { filter: brightness(1.05); }
    .primary:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }

    .ghost-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #f3f3f5;
      padding: 7px 11px; border-radius: 8px;
      font: 600 12px/1 inherit; cursor: pointer;
    }
    .ghost-btn:hover { background: rgba(255,255,255,0.1); }
    .ghost-btn:disabled { opacity: 0.55; cursor: progress; }

    .output {
      flex: 1; overflow-y: auto;
      padding: 6px 16px 18px;
      border-top: 1px solid rgba(255,255,255,0.06);
      margin-top: 4px;
    }
    .output .muted { opacity: 0.5; }
    .output .small { font-size: 12.5px; }
    .result {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px; padding: 12px 14px;
      margin: 8px 0 10px;
      line-height: 1.55;
    }
    .result h2, .result h3, .result h4 { margin: 12px 0 6px; letter-spacing: -0.01em; }
    .result h2 { font-size: 16px; }
    .result h3 { font-size: 14.5px; }
    .result h4 { font-size: 13px; opacity: 0.85; }
    .result ul, .result ol { padding-left: 20px; margin: 6px 0; }
    .result li { margin: 3px 0; }
    .result code {
      background: rgba(255,255,255,0.07); padding: 1px 5px;
      border-radius: 5px; font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .result pre {
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px; padding: 10px 12px;
      overflow-x: auto; font-size: 12.5px;
    }
    .row { display: flex; gap: 6px; flex-wrap: wrap; }
    .err {
      background: rgba(255, 60, 80, 0.12);
      border: 1px solid rgba(255, 60, 80, 0.35);
      color: #ffd0d6;
      padding: 10px 12px; border-radius: 10px;
      font-size: 13px;
    }
    .status { margin-top: 8px; font-size: 12px; min-height: 16px; opacity: 0.75; }
    .status.err { color: #ff8a96; opacity: 1; }
    .status.warn { color: #ffd479; opacity: 1; }

    .spinner {
      width: 18px; height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.18);
      border-top-color: #ff0050;
      animation: spin 0.7s linear infinite;
      display: inline-block; vertical-align: middle;
      margin: 4px 8px 4px 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    a { color: #ff8aa3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { opacity: 0.55; font-size: 12.5px; }
  `;

  const SHADOW_TEMPLATE = `
    <style>${SHADOW_CSS}</style>
    <button id="launcher" title="Remix with AI">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff"/>
            <stop offset="1" stop-color="#fff" stop-opacity=".7"/>
          </linearGradient>
        </defs>
        <path d="M12 2 L13.7 8.3 L20 10 L13.7 11.7 L12 18 L10.3 11.7 L4 10 L10.3 8.3 Z" fill="url(#g)"/>
        <circle cx="18.5" cy="5.5" r="1.6" fill="#fff"/>
        <circle cx="5.5" cy="18.5" r="1.2" fill="#fff" opacity=".85"/>
      </svg>
      <span>Remix</span>
    </button>
    <aside id="panel" aria-label="Happy Remixer">
      <header>
        <div class="brand">
          <div class="logo"></div>
          <div class="title">
            <div class="t1">Happy Remixer</div>
            <div class="t2">remix this video with AI</div>
          </div>
        </div>
        <button id="close-btn" aria-label="Close" title="Close">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
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
      <section id="output" class="output">
        <div class="muted small">Pick a preset or type your own remix prompt. Frames from the current video are sent to Claude for vision analysis.</div>
      </section>
    </aside>
  `;

})();

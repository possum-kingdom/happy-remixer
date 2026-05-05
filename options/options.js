const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggleVis');

async function load() {
  const { apiKey = '', model = 'claude-sonnet-4-6' } =
    await chrome.storage.local.get(['apiKey', 'model']);
  apiKeyEl.value = apiKey;
  modelEl.value = model;
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + kind;
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  await chrome.storage.local.set({
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value,
  });
  setStatus('Saved.', 'ok');
  saveBtn.disabled = false;
  setTimeout(() => setStatus(''), 1800);
});

testBtn.addEventListener('click', async () => {
  const key = apiKeyEl.value.trim();
  if (!key) {
    setStatus('Add a key first.', 'err');
    return;
  }
  testBtn.disabled = true;
  setStatus('Testing…');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelEl.value || 'claude-sonnet-4-6',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word "ready".' }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = t;
      try { msg = JSON.parse(t)?.error?.message ?? t; } catch (_) {}
      throw new Error(`${res.status} ${msg}`);
    }
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text).join('').trim();
    setStatus(`OK — model said “${text.slice(0, 40)}”.`, 'ok');
  } catch (e) {
    setStatus(String(e?.message || e), 'err');
  } finally {
    testBtn.disabled = false;
  }
});

toggleBtn.addEventListener('click', () => {
  const showing = apiKeyEl.type === 'text';
  apiKeyEl.type = showing ? 'password' : 'text';
  toggleBtn.textContent = showing ? 'show' : 'hide';
});

load();

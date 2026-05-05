// Happy Remixer — background service worker
// Routes remix requests from the content script to the Claude API.

import { callClaude } from './lib/ai.js';

async function getSettings() {
  const { apiKey = '', model = '' } = await chrome.storage.local.get(['apiKey', 'model']);
  return { apiKey, model };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false; // sync
  }

  if (msg?.type === 'remix') {
    (async () => {
      try {
        const { apiKey, model } = await getSettings();
        const { text, usage } = await callClaude({
          apiKey,
          model,
          prompt: msg.prompt,
          frames: msg.frames,
          meta: msg.meta,
        });
        sendResponse({ text, usage });
      } catch (e) {
        sendResponse({ error: String(e?.message || e) });
      }
    })();
    return true; // keep the channel open for async response
  }

  if (msg?.type === 'ping') {
    sendResponse({ ok: true, ts: Date.now() });
    return false;
  }
});

// First-run: open the options page so users add their API key.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

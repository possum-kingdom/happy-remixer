const dot = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const hint = document.getElementById('hint');
const openTikTok = document.getElementById('open-tiktok');
const openOptions = document.getElementById('open-options');

(async () => {
  const { apiKey = '', model = 'claude-sonnet-4-6' } =
    await chrome.storage.local.get(['apiKey', 'model']);
  if (!apiKey) {
    dot.className = 'dot warn';
    statusText.textContent = 'No API key set';
    hint.textContent = 'Add a key in Settings to start remixing.';
  } else {
    dot.className = 'dot ok';
    statusText.textContent = `Ready · ${model}`;
    hint.textContent = 'Open any TikTok video and tap the Remix chip.';
  }

  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.url && /https:\/\/www\.tiktok\.com\//.test(tab.url)) {
    openTikTok.textContent = 'Reload tab';
  }
})();

openTikTok.addEventListener('click', async () => {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.url && /https:\/\/www\.tiktok\.com\//.test(tab.url)) {
    await chrome.tabs.reload(tab.id);
  } else {
    await chrome.tabs.create({ url: 'https://www.tiktok.com/foryou' });
  }
  window.close();
});

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

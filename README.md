# Happy Remixer

Remix any TikTok video with AI — without leaving TikTok.

Click Remix, type what you want (or tap a style preset), press Enter. Dreamina generates a new AI video in a background tab while you keep scrolling.

## Setup (2 minutes)

1. **Clone this repo**

   ```
   git clone https://github.com/possum-kingdom/happy-remixer.git
   ```

2. **Open Chrome** and go to `chrome://extensions`

3. **Turn on Developer mode** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the `happy_remixer` folder you just cloned

5. **Sign into Dreamina** — go to [dreamina.capcut.com](https://dreamina.capcut.com) and create a free account (you get 120 free credits, no card needed)

That's it. You're ready.

## How to Use

1. Go to [tiktok.com](https://www.tiktok.com) and scroll to any video
2. Click the **Remix** button in the action rail (smiley face icon on the right side)
3. Pick a style preset or type your own prompt:

   | Preset | What it does |
   |--------|-------------|
   | 🎬 Cinematic | Dramatic movie trailer lighting |
   | ✦ Anime | Anime style animation |
   | 📼 Retro | 90s VHS tape with tracking lines |
   | ✨ Dreamy | Ethereal slow motion |
   | 🖤 Dark | Moody thriller scene |
   | 😂 Funny | Absurd exaggerated comedy |

4. Hit the send arrow (or press Enter)
5. **You stay on TikTok.** Dreamina opens in a background tab, auto-fills your prompt, sets 9:16 vertical format, and starts generating
6. When you're ready, switch to the Dreamina tab to grab your video

## Requirements

- Chrome, Edge, Brave, Arc, or any Chromium browser
- A free [Dreamina](https://dreamina.capcut.com) account (120 free credits from ByteDance, no card)

No API keys needed. No build step. No dependencies.

## Optional: Claude AI Features

If you want AI-powered captions, scripts, or remix analysis, add an Anthropic API key:

1. Click the Happy Remixer icon in your toolbar
2. Go to Settings
3. Paste your API key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)

This is totally optional — the core Dreamina remix flow works without it.

## How It Works

When you click Remix and hit send:

- Captures a reference frame from the current TikTok video
- Opens Dreamina in a background tab (you never leave TikTok)
- Auto-fills your prompt into Dreamina's editor
- Sets aspect ratio to 9:16 (TikTok vertical)
- Clicks generate for you
- If Dreamina errors, it retries automatically after 10 seconds

## Troubleshooting

**Remix button doesn't appear** — Refresh the TikTok page. If it still doesn't show, go to `chrome://extensions`, find Happy Remixer, and click the reload icon.

**Dreamina says "unusual activity"** — You hit Dreamina's rate limit. Wait a minute and try again. The extension retries automatically.

**Prompt fills but nothing generates** — Make sure you're signed into Dreamina. Open [dreamina.capcut.com](https://dreamina.capcut.com) and check you're logged in.

**Dreamina tab opens in the foreground** — This shouldn't happen. If it does, reload the extension from `chrome://extensions`.

## Privacy

- Your prompt and one video frame go to Dreamina when you click send
- If you use Claude features, frames go to `api.anthropic.com` with your key
- Nothing is stored on any server — extension only uses `chrome.storage.local`
- TikTok never sees your API key

## License

MIT

# Happy Remixer

A Chrome extension that lets you remix TikTok videos with AI — and the result plays back as a native-feeling TikTok video, right inside your browser.

Open any TikTok video, tap the floating **Remix** chip, type a prompt or pick a preset (captions, remix concept, edit ideas, hashtags, voiceover, analyze). Sampled frames are sent to Claude. The response opens in a fullscreen viewer that mirrors your video and renders the remix natively — handle, caption, hashtags, and music attribution bottom-left, action rail (like / notes / re-remix / save / sound) on the right, and timed text overlays animating word-by-word over the video.

![preview](icons/icon128.png)

## Features

- 🎬 **Native TikTok-style viewer** — fullscreen black, mirrored 9:16 video, action rail on the right, info bottom-left. Tap to pause/play, ESC to close.
- ✨ **Animated overlays** — Claude returns a list of timed text overlays. They pop in word-by-word, synced to the video timeline.
- 🪞 **Live mirroring** — uses `HTMLVideoElement.captureStream()` to mirror the playing TikTok video into the viewer with no re-download.
- 🧠 **Structured AI output** — Claude returns a strict JSON object (`handle`, `caption`, `hashtags`, `music`, `overlays[]`, `summary`) so the viewer can render it directly. Prompt prefill (`{`) guarantees parseable JSON.
- ⚡ **Six remix presets** — Captions, Remix concept, Edit ideas, Hashtags, New voiceover, Analyze.
- ✍️ **Free-form prompts** — type anything; ⌘↩ / Ctrl↩ to send.
- 💾 **Save / re-remix** — save the remix as Markdown, like it (counter pops), or jump back to the composer with the same prompt.
- 🔐 **Local-only key storage** — your Anthropic API key lives in `chrome.storage.local`, nothing else.
- 🧠 **Prompt caching** — the system prompt is cached so repeat remixes are cheap.

## Install (developer mode)

1. `git clone` this repo to your machine.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and pick the `happy_remixer` directory.
5. The options page opens automatically — paste your Anthropic API key and click **Save**. Get one at <https://console.anthropic.com/settings/keys>.
6. Click **Test connection** to verify.
7. Visit any TikTok video page (e.g. `tiktok.com/foryou`) — a **Remix** chip appears bottom-right.

## How it works

```
content/content.js      injects launcher + composer + native viewer into TikTok pages
                        (everything inside a Shadow DOM, zero CSS leakage)
                        samples 4 frames via OffscreenCanvas
                        mirrors the playing video into the viewer via captureStream()
                        renders timed overlays on a requestAnimationFrame loop synced to currentTime

background.js           MV3 service worker; routes the remix request

lib/ai.js               Claude API client; cached system prompt; assistant prefill ('{')
                        guarantees JSON output; result normalized into a strict shape

options/                API-key entry + connection test
popup/                  toolbar status + quick actions
```

### Structured remix shape

```jsonc
{
  "handle":   "@vibe_lab",
  "caption":  "POV: when AI clocks the trend before you do 💀",
  "hashtags": ["fyp", "ai", "remix", "pov"],
  "music":    "original sound · happy_remixer",
  "overlays": [
    { "time": 0.0, "text": "POV:", "style": "title" },
    { "time": 0.6, "text": "you let an AI", "style": "body" },
    { "time": 1.6, "text": "remix your tiktok", "style": "body" },
    { "time": 3.0, "text": "💀", "style": "emoji" }
  ],
  "summary":  "Plays on the POV trope; first overlay lands inside the 1.5s hook window."
}
```

## Models

The default is `claude-sonnet-4-6` (fast + smart). You can switch to `claude-opus-4-7` (smartest) or `claude-haiku-4-5-20251001` (cheapest) in Settings.

## Privacy

- Frames + your prompt are sent to `api.anthropic.com` over HTTPS, with your API key. They are not sent anywhere else.
- The TikTok page never sees your API key — calls happen from the background service worker.
- Recording playback is done locally with `MediaRecorder` on the page's `<video>` element. The result is downloaded directly to your machine.

## Limitations

- Only triggers on `tiktok.com` video pages (URLs that look like `/@user/video/123…`).
- Audio analysis: Claude only sees images, so prompts about specific sounds/music will be answered from visual context only.
- The viewer mirrors the source via `captureStream()`. If TikTok serves a DRM-protected stream in your region, the mirror may render black; the overlays still play on the correct timeline.
- TikTok's DOM may shift; the launcher targets the largest visible `<video>` element to stay resilient.

## Development

There is no build step. Edit a file, hit **Reload** on the extension card in `chrome://extensions`, refresh the TikTok tab.

If you change `manifest.json` or `background.js` you need to reload the extension. Content-script changes only need a tab refresh.

## License

MIT

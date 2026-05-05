# Happy Remixer

A Chrome extension that lets you remix TikTok videos with AI — like a native app, right inside your browser.

Open any TikTok video, tap the floating **Remix** chip, and a polished side panel slides in. Pick a preset (captions, remix concept, edit ideas, hashtags, voiceover, analyze) or type your own creative prompt. Frames from the current video are sampled and sent to Claude for vision-aware analysis. You get back captions, scripts, edit timestamps, hashtags, or whatever else you asked for. You can also record the playing video to `.webm` and download it.

![preview](icons/icon128.png)

## Features

- 💅 **Native-feeling UI** — frosted-glass side panel with shadow-DOM isolation, so TikTok styles can't bleed in.
- 🎬 **Vision-aware remixing** — samples 4 frames from the playing video and sends them to Claude as image inputs.
- ⚡ **Six remix presets** — Captions, Remix concept, Edit ideas, Hashtags, New voiceover, Analyze.
- ✍️ **Free-form prompts** — type anything; ⌘↩ / Ctrl↩ to send.
- 💾 **Save the result** — copy to clipboard, save as Markdown, or download the source video as `.webm`.
- 🔐 **Local-only key storage** — your Anthropic API key lives in `chrome.storage.local`, nothing else.
- 🧠 **Prompt caching** — system prompt is cached so repeat remixes are cheap.

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
content/content.js      injects the launcher + remix panel into TikTok pages
                        (everything inside a Shadow DOM, no CSS leakage)
                        captures sampled frames via OffscreenCanvas
                        captures playback via MediaRecorder for .webm export

background.js           service worker; relays messages to the Claude API

lib/ai.js               Claude API client; uses cached system prompt, sends
                        sampled frames as base64 image blocks

options/                API-key entry + connection test
popup/                  toolbar status + quick actions
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
- Recording captures the video at its current playback resolution, encoded to VP9/Opus in WebM. TikTok also serves DRM-protected streams in some regions; in that case `captureStream()` may return an empty stream.
- TikTok's CSS may evolve; the launcher targets the largest visible `<video>` element to be resilient.

## Development

There is no build step. Edit a file, hit **Reload** on the extension card in `chrome://extensions`, refresh the TikTok tab.

If you change `manifest.json` or `background.js` you need to reload the extension. Content-script changes only need a tab refresh.

## License

MIT

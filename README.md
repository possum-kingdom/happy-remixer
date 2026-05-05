# Happy Remixer

Remix any TikTok video with AI. Click **Remix**, type what you want, and Dreamina generates a new video from your prompt — all without leaving TikTok.

## Quick Start

1. **Download** — clone or download this repo
2. **Install** — open `chrome://extensions`, turn on **Developer mode** (top-right), click **Load unpacked**, pick the `happy_remixer` folder
3. **Go to TikTok** — open [tiktok.com](https://www.tiktok.com) and scroll to any video
4. **Tap Remix** — it's in the action rail on the right (smiley face icon)
5. **Type or pick a style** — presets like Cinematic, Anime, Retro are one tap
6. **Hit send** — Dreamina opens with your prompt, a reference frame from the video, and 9:16 aspect ratio already set. Just click generate.

That's it.

## What It Does

When you click Remix on a TikTok video:

- Captures a frame from the video as a reference image
- Opens [Dreamina](https://dreamina.capcut.com) (ByteDance's free AI video generator)
- Auto-fills your prompt into Dreamina's editor
- Uploads the reference frame
- Sets the aspect ratio to 9:16 (vertical, TikTok format)
- You just hit the generate button

The whole point is you never have to manually copy-paste prompts or set up Dreamina yourself. One input box, one click.

## Style Presets

Quick-tap chips above the input bar:

| Chip | Prompt |
|------|--------|
| Cinematic | Cinematic movie trailer with dramatic lighting |
| Anime | Anime style animation |
| Retro | 90s VHS tape with retro effects |
| Dreamy | Dreamy ethereal slow motion |
| Dark | Dark and moody thriller scene |
| Funny | Absurd and exaggerated comedy |

Or type anything you want.

## Requirements

- Chrome (or any Chromium browser — Edge, Brave, Arc, etc.)
- A free [Dreamina](https://dreamina.capcut.com) account (ByteDance gives you 120 free credits)

No API keys needed for Dreamina. If you want to use the Claude-powered remix features (text overlays, captions, analysis), add an Anthropic API key in the extension settings.

## Files

```
content/content.js    Main content script — remix bar, frame capture,
                      Dreamina auto-fill, native TikTok viewer
background.js         Service worker — routes Claude API calls
lib/ai.js             Claude API client (optional features)
options/              Settings page for API key
popup/                Toolbar popup
```

## Privacy

- Your prompt and a single video frame are sent to Dreamina when you click send
- If you use Claude features, frames go to `api.anthropic.com` with your API key
- Nothing is stored on any server. The extension only uses `chrome.storage.local`
- TikTok never sees your API key — all calls go through the background worker

## Development

No build step. Edit a file, hit Reload on the extension card in `chrome://extensions`, refresh the TikTok tab.

## License

MIT

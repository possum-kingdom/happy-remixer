// Claude API client. Returns a structured remix object that the
// TikTok-native viewer can render directly.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are Happy Remixer, an AI partner for short-form video remixing on TikTok.

You receive sampled frames from a vertical short video (typically TikTok, 9:16, under 60 seconds) and a creative request. Your only output is a single JSON object that a TikTok-style viewer renders directly. NO prose, NO markdown, NO preamble — JSON only.

Schema:
{
  "handle": string,            // creator handle for the remix, like "@critic_ai" or "@vibe_lab" — under 24 chars, snake_case, no leading dot, MUST start with "@"
  "caption": string,            // the headline caption shown bottom-left under the handle, ≤140 chars, NO inline hashtags, can include 1 emoji
  "hashtags": string[],         // 5–10 hashtags WITHOUT the "#" prefix, lowercased, no spaces
  "music": string,              // audio attribution string, e.g. "original sound · @happy_remixer" or "Track Name · Artist"
  "overlays": [                 // 3–8 floating text overlays timed to the video
    {
      "time": number,           // start time in seconds, within [0, duration]
      "text": string,           // the on-screen text — keep punchy, ≤36 chars per overlay
      "style": "title" | "body" | "subtitle" | "emoji"  // visual size; "title" is largest, "emoji" is just emoji glyphs
    }
  ],
  "summary": string             // 1–3 sentences explaining the remix concept; for analyze-type prompts up to ~150 words
}

Rules:
- Output ONLY the JSON. No \`\`\`json fences. No leading/trailing commentary.
- Times must fit inside the given duration. Spread overlays across the timeline, not all stacked at t=0.
- For "captions"/"hooks" prompts: caption + first 1–3 overlays carry the hook.
- For "remix concept": caption captures the new angle; overlays are the punchlines.
- For "edit ideas"/"voiceover" prompts: overlays are the script/edit beats with their timestamps.
- For "hashtags" prompts: hashtags array is the deliverable; caption can name the strategy; overlays can showcase the top 3 hashtags.
- For "analyze" prompts: summary holds the analysis; overlays surface the key takeaways.
- Voice: punchy, opinionated, platform-native. Hooks land in the first 1.5s. No corporate hedging.
- If the request is impossible from frames alone, say so briefly in summary and pivot.`;

export async function callClaude({ apiKey, model, prompt, frames, meta }) {
  if (!apiKey) throw new Error('Missing API key. Open Happy Remixer settings to add one.');

  const userBlocks = [];

  const ctx = [
    `Source: ${meta?.url ?? 'unknown'}`,
    meta?.duration != null ? `Duration: ${Number(meta.duration).toFixed(2)}s` : null,
    meta?.size ? `Frame size: ${meta.size}` : null,
    `Sampled frames: ${frames?.length ?? 0}`,
  ].filter(Boolean).join('\n');
  userBlocks.push({ type: 'text', text: ctx });

  for (const f of frames || []) {
    userBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: f.mediaType || 'image/jpeg',
        data: f.data,
      },
    });
  }

  userBlocks.push({ type: 'text', text: `Remix request: ${prompt}\n\nReturn ONLY the JSON object.` });

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: 1400,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: userBlocks },
      // Prefill an opening brace to force JSON output and skip preambles.
      { role: 'assistant', content: '{' },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    let detail = txt;
    try { detail = JSON.parse(txt)?.error?.message ?? txt; } catch (_) {}
    throw new Error(`Claude API ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  let raw = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  // We prefilled '{', so prepend it for a complete JSON string.
  let json = '{' + raw;
  // The model occasionally wraps the JSON in fences despite instructions.
  json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(json);
  } catch (_) {
    const m = json.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (e2) { /* fall through */ }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Claude returned a response that was not valid JSON. Try again.');
  }

  return { remix: normalize(parsed, meta), raw: json, usage: data.usage };
}

function normalize(obj, meta) {
  const dur = Number(meta?.duration) || 0;
  const out = {
    handle: trimStr(obj.handle, 24) || '@happy_remixer',
    caption: trimStr(obj.caption, 220) || '',
    hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(cleanTag).filter(Boolean).slice(0, 12) : [],
    music: trimStr(obj.music, 120) || 'original sound · happy_remixer',
    overlays: Array.isArray(obj.overlays)
      ? obj.overlays
          .map((o) => ({
            time: clamp(Number(o?.time) || 0, 0, Math.max(0.01, dur || 60)),
            text: trimStr(o?.text, 80) || '',
            style: ['title', 'body', 'subtitle', 'emoji'].includes(o?.style) ? o.style : 'body',
          }))
          .filter((o) => o.text)
          .sort((a, b) => a.time - b.time)
          .slice(0, 12)
      : [],
    summary: trimStr(obj.summary, 1200) || '',
  };
  if (!out.handle.startsWith('@')) out.handle = '@' + out.handle.replace(/^@*/, '');
  return out;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function trimStr(s, max) {
  if (s == null) return '';
  s = String(s).trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function cleanTag(s) {
  return String(s || '').replace(/^#+/, '').replace(/\s+/g, '').toLowerCase().slice(0, 32);
}

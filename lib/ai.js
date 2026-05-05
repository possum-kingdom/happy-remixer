// Tiny Claude API client. Runs in the service worker.
// Uses prompt caching on the system block to keep repeat requests cheap.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are Happy Remixer, an AI creative partner for short-form video remixing.

You receive frames sampled from a short vertical video (typically TikTok, 9:16, under 60 seconds) and a creative prompt from the user. Your job is to produce remix material that's specific, usable, and tuned to the platform.

Voice and style:
- Punchy, concrete, opinionated. No corporate hedging.
- Lean into platform-native rhythm: hooks in the first 1.5s, payoff before the 8-second drop-off, tight cuts.
- Format with light Markdown: bullets, bold for hooks, code blocks for scripts/captions you want copied verbatim.
- When you write captions/hooks, mark each with its style in italics, then the line itself on a new line.
- For edit suggestions, always include rough timestamps (e.g. \`0.0s–1.4s\`).
- For voiceovers and scripts, format as a script: each line on its own line, timing in brackets.
- Don't lecture. Don't restate the prompt. Don't include preambles like "Here are some ideas". Lead with the goods.

Constraints:
- Never invent text that's clearly visible in the frames as if you couldn't see it — read what's on screen.
- Never claim to know audio you didn't hear; reason from visuals.
- If a request is impossible from frames alone (e.g. "what's the song"), say so briefly and pivot.
- Keep total output under ~400 words unless the user asks for more.`;

export async function callClaude({ apiKey, model, prompt, frames, meta }) {
  if (!apiKey) throw new Error('Missing API key. Open Happy Remixer settings to add one.');

  const userBlocks = [];

  // Brief context block.
  const ctx = [
    `Source: ${meta?.url ?? 'unknown'}`,
    meta?.duration != null ? `Duration: ${Number(meta.duration).toFixed(1)}s` : null,
    meta?.size ? `Frame size: ${meta.size}` : null,
    `Sampled frames: ${frames?.length ?? 0}`,
  ].filter(Boolean).join('\n');
  userBlocks.push({ type: 'text', text: ctx });

  // Image blocks for each sampled frame.
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

  // The user's actual prompt.
  userBlocks.push({ type: 'text', text: `Remix request: ${prompt}` });

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: 1400,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: userBlocks },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser calls. The Anthropic SDK normally sets this server-side.
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
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { text, usage: data.usage };
}

// VOYA AI — the conversational brain.
// Calls the Claude Messages API directly over HTTPS. (The official SDK imports
// node:fs, which React Native's Metro bundler can't resolve, so we hit the REST
// endpoint — which works in both React Native and the web preview.)
//
// The key comes from EXPO_PUBLIC_ANTHROPIC_API_KEY (.env.local, gitignored).
// Without a key, a simple local parser keeps the app working.

const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
export const aiEnabled = apiKey.startsWith('sk-ant-');

export type Turn = { role: 'user' | 'assistant'; content: string };
export type Intent = 'navigate' | 'chat' | 'cancel';
export type Interpretation = { intent: Intent; destination: string; reply: string };

const SYSTEM = `You are VOYA AI, a warm, concise hands-free driving co-pilot for a delivery driver in Australia (focus: Melbourne). Keep every reply to ONE short, natural sentence — the driver is on the road.

WHAT YOU CAN DO: take the driver to a destination, and talk about a route once the app has calculated it. The app gives you the real distance, time and number of routes — only state those numbers when the app has actually provided them.

WHAT YOU DO NOT KNOW (unless the CURRENT CONTEXT below gives it to you): the driver's exact location or suburb, live traffic, road closures, roadworks, toll prices, or the current time. NEVER guess or invent any of these. If you're asked about something you don't have, say so plainly in one short sentence (e.g. "I don't have live traffic yet"). Do not make up suburbs, ETAs, distances, toll costs, or facts. It is always better to admit you don't know than to guess.

INTENT:
- "navigate": they want to go somewhere or find a place — put the clean place/address in "destination".
- "cancel": stop, cancel, or go back — "destination": "".
- "chat": greetings, questions, or anything else — "destination": "".

Respond with ONLY a JSON object, no markdown fences and no extra text, exactly:
{"intent": "navigate" | "chat" | "cancel", "destination": "<place or empty string>", "reply": "<one short sentence>"}`;

function localFallback(userText: string): Interpretation {
  const t = userText.trim();
  const lower = t.toLowerCase();
  if (/(cancel|stop|never\s?mind|go back)/.test(lower)) {
    return { intent: 'cancel', destination: '', reply: 'No worries, cancelled.' };
  }
  const dest = t
    .replace(/^\s*(hey\s+voya[,!.\s]*)?/i, '')
    .replace(/^(take me to|go to|navigate to|drive to|head to|find|show me|directions to)\s+/i, '')
    .trim();
  if (!dest) return { intent: 'chat', destination: '', reply: 'Where would you like to go?' };
  return { intent: 'navigate', destination: dest, reply: `Righto — let's get you to ${dest}.` };
}

function parseReply(raw: string): Interpretation {
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = {};
      }
    }
  }
  const intent: Intent =
    parsed.intent === 'cancel' || parsed.intent === 'chat' ? parsed.intent : 'navigate';
  return {
    intent,
    destination: typeof parsed.destination === 'string' ? parsed.destination : '',
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
  };
}

export async function interpret(
  userText: string,
  history: Turn[] = [],
  context = '',
): Promise<Interpretation> {
  if (!aiEnabled) return localFallback(userText);

  const system = context ? `${SYSTEM}\n\nCURRENT CONTEXT (from the app — trust this):\n${context}` : SYSTEM;
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userText },
  ];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Allows direct calls from the browser/web preview (no effect on native).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system,
        output_config: { effort: 'low' }, // snappy replies for in-car use
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[VOYA AI] Claude API error', res.status, detail.slice(0, 300));
      return localFallback(userText);
    }

    const data = await res.json();
    const block = (data.content || []).find((b: any) => b.type === 'text');
    return parseReply(block?.text ?? '{}');
  } catch (e) {
    console.warn('[VOYA AI] request failed, using fallback:', String(e));
    return localFallback(userText);
  }
}

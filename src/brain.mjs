// Compresses a session into glanceable form: a living title, a two-sentence
// "now" status, what it's asking of you, and a visual metaphor for cover art.
const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.VIBEDECK_BRAIN_MODEL || 'claude-haiku-4-5-20251001';

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  return JSON.parse(m[0]);
}

export async function generateBrain(session, prev, stateHint) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const transcript = session.recent
    .map(m => `${m.role === 'user' ? 'DEREK' : 'AGENT'}: ${m.text}`)
    .join('\n---\n')
    .slice(-9000);

  const context = {
    project: session.project,
    branch: session.gitBranch,
    original_wish: (session.wish || session.firstPrompt)?.slice(0, 1200) || null,
    previous_title: prev?.title || session.aiTitle || null,
    previous_status: prev?.status || null,
    current_state: stateHint || 'unknown',
    recent_transcript: transcript,
  };

  const body = {
    model: MODEL,
    max_tokens: 500,
    system: `You compress a live coding-agent session into a glanceable dashboard card for Derek, who runs many sessions in parallel. Be specific and concrete — the card must be recognizable among ten others at a glance. Respond with ONLY a JSON object:
{
  "title": "3-6 words, specific, evolves as the work evolves (not the original request verbatim if work has moved on)",
  "status": "1-2 short present-tense sentences: what just happened / what it's doing now. Plain language, no filler.",
  "asks": "if the session is waiting on Derek, one short imperative phrase of what it needs (e.g. 'approve the deploy', 'answer: which database?'), else null",
  "vibe": "a concrete visual metaphor for cover art: 4-10 words of vivid nouns/scenery capturing what this session is about (no text, no words, no logos)",
  "emoji": "one emoji",
  "milestone": true if since the previous_status something significant completed, shipped, or the direction changed — else false
}`,
    messages: [{ role: 'user', content: JSON.stringify(context) }],
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = extractJson(data.content?.map(p => p.text || '').join('') || '');
  return {
    title: String(out.title || '').slice(0, 80),
    status: String(out.status || '').slice(0, 300),
    asks: out.asks ? String(out.asks).slice(0, 120) : null,
    vibe: String(out.vibe || '').slice(0, 200),
    emoji: String(out.emoji || '').slice(0, 8),
    milestone: !!out.milestone,
    genAt: Date.now(),
    atMsgCount: session.userCount + session.assistantCount,
  };
}

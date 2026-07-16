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
    previous_svg: prev?.svg?.slice(0, 1400) || null,
    current_state: stateHint || 'unknown',
    recent_transcript: transcript,
  };

  const body = {
    model: MODEL,
    max_tokens: 1000,
    system: `You compress a live coding-agent session into a glanceable dashboard row for Derek, who runs many sessions in parallel. Be specific and concrete — the row must be recognizable among ten others at a glance. Respond with ONLY a JSON object:
{
  "title": "3-6 words, specific, evolves as the work evolves (not the original request verbatim if work has moved on)",
  "status": "1-2 short present-tense sentences: what just happened / what it's doing now. Plain language, no filler.",
  "asks": "if the session is waiting on Derek, one short imperative phrase of what it needs (e.g. 'approve the deploy', 'answer: which database?'), else null",
  "emoji": "one emoji",
  "milestone": true if since the previous_status something significant completed, shipped, or the direction changed — else false,
  "svg": "the session's pictogram — one complete <svg> element following the SVG RULES below"
}

SVG RULES — this mark is how Derek recognizes the session in a sidebar, so it must be UNIQUE to this session's subject:
1. KEEP-IF-GOOD: if previous_svg exists, is NOT a generic document/page/checkmark, and the session is still about the same thing, return previous_svg byte-for-byte unchanged. Only draw fresh when the subject genuinely changed or the previous glyph was generic.
2. First name (to yourself) ONE concrete physical object or scene that is what the work is ABOUT — then draw that. Examples of the mapping: letters to kids at summer camp → a pine tree with an envelope leaning on it; an EEG experiment → a head in profile with electrode dots; a storage cleanup → stacked boxes with one lid open; stone carvings → three standing stones under a sun; a lead-generation funnel → a funnel catching a coin; a translation pipeline → an open book split into two ink colors; a birthday party → a cake with one candle. The object comes from the SUBJECT, never from the medium of work. If the subject truly IS a document, depict its distinctive essence as an object instead: a legal agreement → a wax seal or two overlapping hands; a pull request → two branching paths merging into one; a tax question → a balance scale.
3. BANNED (these identify nothing): documents/pages/cards with lines, rotated-rectangle fans, browser or terminal windows, envelopes-with-lines, checkmarks (even for finished work), magnifying glasses, gears, lightbulbs. If your first idea is rectangles or a checkmark, look at the subject again and pick a real object from it.
4. viewBox='0 0 100 100'; 4-10 flat filled shapes (circle/rect/path/polygon/ellipse); no text, no strokes, no gradients; transparent background (it sits on deep indigo).
5. Fills ONLY from #e8a852 #5f9e94 #efe6d0 #c96f4a #8d86c9 — pick 2-3, not all five.
6. Composition: main form 60-90 units, asymmetric, overlapping shapes; a slight transform='rotate(a cx cy)' on one shape adds life. Under 1000 characters.`,
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
    emoji: String(out.emoji || '').slice(0, 8),
    milestone: !!out.milestone,
    svg: sanitizeSvg(out.svg),
    genAt: Date.now(),
    atMsgCount: session.userCount + session.assistantCount,
  };
}

// Model-written SVG goes straight into the DOM — allow shapes only.
function sanitizeSvg(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return null;
  let svg = m[0].slice(0, 4000);
  if (/<\s*(script|foreignObject|image|use|iframe|a)\b/i.test(svg)) return null;
  if (/\bon\w+\s*=|javascript:|href|xlink/i.test(svg)) return null;
  if (!/viewBox/.test(svg)) svg = svg.replace(/<svg/i, '<svg viewBox="0 0 100 100"');
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

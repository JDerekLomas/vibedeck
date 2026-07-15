// Cover art for a session — Gemini image gen from the brain's visual metaphor,
// with a deterministic generative-SVG fallback so every card always has a face.
import fs from 'node:fs';
import path from 'node:path';
import { artDirFor } from './store.mjs';

const MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-2.0-flash-preview-image-generation'];

const SERIES_STYLE = 'Minimal risograph screenprint illustration, bold flat shapes, limited palette of warm amber, dusty teal and cream inks on deep indigo paper, subtle grain texture, generous negative space, square composition. Absolutely no text, no letters, no numbers, no logos.';

export async function generateArt(session, vibe) {
  const key = process.env.GEMINI_API_KEY;
  const dir = artDirFor(session.id);
  const ts = Date.now();

  if (key && vibe) {
    for (const model of MODELS) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${SERIES_STYLE}\n\nSubject: ${vibe}` }] }],
            }),
          },
        );
        if (!res.ok) { if (res.status === 404) continue; throw new Error(`${model} ${res.status}`); }
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const img = parts.find(p => p.inlineData?.data);
        if (!img) continue;
        const ext = (img.inlineData.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
        const file = path.join(dir, `${ts}.${ext}`);
        fs.writeFileSync(file, Buffer.from(img.inlineData.data, 'base64'));
        return `/art/${session.id}/${ts}.${ext}`;
      } catch (e) {
        console.error('art', model, e.message);
      }
    }
  }

  // Fallback: deterministic generative composition from the session id.
  const file = path.join(dir, `${ts}.svg`);
  fs.writeFileSync(file, fallbackSvg(session.id, session.project));
  return `/art/${session.id}/${ts}.svg`;
}

function fallbackSvg(id, seedText) {
  let h = 0;
  const str = id + (seedText || '');
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 2 ** 32; };
  const inks = ['#e8a852', '#5f9e94', '#efe6d0', '#c96f4a', '#8d86c9'];
  const shapes = [];
  const n = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const ink = inks[Math.floor(rand() * inks.length)];
    const cx = 40 + rand() * 320, cy = 40 + rand() * 320, r = 25 + rand() * 110;
    if (rand() < 0.45) {
      shapes.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${ink}" opacity="${(0.55 + rand() * 0.35).toFixed(2)}"/>`);
    } else if (rand() < 0.5) {
      shapes.push(`<rect x="${(cx - r).toFixed(0)}" y="${(cy - r / 2).toFixed(0)}" width="${(r * 2).toFixed(0)}" height="${r.toFixed(0)}" rx="${(r / 5).toFixed(0)}" fill="${ink}" opacity="${(0.5 + rand() * 0.4).toFixed(2)}" transform="rotate(${(rand() * 60 - 30).toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
    } else {
      const x2 = cx + (rand() - 0.5) * 260, y2 = cy + (rand() - 0.5) * 260;
      shapes.push(`<path d="M ${cx.toFixed(0)} ${cy.toFixed(0)} Q ${(cx + x2) / 2 + (rand() - 0.5) * 120} ${(cy + y2) / 2 + (rand() - 0.5) * 120} ${x2.toFixed(0)} ${y2.toFixed(0)}" stroke="${ink}" stroke-width="${(4 + rand() * 14).toFixed(0)}" fill="none" stroke-linecap="round" opacity="${(0.6 + rand() * 0.3).toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#1b2036"/>${shapes.join('')}<rect width="400" height="400" fill="url(#g)" opacity="0"/></svg>`;
}

// Session glyphs — small SVG pictograms written by the brain (Haiku), with a
// deterministic generative fallback so every row always has a face.
import fs from 'node:fs';
import path from 'node:path';
import { artDirFor } from './store.mjs';

// Persist the brain's pictogram (or the deterministic fallback) as the
// session's latest glyph. History is kept — the drawer shows the filmstrip.
export function saveGlyph(session, svg) {
  const dir = artDirFor(session.id);
  const ts = Date.now();
  const file = path.join(dir, `${ts}.svg`);
  fs.writeFileSync(file, svg || fallbackSvg(session.id, session.project));
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

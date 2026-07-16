/* vibedeck — split view: session list (left) + letter & gazette detail (right). */
const $ = (s, el = document) => el.querySelector(s);
let data = null;
let selectedId = null;
let userSelected = false;

const ago = (ts) => {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const esc = (t) => (t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATE_LABEL = { 'needs-input': 'needs you', working: 'working', idle: 'resting', ended: 'closed' };

/* ---------- list ---------- */
function glyph(c) {
  return c.art
    ? `<img class="glyph" src="${c.art}" alt="" loading="lazy">`
    : `<div class="glyph em">${esc(c.emoji || '·')}</div>`;
}

function rowHtml(c, compact = false) {
  const waiting = c.asks && c.state !== 'working' && c.state !== 'needs-input';
  const stateCls = waiting ? 'waiting' : c.state;
  const second = (c.asks && c.state !== 'working')
    ? `<span class="asks">→ ${esc(c.asks)}</span>`
    : (c.status ? esc(c.status) : esc(c.project));
  return `<div class="lrow ${stateCls}${compact ? ' compact' : ''}${c.id === selectedId ? ' sel' : ''}" data-id="${c.id}">
    ${glyph(c)}
    <div class="mid">
      <div class="l1"><h4>${esc(c.title)}</h4></div>
      ${!compact ? `<div class="l2">${second}</div>` : ''}
      ${!compact ? `<div class="l3"><span class="proj">${esc(c.project)}</span><span class="dot state-${stateCls}"></span><span class="ago">${ago(c.lastActivity)}</span></div>` : ''}
    </div>
    <button class="jump" data-jump="${c.id}" title="open in cmux">↗</button>
  </div>`;
}

function section(title, cls, cards, emptyText, compact = false) {
  if (!cards.length && !emptyText) return '';
  const body = cards.length
    ? cards.map(c => rowHtml(c, compact)).join('')
    : `<div class="empty">${emptyText}</div>`;
  return `<section class="section ${cls}">
    <div class="section-head ${cls}"><span>${title}</span><span class="count">${cards.length || ''}</span></div>
    ${body}</section>`;
}

function render() {
  if (!data) return;
  // A stopped session that asked for something is still waiting on you.
  const needs = data.active.filter(c => c.state === 'needs-input' || (c.asks && c.state !== 'working'));
  const working = data.active.filter(c => c.state === 'working');
  const resting = data.active.filter(c => !needs.includes(c) && !working.includes(c));

  $('#tally').innerHTML =
    (needs.length ? `<span class="hot">${needs.length} need${needs.length === 1 ? 's' : ''} you</span> · ` : '') +
    `<b>${working.length}</b> working · <b>${resting.length}</b> resting`;

  $('#board').innerHTML =
    section('Needs you', 'needs', needs, 'nobody is waiting on you') +
    section('In motion', 'motion', working, '') +
    section('At rest', 'rest', resting, '') +
    section('Earlier', 'earlier', data.earlier, '', true);

  document.querySelectorAll('.lrow').forEach(el => {
    el.addEventListener('click', () => select(el.dataset.id));
    el.addEventListener('dblclick', () => jumpIn(el.dataset.id));
  });
  document.querySelectorAll('.jump').forEach(el =>
    el.addEventListener('click', (e) => { e.stopPropagation(); jumpIn(el.dataset.jump); }));

  if (!userSelected && !selectedId && needs.concat(working, resting)[0]) {
    select(needs.concat(working, resting)[0].id, false);
  }
}

async function refresh() {
  try {
    data = await (await fetch('/api/sessions')).json();
    render();
    if (selectedId) renderDetail(selectedId, true);
  } catch { /* server restarting */ }
}

function select(id, byUser = true) {
  selectedId = id;
  if (byUser) userSelected = true;
  document.querySelectorAll('.lrow').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  renderDetail(id);
}

/* ---------- jump (fluid path into cmux) ---------- */
async function jumpIn(id) {
  toast('opening in cmux…', 12000);
  try {
    const r = await (await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })).json();
    if (r.result === 'focused') toast('focused its cmux pane');
    else if (r.result === 'resumed') toast('resumed in a new cmux workspace');
    else {
      const copied = await safeCopy(r.resumeCmd);
      toast(`couldn't open: ${r.detail || r.error || r.result}${copied ? ' — resume command copied' : ''}`, 8000);
    }
  } catch (e) { toast(`couldn't open: ${e.message}`, 8000); }
}

/* ---------- detail: letter + gazette ---------- */
function fmtDate(ts) {
  return new Date(ts || Date.now()).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function renderDetail(id, soft = false) {
  let d;
  try { d = await (await fetch(`/api/session/${id}`)).json(); } catch { return; }
  if (selectedId !== id) return;

  const heroList = d.artHistory || [];
  const latest = heroList[heroList.length - 1];
  const paras = (d.status || '').split(/(?<=\.)\s+/).filter(Boolean);

  const exchange = (d.recent || []).slice(-6).map(m => `
    <article class="gz-item">
      <span class="gz-who">${m.role === 'user' ? 'Derek' : 'The agent'}</span>
      <p>${esc(m.text.slice(0, 480))}${m.text.length > 480 ? '…' : ''}</p>
    </article>`).join('');

  const film = heroList.length
    ? `<div class="gz-film">${heroList.slice(-6).map(a => `<img src="${a.url}">`).join('')}</div>`
    : '';

  $('#detail').innerHTML = `
  <div class="paper">
    <div class="letter">
      <div class="letterhead">
        <div>FROM THE DECK OF ${esc(d.project).toUpperCase()}</div>
        <div class="lh2">${esc(d.cwd || '')}${d.branch ? ' · ' + esc(d.branch) : ''}</div>
      </div>
      <div class="dateline">${fmtDate(d.lastActivity)}</div>

      <div class="lt-glyph">${latest ? `<img src="${latest.url}">` : esc(d.emoji || '')}</div>
      <h1>${esc(d.title)}</h1>

      ${d.asks ? `<div class="lt-asks">→ ${esc(d.asks)}</div>` : ''}

      <div class="lt-body">
        ${paras.map(p => `<p>${esc(p)}</p>`).join('') || '<p>Nothing to report yet — the story is still being written.</p>'}
        ${d.firstPrompt ? `<p class="lt-wish">You wrote: <em>“${esc(d.firstPrompt.slice(0, 360))}${d.firstPrompt.length > 360 ? '…' : ''}”</em></p>` : ''}
      </div>

      <div class="lt-sign">
        <span>Yours in progress,</span>
        <span class="lt-agent">${esc(d.emoji || '✳')} the ${esc(d.project)} session</span>
      </div>

      <div class="lt-actions">
        <button class="primary" id="jumpBtn">Jump in ↗</button>
        <button class="ghost paper-ghost" id="copyBtn">Copy resume command</button>
        <span class="lt-state pill state-${d.state}"><span class="dot"></span>${STATE_LABEL[d.state] || d.state}</span>
      </div>
    </div>

    <div class="gazette">
      <div class="gz-masthead">The ${esc(d.project)} Gazette</div>
      <div class="gz-dateline">
        <span>${d.msgs} messages</span><span>·</span><span>${d.tools} tool runs</span><span>·</span><span>last activity ${ago(d.lastActivity)}</span>
      </div>
      ${film}
      <div class="gz-rule"></div>
      <div class="gz-cols">
        <div class="gz-head">The latest exchange</div>
        ${exchange || '<p class="gz-none">No correspondence on record.</p>'}
      </div>
      <div class="gz-foot">${esc(d.resumeCmd || '')}</div>
    </div>
  </div>`;

  $('#jumpBtn')?.addEventListener('click', () => jumpIn(id));
  $('#copyBtn')?.addEventListener('click', async () => {
    toast((await safeCopy(d.resumeCmd)) ? 'copied' : 'copy failed — command is printed at the bottom of the gazette');
  });
  if (!soft) $('#detail').scrollTop = 0;
}

/* ---------- wish ---------- */
function closeWish() { $('#wishModal').classList.remove('open'); }
$('#wishBtn').addEventListener('click', async () => {
  $('#wishModal').classList.add('open');
  $('#wishText').focus();
  try {
    const projects = await (await fetch('/api/projects')).json();
    $('#projectList').innerHTML = projects.map(p => `<option value="${esc(p)}">`).join('');
    if (!$('#wishCwd').value && projects[0]) $('#wishCwd').placeholder = projects[0];
  } catch {}
});
$('#wishCancel').addEventListener('click', closeWish);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWish(); });
$('#wishGo').addEventListener('click', async () => {
  const text = $('#wishText').value.trim();
  const cwd = $('#wishCwd').value.trim() || $('#wishCwd').placeholder;
  if (!text) return $('#wishText').focus();
  closeWish();
  toast('starting a new session… (starts cmux if needed)', 15000);
  try {
    const r = await (await fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, cwd }) })).json();
    if (r.result === 'started') toast('session born in cmux — it will appear here shortly');
    else {
      const copied = r.cmd ? await safeCopy(r.cmd) : false;
      toast(`couldn't start: ${r.detail || r.error || r.result}${copied ? ' — launch command copied' : ''}`, 8000);
    }
  } catch (e) { toast(`couldn't start: ${e.message}`, 8000); }
});

/* ---------- toast + clipboard ---------- */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Clipboard that never throws: async API first (absent in WKWebView),
// hidden-textarea fallback second.
async function safeCopy(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ---------- live ---------- */
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => { if (e.data === 'refresh') refresh(); };
  es.onerror = () => { es.close(); setTimeout(connect, 3000); };
}
refresh();
connect();
setInterval(() => { if (data) render(); }, 30000); // keep time-agos fresh

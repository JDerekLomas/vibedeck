/* vibedeck board — renders /api/sessions, live via SSE. */
const $ = (s, el = document) => el.querySelector(s);
let data = null;
let openId = null;

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

function cover(c, cls = 'cover') {
  const inner = c.art
    ? `<img src="${c.art}" alt="" loading="lazy">`
    : `<div class="placeholder">${esc(c.emoji || '·')}</div>`;
  const waiting = c.asks && c.state !== 'working' && c.state !== 'needs-input';
  const stateCls = waiting ? 'needs-input' : c.state;
  const label = waiting ? 'waiting on you' : (STATE_LABEL[c.state] || c.state);
  return `<div class="${cls}">${inner}<span class="state-pill state-${stateCls}"><span class="dot"></span>${label}</span></div>`;
}

function cardHtml(c) {
  return `<article class="card ${c.state}" data-id="${c.id}">
    ${cover(c)}
    <div class="body">
      <h3>${c.emoji ? `<span class="emoji">${esc(c.emoji)}</span>` : ''}${esc(c.title)}</h3>
      ${c.asks && c.state !== 'working' ? `<div class="asks${c.state === 'needs-input' ? '' : ' soft'}">→ ${esc(c.asks)}</div>` : ''}
      ${c.status ? `<div class="status">${esc(c.status)}</div>` : ''}
      <div class="meta">
        <span class="chip">${esc(c.project)}</span>
        ${c.branch && c.branch !== 'main' ? `<span class="chip">${esc(c.branch)}</span>` : ''}
        <span class="ago">${ago(c.lastActivity)}</span>
      </div>
    </div>
  </article>`;
}

function rowHtml(c) {
  const thumb = c.art ? `<img class="thumb" src="${c.art}" loading="lazy">` : `<div class="thumb">${esc(c.emoji || '·')}</div>`;
  return `<div class="row" data-id="${c.id}">
    ${thumb}
    <div class="t"><h4>${esc(c.title)}</h4><small>${esc(c.project)}${c.status ? ' — ' + esc(c.status) : ''}</small></div>
    <span class="ago">${ago(c.lastActivity)}</span>
  </div>`;
}

function section(title, cls, cards, renderer, emptyText) {
  if (!cards.length && !emptyText) return '';
  const body = cards.length
    ? `<div class="${renderer === rowHtml ? 'rows' : 'grid'}">${cards.map(renderer).join('')}</div>`
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
    section('Needs you', 'needs', needs, cardHtml, 'nobody is waiting on you — go make something') +
    section('In motion', 'motion', working, cardHtml, '') +
    section('At rest', 'rest', resting, cardHtml, '') +
    section('Earlier', 'earlier', data.earlier, rowHtml, '');

  document.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => openDrawer(el.dataset.id)));
}

async function refresh() {
  try {
    data = await (await fetch('/api/sessions')).json();
    render();
    if (openId) fillDrawer(openId, true);
  } catch { /* server restarting */ }
}

/* ---------- drawer ---------- */
async function openDrawer(id) {
  openId = id;
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
  fillDrawer(id);
}
function closeDrawer() {
  openId = null;
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
}
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeWish(); } });

async function fillDrawer(id, soft = false) {
  let d;
  try { d = await (await fetch(`/api/session/${id}`)).json(); } catch { return; }
  if (openId !== id) return;
  const hero = d.artHistory?.length ? d.artHistory[d.artHistory.length - 1].url : d.art;
  const film = (d.artHistory || []).length > 1
    ? `<div class="block"><div class="label">How it looked along the way</div>
        <div class="filmstrip">${d.artHistory.map((a, i) => `<img src="${a.url}" data-url="${a.url}" class="${i === d.artHistory.length - 1 ? 'sel' : ''}">`).join('')}</div></div>`
    : '';
  const exchange = (d.recent || []).slice(-4).map(m =>
    `<div class="msg ${m.role}"><span class="who">${m.role === 'user' ? 'you' : 'agent'}</span>${esc(m.text)}</div>`).join('');

  $('#drawerInner').innerHTML = `
    <div class="hero">${hero ? `<img id="heroImg" src="${hero}">` : `<div class="placeholder" style="display:flex;height:100%;align-items:center;justify-content:center;font-size:44px">${esc(d.emoji || '·')}</div>`}</div>
    <div>
      <h2>${d.emoji ? esc(d.emoji) + ' ' : ''}${esc(d.title)}</h2>
      <div class="sub"><span class="chip">${esc(d.project)}</span>${d.branch ? `<span class="chip">${esc(d.branch)}</span>` : ''}<span>${ago(d.lastActivity)} · ${d.msgs} messages · ${d.tools} tool runs</span></div>
    </div>
    ${d.state === 'needs-input' && d.asks ? `<div class="asks">→ ${esc(d.asks)}</div>` : ''}
    ${d.status ? `<div class="block"><div class="label">Now</div><p>${esc(d.status)}</p></div>` : ''}
    ${d.firstPrompt ? `<div class="block"><div class="label">The wish</div><p class="wish-text">“${esc(d.firstPrompt.slice(0, 420))}${d.firstPrompt.length > 420 ? '…' : ''}”</p></div>` : ''}
    ${film}
    ${exchange ? `<div class="block"><div class="label">Last exchange</div><div class="exchange">${exchange}</div></div>` : ''}
    <div class="actions">
      <button class="primary" id="jumpBtn">Jump in ↗</button>
      <button class="ghost" id="copyBtn">Copy resume command</button>
    </div>
    <div class="path">${esc(d.resumeCmd || '')}</div>`;

  $('#jumpBtn')?.addEventListener('click', async () => {
    toast('opening…');
    const r = await (await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })).json();
    if (r.result === 'focused') toast('focused its cmux pane');
    else if (r.result === 'resumed') toast('resumed in a new cmux workspace');
    else { await navigator.clipboard.writeText(d.resumeCmd); toast('cmux unavailable — resume command copied'); }
  });
  $('#copyBtn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(d.resumeCmd); toast('copied');
  });
  document.querySelectorAll('.filmstrip img').forEach(img =>
    img.addEventListener('click', () => {
      $('#heroImg').src = img.dataset.url;
      document.querySelectorAll('.filmstrip img').forEach(i => i.classList.remove('sel'));
      img.classList.add('sel');
    }));
  void soft;
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
$('#wishGo').addEventListener('click', async () => {
  const text = $('#wishText').value.trim();
  const cwd = $('#wishCwd').value.trim() || $('#wishCwd').placeholder;
  if (!text) return $('#wishText').focus();
  closeWish();
  toast('starting a new session…');
  const r = await (await fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, cwd }) })).json();
  if (r.result === 'started') toast('session born in cmux — it will appear here shortly');
  else if (r.cmd) { await navigator.clipboard.writeText(r.cmd); toast('cmux unavailable — launch command copied'); }
  else toast('could not start the session');
});

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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

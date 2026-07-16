/* vibedeck — split view: session list (left) + letter, live terminal & gazette (right). */
const $ = (s, el = document) => el.querySelector(s);
let data = null;
let selectedId = null;
let userSelected = false;
let autostartId = null;   // jump-in wants a terminal as soon as detail loads

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
    <button class="jump" data-jump="${c.id}" title="open terminal">↗</button>
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
  if (byUser) userSelected = true;
  if (selectedId === id) return;
  selectedId = id;
  disposeTerm();
  document.querySelectorAll('.lrow').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  renderDetail(id);
}

/* ---------- jump: fluid path into a live terminal ---------- */
function jumpIn(id) {
  autostartId = id;
  if (selectedId === id) renderDetail(id);
  else select(id);
}

/* ---------- in-app terminal (xterm + tmux over websocket) ---------- */
let xterm = null, xtermWs = null, xtermId = null, fitTimer = null, resizeObs = null;

function disposeTerm() {
  try { xtermWs?.close(); } catch {}
  try { xterm?.dispose(); } catch {}
  try { resizeObs?.disconnect(); } catch {}
  xterm = null; xtermWs = null; xtermId = null;
}

function mountXterm(id) {
  const slot = $('#termSlot');
  if (!slot || xtermId === id) return;
  disposeTerm();
  xtermId = id;
  slot.innerHTML = `<div class="term live">
    <div class="term-bar"><span class="term-dot"></span>live session — type here<span class="term-hint">runs in tmux; survives app restarts</span></div>
    <div class="xt-host"></div>
  </div>`;
  const TerminalCtor = window.Terminal?.Terminal || window.Terminal;
  const FitCtor = window.FitAddon?.FitAddon;
  xterm = new TerminalCtor({
    fontSize: 12,
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
    theme: {
      background: '#0d1017', foreground: '#c9d1e3', cursor: '#e8a852',
      selectionBackground: '#2c3654',
    },
    cursorBlink: true,
    scrollback: 5000,
  });
  const fit = FitCtor ? new FitCtor() : null;
  if (fit) xterm.loadAddon(fit);
  xterm.open(slot.querySelector('.xt-host'));
  const doFit = () => {
    if (!fit || !xterm) return;
    try {
      fit.fit();
      if (xtermWs?.readyState === 1) xtermWs.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
    } catch {}
  };
  resizeObs = new ResizeObserver(() => { clearTimeout(fitTimer); fitTimer = setTimeout(doFit, 120); });
  resizeObs.observe(slot);

  xtermWs = new WebSocket(`ws://${location.host}/term/${id}`);
  xtermWs.onopen = () => { doFit(); xterm.focus(); };
  xtermWs.onmessage = (e) => xterm?.write(e.data);
  xtermWs.onclose = () => {
    if (xtermId === id && xterm) xterm.write('\r\n\x1b[90m— detached —\x1b[0m\r\n');
  };
  xterm.onData(d => { if (xtermWs?.readyState === 1) xtermWs.send(JSON.stringify({ type: 'input', data: d })); });
}

async function startTermHere(id) {
  toast('starting terminal…', 8000);
  try {
    const r = await (await fetch(`/api/term/${id}`, { method: 'POST' })).json();
    if (r.ok) { mountXterm(id); toast('attached'); }
    else toast(`couldn't start: ${r.detail || 'unknown'}`, 6000);
  } catch (e) { toast(`couldn't start: ${e.message}`, 6000); }
}

/* Terminal area decision for a session without a live vibedeck terminal. */
function termOffer(d) {
  if (d.state === 'working' && !d.term) {
    const where = d.cmuxPane ? 'in a cmux pane' : 'in another terminal (Ghostty?)';
    return `<div class="term-offer">
      <span>This session is live ${where} — resuming here would fork it.</span>
      ${d.cmuxPane ? `<button class="ghost paper-ghost" id="cmuxBtn">focus cmux ↗</button>` : ''}
    </div>`;
  }
  return `<div class="term-offer">
    <button class="primary" id="startTermBtn">Open terminal here ▸</button>
    <span>picks the conversation back up, right in this pane</span>
    ${d.cmuxPane ? `<button class="ghost paper-ghost" id="cmuxBtn">or in cmux ↗</button>` : ''}
  </div>`;
}

/* ---------- read-only cmux peek (for sessions living in cmux panes) ---------- */
let screenTimer = null;
let lastScreen = { id: null, text: null };

function renderPeek(id) {
  const slot = $('#peekSlot');
  if (!slot || lastScreen.id !== id) return;
  if (!lastScreen.text || xtermId === id) { slot.innerHTML = ''; return; }
  const had = slot.querySelector('pre');
  const atBottom = !had || had.scrollHeight - had.scrollTop - had.clientHeight < 40;
  slot.innerHTML = `<div class="term">
    <div class="term-bar"><span class="term-dot"></span>live from the cmux pane</div>
    <pre>${esc(lastScreen.text)}</pre>
  </div>`;
  const pre = slot.querySelector('pre');
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

async function pollScreen(id) {
  if (xtermId === id) return;
  try {
    const r = await (await fetch(`/api/screen/${id}`)).json();
    if (selectedId !== id) return;
    lastScreen = { id, text: (r.text || '').trimEnd() || null };
    renderPeek(id);
  } catch {}
}

function watchScreen(id, wanted) {
  clearInterval(screenTimer);
  if (!wanted) return;
  pollScreen(id);
  screenTimer = setInterval(() => pollScreen(id), 3000);
}

/* ---------- detail: letter + terminal + gazette ---------- */
function fmtDate(ts) {
  return new Date(ts || Date.now()).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function letterHtml(d) {
  const heroList = d.artHistory || [];
  const latest = heroList[heroList.length - 1];
  const paras = (d.status || '').split(/(?<=\.)\s+/).filter(Boolean);
  return `
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
    </div>`;
}

function gazetteHtml(d) {
  const heroList = d.artHistory || [];
  const exchange = (d.recent || []).slice(-6).map(m => `
    <article class="gz-item">
      <span class="gz-who">${m.role === 'user' ? 'Derek' : 'The agent'}</span>
      <p>${esc(m.text.slice(0, 480))}${m.text.length > 480 ? '…' : ''}</p>
    </article>`).join('');
  const film = heroList.length
    ? `<div class="gz-film">${heroList.slice(-6).map(a => `<img src="${a.url}">`).join('')}</div>`
    : '';
  return `
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
    <div class="gz-foot">${esc(d.resumeCmd || '')}</div>`;
}

async function renderDetail(id, soft = false) {
  let d;
  try { d = await (await fetch(`/api/session/${id}`)).json(); } catch { return; }
  if (selectedId !== id) return;

  const paper = $('#detail .paper');
  const fresh = !paper || paper.dataset.id !== id;
  if (fresh) {
    disposeTerm();
    $('#detail').innerHTML = `<div class="paper" data-id="${id}">
      <div class="letter"><div id="letterSlot"></div><div class="lt-actions" id="actionsSlot"></div></div>
      <div id="termSlot" class="termzone"></div>
      <div id="peekSlot" class="termzone"></div>
      <div class="gazette" id="gazSlot"></div>
    </div>`;
  }
  $('#letterSlot').innerHTML = letterHtml(d);
  $('#gazSlot').innerHTML = gazetteHtml(d);
  $('#actionsSlot').innerHTML = `
    <button class="ghost paper-ghost" id="copyBtn">Copy resume command</button>
    <span class="lt-state pill state-${d.state}"><span class="dot"></span>${STATE_LABEL[d.state] || d.state}</span>`;
  $('#copyBtn')?.addEventListener('click', async () => {
    toast((await safeCopy(d.resumeCmd)) ? 'copied' : 'copy failed — command is printed at the bottom of the gazette');
  });

  // Terminal area
  if (d.term) {
    mountXterm(id);           // no-op if already mounted for this id
  } else if (autostartId === id && d.state !== 'working') {
    autostartId = null;
    startTermHere(id);
  } else if (xtermId !== id) {
    $('#termSlot').innerHTML = termOffer(d);
    $('#startTermBtn')?.addEventListener('click', () => startTermHere(id));
    $('#cmuxBtn')?.addEventListener('click', async () => {
      toast('focusing cmux…', 8000);
      const r = await (await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })).json();
      toast(r.result === 'focused' ? 'focused its cmux pane' : r.result === 'resumed' ? 'resumed in cmux' : `couldn't: ${r.detail || r.result}`, 5000);
    });
  }
  if (autostartId === id) autostartId = null;

  // Read-only peek only makes sense for cmux-resident sessions w/o our terminal
  watchScreen(id, d.cmuxPane && !d.term && xtermId !== id);

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
  toast('starting a new session…', 10000);
  try {
    const r = await (await fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, cwd }) })).json();
    if (r.result === 'started') toast('session born — it will appear in the list as it wakes up');
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

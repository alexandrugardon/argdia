'use strict';
const VERSION = '1.5';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const k in a) {
    if (k === 'class') e.className = a[k];
    else if (k === 'html') e.innerHTML = a[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), a[k]);
    else e.setAttribute(k, a[k]);
  }
  c.flat().forEach(x => e.append(x));
  return e;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SLOTS = [['dim', 'Dimineața'], ['pra', 'Prânz'], ['sea', 'Seara']];
const CTX = [['ajeun', 'À jeun'], ['inainte', 'Înainte de masă'], ['dupa', '2h după masă']];
const PN = Array.from({ length: 12 }, (_, i) => ['p' + (i + 1), (i + 1) + (i === 0 ? ' oră' : ' ore') + ' după masă']);
const EXTRA_OPTS = [['spot', 'Spontană (la nevoie)'], ['ajeun', 'À jeun'], ['inainte', 'Înainte de masă'], ...PN];
const CTXL = Object.fromEntries([...CTX, ...EXTRA_OPTS]);
const DEF_CTX = { dim: 'ajeun', pra: 'inainte', sea: 'inainte' };
const MEALS = [['mic', 'Mic dejun'], ['gdim', 'Gustare dimineață'], ['pranz', 'Prânz'], ['gdupa', 'Gustare după-amiază'], ['cina', 'Cină']];
const STAT_LABEL = { ok: 'în interval', warn: 'ușor în afara', bad: 'în afara intervalului' };

/* ---------- Stocare locală ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
};
const DEF_S = {
  unit: 'mg', clientId: '', sheetId: '', auth: false,
  th: { low: 70, fMin: 70, fMax: 100, iMin: 70, iMax: 130, dMax: 140 },
  times: { dim: '07:30', pra: '13:00', sea: '20:00', i1: '21:00', i2: '21:30' }
};
let S = LS.get('argdia_settings', {});
S = { ...DEF_S, ...S, th: { ...DEF_S.th, ...(S.th || {}) }, times: { ...DEF_S.times, ...(S.times || {}) } };
let DB = LS.get('argdia_data', {});
const saveS = () => LS.set('argdia_settings', S);
const saveDB = () => LS.set('argdia_data', DB);

/* ---------- Date, unități, praguri ---------- */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const roDate = s => parseD(s).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const unitName = () => S.unit === 'mg' ? 'mg/dL' : 'mmol/L';
const fmt = v => S.unit === 'mg' ? String(Math.round(v)) : (v / 18).toFixed(1);
const toMg = x => { const n = parseFloat(String(x).replace(',', '.')); if (!isFinite(n) || n <= 0) return null; return S.unit === 'mg' ? Math.round(n) : Math.round(n * 18); };
const bothUnits = v => `${Math.round(v)} mg/dL = ${(v / 18).toFixed(1)} mmol/L`;

function range(ctx) {
  const t = S.th;
  if (ctx === 'ajeun') return [t.fMin, t.fMax];
  if (ctx === 'inainte') return [t.iMin, t.iMax];
  const m = /^p(\d+)$/.exec(ctx);
  if (m && +m[1] >= 4) return [t.iMin, t.iMax];
  return [t.low, t.dMax];
}
const nowHM = () => new Date().toTimeString().slice(0, 5);
function status(v, ctx) {
  const [lo, hi] = range(ctx);
  if (v < lo) return v < lo * 0.85 ? 'bad' : 'warn';
  if (v > hi) return v > hi * 1.15 ? 'bad' : 'warn';
  return 'ok';
}
const worst = arr => arr.includes('bad') ? 'bad' : arr.includes('warn') ? 'warn' : arr.length ? 'ok' : '';

function measures(rec) {
  const out = [];
  if (!rec) return out;
  if (rec.g) for (const [k, label] of SLOTS) {
    const g = rec.g[k];
    if (g && g.v) { const c = g.c || DEF_CTX[k]; out.push({ slot: k, label, short: label.slice(0, 3) + '.', hour: slotHour(k), v: g.v, c, st: status(g.v, c) }); }
  }
  (rec.x || []).forEach(x => {
    if (!x || !x.v) return;
    const [h, m] = (x.t || '12:00').split(':').map(Number), c = x.c || 'spot';
    out.push({ slot: 'x', label: 'Spontană ' + x.t, short: '⚡' + x.t, hour: h + (m || 0) / 60, v: x.v, c, st: status(x.v, c) });
  });
  return out;
}

/* ---------- Formular "Azi" ---------- */
let curDate = today();
let saveTimer = null;

function buildForms() {
  const gf = $('#glucoseForm'); gf.innerHTML = '';
  for (const [k, label] of SLOTS) {
    const inp = el('input', { type: 'text', inputmode: 'decimal', id: 'g_' + k, placeholder: unitName(), 'aria-label': label + ' glicemie' });
    const sel = el('select', { id: 'c_' + k, 'aria-label': label + ' context' }, CTX.map(([v, t]) => el('option', { value: v }, t)));
    sel.value = DEF_CTX[k];
    const hint = el('div', { class: 'hint', id: 'h_' + k });
    gf.append(el('div', { class: 'card' }, el('div', { class: 'top' }, label), el('div', { class: 'inp' }, inp, sel), hint));
    inp.addEventListener('input', () => { updHint(k); queueSave(); });
    sel.addEventListener('change', () => { updHint(k); queueSave(); });
  }
  const mf = $('#mealForm'); mf.innerHTML = '';
  for (const [k, label] of MEALS) {
    const dl = el('datalist', { id: 'dl_' + k });
    const inp = el('input', { type: 'text', id: 'm_' + k, list: 'dl_' + k, placeholder: 'ce ai mâncat…', autocomplete: 'off' });
    mf.append(el('label', {}, label, inp, dl));
    inp.addEventListener('input', queueSave);
  }
}
function addExtraRow(x = {}) {
  const t = el('input', { type: 'time', class: 'x-t', 'aria-label': 'Ora măsurării' }); t.value = x.t || nowHM();
  const v = el('input', { type: 'text', inputmode: 'decimal', class: 'x-v', placeholder: unitName(), 'aria-label': 'Glicemie suplimentară' });
  if (x.v) v.value = fmt(x.v);
  const c = el('select', { class: 'x-c', 'aria-label': 'Context' }, EXTRA_OPTS.map(([a, b]) => el('option', { value: a }, b)));
  c.value = x.c === 'dupa' ? 'p2' : (x.c || 'spot');
  const h = el('div', { class: 'hint' });
  const rm = el('button', { type: 'button', 'aria-label': 'Șterge măsurătoarea', onclick: () => { row.remove(); queueSave(); } }, '✕');
  const upd = () => {
    const mv = toMg(v.value);
    if (!mv) { h.innerHTML = ''; return; }
    const st = status(mv, c.value), other = S.unit === 'mg' ? (mv / 18).toFixed(1) + ' mmol/L' : mv + ' mg/dL';
    h.innerHTML = `<span class="chip ${st}">${STAT_LABEL[st]}</span> <span class="muted">= ${other}</span>`;
  };
  const row = el('div', { class: 'card x-row' }, el('div', { class: 'top' }, 'Glicemie suplimentară', rm), el('div', { class: 'inp3' }, t, v, c), h);
  [t, v, c].forEach(e => e.addEventListener('input', () => { upd(); queueSave(); }));
  upd(); $('#extraForm').append(row);
  return row;
}
function fillSuggestions() {
  for (const [k] of MEALS) {
    const cnt = {};
    Object.values(DB).forEach(r => { const t = r.m && r.m[k]; if (t) cnt[t] = (cnt[t] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 30).map(x => x[0]);
    const dl = $('#dl_' + k); dl.innerHTML = '';
    top.forEach(t => dl.append(el('option', { value: t })));
  }
}
function updHint(k) {
  const v = toMg($('#g_' + k).value), h = $('#h_' + k);
  if (!v) { h.innerHTML = ''; return; }
  const st = status(v, $('#c_' + k).value);
  const other = S.unit === 'mg' ? (v / 18).toFixed(1) + ' mmol/L' : v + ' mg/dL';
  h.innerHTML = `<span class="chip ${st}">${STAT_LABEL[st]}</span> <span class="muted">= ${other}</span>`;
}
function loadDay(d) {
  curDate = d; $('#date').value = d;
  const r = DB[d] || {};
  for (const [k] of SLOTS) {
    const g = (r.g && r.g[k]) || {};
    $('#g_' + k).value = g.v ? fmt(g.v) : '';
    $('#c_' + k).value = g.c || DEF_CTX[k];
    updHint(k);
  }
  $('#extraForm').innerHTML = ''; (r.x || []).forEach(addExtraRow);
  for (const [k] of MEALS) $('#m_' + k).value = (r.m && r.m[k]) || '';
  $('#ins').value = r.ins || ''; $('#act').value = r.act || ''; $('#kg').value = r.kg || ''; $('#ta').value = r.ta || ''; $('#note').value = r.note || '';
  $('#saved').textContent = '';
}
function collect() {
  const r = { g: {}, x: [], m: {}, ins: $('#ins').value.trim(), act: $('#act').value.trim(), kg: $('#kg').value.trim(), ta: $('#ta').value.trim(), note: $('#note').value.trim() };
  for (const [k] of SLOTS) { const v = toMg($('#g_' + k).value); if (v) r.g[k] = { v, c: $('#c_' + k).value }; }
  r.x = $$('#extraForm .x-row').map(row => ({ t: row.querySelector('.x-t').value, v: toMg(row.querySelector('.x-v').value), c: row.querySelector('.x-c').value })).filter(o => o.v).sort((a, b) => a.t.localeCompare(b.t));
  for (const [k] of MEALS) { const t = $('#m_' + k).value.trim(); if (t) r.m[k] = t; }
  const empty = !Object.keys(r.g).length && !r.x.length && !Object.keys(r.m).length && !r.ins && !r.act && !r.kg && !r.ta && !r.note;
  return empty ? null : r;
}
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }
function saveNow() {
  const r = collect();
  if (r) { r.upd = new Date().toISOString(); DB[curDate] = r; }
  else if (DB[curDate]) { DB[curDate] = { g: {}, m: {}, act: '', kg: '', ta: '', note: '', upd: new Date().toISOString(), del: true }; }
  saveDB(); fillSuggestions();
  $('#saved').textContent = '✓ Salvat pe acest dispozitiv ' + new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  scheduleSync();
}
const live = () => Object.keys(DB).filter(d => !DB[d].del).sort();

/* ---------- Istoric ---------- */
function renderHist() {
  const box = $('#histList'); box.innerHTML = '';
  const days = live().reverse();
  if (!days.length) { box.append(el('p', { class: 'muted' }, 'Nu ai încă nicio înregistrare.')); return; }
  for (const d of days) {
    const r = DB[d];
    const chips = measures(r).map(m => `<span class="chip ${m.st}">${esc(m.short)} ${fmt(m.v)}</span>`).join(' ');
    const meals = MEALS.map(([k, l]) => r.m && r.m[k] ? l + ': ' + esc(r.m[k]) : '').filter(Boolean).join(' · ');
    const b = el('button', { class: 'hist', onclick: () => { openDay(d); } });
    b.innerHTML = `<b>${roDate(d)}</b><br>${chips || '<span class="muted">fără glicemie</span>'}<div class="meals">${r.ins ? '💉 ' + esc(r.ins) + ' u · ' : ''}${meals}</div>`;
    box.append(b);
  }
}
function openDay(d) { showTab('azi'); loadDay(d); }

/* ---------- Grafic ---------- */
let chartDays = 30;
const slotHour = k => { const [h, m] = (S.times[k] || '12:00').split(':').map(Number); return h + m / 60; };

function drawChart(canvas, from, to, h = 280) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  canvas.width = W * dpr; canvas.height = h * dpr; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim() || '#888';
  ctx.clearRect(0, 0, W, h);
  const pts = [];
  const t0 = parseD(from).getTime(), t1 = parseD(addDays(to, 1)).getTime();
  for (const d of live()) {
    if (d < from || d > to) continue;
    const base = parseD(d).getTime();
    measures(DB[d]).forEach(m => pts.push({ t: base + m.hour * 3600000, v: m.v, st: m.st }));
  }
  const L = 38, R = 10, T = 12, B = 26, pw = W - L - R, ph = h - T - B;
  let lo = 50, hi = 180;
  pts.forEach(p => { lo = Math.min(lo, p.v - 10); hi = Math.max(hi, p.v + 10); });
  const X = t => L + (t - t0) / (t1 - t0) * pw, Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;
  ctx.font = '11px system-ui'; ctx.fillStyle = col('--muted'); ctx.strokeStyle = col('--line');
  // bandă interval
  ctx.fillStyle = col('--okbg'); ctx.fillRect(L, Y(S.th.dMax), pw, Y(S.th.low) - Y(S.th.dMax));
  ctx.fillStyle = col('--muted');
  const step = (hi - lo) > 200 ? 50 : 25;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4, Y(v) + 4);
  }
  const nd = Math.round((t1 - t0) / 86400000), every = Math.max(1, Math.ceil(nd / 7));
  ctx.textAlign = 'center';
  for (let i = 0; i < nd; i += every) {
    const dd = parseD(addDays(from, i));
    ctx.fillText(dd.getDate() + '.' + (dd.getMonth() + 1), X(dd.getTime() + 43200000), h - 8);
  }
  pts.sort((a, b) => a.t - b.t);
  ctx.strokeStyle = col('--muted'); ctx.lineWidth = 1.2; ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))); ctx.stroke();
  pts.forEach(p => { ctx.fillStyle = col('--' + p.st); ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), 4, 0, 7); ctx.fill(); });
  if (!pts.length) { ctx.fillStyle = col('--muted'); ctx.textAlign = 'center'; ctx.fillText('Nicio măsurătoare în perioada aleasă', W / 2, h / 2); }
}
function stats(from, to) {
  const all = []; const bySlot = { dim: [], pra: [], sea: [] };
  for (const d of live()) {
    if (d < from || d > to) continue;
    measures(DB[d]).forEach(m => { all.push(m); if (bySlot[m.slot]) bySlot[m.slot].push(m.v); });
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return {
    n: all.length, avg: avg(all.map(m => m.v)),
    min: all.length ? Math.min(...all.map(m => m.v)) : null,
    max: all.length ? Math.max(...all.map(m => m.v)) : null,
    inr: all.length ? Math.round(100 * all.filter(m => m.st === 'ok').length / all.length) : null,
    bySlot: Object.fromEntries(SLOTS.map(([k]) => [k, avg(bySlot[k])]))
  };
}
const statHtml = s => {
  const f = v => v == null ? '–' : fmt(v);
  return `<div class="stats">
    <div><b>${s.n}</b>măsurători</div><div><b>${f(s.avg)}</b>medie ${unitName()}</div>
    <div><b>${f(s.min)}</b>minim</div><div><b>${f(s.max)}</b>maxim</div>
    <div><b>${s.inr == null ? '–' : s.inr + '%'}</b>în interval</div>
    ${SLOTS.map(([k, l]) => `<div><b>${f(s.bySlot[k])}</b>medie ${l.toLowerCase()}</div>`).join('')}</div>`;
};
function renderChart() {
  const to = today(), from = addDays(to, -(chartDays - 1));
  drawChart($('#chart'), from, to);
  $('#chartStats').innerHTML = statHtml(stats(from, to));
}

/* ---------- Calendar ---------- */
let calMonth = new Date(); calMonth.setDate(1);
function renderCal() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#monthLabel').textContent = calMonth.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
  const g = $('#calGrid'); g.innerHTML = '';
  ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'].forEach(x => g.append(el('div', { class: 'hd' }, x)));
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) g.append(el('div', { class: 'cell empty' }));
  const n = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= n; d++) {
    const ds = ymd(new Date(y, m, d)), ms = measures(DB[ds] && !DB[ds].del ? DB[ds] : null);
    const w = worst(ms.map(x => x.st));
    const avg = ms.length ? fmt(ms.reduce((a, x) => a + x.v, 0) / ms.length) : '';
    const c = el('div', { class: 'cell ' + w, onclick: () => openDay(ds), role: 'button', tabindex: '0', 'aria-label': `${d}: ${avg || 'fără date'} ${w ? STAT_LABEL[w] : ''}` });
    c.innerHTML = `<b>${d}</b>${avg}`;
    g.append(c);
  }
}

/* ---------- Raport ---------- */
function renderReport() {
  const from = $('#repFrom').value, to = $('#repTo').value;
  if (!from || !to) return;
  const days = live().filter(d => d >= from && d <= to);
  let h = `<h2>ARGDIA – Raport glicemie</h2><p>Perioada: ${roDate(from)} – ${roDate(to)} · valori în ${unitName()}</p>`;
  h += statHtml(stats(from, to));
  h += '<canvas id="repChart" style="width:100%"></canvas>';
  h += `<p class="muted">Praguri folosite (mg/dL): à jeun ${S.th.fMin}–${S.th.fMax}; înainte de masă ${S.th.iMin}–${S.th.iMax}; 2h după masă ${S.th.low}–${S.th.dMax}.</p>`;
  h += '<table><tr><th>Data</th>' + SLOTS.map(([, l]) => `<th>${l}</th>`).join('') + '<th>Suplimentare</th><th>Mâncare</th><th>Alte</th></tr>';
  for (const d of days) {
    const r = DB[d];
    h += `<tr><td>${roDate(d)}</td>`;
    for (const [k] of SLOTS) {
      const g = r.g && r.g[k];
      h += g && g.v ? `<td class="${status(g.v, g.c)}">${fmt(g.v)}<br><small>${esc(CTXL[g.c] || '')}</small></td>` : '<td></td>';
    }
    h += '<td>' + measures(r).filter(m => m.slot === 'x').map(m => `<span class="chip ${m.st}">${m.short} ${fmt(m.v)}</span> <small>${esc(CTXL[m.c] || '')}</small>`).join('<br>') + '</td>';
    const meals = MEALS.map(([k, l]) => r.m && r.m[k] ? `<b>${l}:</b> ${esc(r.m[k])}` : '').filter(Boolean).join('<br>');
    const oth = [r.ins && 'Insulină: ' + esc(r.ins) + ' u', r.act && 'Activitate: ' + esc(r.act), r.kg && r.kg + ' kg', r.ta && 'TA ' + esc(r.ta), r.note && esc(r.note)].filter(Boolean).join('<br>');
    h += `<td>${meals}</td><td>${oth}</td></tr>`;
  }
  h += '</table>';
  $('#repOut').innerHTML = h;
  drawChart($('#repChart'), from, to, 220);
}

/* ---------- Setări, CSV, memento-uri ---------- */
function loadSettingsUI() {
  $('#unit').value = S.unit;
  for (const k of Object.keys(S.th)) $('#th_' + k).value = S.th[k];
  $('#clientId').value = S.clientId;
  for (const k of ['dim', 'pra', 'sea', 'i1', 'i2']) $('#t_' + k).value = S.times[k];
  $('#ver').textContent = VERSION;
  $('#sheetLink').innerHTML = S.sheetId ? `Foaia ta: <a href="https://docs.google.com/spreadsheets/d/${esc(S.sheetId)}" target="_blank" rel="noopener">deschide în Google Sheets</a>` : '';
  $('#connectBtn').textContent = S.auth ? 'Reconectează Google Drive' : 'Conectează Google Drive';
}
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
function exportCSV() {
  const { head, rows } = tableRows();
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  download('argdia-' + today() + '.csv', '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
}
function makeICS() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const day = today().replace(/-/g, '');
  const items = [
    ...SLOTS.map(([k, l]) => [k, S.times[k], `Măsoară glicemia (${l.toLowerCase()})`]),
    ['i1', S.times.i1, 'Scoate insulina din frigider'],
    ['i2', S.times.i2, 'Administrează-ți insulina']
  ];
  const ev = items.map(([k, tm, title]) => {
    const t = (tm || '08:00').replace(':', '') + '00';
    return ['BEGIN:VEVENT', `UID:argdia-${k}@argdia`, `DTSTAMP:${stamp}`, `DTSTART:${day}T${t}`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      `SUMMARY:${title}`, 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  download('argdia-memento.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ARGDIA//RO', ...ev, 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
}

/* ---------- Sincronizare Google Drive / Sheets ---------- */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SHEET_NAME = 'ARGDIA - Date';
let tokenClient = null, token = null, tokenExp = 0, syncTimer = null, syncing = false;

function setStatus(t) { $('#syncStatus').textContent = t; }
window.gsiReady = () => initGoogle();
function initGoogle() {
  if (!S.clientId || !window.google || !google.accounts) return;
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: S.clientId, scope: SCOPE, callback: () => { } });
}
function getToken(interactive) {
  return new Promise((res, rej) => {
    if (token && Date.now() < tokenExp - 60000) return res(token);
    if (!tokenClient) return rej(new Error('Google nu este configurat (lipsește Client ID).'));
    tokenClient.callback = r => {
      if (r.error) return rej(new Error(r.error));
      token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
      S.auth = true; saveS(); res(token);
    };
    tokenClient.error_callback = e => rej(new Error(e.type || 'eroare autentificare'));
    const o = { prompt: interactive && !S.auth ? 'consent' : '' };
    if (S.email) o.hint = S.email;
    tokenClient.requestAccessToken(o);
  });
}
async function api(url, opts = {}) {
  const t = await getToken(opts.interactive);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('Google API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function ensureSheet(interactive) {
  if (S.sheetId) return S.sheetId;
  const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const f = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, { interactive });
  if (f.files && f.files.length) S.sheetId = f.files[0].id;
  else {
    const c = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', interactive, body: JSON.stringify({ properties: { title: SHEET_NAME }, sheets: [{ properties: { title: 'Date' } }] }) });
    S.sheetId = c.spreadsheetId;
  }
  saveS(); loadSettingsUI();
  return S.sheetId;
}
function tableRows() {
  const head = ['Data'];
  SLOTS.forEach(([k, l]) => head.push('Glicemie ' + l + ' (mg/dL)', 'Context ' + l));
  MEALS.forEach(([, l]) => head.push(l));
  head.push('Activitate', 'Greutate', 'Tensiune', 'Note', 'Actualizat', 'Sters', 'Insulina (unitati)', 'Glicemii suplimentare (ora=mg/dL=context)');
  const rows = Object.keys(DB).sort().map(d => {
    const r = DB[d], row = [d];
    SLOTS.forEach(([k]) => { const g = r.g && r.g[k]; row.push(g ? g.v : '', g ? g.c : ''); });
    MEALS.forEach(([k]) => row.push((r.m && r.m[k]) || ''));
    row.push(r.act || '', r.kg || '', r.ta || '', r.note || '', r.upd || '', r.del ? 'da' : '', r.ins || '', (r.x || []).map(x => `${x.t}=${x.v}=${x.c}`).join(';'));
    return row;
  });
  return { head, rows };
}
function rowToRec(row) {
  const r = { g: {}, m: {}, act: '', kg: '', ta: '', note: '', upd: '' };
  let i = 1;
  SLOTS.forEach(([k]) => { const v = Number(row[i]), c = row[i + 1]; if (v) r.g[k] = { v, c: c || DEF_CTX[k] }; i += 2; });
  MEALS.forEach(([k]) => { if (row[i]) r.m[k] = String(row[i]); i++; });
  r.act = String(row[i++] ?? ''); r.kg = String(row[i++] ?? ''); r.ta = String(row[i++] ?? ''); r.note = String(row[i++] ?? '');
  r.upd = String(row[i++] ?? ''); if (row[i] === 'da') r.del = true;
  r.ins = String(row[i + 1] ?? '');
  r.x = String(row[i + 2] ?? '').split(';').filter(Boolean).map(p => { const [t, v, c] = p.split('='); return { t, v: Number(v), c: c || 'spot' }; }).filter(o => o.v);
  return r;
}
async function syncNow(interactive) {
  if (syncing) return;
  if (!S.clientId) { if (interactive) alert('Introdu mai întâi Google Client ID în Setări.'); return; }
  if (!navigator.onLine) { setStatus('Offline – se sincronizează mai târziu'); return; }
  syncing = true; setStatus('Se sincronizează…');
  try {
    if (!tokenClient) initGoogle();
    const id = await ensureSheet(interactive);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Date`;
    const got = await api(base + '!A1:Z5000?valueRenderOption=UNFORMATTED_VALUE', { interactive });
    (got.values || []).slice(1).forEach(row => {
      if (!row[0]) return;
      const d = String(row[0]), rec = rowToRec(row);
      if (!DB[d] || (rec.upd || '') > (DB[d].upd || '')) DB[d] = rec;
    });
    saveDB();
    const { head, rows } = tableRows();
    await api(base + '!A1?valueInputOption=RAW', { method: 'PUT', interactive, body: JSON.stringify({ values: [head, ...rows] }) });
    S.lastSync = new Date().toISOString(); saveS();
    setStatus('✓ Sincronizat ' + new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
    fillSuggestions(); loadDay(curDate); refreshView();
  } catch (e) {
    console.error(e);
    setStatus('⚠ Nesincronizat – apasă „Sincronizează”');
    if (interactive) alert('Sincronizarea a eșuat:\n' + e.message);
  } finally { syncing = false; }
}
function scheduleSync() {
  if (!S.auth || !S.clientId) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 3000);
}

/* ---------- Navigare ---------- */
let curTab = 'azi';
function showTab(t) {
  curTab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach(s => s.hidden = s.id !== 'tab-' + t);
  refreshView();
}
function refreshView() {
  if (curTab === 'istoric') renderHist();
  else if (curTab === 'grafic') renderChart();
  else if (curTab === 'calendar') renderCal();
  else if (curTab === 'raport') renderReport();
}

/* ---------- Pornire ---------- */
function init() {
  buildForms(); fillSuggestions(); loadSettingsUI(); loadDay(today());
  $$('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#date').addEventListener('change', e => { saveNow(); loadDay(e.target.value || today()); });
  $('#prevDay').onclick = () => { saveNow(); loadDay(addDays(curDate, -1)); };
  $('#addExtra').onclick = () => { const r = addExtraRow(); r.querySelector('.x-v').focus(); queueSave(); };
  $('#nextDay').onclick = () => { saveNow(); loadDay(addDays(curDate, 1)); };
  $('#todayBtn').onclick = () => { saveNow(); loadDay(today()); };
  ['ins', 'act', 'kg', 'ta', 'note'].forEach(i => $('#' + i).addEventListener('input', queueSave));
  $$('#rangeSeg button').forEach(b => b.onclick = () => {
    chartDays = +b.dataset.d; $$('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b)); renderChart();
  });
  $('#prevMonth').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCal(); };
  $('#nextMonth').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCal(); };
  $('#repTo').value = today(); $('#repFrom').value = addDays(today(), -29);
  $('#repGo').onclick = renderReport;
  $('#repPrint').onclick = () => { renderReport(); setTimeout(() => window.print(), 300); };
  $('#unit').onchange = e => { saveNow(); S.unit = e.target.value; saveS(); buildForms(); fillSuggestions(); loadDay(curDate); refreshView(); };
  for (const k of Object.keys(S.th)) $('#th_' + k).onchange = e => { const v = parseInt(e.target.value, 10); if (v > 0) { S.th[k] = v; saveS(); loadDay(curDate); } };
  $('#clientId').onchange = e => { S.clientId = e.target.value.trim(); S.sheetId = ''; S.auth = false; saveS(); tokenClient = null; initGoogle(); loadSettingsUI(); };
  for (const k of ['dim', 'pra', 'sea', 'i1', 'i2']) $('#t_' + k).onchange = e => { S.times[k] = e.target.value; saveS(); };
  $('#connectBtn').onclick = () => { S.clientId = $('#clientId').value.trim(); saveS(); initGoogle(); syncNow(true); };
  $('#syncBtn').onclick = () => syncNow(true);
  $('#icsBtn').onclick = makeICS;
  $('#csvBtn').onclick = exportCSV;
  window.addEventListener('online', scheduleSync);
  // Reînnoiește accesul Google la prima atingere (browserul permite fereastra doar după un gest al utilizatorului)
  let lastTry = 0;
  document.addEventListener('pointerdown', () => {
    if (S.auth && S.clientId && (!token || Date.now() > tokenExp - 60000) && Date.now() - lastTry > 600000) { lastTry = Date.now(); syncNow(false); }
  }, true);
  $('#gEmail').value = S.email || '';
  $('#gEmail').onchange = e => { S.email = e.target.value.trim(); saveS(); };
  window.addEventListener('resize', () => { if (curTab === 'grafic') renderChart(); });
  if (S.lastSync) setStatus('Ultima sincronizare: ' + new Date(S.lastSync).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  if (window.google && google.accounts) initGoogle();
}
init();

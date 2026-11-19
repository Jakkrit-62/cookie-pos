/* ==========================================================================
   iPad POS — kds.js  (v3)  Kitchen / order-queue display for a 2nd iPad
   Same URL as the POS: Settings ▸ เครื่องนี้ ▸ “จอจัดออเดอร์ (KDS)”.
   • Polls GET ?action=PULL_KITCHEN every few seconds (read-only, no lock on the sheet)
   • “เสร็จแล้ว” / “เรียกคืน” are queued as KITCHEN_STATUS actions → the normal retry queue
   • Ding on a new order · alarm + flashing red card when the POS voids a pending order
   ========================================================================== */
'use strict';

const kds = {
  tickets: [],          // from the server, merged with local overrides
  overrides: {},        // id → { status, at } (optimistic until the server catches up)
  known: null,          // Set of ids seen (null = first load: no sound)
  wasPending: new Set(),
  voidAlerts: new Set(),
  acked: new Set(),
  timer: null,
  tick: null,
  busy: false,
  lastOk: 0,
  error: '',
  audio: null,
  lastDone: null,       // { id, q, at } for the quick-undo bar
};

/* ---------------- sound ---------------- */
function kdsAudio() {
  if (kds.audio) return kds.audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  kds.audio = new AC();
  return kds.audio;
}
function kdsUnlockAudio() {
  const a = kdsAudio();
  if (a && a.state === 'suspended') a.resume();
  // a silent blip unlocks iOS audio
  if (a) { const o = a.createOscillator(); const g = a.createGain(); g.gain.value = 0.0001; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.02); }
  renderKdsTop();
}
function kdsTone(freq, start, dur, type = 'sine', vol = 0.35) {
  const a = kds.audio;
  if (!a || a.state !== 'running') return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
const kdsDing = () => { kdsTone(1046, 0, 0.35); kdsTone(1568, 0.18, 0.6); };
const kdsAlarm = () => { for (let i = 0; i < 6; i++) kdsTone(i % 2 ? 660 : 880, i * 0.22, 0.2, 'square', 0.25); };
const kdsSoundOn = () => !!(kds.audio && kds.audio.state === 'running');

/* ---------------- data ---------------- */
function kdsParseTicket(r) {
  let k = r.items;
  if (typeof k === 'string') { try { k = JSON.parse(k); } catch (e) { k = null; } }
  k = k || {};
  return {
    id: String(r.id),
    q: String(r.q || k.q || ''),
    status: String(r.status || 'PENDING'),
    t: String(k.t || r.createdISO || ''),
    note: String(k.note || r.note || ''),
    staff: String(k.staff || r.staff || ''),
    device: String(r.device || ''),
    items: Array.isArray(k.items) ? k.items : [],
    prep: k.prep && typeof k.prep === 'object' ? k.prep : {},
    updatedAt: Number(r.updatedAt) || 0,
  };
}

async function kdsPoll() {
  clearTimeout(kds.timer);
  const url = (state.settings.gasUrl || '').trim();
  const next = () => { kds.timer = setTimeout(kdsPoll, prefs().kds.pollSec * 1000); };
  if (!url) { kds.error = 'ยังไม่ได้ตั้ง Google Sheets URL — ไปที่ ตั้งค่า ▸ เครื่องนี้'; renderKds(); return next(); }
  if (kds.busy) return next();
  kds.busy = true;
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await cloudFetch(`${url}${sep}action=PULL_KITCHEN_QUEUE&hours=3&_=${Date.now()}`, { method: 'GET' }, 15000);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'PULL_KITCHEN failed');
    kdsMerge((json.result.orders || []).map(kdsParseTicket));
    kds.lastOk = Date.now();
    kds.error = '';
  } catch (e) {
    kds.error = e && e.auth ? 'เซสชันหมดอายุ — กดรีเฟรชเพื่อ Login ใหม่'
      : navigator.onLine ? `เชื่อมต่อ Cloud ไม่ได้: ${e.message || e}` : 'ออฟไลน์ — กำลังรอสัญญาณอินเทอร์เน็ต';
  } finally {
    kds.busy = false;
    renderKds();
    next();
  }
}

function kdsMerge(list) {
  const now = Date.now();
  for (const t of list) {
    const ov = kds.overrides[t.id];
    if (ov) {
      if (t.updatedAt >= ov.at || now - ov.at > 10 * 60000) delete kds.overrides[t.id];
      else t.status = ov.status;
    }
  }
  const first = kds.known === null;
  if (first) kds.known = new Set();
  let fresh = 0;
  let voided = 0;
  for (const t of list) {
    if (!kds.known.has(t.id)) {
      kds.known.add(t.id);
      if (!first && t.status === 'PENDING') fresh++;
    }
    if (t.status === 'PENDING') kds.wasPending.add(t.id);
    if (t.status === 'VOIDED' && kds.wasPending.has(t.id) && !kds.acked.has(t.id) && !kds.voidAlerts.has(t.id)) {
      kds.voidAlerts.add(t.id);
      voided++;
    }
  }
  kds.tickets = list;
  if (voided) { kdsAlarm(); toast(`⚠️ ออเดอร์ถูกยกเลิก ${voided} รายการ — หยุดทำ!`, 'error', 6000); }
  else if (fresh) kdsDing();
}

function kdsSetStatus(id, status) {
  const t = kds.tickets.find((x) => x.id === id);
  if (!t) return;
  const at = Date.now();
  kds.overrides[id] = { status, at };
  t.status = status;
  t.updatedAt = at;
  if (status === 'PENDING') kds.wasPending.add(id);
  enqueue('UPDATE_KITCHEN_STATUS', '', { orderId: id, status, at, device: state.settings.devicePrefix, queueNo: t.q }, `คิว #${t.q} → ${status === 'DONE' ? 'เสร็จ' : 'รอทำ'}`);
  kds.lastDone = status === 'DONE' ? { id, q: t.q, at } : null;
  renderKds();
  syncNow({ silent: true });
}

/* ---------------- UI ---------------- */
function startKDS() {
  let root = $('#kds');
  if (!root) {
    root = document.createElement('div');
    root.id = 'kds';
    root.innerHTML = `
      <header class="kds-top" id="kdsTop"></header>
      <div class="kds-body">
        <main class="kds-grid" id="kdsGrid"></main>
        <aside class="kds-side" id="kdsSide"></aside>
      </div>`;
    document.body.insertBefore(root, document.body.firstChild);
    root.addEventListener('click', kdsClick);
    document.addEventListener('pointerdown', () => { if (!kdsSoundOn()) kdsUnlockAudio(); }, { once: true, capture: true });
  }
  renderKds();
  kdsPoll();
  clearInterval(kds.tick);
  kds.tick = setInterval(kdsTickClock, 1000);
  window.addEventListener('online', kdsPoll);
}

const kdsActive = () => kds.tickets.filter((t) => t.status === 'PENDING' || kds.voidAlerts.has(t.id))
  .sort((a, b) => (a.t < b.t ? -1 : 1));

function kdsElapsed(iso) {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { m, text: m >= 60 ? `${Math.floor(m / 60)}ชม. ${m % 60}น.` : `${m}:${pad(s)}` };
}
function kdsAgeClass(m) {
  const k = prefs().kds;
  return m >= k.lateMin ? 'late' : m >= k.warnMin ? 'warn' : '';
}

function renderKdsTop() {
  const top = $('#kdsTop');
  if (!top) return;
  const pending = kds.tickets.filter((t) => t.status === 'PENDING').length;
  const ago = kds.lastOk ? Math.round((Date.now() - kds.lastOk) / 1000) : null;
  top.innerHTML = `
    <div class="kds-brand"><img src="./icons/logo-mascot.png" alt="" /><div><b>${esc(state.settings.shopName)}</b><small>จอจัดออเดอร์ · ${esc(state.settings.devicePrefix)}</small></div></div>
    <div class="kds-count"><b>${pending}</b><span>ออเดอร์รอทำ</span></div>
    <div class="kds-clock" id="kdsClock">${esc(fmtDateTime(new Date()).slice(11, 16))}</div>
    <span class="grow"></span>
    <span class="kds-conn ${kds.error ? 'bad' : 'ok'}" id="kdsConn">${kds.error ? '● ออฟไลน์' : `● อัปเดต ${ago == null ? '…' : `${ago} วิที่แล้ว`}`}</span>
    ${kdsSoundOn() ? `<span class="kds-sound on">${svg('bell', 18)} เสียงเปิด</span>` : `<button class="btn btn-primary" data-kds="sound" type="button">${svg('bell', 18)} แตะเพื่อเปิดเสียง</button>`}
    <button class="hbtn" data-kds="refresh" type="button">${svg('refresh', 18)}</button>
    <button class="hbtn" data-kds="settings" type="button">${svg('sliders', 18)} ตั้งค่า</button>`;
}

function kdsTicketHTML(t) {
  const isVoid = kds.voidAlerts.has(t.id);
  const el = kdsElapsed(t.t);
  return `
    <article class="kds-card ${isVoid ? 'is-void' : kdsAgeClass(el.m)}" data-id="${esc(t.id)}">
      <div class="kds-card-head">
        <b class="kds-q">#${esc(t.q || t.id.slice(-3))}</b>
        <span class="kds-el" data-t="${esc(t.t)}">${esc(el.text)}</span>
      </div>
      <div class="kds-meta">${esc(t.t.slice(11, 16))} น. · ${esc(t.device)}${t.staff ? ` · ${esc(t.staff)}` : ''}</div>
      ${isVoid ? '<div class="kds-void-banner">❌ ยกเลิกออเดอร์ — หยุดทำ!</div>' : ''}
      ${t.note ? `<div class="kds-note">📝 ${esc(t.note)}</div>` : ''}
      <ul class="kds-items">${t.items.map((i) => `
        <li><span class="kds-qty">${esc(i.q)}</span><div><b>${esc(i.n)}</b>
          ${(i.o || []).length ? `<small>${i.o.map(esc).join(' · ')}</small>` : ''}
          ${i.note ? `<em>📝 ${esc(i.note)}</em>` : ''}</div></li>`).join('') || '<li><div><small>(ไม่มีรายการที่ต้องทำในครัว)</small></div></li>'}</ul>
      ${isVoid ? `<button class="btn btn-danger btn-lg btn-block" data-kds="ack" data-id="${esc(t.id)}" type="button">รับทราบ</button>`
    : `<button class="btn btn-ok btn-lg btn-block kds-done" data-kds="done" data-id="${esc(t.id)}" type="button">✓ เสร็จแล้ว</button>`}
    </article>`;
}

function kdsSummaryHTML(active) {
  const items = {};
  const prep = {};
  for (const t of active) {
    if (kds.voidAlerts.has(t.id)) continue;
    for (const i of t.items) {
      const opts = (i.o || []).filter((x) => !/^\+ แถม/.test(x));
      const key = `${i.n}${opts.length ? ` (${opts.join(', ')})` : ''}`;
      const m = String(i.q).match(/([\d,.]+)/);
      const n = i.g ? i.g : m ? parseFloat(m[1].replace(/,/g, '')) : 1;
      const unit = /ก\./.test(i.q) ? ' ก.' : '';
      const x = items[key] || (items[key] = { n: 0, unit });
      x.n += n;
    }
    for (const k in t.prep) prep[k] = (prep[k] || 0) + t.prep[k];
  }
  const rows = Object.keys(items).sort((a, b) => items[b].n - items[a].n);
  const prepRows = Object.keys(prep).sort((a, b) => prep[b] - prep[a]);
  const done = kds.tickets.filter((t) => t.status === 'DONE').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  return `
    ${kds.lastDone && Date.now() - kds.lastDone.at < 15000 ? `<button class="btn btn-outline btn-block kds-undo" data-kds="undo" data-id="${esc(kds.lastDone.id)}" type="button">${svg('undo', 18)} ย้อนกลับ #${esc(kds.lastDone.q)}</button>` : ''}
    <div class="kds-side-title">ต้องเตรียมรวม</div>
    ${rows.length ? `<ul class="kds-sum">${rows.map((k) => `<li><span>${esc(k)}</span><b>${fmtNum(items[k].n)}${items[k].unit}</b></li>`).join('')}</ul>` : '<div class="help">ไม่มีออเดอร์ค้าง 🎉</div>'}
    ${prepRows.length ? `<div class="kds-side-title">วัตถุดิบ / สต็อกที่ใช้</div><ul class="kds-sum sub">${prepRows.map((k) => { const [name, unit] = k.split('|'); return `<li><span>${esc(name)}</span><b>${fmtNum(prep[k])} ${esc(unit || '')}</b></li>`; }).join('')}</ul>` : ''}
    <div class="kds-side-title">เสร็จล่าสุด</div>
    ${done.length ? `<ul class="kds-done-list">${done.map((t) => `<li><b>#${esc(t.q)}</b><span>${esc(t.items.map((i) => `${i.n} ${i.q}`).join(', '))}</span>
      <button class="btn btn-ghost btn-sm" data-kds="recall" data-id="${esc(t.id)}" type="button">${svg('undo', 16)} เรียกคืน</button></li>`).join('')}</ul>` : '<div class="help">—</div>'}`;
}

function renderKds() {
  if (!$('#kds')) return;
  renderKdsTop();
  const active = kdsActive();
  const grid = $('#kdsGrid');
  grid.innerHTML = active.length ? active.map(kdsTicketHTML).join('')
    : `<div class="kds-empty">${svg('chef', 64)}<p>${kds.known === null ? (kds.error ? esc(kds.error) : 'กำลังโหลดคิว…') : 'ไม่มีออเดอร์รอทำ'}</p></div>`;
  $('#kdsSide').innerHTML = kdsSummaryHTML(active);
  document.body.classList.toggle('kds-alert', kds.voidAlerts.size > 0);
}

function kdsTickClock() {
  const c = $('#kdsClock');
  if (c) c.textContent = fmtDateTime(new Date()).slice(11, 16);
  for (const el of $$('#kdsGrid .kds-el')) {
    const e = kdsElapsed(el.dataset.t);
    el.textContent = e.text;
    const card = el.closest('.kds-card');
    if (!card.classList.contains('is-void')) {
      card.classList.toggle('warn', kdsAgeClass(e.m) === 'warn');
      card.classList.toggle('late', kdsAgeClass(e.m) === 'late');
    }
  }
  const conn = $('#kdsConn');
  if (conn && !kds.error && kds.lastOk) conn.textContent = `● อัปเดต ${Math.round((Date.now() - kds.lastOk) / 1000)} วิที่แล้ว`;
  if (kds.lastDone && Date.now() - kds.lastDone.at >= 15000 && $('.kds-undo')) { kds.lastDone = null; $('#kdsSide').innerHTML = kdsSummaryHTML(kdsActive()); }
}

async function kdsClick(e) {
  const b = e.target.closest('[data-kds]');
  if (!b) return;
  const a = b.dataset.kds;
  const id = b.dataset.id;
  if (a === 'sound') return kdsUnlockAudio();
  if (a === 'refresh') return kdsPoll();
  if (a === 'settings') return openSettings('device');
  if (a === 'done') {
    const card = b.closest('.kds-card');
    if (card) card.classList.add('leaving');
    return setTimeout(() => kdsSetStatus(id, 'DONE'), 180);
  }
  if (a === 'undo' || a === 'recall') return kdsSetStatus(id, 'PENDING');
  if (a === 'ack') {
    kds.voidAlerts.delete(id);
    kds.acked.add(id);
    renderKds();
  }
}

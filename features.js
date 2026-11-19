/* ==========================================================================
   iPad POS — features.js  (v3)
   Staff PIN & permissions · order / line notes · parked bills · receipts (print + image)
   PromptPay QR · shifts & cash drawer · members & points · stock log · shop options
   Loaded after app.js (uses its globals at runtime only).
   ========================================================================== */
'use strict';

/* ==========================================================================
   1. STAFF, PIN & PERMISSIONS
   ========================================================================== */

const staffMode = () => state.catalog.staff.length > 0;

async function hashPin(pin) {
  const text = `pos-pin:${pin}`;
  if (window.crypto && crypto.subtle && window.TextEncoder) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; // FNV-1a fallback (non-secure contexts only)
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `f${(h >>> 0).toString(16)}`;
}

/** Can the logged-in person do this without asking for a PIN? (No staff configured = everything open.) */
function can(perm) {
  if (!staffMode()) return true;
  const s = state.session;
  if (!s) return false;
  if (s.role === 'owner') return true;
  return prefs().perms[perm] === 'staff';
}

/**
 * Resolve to { id, name, role } of the current user when they hold `perm`, otherwise null.
 * A permission that is not granted is HIDDEN in the UI (see applyPermUI) — there is no "ask the owner for a PIN" path;
 * the owner switches to their own account instead.
 */
async function requirePerm(perm, label) {
  if (!staffMode()) return { id: '', name: (state.session && state.session.name) || '', role: 'owner' };
  if (can(perm)) return { id: state.session.staffId, name: state.session.name, role: state.session.role };
  toast(`บัญชีนี้ไม่มีสิทธิ์: ${label}`, 'warn', 2500);
  return null;
}

/** Show / hide every control according to the logged-in account. Called on every header render (= on every user switch). */
function applyPermUI() {
  const hide = (el, on) => { if (typeof el === 'string') el = $(el); if (el) el.classList.toggle('perm-hide', !!on); };
  hide('#btnStock', !can('manage'));
  hide('#btnSettings', !can('settings'));
  const m = $('#manualDiscount');
  if (m) {
    hide(m.closest('.manual-row'), !can('discount'));
    hide('#manualNote', !can('discount'));
    if (!can('discount') && (state.cart.manualDiscount || state.cart.discountBy)) {
      state.cart.manualDiscount = '';
      state.cart.discountBy = '';
      m.value = '';
      save.cart();
    }
  }
}

/** Close every open window except the PIN pad / confirm — used when the account changes so nothing from the old account stays on screen. */
function closeAllOverlays() {
  $$('.modal.open').forEach((m) => { if (m.id !== 'm-pin' && m.id !== 'm-confirm') m.classList.remove('open'); });
}

let pinCtx = null;

/** PIN pad. lock=true → full-screen login (no cancel) that sets the session. */
function askPin({ title, sub = '', filter = () => true, lock = false }) {
  return new Promise((resolve) => {
    if (pinCtx && pinCtx.resolve) pinCtx.resolve(null);
    pinCtx = { title, sub, filter, lock, resolve, pin: '', err: '' };
    const m = ensureModal('m-pin', { size: 'sm', title, z: 'lock' });
    m.classList.toggle('is-lock', lock);
    renderPin();
    openModal('m-pin');
  });
}

function renderPin() {
  const m = $('#m-pin');
  const c = pinCtx;
  m.querySelector('.modal-title').textContent = c.title;
  m.querySelector('.modal-x').style.display = c.lock ? 'none' : '';
  m.querySelector('.modal-body').innerHTML = `
    ${c.lock ? `<div class="lock-brand"><img src="./icons/logo-mascot.png" alt="" /><b>${esc(state.settings.shopName)}</b><small>เลือกเข้าสู่ระบบด้วย PIN ของคุณ</small></div>` : `<p class="help" style="margin:0 0 8px;text-align:center">${esc(c.sub)}</p>`}
    <div class="pin-dots">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="${i < c.pin.length ? 'on' : ''} ${i >= 4 ? 'opt' : ''}"></span>`).join('')}</div>
    <div class="pin-err">${esc(c.err)}</div>
    <div class="numpad pin-pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-pin="${n}" type="button">${n}</button>`).join('')}
      <button class="np-fn" data-pin="C" type="button">ล้าง</button>
      <button data-pin="0" type="button">0</button>
      <button class="np-fn" data-pin="OK" type="button">ตกลง</button>
    </div>`;
  m.querySelector('.modal-foot').innerHTML = c.lock ? '<span class="help" style="margin:0">ลืม PIN? ให้เจ้าของร้านตั้งใหม่ที่ ตั้งค่า ▸ พนักงาน</span>' : '<button class="btn btn-ghost btn-lg" data-pin="cancel" type="button">ยกเลิก</button>';
}

async function pinClick(e) {
  if (pinCtx && !pinCtx.lock && e.target.closest('[data-close]')) { const r = pinCtx.resolve; pinCtx = null; return r(null); }
  const b = e.target.closest('[data-pin]');
  if (!b || !pinCtx) return;
  const c = pinCtx;
  const k = b.dataset.pin;
  if (k === 'cancel') { closeModal('m-pin'); pinCtx = null; return c.resolve(null); }
  if (k === 'C') c.pin = '';
  else if (k === 'OK') return tryPin(true);
  else if (c.pin.length < 6) c.pin += k;
  c.err = '';
  renderPin();
  if (c.pin.length >= 4) tryPin(false);
}

async function tryPin(explicit) {
  const c = pinCtx;
  const h = await hashPin(c.pin);
  if (pinCtx !== c) return;
  const st = state.catalog.staff.find((x) => x.pinHash === h);
  if (st && c.filter(st)) {
    closeModal('m-pin');
    pinCtx = null;
    const who = { id: st.id, name: st.name, role: st.role };
    if (c.lock) {
      state.session = { staffId: st.id, name: st.name, role: st.role, at: isoLocal(new Date()) };
      save.session();
      closeAllOverlays();
      logActivity('LOGIN', `เข้าสู่ระบบ (${st.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงานขาย'})`);
      renderHeader();
      if (state.settings.deviceMode !== 'kds') { renderCart(); renderMenu(); }
      toast(`สวัสดี ${st.name} 👋`, 'success', 1800);
    }
    return c.resolve(who);
  }
  if (st && !c.filter(st)) c.err = `${st.name} ไม่มีสิทธิ์ทำรายการนี้`;
  else if (explicit || c.pin.length >= 6) c.err = 'PIN ไม่ถูกต้อง';
  else return;
  c.pin = '';
  renderPin();
  const dots = $('#m-pin .pin-dots');
  if (dots) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
}

function showLock() {
  return askPin({ title: 'เข้าสู่ระบบ', lock: true });
}
function logout() {
  logActivity('LOGOUT', 'ออกจากระบบ / ล็อกหน้าจอ');
  state.session = null;
  save.session();
  closeAllOverlays();
  renderHeader();
  renderCart();
  if (staffMode()) showLock();
}

function renderStaffChip() {
  const b = $('#btnStaff');
  if (!b) return;
  const s = state.session;
  const shift = state.shift;
  const who = staffMode() ? (s ? s.name : 'ล็อกอยู่') : '';
  b.innerHTML = `${svg(staffMode() ? 'user' : 'cash', 18)}<span class="lbl-chip">${esc(who || 'กะ')}${shift ? '<i class="dot on"></i>' : '<i class="dot"></i>'}</span>`;
  b.title = `${who ? `ผู้ใช้: ${who} · ` : ''}${shift ? `กะเปิดอยู่ตั้งแต่ ${shift.openedAtTH}` : 'ยังไม่เปิดกะ'}`;
}

function openStaffMenu() {
  const m = ensureModal('m-staffmenu', { size: 'sm', title: 'ผู้ใช้ & กะ' });
  const s = state.session;
  const sh = state.shift;
  m.querySelector('.modal-body').innerHTML = `
    ${staffMode() ? `<div class="info-strip" style="display:block">ผู้ใช้ปัจจุบัน: <b>${esc(s ? s.name : '-')}</b> ${s ? `(${s.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงาน'})` : ''}</div>` : ''}
    <div class="menu-list">
      <button class="btn btn-outline btn-block" data-sm="shift" type="button">${svg('cash', 18)} ${sh ? `กะเปิดอยู่ · เงินเข้า-ออก / ปิดกะ` : 'เปิดกะ (กรอกเงินทอนตั้งต้น)'}</button>
      ${staffMode() ? `<button class="btn btn-outline btn-block" data-sm="switch" type="button">${svg('lock', 18)} สลับผู้ใช้ / ล็อกหน้าจอ</button>` : `<button class="btn btn-ghost btn-block" data-sm="setup" type="button">${svg('user', 18)} ตั้งค่าพนักงาน & PIN</button>`}
      <button class="btn btn-ghost btn-block" data-sm="parked" type="button">${svg('pause', 18)} บิลที่พักไว้ (${state.parked.length})</button>
    </div>`;
  m.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-close type="button">ปิด</button>';
  openModal('m-staffmenu');
}
function staffMenuClick(e) {
  const b = e.target.closest('[data-sm]');
  if (!b) return;
  closeModal('m-staffmenu');
  const a = b.dataset.sm;
  if (a === 'shift') openShiftPanel();
  else if (a === 'switch') logout();
  else if (a === 'setup') openSettings('staff');
  else if (a === 'parked') openParked();
}

/* ---------- settings ▸ staff ---------- */
const staffDraft = { name: '', role: 'staff', pin: '' };

function settingsStaffHTML() {
  const st = state.catalog.staff;
  const p = prefs();
  const owners = st.filter((x) => x.role === 'owner').length;
  return `
    <div class="section">
      <div class="section-title">พนักงาน & PIN <small>(ซิงก์ไปทุกเครื่อง · PIN เก็บแบบเข้ารหัส)</small></div>
      ${st.length ? '' : '<div class="info-strip" style="display:block">ยังไม่มีพนักงาน = ทุกคนใช้ได้ทุกฟีเจอร์ (ไม่ล็อก) · เพิ่ม <b>เจ้าของร้าน</b> คนแรกเพื่อเริ่มใช้ระบบล็อกสิทธิ์</div>'}
      ${st.map((x) => `
        <div class="mgr-row">
          <div class="grow"><b>${esc(x.name)}</b> <span class="pill ${x.role === 'owner' ? 'pill-ok' : 'pill-mute'}">${x.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงานขาย'}</span>
            ${state.session && state.session.staffId === x.id ? '<span class="pill pill-wait">ใช้งานอยู่</span>' : ''}</div>
          <button class="btn btn-outline btn-sm" data-act="staff-pin" data-id="${esc(x.id)}" type="button">เปลี่ยน PIN</button>
          <button class="btn btn-ghost btn-sm" data-act="staff-role" data-id="${esc(x.id)}" type="button">${x.role === 'owner' ? 'เปลี่ยนเป็นพนักงาน' : 'ตั้งเป็นเจ้าของ'}</button>
          <button class="icon-btn sm danger" data-act="staff-del" data-id="${esc(x.id)}" type="button" aria-label="ลบ">${svg('trash', 18)}</button>
        </div>`).join('')}
      <div class="mgr-add">
        <input class="input grow" id="staffName" type="text" placeholder="ชื่อ เช่น พี่เมย์" value="${esc(staffDraft.name)}" />
        <select class="input" id="staffRole" style="width:170px" ${st.length ? '' : 'disabled'}>
          <option value="staff" ${staffDraft.role === 'staff' && st.length ? 'selected' : ''}>พนักงานขาย</option>
          <option value="owner" ${staffDraft.role === 'owner' || !st.length ? 'selected' : ''}>เจ้าของร้าน</option>
        </select>
        <input class="input" id="staffPin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN 4-6 หลัก" style="width:150px" autocomplete="new-password" />
        <button class="btn btn-primary" data-act="staff-add" type="button">${svg('plus', 18)} เพิ่ม</button>
      </div>
      ${owners ? '' : (st.length ? '<div class="err-box">ต้องมีเจ้าของร้านอย่างน้อย 1 คน</div>' : '')}
    </div>
    <div class="section">
      <div class="section-title">สิทธิ์ของพนักงานขาย <small>(เจ้าของร้านทำได้ทุกอย่าง · ปิดสิทธิ์ = ซ่อนปุ่ม / เมนู / ตัวเลขนั้นจากพนักงานทันที ต้องสลับไปบัญชีเจ้าของร้านเพื่อใช้)</small></div>
      ${Object.keys(PERMS).map((k) => `
        <div class="perm-row"><span class="grow">${esc(PERMS[k])}</span>
          <div class="seg">
            <button class="${p.perms[k] === 'owner' ? 'on' : ''}" data-act="perm" data-k="${k}" data-v="owner" type="button">🔒 เจ้าของเท่านั้น</button>
            <button class="${p.perms[k] === 'staff' ? 'on' : ''}" data-act="perm" data-k="${k}" data-v="staff" type="button">พนักงานทำได้</button>
          </div></div>`).join('')}
      <button class="switch-row" data-act="pref-toggle" data-k="requireShift" type="button">
        <span class="switch ${p.requireShift ? 'on' : ''}"><span></span></span>
        <span><b>บังคับเปิดกะก่อนขาย</b><small>ต้องกรอกเงินทอนตั้งต้นก่อนรับชำระเงินบิลแรก</small></span>
      </button>
    </div>`;
}

async function staffAction(act, id) {
  const st = state.catalog.staff;
  const x = st.find((s) => s.id === id);
  if (act === 'staff-add') {
    const name = $('#staffName').value.trim();
    const pin = $('#staffPin').value.trim();
    const role = st.length ? $('#staffRole').value : 'owner';
    staffDraft.name = name;
    staffDraft.role = role;
    if (!name) return toast('ใส่ชื่อพนักงาน', 'warn');
    if (!/^\d{4,6}$/.test(pin)) return toast('PIN ต้องเป็นตัวเลข 4-6 หลัก', 'warn');
    const h = await hashPin(pin);
    if (st.some((s) => s.pinHash === h)) return toast('PIN นี้มีคนใช้แล้ว', 'warn');
    const ns = { id: `st_${uid()}`, name, role, pinHash: h };
    st.push(ns);
    if (st.length === 1) {
      state.session = { staffId: ns.id, name, role, at: isoLocal(new Date()) };
      save.session();
      toast('เปิดใช้ระบบ PIN แล้ว — จำ PIN เจ้าของร้านไว้ให้ดี', 'success', 4000);
    }
    staffDraft.name = '';
  } else if (!x) return;
  else if (act === 'staff-pin') {
    const r = await confirmDialog({ title: `เปลี่ยน PIN: ${x.name}`, html: '<p class="help">ตัวเลข 4-6 หลัก</p>', okText: 'บันทึก', input: { placeholder: 'PIN ใหม่' } });
    if (!r.ok) return;
    if (!/^\d{4,6}$/.test(r.value)) return toast('PIN ต้องเป็นตัวเลข 4-6 หลัก', 'warn');
    const h = await hashPin(r.value);
    if (st.some((s) => s.pinHash === h && s.id !== x.id)) return toast('PIN นี้มีคนใช้แล้ว', 'warn');
    x.pinHash = h;
  } else if (act === 'staff-role') {
    if (x.role === 'owner' && st.filter((s) => s.role === 'owner').length <= 1) return toast('ต้องมีเจ้าของร้านอย่างน้อย 1 คน', 'warn');
    x.role = x.role === 'owner' ? 'staff' : 'owner';
  } else if (act === 'staff-del') {
    if (x.role === 'owner' && st.filter((s) => s.role === 'owner').length <= 1 && st.length > 1) return toast('ลบพนักงานคนอื่นก่อน หรือตั้งเจ้าของร้านคนใหม่', 'warn', 3500);
    const r = await confirmDialog({ title: 'ลบพนักงาน', html: `ลบ <b>${esc(x.name)}</b> ?${st.length === 1 ? '<p class="warn-box">นี่คือคนสุดท้าย — ระบบล็อกสิทธิ์จะถูกปิด</p>' : ''}`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    state.catalog.staff = st.filter((s) => s.id !== id);
    if (state.session && state.session.staffId === id) { state.session = null; save.session(); }
  }
  commitCatalog();
  renderSettings();
}

/* ==========================================================================
   2. NOTES (per line / per bill) with owner-defined quick notes
   ========================================================================== */
let noteCtx = null;

function editNote(line) {
  noteCtx = { lineId: line ? line.id : null, text: line ? line.note || '' : state.cart.note || '' };
  const m = ensureModal('m-note', { size: 'sm', title: '' });
  m.querySelector('.modal-title').textContent = line ? `หมายเหตุ: ${lineTitle(line)}` : 'หมายเหตุบิล';
  renderNote();
  openModal('m-note');
  setTimeout(() => { const t = $('#noteText'); if (t) t.focus(); }, 50);
}
function renderNote() {
  const m = $('#m-note');
  const qn = state.catalog.quickNotes;
  m.querySelector('.modal-body').innerHTML = `
    <div class="chips" style="margin-bottom:10px">${qn.map((n) => `<button class="mchip ${noteCtx.text.split(', ').includes(n) ? 'on' : ''}" data-qn="${esc(n)}" type="button">${esc(n)}</button>`).join('')}</div>
    <textarea class="input note-area" id="noteText" rows="3" placeholder="พิมพ์หมายเหตุ…">${esc(noteCtx.text)}</textarea>
    <p class="help">ปุ่มหมายเหตุสำเร็จรูปแก้ได้ที่ จัดการเมนู ▸ ตัวเลือกร้าน</p>`;
  m.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost" data-note="clear" type="button">ลบหมายเหตุ</button><span class="grow"></span>
    <button class="btn btn-primary btn-lg" data-note="ok" type="button">บันทึก</button>`;
}
function noteClick(e) {
  const t = $('#noteText');
  if (t) noteCtx.text = t.value;
  const q = e.target.closest('[data-qn]');
  if (q) {
    const parts = noteCtx.text.split(',').map((x) => x.trim()).filter(Boolean);
    const i = parts.indexOf(q.dataset.qn);
    if (i >= 0) parts.splice(i, 1); else parts.push(q.dataset.qn);
    noteCtx.text = parts.join(', ');
    return renderNote();
  }
  const b = e.target.closest('[data-note]');
  if (!b) return;
  if (b.dataset.note === 'clear') noteCtx.text = '';
  const text = noteCtx.text.trim().slice(0, 200);
  if (noteCtx.lineId) {
    const l = state.cart.lines.find((x) => x.id === noteCtx.lineId);
    if (l) l.note = text;
  } else state.cart.note = text;
  closeModal('m-note');
  cartChanged();
}

/* ==========================================================================
   3. PARKED BILLS (hold / park order)
   ========================================================================== */

async function parkCart() {
  if (!state.cart.lines.length) return openParked();
  const t = cartTotals();
  const r = await confirmDialog({
    title: 'พักบิลนี้ไว้ก่อน',
    html: `<p>${state.cart.lines.length} รายการ · ${money(t.net)}</p><p class="help">ใส่ชื่อลูกค้า / เลขโต๊ะ / ลักษณะ เพื่อเรียกบิลคืนได้ง่าย · สต็อกยังไม่ถูกตัดจนกว่าจะชำระเงิน</p>`,
    okText: 'พักบิล',
    input: { placeholder: `เช่น คุณแนน / โต๊ะ 3 (เว้นว่าง = บิลพัก ${state.parked.length + 1})` },
  });
  if (!r.ok) return;
  state.parked.push({ id: uid(), name: r.value || `บิลพัก ${state.parked.length + 1}`, at: isoLocal(new Date()), atTH: fmtDateTime(new Date()), net: t.net, cart: clone(state.cart) });
  save.parked();
  logActivity('PARK', `พักบิล “${state.parked[state.parked.length - 1].name}”`, t.net);
  resetCart();
  toast(`พักบิล “${state.parked[state.parked.length - 1].name}” แล้ว`, 'success');
}

function openParked() {
  const m = ensureModal('m-parked', { size: 'lg', title: 'บิลที่พักไว้' });
  const list = state.parked;
  m.querySelector('.modal-body').innerHTML = list.length ? list.map((p) => `
    <div class="mgr-row">
      <div class="grow"><b>${esc(p.name)}</b> <span class="help">${esc(p.atTH)}</span>
        <div class="help" style="margin:0">${p.cart.lines.map((l) => `${esc(lineTitle(l))} ${l.type === 'weight' ? `${l.soldG} ก.` : `×${l.qty}`}`).join(' · ')}${p.cart.note ? ` · 📝 ${esc(p.cart.note)}` : ''}</div></div>
      <b class="nowrap">${money(p.net)}</b>
      <button class="btn btn-primary btn-sm" data-pk="resume" data-id="${esc(p.id)}" type="button">เรียกบิลคืน</button>
      <button class="icon-btn sm danger" data-pk="del" data-id="${esc(p.id)}" type="button" aria-label="ลบ">${svg('trash', 18)}</button>
    </div>`).join('') : `<div class="empty-state">${svg('pause', 40)}<p>ไม่มีบิลที่พักไว้</p></div>`;
  m.querySelector('.modal-foot').innerHTML = `${state.cart.lines.length ? `<button class="btn btn-outline" data-pk="park" type="button">${svg('pause', 18)} พักบิลปัจจุบัน</button>` : ''}<span class="grow"></span><button class="btn btn-ghost" data-close type="button">ปิด</button>`;
  openModal('m-parked');
}

async function parkedClick(e) {
  const b = e.target.closest('[data-pk]');
  if (!b) return;
  const i = state.parked.findIndex((p) => p.id === b.dataset.id);
  if (b.dataset.pk === 'park') { closeModal('m-parked'); return parkCart(); }
  if (i < 0) return;
  if (b.dataset.pk === 'del') {
    const r = await confirmDialog({ title: 'ลบบิลที่พัก', html: `ลบ <b>${esc(state.parked[i].name)}</b> ?`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    state.parked.splice(i, 1);
    save.parked();
    renderCart();
    return openParked();
  }
  // resume: the current cart (if any) is parked in its place
  const p = state.parked.splice(i, 1)[0];
  if (state.cart.lines.length) {
    const t = cartTotals();
    state.parked.push({ id: uid(), name: `บิลพัก ${fmtDateTime(new Date()).slice(11, 16)}`, at: isoLocal(new Date()), atTH: fmtDateTime(new Date()), net: t.net, cart: clone(state.cart) });
  }
  save.parked();
  state.cart = Object.assign(emptyCart(), p.cart);
  sanitizeCart();
  $('#manualDiscount').value = state.cart.manualDiscount || '';
  closeModal('m-parked');
  cartChanged();
  const short = cartShortages();
  toast(short.length ? `เรียกบิล “${p.name}” แล้ว — สต็อกไม่พอ: ${shortageText(short)}` : `เรียกบิล “${p.name}” แล้ว`, short.length ? 'warn' : 'success', 3500);
}

/* ==========================================================================
   4. PROMPTPAY QR (EMVCo, offline)
   ========================================================================== */

const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 13) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
  return d;
};

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** PromptPay payload — mobile (10 digits), national/tax ID (13) or e-wallet (15), with the amount. */
function promptPayPayload(id, amount) {
  const f = (tag, v) => `${tag}${String(v.length).padStart(2, '0')}${v}`;
  let target = String(id).replace(/\D/g, '');
  let sub = '02';
  if (target.length === 10) { target = `0066${target.slice(1)}`; sub = '01'; } // 0812345678 → 0066812345678
  else if (target.length === 15) sub = '03';
  const merchant = f('00', 'A000000677010111') + f(sub, target);
  const amt = amount > 0 ? f('54', round2(amount).toFixed(2)) : '';
  const body = f('00', '01') + f('01', amount > 0 ? '12' : '11') + f('29', merchant) + f('53', '764') + amt + f('58', 'TH') + '6304';
  return body + crc16(body);
}

function promptPayQR(id, amount, cell = 5) {
  if (typeof qrcode !== 'function') return '<div class="warn-box">โหลดตัวสร้าง QR ไม่สำเร็จ</div>';
  const qr = qrcode(0, 'M');
  qr.addData(promptPayPayload(id, amount));
  qr.make();
  return `<div class="qr-box">${qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true })}</div>`;
}

/* ==========================================================================
   5. ORDER DONE · RECEIPT (AirPrint 58/80 mm + shareable image)
   ========================================================================== */
let doneOrder = null;

function showOrderDone(o, reprint) {
  doneOrder = o;
  const m = ensureModal('m-done', { size: 'lg', title: '' });
  m.querySelector('.modal-title').textContent = reprint ? `ใบเสร็จ ${o.id}` : 'ชำระเงินสำเร็จ ✓';
  const cash = o.payment.cashReceived != null;
  m.querySelector('.modal-body').innerHTML = `
    <div class="done-layout">
      <div class="done-main">
        ${o.queueNo ? `<div class="queue-big"><small>เลขคิว</small><b>#${esc(o.queueNo)}</b></div>` : ''}
        <div class="done-net"><span>ยอดชำระ (${esc(o.payment.label)})</span><b>${money(o.net)}</b></div>
        ${cash ? `<div class="done-change"><span>รับเงิน ${money(o.payment.cashReceived)} · เงินทอน</span><b>${money(o.payment.change)}</b></div>` : ''}
        ${o.customer && o.customer.phone ? `<div class="help">สมาชิก ${esc(o.customer.name || fmtPhone(o.customer.phone))} · ได้ ${o.customer.earned || 0} แต้ม${state.customers[o.customer.phone] ? ` · สะสม ${fmtNum(state.customers[o.customer.phone].points)} แต้ม` : ''}</div>` : ''}
        ${o.kitchenStatus === 'PENDING' && !reprint ? '<div class="ok-box">ส่งออเดอร์เข้าคิวหลังร้านแล้ว 🍳</div>' : ''}
      </div>
      <div class="receipt-preview">${receiptHTML(o)}</div>
    </div>`;
  m.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-outline btn-lg" data-done="print" type="button">${svg('printer', 20)} พิมพ์ใบเสร็จ</button>
    <button class="btn btn-outline btn-lg" data-done="share" type="button">${svg('share', 20)} แชร์รูปใบเสร็จ</button>
    ${o.queueNo ? `<button class="btn btn-outline btn-lg" data-done="slip" type="button">${svg('receipt', 20)} พิมพ์ใบคิว</button>` : ''}
    <span class="grow"></span>
    <button class="btn btn-primary btn-lg" data-close type="button">${reprint ? 'ปิด' : 'ออเดอร์ถัดไป →'}</button>`;
  openModal('m-done');
}
function orderDoneClick(e) {
  const b = e.target.closest('[data-done]');
  if (!b || !doneOrder) return;
  if (b.dataset.done === 'print') printReceipt(doneOrder);
  else if (b.dataset.done === 'slip') printQueueSlip(doneOrder);
  else shareReceiptImage(doneOrder);
}

/** Receipt as a list of rows, shared by the HTML (print) and canvas (image) renderers. */
function receiptRows(o) {
  const s = state.settings;
  const r = prefs().receipt;
  const rows = [];
  rows.push({ t: 'title', v: s.shopName });
  if (s.shopSubtitle) rows.push({ t: 'center', v: s.shopSubtitle });
  if (r.address) rows.push({ t: 'center', v: r.address });
  if (r.phone) rows.push({ t: 'center', v: `โทร ${r.phone}` });
  if (r.taxId) rows.push({ t: 'center', v: `เลขผู้เสียภาษี ${r.taxId}` });
  rows.push({ t: 'hr' });
  if (o.status === 'VOIDED') rows.push({ t: 'big', v: '*** ยกเลิกบิล (VOID) ***' });
  if (o.queueNo) rows.push({ t: 'big', v: `คิว #${o.queueNo}` });
  rows.push({ t: 'kv', k: 'เลขที่', v: o.id });
  rows.push({ t: 'kv', k: 'วันที่', v: o.createdAtTH });
  if (o.staff && o.staff.name) rows.push({ t: 'kv', k: 'พนักงาน', v: o.staff.name });
  rows.push({ t: 'hr' });
  for (const i of o.items || []) {
    rows.push({ t: 'kv', k: `${i.name}${i.type === 'weight' ? '' : ` ×${i.qty}`}`, v: fmtNum(i.net), b: true });
    const det = i.type === 'set' ? [...(i.options || []), ...(i.addOns || []).map((a) => `+${a.name} ×${a.n}`)].join(', ')
      : i.type === 'weight' ? `${fmtNum(i.soldG)} ก. × ${money(i.unitPrice)}${i.freeG ? ` แถม ${fmtNum(i.freeG)} ก.` : ''}${i.itemDiscount ? ` ลด ${money(i.itemDiscount)}` : ''}`
        : `@ ${money(i.unitPrice)}`;
    if (det) rows.push({ t: 'sub', v: det });
    if (i.note) rows.push({ t: 'sub', v: `📝 ${i.note}` });
  }
  rows.push({ t: 'hr' });
  rows.push({ t: 'kv', k: 'รวม', v: fmtNum(o.subtotal) });
  for (const p of o.promos || []) rows.push({ t: 'kv', k: `${p.label}${p.bundles > 1 ? ` ×${p.bundles}` : ''}`, v: `-${fmtNum(p.discount)}` });
  if (o.itemDiscount) rows.push({ t: 'kv', k: 'ส่วนลดรายการ', v: `-${fmtNum(o.itemDiscount)}` });
  if (o.pointsDiscount) rows.push({ t: 'kv', k: `ใช้แต้ม ${o.customer ? o.customer.redeemed : ''}`, v: `-${fmtNum(o.pointsDiscount)}` });
  if (o.manualDiscount) rows.push({ t: 'kv', k: 'ส่วนลดเพิ่มเติม', v: `-${fmtNum(o.manualDiscount)}` });
  rows.push({ t: 'total', k: 'ยอดสุทธิ', v: money(o.net) });
  rows.push({ t: 'kv', k: o.payment.label, v: fmtNum(o.payment.cashReceived != null ? o.payment.cashReceived : o.net) });
  if (o.payment.change != null) rows.push({ t: 'kv', k: 'เงินทอน', v: fmtNum(o.payment.change) });
  if (o.customer && o.customer.phone) {
    rows.push({ t: 'hr' });
    const c = state.customers[o.customer.phone];
    rows.push({ t: 'kv', k: `สมาชิก ${o.customer.name || ''}`, v: `xxx-${o.customer.phone.slice(-4)}` });
    rows.push({ t: 'kv', k: 'แต้มที่ได้รับ', v: `+${o.customer.earned || 0}` });
    if (c) rows.push({ t: 'kv', k: 'แต้มสะสม', v: fmtNum(c.points) });
  }
  if (o.note) rows.push({ t: 'sub', v: `หมายเหตุ: ${o.note}` });
  rows.push({ t: 'hr' });
  if (r.footer) rows.push({ t: 'center', v: r.footer });
  return rows;
}

function receiptHTML(o) {
  const w = prefs().receipt.width;
  return `<div class="receipt r${w}">${receiptRows(o).map((x) => {
    if (x.t === 'hr') return '<div class="r-hr"></div>';
    if (x.t === 'title') return `<div class="r-title">${esc(x.v)}</div>`;
    if (x.t === 'center') return `<div class="r-center">${esc(x.v)}</div>`;
    if (x.t === 'big') return `<div class="r-big">${esc(x.v)}</div>`;
    if (x.t === 'sub') return `<div class="r-sub">${esc(x.v)}</div>`;
    if (x.t === 'total') return `<div class="r-kv r-total"><span>${esc(x.k)}</span><span>${esc(x.v)}</span></div>`;
    return `<div class="r-kv ${x.b ? 'b' : ''}"><span>${esc(x.k)}</span><span>${esc(x.v)}</span></div>`;
  }).join('')}</div>`;
}

/** AirPrint / any printer: render into #printArea and use the browser print dialog. */
function printHTML(inner) {
  let area = $('#printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.className = `w${prefs().receipt.width}`;
  area.innerHTML = inner;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
const printReceipt = (o) => printHTML(receiptHTML(o));

/** Queue slip — big queue number + what to prepare (stick on the bag / hand to the kitchen). */
function printQueueSlip(o) {
  const items = (o.kitchen && o.kitchen.items) || (o.items || []).map((i) => ({ n: i.name, q: `×${i.qty}`, o: i.options || [], note: i.note || '' }));
  printHTML(`<div class="receipt r${prefs().receipt.width} slip">
    <div class="r-center">${esc(state.settings.shopName)}</div>
    <div class="slip-q">#${esc(o.queueNo)}</div>
    <div class="r-center">${esc(o.createdAtTH)}${o.staff && o.staff.name ? ` · ${esc(o.staff.name)}` : ''}</div>
    <div class="r-hr"></div>
    ${items.map((i) => `<div class="r-kv b"><span>${esc(i.n)}</span><span>${esc(i.q)}</span></div>
      ${(i.o || []).length ? `<div class="r-sub">${i.o.map(esc).join(', ')}</div>` : ''}${i.note ? `<div class="r-sub">📝 ${esc(i.note)}</div>` : ''}`).join('')}
    ${o.note ? `<div class="r-hr"></div><div class="r-big" style="font-size:16px">📝 ${esc(o.note)}</div>` : ''}
  </div>`);
}

/** Draw the receipt on a canvas → PNG → share sheet (AirDrop / LINE / Save Image). */
function receiptCanvas(o) {
  const W = prefs().receipt.width === '80' ? 576 : 420;
  const pad = 22;
  const font = (px, bold) => `${bold ? '700' : '400'} ${px}px Prompt, Thonburi, sans-serif`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const wrap = (text, px, bold, maxW) => {
    ctx.font = font(px, bold);
    const out = [];
    let line = '';
    for (const ch of Array.from(String(text))) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
    }
    if (line) out.push(line);
    return out;
  };
  const ops = [];
  let y = pad;
  for (const r of receiptRows(o)) {
    if (r.t === 'hr') { ops.push({ hr: y + 8 }); y += 18; continue; }
    if (r.t === 'kv' || r.t === 'total') {
      const px = r.t === 'total' ? 26 : 19;
      ctx.font = font(px, true);
      const vw = ctx.measureText(r.v).width;
      const lines = wrap(r.k, px, r.b || r.t === 'total', W - pad * 2 - vw - 12);
      lines.forEach((ln, i) => { ops.push({ text: ln, x: pad, y, px, bold: r.b || r.t === 'total' }); if (i === 0) ops.push({ text: r.v, x: W - pad, y, px, bold: true, align: 'right' }); y += px * 1.45; });
      continue;
    }
    const px = r.t === 'title' ? 28 : r.t === 'big' ? 34 : r.t === 'sub' ? 16 : 17;
    const bold = r.t === 'title' || r.t === 'big';
    const center = r.t !== 'sub';
    for (const ln of wrap(r.v, px, bold, W - pad * 2)) {
      ops.push({ text: ln, x: center ? W / 2 : pad + 10, y, px, bold, align: center ? 'center' : 'left', muted: r.t === 'sub' });
      y += px * 1.45;
    }
  }
  c.width = W;
  c.height = Math.ceil(y + pad);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'top';
  for (const op of ops) {
    if (op.hr != null) {
      ctx.strokeStyle = '#999';
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(pad, op.hr); ctx.lineTo(W - pad, op.hr); ctx.stroke();
      continue;
    }
    ctx.font = font(op.px, op.bold);
    ctx.fillStyle = op.muted ? '#555' : '#111';
    ctx.textAlign = op.align || 'left';
    ctx.fillText(op.text, op.x, op.y);
  }
  return c;
}

async function shareReceiptImage(o) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = receiptCanvas(o);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], `receipt-${o.queueNo || o.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `ใบเสร็จ ${o.id}` });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) {
    if (e && e.name !== 'AbortError') toast(`สร้างรูปใบเสร็จไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

/* ==========================================================================
   6. SHIFT & CASH DRAWER
   ========================================================================== */
let shiftCtx = { float: '', type: 'out', amount: '', reason: '', counted: '', note: '' };
let shiftHistory = null;

const CASH_REASONS = { in: ['เติมเงินทอน', 'รับเงินมัดจำ', 'อื่น ๆ'], out: ['ซื้อน้ำแข็ง', 'ซื้อวัตถุดิบ', 'ค่าส่งของ', 'นำเงินเข้าธนาคาร', 'อื่น ๆ'] };

function computeShift(sh) {
  const orders = state.orders.filter((o) => o.shiftId === sh.id);
  const done = orders.filter((o) => o.status !== 'VOIDED');
  const isCash = (o) => (o.payment.kind ? o.payment.kind === 'cash' : isCashMethod(o.payment.method));
  // cash that really stays in the drawer = received − change (stored as cashInDrawer; = net)
  const drawer = (o) => (o.payment.cashInDrawer != null ? o.payment.cashInDrawer : o.net);
  const cashSales = sumMoney(done.filter(isCash), drawer);
  const byMethod = {};
  for (const o of done) byMethod[o.payment.label] = fromSatang(toSatang(byMethod[o.payment.label] || 0) + toSatang(o.net));
  const payIn = sumMoney(sh.moves.filter((m) => m.type === 'in'), (m) => m.amount);
  const payOut = sumMoney(sh.moves.filter((m) => m.type === 'out'), (m) => m.amount);
  return {
    bills: done.length, voids: orders.length - done.length,
    netSales: sumMoney(done, (o) => o.net),
    cashSales, byMethod, payIn, payOut,
    expected: fromSatang(toSatang(sh.float) + toSatang(cashSales) + toSatang(payIn) - toSatang(payOut)),
  };
}

function openShiftPanel() {
  shiftCtx = { float: '', type: 'out', amount: '', reason: '', counted: '', note: '' };
  ensureModal('m-shift', { size: 'lg', title: 'กะ & ลิ้นชักเงินสด' });
  renderShift();
  openModal('m-shift');
}

function renderShift(keepFocus) {
  const m = $('#m-shift');
  const sh = state.shift;
  const c = shiftCtx;
  if (!sh) {
    m.querySelector('.modal-body').innerHTML = `
      <div class="section-title">เปิดกะใหม่</div>
      <label class="field-label" for="shFloat">เงินทอนตั้งต้นในลิ้นชัก (บาท)</label>
      <input class="input big-in" id="shFloat" data-sh="float" type="text" inputmode="decimal" placeholder="0" value="${esc(c.float)}" />
      <div class="cash-quick">${[500, 1000, 1500, 2000].map((n) => `<button class="btn btn-outline btn-sm" data-shq="float" data-v="${n}" type="button">฿${fmtNum(n)}</button>`).join('')}</div>
      <p class="help">ผู้เปิดกะ: <b>${esc((state.session && state.session.name) || '-')}</b> · เครื่อง ${esc(state.settings.devicePrefix)}</p>`;
    m.querySelector('.modal-foot').innerHTML = `<button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button><button class="btn btn-primary btn-lg" data-sh-act="open" type="button">เปิดกะ</button>`;
    return;
  }
  const x = computeShift(sh);
  const showSales = can('salesTotals');
  const showVar = can('variance');
  const counted = c.counted === '' ? null : round2(parseFloat(c.counted) || 0);
  const diff = counted == null ? null : fromSatang(toSatang(counted) - toSatang(x.expected));
  const moveBox = can('cashMove') ? `
      <div class="card-box">
        <div class="section-title" style="margin-top:0">เงินเข้า-ออกระหว่างกะ</div>
        <div class="seg" style="margin-bottom:8px">
          <button class="${c.type === 'out' ? 'on' : ''}" data-shq="type" data-v="out" type="button">− นำเงินออก (Pay-out)</button>
          <button class="${c.type === 'in' ? 'on' : ''}" data-shq="type" data-v="in" type="button">+ นำเงินเข้า (Pay-in)</button>
        </div>
        <div class="row nowrap"><input class="input" data-sh="amount" type="text" inputmode="decimal" placeholder="จำนวนเงิน" value="${esc(c.amount)}" style="width:140px" />
          <input class="input grow" data-sh="reason" type="text" placeholder="เหตุผล" value="${esc(c.reason)}" /></div>
        <div class="chips" style="margin:8px 0">${CASH_REASONS[c.type].map((r) => `<button class="mchip ${c.reason === r ? 'on' : ''}" data-shq="reason" data-v="${esc(r)}" type="button">${esc(r)}</button>`).join('')}</div>
        <button class="btn btn-primary btn-block" data-sh-act="move" type="button">บันทึกเงิน${c.type === 'in' ? 'เข้า' : 'ออก'}</button>
        <div class="moves">${sh.moves.slice().reverse().map((mv) => `<div class="move ${mv.type}"><span>${esc(mv.atTH.slice(11, 16))} ${esc(mv.reason || '-')} <small>${esc(mv.by || '')}</small></span><b>${mv.type === 'in' ? '+' : '−'}${money(mv.amount)}</b></div>`).join('') || '<div class="help">ยังไม่มีรายการ</div>'}</div>
      </div>` : '';
  m.querySelector('.modal-body').innerHTML = `
    <div class="stat-grid four">
      <div class="stat"><div class="k">เปิดกะ</div><div class="v sm">${esc(sh.openedAtTH.slice(11, 16))} น.</div><div class="s">${esc(sh.openedBy || '-')} · ${esc(sh.openedAtTH.slice(0, 10))}</div></div>
      ${showSales
    ? `<div class="stat"><div class="k">ยอดขายในกะ</div><div class="v">${money(x.netSales)}</div><div class="s">${x.bills} บิล${x.voids ? ` · ยกเลิก ${x.voids}` : ''}</div></div>
      <div class="stat"><div class="k">ขายเงินสด</div><div class="v">${money(x.cashSales)}</div><div class="s">${Object.keys(x.byMethod).map((k) => `${esc(k)} ${money(x.byMethod[k])}`).join(' · ') || '-'}</div></div>`
    : `<div class="stat"><div class="k">จำนวนบิลในกะ</div><div class="v">${x.bills}</div><div class="s">${x.voids ? `ยกเลิก ${x.voids}` : ''}</div></div>`}
      ${showVar ? `<div class="stat primary"><div class="k">เงินสดที่ควรมีในลิ้นชัก</div><div class="v">${money(x.expected)}</div><div class="s">ตั้งต้น ${money(sh.float)} + ขาย ${money(x.cashSales)} + เข้า ${money(x.payIn)} − ออก ${money(x.payOut)}</div></div>` : ''}
    </div>
    <div class="shift-cols ${moveBox ? '' : 'one'}">
      ${moveBox}
      <div class="card-box">
        <div class="section-title" style="margin-top:0">ปิดกะ — นับเงินสดในลิ้นชัก</div>
        <input class="input big-in" data-sh="counted" type="text" inputmode="decimal" placeholder="ยอดเงินสดที่นับได้จริง" value="${esc(c.counted)}" />
        ${showVar
    ? `<div class="change-due ${diff != null && diff < 0 ? 'neg' : ''}" style="margin:10px 0">
          <span>${diff == null ? 'ส่วนต่าง' : diff === 0 ? 'ตรงพอดี ✓' : diff > 0 ? 'เงินเกิน' : 'เงินขาด'}</span><b>${diff == null ? '—' : money(Math.abs(diff))}</b></div>`
    : '<p class="help" style="margin:10px 0">นับเงินให้ครบแล้วกดปิดกะ — ระบบจะเทียบกับยอดในระบบและส่งผลให้เจ้าของร้านดู</p>'}
        <input class="input" data-sh="note" type="text" placeholder="หมายเหตุ (ไม่บังคับ)" value="${esc(c.note)}" />
        <button class="btn btn-danger btn-block" data-sh-act="close" type="button" style="margin-top:10px" ${counted == null ? 'disabled' : ''}>ปิดกะ${showVar ? ' & ส่งสรุปขึ้น Google Sheets' : ''}</button>
      </div>
    </div>`;
  m.querySelector('.modal-foot').innerHTML = `<button class="btn btn-outline" data-sh-act="print" type="button">${svg('printer', 18)} พิมพ์สรุปกะ (X-Report)</button><span class="grow"></span><button class="btn btn-ghost btn-lg" data-close type="button">ปิดหน้าต่าง</button>`;
  if (keepFocus) { const el = m.querySelector(`[data-sh="${keepFocus}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}

function shiftInput(e) {
  const k = e.target.dataset.sh;
  if (!k) return;
  shiftCtx[k] = ['float', 'amount', 'counted'].includes(k) ? cleanNum(e.target.value) : e.target.value;
  if (k === 'counted') renderShift('counted');
}

async function shiftClick(e) {
  const q = e.target.closest('[data-shq]');
  if (q) { shiftCtx[q.dataset.shq] = q.dataset.v; if (q.dataset.shq === 'type') shiftCtx.reason = ''; return renderShift(); }
  const b = e.target.closest('[data-sh-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.shAct;
  const now = new Date();
  const by = (state.session && state.session.name) || '';
  if (act === 'open') {
    const float = round2(parseFloat(shiftCtx.float) || 0);
    const d = state.settings.devicePrefix;
    state.shift = { id: `SH-${d}-${dateKey(now).replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`, device: d,
      openedAtISO: isoLocal(now), openedAtTH: fmtDateTime(now), openedBy: by, float, moves: [] };
    save.shift();
    enqueue('SHIFT_OPEN', '', shiftPayload(state.shift), `เปิดกะ ${state.shift.id}`);
    logActivity('SHIFT_OPEN', `เปิดกะ ${state.shift.id} · เงินทอนตั้งต้น ${money(float)}`, float);
    renderHeader();
    toast(`เปิดกะแล้ว · เงินทอนตั้งต้น ${money(float)}`, 'success');
    closeModal('m-shift');
    syncNow({ silent: true });
  } else if (act === 'move') {
    const amount = round2(parseFloat(shiftCtx.amount) || 0);
    if (!(amount > 0)) return toast('ใส่จำนวนเงิน', 'warn');
    const who = await requirePerm('cashMove', 'บันทึกเงินเข้า-ออก');
    if (!who) return;
    const mv = { id: `CM-${uid()}`, shiftId: state.shift.id, atISO: isoLocal(now), atTH: fmtDateTime(now), type: shiftCtx.type, amount, reason: shiftCtx.reason.trim(), by: who.name || by, device: state.settings.devicePrefix };
    state.shift.moves.push(mv);
    save.shift();
    enqueue('CASH_MOVE', '', mv, `${mv.type === 'in' ? 'เงินเข้า' : 'เงินออก'} ${money(amount)}`);
    logActivity(mv.type === 'in' ? 'CASH_IN' : 'CASH_OUT', `${mv.reason || '-'}`, amount, who);
    shiftCtx.amount = '';
    shiftCtx.reason = '';
    renderShift();
    toast('บันทึกแล้ว', 'success', 1500);
    syncNow({ silent: true });
  } else if (act === 'close') {
    const counted = round2(parseFloat(shiftCtx.counted) || 0);
    const x = computeShift(state.shift);
    const diff = fromSatang(toSatang(counted) - toSatang(x.expected));
    const r = await confirmDialog({
      title: 'ปิดกะ',
      html: can('variance')
        ? `<p>เงินที่ควรมี <b>${money(x.expected)}</b> · นับได้ <b>${money(counted)}</b></p><p>${diff === 0 ? 'ตรงพอดี ✓' : `${diff > 0 ? 'เงินเกิน' : 'เงินขาด'} <b>${money(Math.abs(diff))}</b>`}</p>`
        : `<p>นับเงินสดได้ <b>${money(counted)}</b></p><p class="help">ยืนยันปิดกะ? หลังปิดแล้วแก้ไขไม่ได้</p>`,
      okText: 'ยืนยันปิดกะ',
      danger: can('variance') && diff !== 0,
    });
    if (!r.ok) return;
    const rec = Object.assign({}, state.shift, x, { closedAtISO: isoLocal(now), closedAtTH: fmtDateTime(now), closedBy: by, counted, diff, note: shiftCtx.note.trim() });
    try { await DataDB.put('shifts', [rec]); } catch (err) { console.warn(err); }
    if (shiftHistory) shiftHistory.unshift(rec);
    enqueue('SHIFT_CLOSE', '', shiftPayload(rec), `ปิดกะ ${rec.id}`);
    logActivity('SHIFT_CLOSE', `ปิดกะ ${rec.id} · นับได้ ${money(counted)}${can('variance') ? ` · ส่วนต่าง ${money(diff)}` : ''}`, counted);
    state.shift = null;
    save.shift();
    renderHeader();
    closeModal('m-shift');
    toast('ปิดกะเรียบร้อย ✓', 'success');
    syncNow({ silent: true });
    printShiftSummary(rec);
  } else if (act === 'print') {
    printShiftSummary(Object.assign({}, state.shift, computeShift(state.shift)));
  }
}

function shiftPayload(sh) {
  return {
    shiftId: sh.id, device: sh.device, openedAt: sh.openedAtTH, openedBy: sh.openedBy, float: sh.float,
    closedAt: sh.closedAtTH || '', closedBy: sh.closedBy || '', bills: sh.bills || 0, voids: sh.voids || 0, netSales: sh.netSales || 0,
    cashSales: sh.cashSales || 0, payIn: sh.payIn || 0, payOut: sh.payOut || 0, expected: sh.expected || 0,
    counted: sh.counted == null ? '' : sh.counted, diff: sh.diff == null ? '' : sh.diff,
    byMethod: sh.byMethod ? Object.keys(sh.byMethod).map((k) => `${k}: ${sh.byMethod[k]}`).join(', ') : '', note: sh.note || '',
  };
}

function printShiftSummary(sh) {
  const row = (k, v) => `<div class="r-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
  const showSales = can('salesTotals');
  const showVar = can('variance');
  printHTML(`<div class="receipt r${prefs().receipt.width}">
    <div class="r-title">${esc(state.settings.shopName)}</div>
    <div class="r-big">${sh.closedAtTH ? 'สรุปปิดกะ (Z)' : 'สรุปกะ (X)'}</div>
    ${row('กะ', sh.id)}${row('เปิด', `${sh.openedAtTH} ${sh.openedBy || ''}`)}${sh.closedAtTH ? row('ปิด', `${sh.closedAtTH} ${sh.closedBy || ''}`) : ''}
    <div class="r-hr"></div>
    ${row('จำนวนบิล', `${sh.bills}${sh.voids ? ` (ยกเลิก ${sh.voids})` : ''}`)}
    ${showSales ? `${row('ยอดขายสุทธิ', fmtNum(sh.netSales))}${Object.keys(sh.byMethod || {}).map((k) => row(`  ${k}`, fmtNum(sh.byMethod[k]))).join('')}` : ''}
    ${showVar ? `<div class="r-hr"></div>
    ${row('เงินทอนตั้งต้น', fmtNum(sh.float))}${row('ขายเงินสด', fmtNum(sh.cashSales))}${row('เงินเข้า', fmtNum(sh.payIn))}${row('เงินออก', fmtNum(sh.payOut))}
    <div class="r-kv r-total"><span>ควรมีในลิ้นชัก</span><span>${fmtNum(sh.expected)}</span></div>
    ${sh.counted != null ? row('นับได้จริง', fmtNum(sh.counted)) + row('ส่วนต่าง', fmtNum(sh.diff)) : ''}` : (sh.counted != null ? `<div class="r-hr"></div>${row('นับเงินสดได้', fmtNum(sh.counted))}` : '')}
    ${(sh.moves || []).length ? `<div class="r-hr"></div>${sh.moves.map((m) => row(`${m.atTH.slice(11, 16)} ${m.reason || ''}`, `${m.type === 'in' ? '+' : '-'}${fmtNum(m.amount)}`)).join('')}` : ''}
    ${sh.note ? `<div class="r-sub">หมายเหตุ: ${esc(sh.note)}</div>` : ''}
  </div>`);
}

function shiftHistoryHTML() {
  if (!shiftHistory) {
    DataDB.all('shifts').then((rows) => { shiftHistory = rows.sort((a, b) => (a.closedAtISO < b.closedAtISO ? 1 : -1)); if (isOpen('m-history') && histTab === 'shift') renderHistory(); })
      .catch(() => { shiftHistory = []; });
    return '<div class="empty-state">กำลังโหลด…</div>';
  }
  const sh = state.shift;
  const cur = sh ? computeShift(sh) : null;
  const showSales = can('salesTotals');
  const showVar = can('variance');
  return `
    <div class="row" style="margin-bottom:12px">
      ${sh ? `<div class="ok-box grow" style="margin:0">กะปัจจุบันเปิดตั้งแต่ ${esc(sh.openedAtTH)} โดย ${esc(sh.openedBy || '-')} · ${cur.bills} บิล${showSales ? ` · ยอดขาย ${money(cur.netSales)}` : ''}${showVar ? ` · เงินสดที่ควรมี ${money(cur.expected)}` : ''}</div>`
    : '<div class="warn-box grow" style="margin:0">ยังไม่ได้เปิดกะ</div>'}
      <button class="btn btn-primary" data-shh="panel" type="button">${svg('cash', 18)} ${sh ? (can('cashMove') ? 'เงินเข้า-ออก / ปิดกะ' : 'ปิดกะ') : 'เปิดกะ'}</button>
    </div>
    ${shiftHistory.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>กะ</th><th>เปิด</th><th>ปิด</th><th class="num">บิล</th>${showSales ? '<th class="num">ยอดขาย</th>' : ''}${showVar ? '<th class="num">เงินสดควรมี</th><th class="num">นับได้</th><th class="num">ส่วนต่าง</th>' : ''}<th></th></tr></thead>
      <tbody>${shiftHistory.slice(0, 120).map((s) => `<tr>
        <td class="oid">${esc(s.id)}${s.remote ? `<div class="help" style="margin:0">${esc(s.device || 'Cloud')}</div>` : ''}</td><td>${esc(s.openedAtTH)}<div class="help" style="margin:0">${esc(s.openedBy || '')}</div></td>
        <td>${esc(s.closedAtTH)}<div class="help" style="margin:0">${esc(s.closedBy || '')}</div></td>
        <td class="num">${s.bills}</td>${showSales ? `<td class="num">${money(s.netSales)}</td>` : ''}
        ${showVar ? `<td class="num">${money(s.expected)}</td><td class="num">${money(s.counted)}</td>
        <td class="num" style="color:${s.diff < 0 ? 'var(--danger)' : s.diff > 0 ? 'var(--warn)' : 'var(--ok)'}"><b>${s.diff > 0 ? '+' : ''}${fmtNum(s.diff)}</b></td>` : ''}
        <td><button class="btn btn-outline btn-sm" data-shh="print" data-id="${esc(s.id)}" type="button">${svg('printer', 16)}</button></td></tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty-state">${svg('cash', 40)}<p>ยังไม่มีประวัติการปิดกะ</p></div>`}`;
}
function shiftHistoryClick(e) {
  const b = e.target.closest('[data-shh]');
  if (!b) return;
  if (b.dataset.shh === 'panel') return openShiftPanel();
  const s = (shiftHistory || []).find((x) => x.id === b.dataset.id);
  if (s) printShiftSummary(s);
}

/* ==========================================================================
   7. MEMBERS & POINTS (lightweight CRM)
   ========================================================================== */

async function memberFind() {
  const phone = String(payCtx.phone || ($('#memberPhone') && $('#memberPhone').value) || '').replace(/\D/g, '');
  if (phone.length < 9 || phone.length > 10) return toast('ใส่เบอร์โทร 9-10 หลัก', 'warn');
  state.cart.customer = { phone, name: (state.customers[phone] && state.customers[phone].name) || '', redeem: 0 };
  save.cart();
  renderPayment();
  renderTotals();
  const url = (state.settings.gasUrl || '').trim();
  if (!url || !navigator.onLine) return;
  try {
    const res = await postToSheet(url, { source: 'ipad-pos', device: state.settings.devicePrefix, actions: [{ qid: 'cust', action: 'PULL_CUSTOMER', data: { phone } }] }, { needResponse: true, timeout: 12000 });
    const r = res.results && res.results[0];
    if (r && r.ok && r.result) {
      const pending = pendingCustomerDelta(phone);
      state.customers[phone] = Object.assign(normalizeCustomer(r.result), { points: num(r.result.points) + pending });
      save.customers();
      if (state.cart.customer && state.cart.customer.phone === phone && !state.cart.customer.name) state.cart.customer.name = state.customers[phone].name;
      if (isOpen('m-pay')) { renderPayment(); renderTotals(); }
    }
  } catch (e) { /* offline lookup is fine */ }
}

function memberRedeem(step) {
  const c = state.cart.customer;
  const known = c && state.customers[c.phone];
  if (!known) return;
  const loy = prefs().loyalty;
  const base = calcTotals(state.cart.lines, state.cart.manualDiscount, { off: state.cart.promoOff, mode: state.cart.promoMode, member: true, redeem: 0 });
  const left = round2(base.net + base.manualDiscount);
  const max = Math.min(Math.floor(known.points), Math.floor(left / loy.pointValue));
  let v = step === 'max' ? max : toInt(c.redeem) + step;
  v = Math.max(0, Math.min(max, v));
  if (v > 0 && v < loy.minRedeem) v = step > 0 && max >= loy.minRedeem ? loy.minRedeem : 0;
  c.redeem = v;
  save.cart();
  renderPayment();
  renderTotals();
}

function normalizeCustomer(x) {
  return { phone: String(x.phone || ''), name: String(x.name || ''), points: num(x.points), visits: toInt(x.visits), spent: num(x.spent), last: String(x.last || '') };
}
/** sign +1 = new bill, −1 = void */
function applyCustomerOrder(o, sign) {
  const c = o.customer;
  const cur = state.customers[c.phone] || { phone: c.phone, name: c.name || '', points: 0, visits: 0, spent: 0, last: '' };
  cur.points = Math.max(0, round2(cur.points + sign * ((c.earned || 0) - (c.redeemed || 0))));
  cur.visits = Math.max(0, cur.visits + sign);
  cur.spent = Math.max(0, round2(cur.spent + sign * o.net));
  if (sign > 0) { cur.last = o.date; if (c.name) cur.name = c.name; }
  state.customers[c.phone] = cur;
  save.customers();
}
/** Points of bills still waiting in this device's queue (not yet on the cloud). */
function pendingCustomerDelta(phone) {
  let d = 0;
  for (const q of state.queue) {
    if (q.payload) continue;
    const o = state.orders.find((x) => x.id === q.orderId);
    if (!o || !o.customer || o.customer.phone !== phone) continue;
    const pts = (o.customer.earned || 0) - (o.customer.redeemed || 0);
    d += q.action === 'NEW_ORDER' ? pts : -pts;
  }
  return d;
}
function applyPulledCustomers(list) {
  const map = {};
  for (const x of list) { const c = normalizeCustomer(x); if (c.phone) map[c.phone] = c; }
  for (const phone of Object.keys(map)) map[phone].points = Math.max(0, map[phone].points + pendingCustomerDelta(phone));
  // keep local-only customers whose first bill has not reached the cloud yet
  for (const phone of Object.keys(state.customers)) if (!map[phone] && pendingCustomerDelta(phone)) map[phone] = state.customers[phone];
  state.customers = map;
  save.customers();
}

function settingsLoyaltyHTML() {
  const l = prefs().loyalty;
  const list = Object.values(state.customers).sort((a, b) => b.spent - a.spent);
  return `
    <div class="section">
      <button class="switch-row" data-act="pref-toggle" data-k="loyalty.enabled" type="button">
        <span class="switch ${l.enabled ? 'on' : ''}"><span></span></span>
        <span><b>เปิดระบบสมาชิก & สะสมแต้ม</b><small>ใส่เบอร์โทรลูกค้าในหน้าชำระเงิน · ข้อมูลอยู่ในชีต Customers</small></span>
      </button>
      <div class="row" style="margin-top:8px">
        <span>ทุก ๆ</span><input class="input num-in" data-pref="loyalty.spendPerPoint" type="number" inputmode="decimal" min="1" value="${l.spendPerPoint}" /><span>บาท = 1 แต้ม</span>
        <span style="margin-left:16px">ใช้แลก: 1 แต้ม =</span><input class="input num-in" data-pref="loyalty.pointValue" type="number" inputmode="decimal" min="0" step="0.5" value="${l.pointValue}" /><span>บาท</span>
        <span style="margin-left:16px">ขั้นต่ำต่อครั้ง</span><input class="input num-in" data-pref="loyalty.minRedeem" type="number" inputmode="numeric" min="0" value="${l.minRedeem}" /><span>แต้ม</span>
      </div>
      <p class="help">ตัวอย่าง: ซื้อ ${money(l.spendPerPoint * 3)} ได้ 3 แต้ม · สะสม ${l.minRedeem || 10} แต้ม แลกส่วนลด ${money((l.minRedeem || 10) * l.pointValue)} · ตั้งโปร “เฉพาะสมาชิก” ได้ในหน้าโปรโมชั่น</p>
    </div>
    <div class="section">
      <div class="section-title">สมาชิกที่มีข้อมูลในเครื่อง (${list.length}) <small>กด “ดึงจาก Cloud” ในแท็บ Cloud Sync เพื่ออัปเดตจากทุกเครื่อง</small></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl" style="min-width:600px"><thead><tr><th>เบอร์</th><th>ชื่อ</th><th class="num">แต้ม</th><th class="num">มา (ครั้ง)</th><th class="num">ยอดซื้อรวม</th><th>ล่าสุด</th></tr></thead>
        <tbody>${list.slice(0, 200).map((c) => `<tr><td>${esc(fmtPhone(c.phone))}</td><td>${esc(c.name)}</td><td class="num"><b>${fmtNum(c.points)}</b></td><td class="num">${c.visits}</td><td class="num">${money(c.spent)}</td><td>${esc(c.last ? fmtDateKeyTH(c.last) : '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">ยังไม่มีสมาชิก</div>'}
    </div>`;
}

/* ==========================================================================
   8. STOCK LOG (restock / waste / giveaway …) & manual adjustments
   ========================================================================== */
let stockLogCache = null;
const logView = { days: 7, reason: 'all' };

function logStock(pool, before, after, reasonId, note, who) {
  const now = new Date();
  const p = IDX.pool[pool];
  const reason = state.catalog.stockReasons.find((r) => r.id === reasonId) || { id: reasonId, label: reasonId === 'count' ? 'นับสต็อกปรับยอด' : reasonId, sign: 0 };
  const delta = after - before;
  const e = {
    id: `SL-${state.settings.devicePrefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    atISO: isoLocal(now), atTH: fmtDateTime(now), date: dateKey(now), device: state.settings.devicePrefix,
    pool, poolName: p ? p.name : pool, unit: p ? unitLabel(p.unit) : '', delta, before, after,
    reason: reason.id, reasonLabel: reason.label, note: note || '', staff: (who && who.name) || (state.session && state.session.name) || '',
    costValue: round2(delta * ((p && p.cost) || 0)),
  };
  DataDB.put('stocklog', [e]).catch((err) => console.warn('stock log save failed', err));
  if (stockLogCache) stockLogCache.unshift(e);
  enqueue('STOCK_LOG', '', e, `${e.poolName} ${delta > 0 ? '+' : ''}${delta} (${e.reasonLabel})`);
  logActivity('STOCK', `${e.poolName} ${delta > 0 ? '+' : ''}${fmtNum(delta)} ${e.unit} (${e.reasonLabel})${note ? ` · ${note}` : ''}`, 0, who);
}

let adjCtx = null;
function openStockAdjust(poolId) {
  const p = IDX.pool[poolId];
  if (!p) return;
  const first = state.catalog.stockReasons.find((r) => r.sign === -1) || state.catalog.stockReasons[0];
  adjCtx = { pool: poolId, reason: first.id, amount: '', note: '' };
  ensureModal('m-stockadj', { size: 'sm', title: '', z: 'mid' });
  renderStockAdj();
  openModal('m-stockadj');
}
function renderStockAdj(focus) {
  const m = $('#m-stockadj');
  const p = IDX.pool[adjCtx.pool];
  const cur = state.stock[adjCtx.pool] || 0;
  const r = state.catalog.stockReasons.find((x) => x.id === adjCtx.reason) || state.catalog.stockReasons[0];
  const n = toInt(adjCtx.amount);
  const after = r.sign === 0 ? n : Math.max(0, cur + r.sign * n);
  m.querySelector('.modal-title').textContent = `ปรับสต็อก: ${p.name}`;
  m.querySelector('.modal-body').innerHTML = `
    <div class="info-strip">คงเหลือตอนนี้ <b>${fmtNum(cur)} ${esc(unitLabel(p.unit))}</b></div>
    <div class="adj-reasons">${state.catalog.stockReasons.map((x) => `<button class="mchip ${x.id === r.id ? 'on' : ''}" data-adj="reason" data-v="${esc(x.id)}" type="button">${x.sign > 0 ? '＋' : x.sign < 0 ? '－' : '＝'} ${esc(x.label)}</button>`).join('')}</div>
    <label class="field-label" style="margin-top:12px">${r.sign === 0 ? 'จำนวนที่นับได้จริง' : r.sign > 0 ? 'จำนวนที่เพิ่ม' : 'จำนวนที่ตัดออก'} (${esc(unitLabel(p.unit))})</label>
    <input class="input big-in" data-adjf="amount" type="text" inputmode="numeric" value="${esc(adjCtx.amount)}" placeholder="0" />
    <input class="input" data-adjf="note" type="text" placeholder="หมายเหตุ เช่น ล็อตวันที่ / สาเหตุ" value="${esc(adjCtx.note)}" style="margin-top:8px" />
    <div class="calc-box" style="margin-top:10px"><div class="sum-row total"><span>หลังปรับ</span><span>${fmtNum(after)} ${esc(unitLabel(p.unit))}</span></div>
      ${p.cost ? `<div class="sum-row muted"><span>มูลค่าต้นทุน</span><span>${money(Math.abs(after - cur) * p.cost)}</span></div>` : ''}</div>`;
  m.querySelector('.modal-foot').innerHTML = `<button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button><button class="btn btn-primary btn-lg" data-adj="ok" type="button" ${adjCtx.amount === '' ? 'disabled' : ''}>บันทึก</button>`;
  if (focus) { const el = m.querySelector(`[data-adjf="${focus}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}
function stockAdjInput(e) {
  const k = e.target.dataset.adjf;
  if (!k) return;
  adjCtx[k] = k === 'amount' ? e.target.value.replace(/\D/g, '').slice(0, 7) : e.target.value;
  if (k === 'amount') renderStockAdj('amount');
}
async function stockAdjClick(e) {
  const b = e.target.closest('[data-adj]');
  if (!b || b.disabled) return;
  if (b.dataset.adj === 'reason') { adjCtx.reason = b.dataset.v; return renderStockAdj('amount'); }
  const r = state.catalog.stockReasons.find((x) => x.id === adjCtx.reason) || state.catalog.stockReasons[0];
  const cur = state.stock[adjCtx.pool] || 0;
  const n = toInt(adjCtx.amount);
  const after = r.sign === 0 ? n : Math.max(0, cur + r.sign * n);
  const ok = await setStock(adjCtx.pool, after, { reason: r.id, note: adjCtx.note.trim() });
  if (!ok) return;
  closeModal('m-stockadj');
  if (isOpen('m-manage')) renderManager();
  toast(`${poolName(adjCtx.pool)}: ${fmtNum(cur)} → ${fmtNum(after)} (${r.label})`, 'success');
}

function mgrStockLogHTML() {
  if (!stockLogCache) {
    DataDB.all('stocklog').then((rows) => { stockLogCache = rows.sort((a, b) => (a.atISO < b.atISO ? 1 : -1)); if (isOpen('m-manage') && mgr.tab === 'log') renderManager(); })
      .catch(() => { stockLogCache = []; });
    return '<div class="empty-state">กำลังโหลด…</div>';
  }
  const from = shiftDateKey(todayKey(), -(logView.days - 1));
  const rows = stockLogCache.filter((e) => e.date >= from && (logView.reason === 'all' || e.reason === logView.reason));
  const byReason = {};
  for (const e of stockLogCache.filter((x) => x.date >= from)) {
    const k = e.reasonLabel;
    byReason[k] = byReason[k] || { n: 0, value: 0 };
    byReason[k].n++;
    byReason[k].value = round2(byReason[k].value + e.costValue);
  }
  return `
    <div class="mgr-toolbar">
      <div class="chips">
        ${[[1, 'วันนี้'], [7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน']].map(([d, l]) => `<button class="fchip ${logView.days === d ? 'on' : ''}" data-act="log-days" data-v="${d}" type="button">${l}</button>`).join('')}
      </div>
      <select class="input" data-log="reason" style="width:240px"><option value="all">ทุกเหตุผล</option>${state.catalog.stockReasons.map((r) => `<option value="${esc(r.id)}" ${logView.reason === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
    </div>
    <div class="stat-grid">${Object.keys(byReason).map((k) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${byReason[k].n} ครั้ง</div><div class="s">มูลค่าต้นทุน ${money(Math.abs(byReason[k].value))}</div></div>`).join('') || '<div class="help">ไม่มีรายการในช่วงนี้</div>'}</div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>เวลา</th><th>สต็อก</th><th class="num">เปลี่ยน</th><th class="num">ก่อน → หลัง</th><th>เหตุผล</th><th>หมายเหตุ</th><th>ผู้ทำ</th><th class="num">มูลค่า</th></tr></thead>
      <tbody>${rows.slice(0, 500).map((e) => `<tr>
        <td class="nowrap">${esc(e.atTH)}</td><td>${esc(e.poolName)}</td>
        <td class="num" style="color:${e.delta < 0 ? 'var(--danger)' : 'var(--ok)'}"><b>${e.delta > 0 ? '+' : ''}${fmtNum(e.delta)}</b> ${esc(e.unit)}</td>
        <td class="num">${fmtNum(e.before)} → ${fmtNum(e.after)}</td><td>${esc(e.reasonLabel)}</td><td>${esc(e.note)}</td><td>${esc(e.staff)}</td>
        <td class="num">${e.costValue ? money(Math.abs(e.costValue)) : '-'}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-state">${svg('list', 40)}<p>ยังไม่มีประวัติการปรับสต็อกในช่วงนี้</p></div>`}`;
}
function stockLogAction(act, b) {
  if (act === 'log-days') { logView.days = Number(b.dataset.v); renderManager(); }
}
function stockLogChange(el) {
  if (el.dataset.log === 'reason') { logView.reason = el.value; renderManager(); }
}

/* ==========================================================================
   9. MANAGER ▸ SHOP OPTIONS (units · quick notes · stock reasons · low-stock defaults)
   ========================================================================== */

function mgrShopHTML() {
  const c = state.catalog;
  const ld = c.prefs.lowDefaults;
  const usedUnits = new Set(c.pools.map((p) => p.unit));
  return `
    <div class="section">
      <div class="section-title">หน่วยนับของสต็อก <small>(ชิ้น, กรัม, สกู๊ป, แก้ว, กล่อง …)</small></div>
      <div class="shop-grid">${c.units.map((u) => `
        <div class="shop-item"><input class="input" data-shop="unit" data-id="${esc(u.id)}" type="text" value="${esc(u.label)}" />
          ${['pcs', 'g'].includes(u.id) || usedUnits.has(u.id) ? `<span class="help" style="margin:0">${u.id === 'g' ? 'ใช้กับเมนูชั่งน้ำหนัก' : usedUnits.has(u.id) ? 'ใช้อยู่' : 'หน่วยหลัก'}</span>` : `<button class="icon-btn sm danger" data-act="shop-unit-del" data-id="${esc(u.id)}" type="button" aria-label="ลบ">${svg('trash', 16)}</button>`}</div>`).join('')}</div>
      <div class="mgr-add"><input class="input grow" id="newUnit" type="text" placeholder="หน่วยใหม่ เช่น แก้ว" /><button class="btn btn-primary" data-act="shop-unit-add" type="button">${svg('plus', 18)} เพิ่มหน่วย</button></div>
    </div>
    <div class="section">
      <div class="section-title">ปุ่มหมายเหตุสำเร็จรูป <small>(กดเลือกในตะกร้า / ต่อรายการ)</small></div>
      <div class="chips">${c.quickNotes.map((n, i) => `<span class="mchip on">${esc(n)} <button class="x" data-act="shop-note-del" data-i="${i}" type="button" aria-label="ลบ">×</button></span>`).join('')}</div>
      <div class="mgr-add"><input class="input grow" id="newNote" type="text" placeholder="เช่น ใส่ถุงผ้า, ไม่ใส่น้ำแข็ง" /><button class="btn btn-primary" data-act="shop-note-add" type="button">${svg('plus', 18)} เพิ่ม</button></div>
    </div>
    <div class="section">
      <div class="section-title">เหตุผลการปรับสต็อก <small>(ใช้วิเคราะห์ของเสีย / แจกฟรี)</small></div>
      ${c.stockReasons.map((r) => `
        <div class="mgr-row">
          <input class="input grow" data-shop="reason" data-id="${esc(r.id)}" type="text" value="${esc(r.label)}" />
          <select class="input" data-shop="reason-sign" data-id="${esc(r.id)}" style="width:220px">
            <option value="1" ${r.sign === 1 ? 'selected' : ''}>＋ เพิ่มสต็อก</option>
            <option value="-1" ${r.sign === -1 ? 'selected' : ''}>－ ตัดสต็อก</option>
            <option value="0" ${r.sign === 0 ? 'selected' : ''}>＝ ตั้งยอดที่นับได้</option>
          </select>
          ${c.stockReasons.length > 1 ? `<button class="icon-btn sm danger" data-act="shop-reason-del" data-id="${esc(r.id)}" type="button" aria-label="ลบ">${svg('trash', 16)}</button>` : ''}
        </div>`).join('')}
      <div class="mgr-add"><input class="input grow" id="newReason" type="text" placeholder="เช่น ส่งสาขา, ตกแตก" /><button class="btn btn-primary" data-act="shop-reason-add" type="button">${svg('plus', 18)} เพิ่มเหตุผล</button></div>
    </div>
    <div class="section">
      <div class="section-title">แจ้งเตือนสต็อกใกล้หมด (ค่าเริ่มต้น) <small>ตั้งแยกรายเมนูได้ในหน้าแก้ไขเมนู</small></div>
      <div class="row">
        <span>ขายเป็นชิ้น ≤</span><input class="input num-in" data-shop="low" data-id="unit" type="number" min="0" value="${ld.unit}" /><span>ชิ้น</span>
        <span style="margin-left:14px">ชั่งน้ำหนัก ≤</span><input class="input num-in" data-shop="low" data-id="weight" type="number" min="0" value="${ld.weight}" /><span>กรัม</span>
        <span style="margin-left:14px">เซ็ต ≤</span><input class="input num-in" data-shop="low" data-id="set" type="number" min="0" value="${ld.set}" /><span>เซ็ต</span>
      </div>
    </div>`;
}

function mgrShopAction(act, b) {
  const c = state.catalog;
  const id = b.dataset.id;
  if (act === 'shop-unit-add') {
    const label = $('#newUnit').value.trim();
    if (!label) return toast('ใส่ชื่อหน่วย', 'warn');
    c.units.push({ id: `u_${uid()}`, label });
  } else if (act === 'shop-unit-del') c.units = c.units.filter((u) => u.id !== id);
  else if (act === 'shop-note-add') {
    const n = $('#newNote').value.trim();
    if (!n) return;
    if (!c.quickNotes.includes(n)) c.quickNotes.push(n);
  } else if (act === 'shop-note-del') c.quickNotes.splice(Number(b.dataset.i), 1);
  else if (act === 'shop-reason-add') {
    const label = $('#newReason').value.trim();
    if (!label) return toast('ใส่เหตุผล', 'warn');
    c.stockReasons.push({ id: `r_${uid()}`, label, sign: -1 });
  } else if (act === 'shop-reason-del') c.stockReasons = c.stockReasons.filter((r) => r.id !== id);
  commitCatalog();
  renderManager();
}
function mgrShopChange(el) {
  const c = state.catalog;
  const id = el.dataset.id;
  const k = el.dataset.shop;
  if (k === 'unit') { const u = c.units.find((x) => x.id === id); if (u && el.value.trim()) u.label = el.value.trim(); }
  else if (k === 'reason') { const r = c.stockReasons.find((x) => x.id === id); if (r && el.value.trim()) r.label = el.value.trim(); }
  else if (k === 'reason-sign') { const r = c.stockReasons.find((x) => x.id === id); if (r) r.sign = Number(el.value); }
  else if (k === 'low') c.prefs.lowDefaults[id] = toInt(el.value);
  commitCatalog();
  renderManager();
}

/* ==========================================================================
   10. SETTINGS ▸ receipt · payment methods · KDS · shared prefs
   ========================================================================== */

function settingsReceiptHTML() {
  const r = prefs().receipt;
  return `
    <div class="section">
      <div class="section-title">ใบเสร็จ <small>(พิมพ์ผ่าน AirPrint / เครื่องพิมพ์ความร้อน หรือแชร์เป็นรูปทาง LINE / AirDrop)</small></div>
      <div class="ed-row">
        <label class="ed-field"><span>ที่อยู่ร้าน</span><input class="input" data-pref="receipt.address" type="text" value="${esc(r.address)}" /></label>
        <label class="ed-field"><span>เบอร์โทรร้าน</span><input class="input" data-pref="receipt.phone" type="text" value="${esc(r.phone)}" /></label>
        <label class="ed-field"><span>เลขประจำตัวผู้เสียภาษี (ถ้ามี)</span><input class="input" data-pref="receipt.taxId" type="text" value="${esc(r.taxId)}" /></label>
        <label class="ed-field"><span>ข้อความท้ายใบเสร็จ</span><input class="input" data-pref="receipt.footer" type="text" value="${esc(r.footer)}" /></label>
      </div>
      <div class="row"><span>ขนาดกระดาษ</span>
        <div class="seg"><button class="${r.width === '58' ? 'on' : ''}" data-act="pref-set" data-k="receipt.width" data-v="58" type="button">58 mm</button><button class="${r.width === '80' ? 'on' : ''}" data-act="pref-set" data-k="receipt.width" data-v="80" type="button">80 mm</button></div>
      </div>
      <button class="switch-row" data-act="pref-toggle" data-k="receipt.showDone" type="button">
        <span class="switch ${r.showDone ? 'on' : ''}"><span></span></span>
        <span><b>แสดงหน้าจอเลขคิว + ใบเสร็จหลังชำระเงิน</b><small>มีปุ่มพิมพ์ / แชร์รูปใบเสร็จ</small></span>
      </button>
    </div>`;
}

function settingsPayHTML() {
  const p = prefs();
  const list = state.catalog.payMethods;
  return `
    <div class="section">
      <div class="section-title">พร้อมเพย์ — สร้าง QR ตามยอดอัตโนมัติ</div>
      <div class="row">
        <label class="ed-field" style="width:300px;margin:0"><span>เบอร์มือถือ / เลขบัตร ปชช. / เลขผู้เสียภาษี</span><input class="input" data-pref="promptpayId" type="text" inputmode="numeric" value="${esc(p.promptpayId)}" placeholder="0812345678" /></label>
        <label class="ed-field grow" style="margin:0"><span>ชื่อบัญชี (แสดงใต้ QR)</span><input class="input" data-pref="promptpayName" type="text" value="${esc(p.promptpayName)}" /></label>
      </div>
      ${p.promptpayId ? `<div class="qr-panel" style="margin-top:10px">${promptPayQR(p.promptpayId, 1, 3)}<div><b>ทดสอบ ฿1</b><small>สแกนด้วยแอปธนาคารเพื่อตรวจว่าเป็นบัญชีที่ถูกต้อง</small></div></div>` : ''}
    </div>
    <div class="section">
      <div class="section-title">วิธีชำระเงิน <small>(เพิ่ม/ซ่อน/เรียงลำดับได้ · ซิงก์ทุกเครื่อง)</small></div>
      ${list.map((m, i) => `
        <div class="mgr-row ${m.active ? '' : 'is-off'}">
          <div class="mgr-order">
            <button class="icon-btn sm" data-act="pay-up" data-id="${esc(m.id)}" type="button" ${i === 0 ? 'disabled' : ''} aria-label="ขึ้น">${svg('up', 16)}</button>
            <button class="icon-btn sm" data-act="pay-down" data-id="${esc(m.id)}" type="button" ${i === list.length - 1 ? 'disabled' : ''} aria-label="ลง">${svg('down', 16)}</button>
          </div>
          <span class="pay-ic-sm">${svg(m.icon, 22)}</span>
          <input class="input grow" data-paym="label" data-id="${esc(m.id)}" type="text" value="${esc(m.label)}" />
          <input class="input" data-paym="en" data-id="${esc(m.id)}" type="text" value="${esc(m.en)}" placeholder="คำอธิบาย" style="width:170px" />
          <select class="input" data-paym="kind" data-id="${esc(m.id)}" style="width:210px" ${m.id === 'cash' ? 'disabled' : ''}>${Object.keys(PAY_KINDS).map((k) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${esc(PAY_KINDS[k])}</option>`).join('')}</select>
          <select class="input" data-paym="icon" data-id="${esc(m.id)}" style="width:110px">${PAY_ICONS.map((ic) => `<option value="${ic}" ${m.icon === ic ? 'selected' : ''}>${ic}</option>`).join('')}</select>
          <button class="btn ${m.active ? 'btn-ok' : 'btn-ghost'} btn-sm" data-act="pay-toggle" data-id="${esc(m.id)}" type="button">${m.active ? 'ใช้งาน' : 'ซ่อน'}</button>
          ${m.id === 'cash' ? '' : `<button class="icon-btn sm danger" data-act="pay-del" data-id="${esc(m.id)}" type="button" aria-label="ลบ">${svg('trash', 16)}</button>`}
        </div>`).join('')}
      <div class="mgr-add"><input class="input grow" id="newPay" type="text" placeholder="เช่น บัตรเครดิต, LINE MAN, GrabFood" /><button class="btn btn-primary" data-act="pay-add" type="button">${svg('plus', 18)} เพิ่มวิธีชำระเงิน</button></div>
    </div>`;
}

function settingsKdsHTML() {
  const k = prefs().kds;
  return `
    <div class="section">
      <div class="section-title">จอจัดออเดอร์หลังร้าน (KDS)</div>
      <ol class="help" style="padding-left:18px;line-height:1.8">
        <li>ตั้ง Google Sheets URL ให้เหมือนเครื่องขาย แล้วที่แท็บ “เครื่องนี้” เลือกโหมด <b>จอจัดออเดอร์ (KDS)</b> บน iPad เครื่องที่ 2</li>
        <li>เครื่องขายส่งออเดอร์พร้อมเลขคิว + หมายเหตุ · KDS ดึงคิวใหม่ทุก ${k.pollSec} วินาที (ดีเลย์ประมาณ 3–10 วิ)</li>
        <li>เลือกได้ว่าหมวดไหน “ส่งเข้าครัว” ที่ จัดการเมนู ▸ หมวดหมู่</li>
      </ol>
      <div class="row">
        <span>การ์ดเป็นสีเหลืองเมื่อรอ ≥</span><input class="input num-in" data-pref="kds.warnMin" type="number" min="1" value="${k.warnMin}" /><span>นาที</span>
        <span style="margin-left:14px">สีแดงเมื่อรอ ≥</span><input class="input num-in" data-pref="kds.lateMin" type="number" min="2" value="${k.lateMin}" /><span>นาที</span>
        <span style="margin-left:14px">ดึงข้อมูลทุก</span><input class="input num-in" data-pref="kds.pollSec" type="number" min="3" max="60" value="${k.pollSec}" /><span>วินาที</span>
      </div>
    </div>`;
}

function setPref(path, value) {
  setPath(state.catalog.prefs, path, value);
  state.catalog.prefs = normalizePrefs(state.catalog.prefs);
  commitCatalog();
}

async function settingsAction(act, b) {
  const pms = state.catalog.payMethods;
  const id = b.dataset.id;
  const i = pms.findIndex((m) => m.id === id);
  if (act.startsWith('staff-')) return staffAction(act, id);
  if (act === 'perm') { setPref(`perms.${b.dataset.k}`, b.dataset.v); return renderSettings(); }
  if (act === 'pref-toggle') { const cur = getPath(state.catalog.prefs, b.dataset.k); setPref(b.dataset.k, !cur); return renderSettings(); }
  if (act === 'pref-set') { setPref(b.dataset.k, b.dataset.v); return renderSettings(); }
  if (act === 'pay-add') {
    const label = $('#newPay').value.trim();
    if (!label) return toast('ใส่ชื่อวิธีชำระเงิน', 'warn');
    pms.push({ id: `pay_${uid()}`, label, en: '', kind: 'other', icon: 'card', active: true });
  } else if (i < 0) return;
  else if (act === 'pay-toggle') {
    if (pms[i].active && pms.filter((m) => m.active).length <= 1) return toast('ต้องมีอย่างน้อย 1 วิธีที่ใช้งาน', 'warn');
    pms[i].active = !pms[i].active;
  } else if (act === 'pay-up' && i > 0) [pms[i - 1], pms[i]] = [pms[i], pms[i - 1]];
  else if (act === 'pay-down' && i < pms.length - 1) [pms[i + 1], pms[i]] = [pms[i], pms[i + 1]];
  else if (act === 'pay-del') {
    const r = await confirmDialog({ title: 'ลบวิธีชำระเงิน', html: `ลบ <b>${esc(pms[i].label)}</b> ? (บิลเก่ายังแสดงชื่อเดิม)`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    pms.splice(i, 1);
  }
  commitCatalog();
  renderSettings();
}

function settingsChange(el) {
  if (el.dataset.pref) {
    const v = el.type === 'number' ? num(el.value) : el.value.trim();
    setPref(el.dataset.pref, v);
    if (el.dataset.pref.startsWith('promptpay')) renderSettings();
    return;
  }
  if (el.dataset.paym) {
    const m = state.catalog.payMethods.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const k = el.dataset.paym;
    if (k === 'label' && !el.value.trim()) return renderSettings();
    m[k] = el.value.trim();
    commitCatalog();
    if (k !== 'label' && k !== 'en') renderSettings();
  }
}

function setDeviceMode(mode) {
  if (mode === state.settings.deviceMode) return;
  if (mode === 'kds' && !(state.settings.gasUrl || '').trim()) toast('โหมด KDS ต้องตั้ง Google Sheets URL ก่อน', 'warn', 4000);
  state.settings.deviceMode = mode;
  save.settings();
  location.reload();
}

/* ==========================================================================
   11. ANALYTICS — top sellers · peak hours · by day · profit (COGS) · waste
   ========================================================================== */
const rep = { days: 7, scope: 'local', loading: false, remote: null, remoteKey: '', error: '' };

function reportRange() {
  const to = todayKey();
  return { from: shiftDateKey(to, -(rep.days - 1)), to };
}

/** Local orders → common rows */
function reportDataLocal(from, to) {
  const bills = [];
  const items = [];
  for (const o of state.orders) {
    if (o.date < from || o.date > to) continue;
    const hour = Number((o.createdAtISO || '').slice(11, 13)) || 0;
    bills.push({ id: o.id, date: o.date, hour, net: o.net, cost: o.totalCost || 0, method: o.payment.label, staff: (o.staff && o.staff.name) || '-', status: o.status, discount: o.totalDiscount || 0, device: o.device || '' });
    if (o.status === 'VOIDED') continue;
    for (const i of o.items || []) items.push({ name: i.name, cat: i.category || '', qty: i.type === 'weight' ? 1 : i.qty, grams: i.type === 'weight' ? (i.soldG || 0) : 0, net: round2(i.net - (i.promoDiscount || 0)), cost: i.cost || 0 });
  }
  return { bills, items };
}

async function loadReportRemote() {
  if (rep.scope !== 'all') return;
  const url = (state.settings.gasUrl || '').trim();
  if (!url || !navigator.onLine) { rep.error = 'ออฟไลน์ หรือยังไม่ได้ตั้ง Cloud URL — แสดงเฉพาะข้อมูลในเครื่องนี้'; return renderHistory(); }
  const { from, to } = reportRange();
  const key = `${from}|${to}`;
  if (rep.remote && rep.remoteKey === key) return;
  rep.loading = true;
  rep.error = '';
  renderHistory();
  try {
    const res = await postToSheet(url, { source: 'ipad-pos', device: state.settings.devicePrefix, actions: [{ qid: 'report', action: 'PULL_REPORT', data: { from, to } }, { qid: 'acts', action: 'PULL_ACTIVITY', data: { from, to } }] }, { needResponse: true, timeout: 45000 });
    const r = res.results && res.results[0];
    const ra = res.results && res.results[1];
    if (!r || !r.ok) throw new Error((r && r.error) || 'PULL_REPORT failed');
    rep.remote = {
      bills: (r.result.bills || []).map((b) => ({ id: String(b.id), date: String(b.date), hour: toInt(b.hour), net: num(b.net), cost: num(b.cost), method: String(b.method || '-'), staff: String(b.staff || '-'), status: b.status === 'VOIDED' ? 'VOIDED' : 'COMPLETED', discount: num(b.discount), device: String(b.device || '') })),
      items: (r.result.items || []).map((i) => ({ name: String(i.name), cat: String(i.cat || ''), qty: num(i.qty), grams: num(i.grams), net: num(i.net), cost: num(i.cost) })),
      truncated: !!r.result.truncated,
      acts: ra && ra.ok ? (ra.result.rows || []).map(normalizeActivity) : [],
    };
    rep.remoteKey = key;
  } catch (e) {
    rep.error = `ดึงข้อมูลจาก Cloud ไม่สำเร็จ: ${e.message}`;
  } finally {
    rep.loading = false;
    if (isOpen('m-history') && histTab === 'report') renderHistory();
  }
}

function bars(rows, { fmt = (v) => money(v), color = '' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<div class="bars">${rows.map((r) => `
    <div class="bar-row"><span class="bar-k" title="${esc(r.k)}">${esc(r.k)}</span>
      <span class="bar-track"><span class="bar-fill ${color}" style="width:${Math.max(1.5, (r.v / max) * 100).toFixed(1)}%"></span></span>
      <span class="bar-v">${fmt(r.v)}${r.s ? `<small>${esc(r.s)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function reportHTML() {
  const { from, to } = reportRange();
  const useRemote = rep.scope === 'all' && rep.remote && rep.remoteKey === `${from}|${to}`;
  const data = useRemote ? rep.remote : reportDataLocal(from, to);
  const done = data.bills.filter((b) => b.status !== 'VOIDED');
  const sales = round2(done.reduce((s, b) => s + b.net, 0));
  const cost = round2(done.reduce((s, b) => s + b.cost, 0));
  const profit = round2(sales - cost);
  const disc = round2(done.reduce((s, b) => s + b.discount, 0));
  const hasCost = cost > 0;

  const byItem = {};
  for (const i of data.items) {
    const x = byItem[i.name] || (byItem[i.name] = { name: i.name, qty: 0, grams: 0, net: 0, cost: 0 });
    x.qty += i.qty; x.grams += i.grams; x.net = round2(x.net + i.net); x.cost = round2(x.cost + i.cost);
  }
  const items = Object.values(byItem).sort((a, b) => b.net - a.net);
  const byCat = {};
  for (const i of data.items) byCat[i.cat || '-'] = round2((byCat[i.cat || '-'] || 0) + i.net);

  const hours = {};
  for (const b of done) { const h = hours[b.hour] || (hours[b.hour] = { n: 0, v: 0 }); h.n++; h.v = round2(h.v + b.net); }
  const hk = Object.keys(hours).map(Number);
  const hMin = hk.length ? Math.min(...hk) : 0;
  const hourRows = hk.length ? Array.from({ length: Math.max(...hk) - hMin + 1 }, (_, i) => hMin + i)
    .map((h) => ({ k: `${pad(h)}:00`, v: hours[h] ? hours[h].v : 0, s: hours[h] ? ` ${hours[h].n} บิล` : '' })) : [];
  const peak = hk.length ? hk.reduce((a, b) => (hours[b].v > hours[a].v ? b : a)) : null;
  const days = {};
  for (const b of done) days[b.date] = round2((days[b.date] || 0) + b.net);
  const dayRows = [];
  for (let d = from; d <= to; d = shiftDateKey(d, 1)) dayRows.push({ k: d.slice(5).split('-').reverse().join('/'), v: days[d] || 0 });
  const group = (key) => { const m = {}; for (const b of done) m[b[key]] = round2((m[b[key]] || 0) + b.net); return Object.keys(m).map((k) => ({ k, v: m[k] })).sort((a, b) => b.v - a.v); };

  if (!stockLogCache) DataDB.all('stocklog').then((rows) => { stockLogCache = rows.sort((a, b) => (a.atISO < b.atISO ? 1 : -1)); if (isOpen('m-history') && histTab === 'report') renderHistory(); }).catch(() => { stockLogCache = []; });
  const waste = {};
  for (const e of (stockLogCache || []).filter((x) => x.date >= from && x.date <= to && x.delta < 0 && x.reason !== 'count')) {
    const w = waste[e.reasonLabel] || (waste[e.reasonLabel] = { n: 0, v: 0 });
    w.n += -e.delta;
    w.v = round2(w.v - e.costValue);
  }

  return `
    <div class="mgr-toolbar">
      <div class="chips">${[[1, 'วันนี้'], [7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน']].map(([d, l]) => `<button class="fchip ${rep.days === d ? 'on' : ''}" data-rep="days" data-v="${d}" type="button">${l}</button>`).join('')}</div>
      <div class="seg">
        <button class="${rep.scope === 'local' ? 'on' : ''}" data-rep="scope" data-v="local" type="button">เครื่องนี้</button>
        <button class="${rep.scope === 'all' ? 'on' : ''}" data-rep="scope" data-v="all" type="button">${svg('cloud', 16)} ทุกเครื่อง (Cloud)</button>
      </div>
    </div>
    ${rep.loading ? '<div class="info-strip" style="display:block">กำลังดึงข้อมูลทุกเครื่องจาก Google Sheets…</div>' : ''}
    ${rep.error ? `<div class="warn-box">${esc(rep.error)}</div>` : ''}
    ${useRemote && rep.remote.truncated ? '<div class="warn-box">ข้อมูลมากเกินไป — แสดงบางส่วน ลองเลือกช่วงวันที่สั้นลง</div>' : ''}
    <div class="stat-grid four">
      <div class="stat primary"><div class="k">ยอดขายสุทธิ</div><div class="v">${money(sales)}</div><div class="s">${done.length} บิล · เฉลี่ย ${money(done.length ? sales / done.length : 0)}/บิล</div></div>
      <div class="stat"><div class="k">ต้นทุนสินค้า (COGS)</div><div class="v">${hasCost ? money(cost) : '—'}</div><div class="s">${hasCost ? '' : 'ใส่ต้นทุนที่ จัดการเมนู ▸ สต็อก'}</div></div>
      <div class="stat"><div class="k">กำไรขั้นต้น</div><div class="v" style="color:${profit < 0 ? 'var(--danger)' : 'var(--ok)'}">${hasCost ? money(profit) : '—'}</div><div class="s">${hasCost && sales ? `มาร์จิ้น ${Math.round((profit / sales) * 100)}%` : ''}</div></div>
      <div class="stat"><div class="k">ส่วนลดที่ให้ไป</div><div class="v">${money(disc)}</div><div class="s">${data.bills.length - done.length ? `ยกเลิก ${data.bills.length - done.length} บิล` : ''}</div></div>
    </div>
    ${staffDashHTML(data, from, to)}
    <div class="report-grid">
      <div class="card-box"><div class="section-title" style="margin-top:0">🏆 เมนูขายดี (ตามยอดขาย)</div>
        ${items.length ? `<div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>#</th><th>เมนู</th><th class="num">จำนวน</th><th class="num">ยอดขาย</th>${hasCost ? '<th class="num">กำไร</th>' : ''}</tr></thead>
          <tbody>${items.slice(0, 15).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="num">${x.grams ? `${fmtNum(x.grams)} ก.` : fmtNum(x.qty)}</td><td class="num">${money(x.net)}</td>${hasCost ? `<td class="num">${x.cost ? `${money(x.net - x.cost)} <small class="help">${x.net ? Math.round(((x.net - x.cost) / x.net) * 100) : 0}%</small>` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="help">ไม่มีข้อมูล</div>'}
      </div>
      <div class="card-box"><div class="section-title" style="margin-top:0">⏰ ช่วงเวลาขายดี ${peak != null ? `<small>พีค ${pad(peak)}:00–${pad(peak + 1)}:00</small>` : ''}</div>
        ${hourRows.length ? bars(hourRows) : '<div class="help">ไม่มีข้อมูล</div>'}</div>
      ${rep.days > 1 ? `<div class="card-box"><div class="section-title" style="margin-top:0">📅 ยอดขายรายวัน</div>${bars(dayRows.slice(-31))}</div>` : ''}
      <div class="card-box"><div class="section-title" style="margin-top:0">🗂️ ตามหมวดหมู่</div>${bars(Object.keys(byCat).map((k) => ({ k, v: byCat[k] })).sort((a, b) => b.v - a.v), { color: 'alt' })}</div>
      <div class="card-box"><div class="section-title" style="margin-top:0">💳 ตามวิธีชำระเงิน</div>${bars(group('method'), { color: 'alt' })}</div>
      <div class="card-box"><div class="section-title" style="margin-top:0">🧑‍🍳 ตามพนักงาน</div>${bars(group('staff'), { color: 'alt' })}</div>
      <div class="card-box"><div class="section-title" style="margin-top:0">🗑️ ของเสีย / แจกฟรี <small>(จากประวัติสต็อกเครื่องนี้)</small></div>
        ${Object.keys(waste).length ? bars(Object.keys(waste).map((k) => ({ k, v: waste[k].v, s: ` (${fmtNum(waste[k].n)} หน่วย)` })), { color: 'warn' }) : '<div class="help">ไม่มีรายการ — บันทึกได้ที่ จัดการเมนู ▸ สต็อก ▸ ปรับ / ของเสีย</div>'}</div>
    </div>`;
}

function reportClick(e) {
  const b = e.target.closest('[data-rep]');
  if (!b) return;
  const k = b.dataset.rep;
  if (k === 'send') return sendStaffSummary();
  if (k === 'days') rep.days = Number(b.dataset.v);
  if (k === 'scope') rep.scope = b.dataset.v;
  if (k === 'staff') { rep.staff = b.dataset.v; return renderHistory(); }
  rep.error = '';
  renderHistory();
  loadReportRemote();
}
function reportChange() { /* report tab has no select inputs */ }


/* ==========================================================================
   12. ACTIVITY LOG  +  OWNER DASHBOARD PER ACCOUNT
   ========================================================================== */
rep.staff = 'all';
let actCache = null;
const actThrottle = {};
const ACT_LABEL = {
  LOGIN: '🔑 เข้าสู่ระบบ', LOGOUT: '🚪 ออกจากระบบ', SALE: '🧾 ขาย', VOID: '❌ ยกเลิกบิล', PARK: '⏸ พักบิล',
  SHIFT_OPEN: '🟢 เปิดกะ', SHIFT_CLOSE: '🔴 ปิดกะ', CASH_IN: '➕ เงินเข้า', CASH_OUT: '➖ เงินออก',
  STOCK: '📦 ปรับสต็อก', EDIT: '✏️ แก้ไขเมนู/ตั้งค่า', ACCESS: '🛠 เข้าหน้าจัดการ',
};

/** Every important action of every account → local IndexedDB + Activity_Log sheet (only when staff accounts are in use). */
function logActivity(type, detail, amount = 0, by = null, opt = {}) {
  if (!staffMode()) return;
  const s = state.session;
  const who = by || (s ? { id: s.staffId, name: s.name } : null);
  if (!who) return;
  if (opt.throttle) {
    const k = `${type}|${who.id}`;
    if (actThrottle[k] && Date.now() - actThrottle[k] < opt.throttle) return;
    actThrottle[k] = Date.now();
  }
  const now = new Date();
  const e = {
    id: `AL-${state.settings.devicePrefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    atISO: isoLocal(now), atTH: fmtDateTime(now), date: dateKey(now), hour: now.getHours(), device: state.settings.devicePrefix,
    staffId: who.id || '', staff: who.name || '', type, detail: String(detail || '').slice(0, 300), amount: round2(amount),
    shiftId: state.shift ? state.shift.id : '',
  };
  DataDB.put('activity', [e]).catch((err) => console.warn('activity save failed', err));
  if (actCache) actCache.unshift(e);
  enqueue('ACTIVITY_LOG', '', e, `${type} ${e.detail}`.slice(0, 60));
}

async function loadActivity() {
  if (actCache) return actCache;
  try { actCache = (await DataDB.all('activity')).sort((a, b) => (a.atISO < b.atISO ? 1 : -1)); } catch (e) { actCache = []; }
  return actCache;
}

const thToISO = (v) => {
  const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}` : String(v || '');
};

function normalizeActivity(r) {
  const atTH = String(r.Date_Time || r.atTH || '');
  return {
    id: String(r.Log_ID || r.id), atTH, atISO: thToISO(atTH) || String(r.atISO || ''), date: String(r.Date || r.date || ''),
    hour: toInt(r.Hour != null && r.Hour !== '' ? r.Hour : r.hour), device: String(r.Device || r.device || ''),
    staffId: String(r.Staff_ID || r.staffId || ''), staff: String(r.Staff || r.staff || ''), type: String(r.Type || r.type || ''),
    detail: String(r.Detail || r.detail || ''), amount: num(r.Amount != null ? r.Amount : r.amount), shiftId: String(r.Shift_ID || r.shiftId || ''),
  };
}

function staffStats(bills, acts, name) {
  const mine = bills.filter((b) => b.staff === name);
  const done = mine.filter((b) => b.status !== 'VOIDED');
  const myActs = acts.filter((a) => a.staff === name);
  const hours = {};
  for (const b of done) { const h = hours[b.hour] || (hours[b.hour] = { n: 0, v: 0 }); h.n++; h.v = fromSatang(toSatang(h.v) + toSatang(b.net)); }
  const hk = Object.keys(hours).map(Number);
  const times = myActs.map((a) => a.atISO).filter(Boolean).sort();
  return {
    name, bills: done.length, sales: sumMoney(done, (b) => b.net), discount: sumMoney(done, (b) => b.discount),
    voidBills: mine.length - done.length, voidsDone: myActs.filter((a) => a.type === 'VOID').length,
    avg: done.length ? round2(sumMoney(done, (b) => b.net) / done.length) : 0,
    first: times[0] || '', last: times[times.length - 1] || '', hours,
    peak: hk.length ? hk.reduce((a, b) => (hours[b].v > hours[a].v ? b : a)) : null,
  };
}

function staffDashHTML(data, from, to) {
  const remote = rep.scope === 'all' && rep.remote && rep.remoteKey === `${from}|${to}`;
  if (!actCache) loadActivity().then(() => { if (isOpen('m-history') && histTab === 'report') renderHistory(); });
  const acts = (remote ? rep.remote.acts : (actCache || [])).filter((a) => a.date >= from && a.date <= to);
  const names = [...new Set([...data.bills.map((b) => b.staff), ...acts.map((a) => a.staff)].filter((n) => n && n !== '-'))].sort();
  if (!names.length) {
    return `<div class="card-box staff-dash"><div class="section-title" style="margin-top:0">👥 รายบัญชีพนักงาน</div>
      <div class="help">ยังไม่มีข้อมูลรายบัญชี — เพิ่มพนักงานที่ ตั้งค่า ▸ พนักงาน & สิทธิ์ แล้วทุกการขาย/ยกเลิก/ปรับสต็อก/เปิด-ปิดกะ จะถูกบันทึกแยกตามบัญชี</div></div>`;
  }
  if (rep.staff !== 'all' && !names.includes(rep.staff)) rep.staff = 'all';
  const hh = (iso) => (iso ? iso.slice(11, 16) : '-');
  const chips = ['all', ...names].map((n) => `<button class="fchip ${rep.staff === n ? 'on' : ''}" data-rep="staff" data-v="${esc(n)}" type="button">${n === 'all' ? 'ทุกคน' : esc(n)}</button>`).join('');
  let body = '';
  if (rep.staff === 'all') {
    const rows = names.map((n) => staffStats(data.bills, acts, n)).sort((a, b) => b.sales - a.sales);
    body = `<div class="tbl-wrap"><table class="tbl" style="min-width:640px"><thead><tr><th>บัญชี</th><th class="num">บิล</th><th class="num">ยอดขาย</th><th class="num">เฉลี่ย/บิล</th><th class="num">ส่วนลด</th><th class="num">ยกเลิก (ที่กด)</th><th>ช่วงที่ใช้งาน</th><th>ขายดีช่วง</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><button class="btn-text" data-rep="staff" data-v="${esc(r.name)}" type="button"><b>${esc(r.name)}</b></button></td>
        <td class="num">${r.bills}</td><td class="num"><b>${money(r.sales)}</b></td><td class="num">${money(r.avg)}</td><td class="num">${money(r.discount)}</td>
        <td class="num">${r.voidsDone}</td><td>${hh(r.first)} – ${hh(r.last)}</td><td>${r.peak == null ? '-' : `${pad(r.peak)}:00`}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    const r = staffStats(data.bills, acts, rep.staff);
    const hk = Object.keys(r.hours).map(Number);
    const hMin = hk.length ? Math.min(...hk) : 0;
    const hourRows = hk.length ? Array.from({ length: Math.max(...hk) - hMin + 1 }, (_, i) => hMin + i).map((h) => ({ k: `${pad(h)}:00`, v: r.hours[h] ? r.hours[h].v : 0, s: r.hours[h] ? ` ${r.hours[h].n} บิล` : '' })) : [];
    const list = acts.filter((a) => a.staff === rep.staff).sort((a, b) => (a.atISO < b.atISO ? 1 : -1)).slice(0, 150);
    body = `
      <div class="stat-grid four">
        <div class="stat primary"><div class="k">ยอดขาย</div><div class="v">${money(r.sales)}</div><div class="s">${r.bills} บิล · เฉลี่ย ${money(r.avg)}</div></div>
        <div class="stat"><div class="k">ส่วนลดที่ให้</div><div class="v">${money(r.discount)}</div></div>
        <div class="stat"><div class="k">ยกเลิกบิล</div><div class="v">${r.voidsDone}</div><div class="s">บิลของบัญชีนี้ที่ถูกยกเลิก ${r.voidBills}</div></div>
        <div class="stat"><div class="k">ช่วงที่ใช้งาน</div><div class="v sm">${hh(r.first)} – ${hh(r.last)}</div><div class="s">${r.peak == null ? '' : `ขายดีสุด ${pad(r.peak)}:00`}</div></div>
      </div>
      <div class="report-grid">
        <div class="card-box"><div class="section-title" style="margin-top:0">⏰ ยอดขายรายชั่วโมง — ${esc(r.name)}</div>${hourRows.length ? bars(hourRows) : '<div class="help">ไม่มีข้อมูลการขาย</div>'}</div>
        <div class="card-box"><div class="section-title" style="margin-top:0">🕒 ทำอะไรบ้าง (ล่าสุด ${list.length} รายการ)</div>
          ${list.length ? `<div class="tbl-wrap" style="max-height:340px;overflow:auto"><table class="tbl" style="min-width:0"><thead><tr><th>เวลา</th><th>ทำอะไร</th><th>รายละเอียด</th><th class="num">บาท</th></tr></thead>
          <tbody>${list.map((a) => `<tr><td class="nowrap">${esc(a.date.slice(5))} ${esc(a.atISO.slice(11, 16))}</td><td class="nowrap">${esc(ACT_LABEL[a.type] || a.type)}</td><td>${esc(a.detail)}</td><td class="num">${a.amount ? money(a.amount) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="help">ไม่มีกิจกรรมในช่วงนี้</div>'}</div>
      </div>`;
  }
  return `<div class="card-box staff-dash"><div class="row" style="margin-bottom:8px">
      <div class="section-title grow" style="margin:0">👥 รายบัญชีพนักงาน</div>
      <button class="btn btn-outline btn-sm" data-rep="send" type="button">${svg('cloud', 16)} ส่งสรุปรายบัญชีขึ้น Google Sheets</button></div>
    <div class="chips" style="margin-bottom:10px">${chips}</div>${body}</div>`;
}

/** One row per day × account × device → sheet Staff_Summary (upserted by key — sending twice never duplicates). */
function sendStaffSummary() {
  const { from, to } = reportRange();
  const remote = rep.scope === 'all' && rep.remote && rep.remoteKey === `${from}|${to}`;
  const data = remote ? rep.remote : reportDataLocal(from, to);
  const groups = {};
  for (const b of data.bills) {
    if (!b.staff || b.staff === '-') continue;
    const k = `${b.date}|${b.staff}|${b.device || ''}`;
    (groups[k] || (groups[k] = [])).push(b);
  }
  const acts = (remote ? rep.remote.acts : (actCache || []));
  const rows = Object.keys(groups).map((k) => {
    const [date, staff, device] = k.split('|');
    const all = groups[k];
    const done = all.filter((b) => b.status !== 'VOIDED');
    const hours = {};
    for (const b of done) hours[b.hour] = fromSatang(toSatang(hours[b.hour] || 0) + toSatang(b.net));
    const hk = Object.keys(hours).map(Number);
    const mine = acts.filter((a) => a.date === date && a.staff === staff && (!device || a.device === device)).map((a) => a.atISO).filter(Boolean).sort();
    return {
      key: k, date, staff, device, bills: done.length, sales: sumMoney(done, (b) => b.net), voids: all.length - done.length,
      voidAmount: sumMoney(all.filter((b) => b.status === 'VOIDED'), (b) => b.net), discount: sumMoney(done, (b) => b.discount),
      avg: done.length ? round2(sumMoney(done, (b) => b.net) / done.length) : 0,
      first: mine[0] || '', last: mine[mine.length - 1] || '',
      peakHour: hk.length ? hk.reduce((a, b) => (hours[b] > hours[a] ? b : a)) : '', hourly: JSON.stringify(hours),
    };
  });
  if (!rows.length) return toast('ยังไม่มีข้อมูลรายบัญชีในช่วงนี้', 'warn');
  for (let i = 0; i < rows.length; i += 100) enqueue('STAFF_SUMMARY', '', { rows: rows.slice(i, i + 100) }, `สรุปรายบัญชี ${rows.length} แถว`);
  toast(`ส่งสรุปรายบัญชี ${rows.length} แถวเข้าคิวแล้ว — ดูที่ชีต Staff_Summary`, 'success', 3500);
  syncNow({ silent: true });
}

/* ==========================================================================
   13. TWO-WAY LIVE SYNC  (stock · shifts · cash moves · stock log · activity)  +  KITCHEN QUEUE COUNTER
   ========================================================================== */
const live = { busy: false, timer: null, kTimer: null, kBusy: false, ids: null, kitchen: { known: false, list: [], error: false } };

function startLiveSync() {
  clearInterval(live.timer);
  live.timer = setInterval(livePull, 20000);
  setTimeout(livePull, 4000);
  setInterval(renderKitchenChip, 30000);
  window.addEventListener('online', () => { livePull(); kitchenPoll(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { livePull(); kitchenPoll(); } });
  kitchenPoll();
}

async function ledgerIds() {
  if (live.ids) return live.ids;
  const ids = {};
  for (const st of ['shifts', 'stocklog', 'activity']) {
    try { ids[st] = new Set((await DataDB.all(st)).map((x) => x.id)); } catch (e) { ids[st] = new Set(); }
  }
  live.ids = ids;
  return ids;
}

/** Merge shifts / stock log / activity written by the other iPads. Keyed by id → never duplicates. */
async function applyPulledLedger(l) {
  if (!l) return false;
  const ids = await ledgerIds();
  const add = { shifts: [], stocklog: [], activity: [] };
  const movesByShift = {};
  for (const m of l.moves || []) {
    (movesByShift[m.Shift_ID] || (movesByShift[m.Shift_ID] = [])).push({
      id: String(m.Move_ID), atTH: String(m.Date_Time || ''), type: m.Type === 'PAY_IN' ? 'in' : 'out', amount: num(m.Amount), reason: String(m.Reason || ''), by: String(m.By || ''),
    });
  }
  for (const r of l.shifts || []) {
    const id = String(r.Shift_ID);
    if (String(r.Status) !== 'CLOSED' || ids.shifts.has(id) || (state.shift && state.shift.id === id)) continue;
    add.shifts.push({
      id, remote: true, device: String(r.Device || ''), openedAtTH: String(r.Opened_At || ''), openedBy: String(r.Opened_By || ''), float: num(r.Opening_Float),
      closedAtTH: String(r.Closed_At || ''), closedAtISO: thToISO(r.Closed_At), closedBy: String(r.Closed_By || ''),
      bills: num(r.Bills), voids: num(r.Voids), netSales: num(r.Net_Sales), cashSales: num(r.Cash_Sales), payIn: num(r.Pay_In), payOut: num(r.Pay_Out),
      expected: num(r.Expected_Cash), counted: num(r.Counted_Cash), diff: num(r.Difference), note: String(r.Note || ''), moves: movesByShift[id] || [], byMethod: {},
    });
  }
  for (const r of l.stocklog || []) {
    const id = String(r.Log_ID);
    if (ids.stocklog.has(id)) continue;
    add.stocklog.push({
      id, atTH: String(r.Date_Time || ''), atISO: thToISO(r.Date_Time), date: String(r.Date || ''), device: String(r.Device || ''), pool: String(r.Pool_ID || ''),
      poolName: String(r.Pool_Name || ''), unit: String(r.Unit || ''), delta: num(r.Change), before: num(r.Before), after: num(r.After), reason: String(r.Reason_ID || ''),
      reasonLabel: String(r.Reason || ''), note: String(r.Note || ''), staff: String(r.Staff || ''), costValue: num(r.Cost_Value),
    });
  }
  for (const r of l.activity || []) {
    const e = normalizeActivity(r);
    if (e.id && !ids.activity.has(e.id)) add.activity.push(e);
  }
  let changed = false;
  for (const st of Object.keys(add)) {
    if (!add[st].length) continue;
    await DataDB.put(st, add[st]);
    add[st].forEach((x) => ids[st].add(x.id));
    changed = true;
  }
  if (!changed) return false;
  if (add.shifts.length) shiftHistory = null;
  if (add.stocklog.length) stockLogCache = null;
  if (add.activity.length) actCache = null;
  if (isOpen('m-history')) renderHistory();
  if (isOpen('m-manage') && mgr.tab === 'log') renderManager();
  return true;
}

/** Every ~20 s: send what is queued, then take the cloud stock + other iPads' shifts / cash moves / stock log. */
async function livePull() {
  const url = (state.settings.gasUrl || '').trim();
  if (live.busy || !url || !navigator.onLine || document.visibilityState !== 'visible') return;
  if (state.syncing || state.cloudBusy || isOpen('m-pay') || isOpen('m-weight') || isOpen('m-set')) return;
  live.busy = true;
  try {
    if (state.queue.length) await syncNow({ silent: true });
    if (state.authExpired) return;
    const res = await postToSheet(url, { source: 'ipad-pos', device: state.settings.devicePrefix, actions: [{ qid: 'live', action: 'PULL_LIVE', data: {} }] }, { needResponse: true, timeout: 25000 });
    const r = res.results && res.results[0];
    if (!r || !r.ok) throw new Error((r && r.error) || 'PULL_LIVE failed');
    if (r.result.stock && typeof r.result.stock === 'object') {
      const before = JSON.stringify(state.stock);
      const next = mergeServerStock(r.result.stock);
      if (JSON.stringify(next) !== before) {
        state.stock = next;
        save.stock();
        renderMenu();
        renderCart();
        const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (isOpen('m-manage') && !typing) renderManager();
      }
    }
    await applyPulledLedger(r.result.ledger);
  } catch (e) {
    if (!(e && e.auth)) console.warn('[live]', e && e.message);
  } finally {
    live.busy = false;
  }
}

/* ---------- kitchen counter (POS header) ---------- */
async function kitchenPoll() {
  clearTimeout(live.kTimer);
  const next = () => { live.kTimer = setTimeout(kitchenPoll, Math.max(10, prefs().kds.pollSec * 2) * 1000); };
  const url = (state.settings.gasUrl || '').trim();
  if (!url || state.settings.deviceMode === 'kds') { renderKitchenChip(); return; }
  if (live.kBusy || document.visibilityState !== 'visible' || !navigator.onLine || state.authExpired) { renderKitchenChip(); return next(); }
  live.kBusy = true;
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await cloudFetch(`${url}${sep}action=PULL_KITCHEN_QUEUE&hours=1&_=${Date.now()}`, { method: 'GET' }, 12000);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'kitchen');
    live.kitchen = { known: true, error: false, list: (json.result.orders || []).filter((o) => o.status === 'PENDING').map((o) => {
      let k = o.items; if (typeof k === 'string') { try { k = JSON.parse(k); } catch (e) { k = {}; } }
      return { id: String(o.id), q: String(o.q || (k && k.q) || ''), t: String((k && k.t) || o.createdISO || ''), items: (k && k.items) || [], note: (k && k.note) || '' };
    }) };
  } catch (e) {
    live.kitchen.error = true;
  } finally {
    live.kBusy = false;
    renderKitchenChip();
    next();
  }
}

/** Queue = PENDING on the cloud + bills of this iPad that are not uploaded yet (the kitchen cannot see those). */
function kitchenQueue() {
  const list = live.kitchen.list.slice();
  const have = new Set(list.map((x) => x.id));
  for (const o of state.orders) {
    if (o.status === 'VOIDED' || o.kitchenStatus !== 'PENDING' || o.synced || have.has(o.id) || o.date !== todayKey()) continue;
    list.push({ id: o.id, q: o.queueNo, t: o.createdAtISO, items: (o.kitchen && o.kitchen.items) || [], note: o.note || '', local: true });
  }
  return list.sort((a, b) => (a.t < b.t ? -1 : 1));
}

function renderKitchenChip() {
  const b = $('#kitchenChip');
  if (!b) return;
  const show = !!(state.settings.gasUrl || '').trim() && state.settings.deviceMode !== 'kds';
  b.hidden = !show;
  if (!show) return;
  const list = kitchenQueue();
  const k = prefs().kds;
  const oldest = list.length ? Math.max(0, Math.floor((Date.now() - new Date(list[0].t).getTime()) / 60000)) : 0;
  const cls = live.kitchen.error && !live.kitchen.known ? 'bad' : !list.length ? '' : oldest >= k.lateMin ? 'late' : oldest >= k.warnMin ? 'warn' : 'busy';
  b.className = `hbtn kitchen-chip ${cls}`;
  b.innerHTML = `${svg('chef', 18)}<span class="kc-n">${live.kitchen.known || list.length ? list.length : '–'}</span><span class="lbl-long">${list.length ? `คิวหลังร้านรอทำ${oldest ? ` · นานสุด ${oldest} น.` : ''}` : (live.kitchen.error && !live.kitchen.known ? 'ดูคิวหลังร้านไม่ได้' : 'หลังร้านว่าง')}</span>`;
  b.title = live.kitchen.error ? 'เชื่อมต่อไม่ได้ — แสดงตัวเลขล่าสุด' : 'กดเพื่อดูคิวที่ค้างอยู่หลังร้าน';
}

function openKitchenList() {
  const m = ensureModal('m-kq', { size: 'lg', title: 'คิวหลังร้านที่ยังรอทำ' });
  const list = kitchenQueue();
  m.querySelector('.modal-body').innerHTML = list.length ? list.map((o) => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(o.t).getTime()) / 60000));
    return `<div class="mgr-row"><span class="qno">#${esc(o.q)}</span>
      <div class="grow">${(o.items || []).map((i) => `${esc(i.n)} ${esc(i.q)}`).join(' · ') || '-'}${o.note ? `<div class="cl-note-inline">📝 ${esc(o.note)}</div>` : ''}${o.local ? '<div class="help" style="margin:0">ยังไม่ได้ส่งขึ้น Cloud</div>' : ''}</div>
      <b class="nowrap">${mins} นาที</b></div>`;
  }).join('') : `<div class="empty-state">${svg('chef', 40)}<p>ไม่มีออเดอร์ค้างหลังร้าน</p></div>`;
  m.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-close type="button">ปิด</button>';
  openModal('m-kq');
}

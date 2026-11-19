/* ==========================================================================
   iPad POS — app.js  (v2: dynamic catalog + multi-device cloud sync)
   Offline-first point-of-sale: catalog, promo engine, stock pools, images,
   order sync queue and two-way state sync with Google Sheets.
   No build step: plain ES2018+ that runs on iPadOS Safari 14+.
   ========================================================================== */
'use strict';

const APP_VERSION = '3.0.0';

/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

/** Built-in units / payment methods — the shop can add more in the app (catalog.units / catalog.payMethods). */
const DEFAULT_UNITS = [{ id: 'pcs', label: 'ชิ้น' }, { id: 'g', label: 'กรัม' }, { id: 'scoop', label: 'สกู๊ป' }];
const DEFAULT_PAY_METHODS = [
  { id: 'cash', label: 'เงินสด', en: 'Cash', kind: 'cash', icon: 'cash', active: true },
  { id: 'qr', label: 'สแกน QR', en: 'PromptPay QR', kind: 'promptpay', icon: 'qr', active: true },
  { id: 'tcp', label: 'ไทยช่วยไทยพลัส', en: 'Thai Chuay Thai Plus', kind: 'other', icon: 'gov', active: true },
];
const PAY_KINDS = { cash: 'เงินสด (มีเงินทอน · นับเข้าลิ้นชัก)', promptpay: 'พร้อมเพย์ (แสดง QR ตามยอด)', other: 'อื่น ๆ (บัตร / แอปเดลิเวอรี / โครงการรัฐ)' };
const PAY_ICONS = ['cash', 'qr', 'gov', 'card', 'phone', 'bike', 'tag'];
const DEFAULT_QUICK_NOTES = ['แยกถุง', 'ใส่กล่อง', 'อุ่นร้อน', 'ไม่รับช้อน', 'กินที่ร้าน', 'กลับบ้าน'];
const DEFAULT_STOCK_REASONS = [
  { id: 'restock', label: 'เติมสต็อก / อบใหม่', sign: 1 },
  { id: 'waste', label: 'ของเสีย / หมดอายุ', sign: -1 },
  { id: 'free', label: 'แจกฟรี / ให้ชิม', sign: -1 },
  { id: 'staff', label: 'พนักงานใช้ / ทาน', sign: -1 },
  { id: 'count', label: 'นับสต็อกปรับยอด', sign: 0 },
];
const PERMS = {
  void: 'ยกเลิกบิล (VOID)',
  discount: 'ให้ส่วนลดเพิ่มเติม (Manual)',
  manage: 'แก้เมนู / ราคา / โปร',
  stock: 'ปรับสต็อก',
  settings: 'ตั้งค่า & Cloud Sync',
  cashMove: 'เงินเข้า-ออกลิ้นชัก',
  reports: 'ดูรายงาน / กำไร',
};
const defaultPrefs = () => ({
  lowDefaults: { unit: 5, weight: 200, set: 3 },
  promptpayId: '',
  promptpayName: '',
  receipt: { address: '', taxId: '', phone: '', footer: 'ขอบคุณที่อุดหนุนค่ะ 🍪', width: '58', showDone: true },
  loyalty: { enabled: false, spendPerPoint: 100, pointValue: 1, minRedeem: 10 },
  perms: { void: 'owner', discount: 'owner', manage: 'owner', stock: 'owner', settings: 'owner', cashMove: 'staff', reports: 'owner' },
  requireShift: false,
  kds: { warnMin: 5, lateMin: 10, pollSec: 6 },
});
const unitLabel = (u) => {
  const x = state.catalog.units.find((v) => v.id === u);
  return x ? x.label : u;
};
const payMethods = (activeOnly) => state.catalog.payMethods.filter((m) => !activeOnly || m.active);
const payMethod = (id) => state.catalog.payMethods.find((m) => m.id === id) || null;
const isCashMethod = (id) => { const m = payMethod(id); return m ? m.kind === 'cash' : id === 'cash'; };
const MODES = {
  unit: { label: 'ขายเป็นชิ้น', en: 'Per Piece' },
  weight: { label: 'ขายตามน้ำหนัก (กรัม)', en: 'By Weight' },
  set: { label: 'เซ็ต + ตัวเลือก / Add-on', en: 'Set with Modifiers' },
};
const AVAIL = {
  normal: 'เปิดขายตามสต็อก',
  soldout: 'ปิดขายชั่วคราววันนี้',
  hidden: 'ซ่อนจากหน้าขาย',
};

/** Menu photos: small enough to fit one Google Sheets cell (< 50,000 chars). */
const IMG_SIZE = 250;
const IMG_QUALITY = 0.72;
const IMG_MAX_CHARS = 34000; // ≈ 25 KB JPEG

/* ==========================================================================
   2. SEED CATALOG (the original bakery menu — used on first run / migration)
   ========================================================================== */

function buildSeedCatalog() {
  const soft = [
    ['sc_classic', 'รสคลาสสิก'], ['sc_nutella', 'นูเทลล่า'], ['sc_redvelvet', 'เรดเวลเวท'], ['sc_smore', 'สมอร์'],
    ['sc_triplechoc', 'ทริปเปิ้ลช้อก'], ['sc_biscoff', 'บิสคอฟ'], ['sc_strawberry', 'สตอเบอรี่'], ['sc_birthday', 'เบิร์ดเดย์'],
  ];
  const cereal = [['cc_chocchip', 'ช็อกโกแลตชิพ'], ['cc_matcha', 'มัทฉะ'], ['cc_redvelvet', 'เรดเวลเวท'], ['cc_cocoa', 'โกโก้']];
  const item = (o) => normalizeItem(o);
  return {
    schema: 1,
    updatedAt: '',
    categories: [
      { id: 'soft', name: 'ซอฟต์คุกกี้', hidden: false, kitchen: true },
      { id: 'cereal', name: 'ซีเรียลคุกกี้', hidden: false, kitchen: true },
      { id: 'gooey', name: 'Gooey & ไอศกรีม', hidden: false, kitchen: true },
      { id: 'puff', name: 'ครีมพัฟ & ชูครีม', hidden: false, kitchen: true },
    ],
    pools: [
      ...soft.map(([id, n]) => ({ id, name: `ซอฟต์คุกกี้ ${n}`, unit: 'pcs' })),
      ...cereal.map(([id, n]) => ({ id, name: `ซีเรียลคุกกี้ ${n}`, unit: 'g' })),
      { id: 'gooey_cookie', name: 'คุกกี้ Gooey Chocolate', unit: 'pcs' },
      { id: 'ice_hokkaido', name: 'ไอศกรีม ฮอกไกโด (Hokkaido)', unit: 'scoop' },
      { id: 'ice_vanilla', name: 'ไอศกรีม วนิลา (Vanilla)', unit: 'scoop' },
      { id: 'puff_osaka', name: 'Osaka Cream Puff', unit: 'pcs' },
      { id: 'choux_cream', name: 'ชูครีม (Choux Cream)', unit: 'pcs' },
    ],
    items: [
      ...soft.map(([id, n]) => item({ id, name: `ซอฟต์คุกกี้ ${n}`, categoryId: 'soft', mode: 'unit', price: 39, stockPool: id })),
      ...cereal.map(([id, n]) => item({ id, name: `ซีเรียลคุกกี้ ${n}`, categoryId: 'cereal', mode: 'weight', pricePerGram: 1, minGrams: 20, stockPool: id })),
      item({
        id: 'gooey_set', name: 'Gooey Chocolate + Ice Cream', categoryId: 'gooey', mode: 'set', price: 59,
        baseConsumes: [{ pool: 'gooey_cookie', qty: 1 }],
        optionGroups: [
          { id: 'g_main', name: 'เลือกไอศกรีมในเซ็ต (1 สกู๊ป)', type: 'pick1', options: [
            { id: 'hokkaido', name: 'ฮอกไกโด', price: 0, pool: 'ice_hokkaido', qty: 1 },
            { id: 'vanilla', name: 'วนิลา', price: 0, pool: 'ice_vanilla', qty: 1 },
          ] },
          { id: 'g_addice', name: 'Add-on เพิ่มไอศกรีม (คละรสได้)', type: 'stepper', options: [
            { id: 'hokkaido', name: 'ไอศกรีมฮอกไกโด', price: 20, pool: 'ice_hokkaido', qty: 1 },
            { id: 'vanilla', name: 'ไอศกรีมวนิลา', price: 20, pool: 'ice_vanilla', qty: 1 },
          ] },
          { id: 'g_addcookie', name: 'Add-on เพิ่มคุกกี้ Gooey Chocolate', type: 'stepper', options: [
            { id: 'cookie', name: 'คุกกี้ Gooey', price: 39, pool: 'gooey_cookie', qty: 1 },
          ] },
        ],
      }),
      item({ id: 'puff_osaka', name: 'Osaka Cream Puff', categoryId: 'puff', mode: 'unit', price: 29, stockPool: 'puff_osaka' }),
      item({ id: 'choux_cream', name: 'ชูครีม (Choux Cream)', categoryId: 'puff', mode: 'unit', price: 12, stockPool: 'choux_cream' }),
    ],
    promos: [
      { id: 'p_soft', name: 'โปรซอฟต์คุกกี้ 3 ชิ้น 100', type: 'bundle', slots: [{ qty: 3, match: { cats: ['soft'] } }], reward: { kind: 'price', value: 100 } },
      { id: 'p_puff', name: 'โปรครีมพัฟ 4 ชิ้น 99', type: 'bundle', slots: [{ qty: 4, match: { items: ['puff_osaka'] } }], reward: { kind: 'price', value: 99 } },
      { id: 'p_choux', name: 'โปรชูครีม 5 ชิ้น 50', type: 'bundle', slots: [{ qty: 5, match: { items: ['choux_cream'] } }], reward: { kind: 'price', value: 50 } },
    ],
  };
}

/* ==========================================================================
   3. ICONS (inline SVG — no network needed)
   ========================================================================== */

const ICONS = {
  cookie: '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5h.01M16 15.5h.01M12 12h.01M11 17h.01M7 14h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-3 2-3-2-3 2-3-2-3 2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  cloud: '<path d="M16 16l-4-4-4 4M12 12v9"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><path d="M7 7h.01"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  gov: '<path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-7 10 7Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/>',
  chef: '<path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 9.18 0A4 4 0 0 1 18 13.87V21H6Z"/><path d="M6 17h12"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 11.5M5.5 17.5 9 10h6l-3 7.5M9 10 8 6H6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
};
function svg(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ==========================================================================
   4. UTILITIES
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad = (n, len = 2) => String(n).padStart(len, '0');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? round2(n) : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (o) => JSON.parse(JSON.stringify(o));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  const v = round2(n);
  return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
const money = (n) => `฿${fmtNum(n)}`;
const negMoney = (n) => (n > 0 ? `-฿${fmtNum(n)}` : '฿0');

function fmtDateTime(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const todayKey = () => dateKey(new Date());
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}
function fmtDateKeyTH(key) {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
const sanitizePrefix = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

/* ==========================================================================
   5. CATALOG MODEL
   ========================================================================== */

function normalizeItem(x) {
  return {
    id: String(x.id),
    name: String(x.name || 'เมนูใหม่'),
    categoryId: String(x.categoryId || ''),
    mode: ['unit', 'weight', 'set'].includes(x.mode) ? x.mode : 'unit',
    price: Math.max(0, num(x.price)),
    pricePerGram: Math.max(0, num(x.pricePerGram == null ? 1 : x.pricePerGram)),
    minGrams: Math.max(1, toInt(x.minGrams == null ? 20 : x.minGrams)),
    stockPool: String(x.stockPool || ''),
    tag: String(x.tag || ''),
    /** extra cost per sale (box, bag, sticker…) on top of the stock pools' cost */
    cost: Math.max(0, num(x.cost)),
    /** low-stock alert point ('' = shop default for this sale mode) */
    lowAt: x.lowAt === '' || x.lowAt == null ? '' : toInt(x.lowAt),
    availability: ['normal', 'soldout', 'hidden'].includes(x.availability) ? x.availability : 'normal',
    soldOutDate: String(x.soldOutDate || ''),
    baseConsumes: (x.baseConsumes || []).filter((b) => b && b.pool).map((b) => ({ pool: String(b.pool), qty: Math.max(1, toInt(b.qty) || 1) })),
    optionGroups: (x.optionGroups || []).filter((g) => g && g.id).map((g) => ({
      id: String(g.id),
      name: String(g.name || 'ตัวเลือก'),
      type: g.type === 'stepper' ? 'stepper' : 'pick1',
      options: (g.options || []).filter((o) => o && o.id).map((o) => ({
        id: String(o.id),
        name: String(o.name || 'ตัวเลือก'),
        price: Math.max(0, num(o.price)),
        pool: String(o.pool || ''),
        qty: Math.max(1, toInt(o.qty) || 1),
      })),
    })),
  };
}

const normId = (s, fallback) => String(s || '').trim().replace(/[^\w-]/g, '_').slice(0, 40) || fallback;

function normalizePrefs(x) {
  const d = defaultPrefs();
  x = x && typeof x === 'object' ? x : {};
  const merge = (def, v) => Object.assign({}, def, v && typeof v === 'object' ? v : {});
  const p = Object.assign(d, x, {
    lowDefaults: merge(d.lowDefaults, x.lowDefaults),
    receipt: merge(d.receipt, x.receipt),
    loyalty: merge(d.loyalty, x.loyalty),
    perms: merge(d.perms, x.perms),
    kds: merge(d.kds, x.kds),
  });
  for (const k of Object.keys(PERMS)) if (!['owner', 'staff'].includes(p.perms[k])) p.perms[k] = 'owner';
  p.lowDefaults = { unit: toInt(p.lowDefaults.unit), weight: toInt(p.lowDefaults.weight), set: toInt(p.lowDefaults.set) };
  p.loyalty.spendPerPoint = Math.max(1, num(p.loyalty.spendPerPoint) || 100);
  p.loyalty.pointValue = Math.max(0, num(p.loyalty.pointValue));
  p.loyalty.minRedeem = toInt(p.loyalty.minRedeem);
  p.loyalty.enabled = !!p.loyalty.enabled;
  p.kds = { warnMin: Math.max(1, toInt(p.kds.warnMin) || 5), lateMin: Math.max(2, toInt(p.kds.lateMin) || 10), pollSec: Math.min(60, Math.max(3, toInt(p.kds.pollSec) || 6)) };
  p.receipt.width = String(p.receipt.width) === '80' ? '80' : '58';
  p.receipt.showDone = p.receipt.showDone !== false;
  p.promptpayId = String(p.promptpayId || '').replace(/[^\d]/g, '');
  p.promptpayName = String(p.promptpayName || '');
  p.requireShift = !!p.requireShift;
  return p;
}

function normalizeCatalog(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.items)) return normalizeCatalog(buildSeedCatalog());
  const units = (Array.isArray(c.units) && c.units.length ? c.units : DEFAULT_UNITS).filter((u) => u && u.id)
    .map((u) => ({ id: normId(u.id, 'u'), label: String(u.label || u.id) }));
  for (const u of DEFAULT_UNITS) if (!units.some((x) => x.id === u.id)) units.unshift(Object.assign({}, u));
  const unitIds = new Set(units.map((u) => u.id));
  const pays = (Array.isArray(c.payMethods) && c.payMethods.length ? c.payMethods : DEFAULT_PAY_METHODS).filter((m) => m && m.id)
    .map((m) => ({
      id: normId(m.id, 'pay'), label: String(m.label || m.id), en: String(m.en || ''),
      kind: PAY_KINDS[m.kind] ? m.kind : 'other', icon: PAY_ICONS.includes(m.icon) ? m.icon : 'tag', active: m.active !== false,
    }));
  if (!pays.some((m) => m.id === 'cash')) pays.unshift(Object.assign({}, DEFAULT_PAY_METHODS[0]));
  const out = {
    schema: 3,
    updatedAt: String(c.updatedAt || ''),
    categories: (c.categories || []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || 'หมวดหมู่'), hidden: !!x.hidden, kitchen: x.kitchen !== false,
    })),
    pools: (c.pools || []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || x.id), unit: unitIds.has(x.unit) ? x.unit : 'pcs', cost: Math.max(0, num(x.cost)),
    })),
    promos: normalizePromos(c),
    items: c.items.filter((x) => x && x.id).map(normalizeItem),
    units,
    payMethods: pays,
    quickNotes: (Array.isArray(c.quickNotes) ? c.quickNotes : DEFAULT_QUICK_NOTES).map((n) => String(n).trim()).filter(Boolean).slice(0, 30),
    stockReasons: (Array.isArray(c.stockReasons) && c.stockReasons.length ? c.stockReasons : DEFAULT_STOCK_REASONS).filter((r) => r && r.id)
      .map((r) => ({ id: normId(r.id, 'r'), label: String(r.label || r.id), sign: [1, -1, 0].includes(Number(r.sign)) ? Number(r.sign) : 0 })),
    staff: (Array.isArray(c.staff) ? c.staff : []).filter((x) => x && x.id && x.pinHash)
      .map((x) => ({ id: String(x.id), name: String(x.name || 'พนักงาน'), role: x.role === 'owner' ? 'owner' : 'staff', pinHash: String(x.pinHash) })),
    prefs: normalizePrefs(c.prefs),
  };
  if (!out.categories.length) out.categories.push({ id: 'general', name: 'ทั่วไป', hidden: false, kitchen: true });
  const catIds = new Set(out.categories.map((x) => x.id));
  for (const it of out.items) if (!catIds.has(it.categoryId)) it.categoryId = out.categories[0].id;
  return out;
}

/** Fast lookup maps — rebuilt after every catalog change. */
let IDX = { cat: {}, item: {}, pool: {}, promo: {} };
function reindex() {
  const c = state.catalog;
  const map = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  IDX = { cat: map(c.categories), item: map(c.items), pool: map(c.pools), promo: map(c.promos) };
}
const poolName = (id) => (IDX.pool[id] ? IDX.pool[id].name : id);
const poolUnit = (id) => (IDX.pool[id] ? unitLabel(IDX.pool[id].unit) : '');
const prefs = () => state.catalog.prefs;

function itemAvailability(it) {
  const cat = IDX.cat[it.categoryId];
  if (it.availability === 'hidden' || (cat && cat.hidden)) return 'hidden';
  if (it.availability === 'soldout' && it.soldOutDate === todayKey()) return 'soldout';
  return 'normal';
}
function visibleCategories() {
  return state.catalog.categories.filter((c) => !c.hidden);
}
/** Which items reference a stock pool (for the stock manager & delete guard) */
function poolRefs(poolId) {
  return state.catalog.items.filter((it) =>
    it.stockPool === poolId ||
    it.baseConsumes.some((b) => b.pool === poolId) ||
    it.optionGroups.some((g) => g.options.some((o) => o.pool === poolId)));
}

/* ==========================================================================
   6. PERSISTENCE
   ========================================================================== */

const LS = {
  catalog: 'pos.v1.catalog',
  stock: 'pos.v1.stock',
  orders: 'pos.v1.orders', // legacy — orders now live in IndexedDB (OrderStore); kept only for migration / fallback
  queue: 'pos.v1.queue',
  settings: 'pos.v1.settings',
  cart: 'pos.v1.cart',
  syncMeta: 'pos.v1.syncMeta',
  remote: 'pos.v1.remoteOrders',
  parked: 'pos.v1.parked',
  customers: 'pos.v1.customers',
  shift: 'pos.v1.shift',
  session: 'pos.v1.session',
};

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('lsGet failed', key, e);
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('lsSet failed', key, e);
    toast('พื้นที่จัดเก็บเต็ม! กรุณา Export Backup แล้วล้างบิลเก่าในหน้าตั้งค่า', 'error', 7000);
    return false;
  }
}

/** Cloudflare hosting: index.html carries <meta name="pos-sync-url" content="/api/sync"> → sync goes through the protected proxy. */
const SYNC_URL_META = ((document.querySelector('meta[name="pos-sync-url"]') || {}).content || '').trim();
/** A device that still points straight at Apps Script (old GitHub setup / imported backup) is moved to the proxy. */
function fixSyncUrl(settings) {
  if (SYNC_URL_META && (!settings.gasUrl || /script\.google(usercontent)?\.com/.test(settings.gasUrl))) settings.gasUrl = SYNC_URL_META;
  return settings;
}

const defaultSettings = () => ({
  gasUrl: SYNC_URL_META,
  shopName: 'Maysa.Meekanom',
  shopSubtitle: 'HOMEMADE BAKERY & COOKIES',
  devicePrefix: 'IPAD1',
  deviceMode: 'pos', // 'pos' = sell at the counter · 'kds' = kitchen / order-queue screen
  queuePrefix: '',
  autoPush: true,
  autoPull: false,
  lastSyncAt: '',
  lastSyncError: '',
});
const defaultSyncMeta = () => ({
  catalogDirty: 0, settingsDirty: 0, stockDirty: {}, imagesDirty: {},
  lastPushAt: '', lastPullAt: '', lastStateError: '',
});
const emptyCart = () => ({ lines: [], manualDiscount: '', note: '', promoOff: [], promoMode: 'priority', customer: null, discountBy: '' });

function sanitizeStock(obj, catalog) {
  const s = {};
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) s[k] = toInt(obj[k]);
  for (const p of catalog.pools) if (!(p.id in s)) s[p.id] = 0;
  return s;
}

/* ---------- load + migrate ---------- */
const state = (() => {
  const rawCatalog = lsGet(LS.catalog, null);
  const catalog = normalizeCatalog(rawCatalog);
  const settings = Object.assign(defaultSettings(), lsGet(LS.settings, {}));
  if (settings.shopName === 'Cookie POS') settings.shopName = 'Maysa.Meekanom';
  if (!settings.devicePrefix || !/^[A-Z0-9]{1,10}$/.test(settings.devicePrefix)) {
    settings.devicePrefix = sanitizePrefix(settings.deviceName) || 'IPAD1';
  }
  if (!['pos', 'kds'].includes(settings.deviceMode)) settings.deviceMode = 'pos';
  fixSyncUrl(settings);
  const cart = Object.assign(emptyCart(), lsGet(LS.cart, {}));
  const orders = lsGet(LS.orders, []);
  const queue = lsGet(LS.queue, []);
  return {
    catalog,
    migrated: !rawCatalog || rawCatalog.schema !== 3,
    stock: sanitizeStock(lsGet(LS.stock, null), catalog),
    orders: Array.isArray(orders) ? orders : [],
    queue: Array.isArray(queue) ? queue : [],
    settings,
    syncMeta: Object.assign(defaultSyncMeta(), lsGet(LS.syncMeta, {})),
    remoteOrders: lsGet(LS.remote, {}) || {},
    cart: Object.assign(cart, { lines: Array.isArray(cart.lines) ? cart.lines : [], promoOff: Array.isArray(cart.promoOff) ? cart.promoOff : [] }),
    parked: lsGet(LS.parked, []) || [],
    customers: lsGet(LS.customers, {}) || {},
    shift: lsGet(LS.shift, null),
    session: lsGet(LS.session, null), // { staffId, name, role, at }
    images: {},
    category: 'all',
    syncing: false,
    cloudBusy: false,
  };
})();
reindex();

const save = {
  catalog: () => lsSet(LS.catalog, state.catalog),
  stock: () => lsSet(LS.stock, state.stock),
  /** Persist orders to IndexedDB. Pass the changed orders (or nothing = all). Resolves to true/false. */
  orders: (list) => OrderStore.put(list || state.orders),
  queue: () => lsSet(LS.queue, state.queue),
  settings: () => lsSet(LS.settings, state.settings),
  cart: () => lsSet(LS.cart, state.cart),
  syncMeta: () => lsSet(LS.syncMeta, state.syncMeta),
  remote: () => lsSet(LS.remote, state.remoteOrders),
  parked: () => lsSet(LS.parked, state.parked),
  customers: () => lsSet(LS.customers, state.customers),
  shift: () => lsSet(LS.shift, state.shift),
  session: () => lsSet(LS.session, state.session),
};

/* ---------- IndexedDB data store: orders, stock log, closed shifts (hundreds of MB vs ~5 MB localStorage) ---------- */
const DataDB = (() => {
  const DB_NAME = 'pos-data';
  const STORES = ['orders', 'stocklog', 'shifts'];
  let dbPromise = null;
  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB not supported'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((e) => { dbPromise = null; throw e; });
    }
    return dbPromise;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  async function all(store) {
    const out = [];
    await tx(store, 'readonly', (s) => {
      const req = s.openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.value); c.continue(); } };
    });
    return out;
  }
  const put = (store, rows) => tx(store, 'readwrite', (s) => { for (const r of rows) s.put(JSON.parse(JSON.stringify(r))); });
  const remove = (store, ids) => tx(store, 'readwrite', (s) => { for (const id of ids) s.delete(id); });
  const clear = (store) => tx(store, 'readwrite', (s) => s.clear());
  return { open, all, put, remove, clear };
})();

/** Orders: IndexedDB with automatic fallback to localStorage when IDB is unavailable. */
const OrderStore = (() => {
  let useLS = false;
  async function load() {
    try {
      const rows = await DataDB.all('orders');
      const legacy = lsGet(LS.orders, null);
      if (Array.isArray(legacy) && legacy.length) {
        const have = new Set(rows.map((o) => o.id));
        const add = legacy.filter((o) => o && o.id && !have.has(o.id));
        if (add.length) await DataDB.put('orders', add);
        rows.push(...add);
        localStorage.removeItem(LS.orders); // migrated → frees ~all of the 5 MB quota
      }
      return rows.sort((a, b) => ((a.createdAtISO || '') < (b.createdAtISO || '') ? -1 : 1));
    } catch (e) {
      console.warn('OrderStore: IndexedDB unavailable, using localStorage', e);
      useLS = true;
      return lsGet(LS.orders, []) || [];
    }
  }
  async function put(list) {
    if (useLS) return lsSet(LS.orders, state.orders);
    try {
      await DataDB.put('orders', list);
      return true;
    } catch (e) {
      console.error('OrderStore put failed', e);
      toast('บันทึกบิลลงเครื่องไม่สำเร็จ — กรุณา Export Backup', 'error', 6000);
      return false;
    }
  }
  async function remove(ids) {
    if (useLS) return lsSet(LS.orders, state.orders);
    try { await DataDB.remove('orders', ids); return true; } catch (e) { console.warn(e); return false; }
  }
  async function replaceAll(list) {
    if (useLS) return lsSet(LS.orders, list);
    try { await DataDB.clear('orders'); await DataDB.put('orders', list); return true; } catch (e) { console.warn(e); return false; }
  }
  return { load, put, remove, replaceAll, get usingLS() { return useLS; } };
})();

/** Generic modal shell created on demand (keeps index.html small). size: sm | lg | xl · z: mid | top */
function ensureModal(id, { size = 'lg', title = '', z = '' } = {}) {
  let m = document.getElementById(id);
  if (m) return m;
  m = document.createElement('div');
  m.className = `modal${z === 'mid' ? ' modal-mid' : z === 'top' ? ' modal-top' : z === 'lock' ? ' modal-lock' : ''}`;
  m.id = id;
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.innerHTML = `
    <div class="modal-card modal-${size}">
      <div class="modal-head"><h2 class="modal-title">${esc(title)}</h2><button class="modal-x" data-close type="button" aria-label="ปิด">&times;</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  document.body.appendChild(m);
  return m;
}

/** v1 cart lines (cereal / gooey) → v2 (weight / set). Drops lines whose item no longer exists. */
function sanitizeCart() {
  state.cart.lines = state.cart.lines.map((l) => {
    if (!l) return null;
    if (l.type === 'cereal') return { id: l.id, type: 'weight', menuId: l.menuId, soldG: toInt(l.soldG), freeG: toInt(l.freeG), disc: toInt(l.disc) };
    if (l.type === 'gooey') {
      return {
        id: l.id, type: 'set', menuId: 'gooey_set', qty: Math.max(1, toInt(l.qty)),
        picks: { g_main: l.main },
        adds: { g_addice: { hokkaido: toInt(l.addH), vanilla: toInt(l.addV) }, g_addcookie: { cookie: toInt(l.addC) } },
      };
    }
    return l;
  }).filter((l) => {
    if (!l) return false;
    const it = IDX.item[l.menuId];
    if (!it || it.mode !== l.type) return false;
    if (l.type === 'set') {
      l.picks = l.picks || {};
      l.adds = l.adds || {};
      for (const g of it.optionGroups) {
        if (g.type === 'pick1' && g.options.length && !g.options.some((o) => o.id === l.picks[g.id])) return false;
        if (g.type === 'stepper') {
          const a = l.adds[g.id] || {};
          for (const k of Object.keys(a)) if (!g.options.some((o) => o.id === k)) delete a[k];
        }
      }
    }
    return true;
  });
}
sanitizeCart();

/* ---------- IndexedDB image store (falls back to localStorage) ---------- */
const ImageStore = (() => {
  const DB_NAME = 'pos-images';
  const STORE = 'images';
  const LS_PREFIX = 'pos.v1.img.';
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB not supported'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((e) => { dbPromise = null; throw e; });
    }
    return dbPromise;
  }
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function getAll() {
    const out = {};
    try {
      await run('readonly', (store) => {
        const req = store.openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (c) { out[c.key] = c.value; c.continue(); }
        };
      });
    } catch (e) {
      console.warn('IDB getAll failed, using localStorage', e);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && !out[k.slice(LS_PREFIX.length)]) out[k.slice(LS_PREFIX.length)] = localStorage.getItem(k);
    }
    return out;
  }
  async function put(id, dataUrl) {
    try {
      await run('readwrite', (store) => store.put(dataUrl, id));
      localStorage.removeItem(LS_PREFIX + id);
    } catch (e) {
      console.warn('IDB put failed, using localStorage', e);
      localStorage.setItem(LS_PREFIX + id, dataUrl);
    }
  }
  async function remove(id) {
    try { await run('readwrite', (store) => store.delete(id)); } catch (e) { console.warn(e); }
    localStorage.removeItem(LS_PREFIX + id);
  }
  async function clear() {
    try { await run('readwrite', (store) => store.clear()); } catch (e) { console.warn(e); }
    Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX)).forEach((k) => localStorage.removeItem(k));
  }
  return { getAll, put, remove, clear };
})();

/**
 * Resize + center-crop to a square JPEG data URL (250×250, q 0.72).
 * Accepts a File/Blob or an existing data URL. Shrinks further until < IMG_MAX_CHARS
 * so every image fits in a single Google Sheets cell.
 */
function compressImage(source, size = IMG_SIZE, quality = IMG_QUALITY) {
  return new Promise((resolve, reject) => {
    const isString = typeof source === 'string';
    const url = isString ? source : URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(w, h);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const draw = (px) => {
          canvas.width = canvas.height = px;
          ctx.fillStyle = '#fffdf9';
          ctx.fillRect(0, 0, px, px);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, px, px);
        };
        let px = size;
        draw(px);
        let q = quality;
        let data = canvas.toDataURL('image/jpeg', q);
        while (data.length > IMG_MAX_CHARS && q > 0.5) { q -= 0.07; data = canvas.toDataURL('image/jpeg', q); }
        while (data.length > IMG_MAX_CHARS && px > 120) { px -= 30; draw(px); data = canvas.toDataURL('image/jpeg', 0.6); }
        resolve(data);
      } catch (e) {
        reject(e);
      } finally {
        if (!isString) URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { if (!isString) URL.revokeObjectURL(url); reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้')); };
    img.src = url;
  });
}

/** v1 images were up to ~70k chars — shrink them once so they fit a Sheets cell. */
async function shrinkLegacyImages() {
  for (const [id, data] of Object.entries(state.images)) {
    if (typeof data === 'string' && data.length > IMG_MAX_CHARS + 2000) {
      try {
        const small = await compressImage(data);
        await ImageStore.put(id, small);
        state.images[id] = small;
      } catch (e) { console.warn('shrink failed', id, e); }
    }
  }
}

/* ==========================================================================
   7. CART ENGINE (stock needs, pricing, promotions)
   ========================================================================== */

const findOpt = (g, oid) => g.options.find((o) => o.id === oid);

/** Stock consumed by one cart line: { poolId: amount } (untracked items consume nothing) */
function lineNeeds(line) {
  const n = {};
  const add = (k, v) => { if (k && v > 0) n[k] = (n[k] || 0) + v; };
  const it = IDX.item[line.menuId];
  if (!it) return n;
  if (line.type === 'unit') add(it.stockPool, line.qty);
  else if (line.type === 'weight') add(it.stockPool, line.soldG + line.freeG);
  else if (line.type === 'set') {
    const q = line.qty;
    for (const b of it.baseConsumes) add(b.pool, q * b.qty);
    for (const g of it.optionGroups) {
      if (g.type === 'pick1') {
        const o = findOpt(g, (line.picks || {})[g.id]);
        if (o) add(o.pool, q * o.qty);
      } else {
        const a = (line.adds || {})[g.id] || {};
        for (const o of g.options) add(o.pool, q * (a[o.id] || 0) * o.qty);
      }
    }
  }
  return n;
}
function mergeNeeds(target, src) {
  for (const k in src) target[k] = (target[k] || 0) + src[k];
  return target;
}
function cartNeeds(excludeLineId) {
  const t = {};
  for (const l of state.cart.lines) if (l.id !== excludeLineId) mergeNeeds(t, lineNeeds(l));
  return t;
}
function availableOf(pool, reserved) {
  if (!pool) return Infinity;
  return (state.stock[pool] || 0) - ((reserved || cartNeeds())[pool] || 0);
}
function findShortages(needs, excludeLineId) {
  const reserved = cartNeeds(excludeLineId);
  const out = [];
  for (const k in needs) {
    const have = (state.stock[k] || 0) - (reserved[k] || 0);
    if (needs[k] > have) out.push({ key: k, need: needs[k], have: Math.max(0, have) });
  }
  return out;
}
function cartShortages() {
  const t = cartNeeds();
  const out = [];
  for (const k in t) if (t[k] > (state.stock[k] || 0)) out.push({ key: k, need: t[k], have: state.stock[k] || 0 });
  return out;
}
function shortageText(list) {
  return list.map((s) => `${poolName(s.key)} (ต้องการ ${fmtNum(s.need)} มี ${fmtNum(s.have)} ${poolUnit(s.key)})`).join(', ');
}

function setUnitPrice(it, line) {
  let p = it.price;
  for (const g of it.optionGroups) {
    if (g.type === 'pick1') {
      const o = findOpt(g, (line.picks || {})[g.id]);
      if (o) p += o.price;
    } else {
      const a = (line.adds || {})[g.id] || {};
      for (const o of g.options) p += (a[o.id] || 0) * o.price;
    }
  }
  return round2(p);
}
function lineGross(line) {
  const it = IDX.item[line.menuId];
  if (!it) return 0;
  if (line.type === 'unit') return round2(it.price * line.qty);
  if (line.type === 'weight') return round2(line.soldG * it.pricePerGram);
  if (line.type === 'set') return round2(setUnitPrice(it, line) * line.qty);
  return 0;
}
function lineItemDiscount(line) {
  return line.type === 'weight' ? Math.min(toInt(line.disc), lineGross(line)) : 0;
}
function lineTitle(line) {
  const it = IDX.item[line.menuId];
  return it ? it.name : line.menuId;
}
function setSelections(it, line) {
  const options = [];
  const addOns = [];
  for (const g of it.optionGroups) {
    if (g.type === 'pick1') {
      const o = findOpt(g, (line.picks || {})[g.id]);
      if (o) options.push(o.name);
    } else {
      const a = (line.adds || {})[g.id] || {};
      for (const o of g.options) if (a[o.id]) addOns.push({ name: o.name, n: a[o.id], price: o.price });
    }
  }
  return { options, addOns };
}
function lineDetail(line) {
  const it = IDX.item[line.menuId];
  if (!it) return '';
  if (line.type === 'unit') return `${line.qty} × ${money(it.price)}`;
  if (line.type === 'weight') {
    const parts = [`ขาย ${fmtNum(line.soldG)} ก. (${money(line.soldG * it.pricePerGram)})`];
    if (line.freeG > 0) parts.push(`แถม ${fmtNum(line.freeG)} ก.`);
    if (line.disc > 0) parts.push(`ลดรายการ ${money(line.disc)}`);
    return parts.join(' · ');
  }
  const sel = setSelections(it, line);
  const parts = [...sel.options, ...sel.addOns.map((a) => `+${a.name} ×${a.n}`)];
  return `${parts.join(' · ')}${parts.length ? ' — ' : ''}${line.qty} × ${money(setUnitPrice(it, line))}`;
}
const lineCount = (l) => (l.type === 'weight' ? 1 : l.qty);

/**
 * Bill calculation: subtotal → owner-defined promotions (promo.js) → by-weight line discounts
 * → loyalty points → manual discount.
 */
function calcTotals(lines, manualInput, opt = {}) {
  const subtotal = round2(lines.reduce((s, l) => s + lineGross(l), 0));
  const pr = runPromoEngine(lines, opt);
  const promoDiscount = pr.discount;
  const itemDiscount = round2(lines.reduce((s, l) => s + lineItemDiscount(l), 0));
  let left = Math.max(0, round2(subtotal - promoDiscount - itemDiscount));
  // loyalty points redemption (before the manual discount)
  const loy = prefs().loyalty;
  let pointsRedeemed = 0, pointsDiscount = 0;
  if (loy.enabled && opt.redeem > 0 && loy.pointValue > 0) {
    pointsRedeemed = Math.min(toInt(opt.redeem), Math.floor(left / loy.pointValue));
    pointsDiscount = round2(pointsRedeemed * loy.pointValue);
    left = round2(left - pointsDiscount);
  }
  const manualRequested = Math.max(0, round2(parseFloat(manualInput) || 0));
  const manualDiscount = Math.min(manualRequested, left);
  const net = round2(left - manualDiscount);
  return {
    subtotal, promos: pr.promos, promoDiscount, promoLine: pr.lineDisc, promoLive: pr.live, itemDiscount,
    pointsRedeemed, pointsDiscount,
    manualRequested, manualDiscount,
    totalDiscount: round2(promoDiscount + itemDiscount + pointsDiscount + manualDiscount),
    net,
    pointsEarned: loy.enabled && opt.member ? Math.floor(net / loy.spendPerPoint) : 0,
  };
}
/** Totals of the current cart (promo choices, member, points). */
function cartTotals() {
  const c = state.cart;
  const cust = c.customer && c.customer.phone ? c.customer : null;
  return calcTotals(c.lines, c.manualDiscount, { off: c.promoOff, mode: c.promoMode, member: !!cust, redeem: cust ? cust.redeem : 0 });
}
/** Low-stock alert point of a menu (per-menu value, or the shop default for its sale mode). */
const lowPoint = (it) => (it.lowAt === '' || it.lowAt == null ? prefs().lowDefaults[it.mode] : it.lowAt);

/** Max number of sets the given stock function allows (required picks + base consumption). */
function setCapacity(it, avail) {
  let cap = Infinity;
  for (const b of it.baseConsumes) cap = Math.min(cap, Math.floor(avail(b.pool) / b.qty));
  for (const g of it.optionGroups) {
    if (g.type !== 'pick1' || !g.options.length) continue;
    let s = 0;
    for (const o of g.options) s += o.pool ? Math.max(0, Math.floor(avail(o.pool) / o.qty)) : Infinity;
    cap = Math.min(cap, s);
  }
  return cap;
}

function menuStatus(it, reserved) {
  const av = (p) => (p ? (state.stock[p] || 0) - (reserved[p] || 0) : Infinity);
  const real = (p) => (p ? state.stock[p] || 0 : Infinity);
  const manual = itemAvailability(it) === 'soldout';
  if (it.mode === 'unit') {
    const a = av(it.stockPool);
    return {
      soldOut: manual || real(it.stockPool) <= 0,
      blocked: a <= 0,
      manual,
      badge: it.stockPool ? `คงเหลือ ${fmtNum(Math.max(0, a))} ${poolUnit(it.stockPool)}` : 'พร้อมขาย',
      low: isFinite(a) && a > 0 && a <= lowPoint(it),
    };
  }
  if (it.mode === 'weight') {
    const a = av(it.stockPool);
    return {
      soldOut: manual || real(it.stockPool) < it.minGrams,
      blocked: a < it.minGrams,
      manual,
      badge: it.stockPool ? `${fmtNum(Math.max(0, a))} กรัม` : 'พร้อมขาย',
      low: isFinite(a) && a >= it.minGrams && a <= lowPoint(it),
    };
  }
  const sets = setCapacity(it, av);
  const parts = [];
  for (const b of it.baseConsumes) parts.push(`${poolName(b.pool)} ${fmtNum(Math.max(0, av(b.pool)))}`);
  for (const g of it.optionGroups) {
    if (g.type === 'pick1') for (const o of g.options) if (o.pool) parts.push(`${o.name} ${fmtNum(Math.max(0, av(o.pool)))}`);
  }
  return {
    soldOut: manual || setCapacity(it, real) <= 0,
    blocked: sets <= 0,
    manual,
    badge: isFinite(sets) ? `คงเหลือ ${Math.max(0, sets)} เซ็ต` : 'พร้อมขาย',
    low: isFinite(sets) && sets > 0 && sets <= lowPoint(it),
    sub: parts.join(' · '),
  };
}

/* ==========================================================================
   8. TOASTS & MODALS
   ========================================================================== */

function toast(msg, type = '', ms = 2600) {
  const host = $('#toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

function openModal(id) { $(`#${id}`).classList.add('open'); }
function closeModal(id) { $(`#${id}`).classList.remove('open'); }
const isOpen = (id) => $(`#${id}`).classList.contains('open');

/** Re-render a modal body without losing scroll position */
function paint(el, html) {
  const top = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = top;
}

function confirmDialog({ title = 'ยืนยัน', html = '', okText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false, input = null }) {
  return new Promise((resolve) => {
    const m = $('#m-confirm');
    m.querySelector('.cf-title').textContent = title;
    m.querySelector('.cf-body').innerHTML = html +
      (input ? `<input class="input cf-input" type="text" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}" />` : '');
    const ok = m.querySelector('.cf-ok');
    const cancel = m.querySelector('.cf-cancel');
    ok.textContent = okText;
    cancel.textContent = cancelText;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'} cf-ok`;
    const done = (result) => {
      closeModal('m-confirm');
      ok.onclick = cancel.onclick = null;
      resolve(result);
    };
    ok.onclick = () => done({ ok: true, value: input ? m.querySelector('.cf-input').value.trim() : null });
    cancel.onclick = () => done({ ok: false });
    openModal('m-confirm');
  });
}

/* ==========================================================================
   9. RENDER — HEADER, MENU, CART
   ========================================================================== */

function renderClock() {
  const s = fmtDateTime(new Date()).split(' ');
  $('#clockDate').textContent = s[0];
  $('#clockTime').textContent = s[1];
}

function hasStateChanges() {
  const m = state.syncMeta;
  return !!(m.catalogDirty || m.settingsDirty || Object.keys(m.stockDirty).length || Object.keys(m.imagesDirty).length);
}

function renderHeader() {
  const s = state.settings;
  $('#shopName').textContent = s.shopName || 'Maysa.Meekanom';
  $('#shopSub').textContent = s.shopSubtitle || '';
  document.title = s.shopName || 'Maysa.Meekanom';
  const online = navigator.onLine;
  const badge = $('#netBadge');
  badge.textContent = online ? 'Online' : 'Offline';
  badge.classList.toggle('offline', !online);

  const n = state.queue.length + (hasStateChanges() ? 1 : 0);
  const busy = state.syncing || state.cloudBusy;
  const btn = $('#btnSync');
  btn.classList.toggle('pending', n > 0);
  btn.classList.toggle('syncing', busy);
  $('#syncLabel').textContent = busy ? 'กำลัง Sync…' : (n ? `Sync Pending (${n})` : 'Synced ✓');
  renderStaffChip();
  renderAuthBanner();
}

function renderTabs() {
  const cats = visibleCategories();
  if (state.category !== 'all' && !cats.some((c) => c.id === state.category)) state.category = 'all';
  const count = (cid) => state.catalog.items.filter((it) => (cid === 'all' || it.categoryId === cid) && itemAvailability(it) !== 'hidden').length;
  $('#catTabs').innerHTML = [{ id: 'all', name: 'ทั้งหมด' }, ...cats].map((c) =>
    `<button class="cat-tab ${state.category === c.id ? 'active' : ''}" data-cat="${esc(c.id)}" type="button">${esc(c.name)}<span class="cnt">${count(c.id)}</span></button>`).join('') +
    `<button class="cat-tab add" data-act="cat-manage" type="button" aria-label="เพิ่ม/จัดการหมวดหมู่" title="เพิ่ม/จัดการหมวดหมู่">＋</button>`;
}

function cardTag(it) {
  if (it.tag) return it.tag;
  const p = cardPromo(it);
  if (p) return promoShortTag(p);
  if (it.mode === 'weight') return 'ชั่งน้ำหนัก';
  if (it.mode === 'set') return 'เซ็ต';
  return '';
}
function priceHtml(it) {
  if (it.mode === 'weight') return `${money(it.pricePerGram)}<small> / กรัม</small>`;
  if (it.mode === 'set') return `${money(it.price)}<small> / เซ็ต</small>`;
  return money(it.price);
}

function renderMenu() {
  const reserved = cartNeeds();
  const inCart = {};
  for (const l of state.cart.lines) inCart[l.menuId] = (inCart[l.menuId] || 0) + lineCount(l);
  const catOrder = Object.fromEntries(state.catalog.categories.map((c, i) => [c.id, i]));
  const items = state.catalog.items
    .filter((it) => itemAvailability(it) !== 'hidden' && (state.category === 'all' || it.categoryId === state.category))
    .sort((a, b) => (catOrder[a.categoryId] - catOrder[b.categoryId]));

  $('#menuGrid').innerHTML = items.length ? items.map((it) => {
    const st = menuStatus(it, reserved);
    const img = state.images[it.id];
    const tag = cardTag(it);
    const cls = ['menu-card', st.soldOut ? 'is-soldout' : '', !st.soldOut && st.blocked ? 'is-blocked' : '', inCart[it.id] ? 'in-cart' : ''].join(' ');
    return `
      <button class="${cls}" data-menu="${esc(it.id)}" type="button" aria-disabled="${st.soldOut || st.blocked}">
        <div class="card-img">
          ${img ? `<img src="${img}" alt="" loading="lazy" />` : `${svg('cookie', 46)}<span>ยังไม่มีรูป</span>`}
          ${tag ? `<span class="promo-tag">${esc(tag)}</span>` : ''}
          <span class="stock-badge ${st.low ? 'low' : ''}">${esc(st.badge)}</span>
          ${inCart[it.id] && !st.soldOut ? `<span class="qty-tag">${inCart[it.id]}</span>` : ''}
          ${!st.soldOut && st.blocked ? '<span class="blocked-note">สต็อกทั้งหมดอยู่ในตะกร้าแล้ว</span>' : ''}
        </div>
        ${st.soldOut ? `<div class="soldout-overlay"><span>SOLD OUT${st.manual ? '<small>ปิดขายวันนี้</small>' : ''}</span></div>` : ''}
        <div class="card-body">
          <div class="card-name">${esc(it.name)}</div>
          ${st.sub ? `<div class="card-sub">${esc(st.sub)}</div>` : ''}
          <div class="card-price">${priceHtml(it)}</div>
        </div>
      </button>`;
  }).join('') : `<div class="empty-state" style="grid-column:1/-1">${svg('cookie', 48)}<p>ยังไม่มีเมนูในหมวดนี้ — เพิ่มได้ที่ “จัดการเมนู &amp; สต็อก”</p></div>`;
}

function renderCart() {
  const lines = state.cart.lines;
  $('#cartCount').textContent = lines.reduce((s, l) => s + lineCount(l), 0);
  $('#btnClearCart').disabled = !lines.length;
  const parkBtn = $('#btnPark');
  if (parkBtn) {
    parkBtn.innerHTML = `${svg('pause', 18)} พักบิล${state.parked.length ? `<span class="cnt">${state.parked.length}</span>` : ''}`;
    parkBtn.classList.toggle('has', state.parked.length > 0);
  }
  const t = cartTotals();

  if (!lines.length) {
    $('#cartList').innerHTML = `<div class="cart-empty">${svg('cart', 48)}<div>ยังไม่มีสินค้าในออเดอร์<br/>แตะที่เมนูเพื่อเพิ่ม</div>
      ${state.parked.length ? `<button class="btn btn-outline" data-act="parked" type="button">${svg('pause', 18)} บิลที่พักไว้ ${state.parked.length} บิล</button>` : ''}</div>`;
  } else {
    $('#cartList').innerHTML = lines.map((l) => {
      const gross = lineGross(l);
      const disc = lineItemDiscount(l);
      const promo = t.promoLine[l.id] || 0;
      const editBtn = `<button class="icon-btn" data-act="edit" data-id="${l.id}" type="button" aria-label="แก้ไข">${svg('edit')}</button>`;
      const controls = l.type === 'weight'
        ? editBtn
        : `<div class="stepper">
             <button data-act="dec" data-id="${l.id}" type="button" aria-label="ลด">${svg('minus')}</button>
             <span class="qty">${l.qty}</span>
             <button data-act="inc" data-id="${l.id}" type="button" aria-label="เพิ่ม">${svg('plus')}</button>
           </div>${l.type === 'set' ? editBtn : ''}`;
      return `
        <div class="cart-line">
          <div class="cl-top">
            <div class="cl-name">${esc(lineTitle(l))}</div>
            <div class="cl-amt">${disc ? `<s>${money(gross)}</s> ` : ''}${money(gross - disc)}</div>
          </div>
          <div class="cl-detail">${esc(lineDetail(l))}${promo ? ` <span class="cl-promo">โปร -${money(promo)}</span>` : ''}</div>
          ${l.note ? `<div class="cl-note">📝 ${esc(l.note)}</div>` : ''}
          <div class="cl-actions">${controls}<span class="grow"></span>
            <button class="icon-btn ${l.note ? 'on' : ''}" data-act="note" data-id="${l.id}" type="button" aria-label="หมายเหตุ">${svg('note')}</button>
            <button class="icon-btn danger" data-act="remove" data-id="${l.id}" type="button" aria-label="ลบ">${svg('trash')}</button>
          </div>
        </div>`;
    }).join('') + `
      <button class="bill-note ${state.cart.note ? 'on' : ''}" data-act="bill-note" type="button">
        ${svg('note', 18)} <span>${state.cart.note ? `หมายเหตุบิล: <b>${esc(state.cart.note)}</b>` : 'เพิ่มหมายเหตุบิล (แยกถุง, อุ่นร้อน …)'}</span>
      </button>`;
  }
  renderTotals(t);
}

function renderTotals(t) {
  t = t || cartTotals();
  $('#sumSubtotal').textContent = money(t.subtotal);
  const off = (state.cart.promoOff || []).length;
  const best = state.cart.promoMode === 'best';
  let html = `
    <div class="sum-row ${t.promos.length ? 'discount' : 'muted'}">
      <button class="promo-pick" data-act="promo-pick" type="button" ${state.cart.lines.length ? '' : 'disabled'}>
        ${svg('tag', 16)} โปรโมชั่น${best ? ' · คุ้มสุด' : ''}${off ? ` · ปิด ${off}` : ''}${t.promoLive.length > t.promos.length && state.cart.lines.length ? ' · เลือกได้' : ''}
      </button>
      <span>${negMoney(t.promoDiscount)}</span>
    </div>`;
  html += t.promos.map((p) => `<div class="sum-row sub"><span>• ${esc(p.label)}${p.bundles > 1 ? ` × ${p.bundles}` : ''}</span><span>${negMoney(p.discount)}</span></div>`).join('');
  if (t.itemDiscount > 0) html += `<div class="sum-row discount"><span>ส่วนลดเฉพาะรายการ</span><span>${negMoney(t.itemDiscount)}</span></div>`;
  const cust = state.cart.customer;
  if (cust && cust.phone) {
    html += `<div class="sum-row member"><span>👤 ${esc(cust.name || cust.phone)}${t.pointsEarned ? ` · ได้ ${t.pointsEarned} แต้ม` : ''}</span><span>${t.pointsDiscount ? negMoney(t.pointsDiscount) : ''}</span></div>`;
  }
  $('#promoRows').innerHTML = html;
  const manual = $('#manualDiscount');
  manual.readOnly = !can('discount') && !state.cart.discountBy;
  manual.placeholder = manual.readOnly ? '🔒' : '0';
  $('#manualNote').textContent = t.manualRequested > t.manualDiscount
    ? `ส่วนลดเพิ่มเติมถูกจำกัดไว้ที่ ${money(t.manualDiscount)} (ไม่เกินยอดคงเหลือ)` : (state.cart.discountBy ? `อนุมัติส่วนลดโดย ${state.cart.discountBy}` : '');
  $('#sumNet').textContent = money(t.net);
  $('#btnCheckout').disabled = !state.cart.lines.length;
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderMenu();
  renderCart();
}

function cartChanged() {
  save.cart();
  renderMenu();
  renderCart();
}

/* ==========================================================================
   10. CART ACTIONS
   ========================================================================== */

function onMenuTap(menuId) {
  const it = IDX.item[menuId];
  if (!it) return;
  const st = menuStatus(it, cartNeeds());
  if (st.soldOut) return toast(`${it.name} — SOLD OUT`, 'error');
  if (st.blocked) return toast('สต็อกคงเหลือทั้งหมดอยู่ในตะกร้าแล้ว', 'warn');
  if (it.mode === 'unit') addUnit(it);
  else if (it.mode === 'weight') openWeight(menuId, null);
  else openSet(menuId, null);
}

function addUnit(it) {
  if (it.stockPool && findShortages({ [it.stockPool]: 1 }).length) return toast('สต็อกไม่พอ', 'error');
  const line = state.cart.lines.find((l) => l.type === 'unit' && l.menuId === it.id);
  if (line) line.qty += 1;
  else state.cart.lines.push({ id: uid(), type: 'unit', menuId: it.id, qty: 1 });
  cartChanged();
  const count = $('#cartCount');
  count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump');
}

function changeQty(lineId, delta) {
  const line = state.cart.lines.find((l) => l.id === lineId);
  if (!line || line.type === 'weight') return;
  if (delta > 0) {
    const short = findShortages(lineNeeds(Object.assign({}, line, { qty: 1 })));
    if (short.length) return toast(`สต็อกไม่พอ: ${shortageText(short)}`, 'error', 3500);
    line.qty += 1;
  } else {
    line.qty -= 1;
    if (line.qty <= 0) state.cart.lines = state.cart.lines.filter((l) => l.id !== lineId);
  }
  cartChanged();
}

function removeLine(lineId) {
  state.cart.lines = state.cart.lines.filter((l) => l.id !== lineId);
  cartChanged();
}

async function clearCart() {
  if (!state.cart.lines.length) return;
  const r = await confirmDialog({ title: 'ล้างตะกร้า', html: 'ต้องการลบสินค้าทั้งหมดในออเดอร์นี้หรือไม่?', okText: 'ล้างตะกร้า', danger: true });
  if (!r.ok) return;
  resetCart();
}
/** Empty the cart (after payment, clear, or parking a bill). */
function resetCart() {
  state.cart = emptyCart();
  $('#manualDiscount').value = '';
  cartChanged();
}

/* ==========================================================================
   11. BY-WEIGHT MODAL (sold grams / giveaway grams / item discount + numpad)
   ========================================================================== */

let weightCtx = null;

function openWeight(menuId, editLine) {
  weightCtx = {
    menuId,
    editId: editLine ? editLine.id : null,
    f: {
      sold: editLine ? String(editLine.soldG) : '',
      free: editLine ? String(editLine.freeG) : '0',
      disc: editLine ? String(editLine.disc) : '0',
    },
    active: 'sold',
  };
  renderWeight();
  openModal('m-weight');
}

function weightCalc() {
  const it = IDX.item[weightCtx.menuId];
  const sold = toInt(weightCtx.f.sold);
  const free = toInt(weightCtx.f.free);
  const disc = toInt(weightCtx.f.disc);
  const available = availableOf(it.stockPool, cartNeeds(weightCtx.editId));
  const price = round2(sold * it.pricePerGram);
  const errors = [];
  if (sold < it.minGrams) errors.push(`น้ำหนักที่ขายต้องไม่น้อยกว่า ${it.minGrams} กรัม`);
  if (sold + free > available) errors.push(`สต็อกไม่พอ: ต้องตัด ${fmtNum(sold + free)} ก. แต่คงเหลือ ${fmtNum(Math.max(0, available))} ก.`);
  if (disc > price) errors.push('ส่วนลดเฉพาะรายการเกินราคาสินค้า');
  return { it, sold, free, disc, available, price, total: Math.max(0, round2(price - disc)), errors };
}

function renderWeight() {
  const c = weightCalc();
  const modal = $('#m-weight');
  modal.querySelector('.modal-title').textContent = `${c.it.name}${weightCtx.editId ? ' (แก้ไข)' : ''}`;
  const field = (key, label, hint, unit) => {
    const raw = weightCtx.f[key];
    return `
      <button class="num-field ${weightCtx.active === key ? 'active' : ''}" data-field="${key}" type="button">
        <div class="nf-label">${label}</div><div class="nf-hint">${hint}</div>
        <div class="nf-val">${raw === '' ? '<span class="ph">0</span>' : fmtNum(toInt(raw))}<span class="unit">${unit}</span></div>
      </button>`;
  };
  const chips = weightCtx.active === 'disc' ? [5, 10, 20, 50] : [10, 50, 100, 200];
  modal.querySelector('.modal-body').innerHTML = `
    <div class="info-strip">
      <span>สต็อกคงเหลือ: <b>${isFinite(c.available) ? `${fmtNum(Math.max(0, c.available))} กรัม` : 'ไม่จำกัด'}</b></span>
      <span>ราคา: <b>${money(c.it.pricePerGram)} / กรัม</b></span>
      <span>ขั้นต่ำ: <b>${c.it.minGrams} กรัม</b></span>
    </div>
    <div class="cereal-layout">
      <div>
        ${field('sold', 'น้ำหนักที่ขาย (กรัม)', `บังคับ · ขั้นต่ำ ${c.it.minGrams} กรัม · ราคา = น้ำหนัก × ${money(c.it.pricePerGram)}`, 'กรัม')}
        ${field('free', 'น้ำหนักที่แถม (กรัม)', 'ไม่บังคับ · ของแถม ฿0 (ตัดสต็อกด้วย)', 'กรัม')}
        ${field('disc', 'ส่วนลดเฉพาะรายการนี้ (บาท)', 'ไม่บังคับ', 'บาท')}
        <div class="calc-box">
          <div class="sum-row"><span>ราคา (${fmtNum(c.sold)} ก. × ${money(c.it.pricePerGram)})</span><span>${money(c.price)}</span></div>
          <div class="sum-row discount"><span>ส่วนลดรายการ</span><span>${negMoney(Math.min(c.disc, c.price))}</span></div>
          <div class="sum-row muted"><span>ตัดสต็อกรวม (ขาย + แถม)</span><span>${fmtNum(c.sold + c.free)} กรัม</span></div>
          <div class="sum-row total"><span>ยอดรายการนี้</span><span>${money(c.total)}</span></div>
        </div>
        ${c.errors.length && weightCtx.f.sold !== '' ? `<div class="err-box">${c.errors.map(esc).join('<br/>')}</div>` : ''}
      </div>
      <div>
        <div class="chip-row">${chips.map((n) => `<button class="chip" data-chip="${n}" type="button">+${n}</button>`).join('')}</div>
        <div class="numpad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-key="${n}" type="button">${n}</button>`).join('')}
          <button class="np-fn" data-key="C" type="button">ล้าง</button>
          <button data-key="0" type="button">0</button>
          <button class="np-fn" data-key="BS" type="button" aria-label="ลบ">⌫</button>
        </div>
      </div>
    </div>`;
  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button>
    <button class="btn btn-primary btn-lg" data-act="weight-ok" type="button" ${c.errors.length ? 'disabled' : ''}>
      ${weightCtx.editId ? 'บันทึกการแก้ไข' : 'เพิ่มลงตะกร้า'} · ${money(c.total)}
    </button>`;
}

function weightKey(k) {
  const f = weightCtx.f;
  const a = weightCtx.active;
  if (k === 'C') f[a] = '';
  else if (k === 'BS') f[a] = f[a].slice(0, -1);
  else if (f[a].length < 6) f[a] = f[a] === '0' ? String(k) : f[a] + k;
  renderWeight();
}

function weightConfirm() {
  const c = weightCalc();
  if (c.errors.length) return toast(c.errors[0], 'error');
  const data = { soldG: c.sold, freeG: c.free, disc: Math.min(c.disc, c.price) };
  if (weightCtx.editId) {
    const line = state.cart.lines.find((l) => l.id === weightCtx.editId);
    if (line) Object.assign(line, data);
  } else {
    state.cart.lines.push(Object.assign({ id: uid(), type: 'weight', menuId: weightCtx.menuId }, data));
  }
  closeModal('m-weight');
  cartChanged();
  toast(`เพิ่ม ${c.it.name} ${fmtNum(c.sold)} ก.${c.free ? ` (แถม ${c.free} ก.)` : ''}`, 'success', 1600);
}

/* ==========================================================================
   12. SET MODAL (required pick-1 groups + add-on steppers)
   ========================================================================== */

let setCtx = null;

function openSet(menuId, editLine) {
  const it = IDX.item[menuId];
  setCtx = editLine
    ? { menuId, editId: editLine.id, picks: clone(editLine.picks || {}), adds: clone(editLine.adds || {}), qty: editLine.qty }
    : { menuId, editId: null, picks: {}, adds: {}, qty: 1 };
  if (!editLine) {
    // auto-select when only one option of a required group is in stock
    for (const g of it.optionGroups) {
      if (g.type !== 'pick1') continue;
      const ok = g.options.filter((o) => setTry((c) => { c.picks[g.id] = o.id; }));
      if (ok.length === 1) setCtx.picks[g.id] = ok[0].id;
    }
  }
  renderSet();
  openModal('m-set');
}
const setLine = (c) => ({ type: 'set', menuId: c.menuId, picks: c.picks, adds: c.adds, qty: c.qty });
function setTry(mutate) {
  const c = clone(setCtx);
  mutate(c);
  return findShortages(lineNeeds(setLine(c)), setCtx.editId).length === 0;
}
function setComplete(c) {
  const it = IDX.item[c.menuId];
  return it.optionGroups.every((g) => g.type !== 'pick1' || !g.options.length || findOpt(g, c.picks[g.id]));
}
const addCount = (c, gid, oid) => ((c.adds[gid] || {})[oid]) || 0;

function renderSet() {
  const c = setCtx;
  const it = IDX.item[c.menuId];
  const reserved = cartNeeds(c.editId);
  const left = (p) => availableOf(p, reserved);
  const fits = setTry(() => {});
  const complete = setComplete(c);
  const valid = fits && complete;
  const unitPrice = setUnitPrice(it, setLine(c));
  const total = round2(unitPrice * c.qty);

  const pools = new Set();
  it.baseConsumes.forEach((b) => pools.add(b.pool));
  it.optionGroups.forEach((g) => g.options.forEach((o) => o.pool && pools.add(o.pool)));
  const stepper = (attrs, value, min, canInc) => `
    <div class="stepper lg">
      <button ${attrs} data-d="-1" type="button" ${value <= min ? 'disabled' : ''} aria-label="ลด">${svg('minus')}</button>
      <span class="qty">${value}</span>
      <button ${attrs} data-d="1" type="button" ${canInc ? '' : 'disabled'} aria-label="เพิ่ม">${svg('plus')}</button>
    </div>`;

  const groupsHtml = it.optionGroups.map((g, gi) => {
    if (g.type === 'pick1') {
      return `
        <div class="section">
          <div class="section-title">${gi + 1}. ${esc(g.name)} <small>(บังคับเลือก 1)</small></div>
          <div class="choice-row">
            ${g.options.map((o) => {
              const sel = c.picks[g.id] === o.id;
              const can = sel || setTry((x) => { x.picks[g.id] = o.id; });
              return `<button class="choice ${sel ? 'selected' : ''}" data-pick="${esc(g.id)}" data-o="${esc(o.id)}" type="button" ${can ? '' : 'disabled'}>
                ${esc(o.name)}<small>${o.price ? `+${money(o.price)} · ` : ''}${o.pool ? `คงเหลือ ${fmtNum(Math.max(0, left(o.pool)))} ${poolUnit(o.pool)}` : 'พร้อมขาย'}</small>
              </button>`;
            }).join('')}
          </div>
        </div>`;
    }
    return `
      <div class="section">
        <div class="section-title">${gi + 1}. ${esc(g.name)} <small>(ไม่บังคับ)</small></div>
        <div class="card-box">
          ${g.options.map((o) => {
            const n = addCount(c, g.id, o.id);
            const canInc = setTry((x) => { x.adds[g.id] = x.adds[g.id] || {}; x.adds[g.id][o.id] = n + 1; });
            return `<div class="addon-row"><div class="addon-name">${esc(o.name)} (+${money(o.price)})<small>${o.pool ? `คงเหลือ ${fmtNum(Math.max(0, left(o.pool)))} ${poolUnit(o.pool)}` : ''}</small></div>
              ${stepper(`data-add="${esc(g.id)}" data-o="${esc(o.id)}"`, n, 0, canInc)}</div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  const sel = setSelections(it, setLine(c));
  const modal = $('#m-set');
  modal.querySelector('.modal-title').textContent = `${it.name}${c.editId ? ' (แก้ไข)' : ''}`;
  modal.querySelector('.modal-body').innerHTML = `
    ${pools.size ? `<div class="info-strip">${[...pools].map((p) => `<span>${esc(poolName(p))}: <b>${fmtNum(Math.max(0, left(p)))} ${poolUnit(p)}</b></span>`).join('')}</div>` : ''}
    <div class="gooey-layout">
      <div>${groupsHtml || '<p class="help">เซ็ตนี้ไม่มีตัวเลือก</p>'}</div>
      <div>
        <div class="section">
          <div class="section-title">จำนวนเซ็ต</div>
          <div class="card-box" style="display:flex;justify-content:center">${stepper('data-qty="1"', c.qty, 1, setTry((x) => { x.qty += 1; }))}</div>
        </div>
        <div class="calc-box">
          <div class="sum-row"><span>ราคาเซ็ต</span><span>${money(it.price)}</span></div>
          ${it.optionGroups.filter((g) => g.type === 'pick1').map((g) => { const o = findOpt(g, c.picks[g.id]); return o && o.price ? `<div class="sum-row"><span>${esc(o.name)}</span><span>+${money(o.price)}</span></div>` : ''; }).join('')}
          ${sel.addOns.map((a) => `<div class="sum-row"><span>${esc(a.name)} × ${a.n}</span><span>+${money(a.price * a.n)}</span></div>`).join('')}
          <div class="sum-row muted"><span>ราคาต่อเซ็ต × ${c.qty}</span><span>${money(unitPrice)}</span></div>
          <div class="sum-row total"><span>รวม</span><span>${money(total)}</span></div>
        </div>
        ${!complete ? '<div class="warn-box">กรุณาเลือกตัวเลือกที่บังคับให้ครบ</div>' : (!fits ? '<div class="err-box">สต็อกไม่พอสำหรับตัวเลือกนี้</div>' : '')}
      </div>
    </div>`;
  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button>
    <button class="btn btn-primary btn-lg" data-act="set-ok" type="button" ${valid ? '' : 'disabled'}>
      ${c.editId ? 'บันทึกการแก้ไข' : 'เพิ่มลงตะกร้า'} · ${money(total)}
    </button>`;
}

function setConfirm() {
  const c = setCtx;
  if (!setComplete(c) || !setTry(() => {})) return toast('กรุณาเลือกตัวเลือกให้ครบ หรือสต็อกไม่พอ', 'error');
  for (const gid of Object.keys(c.adds)) {
    for (const oid of Object.keys(c.adds[gid])) if (!c.adds[gid][oid]) delete c.adds[gid][oid];
    if (!Object.keys(c.adds[gid]).length) delete c.adds[gid];
  }
  const cfg = { picks: c.picks, adds: c.adds, qty: c.qty };
  if (c.editId) {
    const line = state.cart.lines.find((l) => l.id === c.editId);
    if (line) Object.assign(line, cfg);
  } else {
    const key = JSON.stringify([c.picks, c.adds]);
    const same = state.cart.lines.find((l) => l.type === 'set' && l.menuId === c.menuId && JSON.stringify([l.picks, l.adds]) === key);
    if (same) same.qty += c.qty;
    else state.cart.lines.push(Object.assign({ id: uid(), type: 'set', menuId: c.menuId }, cfg));
  }
  closeModal('m-set');
  cartChanged();
  toast(`เพิ่ม ${IDX.item[c.menuId].name} แล้ว`, 'success', 1600);
}

/* ==========================================================================
   13. PAYMENT & CHECKOUT
   ========================================================================== */

let payCtx = null;

async function openPayment() {
  if (!state.cart.lines.length) return;
  const short = cartShortages();
  if (short.length) return toast(`สต็อกไม่พอ: ${shortageText(short)} — กรุณาแก้ไขตะกร้า`, 'error', 5000);
  if (prefs().requireShift && !state.shift) {
    toast('กรุณาเปิดกะก่อนขาย (กรอกเงินทอนตั้งต้น)', 'warn', 3500);
    return openShiftPanel();
  }
  const methods = payMethods(true);
  payCtx = { method: methods.length === 1 ? methods[0].id : null, cash: '', busy: false, openedAt: new Date(), phone: (state.cart.customer && state.cart.customer.phone) || '' };
  ensureModal('m-pay', { size: 'lg', title: 'ชำระเงิน' });
  renderPayment();
  openModal('m-pay');
}

function memberPanelHTML(t) {
  const loy = prefs().loyalty;
  if (!loy.enabled) return '';
  const c = state.cart.customer;
  const known = c && c.phone ? state.customers[c.phone] : null;
  const pts = known ? known.points : 0;
  const canRedeem = known && loy.pointValue > 0 && pts >= Math.max(1, loy.minRedeem);
  return `
    <div class="member-panel">
      <div class="section-title" style="margin:0 0 6px">สมาชิก / สะสมแต้ม <small>(ไม่บังคับ)</small></div>
      ${c && c.phone ? `
        <div class="row nowrap">
          <div class="grow"><b>${esc(c.name || (known && known.name) || 'สมาชิกใหม่')}</b> · ${esc(fmtPhone(c.phone))}
            <div class="help" style="margin:0">${known ? `แต้มสะสม <b>${fmtNum(pts)}</b> · มาแล้ว ${known.visits || 0} ครั้ง` : 'สมาชิกใหม่ — จะสร้างให้อัตโนมัติเมื่อชำระเงิน'}${t.pointsEarned ? ` · บิลนี้ได้ <b>+${t.pointsEarned}</b> แต้ม` : ''}</div></div>
          <button class="btn btn-ghost btn-sm" data-act="member-clear" type="button">เปลี่ยน</button>
        </div>
        ${known ? '' : `<input class="input" id="memberName" type="text" placeholder="ชื่อลูกค้า (ไม่บังคับ)" value="${esc(c.name || '')}" style="margin-top:8px" />`}
        ${canRedeem ? `
          <div class="row" style="margin-top:8px">
            <span>ใช้แต้ม</span>
            <div class="stepper"><button data-act="redeem" data-d="-${Math.max(1, loy.minRedeem)}" type="button" aria-label="ลด">${svg('minus')}</button>
              <span class="qty">${toInt(c.redeem)}</span>
              <button data-act="redeem" data-d="${Math.max(1, loy.minRedeem)}" type="button" aria-label="เพิ่ม">${svg('plus')}</button></div>
            <button class="btn btn-outline btn-sm" data-act="redeem-max" type="button">ใช้สูงสุด</button>
            <span class="help" style="margin:0">1 แต้ม = ${money(loy.pointValue)}${loy.minRedeem > 1 ? ` · ขั้นต่ำ ${loy.minRedeem} แต้ม` : ''}</span>
          </div>` : ''}` : `
        <div class="row nowrap">
          <input class="input grow" id="memberPhone" type="tel" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="เบอร์โทรลูกค้า" value="${esc(payCtx.phone)}" />
          <button class="btn btn-outline" data-act="member-find" type="button">ค้นหา/เพิ่ม</button>
        </div>`}
    </div>`;
}

function renderPayment() {
  const t = cartTotals();
  const modal = $('#m-pay');
  const items = state.cart.lines.map((l) => `
    <div class="pay-item">
      <div><div>${esc(lineTitle(l))}</div><div class="pi-detail">${esc(lineDetail(l))}${l.note ? ` · 📝 ${esc(l.note)}` : ''}</div></div>
      <div class="nowrap">${money(lineGross(l) - lineItemDiscount(l))}</div>
    </div>`).join('');
  const m = payMethod(payCtx.method);
  let methodPanel = '';
  if (m && m.kind === 'cash') {
    methodPanel = `
      <div class="cash-panel">
        <label class="field-label" for="payCash">รับเงินมา (ไม่บังคับ)</label>
        <input class="input" id="payCash" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(payCtx.cash)}" />
        <div class="cash-quick">
          <button class="btn btn-outline btn-sm" data-cash="exact" type="button">พอดี</button>
          ${[100, 500, 1000].map((n) => `<button class="btn btn-outline btn-sm" data-cash="${n}" type="button">฿${fmtNum(n)}</button>`).join('')}
        </div>
        <div class="change-due" id="changeDue"></div>
      </div>`;
  } else if (m && m.kind === 'promptpay') {
    const id = prefs().promptpayId;
    methodPanel = id
      ? `<div class="qr-panel">${promptPayQR(id, t.net)}<div><b>${money(t.net)}</b><small>พร้อมเพย์ ${esc(fmtPhone(id))}${prefs().promptpayName ? `<br/>${esc(prefs().promptpayName)}` : ''}</small><small>ให้ลูกค้าสแกนจ่าย ยอดถูกใส่ไว้แล้ว</small></div></div>`
      : `<div class="warn-box">ยังไม่ได้ตั้งค่าเบอร์/เลขพร้อมเพย์ — ตั้งได้ที่ ตั้งค่า ▸ การชำระเงิน แล้วระบบจะสร้าง QR ตามยอดให้อัตโนมัติ</div>`;
  }

  modal.querySelector('.modal-body').innerHTML = `
    <div class="pay-layout">
      <div>
        <div class="section-title">สรุปรายการ <small>${fmtDateTime(payCtx.openedAt)}</small></div>
        <div class="pay-items">${items}</div>
        ${state.cart.note ? `<div class="cl-note" style="margin-top:6px">📝 หมายเหตุบิล: ${esc(state.cart.note)}</div>` : ''}
        <div style="margin-top:8px">
          <div class="sum-row"><span>ยอดรวมก่อนลด</span><span>${money(t.subtotal)}</span></div>
          ${t.promos.map((p) => `<div class="sum-row discount"><span>${esc(p.label)}${p.bundles > 1 ? ` × ${p.bundles}` : ''}</span><span>${negMoney(p.discount)}</span></div>`).join('')}
          ${t.itemDiscount ? `<div class="sum-row discount"><span>ส่วนลดเฉพาะรายการ</span><span>${negMoney(t.itemDiscount)}</span></div>` : ''}
          ${t.pointsDiscount ? `<div class="sum-row discount"><span>ใช้แต้ม ${t.pointsRedeemed} แต้ม</span><span>${negMoney(t.pointsDiscount)}</span></div>` : ''}
          ${t.manualDiscount ? `<div class="sum-row discount"><span>ส่วนลดเพิ่มเติม</span><span>${negMoney(t.manualDiscount)}</span></div>` : ''}
        </div>
        <div class="pay-net"><span class="section-title" style="margin:0">ยอดชำระสุทธิ</span><b>${money(t.net)}</b></div>
        ${memberPanelHTML(t)}
      </div>
      <div>
        <div class="section-title">เลือกวิธีชำระเงิน</div>
        <div class="pay-methods">
          ${payMethods(true).map((pm) => `
            <button class="pay-btn ${payCtx.method === pm.id ? 'selected' : ''}" data-method="${esc(pm.id)}" type="button">
              <span class="pay-ic">${svg(pm.icon, 26)}</span>
              <span>${esc(pm.label)}<small>${esc(pm.en)}</small></span>
            </button>`).join('')}
        </div>
        ${methodPanel}
      </div>
    </div>`;
  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost btn-lg" data-close type="button">กลับไปแก้ไข</button>
    <button class="btn btn-primary btn-lg" id="btnPayConfirm" data-act="pay-ok" type="button">ยืนยันการชำระเงิน · ${money(t.net)}</button>`;
  updatePayState();
}

function updatePayState() {
  const t = cartTotals();
  const btn = $('#btnPayConfirm');
  let ok = !!payCtx.method && !payCtx.busy;
  const due = $('#changeDue');
  if (isCashMethod(payCtx.method) && due) {
    const received = parseFloat(payCtx.cash);
    if (payCtx.cash === '' || isNaN(received)) {
      due.className = 'change-due';
      due.innerHTML = `<span>เงินทอน</span><b>—</b>`;
    } else {
      const change = round2(received - t.net);
      due.className = `change-due ${change < 0 ? 'neg' : ''}`;
      due.innerHTML = change < 0 ? `<span>รับเงินไม่พอ ขาดอีก</span><b>${money(-change)}</b>` : `<span>เงินทอน</span><b>${money(change)}</b>`;
      if (change < 0) ok = false;
    }
  }
  if (btn) btn.disabled = !ok;
}

/** ORD-<DEVICE>-YYYYMMDD-001 — the device prefix prevents collisions between iPads */
function nextOrderId(d) {
  const prefix = `ORD-${state.settings.devicePrefix || 'IPAD1'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`;
  let max = 0;
  for (const o of state.orders) {
    if (o.id.startsWith(prefix)) max = Math.max(max, parseInt(o.id.slice(prefix.length), 10) || 0);
  }
  return prefix + pad(max + 1, 3);
}
/** Short queue number for the counter (#01, #02 … resets daily; optional letter per device, e.g. A01). */
function nextQueueNo(d) {
  const day = dateKey(d);
  const n = state.orders.filter((o) => o.date === day && o.device === state.settings.devicePrefix).length + 1;
  return `${state.settings.queuePrefix || ''}${pad(n, 2)}`;
}

/** Stock cost of a cart line at today's pool costs + the menu's extra cost (packaging). */
function lineCost(l, needs) {
  const it = IDX.item[l.menuId];
  let c = 0;
  for (const k in needs) c += needs[k] * ((IDX.pool[k] && IDX.pool[k].cost) || 0);
  if (it) c += it.cost * (l.type === 'weight' ? 1 : l.qty);
  return round2(c);
}

function buildOrderItems(lines, promoLine) {
  return lines.map((l, i) => {
    const it = IDX.item[l.menuId];
    const cat = IDX.cat[it.categoryId];
    const gross = lineGross(l);
    const itemDiscount = lineItemDiscount(l);
    const promoDiscount = round2((promoLine && promoLine[l.id]) || 0);
    const sel = l.type === 'set' ? setSelections(it, l) : { options: [], addOns: [] };
    const needs = lineNeeds(l);
    return {
      lineNo: i + 1,
      type: l.type,
      menuId: l.menuId,
      categoryId: it.categoryId,
      category: cat ? cat.name : '',
      kitchen: cat ? cat.kitchen !== false : true,
      name: lineTitle(l),
      detail: lineDetail(l),
      qty: l.type === 'weight' ? 1 : l.qty,
      unitPrice: l.type === 'unit' ? it.price : l.type === 'set' ? setUnitPrice(it, l) : it.pricePerGram,
      soldG: l.soldG || 0,
      freeG: l.freeG || 0,
      options: sel.options,
      addOns: sel.addOns.map((a) => ({ name: a.name, n: a.n })),
      note: l.note || '',
      gross,
      itemDiscount,
      promoDiscount,
      net: round2(gross - itemDiscount),
      cost: lineCost(l, needs),
      needs,
    };
  });
}

/** What the kitchen screen shows for a bill (only categories marked "ส่งเข้าครัว"). */
function kitchenTicket(items) {
  const list = items.filter((i) => i.kitchen !== false).map((i) => ({
    n: i.name,
    q: i.type === 'weight' ? `${fmtNum(i.soldG)} ก.` : `×${i.qty}`,
    o: [...(i.type === 'weight' && i.freeG ? [`+ แถม ${fmtNum(i.freeG)} ก. (รวม ${fmtNum(i.soldG + i.freeG)} ก.)`] : []),
      ...(i.options || []), ...(i.addOns || []).map((a) => `+${a.name} ×${a.n}`)],
    g: i.type === 'weight' ? i.soldG + i.freeG : 0,
    note: i.note || '',
  }));
  const prep = {};
  for (const i of items) {
    if (i.kitchen === false) continue;
    for (const k in i.needs || {}) {
      const label = `${poolName(k)}|${poolUnit(k)}`;
      prep[label] = (prep[label] || 0) + i.needs[k];
    }
  }
  return { items: list, prep };
}

async function confirmPayment() {
  if (!payCtx || payCtx.busy || !payCtx.method) return;
  const short = cartShortages();
  if (short.length) return toast(`สต็อกไม่พอ: ${shortageText(short)}`, 'error', 5000);
  const memberName = $('#memberName');
  if (memberName && state.cart.customer) state.cart.customer.name = memberName.value.trim();
  const t = cartTotals();
  const pm = payMethod(payCtx.method);
  let cashReceived = null, change = null;
  if (pm && pm.kind === 'cash' && payCtx.cash !== '') {
    cashReceived = round2(parseFloat(payCtx.cash) || 0);
    change = round2(cashReceived - t.net);
    if (change < 0) return toast('รับเงินไม่พอ', 'error');
  }
  payCtx.busy = true;
  updatePayState();

  const now = new Date();
  const items = buildOrderItems(state.cart.lines, t.promoLine);
  const ticket = kitchenTicket(items);
  const cust = state.cart.customer && state.cart.customer.phone ? state.cart.customer : null;
  const order = {
    id: nextOrderId(now),
    queueNo: nextQueueNo(now),
    createdAtISO: isoLocal(now),
    createdAtUTC: now.toISOString(),
    createdAtTH: fmtDateTime(now),
    date: dateKey(now),
    device: state.settings.devicePrefix,
    staff: state.session ? { id: state.session.staffId, name: state.session.name } : null,
    shiftId: state.shift ? state.shift.id : '',
    note: state.cart.note || '',
    items,
    subtotal: t.subtotal,
    promos: t.promos.map((p) => ({ key: p.key, label: p.label, bundles: p.bundles, discount: p.discount })),
    promoDiscount: t.promoDiscount,
    itemDiscount: t.itemDiscount,
    pointsDiscount: t.pointsDiscount,
    manualDiscount: t.manualDiscount,
    manualBy: t.manualDiscount ? (state.cart.discountBy || (state.session && state.session.name) || '') : '',
    totalDiscount: t.totalDiscount,
    net: t.net,
    totalCost: round2(items.reduce((s, i) => s + i.cost, 0)),
    customer: cust ? { phone: cust.phone, name: cust.name || (state.customers[cust.phone] && state.customers[cust.phone].name) || '', earned: t.pointsEarned, redeemed: t.pointsRedeemed } : null,
    payment: { method: payCtx.method, label: pm ? pm.label : payCtx.method, kind: pm ? pm.kind : 'other', cashReceived, change },
    stockDeduction: cartNeeds(),
    kitchenStatus: ticket.items.length ? 'PENDING' : 'NONE',
    kitchen: ticket,
    status: 'COMPLETED',
    synced: false,
    voidedAtISO: '',
    voidedAtTH: '',
    voidReason: '',
    voidSynced: false,
  };

  state.orders.push(order);
  if (!(await save.orders([order]))) {
    state.orders.pop();
    payCtx.busy = false;
    updatePayState();
    return;
  }
  for (const k in order.stockDeduction) state.stock[k] = Math.max(0, (state.stock[k] || 0) - order.stockDeduction[k]);
  save.stock();
  if (order.customer) applyCustomerOrder(order, 1);
  enqueue('NEW_ORDER', order.id);
  resetCart();

  closeModal('m-pay');
  renderAll();
  if (prefs().receipt.showDone) showOrderDone(order);
  else toast(`ชำระเงินสำเร็จ คิว #${order.queueNo}${change != null ? ` · เงินทอน ${money(change)}` : ''}`, 'success', 4000);
  syncNow({ silent: true });
}

/* ==========================================================================
   14. HISTORY, SALES SUMMARY & VOID
   ========================================================================== */

let histDate = todayKey();
let histScope = 'local'; // 'local' | 'all'
let histLoading = false;
let histTab = 'bills'; // 'bills' | 'report' | 'shift'

function openHistory(tab) {
  histDate = todayKey();
  if (tab) histTab = tab;
  renderHistory();
  openModal('m-history');
  if (histScope === 'all' && histTab === 'bills') loadRemoteOrders();
}

/** Sheet row → order-like object for display (read-only) */
function normalizeRemoteOrder(r) {
  const label = r.Payment_Method || '';
  const pm = state.catalog.payMethods.find((m) => m.id === r.Payment_Key) || state.catalog.payMethods.find((m) => m.label === label);
  return {
    id: String(r.Order_ID || ''),
    remote: true,
    queueNo: String(r.Queue_No || ''),
    status: r.Status === 'VOIDED' ? 'VOIDED' : 'COMPLETED',
    date: String(r.Date || ''),
    createdAtTH: String(r.Date_Time || ''),
    createdAtISO: String(r.Timestamp_ISO || ''),
    itemsDetail: String(r.Items_Detail || ''),
    note: String(r.Order_Note || ''),
    items: null,
    subtotal: num(r.Subtotal),
    promoDiscount: num(r.Promo_Discount),
    itemDiscount: num(r.Item_Discount),
    pointsDiscount: num(r.Points_Discount),
    manualDiscount: num(r.Manual_Discount),
    totalDiscount: num(r.Total_Discount),
    net: num(r.Net_Total),
    totalCost: num(r.Total_Cost),
    staff: r.Staff ? { name: String(r.Staff) } : null,
    payment: {
      method: r.Payment_Key || (pm ? pm.id : 'cash'),
      label,
      cashReceived: r.Cash_Received === '' || r.Cash_Received == null ? null : num(r.Cash_Received),
      change: r.Change === '' || r.Change == null ? null : num(r.Change),
    },
    device: String(r.Device || ''),
    voidedAtTH: String(r.Voided_At || ''),
    voidReason: String(r.Void_Reason || ''),
    synced: true,
    voidSynced: true,
  };
}

async function loadRemoteOrders() {
  const url = (state.settings.gasUrl || '').trim();
  if (!url || !navigator.onLine) return;
  const date = histDate;
  histLoading = true;
  renderHistory();
  try {
    const res = await postToSheet(url, { source: 'ipad-pos', device: state.settings.devicePrefix, actions: [{ qid: 'pull-orders', action: 'PULL_ORDERS', data: { date } }] }, { needResponse: true });
    const r = res.results && res.results[0];
    if (!r || !r.ok) throw new Error((r && r.error) || 'PULL_ORDERS failed');
    state.remoteOrders = { [date]: (r.result.orders || []).map(normalizeRemoteOrder) };
    save.remote();
  } catch (e) {
    toast(`ดึงบิลจาก Cloud ไม่สำเร็จ: ${e.message}`, 'error', 4000);
  } finally {
    histLoading = false;
    if (isOpen('m-history')) renderHistory();
  }
}

function ordersForHistory() {
  const local = state.orders.filter((o) => o.date === histDate);
  if (histScope !== 'all') return local;
  const ids = new Set(local.map((o) => o.id));
  const remote = (state.remoteOrders[histDate] || []).filter((o) => !ids.has(o.id));
  return local.concat(remote);
}

function orderSyncPill(o) {
  if (o.remote) return `<span class="pill pill-mute">${esc(o.device || 'Cloud')}</span>`;
  if (o.status === 'VOIDED') {
    return o.voidSynced ? '<span class="pill pill-ok">VOID ✓ Synced</span>' : '<span class="pill pill-wait">VOID รอ Sync</span>';
  }
  return o.synced ? '<span class="pill pill-ok">✓ Synced</span>' : '<span class="pill pill-wait">รอ Sync</span>';
}

function renderHistory() {
  const modal = $('#m-history');
  const tabs = [['bills', 'ประวัติบิล', 'receipt'], ['report', 'วิเคราะห์ยอดขาย & กำไร', 'chart'], ['shift', 'กะ & ลิ้นชักเงินสด', 'cash']];
  const head = `
    <div class="mgr-tabs">
      ${tabs.map(([id, label, ic]) => `<button class="mgr-tab ${histTab === id ? 'on' : ''}" data-htab="${id}" type="button">${svg(ic, 18)} ${label}</button>`).join('')}
    </div>`;
  if (histTab === 'report') return paint(modal.querySelector('.modal-body'), head + reportHTML());
  if (histTab === 'shift') return paint(modal.querySelector('.modal-body'), head + shiftHistoryHTML());

  const orders = ordersForHistory().sort((a, b) => ((a.createdAtISO || '') < (b.createdAtISO || '') ? 1 : -1));
  const done = orders.filter((o) => o.status !== 'VOIDED');
  const voided = orders.length - done.length;
  const sum = (arr, f) => round2(arr.reduce((s, o) => s + f(o), 0));
  const methodIds = [...new Set(payMethods(false).map((m) => m.id).concat(done.map((o) => o.payment.method)))];
  const methodStats = methodIds.map((id) => {
    const list = done.filter((o) => o.payment.method === id);
    const pm = payMethod(id);
    return { id, label: pm ? pm.label : (list[0] && list[0].payment.label) || id, total: sum(list, (o) => o.net), n: list.length, active: pm ? pm.active : false };
  }).filter((x) => x.n || x.active);

  const sold = {};
  let freeG = 0;
  for (const o of done) {
    if (o.remote) continue;
    mergeNeeds(sold, o.stockDeduction || {});
    for (const i of o.items) freeG += i.freeG || 0;
  }
  const soldRows = Object.keys(sold).map((k) =>
    `<div><span>${esc(poolName(k))}</span><b>${fmtNum(sold[k])} ${poolUnit(k)}</b></div>`).join('');
  const hasUrl = !!(state.settings.gasUrl || '').trim();

  const rows = orders.map((o) => {
    const itemsHtml = o.items
      ? o.items.map((i) => `<div><b>${esc(i.name)}</b> — ${esc(i.detail)}${i.note ? ` <span class="cl-note-inline">📝 ${esc(i.note)}</span>` : ''}</div>`).join('')
      : o.itemsDetail.split(' | ').map((s) => `<div>${esc(s)}</div>`).join('');
    const [d, t] = (o.createdAtTH || ' ').split(' ');
    const otherDisc = round2((o.pointsDiscount || 0) + (o.manualDiscount || 0));
    return `
    <tr class="${o.status === 'VOIDED' ? 'voided' : ''}">
      <td class="oid">${o.queueNo ? `<span class="qno">#${esc(o.queueNo)}</span>` : ''}${esc(o.id)}${o.staff && o.staff.name ? `<div class="help" style="margin:0">👤 ${esc(o.staff.name)}</div>` : ''}</td>
      <td class="nowrap">${esc(d)}<div class="help" style="margin:0">${esc(t || '')}</div></td>
      <td class="items-cell">${itemsHtml}${o.note ? `<div class="cl-note-inline">📝 ${esc(o.note)}</div>` : ''}${o.customer && o.customer.phone ? `<div class="help" style="margin:0">สมาชิก ${esc(o.customer.name || fmtPhone(o.customer.phone))}${o.customer.earned ? ` · +${o.customer.earned} แต้ม` : ''}</div>` : ''}</td>
      <td class="num strike">${money(o.subtotal)}</td>
      <td class="num strike">${negMoney(o.promoDiscount + o.itemDiscount)}${o.itemDiscount ? `<div class="help">รวมลดรายการ ${money(o.itemDiscount)}</div>` : ''}</td>
      <td class="num strike">${negMoney(otherDisc)}${o.pointsDiscount ? `<div class="help">แต้ม ${money(o.pointsDiscount)}</div>` : ''}</td>
      <td class="num strike"><b>${money(o.net)}</b></td>
      <td>${esc(o.payment.label)}${o.payment.cashReceived != null ? `<div class="help">รับ ${money(o.payment.cashReceived)}<br/>ทอน ${money(o.payment.change)}</div>` : ''}</td>
      <td>${orderSyncPill(o)}</td>
      <td>${o.status === 'VOIDED'
        ? `<span class="pill pill-void">ยกเลิกบิล</span><div class="help">${esc(o.voidedAtTH)}${o.voidReason ? `<br/>${esc(o.voidReason)}` : ''}</div>`
        : `<span class="pill pill-ok">ปกติ</span>${o.remote ? `<div class="help">ยกเลิกได้ที่เครื่อง ${esc(o.device)}</div>` : `
          <div class="row" style="margin-top:8px;gap:6px">
            <button class="btn btn-outline btn-sm" data-receipt="${esc(o.id)}" type="button">${svg('printer', 16)} ใบเสร็จ</button>
            <button class="btn btn-danger btn-sm" data-void="${esc(o.id)}" type="button">${can('void') ? '' : '🔒 '}ยกเลิกบิล</button>
          </div>`}`}</td>
    </tr>`;
  }).join('');

  paint(modal.querySelector('.modal-body'), `${head}
    <div class="hist-toolbar">
      <button class="icon-btn" data-day="-1" type="button" aria-label="วันก่อนหน้า">${svg('left')}</button>
      <input class="input" id="histDate" type="date" value="${histDate}" max="${todayKey()}" />
      <button class="icon-btn" data-day="1" type="button" aria-label="วันถัดไป" ${histDate >= todayKey() ? 'disabled' : ''}>${svg('right')}</button>
      <button class="btn btn-outline" data-day="today" type="button">วันนี้</button>
      <div class="seg">
        <button class="${histScope === 'local' ? 'on' : ''}" data-scope="local" type="button">เครื่องนี้</button>
        <button class="${histScope === 'all' ? 'on' : ''}" data-scope="all" type="button" ${hasUrl ? '' : 'disabled'}>ทุกเครื่อง (Cloud)</button>
      </div>
      <span class="grow"></span>
      <span class="help">${histLoading ? 'กำลังดึงบิลจาก Cloud…' : `วันที่ <b>${fmtDateKeyTH(histDate)}</b> · ไม่รวมบิลที่ยกเลิก`}</span>
    </div>

    <div class="stat-grid">
      <div class="stat primary span2"><div class="k">ยอดขายสุทธิรวม${histScope === 'all' ? ' (ทุกเครื่อง)' : ''}</div><div class="v">${money(sum(done, (o) => o.net))}</div><div class="s">${done.length} บิลสำเร็จ${voided ? ` · ยกเลิก ${voided} บิล` : ''}</div></div>
      ${methodStats.map((m) => `<div class="stat"><div class="k">${esc(m.label)}</div><div class="v">${money(m.total)}</div><div class="s">${m.n} บิล</div></div>`).join('')}
      <div class="stat"><div class="k">ส่วนลดรวมทั้งหมด</div><div class="v">${money(sum(done, (o) => o.totalDiscount))}</div>
        <div class="s">โปร ${money(sum(done, (o) => o.promoDiscount))} · รายการ ${money(sum(done, (o) => o.itemDiscount))} · แต้ม ${money(sum(done, (o) => o.pointsDiscount || 0))} · เพิ่มเติม ${money(sum(done, (o) => o.manualDiscount))}</div></div>
    </div>

    ${soldRows ? `
      <details class="sold-summary">
        <summary>สรุปจำนวนสินค้าที่ตัดสต็อก (บิลสำเร็จของเครื่องนี้)${freeG ? ` · แถมรวม ${fmtNum(freeG)} ก.` : ''}</summary>
        <div class="sold-grid">${soldRows}</div>
      </details>` : ''}

    ${orders.length ? `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>
            <th>คิว / Order_ID</th><th>วันที่/เวลา</th><th>รายการ</th><th class="num">ยอดรวม</th><th class="num">ส่วนลดโปร</th>
            <th class="num">แต้ม/ลดเพิ่ม</th><th class="num">สุทธิ</th><th>ชำระโดย</th><th>Sync</th><th>สถานะ</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `<div class="empty-state">${svg('receipt', 48)}<p>ไม่มีบิลในวันที่เลือก</p></div>`}`);
}

async function voidOrder(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status === 'VOIDED') return;
  const who = await requirePerm('void', 'ยกเลิกบิล');
  if (!who) return;
  const restore = Object.keys(o.stockDeduction || {}).map((k) => `${poolName(k)} +${fmtNum(o.stockDeduction[k])} ${poolUnit(k)}`);
  const r = await confirmDialog({
    title: `ยกเลิกบิล ${o.queueNo ? `คิว #${o.queueNo} · ` : ''}${o.id}`,
    html: `<p>ยอด <b>${money(o.net)}</b> (${esc(o.payment.label)}) จะถูกยกเลิกและไม่นับรวมในยอดขาย</p>
           <p class="help">สต็อกที่จะคืนกลับ: ${esc(restore.join(', ') || '-')}</p>
           ${o.customer && o.customer.phone ? `<p class="help">แต้มสมาชิกจะถูกคืน/หักกลับ (${o.customer.earned ? `-${o.customer.earned}` : '0'} / ${o.customer.redeemed ? `+${o.customer.redeemed}` : '0'})</p>` : ''}
           ${o.kitchenStatus === 'PENDING' ? '<p class="warn-box">ออเดอร์นี้ยังอยู่ในคิวหลังร้าน — จอ KDS จะแจ้งเตือนให้หยุดทำ</p>' : ''}`,
    okText: 'ยืนยันยกเลิกบิล',
    danger: true,
    input: { placeholder: 'เหตุผล (ไม่บังคับ)' },
  });
  if (!r.ok) return;
  const now = new Date();
  o.status = 'VOIDED';
  o.voidedAtISO = isoLocal(now);
  o.voidedAtTH = fmtDateTime(now);
  o.voidReason = r.value || '';
  o.voidedBy = who.name || '';
  o.voidSynced = false;
  for (const k in o.stockDeduction || {}) state.stock[k] = (state.stock[k] || 0) + o.stockDeduction[k];
  if (o.customer) applyCustomerOrder(o, -1);
  save.orders([o]);
  save.stock();
  enqueue('VOID_ORDER', o.id);
  renderAll();
  if (isOpen('m-history')) renderHistory();
  toast(`ยกเลิกบิล ${o.id} แล้ว · คืนสต็อกเรียบร้อย`, 'success', 3000);
  syncNow({ silent: true });
}

/* ==========================================================================
   15. MANAGER — MENU / CATEGORIES / PROMOTIONS / STOCK  (GrabMerchant-style)
   ========================================================================== */

const mgr = { tab: 'menu', catFilter: 'all' };
let imageTarget = null;

/** Persist catalog edits, refresh indexes, keep the cart valid and schedule a cloud push. */
function commitCatalog() {
  state.catalog.updatedAt = isoLocal(new Date());
  for (const p of state.catalog.pools) if (!(p.id in state.stock)) state.stock[p.id] = 0;
  save.catalog();
  save.stock();
  reindex();
  sanitizeCart();
  save.cart();
  markDirty('catalog');
  renderAll();
}

async function openManager(tab) {
  if (!(await requirePerm('manage', 'จัดการเมนู & สต็อก'))) return;
  if (tab) mgr.tab = tab;
  renderManager();
  openModal('m-manage');
}

function renderManager() {
  const tabs = [
    ['menu', 'เมนู', 'menu', state.catalog.items.length],
    ['cats', 'หมวดหมู่', 'folder', state.catalog.categories.length],
    ['promos', 'โปรโมชั่น', 'tag', state.catalog.promos.length],
    ['stock', 'สต็อก', 'box', state.catalog.pools.length],
    ['log', 'ประวัติสต็อก', 'list', ''],
    ['shop', 'ตัวเลือกร้าน', 'sliders', ''],
  ];
  const body = $('#m-manage .modal-body');
  const views = { cats: mgrCatsHTML, promos: mgrPromosHTML, stock: mgrStockHTML, log: mgrStockLogHTML, shop: mgrShopHTML };
  const content = (views[mgr.tab] || mgrMenuHTML)();
  paint(body, `
    <div class="mgr-tabs">
      ${tabs.map(([id, label, ic, n]) => `<button class="mgr-tab ${mgr.tab === id ? 'on' : ''}" data-mtab="${id}" type="button">${svg(ic, 18)} ${label}${n === '' ? '' : `<span class="cnt">${n}</span>`}</button>`).join('')}
    </div>
    <div class="mgr-content">${content}</div>`);
  $('#m-manage .foot-note').textContent = (state.settings.gasUrl || '').trim() && state.settings.autoPush
    ? (hasStateChanges() ? 'มีการเปลี่ยนแปลงรอส่งขึ้น Cloud…' : 'ข้อมูลตรงกับ Cloud ✓')
    : 'บันทึกในเครื่องอัตโนมัติ';
}

/* ---------- Menu tab ---------- */
function itemMetaText(it) {
  const parts = [MODES[it.mode].label];
  if (it.mode === 'unit') parts.push(money(it.price));
  if (it.mode === 'weight') parts.push(`${money(it.pricePerGram)}/กรัม · ขั้นต่ำ ${it.minGrams} ก.`);
  if (it.mode === 'set') parts.push(`${money(it.price)} · ${it.optionGroups.length} กลุ่มตัวเลือก`);
  const ps = state.catalog.promos.filter((p) => p.active && promoTouches(p, it));
  if (ps.length) parts.push(`โปร: ${ps.map((p) => p.name).join(', ')}`);
  if (it.cost) parts.push(`ต้นทุนเพิ่ม ${money(it.cost)}`);
  return parts.join(' · ');
}
function itemStockText(it) {
  if (it.mode === 'set') {
    const sets = setCapacity(it, (p) => (p ? state.stock[p] || 0 : Infinity));
    return isFinite(sets) ? `${sets} เซ็ต` : 'ไม่ตัดสต็อก';
  }
  if (!it.stockPool) return 'ไม่ตัดสต็อก';
  return `${fmtNum(state.stock[it.stockPool] || 0)} ${poolUnit(it.stockPool)}${it.stockPool !== it.id ? ' (ใช้ร่วม)' : ''}`;
}

function mgrMenuHTML() {
  const cats = state.catalog.categories;
  const shown = mgr.catFilter === 'all' ? cats : cats.filter((c) => c.id === mgr.catFilter);
  return `
    <div class="mgr-toolbar">
      <div class="chips">
        <button class="fchip ${mgr.catFilter === 'all' ? 'on' : ''}" data-mcat="all" type="button">ทั้งหมด</button>
        ${cats.map((c) => `<button class="fchip ${mgr.catFilter === c.id ? 'on' : ''}" data-mcat="${esc(c.id)}" type="button">${esc(c.name)}</button>`).join('')}
      </div>
      <button class="btn btn-primary" data-act="item-new" type="button">${svg('plus', 18)} เพิ่มเมนูใหม่</button>
    </div>
    ${shown.map((c) => {
      const items = state.catalog.items.filter((it) => it.categoryId === c.id);
      return `
        <div class="mgr-cat">
          <div class="mgr-cat-title">${esc(c.name)} <small>${items.length} รายการ${c.hidden ? ' · หมวดนี้ซ่อนอยู่' : ''}</small></div>
          ${items.length ? items.map((it) => {
            const av = itemAvailability(it);
            const raw = it.availability === 'soldout' && it.soldOutDate !== todayKey() ? 'normal' : it.availability;
            return `
            <div class="mgr-item ${av !== 'normal' ? 'is-off' : ''}">
              <button class="mgr-thumb" data-act="item-edit" data-id="${esc(it.id)}" type="button">${state.images[it.id] ? `<img src="${state.images[it.id]}" alt="" />` : svg('image', 26)}</button>
              <div class="mgr-info">
                <div class="mgr-name">${esc(it.name)}</div>
                <div class="mgr-meta">${esc(itemMetaText(it))}</div>
                <div class="mgr-meta">สต็อก: <b>${esc(itemStockText(it))}</b></div>
              </div>
              <div class="seg seg-avail">
                ${Object.keys(AVAIL).map((k) => `<button class="${raw === k ? `on ${k}` : ''}" data-act="avail" data-id="${esc(it.id)}" data-v="${k}" type="button">${k === 'normal' ? 'เปิดขาย' : k === 'soldout' ? 'หมดวันนี้' : 'ซ่อน'}</button>`).join('')}
              </div>
              <button class="btn btn-outline btn-sm" data-act="item-edit" data-id="${esc(it.id)}" type="button">${svg('edit', 16)} แก้ไข</button>
            </div>`;
          }).join('') : '<div class="help" style="padding:8px 4px">ยังไม่มีเมนูในหมวดนี้</div>'}
        </div>`;
    }).join('')}`;
}

function setAvailability(id, v) {
  const it = IDX.item[id];
  if (!it) return;
  it.availability = v;
  it.soldOutDate = v === 'soldout' ? todayKey() : '';
  commitCatalog();
  renderManager();
  toast(`${it.name}: ${AVAIL[v]}`, '', 1600);
}

/* ---------- Categories tab ---------- */
function mgrCatsHTML() {
  const cats = state.catalog.categories;
  return `
    <p class="help" style="margin:0 0 12px">ลำดับหมวดหมู่ = ลำดับแท็บบนหน้าขาย · “ส่งเข้าครัว” = รายการในหมวดนี้จะขึ้นจอจัดออเดอร์ (KDS) · ตั้งโปรของหมวดได้ที่แท็บ “โปรโมชั่น”</p>
    ${cats.map((c, i) => {
      const n = state.catalog.items.filter((it) => it.categoryId === c.id).length;
      return `
      <div class="mgr-row ${c.hidden ? 'is-off' : ''}">
        <div class="mgr-order">
          <button class="icon-btn sm" data-act="cat-up" data-id="${esc(c.id)}" type="button" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">${svg('up', 18)}</button>
          <button class="icon-btn sm" data-act="cat-down" data-id="${esc(c.id)}" type="button" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">${svg('down', 18)}</button>
        </div>
        <div class="grow">
          <input class="input" data-catname="${esc(c.id)}" type="text" value="${esc(c.name)}" />
          <div class="help">${n} เมนู</div>
        </div>
        <button class="btn ${c.kitchen ? 'btn-outline' : 'btn-ghost'}" data-act="cat-kitchen" data-id="${esc(c.id)}" type="button">${c.kitchen ? '🍳 ส่งเข้าครัว' : 'ไม่ส่งเข้าครัว'}</button>
        <button class="btn ${c.hidden ? 'btn-outline' : 'btn-ghost'}" data-act="cat-toggle" data-id="${esc(c.id)}" type="button">${svg(c.hidden ? 'eyeoff' : 'eye', 18)} ${c.hidden ? 'ซ่อนอยู่' : 'แสดง'}</button>
        <button class="icon-btn danger" data-act="cat-del" data-id="${esc(c.id)}" type="button" aria-label="ลบหมวด">${svg('trash')}</button>
      </div>`;
    }).join('')}
    <div class="mgr-add">
      <input class="input grow" id="newCatName" type="text" placeholder="ชื่อหมวดหมู่ใหม่ เช่น เครื่องดื่ม" />
      <button class="btn btn-primary" data-act="cat-add" type="button">${svg('plus', 18)} เพิ่มหมวดหมู่</button>
    </div>`;
}

async function catAction(act, id) {
  const cats = state.catalog.categories;
  const i = cats.findIndex((c) => c.id === id);
  if (act === 'cat-add') {
    const name = ($('#newCatName').value || '').trim();
    if (!name) return toast('กรุณาใส่ชื่อหมวดหมู่', 'warn');
    cats.push({ id: `c_${uid()}`, name, hidden: false, kitchen: true });
  } else if (i < 0) {
    return;
  } else if (act === 'cat-up' && i > 0) {
    [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
  } else if (act === 'cat-down' && i < cats.length - 1) {
    [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
  } else if (act === 'cat-toggle') {
    cats[i].hidden = !cats[i].hidden;
  } else if (act === 'cat-kitchen') {
    cats[i].kitchen = !cats[i].kitchen;
  } else if (act === 'cat-del') {
    const n = state.catalog.items.filter((it) => it.categoryId === id).length;
    if (n) return toast(`ย้ายหรือลบเมนูในหมวดนี้ก่อน (${n} เมนู)`, 'warn', 3500);
    if (cats.length <= 1) return toast('ต้องมีอย่างน้อย 1 หมวดหมู่', 'warn');
    const r = await confirmDialog({ title: 'ลบหมวดหมู่', html: `ลบหมวด <b>${esc(cats[i].name)}</b> ?`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    cats.splice(i, 1);
  }
  commitCatalog();
  renderManager();
}

/* ---------- Stock tab ---------- */
function mgrStockHTML() {
  const seen = new Set();
  const groups = state.catalog.categories.map((c) => {
    const pools = [];
    for (const it of state.catalog.items.filter((x) => x.categoryId === c.id)) {
      const ids = [it.stockPool, ...it.baseConsumes.map((b) => b.pool), ...it.optionGroups.flatMap((g) => g.options.map((o) => o.pool))];
      for (const id of ids) if (id && IDX.pool[id] && !seen.has(id)) { seen.add(id); pools.push(id); }
    }
    return { title: c.name, pools };
  }).filter((g) => g.pools.length);
  const orphans = state.catalog.pools.map((p) => p.id).filter((id) => !seen.has(id));
  if (orphans.length) groups.push({ title: 'Stock Pool ที่ยังไม่ผูกกับเมนู', pools: orphans });
  const locked = !can('stock');

  const row = (id) => {
    const p = IDX.pool[id];
    const refs = poolRefs(id);
    const quick = p.unit === 'g' ? [[-100, '-100g'], [100, '+100g'], [500, '+500g']] : [[-1, '-1'], [5, '+5'], [10, '+10']];
    const thumbId = refs.length && refs[0].stockPool === id ? refs[0].id : '';
    const img = thumbId && state.images[thumbId];
    const low = refs.some((it) => it.mode !== 'set' && it.stockPool === id && (state.stock[id] || 0) <= lowPoint(it));
    return `
      <div class="stock-row ${low ? 'is-low' : ''}" data-row="${esc(id)}">
        <div class="stock-thumb ${img ? '' : 'none'}">${img ? `<img src="${img}" alt="" />` : svg('box', 26)}</div>
        <div>
          <input class="input pool-name" data-poolname="${esc(id)}" type="text" value="${esc(p.name)}" ${locked ? 'readonly' : ''} />
          <div class="stock-meta">หน่วย: ${esc(unitLabel(p.unit))} · ใช้กับ: ${refs.length ? esc(refs.map((r) => r.name).join(', ')) : '—'}${low ? ' · <b style="color:var(--warn)">ใกล้หมด</b>' : ''}</div>
          <label class="stock-meta cost-in">ต้นทุน ฿<input class="input" data-poolcost="${esc(id)}" type="number" inputmode="decimal" min="0" step="0.01" value="${p.cost || ''}" placeholder="0" ${locked ? 'readonly' : ''} /> / ${esc(unitLabel(p.unit))}</label>
        </div>
        <div class="stock-input-wrap">
          <input class="stock-input ${state.stock[id] <= 0 ? 'zero' : ''}" data-stock="${esc(id)}" type="number" inputmode="numeric" min="0" step="1" value="${state.stock[id] || 0}" ${locked ? 'readonly' : ''} />
          <span class="stock-unit">${esc(unitLabel(p.unit))}</span>
        </div>
        <div class="quick-add">
          ${quick.map(([n, label]) => `<button class="${n < 0 ? 'minus' : ''}" data-quick="${esc(id)}" data-n="${n}" type="button">${label}</button>`).join('')}
          <button class="adj" data-act="pool-adjust" data-id="${esc(id)}" type="button">ปรับ / ของเสีย</button>
          ${refs.length ? '' : `<button class="minus" data-act="pool-del" data-id="${esc(id)}" type="button" aria-label="ลบ">${svg('trash', 18)}</button>`}
        </div>
      </div>`;
  };
  return `
    ${locked ? '<div class="warn-box" style="margin:0 0 12px">🔒 การปรับสต็อกต้องใช้ PIN เจ้าของร้าน — กดปุ่มปรับแล้วระบบจะขอ PIN</div>' : ''}
    <p class="help" style="margin:0 0 12px">ทุกการปรับสต็อกถูกบันทึกในแท็บ “ประวัติสต็อก” พร้อมเหตุผล (เติมสต็อก / ของเสีย / แจกฟรี …) และส่งขึ้นชีต Stock_Log · ใส่ต้นทุนต่อหน่วยเพื่อดูกำไรในหน้ารายงาน</p>
    ${groups.map((g) => `<div class="stock-group"><h3>${esc(g.title)}</h3>${g.pools.map(row).join('')}</div>`).join('')}
    <div class="stock-group">
      <h3>เพิ่ม Stock Pool ใช้ร่วม <small>เช่น วัตถุดิบที่หลายเมนูใช้ร่วมกัน (ไอศกรีม, คุกกี้ในเซ็ต)</small></h3>
      <div class="mgr-add">
        <input class="input grow" id="newPoolName" type="text" placeholder="ชื่อ Stock Pool เช่น ไอศกรีมช็อกโกแลต" />
        <select class="input" id="newPoolUnit" style="width:140px">${state.catalog.units.map((u) => `<option value="${esc(u.id)}">${esc(u.label)}</option>`).join('')}</select>
        <button class="btn btn-primary" data-act="pool-add" type="button">${svg('plus', 18)} เพิ่ม</button>
      </div>
    </div>`;
}

/**
 * Change a stock pool and write a stock-log entry.
 * reason: id from catalog.stockReasons ('count' = set exact amount). Requires the "stock" permission.
 */
async function setStock(key, value, { flash = true, reason = 'count', note = '' } = {}) {
  const who = await requirePerm('stock', 'ปรับสต็อก');
  const row = $$('#m-manage [data-row]').find((r) => r.dataset.row === key);
  if (!who) {
    if (row) row.querySelector('.stock-input').value = state.stock[key] || 0;
    return false;
  }
  const before = state.stock[key] || 0;
  state.stock[key] = toInt(value);
  save.stock();
  markDirty('stock', key);
  if (state.stock[key] !== before) logStock(key, before, state.stock[key], reason, note, who);
  if (row) {
    const input = row.querySelector('.stock-input');
    if (document.activeElement !== input) input.value = state.stock[key];
    input.classList.toggle('zero', state.stock[key] <= 0);
    if (flash) { row.classList.remove('flash-ok'); void row.offsetWidth; row.classList.add('flash-ok'); }
  }
  renderMenu();
  renderCart();
  return true;
}

async function poolAction(act, id) {
  if (act === 'pool-adjust') return openStockAdjust(id);
  if (act === 'pool-add') {
    const name = ($('#newPoolName').value || '').trim();
    if (!name) return toast('กรุณาใส่ชื่อ Stock Pool', 'warn');
    const pid = `pool_${uid()}`;
    state.catalog.pools.push({ id: pid, name, unit: $('#newPoolUnit').value || 'pcs', cost: 0 });
    state.stock[pid] = 0;
  } else if (act === 'pool-del') {
    if (poolRefs(id).length) return toast('Pool นี้ยังถูกใช้อยู่', 'warn');
    const r = await confirmDialog({ title: 'ลบ Stock Pool', html: `ลบ <b>${esc(poolName(id))}</b> (คงเหลือ ${fmtNum(state.stock[id] || 0)}) ?`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    state.catalog.pools = state.catalog.pools.filter((p) => p.id !== id);
    delete state.stock[id];
  }
  commitCatalog();
  renderManager();
}

/* ---------- Item editor (add / edit / delete menu) ---------- */
let ed = null;

function newItemDraft() {
  const cat = mgr.catFilter !== 'all' && IDX.cat[mgr.catFilter] ? mgr.catFilter : state.catalog.categories[0].id;
  return Object.assign(normalizeItem({ id: `m_${uid()}`, categoryId: cat, mode: 'unit', price: 0 }), { name: '' });
}

function openItemEditor(id) {
  const src = id ? IDX.item[id] : newItemDraft();
  const draft = clone(src);
  draft._bind = id ? (draft.stockPool && draft.stockPool === draft.id ? '__own__' : draft.stockPool) : '__own__';
  ed = { draft, isNew: !id, image: undefined };
  renderItemEditor();
  openModal('m-item');
}

function poolSelect(path, value) {
  return `<select class="input" data-bind="${path}">
    <option value="" ${!value ? 'selected' : ''}>— ไม่ตัดสต็อก —</option>
    ${state.catalog.pools.map((p) => `<option value="${esc(p.id)}" ${value === p.id ? 'selected' : ''}>${esc(p.name)} (${esc(unitLabel(p.unit))})</option>`).join('')}
  </select>`;
}

function renderItemEditor() {
  const d = ed.draft;
  const img = ed.image !== undefined ? ed.image : state.images[d.id];
  const promosHere = state.catalog.promos.filter((p) => promoTouches(p, d));
  const isUnitPool = (p) => p.unit !== 'g' && p.id !== d.id;
  const isGramPool = (p) => p.unit === 'g' && p.id !== d.id;
  const ownExists = !ed.isNew && IDX.pool[d.id];
  const ownLabel = ownExists ? `สต็อกของเมนูนี้เอง (คงเหลือ ${fmtNum(state.stock[d.id] || 0)})` : 'สร้างสต็อกของเมนูนี้เอง';
  const bindSelect = (filter) => `
    <select class="input" data-bind="_bind">
      <option value="__own__" ${d._bind === '__own__' ? 'selected' : ''}>${esc(ownLabel)}</option>
      <option value="" ${d._bind === '' ? 'selected' : ''}>— ไม่ตัดสต็อก (ขายได้ไม่จำกัด) —</option>
      <optgroup label="ใช้ Stock Pool ร่วม">
        ${state.catalog.pools.filter(filter).map((p) => `<option value="${esc(p.id)}" ${d._bind === p.id ? 'selected' : ''}>${esc(p.name)} (${esc(unitLabel(p.unit))})</option>`).join('')}
      </optgroup>
    </select>`;

  let modeHtml = '';
  if (d.mode === 'unit') {
    modeHtml = `
      <div class="ed-row">
        <label class="ed-field"><span>ราคาต่อชิ้น (บาท)</span><input class="input" data-bind="price" type="number" inputmode="decimal" min="0" value="${esc(d.price)}" /></label>
        <label class="ed-field"><span>การผูกสต็อก</span>${bindSelect(isUnitPool)}</label>
      </div>
`;
  } else if (d.mode === 'weight') {
    modeHtml = `
      <div class="ed-row">
        <label class="ed-field"><span>ราคาต่อกรัม (บาท)</span><input class="input" data-bind="pricePerGram" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(d.pricePerGram)}" /></label>
        <label class="ed-field"><span>ขั้นต่ำ (กรัม)</span><input class="input" data-bind="minGrams" type="number" inputmode="numeric" min="1" value="${esc(d.minGrams)}" /></label>
      </div>
      <label class="ed-field"><span>การผูกสต็อก (กรัม)</span>${bindSelect(isGramPool)}</label>
      <p class="help">ตอนขายจะมีหน้าต่างให้ใส่ น้ำหนักที่ขาย · น้ำหนักที่แถม · ส่วนลดเฉพาะรายการ (เหมือนซีเรียลคุกกี้)</p>`;
  } else {
    modeHtml = `
      <label class="ed-field"><span>ราคาเซ็ต (บาท)</span><input class="input" data-bind="price" type="number" inputmode="decimal" min="0" value="${esc(d.price)}" /></label>
      <div class="ed-sub">
        <div class="ed-sub-title">สต็อกที่ตัดทุกครั้งต่อ 1 เซ็ต</div>
        ${d.baseConsumes.map((b, i) => `
          <div class="opt-row">
            ${poolSelect(`baseConsumes.${i}.pool`, b.pool)}
            <label class="opt-qty"><span>× จำนวน</span><input class="input" data-bind="baseConsumes.${i}.qty" type="number" inputmode="numeric" min="1" value="${esc(b.qty)}" /></label>
            <button class="icon-btn danger" data-ed="base-del" data-i="${i}" type="button" aria-label="ลบ">${svg('trash', 18)}</button>
          </div>`).join('') || '<div class="help">ยังไม่มี (เช่น คุกกี้ 1 ชิ้นต่อเซ็ต)</div>'}
        <button class="btn btn-ghost btn-sm" data-ed="base-add" type="button">${svg('plus', 16)} เพิ่มสต็อกที่ตัดต่อเซ็ต</button>
      </div>
      ${d.optionGroups.map((g, gi) => `
        <div class="ed-sub group-card">
          <div class="opt-row">
            <input class="input grow" data-bind="optionGroups.${gi}.name" type="text" value="${esc(g.name)}" placeholder="ชื่อกลุ่ม เช่น เลือกไอศกรีม" />
            <select class="input" data-bind="optionGroups.${gi}.type" style="width:230px">
              <option value="pick1" ${g.type === 'pick1' ? 'selected' : ''}>บังคับเลือก 1 อย่าง</option>
              <option value="stepper" ${g.type === 'stepper' ? 'selected' : ''}>Add-on (ไม่บังคับ, กด +/-)</option>
            </select>
            <button class="icon-btn danger" data-ed="group-del" data-g="${gi}" type="button" aria-label="ลบกลุ่ม">${svg('trash', 18)}</button>
          </div>
          <div class="opt-head"><span>ตัวเลือก</span><span>+ราคา</span><span>ตัดสต็อกจาก</span><span>× จำนวน</span><span></span></div>
          ${g.options.map((o, oi) => `
            <div class="opt-grid">
              <input class="input" data-bind="optionGroups.${gi}.options.${oi}.name" type="text" value="${esc(o.name)}" placeholder="ชื่อตัวเลือก" />
              <input class="input" data-bind="optionGroups.${gi}.options.${oi}.price" type="number" inputmode="decimal" min="0" value="${esc(o.price)}" />
              ${poolSelect(`optionGroups.${gi}.options.${oi}.pool`, o.pool)}
              <input class="input" data-bind="optionGroups.${gi}.options.${oi}.qty" type="number" inputmode="numeric" min="1" value="${esc(o.qty)}" />
              <button class="icon-btn danger" data-ed="opt-del" data-g="${gi}" data-o="${oi}" type="button" aria-label="ลบตัวเลือก">${svg('trash', 18)}</button>
            </div>`).join('')}
          <button class="btn btn-ghost btn-sm" data-ed="opt-add" data-g="${gi}" type="button">${svg('plus', 16)} เพิ่มตัวเลือก</button>
        </div>`).join('')}
      <div class="row">
        <button class="btn btn-outline btn-sm" data-ed="group-add" data-type="pick1" type="button">${svg('plus', 16)} กลุ่มบังคับเลือก 1</button>
        <button class="btn btn-outline btn-sm" data-ed="group-add" data-type="stepper" type="button">${svg('plus', 16)} กลุ่ม Add-on</button>
      </div>`;
  }

  const raw = d.availability === 'soldout' && d.soldOutDate !== todayKey() ? 'normal' : d.availability;
  const modal = $('#m-item');
  modal.querySelector('.modal-title').textContent = ed.isNew ? 'เพิ่มเมนูใหม่' : `แก้ไขเมนู: ${d.name}`;
  paint(modal.querySelector('.modal-body'), `
    <div class="ed-grid">
      <div class="ed-left">
        <div class="ed-photo">${img ? `<img src="${img}" alt="" />` : `${svg('image', 44)}<span>ยังไม่มีรูป</span>`}</div>
        <button class="btn btn-outline btn-block" data-ed="img" type="button">${svg('upload', 18)} ${img ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</button>
        ${img ? `<button class="btn btn-ghost btn-block" data-ed="img-del" type="button" style="color:var(--danger);margin-top:6px">ลบรูป</button>` : ''}
        <p class="help">ย่ออัตโนมัติเป็น ${IMG_SIZE}×${IMG_SIZE} JPEG (≈ 25 KB) เพื่อซิงก์ขึ้น Google Sheets ได้</p>
        <div class="ed-sub-title" style="margin-top:14px">สถานะการขาย</div>
        <div class="avail-list">
          ${Object.keys(AVAIL).map((k) => `<button class="avail-opt ${raw === k ? `on ${k}` : ''}" data-ed="avail" data-v="${k}" type="button">${AVAIL[k]}</button>`).join('')}
        </div>
      </div>
      <div class="ed-right">
        <label class="ed-field"><span>ชื่อเมนู *</span><input class="input" data-bind="name" type="text" value="${esc(d.name)}" placeholder="เช่น ซอฟต์คุกกี้ มัทฉะ" /></label>
        <div class="ed-row">
          <div class="ed-field"><span>หมวดหมู่</span>
            <div class="cat-pick">
              <select class="input" data-bind="categoryId">${state.catalog.categories.map((c) => `<option value="${esc(c.id)}" ${d.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              <button class="btn btn-outline" data-ed="cat-new" type="button">${svg('plus', 16)} หมวดใหม่</button>
            </div></div>
          <label class="ed-field"><span>ป้ายบนการ์ด (ไม่บังคับ)</span><input class="input" data-bind="tag" type="text" value="${esc(d.tag)}" placeholder="อัตโนมัติ เช่น 3 ชิ้น ฿100" /></label>
        </div>
        <div class="ed-sub-title">รูปแบบการขาย</div>
        <div class="mode-cards">
          ${Object.keys(MODES).map((k) => `<button class="mode-card ${d.mode === k ? 'on' : ''}" data-ed="mode" data-v="${k}" type="button"><b>${MODES[k].label}</b><small>${MODES[k].en}</small></button>`).join('')}
        </div>
        ${modeHtml}
        <div class="ed-row">
          <label class="ed-field"><span>ต้นทุนเพิ่มต่อ${d.mode === 'set' ? 'เซ็ต' : d.mode === 'weight' ? 'รายการ' : 'ชิ้น'} (กล่อง/ถุง ฯลฯ)</span><input class="input" data-bind="cost" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(d.cost || '')}" placeholder="0" /></label>
          <label class="ed-field"><span>แจ้งเตือนใกล้หมดเมื่อเหลือ ≤ (${d.mode === 'set' ? 'เซ็ต' : d.mode === 'weight' ? 'กรัม' : 'ชิ้น'})</span><input class="input" data-bind="lowAt" type="number" inputmode="numeric" min="0" value="${esc(d.lowAt)}" placeholder="ค่าเริ่มต้นร้าน: ${prefs().lowDefaults[d.mode]}" /></label>
        </div>
        <p class="help" style="margin-top:-6px">ต้นทุนวัตถุดิบตั้งที่แท็บ “สต็อก” (ต่อหน่วยของ Stock Pool) — ต้นทุนรวม = วัตถุดิบที่ตัด + ต้นทุนเพิ่มนี้</p>
        <div class="ed-sub-title">โปรโมชั่นที่ใช้กับเมนูนี้</div>
        <div class="help" style="margin:0 0 10px">${promosHere.length ? promosHere.map((p) => `• ${esc(p.name)}${p.active ? '' : ' (ปิดอยู่)'}`).join('<br/>') : 'ยังไม่มี'} — ตั้ง/แก้ได้ที่แท็บ “โปรโมชั่น”</div>
      </div>
    </div>`);
  modal.querySelector('.modal-foot').innerHTML = `
    ${ed.isNew ? '' : `<button class="btn btn-danger" data-ed="delete" type="button">${svg('trash', 18)} ลบเมนูนี้</button>`}
    <span class="grow"></span>
    <button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button>
    <button class="btn btn-primary btn-lg" data-ed="save" type="button">บันทึกเมนู</button>`;
}

function editorAction(act, el) {
  const d = ed.draft;
  const gi = Number(el.dataset.g);
  if (act === 'mode') {
    d.mode = el.dataset.v;
    if (d.mode === 'set') d._bind = '';
    else {
      const p = IDX.pool[d._bind];
      if (!d._bind || (p && (p.unit === 'g') !== (d.mode === 'weight'))) d._bind = '__own__';
    }
  } else if (act === 'avail') {
    d.availability = el.dataset.v;
    d.soldOutDate = el.dataset.v === 'soldout' ? todayKey() : '';
  } else if (act === 'base-add') d.baseConsumes.push({ pool: '', qty: 1 });
  else if (act === 'base-del') d.baseConsumes.splice(Number(el.dataset.i), 1);
  else if (act === 'group-add') {
    d.optionGroups.push({ id: `g_${uid()}`, name: el.dataset.type === 'pick1' ? 'เลือก 1 อย่าง' : 'Add-on เพิ่มเติม', type: el.dataset.type, options: [{ id: `o_${uid()}`, name: '', price: 0, pool: '', qty: 1 }] });
  } else if (act === 'group-del') d.optionGroups.splice(gi, 1);
  else if (act === 'opt-add') d.optionGroups[gi].options.push({ id: `o_${uid()}`, name: '', price: 0, pool: '', qty: 1 });
  else if (act === 'opt-del') d.optionGroups[gi].options.splice(Number(el.dataset.o), 1);
  else if (act === 'img') { imageTarget = '__editor__'; $('#imageInput').value = ''; $('#imageInput').click(); return; }
  else if (act === 'img-del') ed.image = null;
  else if (act === 'cat-new') { newCategoryFromEditor(); return; }
  else if (act === 'save') { saveItemEditor(); return; }
  else if (act === 'delete') { deleteItem(d.id); return; }
  renderItemEditor();
}

/** Create a category without leaving the item form, and select it for this item. */
async function newCategoryFromEditor() {
  const r = await confirmDialog({
    title: 'เพิ่มหมวดหมู่ใหม่',
    html: '<p class="help">หมวดจะแสดงเป็นแท็บบนหน้าขาย — เปลี่ยนชื่อ จัดลำดับ หรือซ่อนได้ภายหลังที่แท็บ “หมวดหมู่”</p>',
    okText: 'เพิ่มหมวดหมู่',
    input: { placeholder: 'ชื่อหมวดหมู่ เช่น เครื่องดื่ม' },
  });
  if (!r.ok) return;
  const name = (r.value || '').trim();
  if (!name) return toast('กรุณาใส่ชื่อหมวดหมู่', 'warn');
  const existing = state.catalog.categories.find((c) => c.name === name);
  const id = existing ? existing.id : `c_${uid()}`;
  if (!existing) state.catalog.categories.push({ id, name, hidden: false, kitchen: true });
  ed.draft.categoryId = id;
  commitCatalog();
  renderItemEditor();
  if (isOpen('m-manage')) renderManager();
  toast(existing ? `ใช้หมวด “${name}” ที่มีอยู่แล้ว` : `เพิ่มหมวด “${name}” แล้ว`, 'success', 1800);
}

async function saveItemEditor() {
  const d = ed.draft;
  if (!String(d.name).trim()) return toast('กรุณาใส่ชื่อเมนู', 'warn');
  if (d.mode === 'weight' && !(num(d.pricePerGram) > 0)) return toast('กรุณาใส่ราคาต่อกรัม', 'warn');
  if (d.mode === 'set') {
    d.baseConsumes = d.baseConsumes.filter((b) => b.pool);
    for (const g of d.optionGroups) {
      g.options = g.options.filter((o) => String(o.name).trim());
      if (!String(g.name).trim()) return toast('กรุณาตั้งชื่อกลุ่มตัวเลือกให้ครบ', 'warn');
      if (!g.options.length) return toast(`กลุ่ม “${g.name}” ต้องมีอย่างน้อย 1 ตัวเลือก`, 'warn');
    }
  }
  d.name = String(d.name).trim();
  const bind = d._bind;
  if (d.mode === 'set') d.stockPool = '';
  else if (bind === '__own__') {
    d.stockPool = d.id;
    const unit = d.mode === 'weight' ? 'g' : 'pcs';
    const own = IDX.pool[d.id];
    if (own) { own.name = d.name; own.unit = unit; } else state.catalog.pools.push({ id: d.id, name: d.name, unit });
  } else d.stockPool = bind || '';

  const item = normalizeItem(d);
  const items = state.catalog.items;
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = item; else items.push(item);

  if (ed.image !== undefined) {
    if (ed.image) {
      await ImageStore.put(item.id, ed.image);
      state.images[item.id] = ed.image;
      markDirty('image', item.id);
    } else if (state.images[item.id]) {
      await ImageStore.remove(item.id);
      delete state.images[item.id];
      markDirty('image', item.id);
    }
  }
  commitCatalog();
  closeModal('m-item');
  if (isOpen('m-manage')) renderManager();
  toast(`บันทึกเมนู “${item.name}” แล้ว`, 'success');
}

async function deleteItem(id) {
  const it = IDX.item[id];
  if (!it) return;
  const own = it.stockPool === id && IDX.pool[id];
  const r = await confirmDialog({
    title: 'ลบเมนู',
    html: `ลบเมนู <b>${esc(it.name)}</b> ออกจากหน้าขาย?${own ? `<p class="help">สต็อกของเมนูนี้ (${fmtNum(state.stock[id] || 0)} ${poolUnit(id)}) จะถูกลบด้วย</p>` : ''}<p class="help">ประวัติบิลเดิมไม่หาย</p>`,
    okText: 'ลบเมนู',
    danger: true,
  });
  if (!r.ok) return;
  state.catalog.items = state.catalog.items.filter((x) => x.id !== id);
  reindex();
  if (own && !poolRefs(id).length) {
    state.catalog.pools = state.catalog.pools.filter((p) => p.id !== id);
    delete state.stock[id];
  }
  if (state.images[id]) {
    await ImageStore.remove(id);
    delete state.images[id];
    markDirty('image', id);
  }
  commitCatalog();
  closeModal('m-item');
  if (isOpen('m-manage')) renderManager();
  toast('ลบเมนูแล้ว', 'success');
}

async function onImagePicked(file) {
  if (!file || !imageTarget) return;
  imageTarget = null;
  try {
    toast('กำลังย่อรูปภาพ…', '', 1200);
    const data = await compressImage(file);
    if (ed) { ed.image = data; renderItemEditor(); }
    toast(`ย่อรูปแล้ว ${Math.round(data.length * 0.75 / 1024)} KB — กด “บันทึกเมนู” เพื่อใช้รูปนี้`, 'success', 3000);
  } catch (e) {
    console.error(e);
    toast(e.message || 'อัปโหลดรูปไม่สำเร็จ', 'error', 4000);
  }
}

/* ==========================================================================
   16. GOOGLE SHEETS — ORDER QUEUE
   ========================================================================== */

/** Queue a write for Google Sheets. Order actions reference the order; others carry their own payload. */
function enqueue(action, orderId, payload, label) {
  const q = { qid: uid(), action, orderId: orderId || '', createdAt: isoLocal(new Date()), attempts: 0, lastError: '' };
  if (payload) { q.payload = payload; q.label = label || action; }
  state.queue.push(q);
  save.queue();
  renderHeader();
}

function orderSyncData(o) {
  const addOnText = (i) => (i.addOns ? i.addOns.map((a) => `${a.name} x${a.n}`).join(', ')
    : [i.addH ? `ไอศกรีมฮอกไกโด x${i.addH}` : '', i.addV ? `ไอศกรีมวนิลา x${i.addV}` : '', i.addC ? `คุกกี้ Gooey x${i.addC}` : ''].filter(Boolean).join(', '));
  return {
    orderId: o.id,
    status: o.status,
    date: o.date,
    dateTime: o.createdAtTH,
    timestampISO: o.createdAtISO,
    itemsDetail: o.items.map((i) => `${i.name} (${i.detail})`).join(' | '),
    subtotal: o.subtotal,
    promoDiscount: o.promoDiscount,
    promoDetail: (o.promos || []).map((p) => `${p.label} x${p.bundles} (-${p.discount})`).join(', '),
    itemDiscount: o.itemDiscount,
    manualDiscount: o.manualDiscount,
    totalDiscount: o.totalDiscount,
    netTotal: o.net,
    paymentMethod: o.payment.label,
    paymentKey: o.payment.method,
    cashReceived: o.payment.cashReceived == null ? '' : o.payment.cashReceived,
    change: o.payment.change == null ? '' : o.payment.change,
    device: o.device,
    voidedAt: o.voidedAtTH || '',
    voidReason: o.voidReason || '',
    voidedBy: o.voidedBy || '',
    stockDeduction: o.stockDeduction || {},
    queueNo: o.queueNo || '',
    orderNote: o.note || '',
    kitchenStatus: o.kitchenStatus || 'NONE',
    kitchenItems: o.kitchen ? JSON.stringify({ q: o.queueNo || '', t: o.createdAtISO, note: o.note || '', staff: o.staff ? o.staff.name : '', items: o.kitchen.items, prep: o.kitchen.prep }) : '',
    staff: o.staff ? o.staff.name : '',
    customerPhone: o.customer ? o.customer.phone : '',
    customerName: o.customer ? o.customer.name : '',
    pointsEarned: o.customer ? o.customer.earned || 0 : 0,
    pointsRedeemed: o.customer ? o.customer.redeemed || 0 : 0,
    pointsDiscount: o.pointsDiscount || 0,
    totalCost: o.totalCost || 0,
    shiftId: o.shiftId || '',
    manualBy: o.manualBy || '',
    items: o.items.map((i) => ({
      lineNo: i.lineNo,
      category: i.category,
      menu: i.name,
      menuId: i.menuId,
      detail: i.detail,
      qty: i.qty,
      soldGrams: i.soldG || 0,
      freeGrams: i.freeG || 0,
      options: i.options ? i.options.join(', ') : (i.main || ''),
      addOns: addOnText(i),
      unitPrice: i.unitPrice,
      gross: i.gross,
      itemDiscount: i.itemDiscount,
      lineNet: i.net,
      lineNote: i.note || '',
      promoDiscount: i.promoDiscount || 0,
      cost: i.cost || 0,
    })),
  };
}

function buildAction(q) {
  if (q.payload) return { qid: q.qid, action: q.action, orderId: q.orderId || q.label || q.action, data: q.payload };
  const o = state.orders.find((x) => x.id === q.orderId);
  if (!o) return null;
  if (q.action === 'NEW_ORDER') return { qid: q.qid, action: 'NEW_ORDER', orderId: o.id, data: orderSyncData(o) };
  return {
    qid: q.qid, action: 'VOID_ORDER', orderId: o.id,
    data: { orderId: o.id, voidedAt: o.voidedAtTH, voidedAtISO: o.voidedAtISO, reason: o.voidReason, order: orderSyncData(o) },
  };
}

function fetchWithTimeout(url, opts, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(url, Object.assign({}, opts, ctrl ? { signal: ctrl.signal } : {})).finally(() => timer && clearTimeout(timer));
}

/* ---------- Cloud endpoint: Cloudflare /api/sync (behind Access login) or Apps Script directly ---------- */

const isProxyUrl = (url) => { try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; } };

class AuthExpiredError extends Error {
  constructor() {
    super('เซสชันเข้าสู่ระบบหมดอายุ — กด “รีเฟรชเพื่อ Login ใหม่”');
    this.name = 'AuthExpiredError';
    this.auth = true;
  }
}

/**
 * fetch() for the sync endpoint. For the same-origin proxy, redirects are NOT followed: when the
 * Cloudflare Access session has expired, Access answers with a redirect to its login page
 * (→ "opaqueredirect") or a 401/403 page — both mean “log in again”, never “offline”.
 */
async function cloudFetch(url, opts, ms) {
  const proxy = isProxyUrl(url);
  const res = await fetchWithTimeout(url, Object.assign({}, opts, proxy
    ? { redirect: 'manual', credentials: 'same-origin', cache: 'no-store' }
    : { redirect: 'follow' }), ms);
  if (!proxy) return res;
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) { setAuthExpired(true); throw new AuthExpiredError(); }
  const ct = res.headers.get('content-type') || '';
  if (res.status === 401 || res.status === 403 || ct.includes('text/html')) {
    let j = null;
    try { j = JSON.parse(await res.clone().text()); } catch (e) { /* Access HTML page */ }
    if (!j || j.code === 'AUTH_EXPIRED') { setAuthExpired(true); throw new AuthExpiredError(); }
    setAuthExpired(false);
    throw new Error(j.error || `HTTP ${res.status}`); // our own JSON error = configuration problem, not the session
  }
  setAuthExpired(false);
  return res;
}

/** Persistent red banner — the sale screen keeps working, only the cloud is paused. */
function setAuthExpired(on) {
  on = !!on;
  const was = !!state.authExpired;
  state.authExpired = on;
  let b = document.getElementById('authBanner');
  if (!on) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'authBanner';
    b.setAttribute('role', 'alert');
    document.body.appendChild(b);
    b.addEventListener('click', (e) => { if (e.target.closest('[data-auth="reload"]')) location.reload(); });
  }
  renderAuthBanner();
  if (!was) toast('🔒 เซสชันเข้าสู่ระบบหมดอายุ — กดปุ่มสีแดงด้านบนเพื่อ Login ใหม่', 'error', 7000);
}
function renderAuthBanner() {
  const b = document.getElementById('authBanner');
  if (!b) return;
  const n = state.queue.length;
  b.innerHTML = `
    <div class="ab-ic">🔒</div>
    <div class="ab-text"><b>เซสชันเข้าสู่ระบบหมดอายุ — ข้อมูลยังไม่ถูกส่งขึ้น Google Sheets</b>
      <span>ขายต่อได้ตามปกติ บิล${n ? ` ${n} รายการที่ค้างอยู่` : ''}และตะกร้าเก็บในเครื่องครบ ไม่หาย · กดรีเฟรชแล้วกรอกอีเมล + รหัส OTP เพื่อเข้าสู่ระบบใหม่ ระบบจะส่งข้อมูลที่ค้างให้อัตโนมัติ</span></div>
    <button class="btn btn-lg ab-btn" data-auth="reload" type="button">${svg('refresh', 20)} รีเฟรชเพื่อ Login ใหม่</button>`;
}

/**
 * POST as text/plain (a "simple" request → no CORS preflight). Apps Script replies with
 * Access-Control-Allow-Origin:* so the JSON is normally readable. If it isn't (and the
 * caller does not need the response), retry in no-cors mode and treat it as delivered —
 * every write action is idempotent on the server.
 */
async function postToSheet(url, bodyObj, { needResponse = false, timeout = 30000 } = {}) {
  const body = JSON.stringify(bodyObj);
  const headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  const proxy = isProxyUrl(url);
  let res;
  try {
    res = await cloudFetch(url, { method: 'POST', headers, body }, timeout);
  } catch (err) {
    if (err && err.auth) throw err; // session expired → keep everything queued
    if (err && err.name === 'AbortError') throw new Error('หมดเวลาเชื่อมต่อ (timeout)');
    if (proxy || needResponse) throw new Error(err && err.message && !/fetch|network|load failed/i.test(err.message) ? err.message : 'เชื่อมต่อ Cloud ไม่ได้ — ตรวจสอบอินเทอร์เน็ต');
    // legacy direct Apps Script only (CORS quirk): fire-and-forget, every write is idempotent on the server
    await fetchWithTimeout(url, { method: 'POST', mode: 'no-cors', headers, body }, timeout);
    return { opaque: true };
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) {
    throw new Error(proxy ? `Cloud ตอบกลับไม่ถูกต้อง (HTTP ${res.status})` : `Apps Script ตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ตรวจสอบว่า Deploy แบบ "Anyone" แล้ว`);
  }
  if (!json.ok) throw new Error(json.code === 'BAD_KEY' ? 'รหัสลับไม่ตรงกัน (SYNC_SECRET ใน Cloudflare ≠ Apps Script)' : json.error || 'Apps Script error');
  return json;
}

async function syncNow({ silent = false } = {}) {
  if (state.syncing) return;
  const url = (state.settings.gasUrl || '').trim();
  if (!state.queue.length) return;
  if (!url) {
    if (!silent) { toast('กรุณาตั้งค่า Google Apps Script URL ก่อน', 'warn'); openSettings(); }
    return;
  }
  if (!navigator.onLine) { if (!silent) toast('ออฟไลน์อยู่ — จะ Sync อัตโนมัติเมื่อกลับมาออนไลน์', 'warn'); return; }

  state.syncing = true;
  renderHeader();
  refreshSettingsIfOpen();
  let okCount = 0, failCount = 0, lastError = '';
  try {
    state.queue = state.queue.filter((q) => q.payload || state.orders.some((o) => o.id === q.orderId));
    const snapshot = state.queue.slice();
    for (let i = 0; i < snapshot.length; i += 20) {
      const batch = snapshot.slice(i, i + 20);
      const actions = batch.map(buildAction).filter(Boolean);
      let doneIds = [];
      const errors = {};
      try {
        const res = await postToSheet(url, { source: 'ipad-pos', appVersion: APP_VERSION, device: state.settings.devicePrefix, actions });
        if (res.opaque) doneIds = batch.map((q) => q.qid);
        else for (const r of res.results || []) { if (r.ok) doneIds.push(r.qid); else errors[r.qid] = r.error || 'error'; }
      } catch (err) {
        lastError = err.message || String(err);
        batch.forEach((q) => { errors[q.qid] = lastError; });
      }
      const touched = [];
      for (const q of batch) {
        if (doneIds.includes(q.qid)) {
          okCount++;
          const o = !q.payload && state.orders.find((x) => x.id === q.orderId);
          if (o) { if (q.action === 'NEW_ORDER') o.synced = true; else o.voidSynced = true; touched.push(o); }
        } else {
          failCount++;
          const live = state.queue.find((x) => x.qid === q.qid);
          if (live) { live.attempts += 1; live.lastError = errors[q.qid] || 'ไม่ทราบสาเหตุ'; lastError = live.lastError; }
        }
      }
      state.queue = state.queue.filter((q) => !doneIds.includes(q.qid));
      save.queue();
      if (touched.length) save.orders(touched);
      if (lastError && !doneIds.length) break;
    }
  } finally {
    state.syncing = false;
    state.settings.lastSyncAt = fmtDateTime(new Date());
    state.settings.lastSyncError = failCount ? lastError : '';
    save.settings();
    renderHeader();
    refreshSettingsIfOpen();
    if (isOpen('m-history')) renderHistory();
  }
  if (!silent || failCount) {
    if (failCount && !state.authExpired) toast(`Sync บิลไม่สำเร็จ ${failCount} รายการ: ${lastError}`, 'error', 5000);
    else toast(`Sync บิลสำเร็จ ${okCount} รายการ ✓`, 'success');
  }
}

/* ==========================================================================
   17. GOOGLE SHEETS — MULTI-DEVICE STATE SYNC (catalog / stock / images / settings)
   ========================================================================== */

let autoPushTimer = null;

/** Remember what changed since the last successful push (timestamped, so edits made
 *  while a push is in flight are not lost). */
function markDirty(kind, key) {
  const m = state.syncMeta;
  const ts = Date.now();
  if (kind === 'catalog') m.catalogDirty = ts;
  else if (kind === 'settings') m.settingsDirty = ts;
  else if (kind === 'stock') m.stockDirty[key] = ts;
  else if (kind === 'image') m.imagesDirty[key] = ts;
  save.syncMeta();
  renderHeader();
  scheduleAutoPush();
}
function scheduleAutoPush() {
  if (!state.settings.autoPush || !(state.settings.gasUrl || '').trim()) return;
  clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => pushState({ silent: true }), 4000);
}

const sharedSettings = () => ({ shopName: state.settings.shopName, shopSubtitle: state.settings.shopSubtitle });

/** Builds the PUSH_STATE action. `full` = overwrite everything on the cloud. */
function buildPushPayload(full) {
  const m = state.syncMeta;
  const data = { device: state.settings.devicePrefix, at: isoLocal(new Date()), appVersion: APP_VERSION };
  if (full || m.catalogDirty) data.catalog = state.catalog;
  if (full || m.settingsDirty) data.settings = sharedSettings();
  const stockKeys = full ? Object.keys(state.stock) : Object.keys(m.stockDirty);
  if (stockKeys.length) {
    data.stockSet = {};
    for (const k of stockKeys) if (k in state.stock) data.stockSet[k] = state.stock[k];
  }
  const imgKeys = full ? Object.keys(state.images) : Object.keys(m.imagesDirty);
  data.images = imgKeys.filter((id) => state.images[id]).map((id) => ({ id, data: state.images[id] }));
  data.deletedImages = full ? [] : imgKeys.filter((id) => !state.images[id]);
  if (full) { data.allImageIds = Object.keys(state.images); data.fullStock = true; }
  const empty = !data.catalog && !data.settings && !data.stockSet && !data.images.length && !data.deletedImages.length;
  return empty ? null : { qid: `state-${Date.now()}`, action: 'PUSH_STATE', data };
}

function clearDirtyUpTo(stamp) {
  const m = state.syncMeta;
  if (m.catalogDirty && m.catalogDirty <= stamp) m.catalogDirty = 0;
  if (m.settingsDirty && m.settingsDirty <= stamp) m.settingsDirty = 0;
  for (const k of Object.keys(m.stockDirty)) if (m.stockDirty[k] <= stamp) delete m.stockDirty[k];
  for (const k of Object.keys(m.imagesDirty)) if (m.imagesDirty[k] <= stamp) delete m.imagesDirty[k];
}

async function pushState({ full = false, silent = false } = {}) {
  const url = (state.settings.gasUrl || '').trim();
  if (!url) { if (!silent) { toast('กรุณาตั้งค่า Google Apps Script URL ก่อน', 'warn'); openSettings(); } return false; }
  if (!navigator.onLine) { if (!silent) toast('ออฟไลน์อยู่ — จะส่งขึ้น Cloud เมื่อออนไลน์', 'warn'); return false; }
  if (state.cloudBusy) { scheduleAutoPush(); return false; }
  const stamp = Date.now();
  const action = buildPushPayload(full);
  if (!action) { if (!silent) toast('ไม่มีการเปลี่ยนแปลงที่ต้องส่ง ✓', 'success'); return true; }

  state.cloudBusy = true;
  renderHeader();
  refreshSettingsIfOpen();
  try {
    const res = await postToSheet(url, { source: 'ipad-pos', appVersion: APP_VERSION, device: state.settings.devicePrefix, actions: [action] }, { timeout: 60000 });
    if (!res.opaque) {
      const r = res.results && res.results[0];
      if (!r || !r.ok) throw new Error((r && r.error) || 'PUSH_STATE failed');
    }
    clearDirtyUpTo(stamp);
    state.syncMeta.lastPushAt = fmtDateTime(new Date());
    state.syncMeta.lastStateError = '';
    save.syncMeta();
    if (!silent) toast(full ? 'อัปเดตเมนู/รูป/สต็อก ขึ้น Cloud ทั้งหมดแล้ว ✓' : 'ส่งการเปลี่ยนแปลงขึ้น Cloud แล้ว ✓', 'success');
    return true;
  } catch (e) {
    state.syncMeta.lastStateError = e.message || String(e);
    save.syncMeta();
    if (!silent) toast(`ส่งขึ้น Cloud ไม่สำเร็จ: ${state.syncMeta.lastStateError}`, 'error', 5000);
    return false;
  } finally {
    state.cloudBusy = false;
    renderHeader();
    refreshSettingsIfOpen();
    if (isOpen('m-manage')) renderManager();
  }
}

/**
 * Apply a PULL_STATE result. Cloud stock already contains every synced order; orders still
 * waiting in this device's queue are re-applied on top so nothing is double-counted or lost.
 */
async function applyPulledState(r) {
  if (r.catalog) {
    state.catalog = normalizeCatalog(r.catalog);
    save.catalog();
    reindex();
  }
  if (r.settings) {
    if (r.settings.shopName) state.settings.shopName = String(r.settings.shopName);
    if (r.settings.shopSubtitle != null) state.settings.shopSubtitle = String(r.settings.shopSubtitle);
    save.settings();
  }
  if (r.stock && typeof r.stock === 'object') {
    const s = sanitizeStock(r.stock, state.catalog);
    for (const q of state.queue) {
      if (q.payload) continue;
      const o = state.orders.find((x) => x.id === q.orderId);
      if (!o) continue;
      const sign = q.action === 'NEW_ORDER' ? -1 : 1;
      for (const k in o.stockDeduction || {}) s[k] = Math.max(0, (s[k] || 0) + sign * o.stockDeduction[k]);
    }
    state.stock = s;
  } else {
    state.stock = sanitizeStock(state.stock, state.catalog);
  }
  save.stock();
  if (r.images && typeof r.images === 'object') {
    for (const id of Object.keys(state.images)) {
      if (!r.images[id]) { await ImageStore.remove(id); delete state.images[id]; }
    }
    for (const [id, data] of Object.entries(r.images)) {
      if (typeof data === 'string' && data.startsWith('data:image/') && state.images[id] !== data) {
        await ImageStore.put(id, data);
        state.images[id] = data;
      }
    }
  }
  if (Array.isArray(r.orders) && r.date) {
    state.remoteOrders = { [r.date]: r.orders.map(normalizeRemoteOrder) };
    save.remote();
  }
  if (Array.isArray(r.customers)) applyPulledCustomers(r.customers);
  sanitizeCart();
  save.cart();
  state.syncMeta.lastPullAt = fmtDateTime(new Date());
  state.syncMeta.lastStateError = '';
  save.syncMeta();
  renderAll();
  if (isOpen('m-manage')) renderManager();
}

async function pullState({ silent = false } = {}) {
  const url = (state.settings.gasUrl || '').trim();
  if (!url) { if (!silent) { toast('กรุณาตั้งค่า Google Apps Script URL ก่อน', 'warn'); openSettings(); } return false; }
  if (!navigator.onLine) { if (!silent) toast('ออฟไลน์อยู่', 'warn'); return false; }
  // 1) send this device's pending orders + edits first so they are not overwritten
  await syncNow({ silent: true });
  if (hasStateChanges()) {
    const ok = await pushState({ silent: true });
    if (!ok) { if (!silent) toast('ส่งการเปลี่ยนแปลงในเครื่องนี้ไม่สำเร็จ — ยกเลิกการดึงเพื่อป้องกันข้อมูลหาย', 'error', 5000); return false; }
  }
  if (state.cloudBusy) return false;
  state.cloudBusy = true;
  renderHeader();
  refreshSettingsIfOpen();
  try {
    const res = await postToSheet(url, { source: 'ipad-pos', device: state.settings.devicePrefix, actions: [{ qid: 'pull', action: 'PULL_STATE', data: { date: todayKey() } }] }, { needResponse: true, timeout: 60000 });
    const r = res.results && res.results[0];
    if (!r || !r.ok) throw new Error((r && r.error) || 'PULL_STATE failed');
    if (!r.result.catalog) {
      if (!silent) toast('ยังไม่มีข้อมูลเมนูบน Cloud — กด “อัปเดตขึ้น Cloud” จากเครื่องหลักก่อน', 'warn', 5000);
      return false;
    }
    await applyPulledState(r.result);
    if (!silent) toast('ดึงเมนู/รูป/สต็อก ล่าสุดจาก Cloud แล้ว ✓', 'success');
    return true;
  } catch (e) {
    state.syncMeta.lastStateError = e.message || String(e);
    save.syncMeta();
    if (!silent) toast(`ดึงข้อมูลจาก Cloud ไม่สำเร็จ: ${state.syncMeta.lastStateError}`, 'error', 5000);
    return false;
  } finally {
    state.cloudBusy = false;
    renderHeader();
    refreshSettingsIfOpen();
  }
}

async function confirmFullPush() {
  const r = await confirmDialog({
    title: 'อัปเดตขึ้น Cloud (Push from Main)',
    html: `<p>ส่ง <b>เมนู · หมวดหมู่ · โปรโมชั่น · รูป ${Object.keys(state.images).length} รูป · สต็อกทั้งหมด</b> จากเครื่องนี้ขึ้น Google Sheets</p>
           <p class="warn-box">ข้อมูลบน Cloud จะถูกแทนที่ด้วยข้อมูลของเครื่องนี้ (รวมจำนวนสต็อก) — ใช้กับเครื่องหลักเท่านั้น</p>`,
    okText: 'ยืนยันอัปเดตขึ้น Cloud',
  });
  if (r.ok) pushState({ full: true });
}

async function syncAll() {
  const url = (state.settings.gasUrl || '').trim();
  if (!url) { toast('กรุณาตั้งค่า Google Apps Script URL ก่อน', 'warn'); return openSettings(); }
  if (!state.queue.length && !hasStateChanges()) return toast('ข้อมูล Sync ครบแล้ว ✓', 'success');
  await syncNow();
  if (hasStateChanges()) await pushState();
}

async function testConnection() {
  const url = ($('#gasUrl') ? $('#gasUrl').value : state.settings.gasUrl).trim();
  if (!url) return toast('กรุณาใส่ URL ก่อน', 'warn');
  if (!navigator.onLine) return toast('ออฟไลน์อยู่', 'warn');
  try {
    const res = await cloudFetch(url, { method: 'GET' }, 20000);
    const json = JSON.parse(await res.text());
    if (json.ok) toast(`เชื่อมต่อสำเร็จ ✓ ${json.sheet ? `(${json.sheet})` : ''}${json.hasCatalog ? ' · มีเมนูบน Cloud แล้ว' : ''}`, 'success', 3500);
    else toast(`เชื่อมต่อได้แต่มีข้อผิดพลาด: ${json.code === 'BAD_KEY' ? 'รหัสลับ SYNC_SECRET ไม่ตรงกัน' : json.error}`, 'error', 6000);
  } catch (e) {
    if (e && e.auth) return;
    toast(isProxyUrl(url) ? `เชื่อมต่อไม่สำเร็จ: ${e.message || e}` : 'เชื่อมต่อไม่สำเร็จ — ตรวจสอบ URL และการ Deploy (Who has access: Anyone)', 'error', 6000);
  }
}

/* ==========================================================================
   18. SETTINGS, BACKUP & MAINTENANCE
   ========================================================================== */

async function openSettings(tab) {
  if (!(await requirePerm('settings', 'ตั้งค่า'))) return;
  if (tab) setTab = tab;
  renderSettings();
  openModal('m-settings');
}
function refreshSettingsIfOpen() {
  if (isOpen('m-settings')) renderSettings(true);
}
function storageUsageKB() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
  }
  return Math.round(bytes / 1024);
}

let setTab = 'device';

function renderSettings(keepInputs = false) {
  const modal = $('#m-settings');
  const val = (id) => ($(`#${id}`) ? $(`#${id}`).value : null);
  const prev = keepInputs ? { url: val('gasUrl'), shop: val('shopNameInput'), sub: val('shopSubInput'), prefix: val('prefixInput'), qp: val('queuePrefixInput') } : {};
  const pick = (p, v) => (p != null ? p : v);
  const s = state.settings;
  const m = state.syncMeta;
  const q = state.queue;
  const busy = state.cloudBusy || state.syncing;
  const canShare = !!(navigator.canShare && window.File);
  const dirtyParts = [
    m.catalogDirty ? 'เมนู/หมวด/โปร/ตั้งค่าร้าน' : '',
    Object.keys(m.stockDirty).length ? `สต็อก ${Object.keys(m.stockDirty).length} รายการ` : '',
    Object.keys(m.imagesDirty).length ? `รูป ${Object.keys(m.imagesDirty).length} รูป` : '',
    m.settingsDirty ? 'ข้อมูลร้าน' : '',
  ].filter(Boolean);
  const toggle = (key, label, help) => `
    <button class="switch-row" data-act="toggle" data-key="${key}" type="button" aria-pressed="${!!s[key]}">
      <span class="switch ${s[key] ? 'on' : ''}"><span></span></span>
      <span><b>${label}</b><small>${help}</small></span>
    </button>`;
  const tabs = [
    ['device', 'เครื่องนี้', 'tablet'], ['sync', 'Cloud Sync', 'cloud'], ['shop', 'ร้าน & ใบเสร็จ', 'receipt'],
    ['pay', 'การชำระเงิน', 'cash'], ['staff', 'พนักงาน & สิทธิ์', 'user'], ['loyalty', 'สมาชิก & แต้ม', 'star'],
    ['kds', 'จอครัว (KDS)', 'chef'], ['backup', 'สำรอง & บำรุงรักษา', 'download'],
  ];
  let body = '';
  if (setTab === 'device') {
    body = `
    <div class="section">
      <div class="section-title">โหมดของเครื่องนี้</div>
      <div class="type-cards two">
        <button class="mode-card ${s.deviceMode === 'pos' ? 'on' : ''}" data-act="device-mode" data-v="pos" type="button"><b>🛒 ขายหน้าร้าน (POS)</b><small>รับออเดอร์ · ชำระเงิน · ออกใบเสร็จ</small></button>
        <button class="mode-card ${s.deviceMode === 'kds' ? 'on' : ''}" data-act="device-mode" data-v="kds" type="button"><b>🍳 จอจัดออเดอร์ (KDS)</b><small>iPad หลังร้าน — แสดงคิวที่ต้องทำ/ส่งมอบ (ต้องตั้ง Cloud Sync)</small></button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Google Sheets Web App URL</div>
      <div class="row nowrap">
        <input class="input grow" id="gasUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="${esc(SYNC_URL_META || 'https://script.google.com/macros/s/XXXX/exec')}" value="${esc(pick(prev.url, s.gasUrl))}" />
        <button class="btn btn-primary" data-act="save-url" type="button">บันทึก</button>
        <button class="btn btn-outline" data-act="test-url" type="button">${svg('link', 18)} ทดสอบ</button>
      </div>
      <p class="help">${isProxyUrl(s.gasUrl || '') ? '🔒 เชื่อมผ่าน Cloudflare <b>/api/sync</b> (ต้อง Login + รหัสลับฝั่งเซิร์ฟเวอร์) — ไม่ต้องใส่ URL ของ Google ในเครื่อง' : 'ใช้ URL เดียวกันในทุกเครื่อง (ลงท้ายด้วย /exec) — ดูขั้นตอนใน README.md'}</p>
    </div>
    <div class="section">
      <div class="row" style="align-items:flex-end">
        <label class="ed-field" style="width:220px;margin:0"><span>รหัสเครื่อง (Device Prefix)</span>
          <input class="input" id="prefixInput" type="text" autocapitalize="characters" maxlength="10" value="${esc(pick(prev.prefix, s.devicePrefix))}" /></label>
        <label class="ed-field" style="width:200px;margin:0"><span>ตัวอักษรนำหน้าเลขคิว</span>
          <input class="input" id="queuePrefixInput" type="text" autocapitalize="characters" maxlength="3" placeholder="เช่น A" value="${esc(pick(prev.qp, s.queuePrefix))}" /></label>
        <button class="btn btn-outline" data-act="save-prefix" type="button">บันทึก</button>
      </div>
      <p class="help">เลขบิล: <b>ORD-${esc(s.devicePrefix)}-${todayKey().replace(/-/g, '')}-001</b> · เลขคิว: <b>#${esc(s.queuePrefix)}01</b> (เริ่มใหม่ทุกวัน) — ถ้ามี POS หลายเครื่อง ตั้งตัวอักษรคิวให้ต่างกัน เช่น A / B</p>
    </div>`;
  } else if (setTab === 'sync') {
    body = `
    <div class="section sync-panel">
      <div class="section-title">หลายเครื่อง — ซิงก์เมนู / รูป / สต็อก / ตั้งค่าร้าน ผ่าน Cloud</div>
      <div class="cloud-btns">
        <button class="btn btn-primary btn-lg" data-act="push-full" type="button" ${busy ? 'disabled' : ''}>☁️ อัปเดตเมนู/รูป/สต็อก ขึ้น Cloud<small>Push from Main</small></button>
        <button class="btn btn-outline btn-lg" data-act="pull" type="button" ${busy ? 'disabled' : ''}>📥 ดึงเมนู/รูป/สต็อก ล่าสุดจาก Cloud<small>Pull to this Device</small></button>
      </div>
      ${toggle('autoPush', 'ส่งการเปลี่ยนแปลงขึ้น Cloud อัตโนมัติ', 'เมื่อแก้เมนู โปร อัปโหลดรูป หรือแก้สต็อก (แนะนำให้เปิดในเครื่องหลัก)')}
      ${toggle('autoPull', 'ซิงก์ข้อมูลเมนูและสต็อกจาก Cloud อัตโนมัติเมื่อเปิดแอป', 'เหมาะกับเครื่องรอง — เปิดแอปแล้วได้เมนู รูป และสต็อกล่าสุดทันที')}
      <dl class="kv" style="margin-top:10px">
        <dt>ส่งขึ้นล่าสุด</dt><dd>${esc(m.lastPushAt || '-')}</dd>
        <dt>ดึงล่าสุด</dt><dd>${esc(m.lastPullAt || '-')}</dd>
        <dt>รอส่งขึ้น Cloud</dt><dd>${dirtyParts.length ? `<span style="color:var(--warn)">${esc(dirtyParts.join(' · '))}</span>` : '<span style="color:var(--ok)">ไม่มี ✓</span>'}</dd>
        ${m.lastStateError ? `<dt>ข้อผิดพลาด</dt><dd style="color:var(--danger)">${esc(m.lastStateError)}</dd>` : ''}
      </dl>
    </div>
    <div class="section">
      <div class="row" style="margin-bottom:10px">
        <div class="section-title grow" style="margin:0">คิวรอ Sync (${q.length})</div>
        <button class="btn btn-primary" data-act="sync-all" type="button" ${state.syncing || !q.length ? 'disabled' : ''}>
          ${svg('cloud', 18)} ${state.syncing ? 'กำลัง Sync…' : 'Sync ข้อมูลทั้งหมดตอนนี้'}
        </button>
      </div>
      ${q.length ? `<div class="queue-list">${q.map((it) => `
        <div class="queue-item">
          <span class="pill ${it.action === 'VOID_ORDER' ? 'pill-void' : 'pill-mute'}">${esc(it.action)}</span>
          <div class="grow"><b>${esc(it.orderId || it.label || '')}</b> <span class="help">${esc(it.createdAt.replace('T', ' ').slice(0, 19))}</span>
            ${it.lastError ? `<div class="q-err">พยายาม ${it.attempts} ครั้ง: ${esc(it.lastError)}</div>` : ''}</div>
        </div>`).join('')}</div>` : '<div class="ok-box">ไม่มีรายการค้าง — Sync แล้วทั้งหมด ✓</div>'}
      <p class="help">Sync ล่าสุด: ${esc(s.lastSyncAt || '-')}${s.lastSyncError ? ` · <span style="color:var(--danger)">${esc(s.lastSyncError)}</span>` : ''}</p>
    </div>`;
  } else if (setTab === 'shop') {
    body = `
    <div class="section">
      <div class="section-title">ข้อมูลร้าน <small>(ซิงก์ไปทุกเครื่อง)</small></div>
      <div class="row">
        <div class="grow"><label class="field-label" for="shopNameInput">ชื่อร้าน</label>
          <input class="input" id="shopNameInput" type="text" value="${esc(pick(prev.shop, s.shopName))}" /></div>
        <div class="grow"><label class="field-label" for="shopSubInput">คำโปรย / Subtitle</label>
          <input class="input" id="shopSubInput" type="text" value="${esc(pick(prev.sub, s.shopSubtitle))}" /></div>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn btn-outline" data-act="save-shop" type="button">บันทึกข้อมูลร้าน</button></div>
    </div>
    ${settingsReceiptHTML()}`;
  } else if (setTab === 'pay') body = settingsPayHTML();
  else if (setTab === 'staff') body = settingsStaffHTML();
  else if (setTab === 'loyalty') body = settingsLoyaltyHTML();
  else if (setTab === 'kds') body = settingsKdsHTML();
  else {
    body = `
    <div class="section">
      <div class="section-title">สำรองข้อมูล (Backup)</div>
      <p class="help" style="margin:0 0 10px">ไฟล์ JSON รวม เมนู · โปร · สต็อก · ประวัติบิล · ประวัติสต็อก · กะ · สมาชิก · คิว Sync · ตั้งค่า · รูปเมนู</p>
      <div class="row">
        <button class="btn btn-primary" data-act="export" type="button">${svg('download', 18)} Export Backup (JSON)</button>
        ${canShare ? `<button class="btn btn-outline" data-act="share" type="button">${svg('share', 18)} แชร์ไฟล์ Backup</button>` : ''}
        <button class="btn btn-outline" data-act="import" type="button">${svg('upload', 18)} Import Backup (JSON)</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">บำรุงรักษา</div>
      <dl class="kv">
        <dt>เวอร์ชันแอป</dt><dd>${APP_VERSION}</dd>
        <dt>เมนู / หมวด / โปร</dt><dd>${state.catalog.items.length} / ${state.catalog.categories.length} / ${state.catalog.promos.length}</dd>
        <dt>บิลทั้งหมดในเครื่อง</dt><dd>${state.orders.length} บิล ${OrderStore.usingLS ? '(localStorage)' : '(IndexedDB — เก็บได้หลายหมื่นบิล)'}</dd>
        <dt>พื้นที่ localStorage</dt><dd>~${storageUsageKB()} KB (จำกัดประมาณ 5,000 KB · บิลไม่ได้เก็บที่นี่แล้ว)</dd>
      </dl>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-outline" data-act="update-app" type="button">${svg('refresh', 18)} Update App Version</button>
        <button class="btn btn-ghost" data-act="cleanup" type="button">ล้างบิลเก่าที่ Sync แล้ว (เกิน 365 วัน)</button>
      </div>
    </div>`;
  }

  paint(modal.querySelector('.modal-body'), `
    <div class="mgr-tabs set-tabs">
      ${tabs.map(([id, label, ic]) => `<button class="mgr-tab ${setTab === id ? 'on' : ''}" data-stab="${id}" type="button">${svg(ic, 18)} ${label}</button>`).join('')}
    </div>
    ${body}`);
}

async function backupPayload() {
  let stockLog = [], shifts = [];
  try { stockLog = await DataDB.all('stocklog'); shifts = await DataDB.all('shifts'); } catch (e) { /* IDB unavailable */ }
  return {
    app: 'ipad-pos', schema: 3, appVersion: APP_VERSION, exportedAt: isoLocal(new Date()),
    catalog: state.catalog, stock: state.stock, orders: state.orders, queue: state.queue,
    settings: state.settings, images: state.images,
    stockLog, shifts, shift: state.shift, parked: state.parked, customers: state.customers,
  };
}
function backupFileName() {
  const d = new Date();
  return `pos-backup-${state.settings.devicePrefix}-${dateKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
async function exportBackup() {
  const blob = new Blob([JSON.stringify(await backupPayload())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Export Backup แล้ว', 'success');
}
async function shareBackup() {
  try {
    const name = backupFileName();
    const file = new File([JSON.stringify(await backupPayload())], name, { type: 'application/json' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return exportBackup();
    await navigator.share({ files: [file], title: name });
  } catch (e) {
    if (e && e.name !== 'AbortError') { console.warn(e); exportBackup(); }
  }
}
async function importBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง', 'error'); }
  if (!data || data.app !== 'ipad-pos' || !Array.isArray(data.orders)) return toast('ไฟล์ Backup ไม่ถูกต้อง', 'error');
  const r = await confirmDialog({
    title: 'Import Backup',
    html: `<p>ข้อมูลในไฟล์ (Export เมื่อ ${esc(data.exportedAt || '-')}):</p>
           <p>เมนู <b>${data.catalog && Array.isArray(data.catalog.items) ? data.catalog.items.length : 'ชุดเริ่มต้น'}</b> · บิล <b>${data.orders.length}</b> · คิว Sync <b>${(data.queue || []).length}</b> · รูปภาพ <b>${Object.keys(data.images || {}).length}</b></p>
           <p class="err-box">ข้อมูลปัจจุบันในเครื่องนี้จะถูกแทนที่ทั้งหมด (ตะกร้าจะถูกล้าง)</p>`,
    okText: 'นำเข้าและแทนที่',
    danger: true,
  });
  if (!r.ok) return;
  const keepUrl = state.settings.gasUrl;
  state.catalog = normalizeCatalog(data.catalog);
  reindex();
  state.stock = sanitizeStock(data.stock, state.catalog);
  state.orders = data.orders;
  state.queue = Array.isArray(data.queue) ? data.queue : [];
  state.settings = Object.assign(defaultSettings(), data.settings || {});
  if (!state.settings.gasUrl && keepUrl) state.settings.gasUrl = keepUrl;
  fixSyncUrl(state.settings);
  state.cart = emptyCart();
  state.parked = Array.isArray(data.parked) ? data.parked : [];
  state.customers = data.customers && typeof data.customers === 'object' ? data.customers : {};
  state.shift = data.shift || null;
  $('#manualDiscount').value = '';
  const ok = save.catalog() && (await OrderStore.replaceAll(state.orders)) && save.stock() && save.queue() && save.settings() && save.cart()
    && save.parked() && save.customers() && save.shift();
  try {
    if (Array.isArray(data.stockLog)) { await DataDB.clear('stocklog'); await DataDB.put('stocklog', data.stockLog); }
    if (Array.isArray(data.shifts)) { await DataDB.clear('shifts'); await DataDB.put('shifts', data.shifts); }
  } catch (e) { console.warn('restore logs failed', e); }
  await ImageStore.clear();
  state.images = {};
  for (const [id, url] of Object.entries(data.images || {})) {
    if (typeof url === 'string' && url.startsWith('data:image/')) {
      await ImageStore.put(id, url);
      state.images[id] = url;
    }
  }
  await shrinkLegacyImages();
  renderAll();
  renderSettings();
  toast(ok ? 'นำเข้าข้อมูลสำเร็จ ✓ (กด “อัปเดตขึ้น Cloud” ถ้าต้องการให้เครื่องอื่นได้ข้อมูลนี้)' : 'นำเข้าแล้วบางส่วน — พื้นที่จัดเก็บไม่พอ', ok ? 'success' : 'error', 5000);
}
async function cleanupOldOrders() {
  const cutoff = shiftDateKey(todayKey(), -365);
  const queued = new Set(state.queue.map((q) => q.orderId));
  const removable = state.orders.filter((o) => o.date < cutoff && !queued.has(o.id) && o.synced && (o.status !== 'VOIDED' || o.voidSynced));
  if (!removable.length) return toast('ไม่มีบิลเก่าที่ลบได้', '');
  const r = await confirmDialog({
    title: 'ล้างบิลเก่า',
    html: `ลบบิลที่ Sync แล้วและเก่ากว่า ${fmtDateKeyTH(cutoff)} จำนวน <b>${removable.length}</b> บิลออกจากเครื่องนี้?<br/><span class="help">ข้อมูลยังอยู่ใน Google Sheets — แนะนำให้ Export Backup ก่อน</span>`,
    okText: 'ลบบิลเก่า',
    danger: true,
  });
  if (!r.ok) return;
  const ids = new Set(removable.map((o) => o.id));
  state.orders = state.orders.filter((o) => !ids.has(o.id));
  await OrderStore.remove([...ids]);
  renderSettings();
  toast(`ลบ ${removable.length} บิลแล้ว`, 'success');
}

/* ==========================================================================
   19. PWA — SERVICE WORKER & UPDATE
   ========================================================================== */

function swMessage(worker, msg, timeoutMs) {
  return new Promise((resolve) => {
    if (!worker) return resolve(null);
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    worker.postMessage(msg, [ch.port2]);
  });
}
async function updateApp() {
  if (!navigator.onLine) return toast('ต้องเชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดตแอป', 'warn');
  save.cart();
  toast('กำลังดาวน์โหลดเวอร์ชันล่าสุด…', '', 4000);
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        const res = await swMessage(navigator.serviceWorker.controller || reg.active, { type: 'REFRESH_CACHE' }, 20000);
        if (res && res.ok === false) console.warn('cache refresh failed', res.error);
      }
    }
  } catch (e) {
    console.warn('update failed', e);
  }
  setTimeout(() => location.reload(), 300);
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update().catch(() => {}); })
    .catch((e) => console.warn('SW register failed', e));
}

/* ==========================================================================
   20. EVENTS & INIT
   ========================================================================== */

const cleanNum = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

function bindEvents() {
  $('#btnSync').addEventListener('click', syncAll);
  $('#btnStock').addEventListener('click', () => openManager());
  $('#btnHistory').addEventListener('click', () => openHistory());
  $('#btnSettings').addEventListener('click', () => openSettings());
  $('#btnUpdate').addEventListener('click', updateApp);
  $('#btnStaff').addEventListener('click', openStaffMenu);

  $('#catTabs').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cat-manage"]')) { openManager('cats'); return; }
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.category = b.dataset.cat;
    renderTabs();
    renderMenu();
    $('#menuGrid').scrollTop = 0;
  });
  $('#menuGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-menu]');
    if (card) onMenuTap(card.dataset.menu);
  });

  $('#cartList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    const line = state.cart.lines.find((l) => l.id === id);
    if (act === 'inc') changeQty(id, 1);
    else if (act === 'dec') changeQty(id, -1);
    else if (act === 'remove') removeLine(id);
    else if (act === 'note' && line) editNote(line);
    else if (act === 'bill-note') editNote(null);
    else if (act === 'parked') openParked();
    else if (act === 'edit' && line) {
      if (line.type === 'weight') openWeight(line.menuId, line);
      else if (line.type === 'set') openSet(line.menuId, line);
    }
  });
  $('#btnClearCart').addEventListener('click', clearCart);
  $('#btnPark').addEventListener('click', () => (state.cart.lines.length ? parkCart() : openParked()));
  $('#promoRows').addEventListener('click', (e) => { if (e.target.closest('[data-act="promo-pick"]')) openPromoPicker(); });
  const manual = $('#manualDiscount');
  manual.value = state.cart.manualDiscount || '';
  manual.addEventListener('input', () => {
    if (manual.readOnly) return;
    const cleaned = cleanNum(manual.value);
    if (cleaned !== manual.value) manual.value = cleaned;
    state.cart.manualDiscount = cleaned;
    save.cart();
    renderTotals();
  });
  manual.addEventListener('focus', async () => {
    if (!manual.readOnly) { manual.select(); return; }
    manual.blur();
    const who = await requirePerm('discount', 'ให้ส่วนลดเพิ่มเติม', { force: true });
    if (!who) return;
    state.cart.discountBy = who.name || 'เจ้าของร้าน';
    save.cart();
    renderTotals();
    manual.focus();
  });
  $('#btnCheckout').addEventListener('click', openPayment);

  // dynamic modals (created on demand) — one delegated listener per event type
  const MODAL = {
    'm-promo': { click: promoEditorClick, change: promoEditorChange },
    'm-promopick': { click: promoPickerClick },
    'm-done': { click: orderDoneClick },
    'm-parked': { click: parkedClick },
    'm-shift': { click: shiftClick, input: shiftInput },
    'm-stockadj': { click: stockAdjClick, input: stockAdjInput },
    'm-pin': { click: pinClick },
    'm-staffmenu': { click: staffMenuClick },
    'm-note': { click: noteClick },
  };
  for (const type of ['click', 'change', 'input']) {
    document.addEventListener(type, (e) => {
      const m = e.target.closest && e.target.closest('.modal');
      const h = m && MODAL[m.id];
      if (h && h[type]) h[type](e);
    });
  }

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) c.closest('.modal').classList.remove('open');
  });

  // weight modal
  $('#m-weight').addEventListener('click', (e) => {
    const f = e.target.closest('[data-field]');
    if (f) { weightCtx.active = f.dataset.field; return renderWeight(); }
    const k = e.target.closest('[data-key]');
    if (k) return weightKey(k.dataset.key);
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const a = weightCtx.active;
      weightCtx.f[a] = String(toInt(weightCtx.f[a]) + Number(chip.dataset.chip));
      return renderWeight();
    }
    if (e.target.closest('[data-act="weight-ok"]')) weightConfirm();
  });

  // set modal
  $('#m-set').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (p && !p.disabled) { setCtx.picks[p.dataset.pick] = p.dataset.o; return renderSet(); }
    const a = e.target.closest('[data-add]');
    if (a && !a.disabled) {
      const g = a.dataset.add, o = a.dataset.o;
      setCtx.adds[g] = setCtx.adds[g] || {};
      setCtx.adds[g][o] = Math.max(0, (setCtx.adds[g][o] || 0) + Number(a.dataset.d));
      return renderSet();
    }
    const q = e.target.closest('[data-qty]');
    if (q && !q.disabled) { setCtx.qty = Math.max(1, setCtx.qty + Number(q.dataset.d)); return renderSet(); }
    if (e.target.closest('[data-act="set-ok"]')) setConfirm();
  });

  // payment modal
  const pay = $('#m-pay');
  pay.addEventListener('click', (e) => {
    const m = e.target.closest('[data-method]');
    if (m) { payCtx.method = m.dataset.method; renderPayment(); return; }
    const c = e.target.closest('[data-cash]');
    if (c) {
      const t = cartTotals();
      payCtx.cash = c.dataset.cash === 'exact' ? String(t.net) : c.dataset.cash;
      $('#payCash').value = payCtx.cash;
      return updatePayState();
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'pay-ok') confirmPayment();
    else if (act === 'member-find') memberFind();
    else if (act === 'member-clear') { state.cart.customer = null; payCtx.phone = ''; save.cart(); renderPayment(); renderTotals(); }
    else if (act === 'redeem' || act === 'redeem-max') memberRedeem(act === 'redeem-max' ? 'max' : Number(b.dataset.d));
  });
  pay.addEventListener('input', (e) => {
    if (e.target.id === 'memberPhone') { payCtx.phone = e.target.value.replace(/[^\d]/g, ''); return; }
    if (e.target.id !== 'payCash') return;
    const cleaned = cleanNum(e.target.value);
    if (cleaned !== e.target.value) e.target.value = cleaned;
    payCtx.cash = cleaned;
    updatePayState();
  });
  pay.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'memberPhone') memberFind(); });

  // manager modal
  const mm = $('#m-manage');
  mm.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mtab]');
    if (t) { mgr.tab = t.dataset.mtab; return renderManager(); }
    const f = e.target.closest('[data-mcat]');
    if (f) { mgr.catFilter = f.dataset.mcat; return renderManager(); }
    const q = e.target.closest('[data-quick]');
    if (q) {
      const k = q.dataset.quick;
      const n = Number(q.dataset.n);
      return setStock(k, Math.max(0, (state.stock[k] || 0) + n), { reason: n > 0 ? 'restock' : 'count' });
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'item-new') openItemEditor(null);
    else if (act === 'item-edit') openItemEditor(b.dataset.id);
    else if (act === 'avail') setAvailability(b.dataset.id, b.dataset.v);
    else if (act.startsWith('cat-')) catAction(act, b.dataset.id);
    else if (act.startsWith('promo-')) promoAction(act, b.dataset.id, b);
    else if (act.startsWith('pool-')) poolAction(act, b.dataset.id);
    else if (act.startsWith('shop-')) mgrShopAction(act, b);
    else if (act.startsWith('log-')) stockLogAction(act, b);
  });
  mm.addEventListener('change', (e) => {
    const el = e.target;
    const d = el.dataset;
    if (d.stock) return setStock(d.stock, el.value, { reason: 'count' });
    if (d.catname) { const c = IDX.cat[d.catname]; if (c && el.value.trim()) { c.name = el.value.trim(); commitCatalog(); renderManager(); } return; }
    if (d.poolname) { const p = IDX.pool[d.poolname]; if (p && el.value.trim()) { p.name = el.value.trim(); commitCatalog(); } return; }
    if (d.poolcost) { const p = IDX.pool[d.poolcost]; if (p) { p.cost = Math.max(0, num(el.value)); commitCatalog(); } return; }
    if (d.shop) mgrShopChange(el);
    if (d.log) stockLogChange(el);
  });
  mm.addEventListener('focusin', (e) => { if (e.target.dataset.stock && !e.target.readOnly) e.target.select(); });

  // item editor
  const mi = $('#m-item');
  mi.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]');
    if (b && !b.disabled) editorAction(b.dataset.ed, b);
  });
  mi.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind && el.tagName === 'INPUT') setPath(ed.draft, el.dataset.bind, el.value);
  });
  mi.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.bind) return;
    setPath(ed.draft, el.dataset.bind, el.value);
    if (el.tagName === 'SELECT') renderItemEditor();
  });
  $('#imageInput').addEventListener('change', (e) => onImagePicked(e.target.files && e.target.files[0]));

  // history / reports / shifts
  const hist = $('#m-history');
  hist.addEventListener('click', async (e) => {
    const ht = e.target.closest('[data-htab]');
    if (ht) {
      if (ht.dataset.htab === 'report' && !(await requirePerm('reports', 'ดูรายงาน & กำไร'))) return;
      histTab = ht.dataset.htab;
      renderHistory();
      if (histTab === 'report') loadReportRemote();
      return;
    }
    if (histTab === 'report') return reportClick(e);
    if (histTab === 'shift') return shiftHistoryClick(e);
    const d = e.target.closest('[data-day]');
    if (d && !d.disabled) {
      histDate = d.dataset.day === 'today' ? todayKey() : shiftDateKey(histDate, Number(d.dataset.day));
      if (histDate > todayKey()) histDate = todayKey();
      renderHistory();
      if (histScope === 'all') loadRemoteOrders();
      return;
    }
    const sc = e.target.closest('[data-scope]');
    if (sc && !sc.disabled) {
      histScope = sc.dataset.scope;
      renderHistory();
      if (histScope === 'all') loadRemoteOrders();
      return;
    }
    const v = e.target.closest('[data-void]');
    if (v) return voidOrder(v.dataset.void);
    const rc = e.target.closest('[data-receipt]');
    if (rc) { const o = state.orders.find((x) => x.id === rc.dataset.receipt); if (o) showOrderDone(o, true); }
  });
  hist.addEventListener('change', (e) => {
    if (histTab === 'report') return reportChange(e);
    if (e.target.id === 'histDate' && e.target.value) {
      histDate = e.target.value;
      renderHistory();
      if (histScope === 'all') loadRemoteOrders();
    }
  });

  // settings
  const st = $('#m-settings');
  st.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-stab]');
    if (tb) { setTab = tb.dataset.stab; return renderSettings(); }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'save-url') {
      const url = $('#gasUrl').value.trim();
      if (url && !isProxyUrl(url) && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) toast('URL ไม่ใช่ Google Apps Script หรือ /api/sync — ตรวจสอบอีกครั้ง', 'warn', 3500);
      state.settings.gasUrl = url;
      save.settings();
      renderSettings();
      toast('บันทึก URL แล้ว', 'success');
      if (url) syncNow({ silent: true });
    } else if (act === 'test-url') testConnection();
    else if (act === 'sync-all') syncNow();
    else if (act === 'push-full') confirmFullPush();
    else if (act === 'pull') pullState();
    else if (act === 'toggle') {
      const k = b.dataset.key;
      state.settings[k] = !state.settings[k];
      save.settings();
      renderSettings(true);
      if (k === 'autoPush' && state.settings.autoPush && hasStateChanges()) scheduleAutoPush();
    } else if (act === 'save-prefix') {
      const p = sanitizePrefix($('#prefixInput').value);
      if (!p) return toast('รหัสเครื่องใช้ได้เฉพาะ A-Z และ 0-9', 'warn');
      state.settings.devicePrefix = p;
      state.settings.queuePrefix = sanitizePrefix($('#queuePrefixInput').value).slice(0, 3);
      save.settings();
      renderSettings();
      toast(`รหัสเครื่อง: ${p}`, 'success');
    } else if (act === 'save-shop') {
      state.settings.shopName = $('#shopNameInput').value.trim() || 'Maysa.Meekanom';
      state.settings.shopSubtitle = $('#shopSubInput').value.trim();
      save.settings();
      markDirty('settings');
      renderHeader();
      renderSettings();
      toast('บันทึกข้อมูลร้านแล้ว', 'success');
    } else if (act === 'device-mode') setDeviceMode(b.dataset.v);
    else if (act === 'export') exportBackup();
    else if (act === 'share') shareBackup();
    else if (act === 'import') { $('#importInput').value = ''; $('#importInput').click(); }
    else if (act === 'cleanup') cleanupOldOrders();
    else if (act === 'update-app') updateApp();
    else settingsAction(act, b);
  });
  st.addEventListener('change', (e) => settingsChange(e.target));
  $('#importInput').addEventListener('change', (e) => importBackup(e.target.files && e.target.files[0]));

  window.addEventListener('online', () => {
    renderHeader();
    toast('กลับมาออนไลน์แล้ว', 'success');
    syncNow({ silent: true });
    if (hasStateChanges()) scheduleAutoPush();
  });
  window.addEventListener('offline', () => { renderHeader(); toast('ออฟไลน์ — ระบบยังขายได้ตามปกติ', 'warn'); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $$('.modal.open').filter((m) => !['m-confirm', 'm-lock'].includes(m.id));
    if (open.length) open[open.length - 1].classList.remove('open');
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('storage', async (e) => {
    if (!e.key || !e.key.startsWith('pos.v1.')) return;
    state.catalog = normalizeCatalog(lsGet(LS.catalog, null));
    reindex();
    state.stock = sanitizeStock(lsGet(LS.stock, null), state.catalog);
    state.queue = lsGet(LS.queue, []);
    state.parked = lsGet(LS.parked, []) || [];
    state.orders = await OrderStore.load();
    if (state.settings.deviceMode !== 'kds') renderAll();
  });
}

async function init() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon, 20); });
  if (state.migrated) {
    save.catalog();
    save.stock();
    save.cart();
  }
  save.settings();
  state.orders = await OrderStore.load();
  bindEvents();
  renderClock();
  setInterval(renderClock, 1000);
  const kds = state.settings.deviceMode === 'kds';
  document.body.classList.toggle('mode-kds', kds);
  if (kds) startKDS(); else renderAll();
  if (!kds && state.catalog.staff.length && !state.session) showLock();

  try {
    state.images = await ImageStore.getAll();
    await shrinkLegacyImages();
    if (!kds) renderMenu();
  } catch (e) {
    console.warn('image load failed', e);
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSW();

  const hasUrl = () => !!(state.settings.gasUrl || '').trim();
  setTimeout(async () => {
    if (state.settings.autoPull && hasUrl() && navigator.onLine) {
      const ok = await pullState({ silent: true });
      if (ok) toast('ซิงก์เมนูและสต็อกล่าสุดจาก Cloud แล้ว ✓', 'success');
    } else {
      syncNow({ silent: true });
      if (hasStateChanges()) scheduleAutoPush();
    }
  }, 1500);
  setInterval(() => { if (state.queue.length && navigator.onLine) syncNow({ silent: true }); }, 60000);

  let hiddenAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (state.queue.length) syncNow({ silent: true });
    if (state.settings.deviceMode === 'kds') return kdsPoll();
    if (state.settings.autoPull && hasUrl() && !state.cart.lines.length && Date.now() - hiddenAt > 3 * 60000) pullState({ silent: true });
  });
}

document.addEventListener('DOMContentLoaded', init);

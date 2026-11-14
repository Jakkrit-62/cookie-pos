/* ==========================================================================
   iPad POS — app.js  (v2: dynamic catalog + multi-device cloud sync)
   Offline-first point-of-sale: catalog, promo engine, stock pools, images,
   order sync queue and two-way state sync with Google Sheets.
   No build step: plain ES2018+ that runs on iPadOS Safari 14+.
   ========================================================================== */
'use strict';

const APP_VERSION = '2.0.0';

/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

const UNIT_LABEL = { pcs: 'ชิ้น', g: 'กรัม', scoop: 'สกู๊ป' };
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
const PAY_METHODS = {
  cash: { label: 'เงินสด', en: 'Cash', icon: 'cash' },
  qr: { label: 'สแกน QR', en: 'QR Code', icon: 'qr' },
  tcp: { label: 'ไทยช่วยไทยพลัส', en: 'Thai Chuay Thai Plus', icon: 'gov' },
};
const PAY_LABEL_TO_KEY = { 'เงินสด': 'cash', 'สแกน QR': 'qr', 'ไทยช่วยไทยพลัส': 'tcp' };

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
      { id: 'soft', name: 'ซอฟต์คุกกี้', hidden: false, promoId: 'p_soft' },
      { id: 'cereal', name: 'ซีเรียลคุกกี้', hidden: false, promoId: '' },
      { id: 'gooey', name: 'Gooey & ไอศกรีม', hidden: false, promoId: '' },
      { id: 'puff', name: 'ครีมพัฟ & ชูครีม', hidden: false, promoId: '' },
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
      item({ id: 'puff_osaka', name: 'Osaka Cream Puff', categoryId: 'puff', mode: 'unit', price: 29, stockPool: 'puff_osaka', promoId: 'p_puff' }),
      item({ id: 'choux_cream', name: 'ชูครีม (Choux Cream)', categoryId: 'puff', mode: 'unit', price: 12, stockPool: 'choux_cream', promoId: 'p_choux' }),
    ],
    promos: [
      { id: 'p_soft', name: 'โปรซอฟต์คุกกี้ 3 ชิ้น 100', size: 3, price: 100, active: true },
      { id: 'p_puff', name: 'โปรครีมพัฟ 4 ชิ้น 99', size: 4, price: 99, active: true },
      { id: 'p_choux', name: 'โปรชูครีม 5 ชิ้น 50', size: 5, price: 50, active: true },
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
    promoId: String(x.promoId || ''),
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

function normalizeCatalog(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.items)) return buildSeedCatalog();
  const out = {
    schema: 1,
    updatedAt: String(c.updatedAt || ''),
    categories: (c.categories || []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || 'หมวดหมู่'), hidden: !!x.hidden, promoId: String(x.promoId || ''),
    })),
    pools: (c.pools || []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || x.id), unit: UNIT_LABEL[x.unit] ? x.unit : 'pcs',
    })),
    promos: (c.promos || []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || 'โปรโมชั่น'), size: Math.max(2, toInt(x.size) || 2),
      price: Math.max(0, num(x.price)), active: x.active !== false,
    })),
    items: c.items.filter((x) => x && x.id).map(normalizeItem),
  };
  if (!out.categories.length) out.categories.push({ id: 'general', name: 'ทั่วไป', hidden: false, promoId: '' });
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
const poolUnit = (id) => (IDX.pool[id] ? UNIT_LABEL[IDX.pool[id].unit] : '');

function itemAvailability(it) {
  const cat = IDX.cat[it.categoryId];
  if (it.availability === 'hidden' || (cat && cat.hidden)) return 'hidden';
  if (it.availability === 'soldout' && it.soldOutDate === todayKey()) return 'soldout';
  return 'normal';
}
function visibleCategories() {
  return state.catalog.categories.filter((c) => !c.hidden);
}
function effectivePromo(it) {
  if (!it || it.mode !== 'unit') return null;
  let pid = it.promoId;
  if (pid === 'none') return null;
  if (!pid) { const c = IDX.cat[it.categoryId]; pid = c ? c.promoId : ''; }
  const p = IDX.promo[pid];
  return p && p.active ? p : null;
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
  orders: 'pos.v1.orders',
  queue: 'pos.v1.queue',
  settings: 'pos.v1.settings',
  cart: 'pos.v1.cart',
  syncMeta: 'pos.v1.syncMeta',
  remote: 'pos.v1.remoteOrders',
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

const defaultSettings = () => ({
  gasUrl: '',
  shopName: 'Maysa.Meekanom',
  shopSubtitle: 'HOMEMADE BAKERY & COOKIES',
  devicePrefix: 'IPAD1',
  autoPush: true,
  autoPull: false,
  lastSyncAt: '',
  lastSyncError: '',
});
const defaultSyncMeta = () => ({
  catalogDirty: 0, settingsDirty: 0, stockDirty: {}, imagesDirty: {},
  lastPushAt: '', lastPullAt: '', lastStateError: '',
});

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
  const cart = Object.assign({ lines: [], manualDiscount: '' }, lsGet(LS.cart, {}));
  const orders = lsGet(LS.orders, []);
  const queue = lsGet(LS.queue, []);
  return {
    catalog,
    migrated: !rawCatalog,
    stock: sanitizeStock(lsGet(LS.stock, null), catalog),
    orders: Array.isArray(orders) ? orders : [],
    queue: Array.isArray(queue) ? queue : [],
    settings,
    syncMeta: Object.assign(defaultSyncMeta(), lsGet(LS.syncMeta, {})),
    remoteOrders: lsGet(LS.remote, {}) || {},
    cart: { lines: Array.isArray(cart.lines) ? cart.lines : [], manualDiscount: cart.manualDiscount || '' },
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
  orders: () => lsSet(LS.orders, state.orders),
  queue: () => lsSet(LS.queue, state.queue),
  settings: () => lsSet(LS.settings, state.settings),
  cart: () => lsSet(LS.cart, state.cart),
  syncMeta: () => lsSet(LS.syncMeta, state.syncMeta),
  remote: () => lsSet(LS.remote, state.remoteOrders),
};

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
 * Bill calculation. Mix-and-match bundles: units in the same promo are sorted by price
 * (highest first) and grouped into bundles of `size`; each bundle costs `price`.
 */
function calcTotals(lines, manualInput) {
  const subtotal = round2(lines.reduce((s, l) => s + lineGross(l), 0));
  const groups = {};
  for (const l of lines) {
    if (l.type !== 'unit') continue;
    const it = IDX.item[l.menuId];
    const p = effectivePromo(it);
    if (!p) continue;
    groups[p.id] = groups[p.id] || [];
    for (let i = 0; i < l.qty; i++) groups[p.id].push(it.price);
  }
  const promos = state.catalog.promos.filter((p) => groups[p.id]).map((p) => {
    const prices = groups[p.id].sort((a, b) => b - a);
    const bundles = Math.floor(prices.length / p.size);
    let discount = 0;
    for (let b = 0; b < bundles; b++) {
      const sum = prices.slice(b * p.size, (b + 1) * p.size).reduce((s, x) => s + x, 0);
      discount += Math.max(0, sum - p.price);
    }
    return { key: p.id, label: p.name, bundles, discount: round2(discount) };
  }).filter((p) => p.bundles > 0 && p.discount > 0);
  const promoDiscount = round2(promos.reduce((s, p) => s + p.discount, 0));
  const itemDiscount = round2(lines.reduce((s, l) => s + lineItemDiscount(l), 0));
  const afterAuto = Math.max(0, round2(subtotal - promoDiscount - itemDiscount));
  const manualRequested = Math.max(0, round2(parseFloat(manualInput) || 0));
  const manualDiscount = Math.min(manualRequested, afterAuto);
  return {
    subtotal, promos, promoDiscount, itemDiscount,
    manualRequested, manualDiscount,
    totalDiscount: round2(promoDiscount + itemDiscount + manualDiscount),
    net: round2(afterAuto - manualDiscount),
  };
}

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
      low: isFinite(a) && a > 0 && a <= 5,
    };
  }
  if (it.mode === 'weight') {
    const a = av(it.stockPool);
    return {
      soldOut: manual || real(it.stockPool) < it.minGrams,
      blocked: a < it.minGrams,
      manual,
      badge: it.stockPool ? `${fmtNum(Math.max(0, a))} กรัม` : 'พร้อมขาย',
      low: isFinite(a) && a >= it.minGrams && a < 200,
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
    low: isFinite(sets) && sets > 0 && sets <= 3,
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
  const p = effectivePromo(it);
  if (p) return `${p.size} ชิ้น ฿${fmtNum(p.price)}`;
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

  if (!lines.length) {
    $('#cartList').innerHTML = `<div class="cart-empty">${svg('cart', 48)}<div>ยังไม่มีสินค้าในออเดอร์<br/>แตะที่เมนูเพื่อเพิ่ม</div></div>`;
  } else {
    $('#cartList').innerHTML = lines.map((l) => {
      const gross = lineGross(l);
      const disc = lineItemDiscount(l);
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
          <div class="cl-detail">${esc(lineDetail(l))}</div>
          <div class="cl-actions">${controls}<span class="grow"></span>
            <button class="icon-btn danger" data-act="remove" data-id="${l.id}" type="button" aria-label="ลบ">${svg('trash')}</button>
          </div>
        </div>`;
    }).join('');
  }
  renderTotals();
}

function renderTotals() {
  const t = calcTotals(state.cart.lines, state.cart.manualDiscount);
  $('#sumSubtotal').textContent = money(t.subtotal);
  let html = '';
  if (!t.promos.length) {
    html += `<div class="sum-row muted"><span>ส่วนลดโปรโมชั่นอัตโนมัติ</span><span>฿0</span></div>`;
  } else {
    html += `<div class="sum-row discount"><span>ส่วนลดโปรโมชั่นอัตโนมัติ</span><span>${negMoney(t.promoDiscount)}</span></div>`;
    html += t.promos.map((p) => `<div class="sum-row sub"><span>• ${esc(p.label)} × ${p.bundles}</span><span>${negMoney(p.discount)}</span></div>`).join('');
  }
  if (t.itemDiscount > 0) html += `<div class="sum-row discount"><span>ส่วนลดเฉพาะรายการ</span><span>${negMoney(t.itemDiscount)}</span></div>`;
  $('#promoRows').innerHTML = html;
  $('#manualNote').textContent = t.manualRequested > t.manualDiscount
    ? `ส่วนลดเพิ่มเติมถูกจำกัดไว้ที่ ${money(t.manualDiscount)} (ไม่เกินยอดคงเหลือ)` : '';
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
  state.cart.lines = [];
  state.cart.manualDiscount = '';
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

function openPayment() {
  if (!state.cart.lines.length) return;
  const short = cartShortages();
  if (short.length) return toast(`สต็อกไม่พอ: ${shortageText(short)} — กรุณาแก้ไขตะกร้า`, 'error', 5000);
  payCtx = { method: null, cash: '', busy: false, openedAt: new Date() };
  renderPayment();
  openModal('m-pay');
}

function renderPayment() {
  const t = calcTotals(state.cart.lines, state.cart.manualDiscount);
  const modal = $('#m-pay');
  const items = state.cart.lines.map((l) => `
    <div class="pay-item">
      <div><div>${esc(lineTitle(l))}</div><div class="pi-detail">${esc(lineDetail(l))}</div></div>
      <div class="nowrap">${money(lineGross(l) - lineItemDiscount(l))}</div>
    </div>`).join('');

  modal.querySelector('.modal-body').innerHTML = `
    <div class="pay-layout">
      <div>
        <div class="section-title">สรุปรายการ <small>${fmtDateTime(payCtx.openedAt)}</small></div>
        <div class="pay-items">${items}</div>
        <div style="margin-top:8px">
          <div class="sum-row"><span>ยอดรวมก่อนลด</span><span>${money(t.subtotal)}</span></div>
          ${t.promos.map((p) => `<div class="sum-row discount"><span>${esc(p.label)} × ${p.bundles}</span><span>${negMoney(p.discount)}</span></div>`).join('')}
          ${t.itemDiscount ? `<div class="sum-row discount"><span>ส่วนลดเฉพาะรายการ</span><span>${negMoney(t.itemDiscount)}</span></div>` : ''}
          ${t.manualDiscount ? `<div class="sum-row discount"><span>ส่วนลดเพิ่มเติม</span><span>${negMoney(t.manualDiscount)}</span></div>` : ''}
        </div>
        <div class="pay-net"><span class="section-title" style="margin:0">ยอดชำระสุทธิ</span><b>${money(t.net)}</b></div>
      </div>
      <div>
        <div class="section-title">เลือกวิธีชำระเงิน</div>
        <div class="pay-methods">
          ${Object.keys(PAY_METHODS).map((k) => `
            <button class="pay-btn ${payCtx.method === k ? 'selected' : ''}" data-method="${k}" type="button">
              <span class="pay-ic">${svg(PAY_METHODS[k].icon, 26)}</span>
              <span>${PAY_METHODS[k].label}<small>${PAY_METHODS[k].en}</small></span>
            </button>`).join('')}
        </div>
        ${payCtx.method === 'cash' ? `
          <div class="cash-panel">
            <label class="field-label" for="payCash">รับเงินมา (ไม่บังคับ)</label>
            <input class="input" id="payCash" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(payCtx.cash)}" />
            <div class="cash-quick">
              <button class="btn btn-outline btn-sm" data-cash="exact" type="button">พอดี</button>
              <button class="btn btn-outline btn-sm" data-cash="100" type="button">฿100</button>
              <button class="btn btn-outline btn-sm" data-cash="500" type="button">฿500</button>
              <button class="btn btn-outline btn-sm" data-cash="1000" type="button">฿1,000</button>
            </div>
            <div class="change-due" id="changeDue"></div>
          </div>` : ''}
      </div>
    </div>`;
  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost btn-lg" data-close type="button">กลับไปแก้ไข</button>
    <button class="btn btn-primary btn-lg" id="btnPayConfirm" data-act="pay-ok" type="button">ยืนยันการชำระเงิน · ${money(t.net)}</button>`;
  updatePayState();
}

function updatePayState() {
  const t = calcTotals(state.cart.lines, state.cart.manualDiscount);
  const btn = $('#btnPayConfirm');
  let ok = !!payCtx.method && !payCtx.busy;
  const due = $('#changeDue');
  if (payCtx.method === 'cash' && due) {
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

function buildOrderItems(lines) {
  return lines.map((l, i) => {
    const it = IDX.item[l.menuId];
    const cat = IDX.cat[it.categoryId];
    const gross = lineGross(l);
    const itemDiscount = lineItemDiscount(l);
    const sel = l.type === 'set' ? setSelections(it, l) : { options: [], addOns: [] };
    return {
      lineNo: i + 1,
      type: l.type,
      menuId: l.menuId,
      category: cat ? cat.name : '',
      name: lineTitle(l),
      detail: lineDetail(l),
      qty: l.type === 'weight' ? 1 : l.qty,
      unitPrice: l.type === 'unit' ? it.price : l.type === 'set' ? setUnitPrice(it, l) : it.pricePerGram,
      soldG: l.soldG || 0,
      freeG: l.freeG || 0,
      options: sel.options,
      addOns: sel.addOns.map((a) => ({ name: a.name, n: a.n })),
      gross,
      itemDiscount,
      net: round2(gross - itemDiscount),
      needs: lineNeeds(l),
    };
  });
}

function confirmPayment() {
  if (!payCtx || payCtx.busy || !payCtx.method) return;
  const short = cartShortages();
  if (short.length) return toast(`สต็อกไม่พอ: ${shortageText(short)}`, 'error', 5000);
  const t = calcTotals(state.cart.lines, state.cart.manualDiscount);
  let cashReceived = null, change = null;
  if (payCtx.method === 'cash' && payCtx.cash !== '') {
    cashReceived = round2(parseFloat(payCtx.cash) || 0);
    change = round2(cashReceived - t.net);
    if (change < 0) return toast('รับเงินไม่พอ', 'error');
  }
  payCtx.busy = true;
  updatePayState();

  const now = new Date();
  const order = {
    id: nextOrderId(now),
    createdAtISO: isoLocal(now),
    createdAtUTC: now.toISOString(),
    createdAtTH: fmtDateTime(now),
    date: dateKey(now),
    device: state.settings.devicePrefix,
    items: buildOrderItems(state.cart.lines),
    subtotal: t.subtotal,
    promos: t.promos,
    promoDiscount: t.promoDiscount,
    itemDiscount: t.itemDiscount,
    manualDiscount: t.manualDiscount,
    totalDiscount: t.totalDiscount,
    net: t.net,
    payment: { method: payCtx.method, label: PAY_METHODS[payCtx.method].label, cashReceived, change },
    stockDeduction: cartNeeds(),
    status: 'COMPLETED',
    synced: false,
    voidedAtISO: '',
    voidedAtTH: '',
    voidReason: '',
    voidSynced: false,
  };

  state.orders.push(order);
  if (!save.orders()) {
    state.orders.pop();
    payCtx.busy = false;
    updatePayState();
    return;
  }
  for (const k in order.stockDeduction) state.stock[k] = Math.max(0, (state.stock[k] || 0) - order.stockDeduction[k]);
  save.stock();
  enqueue('NEW_ORDER', order.id);
  state.cart.lines = [];
  state.cart.manualDiscount = '';
  $('#manualDiscount').value = '';
  save.cart();

  closeModal('m-pay');
  renderAll();
  toast(`ชำระเงินสำเร็จ ${order.id}${change != null ? ` · เงินทอน ${money(change)}` : ''}`, 'success', 4000);
  syncNow({ silent: true });
}

/* ==========================================================================
   14. HISTORY, SALES SUMMARY & VOID
   ========================================================================== */

let histDate = todayKey();
let histScope = 'local'; // 'local' | 'all'
let histLoading = false;

function openHistory() {
  histDate = todayKey();
  renderHistory();
  openModal('m-history');
  if (histScope === 'all') loadRemoteOrders();
}

/** Sheet row → order-like object for display (read-only) */
function normalizeRemoteOrder(r) {
  const label = r.Payment_Method || '';
  return {
    id: String(r.Order_ID || ''),
    remote: true,
    status: r.Status === 'VOIDED' ? 'VOIDED' : 'COMPLETED',
    date: String(r.Date || ''),
    createdAtTH: String(r.Date_Time || ''),
    createdAtISO: String(r.Timestamp_ISO || ''),
    itemsDetail: String(r.Items_Detail || ''),
    items: null,
    subtotal: num(r.Subtotal),
    promoDiscount: num(r.Promo_Discount),
    itemDiscount: num(r.Item_Discount),
    manualDiscount: num(r.Manual_Discount),
    totalDiscount: num(r.Total_Discount),
    net: num(r.Net_Total),
    payment: {
      method: r.Payment_Key || PAY_LABEL_TO_KEY[label] || 'cash',
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
  const orders = ordersForHistory().sort((a, b) => ((a.createdAtISO || '') < (b.createdAtISO || '') ? 1 : -1));
  const done = orders.filter((o) => o.status !== 'VOIDED');
  const voided = orders.length - done.length;
  const sum = (arr, f) => round2(arr.reduce((s, o) => s + f(o), 0));
  const byMethod = (m) => sum(done.filter((o) => o.payment.method === m), (o) => o.net);
  const countMethod = (m) => done.filter((o) => o.payment.method === m).length;

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
      ? o.items.map((i) => `<div><b>${esc(i.name)}</b> — ${esc(i.detail)}</div>`).join('')
      : o.itemsDetail.split(' | ').map((s) => `<div>${esc(s)}</div>`).join('');
    const [d, t] = (o.createdAtTH || ' ').split(' ');
    return `
    <tr class="${o.status === 'VOIDED' ? 'voided' : ''}">
      <td class="oid">${esc(o.id)}</td>
      <td class="nowrap">${esc(d)}<div class="help" style="margin:0">${esc(t || '')}</div></td>
      <td class="items-cell">${itemsHtml}</td>
      <td class="num strike">${money(o.subtotal)}</td>
      <td class="num strike">${negMoney(o.promoDiscount + o.itemDiscount)}${o.itemDiscount ? `<div class="help">รวมลดรายการ ${money(o.itemDiscount)}</div>` : ''}</td>
      <td class="num strike">${negMoney(o.manualDiscount)}</td>
      <td class="num strike"><b>${money(o.net)}</b></td>
      <td>${esc(o.payment.label)}${o.payment.cashReceived != null ? `<div class="help">รับ ${money(o.payment.cashReceived)}<br/>ทอน ${money(o.payment.change)}</div>` : ''}</td>
      <td>${orderSyncPill(o)}</td>
      <td>${o.status === 'VOIDED'
        ? `<span class="pill pill-void">ยกเลิกบิล</span><div class="help">${esc(o.voidedAtTH)}${o.voidReason ? `<br/>${esc(o.voidReason)}` : ''}</div>`
        : `<span class="pill pill-ok">ปกติ</span>${o.remote ? `<div class="help">ยกเลิกได้ที่เครื่อง ${esc(o.device)}</div>` : `<div style="margin-top:8px"><button class="btn btn-danger btn-sm" data-void="${esc(o.id)}" type="button">ยกเลิกบิล</button></div>`}`}</td>
    </tr>`;
  }).join('');

  paint(modal.querySelector('.modal-body'), `
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
      <div class="stat"><div class="k">เงินสด</div><div class="v">${money(byMethod('cash'))}</div><div class="s">${countMethod('cash')} บิล</div></div>
      <div class="stat"><div class="k">สแกน QR</div><div class="v">${money(byMethod('qr'))}</div><div class="s">${countMethod('qr')} บิล</div></div>
      <div class="stat"><div class="k">ไทยช่วยไทยพลัส</div><div class="v">${money(byMethod('tcp'))}</div><div class="s">${countMethod('tcp')} บิล</div></div>
      <div class="stat"><div class="k">ส่วนลดรวมทั้งหมด</div><div class="v">${money(sum(done, (o) => o.totalDiscount))}</div>
        <div class="s">โปร ${money(sum(done, (o) => o.promoDiscount))} · รายการ ${money(sum(done, (o) => o.itemDiscount))} · เพิ่มเติม ${money(sum(done, (o) => o.manualDiscount))}</div></div>
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
            <th>Order_ID</th><th>วันที่/เวลา</th><th>รายการ</th><th class="num">ยอดรวม</th><th class="num">ส่วนลดโปร</th>
            <th class="num">ส่วนลดเพิ่ม</th><th class="num">สุทธิ</th><th>ชำระโดย</th><th>Sync</th><th>สถานะ</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `<div class="empty-state">${svg('receipt', 48)}<p>ไม่มีบิลในวันที่เลือก</p></div>`}`);
}

async function voidOrder(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status === 'VOIDED') return;
  const restore = Object.keys(o.stockDeduction || {}).map((k) => `${poolName(k)} +${fmtNum(o.stockDeduction[k])} ${poolUnit(k)}`);
  const r = await confirmDialog({
    title: `ยกเลิกบิล ${o.id}`,
    html: `<p>ยอด <b>${money(o.net)}</b> (${esc(o.payment.label)}) จะถูกยกเลิกและไม่นับรวมในยอดขาย</p>
           <p class="help">สต็อกที่จะคืนกลับ: ${esc(restore.join(', ') || '-')}</p>`,
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
  o.voidSynced = false;
  for (const k in o.stockDeduction || {}) state.stock[k] = (state.stock[k] || 0) + o.stockDeduction[k];
  save.orders();
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

function openManager(tab) {
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
  ];
  const body = $('#m-manage .modal-body');
  const content = mgr.tab === 'cats' ? mgrCatsHTML() : mgr.tab === 'promos' ? mgrPromosHTML() : mgr.tab === 'stock' ? mgrStockHTML() : mgrMenuHTML();
  paint(body, `
    <div class="mgr-tabs">
      ${tabs.map(([id, label, ic, n]) => `<button class="mgr-tab ${mgr.tab === id ? 'on' : ''}" data-mtab="${id}" type="button">${svg(ic, 18)} ${label}<span class="cnt">${n}</span></button>`).join('')}
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
  const p = effectivePromo(it);
  if (p) parts.push(p.name);
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
function promoOptions(selected) {
  return `<option value="" ${!selected ? 'selected' : ''}>— ไม่มีโปรของหมวด —</option>
    ${state.catalog.promos.map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? 'selected' : ''}>${esc(p.name)}${p.active ? '' : ' (ปิดอยู่)'}</option>`).join('')}`;
}
function mgrCatsHTML() {
  const cats = state.catalog.categories;
  return `
    <p class="help" style="margin:0 0 12px">ลำดับหมวดหมู่ = ลำดับแท็บบนหน้าขาย · โปรของหมวดใช้กับทุกเมนู “ขายเป็นชิ้น” ในหมวด (เว้นแต่เมนูนั้นตั้งโปรเอง)</p>
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
        <label class="mgr-field"><span class="help">โปรของหมวด</span>
          <select class="input" data-catpromo="${esc(c.id)}">${promoOptions(c.promoId)}</select></label>
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
    cats.push({ id: `c_${uid()}`, name, hidden: false, promoId: '' });
  } else if (i < 0) {
    return;
  } else if (act === 'cat-up' && i > 0) {
    [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
  } else if (act === 'cat-down' && i < cats.length - 1) {
    [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
  } else if (act === 'cat-toggle') {
    cats[i].hidden = !cats[i].hidden;
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

/* ---------- Promotions tab ---------- */
function promoMembers(pid) {
  return state.catalog.items.filter((it) => { const p = effectivePromo(it); return p && p.id === pid; });
}
function mgrPromosHTML() {
  const unitItems = state.catalog.items.filter((it) => it.mode === 'unit');
  return `
    <p class="help" style="margin:0 0 12px">โปรคละได้ (Mix &amp; Match): ครบ X ชิ้นจากเมนูที่เลือก = Y บาท · ระบบจับชุดจากชิ้นที่ราคาสูงสุดก่อน · ใช้ได้กับเมนู “ขายเป็นชิ้น”</p>
    ${state.catalog.promos.map((p) => {
      const members = new Set(state.catalog.items.filter((it) => {
        if (it.mode !== 'unit' || it.promoId === 'none') return false;
        const pid = it.promoId || (IDX.cat[it.categoryId] ? IDX.cat[it.categoryId].promoId : '');
        return pid === p.id;
      }).map((x) => x.id));
      const prices = [...members].map((id) => IDX.item[id].price);
      const sample = prices.length ? Math.max(...prices) * p.size : 0;
      return `
      <div class="promo-card ${p.active ? '' : 'is-off'}">
        <div class="promo-head">
          <input class="input grow" data-promo="${esc(p.id)}" data-f="name" type="text" value="${esc(p.name)}" />
          <button class="btn ${p.active ? 'btn-ok' : 'btn-ghost'}" data-act="promo-toggle" data-id="${esc(p.id)}" type="button">${p.active ? 'เปิดใช้งาน' : 'ปิดอยู่'}</button>
          <button class="icon-btn danger" data-act="promo-del" data-id="${esc(p.id)}" type="button" aria-label="ลบโปร">${svg('trash')}</button>
        </div>
        <div class="promo-rule">
          <span>ครบ</span><input class="input num-in" data-promo="${esc(p.id)}" data-f="size" type="number" inputmode="numeric" min="2" value="${p.size}" /><span>ชิ้น</span>
          <span>ราคา</span><input class="input num-in" data-promo="${esc(p.id)}" data-f="price" type="number" inputmode="decimal" min="0" value="${p.price}" /><span>บาท</span>
          ${sample ? `<span class="help">ตัวอย่าง: ปกติ ${money(sample)} → ${money(p.price)} (ลด ${money(Math.max(0, sample - p.price))}/ชุด)</span>` : ''}
        </div>
        <div class="help" style="margin:8px 0 4px">เมนูที่ร่วมโปรนี้ (${members.size})</div>
        <div class="member-grid">
          ${unitItems.map((it) => `
            <label class="member ${members.has(it.id) ? 'on' : ''}">
              <input type="checkbox" data-member="${esc(p.id)}" data-item="${esc(it.id)}" ${members.has(it.id) ? 'checked' : ''} />
              <span>${esc(it.name)} <small>${money(it.price)}</small></span>
            </label>`).join('')}
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">ยังไม่มีโปรโมชั่น</div>'}
    <div class="mgr-add"><button class="btn btn-primary" data-act="promo-add" type="button">${svg('plus', 18)} เพิ่มโปรโมชั่นคละได้</button></div>`;
}

function togglePromoMember(pid, itemId, on) {
  const it = IDX.item[itemId];
  if (!it) return;
  const cat = IDX.cat[it.categoryId];
  const catPid = cat ? cat.promoId : '';
  if (on) it.promoId = catPid === pid ? '' : pid;
  else it.promoId = catPid === pid ? 'none' : '';
  commitCatalog();
  renderManager();
}

async function promoAction(act, id) {
  const promos = state.catalog.promos;
  if (act === 'promo-add') {
    promos.push({ id: `p_${uid()}`, name: 'โปรใหม่ 2 ชิ้น', size: 2, price: 0, active: true });
  } else if (act === 'promo-toggle') {
    const p = IDX.promo[id];
    if (p) p.active = !p.active;
  } else if (act === 'promo-del') {
    const p = IDX.promo[id];
    if (!p) return;
    const r = await confirmDialog({ title: 'ลบโปรโมชั่น', html: `ลบ <b>${esc(p.name)}</b> ? เมนูที่ผูกไว้จะไม่ร่วมโปรนี้อีก`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    state.catalog.promos = promos.filter((x) => x.id !== id);
    state.catalog.categories.forEach((c) => { if (c.promoId === id) c.promoId = ''; });
    state.catalog.items.forEach((it) => { if (it.promoId === id) it.promoId = ''; });
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

  const row = (id) => {
    const p = IDX.pool[id];
    const refs = poolRefs(id);
    const quick = p.unit === 'g' ? [[-100, '-100g'], [100, '+100g'], [500, '+500g']] : [[-1, '-1'], [5, '+5'], [10, '+10']];
    const thumbId = refs.length && refs[0].stockPool === id ? refs[0].id : '';
    const img = thumbId && state.images[thumbId];
    return `
      <div class="stock-row" data-row="${esc(id)}">
        <div class="stock-thumb ${img ? '' : 'none'}">${img ? `<img src="${img}" alt="" />` : svg('box', 26)}</div>
        <div>
          <input class="input pool-name" data-poolname="${esc(id)}" type="text" value="${esc(p.name)}" />
          <div class="stock-meta">หน่วย: ${UNIT_LABEL[p.unit]} · ใช้กับ: ${refs.length ? esc(refs.map((r) => r.name).join(', ')) : '—'}</div>
        </div>
        <div class="stock-input-wrap">
          <input class="stock-input ${state.stock[id] <= 0 ? 'zero' : ''}" data-stock="${esc(id)}" type="number" inputmode="numeric" min="0" step="1" value="${state.stock[id] || 0}" />
          <span class="stock-unit">${UNIT_LABEL[p.unit]}</span>
        </div>
        <div class="quick-add">
          ${quick.map(([n, label]) => `<button class="${n < 0 ? 'minus' : ''}" data-quick="${esc(id)}" data-n="${n}" type="button">${label}</button>`).join('')}
          ${refs.length ? '' : `<button class="minus" data-act="pool-del" data-id="${esc(id)}" type="button" aria-label="ลบ">${svg('trash', 18)}</button>`}
        </div>
      </div>`;
  };
  return `
    ${groups.map((g) => `<div class="stock-group"><h3>${esc(g.title)}</h3>${g.pools.map(row).join('')}</div>`).join('')}
    <div class="stock-group">
      <h3>เพิ่ม Stock Pool ใช้ร่วม <small>เช่น วัตถุดิบที่หลายเมนูใช้ร่วมกัน (ไอศกรีม, คุกกี้ในเซ็ต)</small></h3>
      <div class="mgr-add">
        <input class="input grow" id="newPoolName" type="text" placeholder="ชื่อ Stock Pool เช่น ไอศกรีมช็อกโกแลต" />
        <select class="input" id="newPoolUnit" style="width:140px">${Object.keys(UNIT_LABEL).map((u) => `<option value="${u}">${UNIT_LABEL[u]}</option>`).join('')}</select>
        <button class="btn btn-primary" data-act="pool-add" type="button">${svg('plus', 18)} เพิ่ม</button>
      </div>
    </div>`;
}

function setStock(key, value, flash = true) {
  state.stock[key] = toInt(value);
  save.stock();
  markDirty('stock', key);
  const row = $$('#m-manage [data-row]').find((r) => r.dataset.row === key);
  if (row) {
    const input = row.querySelector('.stock-input');
    if (document.activeElement !== input) input.value = state.stock[key];
    input.classList.toggle('zero', state.stock[key] <= 0);
    if (flash) { row.classList.remove('flash-ok'); void row.offsetWidth; row.classList.add('flash-ok'); }
  }
  renderMenu();
  renderCart();
}

async function poolAction(act, id) {
  if (act === 'pool-add') {
    const name = ($('#newPoolName').value || '').trim();
    if (!name) return toast('กรุณาใส่ชื่อ Stock Pool', 'warn');
    const pid = `pool_${uid()}`;
    state.catalog.pools.push({ id: pid, name, unit: $('#newPoolUnit').value || 'pcs' });
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
    ${state.catalog.pools.map((p) => `<option value="${esc(p.id)}" ${value === p.id ? 'selected' : ''}>${esc(p.name)} (${UNIT_LABEL[p.unit]})</option>`).join('')}
  </select>`;
}

function renderItemEditor() {
  const d = ed.draft;
  const img = ed.image !== undefined ? ed.image : state.images[d.id];
  const cat = IDX.cat[d.categoryId];
  const catPromo = cat && IDX.promo[cat.promoId];
  const isUnitPool = (p) => p.unit !== 'g' && p.id !== d.id;
  const isGramPool = (p) => p.unit === 'g' && p.id !== d.id;
  const ownExists = !ed.isNew && IDX.pool[d.id];
  const ownLabel = ownExists ? `สต็อกของเมนูนี้เอง (คงเหลือ ${fmtNum(state.stock[d.id] || 0)})` : 'สร้างสต็อกของเมนูนี้เอง';
  const bindSelect = (filter) => `
    <select class="input" data-bind="_bind">
      <option value="__own__" ${d._bind === '__own__' ? 'selected' : ''}>${esc(ownLabel)}</option>
      <option value="" ${d._bind === '' ? 'selected' : ''}>— ไม่ตัดสต็อก (ขายได้ไม่จำกัด) —</option>
      <optgroup label="ใช้ Stock Pool ร่วม">
        ${state.catalog.pools.filter(filter).map((p) => `<option value="${esc(p.id)}" ${d._bind === p.id ? 'selected' : ''}>${esc(p.name)} (${UNIT_LABEL[p.unit]})</option>`).join('')}
      </optgroup>
    </select>`;

  let modeHtml = '';
  if (d.mode === 'unit') {
    modeHtml = `
      <div class="ed-row">
        <label class="ed-field"><span>ราคาต่อชิ้น (บาท)</span><input class="input" data-bind="price" type="number" inputmode="decimal" min="0" value="${esc(d.price)}" /></label>
        <label class="ed-field"><span>การผูกสต็อก</span>${bindSelect(isUnitPool)}</label>
      </div>
      <label class="ed-field"><span>โปรโมชั่นคละได้</span>
        <select class="input" data-bind="promoId">
          <option value="" ${!d.promoId ? 'selected' : ''}>ตามหมวดหมู่${catPromo ? ` (${esc(catPromo.name)})` : ' (ไม่มี)'}</option>
          <option value="none" ${d.promoId === 'none' ? 'selected' : ''}>ไม่ร่วมโปรโมชั่น</option>
          ${state.catalog.promos.map((p) => `<option value="${esc(p.id)}" ${d.promoId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>`;
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
  if (!existing) state.catalog.categories.push({ id, name, hidden: false, promoId: '' });
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
  if (d.mode !== 'unit' && d.promoId !== 'none') d.promoId = '';

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

function enqueue(action, orderId) {
  state.queue.push({ qid: uid(), action, orderId, createdAt: isoLocal(new Date()), attempts: 0, lastError: '' });
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
    stockDeduction: o.stockDeduction || {},
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
    })),
  };
}

function buildAction(q) {
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

/**
 * POST as text/plain (a "simple" request → no CORS preflight). Apps Script replies with
 * Access-Control-Allow-Origin:* so the JSON is normally readable. If it isn't (and the
 * caller does not need the response), retry in no-cors mode and treat it as delivered —
 * every write action is idempotent on the server.
 */
async function postToSheet(url, bodyObj, { needResponse = false, timeout = 30000 } = {}) {
  const body = JSON.stringify(bodyObj);
  const headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  let res;
  try {
    res = await fetchWithTimeout(url, { method: 'POST', headers, body, redirect: 'follow' }, timeout);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('หมดเวลาเชื่อมต่อ (timeout)');
    if (needResponse) throw new Error('อ่านข้อมูลจาก Cloud ไม่ได้ — ตรวจสอบอินเทอร์เน็ตและการ Deploy');
    await fetchWithTimeout(url, { method: 'POST', mode: 'no-cors', headers, body }, timeout);
    return { opaque: true };
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) {
    throw new Error(`Apps Script ตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ตรวจสอบว่า Deploy แบบ "Anyone" แล้ว`);
  }
  if (!json.ok) throw new Error(json.error || 'Apps Script error');
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
    state.queue = state.queue.filter((q) => state.orders.some((o) => o.id === q.orderId));
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
      for (const q of batch) {
        if (doneIds.includes(q.qid)) {
          okCount++;
          const o = state.orders.find((x) => x.id === q.orderId);
          if (o) { if (q.action === 'NEW_ORDER') o.synced = true; else o.voidSynced = true; }
        } else {
          failCount++;
          const live = state.queue.find((x) => x.qid === q.qid);
          if (live) { live.attempts += 1; live.lastError = errors[q.qid] || 'ไม่ทราบสาเหตุ'; lastError = live.lastError; }
        }
      }
      state.queue = state.queue.filter((q) => !doneIds.includes(q.qid));
      save.queue();
      save.orders();
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
    if (failCount) toast(`Sync บิลไม่สำเร็จ ${failCount} รายการ: ${lastError}`, 'error', 5000);
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
    const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, 20000);
    const json = JSON.parse(await res.text());
    if (json.ok) toast(`เชื่อมต่อสำเร็จ ✓ ${json.sheet ? `(${json.sheet})` : ''}${json.hasCatalog ? ' · มีเมนูบน Cloud แล้ว' : ''}`, 'success', 3500);
    else toast(`เชื่อมต่อได้แต่มีข้อผิดพลาด: ${json.error}`, 'error', 5000);
  } catch (e) {
    toast('เชื่อมต่อไม่สำเร็จ — ตรวจสอบ URL และการ Deploy (Who has access: Anyone)', 'error', 5000);
  }
}

/* ==========================================================================
   18. SETTINGS, BACKUP & MAINTENANCE
   ========================================================================== */

function openSettings() {
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

function renderSettings(keepInputs = false) {
  const modal = $('#m-settings');
  const val = (id) => ($(`#${id}`) ? $(`#${id}`).value : null);
  const prev = keepInputs ? { url: val('gasUrl'), shop: val('shopNameInput'), sub: val('shopSubInput'), prefix: val('prefixInput') } : {};
  const pick = (p, v) => (p != null ? p : v);
  const s = state.settings;
  const m = state.syncMeta;
  const q = state.queue;
  const busy = state.cloudBusy || state.syncing;
  const canShare = !!(navigator.canShare && window.File);
  const dirtyParts = [
    m.catalogDirty ? 'เมนู/หมวด/โปร' : '',
    Object.keys(m.stockDirty).length ? `สต็อก ${Object.keys(m.stockDirty).length} รายการ` : '',
    Object.keys(m.imagesDirty).length ? `รูป ${Object.keys(m.imagesDirty).length} รูป` : '',
    m.settingsDirty ? 'ข้อมูลร้าน' : '',
  ].filter(Boolean);
  const toggle = (key, label, help) => `
    <button class="switch-row" data-act="toggle" data-key="${key}" type="button" aria-pressed="${!!s[key]}">
      <span class="switch ${s[key] ? 'on' : ''}"><span></span></span>
      <span><b>${label}</b><small>${help}</small></span>
    </button>`;

  paint(modal.querySelector('.modal-body'), `
    <div class="section">
      <div class="section-title">Google Sheets Web App URL</div>
      <div class="row nowrap">
        <input class="input grow" id="gasUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="https://script.google.com/macros/s/XXXX/exec" value="${esc(pick(prev.url, s.gasUrl))}" />
        <button class="btn btn-primary" data-act="save-url" type="button">บันทึก</button>
        <button class="btn btn-outline" data-act="test-url" type="button">${svg('link', 18)} ทดสอบ</button>
      </div>
      <p class="help">ใช้ URL เดียวกันในทุกเครื่อง (ลงท้ายด้วย /exec) — ดูขั้นตอนใน README.md</p>
    </div>

    <div class="section sync-panel">
      <div class="section-title">หลายเครื่อง — ซิงก์เมนู / รูป / สต็อก ผ่าน Cloud</div>
      <div class="row" style="align-items:flex-end">
        <label class="ed-field" style="width:220px;margin:0"><span>รหัสเครื่อง (Device Prefix)</span>
          <input class="input" id="prefixInput" type="text" autocapitalize="characters" maxlength="10" value="${esc(pick(prev.prefix, s.devicePrefix))}" /></label>
        <button class="btn btn-outline" data-act="save-prefix" type="button">บันทึกรหัสเครื่อง</button>
        <span class="help grow">เลขบิล: <b>ORD-${esc(s.devicePrefix)}-${todayKey().replace(/-/g, '')}-001</b> — ตั้งให้ไม่ซ้ำกันในแต่ละเครื่อง เช่น IPAD1, IPAD2, PC1</span>
      </div>
      <div class="cloud-btns">
        <button class="btn btn-primary btn-lg" data-act="push-full" type="button" ${busy ? 'disabled' : ''}>☁️ อัปเดตเมนู/รูป/สต็อก ขึ้น Cloud<small>Push from Main</small></button>
        <button class="btn btn-outline btn-lg" data-act="pull" type="button" ${busy ? 'disabled' : ''}>📥 ดึงเมนู/รูป/สต็อก ล่าสุดจาก Cloud<small>Pull to this Device</small></button>
      </div>
      ${toggle('autoPush', 'ส่งการเปลี่ยนแปลงขึ้น Cloud อัตโนมัติ', 'เมื่อแก้เมนู อัปโหลดรูป หรือแก้สต็อก (แนะนำให้เปิดในเครื่องหลัก)')}
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
        <div class="section-title grow" style="margin:0">คิวบิลรอ Sync (${q.length})</div>
        <button class="btn btn-primary" data-act="sync-all" type="button" ${state.syncing || !q.length ? 'disabled' : ''}>
          ${svg('cloud', 18)} ${state.syncing ? 'กำลัง Sync…' : 'Sync ข้อมูลทั้งหมดตอนนี้'}
        </button>
      </div>
      ${q.length ? `<div class="queue-list">${q.map((it) => `
        <div class="queue-item">
          <span class="pill ${it.action === 'VOID_ORDER' ? 'pill-void' : 'pill-mute'}">${it.action}</span>
          <div class="grow"><b>${esc(it.orderId)}</b> <span class="help">${esc(it.createdAt.replace('T', ' ').slice(0, 19))}</span>
            ${it.lastError ? `<div class="q-err">พยายาม ${it.attempts} ครั้ง: ${esc(it.lastError)}</div>` : ''}</div>
        </div>`).join('')}</div>` : '<div class="ok-box">ไม่มีบิลค้าง — Sync แล้วทั้งหมด ✓</div>'}
      <p class="help">Sync บิลล่าสุด: ${esc(s.lastSyncAt || '-')}${s.lastSyncError ? ` · <span style="color:var(--danger)">${esc(s.lastSyncError)}</span>` : ''}</p>
    </div>

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

    <div class="section">
      <div class="section-title">สำรองข้อมูล (Backup)</div>
      <p class="help" style="margin:0 0 10px">ไฟล์ JSON รวม เมนู · สต็อก · ประวัติบิล · คิว Sync · ตั้งค่า · รูปเมนู</p>
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
        <dt>บิลทั้งหมดในเครื่อง</dt><dd>${state.orders.length} บิล</dd>
        <dt>พื้นที่ localStorage</dt><dd>~${storageUsageKB()} KB (จำกัดประมาณ 5,000 KB)</dd>
      </dl>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-outline" data-act="update-app" type="button">${svg('refresh', 18)} Update App Version</button>
        <button class="btn btn-ghost" data-act="cleanup" type="button">ล้างบิลเก่าที่ Sync แล้ว (เกิน 60 วัน)</button>
      </div>
    </div>`);
}

function backupPayload() {
  return {
    app: 'ipad-pos', schema: 2, appVersion: APP_VERSION, exportedAt: isoLocal(new Date()),
    catalog: state.catalog, stock: state.stock, orders: state.orders, queue: state.queue,
    settings: state.settings, images: state.images,
  };
}
function backupFileName() {
  const d = new Date();
  return `pos-backup-${state.settings.devicePrefix}-${dateKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(backupPayload())], { type: 'application/json' });
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
    const file = new File([JSON.stringify(backupPayload())], name, { type: 'application/json' });
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
  state.cart = { lines: [], manualDiscount: '' };
  $('#manualDiscount').value = '';
  const ok = save.catalog() && save.orders() && save.stock() && save.queue() && save.settings() && save.cart();
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
  const cutoff = shiftDateKey(todayKey(), -60);
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
  save.orders();
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
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnUpdate').addEventListener('click', updateApp);

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
    const line = state.cart.lines.find((l) => l.id === id);
    if (b.dataset.act === 'inc') changeQty(id, 1);
    else if (b.dataset.act === 'dec') changeQty(id, -1);
    else if (b.dataset.act === 'remove') removeLine(id);
    else if (b.dataset.act === 'edit' && line) {
      if (line.type === 'weight') openWeight(line.menuId, line);
      else if (line.type === 'set') openSet(line.menuId, line);
    }
  });
  $('#btnClearCart').addEventListener('click', clearCart);
  const manual = $('#manualDiscount');
  manual.value = state.cart.manualDiscount || '';
  manual.addEventListener('input', () => {
    const cleaned = cleanNum(manual.value);
    if (cleaned !== manual.value) manual.value = cleaned;
    state.cart.manualDiscount = cleaned;
    save.cart();
    renderTotals();
  });
  manual.addEventListener('focus', () => manual.select());
  $('#btnCheckout').addEventListener('click', openPayment);

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
      const t = calcTotals(state.cart.lines, state.cart.manualDiscount);
      payCtx.cash = c.dataset.cash === 'exact' ? String(t.net) : c.dataset.cash;
      $('#payCash').value = payCtx.cash;
      return updatePayState();
    }
    if (e.target.closest('[data-act="pay-ok"]')) confirmPayment();
  });
  pay.addEventListener('input', (e) => {
    if (e.target.id !== 'payCash') return;
    const cleaned = cleanNum(e.target.value);
    if (cleaned !== e.target.value) e.target.value = cleaned;
    payCtx.cash = cleaned;
    updatePayState();
  });

  // manager modal
  const mm = $('#m-manage');
  mm.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mtab]');
    if (t) { mgr.tab = t.dataset.mtab; return renderManager(); }
    const f = e.target.closest('[data-mcat]');
    if (f) { mgr.catFilter = f.dataset.mcat; return renderManager(); }
    const q = e.target.closest('[data-quick]');
    if (q) { const k = q.dataset.quick; return setStock(k, Math.max(0, (state.stock[k] || 0) + Number(q.dataset.n))); }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'item-new') openItemEditor(null);
    else if (act === 'item-edit') openItemEditor(b.dataset.id);
    else if (act === 'avail') setAvailability(b.dataset.id, b.dataset.v);
    else if (act.startsWith('cat-')) catAction(act, b.dataset.id);
    else if (act.startsWith('promo-')) promoAction(act, b.dataset.id);
    else if (act.startsWith('pool-')) poolAction(act, b.dataset.id);
  });
  mm.addEventListener('change', (e) => {
    const el = e.target;
    const d = el.dataset;
    if (d.stock) return setStock(d.stock, el.value);
    if (d.catname) { const c = IDX.cat[d.catname]; if (c && el.value.trim()) { c.name = el.value.trim(); commitCatalog(); renderManager(); } return; }
    if (d.catpromo) { const c = IDX.cat[d.catpromo]; if (c) { c.promoId = el.value; commitCatalog(); renderManager(); } return; }
    if (d.promo) {
      const p = IDX.promo[d.promo];
      if (!p) return;
      if (d.f === 'name') p.name = el.value.trim() || p.name;
      if (d.f === 'size') p.size = Math.max(2, toInt(el.value) || 2);
      if (d.f === 'price') p.price = Math.max(0, num(el.value));
      commitCatalog();
      renderManager();
      return;
    }
    if (d.member) { togglePromoMember(d.member, d.item, el.checked); return; }
    if (d.poolname) { const p = IDX.pool[d.poolname]; if (p && el.value.trim()) { p.name = el.value.trim(); commitCatalog(); } }
  });
  mm.addEventListener('focusin', (e) => { if (e.target.dataset.stock) e.target.select(); });

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

  // history
  const hist = $('#m-history');
  hist.addEventListener('click', (e) => {
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
    if (v) voidOrder(v.dataset.void);
  });
  hist.addEventListener('change', (e) => {
    if (e.target.id === 'histDate' && e.target.value) {
      histDate = e.target.value;
      renderHistory();
      if (histScope === 'all') loadRemoteOrders();
    }
  });

  // settings
  $('#m-settings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'save-url') {
      const url = $('#gasUrl').value.trim();
      if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) toast('URL ไม่ใช่ Google Apps Script — ตรวจสอบอีกครั้ง', 'warn', 3500);
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
    } else if (act === 'export') exportBackup();
    else if (act === 'share') shareBackup();
    else if (act === 'import') { $('#importInput').value = ''; $('#importInput').click(); }
    else if (act === 'cleanup') cleanupOldOrders();
    else if (act === 'update-app') updateApp();
  });
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
    const open = $$('.modal.open');
    if (open.length && open[open.length - 1].id !== 'm-confirm') open[open.length - 1].classList.remove('open');
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('pos.v1.')) return;
    state.catalog = normalizeCatalog(lsGet(LS.catalog, null));
    reindex();
    state.stock = sanitizeStock(lsGet(LS.stock, null), state.catalog);
    state.orders = lsGet(LS.orders, []);
    state.queue = lsGet(LS.queue, []);
    renderAll();
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
  bindEvents();
  renderClock();
  setInterval(renderClock, 1000);
  renderAll();

  try {
    state.images = await ImageStore.getAll();
    await shrinkLegacyImages();
    renderMenu();
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
    if (state.settings.autoPull && hasUrl() && !state.cart.lines.length && Date.now() - hiddenAt > 3 * 60000) pullState({ silent: true });
  });
}

document.addEventListener('DOMContentLoaded', init);

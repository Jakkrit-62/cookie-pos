/* ==========================================================================
   iPad POS — app.js
   Offline-first point-of-sale: state, promo engine, stock, images, sync queue.
   No build step: plain ES2018+ that runs on iPadOS Safari 14+.
   ========================================================================== */
'use strict';

const APP_VERSION = '1.0.0';

/* ==========================================================================
   1. CATALOG  (edit prices / flavors here)
   ========================================================================== */

const UNIT_LABEL = { pcs: 'ชิ้น', g: 'กรัม', scoop: 'สกู๊ป' };

const CATEGORIES = [
  { id: 'all', name: 'ทั้งหมด' },
  { id: 'soft', name: 'ซอฟต์คุกกี้' },
  { id: 'cereal', name: 'ซีเรียลคุกกี้' },
  { id: 'gooey', name: 'Gooey & ไอศกรีม' },
  { id: 'puff', name: 'ครีมพัฟ & ชูครีม' },
];
const CATEGORY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));

const SOFT_FLAVORS = [
  ['sc_classic', 'รสคลาสสิก'],
  ['sc_nutella', 'นูเทลล่า'],
  ['sc_redvelvet', 'เรดเวลเวท'],
  ['sc_smore', 'สมอร์'],
  ['sc_triplechoc', 'ทริปเปิ้ลช้อก'],
  ['sc_biscoff', 'บิสคอฟ'],
  ['sc_strawberry', 'สตอเบอรี่'],
  ['sc_birthday', 'เบิร์ดเดย์'],
];
const CEREAL_FLAVORS = [
  ['cc_chocchip', 'ช็อกโกแลตชิพ'],
  ['cc_matcha', 'มัทฉะ'],
  ['cc_redvelvet', 'เรดเวลเวท'],
  ['cc_cocoa', 'โกโก้'],
];

const SOFT_PRICE = 39;
const CEREAL_PRICE_PER_G = 1;
const CEREAL_MIN_G = 20;
const GOOEY = { basePrice: 59, extraScoop: 20, extraCookie: 39 };

const MENU = [
  ...SOFT_FLAVORS.map(([id, name]) => ({
    id, cat: 'soft', type: 'unit', name, fullName: `ซอฟต์คุกกี้ ${name}`,
    price: SOFT_PRICE, stockKey: id, promo: 'soft', tag: '3 ชิ้น ฿100',
  })),
  ...CEREAL_FLAVORS.map(([id, name]) => ({
    id, cat: 'cereal', type: 'cereal', name, fullName: `ซีเรียลคุกกี้ ${name}`,
    pricePerGram: CEREAL_PRICE_PER_G, stockKey: id, tag: 'ชั่งน้ำหนัก',
  })),
  {
    id: 'gooey_set', cat: 'gooey', type: 'gooey', name: 'Gooey Chocolate + Ice Cream',
    fullName: 'Gooey Chocolate + Ice Cream', price: GOOEY.basePrice, tag: 'เซ็ต',
  },
  {
    id: 'puff_osaka', cat: 'puff', type: 'unit', name: 'Osaka Cream Puff', fullName: 'Osaka Cream Puff',
    price: 29, stockKey: 'puff_osaka', promo: 'puff', tag: '4 ชิ้น ฿99',
  },
  {
    id: 'choux_cream', cat: 'puff', type: 'unit', name: 'ชูครีม', fullName: 'ชูครีม (Choux Cream)',
    price: 12, stockKey: 'choux_cream', promo: 'choux', tag: '5 ชิ้น ฿50',
  },
];
const MENU_BY_ID = Object.fromEntries(MENU.map((m) => [m.id, m]));

/** Every stock pool. `image` = which menu card's photo is managed on this row. */
const STOCK_ITEMS = {
  ...Object.fromEntries(SOFT_FLAVORS.map(([id, n]) => [id, { name: `ซอฟต์คุกกี้ ${n}`, unit: 'pcs', image: id }])),
  ...Object.fromEntries(CEREAL_FLAVORS.map(([id, n]) => [id, { name: `ซีเรียลคุกกี้ ${n}`, unit: 'g', image: id }])),
  gooey_cookie: { name: 'คุกกี้ Gooey Chocolate', unit: 'pcs', image: 'gooey_set' },
  ice_hokkaido: { name: 'ไอศกรีม รสฮอกไกโด (Hokkaido)', unit: 'scoop' },
  ice_vanilla: { name: 'ไอศกรีม รสวนิลา (Vanilla)', unit: 'scoop' },
  puff_osaka: { name: 'Osaka Cream Puff', unit: 'pcs', image: 'puff_osaka' },
  choux_cream: { name: 'ชูครีม (Choux Cream)', unit: 'pcs', image: 'choux_cream' },
};

const STOCK_GROUPS = [
  { title: 'ซอฟต์คุกกี้', note: '8 รส · นับเป็นชิ้น', keys: SOFT_FLAVORS.map((f) => f[0]) },
  { title: 'ซีเรียลคุกกี้', note: '4 รส · นับเป็นกรัม', keys: CEREAL_FLAVORS.map((f) => f[0]) },
  { title: 'Gooey Chocolate + Ice Cream', note: 'คุกกี้ (ชิ้น) · ไอศกรีม (สกู๊ป)', keys: ['gooey_cookie', 'ice_hokkaido', 'ice_vanilla'] },
  { title: 'Osaka Cream Puff & ชูครีม', note: 'นับเป็นชิ้น', keys: ['puff_osaka', 'choux_cream'] },
];

const ICE = {
  hokkaido: { key: 'ice_hokkaido', name: 'ฮอกไกโด', en: 'Hokkaido' },
  vanilla: { key: 'ice_vanilla', name: 'วนิลา', en: 'Vanilla' },
};

/** Mix-and-match bundle promotions (auto-applied). */
const PROMOS = {
  soft: { label: 'โปรซอฟต์คุกกี้ 3 ชิ้น 100', size: 3, discount: 17 },
  puff: { label: 'โปรครีมพัฟ 4 ชิ้น 99', size: 4, discount: 17 },
  choux: { label: 'โปรชูครีม 5 ชิ้น 50', size: 5, discount: 10 },
};

const PAY_METHODS = {
  cash: { label: 'เงินสด', en: 'Cash', icon: 'cash' },
  qr: { label: 'สแกน QR', en: 'QR Code', icon: 'qr' },
  tcp: { label: 'ไทยช่วยไทยพลัส', en: 'Thai Chuay Thai Plus', icon: 'gov' },
};

/* ==========================================================================
   2. ICONS (inline SVG — no network needed)
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
  check: '<path d="M20 6 9 17l-5-5"/>',
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
   3. UTILITIES
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad = (n, len = 2) => String(n).padStart(len, '0');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  const v = round2(n);
  return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
const money = (n) => `฿${fmtNum(n)}`;
const negMoney = (n) => (n > 0 ? `-฿${fmtNum(n)}` : '฿0');

/** DD/MM/YYYY HH:mm:ss (local time) */
function fmtDateTime(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** YYYY-MM-DD (local date) */
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const todayKey = () => dateKey(new Date());
/** ISO-8601 with local offset, e.g. 2026-11-14T13:05:22+07:00 */
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

/* ==========================================================================
   4. PERSISTENCE (localStorage for data, IndexedDB for images)
   ========================================================================== */

const LS = {
  stock: 'pos.v1.stock',
  orders: 'pos.v1.orders',
  queue: 'pos.v1.queue',
  settings: 'pos.v1.settings',
  cart: 'pos.v1.cart',
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

const defaultStock = () => Object.fromEntries(Object.keys(STOCK_ITEMS).map((k) => [k, 0]));
const defaultSettings = () => ({
  gasUrl: '',
  shopName: 'Cookie POS',
  deviceName: 'iPad-1',
  lastSyncAt: '',
  lastSyncError: '',
});

function sanitizeStock(obj) {
  const s = defaultStock();
  if (obj && typeof obj === 'object') for (const k of Object.keys(s)) s[k] = toInt(obj[k]);
  return s;
}

const state = {
  stock: sanitizeStock(lsGet(LS.stock, null)),
  orders: lsGet(LS.orders, []),
  queue: lsGet(LS.queue, []),
  settings: Object.assign(defaultSettings(), lsGet(LS.settings, {})),
  cart: Object.assign({ lines: [], manualDiscount: '' }, lsGet(LS.cart, {})),
  images: {},
  category: 'all',
  syncing: false,
};
if (!Array.isArray(state.orders)) state.orders = [];
if (!Array.isArray(state.queue)) state.queue = [];
if (!Array.isArray(state.cart.lines)) state.cart.lines = [];
state.cart.lines = state.cart.lines.filter((l) => l && MENU_BY_ID[l.menuId]);

const save = {
  stock: () => lsSet(LS.stock, state.stock),
  orders: () => lsSet(LS.orders, state.orders),
  queue: () => lsSet(LS.queue, state.queue),
  settings: () => lsSet(LS.settings, state.settings),
  cart: () => lsSet(LS.cart, state.cart),
};

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
    // merge any localStorage fallback images
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

/** Resize + center-crop to a square JPEG data URL (default 300×300) */
function compressImage(file, size = 300, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fffdf9';
        ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
        let q = quality;
        let data = canvas.toDataURL('image/jpeg', q);
        while (data.length > 70000 && q > 0.45) { // keep each image ≲ 50 KB
          q -= 0.1;
          data = canvas.toDataURL('image/jpeg', q);
        }
        resolve(data);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้')); };
    img.src = url;
  });
}

/* ==========================================================================
   5. CART ENGINE (stock needs, pricing, promotions)
   ========================================================================== */

/** Stock that a single cart line consumes: { stockKey: amount } */
function lineNeeds(line) {
  const n = {};
  const add = (k, v) => { if (v > 0) n[k] = (n[k] || 0) + v; };
  const m = MENU_BY_ID[line.menuId];
  if (line.type === 'unit') add(m.stockKey, line.qty);
  else if (line.type === 'cereal') add(m.stockKey, line.soldG + line.freeG);
  else if (line.type === 'gooey') {
    const q = line.qty;
    add('gooey_cookie', q * (1 + line.addC));
    add(ICE.hokkaido.key, q * ((line.main === 'hokkaido' ? 1 : 0) + line.addH));
    add(ICE.vanilla.key, q * ((line.main === 'vanilla' ? 1 : 0) + line.addV));
  }
  return n;
}
function mergeNeeds(target, src) {
  for (const k in src) target[k] = (target[k] || 0) + src[k];
  return target;
}
/** Total stock reserved by the cart (optionally excluding one line being edited) */
function cartNeeds(excludeLineId) {
  const t = {};
  for (const l of state.cart.lines) if (l.id !== excludeLineId) mergeNeeds(t, lineNeeds(l));
  return t;
}
function availableOf(key, reserved) {
  return (state.stock[key] || 0) - ((reserved || cartNeeds())[key] || 0);
}
/** Returns shortages if `needs` were added on top of the cart (minus excluded line). */
function findShortages(needs, excludeLineId) {
  const reserved = cartNeeds(excludeLineId);
  const out = [];
  for (const k in needs) {
    const have = (state.stock[k] || 0) - (reserved[k] || 0);
    if (needs[k] > have) out.push({ key: k, need: needs[k], have: Math.max(0, have) });
  }
  return out;
}
/** Shortages for the whole cart vs. current stock */
function cartShortages() {
  const t = cartNeeds();
  const out = [];
  for (const k in t) if (t[k] > (state.stock[k] || 0)) out.push({ key: k, need: t[k], have: state.stock[k] || 0 });
  return out;
}
function shortageText(list) {
  return list.map((s) => `${STOCK_ITEMS[s.key].name} (ต้องการ ${fmtNum(s.need)} มี ${fmtNum(s.have)} ${UNIT_LABEL[STOCK_ITEMS[s.key].unit]})`).join(', ');
}

function gooeySetPrice(line) {
  return GOOEY.basePrice + GOOEY.extraScoop * (line.addH + line.addV) + GOOEY.extraCookie * line.addC;
}
function lineGross(line) {
  const m = MENU_BY_ID[line.menuId];
  if (line.type === 'unit') return m.price * line.qty;
  if (line.type === 'cereal') return line.soldG * m.pricePerGram;
  if (line.type === 'gooey') return gooeySetPrice(line) * line.qty;
  return 0;
}
function lineItemDiscount(line) {
  return line.type === 'cereal' ? Math.min(toInt(line.disc), lineGross(line)) : 0;
}
function lineTitle(line) {
  return MENU_BY_ID[line.menuId].fullName;
}
function lineDetail(line) {
  const m = MENU_BY_ID[line.menuId];
  if (line.type === 'unit') return `${line.qty} × ${money(m.price)}`;
  if (line.type === 'cereal') {
    const parts = [`ขาย ${fmtNum(line.soldG)} ก. (${money(line.soldG * m.pricePerGram)})`];
    if (line.freeG > 0) parts.push(`แถม ${fmtNum(line.freeG)} ก.`);
    if (line.disc > 0) parts.push(`ลดรายการ ${money(line.disc)}`);
    return parts.join(' · ');
  }
  if (line.type === 'gooey') {
    const parts = [`ไอศกรีมหลัก ${ICE[line.main].name}`];
    if (line.addH) parts.push(`+ฮอกไกโด ${line.addH} สกู๊ป`);
    if (line.addV) parts.push(`+วนิลา ${line.addV} สกู๊ป`);
    if (line.addC) parts.push(`+คุกกี้ Gooey ${line.addC} ชิ้น`);
    return `${parts.join(' · ')} — ${line.qty} × ${money(gooeySetPrice(line))}`;
  }
  return '';
}
const lineCount = (l) => (l.type === 'cereal' ? 1 : l.qty);

/** Full bill calculation */
function calcTotals(lines, manualInput) {
  const subtotal = round2(lines.reduce((s, l) => s + lineGross(l), 0));
  const counts = { soft: 0, puff: 0, choux: 0 };
  for (const l of lines) {
    if (l.type !== 'unit') continue;
    const p = MENU_BY_ID[l.menuId].promo;
    if (p) counts[p] += l.qty;
  }
  const promos = Object.keys(PROMOS).map((key) => {
    const p = PROMOS[key];
    const bundles = Math.floor(counts[key] / p.size);
    return { key, label: p.label, bundles, discount: bundles * p.discount };
  }).filter((p) => p.bundles > 0);
  const promoDiscount = promos.reduce((s, p) => s + p.discount, 0);
  const itemDiscount = round2(lines.reduce((s, l) => s + lineItemDiscount(l), 0));
  const afterAuto = Math.max(0, round2(subtotal - promoDiscount - itemDiscount));
  const manualRequested = Math.max(0, round2(parseFloat(manualInput) || 0));
  const manualDiscount = Math.min(manualRequested, afterAuto);
  const net = round2(afterAuto - manualDiscount);
  return {
    subtotal, promos, promoDiscount, itemDiscount,
    manualRequested, manualDiscount,
    totalDiscount: round2(promoDiscount + itemDiscount + manualDiscount),
    net,
  };
}

/* ==========================================================================
   6. TOASTS & MODALS
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
   7. RENDER — HEADER, MENU, CART
   ========================================================================== */

function renderClock() {
  const d = new Date();
  const s = fmtDateTime(d).split(' ');
  $('#clockDate').textContent = s[0];
  $('#clockTime').textContent = s[1];
}

function renderHeader() {
  $('#shopName').textContent = state.settings.shopName || 'Cookie POS';
  document.title = state.settings.shopName || 'Cookie POS';
  const online = navigator.onLine;
  const badge = $('#netBadge');
  badge.textContent = online ? 'Online' : 'Offline';
  badge.classList.toggle('offline', !online);

  const n = state.queue.length;
  const btn = $('#btnSync');
  btn.classList.toggle('pending', n > 0);
  btn.classList.toggle('syncing', state.syncing);
  $('#syncLabel').textContent = state.syncing ? `กำลัง Sync (${n})…` : (n ? `Sync Pending (${n})` : 'Synced ✓');
}

function menuStatus(m, reserved) {
  const S = state.stock;
  if (m.type === 'unit') {
    const avail = availableOf(m.stockKey, reserved);
    return {
      soldOut: S[m.stockKey] <= 0,
      blocked: avail <= 0,
      badge: `คงเหลือ ${fmtNum(Math.max(0, avail))} ชิ้น`,
      low: avail > 0 && avail <= 5,
    };
  }
  if (m.type === 'cereal') {
    const avail = availableOf(m.stockKey, reserved);
    return {
      soldOut: S[m.stockKey] < CEREAL_MIN_G,
      blocked: avail < CEREAL_MIN_G,
      badge: `${fmtNum(Math.max(0, avail))} กรัม`,
      low: avail >= CEREAL_MIN_G && avail < 200,
    };
  }
  // gooey set
  const c = availableOf('gooey_cookie', reserved);
  const h = availableOf(ICE.hokkaido.key, reserved);
  const v = availableOf(ICE.vanilla.key, reserved);
  const sets = Math.max(0, Math.min(c, h + v));
  return {
    soldOut: S.gooey_cookie <= 0 || (S.ice_hokkaido <= 0 && S.ice_vanilla <= 0),
    blocked: c <= 0 || (h <= 0 && v <= 0),
    badge: `คงเหลือ ${sets} เซ็ต`,
    low: sets > 0 && sets <= 3,
    sub: `คุกกี้ ${Math.max(0, c)} · ฮอกไกโด ${Math.max(0, h)} · วนิลา ${Math.max(0, v)}`,
  };
}

function renderTabs() {
  $('#catTabs').innerHTML = CATEGORIES.map((c) => {
    const cnt = c.id === 'all' ? MENU.length : MENU.filter((m) => m.cat === c.id).length;
    return `<button class="cat-tab ${state.category === c.id ? 'active' : ''}" data-cat="${c.id}" type="button">${esc(c.name)}<span class="cnt">${cnt}</span></button>`;
  }).join('');
}

function renderMenu() {
  const reserved = cartNeeds();
  const inCart = {};
  for (const l of state.cart.lines) inCart[l.menuId] = (inCart[l.menuId] || 0) + lineCount(l);
  const items = MENU.filter((m) => state.category === 'all' || m.cat === state.category);

  $('#menuGrid').innerHTML = items.map((m) => {
    const st = menuStatus(m, reserved);
    const img = state.images[m.id];
    const priceHtml = m.type === 'cereal'
      ? `${money(m.pricePerGram)}<small> / กรัม</small>`
      : m.type === 'gooey' ? `${money(m.price)}<small> / เซ็ต</small>` : money(m.price);
    const cls = ['menu-card', st.soldOut ? 'is-soldout' : '', !st.soldOut && st.blocked ? 'is-blocked' : '', inCart[m.id] ? 'in-cart' : ''].join(' ');
    return `
      <button class="${cls}" data-menu="${m.id}" type="button" aria-disabled="${st.soldOut || st.blocked}">
        <div class="card-img">
          ${img ? `<img src="${img}" alt="" loading="lazy" />` : `${svg('cookie', 46)}<span>ยังไม่มีรูป</span>`}
          ${m.tag ? `<span class="promo-tag">${esc(m.tag)}</span>` : ''}
          <span class="stock-badge ${st.low ? 'low' : ''}">${esc(st.badge)}</span>
          ${inCart[m.id] && !st.soldOut ? `<span class="qty-tag">${inCart[m.id]}</span>` : ''}
          ${!st.soldOut && st.blocked ? '<span class="blocked-note">สต็อกทั้งหมดอยู่ในตะกร้าแล้ว</span>' : ''}
        </div>
        ${st.soldOut ? '<div class="soldout-overlay"><span>SOLD OUT</span></div>' : ''}
        <div class="card-body">
          <div class="card-cat">${esc(CATEGORY_NAME[m.cat])}</div>
          <div class="card-name">${esc(m.name)}</div>
          ${st.sub ? `<div class="card-sub">${esc(st.sub)}</div>` : ''}
          <div class="card-price">${priceHtml}</div>
        </div>
      </button>`;
  }).join('');
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
      const controls = l.type === 'cereal'
        ? editBtn
        : `<div class="stepper">
             <button data-act="dec" data-id="${l.id}" type="button" aria-label="ลด">${svg('minus')}</button>
             <span class="qty">${l.qty}</span>
             <button data-act="inc" data-id="${l.id}" type="button" aria-label="เพิ่ม">${svg('plus')}</button>
           </div>${l.type === 'gooey' ? editBtn : ''}`;
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
  if (t.itemDiscount > 0) {
    html += `<div class="sum-row discount"><span>ส่วนลดเฉพาะรายการ (ซีเรียลคุกกี้)</span><span>${negMoney(t.itemDiscount)}</span></div>`;
  }
  $('#promoRows').innerHTML = html;

  $('#manualNote').textContent = t.manualRequested > t.manualDiscount
    ? `ส่วนลดเพิ่มเติมถูกจำกัดไว้ที่ ${money(t.manualDiscount)} (ไม่เกินยอดคงเหลือ)` : '';
  $('#sumNet').textContent = money(t.net);
  $('#btnCheckout').disabled = !state.cart.lines.length;
}

function renderAll() {
  renderHeader();
  renderMenu();
  renderCart();
}

function cartChanged() {
  save.cart();
  renderMenu();
  renderCart();
}

/* ==========================================================================
   8. CART ACTIONS
   ========================================================================== */

function onMenuTap(menuId) {
  const m = MENU_BY_ID[menuId];
  if (!m) return;
  const st = menuStatus(m, cartNeeds());
  if (st.soldOut) return toast(`${m.fullName} — SOLD OUT`, 'error');
  if (st.blocked) return toast('สต็อกคงเหลือทั้งหมดอยู่ในตะกร้าแล้ว', 'warn');
  if (m.type === 'unit') addUnit(m);
  else if (m.type === 'cereal') openCereal(menuId, null);
  else openGooey(null);
}

function addUnit(m) {
  if (findShortages({ [m.stockKey]: 1 }).length) return toast('สต็อกไม่พอ', 'error');
  const line = state.cart.lines.find((l) => l.type === 'unit' && l.menuId === m.id);
  if (line) line.qty += 1;
  else state.cart.lines.push({ id: uid(), type: 'unit', menuId: m.id, qty: 1 });
  cartChanged();
  const count = $('#cartCount');
  count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump');
}

function changeQty(lineId, delta) {
  const line = state.cart.lines.find((l) => l.id === lineId);
  if (!line || line.type === 'cereal') return;
  if (delta > 0) {
    const one = lineNeeds(Object.assign({}, line, { qty: 1 }));
    const short = findShortages(one);
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
   9. CEREAL COOKIE MODAL (weight / giveaway / item discount + numpad)
   ========================================================================== */

let cerealCtx = null;

function openCereal(menuId, editLine) {
  cerealCtx = {
    menuId,
    editId: editLine ? editLine.id : null,
    f: {
      sold: editLine ? String(editLine.soldG) : '',
      free: editLine ? String(editLine.freeG) : '0',
      disc: editLine ? String(editLine.disc) : '0',
    },
    active: 'sold',
  };
  renderCereal();
  openModal('m-cereal');
}

function cerealCalc() {
  const m = MENU_BY_ID[cerealCtx.menuId];
  const sold = toInt(cerealCtx.f.sold);
  const free = toInt(cerealCtx.f.free);
  const disc = toInt(cerealCtx.f.disc);
  const available = availableOf(m.stockKey, cerealCtx.editId === null ? cartNeeds() : cartNeeds(cerealCtx.editId));
  const price = sold * m.pricePerGram;
  const errors = [];
  if (sold < CEREAL_MIN_G) errors.push(`น้ำหนักที่ขายต้องไม่น้อยกว่า ${CEREAL_MIN_G} กรัม`);
  if (sold + free > available) errors.push(`สต็อกไม่พอ: ต้องตัด ${fmtNum(sold + free)} ก. แต่คงเหลือ ${fmtNum(Math.max(0, available))} ก.`);
  if (disc > price) errors.push('ส่วนลดเฉพาะรายการเกินราคาสินค้า');
  return { m, sold, free, disc, available, price, total: Math.max(0, price - disc), errors };
}

function renderCereal() {
  const c = cerealCalc();
  const modal = $('#m-cereal');
  modal.querySelector('.modal-title').textContent = `${c.m.fullName}${cerealCtx.editId ? ' (แก้ไข)' : ''}`;

  const field = (key, label, hint, unit) => {
    const raw = cerealCtx.f[key];
    return `
      <button class="num-field ${cerealCtx.active === key ? 'active' : ''}" data-field="${key}" type="button">
        <div class="row nowrap"><div class="grow"><div class="nf-label">${label}</div><div class="nf-hint">${hint}</div></div></div>
        <div class="nf-val">${raw === '' ? '<span class="ph">0</span>' : fmtNum(toInt(raw))}<span class="unit">${unit}</span></div>
      </button>`;
  };
  const chips = cerealCtx.active === 'disc' ? [5, 10, 20, 50] : [10, 50, 100, 200];

  modal.querySelector('.modal-body').innerHTML = `
    <div class="info-strip">
      <span>สต็อกคงเหลือ: <b>${fmtNum(Math.max(0, c.available))} กรัม</b></span>
      <span>ราคา: <b>฿${c.m.pricePerGram} / กรัม</b></span>
      <span>ขั้นต่ำ: <b>${CEREAL_MIN_G} กรัม</b></span>
    </div>
    <div class="cereal-layout">
      <div>
        ${field('sold', 'น้ำหนักที่ขาย (กรัม)', `บังคับ · ขั้นต่ำ ${CEREAL_MIN_G} กรัม · ราคา = น้ำหนัก × ฿${c.m.pricePerGram}`, 'กรัม')}
        ${field('free', 'น้ำหนักที่แถม (กรัม)', 'ไม่บังคับ · ของแถม ฿0 (ตัดสต็อกด้วย)', 'กรัม')}
        ${field('disc', 'ส่วนลดเฉพาะรายการนี้ (บาท)', 'ไม่บังคับ', 'บาท')}
        <div class="calc-box">
          <div class="sum-row"><span>ราคา (${fmtNum(c.sold)} ก. × ฿${c.m.pricePerGram})</span><span>${money(c.price)}</span></div>
          <div class="sum-row discount"><span>ส่วนลดรายการ</span><span>${negMoney(Math.min(c.disc, c.price))}</span></div>
          <div class="sum-row muted"><span>ตัดสต็อกรวม (ขาย + แถม)</span><span>${fmtNum(c.sold + c.free)} กรัม</span></div>
          <div class="sum-row total"><span>ยอดรายการนี้</span><span>${money(c.total)}</span></div>
        </div>
        ${c.errors.length && cerealCtx.f.sold !== '' ? `<div class="err-box">${c.errors.map(esc).join('<br/>')}</div>` : ''}
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
    <button class="btn btn-primary btn-lg" data-act="cereal-ok" type="button" ${c.errors.length ? 'disabled' : ''}>
      ${cerealCtx.editId ? 'บันทึกการแก้ไข' : 'เพิ่มลงตะกร้า'} · ${money(c.total)}
    </button>`;
}

function cerealKey(k) {
  const f = cerealCtx.f;
  const a = cerealCtx.active;
  if (k === 'C') f[a] = '';
  else if (k === 'BS') f[a] = f[a].slice(0, -1);
  else if (f[a].length < 6) f[a] = f[a] === '0' ? String(k) : f[a] + k;
  renderCereal();
}

function cerealConfirm() {
  const c = cerealCalc();
  if (c.errors.length) return toast(c.errors[0], 'error');
  const data = { soldG: c.sold, freeG: c.free, disc: Math.min(c.disc, c.price) };
  if (cerealCtx.editId) {
    const line = state.cart.lines.find((l) => l.id === cerealCtx.editId);
    if (line) Object.assign(line, data);
  } else {
    state.cart.lines.push(Object.assign({ id: uid(), type: 'cereal', menuId: cerealCtx.menuId }, data));
  }
  closeModal('m-cereal');
  cartChanged();
  toast(`เพิ่ม ${c.m.fullName} ${fmtNum(c.sold)} ก.${c.free ? ` (แถม ${c.free} ก.)` : ''}`, 'success', 1600);
}

/* ==========================================================================
   10. GOOEY SET MODAL
   ========================================================================== */

let gooeyCtx = null;

function openGooey(editLine) {
  gooeyCtx = editLine
    ? { editId: editLine.id, main: editLine.main, addH: editLine.addH, addV: editLine.addV, addC: editLine.addC, qty: editLine.qty }
    : { editId: null, main: null, addH: 0, addV: 0, addC: 0, qty: 1 };
  if (!gooeyCtx.main) {
    const r = cartNeeds();
    const h = availableOf(ICE.hokkaido.key, r);
    const v = availableOf(ICE.vanilla.key, r);
    if (h > 0 && v <= 0) gooeyCtx.main = 'hokkaido';
    if (v > 0 && h <= 0) gooeyCtx.main = 'vanilla';
  }
  renderGooey();
  openModal('m-gooey');
}

function gooeyFits(cfg) {
  if (!cfg.main) return false;
  return findShortages(lineNeeds(Object.assign({ type: 'gooey', menuId: 'gooey_set' }, cfg)), gooeyCtx.editId).length === 0;
}
function gooeyTry(patch) {
  return gooeyFits(Object.assign({}, gooeyCtx, patch, { main: (patch.main || gooeyCtx.main || 'hokkaido') }));
}

function renderGooey() {
  const g = gooeyCtx;
  const reserved = cartNeeds(g.editId);
  const left = {
    c: availableOf('gooey_cookie', reserved),
    h: availableOf(ICE.hokkaido.key, reserved),
    v: availableOf(ICE.vanilla.key, reserved),
  };
  const setPrice = gooeySetPrice(g);
  const total = setPrice * g.qty;
  const valid = gooeyFits(g);
  const canMain = (flavor) => gooeyFits(Object.assign({}, g, { main: flavor }));
  const stepper = (field, value, canInc) => `
    <div class="stepper lg">
      <button data-step="${field}" data-d="-1" type="button" ${value <= (field === 'qty' ? 1 : 0) ? 'disabled' : ''} aria-label="ลด">${svg('minus')}</button>
      <span class="qty">${value}</span>
      <button data-step="${field}" data-d="1" type="button" ${canInc ? '' : 'disabled'} aria-label="เพิ่ม">${svg('plus')}</button>
    </div>`;

  const modal = $('#m-gooey');
  modal.querySelector('.modal-title').textContent = `Gooey Chocolate + Ice Cream${g.editId ? ' (แก้ไข)' : ''}`;
  modal.querySelector('.modal-body').innerHTML = `
    <div class="info-strip">
      <span>คงเหลือ — คุกกี้ Gooey: <b>${Math.max(0, left.c)} ชิ้น</b></span>
      <span>ฮอกไกโด: <b>${Math.max(0, left.h)} สกู๊ป</b></span>
      <span>วนิลา: <b>${Math.max(0, left.v)} สกู๊ป</b></span>
    </div>
    <div class="gooey-layout">
      <div>
        <div class="section">
          <div class="section-title">1. เลือกไอศกรีมหลักในเซ็ต <small>(1 สกู๊ป - บังคับเลือก)</small></div>
          <div class="choice-row">
            ${['hokkaido', 'vanilla'].map((f) => `
              <button class="choice ${g.main === f ? 'selected' : ''}" data-main="${f}" type="button" ${canMain(f) || g.main === f ? '' : 'disabled'}>
                ${ICE[f].name}<small>${ICE[f].en} · คงเหลือ ${Math.max(0, left[f === 'hokkaido' ? 'h' : 'v'])} สกู๊ป</small>
              </button>`).join('')}
          </div>
        </div>
        <div class="section">
          <div class="section-title">2. Add-on เพิ่มไอศกรีม <small>(+฿${GOOEY.extraScoop} / สกู๊ป - คละรสได้)</small></div>
          <div class="card-box">
            <div class="addon-row"><div class="addon-name">ฮอกไกโด (+฿${GOOEY.extraScoop})<small>Hokkaido</small></div>${stepper('addH', g.addH, gooeyTry({ addH: g.addH + 1 }))}</div>
            <div class="addon-row"><div class="addon-name">วนิลา (+฿${GOOEY.extraScoop})<small>Vanilla</small></div>${stepper('addV', g.addV, gooeyTry({ addV: g.addV + 1 }))}</div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">3. Add-on เพิ่มคุกกี้ Gooey Chocolate <small>(+฿${GOOEY.extraCookie} / ชิ้น)</small></div>
          <div class="card-box">
            <div class="addon-row"><div class="addon-name">คุกกี้ Gooey (+฿${GOOEY.extraCookie})<small>ไม่ร่วมโปรซอฟต์คุกกี้ 3 ชิ้น 100</small></div>${stepper('addC', g.addC, gooeyTry({ addC: g.addC + 1 }))}</div>
          </div>
        </div>
      </div>
      <div>
        <div class="section">
          <div class="section-title">จำนวนเซ็ต</div>
          <div class="card-box" style="display:flex;justify-content:center">${stepper('qty', g.qty, gooeyTry({ qty: g.qty + 1 }))}</div>
        </div>
        <div class="calc-box">
          <div class="sum-row"><span>ราคาเซ็ต</span><span>${money(GOOEY.basePrice)}</span></div>
          ${g.addH + g.addV ? `<div class="sum-row"><span>เพิ่มไอศกรีม ${g.addH + g.addV} สกู๊ป</span><span>+${money(GOOEY.extraScoop * (g.addH + g.addV))}</span></div>` : ''}
          ${g.addC ? `<div class="sum-row"><span>เพิ่มคุกกี้ ${g.addC} ชิ้น</span><span>+${money(GOOEY.extraCookie * g.addC)}</span></div>` : ''}
          <div class="sum-row muted"><span>ราคาต่อเซ็ต × ${g.qty}</span><span>${money(setPrice)}</span></div>
          <div class="sum-row total"><span>รวม</span><span>${money(total)}</span></div>
        </div>
        ${!g.main ? '<div class="warn-box">กรุณาเลือกไอศกรีมหลักในเซ็ต</div>' : (!valid ? '<div class="err-box">สต็อกไม่พอสำหรับตัวเลือกนี้</div>' : '')}
      </div>
    </div>`;

  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button>
    <button class="btn btn-primary btn-lg" data-act="gooey-ok" type="button" ${valid ? '' : 'disabled'}>
      ${g.editId ? 'บันทึกการแก้ไข' : 'เพิ่มลงตะกร้า'} · ${money(total)}
    </button>`;
}

function gooeyStep(field, d) {
  const g = gooeyCtx;
  const next = g[field] + d;
  if (next < (field === 'qty' ? 1 : 0)) return;
  if (d > 0 && !gooeyTry({ [field]: next })) return toast('สต็อกไม่พอ', 'error');
  g[field] = next;
  renderGooey();
}

function gooeyConfirm() {
  const g = gooeyCtx;
  if (!gooeyFits(g)) return toast('กรุณาเลือกไอศกรีมหลัก หรือสต็อกไม่พอ', 'error');
  const cfg = { main: g.main, addH: g.addH, addV: g.addV, addC: g.addC, qty: g.qty };
  if (g.editId) {
    const line = state.cart.lines.find((l) => l.id === g.editId);
    if (line) Object.assign(line, cfg);
  } else {
    const same = state.cart.lines.find((l) => l.type === 'gooey' && l.main === cfg.main && l.addH === cfg.addH && l.addV === cfg.addV && l.addC === cfg.addC);
    if (same) same.qty += cfg.qty;
    else state.cart.lines.push(Object.assign({ id: uid(), type: 'gooey', menuId: 'gooey_set' }, cfg));
  }
  closeModal('m-gooey');
  cartChanged();
  toast('เพิ่ม Gooey Chocolate + Ice Cream แล้ว', 'success', 1600);
}

/* ==========================================================================
   11. PAYMENT & CHECKOUT
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

function nextOrderId(d) {
  const prefix = `ORD-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`;
  let max = 0;
  for (const o of state.orders) {
    if (o.id.startsWith(prefix)) max = Math.max(max, parseInt(o.id.slice(prefix.length), 10) || 0);
  }
  return prefix + pad(max + 1, 3);
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
    device: state.settings.deviceName || '',
    items: state.cart.lines.map((l, i) => {
      const m = MENU_BY_ID[l.menuId];
      const gross = lineGross(l);
      const itemDiscount = lineItemDiscount(l);
      return {
        lineNo: i + 1,
        type: l.type,
        menuId: l.menuId,
        category: CATEGORY_NAME[m.cat],
        name: lineTitle(l),
        detail: lineDetail(l),
        qty: l.type === 'cereal' ? 1 : l.qty,
        unitPrice: l.type === 'unit' ? m.price : l.type === 'gooey' ? gooeySetPrice(l) : m.pricePerGram,
        soldG: l.soldG || 0,
        freeG: l.freeG || 0,
        main: l.main || '',
        addH: l.addH || 0,
        addV: l.addV || 0,
        addC: l.addC || 0,
        gross,
        itemDiscount,
        net: round2(gross - itemDiscount),
        needs: lineNeeds(l),
      };
    }),
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

  // 1) persist the order first — abort cleanly if storage is full
  state.orders.push(order);
  if (!save.orders()) {
    state.orders.pop();
    payCtx.busy = false;
    updatePayState();
    return;
  }
  // 2) deduct stock
  for (const k in order.stockDeduction) state.stock[k] = Math.max(0, (state.stock[k] || 0) - order.stockDeduction[k]);
  save.stock();
  // 3) queue for Google Sheets
  enqueue('NEW_ORDER', order.id);
  // 4) clear cart
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
   12. HISTORY, SALES SUMMARY & VOID
   ========================================================================== */

let histDate = todayKey();

function openHistory() {
  histDate = todayKey();
  renderHistory();
  openModal('m-history');
}

function orderSyncPill(o) {
  if (o.status === 'VOIDED') {
    return o.voidSynced ? '<span class="pill pill-ok">VOID ✓ Synced</span>' : '<span class="pill pill-wait">VOID รอ Sync</span>';
  }
  return o.synced ? '<span class="pill pill-ok">✓ Synced</span>' : '<span class="pill pill-wait">รอ Sync</span>';
}

function renderHistory() {
  const modal = $('#m-history');
  const orders = state.orders.filter((o) => o.date === histDate).sort((a, b) => (a.createdAtUTC < b.createdAtUTC ? 1 : -1));
  const done = orders.filter((o) => o.status !== 'VOIDED');
  const voided = orders.length - done.length;
  const sum = (arr, f) => round2(arr.reduce((s, o) => s + f(o), 0));
  const byMethod = (m) => sum(done.filter((o) => o.payment.method === m), (o) => o.net);
  const countMethod = (m) => done.filter((o) => o.payment.method === m).length;

  // items sold summary (from stock deducted on completed bills)
  const sold = {};
  let freeG = 0;
  for (const o of done) {
    mergeNeeds(sold, o.stockDeduction || {});
    for (const i of o.items) freeG += i.freeG || 0;
  }
  const soldRows = Object.keys(STOCK_ITEMS).filter((k) => sold[k]).map((k) =>
    `<div><span>${esc(STOCK_ITEMS[k].name)}</span><b>${fmtNum(sold[k])} ${UNIT_LABEL[STOCK_ITEMS[k].unit]}</b></div>`).join('');

  const rows = orders.map((o) => `
    <tr class="${o.status === 'VOIDED' ? 'voided' : ''}">
      <td class="oid">${esc(o.id)}</td>
      <td class="nowrap">${esc(o.createdAtTH.split(' ')[0])}<div class="help" style="margin:0">${esc(o.createdAtTH.split(' ')[1] || '')}</div></td>
      <td class="items-cell">${o.items.map((i) => `<div><b>${esc(i.name)}</b> — ${esc(i.detail)}</div>`).join('')}</td>
      <td class="num strike">${money(o.subtotal)}</td>
      <td class="num strike">${negMoney(o.promoDiscount + o.itemDiscount)}${o.itemDiscount ? `<div class="help">รวมลดรายการ ${money(o.itemDiscount)}</div>` : ''}</td>
      <td class="num strike">${negMoney(o.manualDiscount)}</td>
      <td class="num strike"><b>${money(o.net)}</b></td>
      <td>${esc(o.payment.label)}${o.payment.cashReceived != null ? `<div class="help">รับ ${money(o.payment.cashReceived)}<br/>ทอน ${money(o.payment.change)}</div>` : ''}</td>
      <td>${orderSyncPill(o)}</td>
      <td>${o.status === 'VOIDED'
        ? `<span class="pill pill-void">ยกเลิกบิล</span><div class="help">${esc(o.voidedAtTH)}${o.voidReason ? `<br/>${esc(o.voidReason)}` : ''}</div>`
        : `<span class="pill pill-ok">ปกติ</span><div style="margin-top:8px"><button class="btn btn-danger btn-sm" data-void="${esc(o.id)}" type="button">ยกเลิกบิล</button></div>`}</td>
    </tr>`).join('');

  modal.querySelector('.modal-body').innerHTML = `
    <div class="hist-toolbar">
      <button class="icon-btn" data-day="-1" type="button" aria-label="วันก่อนหน้า">${svg('left')}</button>
      <input class="input" id="histDate" type="date" value="${histDate}" max="${todayKey()}" />
      <button class="icon-btn" data-day="1" type="button" aria-label="วันถัดไป" ${histDate >= todayKey() ? 'disabled' : ''}>${svg('right')}</button>
      <button class="btn btn-outline" data-day="today" type="button">วันนี้</button>
      <span class="grow"></span>
      <span class="help">แสดงข้อมูลวันที่ <b>${fmtDateKeyTH(histDate)}</b> · ยอดขายไม่รวมบิลที่ยกเลิก</span>
    </div>

    <div class="stat-grid">
      <div class="stat primary span2"><div class="k">ยอดขายสุทธิรวม</div><div class="v">${money(sum(done, (o) => o.net))}</div><div class="s">${done.length} บิลสำเร็จ${voided ? ` · ยกเลิก ${voided} บิล` : ''}</div></div>
      <div class="stat"><div class="k">เงินสด</div><div class="v">${money(byMethod('cash'))}</div><div class="s">${countMethod('cash')} บิล</div></div>
      <div class="stat"><div class="k">สแกน QR</div><div class="v">${money(byMethod('qr'))}</div><div class="s">${countMethod('qr')} บิล</div></div>
      <div class="stat"><div class="k">ไทยช่วยไทยพลัส</div><div class="v">${money(byMethod('tcp'))}</div><div class="s">${countMethod('tcp')} บิล</div></div>
      <div class="stat"><div class="k">ส่วนลดรวมทั้งหมด</div><div class="v">${money(sum(done, (o) => o.totalDiscount))}</div>
        <div class="s">โปร ${money(sum(done, (o) => o.promoDiscount))} · รายการ ${money(sum(done, (o) => o.itemDiscount))} · เพิ่มเติม ${money(sum(done, (o) => o.manualDiscount))}</div></div>
    </div>

    ${soldRows ? `
      <details class="sold-summary">
        <summary>สรุปจำนวนสินค้าที่ตัดสต็อก (บิลสำเร็จ)${freeG ? ` · ซีเรียลแถมรวม ${fmtNum(freeG)} ก.` : ''}</summary>
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
      </div>` : `<div class="empty-state">${svg('receipt', 48)}<p>ไม่มีบิลในวันที่เลือก</p></div>`}`;
}

async function voidOrder(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status === 'VOIDED') return;
  const restore = Object.keys(o.stockDeduction || {}).map((k) => `${STOCK_ITEMS[k] ? STOCK_ITEMS[k].name : k} +${fmtNum(o.stockDeduction[k])} ${STOCK_ITEMS[k] ? UNIT_LABEL[STOCK_ITEMS[k].unit] : ''}`);
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
   13. STOCK & IMAGE MANAGEMENT
   ========================================================================== */

let imageTarget = null;

function openStock() {
  renderStock();
  openModal('m-stock');
}

function renderStock() {
  const modal = $('#m-stock');
  modal.querySelector('.modal-body').innerHTML = STOCK_GROUPS.map((g) => `
    <div class="stock-group">
      <h3>${esc(g.title)} <small>${esc(g.note)}</small></h3>
      ${g.keys.map((k) => stockRowHTML(k)).join('')}
    </div>`).join('') + `<p class="help">รูปภาพถูกย่อเป็น 300×300 JPEG และเก็บไว้ในเครื่อง (IndexedDB) ใช้งานออฟไลน์ได้</p>`;
}

function stockRowHTML(k) {
  const it = STOCK_ITEMS[k];
  const unit = UNIT_LABEL[it.unit];
  const img = it.image ? state.images[it.image] : null;
  const quick = it.unit === 'g' ? [[-100, '-100g'], [100, '+100g'], [500, '+500g']] : [[-1, '-1'], [5, '+5'], [10, '+10']];
  const imgBlock = it.image
    ? `<div class="stock-thumb">${img ? `<img src="${img}" alt="" />` : svg('image', 30)}</div>`
    : `<div class="stock-thumb none">${svg('cookie', 28)}</div>`;
  const imgActions = it.image ? `
    <div class="stock-img-actions">
      <button class="btn btn-ghost btn-sm" data-img="${it.image}" type="button">${svg('image', 18)} ${img ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</button>
      ${img ? `<button class="btn btn-ghost btn-sm" data-img-del="${it.image}" type="button" style="color:var(--danger)">ลบรูป</button>` : ''}
    </div>` : '<div class="stock-meta">ใช้ร่วมในเมนู Gooey Chocolate + Ice Cream</div>';
  return `
    <div class="stock-row" data-row="${k}">
      ${imgBlock}
      <div>
        <div class="stock-name">${esc(it.name)}</div>
        <div class="stock-meta">รหัส: ${k} · หน่วย: ${unit}${it.unit === 'g' ? ` · SOLD OUT เมื่อ &lt; ${CEREAL_MIN_G} ก.` : ''}</div>
        ${imgActions}
      </div>
      <div class="stock-input-wrap">
        <input class="stock-input ${state.stock[k] <= 0 ? 'zero' : ''}" data-stock="${k}" type="number" inputmode="numeric" min="0" step="1" value="${state.stock[k]}" />
        <span class="stock-unit">${unit}</span>
      </div>
      <div class="quick-add">
        ${quick.map(([n, label]) => `<button class="${n < 0 ? 'minus' : ''}" data-quick="${k}" data-n="${n}" type="button">${label}</button>`).join('')}
      </div>
    </div>`;
}

function setStock(key, value, flash = true) {
  state.stock[key] = toInt(value);
  save.stock();
  const row = $(`#m-stock [data-row="${key}"]`);
  if (row) {
    const input = row.querySelector('.stock-input');
    if (document.activeElement !== input) input.value = state.stock[key];
    input.classList.toggle('zero', state.stock[key] <= 0);
    if (flash) { row.classList.remove('flash-ok'); void row.offsetWidth; row.classList.add('flash-ok'); }
  }
  renderMenu();
  renderCart();
}

async function onImagePicked(file) {
  if (!file || !imageTarget) return;
  const target = imageTarget;
  imageTarget = null;
  try {
    toast('กำลังย่อรูปภาพ…', '', 1200);
    const data = await compressImage(file);
    await ImageStore.put(target, data);
    state.images[target] = data;
    if (isOpen('m-stock')) renderStock();
    renderMenu();
    toast(`บันทึกรูป ${MENU_BY_ID[target].fullName} แล้ว (${Math.round(data.length * 0.75 / 1024)} KB)`, 'success');
  } catch (e) {
    console.error(e);
    toast(e.message || 'อัปโหลดรูปไม่สำเร็จ', 'error', 4000);
  }
}

async function deleteImage(menuId) {
  const r = await confirmDialog({ title: 'ลบรูปภาพ', html: `ลบรูปของ <b>${esc(MENU_BY_ID[menuId].fullName)}</b> ?`, okText: 'ลบรูป', danger: true });
  if (!r.ok) return;
  await ImageStore.remove(menuId);
  delete state.images[menuId];
  renderStock();
  renderMenu();
}

/* ==========================================================================
   14. GOOGLE SHEETS SYNC QUEUE
   ========================================================================== */

function enqueue(action, orderId) {
  state.queue.push({ qid: uid(), action, orderId, createdAt: isoLocal(new Date()), attempts: 0, lastError: '' });
  save.queue();
  renderHeader();
}

/** Flat payload the Apps Script writes into the sheet */
function orderSyncData(o) {
  return {
    orderId: o.id,
    status: o.status,
    date: o.date,
    dateTime: o.createdAtTH,
    timestampISO: o.createdAtISO,
    itemsDetail: o.items.map((i) => `${i.name} (${i.detail})`).join(' | '),
    subtotal: o.subtotal,
    promoDiscount: o.promoDiscount,
    promoDetail: o.promos.map((p) => `${p.label} x${p.bundles} (-${p.discount})`).join(', '),
    itemDiscount: o.itemDiscount,
    manualDiscount: o.manualDiscount,
    totalDiscount: o.totalDiscount,
    netTotal: o.net,
    paymentMethod: o.payment.label,
    cashReceived: o.payment.cashReceived == null ? '' : o.payment.cashReceived,
    change: o.payment.change == null ? '' : o.payment.change,
    device: o.device,
    voidedAt: o.voidedAtTH || '',
    voidReason: o.voidReason || '',
    items: o.items.map((i) => ({
      lineNo: i.lineNo,
      category: i.category,
      menu: i.name,
      menuId: i.menuId,
      detail: i.detail,
      qty: i.qty,
      soldGrams: i.soldG,
      freeGrams: i.freeG,
      mainScoop: i.main ? ICE[i.main].en : '',
      addHokkaido: i.addH,
      addVanilla: i.addV,
      addGooeyCookie: i.addC,
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
 * POST as text/plain (a "simple" request → no CORS preflight).
 * Google Apps Script answers with Access-Control-Allow-Origin:* so we can usually read the JSON.
 * If the response cannot be read (CORS / redirect quirks) we retry in no-cors mode and treat the
 * opaque response as delivered — the script upserts by Order_ID so re-sends are harmless.
 */
async function postToSheet(url, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  let res;
  try {
    res = await fetchWithTimeout(url, { method: 'POST', headers, body, redirect: 'follow' }, 25000);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('หมดเวลาเชื่อมต่อ (timeout)');
    await fetchWithTimeout(url, { method: 'POST', mode: 'no-cors', headers, body }, 25000);
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
  if (!state.queue.length) { if (!silent) toast('ข้อมูล Sync ครบแล้ว ✓', 'success'); return; }
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
    // drop queue items whose order no longer exists
    state.queue = state.queue.filter((q) => state.orders.some((o) => o.id === q.orderId));
    const snapshot = state.queue.slice();
    for (let i = 0; i < snapshot.length; i += 20) {
      const batch = snapshot.slice(i, i + 20);
      const actions = batch.map(buildAction).filter(Boolean);
      let doneIds = [];
      const errors = {};
      try {
        const res = await postToSheet(url, { source: 'ipad-pos', appVersion: APP_VERSION, device: state.settings.deviceName, actions });
        if (res.opaque) doneIds = batch.map((q) => q.qid);
        else {
          for (const r of res.results || []) {
            if (r.ok) doneIds.push(r.qid);
            else errors[r.qid] = r.error || 'error';
          }
        }
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
      if (lastError && !doneIds.length) break; // network/server down — stop early
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
    if (failCount) toast(`Sync ไม่สำเร็จ ${failCount} รายการ: ${lastError}`, 'error', 5000);
    else toast(`Sync สำเร็จ ${okCount} รายการ ✓`, 'success');
  }
}

async function testConnection() {
  const url = ($('#gasUrl') ? $('#gasUrl').value : state.settings.gasUrl).trim();
  if (!url) return toast('กรุณาใส่ URL ก่อน', 'warn');
  if (!navigator.onLine) return toast('ออฟไลน์อยู่', 'warn');
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, 20000);
    const json = JSON.parse(await res.text());
    if (json.ok) toast(`เชื่อมต่อสำเร็จ ✓ ${json.sheet ? `(${json.sheet})` : ''}`, 'success', 3500);
    else toast(`เชื่อมต่อได้แต่มีข้อผิดพลาด: ${json.error}`, 'error', 5000);
  } catch (e) {
    toast('เชื่อมต่อไม่สำเร็จ — ตรวจสอบ URL และการ Deploy (Who has access: Anyone)', 'error', 5000);
  }
}

/* ==========================================================================
   15. SETTINGS, BACKUP & MAINTENANCE
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
  const prev = keepInputs ? {
    url: $('#gasUrl') && $('#gasUrl').value,
    shop: $('#shopNameInput') && $('#shopNameInput').value,
    dev: $('#deviceInput') && $('#deviceInput').value,
  } : {};
  const s = state.settings;
  const q = state.queue;
  const canShare = !!(navigator.canShare && window.File);

  modal.querySelector('.modal-body').innerHTML = `
    <div class="section">
      <div class="section-title">Google Sheets Web App URL</div>
      <div class="row nowrap">
        <input class="input grow" id="gasUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="https://script.google.com/macros/s/XXXX/exec" value="${esc(prev.url != null ? prev.url : s.gasUrl)}" />
        <button class="btn btn-primary" data-act="save-url" type="button">บันทึก</button>
        <button class="btn btn-outline" data-act="test-url" type="button">${svg('link', 18)} ทดสอบ</button>
      </div>
      <p class="help">วาง URL ที่ได้จากการ Deploy Google Apps Script เป็น Web App (ลงท้ายด้วย /exec) — ดูขั้นตอนใน README.md</p>
      <dl class="kv" style="margin-top:10px">
        <dt>Sync ล่าสุด</dt><dd>${esc(s.lastSyncAt || '-')}</dd>
        <dt>สถานะ</dt><dd>${s.lastSyncError ? `<span style="color:var(--danger)">${esc(s.lastSyncError)}</span>` : (s.lastSyncAt ? '<span style="color:var(--ok)">สำเร็จ</span>' : '-')}</dd>
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
          <span class="pill ${it.action === 'VOID_ORDER' ? 'pill-void' : 'pill-mute'}">${it.action}</span>
          <div class="grow"><b>${esc(it.orderId)}</b> <span class="help">${esc(it.createdAt.replace('T', ' ').slice(0, 19))}</span>
            ${it.lastError ? `<div class="q-err">พยายาม ${it.attempts} ครั้ง: ${esc(it.lastError)}</div>` : ''}</div>
        </div>`).join('')}</div>` : '<div class="ok-box">ไม่มีรายการค้าง — ข้อมูลทั้งหมด Sync แล้ว ✓</div>'}
    </div>

    <div class="section">
      <div class="section-title">ข้อมูลร้าน / อุปกรณ์</div>
      <div class="row">
        <div class="grow"><label class="field-label" for="shopNameInput">ชื่อร้าน</label>
          <input class="input" id="shopNameInput" type="text" value="${esc(prev.shop != null ? prev.shop : s.shopName)}" /></div>
        <div class="grow"><label class="field-label" for="deviceInput">ชื่ออุปกรณ์ (ส่งไปที่ Sheet)</label>
          <input class="input" id="deviceInput" type="text" value="${esc(prev.dev != null ? prev.dev : s.deviceName)}" /></div>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn btn-outline" data-act="save-shop" type="button">บันทึกข้อมูลร้าน</button></div>
    </div>

    <div class="section">
      <div class="section-title">สำรองข้อมูล (Backup)</div>
      <p class="help" style="margin:0 0 10px">ไฟล์ JSON รวม สต็อก · ประวัติบิล · คิว Sync · ตั้งค่า · รูปเมนู — ใช้ย้ายเครื่องหรือกู้คืนข้อมูล</p>
      <div class="row">
        <button class="btn btn-primary" data-act="export" type="button">${svg('download', 18)} Export Backup (JSON)</button>
        ${canShare ? `<button class="btn btn-outline" data-act="share" type="button">${svg('share', 18)} แชร์ไฟล์ Backup (AirDrop / Files)</button>` : ''}
        <button class="btn btn-outline" data-act="import" type="button">${svg('upload', 18)} Import Backup (JSON)</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">บำรุงรักษา</div>
      <dl class="kv">
        <dt>เวอร์ชันแอป</dt><dd>${APP_VERSION}</dd>
        <dt>บิลทั้งหมดในเครื่อง</dt><dd>${state.orders.length} บิล</dd>
        <dt>พื้นที่ localStorage</dt><dd>~${storageUsageKB()} KB (จำกัดประมาณ 5,000 KB)</dd>
      </dl>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-outline" data-act="update-app" type="button">${svg('refresh', 18)} Update App Version</button>
        <button class="btn btn-ghost" data-act="cleanup" type="button">ล้างบิลเก่าที่ Sync แล้ว (เกิน 60 วัน)</button>
      </div>
    </div>`;
}

function backupPayload() {
  return {
    app: 'ipad-pos',
    schema: 1,
    appVersion: APP_VERSION,
    exportedAt: isoLocal(new Date()),
    stock: state.stock,
    orders: state.orders,
    queue: state.queue,
    settings: state.settings,
    images: state.images,
  };
}
function backupFileName() {
  const d = new Date();
  return `pos-backup-${dateKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
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
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    return toast('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง', 'error');
  }
  if (!data || data.app !== 'ipad-pos' || !Array.isArray(data.orders)) return toast('ไฟล์ Backup ไม่ถูกต้อง', 'error');
  const r = await confirmDialog({
    title: 'Import Backup',
    html: `<p>ข้อมูลในไฟล์ (Export เมื่อ ${esc(data.exportedAt || '-')}):</p>
           <p>บิล <b>${data.orders.length}</b> · คิว Sync <b>${(data.queue || []).length}</b> · รูปภาพ <b>${Object.keys(data.images || {}).length}</b></p>
           <p class="err-box">ข้อมูลปัจจุบันในเครื่องนี้จะถูกแทนที่ทั้งหมด (ตะกร้าจะถูกล้าง)</p>`,
    okText: 'นำเข้าและแทนที่',
    danger: true,
  });
  if (!r.ok) return;

  state.stock = sanitizeStock(data.stock);
  state.orders = data.orders;
  state.queue = Array.isArray(data.queue) ? data.queue : [];
  state.settings = Object.assign(defaultSettings(), data.settings || {});
  state.cart = { lines: [], manualDiscount: '' };
  $('#manualDiscount').value = '';
  const ok = save.orders() && save.stock() && save.queue() && save.settings() && save.cart();

  await ImageStore.clear();
  state.images = {};
  for (const [id, url] of Object.entries(data.images || {})) {
    if (MENU_BY_ID[id] && typeof url === 'string' && url.startsWith('data:image/')) {
      await ImageStore.put(id, url);
      state.images[id] = url;
    }
  }
  renderAll();
  renderSettings();
  toast(ok ? 'นำเข้าข้อมูลสำเร็จ ✓' : 'นำเข้าแล้วบางส่วน — พื้นที่จัดเก็บไม่พอ', ok ? 'success' : 'error', 4000);
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
   16. PWA — SERVICE WORKER & UPDATE
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
  if (state.cart.lines.length) save.cart();
  toast('กำลังดาวน์โหลดเวอร์ชันล่าสุด…', '', 4000);
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        const worker = navigator.serviceWorker.controller || reg.active;
        const res = await swMessage(worker, { type: 'REFRESH_CACHE' }, 20000);
        if (res && res.ok === false) console.warn('cache refresh failed', res.error);
      }
    }
  } catch (e) {
    console.warn('update failed', e);
  }
  // localStorage + IndexedDB are untouched — only app files are refreshed
  setTimeout(() => location.reload(), 300);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => { reg.update().catch(() => {}); })
    .catch((e) => console.warn('SW register failed', e));
}

/* ==========================================================================
   17. EVENTS & INIT
   ========================================================================== */

function bindEvents() {
  // header
  $('#btnSync').addEventListener('click', () => syncNow());
  $('#btnStock').addEventListener('click', openStock);
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnUpdate').addEventListener('click', updateApp);

  // tabs & menu
  $('#catTabs').addEventListener('click', (e) => {
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

  // cart
  $('#cartList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const line = state.cart.lines.find((l) => l.id === id);
    if (b.dataset.act === 'inc') changeQty(id, 1);
    else if (b.dataset.act === 'dec') changeQty(id, -1);
    else if (b.dataset.act === 'remove') removeLine(id);
    else if (b.dataset.act === 'edit' && line) {
      if (line.type === 'cereal') openCereal(line.menuId, line);
      else if (line.type === 'gooey') openGooey(line);
    }
  });
  $('#btnClearCart').addEventListener('click', clearCart);
  const manual = $('#manualDiscount');
  manual.value = state.cart.manualDiscount || '';
  manual.addEventListener('input', () => {
    const cleaned = manual.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    if (cleaned !== manual.value) manual.value = cleaned;
    state.cart.manualDiscount = cleaned;
    save.cart();
    renderTotals();
  });
  manual.addEventListener('focus', () => manual.select());
  $('#btnCheckout').addEventListener('click', openPayment);

  // generic modal close buttons
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) c.closest('.modal').classList.remove('open');
  });

  // cereal modal
  $('#m-cereal').addEventListener('click', (e) => {
    const f = e.target.closest('[data-field]');
    if (f) { cerealCtx.active = f.dataset.field; return renderCereal(); }
    const k = e.target.closest('[data-key]');
    if (k) return cerealKey(k.dataset.key);
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const a = cerealCtx.active;
      cerealCtx.f[a] = String(toInt(cerealCtx.f[a]) + Number(chip.dataset.chip));
      return renderCereal();
    }
    if (e.target.closest('[data-act="cereal-ok"]')) cerealConfirm();
  });

  // gooey modal
  $('#m-gooey').addEventListener('click', (e) => {
    const mainBtn = e.target.closest('[data-main]');
    if (mainBtn && !mainBtn.disabled) { gooeyCtx.main = mainBtn.dataset.main; return renderGooey(); }
    const st = e.target.closest('[data-step]');
    if (st && !st.disabled) return gooeyStep(st.dataset.step, Number(st.dataset.d));
    if (e.target.closest('[data-act="gooey-ok"]')) gooeyConfirm();
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
    const cleaned = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    if (cleaned !== e.target.value) e.target.value = cleaned;
    payCtx.cash = cleaned;
    updatePayState();
  });

  // stock modal
  const stock = $('#m-stock');
  stock.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) {
      const k = q.dataset.quick;
      return setStock(k, Math.max(0, (state.stock[k] || 0) + Number(q.dataset.n)));
    }
    const img = e.target.closest('[data-img]');
    if (img) { imageTarget = img.dataset.img; $('#imageInput').value = ''; return $('#imageInput').click(); }
    const del = e.target.closest('[data-img-del]');
    if (del) deleteImage(del.dataset.imgDel);
  });
  stock.addEventListener('change', (e) => {
    if (e.target.dataset.stock) setStock(e.target.dataset.stock, e.target.value);
  });
  stock.addEventListener('focusin', (e) => { if (e.target.dataset.stock) e.target.select(); });
  $('#imageInput').addEventListener('change', (e) => onImagePicked(e.target.files && e.target.files[0]));

  // history modal
  const hist = $('#m-history');
  hist.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (d && !d.disabled) {
      histDate = d.dataset.day === 'today' ? todayKey() : shiftDateKey(histDate, Number(d.dataset.day));
      if (histDate > todayKey()) histDate = todayKey();
      return renderHistory();
    }
    const v = e.target.closest('[data-void]');
    if (v) voidOrder(v.dataset.void);
  });
  hist.addEventListener('change', (e) => {
    if (e.target.id === 'histDate' && e.target.value) { histDate = e.target.value; renderHistory(); }
  });

  // settings modal
  $('#m-settings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
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
    else if (act === 'save-shop') {
      state.settings.shopName = $('#shopNameInput').value.trim() || 'Cookie POS';
      state.settings.deviceName = $('#deviceInput').value.trim() || 'iPad-1';
      save.settings();
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

  // network status
  window.addEventListener('online', () => { renderHeader(); toast('กลับมาออนไลน์แล้ว', 'success'); syncNow({ silent: true }); });
  window.addEventListener('offline', () => { renderHeader(); toast('ออฟไลน์ — ระบบยังขายได้ตามปกติ', 'warn'); });

  // Escape closes the top-most modal (keyboard users)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $$('.modal.open');
    if (open.length && open[open.length - 1].id !== 'm-confirm') open[open.length - 1].classList.remove('open');
  });

  // iOS: block pinch-zoom gestures
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // keep other tabs in sync (e.g. desktop testing)
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('pos.v1.')) return;
    state.stock = sanitizeStock(lsGet(LS.stock, null));
    state.orders = lsGet(LS.orders, []);
    state.queue = lsGet(LS.queue, []);
    renderAll();
  });
}

async function init() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon, el.classList.contains('brand-logo') ? 28 : 20); });
  bindEvents();
  renderTabs();
  renderClock();
  setInterval(renderClock, 1000);
  renderAll();

  try {
    state.images = await ImageStore.getAll();
    renderMenu();
  } catch (e) {
    console.warn('image load failed', e);
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSW();

  // background sync loop
  setTimeout(() => syncNow({ silent: true }), 2500);
  setInterval(() => { if (state.queue.length && navigator.onLine) syncNow({ silent: true }); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.queue.length) syncNow({ silent: true });
  });
}

document.addEventListener('DOMContentLoaded', init);

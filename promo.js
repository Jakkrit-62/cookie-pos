/* ==========================================================================
   iPad POS — promo.js  (v3: flexible promotion engine)
   Owner-defined rules — no code changes needed for new promotions:
     • bundle     ชุดราคาพิเศษ / จับคู่ข้ามหมวด  (slot A × n + slot B × m … = ราคา / ลด ฿ / ลด %)
     • discount   ลดราคาต่อชิ้น (% / ฿ / ขายชิ้นละ ฿)
     • bxgy       ซื้อ X แถม/ลด Y (กลุ่มเดียวกัน หรือได้ของอีกกลุ่ม)
     • threshold  ซื้อครบยอดขั้นต่ำ (ลด ฿ / ลด % / แถมฟรี) — ระดับบิล
   Every rule can target any mix of categories / menus (incl. sets & by-weight items),
   be limited per bill, be member-only and have a schedule (days, hours, date range).
   Loaded BEFORE app.js (normalizeCatalog uses normalizePromos at startup).
   ========================================================================== */
'use strict';

const PROMO_TYPES = {
  bundle: { label: 'ชุดราคาพิเศษ / จับคู่', hint: 'ครบตามเงื่อนไข (คละเมนู · ข้ามหมวดได้) = ราคาเดียว หรือ ลดต่อชุด' },
  discount: { label: 'ลดราคาต่อชิ้น', hint: 'ลด % · ลดเป็นบาท · หรือขายชิ้นละ X บาท ทุกชิ้นที่เข้าเงื่อนไข' },
  bxgy: { label: 'ซื้อ X แถม/ลด Y', hint: 'เช่น ซื้อ 5 แถม 1 · ชิ้นที่ 2 ลด 50% · ซื้อคุกกี้ 2 ได้เครื่องดื่มราคา 20' },
  threshold: { label: 'ซื้อครบยอดขั้นต่ำ', hint: 'ครบ ฿X ลดเป็นบาท / % / แถมฟรี (คิดท้ายบิล)' },
};
const REWARD_KINDS = {
  bundle: { price: 'ราคาชุด (฿)', off: 'ลดต่อชุด (฿)', pct: 'ลดต่อชุด (%)' },
  discount: { pct: 'ลด (%)', off: 'ลดชิ้นละ (฿)', price: 'ขายชิ้นละ (฿)' },
  bxgy: { free: 'แถมฟรี', pct: 'ลด (%)', off: 'ลดชิ้นละ (฿)', price: 'ราคาพิเศษชิ้นละ (฿)' },
  threshold: { off: 'ลดท้ายบิล (฿)', pct: 'ลดท้ายบิล (%)', free: 'แถมฟรี (ชิ้นที่ถูกที่สุด)' },
};
const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const PERM_SEARCH_LIMIT = 7; // "best for customer" tries every order of up to 7 item-level promos

/* ---------- model ---------- */

function normalizeMatch(m) {
  m = m || {};
  const arr = (a) => (Array.isArray(a) ? [...new Set(a.map(String).filter(Boolean))] : []);
  return { all: !!m.all, cats: arr(m.cats), items: arr(m.items), exclude: arr(m.exclude) };
}
const matchEmpty = (m) => !m || (!m.all && !m.cats.length && !m.items.length);

function defaultPromo(type) {
  const base = { id: `p_${uid()}`, name: '', active: true, type, tag: '', maxUses: 0, memberOnly: false,
    match: normalizeMatch({}), schedule: { days: [], from: '', to: '', start: '', end: '' } };
  if (type === 'bundle') return Object.assign(base, { name: 'โปรชุดใหม่', slots: [{ qty: 3, match: normalizeMatch({}) }], reward: { kind: 'price', value: 100 } });
  if (type === 'discount') return Object.assign(base, { name: 'โปรลดราคา', minQty: 1, reward: { kind: 'pct', value: 10 } });
  if (type === 'bxgy') return Object.assign(base, { name: 'โปรซื้อ X แถม Y', buyQty: 2, getQty: 1, getSame: true, getMatch: normalizeMatch({}), reward: { kind: 'free', value: 0 } });
  return Object.assign(base, { name: 'โปรครบยอด', match: normalizeMatch({ all: true }), minSpend: 300, repeat: false, stackable: false,
    reward: { kind: 'off', value: 30, qty: 1, match: normalizeMatch({}) } });
}

function normalizePromo(x) {
  const type = PROMO_TYPES[x.type] ? x.type : 'bundle';
  const d = defaultPromo(type);
  const r = x.reward || {};
  const kinds = REWARD_KINDS[type];
  const sch = x.schedule || {};
  const hm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '');
  const dk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const p = {
    id: String(x.id || d.id),
    name: String(x.name || d.name),
    active: x.active !== false,
    type,
    tag: String(x.tag || ''),
    maxUses: toInt(x.maxUses),
    memberOnly: !!x.memberOnly,
    match: normalizeMatch(x.match),
    schedule: {
      days: Array.isArray(sch.days) ? [...new Set(sch.days.map(Number).filter((n) => n >= 0 && n <= 6))].sort() : [],
      from: hm(sch.from), to: hm(sch.to), start: dk(sch.start), end: dk(sch.end),
    },
    reward: { kind: kinds[r.kind] ? r.kind : d.reward.kind, value: Math.max(0, num(r.value)) },
  };
  if (type === 'bundle') {
    p.slots = (Array.isArray(x.slots) ? x.slots : d.slots).map((s) => ({ qty: Math.max(1, toInt(s && s.qty) || 1), match: normalizeMatch(s && s.match) }));
    if (!p.slots.length) p.slots = d.slots;
  } else if (type === 'discount') {
    p.minQty = Math.max(1, toInt(x.minQty) || 1);
  } else if (type === 'bxgy') {
    p.buyQty = Math.max(1, toInt(x.buyQty) || 1);
    p.getQty = Math.max(1, toInt(x.getQty) || 1);
    p.getSame = x.getSame !== false;
    p.getMatch = normalizeMatch(x.getMatch);
  } else {
    p.minSpend = Math.max(0, num(x.minSpend));
    p.repeat = !!x.repeat;
    p.stackable = !!x.stackable;
    p.reward.qty = Math.max(1, toInt(r.qty) || 1);
    p.reward.match = normalizeMatch(r.match);
  }
  return p;
}

/**
 * v1/v2 promos were { size, price } with membership stored on items/categories (promoId).
 * Convert them to bundle rules so existing shops keep their promotions after the update.
 */
function normalizePromos(raw) {
  const list = Array.isArray(raw.promos) ? raw.promos.filter((x) => x && x.id) : [];
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const rawCats = Array.isArray(raw.categories) ? raw.categories : [];
  return list.map((x) => {
    if (x.type) return normalizePromo(x);
    const cats = rawCats.filter((c) => c && c.promoId === x.id).map((c) => String(c.id));
    const items = rawItems.filter((it) => it && it.promoId === x.id && it.mode !== 'weight' && it.mode !== 'set').map((it) => String(it.id));
    const exclude = rawItems.filter((it) => it && cats.includes(String(it.categoryId)) &&
      ((it.promoId && it.promoId !== x.id) || it.mode === 'weight' || it.mode === 'set')).map((it) => String(it.id));
    return normalizePromo({
      id: x.id, name: x.name, active: x.active, type: 'bundle',
      slots: [{ qty: Math.max(2, toInt(x.size) || 2), match: { cats, items, exclude } }],
      reward: { kind: 'price', value: x.price },
    });
  });
}

/* ---------- matching & schedule ---------- */

function matchItem(m, menuId, catId) {
  if (!m || m.exclude.includes(menuId)) return false;
  return m.all || m.items.includes(menuId) || m.cats.includes(catId);
}
const matchUnit = (m, u) => matchItem(m, u.menuId, u.catId);

function promoScheduled(p, now) {
  const s = p.schedule;
  const dk = dateKey(now);
  if (s.start && dk < s.start) return false;
  if (s.end && dk > s.end) return false;
  if (s.days.length && !s.days.includes(now.getDay())) return false;
  if (s.from || s.to) {
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const from = s.from || '00:00';
    const to = s.to || '23:59';
    const inside = from <= to ? hm >= from && hm <= to : hm >= from || hm <= to; // overnight windows
    if (!inside) return false;
  }
  return true;
}
function promoLive(p, now, ctx) {
  if (!p.active || !promoScheduled(p, now)) return false;
  if (p.memberOnly && !(ctx && ctx.member)) return false;
  return true;
}

/** Every menu a promo can touch (used for card tags & the editor preview). */
function promoTouches(p, it) {
  const m = (x) => matchItem(x, it.id, it.categoryId);
  if (p.type === 'bundle') return p.slots.some((s) => m(s.match));
  if (p.type === 'bxgy') return m(p.match) || (!p.getSame && m(p.getMatch));
  if (p.type === 'threshold') return false;
  return m(p.match);
}

/* ---------- labels ---------- */

function promoShortTag(p) {
  if (p.tag) return p.tag;
  const r = p.reward;
  if (p.type === 'bundle') {
    const n = p.slots.reduce((s, x) => s + x.qty, 0);
    if (r.kind === 'price') return `${n} ชิ้น ฿${fmtNum(r.value)}`;
    return `ครบ ${n} ลด ${r.kind === 'pct' ? `${fmtNum(r.value)}%` : `฿${fmtNum(r.value)}`}`;
  }
  if (p.type === 'discount') return r.kind === 'pct' ? `ลด ${fmtNum(r.value)}%` : r.kind === 'off' ? `ลด ฿${fmtNum(r.value)}` : `เหลือ ฿${fmtNum(r.value)}`;
  if (p.type === 'bxgy') return r.kind === 'free' ? `ซื้อ ${p.buyQty} แถม ${p.getQty}` : `ซื้อ ${p.buyQty} ชิ้นถัดไปลด`;
  return '';
}

function matchText(m) {
  if (matchEmpty(m)) return '(ยังไม่ได้เลือกเมนู)';
  const parts = [];
  if (m.all) parts.push('ทุกเมนู');
  for (const c of m.cats) if (IDX.cat[c]) parts.push(`หมวด${IDX.cat[c].name}`);
  for (const i of m.items) if (IDX.item[i]) parts.push(IDX.item[i].name);
  let s = parts.join(', ') || '(เมนูที่เลือกถูกลบไปแล้ว)';
  const ex = m.exclude.filter((i) => IDX.item[i]);
  if (ex.length) s += ` (ยกเว้น ${ex.map((i) => IDX.item[i].name).join(', ')})`;
  return s;
}

function rewardText(p) {
  const r = p.reward;
  const v = fmtNum(r.value);
  if (p.type === 'bundle') return r.kind === 'price' ? `จ่าย ฿${v}` : r.kind === 'off' ? `ลด ฿${v}/ชุด` : `ลด ${v}%/ชุด`;
  if (p.type === 'discount') return r.kind === 'pct' ? `ลด ${v}%` : r.kind === 'off' ? `ลดชิ้นละ ฿${v}` : `ขายชิ้นละ ฿${v}`;
  if (p.type === 'bxgy') return r.kind === 'free' ? 'ฟรี' : r.kind === 'pct' ? `ลด ${v}%` : r.kind === 'off' ? `ลดชิ้นละ ฿${v}` : `ชิ้นละ ฿${v}`;
  return r.kind === 'off' ? `ลด ฿${v}` : r.kind === 'pct' ? `ลด ${v}%` : `แถมฟรี ${r.qty} ชิ้น (${matchEmpty(r.match) ? 'ชิ้นที่ถูกที่สุดในบิล' : matchText(r.match)})`;
}

function promoSummary(p) {
  if (p.type === 'bundle') return `ซื้อ ${p.slots.map((s) => `${matchText(s.match)} × ${s.qty}`).join(' + ')} → ${rewardText(p)}`;
  if (p.type === 'discount') return `${matchText(p.match)}${p.minQty > 1 ? ` (ซื้อตั้งแต่ ${p.minQty} ชิ้น)` : ''} → ${rewardText(p)}`;
  if (p.type === 'bxgy') {
    const get = p.getSame ? 'ชิ้นที่ถูกที่สุดในกลุ่มเดียวกัน' : matchText(p.getMatch);
    return `ซื้อ ${matchText(p.match)} ${p.buyQty} ชิ้น → ได้ ${get} ${p.getQty} ชิ้น ${rewardText(p)}`;
  }
  return `ซื้อ${matchEmpty(p.match) || p.match.all ? '' : ` ${matchText(p.match)}`} ครบ ฿${fmtNum(p.minSpend)}${p.repeat ? ' (ทุก ๆ)' : ''} → ${rewardText(p)}`;
}

function scheduleText(s) {
  const parts = [];
  if (s.days.length && s.days.length < 7) parts.push(`ทุกวัน${s.days.map((d) => DAY_TH[d]).join('/')}`);
  if (s.from || s.to) parts.push(`${s.from || '00:00'}–${s.to || '23:59'} น.`);
  if (s.start || s.end) parts.push(`${s.start ? fmtDateKeyTH(s.start) : '…'} ถึง ${s.end ? fmtDateKeyTH(s.end) : '…'}`);
  return parts.join(' · ');
}

/* ---------- engine ---------- */

/** Cart lines → individual priced units (a set counts per set; a by-weight line is one unit). */
function cartUnits(lines) {
  const out = [];
  for (const l of lines) {
    const it = IDX.item[l.menuId];
    if (!it) continue;
    const base = { lineId: l.id, menuId: it.id, catId: it.categoryId };
    if (l.type === 'weight') {
      out.push(Object.assign({ key: l.id, price: round2(lineGross(l) - lineItemDiscount(l)) }, base));
    } else {
      const unit = l.type === 'set' ? setUnitPrice(it, l) : it.price;
      for (let i = 0; i < l.qty; i++) out.push(Object.assign({ key: `${l.id}#${i}`, price: unit }, base));
    }
  }
  return out;
}

function perUnitReward(r, price) {
  if (r.kind === 'free') return price;
  if (r.kind === 'pct') return price * Math.min(100, r.value) / 100;
  if (r.kind === 'off') return Math.min(r.value, price);
  if (r.kind === 'price') return Math.max(0, price - r.value);
  return 0;
}

/**
 * Run the promotions in the given order.
 * Item-level rules (bundle / discount / bxgy) each consume the units they use, so one unit
 * gets at most one item-level promo. Bill-level rules (threshold) run afterwards on what's left.
 */
function evalPromos(units, promos) {
  const rem = {};
  for (const u of units) rem[u.key] = u.price;
  const used = new Set();
  const applied = new Map();
  const lineDisc = {};

  const give = (p, list, amount, uses) => {
    const total = list.reduce((s, u) => s + rem[u.key], 0);
    let disc = round2(Math.min(amount, total));
    if (disc <= 0) return 0;
    let left = disc;
    list.forEach((u, i) => {
      const share = i === list.length - 1 ? left : round2(disc * rem[u.key] / total);
      const a = Math.min(share, rem[u.key], left);
      rem[u.key] = round2(rem[u.key] - a);
      left = round2(left - a);
      lineDisc[u.lineId] = round2((lineDisc[u.lineId] || 0) + a);
    });
    disc = round2(disc - left);
    const e = applied.get(p.id) || { key: p.id, label: p.name, type: p.type, bundles: 0, discount: 0 };
    e.bundles += uses;
    e.discount = round2(e.discount + disc);
    applied.set(p.id, e);
    return disc;
  };
  const free = () => units.filter((u) => !used.has(u.key)).sort((a, b) => b.price - a.price);
  const canUse = (p, n) => !p.maxUses || n < p.maxUses;

  for (const p of promos) {
    if (p.type === 'threshold') continue;
    let n = 0;
    if (p.type === 'bundle') {
      while (canUse(p, n)) {
        const pool = free();
        const taken = new Set();
        const pick = [];
        // fill the most constrained slot first so a broad slot never steals a specific one's units
        const slots = p.slots.slice().sort((a, b) => pool.filter((u) => matchUnit(a.match, u)).length - pool.filter((u) => matchUnit(b.match, u)).length);
        let ok = true;
        for (const s of slots) {
          const c = pool.filter((u) => !taken.has(u.key) && matchUnit(s.match, u)).slice(0, s.qty);
          if (c.length < s.qty) { ok = false; break; }
          c.forEach((u) => { taken.add(u.key); pick.push(u); });
        }
        if (!ok) break;
        const sum = pick.reduce((s, u) => s + u.price, 0);
        const r = p.reward;
        const disc = r.kind === 'price' ? sum - r.value : r.kind === 'off' ? r.value : sum * Math.min(100, r.value) / 100;
        if (disc <= 0.001) break;
        pick.forEach((u) => used.add(u.key));
        give(p, pick, disc, 1);
        n++;
      }
    } else if (p.type === 'discount') {
      const el = free().filter((u) => matchUnit(p.match, u));
      if (el.length < p.minQty) continue;
      const list = p.maxUses ? el.slice(0, p.maxUses) : el;
      for (const u of list) {
        const d = perUnitReward(p.reward, u.price);
        if (d <= 0) continue;
        used.add(u.key);
        give(p, [u], d, 1);
      }
    } else if (p.type === 'bxgy') {
      if (p.getSame) {
        const el = free().filter((u) => matchUnit(p.match, u));
        const size = p.buyQty + p.getQty;
        for (let i = 0; i + size <= el.length && canUse(p, n); i += size) {
          const chunk = el.slice(i, i + size);
          const gets = chunk.slice(p.buyQty);
          const d = gets.reduce((s, u) => s + perUnitReward(p.reward, u.price), 0);
          if (d <= 0) break;
          chunk.forEach((u) => used.add(u.key));
          give(p, gets, d, 1);
          n++;
        }
      } else {
        while (canUse(p, n)) {
          const buys = free().filter((u) => matchUnit(p.match, u)).slice(0, p.buyQty);
          if (buys.length < p.buyQty) break;
          const bset = new Set(buys.map((u) => u.key));
          const gets = free().filter((u) => !bset.has(u.key) && matchUnit(p.getMatch, u)).sort((a, b) => a.price - b.price).slice(0, p.getQty);
          if (gets.length < p.getQty) break;
          const d = gets.reduce((s, u) => s + perUnitReward(p.reward, u.price), 0);
          if (d <= 0) break;
          buys.concat(gets).forEach((u) => used.add(u.key));
          give(p, gets, d, 1);
          n++;
        }
      }
    }
  }

  for (const p of promos) {
    if (p.type !== 'threshold') continue;
    const el = units.filter((u) => (matchEmpty(p.match) || matchUnit(p.match, u)) && rem[u.key] > 0);
    const base = el.reduce((s, u) => s + rem[u.key], 0);
    if (base <= 0 || base < p.minSpend) continue;
    let times = p.repeat && p.minSpend > 0 ? Math.floor(base / p.minSpend) : 1;
    if (p.maxUses) times = Math.min(times, p.maxUses);
    const r = p.reward;
    let got = 0;
    if (r.kind === 'off') got = give(p, el, r.value * times, times);
    else if (r.kind === 'pct') got = give(p, el, base * Math.min(100, r.value) / 100, 1);
    else {
      const cand = units.filter((u) => rem[u.key] > 0 && (matchEmpty(r.match) || matchUnit(r.match, u)))
        .sort((a, b) => rem[a.key] - rem[b.key]).slice(0, r.qty * times);
      for (const u of cand) got += give(p, [u], rem[u.key], 0);
      if (got > 0) applied.get(p.id).bundles = Math.min(times, cand.length);
    }
    if (got > 0 && !p.stackable) break;
  }

  const list = [...applied.values()].filter((e) => e.discount > 0);
  return { promos: list, discount: round2(list.reduce((s, e) => s + e.discount, 0)), lineDisc };
}

/**
 * Promotions for a cart.
 * opt.off     — promo ids switched off for this bill (staff choice)
 * opt.mode    — 'priority' (owner order, default) | 'best' (try every order, keep the cheapest bill)
 * opt.member  — a member is attached (enables member-only promos)
 * opt.only    — evaluate just this promo (editor preview)
 */
function runPromoEngine(lines, opt = {}) {
  const units = cartUnits(lines);
  const empty = { promos: [], discount: 0, lineDisc: {}, live: [], mode: opt.mode || 'priority' };
  if (!units.length) return empty;
  const now = new Date();
  const off = new Set(opt.off || []);
  const all = opt.only ? [opt.only] : state.catalog.promos;
  const live = all.filter((p) => (opt.only || promoLive(p, now, opt)) && !off.has(p.id));
  const relevant = live.filter((p) => p.type === 'threshold' || units.some((u) => promoTouches(p, IDX.item[u.menuId])));
  const liveAll = all.filter((p) => (opt.only || promoLive(p, now, opt)) && (p.type === 'threshold' || units.some((u) => promoTouches(p, IDX.item[u.menuId]))));
  let best = evalPromos(units, relevant);
  const itemLevel = relevant.filter((p) => p.type !== 'threshold');
  const bills = relevant.filter((p) => p.type === 'threshold');
  if (opt.mode === 'best' && itemLevel.length > 1 && itemLevel.length <= PERM_SEARCH_LIMIT) {
    const permute = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permute(arr.slice(0, i).concat(arr.slice(i + 1))).map((r) => [x].concat(r))));
    for (const order of permute(itemLevel)) {
      const r = evalPromos(units, order.concat(bills));
      if (r.discount > best.discount + 0.001) best = r;
    }
  }
  return Object.assign(best, { live: liveAll, mode: opt.mode || 'priority' });
}

/** The first live, item-level promo that touches this menu (for the menu-card tag). */
function cardPromo(it) {
  const now = new Date();
  return state.catalog.promos.find((p) => p.active && !p.memberOnly && promoScheduled(p, now) && p.type !== 'threshold' && promoTouches(p, it)) || null;
}

/* ==========================================================================
   MANAGER — promotions tab + promo editor
   ========================================================================== */

function mgrPromosHTML() {
  const promos = state.catalog.promos;
  const now = new Date();
  return `
    <div class="info-strip" style="display:block">
      <b>ตั้งโปรได้เอง ไม่ต้องแก้โค้ด</b> — เลือกเมนู/หมวดที่ร่วมโปร คละกันหรือข้ามหมวดก็ได้ ·
      ถ้าสินค้าเข้าได้หลายโปร ระบบใช้ <b>ลำดับด้านล่าง</b> (บนสุดได้สิทธิ์ก่อน) และพนักงานกดเลือก “ลูกค้าคุ้มสุด” หรือปิดโปรบางตัวในบิลได้
    </div>
    ${promos.map((p, i) => {
      const live = p.active && promoScheduled(p, now);
      const sch = scheduleText(p.schedule);
      return `
      <div class="promo-card ${p.active ? '' : 'is-off'}">
        <div class="promo-head">
          <div class="mgr-order">
            <button class="icon-btn sm" data-act="promo-up" data-id="${esc(p.id)}" type="button" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">${svg('up', 18)}</button>
            <button class="icon-btn sm" data-act="promo-down" data-id="${esc(p.id)}" type="button" ${i === promos.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">${svg('down', 18)}</button>
          </div>
          <span class="prio">${i + 1}</span>
          <div class="grow">
            <div class="promo-name">${esc(p.name)} <span class="pill pill-mute">${esc(PROMO_TYPES[p.type].label)}</span>
              ${p.memberOnly ? '<span class="pill pill-wait">เฉพาะสมาชิก</span>' : ''}
              ${p.active && !live ? '<span class="pill pill-wait">นอกเวลาโปร</span>' : ''}
              ${p.maxUses ? `<span class="pill pill-mute">สูงสุด ${p.maxUses} ครั้ง/บิล</span>` : ''}</div>
            <div class="help" style="margin-top:2px">${esc(promoSummary(p))}${sch ? ` · <b>${esc(sch)}</b>` : ''}</div>
          </div>
          <button class="btn ${p.active ? 'btn-ok' : 'btn-ghost'} btn-sm" data-act="promo-toggle" data-id="${esc(p.id)}" type="button">${p.active ? 'เปิดใช้งาน' : 'ปิดอยู่'}</button>
          <button class="btn btn-outline btn-sm" data-act="promo-edit" data-id="${esc(p.id)}" type="button">${svg('edit', 16)} แก้ไข</button>
          <button class="icon-btn sm" data-act="promo-dup" data-id="${esc(p.id)}" type="button" aria-label="ทำสำเนา" title="ทำสำเนา">${svg('copy', 18)}</button>
          <button class="icon-btn sm danger" data-act="promo-del" data-id="${esc(p.id)}" type="button" aria-label="ลบโปร">${svg('trash', 18)}</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">ยังไม่มีโปรโมชั่น</div>'}
    <div class="section-title" style="margin-top:16px">เพิ่มโปรโมชั่นใหม่</div>
    <div class="type-cards">
      ${Object.keys(PROMO_TYPES).map((t) => `<button class="mode-card" data-act="promo-add" data-type="${t}" type="button"><b>${svg('plus', 16)} ${PROMO_TYPES[t].label}</b><small>${PROMO_TYPES[t].hint}</small></button>`).join('')}
    </div>`;
}

async function promoAction(act, id, el) {
  const promos = state.catalog.promos;
  const i = promos.findIndex((p) => p.id === id);
  if (act === 'promo-add') return openPromoEditor(null, el.dataset.type);
  if (act === 'promo-edit') return openPromoEditor(id);
  if (i < 0) return;
  if (act === 'promo-toggle') promos[i].active = !promos[i].active;
  else if (act === 'promo-up' && i > 0) [promos[i - 1], promos[i]] = [promos[i], promos[i - 1]];
  else if (act === 'promo-down' && i < promos.length - 1) [promos[i + 1], promos[i]] = [promos[i], promos[i + 1]];
  else if (act === 'promo-dup') promos.splice(i + 1, 0, Object.assign(clone(promos[i]), { id: `p_${uid()}`, name: `${promos[i].name} (สำเนา)`, active: false }));
  else if (act === 'promo-del') {
    const r = await confirmDialog({ title: 'ลบโปรโมชั่น', html: `ลบ <b>${esc(promos[i].name)}</b> ?`, okText: 'ลบ', danger: true });
    if (!r.ok) return;
    promos.splice(i, 1);
  }
  commitCatalog();
  renderManager();
}

/* ---------- promo editor ---------- */
let ped = null;

function openPromoEditor(id, type) {
  const src = id ? IDX.promo[id] : defaultPromo(type || 'bundle');
  ped = { draft: clone(src), isNew: !id };
  ensureModal('m-promo', { size: 'xl', title: 'โปรโมชั่น', z: 'mid' });
  renderPromoEditor();
  openModal('m-promo');
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Category / menu picker. Tap a category to include all its menus; tap a menu inside an
 *  included category to exclude it; tap any other menu to include just that menu. */
function matchPicker(path, m) {
  const cats = state.catalog.categories;
  return `
    <div class="mp" data-mp="${path}">
      <div class="mp-row">
        <button class="mchip ${m.all ? 'on' : ''}" data-mpk="all" type="button">${m.all ? '✓ ' : ''}ทุกเมนูในร้าน</button>
        <span class="help" style="margin:0">${esc(matchText(m))}</span>
      </div>
      ${cats.map((c) => {
        const items = state.catalog.items.filter((it) => it.categoryId === c.id);
        const catOn = m.cats.includes(c.id);
        return `
        <div class="mp-row">
          <button class="mchip cat ${catOn ? 'on' : ''}" data-mpk="cat" data-id="${esc(c.id)}" type="button">${catOn ? '✓ ' : ''}หมวด ${esc(c.name)}</button>
          ${items.map((it) => {
            const ex = m.exclude.includes(it.id);
            const via = (m.all || catOn) && !ex;
            const on = m.items.includes(it.id) && !ex;
            return `<button class="mchip ${on ? 'on' : via ? 'via' : ''} ${ex ? 'ex' : ''}" data-mpk="item" data-id="${esc(it.id)}" type="button">${esc(it.name)}</button>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>`;
}

function matchToggle(m, kind, id) {
  const tog = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
  if (kind === 'all') m.all = !m.all;
  else if (kind === 'cat') tog(m.cats, id);
  else {
    const it = IDX.item[id];
    const via = m.all || (it && m.cats.includes(it.categoryId));
    if (via) tog(m.exclude, id);
    else { tog(m.items, id); m.exclude = m.exclude.filter((x) => x !== id); }
  }
}

function renderPromoEditor() {
  const d = ped.draft;
  const modal = $('#m-promo');
  const num = (path, val, attrs = '') => `<input class="input num-in" data-pf="${path}" type="number" inputmode="decimal" min="0" value="${esc(val)}" ${attrs} />`;
  const seg = (path, opts, cur) => `<div class="seg">${Object.keys(opts).map((k) => `<button class="${cur === k ? 'on' : ''}" data-pset="${path}" data-v="${k}" type="button">${opts[k]}</button>`).join('')}</div>`;
  const sw = (path, on, label, help) => `
    <button class="switch-row" data-ptog="${path}" type="button" aria-pressed="${!!on}">
      <span class="switch ${on ? 'on' : ''}"><span></span></span><span><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span>
    </button>`;
  const rewardRow = () => `
    <div class="row">${seg('reward.kind', REWARD_KINDS[d.type], d.reward.kind)}
      ${d.reward.kind === 'free' ? '' : `${num('reward.value', d.reward.value)}<span>${d.reward.kind === 'pct' ? '%' : 'บาท'}</span>`}</div>`;

  let rule = '';
  if (d.type === 'bundle') {
    rule = `
      <div class="section-title">1. ในหนึ่งชุดต้องมี <small>(เพิ่มหลายเงื่อนไข = จับคู่ข้ามหมวด เช่น คุกกี้ 2 + เครื่องดื่ม 1)</small></div>
      ${d.slots.map((s, i) => `
        <div class="ed-sub group-card">
          <div class="row" style="margin-bottom:8px"><b>เงื่อนไขที่ ${i + 1}:</b> จำนวน ${num(`slots.${i}.qty`, s.qty, 'min="1"')} ชิ้น จาก
            <span class="grow"></span>${d.slots.length > 1 ? `<button class="icon-btn sm danger" data-pact="slot-del" data-i="${i}" type="button" aria-label="ลบเงื่อนไข">${svg('trash', 18)}</button>` : ''}</div>
          ${matchPicker(`slots.${i}.match`, s.match)}
        </div>`).join('')}
      <button class="btn btn-outline btn-sm" data-pact="slot-add" type="button">${svg('plus', 16)} เพิ่มเงื่อนไขในชุด (จับคู่ข้ามหมวด)</button>
      <div class="section-title" style="margin-top:16px">2. ได้รับ</div>${rewardRow()}
      <p class="help">ระบบจับชุดจากชิ้นที่ราคาสูงสุดก่อน (ลูกค้าได้ส่วนลดมากที่สุด) · ซื้อหลายชุดในบิลเดียวได้</p>`;
  } else if (d.type === 'discount') {
    rule = `
      <div class="section-title">1. เมนูที่ลดราคา</div>${matchPicker('match', d.match)}
      <div class="row" style="margin-top:10px">ต้องซื้อเมนูในกลุ่มนี้รวมกันอย่างน้อย ${num('minQty', d.minQty, 'min="1"')} ชิ้น จึงจะลด</div>
      <div class="section-title" style="margin-top:16px">2. ส่วนลด</div>${rewardRow()}`;
  } else if (d.type === 'bxgy') {
    rule = `
      <div class="section-title">1. ซื้อ ${num('buyQty', d.buyQty, 'min="1"')} ชิ้น จาก</div>${matchPicker('match', d.match)}
      <div class="section-title" style="margin-top:16px">2. ได้ ${num('getQty', d.getQty, 'min="1"')} ชิ้น</div>
      ${sw('getSame', d.getSame, 'ชิ้นที่ได้มาจากกลุ่มเดียวกับที่ซื้อ', 'เช่น ซื้อ 2 แถม 1 (ชิ้นที่ถูกที่สุดในแต่ละชุดได้ส่วนลด)')}
      ${d.getSame ? '' : matchPicker('getMatch', d.getMatch)}
      <div class="section-title" style="margin-top:16px">3. ชิ้นที่ได้</div>${rewardRow()}`;
  } else {
    rule = `
      <div class="section-title">1. ซื้อครบ ${num('minSpend', d.minSpend)} บาท</div>
      ${sw('repeat', d.repeat, 'ให้ซ้ำทุก ๆ ยอดขั้นต่ำ', 'เช่น ทุก ๆ 300 บาท ลด 30 (600 บาท ลด 60)')}
      <details class="mp-details" ${matchEmpty(d.match) || d.match.all ? '' : 'open'}><summary>นับยอดเฉพาะบางเมนู (ค่าเริ่มต้น: ทุกเมนู)</summary>${matchPicker('match', d.match)}</details>
      <div class="section-title" style="margin-top:16px">2. ได้รับ</div>${rewardRow()}
      ${d.reward.kind === 'free' ? `
        <div class="row" style="margin:10px 0">แถมฟรี ${num('reward.qty', d.reward.qty, 'min="1"')} ชิ้น · เลือกจากเมนู (ไม่เลือก = ชิ้นที่ถูกที่สุดในบิล) — พนักงานต้องหยิบของแถมใส่ตะกร้าด้วย</div>
        ${matchPicker('reward.match', d.reward.match)}` : ''}
      ${sw('stackable', d.stackable, 'ใช้ร่วมกับโปรท้ายบิลอื่นได้', 'ปิด = ใช้โปรท้ายบิลที่เข้าเงื่อนไขตัวแรกตามลำดับเท่านั้น (เหมาะกับขั้นบันได 300 ลด 30 / 500 ลด 60)')}`;
  }

  const s = d.schedule;
  let preview = '';
  if (state.cart.lines.length) {
    const r = runPromoEngine(state.cart.lines, { only: normalizePromo(d), member: true });
    preview = `<div class="${r.discount > 0 ? 'ok-box' : 'warn-box'}">ทดลองกับตะกร้าปัจจุบัน: ${r.discount > 0 ? `ลด <b>${money(r.discount)}</b>` : 'ยังไม่เข้าเงื่อนไข'}</div>`;
  }

  modal.querySelector('.modal-title').textContent = ped.isNew ? `เพิ่มโปร: ${PROMO_TYPES[d.type].label}` : `แก้ไขโปร: ${d.name}`;
  paint(modal.querySelector('.modal-body'), `
    <div class="ed-row">
      <label class="ed-field"><span>ชื่อโปร (แสดงในบิล) *</span><input class="input" data-pf="name" type="text" value="${esc(d.name)}" /></label>
      <label class="ed-field"><span>ป้ายบนการ์ดเมนู (ไม่บังคับ)</span><input class="input" data-pf="tag" type="text" value="${esc(d.tag)}" placeholder="อัตโนมัติ: ${esc(promoShortTag(Object.assign({}, d, { tag: '' })))}" /></label>
    </div>
    <div class="ed-sub-title">ประเภทโปร</div>
    <div class="type-cards">${Object.keys(PROMO_TYPES).map((t) => `<button class="mode-card ${d.type === t ? 'on' : ''}" data-pact="type" data-v="${t}" type="button"><b>${PROMO_TYPES[t].label}</b><small>${PROMO_TYPES[t].hint}</small></button>`).join('')}</div>
    <div class="promo-sentence">${esc(promoSummary(normalizePromo(d)))}</div>
    ${rule}
    <div class="section-title" style="margin-top:18px">เงื่อนไขเพิ่มเติม</div>
    <div class="row">ใช้ได้สูงสุด ${num('maxUses', d.maxUses)} ครั้ง/บิล <span class="help" style="margin:0">(0 = ไม่จำกัด)</span></div>
    ${sw('memberOnly', d.memberOnly, 'เฉพาะสมาชิก', 'ต้องใส่เบอร์โทรสมาชิกในหน้าชำระเงินก่อนจึงจะได้โปรนี้')}
    <div class="section-title" style="margin-top:12px">ช่วงเวลาที่โปรมีผล <small>(ไม่ตั้ง = ทุกวันตลอดเวลา)</small></div>
    <div class="row">${DAY_TH.map((n, i) => `<button class="mchip ${s.days.includes(i) ? 'on' : ''}" data-pact="day" data-v="${i}" type="button">${n}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px">
      <label class="mgr-field" style="width:150px"><span class="help">ตั้งแต่เวลา</span><input class="input" data-pf="schedule.from" type="time" value="${esc(s.from)}" /></label>
      <label class="mgr-field" style="width:150px"><span class="help">ถึงเวลา</span><input class="input" data-pf="schedule.to" type="time" value="${esc(s.to)}" /></label>
      <label class="mgr-field" style="width:190px"><span class="help">เริ่มวันที่</span><input class="input" data-pf="schedule.start" type="date" value="${esc(s.start)}" /></label>
      <label class="mgr-field" style="width:190px"><span class="help">ถึงวันที่</span><input class="input" data-pf="schedule.end" type="date" value="${esc(s.end)}" /></label>
      <button class="btn btn-ghost btn-sm" data-pact="sched-clear" type="button">ล้างช่วงเวลา</button>
    </div>
    ${preview}`);
  modal.querySelector('.modal-foot').innerHTML = `
    <button class="btn ${d.active ? 'btn-ok' : 'btn-ghost'}" data-pact="active" type="button">${d.active ? 'เปิดใช้งาน' : 'ปิดอยู่'}</button>
    <span class="grow"></span>
    <button class="btn btn-ghost btn-lg" data-close type="button">ยกเลิก</button>
    <button class="btn btn-primary btn-lg" data-pact="save" type="button">บันทึกโปร</button>`;
}

function promoEditorClick(e) {
  const d = ped && ped.draft;
  if (!d) return;
  const mp = e.target.closest('[data-mpk]');
  if (mp) {
    const m = getPath(d, mp.closest('[data-mp]').dataset.mp);
    matchToggle(m, mp.dataset.mpk, mp.dataset.id);
    return renderPromoEditor();
  }
  const sp = e.target.closest('[data-pset]');
  if (sp) { setPath(d, sp.dataset.pset, sp.dataset.v); return renderPromoEditor(); }
  const tg = e.target.closest('[data-ptog]');
  if (tg) { setPath(d, tg.dataset.ptog, !getPath(d, tg.dataset.ptog)); return renderPromoEditor(); }
  const b = e.target.closest('[data-pact]');
  if (!b) return;
  const act = b.dataset.pact;
  if (act === 'type') {
    const keep = { id: d.id, name: d.name, active: d.active, tag: d.tag, schedule: d.schedule, memberOnly: d.memberOnly, maxUses: d.maxUses };
    const fresh = defaultPromo(b.dataset.v);
    // carry the menus over so switching type does not lose the selection
    const m = d.type === 'bundle' ? d.slots[0].match : d.match;
    if (b.dataset.v === 'bundle') fresh.slots[0].match = clone(m); else if (b.dataset.v !== 'threshold') fresh.match = clone(m);
    ped.draft = Object.assign(fresh, keep, { name: ped.isNew ? fresh.name : d.name });
  } else if (act === 'slot-add') d.slots.push({ qty: 1, match: normalizeMatch({}) });
  else if (act === 'slot-del') d.slots.splice(Number(b.dataset.i), 1);
  else if (act === 'day') {
    const v = Number(b.dataset.v);
    d.schedule.days = d.schedule.days.includes(v) ? d.schedule.days.filter((x) => x !== v) : d.schedule.days.concat(v).sort();
  } else if (act === 'sched-clear') d.schedule = { days: [], from: '', to: '', start: '', end: '' };
  else if (act === 'active') d.active = !d.active;
  else if (act === 'save') return savePromoEditor();
  renderPromoEditor();
}

function promoEditorChange(e) {
  const el = e.target;
  if (!el.dataset.pf || !ped) return;
  setPath(ped.draft, el.dataset.pf, el.type === 'number' ? num(el.value) : el.value);
  renderPromoEditor();
}

function savePromoEditor() {
  const p = normalizePromo(ped.draft);
  if (!p.name.trim()) return toast('กรุณาตั้งชื่อโปร', 'warn');
  if (p.type === 'bundle' && p.slots.some((s) => matchEmpty(s.match))) return toast('เลือกเมนู/หมวดให้ทุกเงื่อนไขในชุด', 'warn');
  if ((p.type === 'discount' || p.type === 'bxgy') && matchEmpty(p.match)) return toast('เลือกเมนู/หมวดที่ร่วมโปร', 'warn');
  if (p.type === 'bxgy' && !p.getSame && matchEmpty(p.getMatch)) return toast('เลือกเมนูของชิ้นที่ได้', 'warn');
  if (p.type !== 'threshold' && p.reward.kind !== 'free' && !(p.reward.value > 0) && p.reward.kind !== 'price') return toast('ใส่มูลค่าส่วนลด', 'warn');
  if (p.reward.kind === 'pct' && p.reward.value > 100) return toast('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100', 'warn');
  const promos = state.catalog.promos;
  const i = promos.findIndex((x) => x.id === p.id);
  if (i >= 0) promos[i] = p; else promos.push(p);
  commitCatalog();
  closeModal('m-promo');
  if (isOpen('m-manage')) renderManager();
  toast(`บันทึกโปร “${p.name}” แล้ว`, 'success');
}

/* ==========================================================================
   CART — staff promo chooser (per bill)
   ========================================================================== */

function openPromoPicker() {
  ensureModal('m-promopick', { size: 'lg', title: 'โปรโมชั่นในบิลนี้', z: 'mid' });
  renderPromoPicker();
  openModal('m-promopick');
}

function renderPromoPicker() {
  const c = state.cart;
  const t = cartTotals();
  const off = new Set(c.promoOff || []);
  const got = Object.fromEntries(t.promos.map((p) => [p.key, p]));
  const modal = $('#m-promopick');
  const live = t.promoLive;
  paint(modal.querySelector('.modal-body'), `
    <div class="section-title">วิธีเลือกโปรเมื่อสินค้าเข้าได้หลายโปร</div>
    <div class="seg" style="margin-bottom:6px">
      <button class="${c.promoMode !== 'best' ? 'on' : ''}" data-ppmode="priority" type="button">ตามลำดับที่ร้านตั้ง</button>
      <button class="${c.promoMode === 'best' ? 'on' : ''}" data-ppmode="best" type="button">ลูกค้าคุ้มที่สุด</button>
    </div>
    <p class="help">ยกเลิกเลือกโปรที่ลูกค้าไม่ต้องการ เพื่อให้สินค้าไปเข้าโปรอื่นแทน</p>
    ${live.length ? live.map((p) => `
      <button class="switch-row pp-row" data-pptog="${esc(p.id)}" type="button">
        <span class="switch ${off.has(p.id) ? '' : 'on'}"><span></span></span>
        <span class="grow"><b>${esc(p.name)}</b><small>${esc(promoSummary(p))}</small></span>
        <span class="pp-amt">${got[p.id] ? `-${money(got[p.id].discount)}` : (off.has(p.id) ? 'ปิดในบิลนี้' : 'ไม่เข้าเงื่อนไข')}</span>
      </button>`).join('') : '<div class="empty-state">ไม่มีโปรที่ใช้กับสินค้าในตะกร้าตอนนี้</div>'}
    <div class="pay-net"><span class="section-title" style="margin:0">ส่วนลดโปรรวม</span><b>${money(t.promoDiscount)}</b></div>`);
  modal.querySelector('.modal-foot').innerHTML = `<button class="btn btn-primary btn-lg" data-close type="button">เสร็จสิ้น</button>`;
}

function promoPickerClick(e) {
  const m = e.target.closest('[data-ppmode]');
  if (m) state.cart.promoMode = m.dataset.ppmode;
  const t = e.target.closest('[data-pptog]');
  if (t) {
    const id = t.dataset.pptog;
    const off = new Set(state.cart.promoOff || []);
    if (off.has(id)) off.delete(id); else off.add(id);
    state.cart.promoOff = [...off];
  }
  if (!m && !t) return;
  save.cart();
  renderPromoPicker();
  renderTotals();
}

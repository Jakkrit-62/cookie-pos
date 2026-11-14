/**
 * ==========================================================================
 *  iPad POS  →  Google Sheets  (Google Apps Script Web App)   v2
 * ==========================================================================
 *  Orders
 *    NEW_ORDER   → Orders + Order_Items (upsert by Order_ID — re-sends never duplicate)
 *    VOID_ORDER  → marks the bill VOIDED
 *    Both also adjust the cloud stock snapshot (only once per bill), so every
 *    device that pulls sees stock that already includes sales from all devices.
 *
 *  Multi-device state
 *    PUSH_STATE  → saves catalog / settings / stock into App_State and
 *                  menu photos into Menu_Images (one row per item)
 *    PULL_STATE  → returns catalog, settings, stock, images and the day's orders
 *    PULL_ORDERS → returns the orders of one date (for the "all devices" history view)
 *
 *  Large values are split into ≤ 45,000-character chunks across several columns,
 *  so no single cell ever reaches Google Sheets' 50,000-character limit.
 *
 *  Deploy: Extensions ▸ Apps Script ▸ paste this file ▸ Deploy ▸ New deployment
 *          ▸ Web app ▸ Execute as "Me" ▸ Who has access "Anyone" ▸ copy the /exec URL
 *  Updating an existing deployment: Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version
 * ==========================================================================
 */

/** Leave blank when this script is bound to the spreadsheet (Extensions ▸ Apps Script). */
const SPREADSHEET_ID = '';
const TIMEZONE = 'Asia/Bangkok';
const KEEP_LOG_ROWS = 2000;
const CHUNK = 45000;

const SHEET_ORDERS = 'Orders';
const SHEET_ITEMS = 'Order_Items';
const SHEET_STATE = 'App_State';
const SHEET_IMAGES = 'Menu_Images';
const SHEET_LOG = 'Sync_Log';

const ORDER_HEADERS = [
  'Order_ID', 'Status', 'Date', 'Date_Time', 'Timestamp_ISO', 'Items_Detail',
  'Subtotal', 'Promo_Discount', 'Promo_Detail', 'Item_Discount', 'Manual_Discount',
  'Total_Discount', 'Net_Total', 'Payment_Method', 'Cash_Received', 'Change',
  'Device', 'Voided_At', 'Void_Reason', 'Synced_At', 'Payment_Key',
];
const ITEM_HEADERS = [
  'Order_ID', 'Line_No', 'Status', 'Date', 'Date_Time', 'Category', 'Menu_ID', 'Menu', 'Detail',
  'Qty', 'Sold_Grams', 'Free_Grams', 'Options', 'Add_Ons',
  'Unit_Price', 'Gross', 'Item_Discount', 'Line_Net', 'Payment_Method', 'Device',
];
const STATE_HEADERS = ['Key', 'Updated_At', 'Updated_By_Device', 'JSON_Value', 'JSON_Value_2', 'JSON_Value_3', 'JSON_Value_4', 'JSON_Value_5', 'JSON_Value_6', 'JSON_Value_7', 'JSON_Value_8'];
const IMAGE_HEADERS = ['Item_ID', 'Updated_At', 'Updated_By_Device', 'Chars', 'Base64_Data', 'Base64_Data_2', 'Base64_Data_3'];
const LOG_HEADERS = ['Received_At', 'Device', 'App_Version', 'Actions', 'OK', 'Failed', 'Errors'];

const STATE_DATA_COL = 4;  // JSON_Value starts here
const IMAGE_DATA_COL = 5;  // Base64_Data starts here

/* ------------------------------------------------------------------------ */
/*  Entry points                                                            */
/* ------------------------------------------------------------------------ */

/**
 * GET                       → health check (used by the POS "ทดสอบ" button)
 * GET ?action=PULL_STATE    → full state as JSON (optional &date=YYYY-MM-DD)
 * GET ?action=PULL_ORDERS&date=YYYY-MM-DD
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const ss = getSpreadsheet_();
    const sh = ensureSheets_(ss);
    const action = String(p.action || '').toUpperCase();
    if (action === 'PULL_STATE') return json_({ ok: true, result: pullState_({ date: p.date }, sh) });
    if (action === 'PULL_ORDERS') return json_({ ok: true, result: { date: p.date || today_(), orders: ordersForDate_(sh.orders, p.date || today_()) } });
    return json_({ ok: true, service: 'iPad POS Sync v2', sheet: ss.getName(), hasCatalog: !!getState_(sh.state, 'catalog'), time: now_() });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'Server busy — please retry' });
  }
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw) throw new Error('Empty request body');
    const body = JSON.parse(raw);
    const actions = Array.isArray(body.actions) ? body.actions : [body];
    const ss = getSpreadsheet_();
    const sh = ensureSheets_(ss);

    const results = actions.map(function (a) {
      try {
        return { qid: a.qid, orderId: a.orderId, ok: true, result: handleAction_(a, sh, body.device) };
      } catch (err) {
        return { qid: a.qid, orderId: a.orderId, ok: false, error: errMsg_(err) };
      }
    });

    const writes = actions.filter(function (a) { return String(a.action || '').toUpperCase().indexOf('PULL') !== 0; });
    if (writes.length) {
      const failed = results.filter(function (r) { return !r.ok; });
      writeLog_(sh.log, body, actions.length, results.length - failed.length, failed);
    }
    SpreadsheetApp.flush();
    return json_({ ok: true, results: results });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------------ */
/*  Actions                                                                 */
/* ------------------------------------------------------------------------ */

function handleAction_(a, sh, bodyDevice) {
  const type = String(a.action || '').toUpperCase();
  const data = a.data || {};
  if (type === 'NEW_ORDER') return newOrder_(data, sh);
  if (type === 'VOID_ORDER') return voidOrder_(data, sh);
  if (type === 'PUSH_STATE') return pushState_(data, sh, data.device || bodyDevice || '');
  if (type === 'PULL_STATE') return pullState_(data, sh);
  if (type === 'PULL_ORDERS') return { date: data.date || today_(), orders: ordersForDate_(sh.orders, data.date || today_()) };
  throw new Error('Unknown action: ' + a.action);
}

/** Insert or update a bill. Stock is deducted only the first time the bill is inserted. */
function newOrder_(o, sh) {
  const r = upsertOrder_(o, sh, false);
  if (r.inserted && r.status !== 'VOIDED') adjustStock_(sh, o.stockDeduction, -1, o.device);
  return r.inserted ? 'inserted' : 'updated';
}

/** Mark a bill VOIDED and give its stock back (only on the COMPLETED → VOIDED transition). */
function voidOrder_(d, sh) {
  if (!d || !d.orderId) throw new Error('Missing orderId');
  const orders = sh.orders;
  const row = findRow_(orders, d.orderId);

  if (!row) {
    if (!d.order) throw new Error('Order not found: ' + d.orderId);
    // NEW_ORDER never arrived: store the bill as VOIDED; net stock effect is zero
    upsertOrder_(Object.assign({}, d.order, { voidedAt: d.voidedAt, voidReason: d.reason }), sh, true);
    return 'inserted-as-voided';
  }
  const statusCol = col_(ORDER_HEADERS, 'Status');
  if (orders.getRange(row, statusCol).getValue() === 'VOIDED') return 'already-voided';

  orders.getRange(row, statusCol).setValue('VOIDED');
  orders.getRange(row, col_(ORDER_HEADERS, 'Voided_At')).setValue(d.voidedAt || now_());
  orders.getRange(row, col_(ORDER_HEADERS, 'Void_Reason')).setValue(d.reason || '');
  orders.getRange(row, col_(ORDER_HEADERS, 'Synced_At')).setValue(now_());
  orders.getRange(row, 1, 1, ORDER_HEADERS.length).setBackground('#fbe4e1').setFontColor('#9b8f86');
  setItemsStatus_(sh.items, findAllRows_(sh.items, d.orderId), 'VOIDED');
  if (d.order) adjustStock_(sh, d.order.stockDeduction, +1, d.order.device);
  return 'voided';
}

function upsertOrder_(o, sh, forceVoid) {
  if (!o || !o.orderId) throw new Error('Missing orderId');
  const orders = sh.orders;
  const row = findRow_(orders, o.orderId);
  let status = forceVoid ? 'VOIDED' : (o.status || 'COMPLETED');
  if (row && orders.getRange(row, col_(ORDER_HEADERS, 'Status')).getValue() === 'VOIDED') status = 'VOIDED'; // never un-void
  const values = [orderRow_(o, status)];
  if (row) orders.getRange(row, 1, 1, ORDER_HEADERS.length).setValues(values);
  else orders.getRange(orders.getLastRow() + 1, 1, 1, ORDER_HEADERS.length).setValues(values);

  const itemRows = findAllRows_(sh.items, o.orderId);
  if (!itemRows.length && Array.isArray(o.items) && o.items.length) {
    const rows = o.items.map(function (i) { return itemRow_(o, i, status); });
    sh.items.getRange(sh.items.getLastRow() + 1, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
  } else if (itemRows.length) {
    setItemsStatus_(sh.items, itemRows, status);
  }
  return { inserted: !row, status: status };
}

/** PUSH_STATE: catalog / settings / stock (partial or full) / images */
function pushState_(d, sh, device) {
  const out = { saved: [] };
  if (d.catalog) { setState_(sh.state, 'catalog', d.catalog, device); out.saved.push('catalog'); }
  if (d.settings) { setState_(sh.state, 'settings', d.settings, device); out.saved.push('settings'); }
  if (d.stockSet) {
    const stock = d.fullStock ? {} : (getState_(sh.state, 'stock') || {});
    Object.keys(d.stockSet).forEach(function (k) { stock[k] = Math.max(0, Number(d.stockSet[k]) || 0); });
    setState_(sh.state, 'stock', stock, device);
    out.saved.push('stock');
  }
  (d.images || []).forEach(function (img) { if (img && img.id && img.data) upsertImage_(sh.images, img.id, img.data, device); });
  if (d.images && d.images.length) out.saved.push(d.images.length + ' images');
  (d.deletedImages || []).forEach(function (id) { deleteImage_(sh.images, id); });
  if (Array.isArray(d.allImageIds)) {
    const keep = {};
    d.allImageIds.forEach(function (id) { keep[id] = true; });
    const last = sh.images.getLastRow();
    if (last >= 2) {
      const ids = sh.images.getRange(2, 1, last - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) if (!keep[String(ids[i][0])]) sh.images.deleteRow(i + 2);
    }
  }
  out.stock = getState_(sh.state, 'stock');
  return out;
}

function pullState_(d, sh) {
  const date = (d && d.date) || today_();
  return {
    catalog: getState_(sh.state, 'catalog'),
    settings: getState_(sh.state, 'settings'),
    stock: getState_(sh.state, 'stock'),
    images: allImages_(sh.images),
    date: date,
    orders: ordersForDate_(sh.orders, date),
    serverTime: now_(),
  };
}

/** Apply a stock delta to the cloud snapshot (skipped until a device has pushed stock once). */
function adjustStock_(sh, delta, sign, device) {
  if (!delta) return;
  const stock = getState_(sh.state, 'stock');
  if (!stock) return;
  Object.keys(delta).forEach(function (k) {
    stock[k] = Math.max(0, (Number(stock[k]) || 0) + sign * (Number(delta[k]) || 0));
  });
  setState_(sh.state, 'stock', stock, device || 'order');
}

/* ------------------------------------------------------------------------ */
/*  Chunked key/value + image storage                                       */
/* ------------------------------------------------------------------------ */

/** Each chunk is stored with a leading "~" so Sheets never treats it as a formula/number. */
function toChunks_(str, slots) {
  const parts = [];
  for (let i = 0; i < str.length; i += CHUNK) parts.push('~' + str.slice(i, i + CHUNK));
  if (parts.length > slots) throw new Error('Value too large (' + str.length + ' chars, max ' + (slots * CHUNK) + ')');
  while (parts.length < slots) parts.push('');
  return parts;
}
function fromChunks_(cells) {
  return cells.map(function (c) { c = String(c || ''); return c.charAt(0) === '~' ? c.slice(1) : c; }).join('');
}

function setState_(sheet, key, value, device) {
  const slots = STATE_HEADERS.length - STATE_DATA_COL + 1;
  const row = [key, now_(), device || ''].concat(toChunks_(JSON.stringify(value), slots));
  const r = findRow_(sheet, key);
  if (r) sheet.getRange(r, 1, 1, row.length).setValues([row]);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
function getState_(sheet, key) {
  const r = findRow_(sheet, key);
  if (!r) return null;
  const slots = STATE_HEADERS.length - STATE_DATA_COL + 1;
  const txt = fromChunks_(sheet.getRange(r, STATE_DATA_COL, 1, slots).getValues()[0]);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (err) { return null; }
}

function upsertImage_(sheet, id, data, device) {
  const slots = IMAGE_HEADERS.length - IMAGE_DATA_COL + 1;
  const row = [id, now_(), device || '', data.length].concat(toChunks_(String(data), slots));
  const r = findRow_(sheet, id);
  if (r) sheet.getRange(r, 1, 1, row.length).setValues([row]);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
function deleteImage_(sheet, id) {
  const r = findRow_(sheet, id);
  if (r) sheet.deleteRow(r);
}
function allImages_(sheet) {
  const last = sheet.getLastRow();
  const out = {};
  if (last < 2) return out;
  const values = sheet.getRange(2, 1, last - 1, IMAGE_HEADERS.length).getValues();
  values.forEach(function (v) {
    const id = String(v[0] || '');
    const data = fromChunks_(v.slice(IMAGE_DATA_COL - 1));
    if (id && data) out[id] = data;
  });
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Orders for one date (multi-device history)                              */
/* ------------------------------------------------------------------------ */

function ordersForDate_(sheet, date) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(1, 1, last, ORDER_HEADERS.length).getValues();
  const headers = values[0].map(String);
  const dateCol = headers.indexOf('Date');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    let d = v[dateCol];
    if (d instanceof Date) d = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
    if (String(d) !== String(date)) continue;
    const obj = {};
    headers.forEach(function (h, j) {
      let x = v[j];
      if (x instanceof Date) x = Utilities.formatDate(x, TIMEZONE, h === 'Date' ? 'yyyy-MM-dd' : 'dd/MM/yyyy HH:mm:ss');
      obj[h] = x;
    });
    out.push(obj);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Row builders                                                            */
/* ------------------------------------------------------------------------ */

function orderRow_(o, status) {
  const map = {
    Order_ID: o.orderId,
    Status: status,
    Date: o.date || '',
    Date_Time: o.dateTime || '',
    Timestamp_ISO: o.timestampISO || '',
    Items_Detail: o.itemsDetail || '',
    Subtotal: num_(o.subtotal),
    Promo_Discount: num_(o.promoDiscount),
    Promo_Detail: o.promoDetail || '',
    Item_Discount: num_(o.itemDiscount),
    Manual_Discount: num_(o.manualDiscount),
    Total_Discount: num_(o.totalDiscount),
    Net_Total: num_(o.netTotal),
    Payment_Method: o.paymentMethod || '',
    Cash_Received: o.cashReceived === '' || o.cashReceived == null ? '' : num_(o.cashReceived),
    Change: o.change === '' || o.change == null ? '' : num_(o.change),
    Device: o.device || '',
    Voided_At: status === 'VOIDED' ? (o.voidedAt || now_()) : '',
    Void_Reason: o.voidReason || '',
    Synced_At: now_(),
    Payment_Key: o.paymentKey || '',
  };
  return ORDER_HEADERS.map(function (h) { return map[h]; });
}

function itemRow_(o, i, status) {
  const map = {
    Order_ID: o.orderId,
    Line_No: i.lineNo,
    Status: status,
    Date: o.date || '',
    Date_Time: o.dateTime || '',
    Category: i.category || '',
    Menu_ID: i.menuId || '',
    Menu: i.menu || '',
    Detail: i.detail || '',
    Qty: num_(i.qty),
    Sold_Grams: num_(i.soldGrams),
    Free_Grams: num_(i.freeGrams),
    Options: i.options || '',
    Add_Ons: i.addOns || '',
    Unit_Price: num_(i.unitPrice),
    Gross: num_(i.gross),
    Item_Discount: num_(i.itemDiscount),
    Line_Net: num_(i.lineNet),
    Payment_Method: o.paymentMethod || '',
    Device: o.device || '',
  };
  return ITEM_HEADERS.map(function (h) { return map[h]; });
}

/* ------------------------------------------------------------------------ */
/*  Sheet helpers                                                           */
/* ------------------------------------------------------------------------ */

function getSpreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets_(ss) {
  return {
    orders: ensureSheet_(ss, SHEET_ORDERS, ORDER_HEADERS, ['Order_ID', 'Date', 'Date_Time', 'Timestamp_ISO', 'Voided_At', 'Synced_At']),
    items: ensureSheet_(ss, SHEET_ITEMS, ITEM_HEADERS, ['Order_ID', 'Date', 'Date_Time']),
    state: ensureSheet_(ss, SHEET_STATE, STATE_HEADERS, STATE_HEADERS),
    images: ensureSheet_(ss, SHEET_IMAGES, IMAGE_HEADERS, ['Item_ID', 'Updated_At', 'Updated_By_Device', 'Base64_Data', 'Base64_Data_2', 'Base64_Data_3']),
    log: ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, ['Received_At']),
  };
}

/**
 * Creates the sheet if missing. If an older version of the sheet exists:
 *  - new columns were only appended → extend the header in place (data stays aligned)
 *  - columns changed in the middle   → keep the old tab as "<name>_old_<timestamp>" and start fresh
 */
function ensureSheet_(ss, name, headers, textCols) {
  let sh = ss.getSheetByName(name);
  if (sh) {
    const width = Math.max(sh.getLastColumn(), 1);
    const first = sh.getRange(1, 1, 1, width).getValues()[0].map(String).filter(function (x) { return x !== ''; });
    if (!first.length) {
      styleHeader_(sh, headers, textCols);
    } else if (first.length !== headers.length || first.some(function (h, i) { return h !== headers[i]; })) {
      const isPrefix = first.length < headers.length && first.every(function (h, i) { return h === headers[i]; });
      if (isPrefix) {
        styleHeader_(sh, headers, textCols);
      } else if (sh.getLastRow() > 1) {
        sh.setName(name + '_old_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmm'));
        sh = ss.insertSheet(name);
        styleHeader_(sh, headers, textCols);
      } else {
        sh.clear();
        styleHeader_(sh, headers, textCols);
      }
    }
    return sh;
  }
  sh = ss.insertSheet(name);
  styleHeader_(sh, headers, textCols);
  return sh;
}

function styleHeader_(sh, headers, textCols) {
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#862d28').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  (textCols || []).forEach(function (h) {
    const c = headers.indexOf(h) + 1;
    if (c > 0 && sh.getMaxRows() > 1) sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const cell = sheet.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function findAllRows_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findAll()
    .map(function (r) { return r.getRow(); });
}

function setItemsStatus_(sheet, rows, status) {
  const c = col_(ITEM_HEADERS, 'Status');
  rows.forEach(function (r) {
    sheet.getRange(r, c).setValue(status);
    if (status === 'VOIDED') sheet.getRange(r, 1, 1, ITEM_HEADERS.length).setFontColor('#9b8f86');
  });
}

function writeLog_(sheet, body, total, ok, failed) {
  try {
    sheet.appendRow([
      now_(), body.device || '', body.appVersion || '', total, ok, failed.length,
      failed.map(function (f) { return f.orderId + ': ' + f.error; }).join(' | '),
    ]);
    const extra = sheet.getLastRow() - 1 - KEEP_LOG_ROWS;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (err) {
    // logging must never break syncing
  }
}

/* ------------------------------------------------------------------------ */
/*  Utils                                                                   */
/* ------------------------------------------------------------------------ */

function col_(headers, name) { return headers.indexOf(name) + 1; }
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function now_() { return Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'); }
function errMsg_(err) { return String((err && err.message) || err); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (▶ Run) to create all sheets and grant permissions. */
function setup() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  Logger.log('Sheets ready in: ' + ss.getName());
}

/** Optional: simulate POS requests from the editor to verify everything works. */
function testPost() {
  const id = 'ORD-TEST-' + new Date().getTime();
  const order = {
    orderId: id, status: 'COMPLETED', date: today_(), dateTime: now_(), timestampISO: new Date().toISOString(),
    itemsDetail: 'ซอฟต์คุกกี้ รสคลาสสิก (3 × ฿39)', subtotal: 117, promoDiscount: 17, promoDetail: 'โปรซอฟต์คุกกี้ 3 ชิ้น 100 x1 (-17)',
    itemDiscount: 0, manualDiscount: 0, totalDiscount: 17, netTotal: 100, paymentMethod: 'เงินสด', paymentKey: 'cash',
    cashReceived: 100, change: 0, device: 'TEST', stockDeduction: { sc_classic: 3 },
    items: [{ lineNo: 1, category: 'ซอฟต์คุกกี้', menuId: 'sc_classic', menu: 'ซอฟต์คุกกี้ รสคลาสสิก', detail: '3 × ฿39', qty: 3, unitPrice: 39, gross: 117, itemDiscount: 0, lineNet: 117 }],
  };
  const e = { postData: { contents: JSON.stringify({ device: 'TEST', actions: [
    { qid: 'a', action: 'NEW_ORDER', orderId: id, data: order },
    { qid: 'b', action: 'VOID_ORDER', orderId: id, data: { orderId: id, voidedAt: now_(), reason: 'test', order: order } },
  ] }) } };
  Logger.log(doPost(e).getContent());
}

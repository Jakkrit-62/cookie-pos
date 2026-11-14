/**
 * ==========================================================================
 *  iPad POS  →  Google Sheets Sync  (Google Apps Script Web App)
 * ==========================================================================
 *  Receives NEW_ORDER and VOID_ORDER actions from the POS (POST, text/plain JSON)
 *  and writes them to:
 *    • Orders       — 1 row per bill (upsert by Order_ID, so re-sends never duplicate)
 *    • Order_Items  — 1 row per cart line (for per-menu analysis / pivot tables)
 *    • Sync_Log     — 1 row per request (troubleshooting)
 *
 *  Deploy: Extensions ▸ Apps Script ▸ paste this file ▸ Deploy ▸ New deployment
 *          ▸ Type "Web app" ▸ Execute as "Me" ▸ Who has access "Anyone" ▸ copy /exec URL
 *  (Full step-by-step guide in README.md)
 * ==========================================================================
 */

/** Leave blank when this script is bound to the spreadsheet (Extensions ▸ Apps Script).
 *  For a standalone script, paste the spreadsheet ID from its URL here. */
const SPREADSHEET_ID = '';
const TIMEZONE = 'Asia/Bangkok';
const KEEP_LOG_ROWS = 2000;

const SHEET_ORDERS = 'Orders';
const SHEET_ITEMS = 'Order_Items';
const SHEET_LOG = 'Sync_Log';

const ORDER_HEADERS = [
  'Order_ID', 'Status', 'Date', 'Date_Time', 'Timestamp_ISO', 'Items_Detail',
  'Subtotal', 'Promo_Discount', 'Promo_Detail', 'Item_Discount', 'Manual_Discount',
  'Total_Discount', 'Net_Total', 'Payment_Method', 'Cash_Received', 'Change',
  'Device', 'Voided_At', 'Void_Reason', 'Synced_At',
];
const ORDER_TEXT_COLS = ['Order_ID', 'Date', 'Date_Time', 'Timestamp_ISO', 'Voided_At', 'Synced_At'];

const ITEM_HEADERS = [
  'Order_ID', 'Line_No', 'Status', 'Date', 'Date_Time', 'Category', 'Menu_ID', 'Menu', 'Detail',
  'Qty', 'Sold_Grams', 'Free_Grams', 'Main_Scoop', 'Add_Hokkaido', 'Add_Vanilla', 'Add_Gooey_Cookie',
  'Unit_Price', 'Gross', 'Item_Discount', 'Line_Net', 'Payment_Method', 'Device',
];
const ITEM_TEXT_COLS = ['Order_ID', 'Date', 'Date_Time'];

const LOG_HEADERS = ['Received_At', 'Device', 'App_Version', 'Actions', 'OK', 'Failed', 'Errors'];

/* ------------------------------------------------------------------------ */
/*  Entry points                                                            */
/* ------------------------------------------------------------------------ */

/** Health check — the POS "ทดสอบ" button calls this. */
function doGet() {
  try {
    const ss = getSpreadsheet_();
    ensureSheets_(ss);
    return json_({ ok: true, service: 'iPad POS Sync', sheet: ss.getName(), time: now_() });
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
    const sheets = ensureSheets_(ss);

    const results = actions.map(function (a) {
      try {
        const r = handleAction_(a, sheets);
        return { qid: a.qid, orderId: a.orderId, ok: true, result: r };
      } catch (err) {
        return { qid: a.qid, orderId: a.orderId, ok: false, error: errMsg_(err) };
      }
    });

    const failed = results.filter(function (r) { return !r.ok; });
    writeLog_(sheets.log, body, actions.length, results.length - failed.length, failed);
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

function handleAction_(a, sheets) {
  const type = String(a.action || '').toUpperCase();
  if (type === 'NEW_ORDER') return upsertOrder_(a.data, sheets, false);
  if (type === 'VOID_ORDER') return voidOrder_(a.data, sheets);
  throw new Error('Unknown action: ' + a.action);
}

/** Insert the bill, or update it if the Order_ID already exists (idempotent). */
function upsertOrder_(o, sheets, forceVoid) {
  if (!o || !o.orderId) throw new Error('Missing orderId');
  const orders = sheets.orders;
  const row = findRow_(orders, o.orderId);

  let status = forceVoid ? 'VOIDED' : (o.status || 'COMPLETED');
  if (row) {
    const current = orders.getRange(row, col_(ORDER_HEADERS, 'Status')).getValue();
    if (current === 'VOIDED') status = 'VOIDED'; // never "un-void" a bill
  }
  const values = [orderRow_(o, status)];

  if (row) {
    orders.getRange(row, 1, 1, ORDER_HEADERS.length).setValues(values);
  } else {
    orders.getRange(orders.getLastRow() + 1, 1, 1, ORDER_HEADERS.length).setValues(values);
  }

  // Line items: write once per order; afterwards only the status is kept in sync
  const itemRows = findAllRows_(sheets.items, o.orderId);
  if (!itemRows.length && Array.isArray(o.items) && o.items.length) {
    const rows = o.items.map(function (i) { return itemRow_(o, i, status); });
    sheets.items.getRange(sheets.items.getLastRow() + 1, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
  } else if (itemRows.length) {
    setItemsStatus_(sheets.items, itemRows, status);
  }
  return row ? 'updated' : 'inserted';
}

/** Mark the bill VOIDED. If the NEW_ORDER never arrived, insert it from the snapshot. */
function voidOrder_(d, sheets) {
  if (!d || !d.orderId) throw new Error('Missing orderId');
  const orders = sheets.orders;
  const row = findRow_(orders, d.orderId);

  if (!row) {
    if (!d.order) throw new Error('Order not found: ' + d.orderId);
    const snap = Object.assign({}, d.order, { voidedAt: d.voidedAt, voidReason: d.reason });
    upsertOrder_(snap, sheets, true);
    return 'inserted-as-voided';
  }

  orders.getRange(row, col_(ORDER_HEADERS, 'Status')).setValue('VOIDED');
  orders.getRange(row, col_(ORDER_HEADERS, 'Voided_At')).setValue(d.voidedAt || now_());
  orders.getRange(row, col_(ORDER_HEADERS, 'Void_Reason')).setValue(d.reason || '');
  orders.getRange(row, col_(ORDER_HEADERS, 'Synced_At')).setValue(now_());
  orders.getRange(row, 1, 1, ORDER_HEADERS.length).setBackground('#fbe4e1').setFontColor('#9b8f86');

  setItemsStatus_(sheets.items, findAllRows_(sheets.items, d.orderId), 'VOIDED');
  return 'voided';
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
    Main_Scoop: i.mainScoop || '',
    Add_Hokkaido: num_(i.addHokkaido),
    Add_Vanilla: num_(i.addVanilla),
    Add_Gooey_Cookie: num_(i.addGooeyCookie),
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
    orders: ensureSheet_(ss, SHEET_ORDERS, ORDER_HEADERS, ORDER_TEXT_COLS),
    items: ensureSheet_(ss, SHEET_ITEMS, ITEM_HEADERS, ITEM_TEXT_COLS),
    log: ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, ['Received_At']),
  };
}

/** Creates the sheet (with styled header + plain-text ID/date columns) if missing. */
function ensureSheet_(ss, name, headers, textCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#862d28').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    (textCols || []).forEach(function (h) {
      const c = headers.indexOf(h) + 1;
      if (c > 0) sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  } else if (first.length < headers.length || headers.some(function (h, i) { return first[i] !== h; })) {
    // header drifted (e.g. columns were added in a newer version) → rewrite header row
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function findRow_(sheet, orderId) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const cell = sheet.getRange(2, 1, last - 1, 1)
    .createTextFinder(String(orderId)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function findAllRows_(sheet, orderId) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 1)
    .createTextFinder(String(orderId)).matchEntireCell(true).findAll()
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
function errMsg_(err) { return String((err && err.message) || err); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from the Apps Script editor (▶ Run) to create the sheets
 * and grant permissions before deploying.
 */
function setup() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  Logger.log('Sheets ready in: ' + ss.getName());
}

/** Optional: simulate a POS request from the editor to verify everything works. */
function testPost() {
  const id = 'ORD-TEST-' + new Date().getTime();
  const order = {
    orderId: id, status: 'COMPLETED', date: '2026-01-01', dateTime: '01/01/2026 10:00:00',
    timestampISO: '2026-01-01T10:00:00+07:00', itemsDetail: 'ซอฟต์คุกกี้ รสคลาสสิก (3 × ฿39)',
    subtotal: 117, promoDiscount: 17, promoDetail: 'โปรซอฟต์คุกกี้ 3 ชิ้น 100 x1 (-17)', itemDiscount: 0,
    manualDiscount: 0, totalDiscount: 17, netTotal: 100, paymentMethod: 'เงินสด', cashReceived: 100, change: 0,
    device: 'Editor-Test',
    items: [{ lineNo: 1, category: 'ซอฟต์คุกกี้', menuId: 'sc_classic', menu: 'ซอฟต์คุกกี้ รสคลาสสิก', detail: '3 × ฿39', qty: 3, unitPrice: 39, gross: 117, itemDiscount: 0, lineNet: 117 }],
  };
  const e = { postData: { contents: JSON.stringify({ device: 'Editor-Test', actions: [
    { qid: 'a', action: 'NEW_ORDER', orderId: id, data: order },
    { qid: 'b', action: 'VOID_ORDER', orderId: id, data: { orderId: id, voidedAt: now_(), reason: 'test', order: order } },
  ] }) } };
  Logger.log(doPost(e).getContent());
}

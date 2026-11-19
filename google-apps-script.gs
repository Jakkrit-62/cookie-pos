/**
 * ==========================================================================
 *  iPad POS  →  Google Sheets  (Google Apps Script Web App)   v3
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
 *  v3
 *    SHIFT_OPEN / SHIFT_CLOSE → Shifts (cash-drawer reconciliation)
 *    CASH_MOVE      → Cash_Moves (pay-in / pay-out during a shift)
 *    STOCK_LOG      → Stock_Log (restock / waste / giveaway … with reason)
 *    KITCHEN_STATUS → Orders.Kitchen_Status  PENDING ↔ DONE (from the KDS iPad)
 *    PULL_CUSTOMER  → one member from Customers (points are updated by NEW_ORDER / VOID_ORDER)
 *    PULL_REPORT    → compact bill + item rows for a date range (analytics, all devices)
 *    GET ?action=PULL_KITCHEN → the kitchen queue (read-only, no lock — polled every few seconds)
 *
 *  Large values are split into ≤ 45,000-character chunks across several columns,
 *  so no single cell ever reaches Google Sheets' 50,000-character limit.
 *
 *  Security (Cloudflare hosting): run createSyncSecret() once → every request must carry ?key=<secret>.
 *  Only the Cloudflare /api/sync proxy knows the secret, so the /exec URL alone is useless to outsiders.
 *  (No secret set = open, like v2.)
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
const SHEET_SHIFTS = 'Shifts';
const SHEET_MOVES = 'Cash_Moves';
const SHEET_STOCKLOG = 'Stock_Log';
const SHEET_CUSTOMERS = 'Customers';
const SHEET_ACTIVITY = 'Activity_Log';
const SHEET_STAFFSUM = 'Staff_Summary';
const KITCHEN_SCAN_ROWS = 400;   // KDS only looks at the newest N bills

const ORDER_HEADERS = [
  'Order_ID', 'Status', 'Date', 'Date_Time', 'Timestamp_ISO', 'Items_Detail',
  'Subtotal', 'Promo_Discount', 'Promo_Detail', 'Item_Discount', 'Manual_Discount',
  'Total_Discount', 'Net_Total', 'Payment_Method', 'Cash_Received', 'Change',
  'Device', 'Voided_At', 'Void_Reason', 'Synced_At', 'Payment_Key',
  // v3 (appended — existing sheets are extended in place)
  'Queue_No', 'Order_Note', 'Kitchen_Status', 'Kitchen_Items', 'Kitchen_Updated_At',
  'Staff', 'Customer_Phone', 'Customer_Name', 'Points_Earned', 'Points_Redeemed', 'Points_Discount',
  'Total_Cost', 'Shift_ID', 'Manual_By', 'Voided_By',
  // v4
  'Cash_In_Drawer',
];
const ITEM_HEADERS = [
  'Order_ID', 'Line_No', 'Status', 'Date', 'Date_Time', 'Category', 'Menu_ID', 'Menu', 'Detail',
  'Qty', 'Sold_Grams', 'Free_Grams', 'Options', 'Add_Ons',
  'Unit_Price', 'Gross', 'Item_Discount', 'Line_Net', 'Payment_Method', 'Device',
  // v3
  'Line_Note', 'Promo_Discount', 'Cost', 'Staff',
];
const STATE_HEADERS = ['Key', 'Updated_At', 'Updated_By_Device', 'JSON_Value', 'JSON_Value_2', 'JSON_Value_3', 'JSON_Value_4', 'JSON_Value_5', 'JSON_Value_6', 'JSON_Value_7', 'JSON_Value_8'];
const IMAGE_HEADERS = ['Item_ID', 'Updated_At', 'Updated_By_Device', 'Chars', 'Base64_Data', 'Base64_Data_2', 'Base64_Data_3'];
const LOG_HEADERS = ['Received_At', 'Device', 'App_Version', 'Actions', 'OK', 'Failed', 'Errors'];
const SHIFT_HEADERS = [
  'Shift_ID', 'Device', 'Status', 'Opened_At', 'Opened_By', 'Opening_Float', 'Closed_At', 'Closed_By',
  'Bills', 'Voids', 'Net_Sales', 'Cash_Sales', 'Pay_In', 'Pay_Out', 'Expected_Cash', 'Counted_Cash', 'Difference',
  'By_Method', 'Note', 'Synced_At',
];
const MOVE_HEADERS = ['Move_ID', 'Shift_ID', 'Date_Time', 'Type', 'Amount', 'Reason', 'By', 'Device', 'Synced_At'];
const STOCKLOG_HEADERS = [
  'Log_ID', 'Date', 'Date_Time', 'Device', 'Pool_ID', 'Pool_Name', 'Unit', 'Change', 'Before', 'After',
  'Reason_ID', 'Reason', 'Note', 'Staff', 'Cost_Value', 'Synced_At',
];
const ACTIVITY_HEADERS = ['Log_ID', 'Date', 'Date_Time', 'Hour', 'Device', 'Staff_ID', 'Staff', 'Type', 'Detail', 'Amount', 'Shift_ID', 'Synced_At'];
const STAFFSUM_HEADERS = [
  'Key', 'Date', 'Staff', 'Device', 'Bills', 'Sales', 'Voids', 'Void_Amount', 'Discount', 'Avg_Per_Bill',
  'First_Action', 'Last_Action', 'Peak_Hour', 'Hourly_Sales', 'Updated_At',
];
const CUSTOMER_HEADERS = ['Phone', 'Name', 'Points', 'Visits', 'Total_Spent', 'First_Visit', 'Last_Visit', 'Updated_At'];

const STATE_DATA_COL = 4;  // JSON_Value starts here
const IMAGE_DATA_COL = 5;  // Base64_Data starts here

/* ------------------------------------------------------------------------ */
/*  Entry points                                                            */
/* ------------------------------------------------------------------------ */

/**
 * GET                       → health check (used by the POS "ทดสอบ" button)
 * GET ?action=PULL_STATE    → full state as JSON (optional &date=YYYY-MM-DD)
 * GET ?action=PULL_ORDERS&date=YYYY-MM-DD
 * GET ?action=PULL_KITCHEN&hours=14   → KDS queue (fast path: touches only the Orders sheet)
 */
/** Shared secret from Script Properties (Project Settings ▸ Script properties ▸ SYNC_SECRET). */
function keyOk_(e) {
  const want = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!want) return true;
  const got = String((e && e.parameter && e.parameter.key) || '');
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
const DENIED_ = { ok: false, code: 'BAD_KEY', error: 'Unauthorized' };

function doGet(e) {
  try {
    if (!keyOk_(e)) return json_(DENIED_);
    const p = (e && e.parameter) || {};
    const ss = getSpreadsheet_();
    const act = String(p.action || '').toUpperCase();
    if (act === 'PULL_KITCHEN' || act === 'PULL_KITCHEN_QUEUE') {
      const orders = ss.getSheetByName(SHEET_ORDERS) || ensureSheet_(ss, SHEET_ORDERS, ORDER_HEADERS, ORDER_TEXT_COLS);
      return json_({ ok: true, result: pullKitchen_(orders, Number(p.hours) || 3) });
    }
    const sh = ensureSheets_(ss);
    const action = String(p.action || '').toUpperCase();
    if (action === 'PULL_STATE') return json_({ ok: true, result: pullState_({ date: p.date }, sh) });
    if (action === 'PULL_ORDERS') return json_({ ok: true, result: { date: p.date || today_(), orders: ordersForDate_(sh.orders, p.date || today_()) } });
    return json_({ ok: true, service: 'iPad POS Sync v3', sheet: ss.getName(), hasCatalog: !!getState_(sh.state, 'catalog'), time: now_() });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

function doPost(e) {
  if (!keyOk_(e)) return json_(DENIED_);
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
  if (type === 'SHIFT_OPEN' || type === 'SHIFT_CLOSE') return shift_(data, sh, type === 'SHIFT_CLOSE');
  if (type === 'CASH_MOVE') return cashMove_(data, sh);
  if (type === 'STOCK_LOG') return stockLog_(data, sh);
  if (type === 'KITCHEN_STATUS' || type === 'UPDATE_KITCHEN_STATUS') return kitchenStatus_(data, sh);
  if (type === 'PULL_CUSTOMER') return customerByPhone_(sh.customers, data.phone);
  if (type === 'PULL_REPORT') return pullReport_(data, sh);
  if (type === 'ACTIVITY_LOG') return activityLog_(data, sh);
  if (type === 'STAFF_SUMMARY') return staffSummary_(data, sh);
  if (type === 'PULL_ACTIVITY') return pullActivity_(data, sh);
  if (type === 'PULL_LIVE') return pullLive_(sh);
  if (type === 'PULL_KITCHEN' || type === 'PULL_KITCHEN_QUEUE') return pullKitchen_(sh.orders, Number(data.hours) || 3);
  throw new Error('Unknown action: ' + a.action);
}

/** Insert or update a bill. Stock is deducted only the first time the bill is inserted. */
function newOrder_(o, sh) {
  const r = upsertOrder_(o, sh, false);
  if (r.inserted && r.status !== 'VOIDED') {
    adjustStock_(sh, o.stockDeduction, -1, o.device);
    if (o.customerPhone) {
      upsertCustomer_(sh.customers, o.customerPhone, o.customerName, num_(o.pointsEarned) - num_(o.pointsRedeemed), 1, num_(o.netTotal), o.date);
    }
  }
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
  if (d.order && d.order.voidedBy) orders.getRange(row, col_(ORDER_HEADERS, 'Voided_By')).setValue(d.order.voidedBy);
  // tell the kitchen screen to stop making it
  const ksCol = col_(ORDER_HEADERS, 'Kitchen_Status');
  if (String(orders.getRange(row, ksCol).getValue()) === 'PENDING') {
    orders.getRange(row, ksCol).setValue('VOIDED');
    orders.getRange(row, col_(ORDER_HEADERS, 'Kitchen_Updated_At')).setValue(Date.now());
  }
  const o = d.order;
  if (o && o.customerPhone) {
    upsertCustomer_(sh.customers, o.customerPhone, '', -(num_(o.pointsEarned) - num_(o.pointsRedeemed)), -1, -num_(o.netTotal), '');
  }
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
  let kitchen = null;
  if (row) {
    const cur = orders.getRange(row, 1, 1, ORDER_HEADERS.length).getValues()[0];
    if (cur[col_(ORDER_HEADERS, 'Status') - 1] === 'VOIDED') status = 'VOIDED'; // never un-void
    // the kitchen screen owns Kitchen_Status once the bill exists — a re-send must not reset DONE → PENDING
    const ks = String(cur[col_(ORDER_HEADERS, 'Kitchen_Status') - 1] || '');
    if (ks) kitchen = { status: ks, at: cur[col_(ORDER_HEADERS, 'Kitchen_Updated_At') - 1] };
  }
  const values = [orderRow_(o, status, kitchen)];
  if (row) orders.getRange(row, 1, 1, ORDER_HEADERS.length).setValues(values);
  else {
    const nr = orders.getLastRow() + 1;
    textCells_(orders, nr, ORDER_HEADERS, ORDER_TEXT_COLS);
    orders.getRange(nr, 1, 1, ORDER_HEADERS.length).setValues(values);
  }

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
    customers: allCustomers_(sh.customers),
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
/*  v3: shifts · cash moves · stock log · kitchen · customers · reports     */
/* ------------------------------------------------------------------------ */

/** Write `obj` (header → value) into the row whose first column = key; insert when missing. */
function upsertRow_(sheet, headers, key, obj) {
  const row = findRow_(sheet, key);
  let base = headers.map(function () { return ''; });
  if (row) base = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  const values = headers.map(function (h, i) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : base[i]; });
  if (row) sheet.getRange(row, 1, 1, headers.length).setValues([values]);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([values]);
  return row ? 'updated' : 'inserted';
}

function shift_(d, sh, closing) {
  if (!d.shiftId) throw new Error('Missing shiftId');
  const row = findRow_(sh.shifts, d.shiftId);
  if (!closing && row && String(sh.shifts.getRange(row, col_(SHIFT_HEADERS, 'Status')).getValue()) === 'CLOSED') return 'already-closed';
  const obj = {
    Shift_ID: d.shiftId, Device: d.device || '', Status: closing ? 'CLOSED' : 'OPEN',
    Opened_At: d.openedAt || '', Opened_By: d.openedBy || '', Opening_Float: num_(d.float), Synced_At: now_(),
  };
  if (closing) {
    Object.assign(obj, {
      Closed_At: d.closedAt || now_(), Closed_By: d.closedBy || '', Bills: num_(d.bills), Voids: num_(d.voids),
      Net_Sales: num_(d.netSales), Cash_Sales: num_(d.cashSales), Pay_In: num_(d.payIn), Pay_Out: num_(d.payOut),
      Expected_Cash: num_(d.expected), Counted_Cash: d.counted === '' ? '' : num_(d.counted),
      Difference: d.diff === '' ? '' : num_(d.diff), By_Method: d.byMethod || '', Note: d.note || '',
    });
  }
  const r = upsertRow_(sh.shifts, SHIFT_HEADERS, d.shiftId, obj);
  if (closing && num_(d.diff) !== 0) {
    const rr = findRow_(sh.shifts, d.shiftId);
    sh.shifts.getRange(rr, col_(SHIFT_HEADERS, 'Difference')).setFontColor(num_(d.diff) < 0 ? '#c0392b' : '#b7791f').setFontWeight('bold');
  }
  return r;
}

function cashMove_(d, sh) {
  if (!d.id) throw new Error('Missing move id');
  return upsertRow_(sh.moves, MOVE_HEADERS, d.id, {
    Move_ID: d.id, Shift_ID: d.shiftId || '', Date_Time: d.atTH || now_(), Type: d.type === 'in' ? 'PAY_IN' : 'PAY_OUT',
    Amount: num_(d.amount), Reason: d.reason || '', By: d.by || '', Device: d.device || '', Synced_At: now_(),
  });
}

function stockLog_(d, sh) {
  if (!d.id) throw new Error('Missing log id');
  if (findRow_(sh.stocklog, d.id)) return 'duplicate';
  // The adjustment is a DELTA applied to the shared cloud stock — a sale made on another iPad is never overwritten.
  if (d.pool && num_(d.delta)) {
    const dl = num_(d.delta);
    adjustStock_(sh, { [d.pool]: Math.abs(dl) }, dl < 0 ? -1 : 1, d.device || 'stock-log');
  }
  return upsertRow_(sh.stocklog, STOCKLOG_HEADERS, d.id, {
    Log_ID: d.id, Date: d.date || today_(), Date_Time: d.atTH || now_(), Device: d.device || '',
    Pool_ID: d.pool || '', Pool_Name: d.poolName || '', Unit: d.unit || '', Change: num_(d.delta),
    Before: num_(d.before), After: num_(d.after), Reason_ID: d.reason || '', Reason: d.reasonLabel || '',
    Note: d.note || '', Staff: d.staff || '', Cost_Value: num_(d.costValue), Synced_At: now_(),
  });
}

/* ---------- v4: activity log · staff summary · live pull ---------- */

function activityLog_(d, sh) {
  if (!d.id) throw new Error('Missing activity id');
  if (findRow_(sh.activity, d.id)) return 'duplicate';
  return upsertRow_(sh.activity, ACTIVITY_HEADERS, d.id, {
    Log_ID: d.id, Date: d.date || today_(), Date_Time: d.atTH || now_(), Hour: num_(d.hour), Device: d.device || '',
    Staff_ID: d.staffId || '', Staff: d.staff || '', Type: d.type || '', Detail: d.detail || '', Amount: num_(d.amount),
    Shift_ID: d.shiftId || '', Synced_At: now_(),
  });
}

/** One row per day × account × device, keyed → re-sending the same range just updates the rows. */
function staffSummary_(d, sh) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  rows.forEach(function (r) {
    if (!r.key) return;
    upsertRow_(sh.staffsum, STAFFSUM_HEADERS, r.key, {
      Key: r.key, Date: r.date, Staff: r.staff, Device: r.device || '', Bills: num_(r.bills), Sales: num_(r.sales), Voids: num_(r.voids),
      Void_Amount: num_(r.voidAmount), Discount: num_(r.discount), Avg_Per_Bill: num_(r.avg), First_Action: r.first || '', Last_Action: r.last || '',
      Peak_Hour: r.peakHour === '' || r.peakHour == null ? '' : num_(r.peakHour), Hourly_Sales: r.hourly || '', Updated_At: now_(),
    });
  });
  return rows.length;
}

/** Newest `n` rows of a sheet as {header: value} objects (dates → text). */
function tailRows_(sheet, headers, n) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  const w = Math.min(sheet.getLastColumn(), headers.length);
  return sheet.getRange(start, 1, last - start + 1, w).getValues().map(function (v) {
    const o = {};
    headers.forEach(function (h, i) {
      let x = i < w ? v[i] : '';
      if (x instanceof Date) x = Utilities.formatDate(x, TIMEZONE, h === 'Date' ? 'yyyy-MM-dd' : 'dd/MM/yyyy HH:mm:ss');
      o[h] = x;
    });
    return o;
  });
}

function pullActivity_(d, sh) {
  const from = String(d.from || today_());
  const to = String(d.to || today_());
  const rows = tailRows_(sh.activity, ACTIVITY_HEADERS, 6000).filter(function (r) { return r.Date >= from && r.Date <= to; });
  return { rows: rows };
}

/** Everything a device needs every ~20 s: shared stock + the other iPads' shifts, cash moves, stock log, activity. */
function pullLive_(sh) {
  const since = Utilities.formatDate(new Date(Date.now() - 3 * 86400000), TIMEZONE, 'yyyy-MM-dd');
  const closedShifts = tailRows_(sh.shifts, SHIFT_HEADERS, 150);
  const ids = {};
  closedShifts.forEach(function (r) { ids[r.Shift_ID] = true; });
  return {
    stock: getState_(sh.state, 'stock'),
    ledger: {
      shifts: closedShifts,
      moves: tailRows_(sh.moves, MOVE_HEADERS, 600).filter(function (m) { return ids[m.Shift_ID]; }),
      stocklog: tailRows_(sh.stocklog, STOCKLOG_HEADERS, 400).filter(function (r) { return r.Date >= since; }),
      activity: tailRows_(sh.activity, ACTIVITY_HEADERS, 500).filter(function (r) { return r.Date >= since; }),
    },
    serverTime: now_(),
  };
}

/** KDS ▸ เสร็จแล้ว / เรียกคืน. Last writer wins (by client timestamp); a voided bill stays VOIDED. */
function kitchenStatus_(d, sh) {
  if (!d.orderId) throw new Error('Missing orderId');
  const row = findRow_(sh.orders, d.orderId);
  if (!row) throw new Error('Order not found yet: ' + d.orderId);
  const ksCol = col_(ORDER_HEADERS, 'Kitchen_Status');
  const atCol = col_(ORDER_HEADERS, 'Kitchen_Updated_At');
  const cur = String(sh.orders.getRange(row, ksCol).getValue());
  if (cur === 'VOIDED' || String(sh.orders.getRange(row, col_(ORDER_HEADERS, 'Status')).getValue()) === 'VOIDED') return 'voided';
  const prevAt = Number(sh.orders.getRange(row, atCol).getValue()) || 0;
  const at = Number(d.at) || Date.now();
  if (at < prevAt) return 'stale';
  const status = d.status === 'DONE' ? 'DONE' : 'PENDING';
  sh.orders.getRange(row, ksCol).setValue(status);
  sh.orders.getRange(row, atCol).setValue(Math.max(at, prevAt + 1));
  return status;
}

/**
 * Newest KITCHEN_SCAN_ROWS bills, kept small on purpose:
 *  PENDING of today · VOIDED in the last 10 minutes (alarm) · DONE in the last `hours` (recall list, max 20)
 */
function pullKitchen_(sheet, hours) {
  const last = sheet.getLastRow();
  const nowMs = Date.now();
  const out = { now: nowMs, orders: [] };
  if (last < 2) return out;
  const width = Math.min(sheet.getLastColumn(), ORDER_HEADERS.length);
  const start = Math.max(2, last - KITCHEN_SCAN_ROWS + 1);
  const values = sheet.getRange(start, 1, last - start + 1, width).getValues();
  const c = function (h) { return ORDER_HEADERS.indexOf(h); };
  const recent = Math.max(1, Math.min(12, hours)) * 3600000;
  const today = today_();
  let done = 0;
  values.reverse().forEach(function (v) {
    const ks = String(v[c('Kitchen_Status')] || '');
    const at = Number(v[c('Kitchen_Updated_At')]) || 0;
    if (ks === 'PENDING') { if (cellDate_(v[c('Date')]) !== today) return; }
    else if (ks === 'VOIDED') { if (nowMs - at > 10 * 60000) return; }
    else if (ks === 'DONE') { if (nowMs - at > recent || ++done > 20) return; }
    else return;
    out.orders.push({
      id: String(v[c('Order_ID')]), q: String(v[c('Queue_No')] || ''), status: ks, updatedAt: at,
      items: String(v[c('Kitchen_Items')] || ''), createdISO: String(v[c('Timestamp_ISO')] || ''),
      device: String(v[c('Device')] || ''), staff: String(v[c('Staff')] || ''), note: String(v[c('Order_Note')] || ''),
    });
  });
  return out;
}

/* ---------- customers / loyalty ---------- */
function normPhone_(p) { return String(p || '').replace(/\D/g, ''); }

function upsertCustomer_(sheet, phone, name, pointsDelta, visitsDelta, spentDelta, date) {
  phone = normPhone_(phone);
  if (!phone) return;
  const row = findRow_(sheet, phone);
  if (!row) {
    if (visitsDelta < 0) return;
    const nr = sheet.getLastRow() + 1;
    textCells_(sheet, nr, CUSTOMER_HEADERS, ['Phone', 'First_Visit', 'Last_Visit']);
    sheet.getRange(nr, 1, 1, CUSTOMER_HEADERS.length).setValues([[
      phone, name || '', Math.max(0, pointsDelta), Math.max(0, visitsDelta), Math.max(0, spentDelta), date || today_(), date || today_(), now_(),
    ]]);
    return;
  }
  const cur = sheet.getRange(row, 1, 1, CUSTOMER_HEADERS.length).getValues()[0];
  const c = function (h) { return CUSTOMER_HEADERS.indexOf(h); };
  cur[c('Phone')] = phone;
  if (name) cur[c('Name')] = name;
  cur[c('Points')] = Math.max(0, Math.round((num_(cur[c('Points')]) + pointsDelta) * 100) / 100);
  cur[c('Visits')] = Math.max(0, num_(cur[c('Visits')]) + visitsDelta);
  cur[c('Total_Spent')] = Math.max(0, Math.round((num_(cur[c('Total_Spent')]) + spentDelta) * 100) / 100);
  if (date) cur[c('Last_Visit')] = date;
  cur[c('Updated_At')] = now_();
  sheet.getRange(row, 1, 1, CUSTOMER_HEADERS.length).setValues([cur]);
}

function customerObj_(v) {
  const d = function (x) { return x instanceof Date ? Utilities.formatDate(x, TIMEZONE, 'yyyy-MM-dd') : String(x || ''); };
  return { phone: normPhone_(v[0]), name: String(v[1] || ''), points: num_(v[2]), visits: num_(v[3]), spent: num_(v[4]), first: d(v[5]), last: d(v[6]) };
}
function customerByPhone_(sheet, phone) {
  const row = findRow_(sheet, normPhone_(phone));
  return row ? customerObj_(sheet.getRange(row, 1, 1, CUSTOMER_HEADERS.length).getValues()[0]) : null;
}
function allCustomers_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, CUSTOMER_HEADERS.length).getValues()
    .map(customerObj_).filter(function (x) { return x.phone; });
}

/* ---------- analytics ---------- */
function cellDate_(x) { return x instanceof Date ? Utilities.formatDate(x, TIMEZONE, 'yyyy-MM-dd') : String(x || ''); }

function pullReport_(d, sh) {
  const from = String(d.from || today_());
  const to = String(d.to || today_());
  const MAX_ITEMS = 20000;
  const out = { from: from, to: to, bills: [], items: [], truncated: false };
  const oc = function (h) { return ORDER_HEADERS.indexOf(h); };
  const ic = function (h) { return ITEM_HEADERS.indexOf(h); };

  let last = sh.orders.getLastRow();
  if (last >= 2) {
    const w = Math.min(sh.orders.getLastColumn(), ORDER_HEADERS.length);
    sh.orders.getRange(2, 1, last - 1, w).getValues().forEach(function (v) {
      const date = cellDate_(v[oc('Date')]);
      if (date < from || date > to) return;
      const iso = String(v[oc('Timestamp_ISO')] || '');
      const dt = String(v[oc('Date_Time')] || '');
      const hour = iso.length >= 13 ? Number(iso.slice(11, 13)) : Number((dt.split(' ')[1] || '0').slice(0, 2));
      out.bills.push({
        id: String(v[oc('Order_ID')]), date: date, hour: hour || 0, net: num_(v[oc('Net_Total')]), cost: num_(v[oc('Total_Cost')]),
        method: String(v[oc('Payment_Method')] || '-'), staff: String(v[oc('Staff')] || '-'), status: String(v[oc('Status')]),
        discount: num_(v[oc('Total_Discount')]), device: String(v[oc('Device')] || ''),
      });
    });
  }
  last = sh.items.getLastRow();
  if (last >= 2) {
    const w = Math.min(sh.items.getLastColumn(), ITEM_HEADERS.length);
    const rows = sh.items.getRange(2, 1, last - 1, w).getValues();
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i];
      const date = cellDate_(v[ic('Date')]);
      if (date < from || date > to || String(v[ic('Status')]) === 'VOIDED') continue;
      if (out.items.length >= MAX_ITEMS) { out.truncated = true; break; }
      const grams = num_(v[ic('Sold_Grams')]);
      out.items.push({
        name: String(v[ic('Menu')] || ''), cat: String(v[ic('Category')] || ''), qty: grams ? 1 : num_(v[ic('Qty')]), grams: grams,
        net: num_(v[ic('Line_Net')]) - num_(v[ic('Promo_Discount')]), cost: num_(v[ic('Cost')]),
      });
    }
  }
  return out;
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

function orderRow_(o, status, kitchen) {
  let ks = o.kitchenStatus || 'NONE';
  let kAt = Date.now();
  if (kitchen) { ks = kitchen.status; kAt = kitchen.at; }
  if (status === 'VOIDED' && ks === 'PENDING') { ks = 'VOIDED'; kAt = Date.now(); }
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
    Cash_In_Drawer: o.cashInDrawer === '' || o.cashInDrawer == null ? '' : num_(o.cashInDrawer),
    Device: o.device || '',
    Voided_At: status === 'VOIDED' ? (o.voidedAt || now_()) : '',
    Void_Reason: o.voidReason || '',
    Synced_At: now_(),
    Payment_Key: o.paymentKey || '',
    Queue_No: o.queueNo || '',
    Order_Note: o.orderNote || '',
    Kitchen_Status: ks,
    Kitchen_Items: o.kitchenItems || '',
    Kitchen_Updated_At: kAt,
    Staff: o.staff || '',
    Customer_Phone: normPhone_(o.customerPhone),
    Customer_Name: o.customerName || '',
    Points_Earned: num_(o.pointsEarned),
    Points_Redeemed: num_(o.pointsRedeemed),
    Points_Discount: num_(o.pointsDiscount),
    Total_Cost: num_(o.totalCost),
    Shift_ID: o.shiftId || '',
    Manual_By: o.manualBy || '',
    Voided_By: o.voidedBy || '',
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
    Line_Note: i.lineNote || '',
    Promo_Discount: num_(i.promoDiscount),
    Cost: num_(i.cost),
    Staff: o.staff || '',
  };
  return ITEM_HEADERS.map(function (h) { return map[h]; });
}

/* ------------------------------------------------------------------------ */
/*  Sheet helpers                                                           */
/* ------------------------------------------------------------------------ */

function getSpreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

const ORDER_TEXT_COLS = ['Order_ID', 'Date', 'Date_Time', 'Timestamp_ISO', 'Voided_At', 'Synced_At', 'Queue_No', 'Kitchen_Items', 'Customer_Phone'];

function ensureSheets_(ss) {
  return {
    orders: ensureSheet_(ss, SHEET_ORDERS, ORDER_HEADERS, ORDER_TEXT_COLS),
    items: ensureSheet_(ss, SHEET_ITEMS, ITEM_HEADERS, ['Order_ID', 'Date', 'Date_Time']),
    state: ensureSheet_(ss, SHEET_STATE, STATE_HEADERS, STATE_HEADERS),
    images: ensureSheet_(ss, SHEET_IMAGES, IMAGE_HEADERS, ['Item_ID', 'Updated_At', 'Updated_By_Device', 'Base64_Data', 'Base64_Data_2', 'Base64_Data_3']),
    log: ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, ['Received_At']),
    shifts: ensureSheet_(ss, SHEET_SHIFTS, SHIFT_HEADERS, ['Shift_ID', 'Opened_At', 'Closed_At', 'Synced_At']),
    moves: ensureSheet_(ss, SHEET_MOVES, MOVE_HEADERS, ['Move_ID', 'Shift_ID', 'Date_Time', 'Synced_At']),
    stocklog: ensureSheet_(ss, SHEET_STOCKLOG, STOCKLOG_HEADERS, ['Log_ID', 'Date', 'Date_Time', 'Synced_At']),
    customers: ensureSheet_(ss, SHEET_CUSTOMERS, CUSTOMER_HEADERS, ['Phone', 'First_Visit', 'Last_Visit', 'Updated_At']),
    activity: ensureSheet_(ss, SHEET_ACTIVITY, ACTIVITY_HEADERS, ['Log_ID', 'Date', 'Date_Time', 'Synced_At']),
    staffsum: ensureSheet_(ss, SHEET_STAFFSUM, STAFFSUM_HEADERS, ['Key', 'Date', 'Updated_At']),
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
/** Force plain-text format on some cells of a new row (keeps leading zeros: 0812…, queue “01”). */
function textCells_(sheet, row, headers, names) {
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows() + 50);
  names.forEach(function (h) { const c = col_(headers, h); if (c) sheet.getRange(row, c).setNumberFormat('@'); });
}
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function now_() { return Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'); }
function errMsg_(err) { return String((err && err.message) || err); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run once from the editor (▶ Run) when moving to Cloudflare: creates a random secret, stores it in
 * Script Properties and prints it in the log (View ▸ Logs) → paste it into Cloudflare as SYNC_SECRET.
 * Running it again rotates the secret (then update Cloudflare too).
 */
function createSyncSecret() {
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SYNC_SECRET', secret);
  Logger.log('SYNC_SECRET = ' + secret);
  return secret;
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
  const e = { parameter: { key: PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '' }, postData: { contents: JSON.stringify({ device: 'TEST', actions: [
    { qid: 'a', action: 'NEW_ORDER', orderId: id, data: order },
    { qid: 'b', action: 'VOID_ORDER', orderId: id, data: { orderId: id, voidedAt: now_(), reason: 'test', order: order } },
  ] }) } };
  Logger.log(doPost(e).getContent());
}

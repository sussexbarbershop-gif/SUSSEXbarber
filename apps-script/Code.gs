/**
 * Sussex Barber Shop — Google Apps Script backend (v3)
 *
 * Paste this over the contents of Code.gs in the Apps Script project, then
 * redeploy the Web App (Deploy > Manage deployments > edit > New version).
 *
 * SET THE ADMIN PASSWORD BEFORE DEPLOYING:
 *   Project Settings > Script Properties > Add script property
 *   Property: ADMIN_PASSWORD   Value: <the password you want>
 * The password lives only here, never in the website source.
 *
 * What changed from v2:
 *   - Services and Hours are stored in the Sheet, so the admin panel can
 *     actually change what customers see.
 *   - Every write is authenticated. In v2 `saveCMS` accepted any request,
 *     which let anyone who knew the URL rewrite the site content.
 *   - Removed the `.setHeaders()` calls. ContentService has no such method,
 *     so those lines threw *after* the booking had been written. Apps Script
 *     sets the CORS header itself, so nothing is lost.
 *   - Deploy as: Execute as = Me, Who has access = Anyone.
 */

// ---- Configuration ----------------------------------------------------

var SHEET_BOOKINGS = 'Sheet1';
var SHEET_SETTINGS = 'Settings';
var SHEET_BARBERS = 'Barbers';
var SHEET_GALLERY = 'Gallery';
var SHEET_SERVICES = 'Services';
var SHEET_HOURS = 'Hours';
var SHEET_CANCELED = 'CanceledBookings';

var DEFAULT_SERVICES = [
  ['Classic Haircut', 'Klassieke knipbeurt', 28, 30],
  ['Skin Fade', 'Skin Fade', 28, 30],
  ['Scissor Cut', 'Knippen met schaar', 28, 30],
  ['Wash & Haircut', 'Haar wassen & knippen', 35, 30],
  ['Beard Trim', 'Baard trimmen', 20, 30],
  ['Clean Shave', 'Glad scheren', 20, 30],
  ['Classic Haircut + Beard Trim', 'Klassieke knipbeurt + baard trimmen', 40, 30],
  ['Skin Fade + Beard Trim', 'Skin Fade + baard trimmen', 40, 30],
  ['One Grade Trim', 'Eén lengte trim (tondeuse)', 20, 30],
  ['Kids Haircut (Up to 10 Years)', 'Kinderknipbeurt (t/m 10 jaar)', 21, 30],
  ['Kids Haircut (Up to 13 Years)', 'Kinderknipbeurt (t/m 13 jaar)', 23, 30]
];

// Must match the bookable slots on the website.
var DEFAULT_HOURS = [
  ['Monday', 'Maandag', true, '12:00', '18:00'],
  ['Tuesday', 'Dinsdag', true, '10:00', '18:00'],
  ['Wednesday', 'Woensdag', true, '10:00', '18:00'],
  ['Thursday', 'Donderdag', true, '10:00', '18:00'],
  ['Friday', 'Vrijdag', true, '10:00', '18:00'],
  ['Saturday', 'Zaterdag', true, '10:00', '18:00'],
  ['Sunday', 'Zondag', false, '10:00', '18:00']
];

// ---- Helpers ----------------------------------------------------------

function json(obj) {
  // Apps Script adds Access-Control-Allow-Origin itself. Do not call
  // setHeaders() here — TextOutput has no such method and it will throw.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetNamed(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** True when the supplied password matches the stored one. */
function isAuthorized(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) return false;            // refuse writes until a password is set
  var given = payload && payload.password ? String(payload.password) : '';
  if (given.length !== expected.length) return false;
  // Constant-time-ish compare so the response time does not leak the password.
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

function getRawBookingsSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_BOOKINGS);
  if (sheet) return sheet;
  sheet = ss.getSheetByName('Bookings');
  if (sheet) return sheet;
  sheet = ss.getSheetByName('All Bookings');
  if (sheet) return sheet;

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var width = Math.min(7, sheets[i].getLastColumn() || 1);
    var values = sheets[i].getRange(1, 1, 1, width).getValues();
    if (values[0]) {
      var clean = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
      if (clean.indexOf('date') !== -1 && clean.indexOf('time') !== -1) return sheets[i];
    }
  }
  return sheets[0];
}

// ---- Sheet setup ------------------------------------------------------

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var bookings = sheetNamed(ss, SHEET_BOOKINGS);
  if (bookings.getLastRow() === 0) {
    bookings.appendRow(['Date', 'Time', 'Service', 'Barber', 'Name', 'Phone', 'Status', 'Timestamp', 'Price']);
  }

  var settings = sheetNamed(ss, SHEET_SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.appendRow(['Key', 'Value']);
    settings.appendRow(['hero_title', 'Masterful Cuts, Exceptional Service.']);
    settings.appendRow(['hero_subtitle', 'Elevating the art of grooming in Sussex. Experience the difference.']);
    settings.appendRow(['about_text', 'With years of experience, our master barbers provide the finest cuts, shaves, and grooming services in Sussex.']);
    settings.appendRow(['contact_phone', '+31 123 456 789']);
    settings.appendRow(['contact_address', 'Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands']);
  }

  var barbers = sheetNamed(ss, SHEET_BARBERS);
  if (barbers.getLastRow() === 0) {
    barbers.appendRow(['Name', 'ImageURL']);
    barbers.appendRow(['Any Available', '']);
  }

  var gallery = sheetNamed(ss, SHEET_GALLERY);
  if (gallery.getLastRow() === 0) {
    gallery.appendRow(['ImageURL']);
    ['assets/IMG_8582.PNG', 'assets/IMG_8577.JPEG', 'assets/IMG_8575.JPEG',
     'assets/IMG_8572.JPEG', 'assets/IMG_8567.JPEG', 'assets/IMG_8569.JPEG']
      .forEach(function (src) { gallery.appendRow([src]); });
  }

  var services = sheetNamed(ss, SHEET_SERVICES);
  if (services.getLastRow() === 0) {
    services.appendRow(['NameEN', 'NameNL', 'Price', 'Duration']);
    DEFAULT_SERVICES.forEach(function (row) { services.appendRow(row); });
  }

  var hours = sheetNamed(ss, SHEET_HOURS);
  if (hours.getLastRow() === 0) {
    hours.appendRow(['Day', 'DayNL', 'Open', 'From', 'To']);
    DEFAULT_HOURS.forEach(function (row) { hours.appendRow(row); });
  }

  var canceled = sheetNamed(ss, SHEET_CANCELED);
  if (canceled.getLastRow() === 0) {
    canceled.appendRow(['Date', 'Time', 'Service', 'Barber', 'Name', 'Phone', 'Status', 'Timestamp', 'Price']);
  }
}

// ---- Reading the config ----------------------------------------------

function readConfig(ss) {
  var out = { settings: {}, barbers: [], gallery: [], services: [], hours: [] };

  var settingsData = ss.getSheetByName(SHEET_SETTINGS).getDataRange().getValues();
  for (var i = 1; i < settingsData.length; i++) {
    if (settingsData[i][0]) out.settings[settingsData[i][0]] = settingsData[i][1];
  }

  var barbersData = ss.getSheetByName(SHEET_BARBERS).getDataRange().getValues();
  for (var j = 1; j < barbersData.length; j++) {
    if (barbersData[j][0]) out.barbers.push({ name: barbersData[j][0], image: barbersData[j][1] });
  }

  var galleryData = ss.getSheetByName(SHEET_GALLERY).getDataRange().getValues();
  for (var k = 1; k < galleryData.length; k++) {
    if (galleryData[k][0]) out.gallery.push(galleryData[k][0]);
  }

  var servicesData = ss.getSheetByName(SHEET_SERVICES).getDataRange().getValues();
  for (var m = 1; m < servicesData.length; m++) {
    if (!servicesData[m][0]) continue;
    out.services.push({
      id: m,
      nameEN: String(servicesData[m][0]),
      nameNL: String(servicesData[m][1] || servicesData[m][0]),
      price: Number(servicesData[m][2]) || 0,
      duration: Number(servicesData[m][3]) || 30
    });
  }

  var hoursData = ss.getSheetByName(SHEET_HOURS).getDataRange().getValues();
  for (var n = 1; n < hoursData.length; n++) {
    if (!hoursData[n][0]) continue;
    out.hours.push({
      day: String(hoursData[n][0]),
      dayNL: String(hoursData[n][1] || hoursData[n][0]),
      open: hoursData[n][2] === true || String(hoursData[n][2]).toLowerCase() === 'true',
      from: formatClock(hoursData[n][3]),
      to: formatClock(hoursData[n][4])
    });
  }

  return out;
}

/** Sheets may hand back a Date for a cell like "10:00"; normalise to HH:mm. */
function formatClock(value) {
  if (value instanceof Date) {
    return String(value.getHours()).padStart(2, '0') + ':' +
           String(value.getMinutes()).padStart(2, '0');
  }
  return String(value || '');
}

// ---- GET --------------------------------------------------------------

function doGet(e) {
  setupSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = e && e.parameter ? e.parameter.action : null;

  // Full site configuration. `getSettings` is kept as an alias so an older
  // deployment of the front-end keeps working during a rollout.
  if (action === 'getConfig' || action === 'getSettings') {
    var config = readConfig(ss);
    config.status = 'success';
    return json(config);
  }

  var rawSheet = getRawBookingsSheet(ss);
  if (!rawSheet) return json([]);

  var data = rawSheet.getDataRange().getValues();
  if (data.length <= 1) return json([]);

  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var dateCol = headers.indexOf('date');
  var timeCol = headers.indexOf('time');
  var statusCol = headers.indexOf('status');

  // Availability for one date.
  var dateParam = e && e.parameter ? e.parameter.date : null;
  if (dateParam && dateCol !== -1 && timeCol !== -1) {
    var booked = [];
    for (var i = 1; i < data.length; i++) {
      if (statusCol !== -1 && String(data[i][statusCol]).trim() === 'Canceled') continue;
      if (formatDateTimezoneSafe(data[i][dateCol]) === dateParam) {
        booked.push(formatTimeForFrontend(data[i][timeCol]));
      }
    }
    return json(booked);
  }

  // Otherwise: every active booking.
  var result = [];
  for (var r = 1; r < data.length; r++) {
    var status = statusCol !== -1 ? String(data[r][statusCol]).trim() : 'Active';
    if (status !== 'Active' && status !== '') continue;
    result.push({
      date: formatDateTimezoneSafe(data[r][dateCol !== -1 ? dateCol : 0]),
      time: formatTimeForFrontend(data[r][timeCol !== -1 ? timeCol : 1]),
      service: data[r][headers.indexOf('service') !== -1 ? headers.indexOf('service') : 2],
      barber: data[r][headers.indexOf('barber') !== -1 ? headers.indexOf('barber') : 3],
      name: data[r][headers.indexOf('name') !== -1 ? headers.indexOf('name') : 4],
      phone: data[r][headers.indexOf('phone') !== -1 ? headers.indexOf('phone') : 5]
    });
  }
  return json(result);
}

// ---- POST -------------------------------------------------------------

function doPost(e) {
  setupSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var payload;
  if (e && e.postData && e.postData.contents) {
    try { payload = JSON.parse(e.postData.contents); }
    catch (err) { payload = e.parameter || {}; }
  } else {
    payload = e ? (e.parameter || {}) : {};
  }

  var action = payload.action;

  // --- Admin sign-in. Verified here so the password never ships to the browser.
  if (action === 'adminLogin') {
    if (!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')) {
      return json({ status: 'error', message: 'No ADMIN_PASSWORD set in Script Properties' });
    }
    return isAuthorized(payload)
      ? json({ status: 'success' })
      : json({ status: 'error', message: 'Invalid username or password' });
  }

  // --- New booking (public).
  if (!action || action === 'addBooking') {
    var sheet = getRawBookingsSheet(ss);
    var lock = LockService.getScriptLock();
    try {
      // Two people submitting the same slot at once would otherwise both win.
      lock.waitLock(10000);

      if (isSlotTaken(sheet, payload.date, payload.time)) {
        return json({ status: 'error', message: 'That time slot has just been taken' });
      }

      sheet.appendRow([
        payload.date, payload.time, payload.service, payload.barber || 'Any',
        payload.name, payload.phone, 'Active', new Date().toISOString(), payload.price || ''
      ]);

      var hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 9).getValues()[0]
        .map(function (h) { return String(h).trim().toLowerCase(); });
      sortRawBookings(sheet, hdrs);
    } catch (err) {
      return json({ status: 'error', message: String(err) });
    } finally {
      try { lock.releaseLock(); } catch (ignored) {}
    }
    return json({ status: 'success', message: 'Booking added' });
  }

  // --- Cancel a booking (public: the caller must know phone + date + time).
  if (action === 'cancelBooking' || action === 'cancel') {
    var bookingSheet = getRawBookingsSheet(ss);
    var canceledSheet = sheetNamed(ss, SHEET_CANCELED);
    if (canceledSheet.getLastRow() === 0) {
      canceledSheet.appendRow(['Date', 'Time', 'Service', 'Barber', 'Name', 'Phone', 'Status', 'Timestamp', 'Price']);
    }

    var rows = bookingSheet.getDataRange().getValues();
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var dCol = head.indexOf('date'), tCol = head.indexOf('time'), pCol = head.indexOf('phone');

    var wantDate = String(payload.date).trim();
    var wantPhone = String(payload.phone).trim();
    var wantTime = String(payload.time).trim();

    for (var i = 1; i < rows.length; i++) {
      var rowDate = formatDateTimezoneSafe(rows[i][dCol !== -1 ? dCol : 0]);
      var rowPhone = String(rows[i][pCol !== -1 ? pCol : 5]).trim();
      var rowTime = formatTimeForFrontend(rows[i][tCol !== -1 ? tCol : 1]).trim();

      if (rowPhone === wantPhone && rowDate === wantDate && rowTime === wantTime) {
        var row = rows[i];
        canceledSheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5],
                                 'Canceled', new Date().toISOString(), row[8] || '']);
        bookingSheet.deleteRow(i + 1);
        return json({ status: 'success', message: 'Booking canceled' });
      }
    }
    return json({ status: 'error', message: 'Booking not found' });
  }

  // --- Everything below changes site content and requires the password. ---
  if (action === 'saveCMS') {
    if (!isAuthorized(payload)) {
      return json({ status: 'error', message: 'Unauthorized' });
    }

    if (payload.settings) {
      var st = ss.getSheetByName(SHEET_SETTINGS);
      st.clear();
      st.appendRow(['Key', 'Value']);
      Object.keys(payload.settings).forEach(function (key) {
        st.appendRow([key, payload.settings[key]]);
      });
    }

    if (payload.barbers) {
      var bs = ss.getSheetByName(SHEET_BARBERS);
      bs.clear();
      bs.appendRow(['Name', 'ImageURL']);
      payload.barbers.forEach(function (b) { bs.appendRow([b.name, b.image || '']); });
    }

    if (payload.gallery) {
      var gs = ss.getSheetByName(SHEET_GALLERY);
      gs.clear();
      gs.appendRow(['ImageURL']);
      payload.gallery.forEach(function (url) { gs.appendRow([url]); });
    }

    if (payload.services) {
      var svc = ss.getSheetByName(SHEET_SERVICES);
      svc.clear();
      svc.appendRow(['NameEN', 'NameNL', 'Price', 'Duration']);
      payload.services.forEach(function (s) {
        svc.appendRow([s.nameEN, s.nameNL || s.nameEN, s.price, s.duration || 30]);
      });
    }

    if (payload.hours) {
      var hrs = ss.getSheetByName(SHEET_HOURS);
      hrs.clear();
      hrs.appendRow(['Day', 'DayNL', 'Open', 'From', 'To']);
      payload.hours.forEach(function (h) {
        hrs.appendRow([h.day, h.dayNL || h.day, h.open === true, h.from, h.to]);
      });
    }

    return json({ status: 'success', message: 'Saved' });
  }

  return json({ status: 'error', message: 'Unknown action' });
}

/** Guards against double-booking the same date and time. */
function isSlotTaken(sheet, date, time) {
  if (!date || !time) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;

  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var dateCol = headers.indexOf('date');
  var timeCol = headers.indexOf('time');
  var statusCol = headers.indexOf('status');
  if (dateCol === -1 || timeCol === -1) return false;

  for (var i = 1; i < data.length; i++) {
    if (statusCol !== -1 && String(data[i][statusCol]).trim() === 'Canceled') continue;
    if (formatDateTimezoneSafe(data[i][dateCol]) === String(date) &&
        formatTimeForFrontend(data[i][timeCol]).trim() === String(time).trim()) {
      return true;
    }
  }
  return false;
}

function sortRawBookings(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;
  var dateCol = headers.indexOf('date') + 1;
  var timeCol = headers.indexOf('time') + 1;
  if (dateCol > 0 && timeCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort([
      { column: dateCol, ascending: true },
      { column: timeCol, ascending: true }
    ]);
  }
}

// ---- Date / time formatting ------------------------------------------

function formatDateTimezoneSafe(dateVal) {
  if (!dateVal) return '';
  var dateObj = dateVal;
  if (!(dateVal instanceof Date)) {
    if (typeof dateVal === 'string' && dateVal.indexOf('-') !== -1 && dateVal.split('-').length === 3) {
      return dateVal;
    }
    dateObj = new Date(dateVal);
  }
  if (isNaN(dateObj.getTime())) return String(dateVal);
  return dateObj.getFullYear() + '-' +
         String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
         String(dateObj.getDate()).padStart(2, '0');
}

function formatTimeForFrontend(timeVal) {
  if (!timeVal) return '';
  if (typeof timeVal === 'string') return timeVal;
  if (timeVal instanceof Date) {
    var hours = timeVal.getHours();
    var minutes = timeVal.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    if (hours === 0) hours = 12; else if (hours > 12) hours -= 12;
    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;
  }
  return String(timeVal);
}

// ---- Run this once from the editor to check the setup ----------------

function testSetup() {
  setupSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = readConfig(ss);
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Services: ' + config.services.length);
  Logger.log('Hours: ' + config.hours.length);
  Logger.log('Gallery: ' + config.gallery.length);
  Logger.log('Barbers: ' + config.barbers.length);
  var hasPassword = !!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  Logger.log(hasPassword
    ? 'ADMIN_PASSWORD is set — writes are protected.'
    : 'WARNING: ADMIN_PASSWORD is NOT set. Every write will be refused until you add it.');
}

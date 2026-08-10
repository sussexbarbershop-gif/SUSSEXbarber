/**
 * Sussex Barber Shop — Google Apps Script backend
 *
 * Paste this over the contents of Code.gs in the Apps Script project, then
 * redeploy the Web App (Deploy > Manage deployments > edit > New version).
 * Nothing here reaches the site until that redeploy happens.
 *
 * SET THE ADMIN PASSWORD BEFORE DEPLOYING:
 *   Project Settings > Script Properties > Add script property
 *   Property: ADMIN_PASSWORD   Value: <the password you want>
 * The password lives only here, never in the website source.
 *
 * Deploy as: Execute as = Me, Who has access = Anyone.
 *
 * "Anyone" is what lets a customer book without a Google account, so every
 * endpoint below decides for itself what it will hand out:
 *   - public:   the site config, availability for a date, a booking, and a
 *               customer's own appointments looked up by their phone number
 *   - password: the full diary (names and phone numbers), image uploads,
 *               and every write that changes what the site shows
 *
 * The Sheet is the only store. The site and the panel keep nothing locally,
 * so what the owner sees and what customers are offered cannot drift apart.
 */

// ---- Configuration ----------------------------------------------------

var SHEET_BOOKINGS = 'Sheet1';
var SHEET_SETTINGS = 'Settings';
var SHEET_BARBERS = 'Barbers';
var SHEET_GALLERY = 'Gallery';
var SHEET_SERVICES = 'Services';
var SHEET_HOURS = 'Hours';
var SHEET_CANCELED = 'CanceledBookings';
var SHEET_BARBER_HOURS = 'BarberHours';
var SHEET_TIME_OFF = 'TimeOff';

/** The chair-agnostic barber option offered to customers with no preference. */
var ANY_BARBER = 'Any Available';

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

/**
 * The rota as the shop actually runs it today. Only used to seed a barber who
 * has no rows yet — once the owner edits a rota in the panel, the Sheet wins
 * and nothing here is consulted again.
 *
 * A barber not listed here is left off every day, because the remaining staff
 * come in as needed rather than on fixed days; the owner turns their days on in
 * the panel when they are scheduled.
 */
var FULL_DAY = { from: '10:00', to: '18:00', breakFrom: '13:30', breakTo: '14:00' };
// Monday is Raman's alone: he comes in at noon and works straight through.
var MONDAY_LATE = { from: '12:00', to: '18:00', breakFrom: '', breakTo: '' };

var DEFAULT_BARBER_ROTA = {
  'Hemen': { Tuesday: FULL_DAY, Wednesday: FULL_DAY, Friday: FULL_DAY, Saturday: FULL_DAY },
  'Amir':  { Tuesday: FULL_DAY, Thursday: FULL_DAY, Friday: FULL_DAY, Saturday: FULL_DAY },
  'Raman': { Monday: MONDAY_LATE, Saturday: FULL_DAY }
};

/** Everyone the booking form can offer, in the order the cards appear.
 *  Anyone here but missing from the Barbers sheet is added on next request. */
var KNOWN_BARBERS = [ANY_BARBER, 'Hemen', 'Amir', 'Raman', 'Bassam', 'Saan'];

/** Appointment length. Must match SLOT_MINUTES in index.html. */
var SLOT_MINUTES = 30;

/** How much notice the shop wants. A slot closer to now than this is neither
 *  offered nor accepted: nobody is in the chair in five minutes. Must match
 *  MIN_NOTICE_MINUTES in index.html. */
var MIN_NOTICE_MINUTES = 15;

// Where the site points before anyone edits them in the panel. These used to
// be written into index.html in six places between them, so moving premises or
// changing the handle meant editing the source.
var DEFAULT_INSTAGRAM = 'https://www.instagram.com/sussexbarbershop';
var DEFAULT_MAPS_URL = 'https://maps.app.goo.gl/vhDfYkHsUg5vzWHB8';
var DEFAULT_MAPS_EMBED = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2449.610582236528!2d4.394628212130325!3d52.1412030656041!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c5b736b4421bfd%3A0xc6c4293e50ab52e4!2sVan%20Hogendorpstraat%2010%2C%202242%20KZ%20Wassenaar%2C%20Netherlands!5e0!3m2!1sen!2sus!4v1715690000000!5m2!1sen!2sus';

/**
 * Bumped whenever this file changes in a way the site depends on. It is
 * returned with the config so `npm run check:backend` can tell whether the
 * deployed Web App is still the version in the repository — this file only
 * reaches the site when someone pastes it in and redeploys, and forgetting
 * that has been the cause of every "I changed it but nothing happened".
 */
var BACKEND_VERSION = '11-validate-email';

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

/**
 * Replace the Settings sheet with `pairs` — [[key, value], ...].
 *
 * The value column is set to plain text first. A phone number written as
 * "+31 6 53730803" begins with a plus, which Sheets parses as a formula, and
 * the cell ends up holding #ERROR! — which the website then displays where the
 * number should be. The same trap catches anything starting with =, -, @ or +.
 */
function writeSettings(sheet, pairs) {
  var rows = [['Key', 'Value']].concat(pairs);
  sheet.clear();
  sheet.getRange(1, 2, rows.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  SpreadsheetApp.flush();
}

/** Drive folder that holds gallery and barber photos. Created on first use. */
function getImageFolder() {
  var name = 'Sussex Barber Site Images';
  var existing = DriveApp.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(name);
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

/** Back off after each wrong password, up to 8 seconds. Guessing a decent
 *  password at one attempt every few seconds is not a realistic attack, and
 *  the Apps Script execution budget caps the total anyway. */
function throttleFailedLogin() {
  var cache = CacheService.getScriptCache();
  var failures = parseInt(cache.get('login_failures') || '0', 10) + 1;
  cache.put('login_failures', String(failures), 900);   // 15 minutes
  Utilities.sleep(Math.min(8000, 500 * Math.pow(2, Math.min(failures, 4))));
}

function resetLoginFailures() {
  CacheService.getScriptCache().remove('login_failures');
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

/**
 * Bump when setupSheets() starts creating something new, so the next request
 * runs it once more instead of trusting the "already done" mark.
 */
var SCHEMA_VERSION = '8-booking-email-column';

/**
 * setupSheets() opens nine sheets and reads them to decide it has nothing to
 * do, which it did on every single request. Apps Script charges for that in
 * whole seconds. Run it once, then remember.
 *
 * Anything that can invalidate the answer — a barber added, sheets renamed —
 * calls forgetSetup(), so this never hides a missing sheet for long.
 */
function ensureSheets() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('schema_ready') === SCHEMA_VERSION) return;
  setupSheets();
  props.setProperty('schema_ready', SCHEMA_VERSION);
}

function forgetSetup() {
  PropertiesService.getScriptProperties().deleteProperty('schema_ready');
  CacheService.getScriptCache().remove('config');
}

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var bookings = sheetNamed(ss, SHEET_BOOKINGS);
  if (bookings.getLastRow() === 0) {
    bookings.appendRow(['Date', 'Time', 'Service', 'Barber', 'Name', 'Phone',
                        'Status', 'Timestamp', 'Price', 'Email']);
  }
  addMissingBookingColumns(bookings);

  var settings = sheetNamed(ss, SHEET_SETTINGS);
  if (settings.getLastRow() === 0) {
    writeSettings(settings, [
      ['hero_title', 'Masterful Cuts, Exceptional Service.'],
      ['hero_subtitle', 'Elevating the art of grooming in Sussex. Experience the difference.'],
      ['about_text', 'With years of experience, our master barbers provide the finest cuts, shaves, and grooming services in Sussex.'],
      ['contact_phone', '+31 123 456 789'],
      ['contact_address', 'Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands'],
      ['instagram_url', DEFAULT_INSTAGRAM],
      ['maps_url', DEFAULT_MAPS_URL],
      ['maps_embed_url', DEFAULT_MAPS_EMBED]
    ]);
  }
  repairSettingErrors(settings);
  addMissingSettings(settings);

  var barbers = sheetNamed(ss, SHEET_BARBERS);
  if (barbers.getLastRow() === 0) {
    barbers.appendRow(['Name', 'ImageURL']);
  }
  // The booking form offers these by name. Until they exist here they have no
  // rota, and a barber with no rota falls back to the shop's hours — which is
  // why Hemen was bookable on a Monday he does not work.
  addMissingBarbers(barbers);

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

  var barberHours = sheetNamed(ss, SHEET_BARBER_HOURS);
  if (barberHours.getLastRow() === 0) {
    barberHours.appendRow(['Barber', 'Day', 'Working', 'From', 'To', 'BreakFrom', 'BreakTo']);
  }
  dedupeBarberHours(barberHours);
  // Barbers added before this sheet existed, or added later from the panel,
  // start out with no rows at all. Give them a week from DEFAULT_BARBER_ROTA,
  // which is every day off for anyone that map does not name.
  seedMissingBarberHours(ss, barberHours);

  var timeOff = sheetNamed(ss, SHEET_TIME_OFF);
  if (timeOff.getLastRow() === 0) {
    timeOff.appendRow(['Barber', 'From', 'To', 'Note']);
  }
}

/**
 * Puts back any Settings value that has become a formula error.
 *
 * contact_phone was written with appendRow() as "+31 6 53730803"; Sheets read
 * the leading plus as a formula and stored #ERROR!, and the site had no number
 * to show. Writing is fixed at the source, but the broken cell is already in
 * the sheet and setupSheets() only fills a sheet that is completely empty.
 * A no-op once the values are clean.
 */
function repairSettingErrors(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var replacements = {
    contact_phone: '+31 6 53730803',
    contact_address: 'Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands'
  };

  var fixed = false;
  for (var r = 1; r < data.length; r++) {
    var key = String(data[r][0]).trim();
    var value = String(data[r][1]);
    if (value.indexOf('#') !== 0) continue;      // not an error cell
    if (!replacements[key]) continue;            // nothing sensible to restore
    sheet.getRange(r + 1, 2).setNumberFormat('@').setValue(replacements[key]);
    fixed = true;
  }
  if (fixed) {
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('config');
  }
}

/**
 * Adds a header the bookings sheet has never had, to the right of what is
 * already there. Existing rows keep their columns and simply have nothing in
 * the new one; nothing is moved, so a sheet the owner has sorted, filtered or
 * built a formula against is left as it was.
 */
function addMissingBookingColumns(sheet) {
  if (sheet.getLastRow() === 0) return;

  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });

  ['email'].forEach(function (name) {
    if (headers.indexOf(name) !== -1) return;
    width += 1;
    sheet.getRange(1, width).setValue(name.charAt(0).toUpperCase() + name.slice(1));
    headers.push(name);
  });
  SpreadsheetApp.flush();
}

/**
 * Adds Settings keys the sheet has never held. setupSheets() only fills a
 * sheet that is completely empty, so a project that predates a new setting
 * would never get one and the panel would show an empty box for it.
 * Existing values are untouched.
 */
function addMissingSettings(sheet) {
  var data = sheet.getDataRange().getValues();
  var present = {};
  for (var r = 1; r < data.length; r++) {
    if (data[r][0]) present[String(data[r][0]).trim()] = true;
  }

  var wanted = [
    ['instagram_url', DEFAULT_INSTAGRAM],
    ['maps_url', DEFAULT_MAPS_URL],
    ['maps_embed_url', DEFAULT_MAPS_EMBED]
  ];
  var toAppend = wanted.filter(function (pair) { return !present[pair[0]]; });
  if (toAppend.length === 0) return;

  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 2, toAppend.length, 1).setNumberFormat('@');
  sheet.getRange(start, 1, toAppend.length, 2).setValues(toAppend);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('config');
}

/**
 * Removes duplicate (barber, day) rows, keeping the first — which is the one
 * the owner last edited, since the copies were appended after it.
 *
 * A save used to rewrite this sheet and then read it back without flushing, so
 * the seeding pass saw an empty sheet and appended a second full rota. That is
 * fixed at the source; this clears up sheets it already damaged, and is a
 * no-op once they are clean.
 */
function dedupeBarberHours(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 2) return;

  var seen = {};
  var kept = [data[0]];
  for (var r = 1; r < data.length; r++) {
    if (!data[r][0]) continue;
    var key = String(data[r][0]).trim() + '|' + String(data[r][1]).trim();
    if (seen[key]) continue;
    seen[key] = true;
    kept.push(data[r]);
  }
  if (kept.length === data.length) return;   // nothing to do

  sheet.clear();
  sheet.getRange(1, 1, kept.length, kept[0].length).setValues(kept);
  SpreadsheetApp.flush();
}

/**
 * Adds any KNOWN_BARBERS row the sheet is missing. Names the owner has already
 * added, renamed or deleted are left exactly as they are — this only fills
 * gaps, so a barber removed on purpose does not come back.
 */
function addMissingBarbers(barbersSheet) {
  var data = barbersSheet.getDataRange().getValues();
  var present = {};
  for (var r = 1; r < data.length; r++) {
    if (data[r][0]) present[String(data[r][0]).trim()] = true;
  }

  // Only seed on a sheet nobody has curated yet: once a real barber is in
  // there, the sheet is the owner's list and we stop adding to it.
  var hasRealBarber = Object.keys(present).some(function (n) { return n !== ANY_BARBER; });
  if (hasRealBarber) return;

  var toAppend = [];
  KNOWN_BARBERS.forEach(function (name) {
    if (!present[name]) toAppend.push([name, '']);
  });
  if (toAppend.length) {
    barbersSheet.getRange(barbersSheet.getLastRow() + 1, 1, toAppend.length, 2)
                .setValues(toAppend);
  }
}

/**
 * Gives every barber a full week of rows in BarberHours unless they already
 * have some, using DEFAULT_BARBER_ROTA. Never edits rows the owner has set, so
 * it is safe to call on every request.
 */
function seedMissingBarberHours(ss, barberHoursSheet) {
  var barbersData = ss.getSheetByName(SHEET_BARBERS).getDataRange().getValues();

  var existing = {};
  var current = barberHoursSheet.getDataRange().getValues();
  for (var r = 1; r < current.length; r++) {
    if (current[r][0]) existing[String(current[r][0]).trim()] = true;
  }

  var toAppend = [];
  for (var b = 1; b < barbersData.length; b++) {
    var name = String(barbersData[b][0] || '').trim();
    // "Any Available" is a placeholder, not a person, so it has no rota.
    if (!name || name === ANY_BARBER || existing[name]) continue;

    var rota = DEFAULT_BARBER_ROTA[name] || {};
    for (var d = 0; d < WEEKDAY_NAMES.length; d++) {
      var dayName = WEEKDAY_NAMES[d];
      var shift = rota[dayName];
      toAppend.push([
        name, dayName, !!shift,
        shift ? shift.from : '',
        shift ? shift.to : '',
        shift ? (shift.breakFrom || '') : '',
        shift ? (shift.breakTo || '') : ''
      ]);
    }
  }

  if (toAppend.length) {
    barberHoursSheet
      .getRange(barberHoursSheet.getLastRow() + 1, 1, toAppend.length, 7)
      .setValues(toAppend);
  }
}

// ---- Reading the config ----------------------------------------------

/**
 * readConfig() reads seven sheets. Every visitor needs it and it changes only
 * when the owner saves, so serve it from cache and drop the cache on save.
 * Two minutes: short enough that a change feels immediate, long enough that a
 * burst of visitors costs one read between them.
 */
function readConfigCached(ss) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('config');
  if (hit) {
    try { return JSON.parse(hit); } catch (ignored) {}
  }

  var config;
  try {
    config = readConfig(ss);
  } catch (err) {
    // A sheet has gone missing. ensureSheets() would normally have rebuilt it,
    // but it now skips once the schema is marked ready — so clear that mark,
    // rebuild, and try once more before giving up.
    forgetSetup();
    setupSheets();
    PropertiesService.getScriptProperties().setProperty('schema_ready', SCHEMA_VERSION);
    config = readConfig(ss);
  }

  try {
    cache.put('config', JSON.stringify(config), 120);
  } catch (ignored) {
    // Over the 100KB cache limit; correctness does not depend on caching.
  }
  return config;
}

function readConfig(ss) {
  var out = {
    settings: {}, barbers: [], gallery: [], services: [], hours: [],
    barberHours: {}, timeOff: []
  };

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

  var barberHoursData = ss.getSheetByName(SHEET_BARBER_HOURS).getDataRange().getValues();
  var seenDay = {};
  for (var p = 1; p < barberHoursData.length; p++) {
    var who = String(barberHoursData[p][0] || '').trim();
    if (!who || !barberHoursData[p][1]) continue;
    // Ignore a repeated day even if the sheet somehow holds one: two rows for
    // the same Tuesday would otherwise put the barber on the rota twice and
    // let one slot be booked twice over.
    var dayKey = who + '|' + String(barberHoursData[p][1]).trim();
    if (seenDay[dayKey]) continue;
    seenDay[dayKey] = true;
    if (!out.barberHours[who]) out.barberHours[who] = [];
    out.barberHours[who].push({
      day: String(barberHoursData[p][1]).trim(),
      working: barberHoursData[p][2] === true ||
        String(barberHoursData[p][2]).toLowerCase() === 'true',
      from: formatClock(barberHoursData[p][3]),
      to: formatClock(barberHoursData[p][4]),
      breakFrom: formatClock(barberHoursData[p][5]),
      breakTo: formatClock(barberHoursData[p][6])
    });
  }

  var timeOffData = ss.getSheetByName(SHEET_TIME_OFF).getDataRange().getValues();
  for (var q = 1; q < timeOffData.length; q++) {
    if (!timeOffData[q][0] || !timeOffData[q][1]) continue;
    var fromDate = formatDateTimezoneSafe(timeOffData[q][1]);
    out.timeOff.push({
      barber: String(timeOffData[q][0]).trim(),
      from: fromDate,
      // A single-day absence is the common case; let the owner leave To blank.
      to: timeOffData[q][2] ? formatDateTimezoneSafe(timeOffData[q][2]) : fromDate,
      note: String(timeOffData[q][3] || '')
    });
  }

  return out;
}

// ---- Who is actually on the floor -------------------------------------

/** The barber's entry for a weekday, or null when they have no rota at all. */
function barberDayEntry(config, barberName, weekdayName) {
  var rota = config.barberHours[String(barberName).trim()];
  if (!rota) return null;
  for (var i = 0; i < rota.length; i++) {
    if (rota[i].day === weekdayName) return rota[i];
  }
  return null;
}

function isBarberOnLeave(config, barberName, dateStr) {
  var name = String(barberName).trim();
  for (var i = 0; i < config.timeOff.length; i++) {
    var row = config.timeOff[i];
    if (row.barber !== name) continue;
    if (dateStr >= row.from && dateStr <= row.to) return true;
  }
  return false;
}

/**
 * True when the barber is rostered on that date and the time falls inside both
 * their own hours and the shop's. A barber with no rota row for the day falls
 * back to the shop hours, so nothing breaks before the owner fills the rota in.
 */
function isBarberWorkingAt(config, barberName, dateStr, minutes) {
  if (isBarberOnLeave(config, barberName, dateStr)) return false;

  var weekday = weekdayNameFor(dateStr);
  var shop = null;
  for (var i = 0; i < config.hours.length; i++) {
    if (config.hours[i].day === weekday) { shop = config.hours[i]; break; }
  }
  if (!shop || !shop.open) return false;
  var shopFrom = clockToMinutes(shop.from);
  var shopTo = clockToMinutes(shop.to);
  if (shopFrom === null || shopTo === null) return false;
  // The appointment has to finish by closing, not merely start before it.
  // This said `minutes >= shopTo`, which the website never agreed with, so a
  // hand-made POST could book an appointment running past the shutters.
  if (minutes < shopFrom || minutes + SLOT_MINUTES > shopTo) return false;

  var entry = barberDayEntry(config, barberName, weekday);
  if (!entry) return true;          // no rota yet: shop hours apply
  if (!entry.working) return false;

  var from = clockToMinutes(entry.from);
  var to = clockToMinutes(entry.to);
  if (from === null || to === null) return true;
  if (minutes < from || minutes + SLOT_MINUTES > to) return false;

  // The daily break. A slot starting inside it is not bookable; a slot ending
  // exactly as the break starts still is.
  var breakFrom = clockToMinutes(entry.breakFrom);
  var breakTo = clockToMinutes(entry.breakTo);
  if (breakFrom !== null && breakTo !== null && breakTo > breakFrom) {
    if (minutes + SLOT_MINUTES > breakFrom && minutes < breakTo) return false;
  }
  return true;
}

/** Every real barber (never ANY_BARBER) rostered for that date and time. */
function barbersWorkingAt(config, dateStr, minutes) {
  var working = [];
  for (var i = 0; i < config.barbers.length; i++) {
    var name = String(config.barbers[i].name).trim();
    if (!name || name === ANY_BARBER) continue;
    if (isBarberWorkingAt(config, name, dateStr, minutes)) working.push(name);
  }
  return working;
}

/**
 * Can `wanted` still be booked at this slot, given the bookings already on it?
 *
 * Each booking occupies one chair. Bookings naming a barber occupy that
 * barber's chair; bookings made without a preference occupy an unspecified one,
 * so they only rule a named barber out once no other chair could absorb them.
 *
 * `wanted` empty or ANY_BARBER means "no preference".
 */
function isSlotFree(config, dateStr, slotLabel, holders, wanted) {
  var minutes = clockToMinutes(slotLabel);
  if (minutes === null) return true;

  var working = barbersWorkingAt(config, dateStr, minutes);
  if (working.length === 0) return false;   // nobody on the floor

  var named = [];
  var anonymous = 0;
  (holders || []).forEach(function (h) {
    var who = String(h || '').trim();
    if (!who || who === ANY_BARBER || who === 'Any') anonymous++;
    else if (named.indexOf(who) === -1) named.push(who);
  });

  var name = String(wanted || '').trim();
  if (!name || name === ANY_BARBER) {
    return (named.length + anonymous) < working.length;
  }

  if (working.indexOf(name) === -1) return false;   // not rostered
  if (named.indexOf(name) !== -1) return false;     // already booked

  // Chairs left after the explicit bookings, one of which must stay for us.
  var uncommitted = working.filter(function (w) { return named.indexOf(w) === -1; });
  return anonymous < uncommitted.length;
}

/** Sheets may hand back a Date for a cell like "10:00"; normalise to HH:mm. */
function formatClock(value) {
  if (value instanceof Date) {
    return String(value.getHours()).padStart(2, '0') + ':' +
           String(value.getMinutes()).padStart(2, '0');
  }
  return String(value || '');
}

var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                     'Friday', 'Saturday'];

/** 'Monday' for a 'YYYY-MM-DD' string, read as a local date, not UTC. */
function weekdayNameFor(dateStr) {
  var parts = String(dateStr).split('-');
  if (parts.length !== 3) return '';
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? '' : WEEKDAY_NAMES[d.getDay()];
}

/** Minutes past midnight for '14:30' or the '02:30 PM' the booking form sends. */
function clockToMinutes(value) {
  var text = String(value == null ? '' : value).trim();
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }
  var m = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  var hours = parseInt(m[1], 10);
  var mins = parseInt(m[2], 10);
  if (m[3]) {
    var period = m[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + mins;
}

// ---- GET --------------------------------------------------------------

function doGet(e) {
  ensureSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = e && e.parameter ? e.parameter.action : null;

  // Full site configuration. `getSettings` is kept as an alias so an older
  // deployment of the front-end keeps working during a rollout.
  if (action === 'getConfig' || action === 'getSettings') {
    var config = readConfigCached(ss);
    config.status = 'success';
    // Not cached with the rest: the cache outlives a redeploy, and a stale
    // version number here would defeat the point of reporting it.
    config.backendVersion = BACKEND_VERSION;
    return json(config);
  }

  // Page-view counter. Lives here so the site keeps nothing locally.
  if (action === 'trackVisit') {
    var counterSheet = sheetNamed(ss, SHEET_SETTINGS);
    var rows = counterSheet.getDataRange().getValues();
    var found = -1;
    for (var v = 1; v < rows.length; v++) {
      if (String(rows[v][0]) === 'visit_count') { found = v + 1; break; }
    }
    var current = found === -1 ? 0 : (Number(rows[found - 1][1]) || 0);
    if (found === -1) counterSheet.appendRow(['visit_count', 1]);
    else counterSheet.getRange(found, 2).setValue(current + 1);
    return json({ status: 'success', visits: current + 1 });
  }

  var rawSheet = getRawBookingsSheet(ss);
  if (!rawSheet) return json([]);

  var data = rawSheet.getDataRange().getValues();
  if (data.length <= 1) return json([]);

  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var dateCol = headers.indexOf('date');
  var timeCol = headers.indexOf('time');
  var statusCol = headers.indexOf('status');

  // A customer looking up their own bookings by phone number. Replaces the
  // per-device list the site used to keep, so it works from any device.
  if (action === 'myBookings') {
    var wantedPhone = normalisePhone(e.parameter.phone);
    if (!wantedPhone) return json([]);

    var phoneCol = headers.indexOf('phone');
    var mine = [];
    var todayStr = formatDateTimezoneSafe(new Date());

    for (var b = 1; b < data.length; b++) {
      if (statusCol !== -1 && String(data[b][statusCol]).trim() === 'Canceled') continue;
      if (normalisePhone(data[b][phoneCol !== -1 ? phoneCol : 5]) !== wantedPhone) continue;

      var bookingDate = formatDateTimezoneSafe(data[b][dateCol]);
      if (bookingDate < todayStr) continue;   // past appointments are not actionable

      mine.push({
        date: bookingDate,
        time: formatTimeForFrontend(data[b][timeCol]),
        service: data[b][headers.indexOf('service') !== -1 ? headers.indexOf('service') : 2],
        barber: data[b][headers.indexOf('barber') !== -1 ? headers.indexOf('barber') : 3],
        name: data[b][headers.indexOf('name') !== -1 ? headers.indexOf('name') : 4],
        phone: String(data[b][phoneCol !== -1 ? phoneCol : 5])
      });
    }
    return json(mine);
  }

  // Availability for one date. Before per-barber rotas this returned every
  // booking on the date, so one customer booking 10:00 with Hemen also closed
  // 10:00 for Amir and Raman. A slot is now only unavailable when the barber
  // the customer actually asked for is busy — or, for "Any Available", when
  // every barber rostered at that time is busy.
  var dateParam = e && e.parameter ? e.parameter.date : null;
  if (dateParam && dateCol !== -1 && timeCol !== -1) {
    var barberParam = String((e.parameter.barber || '')).trim();
    var barberCol = headers.indexOf('barber');
    var takenBy = {};

    for (var i = 1; i < data.length; i++) {
      if (statusCol !== -1 && String(data[i][statusCol]).trim() === 'Canceled') continue;
      if (formatDateTimezoneSafe(data[i][dateCol]) !== dateParam) continue;
      var slot = formatTimeForFrontend(data[i][timeCol]);
      var who = String(data[i][barberCol !== -1 ? barberCol : 3] || '').trim();
      if (!takenBy[slot]) takenBy[slot] = [];
      takenBy[slot].push(who);
    }

    var config = readConfigCached(ss);
    var booked = [];

    Object.keys(takenBy).forEach(function (slot) {
      if (!isSlotFree(config, dateParam, slot, takenBy[slot], barberParam)) {
        booked.push(slot);
      }
    });

    // Times today that have already gone. The browser hides these itself, but
    // it works from the visitor's own clock: a phone set to the wrong time, or
    // a customer in another timezone, would still be shown them. The shop's
    // clock is the one that decides.
    var nowForDate = new Date();
    if (dateParam === formatDateTimezoneSafe(nowForDate)) {
      var cutoff = nowForDate.getHours() * 60 + nowForDate.getMinutes() + MIN_NOTICE_MINUTES;
      config.hours.forEach(function (day) {
        if (day.day !== weekdayNameFor(dateParam) || !day.open) return;
        var open = clockToMinutes(day.from);
        var close = clockToMinutes(day.to);
        if (open === null || close === null) return;
        for (var t = open; t + SLOT_MINUTES <= close; t += SLOT_MINUTES) {
          if (t >= cutoff) break;
          var label = formatTimeForFrontend(new Date(1970, 0, 1, Math.floor(t / 60), t % 60));
          if (booked.indexOf(label) === -1) booked.push(label);
        }
      });
    }

    return json(booked);
  }

  // Nothing else is public. A bare GET used to return every booking in the
  // shop — customer names and phone numbers included — to anyone who had the
  // URL, and the URL is in the page source of a public website. The panel now
  // asks for that list by POST with the password (action: 'allBookings').
  return json([]);
}

// ---- POST -------------------------------------------------------------

function doPost(e) {
  ensureSheets();
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
    if (isAuthorized(payload)) {
      resetLoginFailures();
      return json({ status: 'success' });
    }
    // Slow guessing down. Deliberately a delay and not a lockout: a lockout
    // would let anyone lock the owner out of their own panel just by
    // submitting wrong passwords.
    throttleFailedLogin();
    return json({ status: 'error', message: 'Invalid username or password' });
  }

  // --- The whole diary, for the panel. Behind the password: it carries every
  //     customer's name and phone number.
  if (action === 'allBookings') {
    if (!isAuthorized(payload)) {
      throttleFailedLogin();
      return json({ status: 'error', message: 'Unauthorized' });
    }

    var diarySheet = getRawBookingsSheet(ss);
    if (!diarySheet) return json([]);
    var diary = diarySheet.getDataRange().getValues();
    if (diary.length <= 1) return json([]);

    var head2 = diary[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var col = function (name, fallback) {
      var idx = head2.indexOf(name);
      return idx === -1 ? fallback : idx;
    };
    var statusIdx = head2.indexOf('status');
    var emailIdx = head2.indexOf('email');

    var diaryOut = [];
    for (var d2 = 1; d2 < diary.length; d2++) {
      var st = statusIdx !== -1 ? String(diary[d2][statusIdx]).trim() : 'Active';
      if (st !== 'Active' && st !== '') continue;
      diaryOut.push({
        date: formatDateTimezoneSafe(diary[d2][col('date', 0)]),
        time: formatTimeForFrontend(diary[d2][col('time', 1)]),
        service: diary[d2][col('service', 2)],
        barber: diary[d2][col('barber', 3)],
        name: diary[d2][col('name', 4)],
        phone: diary[d2][col('phone', 5)],
        // No fallback position: Email was added later, so a sheet that predates
        // it simply has no such column and every booking reads as blank.
        email: emailIdx === -1 ? '' : (diary[d2][emailIdx] || ''),
        price: diary[d2][col('price', 8)]
      });
    }
    return json(diaryOut);
  }

  // --- New booking (public).
  if (!action || action === 'addBooking') {
    var sheet = getRawBookingsSheet(ss);
    var lock = LockService.getScriptLock();
    try {
      // Two people submitting the same slot at once would otherwise both win.
      lock.waitLock(10000);

      var check = slotRefusal(ss, sheet, payload);
      if (check) {
        return json({ status: 'error', message: check });
      }

      // Built by header name, not by position: the sheet has gained columns
      // over time and may be reordered by hand, and writing a row positionally
      // would put the phone number wherever the sixth column happens to be.
      var hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 9).getValues()[0]
        .map(function (h) { return String(h).trim().toLowerCase(); });

      var values = {
        date: payload.date,
        time: payload.time,
        service: payload.service,
        barber: payload.barber || 'Any',
        name: payload.name,
        phone: payload.phone,
        email: String(payload.email || '').trim(),
        status: 'Active',
        timestamp: new Date().toISOString(),
        price: payload.price || ''
      };
      var row = hdrs.map(function (h) {
        return Object.prototype.hasOwnProperty.call(values, h) ? values[h] : '';
      });
      sheet.appendRow(row);

      sortRawBookings(sheet, hdrs);
    } catch (err) {
      return json({ status: 'error', message: String(err) });
    } finally {
      try { lock.releaseLock(); } catch (ignored) {}
    }

    // Both sent after the lock is released and the row is safely written: the
    // booking must not fail because an email did.
    notifyOwnerOfBooking(payload);
    emailCustomerConfirmation(payload);

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

        // Worth knowing sooner than a booking: a chair has just come free.
        notifyOwnerOfCancellation({
          date: rowDate, time: rowTime, name: row[4], phone: row[5],
          service: row[2], barber: row[3]
        });

        return json({ status: 'success', message: 'Booking canceled' });
      }
    }
    return json({ status: 'error', message: 'Booking not found' });
  }

  // --- Image upload. A Sheet cell holds at most 50,000 characters, so an
  //     image can never be stored inline as base64; put the file in Drive and
  //     keep only its URL. The panel shrinks the image before sending it.
  if (action === 'uploadImage') {
    if (!isAuthorized(payload)) {
      return json({ status: 'error', message: 'Unauthorized' });
    }
    try {
      var folder = getImageFolder();
      var parts = String(payload.dataUrl || '').split(',');
      if (parts.length !== 2) {
        return json({ status: 'error', message: 'Malformed image data' });
      }
      var contentType = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
      var bytes = Utilities.base64Decode(parts[1]);
      var blob = Utilities.newBlob(bytes, contentType, payload.filename || ('image-' + Date.now() + '.jpg'));

      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      // This form renders inside an <img>; the /file/d/ share link does not.
      return json({
        status: 'success',
        url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600'
      });
    } catch (err) {
      return json({ status: 'error', message: String(err) });
    }
  }

  // --- Everything below changes site content and requires the password. ---
  if (action === 'saveCMS') {
    if (!isAuthorized(payload)) {
      return json({ status: 'error', message: 'Unauthorized' });
    }

    if (payload.settings) {
      writeSettings(ss.getSheetByName(SHEET_SETTINGS),
        Object.keys(payload.settings).map(function (key) {
          return [key, payload.settings[key]];
        }));
    }

    if (payload.barbers) {
      var bs = ss.getSheetByName(SHEET_BARBERS);
      var barberRows = [['Name', 'ImageURL']];
      payload.barbers.forEach(function (b) {
        if (String(b.name || '').trim()) barberRows.push([b.name, b.image || '']);
      });
      bs.clear();
      bs.getRange(1, 1, barberRows.length, 2).setValues(barberRows);
      // seedMissingBarberHours() reads this sheet at the end of the save. Apps
      // Script buffers writes, so without this it works from the old list: a
      // barber just added gets no rota and silently falls back to shop hours.
      SpreadsheetApp.flush();
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

    if (payload.barberHours) {
      var bh = sheetNamed(ss, SHEET_BARBER_HOURS);
      var rows = [['Barber', 'Day', 'Working', 'From', 'To', 'BreakFrom', 'BreakTo']];
      Object.keys(payload.barberHours).forEach(function (who) {
        (payload.barberHours[who] || []).forEach(function (row) {
          rows.push([who, row.day, row.working === true, row.from, row.to,
                     row.breakFrom || '', row.breakTo || '']);
        });
      });
      bh.clear();
      // One write instead of a call per row: a full rota is 42 appendRow()
      // round trips, and that is most of what made saving slow.
      bh.getRange(1, 1, rows.length, 7).setValues(rows);
      // seedMissingBarberHours() reads this sheet back in a moment. Apps Script
      // buffers writes, so without this it sees the sheet as it was before the
      // clear, decides every barber is missing, and appends a second copy of
      // the whole rota.
      SpreadsheetApp.flush();
    }

    if (payload.timeOff) {
      var off = sheetNamed(ss, SHEET_TIME_OFF);
      off.clear();
      off.appendRow(['Barber', 'From', 'To', 'Note']);
      payload.timeOff.forEach(function (row) {
        off.appendRow([row.barber, row.from, row.to || row.from, row.note || '']);
      });
    }

    // A barber added in this same save has no rota yet; give them a week.
    seedMissingBarberHours(ss, sheetNamed(ss, SHEET_BARBER_HOURS));

    // The panel has just changed what customers see, so the cached copy is
    // wrong. Drop it or the owner would watch the site ignore them for two
    // minutes and save again.
    CacheService.getScriptCache().remove('config');

    return json({ status: 'success', message: 'Saved' });
  }

  return json({ status: 'error', message: 'Unknown action' });
}

/**
 * Emails the shop when a booking comes in, so nobody has to keep the panel
 * open to find out. Off until an address is set:
 *
 *   Project Settings > Script Properties > Add script property
 *   Property: NOTIFY_EMAIL   Value: the address to tell
 *
 * Never throws. A booking is already written by the time this runs, and a
 * failed email must not turn a successful booking into an error for the
 * customer - nor use up the daily quota retrying.
 */
function notifyOwnerOfBooking(payload) {
  notifyOwner('Booking', 'New booking', payload);
}

/**
 * Confirms the appointment to the customer, if they gave an address. The email
 * field is optional, so most bookings will not send one.
 *
 * Silent on failure for the same reason as the owner's copy: the booking is
 * already in the sheet, and a bounced address must not be reported back to
 * someone whose appointment is confirmed.
 */
function emailCustomerConfirmation(payload) {
  try {
    var to = String(payload.email || '').trim();
    // Same shape the browser checks. This is a public endpoint, so whatever
    // arrives here is checked again before it is handed to MailApp.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return;

    var config = readConfigCached(SpreadsheetApp.getActiveSpreadsheet());
    var shopPhone = String(config.settings.contact_phone || '').trim();
    var shopAddress = String(config.settings.contact_address || '').trim()
      .replace(/<br\s*\/?>/gi, ', ');
    var barber = String(payload.barber || '').trim() || ANY_BARBER;

    var lines = [
      'Hello ' + String(payload.name || '') + ',',
      '',
      'Your appointment at Sussex Barber Shop is booked.',
      '',
      'When:    ' + String(payload.date || '') + ' at ' + String(payload.time || ''),
      'Service: ' + String(payload.service || ''),
      'Barber:  ' + barber
    ];
    if (shopAddress) lines.push('Where:   ' + shopAddress);
    lines.push('');
    // No cancel link: cancelling is done on the site with the phone number the
    // booking was made under, and a link in an email would be a second way in
    // that nothing else checks.
    lines.push('To change or cancel, visit the website and use "Already booked?"');
    if (shopPhone) lines.push('or call us on ' + shopPhone + '.');
    lines.push('');
    lines.push('See you soon.');

    MailApp.sendEmail({
      to: to,
      subject: 'Your appointment — ' + String(payload.date || '') + ' at ' + String(payload.time || ''),
      body: lines.join('\n')
    });
  } catch (err) {
    Logger.log('Could not send the customer confirmation: ' + err);
  }
}

/** A cancellation is worth knowing sooner than a booking: a chair is free. */
function notifyOwnerOfCancellation(payload) {
  notifyOwner('CANCELLED', 'Booking cancelled', payload);
}

function notifyOwner(subjectPrefix, heading, payload) {
  try {
    var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
    if (!to) return;

    var when = String(payload.date || '') + ' at ' + String(payload.time || '');
    var barber = String(payload.barber || '').trim() || ANY_BARBER;

    var lines = [
      heading,
      '',
      'When:    ' + when,
      'Who:     ' + String(payload.name || ''),
      'Phone:   ' + String(payload.phone || ''),
      'Email:   ' + (String(payload.email || '').trim() || '—'),
      'Service: ' + String(payload.service || ''),
      'Barber:  ' + barber
    ];
    if (payload.price) lines.push('Price:   EUR ' + String(payload.price));

    MailApp.sendEmail({
      to: to,
      // The subject alone should be enough to read on a lock screen.
      subject: subjectPrefix + ': ' + String(payload.name || 'customer') + ' — ' + when,
      body: lines.join('\n')
    });
  } catch (err) {
    Logger.log('Could not send the ' + subjectPrefix + ' notification: ' + err);
  }
}

/**
 * Why this booking cannot be accepted, or '' when it can. Checked here and not
 * only in the browser: the form is public, so the rota is not enforced until
 * the server says so.
 */
function slotRefusal(ss, sheet, payload) {
  var date = payload.date;
  var time = payload.time;

  // This used to return '' — accept — for a booking with no date or time, so a
  // malformed request wrote a blank row into the diary.
  if (!date || !time) return 'Please choose a date and a time';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return 'That date is not valid';

  var minutes = clockToMinutes(time);
  if (minutes === null) return 'That time is not valid';

  var name = String(payload.name || '').trim();
  var phone = String(payload.phone || '').trim();
  if (!name) return 'Please give a name for the booking';
  if (normalisePhone(phone).length < 6) return 'Please give a phone number we can reach you on';
  // Nothing legitimate is this long; a cell holds 50,000 characters and the
  // diary is read by a person.
  if (name.length > 100 || phone.length > 40) return 'That name or number is too long';

  // Optional, but a typo is worse than leaving it blank: the booking would be
  // accepted, the confirmation would silently never arrive, and the customer
  // would be waiting for one. Only the browser checked this, and the browser
  // is not what decides.
  var email = String(payload.email || '').trim();
  if (email) {
    if (email.length > 254) return 'That email address is too long';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return 'That email address does not look right. Leave it blank if you prefer.';
    }
  }

  // The diary is only useful for appointments that have not happened yet, and
  // the site itself only offers the next 30 days.
  var now = new Date();
  var today = formatDateTimezoneSafe(now);
  if (String(date) < today) return 'That date has already passed';

  // Only the date was checked here, so at four in the afternoon a booking for
  // ten that morning was accepted - and then sat in the diary looking like a
  // customer who had not turned up.
  if (String(date) === today) {
    var minutesNow = now.getHours() * 60 + now.getMinutes();
    if (minutes < minutesNow + MIN_NOTICE_MINUTES) {
      return 'That time has passed. Please choose a later one.';
    }
  }

  var config = readConfigCached(ss);
  var wanted = String(payload.barber || '').trim();

  if (wanted && wanted !== ANY_BARBER && wanted !== 'Any') {
    if (isBarberOnLeave(config, wanted, String(date))) {
      return wanted + ' is away on that date';
    }
    if (!isBarberWorkingAt(config, wanted, String(date), minutes)) {
      return wanted + ' does not work at that time';
    }
  }

  var holders = holdersOfSlot(sheet, date, time);
  if (!isSlotFree(config, String(date), String(time), holders, wanted)) {
    // Says who took it and what to do, because the customer had that slot on
    // screen a moment ago and needs to know it was not their own mistake.
    return 'Someone else booked that time while you were filling this in. ' +
           'Please choose another.';
  }
  return '';
}

/** The barber named on every active booking sitting on this date and time. */
function holdersOfSlot(sheet, date, time) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var dateCol = headers.indexOf('date');
  var timeCol = headers.indexOf('time');
  var statusCol = headers.indexOf('status');
  var barberCol = headers.indexOf('barber');
  if (dateCol === -1 || timeCol === -1) return [];

  var holders = [];
  for (var i = 1; i < data.length; i++) {
    if (statusCol !== -1 && String(data[i][statusCol]).trim() === 'Canceled') continue;
    if (formatDateTimezoneSafe(data[i][dateCol]) === String(date) &&
        formatTimeForFrontend(data[i][timeCol]).trim() === String(time).trim()) {
      holders.push(String(data[i][barberCol !== -1 ? barberCol : 3] || '').trim());
    }
  }
  return holders;
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

/** Compare phone numbers by their last 9 digits, so the Dutch local and
 *  international forms of one number match: "06 1234 5678",
 *  "+31 6 1234 5678" and "0031612345678" all identify the same customer. */
function normalisePhone(value) {
  var digits = String(value || '').replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
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

// ---- One-click repair -------------------------------------------------

/**
 * Overwrite Settings, Gallery and Barbers with the real shop content.
 *
 * setupSheets() only fills a sheet that is completely empty, so a project
 * that already ran the older script still holds its placeholder rows — a
 * Amsterdam address, stock Unsplash photos, invented barber names. Those
 * would replace the real content on the site. Run this once from the editor
 * to put it right; after that, edit through the admin panel or the Sheet.
 *
 * Safe to re-run. It does not touch bookings.
 */
function fixContent() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var settings = sheetNamed(ss, SHEET_SETTINGS);
  var keep = {};
  var existing = settings.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (existing[i][0] === 'visit_count') keep.visit_count = existing[i][1];
  }

  // appendRow() is what put "#ERROR!" in contact_phone: the number starts with
  // a plus, so Sheets took it for a formula. writeSettings() sets the column to
  // plain text first.
  writeSettings(settings, [
    ['hero_title', 'Masterful Cuts, Exceptional Service.'],
    ['hero_subtitle', 'Experience premium grooming and hearty service in the heart of Wassenaar.'],
    ['about_text',
      'At Sussex Barber Shop, we blend modern styling techniques with traditional barbering values. ' +
      'Our space is designed to be a sanctuary for men—a place where you can unwind, enjoy a free coffee, ' +
      'and leave looking your absolute best.\n' +
      'With a 4.7-star rating and a reputation for precise cuts and a friendly atmosphere, our attentive barbers ' +
      'ensure that every haircut, beard trim, and hot towel shave is executed to perfection.'],
    ['contact_phone', '+31 6 53730803'],
    ['contact_address', 'Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands'],
    ['instagram_url', DEFAULT_INSTAGRAM],
    ['maps_url', DEFAULT_MAPS_URL],
    ['maps_embed_url', DEFAULT_MAPS_EMBED],
    ['visit_count', keep.visit_count || 0]
  ]);

  var gallery = sheetNamed(ss, SHEET_GALLERY);
  gallery.clear();
  gallery.appendRow(['ImageURL']);
  ['assets/IMG_8582.PNG', 'assets/IMG_8577.JPEG', 'assets/IMG_8575.JPEG',
   'assets/IMG_8572.JPEG', 'assets/IMG_8567.JPEG', 'assets/IMG_8569.JPEG']
    .forEach(function (src) { gallery.appendRow([src]); });

  // Barbers are deliberately left alone. This used to reset the sheet to just
  // "Any Available", which would delete the staff, strand every rota keyed to
  // their names, and leave the booking form offering one option.
  CacheService.getScriptCache().remove('config');

  Logger.log('Settings and Gallery reset to the real shop content.');
  Logger.log('Gallery images: 6');
  Logger.log('Address: Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands');
  Logger.log('Barbers, rotas and bookings were not touched.');
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

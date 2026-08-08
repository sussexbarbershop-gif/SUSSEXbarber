// The barber and service grids became two buttons that open a picker sheet.
// This covers the interactive half renderBarberCards/renderServiceCards don't:
// choosing a row applies it, closes the sheet, and updates the button.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(name) {
  const re = new RegExp('^        function ' + name + '\\([\\s\\S]*?^        }', 'm');
  const m = html.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const ANY_BARBER = 'Any Available';
const el = (initial = {}) => Object.assign({
  classList: { add() {}, remove() {} },
  dispatchEvent() {}, addEventListener() {}
}, initial);

const barberField = el({ value: ANY_BARBER });
const serviceField = el({ value: '' });
const dateField = el({ value: '' });
const barberList = el({ innerHTML: '' });
const serviceList = el({ innerHTML: '' });
const barberLabel = el({ textContent: '' });
const serviceLabel = el({ textContent: '' });
const servicePrice = el({ textContent: '' });
const barberSheet = el({ hidden: false, classList: { add(c) { if (c === 'hidden') barberSheet.hidden = true; }, remove(c) { if (c === 'hidden') barberSheet.hidden = false; } } });
const serviceSheet = el({ hidden: false, classList: { add(c) { if (c === 'hidden') serviceSheet.hidden = true; }, remove(c) { if (c === 'hidden') serviceSheet.hidden = false; } } });

const byId = {
  barber: barberField, service: serviceField, date: dateField,
  barberPickerList: barberList, servicePickerList: serviceList,
  barberPickerLabel: barberLabel, servicePickerLabel: serviceLabel,
  servicePickerPrice: servicePrice,
  barberPickerSheet: barberSheet, servicePickerSheet: serviceSheet,
  desktopLiveService: null, time: el({ value: '' })
};
global.document = {
  getElementById: id => (id in byId ? byId[id] : null),
  createElement: () => ({
    set textContent(v) { this._t = String(v == null ? '' : v); },
    get innerHTML() { return this._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  })
};
global.window = {};
let toasts = [];
function showToast(msg) { toasts.push(msg); }
function updateDesktopLiveSummary() {}
function renderCustomCalendar() {}
function renderTimeChips() {}
function noSlotsOn() { return false; }
let bookedTimesList = [];

eval([
  'escapeText', 'escapeAttribute',
  'renderBarberCards', 'updateBarberPickerLabel', 'chooseBarber', 'closeBarberPicker',
  'renderServiceCards', 'updateServicePickerLabel', 'chooseService', 'closeServicePicker'
].map(grab).join('\n'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- barber picker ---');
barberField.value = 'Hemen';
renderBarberCards([{ name: ANY_BARBER }, { name: 'Hemen' }, { name: 'Amir' }]);
ok('the current barber is checked', /data-barber="Hemen"[^>]*bg-gold\/10/.test(barberList.innerHTML), true);
ok('the others are not', /data-barber="Amir"[^>]*bg-gold\/10/.test(barberList.innerHTML), false);
ok('button label follows the hidden value', barberLabel.textContent, 'Hemen');

barberSheet.hidden = false;
chooseBarber('Amir');
ok('choosing updates the hidden field', barberField.value, 'Amir');
ok('choosing updates the button label', barberLabel.textContent, 'Amir');
ok('choosing closes the sheet', barberSheet.hidden, true);
ok('the list redraws to check the new choice', /data-barber="Amir"[^>]*bg-gold\/10/.test(barberList.innerHTML), true);

console.log('--- a barber not working that day resets the date ---');
dateField.value = '2026-09-01';
noSlotsOn = () => true;
chooseBarber('Hemen');
ok('the stale date is cleared', dateField.value, '');
ok('a toast explains why', toasts.some(t => t.includes('Hemen')), true);
dateField.value = '';
noSlotsOn = () => false;

console.log('--- service picker ---');
serviceField.value = 'Classic Haircut';
renderServiceCards([
  { nameEN: 'Classic Haircut', duration: 30, price: 28 },
  { nameEN: 'Skin Fade', duration: 30, price: 28 }
]);
ok('price and duration are shown', /Classic Haircut[\s\S]*~30 min[\s\S]*€28/.test(serviceList.innerHTML), true);
ok('the current service is checked', /data-service="Classic Haircut"[^>]*bg-gold\/10/.test(serviceList.innerHTML), true);
ok('button label follows the hidden value', serviceLabel.textContent, 'Classic Haircut');
ok('button price follows the hidden value', servicePrice.textContent, '€28');

serviceSheet.hidden = false;
chooseService('Skin Fade');
ok('choosing updates the hidden field', serviceField.value, 'Skin Fade');
ok('choosing updates the button label', serviceLabel.textContent, 'Skin Fade');
ok('choosing updates the button price', servicePrice.textContent, '€28');
ok('choosing closes the sheet', serviceSheet.hidden, true);

console.log('--- free text is escaped, not injected ---');
renderBarberCards([{ name: ANY_BARBER }, { name: '<img onerror=x>' }]);
ok('a barber name cannot inject markup', barberList.innerHTML.includes('<img'), false);
renderServiceCards([{ nameEN: '<img onerror=x>', duration: 30, price: 10 }]);
ok('a service name cannot inject markup', serviceList.innerHTML.includes('<img'), false);

console.log(failed === 0 ? '\nAll picker tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

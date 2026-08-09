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
/** A stand-in element whose classList remembers what is on it, so the tests can
 *  tell placeholder styling from chosen styling. */
const el = (initial = {}) => {
  const classes = new Set();
  return Object.assign({
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    dispatchEvent() {}, addEventListener() {}
  }, initial);
};

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

const continueBtn = el({ disabled: true });

const byId = {
  barber: barberField, service: serviceField, date: dateField,
  barberPickerList: barberList, servicePickerList: serviceList,
  barberPickerLabel: barberLabel, servicePickerLabel: serviceLabel,
  servicePickerPrice: servicePrice,
  barberPickerSheet: barberSheet, servicePickerSheet: serviceSheet,
  goToStep2Btn: continueBtn,
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
  'escapeText', 'escapeAttribute', 'setPickerLabelState', 'updateStep1Ready',
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

console.log('--- every inline onclick can actually reach its function ---');
// The site's script runs inside an IIFE, so a function is private unless it is
// published on window. Both picker buttons shipped broken for exactly this
// reason: the markup called openBarberPicker(), the function existed, and the
// browser could not see it. Syntax checks pass either way, so this checks the
// one thing that matters - the name is reachable from an attribute.
{
  const handlers = new Set(
    [...html.matchAll(/on(?:click|change|submit)="(\w+)\(/g)].map(m => m[1])
  );
  const exported = new Set(
    [...html.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1])
  );
  // Handlers declared outside any IIFE are global already; find those too.
  const topLevel = new Set(
    [...html.matchAll(/^    (?:async )?function (\w+)/gm)].map(m => m[1])
  );
  const unreachable = [...handlers].filter(h => !exported.has(h) && !topLevel.has(h)).sort();
  ok('no onclick calls a function trapped inside the IIFE', unreachable, []);
}

console.log('--- changing step scrolls to the steps, not past them ---');
// This scrolled to the top of #booking minus 100px, which put the "Book an
// Appointment" heading and its subtitle back on screen on every step change.
{
  const wizard = html.match(/function updateWizardUI\(stepNum\)[\s\S]*?\n        \}/);
  const src = wizard ? wizard[0] : '';
  ok('the wizard scrolls to the steps anchor', /getElementById\('bookingStepsAnchor'\)/.test(src), true);
  ok('it no longer scrolls to the section top', /getElementById\('booking'\)/.test(src), false);
  // The indicator is sticky: once stuck, its box is where it is pinned rather
  // than where it belongs in the page, so measuring it or scrolling to it
  // overshoots by however far the page had already moved. The anchor is a
  // plain, empty, non-sticky element and has neither problem.
  ok('it does not aim at the sticky indicator', /getElementById\('stepIndicator'\)/.test(src), false);
  ok('the anchor exists above the indicator',
     html.indexOf('id="bookingStepsAnchor"') < html.indexOf('id="stepIndicator"'), true);
  // The nav is fixed, so the anchor needs its own scroll margin or the browser
  // parks it underneath the header.
  const anchorTag = (html.match(/<div id="bookingStepsAnchor"[^>]*>/) || [''])[0];
  ok('the anchor clears the fixed nav', /scroll-mt-/.test(anchorTag), true);
}

console.log('--- the desktop Live Summary is gone ---');
// It repeated service, barber, date and time under the form on every step,
// reading as four dashes for most of the booking. Step 3 already summarises
// the same four lines where they matter, just before confirming.
// Match the rendered heading, not the comment that explains its removal.
ok('no Live Summary panel', />\s*Live Summary\s*</.test(html), false);
ok('no desktopLive* elements', /desktopLive/.test(html), false);
ok('step 3 still summarises the booking', /id="summaryService"/.test(html), true);

console.log('--- nothing is chosen for the customer ---');
// Both fields used to ship pre-filled ("Classic Haircut", "Any Available"), so
// someone who opened neither picker still booked - for whoever and whatever the
// defaults were - without having chosen either.
ok('the page ships with no barber pre-selected', /id="barber" value=""/.test(html), true);
ok('the page ships with no service pre-selected', /id="service" value=""/.test(html), true);
ok('the Continue button starts disabled', /id="goToStep2Btn" disabled/.test(html), true);

barberField.value = '';
serviceField.value = '';
renderBarberCards([{ name: ANY_BARBER }, { name: 'Hemen' }]);
renderServiceCards([{ nameEN: 'Classic Haircut', duration: 30, price: 28 }]);
ok('barber button reads as a prompt', barberLabel.textContent, 'Choose barber');
ok('service button reads as a prompt', serviceLabel.textContent, 'Choose service');
ok('prompts are styled as placeholders', barberLabel.classList.contains('text-gray-500'), true);
ok('no price is shown before a service is picked', servicePrice.textContent, '');
ok('Continue is blocked with neither chosen', continueBtn.disabled, true);

chooseBarber('Hemen');
ok('Continue is still blocked with only a barber', continueBtn.disabled, true);
chooseService('Classic Haircut');
ok('Continue unlocks once both are chosen', continueBtn.disabled, false);
ok('a real choice is not styled as a placeholder', barberLabel.classList.contains('text-gray-500'), false);

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

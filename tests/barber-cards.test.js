const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8');

function grab(name) {
  const re = new RegExp('^        function ' + name + '\\([\\s\\S]*?^        }', 'm');
  const m = html.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const ANY_BARBER = 'Any Available';
const barberField = { value: '' };
const serviceField = { value: '' };
const container = { innerHTML: '' };
const teamContainer = { innerHTML: '' };
const noopClassList = { add() {}, remove() {}, toggle() {}, contains: () => false };
const pickerLabel = { textContent: '', classList: noopClassList };
const continueBtn = { disabled: true };

global.document = {
  getElementById: id => id === 'barberPickerList' ? container
                      : id === 'barber' ? barberField
                      : id === 'service' ? serviceField
                      : id === 'cms-barbers-grid' ? teamContainer
                      : id === 'barberPickerLabel' ? pickerLabel
                      : id === 'goToStep2Btn' ? continueBtn
                      : null,
  createElement: () => ({
    set textContent(v) { this._t = String(v == null ? '' : v); },
    get innerHTML() { return this._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  }),
  querySelectorAll: () => []
};
global.window = { sussexBarberHours: {} };

eval(['renderBarberCards', 'renderTeamGrid', 'escapeText', 'escapeAttribute',
      'updateBarberPickerLabel', 'setPickerLabelState', 'updateStep1Ready'].map(grab).join('\n'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const cardNames = () => [...container.innerHTML.matchAll(/data-barber="([^"]*)"/g)].map(m => m[1]);

barberField.value = 'Hemen';
renderBarberCards([{name:'Any Available'},{name:'Hemen'},{name:'Amir'},{name:'Raman'}]);
ok('cards come from the sheet', cardNames(), ['Any Available','Hemen','Amir','Raman']);
ok('existing choice kept', barberField.value, 'Hemen');

// The owner adds someone in the panel.
renderBarberCards([{name:'Any Available'},{name:'Hemen'},{name:'Kawa'}]);
ok('added barber appears', cardNames().includes('Kawa'), true);

// The owner deletes the barber the customer had selected.
barberField.value = 'Kawa';
renderBarberCards([{name:'Any Available'},{name:'Hemen'}]);
ok('deleted barber gone', cardNames().includes('Kawa'), false);
ok('stale choice reset to Any', barberField.value, ANY_BARBER);

// "Any Available" leads even when the sheet forgets it or reorders.
renderBarberCards([{name:'Hemen'},{name:'Any Available'},{name:'Amir'}]);
ok('Any Available leads once', cardNames(), ['Any Available','Hemen','Amir']);
renderBarberCards([{name:'Hemen'}]);
ok('Any Available added when missing', cardNames(), ['Any Available','Hemen']);

// Names are free text typed into the panel.
renderBarberCards([{name:'Any Available'},{name:'Ali"s'}]);
ok('quote escaped in attribute', /data-barber="Ali&quot;s"/.test(container.innerHTML), true);
renderBarberCards([{name:'Any Available'},{name:'<img onerror=x>'}]);
ok('markup in a name not injected', container.innerHTML.includes('<img'), false);

renderBarberCards([]);
ok('empty sheet still offers Any', cardNames(), ['Any Available']);

console.log('--- Our Master Barbers: no hardcoded staff ---');
// This used to be three cards written into the page: fixed names, invented
// ratings, and a photo captioned with someone else's name. None of that
// tracked the Barbers sheet, so adding or removing staff never showed here.
ok('no barber names left in the page source',
   /Hemen|Amir|Raman|Bassam|Saan/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')),
   false);
ok('the grid starts empty, built only by renderTeamGrid()',
   /id="cms-barbers-grid"[^>]*>\s*<\/div>/.test(html), true);

const teamNames = () => [...teamContainer.innerHTML.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(m => m[1]);

renderTeamGrid([{ name: 'Any Available' }, { name: 'Hemen', image: 'h.jpg' }, { name: 'Amir' }]);
ok('team grid: Any Available is not staff', teamNames().includes('Any Available'), false);
ok('team grid: real barbers shown', teamNames(), ['Hemen', 'Amir']);
ok('team grid: a barber with a photo gets an <img>', teamContainer.innerHTML.includes('h.jpg'), true);
ok('team grid: a barber with no photo gets an initial, not a broken <img>',
   /<img[^>]*src="\s*"/.test(teamContainer.innerHTML), false);

window.sussexBarberHours = {
  Hemen: [{ day: 'Tuesday', working: true }, { day: 'Friday', working: true },
          { day: 'Wednesday', working: false }]
};
renderTeamGrid([{ name: 'Hemen' }]);
ok('team grid: shows real working days, not a rating', teamContainer.innerHTML.includes('Tue · Fri'), true);
ok('team grid: no invented star rating', teamContainer.innerHTML.includes('★'), false);

renderTeamGrid([]);
ok('team grid: empty sheet renders nothing, not stale cards', teamContainer.innerHTML, '');

console.log(failed === 0 ? '\nAll card tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

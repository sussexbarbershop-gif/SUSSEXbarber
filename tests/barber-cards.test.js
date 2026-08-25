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
// A real enough classList to be worth asserting against: renderTeamGrid sets
// the column count from the size of the team, and a stub that swallowed the
// calls would let that silently stop happening.
const classSet = (initial) => {
  const set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: c => set.has(c),
    has: c => set.has(c),
    toggle(c, on) {
      if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
      else if (on) set.add(c); else set.delete(c);
      return set.has(c);
    }
  };
};
// Started from what the markup actually carries, so the first render is asked
// to correct a real starting state rather than an empty one.
const teamContainer = {
  innerHTML: '',
  classList: classSet('stagger reveal grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6 lg:gap-8')
};
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

console.log('--- and the row is centred whatever the size of the team ---');
// The shop turned all but two barbers off in the panel, and the two that were
// left sat in the first two of three columns — left of a centred heading, with
// an empty third column nobody could see. It looked like a broken page rather
// than a shop with two barbers, and the cause was invisible from the outside.
const shape = () => ['grid-cols-1', 'grid-cols-2', 'md:grid-cols-2', 'md:grid-cols-3',
                     'max-w-xs', 'md:max-w-3xl', 'mx-auto']
  .filter(c => teamContainer.classList.has(c));

window.sussexBarberHours = {};
renderTeamGrid([{ name: 'Hemen' }, { name: 'Amir' }, { name: 'Raman' }]);
ok('three fill the three columns', shape(), ['grid-cols-2', 'md:grid-cols-3']);

renderTeamGrid([{ name: 'Hemen' }, { name: 'Amir' }]);
ok('two make two columns, and centre',
   shape(), ['grid-cols-2', 'md:grid-cols-2', 'md:max-w-3xl', 'mx-auto']);

renderTeamGrid([{ name: 'Hemen' }]);
ok('one is a single card, not a half-width one',
   shape(), ['grid-cols-1', 'max-w-xs', 'mx-auto']);

// Back up again: the classes have to come off as well as go on, or the shop
// turning a barber back on would leave the row stuck at the narrower measure.
renderTeamGrid([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
ok('and four go back to three columns', shape(), ['grid-cols-2', 'md:grid-cols-3']);

renderTeamGrid([]);
ok('team grid: empty sheet renders nothing, not stale cards', teamContainer.innerHTML, '');

console.log(failed === 0 ? '\nAll card tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// The Working Hours page, against a stand-in DOM.
//
// The database will not store a day that is open with no opening time, and the
// panel saves all seven days in one transaction — so one blank box does not
// fail one day, it fails the save. That happened live: Sunday had been shut
// since before the panel existed and carried no hours at all, switching it on
// sent exactly that, and the toggle stayed on screen looking saved while the
// reason sat in a log.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');

function grab(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}
function grabConst(name) {
  const re = new RegExp('^const ' + name + ' = .*$', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

let hours, saved, toasts = [];
const el = () => ({ innerHTML: '' });
global.document = { getElementById: el };
function showToast(msg, type) { toasts.push({ msg, type }); }
async function saveHours() { saved = JSON.parse(JSON.stringify(hours)); return true; }

eval([grabConst('DEFAULT_OPEN_FROM'), grabConst('DEFAULT_OPEN_TO'),
      grab('renderHours'), grab('updateHour'), grab('toggleDay')].join('\n'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const reset = () => {
  toasts = [];
  saved = null;
  hours = [
    { day: 'Sunday',   open: false, from: '',      to: ''      },
    { day: 'Monday',   open: true,  from: '12:00', to: '18:00' },
    { day: 'Tuesday',  open: false, from: '10:00', to: '18:00' }
  ];
};

console.log('--- opening a day that has never had hours ---');
reset();
toggleDay(0, true);
ok('it is open', hours[0].open, true);
ok('with the shop\'s usual hours', [hours[0].from, hours[0].to], ['10:00', '18:00']);
ok('and that is what was saved', [saved[0].from, saved[0].to], ['10:00', '18:00']);
// Nothing here can be refused, so nothing has to be explained.
ok('no complaint', toasts.length, 0);

console.log('--- a day that was shut but remembered its hours ---');
reset();
toggleDay(2, true);
ok('keeps them rather than being reset', [hours[2].from, hours[2].to], ['10:00', '18:00']);

console.log('--- closing a day keeps the times for next time ---');
reset();
toggleDay(1, false);
ok('shut', hours[1].open, false);
// Blanking them means the owner who closes a Monday and reopens it a month
// later is handed two empty boxes.
ok('but the hours are still there', [hours[1].from, hours[1].to], ['12:00', '18:00']);

console.log('--- an open day cannot be left without a time ---');
reset();
updateHour(1, 'from', '');
ok('the blank is refused', hours[1].from, '10:00');
ok('the owner is told why', toasts.length, 1);
ok('and nothing was sent', saved, null);

console.log('--- a real edit still saves ---');
reset();
updateHour(1, 'from', '09:30');
ok('the new time is kept', hours[1].from, '09:30');
ok('and saved', saved[1].from, '09:30');
ok('silently', toasts.length, 0);

console.log('--- a closed day may hold blanks ---');
reset();
updateHour(0, 'from', '');
ok('nothing to refuse', hours[0].from, '');
ok('and it is saved', saved !== null, true);

console.log(failed === 0 ? '\nAll shop hours tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// Exercises the barber dialog in admin/admin.js against a stand-in DOM.
// The risky part is that rotas and time off are keyed by barber name, so a
// rename has to carry them across or the barber silently loses their schedule
// and falls back to the shop's opening hours.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');

function grab(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const WEEK = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const ANY_BARBER = 'Any Available';

// --- state the functions read and write -------------------------------
let barbers, barberHours, timeOff;
let editingBarberIndex = -1, draftRota = null, draftTimeOff = null, draftImage = '';
let synced = null, toasts = [];
let confirmAnswer = true;

// --- stand-in DOM ------------------------------------------------------
const fields = {};
const el = (id) => (fields[id] || (fields[id] = { value: '', textContent: '', innerHTML: '',
  style: {}, src: '', classList: { add(){}, remove(){} } }));
global.document = {
  getElementById: el,
  createElement: () => ({
    set textContent(v) { this._t = String(v == null ? '' : v); },
    get innerHTML() { return this._t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  })
};
global.confirm = () => confirmAnswer;
function showToast(msg, type) { toasts.push({ msg, type }); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g,'&quot;'); }
function renderBarbers() {}
function uploadImage() { return null; }
async function saveToServer(partial) { synced = partial; return true; }

eval([
  'rotaFor', 'openBarberModal', 'setBarberModalPhoto', 'closeBarberModal',
  'renderModalRota', 'updateDraftRota', 'toggleDraftRotaDay', 'renderModalTimeOff',
  'addTimeOffFor', 'updateDraftTimeOff', 'removeDraftTimeOff',
  'saveBarberModal', 'deleteBarberFromModal', 'addBarber'
].map(grab).join('\n'));

// --- helpers -----------------------------------------------------------
let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const workingDays = name => (barberHours[name] || []).filter(r => r.working).map(r => r.day);

function reset() {
  barbers = [{ name: 'Any Available', image: '' }, { name: 'Hemen', image: 'h.jpg' }];
  barberHours = {
    Hemen: WEEK.map(d => ['Tuesday','Friday'].includes(d)
      ? { day: d, working: true, from: '10:00', to: '18:00', breakFrom: '13:30', breakTo: '14:00' }
      : { day: d, working: false, from: '', to: '', breakFrom: '', breakTo: '' })
  };
  timeOff = [{ barber: 'Hemen', from: '2026-09-01', to: '2026-09-03', note: 'holiday' }];
  synced = null; toasts = []; confirmAnswer = true;
}

async function main() {
  console.log('--- opening a barber ---');
  reset();
  openBarberModal(1);
  ok('draft rota loaded',    draftRota.filter(r => r.working).map(r => r.day), ['Tuesday','Friday']);
  ok('draft time off loaded', draftTimeOff.length, 1);
  ok('name shown',           el('barberModalName').value, 'Hemen');

  console.log('--- Close throws edits away ---');
  toggleDraftRotaDay(WEEK.indexOf('Monday'), true);
  closeBarberModal();
  ok('live rota untouched', workingDays('Hemen'), ['Tuesday','Friday']);

  console.log('--- Save applies them ---');
  reset();
  openBarberModal(1);
  toggleDraftRotaDay(WEEK.indexOf('Monday'), true);
  ok('switching a day on fills the hours', draftRota[WEEK.indexOf('Monday')].from, '10:00');
  await saveBarberModal();
  ok('Monday saved',       workingDays('Hemen'), ['Monday','Tuesday','Friday']);
  ok('sheet was written',  Object.keys(synced).sort(), ['barberHours','barbers','timeOff']);

  console.log('--- renaming carries the schedule ---');
  reset();
  openBarberModal(1);
  el('barberModalName').value = 'Hemin';
  await saveBarberModal();
  ok('new name on the list',   barbers[1].name, 'Hemin');
  ok('rota moved across',      workingDays('Hemin'), ['Tuesday','Friday']);
  ok('old key dropped',        barberHours.Hemen, undefined);
  ok('time off followed',      timeOff.map(t => t.barber), ['Hemin']);

  console.log('--- a name has to be unique and non-empty ---');
  reset();
  barbers.push({ name: 'Amir', image: '' });
  openBarberModal(1);
  el('barberModalName').value = '   ';
  await saveBarberModal();
  ok('blank name refused',   barbers[1].name, 'Hemen');
  ok('nothing synced',       synced, null);
  el('barberModalName').value = 'Amir';
  await saveBarberModal();
  ok('duplicate refused',    barbers[1].name, 'Hemen');
  ok('still nothing synced', synced, null);

  console.log('--- deleting ---');
  reset();
  openBarberModal(1);
  confirmAnswer = false;
  await deleteBarberFromModal();
  ok('cancelled delete keeps them', barbers.map(b => b.name), ['Any Available','Hemen']);
  confirmAnswer = true;
  openBarberModal(1);
  await deleteBarberFromModal();
  ok('barber gone',      barbers.map(b => b.name), ['Any Available']);
  ok('rota gone',        barberHours.Hemen, undefined);
  ok('their leave gone', timeOff, []);

  console.log('--- adding ---');
  reset();
  global.prompt = () => 'Kawa';
  await addBarber();
  ok('added to the list', barbers.map(b => b.name), ['Any Available','Hemen','Kawa']);
  ok('starts with every day off', workingDays('Kawa'), []);
  ok('but has a full week of rows', barberHours.Kawa.length, 7);
  global.prompt = () => 'hemen';
  await addBarber();
  ok('duplicate name refused (any case)', barbers.length, 3);

  console.log('--- time off validation ---');
  reset();
  openBarberModal(1);
  addTimeOffFor();
  const last = draftTimeOff.length - 1;
  updateDraftTimeOff(last, 'from', '2026-10-10');
  updateDraftTimeOff(last, 'to', '2026-10-01');
  ok('end before start refused', draftTimeOff[last].to, '2026-10-10');
  removeDraftTimeOff(last);
  ok('removed again', draftTimeOff.length, 1);

  console.log('--- a shift cannot end before it starts ---');
  reset();
  openBarberModal(1);
  const tue = WEEK.indexOf('Tuesday');
  const goodEnd = draftRota[tue].to;
  updateDraftRota(tue, 'to', '09:00');
  // Put back, not cleared. A working day with a blank time is refused by the
  // database, and refused along with every other change in the same save.
  ok('bad end time reverted', draftRota[tue].to, goodEnd);
  ok('and the owner is told', toasts[toasts.length - 1].type, 'error');

  console.log('--- a working day always has hours in it ---');
  reset();
  openBarberModal(1);
  const sun = WEEK.indexOf('Sunday');
  draftRota[sun].from = '';
  draftRota[sun].to = '';
  toggleDraftRotaDay(sun, true);
  ok('switching it on fills them in', [draftRota[sun].from, draftRota[sun].to],
     ['10:00', '18:00']);

  toasts = [];
  updateDraftRota(sun, 'from', '');
  ok('and clearing one is refused', draftRota[sun].from, '10:00');
  ok('with a reason', toasts.length, 1);
}

main().then(() => {
  console.log(failed === 0 ? '\nAll panel tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});

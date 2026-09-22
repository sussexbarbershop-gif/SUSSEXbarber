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
let bookings = [];
const today = () => '2026-01-01';
function fetchLiveBookings() {}
let editingBarberIndex = -1, draftRota = null, draftTimeOff = null, draftImage = '';
let synced = null, toasts = [];
let confirmAnswer = true;
let saveAnswer = true, barberSaving = false, saveDetails = {}, saveGate = null;

// --- stand-in DOM ------------------------------------------------------
const fields = {};
const el = (id) => (fields[id] || (fields[id] = { value: '', textContent: '', innerHTML: '',
  style: {}, src: '', classList: { add(){}, remove(){} } }));
global.document = {
  getElementById: el,
  querySelectorAll: () => [],
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
async function saveToServer(partial, onSaved) {
  synced = partial;
  if (saveGate) await saveGate;
  if (saveAnswer && onSaved) onSaved(saveDetails);
  return saveAnswer;
}

eval([
  'rotaFor', 'openBarberModal', 'setBarberModalPhoto', 'closeBarberModal',
  'renderModalRota', 'updateDraftRota', 'toggleDraftRotaDay', 'renderModalTimeOff',
  'addTimeOffFor', 'updateDraftTimeOff', 'removeDraftTimeOff',
  'saveBarberModal', 'deleteBarberFromModal', 'addBarber'
  , 'renderTimeOffWarning'
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
  synced = null; toasts = []; confirmAnswer = true; saveAnswer = true; barberSaving = false;
  saveDetails = {}; saveGate = null;
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
  const beforeFailedSave = JSON.stringify({barbers,barberHours,timeOff});
  draftTimeOff.push({barber:'Hemen',from:'2026-10-10',to:'2026-10-12',note:''});
  saveAnswer = false;
  await saveBarberModal();
  ok('a refused save keeps the confirmed state',JSON.stringify({barbers,barberHours,timeOff}),beforeFailedSave);
  ok('a refused save keeps the dialog open',editingBarberIndex,1);
  ok('a refused save keeps the draft for retry',draftTimeOff && draftTimeOff.length,2);

  reset();
  openBarberModal(1);
  draftTimeOff[0].from='';
  await saveBarberModal();
  ok('a blank leave start never reaches the server',synced,null);

  reset();
  openBarberModal(1);
  let releaseSave;
  saveGate = new Promise(resolve => {releaseSave=resolve;});
  const pendingSave = saveBarberModal();
  ok('pending save keeps the modal open',editingBarberIndex,1);
  closeBarberModal();
  ok('closing cannot discard an in-flight save',editingBarberIndex,1);
  const pendingProposal = synced;
  await saveBarberModal();
  ok('a second save does not send another proposal',synced === pendingProposal,true);
  saveDetails = {timeOffConflictCount:2};
  bookings = [1,2].map(i => ({barberName:'Hemen',date:'2026-09-02',time:'10:00',customerName:'Test '+i,status:'Confirmed'}));
  releaseSave();
  await pendingSave;
  ok('success closes the modal',editingBarberIndex,-1);
  ok('existing appointments get a persistent warning',/2 booking/.test(el('barberTimeOffWarning').innerHTML),true);
  el('barberTimeOffWarning').innerHTML = '';
  renderTimeOffWarning();
  ok('warning is rebuilt after a refresh from saved data',/2 booking/.test(el('barberTimeOffWarning').innerHTML),true);
  timeOff = [];
  renderTimeOffWarning();
  ok('removing the leave clears the warning',el('barberTimeOffWarning').hidden,true);

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

  const responses = [], sent = [];
  let proceed = false, prompts = 0;
  const saveReal = new Function('apiPost','asOwner','confirmTimeOffSave','showToast','lockOwnerPages','adminPassword',
    grab('saveToServer')+';return saveToServer;')(
      async payload => {sent.push(payload);return responses.shift();}, x=>x,
      async () => {prompts++;return proceed;},showToast,()=>{},'test-password');
  const proposal={timeOff:[{barber:'Hemen',from:'2026-09-01',to:'2026-09-03'}]};
  const needsReview={status:'error',confirmationRequired:true,conflicts:[{id:7}]};
  responses.push(needsReview);
  ok('Cancel refuses the save',await saveReal(proposal),false);
  ok('Cancel sends no confirmation request',sent.length,1);
  proceed=true; sent.length=0;
  responses.push(needsReview,{...needsReview,conflicts:[{id:7},{id:8}]},{status:'success'});
  ok('Continue saves after reviewing the current conflicts',await saveReal(proposal),true);
  ok('first confirmation names only the reviewed booking',sent[1].confirmedTimeOffBookings,[7]);
  ok('a newly arrived booking is reviewed too',sent[2].confirmedTimeOffBookings,[7,8]);
  ok('each changed conflict list gets its own prompt',prompts,3);
}

main().then(() => {
  console.log(failed === 0 ? '\nAll panel tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});

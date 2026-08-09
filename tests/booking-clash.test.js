// Two customers can want the same slot. The Sheet is the only store, so the
// question is what happens between the moment the page listed a time as free
// and the moment Confirm is pressed - which can be a minute of typing.
//
// Nothing here is optimistic: the browser's list is a snapshot, and only the
// server decides. These checks are about the parts that make that safe and
// then say so clearly.
const fs = require('fs');
const path = require('path');
const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- only one of two simultaneous bookings can win ---');
const addBooking = gs.slice(gs.indexOf("if (!action || action === 'addBooking')"),
                            gs.indexOf("if (action === 'cancelBooking'"));

// Without a lock, two requests can both read "free" and both append. Apps
// Script runs them in separate executions, so this is a real race, not a
// theoretical one.
ok('the write is serialised by a lock', /LockService\.getScriptLock\(\)/.test(addBooking), true);
ok('and it waits rather than failing fast', /waitLock\(/.test(addBooking), true);

// The order matters: checking availability outside the lock would let the
// second request pass its check before the first had written its row.
const lockAt = addBooking.indexOf('waitLock(');
const checkAt = addBooking.indexOf('slotRefusal(');
const appendAt = addBooking.indexOf('sheet.appendRow');
const releaseAt = addBooking.indexOf('lock.releaseLock()');
ok('availability is checked inside the lock', lockAt !== -1 && checkAt > lockAt, true);
ok('and the row written before it is released', appendAt > checkAt && releaseAt > appendAt, true);

console.log('--- the loser is told why, in plain words ---');
const refusal = gs.slice(gs.indexOf('function slotRefusal'));
ok('the message blames the clash, not the customer',
   /Someone else booked that time while you were filling this in/.test(refusal), true);

console.log('--- and is put back where the choice is ---');
// Leaving them on step 3 left a Confirm button that would fail again, with the
// time picker two taps away.
const submit = html.slice(html.indexOf("if (result.status !== 'success')"));
const block = submit.slice(0, submit.indexOf('return;') + 7);
ok('the taken time is cleared', /getElementById\('time'\)\.value = ''/.test(block), true);
ok('they are returned to the time step', /updateWizardUI\(2\)/.test(block), true);
ok('and the day is re-checked against the server',
   /dispatchEvent\(new Event\('change'\)\)/.test(block), true);
ok('the button is usable again', /submitBtn\.disabled = false/.test(block), true);

console.log(failed === 0 ? '\nAll clash tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

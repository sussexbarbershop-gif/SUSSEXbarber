// Two customers can want the same slot. The question is what happens between
// the moment the page listed a time as free and the moment Confirm is pressed,
// which can be a minute of typing.
//
// Nothing here is optimistic: the browser's list is a snapshot, and only the
// server decides. These checks are about the parts that make that safe and
// then say so clearly.
const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- the database refuses the second one, not a lock ---');
// A read followed by a write cannot be made safe by checking harder: two
// requests can both read "free" before either writes. The index decides.
ok('a unique index holds the chair',
   /CREATE UNIQUE INDEX[\s\S]*bookings_one_chair/.test(schema), true);
ok('only for bookings that name a barber',
   /bookings_one_chair[\s\S]*?WHERE status = 'active' AND barber <> ''/.test(schema), true);
ok('and only while they are active',
   /bookings_one_chair[\s\S]*?WHERE status = 'active'/.test(schema), true);

console.log('--- losing that race reads as a clash, not a crash ---');
const addBooking = api.slice(api.indexOf('async function addBooking'),
                             api.indexOf('async function cancelBooking'));
ok('the insert is guarded', /try\s*{[\s\S]*INSERT INTO bookings/.test(addBooking), true);
ok('the index violation is recognised',
   /bookings_one_chair/.test(addBooking), true);
ok('the message blames the clash, not the customer',
   /Someone else booked that time while you were filling this in/.test(addBooking), true);
// Anything else must not be swallowed as a clash: a broken column or a dropped
// connection reported as "someone else booked it" sends the customer round the
// picker forever.
ok('and anything else is rethrown', /throw err;/.test(addBooking), true);

console.log('--- the slot is checked before the write as well ---');
// The index cannot count, so "no preference" bookings are still decided here.
const refusal = api.slice(api.indexOf('async function refuseBooking'),
                          api.indexOf('async function addBooking'));
ok('who holds the slot is read', /FROM bookings/.test(refusal), true);
ok('and handed to the counting rule', /isSlotFree\(/.test(refusal), true);
ok('with the same words on refusal',
   /Someone else booked that time while you were filling this in/.test(refusal), true);

console.log('--- and the loser is put back where the choice is ---');
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

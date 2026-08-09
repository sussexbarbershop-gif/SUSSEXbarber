// The shop is emailed when a booking arrives or is cancelled, so nobody has to
// keep the panel open to find out. The important property is that this can
// never turn a good booking into a failure: the row is already written by the
// time it runs, and an email that will not send must be swallowed.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function grab(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const ANY_BARBER = 'Any Available';

// --- stand-ins for the Apps Script services ---------------------------
let storedEmail = null;
let sent = [];
let logged = [];
let mailThrows = false;

global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: (k) => (k === 'NOTIFY_EMAIL' ? storedEmail : null) })
};
global.MailApp = {
  sendEmail(opts) {
    if (mailThrows) throw new Error('Service invoked too many times');
    sent.push(opts);
  }
};
global.Logger = { log: (m) => logged.push(String(m)) };

// emailCustomerConfirmation() reads the shop's address and phone from the
// config; hand it a fixture rather than a Sheet.
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({}) };
function readConfigCached() {
  return { settings: {
    contact_phone: '+31 6 53730803',
    contact_address: 'Van Hogendorpstraat 10<br>2242 KZ Wassenaar'
  } };
}

eval([grab('notifyOwnerOfBooking'), grab('notifyOwnerOfCancellation'),
      grab('notifyOwner'), grab('emailCustomerConfirmation')].join('\n'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const reset = () => { sent = []; logged = []; mailThrows = false; };

const booking = {
  date: '2026-09-08', time: '11:00 AM', name: 'Ahmed', phone: '0612345678',
  service: 'Skin Fade', barber: 'Hemen', price: 28
};

console.log('--- silent until an address is configured ---');
reset();
storedEmail = null;
notifyOwnerOfBooking(booking);
ok('no address, no email', sent.length, 0);
ok('and nothing logged as an error', logged.length, 0);

console.log('--- a booking ---');
reset();
storedEmail = 'shop@example.com';
notifyOwnerOfBooking(booking);
ok('one email sent', sent.length, 1);
ok('to the configured address', sent[0].to, 'shop@example.com');
ok('the subject carries who and when',
   /Booking: Ahmed .* 2026-09-08 at 11:00 AM/.test(sent[0].subject), true);
['Ahmed', '0612345678', 'Skin Fade', 'Hemen', '2026-09-08', '11:00 AM'].forEach(bit => {
  ok(`the body carries "${bit}"`, sent[0].body.includes(bit), true);
});
ok('and the price', sent[0].body.includes('28'), true);

console.log('--- a cancellation reads differently at a glance ---');
reset();
notifyOwnerOfCancellation(booking);
ok('one email sent', sent.length, 1);
ok('the subject says so up front', sent[0].subject.startsWith('CANCELLED:'), true);
ok('and is not mistakable for a booking', sent[0].subject.startsWith('Booking:'), false);

console.log('--- a booking with no barber preference ---');
reset();
notifyOwnerOfBooking(Object.assign({}, booking, { barber: '' }));
ok('reads as the placeholder, not blank', sent[0].body.includes(ANY_BARBER), true);

console.log('--- mail failing must not break the booking ---');
// The row is already in the sheet by the time this runs. A quota error, a bad
// address, an Apps Script outage - none of it may reach the customer as a
// failed booking.
reset();
mailThrows = true;
let threw = false;
try { notifyOwnerOfBooking(booking); } catch (e) { threw = true; }
ok('the failure is swallowed', threw, false);
ok('and recorded in the log instead', logged.length, 1);

console.log('--- the customer confirmation is optional ---');
// The email field is optional, so most bookings carry no address and must
// send nothing at all rather than failing or mailing an empty recipient.
reset();
emailCustomerConfirmation(Object.assign({}, booking, { email: '' }));
ok('no address, no email', sent.length, 0);
emailCustomerConfirmation(Object.assign({}, booking, { email: '   ' }));
ok('whitespace is not an address', sent.length, 0);
emailCustomerConfirmation(Object.assign({}, booking, {}));
ok('a missing field is not an address', sent.length, 0);

// This is a public endpoint: whatever arrives is checked again here before it
// is handed to MailApp, not just in the browser.
['not-an-email', 'a@b', 'a b@c.com', '@example.com', 'x@.com'].forEach(bad => {
  reset();
  emailCustomerConfirmation(Object.assign({}, booking, { email: bad }));
  ok(`"${bad}" is refused`, sent.length, 0);
});

console.log('--- what the customer is sent ---');
reset();
emailCustomerConfirmation(Object.assign({}, booking, { email: 'ahmed@example.com' }));
ok('one email sent', sent.length, 1);
ok('to the address given', sent[0].to, 'ahmed@example.com');
ok('the subject carries the appointment',
   /Your appointment .* 2026-09-08 at 11:00 AM/.test(sent[0].subject), true);
ok('it greets them by name', sent[0].body.includes('Ahmed'), true);
ok('it names the service', sent[0].body.includes('Skin Fade'), true);
ok('it gives the address', sent[0].body.includes('Van Hogendorpstraat 10'), true);
ok('with the <br> resolved, not printed',
   sent[0].body.includes('<br>'), false);
ok('it says how to cancel', /Already booked\?/.test(sent[0].body), true);
// A cancel link would be a second way in that nothing else checks; cancelling
// is done on the site with the phone number the booking was made under.
ok('and carries no cancel link', /https?:\/\/[^\s]*cancel/i.test(sent[0].body), false);

console.log('--- a bad address must not break a confirmed booking ---');
reset();
mailThrows = true;
threw = false;
try { emailCustomerConfirmation(Object.assign({}, booking, { email: 'ahmed@example.com' })); }
catch (e) { threw = true; }
ok('the failure is swallowed', threw, false);
ok('and recorded in the log instead', logged.length, 1);
mailThrows = false;

console.log('--- the owner is told the address too ---');
reset();
notifyOwnerOfBooking(Object.assign({}, booking, { email: 'ahmed@example.com' }));
ok('the address is in the body', sent[0].body.includes('ahmed@example.com'), true);
reset();
notifyOwnerOfBooking(booking);
ok('and reads as a dash when there is none', /Email:\s+—/.test(sent[0].body), true);

console.log('--- it is called after the row is written, not before ---');
const addBooking = src.slice(src.indexOf("if (!action || action === 'addBooking')"));
const appendAt = addBooking.indexOf('sheet.appendRow');
const notifyAt = addBooking.indexOf('notifyOwnerOfBooking(');
const releaseAt = addBooking.indexOf('lock.releaseLock()');
ok('notify comes after the append', appendAt !== -1 && notifyAt > appendAt, true);
ok('and after the lock is released', releaseAt !== -1 && notifyAt > releaseAt, true);

console.log(failed === 0 ? '\nAll notification tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

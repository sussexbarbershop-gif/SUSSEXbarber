// The shop is emailed when a booking arrives or is cancelled, so nobody has to
// keep the panel open to find out, and the customer is confirmed if they left
// an address. The important property is that this can never turn a good
// booking into a failure: the row is already written by the time it runs, and
// an email that will not send must be swallowed.
//
// The provider is reached over plain HTTPS, so fetch is what gets replaced
// here. Everything above it is the code that runs in production.
const fs = require('fs');
const path = require('path');

const ANY_BARBER = 'Any Available';

let sent = [];
let logged = [];
let mailFails = false;
let mailThrows = false;

global.fetch = async (url, opts) => {
  if (mailThrows) throw new Error('network down');
  sent.push({ url, body: JSON.parse(opts.body) });
  if (mailFails) return { ok: false, status: 401, text: async () => 'refused' };
  return { ok: true, status: 201, text: async () => '{}' };
};

const realError = console.error;
const realWarn = console.warn;
console.error = (...args) => logged.push(args.join(' '));
console.warn = (...args) => logged.push(args.join(' '));

process.env.BREVO_API_KEY = 'test-key';
process.env.MAIL_FROM = 'Sussex Barber Shop <shop@example.com>';

const mail = require(path.join(__dirname, '..', 'api', '_lib', 'mail.js'));

const config = { settings: {
  contact_phone: '+31 6 53730803',
  contact_address: 'Van Hogendorpstraat 10<br>2242 KZ Wassenaar'
} };

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  realError.call(console, (pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const say = msg => realError.call(console, msg);
const reset = () => { sent = []; logged = []; mailFails = false; mailThrows = false; };

// What Brevo was actually handed, in the shape the assertions want to read.
const asMessage = call => ({
  to: call.body.to[0].email,
  subject: call.body.subject,
  body: call.body.textContent,
  from: call.body.sender.email,
  replyTo: call.body.replyTo && call.body.replyTo.email
});

const booking = {
  date: '2026-09-08', time: '11:00', name: 'Ahmed', phone: '0612345678',
  service: 'Skin Fade', barber: 'Hemen', price: 28
};

async function main() {
  say('--- silent until an address is configured ---');
  reset();
  delete process.env.NOTIFY_EMAIL;
  await mail.sendBookingNotice(booking);
  ok('no address, no email', sent.length, 0);
  ok('and nothing logged as an error', logged.length, 0);

  say('--- a booking ---');
  reset();
  process.env.NOTIFY_EMAIL = 'shop@example.com';
  await mail.sendBookingNotice(booking);
  ok('one email sent', sent.length, 1);
  const notice = asMessage(sent[0]);
  ok('to the configured address', notice.to, 'shop@example.com');
  ok('from the verified sender', notice.from, 'shop@example.com');
  ok('the subject carries who and when',
     /Booking: Ahmed .* 2026-09-08 at 11:00/.test(notice.subject), true);
  ['Ahmed', '0612345678', 'Skin Fade', 'Hemen', '2026-09-08', '11:00'].forEach(bit => {
    ok(`the body carries "${bit}"`, notice.body.includes(bit), true);
  });
  ok('and the price', notice.body.includes('28'), true);

  say('--- a cancellation reads differently at a glance ---');
  reset();
  await mail.sendCancellationNotice(booking);
  ok('one email sent', sent.length, 1);
  ok('the subject says so up front', asMessage(sent[0]).subject.startsWith('CANCELLED:'), true);
  ok('and is not mistakable for a booking',
     asMessage(sent[0]).subject.startsWith('Booking:'), false);

  say('--- a booking with no barber preference ---');
  reset();
  await mail.sendBookingNotice(Object.assign({}, booking, { barber: '' }));
  ok('reads as the placeholder, not blank', asMessage(sent[0]).body.includes(ANY_BARBER), true);

  say('--- mail failing must not break the booking ---');
  // The row is already in the database by the time this runs. A quota error, a
  // bad address, a provider outage — none of it may reach the customer as a
  // failed booking.
  reset();
  mailThrows = true;
  let threw = false;
  let result;
  try { result = await mail.sendBookingNotice(booking); } catch (e) { threw = true; }
  ok('the failure is swallowed', threw, false);
  ok('and reported as not sent', result, false);
  ok('and recorded in the log instead', logged.length > 0, true);

  say('--- a refusal from the provider is not a crash either ---');
  reset();
  mailFails = true;
  threw = false;
  try { result = await mail.sendBookingNotice(booking); } catch (e) { threw = true; }
  ok('no throw', threw, false);
  ok('reported as not sent', result, false);
  ok('and the status is logged', logged.join(' ').includes('401'), true);

  say('--- the customer confirmation is optional ---');
  // The email field is optional, so most bookings carry no address and must
  // send nothing at all rather than failing or mailing an empty recipient.
  reset();
  await mail.sendCustomerConfirmation(Object.assign({}, booking, { email: '' }), config);
  ok('no address, no email', sent.length, 0);
  await mail.sendCustomerConfirmation(Object.assign({}, booking, { email: '   ' }), config);
  ok('whitespace is not an address', sent.length, 0);
  await mail.sendCustomerConfirmation(Object.assign({}, booking, {}), config);
  ok('a missing field is not an address', sent.length, 0);

  // This is a public endpoint: whatever arrives is checked again here before it
  // is handed to the provider, not just in the browser.
  for (const bad of ['not-an-email', 'a@b', 'a b@c.com', '@example.com', 'x@.com']) {
    reset();
    await mail.sendCustomerConfirmation(Object.assign({}, booking, { email: bad }), config);
    ok(`"${bad}" is refused`, sent.length, 0);
  }

  say('--- what the customer is sent ---');
  reset();
  await mail.sendCustomerConfirmation(
    Object.assign({}, booking, { email: 'ahmed@example.com' }), config);
  ok('one email sent', sent.length, 1);
  const conf = asMessage(sent[0]);
  ok('to the address given', conf.to, 'ahmed@example.com');
  ok('the subject carries the appointment',
     /Your appointment .* 2026-09-08 at 11:00/.test(conf.subject), true);
  ok('it greets them by name', conf.body.includes('Ahmed'), true);
  ok('it names the service', conf.body.includes('Skin Fade'), true);
  ok('it gives the address', conf.body.includes('Van Hogendorpstraat 10'), true);
  ok('with the <br> resolved, not printed', conf.body.includes('<br>'), false);
  ok('it says how to cancel', /Already booked\?/.test(conf.body), true);
  // A cancel link would be a second way in that nothing else checks; cancelling
  // is done on the site with the phone number the booking was made under.
  ok('and carries no cancel link', /https?:\/\/[^\s]*cancel/i.test(conf.body), false);

  say('--- a bad address must not break a confirmed booking ---');
  reset();
  mailThrows = true;
  threw = false;
  try {
    await mail.sendCustomerConfirmation(
      Object.assign({}, booking, { email: 'ahmed@example.com' }), config);
  } catch (e) { threw = true; }
  ok('the failure is swallowed', threw, false);
  ok('and recorded in the log instead', logged.length > 0, true);

  say('--- the owner is told the address too ---');
  reset();
  await mail.sendBookingNotice(Object.assign({}, booking, { email: 'ahmed@example.com' }));
  ok('the address is in the body', asMessage(sent[0]).body.includes('ahmed@example.com'), true);
  ok('and replying reaches the customer', asMessage(sent[0]).replyTo, 'ahmed@example.com');
  reset();
  await mail.sendBookingNotice(booking);
  ok('and reads as a dash when there is none', /Email:\s+—/.test(asMessage(sent[0]).body), true);

  say('--- nothing is sent when no provider is configured ---');
  reset();
  const key = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  delete process.env.RESEND_API_KEY;
  result = await mail.sendBookingNotice(booking);
  ok('no call made', sent.length, 0);
  ok('reported as not sent', result, false);
  ok('and said so in the log', logged.join(' ').includes('BREVO_API_KEY'), true);
  process.env.BREVO_API_KEY = key;

  say('--- it is called after the row is written, not before ---');
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  const add = api.slice(api.indexOf('async function addBooking'),
                        api.indexOf('/** \'Any Available\''));
  // The row is written by insertBooking(), which works down the shop's order
  // when nobody was asked for. Nothing is emailed until it has come back with
  // a barber — a customer told their appointment is booked, before the row
  // that says so exists, is the one failure that cannot be taken back.
  const writeAt = add.indexOf('await insertBooking(');
  const noticeAt = add.indexOf('sendBookingNotice(');
  ok('the write comes first', writeAt !== -1 && noticeAt > writeAt, true);
  ok('and a refusal sends nothing at all',
     add.indexOf('if (written.error)') < noticeAt, true);
  // allSettled, not all: one address bouncing must not stop the other email.
  ok('and neither email can fail the other', /Promise\.allSettled/.test(add), true);
  // What was recorded, not what was asked for: with no preference the barber
  // is decided at the moment of writing, and the email has to name that one.
  ok('the email quotes the row', /barber: written\.barber/.test(add), true);

  console.error = realError;
  console.warn = realWarn;
  console.log(failed === 0 ? '\nAll notification tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

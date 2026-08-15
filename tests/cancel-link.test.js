// The cancel button in a confirmation email.
//
// The confirmation used to carry no cancel link on purpose, and the reasoning
// was sound as far as it went: a link in an email is a way in that nothing
// else checks. The conclusion was wrong. A customer who cannot say no easily
// does not book elsewhere — they simply do not turn up, and the shop loses the
// whole slot instead of getting it back in time to sell.
//
// So the link exists and is made narrow instead. Two things are being tested:
// that the token can only ever do one thing to one row, and that nothing is
// cancelled without a person pressing a button — because antivirus gateways
// and inbox previewers fetch every URL in an email to see where it goes, and a
// link that cancelled on being opened would cancel appointments nobody clicked.
const path = require('path');

let rows = {};            // id -> booking row
let updated = [];         // ids the UPDATE actually touched

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  if (/UPDATE bookings/.test(sql) && /SET status = 'cancelled'/.test(sql)) {
    const id = values[0];
    const row = rows[id];
    if (!row || row.status !== 'active') return Promise.resolve([]);
    row.status = 'cancelled';
    updated.push(id);
    return Promise.resolve([row]);
  }
  if (/SELECT[\s\S]*FROM bookings WHERE id/.test(sql)) {
    const row = rows[values[0]];
    return Promise.resolve(row ? [row] : []);
  }
  if (/INSERT INTO rate_limit/.test(sql)) return Promise.resolve([{ hits: 1 }]);
  return Promise.resolve([]);
};

const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => fakeSql };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';
process.env.SHOP_TIMEZONE = 'UTC';
process.env.ADMIN_PASSWORD = 'the-panel-password';

const dbPath = require.resolve('../api/_lib/db');
const realDb = require(dbPath);
require.cache[dbPath].exports = Object.assign({}, realDb, {
  readConfig: async () => ({ settings: { contact_phone: '+31 6 00000000' } })
});

let posted = [];
const mailPath = require.resolve('../api/_lib/mail');
const realMail = require(mailPath);
require.cache[mailPath].exports = Object.assign({}, realMail, {
  sendCancellationNotice: async () => { posted.push('shop'); return true; },
  sendCustomerCancellation: async () => { posted.push('customer'); return true; }
});

const auth = require(path.join(__dirname, '..', 'api', '_lib', 'auth.js'));
const api = require(path.join(__dirname, '..', 'api', 'index.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

async function post(body) {
  let answer = null;
  const res = {
    status() { return this; }, setHeader() { return this; },
    send(text) { answer = JSON.parse(text); }
  };
  await api({ method: 'POST', headers: { 'x-real-ip': '1.1.1.1' },
              body: JSON.stringify(body) }, res);
  return answer;
}

const booking = (id, status, date) => ({
  id, status: status || 'active',
  booked_on: date || '2099-09-08', booked_at: '14:30:00',
  service: 'Skin Fade', barber: 'Saan',
  customer_name: 'Ahmed', phone: '0612345678', email: 'a@example.com'
});

const reset = () => { rows = {}; updated = []; posted = []; };

async function main() {
  console.log('--- what a token is, and is not ---');
  const good = auth.cancelToken(41);
  ok('a token names its booking', good.split('.')[0], '41');
  ok('and reads back as it', auth.bookingFromCancelToken(good), 41);

  // The whole point. Editing the id must not produce a working token, or one
  // customer's email cancels another customer's appointment.
  ok('the id cannot be edited',
     auth.bookingFromCancelToken('42.' + good.split('.')[1]), 0);
  ok('nor the signature',
     auth.bookingFromCancelToken('41.' + 'f'.repeat(32)), 0);
  ok('a token with no signature', auth.bookingFromCancelToken('41'), 0);
  ok('an empty one', auth.bookingFromCancelToken(''), 0);
  ok('nothing at all', auth.bookingFromCancelToken(null), 0);
  // '1e3' is 1000 to Number() and would sign as a different row than it reads.
  ok('a number that is not an id', auth.bookingFromCancelToken('1e3.x'), 0);
  ok('and zero is not a booking', auth.bookingFromCancelToken(auth.cancelToken(0)), 0);

  // Changing the panel password invalidates links already sent. That is a fair
  // outcome for a thing that happens once a year, and it must actually happen
  // rather than being assumed.
  process.env.ADMIN_PASSWORD = 'a-new-password';
  ok('an old link stops working when the password changes',
     auth.bookingFromCancelToken(good), 0);
  process.env.ADMIN_PASSWORD = 'the-panel-password';
  ok('and works again when it is put back', auth.bookingFromCancelToken(good), 41);

  console.log('--- looking at what a link points to ---');
  reset();
  rows[41] = booking(41);
  let answer = await post({ action: 'lookupCancel', token: good });
  ok('the booking is described', answer.status, 'success');
  ok('when', [answer.booking.date, answer.booking.time], ['2099-09-08', '14:30']);
  ok('and who with', answer.booking.barber, 'Saan');
  // The token proves somebody has the email. It does not prove they are the
  // customer, and a link forwarded to a colleague must not hand over the
  // number it was sent to.
  ok('but not the phone number', answer.booking.phone, undefined);
  ok('nor the email address', answer.booking.email, undefined);
  // Reading is reading.
  ok('and nothing was cancelled by looking', updated, []);
  ok('nor was anybody emailed', posted, []);

  reset();
  answer = await post({ action: 'lookupCancel', token: '99.' + 'a'.repeat(32) });
  ok('a forged token describes nothing', answer.status, 'error');

  console.log('--- and then cancelling it ---');
  reset();
  rows[41] = booking(41);
  answer = await post({ action: 'cancelByLink', token: good });
  ok('accepted', answer.status, 'success');
  ok('the right row, and only that row', updated, [41]);
  ok('the shop is told', posted.includes('shop'), true);
  ok('and so is the customer', posted.includes('customer'), true);

  console.log('--- pressing it twice ---');
  reset();
  rows[41] = booking(41, 'cancelled');
  posted = [];
  answer = await post({ action: 'cancelByLink', token: good });
  // Not an error: a second click, or a customer who also rang up. Both should
  // be told the same calm thing.
  ok('is not an error', answer.status, 'success');
  ok('and says it is already done', /already cancelled/i.test(answer.message), true);
  ok('nothing is written twice', updated, []);
  ok('and nobody is emailed twice', posted, []);

  console.log('--- somebody else\'s appointment ---');
  reset();
  rows[41] = booking(41);
  rows[42] = booking(42);
  await post({ action: 'cancelByLink', token: auth.cancelToken(42) });
  ok('only theirs goes', updated, [42]);
  ok('and 41 is untouched', rows[41].status, 'active');

  console.log('--- a booking that has already happened ---');
  reset();
  rows[41] = booking(41, 'active', '2000-01-01');
  answer = await post({ action: 'lookupCancel', token: good });
  // The page says so rather than offering a button that does nothing useful.
  ok('is marked as past', answer.booking.past, true);

  console.log('--- the page in front of it ---');
  const fs = require('fs');
  const page = fs.readFileSync(path.join(__dirname, '..', 'cancel.html'), 'utf8');
  ok('there is one', page.length > 0, true);
  // The reason it exists. A link that cancelled on being opened would be
  // triggered by the antivirus gateway that opens every URL in an email.
  ok('it looks the booking up first', /action: 'lookupCancel'/.test(page), true);
  ok('and only cancels from a click',
     /addEventListener\('click'[\s\S]*?action: 'cancelByLink'/.test(page), true);
  ok('never on load',
     /\.then\([\s\S]{0,400}action: 'cancelByLink'/.test(
       page.slice(0, page.indexOf("addEventListener('click'"))), false);
  ok('it asks before doing it', /Cancel this appointment\?/.test(page), true);
  // The address bar holds the token; a referrer header would hand it to any
  // third party this page ever linked to.
  ok('the token is not leaked in a referrer',
     /<meta name="referrer" content="no-referrer">/.test(page), true);
  ok('and the page is not indexed', /noindex/.test(page), true);
  // Two taps on a slow connection.
  ok('the button locks once pressed', /this\.disabled = true/.test(page), true);

  console.log('--- the link that gets there ---');
  ok('the confirmation carries one',
     /cancelToken[\s\S]{0,200}cancel\.html\?b=/.test(
       fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'mail.js'), 'utf8')), true);
  const index = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  ok('and the booking hands one back', /RETURNING id/.test(index), true);
  ok('signed over the row that was written', /cancelToken\(written\.id\)/.test(index), true);
  // The morning of the appointment is when a customer discovers they cannot
  // come, so it is the email where saying so easily is worth the most.
  ok('the reminder carries one too',
     /cancelToken\(row\.id\)/.test(
       fs.readFileSync(path.join(__dirname, '..', 'api', 'daily.js'), 'utf8')), true);

  console.log(failed === 0 ? '\nAll cancel link tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

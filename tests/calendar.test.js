/**
 * Add to Calendar.
 *
 * The button built the file in the browser and handed it over with
 * `window.location.assign('data:text/calendar,…')`. Browsers have refused
 * top-level navigation to a data: URL for years, and refusing it means doing
 * nothing at all — no error, no console line, no download. So the button was
 * dead in silence on every iPhone, which is the only platform that branch
 * ever ran on, for as long as it existed.
 *
 * It is a real URL now. These are the sums that have to be right for the
 * event to land on the correct hour, and the shapes of input that must not
 * reach a calendar file.
 */

const fs = require('fs');
const path = require('path');
const event = require('../api/event.js');

let failed = 0;
function ok(what, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failed++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${what}` +
              (same ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}

/** The handler, with the bits of Vercel's res that it uses. */
function call(query) {
  const res = { headers: {}, code: 200, body: '' };
  event({ query }, {
    status(c) { res.code = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    send(b) { res.body = b; return res; }
  });
  return res;
}

console.log('--- the hour the customer actually booked ---');
// The shop is in Amsterdam and the server is in UTC. Doing this in the
// browser meant doing it in whatever timezone the customer's phone is set to,
// which is the one thing that is not the shop's.
ok('half past two in summer is 12:30 UTC',
   event.shopTimeToUtc('2026-08-20', '14:30').toISOString(), '2026-08-20T12:30:00.000Z');
// The same wall-clock time is an hour further from UTC in winter. A fixed
// offset would put every appointment between November and March an hour out.
ok('and in winter it is 13:30 UTC',
   event.shopTimeToUtc('2026-01-20', '14:30').toISOString(), '2026-01-20T13:30:00.000Z');
// The two mornings a year the clocks move. 02:00 does not exist in spring and
// happens twice in autumn, and a single correction pass can land on the wrong
// side of the boundary.
ok('the morning the clocks go forward',
   event.shopTimeToUtc('2026-03-29', '09:00').toISOString(), '2026-03-29T07:00:00.000Z');
ok('and the morning they go back',
   event.shopTimeToUtc('2026-10-25', '09:00').toISOString(), '2026-10-25T08:00:00.000Z');

console.log('--- a file a calendar will actually open ---');
const good = call({ d: '2026-08-20', t: '14:30', n: '2', s: 'Haircut' });
ok('it answers', good.code, 200);
// Served, not downloaded: iOS opens the Add Event sheet for a calendar file
// it is shown, and an attachment is a download.
ok('as a calendar file', good.headers['content-type'], 'text/calendar; charset=utf-8');
ok('shown rather than handed over', /^inline/.test(good.headers['content-disposition']), true);
// RFC 5545 says CRLF, and iOS is one of the readers that means it.
ok('lines end the way the format requires', good.body.includes('\r\n'), true);
ok('it opens and closes', /^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR$/.test(good.body), true);
ok('the appointment starts when it starts', good.body.includes('DTSTART:20260820T123000Z'), true);
// Two services booked together is an hour, not half of one.
ok('and runs as long as what was booked', good.body.includes('DTEND:20260820T133000Z'), true);
ok('it says where the shop is', /LOCATION:Van Hogendorpstraat 10/.test(good.body), true);
// The reminder the customer would otherwise have to set themselves.
ok('and reminds them an hour before', /TRIGGER:-PT1H/.test(good.body), true);

console.log('--- text that would otherwise break the file ---');
// Commas and semicolons separate fields in this format. A service called
// "Cut, wash & finish" would end the summary early and leave the rest as an
// unknown property, which some calendars refuse the whole file over.
ok('a comma is escaped', event.escape('Cut, wash'), 'Cut\\, wash');
ok('a semicolon too', event.escape('a; b'), 'a\\; b');
ok('and a backslash first, or the escaping escapes itself',
   event.escape('a\\b'), 'a\\\\b');
const messy = call({ d: '2026-08-20', t: '09:00', n: '1', s: 'Cut, wash & finish' });
ok('so the summary survives it whole',
   /SUMMARY:Cut\\, wash & finish at Sussex Barber Shop/.test(messy.body), true);
// The service name is the one free-text field in the query, and it ends up in
// a file. Newlines in it would introduce properties of the attacker's choice.
const injected = call({ d: '2026-08-20', t: '09:00', n: '1', s: 'x\r\nSUMMARY:not this' });
ok('and a line cannot be smuggled into it',
   (injected.body.match(/SUMMARY:/g) || []).length, 1);
ok('the smuggled property is gone, not merely escaped',
   /not this/.test(injected.body) && /SUMMARY:not this/.test(injected.body), false);

console.log('--- what it refuses ---');
[
  ['no date at all', {}],
  ['a date that is not one', { d: 'tomorrow', t: '14:30', n: '1' }],
  ['a time that is not one', { d: '2026-08-20', t: '25:99', n: '1' }],
  ['half a time', { d: '2026-08-20', t: '14', n: '1' }],
  ['no slots', { d: '2026-08-20', t: '14:30', n: '0' }],
  ['a fraction of one', { d: '2026-08-20', t: '14:30', n: '1.5' }],
  // The only thing here worth abusing: a number large enough to make the
  // shop's calendar file describe a booking lasting a year.
  ['more slots than a day has', { d: '2026-08-20', t: '14:30', n: '9999' }]
].forEach(([what, query]) => ok(what + ' is refused', call(query).code, 400));

console.log('--- and the button points at it ---');
const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const runnable = page.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok('nothing navigates to a data: URL any more',
   /location\.assign\('data:text\/calendar/.test(runnable), false);
ok('the calendar button asks the server for the file',
   /window\.location\.assign\(eventUrl\)/.test(page), true);
ok('and sends the shop\'s own date and time, not the device\'s',
   /\/api\/event\?d=' \+ encodeURIComponent\(b\.date\)/.test(page), true);

console.log(failed === 0 ? '\nAll calendar tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

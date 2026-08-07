// Static checks over admin.js for the mistakes that fail quietly in a browser:
// a template reading a field that does not exist renders an empty cell, and an
// onclick naming a function that does not exist only breaks when clicked.
//
// Both were live: the whole Bookings table read b.name/b.phone/b.service/
// b.barber when the objects carry customerName/customerPhone/serviceName/
// barberName, and its buttons called deleteBooking(BK-100) unquoted.
const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

// Comments describe the bugs these checks exist for, so reading them as code
// would report the very mistakes they explain. Only whole-line comments are
// stripped: `accept="image/*"` is not the start of a block comment, and
// treating it as one swallowed a third of the file.
const js = raw.split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// --- the shape fetchLiveBookings() actually produces -------------------
const mapper = js.match(/bookings = data\.map\(\(b, idx\) => \(\{([\s\S]*?)\}\)\)/);
const bookingFields = mapper
  ? [...mapper[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1])
  : [];
console.log('a booking has:', bookingFields.join(', '));
ok('the mapper was found', bookingFields.length > 0, true);

// Anything reading `b.<field>` must name one of those. Only look inside the
// render functions that draw bookings; `b` means a barber elsewhere.
const bookingRenderers = ['renderRecentBookings', 'renderBookings', 'renderDayList',
                          'renderWeeklyPlannerGrid', 'exportBookingsCSV', 'renderDashboard',
                          'renderAnalytics'];
const unknownReads = [];
bookingRenderers.forEach(name => {
  const fn = (js.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm')) || [''])[0];
  [...fn.matchAll(/\bb\.(\w+)/g)].forEach(m => {
    if (!bookingFields.includes(m[1]) && !unknownReads.includes(name + '.' + m[1])) {
      unknownReads.push(name + '.' + m[1]);
    }
  });
});
ok('no render reads a field a booking does not have', unknownReads, []);

// --- every onclick must name a function that exists --------------------
const defined = new Set([...js.matchAll(/^\s*(?:async\s+)?function (\w+)/gm)].map(m => m[1]));
const called = new Set();
[...js.matchAll(/on(?:click|change|submit)="(\w+)\(/g)].forEach(m => called.add(m[1]));
[...html.matchAll(/on(?:click|change|submit)="(\w+)\(/g)].forEach(m => called.add(m[1]));
ok('every handler exists', [...called].filter(f => !defined.has(f)), []);

// --- a booking id in an onclick must be quoted -------------------------
// Booking ids look like "BK-100". `deleteBooking(${b.id})` rendered as
// deleteBooking(BK-100), which is a reference error, so the button did
// nothing at all. Service and gallery ids are numbers and are fine bare.
const unquoted = [...js.matchAll(/on\w+="(\w+)\(\$\{(?:escape\w+\()?b\.id/g)]
  .filter(m => !/on\w+="\w+\('\$\{/.test(m[0]))
  .map(m => m[1]);
ok('no bare booking id in a handler', unquoted, []);

// --- filters the UI offers must be ones the code handles ---------------
const offered = [...html.matchAll(/data-filter="([^"]+)"/g)].map(m => m[1]).sort();
const handled = (js.match(/function renderBookings\(\)[\s\S]*?^}/m) || [''])[0];
const unhandled = offered.filter(f => f !== 'all' && !handled.includes(`'${f}'`));
console.log('booking filters:', offered.join(', '));
ok('every filter tab does something', unhandled, []);

console.log(failed === 0 ? '\nAll wiring tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

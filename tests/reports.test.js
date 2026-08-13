// The Reports page, which is the one thing in the panel the staff are not
// meant to see.
//
// Two properties matter more than the arithmetic. The PIN is checked by the
// server, so the figures are never sent to a browser that has not given it;
// and the PIN is not written down anywhere on the device, because the person
// it is being kept from is holding the device.
const fs = require('fs');
const path = require('path');

const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// --- the PIN, on the server --------------------------------------------
const auth = require(path.join(__dirname, '..', 'api', '_lib', 'auth.js'));

console.log('--- no PIN set, no reports ---');
delete process.env.REPORTS_PIN;
ok('nothing is set', auth.reportsPinIsSet(), false);
// Not "any PIN works" and not a crash: an unset secret refuses everyone,
// the same way an unset ADMIN_PASSWORD does.
ok('and nothing opens it', auth.isPinCorrect({ pin: '' }), false);
ok('nor does a guess', auth.isPinCorrect({ pin: '1234' }), false);

console.log('--- with a PIN set ---');
process.env.REPORTS_PIN = '4821';
ok('it is set', auth.reportsPinIsSet(), true);
ok('the right one opens it', auth.isPinCorrect({ pin: '4821' }), true);
ok('a wrong one does not', auth.isPinCorrect({ pin: '4822' }), false);
ok('nor does a prefix', auth.isPinCorrect({ pin: '482' }), false);
ok('nor a blank', auth.isPinCorrect({ pin: '' }), false);
ok('nor a missing field', auth.isPinCorrect({}), false);
ok('nor no payload at all', auth.isPinCorrect(null), false);
// Compared as digests of equal length, so how long the PIN is cannot be read
// off how long the comparison took.
ok('a longer guess is refused, not thrown at',
   auth.isPinCorrect({ pin: '48210000000' }), false);

console.log('--- the route asks for both secrets ---');
const route = api.slice(api.indexOf("if (action === 'reports')"),
                        api.indexOf("if (action === 'uploadImage')"));
ok('the panel password first', /isAuthorized\(payload\)/.test(route), true);
ok('and the PIN as well', /isPinCorrect\(payload\)/.test(route), true);
// A wrong PIN must cost the same as a wrong password. Four digits is little
// enough to sit and guess at machine speed.
ok('a wrong PIN is slowed down', /throttleFailedLogin\('pin'\)/.test(route), true);
ok('an unset PIN says so rather than failing open',
   /reportsPinIsSet\(\)/.test(route), true);
ok('and nothing is read before all of that',
   route.indexOf('readReports') > route.indexOf('isPinCorrect'), true);

console.log('--- the window a download is taken over ---');
const reportsLib = require(path.join(__dirname, '..', 'api', '_lib', 'reports.js'));

ok('the offer is one, three, six or twelve', reportsLib.WINDOWS, [1, 3, 6, 12]);
// It comes from a dropdown, so anything else is a mistake or a hand-made
// request, and neither should be answered with a refusal or a crash.
[undefined, null, '', 0, -1, 7, 999, 'twelve', {}].forEach(bad => {
  ok(`${JSON.stringify(bad)} falls back to twelve`, reportsLib.windowMonths(bad), 12);
});
ok('a number as a string is understood', reportsLib.windowMonths('3'), 3);

// The window starts at the first of a month, counting the current one, so
// "last 3 months" in August is June, July and August — not the 13th of May.
ok('one month is this month', reportsLib.windowStart('2026-08-13', 1), '2026-08-01');
ok('three months counts this one', reportsLib.windowStart('2026-08-13', 3), '2026-06-01');
ok('six months', reportsLib.windowStart('2026-08-13', 6), '2026-03-01');
ok('twelve months', reportsLib.windowStart('2026-08-13', 12), '2025-09-01');
// January is where month arithmetic usually goes wrong.
ok('three months from January crosses the year',
   reportsLib.windowStart('2026-01-05', 3), '2025-11-01');
ok('twelve months from January',
   reportsLib.windowStart('2026-01-05', 12), '2025-02-01');
// The 31st is the other one: a naive setMonth() rolls it forward a month.
ok('the 31st does not roll the month over',
   reportsLib.windowStart('2026-03-31', 6), '2025-10-01');

console.log('--- and every section knows how to be a file ---');
const sections = [...panel.matchAll(/reportsCard\('(\w+)'/g)].map(m => m[1]);
const declared = (panel.match(/const REPORT_SECTIONS = \{[\s\S]*?\n\};/) || [''])[0];
ok('every card names a section', sections.length > 0, true);
ok('and every one of them is downloadable',
   sections.filter(s => !new RegExp('^\\s{4}' + s + ':', 'm').test(declared)), []);
ok('the summary download exists too', /downloadMenu\('summary'\)/.test(panel), true);
// Sliced out of the twelve months already on screen, three months of takings
// would be right and three months of barber totals would not.
ok('a different window is fetched, not sliced',
   /window\.months !== months[\s\S]{0,400}action: 'reports'[\s\S]{0,80}months/.test(panel), true);

console.log('--- a download over a period must actually change with it ---');
// A card offering one, three, six or twelve months and handing back the same
// file every time is worse than no download: it looks like it worked. Every
// section's rows have to be read out of something the window scopes.
const sectionBlock = name => {
  const at = declared.indexOf('\n    ' + name + ': {');
  return at === -1 ? '' : declared.slice(at, declared.indexOf('\n    },', at));
};
[...new Set(sections)].forEach(name => {
  const block = sectionBlock(name);
  ok(`${name} has a definition`, block !== '', true);
  // d.lifetime.* is the whole history and ignores the window entirely, so a
  // section reading only that would be identical over every period.
  const windowed = /d\.(months|barbers\.window|services|weekdays|hours|loyalty|window)\b/.test(block);
  ok(`${name} reads a windowed figure`, windowed, true);
});

// And where a figure genuinely cannot be cut to a period - the visit counter
// is one running number with no dates behind it - the column has to say so,
// or it gets quoted as the period's.
const reachBlock = sectionBlock('reach');
ok('the all-time columns are labelled', /all time/.test(reachBlock), true);
// Single-row files carry their own dates; a row of bare numbers with no period
// on it is the kind that is read back a month later as this month's.
['reach', 'loyalty', 'summary'].forEach(name => {
  ok(`${name} carries its period`, /'From', 'To'/.test(sectionBlock(name)), true);
});

console.log('--- the figures carry no customer with them ---');
const reports = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'reports.js'), 'utf8');
// The takings are sensitive enough without the customer list travelling with
// them. Counts and sums only; phone_key is counted, never selected.
['customer_name', 'b.phone', 'email'].forEach(column => {
  ok(`no ${column} is selected`, reports.includes('SELECT ' + column), false);
});
ok('phone keys are only ever counted',
   /count\(DISTINCT phone_key\)/.test(reports), true);

console.log('--- the PIN is not stored on the device ---');
// sessionStorage would save the owner typing it after a refresh and hand it
// to anyone who opens the developer tools on the same phone.
const pinLines = panel.split('\n').filter(l => /reportsPin\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));
ok('never written to storage',
   pinLines.some(l => /sessionStorage|localStorage/.test(l)), false);
ok('it is a plain variable', /^let reportsPin = '';$/m.test(panel), true);
ok('signing out clears it', /function handleLogout\(\)[\s\S]*?lockReports\(\)/.test(panel), true);
ok('and locking clears the figures too',
   /function lockReports\(\)[\s\S]*?reportsData = null/.test(panel), true);

console.log('--- and nothing is in the markup to leak ---');
// The page ships the lock, not the numbers.
ok('the section exists', /id="page-reports"/.test(markup), true);
ok('with a PIN form', /id="reportsPinForm"/.test(markup), true);
ok('and an empty place for the figures',
   /<div id="reportsContent"[^>]*><\/div>/.test(markup), true);
ok('the field does not show what is typed',
   /id="reportsPin"[^>]*/.test(markup) &&
   /<input type="password" id="reportsPin"/.test(markup), true);

console.log('--- a refresh lands back on Reports, locked ---');
ok('the page is remembered in the address bar', /function pageFromHash\(\)/.test(panel), true);
ok('and restored on sign-in', /navigateTo\(pageFromHash\(\) \|\| 'today'\)/.test(panel), true);
// With no data in memory, renderReports() must draw the lock, not a blank
// page or a stale copy of the figures.
ok('with no data it shows the lock',
   /if \(!reportsData\) \{[\s\S]*?locked\.style\.display = ''/.test(panel), true);

console.log(failed === 0 ? '\nAll reports tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

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

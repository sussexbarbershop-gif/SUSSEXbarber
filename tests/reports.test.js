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
const css = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.css'), 'utf8');

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

console.log('--- the ten-minute pass ---');
// The PIN is typed once and never kept: keeping it so a refresh would not ask
// again hands the secret to the person it is being kept from, who is holding
// the phone. A signed expiry instead — it cannot be read back into a PIN, it
// cannot be extended, and it stops working on its own.
process.env.ADMIN_PASSWORD = 'panel-password';
{
  const now = Date.UTC(2026, 7, 13, 12, 0, 0);
  const { pass, until } = auth.issueUnlockPass(now);

  ok('it lasts ten minutes', (until - now) / 60000, auth.UNLOCK_MINUTES);
  ok('it opens the lock', auth.unlockPassIsValid(pass, now + 60000), true);
  ok('a second before it runs out', auth.unlockPassIsValid(pass, until - 1), true);
  ok('and not a second after', auth.unlockPassIsValid(pass, until + 1), false);

  // The whole point of signing it: an expiry anyone could write is not a lock.
  const later = String(now + 3600000) + '.' + pass.split('.')[1];
  ok('the expiry cannot be moved', auth.unlockPassIsValid(later, now), false);
  ok('nor the signature invented',
     auth.unlockPassIsValid(String(until) + '.' + 'a'.repeat(64), now), false);
  ok('a pass of the wrong shape is refused', auth.unlockPassIsValid('nonsense', now), false);
  ok('so is an empty one', auth.unlockPassIsValid('', now), false);

  // Signed with the PIN and the password, so changing either one throws away
  // every pass already handed out.
  process.env.REPORTS_PIN = '9999';
  ok('changing the PIN invalidates it', auth.unlockPassIsValid(pass, now), false);
  process.env.REPORTS_PIN = '4821';
  process.env.ADMIN_PASSWORD = 'a-new-password';
  ok('changing the password does too', auth.unlockPassIsValid(pass, now), false);
  process.env.ADMIN_PASSWORD = 'panel-password';
  ok('and it works again once both are back', auth.unlockPassIsValid(pass, now), true);

  // With no PIN configured at all, nothing may open — including a pass that
  // was signed when there was one.
  delete process.env.REPORTS_PIN;
  ok('no PIN set, no pass works', auth.unlockPassIsValid(pass, now), false);
  process.env.REPORTS_PIN = '4821';
}

console.log('--- isOwner takes either ---');
ok('the PIN itself', auth.isOwner({ pin: '4821' }), true);
ok('or a live pass', auth.isOwner({ unlockPass: auth.issueUnlockPass().pass }), true);
ok('a wrong PIN is still wrong', auth.isOwner({ pin: '0000' }), false);
ok('and neither is nothing', auth.isOwner({}), false);
ok('nor no payload', auth.isOwner(null), false);

console.log('--- the owner-only routes ---');
// The takings were behind the PIN; the prices, the hours, the gallery, the
// website's words and the staff were behind the password every barber knows.
// Hiding those pages in the panel would have changed nothing: a hand-written
// request still saved a new price list.
const guard = api.slice(api.indexOf("if (['reports', 'unlock'"),
                        api.indexOf("if (action === 'unlock')"));
['reports', 'unlock', 'saveCMS', 'uploadImage'].forEach(name => {
  ok(`${name} is owner-only`, guard.includes(`'${name}'`), true);
});
ok('the panel password first', /isAuthorized\(payload\)/.test(guard), true);
ok('then the PIN or a pass', /isOwner\(payload\)/.test(guard), true);
// A wrong PIN must cost the same as a wrong password. Four digits is little
// enough to sit and guess at machine speed.
ok('a wrong PIN is slowed down', /throttleFailedLogin\('pin'\)/.test(guard), true);
ok('an unset PIN says so rather than failing open',
   /reportsPinIsSet\(\)/.test(guard), true);
// So the panel puts the keypad back up instead of sending the owner to sign in
// again for a session that has not expired.
ok('a locked answer says which lock it was', /locked: true/.test(guard), true);
ok('and nothing is read before all of that',
   api.indexOf('readReports(db()') > api.indexOf('isOwner(payload)'), true);

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
const sections = [...panel.matchAll(/reports(?:Card|Detail)\('(\w+)'/g)].map(m => m[1]);
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
// What is kept is the signed pass, never the PIN. Storing the PIN would save
// the owner typing it after a refresh and hand it to anyone who opens the
// developer tools on the same phone.
const stores = panel.split(/\r?\n/)
  .filter(l => /sessionStorage\.setItem|localStorage\.setItem/.test(l))
  .filter(l => !/^\s*(\/\/|\*)/.test(l));
console.log('what the panel stores:',
  stores.map(l => (l.match(/setItem\(([^,]+)/) || [])[1]).join(', '));
ok('the PIN is never written anywhere',
   stores.some(l => /\bpin\b/i.test(l) && !/unlockPass/.test(l)), false);
ok('the pass is what is kept', /setItem\(UNLOCK_KEY/.test(panel), true);
ok('and only with its expiry', /JSON\.stringify\(\{ pass: result\.unlockPass, until: result\.until \}\)/.test(panel), true);

console.log('--- and it lets itself go ---');
// A stored expiry that nothing checks is a lock that never closes.
ok('the held pass is checked against the clock',
   /Date\.now\(\) >= held\.until/.test(panel), true);
ok('and thrown away when it has passed',
   /Date\.now\(\) >= held\.until\)[\s\S]{0,120}removeItem\(UNLOCK_KEY\)/.test(panel), true);
ok('signing out clears it', /function handleLogout\(\)[\s\S]*?lockOwnerPages\(\)/.test(panel), true);
ok('and locking clears the figures too',
   /function forgetUnlock\(\)[\s\S]*?reportsData = null/.test(panel), true);
// Otherwise the page it unlocked stays on screen after the ten minutes, and
// the first save is refused with nothing to say the lock had come back.
ok('an expired pass puts the keypad back without being asked',
   /setInterval\([\s\S]{0,320}!isUnlocked\(\)[\s\S]{0,200}lockOwnerPages\(\)/.test(panel), true);

console.log('--- one lock over six pages ---');
ok('the pages are named', /const OWNER_PAGES = \[[^\]]+\]/.test(panel), true);
['services', 'hours', 'gallery', 'cms', 'barbers', 'reports'].forEach(page => {
  const list = (panel.match(/const OWNER_PAGES = \[([^\]]+)\]/) || ['', ''])[1];
  ok(`${page} is behind it`, list.includes(`'${page}'`), true);
});
// The diary is not: that is the work, and everyone who signs in does it.
const list = (panel.match(/const OWNER_PAGES = \[([^\]]+)\]/) || ['', ''])[1];
ok('the diary is not locked', /'bookings'|'week'/.test(list), false);
ok('every owner request carries the pass',
   /const asOwner = payload => Object\.assign\(\{ unlockPass: unlockPass\(\) \}/.test(panel), true);
['saveCMS', 'uploadImage'].forEach(action => {
  const re = new RegExp("asOwner\\([\\s\\S]{0,200}action: '" + action + "'");
  ok(`${action} is signed`, re.test(panel), true);
});

console.log('--- and nothing is in the markup to leak ---');
// The page ships the lock, not the numbers.
ok('the section exists', /id="page-reports"/.test(markup), true);
ok('with a place to type the PIN', /id="ownerPin"/.test(markup), true);
ok('and a button to send it', /id="ownerPinSubmit"/.test(markup), true);
ok('and an empty place for the figures',
   /<div id="reportsContent"[^>]*><\/div>/.test(markup), true);
// It carried style="display:none" from when a sibling card was the lock and
// this was the thing revealed. Once the lock moved out to its own gate nothing
// turned it back on, so the report was written into a hidden div and the page
// was blank with no error anywhere to explain it.
ok('which is not hidden by the markup',
   /<div id="reportsContent"[^>]*display:\s*none/.test(markup), false);

// Anything the panel hides in the markup has to be something it also shows.
const hidden = [...markup.matchAll(/id="([\w-]+)"[^>]*style="[^"]*display:\s*none/g)]
  .map(m => m[1]);
console.log('hidden in the markup:', hidden.join(', ') || '(none)');
hidden.forEach(id => {
  const shows = new RegExp("getElementById\\('" + id + "'\\)[\\s\\S]{0,400}style\\.display");
  ok(`${id} is turned back on somewhere`, shows.test(panel), true);
});
// Masked, but not with type="password". That is what made the browser call
// this a sign-in: it offered to save the PIN over the panel password, and
// offered the panel password back the next time the PIN was asked for. Two
// secrets quietly becoming one is the one thing this lock cannot survive.
const pinField = (markup.match(/<input[^>]*id="ownerPin"[^>]*>/) || [''])[0];
ok('the PIN box is not a password field', /type="password"/.test(pinField), false);
ok('what is typed is still hidden',
   /\.pin-input\s*\{[^}]*text-security:\s*disc/.test(css), true);
ok('and it carries the masking class', /class="[^"]*pin-input/.test(pinField), true);
// A password manager fills on sight and asks questions later.
ok('nothing may fill it before it is touched', /\breadonly\b/.test(pinField), true);
ok('and the managers are asked to leave it alone',
   /data-lpignore|data-1p-ignore/.test(pinField), true);
// A <form> with a password field in it is the shape browsers watch for.
ok('it is not a form', /id="ownerPinForm"/.test(markup), false);

console.log('--- a refresh lands back where it was ---');
ok('the page is remembered in the address bar', /function pageFromHash\(\)/.test(panel), true);
ok('and restored on sign-in', /navigateTo\(pageFromHash\(\) \|\| 'bookings'\)/.test(panel), true);
// Locked, the figures must not be left on screen from before.
ok('a locked Reports draws nothing',
   /if \(!isUnlocked\(\)\) \{[\s\S]{0,140}innerHTML = ''/.test(panel), true);

console.log('--- unlocked on one page, opened on another ---');
// The PIN is one lock over six pages, so it is usually typed somewhere else.
// Arriving at Reports already unlocked drew nothing at all: no keypad, because
// the lock was open, and no figures, because only unlocking *here* had ever
// fetched any.
const drawReports = (panel.match(/function renderReports\(\)[\s\S]*?\n}/) || [''])[0];
ok('an unlocked page with no figures asks for them',
   /if \(!reportsData\)[\s\S]{0,260}refreshReports\(\)/.test(drawReports), true);
ok('and says so while it waits', /Loading/.test(drawReports), true);
// Two navigations before the first answer must not send two requests.
ok('one request at a time', /reportsFetchInFlight/.test(drawReports), true);

console.log('--- a refusal is not left as "Loading…" ---');
const refresh = (panel.match(/async function refreshReports\(\)[\s\S]*?\n}/) || [''])[0];
ok('a refused answer replaces it', /result\.message/.test(refresh), true);
ok('and an unreachable server too', /Could not reach the server/.test(refresh), true);
// An expired pass has to put the keypad back, not sit there refusing.
ok('an expired pass relocks the panel',
   /result\.locked[\s\S]{0,60}lockOwnerPages\(\)/.test(refresh), true);
const save = (panel.match(/async function saveToServer\([\s\S]*?\n}/) || [''])[0];
ok('and so does a refused save', /result\.locked\) lockOwnerPages\(\)/.test(save), true);

// --- and the one check that has to run the thing ------------------------
async function readingIsOneSnapshot() {
  console.log('--- the whole report is read from one snapshot ---');
  // Thirteen separate queries would each see the database as it was when they
  // arrived. A booking taken between the first and the third is counted by one
  // and not the other, and the report says 412 appointments at the top while
  // the barbers underneath add up to 413, with nothing to explain it.
  const counts = { alone: 0, transactions: 0, inTransaction: 0 };
  const row = { done: 0, cancelled: 0, customers: 0, revenue: 0, bookings: 0,
                first_timers: 0, once: 0, returning: 0, average: 0, value: '0',
                barber: 'Hemen', appointments: 0, minutes: 0 };
  // A query object, not a promise: awaiting one would be a trip of its own.
  const sql = () => { counts.alone++; return { built: true }; };
  sql.transaction = queries => {
    counts.transactions++;
    counts.inTransaction += queries.length;
    counts.alone -= queries.length;    // built for the transaction, not sent
    return Promise.resolve(queries.map(() => [row]));
  };

  const out = await reportsLib.readReports(sql, '2026-08-13', 12);
  ok('one transaction', counts.transactions, 1);
  ok('and nothing sent outside it', counts.alone, 0);
  ok('every query is in it', counts.inTransaction > 10, true);
  // The rows still have to be mapped after the transaction hands them back.
  ok('barbers are still shaped', out.barbers.window[0].barber, 'Hemen');
  ok('and so is the window', typeof out.window.cancelled, 'number');
}

readingIsOneSnapshot().then(() => {
  console.log(failed === 0 ? '\nAll reports tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});

// Being signed in, and the state where the panel thinks you are and is wrong.
//
// The panel remembers two things at sign-in: a flag that says to draw the
// panel, and the password every request to the server is signed with. They are
// written together — and were read apart.
//
// The result is the worst kind of broken. The panel appears completely normal,
// because the diary on screen came out of the local cache rather than the
// server. Nothing looks wrong until you press something that actually needs
// the server, and then the answer is "Unauthorized" on a screen you are
// plainly already signed in to.
//
// It surfaced under the owner PIN box, where that word could only be read as
// "wrong PIN" — so the fix is two: do not enter the state, and if the server
// ever refuses the password anyway, say which of the two secrets it means.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- signed in means both halves ---');
const check = (panel.match(/function checkAuth\(\)[\s\S]*?\n\}/) || [''])[0];
ok('there is a check', check !== '', true);
ok('it reads the flag', /sussex_admin_auth/.test(check), true);
// The half that was missing. A flag on its own draws a panel that cannot do
// anything, and every screen in it looks right.
ok('and the password', /sussex_admin_pw/.test(check), true);
ok('and wants both before showing the panel',
   /flagged && password/.test(check), true);
// Leaving the flag behind means the same thing happens again on reload, which
// is how a bug like this survives being reported.
ok('a half session is cleared rather than left',
   /removeItem\('sussex_admin_auth'\)/.test(check), true);
ok('and it says so in the log', /console\.warn/.test(check), true);

// They are written together, which is what makes reading them apart a bug
// rather than a design.
const login = (panel.match(/sessionStorage\.setItem\('sussex_admin_auth'[\s\S]{0,200}/) || [''])[0];
ok('sign-in writes both', /sussex_admin_pw/.test(login), true);
// And signing out clears both, or the next visit is the same broken state.
const out = (panel.match(/function handleLogout\(\)[\s\S]*?\n\}/) ||
             panel.match(/removeItem\('sussex_admin_auth'\)[\s\S]{0,200}/) || [''])[0];
ok('signing out clears both', /sussex_admin_pw/.test(out), true);

console.log('--- and what the owner gate says when it happens anyway ---');
// A password can stop being accepted while a tab is open: changed in Vercel,
// or a session that outlived a deploy. The gate has to name the right secret.
const gate = (panel.match(/action: 'unlock'[\s\S]*?\n        \}/) || [''])[0];
ok('the unlock knows the two refusals apart',
   /unauthorized/i.test(gate), true);
ok('and does not call one the other',
   /sign in again/i.test(gate), true);
// Retyping the PIN cannot fix a password problem, so the box should not be
// waiting for another attempt at it.
ok('nor invite another go at the PIN',
   /if \(!stale\) field\.focus\(\);/.test(gate), true);

console.log('--- which is the message the server actually sends ---');
// The two branches of the owner gate, in the order they are checked. If these
// ever say the same thing, the panel above cannot tell them apart.
const owner = (api.match(/if \(\['reports', 'unlock'[\s\S]*?\n  \}/) || [''])[0];
ok('the password is refused as Unauthorized',
   /message: 'Unauthorized'/.test(owner), true);
ok('and the PIN is refused as something else',
   /That PIN is not right/.test(owner), true);
ok('the password is checked first',
   owner.indexOf('Unauthorized') < owner.indexOf('That PIN is not right'), true);
// A missing REPORTS_PIN is a third thing again, and naming it is the only way
// the owner ever finds out it was never set.
ok('and a PIN that was never configured says so',
   /No REPORTS_PIN set/.test(owner), true);

console.log(failed === 0 ? '\nAll session tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

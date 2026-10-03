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


// Run the real login handler: mobile capitalization must reach authentication,
// while a password with changed case or surrounding spaces must still fail.
async function checkLoginCase() {
  const vm = require('vm');
  const { isAuthorized } = require('../api/_lib/auth');
  const source = panel.match(/async function handleLogin\(e\)[\s\S]*?\n\}/)[0];
  const configured = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'Case-Sensitive-Test!';
  try {
    for (const [username, password, allowed, requests] of [
      ['admin', 'Case-Sensitive-Test!', true, 1],
      ['Admin', 'Case-Sensitive-Test!', true, 1],
      ['ADMIN', 'Case-Sensitive-Test!', true, 1],
      ['  aDmIn  ', 'Case-Sensitive-Test!', true, 1],
      ['administrator', 'Case-Sensitive-Test!', false, 0],
      ['', 'Case-Sensitive-Test!', false, 0],
      ['Admin', 'case-sensitive-test!', false, 1],
      ['ADMIN', ' Case-Sensitive-Test! ', false, 1]
    ]) {
      let shown = false;
      const sent = [], stored = new Map();
      const fields = {loginUsername:{value:username}, loginPassword:{value:password},loginError:{style:{},textContent:''}};
      const button = {textContent:'Sign in',disabled:false};
      const context = {ADMIN_USERNAME:'admin',adminPassword:'',console,
        document:{getElementById:id=>fields[id]},
        sessionStorage:{setItem:(k,v)=>stored.set(k,v)},
        showAdmin:()=>{shown=true;},showToast:()=>{},
        apiPost:async payload=>{sent.push(payload);return {status:isAuthorized(payload)?'success':'error'};}};
      vm.createContext(context);
      vm.runInContext(source,context);
      await context.handleLogin({preventDefault(){},target:{querySelector:()=>button}});
      ok('login case '+JSON.stringify(username)+' / password preserved '+JSON.stringify(password), shown, allowed);
      ok('request count for '+JSON.stringify(username), sent.length, requests);
      if (requests) ok('password reaches server byte-for-byte',sent[0].password,password);
      ok('only successful login creates session',stored.has('sussex_admin_pw'),allowed);
      ok('submit button restored',button.disabled,false);
    }
  } finally {
    if (configured === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = configured;
  }
}
checkLoginCase().then(() => {
  console.log(failed === 0 ? '\nAll session tests passed.' : '\n'+failed+' FAILED');
  process.exit(failed === 0 ? 0 : 1);
}).catch(error => { console.error(error); process.exit(1); });

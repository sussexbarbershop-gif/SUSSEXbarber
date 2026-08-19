/**
 * Taking a fix to somebody who already has the page open.
 *
 * Everything is served with max-age=0, must-revalidate, so a reload always
 * gets the new code. The difficulty was never the cache — it is that nobody
 * reloads. An installed app is opened from the home screen, used, and put
 * away; iOS brings it back from memory. A customer can be running a copy from
 * three weeks ago with nothing on screen to suggest it, which is how a fixed
 * bug goes on being reported.
 *
 * So the page watches the deploy underneath it and fetches itself again when
 * it changes. The whole risk is in *when*: a reload at the wrong moment
 * empties a half-filled booking form in front of a customer who will not
 * understand why and will not start again. This is that guard, run against
 * every shape of "somebody is part-way through" there is.
 *
 * The code is lifted out of index.html rather than copied here, so a change
 * to the page is a change to what this tests.
 */

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(what, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failed++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${what}` +
              (same ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// The page's own code, lifted whole.
// ---------------------------------------------------------------------------

const start = page.indexOf("let releaseWhenLoaded = '';");
const stop = page.indexOf('// Coming back to the app');
ok('the release check is where this expects it', start > 0 && stop > start, true);
const source = page.slice(start, stop);

/**
 * Just enough DOM for it: a form, four steps, and fields.
 *
 * Written out rather than pulled in, because what is being tested is a
 * decision about three booleans and the cost of a real DOM here would be a
 * dependency for the whole suite.
 */
function makeDom({ step, typed }) {
  const field = (type, value) => ({ type, value });
  const fields = [field('text', typed ? 'Ahmad' : ''),
                  field('tel', ''),
                  // Always has a value, and must never count as typing.
                  field('hidden', 'nl')];
  const steps = {};
  [1, 2, 3, 4].forEach(n => {
    steps['bookingStep' + n] = {
      classList: { contains: c => c === 'hidden' && n !== step }
    };
  });
  const form = { querySelectorAll: () => fields };
  return {
    getElementById: id => (id === 'bookingForm' ? form : steps[id] || null)
  };
}

/** The lifted code, with a document of our choosing and no real navigation. */
function load(dom) {
  const win = { location: { pathname: '/', search: '' }, went: null };
  win.location.replace = to => { win.went = to; };
  const build = new Function('document', 'window', 'console',
    source + '\n return { noteRelease, bookingInProgress, reloadIfStale };');
  return { api: build(dom, win, { log() {} }), win };
}

function decide({ from, to, step, typed }) {
  const dom = makeDom({ step: step || 1, typed: Boolean(typed) });
  const { api, win } = load(dom);
  if (from) api.noteRelease({ release: from });
  if (to) api.noteRelease({ release: to });
  api.reloadIfStale();
  return win.went ? 'reloads' : 'stays put';
}

console.log('--- when it must not touch the page ---');
// The one that matters. Everything typed would go, and the customer would be
// looking at an empty form with no idea why. Ten more minutes on an old copy
// costs nothing; a lost half-filled booking is a lost booking.
ok('a name has been typed', decide({ from: 'aaa1111', to: 'bbb2222', typed: true }), 'stays put');
ok('they are choosing a time', decide({ from: 'aaa1111', to: 'bbb2222', step: 2 }), 'stays put');
ok('they are filling in their details', decide({ from: 'aaa1111', to: 'bbb2222', step: 3 }), 'stays put');
ok('they are looking at the confirmation', decide({ from: 'aaa1111', to: 'bbb2222', step: 4 }), 'stays put');

console.log('--- and when there is nothing to reload for ---');
ok('the deploy has not changed', decide({ from: 'aaa1111', to: 'aaa1111' }), 'stays put');
// Anywhere that is not a Vercel deployment sends nothing. Treating that as a
// change would have every local run telling every page it was out of date.
ok('the server has no opinion', decide({}), 'stays put');
ok('and one that has only ever answered once', decide({ from: 'aaa1111' }), 'stays put');

console.log('--- when it should ---');
ok('a new deploy and an untouched form',
   decide({ from: 'aaa1111', to: 'bbb2222' }), 'reloads');
// A hidden input always has a value. Counting it would mean the guard was
// permanently on and nothing would ever refresh — the failure that looks
// exactly like everything working.
ok('a hidden field is not somebody typing',
   decide({ from: 'aaa1111', to: 'bbb2222', typed: false }), 'reloads');

console.log('--- how it is wired ---');
// The moment a page redrawing itself is invisible: it looks like the app
// opening, because that is what it is.
ok('the check runs when the app comes back to the front',
   /visibilitychange[\s\S]{0,200}fetchCMS\(\)\.then\(reloadIfStale\)/.test(page), true);
// replace(), not reload(): reloading a page that arrived by POST asks the
// browser to send it again, and the back button should not walk through two
// copies of the same page.
ok('and replaces rather than reloads', /window\.location\.replace\(/.test(page), true);

console.log('--- the server has to say which deploy it is ---');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
ok('the config carries a release', /config\.release = RELEASE;/.test(api), true);
ok('taken from the commit Vercel built',
   /VERCEL_GIT_COMMIT_SHA/.test(api), true);
// BACKEND_VERSION answers a different question — has the protocol changed —
// and stays at 12-neon across a hundred fixes, so it cannot do this job.
ok('and not from the hand-bumped protocol version',
   /config\.release = BACKEND_VERSION/.test(api), false);

console.log('--- the panel too, which is open all day ---');
const panel = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
ok('it watches the same thing', /function reloadIfStale\(\)/.test(panel), true);
ok('and comes back to it on the way in',
   /visibilitychange[\s\S]{0,200}reloadIfStale/.test(panel), true);
// The icon editor is the one place holding something the server has not got.
ok('but never over an unsaved icon', /iconDirty\) return;/.test(panel), true);
ok('nor over an open dialog', /modal-overlay\.active/.test(panel), true);

console.log(failed === 0 ? '\nAll release tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// Two public endpoints that write, and what stops them being abused or losing
// something.
//
// The visit counter was a GET whose whole job was to increment a number, so a
// loop could put it into the millions in an afternoon — and the "visits that
// booked" figure on the reports with it.
//
// The settings table kept every key the panel had ever sent, read by nothing.
// Clearing them out is easy; clearing them out *safely* is the part that
// needed thinking about, because a save built from a config that never loaded
// looks exactly like a save that means to delete everything.
const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
const site = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// --- the visit counter ---------------------------------------------------
console.log('--- counting a visit is not a thing to be held down ---');
const get = api.slice(api.indexOf('async function handleGet'),
                      api.indexOf('async function handlePost'));
const post = api.slice(api.indexOf('async function handlePost'));

ok('a GET no longer counts anything', /trackVisit/.test(get), false);
ok('a POST does', /action === 'trackVisit'/.test(post), true);

const counter = post.slice(post.indexOf("action === 'trackVisit'"),
                           post.indexOf("action === 'myBookings'"));
ok('and only from our own pages', /isOwnOrigin\(req\)/.test(counter), true);
// Refusing loudly would tell a script it had been noticed, and the visitor
// does not care either way. It answers success and counts nothing.
ok('an outside call is answered, not counted',
   /visits: null/.test(counter), true);
ok('nothing is written before that check',
   counter.indexOf('isOwnOrigin') < counter.indexOf('INSERT INTO settings'), true);

console.log('--- what counts as our own page ---');
const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => () => Promise.resolve([]) };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';
const handler = require(path.join(__dirname, '..', 'api', 'index.js'));
const isOwnOrigin = handler.isOwnOrigin;

ok('the shop\'s own domain',
   isOwnOrigin({ headers: { origin: 'https://sussexbarber.nl' } }), true);
ok('with www', isOwnOrigin({ headers: { origin: 'https://www.sussexbarber.nl' } }), true);
ok('the vercel address',
   isOwnOrigin({ headers: { origin: 'https://sussexbarber.vercel.app' } }), true);
ok('a preview deployment',
   isOwnOrigin({ headers: { origin: 'https://sussexbarber-abc123.vercel.app' } }), true);
ok('a referer rather than an origin',
   isOwnOrigin({ headers: { referer: 'https://sussexbarber.nl/index.html' } }), true);

ok('somebody else\'s site',
   isOwnOrigin({ headers: { origin: 'https://example.com' } }), false);
// The one that catches a lazy check: a domain that merely ends with ours.
ok('a lookalike domain',
   isOwnOrigin({ headers: { origin: 'https://notsussexbarber.nl' } }), false);
ok('and one that merely contains it',
   isOwnOrigin({ headers: { origin: 'https://sussexbarber.nl.example.com' } }), false);
ok('no header at all', isOwnOrigin({ headers: {} }), false);
ok('nonsense in the header', isOwnOrigin({ headers: { origin: 'not a url' } }), false);
ok('no headers object', isOwnOrigin({}), false);
ok('no request', isOwnOrigin(null), false);

console.log('--- and the browser sends it that way ---');
ok('the site posts its visit', /action: 'trackVisit'/.test(site), true);
ok('and no longer gets it', /action=trackVisit/.test(site), false);
// One visitor reading the prices, the gallery and the map is one visit.
ok('once per session', /sussex_visit_counted/.test(site), true);

// --- settings that outlive their use -------------------------------------
console.log('--- clearing out a key nothing sends any more ---');
const save = api.slice(api.indexOf('async function saveCMS'));
ok('a complete save prunes the rest', /DELETE FROM settings/.test(save), true);
ok('but only when it is complete',
   /SITE_SETTINGS\.every\(key => keys\.includes\(key\)\)/.test(save), true);
ok('and the counter is never pruned', /KEPT_SETTINGS/.test(save), true);

// The guard is the whole point: the panel builds its save from the config it
// loaded, so a save missing the site's own fields is one built from nothing.
// Deleting everything absent from that would wipe the shop.
const listed = (api.match(/const SITE_SETTINGS = \[([\s\S]*?)\];/) || ['', ''])[1];
const readBySite = [...site.matchAll(/settings\.(\w+)/g)].map(m => m[1]);
const missing = [...new Set(readBySite)]
  .filter(key => key !== 'contact_phone' && !listed.includes(`'${key}'`));
console.log('the site reads:', [...new Set(readBySite)].join(', '));
ok('every setting the site reads is one the guard checks for', missing, []);

const kept = (api.match(/const KEPT_SETTINGS = \[([^\]]*)\]/) || ['', ''])[1];
ok('the visit count is kept', /visit_count/.test(kept), true);
// barber_priority is sent by the panel, so it does not need keeping — but if
// that ever changes, this is where it would have to be added.
ok('and the panel sends the priority order',
   /barber_priority/.test(fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8')), true);

console.log(failed === 0 ? '\nAll settings hygiene tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

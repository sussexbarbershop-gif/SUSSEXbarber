/**
 * The screen an iPhone shows while the app opens.
 *
 * Android had one from the day the manifest did: Chrome reads background_color
 * and the 512 icon and draws it. iOS reads neither, and until now an iPhone
 * shortcut opened in Safari with the address bar still there — no app, no
 * launch screen, nothing to show.
 *
 * Two halves have to agree for this to work, and neither of them fails loudly:
 * a <link> whose media query is one pixel out is simply never matched, and a
 * size the route does not know is a 404 nobody sees. So both halves are
 * generated from the same list in api/splash.js, and this checks the page
 * against it rather than against a copy written out here.
 */

const fs = require('fs');
const path = require('path');
const splash = require('../api/splash.js');

let failed = 0;
function ok(what, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failed++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${what}` +
              (same ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('--- the app opens as an app ---');
// Without this an iPhone shortcut opens a Safari window with an address bar,
// and a launch screen is never shown however many are declared.
ok('iOS is told it may run standalone',
   /<meta name="apple-mobile-web-app-capable" content="yes">/.test(page), true);
// The same thing under its standard name, which is what Chrome now reads.
ok('and so is everything else',
   /<meta name="mobile-web-app-capable" content="yes">/.test(page), true);
// iOS takes the home-screen label from here rather than from the manifest.
ok('the label under the icon is set',
   /<meta name="apple-mobile-web-app-title" content="[^"]+">/.test(page), true);
ok('and the status bar is drawn for a dark page',
   /apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(page), true);

console.log('--- one launch screen per iPhone, to the pixel ---');
const links = [...page.matchAll(/<link rel="apple-touch-startup-image"[^>]*>/g)].map(m => m[0]);
ok('there is one for every screen the route draws',
   links.length, splash.SCREENS.length);

// Generated from the route's own list, so a screen added there and forgotten
// here is a failure rather than a phone that quietly gets nothing.
const missing = splash.SCREENS.filter(s => !page.includes(splash.linkFor(s)))
                              .map(s => s.phones);
ok('and every one of them is exactly right', missing, []);

// The other direction: a link asking for a size the route refuses is a launch
// that fetches a 404 and shows nothing.
const asked = links.map(l => (l.match(/w=(\d+)&amp;h=(\d+)/) || []).slice(1).map(Number));
const unknown = asked.filter(([w, h]) => !splash.SCREENS.some(s => s.w === w && s.h === h));
ok('and no link asks for a size that is not drawn', unknown, []);

console.log('--- the sizes are real device sizes ---');
// A launch screen is matched on CSS pixels and drawn in device pixels, and
// getting the two the wrong way round produces a picture that never matches.
const wrong = splash.SCREENS.filter(s => s.w !== s.css[0] * s.dpr || s.h !== s.css[1] * s.dpr);
ok('device pixels are CSS pixels times the ratio', wrong, []);
ok('all of them are portrait',
   splash.SCREENS.every(s => s.h > s.w), true);
// Two entries for one screen means one of them can never match.
const seen = splash.SCREENS.map(s => `${s.css[0]}x${s.css[1]}@${s.dpr}`);
ok('no screen is listed twice', seen.length, new Set(seen).size);

console.log('--- what the route will and will not draw ---');
const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'splash.js'), 'utf8');
// Anything the query string asks for would be an invitation to render
// arbitrarily large images on the shop's account.
ok('sizes are a whitelist, not a request',
   /const allowed = \(w, h\) => SCREENS\.some/.test(source), true);
ok('and anything else is refused', /res\.status\(404\)/.test(source), true);
// The icon changes; these must change with it rather than being cut once.
ok('it draws from the saved icon', /icon_512/.test(source), true);
ok('and is not cached for so long that a new icon is not seen',
   /max-age=600/.test(source), true);
// A launch screen that throws is an app that will not open. Charcoal is the
// colour it was going to open onto anyway.
ok('a failure still returns a picture',
   /catch \(err\)[\s\S]{0,400}return res\.send\(await plain/.test(source), true);

console.log(failed === 0 ? '\nAll iOS launch screen tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

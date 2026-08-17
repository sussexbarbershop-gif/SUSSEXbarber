// The site on a phone, which is the site.
//
// Nine bookings in ten are made on one. Everything here was found by measuring
// the live page at 375px rather than by reading it, and every one of them is
// invisible on a desktop — which is where it was being looked at.
//
// Thirteen things were under forty-four pixels: the menu button at forty, every
// link inside the menu at thirty-two, Book Now at thirty-two, the phone number
// at twenty-eight, the two footer links at twenty. All of them were hit
// eventually. "Eventually" is what it costs.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- what the viewport tag has to say ---');
const viewport = (html.match(/<meta name="viewport" content="([^"]*)"/) || ['', ''])[1];
ok('it is set', viewport.length > 0, true);
// Without this, env(safe-area-inset-*) resolves to zero on an iPhone and every
// safe-area rule below it silently does nothing.
ok('viewport-fit=cover, or the safe areas are all zero',
   /viewport-fit=cover/.test(viewport), true);
// A customer squinting at a price is entitled to zoom in on it.
ok('and zooming is not disabled', /user-scalable=no|maximum-scale=1/.test(viewport), false);

console.log('--- the three hundred milliseconds before a tap counts ---');
// A browser waits to see whether a tap becomes a double-tap zoom. On a booking
// form that is the difference between a control that answers and one that
// hesitates.
ok('touch-action is declared', /touch-action:\s*manipulation/.test(style), true);
['button', 'input', 'select', 'textarea'].forEach(tag => {
  const rule = (style.match(/([^{}]*)\{\s*touch-action:\s*manipulation/) || ['', ''])[1];
  ok(`${tag} is covered`, rule.includes(tag), true);
});

console.log('--- a finger gets no hover ---');
// Without a press state a tap has no feedback at all until the screen changes,
// and on a slow connection that is a long way from instant.
ok('there is a press state', /:active\s*\{[^}]*transform:\s*scale/.test(style), true);
// Only where a finger is the input: a mouse has hover already and does not
// need the button shrinking under it.
const pressBlock = (style.match(/@media \(hover: none\)\s*\{[\s\S]*?\n        \}/g) || []).join('');
ok('and it is inside a (hover: none) query', /:active/.test(pressBlock), true);
// Small enough to feel and not to see. A big scale reads as the page flexing.
const scale = Number((style.match(/:active[^}]*transform:\s*scale\(([\d.]+)\)/) || [])[1]);
ok('the scale is subtle', scale >= 0.94 && scale < 1, true);

console.log('--- one vocabulary for movement ---');
// There were eight different duration-and-easing pairs on the page, each one
// whatever was typed at the time. The difference between them is what makes an
// interface feel assembled rather than designed.
ok('an easing is named once', /--ease:/.test(style), true);
ok('a press duration', /--press:/.test(style), true);
ok('and a travel duration', /--move:/.test(style), true);
// A finger going down has to feel instant; anything over about 150ms does not.
const press = Number((style.match(/--press:\s*(\d+)ms/) || [])[1]);
ok('the press is instant', press > 0 && press <= 150, true);

console.log('--- the home indicator on an iPhone ---');
// Anything pinned to the bottom of the screen sits underneath it: a sheet's
// last row, a close button, the bottom of a menu.
ok('safe-area is used', /env\(safe-area-inset-bottom\)/.test(style), true);
// max(), not the bare inset: on a phone without an indicator the inset is zero
// and the sheet's last row would sit flush against the edge.
ok('with a floor under it', /max\([^)]*env\(safe-area-inset-bottom\)/.test(style), true);
// And applied to something, not merely declared.
ok('and applied to the sheets', (html.match(/class="[^"]*safe-bottom/g) || []).length >= 2, true);

console.log('--- a sheet that has been scrolled to its end ---');
// Otherwise the scroll passes through to the page, which then moves behind the
// sheet that is still open on top of it.
ok('overscroll is contained', /overscroll-behavior:\s*contain/.test(style), true);
ok('and the sheets use it', (html.match(/class="[^"]*sheet-scroll/g) || []).length >= 2, true);

console.log('--- forty-four pixels ---');
// The width of the pad of an adult thumb, and the number both Apple and Google
// publish. Height and padding, never font size: making the text bigger to
// reach the target would redesign the page to fix a touch problem.
const phone = (style.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n        \}/) || ['', ''])[1];
ok('there is a phone-sized block', phone.length > 0, true);
['.mobile-link', '#mobileMenuBtn', '.tap-44'].forEach(sel => {
  ok(`${sel} is sized for a thumb`, phone.includes(sel), true);
});
ok('at 44px', (phone.match(/min-(height|width):\s*44px/g) || []).length >= 3, true);
// The ones that were measured short and had to be given the class.
['Book Now', 'Privacy Policy', 'Terms of Service'].forEach(label => {
  const tag = (html.match(new RegExp('<a[^>]*>' + label + '<')) ||
               html.match(new RegExp('<a[^>]*data-translate="' + label + '"[^>]*>')) || [''])[0];
  ok(`${label} is a thumb-sized target`, /tap-44/.test(tag), true);
});

console.log('--- and none of it for somebody who asked it to stop ---');
const reduced = (style.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n        \}/g) || []).join('');
ok('reduced motion is honoured', reduced.length > 0, true);
// The press fires more often than anything else on the page, so it is the one
// that matters most to turn off — and the one easiest to forget.
ok('including the press state', /:active[^}]*transform:\s*none/.test(reduced), true);
ok('and the durations go to nothing', /--press:\s*0/.test(reduced), true);

console.log(failed === 0 ? '\nAll touch tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

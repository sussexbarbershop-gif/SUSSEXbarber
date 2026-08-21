// Guards the "make it read like an app, not a decorated web page" pass:
// the 3-item theme dropdown, the clouds and plane over the map, and emoji
// standing in for icons across both the site and the panel.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'admin', 'admin.css'), 'utf8');
// Rules only. A comment explaining what a selector used to be is not that
// selector, and a test that cannot tell the difference punishes the comment.
const adminCssRules = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- no theme switcher at all: the device decides ---');
// This went from a 3-item Light/Dark/System menu, to one toggle button, to
// nothing. The phone already has the setting, and a second one on the page can
// only disagree with it.
ok('no themeDropdown left', site.includes('id="themeDropdown"'), false);
ok('no Light/Dark/System option buttons', site.includes('data-theme-value'), false);
ok('no toggle button either', site.includes('id="themeToggleBtn"'), false);
// The whole point: no stored preference, and no class being put on <html>.
ok('nothing remembers a theme', /localStorage\.[gs]etItem\(\s*['"]theme['"]/.test(site), false);
ok('no dark class toggled onto <html>',
   /documentElement\.classList\.(toggle|add|remove)\(\s*['"]dark['"]/.test(site), false);

const config = fs.readFileSync(path.join(root, 'tailwind.config.js'), 'utf8');
ok('tailwind follows the device', /darkMode:\s*['"]media['"]/.test(config), true);
// The compiled sheet is what the browser reads. If darkMode changed but nobody
// rebuilt, every dark: utility silently stops working.
const builtCss = fs.readFileSync(path.join(root, 'assets', 'tailwind.css'), 'utf8');
ok('and the built sheet was rebuilt for it', builtCss.includes('prefers-color-scheme'), true);
ok('with no class-based dark rules left', /\.dark\s/.test(builtCss), false);

// The site's own <style> block has to follow the same rule, or the page
// background disagrees with everything Tailwind paints on top of it.
const styleBlock = (site.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
ok('the style block uses the query too',
   styleBlock.includes('prefers-color-scheme'), true);
ok('and has no .dark selectors', /\.dark\s|:not\(\.dark\)/.test(styleBlock), false);

console.log('--- the map is a map ---');
ok('no drifting clouds', site.includes('animate-drift-cloud'), false);
ok('no flying plane', site.includes('animate-fly-plane'), false);

console.log('--- the mobile action bar (superseded by the header CTAs) ---');
ok('removed from the site', site.includes('id="mobileActionBar"'), false);

console.log('--- the panel: English and Dutch only ---');
// Kurdish was dropped from the panel. The option, its dictionary and any
// Kurdish characters all have to go together: leaving the dictionary behind
// would keep a language nobody can select, and leaving the option behind would
// select a language with no dictionary.
ok('no Kurdish option', /value="ku"/.test(adminHtml), false);
ok('no Kurdish dictionary', /^\s*ku:\s*\{/m.test(adminJs), false);
ok('no Kurdish text anywhere in the panel',
   /[؀-ۿ]/.test(adminHtml + adminJs), false);
// A stored 'ku' outlives the option, so the loader has to fall back or the
// panel comes up with its dropdown and its storage disagreeing.
ok('an unknown stored language falls back',
   /if\s*\(!ADMIN_I18N\[savedLang\]\)/.test(adminJs), true);

console.log('--- the panel follows the device too ---');
ok('no theme button', adminHtml.includes('btnThemeToggle'), false);
ok('no toggle function', adminJs.includes('toggleAdminTheme'), false);
ok('nothing remembers a panel theme', adminJs.includes('sussex_admin_theme'), false);
ok('no admin-light-mode class left', /body\.admin-light-mode/.test(adminCssRules), false);
ok('the panel css uses the query', adminCssRules.includes('prefers-color-scheme'), true);

// A colour written as a literal cannot follow the theme. The login background
// was a hardcoded gradient, so signing in on a light device gave a white card
// on a black page - the card read a variable and the page behind it did not.
const darkLiteral = /#(0[0-9a-f]|1[0-9a-f]|2[0-9a-f])[0-9a-f]{4}\b/i;
const offendingLines = adminCssRules.split('\n')
  .filter(l => darkLiteral.test(l) && !/^\s*--/.test(l));
ok('no dark colour hardcoded outside the variables', offendingLines, []);

// var(--typo, fallback) is silent: the name does not exist, the fallback wins,
// and it wins in both themes. --border and --card were never declared, so the
// Today cards kept dark borders on a light page.
// Digits count. The motion tokens are named --m3-long-2 after the standard
// they come from, and a class of [a-z-] reads that as "--m" — which is neither
// declared nor referenced, so the check reported a variable that does not
// exist and missed every one that does.
const declared = new Set([...adminCss.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));
const referenced = [...adminCssRules.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]);
ok('every variable used is one that exists',
   [...new Set(referenced)].filter(v => !declared.has(v)), []);

console.log('--- emoji standing in for an icon or a status ---');
// The weekly planner's calendar/clock/scissors/phone/euro/no-entry icons.
function grabByBraces(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  const bodyStart = src.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const plannerFn = grabByBraces(adminJs, 'renderWeeklyPlannerGrid');
ok('planner cards carry no emoji',
   /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(plannerFn), false);
ok('planner reads the real shop hours, not a hardcoded Sunday',
   /hours\.find\(h => h\.day === dayNames\[i\]\)/.test(plannerFn), true);
ok('the Sunday-is-always-closed bug is gone from the code itself',
   /colIdx === 6/.test(plannerFn), false);

const myBookingsFn = (site.match(/listEl\.innerHTML = myBookingsCache\.map[\s\S]*?<\/div>`;/) || [''])[0];
ok('a customer\'s own bookings list carries no emoji',
   /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(myBookingsFn), false);

console.log('--- Our Barbers grid: one Add action, no unmanageable card ---');
function grabByBraces(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  const bodyStart = src.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

(function () {
  const ANY_BARBER = 'Any Available';
  const container = { innerHTML: '', appendChild(el) { this.innerHTML += el.innerHTML; } };
  global.document = {
    getElementById: id => id === 'barbersContainer' ? container : null,
    createElement: () => ({ innerHTML: '', style: {} })
  };
  const cmsLoaded = true;
  const barbers = [{ name: ANY_BARBER, image: '' }, { name: 'Hemen', image: '' }];
  const rotaFor = () => [{ day: 'Tuesday', working: true }];
  const escapeAttr = s => s;
  const escapeHtml = s => s;
  // The cards are what this checks; the priority list beside them draws into
  // its own element and has its own test.
  const renderBarberPriority = () => {};
  eval(grabByBraces(adminJs, 'renderBarbers'));
  renderBarbers();

  ok('no second "+ Add Barber" tile rendered', container.innerHTML.includes('Add Barber'), false);
  ok('"Any Available" gets no card of its own', container.innerHTML.includes(ANY_BARBER), false);
  ok('a real barber still gets a card', container.innerHTML.includes('Hemen'), true);
})();

console.log('--- image filters left to do their job ---');
// A brightness/contrast/hover-brighten stack was applied to real photos of
// the shop and its barbers, in the gallery and on the team grid.
ok('gallery photos are not run through a brightness/contrast stack',
   /brightness-90 contrast-125/.test(site), false);

console.log('--- Visit Us ---');
// Three gold headings over three short things, each in a different shape: an
// address, a phone number set at text-xl, and a circle with the letters IG in
// it. The address was also on the map card beside them, said twice.
ok('one heading left, over the hours',
   (site.match(/text-gold uppercase tracking-widest[^>]*>(Location|Contact)</g) || []), []);
ok('and the hours keep theirs, being what the section is opened for',
   />Working Hours</.test(site), true);
// One shape for the three things under it, all of which are things to press
// rather than things to read.
ok('the rest are rows that look alike',
   (site.match(/class="visit-row[" ]/g) || []).length, 3);
// Calling comes first: it is the one thing somebody does when the booking
// form has not answered their question. The address is last because the map
// is beside it and says the same thing.
ok('in the order the shop asked for',
   ((site.match(/<ul class="visit-rows">[\s\S]*?<\/ul>/) || [''])[0]
     .match(/visit-label" data-translate="(\w+)"/g) || [])
     .map(m => m.replace(/.*data-translate="/, '').replace('"', '')),
   ['Call', 'Instagram', 'Location']);
ok('each of them big enough to press',
   /\.visit-row \{[\s\S]{0,300}min-height: 56px;/.test(site), true);
// The phone row used to be hidden below the sm breakpoint — on a phone, which
// is where somebody most needs to ring a barber.
ok('and the phone is no longer hidden on a phone',
   /hidden sm:block[\s\S]{0,200}cms-contact-phone/.test(site), false);
// Every hook the settings render writes into has to survive a rearrangement.
ok('the address still has its id', /id="cms-contact-address"/.test(site), true);
ok('the number still has its class', /class="visit-value cms-contact-phone"/.test(site), true);
ok('the dial link still has its own', /cms-contact-phone-link/.test(site), true);
ok('and the handle still has its', /cms-instagram-handle/.test(site), true);

// The line the list is usually opened for looked like all the others.
ok('today is marked in the opening hours', /li\.is-today/.test(site), true);
// The shop's day, not the reader's device: somebody in another timezone
// looking at this list is looking at the shop's week.
ok('and it is the shop\'s day that decides which',
   /timeZone: 'Europe\/Amsterdam', weekday: 'long'/.test(site), true);

// A 1px border under the bar arrived before the glass did on the way down
// the ramp — a line hanging under something still mostly transparent.
ok('the header has no hairline under it',
   /<nav class="[^"]*border-b/.test(site), false);
ok('the shadow does the separating instead',
   /box-shadow: 0 1px 3px rgba\(0, 0, 0, calc\(var\(--nav-p, 0\) \* \.06\)\)/.test(site), true);

console.log('--- the map ---');
// It was a bordered box with padding, around a second box, around the
// iframe: three edges to look at before the map. One surface now, one
// radius.
ok('one card rather than a frame inside a frame',
   /\.map-card \{[^}]*border-radius: 18px/.test(site), true);
ok('and the old double frame is gone',
   /aspect-video sm:aspect-square[^"]*border border-gray-200/.test(site), false);

// The only instruction used to appear on hover, which on the phones nine
// customers in ten arrive on is an instruction that never appears at all.
ok('the action is visible without a pointer',
   /class="map-go"/.test(site), true);
ok('and it is not hidden behind a hover state',
   /group-hover:opacity-100[^>]*>\s*<span class="bg-gold/.test(site), false);
// A finger has to be able to hit it.
ok('big enough to press', /\.map-go \{[\s\S]{0,400}min-height: 44px;/.test(site), true);

// An interactive Google map inside a page catches a finger that was trying
// to scroll past it. Covering it makes the map a picture that opens the
// real thing when tapped — and the scrim over it must pass taps through, or
// the bottom third of the card stops working.
ok('the whole surface still opens Maps', /class="map-hit"/.test(site), true);
ok('and the strip over it does not swallow taps',
   /\.map-foot \{[\s\S]{0,700}pointer-events: none;/.test(site), true);

// The dark treatment was four lines of JavaScript, on the stated grounds
// that a filter cannot be applied to another document from a media query.
// It can: the filter applies to the element, and the element is ours.
ok('the dark map is CSS now', /\.map-card iframe \{[\s\S]{0,200}invert\(\.92\)/.test(site), true);
ok('and the JavaScript that did it is gone', /paintMapForTheme/.test(site), false);
// Full saturation on an inverted map turns water into sand.
ok('with the saturation pulled back', /saturate\(\.78\)/.test(site), true);

// If the shop moves, the line on the card moves with it.
ok('the address on the card follows the settings',
   /querySelectorAll\('\.cms-map-address'\)/.test(site), true);

console.log('--- the logo, at the top of a photograph ---');
// On a light device the black logo is right against the white glass header
// and wrong at the top of the page, where the header is transparent and what
// is behind it is a dark photograph. The shop's name was black ink on a dark
// brick wall — the first thing a customer sees was the one thing they could
// not. The links beside it were already forced white by nav.at-top for
// exactly this reason; the logo is an image, so it needed saying separately.
ok('the white logo carries the top of the page',
   /\.logo-stack \.logo-paper \{[\s\S]{0,160}opacity: calc\(1 - var\(--nav-p, 0\)\)/.test(site), true);
ok('and the black one fades up as the glass does',
   /\.logo-stack \.logo-ink \{ opacity: var\(--nav-p, 0\); \}/.test(site), true);
// Light only. A dark device keeps the charcoal header in both states, where
// the white logo was already correct throughout.
ok('only where the header actually turns white',
   /@media \(prefers-color-scheme: light\) \{[\s\S]{0,400}\.logo-stack \.logo-ink/.test(site), true);

console.log('--- where the photograph stops ---');
// The hero is 100svh, so on a phone it is slightly shorter than what is on
// screen and the next section shows underneath. That is deliberate — it is
// what says there is more page — but the join was a straight line with a dark
// photograph above it and a near-white panel below, at the very bottom edge of
// the screen. It read as a mistake rather than an invitation.
ok('the photograph fades out rather than stopping', /\.hero-bg::after/.test(site), true);
// The fade has to end on the next section's own colour. A shade out and the
// line comes back one pixel lower, fainter and harder to explain.
ok('ending on bg-gray-50, which is what is under it',
   /#f9fafb 100%\)/.test(site), true);
ok('and on charcoal-800 for a dark device',
   /#1a1a1a 100%\)/.test(site), true);
// The hero lays a second veil at z-10 and puts its text at z-20. An auto
// z-index would put the fade under the veil, which would tint it — and a fade
// that ends on a tinted white does not meet the white below it.
ok('layered above the veils and below the words', /z-index: 15;/.test(site), true);
console.log('--- the menu says which section you are in ---');
// One item was gold and it was always the same item: My Bookings was written
// that way in the markup, so the menu said the same thing whichever part of
// the page you had come from.
ok('My Bookings is no longer gold by birth',
   /class="mobile-link[^"]*\stext-gold\b/.test(site), false);
ok('the gold is a state now, not a class in the markup',
   /\.mobile-link\.is-here \{\s*color: var\(--gold/.test(site), true);
// Colour on its own is not something to depend on.
ok('with a dot beside it as well as the colour',
   /\.mobile-link\.is-here::before/.test(site), true);
// The same probe that colours the strip, asked a different way — one answer
// to "which section is this", used by both.
ok('it reads the section under the header',
   /function sectionNow\(\)[\s\S]{0,400}closest\('section\[id\]'\)/.test(site), true);
ok('and marks the link whose href matches it',
   /link\.getAttribute\('href'\) === '#' \+ here/.test(site), true);
// At the top there is no menu item for the hero, and marking the nearest one
// would point at the wrong thing.
ok('nothing is marked at the top of the page',
   /Boolean\(here\) && mine/.test(site), true);
// A screen reader cannot see gold.
ok('and it is announced, not only coloured',
   /setAttribute\('aria-current', 'true'\)/.test(site), true);
// A page opened part-way down — a restored tab, or a link to a section —
// would otherwise mark nothing until the reader happened to scroll.
ok('marked at load as well as at each boundary',
   /markWhereYouAre\(\);\s*\};\s*settle\(\);/.test(site), true);

console.log('--- glass, on the phones that can draw it ---');
// Safari only learned the unprefixed backdrop-filter in version 18. Every
// iPhone on iOS 17 or below draws the -webkit- one and answers "no" to the
// other, so a declaration without the prefix is a surface that is glass on
// Android and flat on an iPhone.
[['index.html', site], ['admin/admin.css', adminCssRules]].forEach(([name, css]) => {
  const plain = (css.match(/(?<!-webkit-)backdrop-filter:/g) || []).length;
  const prefixed = (css.match(/-webkit-backdrop-filter:/g) || []).length;
  ok(name + ' spells it both ways everywhere', prefixed, plain);
});
// And the feature test has to ask about both, or it hands the fallback —
// written for browsers that cannot blur at all — to one that can.
const guards = [...site.matchAll(/@supports not \(([^{]*)\)\s*\{/g)].map(m => m[1]);
const blind = guards.filter(g => /backdrop-filter/.test(g) && !/-webkit-backdrop-filter/.test(g));
ok('and every @supports test asks about both', blind, []);

console.log('--- reveals that follow the finger on Safari too ---');
// Scroll-driven animations are what make the reveals track the scroll rather
// than fire at a threshold. Safari only has them from version 26, so without
// this an iPhone gets the same movement on a timer — which is the difference
// the shop noticed holding the two phones side by side.
const linked = (site.match(/\(function scrollLinkedReveals\(\)[\s\S]*?\n        \}\)\(\);/) || [''])[0];
ok('there is a scroll-linked path at all', linked.length > 0, true);
// It must not run where the CSS already does it, or every frame is paid for
// twice on the phones that were fine.
ok('it stands down where the browser does it in CSS',
   /CSS\.supports\('animation-timeline', 'view\(\)'\)/.test(linked), true);
ok('and where motion is not wanted',
   /prefers-reduced-motion: reduce/.test(linked), true);
// This runs while a finger is moving. A non-passive listener lets it block
// the scroll it is meant to be following.
ok('the scroll listener cannot block scrolling',
   /addEventListener\('scroll', onScroll, \{ passive: true \}\)/.test(linked), true);
ok('and no more than one frame is ever queued',
   /if \(queued \|\| !live\.size\) return;/.test(linked), true);
// A page that finishes reading should cost nothing to keep scrolling.
ok('finished elements stop being measured',
   /classList\.add\('settled'\)[\s\S]{0,120}live\.delete/.test(linked), true);
// The failure that matters: --p defaults to the settled state, so a script
// that never runs leaves a readable page rather than an empty one.
ok('the resting state is visible, not invisible',
   /opacity: var\(--p, 1\);/.test(site), true);
ok('and a throw takes the whole thing back off',
   /catch \(err\)[\s\S]{0,200}classList\.remove\('scroll-linked'\)/.test(linked), true);

// The three grids — services, the gallery, the barbers — are what a customer
// actually scrolls through, and they were left on the observer when the
// sections moved over. So the most-looked-at part of the page was the part
// still arriving on a timer, which is most of what there was to notice.
ok('the grids are scroll-linked too',
   /html\.scroll-linked \.stagger > \* \{[^}]*opacity: var\(--p, 1\)/.test(site), true);
// The container is held still. Each card enters when it personally comes
// into view, so the grid sliding up as well would move every card twice.
ok('and the grid itself is held still',
   /html\.scroll-linked \.stagger \{[^}]*transform: none/.test(site), true);
// Cards do not exist when the script runs: they are built from the shop's
// configuration, which arrives from a cache or the network afterwards.
ok('cards built later are registered when they appear',
   /window\.__relinkReveals = register;/.test(site), true);
ok('and applyConfig is what says so',
   /function applyConfig\(config\)[\s\S]{0,400}__relinkReveals/.test(site), true);

console.log(failed === 0 ? '\nAll design cleanliness tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

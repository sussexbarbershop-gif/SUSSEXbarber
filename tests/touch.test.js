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

console.log('--- the stylesheet parses at all ---');
// A stray brace does not throw. The browser drops whatever it cannot make
// sense of and carries on, so the page renders with a section of the design
// simply missing — and the failure looks like "the header never got its
// shadow" rather than like a syntax error, which is a long way to walk back.
const braces = (src, what) => {
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  ok(`${what}: braces balance`, [open, close], [open, open]);
};
braces(style, 'the page\'s own styles');
braces(fs.readFileSync(path.join(root, 'admin', 'admin.css'), 'utf8'), 'the panel');
// An @media or @supports with no body is the other half of the same mistake.
ok('no empty rules left behind', /\{\s*\}/.test(style), false);
// var() with a name nothing declares is silent: the property is simply
// invalid and the element keeps whatever it had.
//
// A var() with a fallback is a different thing and is fine — `var(--i, 0)` is
// how the stagger reads an index that JavaScript sets per element, and the
// fallback is what it uses until that happens. The rule is: no fallback, then
// something had better declare it.
{
  const declared = new Set([...style.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(m => m[1]));
  const bare = [...style.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map(m => m[1]);
  ok('every var() without a fallback names something declared',
     [...new Set(bare.filter(v => !declared.has(v)))], []);
  // And the one that does have a fallback is set by something.
  ok('the stagger index is set from script', /setProperty\('--i'/.test(html), true);
}

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
// The three names point at Material 3's tokens rather than holding numbers of
// their own, so checking one means following it. Named for the standard it
// comes from, because "somebody else decided this" is the whole value of it.
ok('the easings are a published set, not a taste', /--m3-emphasized:/.test(style), true);
ok('with the entering and leaving halves',
   /--m3-emphasized-decelerate:/.test(style) && /--m3-emphasized-accelerate:/.test(style), true);
ok('and the durations too', /--m3-long-2:/.test(style), true);

console.log('--- the home indicator on an iPhone ---');
// Anything pinned to the bottom of the screen sits underneath it: a sheet's
// last row, a close button, the bottom of a menu.
ok('safe-area is used', /env\(safe-area-inset-bottom\)/.test(style), true);
// max(), not the bare inset: on a phone without an indicator the inset is zero
// and the sheet's last row would sit flush against the edge.
ok('with a floor under it', /max\([^)]*env\(safe-area-inset-bottom\)/.test(style), true);
// And applied to something, not merely declared.
ok('and applied to the sheets', (html.match(/class="[^"]*safe-bottom/g) || []).length >= 2, true);
// The footer is not pinned to the bottom, so it was not thought of as being
// at the bottom — but it is what the edge of the screen lands on once the
// page is scrolled to its end, with the shop's phone number on it. An iPhone
// puts the home indicator there; Android 15 draws apps edge to edge and puts
// the gesture bar there.
ok('and to the footer, which is what the bottom of the page lands on',
   /footer \{\s*padding-bottom: max\(2rem, env\(safe-area-inset-bottom\)\);/.test(style), true);

console.log('--- going to a section, at the same speed on both phones ---');
// scroll-behavior: smooth is a yes or a no, and the two browsers answer it
// at very different speeds: Chrome takes about half a second and it reads as
// a journey, Safari does it in a fraction of that and it reads as a jump.
// The only way to have one answer is to do the moving in script.
ok('the page scrolls itself rather than asking the browser to',
   /function smoothScrollTo\(target\)/.test(html), true);
ok('over a duration the shop set',
   /const TRAVEL = \d{3};/.test(html), true);
// Decelerating, like everything else here: quick to leave, slow to arrive.
ok('and an easing that settles rather than stops',
   /const ease = t => 1 - Math\.pow\(1 - t, 3\);/.test(html), true);
// A page that goes on scrolling somewhere while a finger is trying to
// scroll it is worse than one that never animated: they have changed their
// mind, and the animation has become an argument.
ok('a touch stops it',
   /addEventListener\('touchstart', giveUp, \{ passive: true, once: true \}\)/.test(html), true);
ok('and so does a wheel',
   /addEventListener\('wheel', giveUp, \{ passive: true, once: true \}\)/.test(html), true);
ok('somebody who asked for less movement gets none of it',
   /prefers-reduced-motion: reduce\)'\)\.matches\) \{\s*window\.scrollTo\(0, to\);/.test(html), true);
// It has to clear the fixed header, which measures itself and grows by the
// status bar in an installed app — so the number cannot be written down.
ok('it stops clear of the header it measured',
   /getPropertyValue\('--nav-h'\)/.test(html), true);
// One listener. The page already had a delegated handler for these with a
// decision in it about the address bar; a second would be two handlers
// scrolling the same page at once, at two speeds.
ok('only one thing handles an in-page link',
   (html.match(/closest\('a\[href\^="#"\]'\)/g) || []).length, 1);
ok('and it is the one that keeps the address bar clean',
   /\(function keepTheAddressClean\(\)[\s\S]{0,600}smoothScrollTo\(target\)/.test(html), true);
ok('which no longer asks the browser to do the scrolling',
   /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\);\s*return Boolean\(target\)/.test(html), false);

console.log('--- pulling down to refresh, where the platform has none ---');
// Android's app has this from Chrome. An iPhone app does not: a home-screen
// app runs without Safari's chrome and pull-to-refresh went with it.
ok('there is one', /function pullToRefresh\(\)/.test(html), true);
// Only there. Where the browser already does this, a second one means two
// indicators for one gesture.
ok('and it stands down where the browser has its own',
   /if \(!window\.navigator\.standalone\) return;/.test(html), true);
// An ordinary scroll must never be intercepted by something guessing at
// what it might become, so the gesture is only claimed when it cannot mean
// anything else.
ok('not while a sheet has the page pinned',
   /if \(scrollHolders > 0 \|\| window\.scrollY > 0/.test(html), true);
ok('not sideways', /Math\.abs\(dx\) > Math\.abs\(dy\)/.test(html), true);
ok('and not until it has gone far enough down to be sure',
   /if \(dy <= 12\) return;/.test(html), true);
// preventDefault needs a non-passive listener, and it is the line that
// stops the page scrolling — so it comes after the gesture is certain.
ok('the move listener can actually stop the scroll',
   /'touchmove'[\s\S]{0,1200}\{ passive: false \}/.test(html), true);
ok('and the start listener does not, because it only ever reads',
   /'touchstart'[\s\S]{0,600}\{ passive: true \}/.test(html), true);

console.log('--- the messages the page speaks with ---');
// Pinned twenty pixels from the top right, which is empty space on a desktop
// and the status bar on a phone. There is a screenshot of a green slab lying
// across the clock, the shop's logo and half the BOOK NOW button.
ok('they are not pinned to the top any more',
   /id="toastContainer" class="fixed top-5/.test(html), false);
ok('they come from the bottom, where nothing else is pinned',
   /#toastContainer \{[^}]*bottom: calc\(env\(safe-area-inset-bottom\)/.test(style), true);
// Above the home indicator, which is the other thing down there.
ok('and clear of the home indicator',
   /#toastContainer \{[^}]*env\(safe-area-inset-bottom\) \+ 18px\)/.test(style), true);
// A card, not a coloured rectangle. A booking that failed does not need to
// shout in red across the width of the screen; it needs to be read.
ok('the card is the shop\'s own charcoal',
   /\.toast \{[^}]*background: rgba\(24, 24, 24, \.92\)/.test(style), true);
ok('and the colour is carried by the icon instead',
   /\.toast-error\s+\.toast-mark \{ background: rgba\(244,  63,  94, \.18\)/.test(style), true);
// Four seconds is right for "Saved" and far too long for something in the
// way of what you are reading.
ok('a tap sends one away early', /toast\.addEventListener\('click'/.test(html), true);
ok('and the timer is cleared with it, so neither removes it twice',
   /clearTimeout\(timer\); dismiss\(\);/.test(html), true);
// Some of these carry a sentence from the server, and a server's words are
// not markup.
ok('the message is set as text, never as html',
   /words\.textContent = message;/.test(html), true);

console.log('--- the bar arriving, rather than switching ---');
// It was a one-pixel sentinel and an observer: the bar went from nothing to
// glass in one step, easing over half a second on its own clock — so it
// changed after the scroll rather than with it, and at the same speed whether
// the finger had moved two pixels or two hundred.
ok('the sentinel is gone', /position:absolute;top:0;height:1px;width:1px/.test(html), false);
ok('and the bar reads a progress value instead',
   /--nav-p/.test(style), true);
// Short, as asked: over before the hero's headline has cleared the bar.
ok('over eighty pixels', /const SETTLE = 80;/.test(html), true);
// Everything the bar does comes off the one number.
[['the glass fills in', /background-color: rgba\(255, 255, 255, calc\(var\(--nav-p, 0\) \* \.62\)\)/],
 ['the blur deepens', /blur\(calc\(2px \+ var\(--nav-p, 0\) \* 16px\)\)/],
 ['the edge arrives', /border-color: rgba\(229, 231, 235, var\(--nav-p, 0\)\)/],
 ['and the shadow with it', /box-shadow: 0 1px 2px rgba\(0, 0, 0, calc\(var\(--nav-p, 0\)/]]
  .forEach(([what, re]) => ok(what, re.test(style), true));
// A transition here would be a second animation fighting the one the finger
// is already driving.
ok('nothing eases while a finger is driving it',
   /nav \{\s*padding-top: env\(safe-area-inset-top\);\s*\}/.test(style), true);
// Except when the page moves by itself, which is not a scroll anybody is
// driving and would otherwise cross the whole ramp in one frame.
ok('but a jump to a section is allowed to ease',
   /nav\.site-nav\.is-jumping \{[\s\S]{0,200}transition: background-color/.test(style), true);
ok('and smoothScrollTo says when that is',
   /dispatchEvent\(new Event\('sussex:jump'\)\)/.test(html), true);
// The class survives because three other things read it, and it flips late
// enough that the words turn dark only once the glass behind them is mostly
// there.
ok('the boolean flips at six tenths, not at nothing',
   /const atTop = p < 0\.6;/.test(html), true);
// A hard swap in the middle of a soft change is the one frame anybody would
// notice.
ok('the two logos cross over on the same ramp',
   /\.logo-stack \.logo-ink \{ opacity: var\(--nav-p, 0\); \}/.test(style), true);

console.log('--- the strip Android paints above the app ---');
// The two platforms disagree about where an app begins. iOS was told the
// page may run under the status bar, so the hero photograph goes to the top
// of the screen. Chrome paints a band of theme_color above the page instead
// and there is nothing to opt out of — so the only thing left to get right
// is the colour of that band, and one value cannot suit both states.
ok('the two theme colours can be found again',
   /id="themeColorLight"/.test(html) && /id="themeColorDark"/.test(html), true);
// Over the hero it must be the hero's own charcoal, or there is a seam
// across the top of the screen — which is the whole of what made it look
// unlike the iPhone.
ok('it starts as the hero, not as the light theme',
   /<meta name="theme-color" content="#121212"[^>]*prefers-color-scheme: light/.test(html), true);
ok('and the section behind it is what it changes to',
   /function behindTheBar\(\)/.test(html), true);
// Read off the page, not written down section by section. That is what makes
// it right in both themes without a second table, right for a section added
// later, and unable to drift from the CSS — getComputedStyle has already
// resolved whatever the device's own light or dark setting selected.
ok('by reading the page rather than a list of colours',
   /getComputedStyle\(el\)\.backgroundColor/.test(html), true);
// Anything see-through is not what is being seen; the probe keeps walking up.
ok('and it ignores anything transparent on the way up',
   /Number\(alpha\) > 0\.9/.test(html), true);
// The hero is a photograph under a flat veil, so it has no background-color
// to read. Its two values are measured off the file, one per theme.
ok('the hero has its own measured colour', /HERO_LIGHT = \[50, 33, 25\]/.test(html), true);
ok('and a different one for a dark device', /HERO_DARK  = \[41, 29, 23\]/.test(html), true);
// Three numbers, not hex: asRgb reads what getComputedStyle returns, and
// handed a hex string it finds one number instead of three and gives up —
// which made the whole paint return early and leave the strip on its last
// colour, in silence. That was the first version of this.
ok('written as numbers, because that is what the reader parses',
   /HERO_LIGHT = '#/.test(html), false);
// Once the page has scrolled the strip sits directly on the header's glass,
// so it is the section's colour with the same glass over it. Otherwise the
// two read as two bars rather than one.
ok('with the header glass laid over it once scrolled',
   /over\(behind, isDark\(\) \? GLASS_DARK : GLASS_LIGHT\)/.test(html), true);
// A section boundary is when the answer changes, and the only time it does.
ok('watched at the boundary rather than polled every frame',
   /new IntersectionObserver\(\(\) => repaint\(\)/.test(html), true);
// Switching the phone between light and dark moves both colours at once.
ok('and repainted if the device changes theme underneath it',
   /prefers-color-scheme: dark\)'\)\.addEventListener\('change'/.test(html), true);
// Painted from the same observer that decides the header's own state, so
// the two cannot disagree about whether the page is at the top.
// The strip colour and the header's own state are decided in one place, off
// the same progress value, so they cannot disagree about whether the page
// has left the top.
ok('the strip and the header are decided together',
   /nav\.classList\.toggle\('at-top', atTop\);\s*paintStatusBar\(atTop\);/.test(html), true);
ok('and it is right before a scroll ever happens',
   /settle\(\);\s*addEventListener\('scroll'/.test(html), true);

console.log('--- the status bar, once it opens as an app ---');
// The mirror of the block above, and it only became visible when the icon
// started opening as an app. viewport-fit=cover lets the page use the strip
// behind the status bar; in Safari the address bar was in that strip and
// there was nothing to see. Standalone, there is no address bar, so the
// header moved up into it and the clock landed on the logo.
ok('the header reserves the top inset',
   /nav \{\s*padding-top: env\(safe-area-inset-top\);/.test(style), true);
// Unconditional on purpose: off an iPhone the inset is zero and it does
// nothing, so there is no state anybody has to be in for it to be right.
ok('and does it without a media query around it',
   /@media[^{]*\{[^}]*nav \{\s*padding-top: env\(safe-area-inset-top\)/.test(style), false);
// The one control pinned to the top of the viewport rather than sitting in
// the bar, so the bar's padding does not carry it.
ok('the menu close button clears it too',
   /#closeMobileMenuBtn \{\s*top: calc\(1\.5rem \+ env\(safe-area-inset-top\)\);/.test(style), true);
// Every in-page jump lands on --nav-h, which is measured rather than written
// down — so a header that grows by the inset moves them all with it.
ok('and the jump offset is measured from the bar, not assumed',
   html.includes('bar.getBoundingClientRect().height'), true);

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

console.log('--- the page behind an open overlay ---');
// With the menu open you could still drag the page behind it — you could feel
// it moving under the overlay, and closing the menu left you somewhere else on
// the page than where you started.
const hold = (html.match(/function holdPage\(hold\)[\s\S]*?\n        \}/) || [''])[0];
ok('something holds the page', hold !== '', true);
// overflow:hidden on <body> is the usual answer and iOS Safari ignores it.
ok('by fixing the body, not by hiding its overflow',
   /position = 'fixed'/.test(hold), true);
// Fixing the body takes the scroll position to zero, so it has to be put back.
ok('remembering where you were', /scrollHeldAt = window\.scrollY/.test(hold), true);
ok('and going back to it', /window\.scrollTo\(0, scrollHeldAt\)/.test(hold), true);
// The lightbox can open over a sheet. Whichever closed first used to release
// the page for both.
ok('counted, so two overlays do not release it early',
   /scrollHolders/.test(hold), true);
// Every one of them, or the one that was missed is the one that fails.
// To the end of the function, not a fixed number of characters — openLightbox
// carries enough comment to push its holdPage call past any window guessed at.
const fnBody = name => (html.match(new RegExp(
  '(?:const |function )' + name + '[\\s\\S]*?\\n        \\}')) || [''])[0];

['openMobileMenu', 'closeMobileMenu', 'openLightbox', 'closeLightbox',
 'showSheet', 'hideSheet'].forEach(fn => {
  ok(`${fn} holds or releases it`, /holdPage\(/.test(fnBody(fn)), true);
});
// The two pickers go through the shared pair rather than holding the page
// themselves, so what matters for them is that they still delegate.
['openBarberPicker', 'openServicePicker'].forEach(fn => {
  ok(`${fn} goes through showSheet`, /showSheet\(/.test(fnBody(fn)), true);
});
['closeBarberPicker', 'closeServicePicker'].forEach(fn => {
  ok(`${fn} goes through hideSheet`, /hideSheet\(/.test(fnBody(fn)), true);
});

console.log('--- the two buttons in the header ---');
// The language button was h-9 and text-xs against Book Now's py-2 and
// sm:text-sm. At the same forty-four pixels tall it still read as the smaller
// of the two, because the letters were two points down.
const lang = (html.match(/<button id="langToggleBtn"[^>]*>/) || [''])[0];
const book = (html.match(/<a[^>]*>Book Now</) || [''])[0];
ok('the language button is thumb-sized', /tap-44/.test(lang), true);
ok('no fixed height fighting it', /\bh-9\b/.test(lang), false);
['text-xs', 'sm:text-sm', 'py-2', 'rounded-lg'].forEach(cls => {
  ok(`and matches Book Now on ${cls}`,
     lang.includes(cls) && book.includes(cls), true);
});

console.log('--- slow enough to be seen ---');
// 260ms for a panel crossing the screen is the number a guideline gives you,
// and at that speed nobody sees the movement: the menu is simply there, and
// the work put into how it arrives is work nobody is ever shown.
// The site's three names now point at Material 3's tokens rather than holding
// numbers themselves, so reading one means following it to the token it names.
// One hop is enough and one hop is all that should ever be needed: a token
// pointing at a token pointing at a token is a system nobody can read.
const ms = name => {
  const raw = (style.match(new RegExp('--' + name + ':\\s*([^;]+);')) || ['', ''])[1].trim();
  const direct = raw.match(/^(\d+)ms$/);
  if (direct) return Number(direct[1]);
  const alias = raw.match(/var\(\s*(--[\w-]+)\s*\)/);
  if (!alias) return NaN;
  return Number((style.match(new RegExp(alias[1] + ':\\s*(\\d+)ms')) || [])[1]);
};
ok('travel is visible', ms('move') >= 350, true);
// And not so slow that it is in the way. Under half a second.
ok('but not in the way', ms('move') <= 500, true);
ok('a section arriving can take longer', ms('settle') > ms('move'), true);
// The press is the exception: that one answers a finger and must stay short.
ok('the press stays quick', ms('press') <= 150, true);
ok('the overlays use the travel duration', /#mobileMenu \{ transition-duration: var\(--move\)/.test(style), true);

console.log('--- the sheets, which had no movement at all ---');
// They were shown and hidden with `hidden`, so every duration set above them
// applied to something that appeared and vanished between one frame and the
// next: a sheet covering the screen, arriving with no indication of where it
// came from.
ok('the panel starts off the bottom', /\.sheet-panel \{[^}]*translateY\(100%\)/.test(style), true);
ok('and the backdrop starts clear', /\.sheet-veil \{[^}]*transition: opacity/.test(style), true);
ok('opening moves it to zero', /\.sheet-open \.sheet-panel \{ transform: translateY\(0\)/.test(style), true);
// Transform and opacity only. Both are composited, so a list of eleven
// services does not relayout on every frame of the slide.
const panelRule = (style.match(/\.sheet-panel \{([^}]*)\}/) || ['', ''])[1];
ok('it moves on transform, not on height or top',
   /top:|height:|margin/.test(panelRule), false);
// display:none stops a transition dead, so `hidden` can only go back on after
// the sheet has finished travelling.
const hide = fnBody('hideSheet');
ok('hidden is put back after the journey, not during it',
   /transitionend/.test(hide) && /setTimeout/.test(hide), true);
// A transitionend that never fires — a tab that is not being painted — would
// otherwise leave the sheet present and invisible over the whole page.
ok('with a fallback for a transitionend that never comes', /setTimeout\(once/.test(hide), true);
// Reopened while it was still leaving, the pending hide must not take it away
// half a second after somebody asked for it.
ok('and it checks it was not reopened meanwhile',
   /if \(!sheet\.classList\.contains\('sheet-open'\)\)/.test(hide), true);
// Both keyed off the open class rather than off `hidden`, which for the length
// of the closing animation is neither on nor off.
ok('showSheet asks whether it is open, not whether it is hidden',
   /contains\('sheet-open'\)/.test(fnBody('showSheet')), true);

console.log('--- and the page does not travel when a sheet closes ---');
// <html> carries scroll-smooth, so restoring the scroll position *animated*:
// unpinning the body put the page at the top, and the journey back down to
// where the customer actually was played out in front of them every time they
// picked a barber.
ok('the restore turns smooth scrolling off for its one line',
   /scrollBehavior = 'auto'[\s\S]{0,120}window\.scrollTo\(0, scrollHeldAt\)/.test(hold), true);
ok('and puts it back', /root\.style\.scrollBehavior = was/.test(hold), true);

console.log('--- the first thing anybody sees ---');
// The hero arrived complete, in one frame. Three lines a moment apart read as
// a shop opening its door; three lines simply there read as a screenshot.
ok('the hero lines are animated', /#hero h1, #hero p, #hero a \{/.test(style), true);
ok('one after the other', /#hero p \{ animation-delay/.test(style) &&
                          /#hero a \{ animation-delay/.test(style), true);
// Short: a first-time visitor is here to find out whether the shop is open,
// not to watch a title assemble itself.
const lastDelay = Number((style.match(/#hero a \{ animation-delay: (\d+)ms/) || [])[1]);
ok('and the whole sequence is brief', lastDelay > 0 && lastDelay <= 250, true);
// The photograph is the page's first impression; fading it in would be a wash
// of nothing while the network is still busy.
ok('the photograph itself does not fade in', /#hero \{[^}]*opacity: 0/.test(style), false);

console.log('--- photographs, once they have arrived ---');
// A gallery image pops into place the instant the last byte lands, which on a
// slow connection is six pops in no particular order.
ok('they fade', /\.js-fades \.fade-in-img \{[^}]*opacity: 0/.test(style), true);
// Visible by default, faded only once a script says so: if the file never
// runs, every photograph is simply there.
ok('but only once a script has said so', /^\s*\.fade-in-img \{ opacity: 1; \}/m.test(style), true);
ok('and the script says so first of all', /classList\.add\('js-fades'\)/.test(html), true);
// An image already in the cache is complete before this runs.
ok('a cached image is not left invisible', /if \(img\.complete\)/.test(html), true);
// And one that will not load must not sit invisible over the space it holds.
ok('nor is a broken one', /addEventListener\('error'/.test(html), true);
// The gallery is filled from the config long after this runs.
ok('images added later are caught too', /new MutationObserver/.test(html), true);

console.log('--- work the browser can skip ---');
ok('the sections below the fold are deferred', /content-visibility: auto/.test(style), true);
// Without an intrinsic size the scrollbar lurches as each one is measured.
ok('with a size to reserve', /contain-intrinsic-size/.test(style), true);
// Not the booking form. That is what the page is for.
const cv = (style.match(/([^{}]*)\{\s*content-visibility: auto/) || ['', ''])[1];
ok('and not the form', /#booking/.test(cv), false);
ok('nor the hero', /#hero/.test(cv), false);

console.log('--- the header knows where the page is ---');
// It looked the same over the hero photograph as it did over a white section
// three screens down: a full-strength bar with a border, in the way of an
// image it was sitting on top of.
// The bar no longer has two states with a line between them. It has a ramp,
// and the class is only what other things read off it.
ok('the bar is drawn from the progress value',
   /nav\.site-nav \{[^}]*var\(--nav-p, 0\)/.test(style), true);
ok('which is nothing at all at the top',
   /background-color: rgba\(255, 255, 255, calc\(var\(--nav-p, 0\) \* \.62\)\)/.test(style), true);
ok('and gains its edge as it fills in',
   /border-color: rgba\(229, 231, 235, var\(--nav-p, 0\)\)/.test(style), true);
// Over a dark photograph the links have to be legible whatever the device's
// theme is, and the light theme would otherwise put charcoal on it.
ok('the links stay legible over the photograph',
   /nav\.at-top a, nav\.at-top button \{ color: #fff/.test(style), true);
// A sentinel, not a scroll listener: a listener fires on every frame of every
// scroll for the whole visit to answer a question whose answer changes twice.
ok('driven by a sentinel', /sentinel/.test(html), true);
// The observer that answered this is gone: the question is continuous now.
ok('and a rAF-throttled listener, not an observer',
   /const settle = \(\) => \{[\s\S]{0,900}requestAnimationFrame\(settle\)/.test(html), true);
// Two scroll listeners, and both earn it. This test used to insist on one,
// and the reasoning was right for the question the header was asking then:
// "has the page left the top" changes twice a visit, and paying for that on
// every frame is waste. The header asks a different question now — "how far
// down are we", which has a new answer on every frame — and that is precisely
// what a scroll listener is for.
//
// The number still matters. Anything a boundary can answer belongs on an
// observer, and the section colours and the menu marker both do.
const scrollListeners = (html.match(/addEventListener\('scroll'/g) || []).length;
ok('two things listen to scroll, and no more', scrollListeners, 2);
ok('one of them is the reveals',
   /scrollLinkedReveals[\s\S]*?addEventListener\('scroll'/.test(html), true);
ok('and the other is the header settling',
   /const settle = \(\) => \{[\s\S]*?addEventListener\('scroll'/.test(html), true);
// Both of them queue one frame at most.
ok('neither runs more than once a frame',
   (html.match(/if \(queued\) return;\s*queued = true;\s*requestAnimationFrame/g) || []).length >= 1, true);
// It has to start in the at-top state, or the header is opaque for the moment
// before the first callback arrives.
ok('and it starts at the top',
   /let wasAtTop = null;/.test(html), true);

console.log('--- and if the observer is not there at all ---');
// The staggered grids start at opacity 0 and are brought back by the class the
// observer adds. Without it the services and the gallery would be blank space
// rather than a list — everything visible and no animation is the right way
// for this to fail.
ok('there is a way out', /!\('IntersectionObserver' in window\)/.test(html), true);
ok('and it shows everything', /forEach\(el => el\.classList\.add\('active'\)\)/.test(html), true);

console.log('--- the wizard steps ---');
// A step is a whole panel of content arriving, which is the case the
// emphasized curve exists for.
const twConfig = fs.readFileSync(path.join(root, 'tailwind.config.js'), 'utf8');
ok('the steps use the emphasized-decelerate curve',
   /slideInRight 0\.5s cubic-bezier\(0\.05, 0\.7, 0\.1, 1\)/.test(twConfig), true);
ok('both directions', /slideInLeft 0\.5s cubic-bezier\(0\.05, 0\.7, 0\.1, 1\)/.test(twConfig), true);
// Tailwind compiles that file at build time and cannot read the custom
// properties in index.html, so the number is written twice and this is what
// notices when the two drift.
const emphDecel = (style.match(/--m3-emphasized-decelerate:\s*([^;]+);/) || ['', ''])[1].trim();
ok('and it is the same curve the stylesheet names',
   twConfig.includes(emphDecel), true);

console.log('--- and none of it for somebody who asked it to stop ---');
const reduced = (style.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n        \}/g) || []).join('');
ok('reduced motion is honoured', reduced.length > 0, true);
// The press fires more often than anything else on the page, so it is the one
// that matters most to turn off — and the one easiest to forget.
ok('including the press state', /:active[^}]*transform:\s*none/.test(reduced), true);
ok('and the durations go to nothing', /--press:\s*0/.test(reduced), true);


console.log('--- hover latches on a touch screen ---');
// Reported from a phone: tap the EN button once and it keeps its filled
// background for ever. That is not the button. There is no pointer to leave,
// so :hover latches on tap and stays until something else is tapped — and
// every hover: class on the page had it. The language button was simply where
// it showed, being the only control whose resting state is transparent and
// whose hover state is a solid fill.
const twCfg = fs.readFileSync(path.join(root, 'tailwind.config.js'), 'utf8');
ok('every hover: utility asks whether there is a pointer',
   /hoverOnlyWhenSupported:\s*true/.test(twCfg), true);
// And the built sheet is where that either happened or did not.
{
  const built = fs.readFileSync(path.join(root, 'assets', 'tailwind.css'), 'utf8');
  const guard = built.indexOf('@media (hover:hover)');
  ok('the compiled sheet has the guard', guard > -1, true);
  ok('and not one :hover rule sits outside it',
     (built.slice(0, guard).match(/:hover/g) || []).length, 0);
}
// The panel is hand-written CSS and had twenty-five of the same.
{
  const panel = fs.readFileSync(path.join(root, 'admin', 'admin.css'), 'utf8');
  let inQuery = false;
  const loose = [];
  panel.split('\n').forEach(line => {
    if (/@media[^{]*\(hover:/.test(line)) { inQuery = true; return; }
    if (inQuery && /^\}/.test(line)) { inQuery = false; return; }
    if (inQuery) return;
    if (!line.includes(':hover')) return;
    // A scrollbar is not a control and cannot latch on a tap.
    if (line.trim().startsWith('::-webkit-scrollbar')) return;
    loose.push(line.split('{')[0].trim().slice(0, 40));
  });
  ok('the panel has none left unguarded', loose, []);
}

console.log('--- the header is glass, not a lid ---');
// bg-white/90 is ninety per cent opaque, which is a solid bar with a rounding
// error: scroll down and the header simply goes dark.
// The end of the ramp is the glass this used to switch to.
ok('the far end of the ramp is see-through',
   /calc\(var\(--nav-p, 0\) \* \.62\)/.test(style), true);
ok('with a real blur behind it, deepening as it goes',
   /blur\(calc\(2px \+ var\(--nav-p, 0\) \* 16px\)\)/.test(style), true);
// Blurred colour goes grey without it, and glass over a photograph then looks
// like frosted plastic.
ok('and saturation, or the colour goes grey',
   /saturate\(calc\(100% \+ var\(--nav-p, 0\) \* 60%\)\)/.test(style), true);
// Safari still wants the prefix; without it iOS renders the transparency and
// none of the blur, which is a smear rather than glass.
ok('prefixed for Safari, which still wants it',
   /-webkit-backdrop-filter: blur\(calc\(2px \+ var\(--nav-p, 0\) \* 16px\)\)/.test(style), true);
// Sixty per cent with nothing behind it is text over whatever is scrolling
// past. Glass is an enhancement; legibility is not.
// Asking about both spellings, because Safari before 18 answers "no" to the
// unprefixed one while drawing the prefixed one perfectly — so a test of the
// plain name alone took the glass off exactly the phones that had it.
ok('and an opaque fallback where blur is unsupported',
   /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/.test(style), true);

console.log(failed === 0 ? '\nAll touch tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

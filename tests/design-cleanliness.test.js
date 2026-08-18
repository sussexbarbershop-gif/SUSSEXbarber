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

console.log(failed === 0 ? '\nAll design cleanliness tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

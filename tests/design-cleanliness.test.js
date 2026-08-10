// Guards the "make it read like an app, not a decorated web page" pass:
// the 3-item theme dropdown, the clouds and plane over the map, and emoji
// standing in for icons across both the site and the panel.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');

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

console.log('--- emoji standing in for an icon or a status ---');
// A stray sun in front of "کوردی" (no flag exists for Kurdish) and the
// weekly planner's calendar/clock/scissors/phone/euro/no-entry icons.
ok('no sun icon on the Kurdish option', adminHtml.includes('☀️ کوردی'), false);
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

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

console.log('--- theme switcher: one button, not a 3-item menu ---');
ok('no themeDropdown left', site.includes('id="themeDropdown"'), false);
ok('no Light/Dark/System option buttons', site.includes('data-theme-value'), false);
ok('the button shows both icons, swapped by dark:', /id="themeToggleBtn"[\s\S]{0,600}dark:hidden[\s\S]{0,400}dark:block/.test(site), true);

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

console.log('--- image filters left to do their job ---');
// A brightness/contrast/hover-brighten stack was applied to real photos of
// the shop and its barbers, in the gallery and on the team grid.
ok('gallery photos are not run through a brightness/contrast stack',
   /brightness-90 contrast-125/.test(site), false);

console.log(failed === 0 ? '\nAll design cleanliness tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// Static checks on the panel's CSS for the things that make a page wider than
// a phone. The symptom is the whole panel scrolling sideways — the topbar and
// the Refresh button cut off — and it is caused by one wide thing several
// pages away, so it is hard to attribute by looking.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'admin');
const css = fs.readFileSync(path.join(root, 'admin.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

/** The declarations of one selector, as written. */
const rule = (selector) => {
  const re = new RegExp('(^|[},])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                        '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  return m ? m[2] : null;
};

console.log('--- the flex item that holds every page ---');
// A flex item defaults to min-width:auto: it will not shrink below its
// content, so one wide table pushes the whole panel past the screen edge.
const mainContent = rule('.main-content');
ok('.main-content exists', mainContent !== null, true);
ok('.main-content can shrink below its content', /min-width:\s*0/.test(mainContent || ''), true);

console.log('--- a rota row has six time inputs ---');
const timeInputs = rule('.hours-row .time-inputs');
ok('.time-inputs wraps', /flex-wrap:\s*wrap/.test(timeInputs || ''), true);

console.log('--- the mobile stylesheet ---');
const mobile = (css.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
ok('a max-width:768px block exists', mobile.length > 0, true);
ok('rota rows are restacked on a phone', /\.hours-row\s*\{[^}]*display:\s*grid/.test(mobile), true);
ok('the dialog becomes a full-height sheet', /\.modal\s*\{[^}]*height:\s*100dvh/.test(mobile), true);
ok('the sidebar slides away', /\.sidebar\s*\{[^}]*translateX\(-100%\)/.test(mobile), true);

console.log('--- rows whose contents refuse to shrink ---');
// Each of these is a flex row of fixed-size pieces that together are wider
// than a phone. They have to wrap, or they push the page sideways.
[
  ['.topbar-left', /min-width:\s*0/],
  ['.today-row', /flex-wrap:\s*wrap/],
  ['.today-actions', /width:\s*100%/],
  ['.filter-tabs', /overflow-x:\s*auto/]
].forEach(([selector, expected]) => {
  const block = new RegExp(selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}');
  const found = (mobile.match(block) || [])[1] || '';
  ok(`${selector} gives way on a phone`, expected.test(found), true);
});

console.log('--- a week of appointments ---');
ok('the planner stacks one day per row',
   /#weeklyGridContainer\s*\{[^}]*grid-template-columns:\s*1fr/.test(mobile), true);

console.log('--- anything wide enough to overflow must scroll itself ---');
// A table is wider than a phone by nature; each one needs a scrolling parent.
const tables = (html.match(/<table/g) || []).length;
const wrapped = (html.match(/class="table-responsive"/g) || []).length;
ok('every table sits in a .table-responsive', wrapped >= tables, true);

// Any inline grid with a fixed minimum column has to scroll on its own.
const rigidGrids = [...html.matchAll(/style="([^"]*grid-template-columns:\s*repeat\([^)]*minmax\([^"]*)"/g)]
  .filter(m => !/overflow-x:\s*auto/.test(m[1]))
  .map(m => m[1].slice(0, 60));
ok('fixed-column grids scroll themselves', rigidGrids, []);

console.log('--- the viewport is declared ---');
ok('width=device-width', /name="viewport"[^>]*width=device-width/.test(html), true);

console.log(failed === 0 ? '\nAll admin mobile tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

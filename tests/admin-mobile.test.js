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
// Every one of them, not the first. There was one block for a long time and
// this read it with a single match — so the day a second appeared above it,
// every rule in the real one stopped being checked and ten assertions failed
// at once, pointing at rules that had not moved.
const mobile = [...css.matchAll(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/g)]
  .map(m => m[1]).join('\n');
ok('a max-width:768px block exists', mobile.length > 0, true);
ok('rota rows are restacked on a phone', /\.hours-row\s*\{[^}]*display:\s*grid/.test(mobile), true);
ok('the dialog becomes a full-height sheet', /\.modal\s*\{[^}]*height:\s*100dvh/.test(mobile), true);
ok('the sidebar slides away', /\.sidebar\s*\{[^}]*translateX\(-100%\)/.test(mobile), true);

console.log('--- rows whose contents refuse to shrink ---');
// Each of these is a flex row of fixed-size pieces that together are wider
// than a phone. They have to wrap, or they push the page sideways.
[
  ['.topbar-left', /min-width:\s*0/],
  ['.data-card-header', /flex-wrap:\s*wrap/],
  ['.data-card-actions', /flex-wrap:\s*wrap/],
  ['.planner-toolbar', /flex-wrap:\s*wrap/],
  ['.barber-filter', /width:\s*100%/],
  ['.filter-tabs', /overflow-x:\s*auto/]
].forEach(([selector, expected]) => {
  const block = new RegExp(selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}');
  const found = (mobile.match(block) || [])[1] || '';
  ok(`${selector} gives way on a phone`, expected.test(found), true);
});

console.log('--- a week of appointments ---');
// Swiped through a day at a time rather than stacked down the page: a week is
// a row, and scrolling past six empty days to reach Saturday is not reading a
// week. The snap is what stops a half-scrolled column being left on screen.
ok('the week scrolls sideways',
   /#weeklyGridContainer\s*\{[^}]*grid-auto-flow:\s*column/.test(mobile), true);
ok('one day nearly fills the screen',
   /#weeklyGridContainer\s*\{[^}]*grid-auto-columns:[^;]*vw/.test(mobile), true);
ok('and the days snap into place',
   /#weeklyGridContainer\s*\{[^}]*scroll-snap-type:\s*x/.test(mobile), true);
ok('the grid it scrolls can overflow',
   /\.weekly-grid-container\s*\{[^}]*overflow-x:\s*auto/.test(css), true);

console.log('--- the download menu has to stay on the screen ---');
// It hangs off a button at the right edge of a card, so it opens leftwards
// from there. An earlier phone override set right:auto, which dropped it back
// to where it would have sat in the flow — off the right of the screen, with
// half the options unreachable.
ok('the menu is positioned against its own button',
   /\.download-menu\s*\{[^}]*position:\s*relative/.test(css), true);
ok('and anchored to the right edge',
   /\.download-options\s*\{[^}]*right:\s*0/.test(css), true);
const phoneMenu = (mobile.match(/\.download-options\s*\{([^}]*)\}/) || [])[1] || '';
ok('a phone does not unanchor it', /right:\s*auto/.test(phoneMenu), false);

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

console.log('--- one anatomy for every block in a dialog ---');
// Three section headings with three sets of inline styles and three different
// margins, three hint paragraphs at 8px, 6px and 12px, and a photo-and-name
// row that wrapped on a phone into two ragged columns. Nothing was wrong with
// any one of them; they had no rule in common, so nothing lined up.
ok('a block is a rule, not a copy', /.sheet-block { margin-bottom: 26px; }/.test(css), true);
ok('and so is its heading', /.sheet-title {/.test(css), true);
ok('and its line of explanation', /.sheet-hint {/.test(css), true);
// The dialog should carry no sizes of its own beyond its own width.
const dialog = html.slice(html.indexOf('id="barberModal"'), html.indexOf('id="serviceModal"'));
ok('the barber dialog has one inline style left, its width',
   (dialog.match(/style="/g) || []).length, 1);
ok('and that one is the width', /class="modal" style="max-width:720px"/.test(dialog), true);
// A fixed first column cannot wrap into two ragged columns on a narrow screen.
ok('the photo sits beside the name at a fixed width',
   /grid-template-columns: 88px 1fr;/.test(css), true);
// The strip above the page had nothing to match, which is a hairline across
// the top of every screen in the panel.
ok('the panel tints the status bar to its own background',
   /<meta name="theme-color" content="#f8fafc"/.test(html), true);
ok('and to the dark one as well',
   /<meta name="theme-color" content="#0f0f0f"/.test(html), true);
console.log(failed === 0 ? '\nAll admin mobile tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

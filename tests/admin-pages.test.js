// Every page in the sidebar must be reachable: a title, a section to show, and
// a render call if it has one.
//
// "Our Barbers" had no case in renderPage(), so it only ever drew when the
// config fetch happened to land while the page was already open. That took
// six seconds or more, so it looked like it worked - until the backend got
// faster and the page went permanently blank.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'admin');
const js = fs.readFileSync(path.join(root, 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const pages = [...new Set([...html.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]))].sort();
const sections = [...html.matchAll(/id="page-([^"]+)"/g)].map(m => m[1]).sort();
const titles = [...(js.match(/const titles = \{[\s\S]*?\};/) || [''])[0]
  .matchAll(/(\w+):\s*'/g)].map(m => m[1]).sort();
const cases = [...(js.match(/switch \(page\)[\s\S]*?\n    \}/) || [''])[0]
  .matchAll(/case '([^']+)'/g)].map(m => m[1]).sort();

console.log('sidebar pages:', pages.join(', '));

ok('every page has a section', pages.filter(p => !sections.includes(p)), []);
ok('every page has a title',   pages.filter(p => !titles.includes(p)), []);

// Pages whose content is drawn by JS need a case; the static ones do not.
const needsRender = pages.filter(p => new RegExp('function render' +
  p.charAt(0).toUpperCase() + p.slice(1) + '\\(').test(js));
console.log('pages with a render function:', needsRender.join(', '));
ok('every rendered page is wired up', needsRender.filter(p => !cases.includes(p)), []);

// A case pointing at a function that does not exist fails silently too.
ok('every case has its function',
   cases.filter(p => !new RegExp('function render' +
     p.charAt(0).toUpperCase() + p.slice(1) + '\\(').test(js)), []);

// Nav removed but markup left behind, or the reverse.
ok('no orphan page sections', sections.filter(s => !pages.includes(s)), []);

// --- a class the stylesheet has never heard of --------------------------
// The panel has no utility framework: a class here is either defined in
// admin.css or it does nothing. Both of those have shipped - the Website Text
// boxes carried .form-control, which nothing defined, so they rendered as the
// browser's own white fields on a dark page.
const css = fs.readFileSync(path.join(root, 'admin.css'), 'utf8');
const classes = new Set();
// Static markup, and the classes the panel writes into it at run time.
[...html.matchAll(/class="([^"]+)"/g)].forEach(m =>
  m[1].split(/\s+/).forEach(c => c && classes.add(c)));
[...js.matchAll(/class="([^"${]+)"/g)].forEach(m =>
  m[1].split(/\s+/).forEach(c => c && classes.add(c)));
[...js.matchAll(/className = '([^'${]+)'/g)].forEach(m =>
  m[1].split(/\s+/).forEach(c => c && classes.add(c)));

const unstyled = [...classes].filter(c => !new RegExp('\\.' + c + '\\b').test(css));
console.log('classes in use:', classes.size);
ok('every class the panel uses is styled', unstyled, []);

// --- a colour that does not exist ---------------------------------------
// The language control had colour:var(--text-main) written into it. There is
// no --text-main in this stylesheet, so the label was whatever it inherited —
// which nothing catches, because a bad variable is not an error, it is just
// ignored.
// Comments describe the bug this check exists for, and name the variable that
// caused it, so reading them as code would report the very mistake they
// explain.
const withoutComments = text => text
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...withoutComments(css + html + js)
  .matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
const unknown = [...used].filter(name => !declared.has(name));
console.log('custom properties in use:', used.size);
ok('every var() names one the stylesheet defines', unknown, []);

console.log(failed === 0 ? '\nAll admin page tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

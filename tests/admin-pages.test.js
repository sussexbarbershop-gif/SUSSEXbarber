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

console.log(failed === 0 ? '\nAll admin page tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

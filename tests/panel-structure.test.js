// A stray </div> is the quietest bug HTML has. The browser does not complain —
// it closes whatever was open, carries on, and the page renders. It just
// renders with two of the panel's pages outside .content-area, which is where
// the 32px of padding lives, so those two ran edge to edge and clipped their
// own headings while the other six looked fine.
//
// Nothing looked wrong at the point it went wrong: the extra tag was two
// hundred lines above the pages it broke.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

// Comments blanked, not deleted. A comment can hold <div> — several in here do
// — and counting those reports a document that never balances. But deleting
// them renumbers every line below, and the first version of this test did that
// and then compared two different numbering schemes against each other.
const clean = html.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
const lines = clean.split('\n');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

/** The line a container closes on, counting <div> in and </div> out. */
function closesAt(marker) {
  let depth = 0, started = false;
  for (let i = 0; i < lines.length; i++) {
    if (!started && lines[i].includes(marker)) started = true;
    if (!started) continue;
    depth += (lines[i].match(/<div\b/g) || []).length;
    depth -= (lines[i].match(/<\/div>/g) || []).length;
    if (depth <= 0 && lines[i].includes('</div>')) return i + 1;
  }
  return -1;
}

const lineOf = needle => lines.findIndex(l => l.includes(needle)) + 1;

console.log('--- every page lives inside the padded area ---');
const areaEnd = closesAt('class="content-area"');
ok('content-area closes somewhere', areaEnd > 0, true);

const PAGES = ['bookings', 'week', 'services', 'hours', 'gallery', 'cms',
               'barbers', 'reports'];
const outside = PAGES.filter(id => {
  const at = lineOf(`id="page-${id}"`);
  return at === 0 || at > areaEnd;
});
ok('no page section falls outside it', outside, []);

console.log('--- and the document balances ---');
const opened = (clean.match(/<div\b/g) || []).length;
const closed = (clean.match(/<\/div>/g) || []).length;
ok('every <div> has one </div>', { opened, closed }, { opened, closed: opened });

console.log(failed ? `\n${failed} FAILED` : '\nAll panel structure checks passed.');
process.exit(failed ? 1 : 0);

// Opening the barber picker made the whole page flinch sideways.
//
// holdPage() pins the body with position:fixed so the page behind a sheet does
// not scroll. That takes the body out of flow, and the scrollbar goes with it —
// so the viewport gets wider by the width of the scrollbar and every pixel of
// the page slides across. Then back again on close. On this machine it was 4px
// each way, which is small enough to look like a rendering fault rather than
// something the page did on purpose.
//
// It only happens where scrollbars take up space: a desktop browser. Phones
// overlay them and the gap is zero, which is why nine bookings in ten never saw
// it and it survived this long.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const fn = (html.match(/function holdPage\([\s\S]*?\n        \}/) || [''])[0];
ok('holdPage is still there', fn.length > 0, true);

console.log('--- the gap the scrollbar leaves is measured and filled ---');
// innerWidth counts the scrollbar, clientWidth does not. The difference is it.
ok('the gap is measured',
   /window\.innerWidth\s*-\s*document\.documentElement\.clientWidth/.test(fn), true);
ok('and paid back as padding', /paddingRight\s*=/.test(fn), true);
ok('only when there is one to pay',
   /gutter\s*>\s*0/.test(fn), true);

console.log('--- and given back when the last sheet closes ---');
// Left behind, it is permanent: a strip of dead space down the right of the
// page for the rest of the visit.
const release = fn.slice(fn.indexOf('scrollHolders === 0'));
ok('the padding is cleared on release', /paddingRight\s*=\s*''/.test(release), true);

console.log('--- the pin itself is unchanged ---');
// Counted by plain string, not a built regex: inside a template literal the
// backslash of \. is eaten by the template before RegExp ever sees it, so the
// first version of this quietly searched for "style.positions=" and reported
// four failures against correct code.
['position', 'top', 'left', 'right'].forEach(prop => {
  const times = fn.split('style.' + prop + ' =').length - 1;
  ok(`body.${prop} is set and cleared`, times >= 2, true);
});

console.log('--- and it is still counted, not a flag ---');
// The lightbox can open over a sheet. A boolean let whichever closed first
// release the page for both.
ok('holders are counted', /scrollHolders\s*=\s*Math\.max\(0,/.test(fn), true);

console.log(failed ? `\n${failed} FAILED` : '\nAll scroll lock checks passed.');
process.exit(failed ? 1 : 0);

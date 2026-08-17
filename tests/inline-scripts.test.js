// Does every inline script in every page actually parse?
//
// This exists because of one line. cancel.html grew a `const say` for picking
// between two languages, next to a `const say` that had been setting the
// status line since the page was written. Two consts of one name in one scope
// is a SyntaxError, and a SyntaxError in an inline script throws the *whole*
// script away: not the broken line, all of it.
//
// So the page rendered perfectly. Every heading, every button, the right
// colours — and nothing behind any of it. A customer tapping "cancel" in their
// confirmation email arrived at a page that said "Finding your appointment…"
// for ever.
//
// Every other test in this suite reads these files as text and asks questions
// about the text. All of them passed. Nothing was reading them as code, so
// nothing could tell the difference between a script and a page-length string.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const PAGES = ['index.html', 'privacy.html', 'terms.html', 'cancel.html',
               path.join('admin', 'index.html')];
// The backend too. Everything in here is templated SQL, and a stray backtick
// inside a SQL comment ends the template literal — which is how `booked_at <=
// $2`, written to explain a cast, turned api/daily.js into a syntax error.
// Node would have said so on the next deploy; this says so now.
const FILES = [
  path.join('admin', 'admin.js'),
  path.join('api', 'index.js'),
  path.join('api', 'daily.js'),
  ...fs.readdirSync(path.join(root, 'api', '_lib'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('api', '_lib', f))
];

/** Every <script> with a body, and where in the file it starts. */
function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    // A JSON-LD block is data, not code, and does not parse as a program.
    if (/type="application\/ld\+json"/.test(m[0])) continue;
    if (!m[1].trim()) continue;
    out.push({ code: m[1], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

console.log('--- inline scripts ---');
let checked = 0;
for (const page of PAGES) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) { ok(`${page} exists`, false, true); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const scripts = inlineScripts(html);
  // No assertion that a page has any. terms.html is prose and the admin panel
  // keeps its script in a file; a page with nothing to compile is not a
  // failure, it is a page with nothing to compile.
  scripts.forEach((script, i) => {
    let error = '';
    try {
      // Compiled, not run. Running index.html's script would need a browser;
      // compiling it needs nothing and catches everything a browser would
      // refuse to start.
      new vm.Script(script.code, { filename: `${page}:${script.line}` });
    } catch (err) {
      error = err.message;
    }
    checked++;
    ok(`${page} script ${i + 1} (line ~${script.line}) parses`, error, '');
  });
}

console.log('--- and the files loaded beside them ---');
for (const file of FILES) {
  let error = '';
  try {
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  } catch (err) {
    error = err.message;
  }
  checked++;
  ok(`${file} parses`, error, '');
}

// A regex that stopped matching would make this pass by finding nothing, which
// is the failure mode of every test built on one.
ok('and there was something to compile', checked > 5, true);
console.log(`${checked} scripts compiled`);

// The specific shape of the bug, named so nobody reintroduces it while this
// test is red for some other reason.
console.log('--- one name, one meaning ---');
const cancel = fs.readFileSync(path.join(root, 'cancel.html'), 'utf8');
const declared = [...cancel.matchAll(/\b(?:const|let)\s+(\w+)\s*=/g)].map(m => m[1]);
const twice = declared.filter((name, i) => declared.indexOf(name) !== i);
ok('nothing in cancel.html is declared twice', [...new Set(twice)], []);

console.log(failed === 0 ? '\nAll inline script tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

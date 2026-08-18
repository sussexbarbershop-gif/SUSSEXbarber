// Documentation rots quietly. A file gets renamed and the map still names the
// old one; a test is deleted and the table still recommends reading it; the
// count in the README is whatever it was the day somebody typed it.
//
// None of that breaks a build, and all of it costs the next person more than
// having no documentation would — they act on a confident wrong answer instead
// of going to look.
//
// This checks the half a machine can check: that everything the writing points
// at exists, and that the numbers in it are real. Whether an explanation is
// still *true* is not checkable and stays a human obligation; see AGENTS.md.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const readme = read('README.md');
const agents = read('AGENTS.md');
const migration = read('MIGRATION.md');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- the three documents exist and point at each other ---');
ok('README sends you to AGENTS', readme.includes('AGENTS.md'), true);
ok('AGENTS sends you back to README', agents.includes('README.md'), true);
ok('and to MIGRATION for the setup', agents.includes('MIGRATION.md'), true);

console.log('--- every file the writing names is really there ---');
// Backticked paths that look like files: `api/_lib/rota.js`, `db/schema.sql`.
const named = new Set();
[readme, agents, migration].forEach(doc => {
  const inBackticks = doc.match(/`([\w./-]+\.(?:js|sql|html|css|json|md|yml))`/g) || [];
  inBackticks.forEach(m => named.add(m.replace(/`/g, '')));
  // And markdown links to files in the repo.
  const links = doc.match(/\]\(([\w./-]+\.(?:js|sql|html|css|json|md|yml))\)/g) || [];
  links.forEach(m => named.add(m.slice(2, -1)));
});
// The prose says `db.js` and `mail.js` where a path would read badly, so a
// name with no slash in it is looked for by basename anywhere in the repo.
// That still fails when the file is renamed or deleted, which is the point.
const basenames = new Set();
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    if (e.name === 'node_modules' || e.name === '.git') return;
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else basenames.add(e.name);
  });
})(root);
const missing = [...named].filter(f => f.includes('/')
  ? !fs.existsSync(path.join(root, f))
  : !basenames.has(f));
ok('no file is named that does not exist', missing.sort(), []);

console.log('--- every test the writing recommends is really there ---');
// The README's table names tests without the .test.js, as `rota-agreement`.
const suggested = new Set();
[readme, agents].forEach(doc => {
  (doc.match(/`(tests\/)?([a-z-]+)(\.test\.js)?`/g) || []).forEach(m => {
    const bare = m.replace(/`/g, '').replace(/^tests\//, '').replace(/\.test\.js$/, '');
    if (fs.existsSync(path.join(root, 'tests', bare + '.test.js'))) suggested.add(bare);
  });
});
// Anything the docs present as a test file has to be one.
const asFile = new Set();
[readme, agents, migration].forEach(doc => {
  (doc.match(/tests\/[\w-]+\.test\.js/g) || []).forEach(m => asFile.add(m));
});
const goneTests = [...asFile].filter(f => !fs.existsSync(path.join(root, f)));
ok('no test is recommended that was deleted', goneTests.sort(), []);
ok('and some are recommended at all', suggested.size > 0, true);

console.log('--- the counts are counted, not remembered ---');
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js'));
const claimedFiles = (readme.match(/(\d+) files, run by/) || [])[1];
ok('the file count matches', Number(claimedFiles), testFiles.length);

// Deliberately no check-count assertion. Counting the checks means running
// the suite, and this file is part of the suite — it would run itself. The
// numbers were taken out of README and AGENTS instead: a figure that changes
// on every commit and that nothing can verify is the kind of documentation
// that rots fastest, and a stale one is worse than no figure at all.

console.log('--- and the environment table lists what the code reads ---');
// A variable the code needs and the setup guide never mentions is a shop that
// cannot be stood up again from these instructions.
const source = ['api/index.js', 'api/daily.js', 'api/_lib/db.js', 'api/_lib/mail.js',
                'api/_lib/auth.js', 'api/_lib/limits.js'].map(read).join('\n');
const used = new Set((source.match(/process\.env\.([A-Z_]+)/g) || [])
  .map(m => m.replace('process.env.', '')));
const undocumented = [...used].filter(v => !migration.includes(v));
ok('every environment variable is documented', undocumented.sort(), []);

console.log(failed ? `\n${failed} FAILED` : '\nAll documentation checks passed.');
process.exit(failed ? 1 : 0);

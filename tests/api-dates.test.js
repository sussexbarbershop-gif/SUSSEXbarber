// Dates have to leave the API as 'YYYY-MM-DD' strings, because that is what
// every comparison on the site is written against — `booked_on >= today`, the
// calendar keys, the time-off windows.
//
// The Neon driver returns a `date` column as a JavaScript Date, and stringifying
// one of those gives:
//
//     Fri Aug 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)
//
// Nothing throws. The panel just shows that instead of a date, and every
// string comparison against 'YYYY-MM-DD' quietly stops matching. It reached
// production once; this is here so it cannot do it twice.
//
// A static check rather than a live one: it needs no database, so it runs on
// every commit rather than only when someone remembers to look.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const FILES = ['api/index.js', 'api/_lib/db.js'];
// Every `date` column in db/schema.sql.
const DATE_COLUMNS = ['booked_on', 'starts_on', 'ends_on'];

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const source = {};
FILES.forEach(f => { source[f] = fs.readFileSync(path.join(root, f), 'utf8'); });
const all = Object.values(source).join('\n');
const withoutComments = all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The column lists that actually come back to JavaScript — what follows a
 * SELECT or a RETURNING, up to its FROM or the end of the statement.
 *
 * An INSERT's own column list names the same columns and is not a problem:
 * nothing is read out of it. An earlier version of this test matched any
 * comma, flagged `INSERT INTO time_off (barber_id, starts_on, …)`, and would
 * have had someone "fixing" correct code.
 */
function selectedColumns(src) {
  const out = [];
  const re = /\b(SELECT|RETURNING)\b([\s\S]*?)(\bFROM\b|`|;)/gi;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

console.log('--- date columns are formatted by Postgres, not by JavaScript ---');
const lists = selectedColumns(withoutComments);
DATE_COLUMNS.forEach(col => {
  const bare = new RegExp(`(^|,)\\s*[a-z]*\\.?\\b${col}\\b\\s*(,|$)`, 'i');
  const hits = lists.filter(l => bare.test(l)).map(l => l.trim().replace(/\s+/g, ' ').slice(0, 60));
  ok(`${col} is never selected bare`, hits, []);
});

console.log('--- and never stringified in JavaScript instead ---');
DATE_COLUMNS.forEach(col => {
  const hits = (withoutComments.match(new RegExp(`String\\(\\s*\\w+\\.${col}`, 'g')) || []);
  ok(`String(row.${col}) is not used`, hits, []);
});

console.log('--- a date that does leave is the right shape ---');
// The WHERE clauses compare against these, so the format has to be the one
// Postgres orders and compares dates in.
ok("to_char uses 'YYYY-MM-DD'",
   /to_char\([^)]*'YYYY-MM-DD'\)/.test(all), true);
ok('no other date format is used',
   (all.match(/to_char\([^,]+,\s*'([^']+)'/g) || [])
     .every(s => s.includes('YYYY-MM-DD')), true);

console.log('--- times keep their own format ---');
// booked_at is a `time`, which the driver returns as a string already. It must
// not be run through to_char with a date format by accident.
ok('booked_at is not date-formatted',
   /to_char\(\s*booked_at/.test(all), false);

console.log(failed ? `\n${failed} FAILED` : '\nAll API date checks passed.');
process.exit(failed ? 1 : 0);

// Every booking now points at a customer, and a customer is a phone number.
//
// The shop already identified people that way — it is what "Already booked?"
// searches on and what the per-number booking limit counts — but there was
// nowhere to attach anything to a person. "The tenth cut is free", a promo
// code, a gift card and a discount are all facts about a customer rather than
// about one appointment, and the diary can only answer questions about
// appointments. You can count rows sharing a number; you cannot hang anything
// off the person.
//
// Nothing is built on it yet, deliberately. This checks the foundation is
// sound so that whatever is built on it later starts from something correct.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
const dbjs = fs.readFileSync(path.join(root, 'api', '_lib', 'db.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- one row per person, and the number is the person ---');
ok('the table exists', /CREATE TABLE IF NOT EXISTS customers/.test(schema), true);
// Two rows for one number would split a history in half, which defeats the
// point of having the table at all.
ok('the phone key is unique', /phone_key\s+text NOT NULL UNIQUE/.test(schema), true);
// Plain string, not a regex: the column's own definition contains a backslash,
// and matching that inside a regex literal means escaping it twice — which the
// first version of this line got wrong and reported against correct SQL.
ok('and it is the same nine digits bookings use',
   schema.includes('right(regexp_replace(phone,') && schema.includes(', 9)'), true);

console.log('--- the diary keeps its own copy of everything ---');
// A booking has to stay a complete record on its own: the name and number as
// typed that day, whatever happens to the customer row afterwards.
ok('bookings still hold the name', /customer_name text NOT NULL/.test(schema), true);
ok('and the phone', /\n\s*phone\s+text NOT NULL,/.test(schema), true);

console.log('--- deleting a customer does not delete their history ---');
// CASCADE here would erase the appointments somebody actually came to, which
// is the opposite of what a diary is for.
ok('the link is SET NULL, not CASCADE',
   /customer_id\s+integer REFERENCES customers\(id\) ON DELETE SET NULL/.test(schema), true);

console.log('--- a database that predates the table catches up on its own ---');
// The same trap the earlier columns had: CREATE TABLE IF NOT EXISTS does
// nothing to a live database, and "remember to run some SQL" is not a
// deployment step.
ok('schema.sql alters an existing table',
   /ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id/.test(schema), true);
ok('and the code does it too',
   /ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id/.test(dbjs), true);
ok('the foreign key is added only once',
   /pg_constraint WHERE conname = 'bookings_customer_fk'/.test(schema), true);

console.log('--- everyone already in the diary becomes a customer ---');
[[schema, 'schema.sql'], [dbjs, 'db.js']].forEach(([src, name]) => {
  ok(`${name} backfills from the diary`,
     /INSERT INTO customers \(phone_key[\s\S]{0,400}FROM bookings/.test(src), true);
  // Run twice, do nothing the second time — this is on the path every request
  // takes when the schema is behind.
  ok(`${name} can be re-run`, /ON CONFLICT \(phone_key\) DO NOTHING/.test(src), true);
  ok(`${name} links only the unlinked`,
     /UPDATE bookings b SET customer_id[\s\S]{0,200}customer_id IS NULL/.test(src), true);
});

console.log('--- a booking resolves its customer as it is written ---');
const fn = (dbjs.match(/async function customerFor[\s\S]*?\n}/) || [''])[0];
ok('customerFor exists', fn.length > 0, true);
// Two bookings from the same new number arriving together would both find
// nothing on a SELECT and both insert, and the second would hit the unique
// index. One statement lets the database settle it.
ok('it upserts rather than checking first',
   /INSERT INTO customers[\s\S]{0,300}ON CONFLICT \(phone_key\) DO UPDATE/.test(fn), true);
ok('a later booking refreshes the name',
   /name\s*=\s*COALESCE\(NULLIF\(EXCLUDED\.name, ''\)/.test(fn), true);
// An empty name on one booking must not wipe a good one from an earlier
// booking, which is what a plain EXCLUDED.name would do.
ok('but an empty one does not wipe it', /NULLIF\(EXCLUDED\.name, ''\)/.test(fn), true);
ok('the booking carries the link', /customer_id\)[\s\S]{0,300}\$\{customerId\}/.test(api), true);
// A number that is not one — the shop typing in a walk-in with no phone — must
// still produce a booking.
ok('no number still books', /if \(!key\) return null/.test(fn), true);

console.log('--- and it survives a database that has not caught up ---');
// The first booking on a database without this table is what discovers it is
// missing. Outside withNewSchema the insert throws undefined_table, addBooking
// has no case for that, and the customer is told the booking failed — when it
// had not even been attempted. That is exactly what happened on the live site
// the first time this shipped.
ok('customerFor goes through withNewSchema', /withNewSchema\(/.test(fn), true);

// The same trap for anything else reaching a column the running database may
// not have yet. By name, so one added later is caught here too.
const NEW_COLUMNS = ['customer_id', 'reminded_at', 'review_asked_at'];
const unguarded = [];
api.split(/\n\s*\n/).forEach(block => {
  if (!block.includes('sql`')) return;
  if (block.includes('withNewSchema')) return;
  NEW_COLUMNS.forEach(col => {
    if (new RegExp('\b' + col + '\b').test(block)) unguarded.push(col);
  });
});
ok('no query reaches a new column unguarded', [...new Set(unguarded)], []);

console.log(failed ? `\n${failed} FAILED` : '\nAll customer identity checks passed.');
process.exit(failed ? 1 : 0);

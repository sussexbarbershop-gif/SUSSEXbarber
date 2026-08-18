/**
 * The reminders must not depend on somebody pressing a button.
 *
 * GitHub disables a scheduled workflow in a repository with no activity for
 * sixty days, and this shop's reminders were set off by nothing else. The
 * owner's objection was the correct one: they cannot be expected to notice a
 * date nobody wrote down and press Enable. So the site stands in — an
 * ordinary visitor's request sets the round off when it has gone overdue.
 *
 * That is a fallback, and a fallback nobody watches is the kind of code that
 * quietly stops being true. These are the properties that make it safe rather
 * than a way to email somebody twice.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let failed = 0;
function ok(name, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const api = read('api/index.js');
const dbjs = read('api/_lib/db.js');
const daily = read('api/daily.js');
const nudge = read('.github/workflows/nudge.yml');

console.log('--- the claim is one statement, not a read and then a write ---');
// Ten requests arriving together must produce one round. A SELECT followed by
// an UPDATE lets all ten through, and ten rounds is ten chances of sending
// the same customer their reminder twice.
const claim = (dbjs.match(/async function claimJobRun[\s\S]*?\n}/) || [''])[0];
ok('claimJobRun exists', claim.length > 0, true);
ok('it upserts rather than reading first', /ON CONFLICT \(job\) DO UPDATE/.test(claim), true);
ok('and the update is conditional', /WHERE job_runs\.ran_at < now\(\)/.test(claim), true);
ok('it returns whether it won', /RETURNING job/.test(claim), true);
ok('no SELECT decides it', /SELECT/i.test(claim), false);

console.log('--- it is awaited, not left running after the response ---');
// Work not waited for on a serverless function may be frozen halfway, and half
// a round is emails sent with nothing recording that they were sent.
ok('the handler awaits the stand-in', /await standInForTheClock\(\)/.test(api), true);

console.log('--- and it costs nothing while GitHub is still running ---');
const stale = Number((api.match(/const STALE_MINUTES = (\d+)/) || [])[1]);
const cron = (nudge.match(/cron: '([^']+)'/) || [])[1] || '';
const minutes = (cron.split(' ')[0] || '').split(',').map(Number).sort((a, b) => a - b);
const gap = minutes.length > 1 ? minutes[1] - minutes[0] : 0;
ok('the workflow still runs on a fixed gap', gap > 0, true);
// Comfortably more than one workflow gap, or a single late run from GitHub —
// which is normal, GitHub's scheduler is not punctual — sets off a second
// round for no reason.
ok('stale is well clear of that gap', stale >= gap * 2, true);

console.log('--- the hours it covers are the workflow\'s hours ---');
// Emailing somebody a reminder at four in the morning because a visitor from
// another timezone happened to load the page is worse than not reminding them.
const covered = (api.match(/const COVERED_HOURS = \[(\d+), (\d+)\]/) || []).slice(1).map(Number);
const cronHours = (cron.split(' ')[1] || '').split('-').map(Number);
ok('the stand-in covers the same hours', covered, cronHours);

console.log('--- every round is recorded, however it was set off ---');
// The stand-in wakes on a stale timestamp. A round that runs without writing
// one would be run again half an hour later, and again after that.
ok('runDailyJob records the soon round', /await markJobRun\('soon'\)/.test(daily), true);
ok('and it does so inside the soon branch', 
   daily.indexOf("markJobRun('soon')") > daily.indexOf("if (job === 'soon')"), true);

console.log('--- the table is in both places a table has to be ---');
// A table only in schema.sql never reaches the live database: CREATE TABLE IF
// NOT EXISTS is not run again after the first deploy. See AGENTS.md.
ok('job_runs is in schema.sql', /CREATE TABLE IF NOT EXISTS job_runs/.test(read('db/schema.sql')), true);
ok('and in ensureSchema, so a live database catches up',
   /CREATE TABLE IF NOT EXISTS job_runs/.test(dbjs), true);

console.log(failed ? `\n${failed} FAILED` : '\nAll reminder-fallback tests passed.');
process.exit(failed ? 1 : 0);

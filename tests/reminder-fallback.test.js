/**
 * The reminders must not depend on somebody pressing a button.
 *
 * GitHub disables a scheduled workflow in a repository with no activity for
 * sixty days, and this shop's reminders were set off by nothing else. The
 * owner's objection was the correct one: they cannot be expected to notice a
 * date nobody wrote down and press Enable. So the site stands in — an
 * ordinary visitor's request sets the round off when it has gone overdue.
 *
 * That was written as a net for one rare day. It is not one. The workflow asks
 * GitHub for forty-eight starts a day and got six to eleven over 18-25 August
 * 2026, with gaps up to 176 minutes — so the site stands in most hours of most
 * days, and the comment that used to say it "never fires once" was wrong about
 * the only thing it claimed.
 *
 * What that changes here: this is no longer where correctness lives. A gap
 * wider than the reminder window used to mean a customer nobody wrote to, and
 * the fix for that is in sendReminders(), which widens its window to whatever
 * silence it finds. The stand-in keeps reminders *timely*; the window keeps
 * them *sent*. Both are tested, and the seam between them — the number one
 * hands the other — is the part that would break silently.
 *
 * A fallback nobody watches is the kind of code that quietly stops being true.
 * These are the properties that make it safe rather than a way to email
 * somebody twice.
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

console.log('--- how overdue is overdue ---');
const stale = Number((api.match(/const STALE_MINUTES = (\d+)/) || [])[1]);
const cron = (nudge.match(/cron: '([^']+)'/) || [])[1] || '';
const minutes = (cron.split(' ')[0] || '').split(',').map(Number).sort((a, b) => a - b);
const gap = minutes.length > 1 ? minutes[1] - minutes[0] : 0;
ok('the workflow still asks for a fixed gap', gap > 0, true);
// Clear of the gap the workflow asks for, so a run arriving a few minutes late
// does not set off a second round on top of it. That is all this number is for
// now — it decides how fresh reminders are, not whether they are sent, and
// each firing is paid for by one visitor waiting on it.
ok('stale is clear of the gap that is asked for', stale >= gap * 2, true);

console.log('--- the seam: the silence is read before it is destroyed ---');
const standIn = (api.match(/async function standInForTheClock\(\)[\s\S]*?\n}/) || [''])[0];
// claimJobRun() sets ran_at to now() in the act of winning. Read it after that
// and the answer is always "no time at all" — so the round would go back to a
// one-hour window on exactly the occasions it must not, and the widening in
// sendReminders() would be dead code that still passes its own tests.
ok('the stand-in reads how long it has been', /minutesSinceJobRun\('soon'\)/.test(standIn), true);
ok('before it claims the row',
   standIn.indexOf("minutesSinceJobRun('soon')") < standIn.indexOf("claimJobRun('soon'"), true);
ok('and hands the number to the round',
   /runDailyJob\('soon', silentFor\)/.test(standIn), true);
// Reading first also has to not become the whole check: the claim is still
// what decides, because ten requests can arrive between the read and it.
ok('the claim still decides', /if \(!await claimJobRun\('soon', STALE_MINUTES\)\) return;/.test(standIn), true);

console.log('--- and that read is a read ---');
const since = (dbjs.match(/async function minutesSinceJobRun[\s\S]*?\n}/) || [''])[0];
ok('minutesSinceJobRun exists', since.length > 0, true);
ok('it only selects', /SELECT/.test(since) && !/INSERT|UPDATE|DELETE/.test(since), true);
// A missing row is "never run", not zero minutes: zero would read as a round
// that had just happened and would suppress the very first one.
ok('a table with no row yet answers null', /return Number\.isFinite\(minutes\) \? minutes : null;/.test(since), true);
ok('and the caller treats null as not stale-checked, not as fresh',
   /silentFor !== null && silentFor < STALE_MINUTES/.test(standIn), true);

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

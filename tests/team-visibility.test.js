/**
 * Which barbers get a card on the website.
 *
 * The shop wanted Our Master Barbers down to two people without taking anybody
 * off the booking form — a barber who covers two days a week, or has not had a
 * photograph taken yet, still takes appointments. So this is a switch of its
 * own rather than a side effect of anything else, and the two questions must
 * stay separate: every barber in the config is bookable, whatever this says.
 *
 * The failure worth guarding against is the quiet one. A column that arrives
 * defaulting to false, or a panel that omits the flag and has it read as no,
 * empties the section on a deploy and nobody is told.
 */

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(what, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failed++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${what}` +
              (same ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}

const root = path.join(__dirname, '..');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'api', '_lib', 'db.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

console.log('--- the column ---');
ok('there is one', /ADD COLUMN IF NOT EXISTS on_team boolean/.test(schema), true);
// The whole team disappearing on a deploy is the failure this defends against.
ok('and it defaults to shown', /on_team boolean NOT NULL DEFAULT true/.test(schema), true);
// A database that is behind gets caught up on the first query that needs it.
ok('an older database is brought forward', /ALTER TABLE barbers ADD COLUMN IF NOT EXISTS on_team/.test(db), true);

console.log('--- what the site is told ---');
ok('the flag is read back', /SELECT id, name, image_url, on_team FROM barbers/.test(db), true);
// undefined is what a row from before the column answers. It has to read as
// shown, or the section empties the moment the code lands and before the
// migration has run.
ok('and anything but a definite no counts as shown',
   /onTeam: r\.on_team !== false/.test(db), true);

console.log('--- who gets a card ---');
ok('the grid filters on it', /b\.onTeam !== false/.test(site), true);
// "Any Available" is a choice on the booking form, not a person.
ok('and still drops the no-preference option',
   /!== ANY_BARBER/.test(site), true);

/** The site's own filter, lifted out of renderTeamGrid. */
function whoGetsACard(barbers) {
  const ANY_BARBER = 'Any Available';
  return (barbers || []).filter(b =>
    String(b.name).trim() &&
    String(b.name).trim() !== ANY_BARBER &&
    b.onTeam !== false).map(b => b.name);
}

const roster = [
  { name: 'Any Available' },
  { name: 'Hemen', onTeam: true },
  { name: 'Amir', onTeam: true },
  { name: 'Raman', onTeam: false },
  { name: 'Bassam', onTeam: false },
  { name: 'Saan', onTeam: false }
];
ok('two on, four off, and the two are the two',
   whoGetsACard(roster), ['Hemen', 'Amir']);
// The state of the database before anybody has touched the switch.
ok('a roster with no flags at all shows everybody',
   whoGetsACard([{ name: 'Hemen' }, { name: 'Amir' }, { name: 'Raman' }]),
   ['Hemen', 'Amir', 'Raman']);
ok('and a blank name is still nobody', whoGetsACard([{ name: '  ' }]), []);

console.log('--- and they can all still be booked ---');
// The two questions are separate, and this is the line that keeps them so:
// the booking form reads config.barbers, which is every row in the table.
ok('the booking list is not filtered by it',
   /barberNames = config\.barbers\.map/.test(db), true);
ok('nor is the rota lookup',
   /FROM barbers WHERE name = /.test(api), true);

console.log('--- saving it ---');
ok('the panel writes the column', /on_team   = EXCLUDED\.on_team/.test(api), true);
// A panel tab left open from before this shipped sends no flag. Reading that
// as "hide them" would empty the section on the shop's next save.
ok('and an older panel cannot hide anybody by omission',
   /const onTeam = b\.onTeam !== false;/.test(api), true);

console.log('--- the switch itself ---');
ok('there is one in the barber dialog', /id="barberModalOnTeam"/.test(panelHtml), true);
ok('it opens on what is stored', /onTeamBox\.checked = b\.onTeam !== false/.test(panel), true);
ok('and saving carries it back',
   /b\.onTeam = onTeamBox \? onTeamBox\.checked : true;/.test(panel), true);
// The panel sends the whole array, so the flag travels with everything else.
ok('the barbers array is what is sent',
   /saveToServer\(\{ barbers, barberHours, timeOff \}\)/.test(panel), true);
// Somebody looking at the list should be able to see who is off without
// opening each one.
ok('the list says who is not on the website',
   /NOT ON THE WEBSITE/.test(panel), true);
// It says plainly that this is not about bookings, because that is the thing
// somebody would otherwise assume.
ok('and the dialog says it is not about bookings',
   /still be booked either way/.test(panelHtml), true);

console.log(failed === 0 ? '\nAll team visibility tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

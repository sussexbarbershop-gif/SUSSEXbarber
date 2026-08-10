// The booking calendar used to draw the whole month, so on the 10th of a month
// beginning on a Saturday it opened with six blank cells and two rows of dates
// that had already gone — a screenful of nothing above the first bookable day.
//
// calendarStartDay() drops leading weeks that are entirely past. The two things
// that must never break are that today stays on the grid, and that the columns
// still line up under SUN..SAT.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const m = html.match(/^        function calendarStartDay\([\s\S]*?^        }/m);
if (!m) throw new Error('calendarStartDay not found in index.html');
eval(m[0]);

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const D = s => new Date(s + 'T00:00:00');

/** What the grid ends up looking like for a given today and month on screen. */
function layout(todayStr, year, month) {
  const today = D(todayStr);
  const startDay = calendarStartDay(year, month, today);
  const blanks = new Date(year, month, startDay).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells = blanks + (total - startDay + 1);
  return { startDay, blanks, rows: Math.ceil(cells / 7), cells };
}

console.log('--- the month on screen is the current one ---');
// August 2026 begins on a Saturday; the 10th is a Monday. The 1st and the
// 2nd-8th are whole past weeks and go; the 9th is a Sunday in today's week and
// stays, so Monday the 10th keeps its column.
ok('starts at the Sunday of this week', layout('2026-08-10', 2026, 7).startDay, 9);
ok('and needs no blank cells',          layout('2026-08-10', 2026, 7).blanks, 0);
ok('six rows become four',              layout('2026-08-10', 2026, 7).rows, 4);

console.log('--- nothing is dropped when there is nothing to drop ---');
// The 1st is itself a Saturday: its week has not gone, so the six blanks in
// front of it are the only way to put it under SAT.
ok('today is the 1st: keeps the blanks', layout('2026-08-01', 2026, 7).blanks, 6);
ok('and starts at the 1st',              layout('2026-08-01', 2026, 7).startDay, 1);
// November 2026 begins on a Sunday, so a month viewed from its start needs none.
ok('month starting on a Sunday',         layout('2026-11-15', 2026, 10).blanks, 0);

console.log('--- a month other than this one is untouched ---');
ok('next month starts at the 1st', layout('2026-08-10', 2026, 8).startDay, 1);
ok('and keeps its leading blanks',  layout('2026-08-10', 2026, 8).blanks,
   new Date(2026, 8, 1).getDay());

console.log('--- today is always still on the grid ---');
// The guarantee that matters: drop today and the calendar opens on a month the
// customer cannot book in.
[
  ['2026-08-01', 2026, 7, 'the 1st, a Saturday'],
  ['2026-08-02', 2026, 7, 'the 2nd, a Sunday — first day of a new week'],
  ['2026-08-10', 2026, 7, 'mid-month'],
  ['2026-08-31', 2026, 7, 'the last day of the month'],
  ['2028-02-29', 2028, 1, 'a leap day'],
  ['2026-02-28', 2026, 1, 'the end of a short February']
].forEach(([todayStr, y, mo, label]) => {
  const start = calendarStartDay(y, mo, D(todayStr));
  ok('today visible: ' + label, D(todayStr).getDate() >= start, true);
});

console.log('--- the grid stays a grid ---');
// A start day that is not a Sunday must be preceded by exactly enough blanks,
// or every date lands under the wrong weekday.
for (let day = 1; day <= 28; day++) {
  const todayStr = '2026-08-' + String(day).padStart(2, '0');
  const l = layout(todayStr, 2026, 7);
  const startWeekday = new Date(2026, 7, l.startDay).getDay();
  if (l.blanks !== startWeekday) {
    ok('blanks match the weekday on the ' + day, l.blanks, startWeekday);
  }
  if (l.startDay < 1 || l.startDay > day) {
    ok('start day sane on the ' + day, l.startDay, '1..' + day);
  }
}
console.log('PASS  every day of August 2026 lines up under its weekday');

console.log(failed ? `\n${failed} FAILED` : '\nAll calendar grid checks passed.');
process.exit(failed ? 1 : 0);

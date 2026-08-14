// Static checks over admin.js for the mistakes that fail quietly in a browser:
// a template reading a field that does not exist renders an empty cell, and an
// onclick naming a function that does not exist only breaks when clicked.
//
// Both were live: the whole Bookings table read b.name/b.phone/b.service/
// b.barber when the objects carry customerName/customerPhone/serviceName/
// barberName, and its buttons called deleteBooking(BK-100) unquoted.
const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

// Comments describe the bugs these checks exist for, so reading them as code
// would report the very mistakes they explain. Only whole-line comments are
// stripped: `accept="image/*"` is not the start of a block comment, and
// treating it as one swallowed a third of the file.
const js = raw.split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// --- the shape fetchLiveBookings() actually produces -------------------
const mapper = js.match(/bookings = data\.map\(\(b, idx\) => \(\{([\s\S]*?)\}\)\)/);
const bookingFields = mapper
  ? [...mapper[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1])
  : [];
console.log('a booking has:', bookingFields.join(', '));
ok('the mapper was found', bookingFields.length > 0, true);

// Anything reading `b.<field>` must name one of those. Only look inside the
// render functions that draw bookings; `b` means a barber elsewhere.
const bookingRenderers = ['renderBookings', 'renderWeeklyPlannerGrid',
                          'exportBookingsCSV', 'forChosenBarber',
                          'updateUpcomingBadge'];
const unknownReads = [];
bookingRenderers.forEach(name => {
  const fn = (js.match(new RegExp('^(?:async )?function ' + name + '\\([\\s\\S]*?^}', 'm')) || [''])[0];
  [...fn.matchAll(/\bb\.(\w+)/g)].forEach(m => {
    if (!bookingFields.includes(m[1]) && !unknownReads.includes(name + '.' + m[1])) {
      unknownReads.push(name + '.' + m[1]);
    }
  });
});
ok('no render reads a field a booking does not have', unknownReads, []);

// --- every onclick must name a function that exists --------------------
const defined = new Set([...js.matchAll(/^\s*(?:async\s+)?function (\w+)/gm)].map(m => m[1]));
const called = new Set();
[...js.matchAll(/on(?:click|change|submit)="(\w+)\(/g)].forEach(m => called.add(m[1]));
[...html.matchAll(/on(?:click|change|submit)="(\w+)\(/g)].forEach(m => called.add(m[1]));
ok('every handler exists', [...called].filter(f => !defined.has(f)), []);

// --- a booking id in an onclick must be quoted -------------------------
// Booking ids look like "BK-100". `deleteBooking(${b.id})` rendered as
// deleteBooking(BK-100), which is a reference error, so the button did
// nothing at all. Service and gallery ids are numbers and are fine bare.
const unquoted = [...js.matchAll(/on\w+="(\w+)\(\$\{(?:escape\w+\()?b\.id/g)]
  .filter(m => !/on\w+="\w+\('\$\{/.test(m[0]))
  .map(m => m[1]);
ok('no bare booking id in a handler', unquoted, []);

// --- filters the UI offers must be ones the code handles ---------------
const offered = [...html.matchAll(/data-filter="([^"]+)"/g)].map(m => m[1]).sort();
const chooses = (js.match(/function visibleBookings\(\)[\s\S]*?^}/m) || [''])[0];
const unhandled = offered.filter(f => f !== 'all' && !chooses.includes(`'${f}'`));
console.log('booking filters:', offered.join(', '));
ok('every filter tab does something', unhandled, []);

// The export must send what the page is showing. It used to take the whole
// diary, so a barber who had narrowed the list to their own week exported the
// entire shop's year without being told.
const exporter = (js.match(/function exportBookingsCSV\(\)[\s\S]*?^}/m) || [''])[0];
ok('the export takes the visible list', /visibleBookings\(\)/.test(exporter), true);
ok('and not the raw diary', /\bconst rows = bookings\b/.test(exporter), false);

// The tab that is lit has to be set before any early return. It used to be
// the last thing renderBookings() did, after a `return` taken whenever the
// filter matched nothing — so tapping Today on a quiet day left the highlight
// where it was and the button looked broken rather than the day looking empty.
const draws = (js.match(/function renderBookings\(\)[\s\S]*?^}/m) || [''])[0];
const litAt = draws.indexOf("classList.toggle('active'");
const emptyReturn = draws.indexOf('Nothing here');
ok('the active tab is set', litAt !== -1, true);
ok('and the empty state exists to return to', emptyReturn !== -1, true);
ok('the tab is lit before the early return', litAt < emptyReturn, true);

// --- the Add Booking dialog -------------------------------------------
//
// It is the only place in the panel that writes a booking, and every failure
// it can have is quiet: a chip whose click handler does not exist looks like a
// chip that will not select, and a request sent without the password comes
// back "Unauthorized" with no clue which of the two things was missing.
console.log('--- taking a booking over the phone ---');
const dialog = (html.match(/<div class="modal-overlay" id="shopBookingModal"[\s\S]*?\n    <\/div>/) || [''])[0];
ok('the dialog is in the page', dialog !== '', true);
ok('and a button opens it', /onclick="openShopBookingModal\(\)"/.test(html), true);

// Every field the server requires has to be on the form, or the refusal
// arrives from the server as a sentence about something the user cannot see.
['shopBookService', 'shopBookBarber', 'shopBookDate', 'shopBookName',
 'shopBookPhone', 'shopBookEmail', 'shopBookTimes'].forEach(id => {
  ok(`${id} is there`, dialog.includes(`id="${id}"`), true);
});

const submit = (js.match(/async function submitShopBooking\([\s\S]*?^}/m) || [''])[0];
ok('it posts the shop action', /action: 'addBookingByShop'/.test(submit), true);
// Signed with the panel password. Not the PIN: taking a booking is the work,
// and a barber answering the phone must not have to find the owner.
ok('signed with the password', /password: adminPassword/.test(submit), true);
ok('and not with the owner\'s pass', /asOwner\(/.test(submit), false);
// Every id the form collects has to be read back out again, or the field is
// decoration.
['shopBookService', 'shopBookBarber', 'shopBookDate', 'shopBookName',
 'shopBookPhone', 'shopBookEmail'].forEach(id => {
  ok(`${id} is sent`, submit.includes(id), true);
});
ok('and so is the chosen time', /shopBookingTime/.test(submit), true);
// Two taps on a slow connection is two bookings.
ok('the button locks while it is in flight', /submit\.disabled = true/.test(submit), true);
ok('and unlocks whatever happens', /finally \{[\s\S]*?submit\.disabled = false/.test(submit), true);
// The diary on screen is a minute old the moment a booking lands.
ok('the list is reloaded afterwards', /fetchLiveBookings\(\)/.test(submit), true);

const loader = (js.match(/async function loadShopBookingTimes\([\s\S]*?^}/m) || [''])[0];
// The panel does not work out which times exist. index.html has its own copy
// of the rota logic and rota-agreement.test.js keeps it honest; a third copy
// here would be a third thing to keep in step, and it would drift silently.
ok('the times come from the server', /slots=1/.test(loader), true);
ok('including ones already past', /past=1/.test(loader), true);
ok('a chip handler exists', /function chooseShopBookingTime\(/.test(js), true);
ok('and the chips call it', /onclick="chooseShopBookingTime\(/.test(loader), true);
// Change the date twice quickly and the first answer can land last.
ok('out-of-order answers are dropped', /mine !== shopBookingTimesToken/.test(loader), true);
// A grid drawn from a failed request would show every slot free.
ok('a failed request draws nothing', /Could not reach the server/.test(loader), true);

// --- the dropdowns the panel draws itself ------------------------------
//
// A native <select> opens a list drawn by the operating system, so its
// typeface, its padding and its blue highlight are Windows's and macOS's. CSS
// reaches the closed box and nothing inside the open one.
//
// The whole design rests on one thing: the <select> is still there. It keeps
// the options, it keeps the value, and it still fires `change` — so every
// caller that reads select.value or hangs an onchange off it carries on
// working, and nothing else in the file had to learn about any of this. If
// that ever stops being true, the barber filter silently stops filtering.
console.log('--- dropdowns ---');
const picker = (js.match(/function buildPicker\([\s\S]*?^}/m) || [''])[0];
const wiring = (js.match(/function wirePicker\([\s\S]*?^}/m) || [''])[0];

ok('the select is kept, not replaced', /picker\.appendChild\(select\)/.test(picker), true);
ok('and the change event is still fired',
   /select\.dispatchEvent\(new Event\('change'/.test(wiring), true);
ok('from the select itself, which is what everything listens to',
   /select\.selectedIndex = Number\(/.test(wiring), true);

// Called wherever options are written, or the list shows yesterday's barbers.
const filters = (js.match(/function renderBarberFilters\(\)[\s\S]*?^}/m) || [''])[0];
ok('the barber filters get one', /buildPicker\(select\)/.test(filters), true);
const opener = (js.match(/function openShopBookingModal\(\)[\s\S]*?^}/m) || [''])[0];
ok('the service list gets one', /buildPicker\(service\)/.test(opener), true);
ok('the barber list gets one', /buildPicker\(barber\)/.test(opener), true);
// It has to be safe to call twice: both of those run every time.
ok('and calling it again repaints rather than nesting',
   /classList\.contains\('picker'\)/.test(picker), true);

// A control that a mouse can use and a keyboard cannot is not finished.
['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End'].forEach(key => {
  ok(`${key} is handled`, wiring.includes(`'${key}'`), true);
});
ok('Tab moves on rather than being swallowed', /e\.key === 'Tab'/.test(wiring), true);
// Escape belongs to the innermost open thing.
ok('and Escape is not passed up to the dialog', /stopPropagation/.test(wiring), true);
ok('clicking elsewhere closes it', /closeOtherPickers\(null\)/.test(js), true);
ok('and two are never open at once', /closeOtherPickers\(picker\)/.test(js), true);

// The <label for> points at a select nothing can see any more.
ok('the button carries the field\'s name',
   /setAttribute\('aria-label'/.test(js), true);
ok('the list says what it is', /role="listbox"/.test(js), true);
ok('and each row does', /role="option"/.test(js), true);
ok('with the chosen one marked', /aria-selected="\$\{i === chosen\}"/.test(js), true);
ok('and the button says whether it is open', /aria-expanded/.test(js), true);
// display:none on a required field makes the browser refuse to submit with an
// error nobody can see the cause of.
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.css'), 'utf8');
const native = (cssSrc.match(/select\.picker-native \{([^}]*)\}/) || ['', ''])[1];
ok('the hidden select is still focusable', /display:\s*none/.test(native), false);
ok('and is out of the way', /opacity:\s*0/.test(native), true);

console.log(failed === 0 ? '\nAll wiring tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Whether the website is taking bookings at all.
 *
 * The shop went on Google Maps before the website was ready, and people
 * arrived and booked. So online booking is closed until the panel opens it,
 * and the important word there is *closed* rather than *hidden*: a form is
 * markup, and the address it posts to is public. Hiding it would have left
 * every one of those bookings arriving exactly as before, with the shop no
 * longer able to see the form that sent them.
 *
 * Three things have to hold together, and the ones worth guarding are the
 * quiet failures: a setting that reads as open when it has never been written,
 * a save that prunes it back to absent, and the shop losing its own way of
 * taking an appointment because the public form was shut.
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
const api = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

/** The server's own reading of the setting, lifted out. */
const bookingIsOpen = new Function(
  api.match(/function bookingIsOpen\(config\)[\s\S]*?\n\}/)[0] + '; return bookingIsOpen;')();

console.log('--- what counts as open ---');
// Absent is the case that matters. This shipped on the day the shop asked for
// the form to be closed, so a settings table that has never heard of the key
// is one from before they opened it. Reading that as open would have let every
// booking through on the deploy that was meant to stop them.
ok('a key that was never written', bookingIsOpen({ settings: {} }), false);
ok('an empty value', bookingIsOpen({ settings: { booking_open: '' } }), false);
ok('the word no', bookingIsOpen({ settings: { booking_open: 'no' } }), false);
ok('and no config at all', bookingIsOpen({}), false);
ok('the word yes', bookingIsOpen({ settings: { booking_open: 'yes' } }), true);
// However the panel or a person happens to type it.
ok('with spaces and capitals', bookingIsOpen({ settings: { booking_open: ' Yes ' } }), true);
// Not a boolean-ish guess: only the word the panel writes.
ok('true is not yes', bookingIsOpen({ settings: { booking_open: 'true' } }), false);
ok('nor is 1', bookingIsOpen({ settings: { booking_open: '1' } }), false);

console.log('--- the refusal is the server\'s, not the form\'s ---');
// A hidden form is a form anybody can still post to.
ok('every booking passes the gate',
   /if \(!byShop && !bookingIsOpen\(config\)\)/.test(api), true);
ok('and is told what to do instead',
   /Please call the shop and we will book you in/.test(api), true);
// It sits in refuseBooking, which runs before anything is written.
ok('before a row is written',
   /async function refuseBooking[\s\S]{0,900}bookingIsOpen\(config\)/.test(api), true);

console.log('--- but the shop can still take one ---');
// The panel books over the phone through the same code with byShop set. That
// has to keep working: the reason the public form is closed is that the shop
// is taking appointments another way for now.
ok('the shop\'s own bookings are not refused', bookingIsOpen && /!byShop &&/.test(api), true);
ok('and the panel still calls that path',
   /addBookingByShop|addBooking\(payload, res, true\)/.test(api), true);

console.log('--- the setting cannot be lost ---');
// Saving Website Text prunes every key the panel did not send. Losing this one
// would silently reopen or close the form depending on which way the default
// fell — which is exactly the kind of thing nobody would connect to a save.
ok('a Website Text save cannot prune it',
   /KEPT_SETTINGS = \['visit_count', 'cancel_key', 'booking_open'\]/.test(api), true);
// And the panel writes it explicitly either way, so it stops being absent the
// first time that page is saved.
ok('the panel writes a value both ways',
   /next\.booking_open = openBox\.checked \? 'yes' : 'no';/.test(panel), true);

console.log('--- what a customer sees while it is closed ---');
ok('a notice in place of the form', /id="bookingClosed"/.test(site), true);
ok('and the form is what gets hidden',
   /form\.classList\.toggle\('hidden', !open\)/.test(site), true);
// The shop's number, so the visit is not simply lost.
ok('with the shop\'s number to call',
   /id="bookingClosed"[\s\S]{0,1400}cms-contact-phone-link/.test(site), true);
// It follows the settings like every other number on the page.
ok('which follows the panel too',
   /id="bookingClosed"[\s\S]{0,2200}class="cms-contact-phone"/.test(site), true);
// Both languages, because the site is EN and NL and the shop should not have
// to write Dutch to close a form.
ok('in Dutch as well', /'Online reserveren opent binnenkort'/.test(site), true);
ok('including the line under it',
   /We zijn alles aan het klaarmaken/.test(site), true);

console.log('--- and what still works while it is closed ---');
// Somebody who already booked has to be able to find and cancel it.
ok('the lookup is not hidden with the form',
   /id="lookupDisclosure"[\s\S]{0,200}hidden/.test(site), false);

console.log('--- the switch ---');
ok('there is one in the panel', /id="cms_booking_open"/.test(panelHtml), true);
ok('it opens on what is stored',
   /openBox\.checked = String\(settings\.booking_open \|\| ''\)/.test(panel), true);
// It decides whether customers can book, so it goes above the page's text.
ok('and it is the first thing on that page',
   /Online Booking[\s\S]{0,700}cms_booking_open[\s\S]{0,900}cms-label">1\./.test(panelHtml), true);
// The wording has to say that phone bookings are unaffected, because that is
// the thing somebody would otherwise assume it does.
ok('saying plainly that phone bookings still work',
   /take bookings\s*over the phone/.test(panelHtml), true);

console.log(failed === 0 ? '\nAll booking-open tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

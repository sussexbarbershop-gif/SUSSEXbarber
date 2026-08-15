// Every email in the language the customer was reading.
//
// The shop is in Wassenaar and most of its customers are Dutch, but the site
// opens in English and they have to press EN/NL to change it. The page has
// always known which they pressed; it simply never said, so a Dutch customer
// booked in Dutch and was then written to in English four times.
//
// The risk in a change like this is not that the translation is wrong — it is
// that half of one message is translated and the other half is not, which
// nothing notices because both halves are strings. So this renders every email
// in both languages and checks that nothing English survives into the Dutch
// one, and that the parts which must not be translated — a time, a name, a
// URL, a token — come through untouched.
const path = require('path');

process.env.RESEND_API_KEY = 'test';
process.env.MAIL_FROM = 'Sussex Barber Shop <booking@sussexbarber.nl>';
process.env.SITE_URL = 'https://sussexbarber.nl';

let outbox = [];
global.fetch = async (url, opts) => {
  outbox.push(JSON.parse(opts.body));
  return { ok: true, status: 200, text: async () => '' };
};

const mail = require(path.join(__dirname, '..', 'api', '_lib', 'mail.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const config = { settings: {
  contact_phone: '+31 6 53730803',
  contact_address: 'Van Hogendorpstraat 10<br>2242 KZ Wassenaar'
} };

const booking = (lang, patch) => Object.assign({
  name: 'Ahmed', email: 'a@example.com',
  date: '2026-08-20', time: '02:30 PM',
  service: 'Skin Fade', barber: 'Saan', lang,
  cancelToken: '41.' + 'a'.repeat(32)
}, patch);

/** Send one and hand back what went over the wire. */
async function sent(fn, lang, patch, extra) {
  outbox = [];
  await fn(booking(lang, patch), config, extra);
  return outbox[0];
}

const EMAILS = [
  ['confirmation', mail.sendCustomerConfirmation, undefined],
  ['reminder',     mail.sendReminder,             undefined],
  ['cancellation', mail.sendCustomerCancellation, undefined],
  ['review',       mail.sendReviewRequest,        'https://g.page/r/example']
];

// Words that would only appear in an English sentence. Deliberately not "at"
// or "in" — those occur inside Dutch words and inside HTML attributes — and
// not "Service" or "Was", which are spelled the same in both.
const ENGLISH_GIVEAWAYS =
  /\b(Hello|your appointment|is booked|Thank you|please|cannot|Cancel this|Book another|See you|nothing to do|we hope|review helps|reply to this|a reminder)\b/i;

// And the other way: a Dutch phrase leaking into the English one.
const DUTCH_GIVEAWAYS =
  /\b(Hallo|afspraak|Bedankt|annuleren|geannuleerd|herinnering|kunt u|hoeft u|Tot snel|Tot straks|uw bezoek)\b/i;

async function main() {
  console.log('--- both languages, all four emails ---');
  for (const [name, fn, extra] of EMAILS) {
    const en = await sent(fn, 'en', {}, extra);
    const nl = await sent(fn, 'nl', {}, extra);

    ok(`${name}: both are sent`, [!!en, !!nl], [true, true]);
    ok(`${name}: the subject differs`, en.subject !== nl.subject, true);
    ok(`${name}: and so does the body`, en.text !== nl.text, true);
    // Both parts, always. A client that will not render HTML falls back to the
    // text one, and a message sent as HTML alone arrives at those as nothing.
    ok(`${name}: html and text in each`,
       [!!en.html, !!en.text, !!nl.html, !!nl.text], [true, true, true, true]);

    // The one that actually catches a half-finished translation.
    ok(`${name}: no English left in the Dutch subject`,
       ENGLISH_GIVEAWAYS.test(nl.subject), false);
    ok(`${name}: nor in the Dutch text`, ENGLISH_GIVEAWAYS.test(nl.text), false);
    // The HTML shell holds the shop's address and the site's own name, which
    // are not translated and must not be. Only the written sentences are read.
    const nlProse = nl.html.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
    ok(`${name}: nor in the Dutch page`, ENGLISH_GIVEAWAYS.test(nlProse), false);

    ok(`${name}: no Dutch left in the English one`,
       DUTCH_GIVEAWAYS.test(en.subject + ' ' + en.text), false);
  }

  console.log('--- what must not be translated ---');
  const nl = await sent(mail.sendCustomerConfirmation, 'nl');
  // A date and a person's name are the same in every language, and a
  // translation layer that touches them is one that will one day rewrite
  // somebody's name.
  ok('the date', /2026-08-20/.test(nl.text), true);
  ok('the customer\'s name', /Ahmed/.test(nl.text), true);
  ok('the barber\'s name', /Saan/.test(nl.text), true);
  ok('the shop\'s name', /Sussex Barber Shop/.test(nl.html), true);
  ok('the service, which is the shop\'s own wording', /Skin Fade/.test(nl.text), true);

    console.log('--- the clock ---');
  // The diary speaks twelve-hour time because the booking form does, and the
  // form does because the site was written in English. The Netherlands does
  // not use it: "om 02:30 PM" is not a time a Dutch customer reads without
  // stopping, and half past two in the morning is a real reading of it.
  ok('Dutch gets a 24-hour clock', /14:30/.test(nl.text), true);
  ok('and no AM or PM at all', /\b(AM|PM)\b/.test(nl.text), false);
  ok('nor in the subject', /\b(AM|PM)\b/.test(nl.subject), false);
  ok('nor on the page', /\b(AM|PM)\b/.test(nl.html), false);

  const nlEvening = await sent(mail.sendReminder, 'nl', { time: '05:30 PM' });
  ok('the last slot of the day', /17:30/.test(nlEvening.text), true);
  const nlMorning = await sent(mail.sendReminder, 'nl', { time: '10:00 AM' });
  ok('and the first', /10:00/.test(nlMorning.text), true);
  // The two that a naive conversion gets wrong.
  const nlNoon = await sent(mail.sendReminder, 'nl', { time: '12:30 PM' });
  ok('half past twelve is midday, not midnight', /12:30/.test(nlNoon.text), true);
  const nlMidnight = await sent(mail.sendReminder, 'nl', { time: '12:15 AM' });
  ok('and quarter past twelve at night is 00:15', /00:15/.test(nlMidnight.text), true);

  // English is left exactly as the site shows it.
  const enTime = await sent(mail.sendReminder, 'en');
  ok('English keeps the clock the site uses', /02:30 PM/.test(enTime.text), true);

  console.log('--- the cancel link ---');
  ok('is in the Dutch email', /cancel\.html\?b=41\./.test(nl.text), true);
  // The page it lands on reads this and paints itself Dutch. Without it a
  // Dutch customer taps a Dutch button and arrives somewhere English.
  ok('and says which language to arrive in', /&l=nl/.test(nl.text), true);
  const en = await sent(mail.sendCustomerConfirmation, 'en');
  ok('the English one says so too', /&l=en/.test(en.text), true);
  // In the text part it is a plain URL; in the HTML it is inside an
  // attribute, so the ampersand has to be escaped there and only there.
  ok('escaped in the html', /&amp;l=nl/.test(nl.html), true);
  ok('and raw in the text', /&l=nl/.test(nl.text) && !/&amp;/.test(nl.text), true);

  console.log('--- anything unfamiliar is English ---');
  // A booking taken before the column existed, one the shop typed in, one with
  // nonsense in the field. English is the safer default of the two: a Dutch
  // customer reads it, an English-speaking one cannot read the other.
  for (const value of [undefined, '', 'de', 'NL-BE', 'en', 42, null]) {
    const out = await sent(mail.sendCustomerConfirmation, value);
    const dutch = DUTCH_GIVEAWAYS.test(out.subject + ' ' + out.text);
    ok(`lang=${JSON.stringify(value)} is English`, dutch, false);
  }
  // Except the one spelling that is not nonsense, however it is cased.
  for (const value of ['nl', 'NL', 'Nl']) {
    const out = await sent(mail.sendCustomerConfirmation, value);
    ok(`lang=${JSON.stringify(value)} is Dutch`, /Hallo/.test(out.text), true);
  }

  console.log('--- and nobody is thanked by the wrong name ---');
  // 'Any Available' is a sentinel, not a person. "we hope Any Available looked
  // after you" is not a sentence, so the review email leaves the name out.
  const anon = await sent(mail.sendReviewRequest, 'nl', { barber: '' }, 'https://g.page/r/x');
  ok('the review email drops the barber when there is none',
     /Elke Beschikbare|Any Available/.test(anon.text), false);
  // But the confirmation names it, because there the customer needs to know
  // that nobody in particular was chosen.
  const anyBarber = await sent(mail.sendCustomerConfirmation, 'nl', { barber: '' });
  ok('the confirmation names it, in Dutch', /Elke Beschikbare Kapper/.test(anyBarber.text), true);
  const anyEn = await sent(mail.sendCustomerConfirmation, 'en', { barber: '' });
  ok('and in English', /Any Available/.test(anyEn.text), true);

  console.log('--- the page the button leads to ---');
  const fs = require('fs');
  const page = fs.readFileSync(path.join(__dirname, '..', 'cancel.html'), 'utf8');
  ok('reads the language off the link', /params\.get\('l'\) === 'nl'/.test(page), true);
  // The English is written into the markup so the page reads correctly before
  // any script runs; only the Dutch has to be painted on.
  ok('and the English is in the markup', /Cancel this appointment\?/.test(page), true);
  ok('with the Dutch beside it', /Deze afspraak annuleren\?/.test(page), true);
  // Every word the script swaps has to have somewhere to go, and every hook in
  // the markup has to have a word.
  const words = [...page.matchAll(/^\s{16}(\w+):\s*\[/gm)].map(m => m[1]);
  const hooks = [...page.matchAll(/data-word="(\w+)"/g)].map(m => m[1]);
  ok('every hook has a word', hooks.filter(h => !words.includes(h)), []);
  ok('and the list is not empty', words.length > 10, true);

  console.log(failed === 0 ? '\nAll email language tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

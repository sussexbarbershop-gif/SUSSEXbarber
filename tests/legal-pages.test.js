// The privacy page and the terms page.
//
// Both footer links were href="#" — they went nowhere, and had gone nowhere
// for as long as the site had been taking names, phone numbers and email
// addresses from people in the Netherlands. Nothing on screen looked broken,
// which is why it lasted.
//
// The risk now is the opposite one: two pages nobody looks at again while the
// site around them changes. So this checks the things that would rot quietly —
// a page that describes an email the shop no longer sends, a stylesheet that
// was never rebuilt to know about them, a link back to a home page that has
// moved.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const index = read('index.html');
const privacy = read('privacy.html');
const terms = read('terms.html');
const css = read('assets/tailwind.css');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- the footer links go somewhere ---');
ok('privacy is linked', /href="\/privacy\.html"/.test(index), true);
ok('terms is linked', /href="\/terms\.html"/.test(index), true);
// The exact shape they were in for months.
const footer = (index.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
ok('and neither is a dead anchor any more', /href="#"/.test(footer), false);
ok('both pages exist',
   [fs.existsSync(path.join(root, 'privacy.html')),
    fs.existsSync(path.join(root, 'terms.html'))], [true, true]);

console.log('--- and lead back ---');
[['privacy', privacy], ['terms', terms]].forEach(([name, page]) => {
  ok(`${name} links home`, /href="\/"/.test(page), true);
  ok(`${name} links the other one`, page.includes(name === 'privacy' ? '/terms.html' : '/privacy.html'), true);
  ok(`${name} has a title`, /<title>[^<]+<\/title>/.test(page), true);
  ok(`${name} has a description`, /<meta name="description" content="[^"]+"/.test(page), true);
  ok(`${name} has a canonical`, /<link rel="canonical" href="https:\/\/sussexbarber\.nl\//.test(page), true);
  // Both languages in full, one after the other, rather than a toggle. The
  // rest of the site translates itself with a dropdown; a page somebody may
  // need to point at later should not depend on how a switch was left.
  ok(`${name} is in Dutch as well`, /lang="nl"/.test(page), true);
});

console.log('--- the same address, on every page that names it ---');
// A canonical on one host and a link on another is how a site gets indexed
// twice and ranked as neither.
const hostOf = page => (page.match(/<link rel="canonical" href="(https?:\/\/[^/"]+)/) || [])[1];
ok('all three agree', [...new Set([hostOf(index), hostOf(privacy), hostOf(terms)])],
   ['https://sussexbarber.nl']);

console.log('--- and the sitemap lists them ---');
const sitemap = read('sitemap.xml');
ok('privacy', sitemap.includes('<loc>https://sussexbarber.nl/privacy.html</loc>'), true);
ok('terms', sitemap.includes('<loc>https://sussexbarber.nl/terms.html</loc>'), true);
ok('every <url> is closed',
   (sitemap.match(/<url>/g) || []).length === (sitemap.match(/<\/url>/g) || []).length, true);

console.log('--- they are styled ---');
// assets/tailwind.css is built ahead of time and committed, so a class used on
// a page the build was never told about compiles to nothing. The page still
// renders — as unstyled text, which looks exactly like a broken site, on the
// two pages a customer is most entitled to take seriously.
const config = require(path.join(root, 'tailwind.config.js'));
ok('the build knows about privacy.html', config.content.includes('./privacy.html'), true);
ok('the build knows about terms.html', config.content.includes('./terms.html'), true);

const selectorFor = cls => '.' + cls.replace(/([.:[\]()/!#%,'"+*~^$=<>&|{}?])/g, '\\$1');
const classesIn = page => {
  const used = new Set();
  for (const m of page.matchAll(/class="([^"]*)"/g)) {
    m[1].split(/\s+/).forEach(c => { if (c) used.add(c); });
  }
  return used;
};
// cms-contact-phone is a querySelectorAll target, not a utility.
const isHook = c => c.startsWith('cms-') || c === 'dark';
[['privacy', privacy], ['terms', terms]].forEach(([name, page]) => {
  const missing = [...classesIn(page)]
    .filter(c => !isHook(c) && !css.includes(selectorFor(c))).sort();
  ok(`${name} uses no class the stylesheet lacks`, missing, []);
});

console.log('--- what the privacy page claims is what the code does ---');
const mail = read(path.join('api', '_lib', 'mail.js'));
const daily = read(path.join('api', 'daily.js'));

// Every email the shop can send to a customer has to be listed. One that is
// sent and not described is the failure that matters; one that is described
// and no longer sent is a smaller lie but still a lie.
ok('the confirmation is described', /confirmation when the booking is made/i.test(privacy), true);
ok('and there is one to send', /sendCustomerConfirmation/.test(mail), true);
ok('the reminder is described', /reminder on the morning/i.test(privacy), true);
ok('and there is one to send', /async function sendReminder/.test(mail), true);
ok('the cancellation note is described', /if the appointment is cancelled/i.test(privacy), true);
ok('and there is one to send', /sendCustomerCancellation/.test(mail), true);
ok('the review request is described', /thank-you a few hours after/i.test(privacy), true);
ok('and there is one to send', /async function sendReviewRequest/.test(mail), true);
// It says "a few hours after your appointment", so the job has to be asking
// about the day it is running on, and only about appointments already over.
ok('and it really is the same day', /askForReviews\(sql, config, today/.test(daily), true);
ok('once the chair is empty', /askingCutoff\(\)/.test(daily), true);

// The cancel button is a link in an email that changes something. A privacy
// page that does not mention it is describing a different product.
ok('the cancel link is described', /link for cancelling that one appointment/i.test(privacy), true);
ok('in Dutch too', /link om die ene afspraak te annuleren/i.test(privacy), true);
ok('and one is really sent', /cancel\.html\?b=/.test(mail), true);

// The claim that costs the most if it is wrong.
ok('it says there is no tracking', /no advertising cookies|geen advertentiecookies/i.test(privacy), true);
const site = index;
ok('and the page loads no analytics',
   /googletagmanager|google-analytics|gtag\(|fbq\(|hotjar|plausible|matomo/i.test(site), false);

// The map is the one thing on the site that reaches another company while a
// visitor is reading, so it is the one thing that has to be disclosed.
ok('the map is disclosed', /policies\.google\.com\/privacy/.test(privacy), true);
ok('and the site really does embed one', /google\.com\/maps\/embed/.test(site), true);
// Whereas the legal pages themselves must not, or the disclosure would have to
// be about them too.
ok('the privacy page embeds nothing', /<iframe/.test(privacy), false);
ok('nor does the terms page', /<iframe/.test(terms), false);

// The processors named have to be the ones actually in use.
ok('Neon is named', /Neon/.test(privacy), true);
ok('Vercel is named', /Vercel/.test(privacy), true);
ok('and the mail provider is the one configured', /Resend/.test(privacy), true);

console.log('--- and the terms match the rules the server enforces ---');
const api = read(path.join('api', 'index.js'));
ok('a half-hour slot', /half-hour slot|half uur/i.test(terms), true);
ok('which is what the code uses', /SLOT_MINUTES = 30/.test(read(path.join('api', '_lib', 'rota.js'))), true);
ok('a limit per phone number is mentioned', /limited number of appointments/i.test(terms), true);
ok('and one exists', /MOST_PER_CUSTOMER/.test(api), true);
ok('the price is the one at booking time', /in force when you booked/i.test(terms), true);
ok('and the row records it', /known\[0\]\.price/.test(api), true);
// Nothing is charged online, and nothing should ever quietly start being.
// ("card" on its own is no use as a search term here: the page is full of
// service cards and a twitter:card meta tag.)
ok('it says nothing is paid online', /Nothing is charged online/i.test(terms), true);
ok('no payment provider is loaded',
   /stripe|mollie|adyen|paypal|checkout\.com/i.test(site.replace(/<!--[\s\S]*?-->/g, '')), false);
const fields = [...site.matchAll(/<input[^>]*>/g)].map(m => m[0])
  .filter(f => /card-?number|cardnumber|cc-num|creditcard|iban|autocomplete="cc-/i.test(f));
ok('and nothing on the page asks for a card', fields, []);

console.log(failed === 0 ? '\nAll legal page tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// What the page tells Google, WhatsApp and a screen reader. None of this is
// visible on screen, so nothing on the page looks wrong when it is missing -
// it just means a search result Google writes itself and a shared link that
// arrives as a bare URL.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const meta = (attr, name) => {
  const re = new RegExp('<meta[^>]*' + attr + '="' + name + '"[^>]*content="([^"]*)"');
  const m = html.match(re);
  return m ? m[1] : null;
};

console.log('--- what a search result says ---');
const description = meta('name', 'description');
ok('there is a description', typeof description === 'string' && description.length > 0, true);
// Google truncates around 160 characters; longer and the end is cut mid-sentence.
ok('it fits in a search result', description && description.length <= 165, true);
ok('it says where the shop is', /Wassenaar/.test(description || ''), true);
ok('and what it is for', /[Bb]ook/.test(description || ''), true);
ok('the title says where too', /Wassenaar/.test((html.match(/<title>([^<]*)<\/title>/) || [])[1] || ''), true);
ok('there is a canonical url', /<link rel="canonical" href="https?:\/\//.test(html), true);

// Every absolute address the page states about itself has to be the same one.
// They were all written out by hand, and when the site moved to its own domain
// six of them had to change together — a canonical on one host and an og:url on
// another is how a page gets indexed twice and ranked as neither.
const canonical = (html.match(/<link rel="canonical" href="(https?:\/\/[^/"]+)/) || [])[1];
const otherHosts = [...html.matchAll(/(?:content|href)="(https?:\/\/[^/"]+)/g)]
  .map(m => m[1])
  .filter(host => /sussex/i.test(host) && host !== canonical);
console.log('the site calls itself:', canonical);
ok('and says so consistently', [...new Set(otherHosts)], []);

console.log('--- what a link shared in WhatsApp looks like ---');
['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].forEach(p => {
  ok(`${p} is set`, typeof meta('property', p) === 'string', true);
});
// WhatsApp and Facebook fetch the image from their own servers, so a relative
// path resolves against nothing and the card arrives blank.
const ogImage = meta('property', 'og:image');
ok('og:image is an absolute url', /^https?:\/\//.test(ogImage || ''), true);
ok('and points at a file the site actually has',
   fs.existsSync(path.join(__dirname, '..', (ogImage || '').replace(/^https?:\/\/[^/]+\//, ''))), true);
ok('twitter card is the large format', meta('name', 'twitter:card'), 'summary_large_image');

console.log('--- what Google is told about the business ---');
const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
ok('there is structured data', typeof ld === 'string', true);
let data = null;
try { data = JSON.parse(ld); } catch (e) { /* reported below */ }
ok('and it parses as JSON', data !== null, true);
if (data) {
  ok('typed as a salon', data['@type'], 'HairSalon');
  ok('with a street address', !!(data.address && data.address.streetAddress), true);
  ok('a postcode', !!(data.address && data.address.postalCode), true);
  ok('a phone number', /^\+?\d[\d\s]*$/.test(String(data.telephone || '')), true);
  ok('and opening hours', Array.isArray(data.openingHoursSpecification) &&
     data.openingHoursSpecification.length > 0, true);
}

console.log('--- the time picker for a screen reader ---');
// The whole grid is replaced when a date or barber changes. A sighted customer
// sees that at once; without a live region nobody else is told anything.
ok('the status line is announced', /id="timeSlotStatusText"[^>]*aria-live="polite"/.test(html), true);
ok('the grid is labelled', /id="timeChipsGrid"[^>]*aria-label="Available times"/.test(html), true);
// Selected and booked are carried by colour and a strikethrough alone
// otherwise, so a screen reader reads eighteen identical times.
ok('chips say whether they are selected', /aria-pressed/.test(html), true);
ok('a booked chip says so', /already booked/.test(html), true);
ok('an available one says so', /— available/.test(html), true);

console.log(failed === 0 ? '\nAll metadata tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

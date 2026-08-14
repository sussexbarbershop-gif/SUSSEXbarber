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

console.log('--- and the sitemap robots.txt promises ---');
const robots = fs.readFileSync(path.join(__dirname, '..', 'robots.txt'), 'utf8');
const promised = (robots.match(/Sitemap:\s*(\S+)/i) || [])[1];
ok('robots.txt names a sitemap', typeof promised === 'string', true);
// It named one before the file existed, so the first thing any crawler was
// told about the site was a 404.
ok('and the file is there',
   fs.existsSync(path.join(__dirname, '..', 'sitemap.xml')), true);
const sitemap = fs.existsSync(path.join(__dirname, '..', 'sitemap.xml'))
  ? fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8') : '';
ok('it is a urlset', /<urlset[^>]*>[\s\S]*<\/urlset>/.test(sitemap), true);
ok('every <url> is closed',
   (sitemap.match(/<url>/g) || []).length === (sitemap.match(/<\/url>/g) || []).length, true);
// A sitemap on one host and a canonical on another is a sitemap Google
// rejects as being for somebody else's site.
ok('and it lists the canonical address',
   sitemap.includes('<loc>' + canonical + '/</loc>'), true);
ok('robots points at that host too', (promised || '').startsWith(canonical), true);

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

// The hours, the phone number and the price range were written in by hand.
// They happened to be right; nothing kept them that way, so changing a Monday
// in the panel left the search result saying something the site did not.
console.log('--- and kept in step with the shop ---');
ok('the page rewrites it from the config', /function updateStructuredData\(config\)/.test(html), true);
ok('whenever the config is applied',
   /function applyConfig\([\s\S]*?updateStructuredData\(config\)/.test(html), true);
const updater = (html.match(/function updateStructuredData\(config\)[\s\S]*?\n        \}/) || [''])[0];
['openingHoursSpecification', 'telephone', 'priceRange'].forEach(field => {
  ok(`${field} follows the shop`, updater.includes(field), true);
});
// Only days the shop is actually open belong in it — a closed Monday listed
// with hours is worse than no Monday at all.
ok('closed days are left out', /h\.open === true/.test(updater), true);
// A malformed blob is worse than none: Google reports it against the whole
// site rather than ignoring it.
ok('and it is written back as JSON', /JSON\.stringify\(data/.test(updater), true);

console.log('--- the address stays worth sharing ---');
// Every link in the nav is an in-page anchor, so reading the page left the
// address at sussexbarber.nl/#gallery — and that is the address people then
// copy and send. A customer receives a link to the gallery when what was meant
// was the shop.
const cleanerSource = (html.match(/function keepTheAddressClean\(\)[\s\S]*?\n        \}\)\(\);/) || [''])[0];
// The comments explain why one thing was chosen over another, and name the
// thing that was rejected. Reading them as code reports the very mistake they
// are there to prevent.
const cleaner = cleanerSource
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok('in-page links are handled', cleaner !== '', true);
ok('the hash is never written', /history\.replaceState/.test(cleaner), true);
ok('and the section is still reached', /scrollIntoView/.test(cleaner), true);
// Arriving with a hash — an old link, or a search result that picked up a
// section — has to work and then be tidied.
ok('an arriving hash is honoured', /if \(location\.hash\)/.test(cleaner), true);
// rAF does not run in a tab that is not painting, and a link is copied from a
// background tab as often as a foreground one.
ok('and tidied without waiting for a paint',
   /requestAnimationFrame/.test(cleaner), false);
// A bare "#" is a button wearing a link's clothes; jumping to the top and
// leaving a stray hash is not what it means.
ok('a bare hash does nothing', /href === '#'/.test(cleaner), true);
// An anchor pointing at something the page does not have must be left to the
// browser rather than silently swallowed.
ok('an unknown anchor is left alone', /if \(!scrollTo\(.*\) return;/.test(cleaner), true);

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

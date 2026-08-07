// The panel's "Website Text" page writes five settings into the Sheet. This
// checks the site actually reads all of them.
//
// Two did not. contact_phone was never applied — the number was written into
// four places in the markup, so editing it in the panel changed nothing — and
// hero_title was missing from the same map, so the headline was fixed too.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');

function grab(name) {
  const m = html.match(new RegExp('^        function ' + name + '\\([\\s\\S]*?^        }', 'm'));
  if (!m) throw new Error('not found in index.html: ' + name);
  return m[0];
}

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// --- every setting the panel can save must be read by the site ---------
const savedByPanel = [...(adminJs.match(/const CMS_FIELDS = \{[\s\S]*?\};/) || [''])[0]
  .matchAll(/:\s*'([^']+)'/g)].map(m => m[1]).sort();
console.log('the panel saves:', savedByPanel.join(', '));

const renderSettingsSrc = grab('renderSettings');
const unread = savedByPanel.filter(key => !renderSettingsSrc.includes('settings.' + key));
ok('the site reads every one of them', unread, []);

// --- and applying them actually changes the page -----------------------
const nodes = {};
const el = (id) => (nodes[id] || (nodes[id] = {
  id, tagName: 'P', textContent: '', innerHTML: '', _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k]; }
}));

const node = (tagName) => ({ tagName, textContent: '', _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k]; } });

const phoneText = node('SPAN');
const phoneLink = node('A');
const igLink = node('A');
const igHandle = node('SPAN');
const mapsLink = node('A');

global.document = {
  getElementById: el,
  querySelectorAll: sel => sel === '.cms-contact-phone' ? [phoneText]
                        : sel === '.cms-contact-phone-link' ? [phoneLink]
                        : sel === '[data-cms-link="instagram"]' ? [igLink]
                        : sel === '.cms-instagram-handle' ? [igHandle]
                        : sel === '[data-cms-link="maps"]' ? [mapsLink] : []
};
function setText(node, value) { node.innerHTML = value; }

eval(renderSettingsSrc);

renderSettings({
  hero_title: 'New Headline',
  hero_subtitle: 'New Subtitle',
  about_text: 'New About',
  contact_address: 'New Address',
  contact_phone: '+31 6 11112222',
  instagram_url: 'https://www.instagram.com/newhandle',
  maps_url: 'https://maps.app.goo.gl/abc123',
  maps_embed_url: 'https://www.google.com/maps/embed?pb=NEW'
});

ok('hero title applied',    el('cms-hero-title').innerHTML, 'New Headline');
ok('hero subtitle applied', el('cms-hero-subtitle').innerHTML, 'New Subtitle');
ok('about text applied',    el('cms-about-text').innerHTML, 'New About');
ok('address applied',       el('cms-contact-address').innerHTML, 'New Address');
ok('phone number shown',    phoneText.textContent, '+31 6 11112222');
ok('phone dial link built', phoneLink.getAttribute('href'), 'tel:+31611112222');

// A blank setting should leave what is on the page, not wipe it.
renderSettings({ contact_phone: '' });
ok('a blank phone does not erase the one on the page', phoneText.textContent, '+31 6 11112222');

// A Sheet cell can hold a formula error, and the live one does.
['#ERROR!', '#REF!', '#N/A', 'call us'].forEach(bad => {
  renderSettings({ contact_phone: bad });
  ok(`"${bad}" is not printed as the phone number`, phoneText.textContent, '+31 6 11112222');
});

console.log('--- links that used to be written into the page ---');
ok('instagram link repointed', igLink.getAttribute('href'), 'https://www.instagram.com/newhandle');
ok('handle read off the URL',  igHandle.textContent, '@newhandle');
ok('directions link repointed', mapsLink.getAttribute('href'), 'https://maps.app.goo.gl/abc123');
ok('embedded map repointed',    el('mapIframe').getAttribute('src'), 'https://www.google.com/maps/embed?pb=NEW');

// These become an href and an iframe src. A Sheet the owner shares, or an
// account that gets taken over, must not be able to run script in a visitor's
// browser or point the map at another site.
renderSettings({ instagram_url: 'javascript:alert(1)' });
ok('javascript: URL refused for the link', igLink.getAttribute('href'), 'https://www.instagram.com/newhandle');
renderSettings({ maps_url: 'javascript:alert(1)' });
ok('javascript: URL refused for directions', mapsLink.getAttribute('href'), 'https://maps.app.goo.gl/abc123');
renderSettings({ maps_embed_url: 'https://evil.example.com/page' });
ok('only a real Google embed is accepted', el('mapIframe').getAttribute('src'), 'https://www.google.com/maps/embed?pb=NEW');

console.log(failed === 0 ? '\nAll site content tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

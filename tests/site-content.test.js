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

// --- every setting the panel can save must be read by something --------
//
// A box on the Website Text page that nothing reads is a box the owner fills
// in, saves, and watches change nothing — which is exactly what contact_phone
// and hero_title used to do.
//
// "Something" is not always the website. review_url is typed on the same page
// and read by api/daily.js when it sends the review email; the home page has
// no use for it and should not pretend to. So both are searched, and a
// setting read by neither is the failure.
const savedByPanel = [...(adminJs.match(/const CMS_FIELDS = \{[\s\S]*?\};/) || [''])[0]
  .matchAll(/:\s*'([^']+)'/g)].map(m => m[1]).sort();
console.log('the panel saves:', savedByPanel.join(', '));

const renderSettingsSrc = grab('renderSettings');
const backend = fs.readdirSync(path.join(root, 'api'))
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(root, 'api', f), 'utf8'))
  .join('\n');

const unread = savedByPanel.filter(key =>
  !renderSettingsSrc.includes('settings.' + key) &&
  !backend.includes('.' + key));
ok('the site or the backend reads every one of them', unread, []);

// And named where the reader would look for it. The daily job is the only
// thing that sends a customer to Google, so if that link moves, this is the
// test that says where it went.
ok('the review link is read by the daily job',
   fs.readFileSync(path.join(root, 'api', 'daily.js'), 'utf8').includes('review_url'), true);

// --- and applying them actually changes the page -----------------------
const nodes = {};
const el = (id) => (nodes[id] || (nodes[id] = {
  id, tagName: 'P', innerHTML: '', _attrs: {}, children: [],
  className: '',
  // setHeroTitle builds the headline out of nodes rather than a string, so
  // this has to behave like one: assigning textContent empties it, and what
  // is appended afterwards is what the reader ends up with.
  set textContent(v) { this._text = v; this.children = []; },
  get textContent() {
    return this.children.length
      ? this.children.map(c => c.textContent).join('')
      : (this._text || '');
  },
  appendChild(child) { this.children.push(child); return child; },
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

const made = [];
global.document = {
  getElementById: el,
  createElement(tag) {
    const n = { tagName: tag.toUpperCase(), className: '', children: [],
      set textContent(v) { this._text = v; this.children = []; },
      get textContent() {
        return this.children.length
          ? this.children.map(c => c.textContent).join('') : (this._text || '');
      },
      appendChild(child) { this.children.push(child); return child; } };
    made.push(n);
    return n;
  },
  createTextNode: text => ({ tagName: '#text', textContent: text, children: [] }),
  querySelectorAll: sel => sel === '.cms-contact-phone' ? [phoneText]
                        : sel === '.cms-contact-phone-link' ? [phoneLink]
                        : sel === '[data-cms-link="instagram"]' ? [igLink]
                        : sel === '.cms-instagram-handle' ? [igHandle]
                        : sel === '[data-cms-link="maps"]' ? [mapsLink] : []
};
function setText(node, value) { node.innerHTML = value; }

eval(grab('setHeroTitle'));
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

ok('hero title applied',    el('cms-hero-title').textContent, 'New Headline');
ok('hero subtitle applied', el('cms-hero-subtitle').innerHTML, 'New Subtitle');
ok('about text applied',    el('cms-about-text').innerHTML, 'New About');
ok('address applied',       el('cms-contact-address').innerHTML, 'New Address');
ok('phone number shown',    phoneText.textContent, '+31 6 11112222');
ok('phone dial link built', phoneLink.getAttribute('href'), 'tel:+31611112222');

console.log('--- the headline keeps its shape, whatever it says ---');
// It is two lines with the second in gold italic. setText would have flattened
// that to one plain line the moment the config arrived, which is a design the
// owner never chose and could not get back.
const hero = () => el('cms-hero-title');
const heroShape = () => hero().children.map(c => c.tagName).join(' ');

renderSettings({ hero_title: 'Masterful Cuts, Exceptional Service.' });
// The comma stays with the first line, where it is read; the break is what
// separates them, so there is no space to account for.
ok('all of it is on the page', hero().textContent, 'Masterful Cuts,Exceptional Service.');
ok('broken into two lines', heroShape(), '#text BR SPAN');
ok('the second half is gold italic',
   hero().children[2].className, 'text-gold italic');
ok('and reads as the second half', hero().children[2].textContent, 'Exceptional Service.');

renderSettings({ hero_title: 'One Line Only' });
ok('no comma, no guessing', heroShape(), '#text');
ok('and the words are unchanged', hero().textContent, 'One Line Only');

renderSettings({ hero_title: 'First, Second, Third.' });
ok('broken at the last comma, not the first',
   hero().children[2].textContent, 'Third.');

// A blank setting should leave what is on the page, not wipe it.
renderSettings({ hero_title: '   ' });
ok('a blank headline does not erase the one on the page',
   hero().children[2].textContent, 'Third.');

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

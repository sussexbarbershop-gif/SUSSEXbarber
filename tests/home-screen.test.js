// What the shop looks like when it is not a web page.
//
// Added to an Android home screen, the site showed a grey square with an "S"
// in it and the label "Barber in W" — because there was no icon of any kind
// and nothing but <title> to cut a name from. It sat between Spotify and
// LinkedIn looking like a shortcut somebody had failed to finish making.
//
// The manifest is generated from the shop's own settings now, so this asks the
// route for one and reads the answer, with the database stood in for and
// empty: the shape it takes when nothing has been uploaded, where every icon
// is the committed fallback. Those files are what this is really about — the
// uploaded path is covered in app-icon.test.js.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => () => Promise.resolve([]) };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

/** Ask the route for a manifest, the way a phone would. */
async function fetchManifest() {
  const handler = require(path.join(root, 'api', 'manifest.js'));
  let body = '{}';
  let type = '';
  await handler({}, {
    status() { return this; },
    setHeader(k, v) { if (/content-type/i.test(k)) type = v; return this; },
    send(text) { body = text; }
  });
  return { manifest: JSON.parse(body), type };
}

(async () => {
  console.log('--- the manifest ---');
  const { manifest: m, type } = await fetchManifest();
  ok('the page links to it',
     /<link rel="manifest" href="\/manifest\.webmanifest">/.test(html), true);
  // A manifest served as text/plain is one the browser ignores.
  ok('served as a manifest', /application\/manifest\+json/.test(type), true);
  ok('it has a full name', m.name, 'Sussex Barber Shop');
  // The label under a home-screen icon is about twelve characters. Without a
  // short_name Android cuts the <title>, which is why it read "Barber in W".
  ok('and a short one for the icon label', typeof m.short_name, 'string');
  ok('short enough not to be cut', (m.short_name || '').length <= 13, true);
  ok('and still recognisably the shop', /Sussex/.test(m.short_name || ''), true);

  console.log('--- the icons it names ---');
  // Two kinds. `any` is drawn as it is; `maskable` is cropped by Android to
  // whatever shape the launcher uses and is promised only its middle 80%. An
  // `any` icon used as maskable loses its edges.
  const icons = m.icons || [];
  const purposes = icons.map(i => i.purpose);
  ok('there are icons', icons.length >= 4, true);
  ok('some for drawing as they are', purposes.includes('any'), true);
  ok('and some for being cropped', purposes.includes('maskable'), true);
  // 192 for the launcher, 512 for the splash screen and the install prompt.
  [192, 512].forEach(size => {
    ok(`${size}px in both kinds`,
       icons.filter(i => i.sizes === `${size}x${size}`).length >= 2, true);
  });

  // With nothing uploaded these are the committed files, and a manifest naming
  // an icon that 404s is how you end up back at the grey square with a letter
  // in it.
  icons.forEach(i => {
    ok(`${i.src} exists`,
       fs.existsSync(path.join(root, i.src.replace(/^\//, ''))), true);
  });

  console.log('--- and the ones a manifest does not cover ---');
  // iOS ignores the manifest's icons for Add to Home Screen and reads this.
  ok('an apple-touch-icon is linked', /<link rel="apple-touch-icon"/.test(html), true);
  ok('and exists', fs.existsSync(path.join(root, 'assets/icons/apple-touch-icon.png')), true);
  // The browser tab, which is where most people see it most often.
  ok('a favicon is linked', /<link rel="icon"[^>]*favicon-32\.png/.test(html), true);
  ok('and exists', fs.existsSync(path.join(root, 'assets/icons/favicon-32.png')), true);
  // Every page, not only the home page: a tab left open on the privacy page is
  // still the shop.
  ['privacy.html', 'terms.html', 'cancel.html', path.join('admin', 'index.html')]
    .forEach(page => {
      const src = fs.readFileSync(path.join(root, page), 'utf8');
      ok(`${page} has the icon too`, /<link rel="icon"/.test(src), true);
    });

  console.log('--- what the committed icons actually contain ---');
  // A charcoal square with nothing composited onto it would pass every check
  // above. This is the one that can tell them apart: the mark is what creates
  // the variation in brightness.
  const sharp = require('sharp');
  for (const file of ['icon-192.png', 'icon-maskable-512.png', 'favicon-32.png',
                      'apple-touch-icon.png']) {
    const img = sharp(path.join(root, 'assets/icons', file));
    const meta = await img.metadata();
    const stats = await img.stats();
    ok(`${file} is square`, meta.width, meta.height);
    ok(`${file} has the mark on it`, stats.channels[0].stdev > 25, true);
    // Transparent is a coin toss: it lands on whatever colour the launcher
    // paints behind it, and half the phones in the world paint white.
    ok(`${file} is not transparent`,
       meta.hasAlpha === false || stats.isOpaque === true, true);
  }

  // The generator is committed, so the fallback set can be made again from the
  // logo rather than being files nobody knows the origin of.
  ok('the script that made them is here',
     fs.existsSync(path.join(root, 'scripts', 'make-icons.js')), true);

  console.log(failed === 0 ? '\nAll home screen tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();

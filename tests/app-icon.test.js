// The app icon, and the fact that the shop can change it without asking.
//
// The first set was cut out of the logo by a script on a laptop. That is fine
// until the logo changes, at which point the only person who can redo it is
// whoever wrote the script — which is not a way to run a barber shop.
//
// So the panel does it now: choose a picture, drag it, zoom it, save. What is
// tested here is mostly the parts that could quietly stop working and leave
// the shop back at the browser's grey placeholder.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'api', '_lib', 'icons.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'admin', 'admin.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin', 'admin.css'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- who may change it ---');
// The same gate as the prices and the hours: this is what the shop looks like
// on somebody's phone, which is the owner's decision and not the floor's.
ok('behind the owner PIN with the rest of the branding',
   api.includes("'uploadImage', 'uploadAppIcon'"), true);
ok('and the panel signs the request as the owner',
   /asOwner\(\{[\s\S]{0,60}action: 'uploadAppIcon'/.test(panel), true);

console.log('--- what a save must not destroy ---');
// saveCMS prunes any setting the panel did not send, which is what stops the
// table filling with keys nothing reads. The icon URLs are written by the
// upload and never appear in the Website Text form, so without this the next
// text edit would take the shop's icon off every phone it is installed on.
ok('the icon settings survive a prune',
   /KEPT_SETTINGS = \['visit_count'\]\.concat\(/.test(api), true);
ok('and there are some to keep',
   /ICON_SETTINGS = Object\.values\(SETTING_FOR\)/.test(icons), true);

console.log('--- the six files ---');
// A phone asks for more than one, and the two purposes are not
// interchangeable: `any` is drawn as it is, `maskable` is cropped by Android
// to whatever shape the launcher uses and is promised only its middle 80%.
const sizes = [...icons.matchAll(/file: '([\w.-]+)',\s*size: (\d+),\s*fill: ([\d.]+)/g)]
  .map(m => ({ file: m[1], size: Number(m[2]), fill: Number(m[3]) }));
ok('six of them', sizes.length, 6);
ok('192 and 512 in both purposes',
   [192, 512].every(n => sizes.filter(s => s.size === n).length === 2), true);
ok('a favicon for the tab', sizes.some(s => s.size === 32), true);
ok('and an apple-touch-icon, which iOS reads instead of the manifest',
   sizes.some(s => s.file === 'apple-touch-icon.png'), true);
// The cropped pair is drawn smaller, because some of it is going to be cut.
const maskable = sizes.filter(s => /maskable/.test(s.file));
const plain = sizes.filter(s => /^icon-\d/.test(s.file));
ok('the cropped ones are drawn smaller than the ones that are not',
   maskable.every(m => plain.every(p => m.fill < p.fill)), true);

console.log('--- and they are written as one thing ---');
const route = (api.match(/async function uploadAppIcon[\s\S]*?\n\}/) || [''])[0];
// A half-written set is an icon that disagrees with itself across the tab, the
// home screen and the splash screen.
ok('the settings go in one transaction', /sql\.transaction\(statements\)/.test(route), true);
// Two round trips would leave icons in storage that nothing pointed at, every
// time a save was interrupted.
ok('and the route saves them itself, rather than handing them back',
   /INSERT INTO settings/.test(route), true);
ok('refusing clearly when storage is not configured',
   /BLOB_READ_WRITE_TOKEN/.test(route), true);
ok('and when the file is not a picture', /not a readable image/.test(route), true);

console.log('--- the manifest follows the settings ---');
const manifest = fs.readFileSync(path.join(root, 'api', 'manifest.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
ok('it is generated, not a committed file',
   fs.existsSync(path.join(root, 'manifest.webmanifest')), false);
ok('served at the path the pages link to',
   /\/manifest\.webmanifest[\s\S]*?\/api\/manifest/.test(vercel), true);
ok('and the pages still link to that path',
   /<link rel="manifest" href="\/manifest\.webmanifest">/.test(site), true);
ok('it reads what was uploaded', /settings\[key\]/.test(manifest), true);
// A manifest that 500s is a phone that cannot install the site at all.
ok('and falls back to the committed icons if the database is unreachable',
   /const BUILT_IN/.test(manifest) && /catch \(err\)/.test(manifest), true);
ok('with a short_name, or Android cuts the title instead',
   /short_name: 'Sussex Barber'/.test(manifest), true);

console.log('--- choosing the crop ---');
// The only way to choose one confidently is to watch what survives the circle
// while you are choosing it, which is why this is a panel and not a setting.
ok('there is a canvas to draw on', /id="iconCanvas"/.test(markup), true);
ok('with the safe circle over it', /class="icon-safe"/.test(markup), true);
// inset: 10% is the middle 80% — exactly what a maskable icon is promised.
ok('and the circle is that promised 80%',
   /\.icon-safe \{[\s\S]{0,200}inset: 10%/.test(css), true);
// A guide, not artwork: drawn over the canvas, so it is never in the file.
ok('the guide is never painted into the picture',
   /\.icon-safe \{[\s\S]{0,300}pointer-events: none/.test(css), true);

ok('a finger can drag it',
   /pointerdown/.test(panel) && /pointermove/.test(panel), true);
ok('two fingers can zoom it', /Math\.hypot/.test(panel), true);
ok('a slider can too, for one hand', /id="iconZoom"/.test(markup), true);
ok('and a wheel, at a desk', /'wheel'/.test(panel), true);
// Dragging the picture must not also scroll the page under it.
ok('dragging does not scroll the page behind it',
   /\.icon-stage \{[\s\S]{0,300}touch-action: none/.test(css), true);

console.log('--- what is actually sent ---');
const save = (panel.match(/async function saveAppIcon\(\)[\s\S]*?\n\}/) || [''])[0];
// PNG: this is line art on a flat colour, which is what JPEG smears, and the
// server re-encoding afterwards cannot put back what arrived damaged.
ok('a PNG, not a JPEG', /toDataURL\('image\/png'\)/.test(save), true);
// The crop is decided in the browser, so the server never hears about zoom.
ok('the finished square, not the zoom and the offsets',
   /dataUrl/.test(save) && !/iconView/.test(save), true);
ok('and the panel keeps the new URLs',
   /Object\.assign\(settings, answer\.icons/.test(save), true);
// Android keeps the icon a shortcut was made with. Nothing on the server can
// reach one that is already on a home screen.
ok('the shop is told to add the shortcut again', /add it again/.test(save), true);

console.log('--- and the tab, which the manifest does not cover ---');
ok('the site swaps the favicon from settings',
   /function updateIcons\(config\)/.test(site), true);
ok('whenever the config is applied', /updateIcons\(config\);/.test(site), true);
// With nothing uploaded, or if this never runs, the page keeps the icon it
// shipped with — which is the right way round for it to fail.
ok('and does nothing without a URL', /if \(!url\) return;/.test(site), true);

console.log(failed === 0 ? '\nAll app icon tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

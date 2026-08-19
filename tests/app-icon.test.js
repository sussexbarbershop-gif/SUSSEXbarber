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
   /KEPT_SETTINGS = \[[^\]]*\][\s\S]{0,40}\.concat\(require\('\.\/_lib\/icons'\)\.ICON_SETTINGS\)/.test(api), true);
ok('and there are some to keep',
   /ICON_SETTINGS = Object\.values\(SETTING_FOR\)/.test(icons), true);

console.log('--- the six files ---');
// A phone asks for more than one, and the two purposes are not
// interchangeable: `any` is drawn as it is, `maskable` is cropped by Android
// to whatever shape the launcher uses and is promised only its middle 80%.
const sizes = [...icons.matchAll(/file: '([\w.-]+)',\s*size: (\d+),\s*purpose: '(\w+)'/g)]
  .map(m => ({ file: m[1], size: Number(m[2]), purpose: m[3] }));
ok('six of them', sizes.length, 6);
ok('192 and 512 in both purposes',
   [192, 512].every(n => sizes.filter(s => s.size === n).length === 2), true);
ok('a favicon for the tab', sizes.some(s => s.size === 32), true);
ok('and an apple-touch-icon, which iOS reads instead of the manifest',
   sizes.some(s => s.file === 'apple-touch-icon.png'), true);
// And the server does not resize the mark inside them. It used to shrink
// every upload to 82% of the icon, which was right when the only input was a
// bare logo and wrong the moment the panel grew an editor: the owner composed
// against the circle, pressed Save, and got something visibly smaller than
// the preview. The margin is theirs to set now, so nothing here may reinstate
// one behind them.
ok('the server adds no margin of its own', /fill/.test(icons), false);
// Which only works while the panel is honest about what survives the crop:
// inset 10% is the middle 80%, which is all Android guarantees.
const panelCss = fs.readFileSync(path.join(__dirname, '..', 'admin', 'admin.css'), 'utf8');
const safe = (panelCss.match(/\.icon-safe \{[^}]*\}/) || [''])[0];
ok('the panel draws the circle that is kept', /inset:\s*10%/.test(safe), true);
ok('and draws it as a circle', /border-radius:\s*50%/.test(safe), true);

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

console.log('--- the icon already in use ---');
// Opening the editor on an empty box means the only way to see the current
// icon is to install the site, and the only way to change it slightly is to
// find the original file and start again.
ok('the page opens on the icon that is live', /renderCms[\s\S]{0,200}loadSavedIcon\(\)/.test(panel), true);
const loader = (panel.match(/function loadSavedIcon\(\)[\s\S]*?\n\}/) || [''])[0];
ok('it reads the saved URL', /settings\.icon_512/.test(loader), true);
// The icons come from the blob store. Drawing a cross-origin picture onto a
// canvas taints it, and a tainted canvas throws on toDataURL — so without
// this the editor looks fine and fails at the moment of saving.
ok('and asks for it in a way the canvas can export',
   /crossOrigin = 'anonymous'/.test(loader), true);
// Not over a picture the owner is part-way through placing.
ok('it does not overwrite a chosen file', /if \(iconImage\) return/.test(loader), true);

console.log('--- saved, or only on the screen ---');
// The editor used to leave "Saved." up while the owner carried on dragging
// underneath it. Save, adjust, look at the phone: the phone is showing exactly
// what was sent, which is no longer what is on the screen, and nothing says
// so. It reads as the editor not working.
ok('there is a word for changed-but-not-sent', /let iconDirty/.test(panel), true);
const changes = ['function setIconZoom', 'function resetIcon'];
changes.forEach(fn => {
  const body = (panel.match(new RegExp(fn + '[\\s\\S]*?\\n\\}')) || [''])[0];
  ok(fn.replace('function ', '') + ' says the picture moved',
     /markIconChanged\(\)/.test(body), true);
});
// Dragging is the other half of composing one, and the easy half to forget.
ok('and so does dragging it',
   /iconView\.x \+= toCanvas[\s\S]{0,120}markIconChanged\(\)/.test(panel), true);
const saver = (panel.match(/async function saveAppIcon[\s\S]*?\n\}/) || [''])[0];
ok('only a save clears it', /markIconSaved\(/.test(saver), true);
// Two save buttons on one page, and the big one does not do the icon.
ok('the other save button says the icon is separate',
   /if \(iconDirty\)[\s\S]{0,200}showToast/.test(panel), true);

console.log('--- and what is live, to compare against ---');
ok('the panel shows the icon that is on phones now',
   /function showLiveIcon[\s\S]{0,300}settings\.icon_192/.test(panel), true);
ok('refreshed after a save', /showLiveIcon\(\);[\s\S]{0,200}showToast/.test(panel), true);
ok('and there is somewhere to put it', /id="iconLive"/.test(markup), true);

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

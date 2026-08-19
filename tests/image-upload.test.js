// Photos come off a phone at three to twelve megabytes, and the panel uploads
// whatever the owner picked. Two things follow from that, and both are quiet:
//
//   - a gallery of full-size photos is a page nobody on mobile data waits for,
//     and the shop has no way to tell that is why;
//   - a photo taken on a phone carries EXIF, and EXIF from a phone carries the
//     GPS coordinates it was taken at. Uploading a picture taken in the shop
//     publishes the shop's location a second time, in a place nobody looks.
//
// The panel shrinks in the browser first, which keeps the upload quick, but
// that is one canvas call in one tab and this endpoint takes anything holding
// the password. So the server compresses too, and this checks that it does.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

console.log('--- the upload path compresses, it does not just store ---');
ok('uploadImage calls compressImage', /compressed\s*=\s*await compressImage\(/.test(source), true);
ok('what is stored is the compressed buffer',
   /put\([^)]*compressed\.bytes/s.test(source), true);
ok('the original is never stored',
   /put\([^)]*\boriginal\b/s.test(source), false);

console.log('--- and it is sharp doing it ---');
ok('sharp is required inside the handler', source.includes("require('sharp')"), true);
// A missing native build must not take image uploads down with it.
ok('a missing sharp is survived, not thrown',
   /catch \(err\) \{[\s\S]{0,400}sharp unavailable/.test(source), true);

console.log('--- sharp is a runtime dependency, not a build-time one ---');
// It runs in the deployed function. In devDependencies it is absent there, and
// every upload silently falls back to storing the original.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok('sharp in dependencies', Object.keys(pkg.dependencies || {}).includes('sharp'), true);
ok('sharp not in devDependencies', Object.keys(pkg.devDependencies || {}).includes('sharp'), false);

console.log('--- metadata is dropped ---');
// sharp drops it unless asked. Asking is the mistake this guards against.
ok('withMetadata is never called', source.includes('withMetadata'), false);
ok('the EXIF orientation is applied before it goes', /\.rotate\(\)/.test(source), true);

console.log('--- big pictures come down, small ones are left alone ---');
ok('resize fits inside a box', /fit:\s*'inside'/.test(source), true);
ok('and never enlarges', /withoutEnlargement:\s*true/.test(source), true);
ok('there is more than one quality step',
   (source.match(/QUALITY_STEPS\s*=\s*\[([^\]]*)\]/) || [, ''])[1].split(',').length > 1, true);
ok('and a size it is aiming for', /TARGET_BYTES/.test(source), true);

console.log('--- the stored name matches the stored bytes ---');
// Everything is re-encoded to JPEG, so a URL ending .png would be a lie that
// only shows up in whatever reads the extension instead of the header.
ok('always written as .jpg', /put\(`site\/\$\{name\}\.jpg`/.test(source), true);

console.log('--- images that are the same colour on both phones ---');
// Reported holding the two phones side by side: the same photographs looked
// brighter and cleaner on the Android than on the iPhone. Nothing was wrong
// with the pixels. sharp drops metadata unless it is told not to, and the
// colour profile went with it — and an untagged image is not a colour, it is
// a set of numbers with nothing saying what they mean. Chrome fills that in
// with sRGB and is right. Safari sends them to an iPhone's Display P3 screen
// as they are, the same values stretched across a wider space, so every
// colour sits deeper than it should and a warm, dark photograph turns heavy.
//
// Read out of the bytes rather than through sharp, so this says the same
// thing on a machine where sharp did not build.
function saysWhatColourItIs(file) {
  const bytes = fs.readFileSync(file);
  // JPEG carries it in an APP2 segment that begins with this string.
  if (bytes.includes(Buffer.from('ICC_PROFILE'))) return true;
  // PNG has an iCCP chunk, or the sRGB chunk, which says the same thing in
  // four bytes instead of five hundred.
  return bytes.includes(Buffer.from('iCCP')) || bytes.includes(Buffer.from('sRGB'));
}

const assets = path.join(__dirname, '..', 'assets');
const pictures = fs.readdirSync(assets).filter(n => /\.(jpe?g|png)$/i.test(n));
ok('there are images to check', pictures.length > 0, true);
// Every one of them, not most: the one that ships untagged is the one somebody
// added by hand without running the script over it.
ok('every image in the repository says it is sRGB',
   pictures.filter(n => !saysWhatColourItIs(path.join(assets, n))), []);

// And the two places that make new ones after this file was written.
ok('a photo uploaded from the panel is tagged too',
   /withIccProfile\('srgb'\)/.test(source), true);
const iconSource = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'icons.js'), 'utf8');
ok('and the icons, which come off a canvas untagged',
   /withIccProfile\('srgb'\)/.test(iconSource), true);
// Tagging makes a file slightly larger. A rule of "only write it if it shrank"
// would therefore have refused this fix on every image it applied to, in
// silence, while reporting them all as already optimal.
const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'optimize-images.js'), 'utf8');
ok('and the optimiser will write a file that grew by a profile',
   /if \(after < before \|\| untagged\)/.test(script), true);

console.log(failed ? `\n${failed} FAILED` : '\nAll image upload checks passed.');
process.exit(failed ? 1 : 0);

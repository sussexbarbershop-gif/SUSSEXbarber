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

console.log(failed ? `\n${failed} FAILED` : '\nAll image upload checks passed.');
process.exit(failed ? 1 : 0);

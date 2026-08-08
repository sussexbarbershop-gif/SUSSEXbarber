/**
 * Recompresses the site's own /assets images in place: same filename, same
 * format, far fewer bytes. Nothing in index.html, admin.js or Code.gs has to
 * change, because every reference is by filename and the filename does not
 * move.
 *
 * Anything a photo actually needs is a max edge around 1600px and JPEG
 * quality in the high 70s - past that the bytes buy nothing anyone can see on
 * a screen. Six photos here were straight off a phone camera at 3-7MB each;
 * one visitor loading the gallery was pulling down ~20MB of image before this.
 *
 * Uploads made through the admin panel are already shrunk client-side
 * (shrinkImage() in admin.js, same idea, before the file ever reaches Drive).
 * This script is for the images that ship in the repository itself - run it
 * again if a new one is added to /assets by hand.
 *
 *   npm run optimize:images
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS = path.join(__dirname, '..', 'assets');
const MAX_EDGE = 1600;
const JPEG_QUALITY = 78;
const PNG_QUALITY = 80;

async function optimize(file) {
  const full = path.join(ASSETS, file);
  // Read fully into memory rather than handing sharp the path: on Windows the
  // read handle sharp opens on the source stays open until the pipeline runs,
  // and writing the result back over that same open path then fails.
  const source = fs.readFileSync(full);
  const before = source.length;
  const ext = path.extname(file).toLowerCase();

  const img = sharp(source);
  const meta = await img.metadata();
  const resize = (meta.width > MAX_EDGE || meta.height > MAX_EDGE)
    ? { width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }
    : null;

  let pipeline = resize ? img.resize(resize) : img;
  if (ext === '.png') {
    pipeline = pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9 });
  } else {
    // .jpg, .jpeg
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  }

  const buffer = await pipeline.toBuffer();
  const after = buffer.length;

  // Only overwrite if it is actually smaller - a tiny icon-sized source run
  // back through an encoder can come out larger than it went in.
  if (after < before) {
    fs.writeFileSync(full, buffer);
    console.log(
      `${file.padEnd(40)} ${(before / 1024).toFixed(0).padStart(6)} KB -> ${(after / 1024).toFixed(0).padStart(6)} KB` +
      `  (${(100 - (100 * after / before)).toFixed(0)}% smaller)`
    );
  } else {
    console.log(`${file.padEnd(40)} already smaller than a re-encode (${(before / 1024).toFixed(0)} KB) - left alone`);
  }
}

async function main() {
  const files = fs.readdirSync(ASSETS).filter(f => /\.(jpe?g|png)$/i.test(f));
  let totalBefore = 0, totalAfter = 0;
  for (const f of files) {
    const before = fs.statSync(path.join(ASSETS, f)).size;
    await optimize(f);
    totalBefore += before;
    totalAfter += fs.statSync(path.join(ASSETS, f)).size;
  }
  console.log(
    `\nTotal: ${(totalBefore / 1024 / 1024).toFixed(1)} MB -> ${(totalAfter / 1024 / 1024).toFixed(1)} MB`
  );
}

main();

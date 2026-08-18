/**
 * The icons a phone uses when the site is added to a home screen.
 *
 * Without them Android draws a grey square with the first letter of the page
 * title in it, which is what the shop had — a shortcut that looked like a
 * placeholder sitting between Spotify and LinkedIn.
 *
 * Run:  node scripts/make-icons.js
 * The output is committed; this only needs running again if the logo changes.
 *
 * Two kinds are produced, and the difference is the whole reason this is a
 * script rather than one resized file:
 *
 *   any       drawn as it is, with its own padding. Used by browser tabs and
 *             by anything that does not crop.
 *   maskable  Android crops every icon to whatever shape the launcher uses —
 *             a circle on one phone, a squircle on another, a rounded square
 *             on a third. It guarantees only the middle 80% survives, so the
 *             logo is drawn smaller and the background runs to the edges. An
 *             `any` icon used as maskable gets its edges shaved off; a
 *             maskable one used as `any` merely has generous padding, which
 *             is why both are declared and why this one is the safer default.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets', 'icons');
fs.mkdirSync(out, { recursive: true });

// The shop is gold on charcoal everywhere else — the hero, the panel, the
// emails — so the icon is the white mark on the same charcoal. A transparent
// icon is a coin toss: it lands on whatever colour the launcher paints behind
// it, and half the phones in the world paint white.
const BACKGROUND = { r: 0x12, g: 0x12, b: 0x12, alpha: 1 };
const LOGO = path.join(root, 'assets', 'logo-white.png');

/** One square icon: the logo centred on charcoal, at `fill` of the canvas. */
async function icon(size, fill, file) {
  const inner = Math.round(size * fill);
  const logo = await sharp(LOGO)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, file));
  console.log('  ' + file + '  ' + size + 'x' + size);
}

(async () => {
  console.log('icons:');
  // Tabs and bookmarks. Small enough that the mark needs the room.
  await icon(32,  0.84, 'favicon-32.png');
  await icon(180, 0.76, 'apple-touch-icon.png');   // iOS rounds, never crops
  await icon(192, 0.76, 'icon-192.png');
  await icon(512, 0.76, 'icon-512.png');
  // 60%, so the mark stays inside the circle every Android launcher may cut.
  await icon(512, 0.60, 'icon-maskable-512.png');
  await icon(192, 0.60, 'icon-maskable-192.png');
})();

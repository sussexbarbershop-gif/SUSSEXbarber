/**
 * The icons a phone uses when the site is added to a home screen.
 *
 * Without them Android draws a grey square with the first letter of the page
 * title in it, which is what the shop had.
 *
 * Run:  npm run make:icons
 * The output is committed; this only needs running again if the logo changes.
 *
 * ---- Why this crops the logo ------------------------------------------
 *
 * The shop's mark is a three-part lockup: SUSSEX above, the bearded profile
 * in an oval, a BARBER SHOP banner below. It is a good logo and a bad icon,
 * and the reason is arithmetic rather than taste.
 *
 * A launcher draws an icon at about forty-eight density-independent pixels.
 * The whole lockup at that size puts "BARBER SHOP" at roughly four pixels
 * tall — it is not small, it is absent, and what is left is a grey smudge
 * where a word used to be. Measured on the source: the three parts sit at
 * 0.05-0.17, 0.18-0.67 and 0.67-0.98 of the height, so two thirds of the
 * canvas is spent on text nobody at that size can read.
 *
 * The profile alone survives. It is the distinctive half of the mark, it is
 * drawn in heavier strokes than the lettering, and being wider than it is
 * tall it fits the circle Android may crop to — where the tall lockup does
 * not. The numbers below are not preferences:
 *
 *   safe zone     the middle 80% of the canvas, by diameter, is all a
 *                 maskable icon is guaranteed to keep
 *   whole lockup  243x316. Its diagonal at height h is 1.26h, so h can be
 *                 at most 0.63 of the canvas. That is the small icon the
 *                 shop was looking at.
 *   the profile   231x168. Diagonal 1.21w, so w can reach 0.66 — and being
 *                 the wide dimension, it reads far larger at the same
 *                 percentage.
 *
 * Two kinds are still produced. `any` is drawn as it is, by browser tabs and
 * anything that does not crop, so it can be larger. `maskable` is the one
 * Android cuts to a circle, a squircle or a rounded square depending on the
 * launcher, and stays inside the guaranteed zone.
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

// The profile, measured off the artwork rather than guessed at.
//
// Not the ink alone: the artwork has a rule under SUSSEX on row 58 and the
// banner ribbon begins on row 215, and both run nearly the full width. Any
// crop that includes them puts two straight lines across the top and bottom
// of a circular icon, which is what the first two attempts did — they read as
// a mistake rather than as part of a mark, because at that size they are all
// anybody can see of the parts they belong to.
//
// Rows 60 to 211, which is the profile and nothing else.
const PROFILE = { left: 13, top: 60, width: 227, height: 152 };

/** One square icon: the mark centred on charcoal, at `fill` of the canvas. */
async function icon(size, fill, file) {
  const inner = Math.round(size * fill);
  const mark = await sharp(LOGO)
    .extract(PROFILE)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, file));
  console.log('  ' + file + '  ' + size + 'x' + size);
}

(async () => {
  console.log('icons:');
  // A favicon is sixteen or thirty-two pixels of tab. It gets everything.
  await icon(32,  0.92, 'favicon-32.png');
  // iOS rounds the corners and never crops to a circle, so this can be full.
  await icon(180, 0.78, 'apple-touch-icon.png');
  await icon(192, 0.78, 'icon-192.png');
  await icon(512, 0.78, 'icon-512.png');
  // The two Android will cut. 0.66 is the arithmetic above, not a feeling.
  await icon(192, 0.66, 'icon-maskable-192.png');
  await icon(512, 0.66, 'icon-maskable-512.png');
})();

/**
 * The home-screen icons, made from whatever picture the shop uploads.
 *
 * This exists so the owner never has to ask anybody to change it. The first
 * set was cut from the logo by a script on a laptop, which is fine until the
 * logo changes and the only person who can redo it is the person who wrote
 * the script.
 *
 * The sizes and the two purposes are not preferences, and are explained at
 * length in scripts/make-icons.js. In short:
 *
 *   any       drawn as it is, by browser tabs and anything that does not crop
 *   maskable  Android cuts it to a circle, a squircle or a rounded square
 *             depending on the launcher, and guarantees only the middle 80%
 *             by diameter. So the mark is drawn smaller and the background
 *             runs to the edges.
 *
 * Whatever arrives is fitted rather than stretched, and centred on the shop's
 * charcoal. A picture with a transparent background keeps it — laid on the
 * charcoal — because a transparent icon lands on whatever colour the launcher
 * paints behind it, and half the phones in the world paint white.
 */

// The same charcoal as the hero, the panel and the emails.
const BACKGROUND = { r: 0x12, g: 0x12, b: 0x12, alpha: 1 };

/**
 * What gets made, and how much of the canvas the picture fills in each.
 *
 * `maskable` at 0.72 rather than the 0.66 the logo needed: an uploaded icon
 * is usually already square and already has its own margin, where the logo
 * crop was a wide mark with none. Still inside the guaranteed circle for
 * anything square — a square at 0.72 has a diagonal of 1.02, which is over
 * 0.8 — so it is drawn at 0.72 of the *width* and a square picture's corners
 * may be shaved by a strict circular mask. That is the trade every square
 * app icon makes; the alternative is 0.56, which looks like a stamp.
 */
const SIZES = [
  { file: 'favicon-32.png',        size: 32,  fill: 0.92, purpose: 'favicon' },
  { file: 'apple-touch-icon.png',  size: 180, fill: 0.82, purpose: 'apple' },
  { file: 'icon-192.png',          size: 192, fill: 0.82, purpose: 'any' },
  { file: 'icon-512.png',          size: 512, fill: 0.82, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, fill: 0.72, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, fill: 0.72, purpose: 'maskable' }
];

/** The settings key each file's URL is remembered under. */
const SETTING_FOR = {
  'favicon-32.png':        'icon_favicon',
  'apple-touch-icon.png':  'icon_apple',
  'icon-192.png':          'icon_192',
  'icon-512.png':          'icon_512',
  'icon-maskable-192.png': 'icon_maskable_192',
  'icon-maskable-512.png': 'icon_maskable_512'
};

/** Every settings key this writes, so saveCMS knows not to prune them. */
const ICON_SETTINGS = Object.values(SETTING_FOR);

/**
 * One picture in, six PNGs out.
 *
 * Throws if the bytes are not a readable image, which is the caller's cue to
 * say so rather than to store something nothing can open.
 */
async function makeIconSet(bytes) {
  const sharp = require('sharp');
  // failOn: 'none' so a slightly malformed but openable file is still used —
  // a phone photo out of a messaging app is often technically wrong.
  const source = sharp(bytes, { failOn: 'none' }).rotate();

  // Read it once to fail early and clearly, before six conversions.
  const meta = await source.clone().metadata();
  if (!meta.width || !meta.height) throw new Error('not an image');

  const out = [];
  for (const { file, size, fill } of SIZES) {
    const inner = Math.round(size * fill);
    const fitted = await source.clone()
      .resize(inner, inner, { fit: 'inside', withoutEnlargement: false,
                              background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const png = await sharp({
      create: { width: size, height: size, channels: 4, background: BACKGROUND }
    }).composite([{ input: fitted, gravity: 'centre' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    out.push({ file, bytes: png, setting: SETTING_FOR[file] });
  }
  return out;
}

module.exports = { makeIconSet, SIZES, SETTING_FOR, ICON_SETTINGS, BACKGROUND };

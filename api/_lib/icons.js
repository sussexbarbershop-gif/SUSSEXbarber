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
 *
 * What this deliberately does not do is decide how big the mark should be.
 * The first version did: it shrank whatever arrived to 82% of the icon, or
 * 72% for the cropped pair, on the reasoning that an uploaded logo comes with
 * no margin of its own. That was written before the panel had an editor.
 *
 * Now the owner drags and zooms against a dashed circle that says everything
 * inside it is kept, and presses Save on a picture they have composed. A
 * second shrink here made the phone disagree with the preview they were
 * looking at — the mark landed noticeably smaller than they had placed it,
 * and zooming in only closed part of the gap. So the square that arrives is
 * the square that ships, and the circle in the panel is the whole truth.
 */

// The same charcoal as the hero, the panel and the emails.
const BACKGROUND = { r: 0x12, g: 0x12, b: 0x12, alpha: 1 };

/**
 * What gets made. Every one of them is the uploaded square at a new size.
 *
 * The maskable pair is not drawn smaller than the rest any more, and the
 * reason is the panel: the editor draws the guaranteed circle over the canvas
 * while the owner is composing, so the margin a cropped icon needs is decided
 * by eye, once, in the place where it can be seen. Deciding it a second time
 * here only moved the mark away from where they put it.
 */
const SIZES = [
  { file: 'favicon-32.png',        size: 32,  purpose: 'favicon' },
  { file: 'apple-touch-icon.png',  size: 180, purpose: 'apple' },
  { file: 'icon-192.png',          size: 192, purpose: 'any' },
  { file: 'icon-512.png',          size: 512, purpose: 'any' },
  { file: 'icon-maskable-192.png', size: 192, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' }
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
  for (const { file, size } of SIZES) {
    // 'contain' rather than 'cover': the panel always sends a square, so this
    // is a plain resize — but a square is not something to assume of a caller
    // that has not been written yet, and cropping one by surprise is worse
    // than letting the charcoal show at the sides.
    const fitted = await source.clone()
      .resize(size, size, { fit: 'contain', background: BACKGROUND })
      .toBuffer();
    // Still composited onto opaque charcoal rather than sent as-is, so a
    // picture with a transparent background does not land on whatever colour
    // the launcher paints.
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

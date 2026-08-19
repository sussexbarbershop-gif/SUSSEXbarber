/**
 * The screen iOS shows while the app is opening.
 *
 * Android gets one for nothing: Chrome reads background_color and the 512
 * icon out of the manifest and draws it. iOS reads neither. It wants a picture
 * cut to the exact pixel size of the device, named in a <link> in the page,
 * and it ignores anything whose media query does not match to the pixel — so
 * "one big image, scaled" is not on offer.
 *
 * Which would mean a dozen files in the repo, cut by hand, and cut again every
 * time the shop changes its icon. So they are drawn here instead, from the
 * icon that is currently saved. The <link> tags in index.html are static and
 * point at this route with a size on the end; what comes back follows whatever
 * the panel last uploaded, with no second thing for anybody to remember.
 *
 * The sizes are a whitelist rather than anything the query string asks for.
 * Without one this is an open invitation to render arbitrarily large images on
 * somebody else's account, which is a bill rather than a bug.
 */

const { BACKGROUND } = require('./_lib/icons');

/**
 * Every iPhone screen the site is likely to be opened on, as device pixels.
 *
 * Portrait only. A home-screen app launched sideways is rare enough that the
 * alternative — doubling this list, and the link tags with it — buys less than
 * it costs. An unmatched launch shows the old blank screen, which is what
 * every launch does today.
 *
 * Kept in step with the <link> tags by tests/ios-splash.test.js rather than by
 * anybody noticing: a size here with no tag is an image nothing asks for, and
 * a tag with no size here is a launch that 404s.
 */
const SCREENS = [
  { css: [320, 568], dpr: 2, phones: 'SE (1st), 5, 5s' },
  { css: [375, 667], dpr: 2, phones: 'SE (2nd, 3rd), 6, 7, 8' },
  { css: [414, 896], dpr: 2, phones: 'XR, 11' },
  { css: [414, 736], dpr: 3, phones: '8 Plus' },
  { css: [375, 812], dpr: 3, phones: 'X, XS, 11 Pro, 12 mini, 13 mini' },
  { css: [414, 896], dpr: 3, phones: 'XS Max, 11 Pro Max' },
  { css: [390, 844], dpr: 3, phones: '12, 12 Pro, 13, 13 Pro, 14' },
  { css: [393, 852], dpr: 3, phones: '14 Pro, 15, 15 Pro, 16' },
  { css: [402, 874], dpr: 3, phones: '16 Pro' },
  { css: [428, 926], dpr: 3, phones: '12 Pro Max, 13 Pro Max, 14 Plus' },
  { css: [430, 932], dpr: 3, phones: '14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus' },
  { css: [440, 956], dpr: 3, phones: '16 Pro Max' }
].map(s => Object.assign(s, { w: s.css[0] * s.dpr, h: s.css[1] * s.dpr }));

/** The media query iOS matches a launch screen against, to the pixel. */
function mediaFor(screen) {
  return `(device-width: ${screen.css[0]}px) and (device-height: ${screen.css[1]}px) ` +
         `and (-webkit-device-pixel-ratio: ${screen.dpr}) and (orientation: portrait)`;
}

/** The whole <link> tag, so the page and this file cannot drift apart. */
function linkFor(screen) {
  return `<link rel="apple-touch-startup-image" media="${mediaFor(screen)}" ` +
         `href="/api/splash?w=${screen.w}&amp;h=${screen.h}">`;
}

/**
 * How much of the screen's width the mark takes.
 *
 * A launch screen is not a poster. Apple's own are close to empty, and the
 * point of the thing is that it is gone before it is read — something large
 * enough to look at is something that looks broken for the half second it is
 * up.
 */
const MARK_WIDTH = 0.42;

const allowed = (w, h) => SCREENS.some(s => s.w === w && s.h === h);

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const w = Number(q.w);
  const h = Number(q.h);
  if (!allowed(w, h)) {
    res.status(404);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('No launch screen that size.');
  }

  try {
    const png = await drawSplash(w, h);
    res.status(200);
    res.setHeader('Content-Type', 'image/png');
    // Long enough that a launch is not a database read, short enough that a
    // shop that has just changed its icon sees it the same afternoon.
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    return res.send(png);
  } catch (err) {
    console.error('[splash]', err);
    // A blank charcoal screen is the right failure: the app still opens, and
    // it opens onto the colour it was going to open onto anyway.
    res.status(200);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(await plain(w, h));
  }
};

const sharp = () => require('sharp');

/** Charcoal, and nothing else. */
function plain(w, h) {
  return sharp()({ create: { width: w, height: h, channels: 4, background: BACKGROUND } })
    .png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Charcoal with the shop's mark in the middle.
 *
 * The icon it draws is the 512 one the panel saved, which already sits on the
 * same charcoal — so this composites without a seam and without needing to
 * know anything about what is in the picture.
 */
async function drawSplash(w, h) {
  // Required here rather than at the top so this file can be loaded — and its
  // screen list read — without a database driver present.
  const { readConfig } = require('./_lib/db');
  const config = await readConfig();
  const url = (config.settings || {}).icon_512 || (config.settings || {}).icon_apple;
  if (!url) return plain(w, h);

  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`icon fetch: ${answer.status}`);
  const bytes = Buffer.from(await answer.arrayBuffer());

  const side = Math.round(w * MARK_WIDTH);
  const mark = await sharp()(bytes, { failOn: 'none' })
    .resize(side, side, { fit: 'inside' })
    .toBuffer();

  return sharp()({ create: { width: w, height: h, channels: 4, background: BACKGROUND } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports.SCREENS = SCREENS;
module.exports.MARK_WIDTH = MARK_WIDTH;
module.exports.mediaFor = mediaFor;
module.exports.linkFor = linkFor;

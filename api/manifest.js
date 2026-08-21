/**
 * The web app manifest, built from the shop's own settings.
 *
 * It was a static file, which meant the icons were whatever had been committed
 * and changing them was a job for whoever had the repository. The shop uploads
 * its own now, so this reads them.
 *
 * Served at /manifest.webmanifest by a rewrite in vercel.json, because that is
 * the path the <link> in every page points at and the path a browser caches
 * under. Nothing on the front end knows it stopped being a file.
 *
 * With nothing uploaded it answers with the icons committed alongside the
 * site, so the manifest is never a document full of dead links.
 */
const { readConfig } = require('./_lib/db');

const BUILT_IN = {
  icon_192:           '/assets/icons/icon-192.png',
  icon_512:           '/assets/icons/icon-512.png',
  icon_maskable_192:  '/assets/icons/icon-maskable-192.png',
  icon_maskable_512:  '/assets/icons/icon-maskable-512.png'
};

module.exports = async function handler(req, res) {
  let settings = {};
  try {
    settings = (await readConfig()).settings || {};
  } catch (err) {
    // A manifest that answers with the committed icons is worth far more than
    // one that 500s: the second is a phone that cannot install the site at all.
    console.error('[manifest] could not read settings:', err.message);
  }

  const pick = key => String(settings[key] || '').trim() || BUILT_IN[key];

  const manifest = {
    name: 'Sussex Barber Shop',
    // About thirteen characters is what fits under an icon. Without this,
    // Android cuts the <title> and the label reads "Barber in W".
    short_name: 'Sussex Barber',
    description: 'Book a haircut, beard trim or hot towel shave in Wassenaar.',
    lang: 'en',
    start_url: '/?from=home',
    scope: '/',
    /**
     * How much of the screen the app gets.
     *
     * standalone means no address bar, which is what took the browser chrome
     * away — but Chrome still paints a band of theme_color above the page for
     * the clock and the battery, and starts the page underneath it. That band
     * is the seam the shop kept seeing next to the iPhone, where the page runs
     * under the status bar and the photograph reaches the very top.
     *
     * There is no way to ask Chrome for "standalone, but let me draw behind
     * the status bar" — on Android 15 it does that on its own, and below it,
     * it does not. What there is, is fullscreen: no system bars at all, the
     * page gets every pixel.
     *
     * display_override rather than changing display, so this is a preference
     * and not a demand. A browser that understands the list takes the first
     * mode it supports; one that does not ignores the list entirely and reads
     * display below, which still says standalone. So nothing anywhere is worse
     * off than it was.
     *
     * iOS reads none of this. A home-screen app there is governed by
     * apple-mobile-web-app-capable in index.html, and already runs under the
     * status bar — so this changes Android and leaves the iPhone alone.
     *
     * The trade is the clock and the battery, which are not shown while the
     * app is open. For a page somebody is on for a minute to book a haircut
     * that is a fair price for the top of the screen; for anything longer it
     * would not be.
     */
    display_override: ['standalone'],
    // And display itself, not only the override.
    //
    // display_override is read first by anything that understands it, and
    // display is what everything else reads — so leaving this at standalone
    // meant a browser that ignores the list carried on painting its band.
    // 'fullscreen' is one of the four values the original spec defines, and
    // the fallback chain when it is unsupported is fullscreen -> standalone,
    // which is exactly where this was. So there is no browser this makes
    // worse and one class of them it fixes.
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#121212',
    theme_color: '#121212',
    icons: [
      { src: pick('icon_192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: pick('icon_512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: pick('icon_maskable_192'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: pick('icon_maskable_512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [{
      name: 'Book an appointment',
      short_name: 'Book',
      url: '/?from=home#booking',
      icons: [{ src: pick('icon_192'), sizes: '192x192' }]
    }, {
      // Long-pressing the app icon reaches this. It is here because an
      // installed app has no address bar: there was no way to open a
      // diagnostic page on the one device whose answer was needed, and five
      // taps on a logo turned out to be more than could be relied on.
      name: 'Device report',
      short_name: 'Report',
      url: '/?report=1',
      icons: [{ src: pick('icon_192'), sizes: '192x192' }]
    }]
  };

  res.status(200);
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  // Revalidated every time, like every other document on this site.
  //
  // This was ten minutes with a day of stale-while-revalidate behind it, on
  // the reasoning that a manifest is read on every page load and a new icon
  // arriving the same afternoon was soon enough. Both halves were wrong.
  //
  // It is not read on every page load. It is read when somebody installs the
  // app and when Chrome gets round to checking for an update — twice in a
  // month, not twice a minute — so there was no cost to save.
  //
  // And stale-while-revalidate means a copy up to a day old is handed over
  // immediately while a fresh one is fetched for next time. So the shop
  // deleted their shortcut, added it again, and Chrome installed from a
  // manifest written before the change they were testing. Twice. The fix
  // looked like it had not worked, and the only evidence either way was a
  // photograph of a black strip.
  //
  // A manifest is about a kilobyte. Fetching it fresh is not a cost worth one
  // wasted install, let alone the day of them this could have caused.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.send(JSON.stringify(manifest));
};

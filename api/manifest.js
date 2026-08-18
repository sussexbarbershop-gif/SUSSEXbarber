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
    }]
  };

  res.status(200);
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  // Long enough that every page load is not a database read, short enough that
  // a new icon is on the shop's own phone the same afternoon.
  res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
  res.send(JSON.stringify(manifest));
};

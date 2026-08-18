/** Mirrors the config that used to sit inline next to the CDN script tag. */
module.exports = {
  // The two legal pages share the compiled sheet. Leaving them out compiled a
  // stylesheet that knew nothing about them, and they rendered as unstyled
  // text — which looks exactly like a broken page, on the two pages a customer
  // is most entitled to take seriously.
  content: ['./index.html', './privacy.html', './terms.html', './cancel.html'],
  // The site follows the device. Every `dark:` utility compiles to a
  // prefers-color-scheme query instead of waiting for a class on <html>, so
  // there is nothing to toggle and nothing to remember between visits.
  darkMode: 'media',

  // Every `hover:` utility becomes @media (hover: hover), which is the fix for
  // a bug reported from a phone: tap the EN button once and it keeps its filled
  // background for ever.
  //
  // That is not the button. On a touch screen there is no pointer to leave, so
  // :hover latches on tap and stays until something else is tapped — and every
  // hover: class on the page had it. The language button was simply the one
  // where it showed, because it is the only control whose resting state is
  // transparent and whose hover state is a solid fill.
  //
  // A device with a real pointer is unaffected: it has a pointer, so the query
  // matches and hover works exactly as before.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        charcoal: { 900: '#121212', 800: '#1a1a1a', 700: '#2a2a2a' },
        gold: '#d4af37',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      // The booking wizard's three steps. Material 3's emphasized-decelerate
      // rather than ease-out, and half a second rather than four tenths: a
      // step is a whole panel of content arriving, which is the case the
      // emphasized curve exists for. Its long tail is what makes the panel
      // read as settling into place instead of stopping dead.
      //
      // Written out rather than referring to the custom properties in
      // index.html, because Tailwind compiles this file at build time and has
      // no way to read them. They have to be kept in step by hand, and
      // touch.test.js is what notices when they are not.
      animation: {
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.05, 0.7, 0.1, 1) forwards',
        'slide-in-left': 'slideInLeft 0.5s cubic-bezier(0.05, 0.7, 0.1, 1) forwards',
      },
      keyframes: {
        // A shorter journey than it looks. Thirty pixels was chosen when the
        // curve was ease-out; under emphasized-decelerate most of the distance
        // is covered early, so the same thirty reads as further and lands
        // softer. It stays.
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(30px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-30px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
};

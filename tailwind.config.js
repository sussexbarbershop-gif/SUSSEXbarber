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
      animation: {
        'slide-in-right': 'slideInRight 0.4s ease-out forwards',
        'slide-in-left': 'slideInLeft 0.4s ease-out forwards',
      },
      keyframes: {
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

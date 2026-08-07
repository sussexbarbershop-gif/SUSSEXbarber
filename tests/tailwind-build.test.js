// assets/tailwind.css is built ahead of time and committed. A class added to
// index.html therefore does nothing until `npm run build:css` runs again — and
// it fails silently: the markup looks right, the class is simply not styled.
//
// This reads every class the page uses and checks the compiled sheet knows it.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'tailwind.css'), 'utf8');

// Classes the site defines itself, in the <style> block rather than Tailwind.
const ownStyles = new Set(
  [...(html.match(/<style>[\s\S]*?<\/style>/) || [''])[0]
    .matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1])
);

// Tailwind escapes . : [ ] ( ) / % ! # and friends in the selector it emits.
const selectorFor = cls => '.' + cls.replace(/([.:[\]()/!#%,'"+*~^$=<>&|{}?])/g, '\\$1');

const used = new Set();
for (const m of html.matchAll(/class="([^"]*)"/g)) {
  for (const cls of m[1].split(/\s+/)) {
    if (!cls || cls.includes('${')) continue;   // template hole, not a class
    used.add(cls);
  }
}

// Names that are hooks for JavaScript or for the page's own <style>, not
// Tailwind utilities, so the compiled sheet is right not to carry them.
const structural = new Set([
  'group', 'peer', 'dark', 'reveal', 'active',
  'mobile-link',            // querySelectorAll target for the mobile menu
  'cms-contact-phone',      // text filled in from the Sheet
  'cms-contact-phone-link'  // href filled in from the Sheet
]);

const missing = [...used].filter(cls =>
  !structural.has(cls) &&
  !ownStyles.has(cls) &&
  !css.includes(selectorFor(cls))
).sort();

console.log(`classes used in index.html: ${used.size}`);
if (missing.length) {
  console.log('\nNot present in assets/tailwind.css:');
  missing.forEach(c => console.log('  ' + c));
  console.log('\nRun: npm run build:css');
  process.exit(1);
}
console.log('Every one of them is in the compiled stylesheet.');

const fs = require('fs');
const file = 'c:/Users/ultim/Downloads/SUSSEXbarber/SUSSEXbarber.html';
let html = fs.readFileSync(file, 'utf8');

const dict = {
    'About': 'Over Ons',
    'Services': 'Diensten',
    'Gallery': 'Gallerij',
    'Contact': 'Contact',
    'Book Now': 'Boek Nu',
    'Our Work': 'Ons Werk',
    'Our Master Barbers': 'Onze Meesterkappers',
    'Our Services': 'Onze Diensten',
    'Book an Appointment': 'Maak een afspraak',
    '1. Choose Service': '1. Kies Dienst',
    '2. Choose Barber (Optional)': '2. Kies Kapper (Optioneel)',
    'Any Available Barber': 'Elke Beschikbare Kapper',
    'Next Step': 'Volgende Stap',
    '1. Select Date': '1. Selecteer Datum',
    '2. Select Time Slot': '2. Selecteer Tijdslot',
    'Please choose a date first': 'Kies eerst een datum',
    'Your Full Name': 'Uw Volledige Naam',
    'Back': 'Terug',
    'Confirm Booking': 'Bevestig Boeking',
    'Booking Confirmed!': 'Boeking Bevestigd!',
    'Booking Summary': 'Boekingsoverzicht',
    'Add to Calendar': 'Zet in Agenda',
    'Book Another': 'Nog een boeken',
    'Working Hours': 'Werktijden',
    'Location': 'Locatie',
    'Call Us': 'Bel Ons',
    'Follow Us': 'Volg Ons',
    'Monday - Friday': 'Maandag - Vrijdag',
    'Saturday': 'Zaterdag',
    'Sunday': 'Zondag',
    'Closed': 'Gesloten',
    'Client Testimonials': 'Klantbeoordelingen',
    'Frequently Asked Questions': 'Veelgestelde Vragen',
    'Masterful Cuts.<br><span class=\"text-gold italic\">Timeless Style.</span>': 'Meesterlijke Snits.<br><span class=\"text-gold italic\">Tijdloze Stijl.</span>',
    'Experience premium grooming and hearty service in the heart of Wassenaar.': 'Ervaar premium verzorging en hartelijke service in het hart van Wassenaar.'
};

let script = \
    <script>
        const i18n = \;
        let currentLang = 'en';
        
        function toggleLanguage() {
            currentLang = currentLang === 'en' ? 'nl' : 'en';
            
            // Update Toggle Button Text
            const langBtn = document.getElementById('langToggleBtn');
            if (langBtn) {
                langBtn.innerHTML = currentLang === 'en' ? '🇬🇧 EN' : '🇳🇱 NL';
            }
            
            // Walk DOM and replace text
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let n;
            while (n = walk.nextNode()) {
                const parent = n.parentElement;
                if(parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) continue;
                
                let text = n.nodeValue.trim();
                if(!text) continue;
                
                // Store original EN text if not stored
                if(!parent.dataset.en) {
                    // Check if the exact text exists in dictionary
                    if(i18n[text]) {
                        parent.dataset.en = text;
                        parent.dataset.nl = i18n[text];
                    }
                }
                
                if(parent.dataset.en) {
                    if (currentLang === 'nl') {
                        if (parent.dataset.nl) {
                            n.nodeValue = n.nodeValue.replace(parent.dataset.en, parent.dataset.nl);
                        }
                    } else {
                        if (parent.dataset.en) {
                            n.nodeValue = n.nodeValue.replace(parent.dataset.nl, parent.dataset.en);
                        }
                    }
                }
            }
            
            // Handle placeholders
            document.querySelectorAll('input[placeholder]').forEach(inp => {
                if(!inp.dataset.enPlaceholder) {
                    const ph = inp.getAttribute('placeholder');
                    inp.dataset.enPlaceholder = ph;
                    // basic mappings
                    if(ph === 'John Doe') inp.dataset.nlPlaceholder = 'Jan Jansen';
                }
                
                if(currentLang === 'nl' && inp.dataset.nlPlaceholder) {
                    inp.setAttribute('placeholder', inp.dataset.nlPlaceholder);
                } else if(inp.dataset.enPlaceholder) {
                    inp.setAttribute('placeholder', inp.dataset.enPlaceholder);
                }
            });
        }
    </script>
\;

html = html.replace('</body>', script + '\\n</body>');

fs.writeFileSync(file, html, 'utf8');
console.log('Injected i18n script');

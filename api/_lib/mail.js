/**
 * Booking emails.
 *
 * MailApp went with the Apps Script, so these go out over plain HTTPS. Two
 * providers are supported, and whichever key is present is the one used.
 *
 * Environment — set ONE of these:
 *   BREVO_API_KEY    Brevo. Verifies a single sender address by emailing it a
 *                    link, so the shop can send as its own Gmail with no
 *                    domain and nothing to pay. 300 a day.
 *   RESEND_API_KEY   Resend. Verifies a whole domain and nothing less, so it
 *                    can only reach the account owner's own inbox until the
 *                    shop has a domain. Better deliverability once it does.
 *
 * And:
 *   MAIL_FROM        "Sussex Barber Shop <sussexbarbershop@gmail.com>".
 *                    With Brevo this has to be the address that was verified.
 *   NOTIFY_EMAIL     where the shop's own notifications go
 *
 * Two providers rather than one because of what used to be a real constraint:
 * the shop had no domain, only a vercel.app address, which belongs to Vercel
 * and cannot be verified. Single-sender verification was the only free way to
 * reach customers.
 *
 * The shop has sussexbarber.nl now, so Resend is available: verify the domain
 * with it, set RESEND_API_KEY instead of BREVO_API_KEY, and point MAIL_FROM at
 * an address on the domain. Nothing here changes. Mail from a domain the shop
 * owns is far less likely to be filed as spam than mail from a Gmail address
 * sent by somebody else's server.
 *
 * Every function here swallows its failures, for the same reason the Apps
 * Script did: the booking is already saved by the time these run, and a
 * bounced address must not turn a confirmed appointment into an error for the
 * customer. The failure goes to the Vercel log, which — unlike the Apps Script
 * execution log — is somewhere the owner will actually be looking when they
 * ask why no email arrived.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = v => EMAIL_RE.test(String(v || '').trim());

const SHOP_NAME = 'Sussex Barber Shop';

/** '<name> <addr@x>' or 'addr@x' -> { name, email }, which Brevo wants split. */
function splitFrom(value) {
  const m = String(value || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || SHOP_NAME, email: m[2].trim() };
  return { name: SHOP_NAME, email: String(value || '').trim() };
}

async function sendViaBrevo(key, { to, subject, text, html, replyTo }) {
  const from = splitFrom(process.env.MAIL_FROM || process.env.NOTIFY_EMAIL);
  if (!isEmail(from.email)) {
    console.error('[mail] MAIL_FROM is not a verified sender address:', from.email);
    return false;
  }
  // Both parts, always. A client that will not render HTML — a watch, a
  // screen reader, a mail rule — falls back to the text one, and a message
  // sent as HTML alone arrives at those as nothing at all.
  const body = {
    sender: { name: from.name, email: from.email },
    to: [{ email: to }],
    subject,
    textContent: text
  };
  if (html) body.htmlContent = html;
  if (replyTo) body.replyTo = { email: replyTo };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    console.error('[mail] Brevo refused it:', res.status, await res.text());
    return false;
  }
  return true;
}

async function sendViaResend(key, { to, subject, text, html, replyTo }) {
  // onboarding@resend.dev works out of the box but only delivers to the
  // account owner's address — enough to prove the wiring, not enough to
  // confirm anything to a customer.
  const from = process.env.MAIL_FROM || `${SHOP_NAME} <onboarding@resend.dev>`;
  const body = { from, to: [to], subject, text };
  if (html) body.html = html;
  if (replyTo) body.reply_to = [replyTo];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    console.error('[mail] Resend refused it:', res.status, await res.text());
    return false;
  }
  return true;
}

/**
 * Hand one message to whichever provider is configured.
 * Resolves either way; never throws. True only when it was accepted.
 */
async function send(message) {
  const brevo = process.env.BREVO_API_KEY;
  const resend = process.env.RESEND_API_KEY;
  if (!brevo && !resend) {
    console.warn('[mail] no BREVO_API_KEY or RESEND_API_KEY — nothing sent to', message.to);
    return false;
  }
  try {
    // Brevo first when both are set: it is the one that can reach customers
    // without a domain, so it is the deliberate choice if someone configured
    // both and forgot which.
    return brevo ? await sendViaBrevo(brevo, message) : await sendViaResend(resend, message);
  } catch (err) {
    console.error('[mail] could not reach the mail provider:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// What the emails look like
// ---------------------------------------------------------------------------

/**
 * Where the links point. The cancel button in a confirmation is useless if it
 * points at a preview deployment, so this is the shop's own address unless
 * something deliberately says otherwise.
 */
const SITE_URL = (process.env.SITE_URL || 'https://sussexbarber.nl').replace(/\/+$/, '');

const esc = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One email, as HTML.
 *
 * Written the way email has to be written rather than the way the website is:
 * tables for layout, every style inline, no stylesheet and no web font.
 * Outlook renders with Word's engine and understands almost no CSS; Gmail
 * strips <style> blocks on some clients and not others. A layout that depends
 * on flexbox looks correct everywhere it is tested and collapses in the one
 * place the customer reads it.
 *
 * Playfair Display is the site's headline face and cannot be loaded here, so
 * the serif stack falls back to Georgia — near enough, and present everywhere.
 *
 * Light background on purpose. A dark email is inverted by some clients and
 * left alone by others, and the version nobody checked is the one that comes
 * out grey on grey.
 */
function shell({ preheader, heading, lead, rows, button, note, config }) {
  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const address = String(settings.contact_address || '').trim()
    .replace(/<br\s*\/?>/gi, ', ');

  const detail = (rows || []).filter(r => r && r[1]).map(([label, value]) => `
    <tr>
      <td style="padding:7px 0;font:400 13px Arial,sans-serif;color:#6b6b6b;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:7px 0 7px 20px;font:700 15px Arial,sans-serif;color:#1a1a1a;">${esc(value)}</td>
    </tr>`).join('');

  // A bulletproof-ish button: a padded anchor on its own table cell. An <a>
  // with a background and no table around it loses its colour in Outlook.
  const cta = button ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
      <tr><td style="background:#d4af37;border-radius:6px;">
        <a href="${esc(button.url)}" style="display:inline-block;padding:14px 30px;font:700 14px Arial,sans-serif;color:#1a1a1a;text-decoration:none;letter-spacing:.4px;">${esc(button.label)}</a>
      </td></tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<!-- The line the inbox shows next to the subject. Hidden in the email itself:
     without it, clients pick the first words of the body, which is "Hello". -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">

      <tr><td style="background:#121212;padding:26px 32px;">
        <div style="font:600 21px Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.5px;">${esc(SHOP_NAME)}</div>
        <div style="font:400 11px Arial,sans-serif;color:#d4af37;letter-spacing:2.4px;text-transform:uppercase;padding-top:5px;">Wassenaar</div>
      </td></tr>

      <tr><td style="padding:32px 32px 8px;">
        <div style="font:600 22px Georgia,'Times New Roman',serif;color:#1a1a1a;">${esc(heading)}</div>
        <div style="font:400 15px/1.6 Arial,sans-serif;color:#4a4a4a;padding-top:12px;">${lead || ''}</div>
      </td></tr>

      ${detail ? `<tr><td style="padding:12px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#faf9f6;border-left:3px solid #d4af37;border-radius:0 6px 6px 0;">
          <tr><td style="padding:16px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">${detail}</table>
          </td></tr>
        </table>
      </td></tr>` : ''}

      ${cta || note ? `<tr><td style="padding:0 32px;">
        ${cta}
        ${note ? `<div style="font:400 13px/1.6 Arial,sans-serif;color:#6b6b6b;padding-top:16px;">${note}</div>` : ''}
      </td></tr>` : ''}

      <tr><td style="padding:28px 32px 30px;">
        <div style="border-top:1px solid #eceae4;padding-top:18px;font:400 13px/1.7 Arial,sans-serif;color:#8a8a8a;">
          ${address ? `${esc(address)}<br>` : ''}
          ${phone ? `<a href="tel:${esc(phone.replace(/\s/g, ''))}" style="color:#8a7320;text-decoration:none;">${esc(phone)}</a><br>` : ''}
          <a href="${SITE_URL}" style="color:#8a7320;text-decoration:none;">sussexbarber.nl</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// In the customer's own language
// ---------------------------------------------------------------------------

/**
 * The shop is in Wassenaar and most of its customers are Dutch, but the site
 * opens in English and they have to press EN/NL to change it. Which they
 * pressed is now recorded with the booking, so everything that follows arrives
 * in the language they were actually reading.
 *
 * A confirmation is the first thing a customer sees from the shop in writing.
 * Sending it in the wrong language is a small thing that says something.
 *
 * Anything not 'nl' is English, including a booking taken before this column
 * existed and one the shop typed in itself. English is the safer default of
 * the two: a Dutch customer reads it, an English-speaking one cannot read the
 * other.
 */
const langOf = booking => (String((booking && booking.lang) || '').toLowerCase() === 'nl' ? 'nl' : 'en');

/** Pick one of two. Kept tiny on purpose: two languages, no framework. */
const say = (lang, pair) => (lang === 'nl' ? pair[1] : pair[0]);

/** The barber column holds '' for "no preference", which each language names. */
const barberName = (booking, lang) =>
  String((booking && booking.barber) || '').trim() ||
  say(lang, ['Any Available', 'Elke Beschikbare Kapper']);

/**
 * '02:30 PM' as a Dutch reader writes it: 14:30.
 *
 * The diary speaks twelve-hour time because that is what the booking form
 * shows, and the form shows it because the site was written in English. The
 * Netherlands does not use it. "om 02:30 PM" is not a time a Dutch customer
 * reads without stopping, and half past two in the morning is a real reading
 * of it.
 *
 * Only the wording changes. Nothing stored moves, and the English emails still
 * say what the site says.
 */
function timeIn(lang, label) {
  const text = String(label || '').trim();
  if (lang !== 'nl') return text;
  const m = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return text;                       // already 24-hour, or unreadable
  let hours = parseInt(m[1], 10);
  const period = m[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${m[2]}`;
}

const LABELS = {
  when:    ['When', 'Wanneer'],
  time:    ['Time', 'Tijd'],
  was:     ['Was', 'Was'],
  service: ['Service', 'Dienst'],
  barber:  ['Barber', 'Kapper'],
  where:   ['Where', 'Waar']
};
const label = (lang, key) => say(lang, LABELS[key]);

const line = (label, value) => `${label.padEnd(9)}${value}`;

function bookingLines(b) {
  const out = [
    line('When:', `${b.date || ''} at ${b.time || ''}`),
    line('Who:', b.name || ''),
    line('Phone:', b.phone || ''),
    line('Email:', String(b.email || '').trim() || '—'),
    line('Service:', b.service || ''),
    line('Barber:', String(b.barber || '').trim() || 'Any Available')
  ];
  if (b.price) out.push(line('Price:', `EUR ${b.price}`));
  return out;
}

/** Tell the shop a booking came in, so nobody has to watch the panel. */
async function sendBookingNotice(booking) {
  const to = String(process.env.NOTIFY_EMAIL || '').trim();
  if (!isEmail(to)) return false;
  const when = `${booking.date || ''} at ${booking.time || ''}`;
  return send({
    to,
    // The subject alone should be enough to read on a lock screen.
    subject: `Booking: ${booking.name || 'customer'} — ${when}`,
    text: ['New booking', ''].concat(bookingLines(booking)).join('\n') + '\n',
    // Replying to the notification then reaches the customer.
    replyTo: isEmail(booking.email) ? String(booking.email).trim() : undefined
  });
}

/** A chair has come free — worth knowing sooner than a booking. */
async function sendCancellationNotice(booking) {
  const to = String(process.env.NOTIFY_EMAIL || '').trim();
  if (!isEmail(to)) return false;
  const when = `${booking.date || ''} at ${booking.time || ''}`;
  return send({
    to,
    subject: `CANCELLED: ${booking.name || 'customer'} — ${when}`,
    text: ['Booking cancelled', ''].concat(bookingLines(booking))
      .concat(['', 'The slot is free to book again.']).join('\n') + '\n'
  });
}

/** Confirm the appointment to the customer, if they left an address. */
async function sendCustomerConfirmation(booking, config) {
  const to = String(booking.email || '').trim();
  // Checked again here. This came from a public form, so whatever arrived is
  // not to be trusted just because the browser looked at it first.
  if (!isEmail(to)) return false;

  const lang = langOf(booking);
  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const address = String(settings.contact_address || '').trim().replace(/<br\s*\/?>/gi, ', ');
  const barber = barberName(booking, lang);
  const when = `${booking.date || ''} ${say(lang, ['at', 'om'])} ${timeIn(lang, booking.time)}`;

  // One link, for one booking. See cancelToken() in auth.js for why this
  // exists now when it deliberately did not before.
  const cancelUrl = booking.cancelToken
    ? `${SITE_URL}/cancel.html?b=${encodeURIComponent(booking.cancelToken)}&l=${lang}`
    : '';

  const lines = [
    say(lang, [`Hello ${booking.name || ''},`, `Hallo ${booking.name || ''},`]),
    '',
    say(lang, [`Your appointment at ${SHOP_NAME} is booked.`,
               `Uw afspraak bij ${SHOP_NAME} staat genoteerd.`]),
    '',
    line(label(lang, 'when') + ':', when),
    line(label(lang, 'service') + ':', booking.service || ''),
    line(label(lang, 'barber') + ':', barber)
  ];
  if (address) lines.push(line(label(lang, 'where') + ':', address));
  lines.push('');
  if (cancelUrl) {
    lines.push(say(lang, ['Cannot make it? Cancel here:', 'Kunt u niet komen? Annuleer hier:']),
               cancelUrl, '');
    lines.push(say(lang, ['Otherwise there is nothing to do — just come in.',
                          'Verder hoeft u niets te doen — kom gewoon langs.']));
  } else {
    lines.push(say(lang, ['To change or cancel, visit the website and use "Already booked?"',
                          'Wijzigen of annuleren kan op de website via "Already booked?"']));
  }
  if (phone) lines.push(say(lang, [`Any questions, call us on ${phone}.`,
                                   `Vragen? Bel ons op ${phone}.`]));
  lines.push('', say(lang, ['See you soon.', 'Tot snel.']));

  return send({
    to,
    subject: say(lang, [`Your appointment — ${when}`, `Uw afspraak — ${when}`]),
    text: lines.join('\n') + '\n',
    html: shell({
      config,
      preheader: `${when} ${say(lang, ['with', 'bij'])} ${barber}`,
      heading: say(lang, ['Your appointment is booked', 'Uw afspraak staat genoteerd']),
      lead: say(lang, [
        `Hello ${esc(booking.name || '')}, we have you down for the following.`,
        `Hallo ${esc(booking.name || '')}, wij hebben het volgende voor u genoteerd.`
      ]),
      rows: [
        [label(lang, 'when'), when],
        [label(lang, 'service'), booking.service || ''],
        [label(lang, 'barber'), barber],
        [label(lang, 'where'), address]
      ],
      button: cancelUrl
        ? { label: say(lang, ['Cancel this appointment', 'Deze afspraak annuleren']), url: cancelUrl }
        : null,
      note: cancelUrl
        // Said in this order deliberately: the button is the loud thing on the
        // page, and without a sentence beside it the email reads as though
        // cancelling is what it is for.
        ? say(lang, ['Only if you cannot make it — otherwise there is nothing to do, just come in.',
                     'Alleen als u niet kunt komen — verder hoeft u niets te doen, kom gewoon langs.'])
        : say(lang, ['To change or cancel, use &ldquo;Already booked?&rdquo; on our website.',
                     'Wijzigen of annuleren kan via &ldquo;Already booked?&rdquo; op onze website.'])
    })
  });
}

/**
 * Tell the customer their appointment is off.
 *
 * They were emailed when it was made, so silence when it is cancelled reads as
 * "did that work?" — and the one thing worse than a lost appointment is not
 * being sure whether it is lost.
 */
async function sendCustomerCancellation(booking, config) {
  const to = String(booking.email || '').trim();
  if (!isEmail(to)) return false;

  const lang = langOf(booking);
  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const when = `${booking.date || ''} ${say(lang, ['at', 'om'])} ${timeIn(lang, booking.time)}`;

  const lines = [
    say(lang, [`Hello ${booking.name || ''},`, `Hallo ${booking.name || ''},`]),
    '',
    say(lang, [`Your appointment at ${SHOP_NAME} has been cancelled.`,
               `Uw afspraak bij ${SHOP_NAME} is geannuleerd.`]),
    '',
    line(label(lang, 'was') + ':', when),
    line(label(lang, 'service') + ':', booking.service || ''),
    '',
    say(lang, ['Nothing else is needed. Book again on the website whenever suits you.',
               'Verder hoeft u niets te doen. Boek gerust opnieuw op de website wanneer het u uitkomt.'])
  ];
  if (phone) lines.push(say(lang, [`Or call us on ${phone}.`, `Of bel ons op ${phone}.`]));
  lines.push('', `${SITE_URL}`, '', say(lang, ['See you soon.', 'Tot snel.']));

  return send({
    to,
    subject: say(lang, [`Cancelled — ${when}`, `Geannuleerd — ${when}`]),
    text: lines.join('\n') + '\n',
    html: shell({
      config,
      preheader: say(lang, [`${when} is off`, `${when} gaat niet door`]),
      heading: say(lang, ['Your appointment is cancelled', 'Uw afspraak is geannuleerd']),
      // The one thing to say plainly. Somebody reading this either cancelled
      // it and wants confirmation, or did not and is about to ring up.
      lead: say(lang, [
        `Hello ${esc(booking.name || '')}, that is done — nothing else is needed.`,
        `Hallo ${esc(booking.name || '')}, dat is geregeld — verder hoeft u niets te doen.`
      ]),
      rows: [
        [label(lang, 'was'), when],
        [label(lang, 'service'), booking.service || '']
      ],
      button: { label: say(lang, ['Book another time', 'Nieuwe afspraak maken']), url: SITE_URL },
      note: phone ? say(lang, [`Or call us on ${esc(phone)}.`, `Of bel ons op ${esc(phone)}.`]) : ''
    })
  });
}

/**
 * The morning of the appointment.
 *
 * A haircut is booked days ahead and then forgotten, and a customer who does
 * not turn up costs the shop the whole slot — nobody else could book it and
 * nobody is in the chair. This is the one email that is worth sending for the
 * shop's own sake rather than the customer's, so it is kept to a few lines:
 * when, who with, and how to say if you cannot make it.
 *
 * Sent once. api/daily.js writes the time it went out and never picks the same
 * row up again, so a job that runs twice sends nothing the second time.
 */
async function sendReminder(booking, config) {
  const to = String(booking.email || '').trim();
  if (!isEmail(to)) return false;

  const lang = langOf(booking);
  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const address = String(settings.contact_address || '').trim().replace(/<br\s*\/?>/gi, ', ');
  const barber = barberName(booking, lang);

  const cancelUrl = booking.cancelToken
    ? `${SITE_URL}/cancel.html?b=${encodeURIComponent(booking.cancelToken)}&l=${lang}`
    : '';

  const lines = [
    say(lang, [`Hello ${booking.name || ''},`, `Hallo ${booking.name || ''},`]),
    '',
    say(lang, [`A reminder that your appointment at ${SHOP_NAME} is today.`,
               `Een herinnering: uw afspraak bij ${SHOP_NAME} is vandaag.`]),
    '',
    line(label(lang, 'time') + ':', timeIn(lang, booking.time)),
    line(label(lang, 'service') + ':', booking.service || ''),
    line(label(lang, 'barber') + ':', barber)
  ];
  if (address) lines.push(line(label(lang, 'where') + ':', address));
  lines.push('');
  // The point of the whole email. A customer who cannot come and says so is
  // worth more to the shop than one who is reminded and says nothing, because
  // the slot can still be sold.
  lines.push(say(lang, ['If you cannot make it, please let us know so we can offer the time to someone else.',
                        'Kunt u niet komen? Laat het ons weten, dan kunnen wij de tijd aan iemand anders aanbieden.']));
  if (cancelUrl) lines.push('', cancelUrl);
  if (phone) lines.push('', say(lang, [`Or call us on ${phone}.`, `Of bel ons op ${phone}.`]));
  lines.push('', say(lang, ['See you soon.', 'Tot straks.']));

  return send({
    // The time in the subject, because a reminder read on a lock screen and
    // never opened has still done its job.
    to,
    subject: say(lang, [`Today at ${timeIn(lang, booking.time)} — ${SHOP_NAME}`,
                        `Vandaag om ${timeIn(lang, booking.time)} — ${SHOP_NAME}`]),
    text: lines.join('\n') + '\n',
    html: shell({
      config,
      preheader: `${timeIn(lang, booking.time)} ${say(lang, ['with', 'bij'])} ${barber}`,
      heading: say(lang, ['Your appointment is today', 'Uw afspraak is vandaag']),
      lead: say(lang, [`Hello ${esc(booking.name || '')}, just a reminder.`,
                       `Hallo ${esc(booking.name || '')}, even een herinnering.`]),
      rows: [
        [label(lang, 'time'), timeIn(lang, booking.time)],
        [label(lang, 'service'), booking.service || ''],
        [label(lang, 'barber'), barber],
        [label(lang, 'where'), address]
      ],
      button: cancelUrl
        ? { label: say(lang, ['I cannot make it', 'Ik kan niet komen']), url: cancelUrl }
        : null,
      note: cancelUrl
        ? say(lang, ['Letting us know means we can offer the time to someone else.',
                     'Als u het laat weten, kunnen wij de tijd aan iemand anders aanbieden.'])
        : (phone ? say(lang, [`If you cannot make it, please call us on ${esc(phone)}.`,
                              `Kunt u niet komen, bel ons dan op ${esc(phone)}.`]) : '')
    })
  });
}

/**
 * The day after, asking for a review.
 *
 * Only ever sent to somebody who actually came in, and only once. `reviewUrl`
 * is a setting the owner fills in; with nothing there this is never called at
 * all, rather than sent with a dead link in it.
 *
 * No incentive offered, and none should be: Google removes reviews it decides
 * were paid for, and it takes the honest ones down with them.
 */
async function sendReviewRequest(booking, config, reviewUrl) {
  const to = String(booking.email || '').trim();
  if (!isEmail(to)) return false;
  const url = String(reviewUrl || '').trim();
  if (!url) return false;

  const lang = langOf(booking);
  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  // Not barberName() here: with nobody named there is no one to thank by name,
  // and "we hope Any Available looked after you" is not a sentence.
  const barber = String(booking.barber || '').trim();

  const thanks = barber
    ? say(lang, [`Thank you for coming in today — we hope ${barber} looked after you.`,
                 `Bedankt voor uw bezoek vandaag — wij hopen dat ${barber} u goed geholpen heeft.`])
    : say(lang, ['Thank you for coming in today.', 'Bedankt voor uw bezoek vandaag.']);

  // Said plainly. An email that only wants something is one people stop
  // opening, and the shop would rather hear about a bad haircut than read
  // about it in public.
  const ifWrong = say(lang, [
    'If something was not right, reply to this email' +
      (phone ? ` or call us on ${phone}` : '') + ' — we would rather fix it.',
    'Was er iets niet goed? Antwoord op deze e-mail' +
      (phone ? ` of bel ons op ${phone}` : '') + ' — wij lossen het liever op.'
  ]);

  const lines = [
    say(lang, [`Hello ${booking.name || ''},`, `Hallo ${booking.name || ''},`]),
    '',
    thanks,
    '',
    say(lang, ['If you have a moment, a short review helps people in Wassenaar find us:',
               'Heeft u even? Een korte review helpt mensen in Wassenaar ons te vinden:']),
    url,
    '',
    ifWrong,
    '',
    say(lang, ['See you next time.', 'Tot de volgende keer.'])
  ];

  return send({
    to,
    subject: say(lang, [`Thanks from ${SHOP_NAME}`, `Bedankt van ${SHOP_NAME}`]),
    text: lines.join('\n') + '\n',
    html: shell({
      config,
      preheader: say(lang, ['A quick review helps people in Wassenaar find us',
                            'Een korte review helpt mensen in Wassenaar ons te vinden']),
      heading: say(lang, ['Thank you for coming in', 'Bedankt voor uw bezoek']),
      lead: barber
        ? say(lang, [`Hello ${esc(booking.name || '')}, we hope ${esc(barber)} looked after you today.`,
                     `Hallo ${esc(booking.name || '')}, wij hopen dat ${esc(barber)} u vandaag goed geholpen heeft.`])
        : say(lang, [`Hello ${esc(booking.name || '')}, we hope you were well looked after today.`,
                     `Hallo ${esc(booking.name || '')}, wij hopen dat u vandaag goed geholpen bent.`]),
      rows: [],
      button: { label: say(lang, ['Leave a review', 'Schrijf een review']), url },
      note: esc(ifWrong)
    })
  });
}

module.exports = { sendBookingNotice, sendCancellationNotice,
                   sendCustomerConfirmation, sendCustomerCancellation,
                   sendReminder, sendReviewRequest, isEmail };

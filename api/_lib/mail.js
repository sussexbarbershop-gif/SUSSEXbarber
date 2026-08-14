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

async function sendViaBrevo(key, { to, subject, text, replyTo }) {
  const from = splitFrom(process.env.MAIL_FROM || process.env.NOTIFY_EMAIL);
  if (!isEmail(from.email)) {
    console.error('[mail] MAIL_FROM is not a verified sender address:', from.email);
    return false;
  }
  const body = {
    sender: { name: from.name, email: from.email },
    to: [{ email: to }],
    subject,
    textContent: text
  };
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

async function sendViaResend(key, { to, subject, text, replyTo }) {
  // onboarding@resend.dev works out of the box but only delivers to the
  // account owner's address — enough to prove the wiring, not enough to
  // confirm anything to a customer.
  const from = process.env.MAIL_FROM || `${SHOP_NAME} <onboarding@resend.dev>`;
  const body = { from, to: [to], subject, text };
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

  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const address = String(settings.contact_address || '').trim().replace(/<br\s*\/?>/gi, ', ');
  const barber = String(booking.barber || '').trim() || 'Any Available';

  const lines = [
    `Hello ${booking.name || ''},`,
    '',
    `Your appointment at ${SHOP_NAME} is booked.`,
    '',
    line('When:', `${booking.date || ''} at ${booking.time || ''}`),
    line('Service:', booking.service || ''),
    line('Barber:', barber)
  ];
  if (address) lines.push(line('Where:', address));
  lines.push('');
  // No cancel link. Cancelling is done on the site with the phone number the
  // booking was made under, and a link in an email would be a second way in
  // that nothing else checks.
  lines.push('To change or cancel, visit the website and use "Already booked?"');
  if (phone) lines.push(`or call us on ${phone}.`);
  lines.push('', 'See you soon.');

  return send({
    to,
    subject: `Your appointment — ${booking.date || ''} at ${booking.time || ''}`,
    text: lines.join('\n') + '\n'
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

  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();

  const lines = [
    `Hello ${booking.name || ''},`,
    '',
    `Your appointment at ${SHOP_NAME} has been cancelled.`,
    '',
    line('Was:', `${booking.date || ''} at ${booking.time || ''}`),
    line('Service:', booking.service || ''),
    '',
    'Nothing else is needed. Book again on the website whenever suits you'
  ];
  if (phone) lines.push(`, or call us on ${phone}`);
  lines.push('.', '', 'See you soon.');

  return send({
    to,
    subject: `Cancelled — ${booking.date || ''} at ${booking.time || ''}`,
    text: lines.join('\n') + '\n'
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

  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const address = String(settings.contact_address || '').trim().replace(/<br\s*\/?>/gi, ', ');
  const barber = String(booking.barber || '').trim() || 'Any Available';

  const lines = [
    `Hello ${booking.name || ''},`,
    '',
    `A reminder that your appointment at ${SHOP_NAME} is today.`,
    '',
    line('Time:', booking.time || ''),
    line('Service:', booking.service || ''),
    line('Barber:', barber)
  ];
  if (address) lines.push(line('Where:', address));
  lines.push('');
  // The point of the sentence. A customer who cannot come and knows how to say
  // so is worth more than one who is reminded and says nothing.
  lines.push('If you cannot make it, please let us know so we can offer the');
  lines.push(phone ? `time to someone else — call us on ${phone}.`
                   : 'time to someone else.');
  lines.push('', 'See you soon.');

  return send({
    // "Today" in the subject, because a reminder read on a lock screen and
    // never opened has still done its job.
    to,
    subject: `Today at ${booking.time || ''} — ${SHOP_NAME}`,
    text: lines.join('\n') + '\n'
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

  const settings = (config && config.settings) || {};
  const phone = String(settings.contact_phone || '').trim();
  const barber = String(booking.barber || '').trim();

  const lines = [
    `Hello ${booking.name || ''},`,
    '',
    barber
      ? `Thank you for coming in yesterday — we hope ${barber} looked after you.`
      : 'Thank you for coming in yesterday.',
    '',
    'If you have a moment, a short review helps people in Wassenaar find us:',
    url,
    '',
    // Said plainly. An email that only wants something is one people stop
    // opening, and the shop would rather hear about a bad haircut than read
    // about it in public.
    'If something was not right, reply to this email instead' +
      (phone ? ` or call us on ${phone}` : '') + ' — we would rather fix it.',
    '',
    'See you next time.'
  ];

  return send({
    to,
    subject: `Thanks from ${SHOP_NAME}`,
    text: lines.join('\n') + '\n'
  });
}

module.exports = { sendBookingNotice, sendCancellationNotice,
                   sendCustomerConfirmation, sendCustomerCancellation,
                   sendReminder, sendReviewRequest, isEmail };

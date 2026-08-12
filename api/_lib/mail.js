/**
 * Booking emails.
 *
 * MailApp went with the Apps Script, so this goes through Resend over plain
 * HTTPS — no SDK, because the whole surface used here is one POST.
 *
 * Environment:
 *   RESEND_API_KEY   without it nothing is sent, and nothing complains
 *   MAIL_FROM        e.g. "Sussex Barber Shop <bookings@yourdomain.com>"
 *   NOTIFY_EMAIL     where the shop's own notifications go
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

/**
 * Hand one message to Resend. Resolves either way; never throws.
 * Returns true only when Resend accepted it.
 */
async function send({ to, subject, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[mail] RESEND_API_KEY is not set — nothing sent to', to);
    return false;
  }
  // Resend will only send from a domain you have verified. onboarding@resend.dev
  // works out of the box but can only deliver to your own account address,
  // which is enough to prove the wiring before a domain is set up.
  const from = process.env.MAIL_FROM || `${SHOP_NAME} <onboarding@resend.dev>`;

  try {
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
  } catch (err) {
    console.error('[mail] could not reach Resend:', err);
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

module.exports = { sendBookingNotice, sendCancellationNotice, sendCustomerConfirmation, isEmail };

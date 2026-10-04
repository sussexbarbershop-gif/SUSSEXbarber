/** PIN-protected, in-place diary edits. Never cancel/recreate a booking: its id,
 * source, created time and existing cancel link must keep referring to it.
 * A content version prevents one editor silently overwriting another. */
const {db, withNewSchema, readRotaConfig, ensureBookingProtection, getCancelKey} = require('./db');
const {canonical} = require('../../assets/phone');
const {cancelToken} = require('./auth');
const {sendCustomerConfirmation} = require('./mail');
const rota = require('./rota');
const trim = value => String(value ?? '').trim();
const error = message => ({status:'error', message});
const VERSION = `md5(jsonb_build_array(booked_on,booked_at,service,barber,customer_name,phone,email,price,duration_min,phone_e164)::text)`;
// Snapshot both before reading the rota and inside the final locked statement.
// If hours, leave, staff or service prices changed meanwhile, refuse and retry
// with fresh data. The small config tables are deliberately hashed together.
const STAMP = `md5(jsonb_build_array(${['barbers','barber_hours','time_off','shop_hours','services','settings'].map(table =>
    `(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t)`).join(',')})::text)`;
const read = (sql,id) => withNewSchema(() => sql(`SELECT *, to_char(booked_on,'YYYY-MM-DD') AS date,
    ${VERSION} AS version FROM bookings WHERE id=$1 AND status='active'`, [id]));
function present(row) {
    return {id:row.id, version:row.version, date:row.date, time:rota.minutesToClock(rota.parseClock(row.booked_at)),
        service:row.service, barber:row.barber, name:row.customer_name, phone:row.phone_e164 || row.phone,
        email:row.email || '', duration:Number(row.duration_min)};
}
function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
async function handle(action,payload,now) {
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id < 1) return error('Choose a valid booking.');
    const sql = db();
    const [row] = await read(sql,id);
    if (!row) return error('This booking was cancelled or no longer exists. Refresh the diary.');
    const original = present(row);
    if (action === 'getBookingForEdit') return {status:'success', booking:original};
    const [stampRow] = await withNewSchema(() => sql(`SELECT ${STAMP} AS stamp`));
    const config = await readRotaConfig();
    const date = trim(payload.date), service = trim(payload.service), barber = trim(payload.barber);
    const sameService = service === row.service;
    const chosen = (config.services || []).find(s=>s.nameEN===service || s.nameNL===service);
    if (!sameService && !chosen) return error('Choose a service currently offered by the shop.');
    const duration = sameService ? Number(row.duration_min) : Number(chosen.duration);
    if (!validDate(date)) return error('Choose a valid date.');
    if (barber !== original.barber && (!barber || barber === rota.ANY_BARBER || barber === 'Any')) return error('Choose the barber who will take this appointment.');
    const held = await withNewSchema(() => sql`SELECT barber, booked_at, duration_min,
        extract(epoch FROM (booked_on + booked_at - ${date}::date))/60 AS start_minute
        FROM bookings WHERE status='active' AND id<>${id}
        AND booked_on + booked_at < ${date}::date + interval '1 day'
        AND booked_on + booked_at + duration_min * interval '1 minute' > ${date}::date`);
    const holdersAt = start => held.filter(r=>Number(r.start_minute)<start+duration && Number(r.start_minute)+Number(r.duration_min)>start).map(r=>r.barber);
    if (action === 'editBookingSlots') {
        const slots = rota.slotsForDate(config,date,barber,'',0,duration);
        return {status:'success', slots, unavailable:slots.filter(t=>!rota.isSlotFree(config,date,t,holdersAt(rota.clockToMinutes(t)),barber,duration))};
    }
    if (trim(payload.version) !== row.version) return error('This booking changed while you were editing. Reopen it to see the latest details.');
    const minute = rota.clockToMinutes(trim(payload.time));
    if (minute === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trim(payload.time))) return error('Choose a valid time.');
    const time = rota.minutesToClock(minute);
    const name = trim(payload.name), phone = trim(payload.phone), email = trim(payload.email);
    if (!name || name.length>100) return error('Enter a name of up to 100 characters.');
    const samePhone = phone === original.phone;
    const international = samePhone ? row.phone_e164 : canonical(phone,payload.phoneCountry || 'NL');
    // Old manually entered numbers can stay; only replacements must be valid.
    if (!samePhone && (!international || phone.length>40)) return error('Enter a complete phone number and choose its country code.');
    if (email !== original.email && email && (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) return error('Enter a valid email address or leave it blank.');
    const moved = date!==original.date || time!==original.time || barber!==original.barber || !sameService;
    if (moved) {
        if (!rota.isSlotFree(config,date,time,holdersAt(minute),barber,duration)) return error('That barber is unavailable or another appointment overlaps this time.');
    }
    const rawPhone = samePhone ? row.phone : phone;
    const price = sameService ? row.price : chosen.price;
    if (!moved && name===original.name && samePhone && email===original.email) return {status:'success', message:'No changes to save.', unchanged:true};
    await ensureBookingProtection();
    let written;
    try {
        const result = await withNewSchema(() => sql.transaction([
            sql`SELECT pg_advisory_xact_lock(73021,2047)`,
            sql(`UPDATE bookings SET booked_on=$1::date,booked_at=$2::time,service=$3,barber=$4,
                customer_name=$5,phone=$6,email=$7,price=$8,duration_min=$9,
                customer_id=CASE WHEN phone_e164 IS DISTINCT FROM $10::text THEN NULL ELSE customer_id END,
                phone_e164=$10, reminded_at=CASE WHEN $11 THEN NULL ELSE reminded_at END
                WHERE id=$12 AND status='active' AND ${VERSION}=$13 AND ${STAMP}=$14
                AND (NOT $11 OR NOT EXISTS (SELECT 1 FROM bookings occupied
                    WHERE occupied.id<>$12 AND occupied.status='active' AND occupied.barber=$4
                    AND occupied.booked_on+occupied.booked_at < $1::date+$2::time+$9 * interval '1 minute'
                    AND occupied.booked_on+occupied.booked_at+occupied.duration_min * interval '1 minute' > $1::date+$2::time))
                RETURNING id`,[date,time,service,barber,name,rawPhone,email,price,duration,international || null,moved,id,row.version,stampRow.stamp])
        ]));
        written = result[1];
    } catch (e) {
        if (/bookings_no_overlap|bookings_one_chair/.test(String(e.constraint || '')+' '+String(e.message || '')) || e.code==='40P01') return error('That time was just taken. Choose another time; your original booking is unchanged.');
        throw e;
    }
    if (!written.length) return error('The booking or shop schedule changed. Reopen this booking before saving.');
    // Only after a successful update, and only when explicitly selected by staff.
    // Mail failure never turns a saved edit into an apparent failed edit.
    let emailed = false;
    if (payload.notifyCustomer === true && email && date>=now.date) {
        try { emailed = await sendCustomerConfirmation({date,time,service,barber,name,phone,email,lang:row.lang,
            updated:true,cancelToken:cancelToken(id,await getCancelKey())},config); } catch { /* saved; report delivery separately */ }
    }
    return {status:'success',message:'Booking updated.',emailed};
}
module.exports = {handle};

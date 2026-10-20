// Date-specific extra shifts supplement the weekly rota. Store the small
// owner-managed document in settings, keyed by stable barber IDs so renames
// cannot strand shifts. This is never writable through generic CMS settings.
const {createHash}=require('node:crypto');
const KEY='barber_special_hours';
const revision=raw=>createHash('md5').update(raw || '[]').digest('hex');
function parse(raw) {try {const rows=JSON.parse(raw || '[]');return Array.isArray(rows)?rows.filter(r=>r && typeof r==='object'):[];}catch{return [];}}
function validate(rows) {
    if(!Array.isArray(rows) || rows.length>180) return 'Choose up to 180 dated shifts.';
    const seen=new Set(),clock=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    for(const row of rows) {
        if(!row || typeof row!=='object') return 'Choose a valid dated shift.';
        if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0,10)!==row.date) return 'Choose a valid date.';
        if(seen.has(row.date)) return 'Use one extra shift per date. Edit the existing shift.';
        seen.add(row.date);
        if(!clock(row.from) || !clock(row.to) || row.from>=row.to) return 'End time must be after start time.';
        if((row.breakFrom || row.breakTo) && (!clock(row.breakFrom) || !clock(row.breakTo) || row.breakFrom>=row.breakTo || row.breakFrom<row.from || row.breakTo>row.to)) return 'Keep both break times inside this shift, or leave both empty.';
    }
    return '';
}
async function save(payload,now) {
    const db=require('./db'),f=require('./flexible-bookings'),rota=require('./rota');
    const sql=db.db(),snap=await f.snapshot(sql,now.date);
    const fail=message=>({status:'error',message});
    const invalid=validate(payload.shifts);if(invalid) return fail(invalid);
    if(payload.revision!==snap.config.specialHoursRevision) return fail('Schedules changed. Close and reopen Special hours before saving.');
    const [barber]=await sql`SELECT id,name FROM barbers WHERE name=${String(payload.barber || '')}`;
    if(!barber) return fail('Choose a current barber.');
    const shifts=payload.shifts.map(r=>({barberId:barber.id,date:r.date,from:r.from,to:r.to,breakFrom:r.breakFrom || '',breakTo:r.breakTo || ''}));
    for(const shift of shifts) {
        const shop=rota.hoursForDay(snap.config,shift.date);
        if(!shop?.open || shift.from<shop.from || shift.to>shop.to) return fail('Keep the shift inside the shop opening hours.');
        if(rota.isBarberOnLeave(snap.config,barber.name,shift.date)) return fail('This barber has time off on that date. Update the time off first.');
    }
    const [stored]=await sql`SELECT value FROM settings WHERE key=${KEY}`;
    const next=parse(stored?.value).filter(r=>r.barberId!==barber.id).concat(shifts);
    const proposed={...snap.config,specialHours:(snap.config.specialHours || []).filter(r=>r.barber!==barber.name).concat(shifts.map(r=>({...r,barber:barber.name})))};
    const bookings=await db.withNewSchema(()=>sql`SELECT id,to_char(booked_on,'YYYY-MM-DD') AS date,booked_at,duration_min,customer_name FROM bookings
        WHERE status='active' AND barber=${barber.name} AND booked_on>=${now.date}::date`);
    const conflicts=bookings.filter(b=>rota.isBarberWorkingAt(snap.config,barber.name,b.date,rota.parseClock(b.booked_at),Number(b.duration_min)) &&
        !rota.isBarberWorkingAt(proposed,barber.name,b.date,rota.parseClock(b.booked_at),Number(b.duration_min)))
        .map(b=>({id:b.id,date:b.date,time:String(b.booked_at).slice(0,5),name:b.customer_name}));
    const accepted=new Set(Array.isArray(payload.confirmedBookings)?payload.confirmedBookings:[]);
    if(conflicts.some(b=>!accepted.has(b.id))) return {status:'error',confirmationRequired:true,conflicts,message:'These appointments need attention. They will stay booked.'};
    const raw=JSON.stringify(next);
    try {
        await f.commit(sql,snap,{barber:null,moves:[]},()=>sql`INSERT INTO settings(key,value) VALUES(${KEY},${raw}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
    } catch(error) {if(f.retryable(error))return fail('Bookings or schedules changed. Review again before saving.');throw error;}
    return {status:'success',revision:revision(raw),conflictCount:conflicts.length};
}
module.exports={KEY,parse,revision,validate,save};

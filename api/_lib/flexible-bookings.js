/** Atomic flexible-chair proposals. The same schedule lock as ordinary inserts
 * and owner edits protects the write; a diary/config fingerprint rejects stale
 * proposals. Row locks also serialize cancellation and reminder updates.
 */
const {db,withNewSchema,readRotaConfig}=require('./db');
const {plan}=require('./flexible-plan');
const rota=require('./rota');
const STAMP=`md5(jsonb_build_array(${['barbers','barber_hours','time_off','shop_hours','services','settings','bookings'].map(table=>
    `(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t)`).join(',')})::text)`;
async function readDay(sql,date) {
    return withNewSchema(()=>sql`SELECT id, flexible, barber, duration_min,
        extract(epoch FROM (booked_on + booked_at - ${date}::date))/60 AS start_minute
        FROM bookings WHERE status='active'
        AND booked_on+booked_at < ${date}::date+interval '1 day'
        AND booked_on+booked_at+duration_min*interval '1 minute' > ${date}::date`);
}
function propose(config,date,rows,time,duration,barber,now,excludeId) {
    return plan(config,date,rows.filter(r=>r.id!==excludeId).map(r=>({id:r.id,barber:r.barber,
        flexible:r.flexible===true,start:Number(r.start_minute),duration:Number(r.duration_min)})),
        {start:rota.clockToMinutes(time),duration,barber},
        {movableAfter:date<now.date?Infinity:date===now.date?now.minutes+1:-Infinity});
}
async function snapshot(sql,date) {
    // Stamp BEFORE all planning reads. Final equality detects mixed snapshots.
    const [version]=await withNewSchema(()=>sql(`SELECT ${STAMP} AS stamp`));
    const config=await readRotaConfig();
    const rows=await readDay(sql,date);
    return {stamp:version.stamp,config,rows};
}
async function commit(sql,snapshot,proposal,write,{guard=null, releaseId=null}={}) {
    const moves=proposal.moves;
    const ids=moves.map(m=>m.id);
    const queries=[sql`SELECT pg_advisory_xact_lock(73021,2047)`,
        sql`SELECT id FROM bookings ORDER BY id FOR UPDATE`,
        // Division by zero aborts the WHOLE transaction, not just the insert.
        sql(`SELECT 1 / CASE WHEN ${STAMP}=$1 THEN 1 ELSE 0 END AS valid`,[snapshot.stamp])];
    if(guard) queries.push(guard);
    if(releaseId) queries.push(sql`UPDATE bookings SET barber='' WHERE id=${releaseId}`);
    if(ids.length) {
        queries.push(sql`SELECT 1 / CASE WHEN count(*)=${ids.length} THEN 1 ELSE 0 END AS valid
            FROM bookings WHERE id=ANY(${ids}::int[]) AND flexible=true AND status='active'
            AND booked_on+booked_at > (clock_timestamp() AT TIME ZONE 'Europe/Amsterdam')`);
        // Empty chairs exist only inside this uncommitted transaction. This
        // permits swaps with the non-deferrable exclusion constraint intact.
        // Any failure restores all original names automatically by rollback.
        queries.push(sql`UPDATE bookings SET barber='' WHERE id=ANY(${ids}::int[])`);
        for(const move of moves) queries.push(sql`UPDATE bookings SET barber=${move.to} WHERE id=${move.id}`);
    }
    const writeIndex=queries.length;
    queries.push(write(proposal.barber));
    const result=await withNewSchema(()=>sql.transaction(queries));
    return result[writeIndex];
}
const retryable=e=>['22012','40P01','40001','23505','23P01'].includes(e.code);
module.exports={readDay,propose,snapshot,commit,retryable};

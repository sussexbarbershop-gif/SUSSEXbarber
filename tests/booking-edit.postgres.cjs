// Focused real PostgreSQL verification of the new UPDATE, fingerprint and lock.
// No btree_gist extension required: the existing exclusion constraint is covered
// by booking-overlap.postgres.cjs. Here we prove the new locked overlap guard.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Pool,Client}=require('pg');
const url=process.env.TEST_DATABASE_URL;
if(!url || !['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)) throw new Error('Use a disposable local PostgreSQL database');
const schema='edit_test_'+crypto.randomBytes(6).toString('hex');
const admin=new Client({connectionString:url});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`,max:5});
let beforeWrite=null;
function sql(strings,...values) {
    const text=typeof strings==='string'?strings:strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');
    const params=typeof strings==='string'?(values[0]||[]):values;
    return {text,params,then(resolve,reject){return pool.query(text,params).then(r=>r.rows).then(resolve,reject);}};
}
sql.transaction=async list=>{
    if(beforeWrite) {const fn=beforeWrite;beforeWrite=null;await fn();}
    const client=await pool.connect();
    try {await client.query('BEGIN');const rows=[];for(const q of list)rows.push((await client.query(q.text,q.params)).rows);await client.query('COMMIT');return rows;}
    catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
};
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const config={settings:{},barberNames:['Amir'],services:[{nameEN:'Cut',price:25,duration:30}],hours:days.map(day=>({day,open:true,from:'09:00',to:'18:00'})),barberHours:{Amir:days.map(day=>({day,working:true,from:'09:00',to:'18:00'}))},timeOff:[]};
const db=require('../api/_lib/db');
Object.assign(db,{db:()=>sql,withNewSchema:fn=>fn(),readRotaConfig:async()=>config,ensureBookingProtection:async()=>{}});
const {handle}=require('../api/_lib/booking-edit');
const now={date:'2099-09-01',minutes:0};
async function current(){return (await handle('getBookingForEdit',{id:1},now)).booking;}
async function update(patch){const b=await current();return handle('updateBooking',{...b,...patch},now);}
(async()=>{
    await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
    for(const table of ['barbers','barber_hours','time_off','shop_hours','services','settings']) await pool.query(`CREATE TABLE ${table}(value text)`);
    await pool.query(`CREATE TABLE bookings(id int PRIMARY KEY,booked_on date,booked_at time,service text,barber text,customer_name text,phone text,email text,price numeric,duration_min int,phone_e164 text,status text,lang text,customer_id int,reminded_at timestamptz,source text,created_at timestamptz)`);
    await pool.query(`INSERT INTO bookings VALUES(1,'2099-09-08','10:00','Cut','Amir','Before','legacy','','18',30,NULL,'active','en',NULL,now(),'shop',now())`);
    let answer=await update({name:'After'});assert.equal(answer.status,'success');assert.equal((await current()).name,'After');
    let row=(await pool.query('SELECT * FROM bookings WHERE id=1')).rows[0];assert.equal(Number(row.price),18);assert.equal(row.duration_min,30);assert.equal(row.phone,'legacy');assert.equal(row.source,'shop');
    const base=await current();
    const race=await Promise.all(['First','Second'].map(name=>handle('updateBooking',{...base,name},now)));
    assert.equal(race.filter(r=>r.status==='success').length,1);assert.equal(race.filter(r=>r.status==='error').length,1);
    console.log('PASS real SQL preserves original snapshots and accepts only one stale competing edit');
    beforeWrite=()=>pool.query("INSERT INTO settings VALUES('schedule changed')");
    answer=await update({name:'Must not replace'});assert.equal(answer.status,'error');assert.notEqual((await current()).name,'Must not replace');
    console.log('PASS configuration changed between read and locked write is refused');
    beforeWrite=()=>pool.query("INSERT INTO bookings(id,booked_on,booked_at,service,barber,duration_min,status) VALUES(2,'2099-09-08','11:15','Cut','Amir',30,'active')");
    answer=await update({time:'11:00'});assert.equal(answer.status,'error');assert.equal((await current()).time,'10:00');
    console.log('PASS overlapping row arriving after availability check cannot be overwritten');
    answer=await update({time:'12:00'});assert.equal(answer.status,'success');row=(await pool.query('SELECT * FROM bookings WHERE id=1')).rows[0];assert.equal(row.reminded_at,null);
    beforeWrite=()=>pool.query("UPDATE bookings SET status='cancelled' WHERE id=1");
    answer=await update({name:'Cannot revive'});assert.equal(answer.status,'error');assert.equal((await pool.query('SELECT status FROM bookings WHERE id=1')).rows[0].status,'cancelled');
    console.log('PASS rescheduling resets reminders and a concurrent cancellation is never revived');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
});

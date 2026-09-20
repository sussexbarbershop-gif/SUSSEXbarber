// Real PostgreSQL, separate from the fast offline suite. A fake SQL driver
// cannot prove that two writers block each other. Use a local disposable
// database only; every run owns a random schema and drops only that schema.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const {Pool, Client} = require('pg');
const url = process.env.TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a disposable LOCAL PostgreSQL server');
}
const schema = 'overlap_test_' + crypto.randomBytes(6).toString('hex');
const admin = new Client({connectionString: url});
const pool = new Pool({connectionString: url, options: `-c search_path=${schema},public`, max: 8});
let arrival = null;
function sql(strings, ...values) {
  const text = strings.reduce((out, part, i) => out + (i ? '$' + i : '') + part, '');
  return {_text: text, _values: values, then(resolve, reject) {
    return (async () => {
      if (arrival && /INSERT INTO bookings/.test(text)) await arrival();
      return (await pool.query(text, values)).rows;
    })().then(resolve, reject);
  }};
}
sql.transaction = async queries => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = [];
    for (const query of queries) rows.push((await client.query(query._text, query._values)).rows);
    await client.query('COMMIT');
    return rows;
  } catch (err) {await client.query('ROLLBACK'); throw err;}
  finally {client.release();}
};
const load = Module._load;
Module._load = function(request, ...rest) {
  if (request === '@neondatabase/serverless') return {neon: () => sql};
  return load.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://local-test-driver';
process.env.ADMIN_PASSWORD = 'local-test-password';
process.env.REPORTS_PIN = 'local-test-pin';
delete process.env.BREVO_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.NOTIFY_EMAIL;
const db = require('../api/_lib/db');
db.minutesSinceJobRun = async () => 0;
const mail = require('../api/_lib/mail');
for (const name of ['sendBookingNotice', 'sendCustomerConfirmation', 'sendCancellationNotice', 'sendCustomerCancellation']) {
  mail[name] = async () => false;
}
const api = require('../api');
const day = '2099-09-08';
async function request(method, body) {
  let answer, code = 200;
  await api({method, query: method === 'GET' ? body : {}, headers: {},
    body: method === 'POST' ? JSON.stringify(body) : undefined}, {
    status(value) {code = value; return this;}, setHeader() {}, send(value) {answer = JSON.parse(value);}
  });
  assert.equal(code, 200, JSON.stringify(answer));
  return answer;
}
const book = patch => request('POST', {action:'addBooking', date:day, time:'10:00',
  name:'Synthetic test', phone:'0612345678', service:'Short cut', barber:'Amir', ...patch});
const availability = (service, barber = 'Amir') => request('GET', {date:day, service, barber, slots:'1'});
const reset = async () => {
  arrival = null;
  await pool.query('TRUNCATE bookings, customers, rate_limit RESTART IDENTITY CASCADE');
  await pool.query("UPDATE services SET duration_min = CASE name_en WHEN 'Long cut' THEN 60 ELSE 30 END");
};
const insert = (client, time, duration = 30, barber = 'Amir', date = day) => client.query(
  `INSERT INTO bookings (booked_on,booked_at,duration_min,service,barber,customer_name,phone)
   VALUES ($1,$2,$3,'Synthetic',$4,'Test','0612345678') RETURNING id`, [date,time,duration,barber]);
async function check(name, run) {await reset(); await run(); console.log('PASS  ' + name);}
async function main() {
  await admin.connect();
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
    await pool.query(schemaSql);
    // Prove that the regression actually detects loss of the database guard.
    if (process.env.OVERLAP_MUTATION === 'drop-constraint') {
      await pool.query('ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap');
    }
    await check('PostgreSQL rejects overlapping starts but permits touching endpoints', async () => {
      await insert(pool, '10:00');
      await assert.rejects(insert(pool, '10:15'), err => err.code === '23P01' && err.constraint === 'bookings_no_overlap');
      await insert(pool, '10:30');
      await insert(pool, '10:15', 30, 'Saan');
      await assert.rejects(pool.query("UPDATE bookings SET booked_at='10:10' WHERE booked_at='10:30'"), {code:'23P01'});
    });
    await pool.query("INSERT INTO barbers(name,position) VALUES ('Amir',1),('Saan',2)");
    await pool.query("INSERT INTO services(name_en,name_nl,price,duration_min,position) VALUES ('Short cut','Kort',25,30,1),('Long cut','Lang',40,60,2)");
    await pool.query("INSERT INTO settings(key,value) VALUES ('booking_open','yes'),('barber_priority','Amir,Saan')");
    await pool.query("INSERT INTO shop_hours(weekday,is_open,opens_at,closes_at) SELECT n,true,'10:00','18:00' FROM generate_series(1,7) n");
    await check('a cancelled booking releases its whole interval', async () => {
      await insert(pool,'10:00',60);
      await pool.query("UPDATE bookings SET status='cancelled',cancelled_at=now()");
      await insert(pool,'10:15',45);
    });
    await check('database exclusion also covers an interval across midnight', async () => {
      await insert(pool,'23:45',30);
      await assert.rejects(insert(pool,'00:00',30,'Amir','2099-09-09'),{code:'23P01'});
      await insert(pool,'00:15',30,'Amir','2099-09-09');
    });
    await check('both public and shop bookings refuse off-grid overlaps', async () => {
      assert.equal((await book({})).status,'success');
      assert.equal((await book({time:'10:15'})).status,'error');
      assert.equal((await book({action:'addBookingByShop',password:process.env.ADMIN_PASSWORD,time:'10:15'})).status,'error');
      assert.equal((await book({time:'10:30'})).status,'success');
    });
    await check('longer duration is trusted from the service and saved with the booking', async () => {
      const answer = await book({service:'Long cut',duration:1});
      assert.equal(answer.duration,60);
      assert.equal((await pool.query('SELECT duration_min FROM bookings')).rows[0].duration_min,60);
      assert.equal((await book({time:'10:45'})).status,'error');
      assert.equal((await book({time:'11:00'})).status,'success');
    });
    await check('availability uses both the held and the requested duration', async () => {
      await book({time:'11:00'});
      const short = await availability('Short cut');
      const long = await availability('Long cut');
      assert.equal(short.unavailable.includes('10:30'),false);
      assert.equal(long.unavailable.includes('10:30'),true);
      assert.equal(long.slots.includes('17:30'),false);
      assert.equal((await availability('Long cut','Saan')).unavailable.includes('10:30'),false);
      assert.equal((await request('GET',{date:day,barber:'Amir',service:'Long cut'})).includes('10:30'),true);
    });
    await check('an off-grid old booking blocks the neighbouring chips', async () => {
      await insert(pool,'10:15',30);
      const result = await availability('Short cut');
      assert.equal(result.unavailable.includes('10:00'),true);
      assert.equal(result.unavailable.includes('10:30'),true);
      assert.equal(result.unavailable.includes('11:00'),false);
    });
    await check('saving service duration in the owner panel changes only future bookings', async () => {
      await book({});
      await request('POST',{action:'saveCMS',password:process.env.ADMIN_PASSWORD,pin:process.env.REPORTS_PIN,
        services:[{nameEN:'Short cut',nameNL:'Kort',price:25,duration:60},{nameEN:'Long cut',nameNL:'Lang',price:40,duration:60}]});
      assert.equal((await pool.query('SELECT duration_min FROM bookings')).rows[0].duration_min,30);
      assert.equal((await book({time:'10:30'})).duration,60);
      assert.equal((await book({time:'11:00'})).status,'error');
      assert.equal((await availability('Short cut')).slots.includes('17:30'),false);
    });
    await check('two writers cannot both reserve overlapping intervals', async () => {
      const first = await pool.connect(), second = await pool.connect();
      try {
        await first.query('BEGIN');
        await insert(first,'10:00',60);
        const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const other = insert(second,'10:30').then(()=>null,err=>err);
        let waiting = false;
        for(let n=0;n<100;n++) {
          const row=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
          if(row.wait_event_type==='Lock'){waiting=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(waiting,true,'the other writer must wait for the first transaction');
        await first.query('COMMIT');
        assert.equal((await other).code,'23P01');
      } finally {await first.query('ROLLBACK'); first.release(); second.release();}
    });
    for (const barber of ['Amir','Any Available']) {
      await check(`simultaneous API requests handle the race for ${barber}`, async () => {
        let arrivals=0, release;
        const barrier=new Promise(resolve=>{release=resolve;});
        arrival=async()=>{if(++arrivals===2){arrival=null;release();} await barrier;};
        const results=await Promise.all([
          book({time:'10:00',barber,phone:'0611111111'}),
          book({time:'10:15',barber,phone:'0622222222'})
        ]);
        assert.equal(results.filter(r=>r.status==='success').length,barber==='Amir'?1:2);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM bookings WHERE status='active'")).rows[0].n,barber==='Amir'?1:2);
      });
    }
    await check('fresh schema and automatic upgrade enforce the same constraint', async () => {
      await insert(pool,'10:00');
      await pool.query('ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap');
      await pool.query('ALTER TABLE bookings DROP COLUMN duration_min');
      delete require.cache[require.resolve('../api/_lib/db')];
      const upgrade=require('../api/_lib/db');
      await Promise.all([upgrade.ensureBookingProtection(),upgrade.ensureBookingProtection()]);
      assert.equal((await pool.query('SELECT duration_min FROM bookings')).rows[0].duration_min,30);
      await assert.rejects(insert(pool,'10:15'),{code:'23P01'});
      await pool.query(schemaSql);
    });
    await check('an unsafe upgrade rolls back without moving or deleting old bookings', async () => {
      await pool.query('ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap');
      await insert(pool,'10:00');
      await insert(pool,'10:15');
      await pool.query('ALTER TABLE bookings DROP COLUMN duration_min');
      const before = (await pool.query('SELECT row_to_json(b) AS row FROM bookings b ORDER BY id')).rows;
      delete require.cache[require.resolve('../api/_lib/db')];
      await assert.rejects(require('../api/_lib/db').ensureBookingProtection(),{code:'23P01'});
      assert.deepEqual((await pool.query('SELECT row_to_json(b) AS row FROM bookings b ORDER BY id')).rows,before);
    });
    console.log('All PostgreSQL overlap checks passed. No live database was used.');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch(err=>{console.error(err); process.exitCode=1;});

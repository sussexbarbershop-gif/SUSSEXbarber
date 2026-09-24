// Real request handlers, synthetic database and mail transport. Never touches
// production: knowing a number must neither disclose nor cancel a booking.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname,'..');
const KEY = 'synthetic-cancel-key';
process.env.ADMIN_PASSWORD = 'synthetic-staff-password';
process.env.BREVO_API_KEY = 'synthetic-mail-key';
process.env.MAIL_FROM = 'shop@example.com';
let sent=[], writes=0, allowed=true, providerOK=true;
const rows=[
  {id:1,email:'first@example.com',phone_key:'612345678',barber:'A'},
  {id:2,email:'second@example.com',phone_key:'612345678',barber:'B'},
  {id:3,email:'',phone_key:'612345678',barber:'C'},
  {id:4,email:'first@example.com',phone_key:'611111111',barber:'D'}
].map(r=>({...r,status:'active',booked_on:'2099-09-08',booked_at:'14:30',service:'Haircut',lang:'en'}));
function stub(p,exports){const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports};}
const sql=async(strings,...values)=>{
  const q=strings.join('?');
  if(q.includes('UPDATE bookings')){
    writes++;
    const r=rows.find(r=>r.id===values[0]&&r.status==='active');
    if(!r)return [];
    r.status='cancelled';return [r];
  }
  if(q.includes('FROM bookings WHERE id'))return rows.filter(r=>r.id===values[0]);
  if(q.includes('FROM bookings'))return rows.filter(r=>r.status==='active' && ((values[0]&&r.email===values[0])||(values[2]&&r.phone_key===values[2])));
  return [];
};
stub('../api/_lib/db',{db:()=>sql,withNewSchema:fn=>fn(),readConfig:async()=>({settings:{}}),getCancelKey:async()=>KEY});
stub('../api/_lib/limits',{tooMany:async()=>'',forget:async()=>{},allowBookingEmail:async()=>allowed});
global.fetch=async(url,opts)=>{sent.push(JSON.parse(opts.body));return {ok:providerOK,status:providerOK?201:503,text:async()=>''};};
const api=require('../api/index');
const auth=require('../api/_lib/auth');
async function post(body){let result,code=200;await api({method:'POST',headers:{},body:JSON.stringify(body)},{status(n){code=n;return this;},setHeader(){},send(s){result=JSON.parse(s);}});return {code,result};}
async function main(){
  assert.equal((await post({action:'myBookings',phone:'0612345678'})).code,409);
  assert.equal(sent.length,0,'old automatic lookups never send email');
  const reply=await post({action:'myBookings',sendEmail:true,identifier:'0612345678',email:'attacker@example.com'});
  assert.equal(reply.result.status,'success');
  assert.deepEqual(sent.map(m=>m.to[0].email).sort(),['first@example.com','second@example.com']);
  assert.equal(sent[0].textContent.includes('cancel.html'),true);
  assert.equal(sent[0].textContent.includes(auth.cancelToken(2,KEY)),false,'other recipient token must not leak');
  assert.equal(JSON.stringify(reply).includes('cancel.html'),false);
  assert.equal(JSON.stringify(reply).includes('2099'),false);
  assert.equal(writes,0,'requesting email never cancels');
  sent=[];
  assert.deepEqual(await post({action:'myBookings',sendEmail:true,identifier:'absent@example.com'}),reply);
  assert.equal(sent.length,0);
  await post({action:'myBookings',sendEmail:true,identifier:'FIRST@EXAMPLE.COM'});
  assert.equal(sent.length,1);
  assert.equal(sent[0].textContent.includes(auth.cancelToken(4,KEY)),true);
  assert.equal(sent[0].textContent.includes(auth.cancelToken(2,KEY)),false);
  allowed=false;sent=[];
  assert.deepEqual(await post({action:'myBookings',sendEmail:true,identifier:'first@example.com'}),reply);
  assert.equal(sent.length,0,'recipient throttle prevents sends');
  allowed=true;providerOK=false;
  assert.deepEqual(await post({action:'myBookings',sendEmail:true,identifier:'first@example.com'}),reply,'delivery failure must not expose matching accounts');
  providerOK=true;
  for(const action of ['cancel','cancelBooking']){
    const refused=await post({action,phone:'0612345678',date:'2099-09-08',time:'14:30',id:1});
    assert.equal(refused.code,401);
  }
  assert.equal(writes,0);
  await post({action:'cancelBooking',password:process.env.ADMIN_PASSWORD,id:3});
  assert.equal(rows[2].status,'cancelled','staff can handle no-email booking');
  assert.equal(rows[0].status,'active','same phone/date/time unaffected');
  await post({action:'cancelByLink',token:'forged'});
  assert.equal(writes,1);
  await post({action:'lookupCancel',token:auth.cancelToken(1,KEY)});
  assert.equal(writes,1,'opening email link does not cancel');
  await post({action:'cancelByLink',token:auth.cancelToken(1,KEY)});
  assert.equal(rows[0].status,'cancelled');
  assert.equal(rows[1].status,'active');
  const site=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(site,/if \(!emailVal && !confirm/);
  // Execute the actual warning branch: going back never reaches the write,
  // continuing keeps email optional, and a supplied email needs no warning.
  const warningStart=site.indexOf('            if (!emailVal && !confirm');
  const warningEnd=site.indexOf('            let servicePrice',warningStart);
  const warning=site.slice(warningStart,warningEnd);
  let prompts=0,focus=0,agree=false,warningText='';
  const runWarning=new Function('emailVal','confirm','window','document','submitBtn','originalText',warning+'return "proceed";');
  const args=[text=>{prompts++;warningText=text;return agree;},{currentLang:'en'},{getElementById:()=>({focus(){focus++;}})},{disabled:true},'Book'];
  assert.equal(runWarning('',...args),undefined);
  assert.equal(focus,1);
  assert.match(warningText,/confirmation email or cancellation link/);
  assert.match(warningText,/then book again for an available time/);
  assert.match(warningText,/has not been booked yet/);
  assert.match(warningText,/Cancel to add an email address/);
  assert.equal(args[3].disabled,false,'going back re-enables the booking button');
  args[1].currentLang='nl';
  assert.equal(runWarning('',...args),undefined);
  assert.match(warningText,/opnieuw boeken op een beschikbare tijd/);
  assert.match(warningText,/nog niet geboekt/);
  args[1].currentLang='en';
  agree=true;assert.equal(runWarning('',...args),'proceed');
  const before=prompts;assert.equal(runWarning('test@example.com',...args),'proceed');assert.equal(prompts,before);
  assert.equal(site.includes("action: 'cancel', phone"),false);
  const panel=fs.readFileSync(path.join(root,'admin/admin.js'),'utf8');
  assert.match(panel,/bookingId: b.id/);
  assert.match(panel,/id: Number\(b.bookingId\)/);
  const loadFn=site.match(/^    async function loadMyBookings\([\s\S]*?^    }/m)[0];
  const formStatus={textContent:''}, button={disabled:false};
  let requests=[], releaseRequest;
  const requestGate=new Promise(resolve=>{releaseRequest=resolve;});
  const lookup=new Function('window','document','fetch','API_URL','normalisePhone','showToast',
    'let bookingEmailPending=false;'+loadFn+';return loadMyBookings;')(
    {currentLang:'en'},{querySelector:()=>button,getElementById:()=>formStatus},
    async(url,opts)=>{requests.push(JSON.parse(opts.body));await requestGate;return {ok:true,json:async()=>reply.result};},
    '/api',v=>v.replace(/\D/g,''),()=>{});
  await lookup('0612345678',true);assert.equal(requests.length,0);
  const pending=lookup('first@example.com');
  await lookup('first@example.com');assert.equal(requests.length,1);
  assert.equal(button.disabled,true);
  releaseRequest();await pending;
  assert.deepEqual(requests[0],{action:'myBookings',identifier:'first@example.com',sendEmail:true});
  assert.equal(button.disabled,false);
  assert.match(formStatus.textContent,/If matching bookings/);
  console.log('PASS email-only lookup, recipient isolation, no public disclosure, no-email staff cancellation and single-ID confirmation');
}
main().catch(err=>{console.error(err);process.exitCode=1;});

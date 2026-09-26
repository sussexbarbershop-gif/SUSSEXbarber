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
].map(r=>({...r,phone:'0'+r.phone_key,status:'active',booked_on:'2099-09-08',booked_at:'14:30',service:'Haircut',lang:'en'}));
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
  if(q.includes('FROM bookings'))return rows.filter(r=>r.status==='active' && ((values[0]&&r.email===values[0])||(values[2]&&(r.phone_e164===values[3]||(!r.phone_e164&&values[4].includes(r.phone.replace(/\D/g,'')))))));
  return [];
};
stub('../api/_lib/db',{db:()=>sql,withNewSchema:fn=>fn(),readConfig:async()=>({settings:{}}),getCancelKey:async()=>KEY});
stub('../api/_lib/limits',{tooMany:async()=>'',forget:async()=>{},allowBookingEmail:async()=>allowed});
global.fetch=async(url,opts)=>{sent.push(JSON.parse(opts.body));return {ok:providerOK,status:providerOK?201:503,text:async()=>''};};
const api=require('../api/index');
const auth=require('../api/_lib/auth');
async function post(body){let result,code=200;await api({method:'POST',headers:{},body:JSON.stringify(body)},{status(n){code=n;return this;},setHeader(){},send(s){result=JSON.parse(s);}});return {code,result};}
async function main(){
  const phones=require('../assets/phone');
  for(const value of ['0612345678','+31612345678','0031612345678','06 1234 5678'])assert.equal(phones.canonical(value),' +31612345678'.trim());
  assert.equal(phones.canonical('07501234567','IQ'),'+9647501234567');
  assert.equal(phones.canonical('+9647501234567','NL'),'+9647501234567');
  for(const value of ['','123','not a phone','+000123456789','0612345678 ext 9'])assert.equal(phones.canonical(value),'');
  assert.notEqual(phones.canonical('+31612345678'),phones.canonical('+447612345678'));
  assert.equal(phones.legacyVariants('+447612345678').includes('0612345678'),false);

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
  assert.match(site,/await confirmWithoutEmail\(\)/);
  // Execute the actual warning branch: going back never reaches the write,
  // continuing keeps email optional, and a supplied email needs no warning.
  const warningStart=site.indexOf('            if (!emailVal && !(await confirmWithoutEmail');
  const warningEnd=site.indexOf('            let servicePrice',warningStart);
  const warning=site.slice(warningStart,warningEnd);
  let prompts=0,focus=0,agree=false,warningText='';
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const runWarning=new AsyncFunction('emailVal','confirmWithoutEmail','window','document','submitBtn','originalText',warning+'return "proceed";');
  const args=[text=>{prompts++;warningText=text;return agree;},{currentLang:'en'},{getElementById:()=>({focus(){focus++;}})},{disabled:true},'Book'];
  assert.equal(await runWarning('',...args),undefined);
  assert.equal(focus,1);
  assert.match(site,/confirmation email or cancellation link/);
  assert.match(site,/book again for an available time/);
  assert.match(site,/has not been booked yet/);
  assert.match(site,/Add email/);
  assert.equal(args[3].disabled,false,'going back re-enables the booking button');
  args[1].currentLang='nl';
  assert.equal(await runWarning('',...args),undefined);
  assert.match(site,/opnieuw boeken op een beschikbare tijd/);
  assert.match(site,/nog niet geboekt/);
  args[1].currentLang='en';
  agree=true;assert.equal(await runWarning('',...args),'proceed');
  const before=prompts;assert.equal(await runWarning('test@example.com',...args),'proceed');assert.equal(prompts,before);
  assert.equal(site.includes("action: 'cancel', phone"),false);
  const panel=fs.readFileSync(path.join(root,'admin/admin.js'),'utf8');
  assert.match(panel,/bookingId: b.id/);
  assert.match(panel,/id: Number\(b.bookingId\)/);
  const loadFn=site.match(/^    async function loadMyBookings\([\s\S]*?^    }/m)[0];
  const formStatus={textContent:''}, button={disabled:false};
  const lookupNodes={lookupPhone:{value:'',setAttribute(k,v){this[k]=v;},focus(){this.focused=true;}},lookupPhoneCountry:{value:'NL'},lookupCountryField:{hidden:false},lookupHint:{textContent:''},lookupError:{hidden:true,textContent:''},bookingEmailStatus:formStatus};
  const lookupWindow={currentLang:'en',SussexPhone:phones};
  const lookupDoc={querySelector:()=>button,getElementById:id=>lookupNodes[id]};
  const uiCode=site.match(/^    function lookupProblem\([\s\S]*?^    window.updateLookupPresentation = updateLookupPresentation;/m)[0];
  const refresh=new Function('window','document',uiCode+';return updateLookupPresentation;')(lookupWindow,lookupDoc);
  refresh();assert.match(lookupNodes.lookupHint.textContent,/06/);
  lookupNodes.lookupPhoneCountry.value='IQ';refresh();assert.match(lookupNodes.lookupHint.textContent,/0791/);
  lookupNodes.lookupPhone.value='person@example.com';refresh();assert.equal(lookupNodes.lookupCountryField.hidden,true);
  lookupNodes.lookupPhone.value='123';assert.equal(refresh(true),false);assert.equal(lookupNodes.lookupCountryField.hidden,false);assert.equal(lookupNodes.lookupPhone['aria-invalid'],'true');
  lookupWindow.currentLang='nl';refresh(true);assert.match(lookupNodes.lookupError.textContent,/landcode/);
  lookupNodes.lookupPhone.value='07501234567';assert.equal(refresh(true),true);assert.equal(lookupNodes.lookupError.hidden,true);
  lookupNodes.lookupPhone.value='bad@';assert.equal(refresh(true),false);
  lookupNodes.lookupPhone.value='';assert.equal(refresh(true),false);
  lookupWindow.currentLang='en';

  let requests=[], releaseRequest;
  const requestGate=new Promise(resolve=>{releaseRequest=resolve;});
  const lookup=new Function('window','document','fetch','API_URL','updateLookupPresentation','showToast',
    'let bookingEmailPending=false;'+loadFn+';return loadMyBookings;')(
    lookupWindow,lookupDoc,
    async(url,opts)=>{requests.push(JSON.parse(opts.body));await requestGate;return {ok:true,json:async()=>reply.result};},
    '/api',refresh,()=>{});
  await lookup('0612345678',true);assert.equal(requests.length,0);
  lookupNodes.lookupPhone.value='123';
  await lookup('123');assert.equal(requests.length,0,'invalid phone must not send email request');
  assert.equal(lookupNodes.lookupPhone.focused,true);
  lookupNodes.lookupPhone.value='first@example.com';
  const pending=lookup('first@example.com');
  await lookup('first@example.com');assert.equal(requests.length,1);
  assert.equal(button.disabled,true);
  releaseRequest();await pending;
  assert.deepEqual(requests[0],{action:'myBookings',identifier:'first@example.com',sendEmail:true});
  assert.equal(button.disabled,false);
  assert.match(formStatus.textContent,/If matching bookings/);
  lookupNodes.lookupPhone.value='07501234567';
  await lookup('07501234567');assert.equal(requests[1].phoneCountry,'IQ');
  assert.equal(requests[1].identifier,'07501234567');
  lookupNodes.lookupPhone.value='+31612345678';assert.equal(refresh(true),true,'explicit prefix overrides retained country');
  // Execute the actual sheet controller: dismissal is never consent and a
  // second click cannot settle the decision again or leak event handlers.
  const controller=site.match(/window\.confirmWithoutEmail = function confirmWithoutEmail\(\) \{[\s\S]*?\n        \}/)[0];
  const nodes={}; const listeners={};
  for(const id of ['emailWarningSheet','emailWarningAdd','emailWarningBook','emailWarningClose','emailWarningTitle','emailWarningBody','emailWarningChange','emailWarningPending']) {
    nodes[id]={id,inert:false,textContent:'',setAttribute(){},focus(){fakeDoc.activeElement=this;},addEventListener(k,f){listeners[k]=f;},removeEventListener(k){delete listeners[k];}};
  }
  const background={inert:false};
  const fakeDoc={body:{children:[background,nodes.emailWarningSheet]},activeElement:null,getElementById:id=>nodes[id],addEventListener(k,f){listeners[k]=f;},removeEventListener(k){delete listeners[k];}};
  const sheetWindow={currentLang:'en'};let shown=0,hidden=0;
  new Function('window','document','showSheet','hideSheet',controller)(sheetWindow,fakeDoc,()=>shown++,()=>hidden++);
  for(const choice of ['add','escape','backdrop','close','book']) {
    const pending=sheetWindow.confirmWithoutEmail();
    assert.equal(background.inert,true);
    assert.equal(fakeDoc.activeElement,nodes.emailWarningAdd);
    listeners.keydown({key:'Tab',shiftKey:false,preventDefault(){}});
    assert.equal(fakeDoc.activeElement,nodes.emailWarningBook);
    if(choice==='escape')listeners.keydown({key:'Escape',preventDefault(){}});
    else if(choice==='backdrop'||choice==='close')listeners.click({target:{closest:()=>true}});
    else {const target=nodes[choice==='book'?'emailWarningBook':'emailWarningAdd'];target.closest=()=>false;listeners.click({target});}
    assert.equal(await pending,choice==='book',choice+' only explicit Book proceeds');
    assert.equal(background.inert,false);
    assert.deepEqual(Object.keys(listeners),[]);
  }
  assert.equal(shown,5);assert.equal(hidden,5);
  console.log('PASS email-only lookup, recipient isolation, no public disclosure, no-email staff cancellation and single-ID confirmation');
}
main().catch(err=>{console.error(err);process.exitCode=1;});

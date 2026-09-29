// Exercise the production submit handler with controlled transport failures.
// A committed request can lose its response; retry identity must survive that
// failure and reload without storing names, phone numbers or email addresses.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const html=fs.readFileSync('index.html','utf8');const code=html.slice(html.indexOf('        let bookingAttempt = null;'),html.indexOf('// --- 11. Gallery'));
let handler,requests=[],resets=0,steps=[],messages=[],fetchImpl,timer;const storage=new Map(),nodes={};
const values={time:'11:00',date:'2099-09-08',fullName:'Synthetic Test',phoneNumber:'0612345678',phoneNumberCountry:'NL',emailAddress:'test@example.com',service:'Haircut',barber:'Any Available'};
const node=id=>nodes[id]||(nodes[id]={value:values[id]||'',disabled:false,innerText:'Confirm',style:{},classList:{add(){},remove(){}},addEventListener(type,fn){if(id==='bookingForm')handler=fn},dispatchEvent(){},focus(){}});
const context={document:{getElementById:node},window:{currentLang:'en'},crypto:webcrypto,TextEncoder,Uint8Array,AbortController,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:fn=>{timer=fn;return 1},clearTimeout(){timer=null},validateBookingContacts:()=>true,fetch:(url,opts)=>{requests.push(JSON.parse(opts.body));return fetchImpl(opts)},API_URL:'/api',showToast:m=>messages.push(m),updateWizardUI:s=>steps.push(s),Event:class{},console:{warn(){},error(){}},bookedTimesList:[],renderTimeChips(){},SussexPhone:{canonical:()=>'+31612345678'},rememberPhone(){},renderBookingDate(){},selectedServiceDuration:()=>30,clearBookingContactErrors(){},renderCustomCalendar(){},smoothScrollTo(){}};
const load=()=>vm.runInNewContext(code,{...context});load();const submit=()=>handler.call({reset(){resets++}}, {preventDefault(){}});
(async()=>{
 fetchImpl=opts=>new Promise((a,b)=>opts.signal.addEventListener('abort',()=>b(new Error('aborted'))));const pending=submit();await submit();while(!requests.length)await new Promise(r=>setImmediate(r));assert.equal(requests.length,1);assert(node('submitBtn').disabled);timer();await pending;assert.equal(resets,0);for(const [id,v]of Object.entries(values))assert.equal(node(id).value,v);assert(!node('submitBtn').disabled);
 const key=requests[0].requestKey;assert.match(key,/^[a-f0-9-]{36}$/);assert(![...storage.values()][0].includes('test@example.com'));
 load();fetchImpl=async()=>{throw Error('response lost')};await submit();assert.equal(requests.at(-1).requestKey,key,'reload retains retry identity');
 node('fullName').value='Changed';await submit();assert.notEqual(requests.at(-1).requestKey,key,'changed input needs its own identity');
 fetchImpl=async()=>({ok:true,json:async()=>({status:'error',message:'Slot taken'})});await submit();assert.equal(steps.at(-1),2);assert.equal(node('time').value,'');assert.equal(node('emailAddress').value,values.emailAddress);assert.equal(storage.size,0);
 fetchImpl=async()=>({ok:true,json:async()=>({status:'success',barber:'Assigned Barber',duration:45})});node('time').value='11:00';await submit();assert.equal(node('confirmBarber').innerText,'Assigned Barber');assert.equal(resets,1);assert.equal(context.window.lastBookingData.duration,45);
 console.log('PASS pending double-submit, timeout, field preservation, reload retry identity, changed input, conflict recovery and no stored personal details');
})().catch(e=>{console.error(e);process.exitCode=1});


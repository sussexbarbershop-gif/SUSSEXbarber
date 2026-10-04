const assert=require('assert/strict');
const fs=require('fs');
const dbPath=require.resolve('../api/_lib/db');
const mailPath=require.resolve('../api/_lib/mail');
const row={id:7,date:'2099-09-08',booked_at:'10:00:00',service:'Cut',barber:'Amir',customer_name:'Original',phone:'old number',phone_e164:null,email:'',price:'18.00',duration_min:30,version:'v1',lang:'en'};
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const config={settings:{},barberNames:['Amir','Hemen'],barbers:[{name:'Amir'},{name:'Hemen'}],
    services:[{nameEN:'Cut',price:25,duration:60},{nameEN:'Long cut',price:40,duration:60}],
    hours:days.map(day=>({day,open:true,from:'09:00',to:'18:00'})),
    barberHours:Object.fromEntries(['Amir','Hemen'].map(name=>[name,days.map(day=>({day,working:true,from:'09:00',to:'18:00'}))])),timeOff:[]};
let queries=[],held=[],conflict=false,concurrent=false,active=true,mail=0;
function sql(strings,...values) {
    const text=typeof strings==='string'?strings:strings.join('?');
    const params=typeof strings==='string'?(values[0]||[]):values;
    const query={text,params,then(resolve,reject){return Promise.resolve().then(()=>{
        if (/SELECT \*,/.test(text)) return active?[{...row}]:[];
        if (/ AS stamp$/.test(text)) return [{stamp:'schedule1'}];
        if (/SELECT barber, booked_at/.test(text)) return held;
        return [];
    }).then(resolve,reject);}};
    return query;
}
sql.transaction=async list=>{
    queries.push(...list);
    assert.match(list[0].text,/pg_advisory_xact_lock/);
    assert.match(list[1].text,/status='active'.*md5[\s\S]*md5/);
    if(conflict) throw Object.assign(new Error('bookings_no_overlap'),{constraint:'bookings_no_overlap'});
    return [[],concurrent?[]:[{id:7}]];
};
require(dbPath); require(mailPath);
require.cache[dbPath].exports={db:()=>sql,withNewSchema:fn=>fn(),readRotaConfig:async()=>config,ensureBookingProtection:async()=>{},getCancelKey:async()=> 'test-secret'};
require.cache[mailPath].exports={sendCustomerConfirmation:async b=>{assert.equal(b.updated,true);mail++;return true;}};
const {handle}=require('../api/_lib/booking-edit');
const now={date:'2099-09-01',minutes:0};
const base=()=>({id:7,version:'v1',date:row.date,time:'10:00',service:'Cut',barber:'Amir',name:'Corrected',phone:'old number',email:''});
async function update(patch={}) {queries=[];return handle('updateBooking',{...base(),...patch},now);}
(async()=>{
    let result=await update();assert.equal(result.status,'success');
    let params=queries[1].params;
    assert.equal(params[7],'18.00');assert.equal(params[8],30);assert.equal(params[5],'old number');
    assert.equal(params[11],7);assert.equal(params[12],'v1');assert.equal(params[13],'schedule1');
    console.log('PASS same id, legacy phone, saved price and duration preserved');
    result=await update({service:'Long cut'});assert.equal(result.status,'success');assert.equal(queries[1].params[8],60);assert.equal(queries[1].params[7],40);
    held=[{barber:'Amir',start_minute:630,duration_min:30}];
    result=await update({service:'Long cut'});assert.equal(result.status,'error');assert.equal(queries.length,0);
    result=await update({barber:'Hemen',service:'Long cut'});assert.equal(result.status,'success');held=[];
    config.timeOff=[{barber:'Amir',from:row.date,to:row.date}];
    result=await update({time:'11:00'});assert.equal(result.status,'error');
    result=await update();assert.equal(result.status,'success');config.timeOff=[];
    console.log('PASS duration overlaps, barber changes and time off checked without blocking contact corrections');
    for(const patch of [{version:'old'},{time:'25:00'},{date:'2099-02-30'},{phone:'abc'},{email:'wrong'},{name:''},{service:'Missing'},{barber:'Missing'}]) {
        result=await update(patch);assert.equal(result.status,'error',JSON.stringify(patch));assert.equal(queries.length,0);
    }
    row.date='2020-01-01'; result=await update();assert.equal(result.status,'success');result=await update({time:'11:00'});assert.equal(result.status,'success');row.date='2099-09-08';
    concurrent=true;result=await update();assert.equal(result.status,'error');concurrent=false;
    conflict=true;result=await update();assert.equal(result.status,'error');conflict=false;
    assert.equal(mail,0);
    result=await update({email:'test@example.com',notifyCustomer:true});assert.equal(result.emailed,true);assert.equal(mail,1);
    active=false;result=await update();assert.equal(result.status,'error');active=true;
    result=await update({name:'Original'});assert.equal(result.unchanged,true);assert.equal(queries.length,0);
    console.log('PASS stale edits, cancellation, DB overlap races, invalid changes and unchanged retries are safe');
    const api=fs.readFileSync(require.resolve('../api/index'),'utf8');
    const guard=api.slice(api.indexOf("if (['reports', 'unlock'"),api.indexOf("if (action === 'unlock')"));
    for(const action of ['getBookingForEdit','editBookingSlots','updateBooking']) assert.ok(guard.includes("'"+action+"'"));
    assert.match(guard,/!isAuthorized\(payload\)/);assert.match(guard,/!isOwner\(payload\)/);
    const auth=require('../api/_lib/auth');
    auth.throttleFailedLogin=async()=>{};
    const oldPassword=process.env.ADMIN_PASSWORD,oldPin=process.env.REPORTS_PIN;
    process.env.ADMIN_PASSWORD='test-panel';process.env.REPORTS_PIN='test-owner';
    try {
      const apiHandler=require('../api');
      // Run the actual browser unlock flow against the actual API/auth gate.
      // Mocking unlock as always-success hid differences from Management.
      const vm=require('vm');
      const adminSource=fs.readFileSync(require.resolve('../admin/admin.js'),'utf8');
      const helper=adminSource.slice(adminSource.indexOf('function requestOwnerUnlock('),adminSource.indexOf('/** Ask the server for the ten-minute pass'));
      const fields={};
      const field=id=>fields[id] ||= {value:'',hidden:false,disabled:false,textContent:'',classList:{add(){},remove(){}},reset(){},addEventListener(){},removeAttribute(){},focus(){},scrollIntoView(){}};
      const context=vm.createContext({document:{getElementById:field,body:{children:[],style:{overflow:''}}},adminPassword:'test-panel',setTimeout,clearTimeout,
        showToast(){throw new Error('Unexpected missing booking');},
        apiPost:async payload=>{let result;await apiHandler({method:'POST',body:JSON.stringify(payload)},
          {status(){return this;},setHeader(){},send(v){result=JSON.parse(v);}});return result;}});
      vm.runInContext(helper+'\n'+fs.readFileSync(require.resolve('../admin/booking-editor.js'),'utf8'),context);
      // Use fetchLiveBookings' real mapping, not a numeric fake UI id.
      const mapping=adminSource.slice(adminSource.indexOf('bookings = data.map('),adminSource.indexOf('            saveBookings();',adminSource.indexOf('bookings = data.map(')));
      vm.runInContext('let bookings; const data=[{id:7,name:"Test"}];'+mapping,context);
      vm.runInContext('fillBookingEditor=()=>{};loadBookingEditSlots=async()=>{};',context);
      const event={preventDefault(){},target:{querySelector:()=>field('submit')}};
      for(const pin of ['test-owner','  test-owner  ','wrong']) {
        vm.runInContext("bookingEditorState=null; openBookingEditor('BK-100');",context);
        assert.equal(vm.runInContext('bookingEditorState.id',context),7,'table display id must resolve to persistent booking id');
        field('bookingEditPin').value=pin;field('bookingEditPinForm').hidden=false;field('bookingEditForm').hidden=true;
        await context.unlockBookingEditor(event);
        assert.equal(field('bookingEditForm').hidden,pin==='wrong','same Management PIN must open editor, wrong PIN must not');
      }
      console.log('PASS browser editor accepts Management PIN and surrounding spaces through real API, rejects wrong PIN');
      for(const action of ['getBookingForEdit','editBookingSlots','updateBooking']) {
        for(const creds of [{},{password:'wrong',pin:'test-owner'},{password:'test-panel',pin:'wrong'}]) {
          let code,answer;await apiHandler({method:'POST',body:JSON.stringify({action,id:7,...creds})},{status(c){code=c;return this;},setHeader(){},send(v){answer=JSON.parse(v);}});
          assert.equal(code,401);assert.equal(answer.status,'error');assert.equal(answer.booking,undefined);
        }
      }
    } finally {if(oldPassword===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=oldPassword;if(oldPin===undefined)delete process.env.REPORTS_PIN;else process.env.REPORTS_PIN=oldPin;}
    console.log('PASS actual API refuses every editor action without password and correct PIN');
})().catch(e=>{console.error(e);process.exitCode=1;});

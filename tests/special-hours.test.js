const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rota=require('../api/_lib/rota'),special=require('../api/_lib/special-hours');
const date='2099-09-10'; // Thursday, normally off.
const row={date,from:'10:00',to:'16:00',breakFrom:'13:30',breakTo:'14:00'};
assert.equal(special.validate([row]),'');
for(const rows of [[null],[{...row,date:'2099-02-30'}],[row,row],[{...row,from:'17:00'}],[{...row,breakTo:''}],[{...row,breakTo:'18:00'}]]) assert(special.validate(rows));
const config={barberNames:['Test'],hours:rota.WEEKDAY_NAMES.map(day=>({day,open:true,from:'09:00',to:'18:00'})),barberHours:{Test:rota.WEEKDAY_NAMES.map(day=>({day,working:false}))},timeOff:[],specialHours:[{...row,barber:'Test'}]};
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const names=['parseClock','dateKey','hoursForDay','barberDayEntry','isBarberOnLeave','isBarberWorkingAt'];
const code=names.map(n=>html.match(new RegExp('^        function '+n+'\\([\\s\\S]*?^        }','m'))[0]).join('\n');
const window={sussexHours:config.hours,sussexBarberHours:config.barberHours,sussexTimeOff:config.timeOff,sussexSpecialHours:config.specialHours};
const context=vm.createContext({window,WEEKDAY_NAMES:rota.WEEKDAY_NAMES,SLOT_MINUTES:30});vm.runInContext(code,context);
for(const d of ['2099-09-03',date,'2099-09-17']) for(let t=480;t<1140;t+=15)for(const duration of [15,30,60,90]){
    const backend=rota.isBarberWorkingAt(config,'Test',d,t,duration);
    const frontend=vm.runInContext(`isBarberWorkingAt('Test',new Date('${d}T12:00:00'),${t},${duration})`,context);
    assert.equal(frontend,backend,`${d} ${t}/${duration}`);
}
assert(rota.isBarberWorkingAt(config,'Test',date,600,60));
assert(!rota.isBarberWorkingAt(config,'Test','2099-09-17',600));
assert(!rota.isBarberWorkingAt(config,'Test',date,795,30));
assert(!rota.isBarberWorkingAt(config,'Test',date,930,60));
assert.deepEqual(rota.barbersWorkingAt(config,date,600,60),['Test']);
config.timeOff.push({barber:'Test',from:date,to:date});assert(!rota.isBarberWorkingAt(config,'Test',date,600));config.timeOff.length=0;
config.hours.find(h=>h.day==='Thursday').open=false;assert(!rota.isBarberWorkingAt(config,'Test',date,600));
console.log('PASS dated extra shift: browser/server agreement, other weeks unchanged, lunch, full duration, Any, shop closure and leave');

// Exercise the actual editor: writing the outgoing proposal into the draft
// before success would duplicate or replace source rows on multi-date retries.
(async()=>{
    const elements=new Map(),focuses=[],requests=[];
    const el=id=>{
        if(!elements.has(id))elements.set(id,{id,value:'',innerHTML:'',textContent:'',disabled:false,isConnected:true,
            classList:{add(){},remove(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},
            focus(){focuses.push(id);},querySelector(selector){return id==='specialCalendar'?{focus(){focuses.push(selector);}}:null;}});
        return elements.get(id);
    };
    const original={date:'2026-10-22',from:'11:00',to:'16:00',breakFrom:'13:30',breakTo:'14:00'};
    let answer={status:'error',message:'Synthetic failure'};
    const background={inert:false},modal=el('specialHoursModal'),body={style:{overflow:'hidden'},children:[background,modal]};
    const ctx=vm.createContext({document:{body,getElementById:el,activeElement:{isConnected:true,focus(){focuses.push('parent');}}},
        barbers:[{name:'Test'}],editingBarberIndex:0,barberSaving:false,API_URL:'/api',adminPassword:'test-only',
        fetch:async()=>({json:async()=>({today:'2026-10-20',specialHoursRevision:'v1',specialHours:[{barber:'Test',...original}]})}),
        escapeHtml:String,escapeAttr:String,beginPanelSave:()=>()=>{},asOwner:p=>p,
        apiPost:async p=>{requests.push(JSON.parse(JSON.stringify(p)));return answer;},showToast(){}});
    vm.runInContext(fs.readFileSync(require.resolve('../admin/special-hours.js'),'utf8'),ctx);
    const run=code=>vm.runInContext(code,ctx),state=code=>JSON.parse(run('JSON.stringify('+code+')'));
    const submit=()=>run('saveSpecialHours({preventDefault(){}})');
    await run('openSpecialHours()');assert(background.inert);assert.equal(focuses.at(-1),'specialHoursTitle');
    run('editSpecialDate(-1)');
    for(const [id,value] of Object.entries({specialFrom:'10:00',specialTo:'18:00',specialBreakFrom:'13:30',specialBreakTo:'14:00'}))el(id).value=value;
    assert(!el('specialHoursBody').innerHTML.includes('type="date"'));
    assert(el('specialCalendarPrevious').disabled);
    assert(el('specialHoursSave').disabled);assert.deepEqual(state('specialDraft.dates'),[]);
    assert.match(el('specialCalendar').innerHTML,/aria-label="2026-10-22 — already added" disabled/);
    run("chooseSpecialDate('2026-10-20');chooseSpecialDate('2026-10-20')");assert(el('specialHoursSave').disabled);
    await submit();assert.equal(requests.length,0);assert.match(el('specialHoursError').textContent,/at least one date/);
    run("chooseSpecialDate('2026-10-21');chooseSpecialDate('2026-10-22')");
    assert.deepEqual(state('specialDraft.dates'),['2026-10-21']); // Existing shift cannot be overwritten.
    run("shiftSpecialCalendar(30);chooseSpecialDate('2026-11-19')");
    assert.match(el('specialCalendar').innerHTML,/aria-pressed="true" aria-label="2026-11-19"/);
    assert.equal(el('specialSelectionCount').textContent,'2 dates selected');
    run('shiftSpecialCalendar(-30)');assert.deepEqual(state('specialDraft.dates'),['2026-10-21','2026-11-19']);
    await submit();assert.equal(requests.length,1);
    assert.deepEqual(requests[0].shifts.map(r=>r.date),['2026-10-21','2026-10-22','2026-11-19']);
    assert.equal(requests[0].shifts[1].from,'11:00'); // Unselected hours remain intact.
    assert.equal(special.validate(requests[0].shifts),'');
    assert.deepEqual(state('specialDraft.rows'),[{barber:'Test',...original}]);
    assert.deepEqual(state('specialDraft.dates'),['2026-10-21','2026-11-19']);
    assert.match(el('specialHoursError').textContent,/Synthetic failure/);
    answer={confirmationRequired:true,conflicts:[{id:7,date:'2026-10-21',time:'10:00',name:'Synthetic'}]};
    await submit();assert.deepEqual(state('specialDraft.confirmedBookings'),[7]);
    el('specialHoursBody').listeners.input();assert.equal(run('specialDraft.confirmedBookings'),null);
    assert.equal(el('specialHoursSave').textContent,'Save changes');
    await submit();answer={status:'success'};await submit();
    assert.deepEqual(requests.at(-1).shifts,requests[0].shifts);assert.deepEqual(requests.at(-1).confirmedBookings,[7]);
    assert.equal(run('specialDraft'),null);assert.equal(background.inert,false);assert.equal(body.style.overflow,'hidden');
    assert.equal(focuses.at(-1),'parent');

    // Editing a single saved row can move it or expand it into multiple dates;
    // the old row is replaced only in the outgoing proposal, including retries.
    await run('openSpecialHours()');run('editSpecialDate(0)');
    for(const key of ['specialFrom','specialTo','specialBreakFrom','specialBreakTo'])el(key).value='';
    el('specialFrom').value='12:00';el('specialTo').value='17:00';
    run("chooseSpecialDate('2026-10-23');chooseSpecialDate('2026-10-22')");
    answer={status:'error',message:'Try again'};await submit();await submit();
    assert.deepEqual(requests.at(-1).shifts,[{date:'2026-10-23',from:'12:00',to:'17:00',breakFrom:'',breakTo:''}]);
    assert.deepEqual(requests.at(-1).shifts,requests.at(-2).shifts);
    assert.equal(state('specialDraft.rows')[0].date,'2026-10-22');
    run('closeSpecialHours()');await run('openSpecialHours()');assert.equal(state('specialDraft.rows')[0].date,'2026-10-22');
    run('specialDraft.rows[0].date="2026-12-25";editSpecialDate(0)');assert.equal(run('specialDraft.offset'),60);
    assert.match(el('specialCalendar').innerHTML,/aria-pressed="true" aria-label="2026-12-25"/);
    run('closeSpecialHours()');
    const panel=fs.readFileSync(require.resolve('../admin/index.html'),'utf8');
    const sheet=panel.slice(panel.indexOf('<div id="specialHoursModal"'),panel.indexOf('<script src="/admin/password-visibility.js"'));
    assert(!sheet.includes('modal-close'));assert.equal((sheet.match(/>Back<\/button>/g)||[]).length,1);
    console.log('PASS multi-date selection across pages, empty/duplicate guards, preserved shifts, failed/confirmed retries, edit/move, focus and Back discard');
})().catch(error=>{console.error(error);process.exitCode=1;});

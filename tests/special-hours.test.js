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

// A duration edited in the panel used to be display text only: both pickers
// and the booking API still made every appointment thirty minutes long.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rota = require('../api/_lib/rota');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const names = ['parseClock', 'minutesToLabel', 'hoursForDay', 'isClosedOn',
  'dateKey', 'barberDayEntry', 'isBarberOnLeave', 'isBarberWorkingAt',
  'barbersWorkingAt', 'selectedBarberName', 'selectedServiceDuration', 'slotsForDate'];
const source = names.map(name => {
  const match = html.match(new RegExp('^        function ' + name + '\\([\\s\\S]*?^        }', 'm'));
  return match ? match[0] : '';
}).join('\n');
const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const config = {
  barberNames: ['Amir'],
  hours: days.map(day => ({day, open: true, from: '10:00', to: '18:00'})),
  barberHours: {Amir: days.map(day => ({day, working: true, from: '10:00',
    to: '18:00', breakFrom: '13:30', breakTo: '14:00'}))}, timeOff: []
};
const context = vm.createContext({
  SLOT_MINUTES: 30, MIN_NOTICE_MINUTES: 15, ANY_BARBER: 'Any Available',
  WEEKDAY_NAMES: days,
  document: {getElementById: id => ({value: id === 'barber' ? 'Amir' : 'Long cut'})},
  window: {sussexHours: config.hours, sussexBarbers: config.barberNames,
    sussexBarberHours: config.barberHours, sussexTimeOff: [],
    sussexServices: [{nameEN: 'Long cut', duration: 60}]}
});
vm.runInContext(source, context);
let failed = 0;
function check(name, run) {
  try {run(); console.log('PASS  ' + name);}
  catch (err) {failed++; console.error('FAIL  ' + name + '\n' + err.message);}
}
check('a 60-minute service cannot start half an hour before closing', () => {
  assert.equal(rota.isBarberWorkingAt(config, 'Amir', '2099-09-08', 17 * 60 + 30, 60), false);
});
check('a 60-minute service cannot run into the barber break', () => {
  assert.equal(rota.isBarberWorkingAt(config, 'Amir', '2099-09-08', 13 * 60, 60), false);
  assert.equal(rota.isBarberWorkingAt(config, 'Amir', '2099-09-08', 12 * 60 + 30, 60), true);
});
check('the website reads the selected service duration, not a fixed half hour', () => {
  const slots = vm.runInContext("slotsForDate(new Date('2099-09-08T00:00:00'), 'Amir')", context);
  assert.equal(slots.includes('17:30'), false);
  assert.equal(slots.includes('13:00'), false);
  assert.equal(slots.includes('17:00'), true);
});
check('browser and server agree for 15, 30, 45, 60 and 90 minute services', () => {
  for (const duration of [15, 30, 45, 60, 90]) {
    context.window.sussexServices[0].duration = duration;
    const browser = vm.runInContext("slotsForDate(new Date('2099-09-08T00:00:00'), 'Amir')", context);
    const server = rota.slotsForDate(config, '2099-09-08', 'Amir', '', 0, duration);
    assert.deepEqual(Array.from(browser), server, `duration=${duration}`);
  }
});
check('a longer service still offers starts every thirty minutes', () => {
  const slots = rota.slotsForDate(config, '2099-09-08', 'Amir', '', 0, 60);
  assert.equal(slots.includes('10:30'), true);
});
process.exitCode = failed ? 1 : 0;

// Exercise the real asynchronous handlers: a service switch must fetch new
// intervals, and an old response must not repaint the new service's grid.
(async () => {
  const pending = [];
  const date = new Date(); date.setDate(date.getDate()+1);
  const fields = {
    date: {value: date.toISOString().slice(0,10), addEventListener(type, fn) {this.change=fn;}},
    time: {value:'10:00'}, service: {value:'Short cut'},
    timeSlotStatusText: {}, timeChipsGrid: {appendChild() {}}
  };
  const page = vm.createContext({
    document: {getElementById:id=>fields[id],createElement:()=>({})},
    API_URL:'/api', bookedTimesList:[], selectedBarberName:()=> 'Amir',
    isClosedOn:()=>false, renderTimeChips(){}, showToast(){}, console,
    AbortController, setTimeout:()=>1, clearTimeout(){},
    fetch:url=>new Promise(resolve=>pending.push({url,resolve}))
  });
  const start=html.indexOf('        // Date Change Event (Fetch availability)');
  const end=html.indexOf('        // Set date constraints',start);
  vm.runInContext(html.slice(start,end),page);
  const old=fields.date.change.call(fields.date);
  fields.service.value='Long cut';
  const current=fields.date.change.call(fields.date);
  assert.equal(new URL(pending[1].url,'https://example.test').searchParams.get('service'),'Long cut');
  pending[1].resolve({ok:true,json:async()=>['10:30']}); await current;
  pending[0].resolve({ok:true,json:async()=>[]}); await old;
  assert.deepEqual(Array.from(page.bookedTimesList),['10:30']);
  console.log('PASS  public service changes request fresh intervals and ignore stale answers');

  const admin=fs.readFileSync(require.resolve('../admin/admin.js'),'utf8');
  const panelFields={shopBookTimes:{},shopBookDate:{value:fields.date.value},
    shopBookBarber:{value:'Amir'},shopBookService:{value:'Long cut'}};
  let requested;
  const panel=vm.createContext({document:{getElementById:id=>panelFields[id]},
    ANY_BARBER:'Any Available',API_URL:'/api',shopBookingTime:'10:00',shopBookingTimesToken:0,
    setShopBookingStatus(){},escapeAttr:s=>s,escapeHtml:s=>s,
    fetch:async url=>{requested=url;return {json:async()=>({slots:['10:00','10:30'],unavailable:['10:30']})};}});
  vm.runInContext(admin.match(/^async function loadShopBookingTimes\([\s\S]*?^}/m)[0],panel);
  await panel.loadShopBookingTimes();
  assert.equal(new URL(requested,'https://example.test').searchParams.get('service'),'Long cut');
  assert.match(panelFields.shopBookTimes.innerHTML,/disabled[\s\S]*10:30/);
  assert.equal(panel.shopBookingTime,'');
  assert.match(fs.readFileSync(require.resolve('../admin/index.html'),'utf8'),/id="shopBookService"[^>]*onchange="loadShopBookingTimes\(\)"/);
  console.log('PASS  panel service selection refreshes duration-aware slots and clears the old choice');
})().catch(err=>{console.error(err);process.exitCode=1;});

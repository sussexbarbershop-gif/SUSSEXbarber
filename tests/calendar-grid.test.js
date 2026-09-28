// Month-end must not shrink the picker to a handful of dates. Exercise the
// real renderer, including weekday padding, closed days and click payloads.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const grab=name=>html.match(new RegExp('^        function '+name+'\\([\\s\\S]*?^        }','m'))[0];
const windowOf=new Function(grab('calendarWindow')+';return calendarWindow;')();
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
for(const [now,end] of [['2026-09-28T12:00:00Z','2026-10-27'],['2026-12-31T12:00:00Z','2027-01-29'],['2028-02-28T12:00:00Z','2028-03-28'],['2026-03-28T12:00:00Z','2026-04-26']]) {
  const dates=windowOf(new Date(now));assert.equal(dates.length,30);
  assert.equal(iso(dates[29]),end);assert.equal(new Set(dates.map(iso)).size,30);
  const nodes={calendarDaysGrid:{children:[],appendChild(n){this.children.push(n);}},calendarMonthYear:{},date:{value:''}};
  let changes=0;nodes.date.dispatchEvent=()=>changes++;
  const doc={getElementById:id=>nodes[id],createElement:tag=>({tag,dataset:{},children:[],appendChild(n){this.children.push(n);},setAttribute(k,v){this[k]=v;},addEventListener(k,f){this[k]=f;}})};
  const render=new Function('document','window','calendarWindow','isClosedOn','noSlotsOn','selectedBarberName','Event',grab('renderCustomCalendar')+';return renderCustomCalendar;')(doc,{currentLang:'en'},()=>dates,d=>d.getDay()===0,()=>false,()=>'',class {});
  render();const buttons=nodes.calendarDaysGrid.children.filter(n=>n.tag==='button');
  assert.equal(buttons.length,30);assert.equal(nodes.calendarDaysGrid.children.indexOf(buttons[0]),dates[0].getDay());
  assert.deepEqual(buttons.map(n=>n.dataset.date),dates.map(iso));
  buttons.forEach((b,i)=>assert.equal(!!b.disabled,dates[i].getDay()===0));
  const chosen=buttons.find(b=>!b.disabled);chosen.click();assert.equal(nodes.date.value,chosen.dataset.date);assert.equal(changes,1);
}
assert.equal(iso(windowOf(new Date('2026-09-27T22:30:00Z'))[0]),'2026-09-28','Amsterdam date, not visitor date');
assert.equal(html.includes('id="calNextBtn"'),false,'no misleading month navigation for a rolling window');
console.log('PASS 30 rendered dates across month/year/leap/DST boundaries, weekday alignment, closures and selection');

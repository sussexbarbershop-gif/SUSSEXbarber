// Proposals only. Database integration must separately prove atomic writes,
// snapshot races, cancellation and retries before the planner is enabled.
const assert = require('node:assert/strict');
const {plan} = require('../api/_lib/flexible-plan');
const rota = require('../api/_lib/rota');
const date='2099-09-08';
const config={barberNames:['A','B','C'],barberPriority:['A','B','C'],timeOff:[],
    hours:rota.WEEKDAY_NAMES.map(day=>({day,open:true,from:'09:00',to:'18:00'})),barberHours:{}};
const row=(id,barber,start=600,duration=30,flexible=false)=>({id,barber,start,duration,flexible});
const request=(barber='',start=600,duration=30)=>({barber,start,duration});
function check(label,fn) {fn(); console.log('PASS '+label);}
check('priority assignment, named preference, no mutation',()=>{
    assert.equal(plan(config,date,[],request()).barber,'A');
    assert.equal(plan(config,date,[],request('C')).barber,'C');
    const rows=[row(1,'A',600,30,true)], before=JSON.stringify(rows);
    assert.deepEqual(plan(config,date,rows,request('A')).moves,[{id:1,from:'A',to:'B'}]);
    assert.equal(JSON.stringify(rows),before);
    assert.deepEqual(plan(config,date,rows,request()),{status:'available',barber:'B',moves:[]});
});
check('fixed and legacy bookings never become flexible by inference',()=>{
    assert.equal(plan(config,date,[row(1,'A')],request('A')).status,'unavailable');
    const old=row(1,'A'); delete old.flexible;
    assert.equal(plan(config,date,[old],request('A')).status,'unavailable');
    assert.equal(plan(config,date,[row(1,'')],request('A')).status,'legacy');
    assert.equal(plan(config,date,[row(1,'A',600,30,true)],request('A'),{movableAfter:601}).status,'unavailable');
});
check('capacity exhausted leaves the whole plan unchanged',()=>{
    const rows=['A','B','C'].map((name,i)=>row(i+1,name,600,30,true));
    assert.deepEqual(plan(config,date,rows,request('A')),{status:'unavailable',barber:null,moves:[]});
});
check('transitive chain across different appointment lengths',()=>{
    const c=structuredClone(config);
    // C cannot take the long 10:00 appointment, but can take the later one.
    c.barberHours.C=[{day:'Tuesday',working:true,from:'10:30',to:'18:00'}];
    const result=plan(c,date,[row(1,'A',600,60,true),row(2,'B',630,60,true),row(3,'A',660,30)],request('A'));
    assert.equal(result.status,'available');
    assert.deepEqual(result.moves,[{id:1,from:'A',to:'B'},{id:2,from:'B',to:'C'}]);
});
check('lunch, leave, shift end and the whole service constrain destinations',()=>{
    const c=structuredClone(config);
    c.timeOff=[{barber:'C',from:date,to:date}];
    c.barberHours.B=[{day:'Tuesday',working:true,from:'09:00',to:'18:00',breakFrom:'10:30',breakTo:'11:00'}];
    assert.equal(plan(c,date,[row(1,'A',600,60,true)],request('A')).status,'unavailable');
    assert.equal(plan(c,date,[row(1,'A',600,30,true)],request('A')).status,'available');
    c.barberHours.B=[{day:'Tuesday',working:true,from:'09:00',to:'10:30'}];
    assert.equal(plan(c,date,[row(1,'A',600,60,true)],request('A')).status,'unavailable');
});
check('adjacent intervals do not overlap, unrelated bookings stay untouched',()=>{
    const rows=[row(1,'A',570),row(2,'A',630),row(3,'B',900,30,true)];
    assert.deepEqual(plan(config,date,rows,request('A')),{status:'available',barber:'A',moves:[]});
});
check('invalid input and exhausted search never advertise capacity',()=>{
    assert.equal(plan(config,date,[row(1,'A'),row(1,'B')],request()).status,'invalid');
    assert.equal(plan(config,date,[],request('',600,NaN)).status,'invalid');
    assert.equal(plan(config,date,[],request(),{maxNodes:0}).status,'indeterminate');
});

// Independent exhaustive oracle: enumerate every legal chair assignment for
// small diaries, including overlapping long services. This catches greedy
// algorithms that appear correct in the simple one-slot examples above.
function oracle(c,rows,newRow) {
    const items=[...rows,newRow];
    const assigned=[];
    function visit(index) {
        if(index===items.length) return true;
        const item=items[index];
        const choices=index===rows.length
            ? (item.barber?[item.barber]:c.barberNames)
            : (item.flexible?c.barberNames:[item.barber]);
        for(const barber of choices) {
            if(!rota.isBarberWorkingAt(c,barber,date,item.start,item.duration)) continue;
            if(assigned.some(prev=>prev.barber===barber && Math.max(prev.start,item.start)<Math.min(prev.start+prev.duration,item.start+item.duration))) continue;
            assigned.push({...item,barber});
            if(visit(index+1)) return true;
            assigned.pop();
        }
        return false;
    }
    return visit(0);
}
check('1500 deterministic diaries agree with exhaustive assignment oracle',()=>{
    let seed=81293;
    const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let i=0;i<1500;i++) {
        const rows=[];
        for(let j=0;j<5;j++) {
            const candidate=row(j+1,config.barberNames[rand(3)],600+rand(4)*30,(rand(3)+1)*30,rand(2)===1);
            if(!rows.some(r=>r.barber===candidate.barber && r.start<candidate.start+candidate.duration && candidate.start<r.start+r.duration)) rows.push(candidate);
        }
        const wanted=request(['','A','B','C'][rand(4)],600+rand(4)*30,(rand(3)+1)*30);
        const result=plan(config,date,rows,wanted);
        assert.equal(result.status==='available',oracle(config,rows,wanted),JSON.stringify({rows,wanted,result}));
        if(result.status==='available') {
            const after=rows.map(r=>({...r,barber:result.moves.find(m=>m.id===r.id)?.to || r.barber,flexible:false}));
            assert.equal(oracle(config,after,{...wanted,barber:result.barber}),true);
            assert(result.moves.every(m=>rows.find(r=>r.id===m.id).flexible));
        }
    }
});

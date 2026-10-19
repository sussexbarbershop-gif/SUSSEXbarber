/** Pure scheduling proposal, deliberately not a database writer.
 *
 * A named chair is not evidence of the customer's preference. Only an explicit
 * flexible:true permits reassignment; old rows remain fixed. Plan complete
 * intervals, not counts at the new start time: a long haircut must have one
 * barber for its entire duration. The caller must atomically validate its
 * snapshot and apply every move together before treating this as a booking.
 */
const rota = require('./rota');
const overlaps = (a,b) => a.start < b.start+b.duration && b.start < a.start+a.duration;
const named = value => {
    const text = String(value || '').trim();
    return text === rota.ANY_BARBER || text === 'Any' ? '' : text;
};

/** rows: {id,start,duration,barber,flexible}; request: {start,duration,barber}.
 * All times are minutes relative to date. No personal information is needed.
 * Unknown legacy chairs fail closed when they overlap the affected component.
 * A bounded search reports indeterminate, never falsely reports available.
 */
function plan(config,date,rows,request,{maxNodes=100000, movableAfter=-Infinity}={}) {
    const fail = reason => ({status:reason, barber:null, moves:[]});
    const valid = row => Number.isFinite(row.start) && Number.isFinite(row.duration) && row.duration>0;
    if (!valid(request) || request.start<0 || request.start+request.duration>1440 || !Array.isArray(rows)) return fail('invalid');
    if (!rows.every(valid) || new Set(rows.map(r=>String(r.id))).size!==rows.length || rows.some(r=>r.id==null)) return fail('invalid');
    const names = [...new Set((config.barberNames || []).map(named).filter(Boolean))];
    const priority = [...new Set((config.barberPriority || []).map(named).filter(n=>names.includes(n)))];
    const ranked = priority.concat(names.filter(n=>!priority.includes(n)));
    const candidates = row => ranked.filter(n=>rota.isBarberWorkingAt(config,n,date,row.start,row.duration));
    const wanted = named(request.barber);
    let requestChoices = candidates(request).filter(n=>!wanted || n===wanted);
    if (!wanted) {
        // Another Any request should use an already-free chair in priority
        // order before displacing somebody else's provisional assignment.
        const occupied = name=>rows.some(row=>row.barber===name && overlaps(row,request));
        requestChoices = requestChoices.filter(n=>!occupied(n)).concat(requestChoices.filter(occupied));
    }
    if (!requestChoices.length) return fail('unavailable');

    // Include transitive overlaps: moving 10:00–11:00 can require moving a
    // flexible 10:30–11:30 even for a new appointment ending at 10:30.
    const component = [];
    let frontier = [request];
    const remaining = new Set(rows);
    while (frontier.length) {
        const next = [];
        for (const row of remaining) if (frontier.some(other=>overlaps(row,other))) {
            remaining.delete(row); component.push(row); next.push(row);
        }
        frontier = next;
    }
    if (component.some(row=>!named(row.barber))) return fail('legacy');
    const fixed = component.filter(r=>r.flexible!==true || r.start<movableAfter);
    const flexible = component.filter(r=>r.flexible===true && r.start>=movableAfter);
    // Never use this feature to silently repair an already inconsistent diary.
    if (fixed.some((a,i)=>fixed.slice(i+1).some(b=>a.barber===b.barber && overlaps(a,b)))) return fail('invalid');
    const options = new Map(flexible.map(row=>{
        const available = candidates(row).filter(n=>!fixed.some(f=>f.barber===n && overlaps(f,row)));
        // Keep current chairs where possible, while preferring the shop's
        // ranking for a new request. Existing invalid rota assignments must
        // not be moved unless a complete valid solution exists.
        return [row, available.includes(row.barber) ? [row.barber,...available.filter(n=>n!==row.barber)] : available];
    }));
    let nodes=0, exhausted=false;
    for (const barber of requestChoices) {
        if (fixed.some(row=>row.barber===barber && overlaps(row,request))) continue;
        const placed = [{...request,barber},...fixed];
        const assigned = new Map();
        function search(todo) {
            if (++nodes>maxNodes) { exhausted=true; return false; }
            if (!todo.length) return true;
            // Most constrained first, stable id tie break. This avoids blindly
            // stealing the only chair suitable for a longer service.
            const choices = todo.map(row=>({row,free:options.get(row).filter(n=>
                !placed.some(p=>p.barber===n && overlaps(p,row)))}))
                .sort((a,b)=>a.free.length-b.free.length || String(a.row.id).localeCompare(String(b.row.id)));
            const {row,free} = choices[0];
            for (const name of free) {
                placed.push({...row,barber:name}); assigned.set(row,name);
                if (search(todo.filter(r=>r!==row))) return true;
                assigned.delete(row); placed.pop();
                if (exhausted) return false;
            }
            return false;
        }
        if (search(flexible)) return {status:'available',barber,moves:flexible
            .filter(row=>assigned.get(row)!==row.barber)
            .map(row=>({id:row.id,from:row.barber,to:assigned.get(row)}))};
        if (exhausted) return fail('indeterminate');
    }
    return fail('unavailable');
}
module.exports = {plan};

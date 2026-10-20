// Separate dated draft, kept outside the barber's weekly rota draft. Opening,
// changing dates, Back and failed saves cannot modify the persisted schedule.
let specialDraft=null;
const specialEl=id=>document.getElementById(id);
async function openSpecialHours() {
    if(specialDraft || barberSaving) return;
    const barber=barbers[editingBarberIndex];if(!barber)return;
    const modal=specialEl('specialHoursModal');
    // A prior batch's Saved message must not label this new unsaved draft.
    modal.querySelector('.panel-save-status')?.remove();
    specialDraft={barber:barber.name,rows:[],revision:'',today:'',index:-1,dates:null,offset:0,busy:false,focus:document.activeElement,inert:[],overflow:document.body.style.overflow};
    const state=specialDraft;
    for(const node of document.body.children) if(node!==modal && !node.inert){node.inert=true;state.inert.push(node);}
    document.body.style.overflow='hidden';
    modal.classList.add('active');specialEl('specialHoursTitle').textContent=barber.name+' · Special hours';
    specialEl('specialHoursBody').textContent='Loading…';specialEl('specialHoursError').textContent='';
    try {
        const response=await fetch(API_URL+'?action=getConfig',{cache:'no-store'}),data=await response.json();
        if(specialDraft!==state)return;
        specialDraft.rows=(data.specialHours || []).filter(r=>r.barber===barber.name).map(r=>({...r}));
        specialDraft.revision=data.specialHoursRevision;specialDraft.today=data.today;
        renderSpecialHours();specialEl('specialHoursTitle').focus();
    }catch{if(specialDraft===state)specialEl('specialHoursError').textContent='Could not load the schedule. Go back and try again.';}
}
function closeSpecialHours() {
    if(specialDraft?.busy)return;
    const focus=specialDraft?.focus;
    specialDraft?.inert.forEach(node=>{node.inert=false;});
    if(specialDraft)document.body.style.overflow=specialDraft.overflow;
    specialDraft=null;specialEl('specialHoursModal').classList.remove('active');
    if(focus?.isConnected)focus.focus();
}
function renderSpecialHours() {
    const s=specialDraft;if(!s)return;
    s.dates=null;
    specialEl('specialHoursBody').innerHTML=`<p class="cms-hint">Extra hours on selected dates. Weekly hours stay the same.</p>
        <div class="special-list">${s.rows.map((r,i)=>`<div class="special-row"><button type="button" class="btn btn-secondary" onclick="editSpecialDate(${i})">${escapeHtml(r.date)} · ${escapeHtml(r.from)}–${escapeHtml(r.to)}</button><button type="button" class="btn btn-danger" aria-label="Remove shift ${escapeAttr(r.date)}" onclick="removeSpecialDate(${i})">Remove</button></div>`).join('') || '<p class="cms-hint">No special hours yet.</p>'}</div>
        <button type="button" class="btn btn-secondary" onclick="editSpecialDate(-1)">+ Add dates</button>`;
    specialEl('specialHoursSave').disabled=!s.revision;specialEl('specialHoursSave').textContent='Save changes';s.confirmedBookings=null;
}
function removeSpecialDate(index) {specialDraft.rows.splice(index,1);renderSpecialHours();}
function editSpecialDate(index) {
    const s=specialDraft;s.index=index;s.offset=0;
    const r=s.rows[index] || {date:s.today,from:'10:00',to:'18:00',breakFrom:'13:30',breakTo:'14:00'};
    // New batches start empty: today's hours must not be added accidentally
    // when the owner only taps a different date. Existing shifts start selected.
    s.dates=index<0?[]:[r.date];
    // Editing a saved future shift must open its calendar page, not hide the
    // selection on today's page. Date arithmetic stays at noon across DST.
    const days=Math.round((new Date(r.date+'T12:00:00')-new Date(s.today+'T12:00:00'))/86400000);
    s.offset=Math.max(0,Math.floor(days/30)*30);
    specialEl('specialHoursBody').innerHTML=`<div class="special-date-summary"><strong>Choose dates</strong><span id="specialSelectionCount" role="status" aria-live="polite"></span></div>
        <p class="cms-hint">Tap dates to apply the same hours.</p>
        <div class="special-calendar-head"><button type="button" id="specialCalendarPrevious" class="btn btn-secondary" aria-label="Previous 30 days" onclick="shiftSpecialCalendar(-30)">‹</button><span id="specialCalendarLabel">Choose dates</span><button type="button" class="btn btn-secondary" aria-label="Next 30 days" onclick="shiftSpecialCalendar(30)">›</button></div><div id="specialCalendar" class="special-calendar" role="group" aria-label="Select special hours dates"></div>
        <div class="form-row"><div class="form-group"><label for="specialFrom">Start</label><input type="time" id="specialFrom" value="${escapeAttr(r.from)}" required></div><div class="form-group"><label for="specialTo">End</label><input type="time" id="specialTo" value="${escapeAttr(r.to)}" required></div></div>
        <div class="form-row"><div class="form-group"><label for="specialBreakFrom">Break start (optional)</label><input type="time" id="specialBreakFrom" value="${escapeAttr(r.breakFrom || '')}"></div><div class="form-group"><label for="specialBreakTo">Break end (optional)</label><input type="time" id="specialBreakTo" value="${escapeAttr(r.breakTo || '')}"></div></div>
        <p class="cms-hint">Inside shop hours. Time off takes priority.</p>`;
    renderSpecialCalendar();specialEl('specialHoursSave').textContent='Save changes';s.confirmedBookings=null;
}
function shiftSpecialCalendar(n) {
    specialDraft.offset=Math.max(0,specialDraft.offset+n);renderSpecialCalendar();
    if(n<0 && specialDraft.offset===0)specialEl('specialCalendar').querySelector('button:not(:disabled)')?.focus();
}
function renderSpecialCalendar() {
    const s=specialDraft,base=new Date(s.today+'T12:00:00');
    const first=new Date(base),last=new Date(base);first.setDate(first.getDate()+s.offset);last.setDate(last.getDate()+s.offset+29);
    specialEl('specialCalendarLabel').textContent=first.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' – '+last.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    specialEl('specialCalendarPrevious').disabled=s.offset===0;
    specialEl('specialSelectionCount').textContent=s.dates.length===1?'1 date selected':s.dates.length+' dates selected';
    specialEl('specialHoursSave').disabled=s.dates.length===0;
    specialEl('specialCalendar').innerHTML=Array.from({length:30},(_,i)=>{
        const d=new Date(base);d.setDate(d.getDate()+s.offset+i);
        const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const selected=s.dates.includes(key),exists=s.rows.some((r,i)=>i!==s.index && r.date===key);
        return `<button type="button" class="btn btn-secondary ${selected?'selected':''}" aria-pressed="${selected}" aria-label="${key}${exists?' — already added':''}" ${exists?'disabled':''} onclick="chooseSpecialDate('${key}')"><small>${d.toLocaleDateString('en-GB',{weekday:'short'})}</small><span>${d.getDate()}</span></button>`;
    }).join('');
}
function chooseSpecialDate(key) {
    const s=specialDraft;if(!s || s.busy || !s.dates || s.rows.some((r,i)=>i!==s.index && r.date===key))return;
    s.dates=s.dates.includes(key)?s.dates.filter(d=>d!==key):[...s.dates,key].sort();
    s.confirmedBookings=null;specialEl('specialHoursSave').textContent='Save changes';renderSpecialCalendar();
    // Redrawing the grid must retain keyboard focus on the toggled date.
    specialEl('specialCalendar').querySelector(`[aria-label="${key}"]`)?.focus();
}
async function saveSpecialHours(event) {
    event.preventDefault();const s=specialDraft;if(!s || s.busy || !s.revision)return;
    let shifts=s.rows;
    if(s.dates) {
        if(!s.dates.length){specialEl('specialHoursError').textContent='Choose at least one date.';return;}
        if(s.rows.some((x,i)=>i!==s.index && s.dates.includes(x.date))){specialEl('specialHoursError').textContent='A selected date already exists. Edit its shift.';return;}
        const hours={from:specialEl('specialFrom').value,to:specialEl('specialTo').value,breakFrom:specialEl('specialBreakFrom').value,breakTo:specialEl('specialBreakTo').value};
        // Submit one complete proposal for all selected dates. Keep the source
        // rows untouched so refused saves and conflict-confirmation retries
        // cannot duplicate dates or lose the original shift being edited.
        shifts=s.rows.filter((r,i)=>i!==s.index).concat(s.dates.map(date=>({date,...hours}))).sort((a,b)=>a.date.localeCompare(b.date));
    }
    s.busy=true;specialEl('specialHoursError').textContent='';
    const finish=beginPanelSave();
    let saved=false;
    try {
        const answer=await apiPost(asOwner({action:'saveSpecialHours',password:adminPassword,barber:s.barber,revision:s.revision,shifts,confirmedBookings:s.confirmedBookings}));
        if(answer.confirmationRequired) {
            s.confirmedBookings=answer.conflicts.map(b=>b.id);
            specialEl('specialHoursError').textContent='These bookings stay active and need attention: '+answer.conflicts.map(b=>`${b.date} ${b.time} · ${b.name}`).join('; ')+'. Press Save anyway to continue.';
            specialEl('specialHoursSave').textContent='Save anyway';return;
        }
        if(answer.status!=='success')throw new Error(answer.message || 'Could not save.');
        saved=true;s.busy=false;closeSpecialHours();showToast(answer.conflictCount?'Saved — existing bookings need attention.':'Special hours saved','success');
    }catch(error){specialEl('specialHoursError').textContent=error.message || 'Could not save. Try again.';}
    finally {s.busy=false;finish(saved);}
}
specialEl('specialHoursBody').addEventListener('input',()=>{
    if(specialDraft){specialDraft.confirmedBookings=null;specialEl('specialHoursSave').textContent='Save changes';}
});
specialEl('specialHoursModal').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSpecialHours();}
    if(event.key==='Tab') {
        const controls=[...specialEl('specialHoursModal').querySelectorAll('button,input')].filter(el=>!el.disabled && el.getClientRects().length);
        if(event.shiftKey && document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}
        else if(!event.shiftKey && document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
    }
});

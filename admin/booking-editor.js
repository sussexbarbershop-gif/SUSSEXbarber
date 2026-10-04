// A separate draft: opening, typing or discarding never changes the diary.
// Each opening asks for the owner PIN, even if another owner page is unlocked.
let bookingEditorState = null;
const editEl = id => document.getElementById(id);
async function bookingEditorPost(payload, request = () => apiPost(payload)) {
    // A lost response must not trap the owner in a disabled modal indefinitely.
    // The version guard makes a retry safe even if the first write did arrive.
    let timer;
    try { return await Promise.race([request(),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('The request timed out. Reopen the booking to check its saved details before retrying.')),30000);
    })]); } finally {clearTimeout(timer);}
}
function editError(message) {
    const el=editEl('bookingEditError'); el.textContent = message || '';
    if (message) el.scrollIntoView({block:'nearest'});
}
function openBookingEditor(id) {
    if (bookingEditorState) return;
    const modal = editEl('bookingEditModal');
    bookingEditorState = {id, pass:'', original:null, busy:false, slotToken:0,
        returnFocus:document.activeElement, overflow:document.body.style.overflow, inert:[]};
    for (const el of document.body.children) if (el!==modal && !el.inert) {
        el.inert=true; bookingEditorState.inert.push(el);
    }
    document.body.style.overflow='hidden';
    editEl('bookingEditPinForm').reset(); editEl('bookingEditForm').reset();
    editEl('bookingEditPinForm').hidden=false; editEl('bookingEditForm').hidden=true;
    editError(''); modal.classList.add('active'); editEl('bookingEditPin').focus();
}
function closeBookingEditor() {
    const state = bookingEditorState;
    if (!state || state.busy) return;
    bookingEditorState=null;
    editEl('bookingEditModal').classList.remove('active');
    editEl('bookingEditPinForm').reset(); editEl('bookingEditForm').reset();
    state.inert.forEach(el=>{el.inert=false;});
    document.body.style.overflow=state.overflow;
    if (state.returnFocus?.isConnected) state.returnFocus.focus();
}
async function unlockBookingEditor(event) {
    event.preventDefault();
    const state=bookingEditorState;
    if (!state || state.unlocking) return;
    state.unlocking=true;
    const button=event.target.querySelector('button[type="submit"]'); button.disabled=true;
    editError('');
    try {
        const answer=await bookingEditorPost(null, () => requestOwnerUnlock(editEl('bookingEditPin').value));
        if (bookingEditorState!==state) return;
        editEl('bookingEditPin').value='';
        if (answer.status!=='success') throw new Error(/unauthorized/i.test(answer.message || '')
            ? 'Your sign-in has expired. Log out and sign in again.'
            : answer.locked ? 'Enter the same owner PIN used for Management.' : answer.message || 'That PIN is not right.');
        state.pass=answer.unlockPass;
        if (!state.original) {
            const data=await bookingEditorPost({action:'getBookingForEdit',password:adminPassword,unlockPass:state.pass,id:state.id});
            if (bookingEditorState!==state) return;
            if (data.status!=='success') throw new Error(data.locked
                ? 'Your PIN was accepted, but the editing pass was refused. Please unlock again.' : data.message);
            state.original=data.booking;
            fillBookingEditor(state.original);
        }
        editEl('bookingEditPinForm').hidden=true; editEl('bookingEditForm').hidden=false;
        editEl('editBookingName').focus();
        await loadBookingEditSlots();
    } catch (e) { if (bookingEditorState===state) editError(e.message || 'Could not reach the server. Try again.'); }
    finally { state.unlocking=false; button.disabled=false; }
}
function fillBookingEditor(b) {
    for (const [key,id] of Object.entries({name:'Name',date:'Date',phone:'Phone',email:'Email'})) editEl('editBooking'+id).value=b[key] || '';
    const options=(items,original) => [...new Set([original,...items])].map(value=>`<option value="${escapeAttr(value)}">${escapeHtml(value || 'Unassigned (saved booking)')}</option>`).join('');
    editEl('editBookingBarber').innerHTML=options(barbers.filter(b=>b.name!==ANY_BARBER).map(b=>b.name),b.barber);
    editEl('editBookingService').innerHTML=options(services.map(s=>s.nameEN),b.service);
    editEl('editBookingBarber').value=b.barber; editEl('editBookingService').value=b.service;
    editEl('editBookingNotify').checked=false; // Staff deliberately opt in to sending an email.
    editEl('editBookingTime').innerHTML=`<option value="${escapeAttr(b.time)}">${escapeHtml(b.time)} (current)</option>`;
}
async function loadBookingEditSlots() {
    const state=bookingEditorState;
    if (!state?.original) return;
    const token=++state.slotToken;
    const select=editEl('editBookingTime'), previous=select.value;
    const date=editEl('editBookingDate').value,barber=editEl('editBookingBarber').value,service=editEl('editBookingService').value;
    const same=date===state.original.date && barber===state.original.barber && service===state.original.service;
    editEl('bookingEditSave').disabled=true;
    editEl('bookingEditSlotStatus').textContent='Checking available times…';
    try {
        const data=await bookingEditorPost({action:'editBookingSlots',password:adminPassword,unlockPass:state.pass,id:state.id,date,barber,service});
        if (bookingEditorState!==state || token!==state.slotToken) return;
        if (data.status!=='success') {
            if (data.locked) { editEl('bookingEditPinForm').hidden=false; editEl('bookingEditForm').hidden=true; editEl('bookingEditPin').focus(); }
            throw new Error(data.message || 'Could not load times.');
        }
        // The original off-grid/leave-conflicting time can be kept for contact
        // corrections. Any changed schedule is checked again by the server.
        const all=[...new Set([...(same?[state.original.time]:[]),...(data.slots || [])])];
        select.innerHTML='<option value="">Choose a time</option>'+all.map(t=>{
            const saved=same && t===state.original.time;
            const unavailable=!saved && (data.unavailable || []).includes(t);
            return `<option value="${escapeAttr(t)}" ${unavailable?'disabled':''}>${escapeHtml(t)}${saved?' (current)':unavailable?' — booked/unavailable':''}</option>`;
        }).join('');
        const keep=all.includes(previous) && (same && previous===state.original.time || !(data.unavailable || []).includes(previous));
        select.value=keep?previous:same?state.original.time:'';
        editEl('bookingEditSlotStatus').textContent=same?'Your current time can be kept.':'Choose an available time. The original booking stays until you save.';
        editEl('bookingEditSave').disabled=false;
    } catch(e) { if (bookingEditorState===state && token===state.slotToken) editEl('bookingEditSlotStatus').textContent=e.message || 'Could not check times. Change the date to retry.'; }
}
async function saveBookingEditor(event) {
    event.preventDefault(); const state=bookingEditorState;
    if (!state || state.busy || editEl('bookingEditSave').disabled) return;
    state.busy=true; editError('');
    const button=editEl('bookingEditSave'); button.disabled=true; button.textContent='Saving…';
    const payload={action:'updateBooking',password:adminPassword,unlockPass:state.pass,id:state.id,version:state.original.version,
        phoneCountry:editEl('editBookingCountry').value,notifyCustomer:editEl('editBookingNotify').checked};
    for (const key of ['Name','Barber','Service','Date','Time','Phone','Email']) payload[key.toLowerCase()]=editEl('editBooking'+key).value;
    const controls=[...editEl('bookingEditForm').querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);
    controls.forEach(([el])=>{el.disabled=true;});
    try {
        const answer=await bookingEditorPost(payload);
        if (answer.status!=='success') {
            if (answer.locked) { editEl('bookingEditPinForm').hidden=false; editEl('bookingEditForm').hidden=true; editEl('bookingEditPin').focus(); }
            throw new Error(answer.message || 'Could not save changes.');
        }
        state.busy=false; closeBookingEditor();
        showToast(answer.unchanged?'No changes to save.':payload.notifyCustomer&&!answer.emailed?'Booking saved; no email was sent.':'Booking updated','success');
        await fetchLiveBookings();
    } catch(e) { editError(e.message || 'Connection lost. Reopen the booking to check whether it saved before trying again.'); }
    finally { controls.forEach(([el,disabled])=>{el.disabled=disabled;}); state.busy=false; button.disabled=false; button.textContent='Save changes'; }
}
// Match Management's masked text field: password managers must not replace
// the owner PIN with the panel password merely because this is a form.
['focus','pointerdown','touchstart','click','keydown'].forEach(event => {
    editEl('bookingEditPin').addEventListener(event, () => editEl('bookingEditPin').removeAttribute('readonly'));
});
editEl('bookingEditModal').addEventListener('keydown',event=>{
    if (event.key==='Escape') { event.preventDefault(); closeBookingEditor(); }
    if (event.key==='Tab') {
        const controls=[...editEl('bookingEditModal').querySelectorAll('button,input,select')].filter(e=>!e.disabled && e.getClientRects().length);
        const first=controls[0],last=controls[controls.length-1];
        if (event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
        else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
    }
});

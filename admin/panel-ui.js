// One visual language for the panel. Page navigation stays separate from save:
// gallery/hours already persist each change, whereas dialog/text drafts need
// their existing explicit save. Never suggest that Back undoes a saved change.
(() => {
    const hints = {bookings:'Appointments',week:'Weekly diary',services:'Open a service to edit',
        hours:'Changes save automatically',gallery:'Changes save automatically',
        cms:'Save changes when finished',barbers:'Open a barber to edit',reports:'Shop reports'};
    for (const page of document.querySelectorAll('.page-section')) {
        const key=page.id.replace('page-','');
        const nav=document.createElement('div');nav.className='panel-page-nav';
        const back=document.createElement(key==='bookings'?'a':'button');
        back.className='btn btn-secondary panel-back';
        back.textContent='← Back';
        if(key==='bookings') {back.href='/';back.setAttribute('aria-label','Back to website');}
        else {back.type='button';back.setAttribute('aria-label','Back to bookings');back.addEventListener('click',()=>navigateTo('bookings'));}
        const status=document.createElement('span');status.className='panel-save-status';
        status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent=hints[key] || '';
        nav.append(back,status);page.prepend(nav);
    }
})();

// A failed save must stay visibly failed; restore exactly the disabled states
// we found, including controls disabled by their own booking validation.
function beginPanelSave() {
    // The overlay, rather than the dialog itself, owns the active class.
    // Safari may leave focus on body after a tap, so also find the open dialog.
    const scope=document.activeElement?.closest('.modal-overlay.active:not([inert]) .modal') ||
        document.querySelector('.modal-overlay.active:not([inert]) .modal') || document.querySelector('.page-section.active');
    if(!scope) return ()=>{};
    let status=scope.querySelector('.panel-save-status');
    if(!status) {
        status=document.createElement('p');status.className='panel-save-status panel-modal-status';
        status.setAttribute('role','status');status.setAttribute('aria-live','polite');
        const footer=scope.querySelector('.modal-footer');
        if(footer) footer.before(status);else scope.append(status);
    }
    status.textContent='Saving…';status.dataset.state='saving';scope.setAttribute('aria-busy','true');
    const controls=[...scope.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);
    controls.forEach(([el])=>{el.disabled=true;});
    return saved=>{
        controls.forEach(([el,disabled])=>{el.disabled=disabled;});scope.removeAttribute('aria-busy');
        status.textContent=saved?'Saved':'Not saved — check the message and try again';
        status.dataset.state=saved?'saved':'error';
    };
}

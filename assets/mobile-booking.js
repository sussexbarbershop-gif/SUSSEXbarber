/* Phone sheets reuse the live controls instead of copying their HTML/listeners.
 * Copying would split selection and let stale availability survive a date edit.
 * Keep every scheduling rule in the existing calendar/time rendering code. */
(function () {
    const get = id => document.getElementById(id);
    const mobile = window.matchMedia('(max-width:639px)');
    const sheet = get('bookingPickerSheet');
    const content = get('bookingPickerContent');
    const dateButton = get('datePickerBtn');
    const timeButton = get('timePickerBtn');
    let active = null;
    let previousInert = [];

    function sync() {
        const date = get('date').value;
        const time = get('time').value;
        const nl = window.currentLang === 'nl';
        const dateLabel = date ? new Intl.DateTimeFormat(nl ? 'nl-NL' : 'en-GB', {
            weekday:'short', day:'numeric', month:'short', year:'numeric', timeZone:'UTC'
        }).format(new Date(date + 'T12:00:00Z')) : (nl ? 'Kies een datum' : 'Choose a date');
        get('datePickerLabel').textContent = dateLabel;
        get('timePickerLabel').textContent = time || (date ? (nl ? 'Kies een tijd' : 'Choose a time') : (nl ? 'Kies eerst een datum' : 'Choose a date first'));
        // Keep this enabled after a date is chosen: the sheet must also explain
        // loading, a full day or a failed request, rather than hide that status.
        timeButton.disabled = !date;
        get('bookingPickerClose').setAttribute('aria-label', nl ? 'Sluiten' : 'Close');
        get('bookingPickerTitle').textContent = active === 'time' ? (nl ? 'Kies een tijd' : 'Choose a time') : (nl ? 'Kies een datum' : 'Choose a date');
    }

    function close(restoreFocus = true) {
        if (!active) return;
        const wasDate = active === 'date';
        get(wasDate ? 'datePickerHome' : 'timePickerHome').appendChild(get(wasDate ? 'customCalendar' : 'timePickerContent'));
        active = null;
        previousInert.forEach(([element, value]) => { element.inert = value; });
        previousInert = [];
        window.bookingSheetMotion.hide(sheet);
        sheet.inert = true;
        sync();
        if (restoreFocus) (wasDate ? dateButton : timeButton).focus({preventScroll:true});
    }

    function open(kind) {
        if (!mobile.matches || active || (kind === 'time' && timeButton.disabled)) return;
        active = kind;
        content.appendChild(get(kind === 'date' ? 'customCalendar' : 'timePickerContent'));
        previousInert = Array.from(document.body.children).filter(el => el !== sheet).map(el => [el, el.inert]);
        previousInert.forEach(([el]) => { el.inert = true; });
        sheet.inert = false;
        sync();
        window.bookingSheetMotion.show(sheet);
        get('bookingPickerClose').focus({preventScroll:true});
    }

    dateButton.addEventListener('click', () => open('date'));
    timeButton.addEventListener('click', () => open('time'));
    sheet.addEventListener('click', event => {
        if (event.target.closest('[data-booking-dismiss]')) { close(); return; }
        // Capture before the renderer replaces the clicked button, then finish
        // after its original handler has written the date/time and refreshed slots.
        const picked = event.target.closest('#calendarDaysGrid button, #timeChipsGrid button');
        if (picked && !picked.disabled) queueMicrotask(() => close());
    }, true);
    document.addEventListener('keydown', event => {
        if (!active) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const buttons = Array.from(sheet.querySelectorAll('button:not(:disabled)'));
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }, true);
    // Rotating/resizing must restore desktop's inline calendar and release scroll.
    mobile.addEventListener('change', () => { if (!mobile.matches) close(false); });
    get('date').addEventListener('change', sync);
    get('bookingForm').addEventListener('reset', () => setTimeout(sync, 0));
    new MutationObserver(sync).observe(get('timeChipsGrid'), {childList:true});
    window.syncMobileBooking = sync;
    window.mobileBookingFocus = () => { if (mobile.matches) dateButton.focus({preventScroll:true}); };
    sync();
})();

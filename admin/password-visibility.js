// Revealing a password is temporary: five idle seconds, not five seconds from
// the first click. Input renews the deadline; IME composition must finish first.
// This controller only changes presentation, never the password or auth flow.
(function () {
    const field = document.getElementById('loginPassword');
    const button = document.getElementById('passwordVisibilityBtn');
    if (!field || !button) return;
    const wrapper = field.parentElement;
    let timer;
    let composing = false;

    function hide() {
        clearTimeout(timer);
        field.type = 'password';
        button.setAttribute('aria-label', 'Show password');
        button.setAttribute('aria-pressed', 'false');
    }

    function renew() {
        clearTimeout(timer);
        if (!field.value) return hide();
        if (field.type === 'text' && !composing) timer = setTimeout(hide, 5000);
    }

    button.addEventListener('click', () => {
        if (field.type === 'text') return hide();
        if (!field.value) { field.focus(); return; }
        field.type = 'text';
        button.setAttribute('aria-label', 'Hide password');
        button.setAttribute('aria-pressed', 'true');
        renew();
    });
    field.addEventListener('input', renew);
    field.addEventListener('keydown', event => {
        if (event.key === 'Escape') hide();
        else renew(); // Includes moving the caret while correcting a password.
    });
    field.addEventListener('pointerdown', renew);
    field.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
    field.addEventListener('compositionend', () => { composing = false; renew(); });
    wrapper.addEventListener('focusout', event => {
        if (!wrapper.contains(event.relatedTarget)) hide();
    });
    // Hide even when HTML validation refuses submission or the request fails.
    field.form.addEventListener('submit', hide, true);
    field.form.addEventListener('invalid', hide, true);
    field.form.addEventListener('reset', hide);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
    window.addEventListener('blur', hide);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', hide);
    hide();
})();

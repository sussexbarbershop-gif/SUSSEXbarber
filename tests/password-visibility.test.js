// Run the shipped controller with a deterministic clock, not a copied timer.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../admin/password-visibility.js'), 'utf8');
function target() {
    const events = {};
    return { events, addEventListener(name, fn) { (events[name] ||= []).push(fn); },
        emit(name, event = {}) { for (const fn of events[name] || []) fn(event); },
        setAttribute(name, value) { this[name] = value; } };
}
const field = target(), button = target(), wrapper = target(), form = target();
Object.assign(field, {type:'password', value:'TeSt 123!', parentElement:wrapper, form, focus() {}});
wrapper.contains = e => e === field || e === button;
const document = Object.assign(target(), {hidden:false, getElementById:id => id === 'loginPassword' ? field : button});
const window = target(), timers = new Map();
let now = 0, seq = 0;
vm.runInNewContext(source, {document, window,
    setTimeout(fn, ms) { timers.set(++seq, {fn, at:now + ms}); return seq; },
    clearTimeout(id) { timers.delete(id); }});
function tick(ms) {
    now += ms;
    for (const [id, task] of timers) if (task.at <= now) { timers.delete(id); task.fn(); }
}
function hidden() { assert.equal(field.type, 'password'); assert.equal(button['aria-pressed'], 'false'); assert.equal(button['aria-label'], 'Show password'); }
function shown() { assert.equal(field.type, 'text'); assert.equal(button['aria-pressed'], 'true'); assert.equal(button['aria-label'], 'Hide password'); }
const reveal = () => button.emit('click');
hidden(); reveal(); shown(); tick(4999); shown(); tick(1); hidden();
console.log('PASS reveals and hides at five idle seconds');
reveal(); tick(4000); field.emit('input'); tick(4000); shown(); tick(1000); hidden();
console.log('PASS continued editing renews the deadline');
reveal(); tick(4000); field.emit('keydown', {key:'ArrowLeft'}); tick(4000); shown(); tick(1000); hidden();
reveal(); field.emit('compositionstart'); tick(20000); shown(); field.emit('input'); tick(10000); shown(); field.emit('compositionend'); tick(4999); shown(); tick(1); hidden();
console.log('PASS caret activity and IME composition do not get interrupted');
reveal(); wrapper.emit('focusout', {relatedTarget:button}); shown(); wrapper.emit('focusout', {relatedTarget:field}); shown(); wrapper.emit('focusout', {relatedTarget:null}); hidden();
for (const name of ['submit', 'invalid', 'reset']) { reveal(); form.emit(name); hidden(); }
for (const name of ['blur', 'pagehide', 'pageshow']) { reveal(); window.emit(name); hidden(); }
reveal(); document.hidden = true; document.emit('visibilitychange'); hidden();
reveal(); field.emit('keydown', {key:'Escape'}); hidden();
reveal(); reveal(); hidden();
assert.equal(field.value, 'TeSt 123!');
assert.equal(timers.size, 0);
console.log('PASS leaving, submitting and manual hiding preserve the password and clear timers');
reveal(); field.value = ''; field.emit('input'); hidden(); reveal(); hidden();
console.log('PASS empty passwords remain masked');
const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
assert.match(html, /type="button" id="passwordVisibilityBtn"/);
assert.match(html, /src="\/admin\/password-visibility.js"/);
assert.match(html, /id="loginPassword"[^>]*autocomplete="current-password"/);
console.log('PASS non-submitting eye is wired and preserves password-manager autocomplete');

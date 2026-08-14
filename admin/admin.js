// ===========================
// Sussex Barber Shop — Admin Panel JS
// ===========================

// Same origin as the panel, so the password never crosses to another domain.
// This was an Apps Script Web App over nine Google Sheets until the move to
// Postgres; see MIGRATION.md for what changed and why.
const API_URL = "/api";

// ---- Default Data ----
const DEFAULT_SERVICES = [
    { id: 1, nameEN: 'Classic Haircut', nameNL: 'Klassieke knipbeurt', price: 28, duration: 30 },
    { id: 2, nameEN: 'Skin Fade', nameNL: 'Skin Fade', price: 28, duration: 30 },
    { id: 3, nameEN: 'Scissor Cut', nameNL: 'Knippen met schaar', price: 28, duration: 30 },
    { id: 4, nameEN: 'Wash & Haircut', nameNL: 'Haar wassen & knippen', price: 35, duration: 30 },
    { id: 5, nameEN: 'Beard Trim', nameNL: 'Baard trimmen', price: 20, duration: 30 },
    { id: 6, nameEN: 'Clean Shave', nameNL: 'Glad scheren', price: 20, duration: 30 },
    { id: 7, nameEN: 'Classic Haircut + Beard Trim', nameNL: 'Klassieke knipbeurt + baard trimmen', price: 40, duration: 30 },
    { id: 8, nameEN: 'Skin Fade + Beard Trim', nameNL: 'Skin Fade + baard trimmen', price: 40, duration: 30 },
    { id: 9, nameEN: 'One Grade Trim', nameNL: 'Eén lengte trim (tondeuse)', price: 20, duration: 30 },
    { id: 10, nameEN: 'Kids Haircut (Up to 10 Years)', nameNL: 'Kinderknipbeurt (t/m 10 jaar)', price: 21, duration: 30 },
    { id: 11, nameEN: 'Kids Haircut (Up to 13 Years)', nameNL: 'Kinderknipbeurt (t/m 13 jaar)', price: 23, duration: 30 },
];

// Placeholder only, shown for the instant before the server answers. Kept in
// step with the site's bookable slots so the two never contradict each other.
const DEFAULT_HOURS = [
    { day: 'Monday', dayNL: 'Maandag', open: true, from: '12:00', to: '18:00' },
    { day: 'Tuesday', dayNL: 'Dinsdag', open: true, from: '10:00', to: '18:00' },
    { day: 'Wednesday', dayNL: 'Woensdag', open: true, from: '10:00', to: '18:00' },
    { day: 'Thursday', dayNL: 'Donderdag', open: true, from: '10:00', to: '18:00' },
    { day: 'Friday', dayNL: 'Vrijdag', open: true, from: '10:00', to: '18:00' },
    { day: 'Saturday', dayNL: 'Zaterdag', open: true, from: '10:00', to: '18:00' },
    { day: 'Sunday', dayNL: 'Zondag', open: false, from: '10:00', to: '18:00' },
];

const ADMIN_USERNAME = 'admin';

// The booking form's "no preference" option. It sits in the Barbers sheet so
// the site can offer it, but it is not a person: it has no rota and no leave.
// Must match ANY_BARBER in Code.gs and index.html.
const ANY_BARBER = 'Any Available';

// Small stroke icons, in the site's own style, for the handful of spots that
// used to reach for an emoji (✏️ 🗑 ✓ ✕) instead.
const ICON_EDIT = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
const ICON_DELETE = '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
const ICON_CHECK = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';
const ICON_CROSS = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>';
const ICON_INFO = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

// The password is never stored here. It lives in the deployment's environment
// (Vercel > Settings > Environment Variables > ADMIN_PASSWORD) and is checked
// server-side, so reading this file tells an attacker nothing. It is held in
// memory for the session only, because every write has to be signed with it.
let adminPassword = sessionStorage.getItem('sussex_admin_pw') || '';

/** POST a JSON action and read the reply.
 *
 *  A refusal is returned, not thrown. The server answers a rejected save with
 *  a status and a sentence saying why; throwing on it lost the sentence and
 *  the panel reported "could not reach the server" for a server that had
 *  answered perfectly clearly. Only a request that never got an answer throws.
 */
async function apiPost(payload) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    try {
        return await res.json();
    } catch (err) {
        // Not JSON at all — a gateway page, or nothing. There is no message to
        // pass on, so the status is all the panel can say.
        return { status: 'error', message: `The server answered with ${res.status}` };
    }
}

/** Shrink an image in the browser before it ever leaves the machine.
 *  Gallery photos off a phone are several megabytes; at that size the upload
 *  is slow and storage fills up for no visual benefit on a 400px-wide card. */
function shrinkImage(file, maxEdge = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('That file is not a readable image'));
            img.onload = () => {
                let { width, height } = img;
                if (width > maxEdge || height > maxEdge) {
                    const scale = maxEdge / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

/** Shrink, upload to blob storage, and hand back a URL fit to store. */
async function uploadImage(file) {
    if (!adminPassword) {
        showToast('Session expired — please sign in again', 'error');
        return null;
    }
    showToast('Uploading image...', 'info');
    try {
        const dataUrl = await shrinkImage(file);
        const result = await apiPost(asOwner({
            action: 'uploadImage',
            password: adminPassword,
            filename: file.name,
            dataUrl: dataUrl
        }));
        if (result.status !== 'success' || !result.url) {
            showToast(result.message || 'Upload failed', 'error');
            return null;
        }
        return result.url;
    } catch (err) {
        console.error('Upload failed', err);
        showToast('Could not upload that image', 'error');
        return null;
    }
}

/** Push the current content to the server so customers actually see it. */
async function saveToServer(partial) {
    if (!adminPassword) {
        showToast('Session expired — please sign in again', 'error');
        return false;
    }
    try {
        const result = await apiPost(asOwner(Object.assign({
            action: 'saveCMS',
            password: adminPassword
        }, partial)));

        if (result.status !== 'success') {
            showToast(result.message || 'Server refused the change', 'error');
            // The ten minutes ran out mid-edit. Put the keypad back rather than
            // leaving an open-looking page whose every save is now refused.
            if (result.locked) lockOwnerPages();
            return false;
        }
        return true;
    } catch (err) {
        console.error('Sync failed', err);
        showToast('Could not reach the server — change saved locally only', 'error');
        return false;
    }
}

// ---- State ----
/**
 * Today, in the shop.
 *
 * Not the device's today. The panel worked it out with toISOString(), which is
 * UTC — so at half past midnight in Wassenaar it still said yesterday, and the
 * owner reading the diary from another country got a different answer again.
 * The Today filter was on the wrong day and tomorrow's appointments were
 * marked Past. The server sends the shop's date with the config; until that
 * lands, the device's guess is better than nothing.
 */
let shopToday = new Date().toISOString().split('T')[0];
const today = () => shopToday;

/** `days` before or after the shop's today, as 'YYYY-MM-DD'. */
function shopDayOffset(days) {
    const at = new Date(shopToday + 'T00:00:00Z');
    return new Date(at.getTime() + days * 86400000).toISOString().split('T')[0];
}

let currentPage = 'bookings';
let bookings = [];
let services = [];
let hours = [];
let galleryImages = [];
let barbers = [];
let settings = {};
let visitCount = 0;
let barberHours = {};   // { 'Hemen': [{ day, working, from, to, breakFrom, breakTo }] }
let timeOff = [];       // [{ barber, from, to, note }]
// False until the server has answered once, so pages can say "loading" instead
// of drawing the placeholders as though they were the shop's real data.
let cmsLoaded = false;

// ---- Init ----
async function fetchLiveCMS() {
    try {
        const res = await fetch(API_URL + "?action=getConfig", { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'bad response');

        if (data.settings) {
            settings = data.settings;
            // The visit counter is a row in the settings table.
            visitCount = parseInt(settings.visit_count || '0', 10) || 0;
        }
        if (data.today) shopToday = data.today;
        if (data.barbers && data.barbers.length > 0) barbers = data.barbers;
        if (data.gallery && data.gallery.length > 0) {
            galleryImages = data.gallery.map((g, i) => ({ id: i + 1, src: g, name: 'Img ' + (i + 1) }));
        }
        // Services and hours are read back from the server too, so the panel
        // shows what customers are actually being served.
        if (data.services && data.services.length > 0) services = data.services;
        if (data.hours && data.hours.length > 0) hours = data.hours;
        if (data.barberHours) barberHours = data.barberHours;
        if (data.timeOff) timeOff = data.timeOff;

        cmsLoaded = true;
        saveData();

        // Redraw whatever is open. This was a list of pages to remember to
        // add to, and Website Text was never on it.
        renderPage(currentPage);
    } catch (e) {
        console.error("Failed to fetch live CMS data", e);
        // Let the page draw rather than sit on "Loading…" forever; the retry
        // below is what actually fixes it.
        cmsLoaded = true;
        renderPage(currentPage);
        showToast('Could not load the shop’s details — retrying', 'error');
        setTimeout(fetchLiveCMS, 5000);
    }
}
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkAuth();
    setupNavigation();
    setupSidebar();

    // No form to submit — see the markup for why. The button and the Enter key
    // do what a submit would have.
    const pinButton = document.getElementById('ownerPinSubmit');
    if (pinButton) pinButton.addEventListener('click', submitOwnerPin);

    const pinField = document.getElementById('ownerPin');
    if (pinField) {
        pinField.addEventListener('keydown', e => {
            if (e.key === 'Enter') submitOwnerPin(e);
        });
        // It ships readonly so nothing fills it before anyone has asked for
        // it. Every way a person can reach the box clears that — focus alone
        // is the usual trick and is not enough: it does not fire in a window
        // that has not been given focus yet, and a box that will not take a
        // PIN is worse than a box a password manager fills.
        ['focus', 'pointerdown', 'touchstart', 'click', 'keydown'].forEach(event => {
            pinField.addEventListener(event, () => pinField.removeAttribute('readonly'));
        });
    }

    // The pass runs out on its own. Without this the page it unlocked stays on
    // screen until something else redraws it, and the first save after ten
    // minutes is refused with no warning that the lock had come back.
    setInterval(() => {
        if (OWNER_PAGES.includes(currentPage) && !isUnlocked()) {
            const gate = document.getElementById('ownerGate');
            if (gate && gate.style.display === 'none') lockOwnerPages();
        }
    }, 20000);

    // Ask for both straight away; the 500ms wait only delayed the first paint.
    fetchLiveCMS();
    fetchLiveBookings();

    // Refresh bookings in the background. This polled every 10 seconds, but a
    // backend that took closer to ten to answer, so the calls piled up and
    // competed with whatever the owner was actually doing. fetchLiveBookings()
    // now refuses to overlap itself, and a hidden tab is not worth polling.
    setInterval(() => {
        if (!document.hidden) fetchLiveBookings();
    }, 30000);

    // Coming back to the tab should show the current diary immediately.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) fetchLiveBookings();
    });
});

// ---- Auth ----
function checkAuth() {
    const isLoggedIn = sessionStorage.getItem('sussex_admin_auth');
    if (isLoggedIn === 'true') {
        showAdmin();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginWrapper').style.display = 'flex';
    document.getElementById('adminLayout').classList.remove('active');
}

/** The page named in the address bar, if it is one we have. */
function pageFromHash() {
    const wanted = String(location.hash || '').replace(/^#\/?/, '').trim();
    if (!wanted) return '';
    const known = document.querySelector(`.nav-item[data-page="${CSS.escape(wanted)}"]`);
    return known ? wanted : '';
}

function showAdmin() {
    document.getElementById('loginWrapper').style.display = 'none';
    document.getElementById('adminLayout').classList.add('active');
    // Whatever page they were on, not the one the panel opens with. Editing a
    // barber's rota on a phone and pulling to refresh threw the page away and
    // put them back at Today, which on a phone is several taps from where they
    // were and gives no clue that anything was kept.
    navigateTo(pageFromHash() || 'bookings');
    // The diary needs the password, so it can only be asked for once we have
    // one. On a fresh sign-in that is now, not at page load.
    fetchLiveBookings();
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const fail = (message) => {
        errorEl.style.display = 'block';
        errorEl.textContent = message;
        document.getElementById('loginPassword').value = '';
    };

    if (username !== ADMIN_USERNAME) { fail('Invalid username or password'); return; }

    const originalLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.textContent = 'Signing in...'; submitBtn.disabled = true; }

    try {
        // Verified by the server, not here.
        const result = await apiPost({ action: 'adminLogin', password: password });

        if (result.status === 'success') {
            adminPassword = password;
            sessionStorage.setItem('sussex_admin_auth', 'true');
            sessionStorage.setItem('sussex_admin_pw', password);
            errorEl.style.display = 'none';
            showAdmin();
            showToast('Welcome back, Admin!', 'success');
        } else {
            fail(result.message || 'Invalid username or password');
        }
    } catch (err) {
        console.error('Login failed', err);
        fail('Could not reach the server. Check your connection and try again.');
    } finally {
        if (submitBtn) { submitBtn.textContent = originalLabel; submitBtn.disabled = false; }
    }
}

function handleLogout() {
    adminPassword = '';
    // The takings go with the session. Signing out and handing the phone over
    // must not leave them one tap away.
    lockOwnerPages();
    sessionStorage.removeItem('sussex_admin_auth');
    sessionStorage.removeItem('sussex_admin_pw');
    showLogin();
}

// ---- Data Management ----
function loadData() {
    // Placeholders only. fetchLiveCMS() and fetchLiveBookings() replace all of
    // these with the server's answer a moment after load; nothing about the
    // shop is persisted on this device.
    services = [...DEFAULT_SERVICES];
    hours = [...DEFAULT_HOURS];
    bookings = [];
    galleryImages = getDefaultGallery();
    visitCount = 0;
    // Do NOT increment visit counter here — only the main site should track visits
}

/** Kept as a no-op seam. The panel calls this from several places after
 *  mutating its in-memory state; persistence is the server's job, done by the
 *  saveToServer() calls below. It was missing entirely before, which made
 *  fetchLiveCMS() and all the barber editing throw. */
function saveData() {
    /* nothing is stored locally */
}

async function saveServices() {
    if (await saveToServer({ services: services })) {
        showToast('Services updated — customers see this now', 'success');
    }
}

async function saveHours() {
    if (await saveToServer({ hours: hours })) {
        showToast('Working hours updated — customers see this now', 'success');
    }
}

function saveBookings() {
    // Bookings are owned by the database; fetchLiveBookings() refreshes them.
}

async function saveGallery() {
    // The gallery stores plain URLs, not the panel's {id, src, name} shape.
    if (await saveToServer({ gallery: galleryImages.map(g => g.src) })) {
        showToast('Gallery updated — customers see this now', 'success');
    }
}

// Barbers are saved from the dialog on Our Barbers, which writes the rota and
// time off in the same call; a barbers-only save would leave those behind.

function getDefaultGallery() {
    return [
        { id: 1, src: '../assets/IMG_8582.PNG', name: 'Gallery 1' },
        { id: 2, src: '../assets/IMG_8577.JPEG', name: 'Gallery 2' },
        { id: 3, src: '../assets/IMG_8575.JPEG', name: 'Gallery 3' },
        { id: 4, src: '../assets/IMG_8572.JPEG', name: 'Gallery 4' },
        { id: 5, src: '../assets/IMG_8567.JPEG', name: 'Gallery 5' },
        { id: 6, src: '../assets/IMG_8569.JPEG', name: 'Gallery 6' },
    ];
}

// ---- Navigation ----
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => {
            navigateTo(item.dataset.page);
            closeSidebar();
        });
    });

    // The phone's back button, and anything else that moves through history.
    window.addEventListener('popstate', () => {
        const page = pageFromHash();
        if (page && page !== currentPage) navigateTo(page);
    });
}

function navigateTo(page) {
    currentPage = page;

    // In the address bar, so a refresh comes back here and the phone's back
    // button walks the pages rather than leaving the panel. replaceState on
    // the first page of a session so the history does not start with an entry
    // nobody navigated to.
    const target = '#' + page;
    if (location.hash !== target) {
        if (location.hash) history.pushState(null, '', target);
        else history.replaceState(null, '', target);
    }

    // Update nav
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });

    // Update page
    document.querySelectorAll('.page-section').forEach(el => {
        el.classList.toggle('active', el.id === `page-${page}`);
    });

    // Update topbar title
    const titles = {
        bookings: 'Bookings',
        week: 'Week',
        services: 'Services & Pricing',
        hours: 'Working Hours',
        gallery: 'Gallery',
        cms: 'Website Text',
        barbers: 'Our Barbers',        reports: 'Reports'
    };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    // The keypad goes up before the page draws, so a locked page is never
    // painted and then covered.
    renderOwnerGate(page);
    renderPage(page);
}

function renderPage(page) {
    switch (page) {
        case 'bookings': renderBookings(); break;
        case 'week': renderWeek(); break;
        case 'services': renderServices(); break;
        case 'hours': renderHours(); break;
        case 'gallery': renderGallery(); break;
        // Missing, so Our Barbers only ever painted when the config happened to
        // arrive while the page was already open. That took seconds before the
        // backend was sped up, which is why it looked like it worked.
        case 'barbers': renderBarbers(); break;
        case 'cms': renderCms(); break;
        case 'reports': renderReports(); break;
    }
}

// ---- Sidebar Mobile ----
function setupSidebar() {
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
}

function closeSidebar() {
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// ---- Bookings ----
let bookingFilter = 'all';

// Which barber's work is being looked at, or '' for everyone's. Remembered on
// this device: a barber picks their name once and the panel opens on their own
// day from then on, which is the whole point of it.
const NO_PREFERENCE = '__any__';
let barberFilter = localStorage.getItem('sussex_admin_barber') || '';

/** The names to offer, in the order the booking form offers them. */
function barberFilterNames() {
    return (barbers || [])
        .map(b => String(b.name || '').trim())
        .filter(name => name && name !== ANY_BARBER);
}

/**
 * Fill both dropdowns and keep them saying the same thing.
 *
 * One choice, two pages: switching to the week after narrowing the list to
 * your own name and finding the whole shop's week there again is the kind of
 * thing that gets a filter ignored.
 */
function renderBarberFilters() {
    const names = barberFilterNames();
    // A name that has since been removed from the panel would otherwise leave
    // the select showing nothing while quietly filtering everything out.
    // Cleared here rather than through setBarberFilter(), which would call
    // back into this and the renders that call it.
    if (barberFilter && barberFilter !== NO_PREFERENCE && !names.includes(barberFilter)) {
        barberFilter = '';
        localStorage.removeItem('sussex_admin_barber');
    }

    const options = [
        `<option value="">All barbers</option>`,
        ...names.map(name =>
            `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`),
        `<option value="${NO_PREFERENCE}">No preference</option>`
    ].join('');

    ['bookingsBarberFilter', 'weekBarberFilter'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = options;
        select.value = barberFilter;
        select.onchange = () => setBarberFilter(select.value);
    });
}

function setBarberFilter(name) {
    barberFilter = name || '';
    if (barberFilter) localStorage.setItem('sussex_admin_barber', barberFilter);
    else localStorage.removeItem('sussex_admin_barber');
    renderBarberFilters();
    renderBookings();
    renderWeeklyPlannerGrid();
    // The count in the sidebar follows the filter too, or a barber looking at
    // their own day is told the whole shop's number beside it.
    updateUpcomingBadge();
}

/** The chosen barber's appointments, or everyone's. */
function forChosenBarber(list) {
    if (!barberFilter) return list;
    if (barberFilter === NO_PREFERENCE) {
        // Nobody was asked for, so nobody's name is on it — these are the ones
        // whoever is free picks up.
        return list.filter(b => !b.barberName || b.barberName === 'Any' ||
                                b.barberName === ANY_BARBER);
    }
    return list.filter(b => b.barberName === barberFilter);
}

/**
 * When a booking arrived, in the words someone actually uses.
 *
 * The list is ordered by this, so it has to be readable at a glance: "20m ago"
 * says new, "2026-08-13 01:00" makes you work it out. The exact moment is on
 * the cell's tooltip for when it matters.
 */
function bookedAgo(iso) {
    if (!iso) return '—';
    const at = new Date(iso);
    if (isNaN(at.getTime())) return '—';

    const seconds = Math.round((Date.now() - at.getTime()) / 1000);
    if (seconds < 0) return 'just now';        // a clock slightly ahead of ours
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    // Past a week "37 days ago" stops meaning anything; the date is clearer.
    return at.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/** The whole moment, for the tooltip and the exported file. */
function bookedAtFull(iso) {
    if (!iso) return '';
    const at = new Date(iso);
    if (isNaN(at.getTime())) return '';
    return at.toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

/** "Hemen · 4 appointments" — never a total anyone could add money to. */
function listCaption(count, noun) {
    const who = !barberFilter ? 'Everyone'
              : barberFilter === NO_PREFERENCE ? 'No preference'
              : barberFilter;
    return `${who} · ${count} ${count === 1 ? noun : noun + 's'}`;
}

/**
 * The appointments the Bookings page is showing: the chosen barber's, narrowed
 * to the chosen period, newest arrival first.
 *
 * Shared with the CSV export, which used to send every booking in the diary
 * however the page was filtered — so a barber who had narrowed the list to
 * their own week exported the whole shop's year.
 */
function visibleBookings() {
    let filtered = forChosenBarber(bookings);

    const day = today();
    const weekAgo = shopDayOffset(-7);

    if (bookingFilter === 'today') {
        filtered = filtered.filter(b => b.date === day);
    } else if (bookingFilter === 'week') {
        filtered = filtered.filter(b => b.date >= weekAgo);
    } else if (bookingFilter === 'upcoming') {
        filtered = filtered.filter(b => b.date >= day);
    }

    // Newest arrival first — the booking that came in last is the one nobody
    // has seen yet. Sorting by the appointment date instead put next month's
    // diary above a booking made five minutes ago.
    return [...filtered].sort((a, b) => {
        const arrived = String(b.bookedAt || '').localeCompare(String(a.bookedAt || ''));
        if (arrived !== 0) return arrived;
        // Older rows predate created_at being sent; fall back to the
        // appointment so their order is at least stable.
        return String(b.date + b.time).localeCompare(String(a.date + a.time));
    });
}

function renderBookings() {
    // The dropdown is filled from the config, which can arrive after this page
    // is first drawn — and did, whenever the diary failed to load: the barber
    // list came down with the config and the select stayed empty.
    renderBarberFilters();

    const day = today();
    const filtered = visibleBookings();

    const caption = document.getElementById('bookingsCaption');
    if (caption) caption.textContent = listCaption(filtered.length, 'appointment');

    // Which tab is lit, before anything can return early. This ran at the foot
    // of the function, after a `return` taken whenever the filter matched
    // nothing — so tapping Today on a quiet day left the highlight on the tab
    // you had come from, and the button looked broken rather than empty.
    document.querySelectorAll('#bookingFilters .filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === bookingFilter);
    });

    const tbody = document.getElementById('bookingsBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty">Nothing here</td></tr>`;
        return;
    }

    // The fields are customerName/customerPhone/serviceName/barberName — this
    // read b.name, b.phone, b.service and b.barber, so every one of those four
    // columns rendered blank.
    tbody.innerHTML = filtered.map(b => `
        <tr>
            <td class="cell-strong">${escapeHtml(b.customerName)}</td>
            <td>${b.customerPhone
                    ? `<a class="cell-link" href="tel:${encodeURIComponent(b.customerPhone)}">${escapeHtml(b.customerPhone)}</a>`
                    : '—'}</td>
            <td>${escapeHtml(b.serviceName)}</td>
            <td>${escapeHtml(b.barberName || 'Any')}</td>
            <td>${escapeHtml(b.date)}</td>
            <td>${escapeHtml(b.time)}</td>
            <td class="cell-muted cell-nowrap" title="${escapeAttr(bookedAtFull(b.bookedAt))}">${escapeHtml(bookedAgo(b.bookedAt))}${
                // Only the ones we took ourselves are marked. Marking both
                // would put a label on every row in the table, which is the
                // same as marking none.
                b.source === 'shop' ? ' <span class="cell-muted" title="Taken by the shop, not booked on the website">· by phone</span>' : ''}</td>
            <td>${b.date < day
                    ? '<span class="cell-muted">Past</span>'
                    : '<span class="status-badge confirmed">● Booked</span>' +
                      // Whether the morning reminder can reach them. Only the
                      // absence is marked: a note on every row that does have
                      // an address would be a note on most of the table.
                      (b.hasEmail ? '' : '<span class="cell-muted cell-nowrap" title="No email address, so no reminder can be sent"> no reminder</span>')}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="cancelBookingById('${escapeAttr(b.id)}')" title="Cancel this booking">Cancel</button>
            </td>
        </tr>
    `).join('');
}

// ---- A booking taken over the phone ---------------------------------------
//
// The panel had no way to write one down. Half the shop's bookings arrive by
// phone or through the door, and they were going into a paper diary the
// website could not see — so the site offered slots that were already gone,
// and the takings on the Reports page were the online half of the shop.
//
// Nothing here decides anything. It collects the same six answers the booking
// form collects and posts them; every rule — who is on the floor, whether the
// chair is free, what the service costs, who gets a booking that named nobody
// — is applied by the server, by the same code the website goes through. The
// only thing this file knows about availability is what the server told it.

let shopBookingTime = '';
let shopBookingTimesToken = 0;

function openShopBookingModal() {
    const modal = document.getElementById('shopBookingModal');
    if (!modal) return;
    document.getElementById('shopBookingForm').reset();
    shopBookingTime = '';

    // The services the shop actually sells, priced by the server when the row
    // is written. No price is shown: everyone who signs in shares this
    // password, and what the shop charges is on Reports behind the PIN.
    const service = document.getElementById('shopBookService');
    service.innerHTML = services.map(s =>
        `<option value="${escapeAttr(s.nameEN)}">${escapeHtml(s.nameEN)}</option>`).join('');

    // "Any Available" first and chosen, as on the website. It is the common
    // answer — most people ringing up want a haircut, not a particular pair of
    // hands — and it is the one the shop's own order was written for.
    const barber = document.getElementById('shopBookBarber');
    barber.innerHTML = [`<option value="${escapeAttr(ANY_BARBER)}">${escapeHtml(ANY_BARBER)}</option>`]
        .concat(barbers.filter(b => b.name !== ANY_BARBER)
            .map(b => `<option value="${escapeAttr(b.name)}">${escapeHtml(b.name)}</option>`))
        .join('');

    // Today, because the call is nearly always about today or tomorrow. The
    // shop's date, not the device's — a phone half an hour into tomorrow would
    // otherwise open on a day the shop has not reached.
    const date = document.getElementById('shopBookDate');
    date.value = today();
    date.min = today();

    modal.classList.add('active');
    loadShopBookingTimes();
    // Not the date field: it is already filled in. The first thing actually
    // being asked is which service.
    setTimeout(() => document.getElementById('shopBookService').focus(), 50);
}

function closeShopBookingModal() {
    document.getElementById('shopBookingModal').classList.remove('active');
    // Anything still in flight is for a dialog nobody is looking at.
    shopBookingTimesToken++;
}

function setShopBookingStatus(text) {
    const status = document.getElementById('shopBookTimeStatus');
    if (status) status.textContent = text;
}

/**
 * The times for the chosen date and barber, from the server.
 *
 * `past=1`, so this morning's slots are still offered — the shop is allowed to
 * write down an appointment that has already started, and the website's
 * fifteen-minute notice is for a stranger filling in a form, not for somebody
 * standing at the counter.
 *
 * The token is a guard against the answers arriving out of order: change the
 * date twice quickly and the first request can land last, painting the grid
 * for a day nobody is looking at any more.
 */
async function loadShopBookingTimes() {
    const grid = document.getElementById('shopBookTimes');
    if (!grid) return;
    const date = document.getElementById('shopBookDate').value;
    const barber = document.getElementById('shopBookBarber').value || ANY_BARBER;

    shopBookingTime = '';
    grid.innerHTML = '';
    if (!date) return setShopBookingStatus('Choose a date first.');

    const mine = ++shopBookingTimesToken;
    setShopBookingStatus('Loading times…');

    let all = [];
    let unavailable = [];
    try {
        const url = `${API_URL}?date=${encodeURIComponent(date)}` +
                    `&barber=${encodeURIComponent(barber === ANY_BARBER ? '' : barber)}` +
                    `&slots=1&past=1`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        all = Array.isArray(data && data.slots) ? data.slots : [];
        unavailable = Array.isArray(data && data.unavailable) ? data.unavailable : [];
    } catch (err) {
        if (mine !== shopBookingTimesToken) return;
        // Left empty rather than guessed at. A grid drawn from a failed
        // request would show every slot free, and the first thing the shop
        // would know about it is the server refusing the booking.
        return setShopBookingStatus('Could not reach the server. Try again.');
    }
    if (mine !== shopBookingTimesToken) return;

    if (all.length === 0) {
        return setShopBookingStatus(barber === ANY_BARBER
            ? 'The shop is closed that day.'
            : `${barber} does not work that day.`);
    }

    grid.innerHTML = all.map(t => {
        const taken = unavailable.indexOf(t) !== -1;
        return `<button type="button" class="slot-chip" ${taken ? 'disabled' : ''}
                        aria-pressed="false"
                        aria-label="${escapeAttr(t)} — ${taken ? 'already booked' : 'available'}"
                        onclick="chooseShopBookingTime(this, '${escapeAttr(t)}')">
                    <span class="slot-chip-time">${escapeHtml(t)}</span>
                    ${taken ? '<span class="slot-chip-note">Booked</span>' : ''}
                </button>`;
    }).join('');

    const free = all.length - all.filter(t => unavailable.indexOf(t) !== -1).length;
    setShopBookingStatus(free === 0
        ? 'Every time that day is taken.'
        : `${free} of ${all.length} times free. Pick one.`);
}

function chooseShopBookingTime(button, label) {
    document.querySelectorAll('#shopBookTimes .slot-chip').forEach(chip => {
        chip.classList.remove('selected');
        chip.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('selected');
    button.setAttribute('aria-pressed', 'true');
    shopBookingTime = label;
    setShopBookingStatus(`${label} chosen.`);
}

async function submitShopBooking(e) {
    e.preventDefault();
    if (!adminPassword) return showToast('Session expired — please sign in again', 'error');
    if (!shopBookingTime) {
        setShopBookingStatus('Choose a time before adding this to the diary.');
        return showToast('Choose a time', 'error');
    }

    const submit = document.getElementById('shopBookSubmit');
    // Two taps on a slow connection is two bookings, and the second one would
    // be refused by the index — but only after both had been sent.
    submit.disabled = true;
    submit.textContent = 'Adding…';

    try {
        const answer = await apiPost({
            action: 'addBookingByShop',
            password: adminPassword,
            date: document.getElementById('shopBookDate').value,
            time: shopBookingTime,
            barber: document.getElementById('shopBookBarber').value,
            service: document.getElementById('shopBookService').value,
            name: document.getElementById('shopBookName').value.trim(),
            phone: document.getElementById('shopBookPhone').value.trim(),
            email: document.getElementById('shopBookEmail').value.trim()
        });

        if (!answer || answer.status !== 'success') {
            const why = (answer && answer.message) || 'Could not add that booking';
            setShopBookingStatus(why);
            showToast(why, 'error');
            // The grid is redrawn: the usual reason a booking is refused is
            // that the chair went while the call was going on, and the times
            // on screen are now a picture of a minute ago.
            loadShopBookingTimes();
            return;
        }

        // Who it actually landed with. "Any Available" is a question, and the
        // server's answer to it is the thing the shop needs to say out loud to
        // the customer still on the phone.
        closeShopBookingModal();
        showToast(`Booked with ${answer.barber || 'the shop'}`, 'success');
        await fetchLiveBookings();
    } catch (err) {
        console.error('Could not add the booking', err);
        showToast('Could not reach the server', 'error');
    } finally {
        submit.disabled = false;
        submit.textContent = 'Add to diary';
    }
}

function setBookingFilter(filter) {
    bookingFilter = filter;
    renderBookings();
}

// updateBookingStatus() and deleteBooking() lived here. A booking has no
// pending state — one arrives booked — so the confirm and reject buttons
// never appeared, and both only edited the local array while the server kept
// the row, so a "deleted" booking came back on the next refresh. Cancelling
// goes through cancelBookingById(), which tells the server.

// ---- Services ----
function renderServices() {
    const container = document.getElementById('servicesContainer');
    if (!container) return;

    container.innerHTML = services.map(s => `
        <div class="edit-card">
            <div class="card-info">
                <div class="card-title">${escapeHtml(s.nameEN)}</div>
                <div class="card-sub">${escapeHtml(s.nameNL)} · ${s.duration} min</div>
            </div>
            <div class="card-price">€${s.price}</div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="editService(${s.id})" aria-label="Edit">${ICON_EDIT}</button>
                <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id})" aria-label="Delete">${ICON_DELETE}</button>
            </div>
        </div>
    `).join('');
}

function openServiceModal(service = null) {
    const modal = document.getElementById('serviceModal');
    const title = document.getElementById('serviceModalTitle');
    const form = document.getElementById('serviceForm');

    if (service) {
        title.textContent = 'Edit Service';
        document.getElementById('svcId').value = service.id;
        document.getElementById('svcNameEN').value = service.nameEN;
        document.getElementById('svcNameNL').value = service.nameNL;
        document.getElementById('svcPrice').value = service.price;
        document.getElementById('svcDuration').value = service.duration;
    } else {
        title.textContent = 'Add New Service';
        form.reset();
        document.getElementById('svcId').value = '';
    }

    modal.classList.add('active');
}

function closeServiceModal() {
    document.getElementById('serviceModal').classList.remove('active');
}

function handleServiceSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('svcId').value;
    const data = {
        nameEN: document.getElementById('svcNameEN').value.trim(),
        nameNL: document.getElementById('svcNameNL').value.trim(),
        price: parseFloat(document.getElementById('svcPrice').value),
        duration: parseInt(document.getElementById('svcDuration').value),
    };

    if (id) {
        // Edit existing
        const idx = services.findIndex(s => s.id === parseInt(id));
        if (idx !== -1) {
            services[idx] = { ...services[idx], ...data };
        }
    } else {
        // Add new
        data.id = services.length > 0 ? Math.max(...services.map(s => s.id)) + 1 : 1;
        services.push(data);
    }

    saveServices();
    closeServiceModal();
    renderServices();
}

function editService(id) {
    const service = services.find(s => s.id === id);
    if (service) openServiceModal(service);
}

function deleteService(id) {
    if (confirm('Are you sure you want to delete this service?')) {
        services = services.filter(s => s.id !== id);
        saveServices();
        renderServices();
    }
}

// ---- Working Hours ----
function renderHours() {
    const container = document.getElementById('hoursContainer');
    if (!container) return;

    container.innerHTML = hours.map((h, i) => `
        <div class="hours-row">
            <span class="day-name">${h.day}</span>
            <div class="time-inputs">
                ${h.open ? `
                    <input type="time" value="${h.from}" onchange="updateHour(${i}, 'from', this.value)">
                    <span style="color:var(--text-muted)">—</span>
                    <input type="time" value="${h.to}" onchange="updateHour(${i}, 'to', this.value)">
                ` : '<span class="day-closed">Closed</span>'}
            </div>
            <label class="toggle-switch">
                <input type="checkbox" ${h.open ? 'checked' : ''} onchange="toggleDay(${i}, this.checked)">
                <span class="toggle-slider"></span>
            </label>
        </div>
    `).join('');
}

function updateHour(index, field, value) {
    hours[index][field] = value;
    // Clearing a box on an open day would save a day that is open with no
    // hours, which the database refuses — and refuses the whole save with it,
    // so the other six days are lost too. Put the last good value back.
    if (hours[index].open && !value) {
        hours[index][field] = field === 'from' ? DEFAULT_OPEN_FROM : DEFAULT_OPEN_TO;
        renderHours();
        showToast('An open day needs an opening and a closing time', 'error');
        return;
    }
    saveHours();
}

// What a day that has never had hours is opened with. The shop's usual day,
// so the common case is one toggle and nothing else.
const DEFAULT_OPEN_FROM = '10:00';
const DEFAULT_OPEN_TO = '18:00';

function toggleDay(index, isOpen) {
    const day = hours[index];
    day.open = isOpen;
    // A day that has been shut since before the panel existed carries no hours
    // at all, and switching it on used to send exactly that. The save was
    // refused, the toggle stayed on screen looking saved, and the reason was a
    // line in a log. Opening a day now always opens it at some hour.
    if (isOpen) {
        if (!day.from) day.from = DEFAULT_OPEN_FROM;
        if (!day.to) day.to = DEFAULT_OPEN_TO;
    }
    saveHours();
    renderHours();
}

// ---- Website Text ----
// The five boxes on the Website Text page and the Settings rows they write.
// The page had the boxes and a "Save to Website" button, but nothing ever
// filled them in and saveCMSData() did not exist, so the owner could type into
// them and lose it on the next click.
const CMS_FIELDS = {
    cms_hero_title: 'hero_title',
    cms_hero_subtitle: 'hero_subtitle',
    cms_about_text: 'about_text',
    cms_contact_phone: 'contact_phone',
    cms_contact_address: 'contact_address',
    cms_instagram_url: 'instagram_url',
    cms_maps_url: 'maps_url',
    cms_maps_embed_url: 'maps_embed_url',
    // Not read by the website — the daily job reads it. It lives here because
    // this is the page that saves settings, and a setting the panel does not
    // send is a setting the next complete save deletes.
    cms_review_url: 'review_url'
};

function renderCms() {
    Object.keys(CMS_FIELDS).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = settings[CMS_FIELDS[id]] || '';
    });
}

async function saveCMSData() {
    const next = Object.assign({}, settings);
    Object.keys(CMS_FIELDS).forEach(id => {
        const el = document.getElementById(id);
        if (el) next[CMS_FIELDS[id]] = el.value;
    });

    // saveCMS rewrites the settings from what it is sent, so the
    // visit counter has to travel with it or it resets to zero.
    if (settings.visit_count !== undefined) next.visit_count = settings.visit_count;

    if (await saveToServer({ settings: next })) {
        settings = next;
        showToast('Website text updated — customers see this now', 'success');
    }
}

// ---- Barber Schedules ----
// The shop hours above say when the door is open; these say who is behind the
// chair. A slot is only offered when both agree. Editing lives in the barber
// dialog on the Our Barbers page.

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** A barber with no saved rota reads as off all week, not as a blank page. */
function rotaFor(name) {
    if (!Array.isArray(barberHours[name])) {
        barberHours[name] = WEEK.map(day => ({
            day, working: false, from: '10:00', to: '18:00',
            breakFrom: '13:30', breakTo: '14:00'
        }));
    }
    // Days can be missing if the sheet was edited by hand; fill the gaps.
    WEEK.forEach(day => {
        if (!barberHours[name].some(r => r.day === day)) {
            barberHours[name].push({
                day, working: false, from: '10:00', to: '18:00',
                breakFrom: '13:30', breakTo: '14:00'
            });
        }
    });
    return WEEK.map(day => barberHours[name].find(r => r.day === day));
}


// ---- Gallery ----
function renderGallery() {
    const container = document.getElementById('galleryContainer');
    if (!container) return;

    let html = galleryImages.map(img => `
        <div class="gallery-item">
            <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.name)}" onerror="this.style.display='none'">
            <div class="overlay">
                <button class="btn btn-danger btn-sm" onclick="deleteGalleryImage(${img.id})">${ICON_DELETE} Delete</button>
            </div>
        </div>
    `).join('');

    html += `
        <label class="gallery-upload" for="galleryUpload">
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            Upload Image
            <input type="file" id="galleryUpload" accept="image/*" style="display:none" onchange="handleGalleryUpload(this)">
        </label>
    `;

    container.innerHTML = html;
}

async function handleGalleryUpload(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';   // let the same file be picked again after a failure

    const url = await uploadImage(file);
    if (!url) return;

    const newId = galleryImages.length > 0 ? Math.max(...galleryImages.map(g => g.id)) + 1 : 1;
    galleryImages.push({ id: newId, src: url, name: file.name });
    renderGallery();
    saveGallery();
}

function deleteGalleryImage(id) {
    if (confirm('Delete this image?')) {
        galleryImages = galleryImages.filter(g => g.id !== id);
        saveGallery();
        renderGallery();
        showToast('Image deleted', 'info');
    }
}



// ---- Barbers ----
/**
 * The order the shop offers a barber when the customer asked for nobody.
 *
 * Stored as a setting rather than taken from the order of the cards above: the
 * cards decide what the booking form looks like, and the owner should be able
 * to put their fastest barber first without moving them to the front of the
 * website. Anyone missing from the list is tried after everyone on it, so a
 * barber added this morning is bookable before this has been thought about.
 */
function barberPriority() {
    const known = barbers.map(b => String(b.name).trim())
        .filter(n => n && n !== ANY_BARBER);
    const saved = String(settings.barber_priority || '')
        .split(',').map(n => n.trim()).filter(n => known.includes(n));
    return saved.concat(known.filter(n => !saved.includes(n)));
}

function renderBarberPriority() {
    const container = document.getElementById('barberPriorityList');
    if (!container) return;

    const order = barberPriority();
    if (order.length === 0) {
        container.innerHTML = '<p class="report-empty">No barbers yet.</p>';
        return;
    }

    container.innerHTML = order.map((name, i) => `
        <div class="priority-row">
            <span class="priority-rank">${i + 1}</span>
            <span class="priority-name">${escapeHtml(name)}</span>
            <span class="priority-moves">
                <button class="btn btn-secondary btn-sm" ${i === 0 ? 'disabled' : ''}
                        onclick="moveBarberPriority(${i}, -1)" aria-label="Move up">↑</button>
                <button class="btn btn-secondary btn-sm" ${i === order.length - 1 ? 'disabled' : ''}
                        onclick="moveBarberPriority(${i}, 1)" aria-label="Move down">↓</button>
            </span>
        </div>`).join('');
}

async function moveBarberPriority(index, direction) {
    const order = barberPriority();
    const to = index + direction;
    if (to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to], order[index]];

    const next = Object.assign({}, settings, { barber_priority: order.join(',') });
    // Drawn before the save so the list moves under the finger; the save is
    // what makes it true, and puts it back if the server refuses.
    settings = next;
    renderBarberPriority();

    if (await saveToServer({ settings: next })) {
        showToast('Order saved', 'success');
    } else {
        await fetchLiveCMS();
        renderBarberPriority();
    }
}

function renderBarbers() {
    renderBarberPriority();
    const container = document.getElementById('barbersContainer');
    if (!container) return;

    // The server can take a moment to answer. Say so, rather than showing an
    // empty page that reads as "there are no barbers".
    if (!cmsLoaded) {
        container.innerHTML =
            '<p style="color:var(--text-muted);grid-column:1/-1">Loading barbers…</p>';
        return;
    }

    container.innerHTML = '';

    // A second "+ Add Barber" used to sit here as its own tile - the styled
    // button above the grid already does this, so it was the same action
    // offered twice, and the tile had no .add-new rule to centre its content,
    // which is why it rendered as a bare dark square with the label in the
    // corner.

    barbers.forEach((b, index) => {
        const name = String(b.name).trim();
        // Not a person to manage: it exists only so the booking form has a
        // "no preference" option, and it has no working days to show. Renaming
        // or deleting it here would silently break that option everywhere.
        if (name === ANY_BARBER) return;

        // Show the week at a glance, so the owner can see who covers which day
        // without opening every barber in turn.
        const on = rotaFor(name).filter(r => r.working).map(r => r.day.slice(0, 3));
        const summary = on.length ? on.join(' · ') : 'No days set';

        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.style.position = 'relative';
        item.style.cursor = 'pointer';
        item.innerHTML = `
            ${b.image
                ? `<img src="${escapeAttr(b.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-radius:4px;color:var(--text-muted);font-size:32px;font-weight:600">${escapeHtml(name.charAt(0).toUpperCase())}</div>`}
            <div style="position:absolute;bottom:0;background:rgba(0,0,0,0.82);width:100%;padding:8px;text-align:center">
                <div style="color:var(--gold);font-size:14px;font-weight:bold">${escapeHtml(name)}</div>
                <div style="color:#bbb;font-size:11px;margin-top:2px">${escapeHtml(summary)}</div>
            </div>
        `;
        item.onclick = () => openBarberModal(index);
        container.appendChild(item);
    });
}

// ---- One barber, one dialog ----
// Name, photo, the week they work and their time off are all edited here, so
// there is one place to look after a barber rather than three pages.

// Which barber the open dialog is editing, and a working copy of their rota so
// Close throws the edits away rather than half-applying them.
let editingBarberIndex = -1;
let draftRota = null;
let draftTimeOff = null;
let draftImage = '';

function openBarberModal(index) {
    const b = barbers[index];
    if (!b) return;
    editingBarberIndex = index;
    draftImage = b.image || '';
    // Deep copies: edits must not touch the live state until Save.
    draftRota = JSON.parse(JSON.stringify(rotaFor(b.name)));
    draftTimeOff = JSON.parse(JSON.stringify(timeOff.filter(t => t.barber === b.name)));

    document.getElementById('barberModalTitle').textContent = b.name || 'Edit Barber';
    document.getElementById('barberModalName').value = b.name || '';
    setBarberModalPhoto(draftImage);

    // "Any Available" is the no-preference option, not a person on the rota.
    const isPlaceholder = String(b.name).trim() === ANY_BARBER;
    document.getElementById('barberModalRota').style.display = isPlaceholder ? 'none' : '';
    document.getElementById('barberModalTimeOff').style.display = isPlaceholder ? 'none' : '';

    renderModalRota();
    renderModalTimeOff();
    document.getElementById('barberModal').classList.add('active');
}

function setBarberModalPhoto(url) {
    const img = document.getElementById('barberModalPhoto');
    if (!img) return;
    img.src = url || '';
    img.style.visibility = url ? 'visible' : 'hidden';
}

function closeBarberModal() {
    document.getElementById('barberModal').classList.remove('active');
    editingBarberIndex = -1;
    draftRota = null;
    draftTimeOff = null;
}

function renderModalRota() {
    const container = document.getElementById('barberModalRota');
    if (!container || !draftRota) return;

    container.innerHTML = draftRota.map((r, i) => `
        <div class="hours-row">
            <span class="day-name">${escapeHtml(r.day)}</span>
            <div class="time-inputs">
                ${r.working ? `
                    <input type="time" value="${escapeAttr(r.from || '')}"
                           onchange="updateDraftRota(${i}, 'from', this.value)">
                    <span style="color:var(--text-muted)">—</span>
                    <input type="time" value="${escapeAttr(r.to || '')}"
                           onchange="updateDraftRota(${i}, 'to', this.value)">
                    <span style="color:var(--text-muted);font-size:12px;margin-left:10px">break</span>
                    <input type="time" value="${escapeAttr(r.breakFrom || '')}"
                           onchange="updateDraftRota(${i}, 'breakFrom', this.value)">
                    <span style="color:var(--text-muted)">—</span>
                    <input type="time" value="${escapeAttr(r.breakTo || '')}"
                           onchange="updateDraftRota(${i}, 'breakTo', this.value)">
                ` : '<span class="day-closed">Off</span>'}
            </div>
            <label class="toggle-switch">
                <input type="checkbox" ${r.working ? 'checked' : ''}
                       onchange="toggleDraftRotaDay(${i}, this.checked)">
                <span class="toggle-slider"></span>
            </label>
        </div>
    `).join('');
}

function updateDraftRota(dayIndex, field, value) {
    const row = draftRota[dayIndex];
    const before = row[field];
    row[field] = value;
    // A shift ending before it starts offers nothing, with nothing on screen
    // to explain why. The edit is put back rather than blanked: a working day
    // with a blank time is refused by the database, and refused along with
    // every other change in the same save.
    if (row.from && row.to && row.to <= row.from) {
        showToast('The end time must be after the start time', 'error');
        row[field] = before;
        renderModalRota();
        return;
    }
    if (row.working && !value) {
        showToast('A working day needs a start and an end time', 'error');
        row[field] = before;
        renderModalRota();
    }
}

function toggleDraftRotaDay(dayIndex, isWorking) {
    const row = draftRota[dayIndex];
    row.working = isWorking;
    // Switching a day on with empty times would silently offer no slots.
    if (isWorking && !row.from) { row.from = '10:00'; row.to = '18:00'; }
    renderModalRota();
}

function renderModalTimeOff() {
    const container = document.getElementById('barberModalTimeOff');
    if (!container || !draftTimeOff) return;

    if (draftTimeOff.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No time off booked.</p>';
        return;
    }
    container.innerHTML = draftTimeOff.map((row, i) => `
        <div class="hours-row">
            <div class="time-inputs">
                <input type="date" value="${escapeAttr(row.from || '')}" onchange="updateDraftTimeOff(${i}, 'from', this.value)">
                <span style="color:var(--text-muted)">—</span>
                <input type="date" value="${escapeAttr(row.to || row.from || '')}" onchange="updateDraftTimeOff(${i}, 'to', this.value)">
                <input type="text" placeholder="Reason (optional)" value="${escapeAttr(row.note || '')}"
                       onchange="updateDraftTimeOff(${i}, 'note', this.value)"
                       style="background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;padding:6px;margin-left:10px">
            </div>
            <button class="btn btn-danger btn-sm" onclick="removeDraftTimeOff(${i})">Remove</button>
        </div>
    `).join('');
}

function addTimeOffFor() {
    const today = new Date().toISOString().slice(0, 10);
    draftTimeOff.push({ barber: barbers[editingBarberIndex].name, from: today, to: today, note: '' });
    renderModalTimeOff();
}

function updateDraftTimeOff(index, field, value) {
    const row = draftTimeOff[index];
    row[field] = value;
    if (field === 'from' && row.to && row.to < value) row.to = value;
    if (field === 'to' && value < row.from) {
        showToast('The end date cannot be before the start date', 'error');
        row.to = row.from;
        renderModalTimeOff();
    }
}

function removeDraftTimeOff(index) {
    draftTimeOff.splice(index, 1);
    renderModalTimeOff();
}

function changeBarberPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = await uploadImage(file);
        if (!url) return;
        draftImage = url;
        setBarberModalPhoto(url);
    };
    input.click();
}

async function saveBarberModal() {
    const b = barbers[editingBarberIndex];
    if (!b) return;

    const newName = document.getElementById('barberModalName').value.trim();
    if (!newName) {
        showToast('A barber needs a name', 'error');
        return;
    }
    const clash = barbers.some((other, i) => i !== editingBarberIndex &&
        String(other.name).trim().toLowerCase() === newName.toLowerCase());
    if (clash) {
        showToast('Another barber already has that name', 'error');
        return;
    }

    const oldName = String(b.name).trim();
    if (newName !== oldName) {
        // The rota and time off are keyed by name, so carry them across or
        // they would be orphaned and the barber would fall back to shop hours.
        delete barberHours[oldName];
        timeOff.forEach(t => { if (t.barber === oldName) t.barber = newName; });
        draftTimeOff.forEach(t => { t.barber = newName; });
    }

    b.name = newName;
    b.image = draftImage;
    barberHours[newName] = draftRota;
    timeOff = timeOff.filter(t => t.barber !== newName).concat(draftTimeOff);

    closeBarberModal();
    renderBarbers();

    if (await saveToServer({ barbers, barberHours, timeOff })) {
        showToast(`${newName} updated — customers see this now`, 'success');
    }
}

async function deleteBarberFromModal() {
    const b = barbers[editingBarberIndex];
    if (!b) return;
    if (!confirm(`Remove ${b.name}? Existing bookings are not affected.`)) return;

    const name = String(b.name).trim();
    barbers = barbers.filter((_, i) => i !== editingBarberIndex);
    delete barberHours[name];
    timeOff = timeOff.filter(t => t.barber !== name);

    closeBarberModal();
    renderBarbers();

    if (await saveToServer({ barbers, barberHours, timeOff })) {
        showToast(`${name} removed`, 'success');
    }
}

async function addBarber() {
    const name = prompt('Name of the new barber:');
    if (!name || !name.trim()) return;
    const clean = name.trim();
    if (barbers.some(b => String(b.name).trim().toLowerCase() === clean.toLowerCase())) {
        showToast('That barber is already on the list', 'error');
        return;
    }

    barbers.push({ name: clean, image: '' });
    // Every day off to start: a new barber is offered no appointments until
    // their week is filled in, rather than silently taking the shop's hours.
    barberHours[clean] = WEEK.map(day => ({
        day, working: false, from: '10:00', to: '18:00',
        breakFrom: '13:30', breakTo: '14:00'
    }));

    renderBarbers();
    if (await saveToServer({ barbers, barberHours })) {
        showToast(`${clean} added — set their working days`, 'success');
        openBarberModal(barbers.length - 1);
    }
}

// ---- Today ----

// ---- Reports ----
// The one page in the panel that is not for the staff. The figures are asked
// for with a PIN the server checks; nothing is drawn until it has answered.
//
// The PIN is held in memory and nowhere else. Putting it in sessionStorage
// would save the owner typing it after a refresh and hand it to anyone who
// opens the developer tools on the same phone, which is the person it is
// being kept from.
let reportsData = null;

// ---- The owner's lock --------------------------------------------------
// One PIN over the takings and over everything that changes what the shop is:
// prices, opening hours, the gallery, the website's words, the staff. The
// diary is not behind it — that is the work, and everyone who signs in does it.
//
// The PIN is typed once and never kept. What is kept is a pass the server
// signs, good for ten minutes: it cannot be read back into a PIN, cannot be
// extended, and stops working on its own. sessionStorage so it survives the
// pull-to-refresh that happens by accident while scrolling a rota, and dies
// with the tab.
const OWNER_PAGES = ['services', 'hours', 'gallery', 'cms', 'barbers', 'reports'];
const UNLOCK_KEY = 'sussex_admin_unlock';

/** The live pass, or '' when there is none or it has run out. */
function unlockPass() {
    try {
        const raw = sessionStorage.getItem(UNLOCK_KEY);
        if (!raw) return '';
        const held = JSON.parse(raw);
        if (!held || !held.pass || Date.now() >= held.until) {
            sessionStorage.removeItem(UNLOCK_KEY);
            return '';
        }
        return held.pass;
    } catch (err) {
        return '';
    }
}

const isUnlocked = () => Boolean(unlockPass());

/** Sign every owner-only request with the pass, whatever else it carries. */
const asOwner = payload => Object.assign({ unlockPass: unlockPass() }, payload);

function forgetUnlock() {
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch (err) { /* nothing to forget */ }
    reportsData = null;
}

// The windows a section can be downloaded over. The page itself always asks
// for twelve; these are for the file.
const REPORT_WINDOWS = [1, 3, 6, 12];

/**
 * Each downloadable section: its columns, and how to read a row of it out of
 * a report.
 *
 * Written once here rather than beside each card, so a column added to a
 * table and a column added to its download cannot drift apart.
 */
const REPORT_SECTIONS = {
    months: {
        file: 'trade-by-month',
        columns: ['Month', 'Appointments', 'Takings (EUR)'],
        rows: d => d.months.map(m => [m.month, m.appointments, m.revenue])
    },
    barbers: {
        file: 'barbers',
        columns: ['From', 'To', 'Barber', 'Appointments', 'Minutes in the chair',
                  'Takings (EUR)'],
        rows: d => d.barbers.window.map(b =>
            [d.window.from, d.asAt, b.barber, b.appointments, b.minutes, b.revenue])
    },
    services: {
        file: 'services',
        columns: ['From', 'To', 'Service', 'Appointments', 'Takings (EUR)'],
        rows: d => d.services.map(s =>
            [d.window.from, d.asAt, s.service, s.appointments, s.revenue])
    },
    weekdays: {
        file: 'busiest-days',
        columns: ['From', 'To', 'Day', 'Appointments'],
        rows: d => d.weekdays.map(w => [d.window.from, d.asAt, w.day, w.appointments])
    },
    hours: {
        file: 'busiest-times',
        columns: ['From', 'To', 'Hour', 'Appointments'],
        rows: d => d.hours.map(h =>
            [d.window.from, d.asAt, String(h.hour).padStart(2, '0') + ':00', h.appointments])
    },
    // One row, so it needs the period on it or the numbers mean nothing: 96
    // customers who came in once reads very differently over a month than over
    // a year.
    loyalty: {
        file: 'customers-coming-back',
        columns: ['From', 'To', 'Been in once', 'Been in more than once',
                  'Average visits each'],
        rows: d => [[d.window.from, d.asAt, d.loyalty.onceOnly,
                     d.loyalty.returning, d.loyalty.averageVisits]]
    },
    // The visit counter is a single running number with no dates behind it, so
    // it cannot be cut to a window. The column headings say which figures move
    // with the period and which do not, because a file that does not say is a
    // file someone will quote wrongly a month later.
    reach: {
        file: 'cancellations-and-reach',
        columns: ['From', 'To', 'Cancelled in period',
                  'Share of what was booked in period (%)',
                  'Visits to the website (all time)',
                  'Visits that booked (all time, %)'],
        rows: d => [[d.window.from, d.asAt, d.window.cancelled, d.window.cancelledShare,
                     d.lifetime.siteVisits, d.lifetime.bookedShare]]
    },
    summary: {
        file: 'summary',
        columns: ['From', 'To', 'Months', 'Appointments', 'Takings (EUR)',
                  'Customers', 'Cancelled', 'This month appointments',
                  'This month takings (EUR)', 'New customers this month',
                  'Booked ahead', 'Booked ahead takings (EUR)'],
        rows: d => [[
            d.window.from, d.asAt, d.window.months,
            d.window.appointments, d.window.revenue, d.window.customers,
            d.window.cancelled,
            d.thisMonth.appointments, d.thisMonth.revenue, d.thisMonth.newCustomers,
            d.upcoming.appointments, d.upcoming.revenue
        ]]
    }
};

/**
 * The keypad, or the page behind it.
 *
 * One gate for six pages. Which page is being unlocked is remembered so the
 * owner lands back on it rather than on whichever one the gate happens to
 * live in.
 */
const OWNER_GATE_LINES = {
    services: 'What the shop charges.',
    hours: 'When the shop is open.',
    gallery: 'The photographs on the website.',
    cms: 'The words on the website.',
    barbers: 'Who works here, and when.',
    reports: 'What the shop has taken, and who brought it in.'
};

function renderOwnerGate(page) {
    const gate = document.getElementById('ownerGate');
    if (!gate) return;

    // The keypad belongs to the six pages behind the lock. On the diary it has
    // no business being there at all — that is the work, and everyone who
    // signs in does it.
    const wanted = OWNER_PAGES.includes(page) && !isUnlocked();
    gate.style.display = wanted ? '' : 'none';

    const body = document.getElementById('page-' + page);
    if (body) body.classList.toggle('is-locked', wanted);

    if (!wanted) return;

    // Say what is behind it. One keypad for six pages reads as a wall unless
    // it names the one that was actually asked for.
    const line = gate.querySelector('p:not(.pin-note)');
    if (line) line.textContent = OWNER_GATE_LINES[page] || 'The owner’s pages.';

    const field = document.getElementById('ownerPin');
    if (field) field.value = '';
    const error = document.getElementById('ownerPinError');
    if (error) error.classList.remove('is-shown');
}

let reportsFetchInFlight = false;

function renderReports() {
    const content = document.getElementById('reportsContent');
    if (!content) return;

    if (!isUnlocked()) {
        content.innerHTML = '';   // nothing of the figures left behind the lock
        return;
    }

    // Unlocked, but the figures have not been asked for yet — which is the
    // ordinary case when the PIN was typed on another page. This used to draw
    // nothing at all: no keypad, because the lock was open, and no report,
    // because only unlocking *here* had ever fetched one.
    if (!reportsData) {
        if (!reportsFetchInFlight) {
            content.innerHTML = '<p class="report-empty">Loading…</p>';
            refreshReports();
        }
        return;
    }

    content.innerHTML = reportsMarkup(reportsData);
}

/** Ask the server for the ten-minute pass, then show whatever was locked. */
async function submitOwnerPin(e) {
    if (e) e.preventDefault();
    const field = document.getElementById('ownerPin');
    const error = document.getElementById('ownerPinError');
    const pin = field ? field.value.trim() : '';
    if (!pin) return;

    error.classList.remove('is-shown');
    try {
        const result = await apiPost({ action: 'unlock', password: adminPassword, pin });
        if (result.status !== 'success') {
            error.textContent = result.message || 'That PIN is not right';
            error.classList.add('is-shown');
            field.value = '';
            field.focus();
            return;
        }
        sessionStorage.setItem(UNLOCK_KEY,
            JSON.stringify({ pass: result.unlockPass, until: result.until }));
        // The pass alone does not draw the page; the page it was asked for
        // does. Reports fetches its own figures from there — it has to, since
        // the PIN is as often typed on another page as on that one.
        renderOwnerGate(currentPage);
        renderPage(currentPage);
    } catch (err) {
        console.error('Unlock failed', err);
        error.textContent = 'Could not reach the server. Please try again.';
        error.classList.add('is-shown');
    }
}

/** Put the lock back, on every page at once. */
function lockOwnerPages() {
    forgetUnlock();
    renderOwnerGate(currentPage);
    renderPage(currentPage);
}

/**
 * One section of the report, over one window, as a file.
 *
 * The figures are asked for again rather than sliced out of what is on screen.
 * The page holds twelve months of totals; three months of them is not the
 * first three rows of that, and a barber's three-month takings are not a
 * subtraction anyone should be doing in a browser.
 */
async function downloadReportSection(section, months) {
    closeDownloadMenus();
    const spec = REPORT_SECTIONS[section];
    if (!spec || !isUnlocked()) return;

    let data = reportsData;
    if (!data || data.window.months !== months) {
        showToast('Preparing the file…', 'info');
        try {
            const result = await apiPost(asOwner({
                action: 'reports', password: adminPassword, months
            }));
            if (result.status !== 'success') {
                showToast(result.message || 'Could not build that file', 'error');
                return;
            }
            data = result;
        } catch (err) {
            console.error('Report download failed', err);
            showToast('Could not reach the server', 'error');
            return;
        }
    }

    const rows = spec.rows(data);
    if (rows.length === 0) {
        showToast('Nothing recorded in that period', 'error');
        return;
    }

    downloadCSV(`sussex-${spec.file}-${months}m-${data.asAt}.csv`,
                [spec.columns].concat(rows));
    showToast('Downloaded', 'success');
}

/**
 * Rows to a file the spreadsheet will open.
 *
 * Every field is quoted and its quotes doubled — a service called
 * 4" Clipper Cut, or any name with a comma in it, otherwise shifts every
 * column after it by one and the file reads as nonsense.
 */
function downloadCSV(filename, rows) {
    const body = rows
        .map(row => row.map(cell => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

    // A Blob, not a data: URI. encodeURI() on a long report is slow and silently
    // mangles anything outside Latin-1; a barber called Þór is not an edge case
    // worth losing a file over.
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function refreshReports() {
    if (!isUnlocked() || reportsFetchInFlight) return;
    reportsFetchInFlight = true;
    try {
        const result = await apiPost(asOwner({ action: 'reports', password: adminPassword }));
        if (result.status === 'success') {
            reportsData = result;
        } else {
            // A refused answer must not leave "Loading…" on screen for ever.
            const content = document.getElementById('reportsContent');
            if (content) {
                content.innerHTML = `<p class="report-empty">${escapeHtml(result.message ||
                    'Could not load the reports.')}</p>`;
            }
            // The pass has run out, or was never good. Put the keypad back.
            if (result.locked) { lockOwnerPages(); return; }
        }
    } catch (err) {
        console.error('Could not refresh the reports', err);
        const content = document.getElementById('reportsContent');
        if (content) content.innerHTML = '<p class="report-empty">Could not reach the server.</p>';
    } finally {
        reportsFetchInFlight = false;
    }
    if (reportsData) renderReports();
}

const euros = v => '€' + Number(v || 0).toLocaleString('en-GB',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 195 -> "3h 15m". Minutes alone stop meaning anything past about a hundred. */
function asHours(minutes) {
    const total = Math.round(Number(minutes) || 0);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return m + 'm';
    return m ? `${h}h ${m}m` : `${h}h`;
}

/** "2026-08" -> "Aug 2026", which is what a person reads a chart in. */
function monthLabel(key) {
    const [year, month] = String(key).split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[Number(month) - 1] || month} ${year}`;
}

function statCard(colour, value, label, note) {
    return `
        <div class="stat-card ${colour}">
            <div class="stat-value">${escapeHtml(value)}</div>
            <div class="stat-label">${escapeHtml(label)}</div>
            ${note ? `<div class="stat-note">${escapeHtml(note)}</div>` : ''}
        </div>`;
}

/**
 * The same tile, with what it was last time underneath.
 *
 * A number on its own says nothing. 255 euros this month is good news or bad
 * depending entirely on what last month was, and the owner should not have to
 * remember. The comparison is against the same point in the earlier period —
 * a Tuesday against a Tuesday — or every week would look like a collapse until
 * Sunday.
 */
function statCardVs(colour, value, label, now, before, period) {
    return `
        <div class="stat-card ${colour}">
            <div class="stat-value">${escapeHtml(value)}</div>
            <div class="stat-label">${escapeHtml(label)}</div>
            ${changeNote(now, before, period)}
        </div>`;
}

/**
 * "▲ 18% on last month", and the four cases where a percentage would lie.
 *
 * `period` is the thing being compared against — "last month", "last week" —
 * so each sentence can be built to read properly rather than having one
 * phrase bolted onto the end of all of them.
 */
function changeNote(now, before, period) {
    const then = Number(before) || 0;
    const value = Number(now) || 0;
    const say = (text, mood) => `<div class="stat-note${mood ? ' ' + mood : ''}">${escapeHtml(text)}</div>`;

    if (!then && !value) return say(`nothing this period, nor ${period}`);
    // Something over nothing is not a percentage anybody can use.
    if (!then) return say(`nothing at all ${period}`, 'is-up');
    if (!value) return say(`nothing yet — ${period} it was there`, 'is-down');

    const change = Math.round(((value - then) / then) * 100);
    if (change === 0) return say(`level with ${period}`);
    const mood = change > 0 ? 'is-up' : 'is-down';
    const arrow = change > 0 ? '▲' : '▼';
    return say(`${arrow} ${Math.abs(change)}% on ${period}`, mood);
}

/**
 * A bar per row, drawn with a div rather than a chart library.
 *
 * The panel has no third-party scripts and the site's CSP does not allow any,
 * so this is not a shortcut around one — it is the only kind of chart that can
 * ship here. Widths are a percentage of the largest value, so a quiet month is
 * a short bar and not an empty one.
 */
function barRows(rows, valueOf, labelOf, textOf) {
    const peak = Math.max(1, ...rows.map(valueOf));
    return `<div class="bar-list">${rows.map(row => `
        <div class="bar-row">
            <span class="bar-label">${escapeHtml(labelOf(row))}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(valueOf(row) / peak) * 100}%"></span></span>
            <span class="bar-value">${escapeHtml(textOf(row))}</span>
        </div>`).join('')}</div>`;
}

/**
 * A card, and the download that belongs to it.
 *
 * `section` names which table of the report the file should hold. The window
 * is asked for at the moment of downloading rather than being a setting on
 * the page: the owner wants twelve months on screen and last month in a file
 * far more often than they want the page rewound.
 */
function reportsCard(section, title, body, aside) {
    return `
        <div class="data-card report-card">
            <div class="data-card-header">
                <h3>${escapeHtml(title)}</h3>
                <span class="report-header-right">
                    ${aside ? `<span class="report-aside">${escapeHtml(aside)}</span>` : ''}
                    ${section ? downloadMenu(section) : ''}
                </span>
            </div>
            <div class="report-body">${body}</div>
        </div>`;
}

/** The arrow, and the four windows behind it. */
function downloadMenu(section) {
    const options = REPORT_WINDOWS.map(months =>
        `<button type="button" role="menuitem" onclick="downloadReportSection('${section}', ${months})">
            ${months === 1 ? 'Last month' : 'Last ' + months + ' months'}
        </button>`).join('');
    return `
        <span class="download-menu">
            <button type="button" class="btn btn-secondary btn-sm download-btn"
                    aria-haspopup="true" aria-expanded="false"
                    title="Download this section"
                    onclick="toggleDownloadMenu(this)">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"></path></svg>
            </button>
            <span class="download-options" role="menu" hidden>${options}</span>
        </span>`;
}

function toggleDownloadMenu(button) {
    const menu = button.parentElement.querySelector('.download-options');
    const opening = menu.hidden;
    closeDownloadMenus();
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
}

function closeDownloadMenus() {
    document.querySelectorAll('.download-options').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.download-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
// A menu that only closes when you pick something is a menu you cannot leave.
document.addEventListener('click', e => {
    if (!e.target.closest('.download-menu')) closeDownloadMenus();
});

const EMPTY_NOTE = '<p class="report-empty">Nothing recorded yet.</p>';

/**
 * Who did the work, and what it came to.
 *
 * The share is of the takings rather than of the appointments: a barber doing
 * six beard trims and one doing four skin fades are not the same afternoon,
 * and the appointment count on its own says they are.
 */
function barberTable(rows) {
    if (rows.length === 0) return EMPTY_NOTE;
    const total = rows.reduce((sum, r) => sum + r.revenue, 0);
    return `
        <div class="table-responsive">
            <table>
                <thead><tr>
                    <th>Barber</th><th>Appointments</th><th>In the chair</th>
                    <th>Takings</th><th>Share</th>
                </tr></thead>
                <tbody>${rows.map(r => {
                    const share = total > 0 ? Math.round((r.revenue / total) * 100) : 0;
                    return `
                    <tr>
                        <td class="cell-strong">${escapeHtml(r.barber)}</td>
                        <td>${r.appointments}</td>
                        <td class="cell-nowrap">${escapeHtml(asHours(r.minutes))}</td>
                        <td class="cell-nowrap">${escapeHtml(euros(r.revenue))}</td>
                        <td>
                            <span class="share-cell">
                                <span class="share-track"><span class="share-fill" style="width:${share}%"></span></span>
                                <span class="share-value">${share}%</span>
                            </span>
                        </td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>`;
}

/**
 * A section that stays shut until it is wanted.
 *
 * The page was eight cards deep before anything could be read, which on a
 * phone is a lot of scrolling to reach a number nobody was looking for. The
 * headline and the barbers are always open; the rest answer questions that
 * come up once a month.
 */
function reportsDetail(section, title, body, aside) {
    return `
        <details class="report-detail">
            <summary>
                <span class="detail-title">${escapeHtml(title)}</span>
                ${aside ? `<span class="report-aside">${escapeHtml(aside)}</span>` : ''}
            </summary>
            <div class="report-body">
                ${section ? `<div class="detail-download">${downloadMenu(section)}</div>` : ''}
                ${body}
            </div>
        </details>`;
}

function reportsMarkup(d) {
    const busiestHours = d.hours.filter(h => h.appointments > 0);
    const since = `since ${d.window.from}`;
    const c = d.compare;

    return `
        <div class="report-toolbar">
            <span class="report-asat">Everything up to ${escapeHtml(d.asAt)}</span>
            <span class="report-toolbar-actions">
                ${downloadMenu('summary')}
                <button class="btn btn-secondary btn-sm" onclick="refreshReports()">Refresh</button>
                <button class="btn btn-secondary btn-sm" onclick="lockOwnerPages()">Lock</button>
            </span>
        </div>

        <!-- The four numbers the owner opened the page for. Money first,
             because that is the question; each against the same point in the
             period before, because a number with nothing beside it cannot be
             read as good or bad. -->
        <div class="stats-grid">
            ${statCardVs('gold', euros(d.thisMonth.revenue), 'Taken this month',
                         d.thisMonth.revenue, c.lastMonthSoFar.revenue, 'last month')}
            ${statCardVs('green', euros(c.thisWeek.revenue), 'Taken this week',
                         c.thisWeek.revenue, c.lastWeekSoFar.revenue, 'last week')}
            ${statCardVs('blue', String(d.thisMonth.appointments), 'Appointments this month',
                         d.thisMonth.appointments, c.lastMonthSoFar.appointments, 'last month')}
            ${statCard('orange', String(d.upcoming.appointments), 'Booked ahead',
                       `${euros(d.upcoming.revenue)} still to come in`)}
        </div>

        <p class="report-footnote">
            This month and this week are compared with the same number of days
            into the last one — ${escapeHtml(c.lastMonthSoFar.from)} to
            ${escapeHtml(c.lastMonthSoFar.to)}, and
            ${escapeHtml(c.lastWeekSoFar.from)} to ${escapeHtml(c.lastWeekSoFar.to)}.
            Last month finished on ${escapeHtml(euros(c.lastMonth.revenue))} from
            ${c.lastMonth.appointments} appointments.
        </p>

        ${reportsCard(null, 'Who did the work', barberTable(d.barbers.thisMonth),
            `this month, since ${d.thisMonth.from}`)}

        <!-- Everything below is opened when it is asked for. -->
        <h3 class="report-more">More detail</h3>

        ${reportsDetail('months', 'Month by month',
            d.months.length === 0 ? EMPTY_NOTE : barRows(d.months,
                m => m.revenue, m => monthLabel(m.month),
                m => `${euros(m.revenue)} · ${m.appointments}`),
            'takings, and appointments')}

        ${reportsDetail('barbers', 'Barbers over the whole period',
            barberTable(d.barbers.window), since)}

        ${reportsDetail('services', 'What sells',
            d.services.length === 0 ? EMPTY_NOTE : barRows(d.services,
                s => s.appointments, s => s.service,
                s => `${s.appointments} · ${euros(s.revenue)}`),
            `top ten ${since}`)}

        ${reportsDetail('weekdays', 'Busiest days',
            barRows(d.weekdays, w => w.appointments, w => w.day, w => String(w.appointments)),
            since)}

        ${reportsDetail('hours', 'Busiest times',
            busiestHours.length === 0 ? EMPTY_NOTE : barRows(busiestHours,
                h => h.appointments,
                h => String(h.hour).padStart(2, '0') + ':00',
                h => String(h.appointments)),
            since)}

        ${reportsDetail('loyalty', 'Customers', `
            <div class="stats-grid">
                ${statCard('blue', String(d.loyalty.returning), 'Been in more than once')}
                ${statCard('orange', String(d.loyalty.onceOnly), 'Been in once')}
                ${statCard('green', String(d.thisMonth.newCustomers), 'New this month')}
                ${statCard('gold', String(d.lifetime.customers), 'Customers in all',
                           'every number the shop has ever taken')}
            </div>`,
            since)}

        ${reportsDetail('reach', 'Cancellations, and the website', `
            <div class="stats-grid">
                ${statCard('orange', String(d.window.cancelled), 'Cancelled',
                           d.window.cancelledShare + '% of what was booked')}
                ${statCard('blue', String(d.lifetime.siteVisits), 'Visits to the website',
                           'all time — the counter has never been reset')}
                ${statCard('green', d.lifetime.bookedShare + '%', 'Visits that booked',
                           'a page load counts as a visit, so read it as a trend')}
                ${statCard('gold', euros(d.lifetime.revenue), 'Taken in all',
                           `${d.lifetime.appointments} appointments, all time`)}
            </div>`,
            since)}
    `;
}

// ---- Live Bookings & Weekly Planner Engine ----
let currentWeekOffset = 0;

let bookingsFetchInFlight = false;

async function fetchLiveBookings() {
    // One at a time. The backend is slow enough that a second call started
    // before the first returns only makes both slower.
    if (bookingsFetchInFlight) return;
    // The diary carries every customer's name and phone number, so the server
    // only hands it over with the password. Nothing to ask for until sign-in.
    if (!adminPassword) return;
    bookingsFetchInFlight = true;
    try {
        const data = await apiPost({ action: 'allBookings', password: adminPassword });
        if (data && data.status === 'error') {
            console.error('Bookings refused:', data.message);
            showToast(data.message === 'Unauthorized'
                ? 'Session expired — please sign in again'
                : 'Could not load bookings', 'error');
            return;
        }
        if (Array.isArray(data)) {
            // No price. The server stopped sending one to the panel: the
            // takings are behind the PIN on Reports, and everyone who works
            // the diary shares this password.
            bookings = data.map((b, idx) => ({
                id: 'BK-' + (100 + idx),
                customerName: b.name || 'Customer',
                customerPhone: b.phone || '',
                serviceName: b.service || 'Haircut',
                barberName: b.barber || 'Any',
                date: b.date || '',
                time: b.time || '',
                bookedAt: b.bookedAt || '',
                // 'shop' when somebody in the panel wrote it down. Worth
                // showing: a wrong number on a booking the customer typed is
                // theirs to have mistyped, and one on a booking we took over
                // the phone is ours to have misheard — and only one of those
                // is worth ringing back about.
                source: b.source || 'web',
                // Whether a reminder can reach them, not the address itself.
                hasEmail: b.hasEmail === true,
                status: 'Confirmed'
            }));
            saveBookings();
            updateUpcomingBadge();
            renderBarberFilters();
            renderBookings();
            renderWeeklyPlannerGrid();
        }
    } catch (e) {
        console.error("Failed to fetch live bookings", e);
    } finally {
        bookingsFetchInFlight = false;
    }
}

/** The Week page: the dropdown, then the grid it filters. */
function renderWeek() {
    renderBarberFilters();
    renderWeeklyPlannerGrid();
}

/**
 * The count on the Bookings tab in the sidebar.
 *
 * Appointments still to come, for whoever is being looked at — a barber who
 * has picked their own name wants their own number there, not the shop's.
 */
function updateUpcomingBadge() {
    const badge = document.getElementById('pendingBadge');
    if (!badge) return;
    const upcoming = forChosenBarber(bookings).filter(b => b.date >= today()).length;
    badge.textContent = upcoming;
    badge.style.display = upcoming > 0 ? 'inline' : 'none';
}

function navigateWeek(offsetDir) {
    if (offsetDir === 0) {
        currentWeekOffset = 0;
    } else {
        currentWeekOffset += offsetDir;
    }
    renderWeeklyPlannerGrid();
}

function getMondayOfOffsetWeek(offsetWeeks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(today.setDate(diff));
    monday.setDate(monday.getDate() + (offsetWeeks * 7));
    return monday;
}

function formatDateISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatDateShort(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
}

function renderWeeklyPlannerGrid() {
    const container = document.getElementById('weeklyGridContainer');
    const titleEl = document.getElementById('plannerWeekTitle');
    const captionEl = document.getElementById('weekCaption');

    if (!container) return;

    const monday = getMondayOfOffsetWeek(currentWeekOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    if (titleEl) {
        titleEl.textContent = `${formatDateShort(monday)} – ${formatDateShort(sunday)}`;
    }

    const mine = forChosenBarber(bookings);
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weekDays = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = formatDateISO(d);
        const dayBookings = mine.filter(b => b.date === iso);
        // This used to treat the seventh column as Sunday and Sunday as always
        // closed, which stopped being true the moment the owner changed the
        // shop's day off in Working Hours.
        const shopDay = hours.find(h => h.day === dayNames[i]);
        weekDays.push({
            name: dayNames[i],
            dateObj: d,
            iso: iso,
            bookings: dayBookings,
            closed: shopDay ? shopDay.open !== true : false
        });
    }

    let weekTotal = 0;

    const html = weekDays.map(dayData => {
        weekTotal += dayData.bookings.length;
        const countText = dayData.bookings.length === 1 ? '1 booking' : `${dayData.bookings.length} bookings`;

        let body;
        if (dayData.bookings.length === 0) {
            body = `<div class="planner-empty${dayData.closed ? ' is-closed' : ''}">${dayData.closed ? 'Closed' : 'No bookings'}</div>`;
        } else {
            const sorted = [...dayData.bookings].sort((a, b) => a.time.localeCompare(b.time));
            body = sorted.map(b => `
                <div class="planner-card">
                    <div class="planner-card-top">
                        <span class="planner-card-time">${escapeHtml(b.time)}</span>
                        <button onclick="cancelBookingById('${escapeAttr(b.id)}')" class="planner-card-cancel" aria-label="Cancel booking">
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="planner-card-name">${escapeHtml(b.customerName)}</div>
                    <div class="planner-card-detail">${escapeHtml(b.serviceName)}${b.barberName ? ' · ' + escapeHtml(b.barberName) : ''}</div>
                    ${b.customerPhone ? `<a class="planner-card-phone" href="tel:${escapeHtml(b.customerPhone)}">${escapeHtml(b.customerPhone)}</a>` : ''}
                </div>`).join('');
        }

        return `
            <div class="planner-day-col${dayData.closed ? ' is-closed' : ''}">
                <div class="planner-day-header">
                    <div class="planner-day-name">${dayData.name}</div>
                    <div class="planner-day-date">${formatDateShort(dayData.dateObj)}</div>
                    <div class="planner-day-count">${countText}</div>
                </div>
                <div class="planner-day-body">${body}</div>
            </div>`;
    }).join('');

    container.innerHTML = html;
    if (captionEl) captionEl.textContent = listCaption(weekTotal, 'appointment') + ' this week';
}

/** Cancel by the id the panel gave the booking, so no customer-typed text is
 *  ever spliced into an onclick attribute. */
async function cancelBookingById(id) {
    const b = bookings.find(x => x.id === id);
    if (!b) return;

    const who = b.customerName || 'this booking';
    if (!confirm(`Cancel ${who} on ${b.date} at ${b.time}?`)) return;

    showToast('Canceling booking...', 'info');

    // Drop it locally first so the grid reacts at once; the re-sync below is
    // what makes it true.
    bookings = bookings.filter(x => x.id !== id);
    renderBookings();
    renderWeeklyPlannerGrid();
    updateUpcomingBadge();

    try {
        const result = await apiPost({
            action: 'cancelBooking',
            date: b.date,
            time: b.time,
            phone: b.customerPhone
        });

        if (result.status === 'success') {
            showToast('Booking canceled successfully!', 'success');
        } else {
            // The optimistic removal above was wrong — put the real list back.
            showToast(result.message || 'Could not cancel that booking', 'error');
        }
    } catch (e) {
        console.error("Cancel failed", e);
        showToast('Could not reach the server — nothing was canceled', 'error');
    } finally {
        // Always re-sync: the server decides what the schedule really is.
        fetchLiveBookings();
    }
}

// ---- CSV Export Engine ----
function exportBookingsCSV() {
    if (!bookings || bookings.length === 0) {
        showToast('No bookings available to export', 'error');
        return;
    }

    // Exactly what is on the page — the same barber, the same period. A file
    // that quietly holds more than the list it was taken from is worse than no
    // file. No price column either: the takings are behind the PIN, and a
    // spreadsheet leaves the building.
    const rows = visibleBookings();
    if (rows.length === 0) {
        showToast('Nothing to export for that filter', 'error');
        return;
    }

    // Through downloadCSV(), the same as the reports. This built a data: URI by
    // hand and ran it through encodeURI(), which is slow on a long diary and
    // silently mangles anything outside Latin-1 — a customer called Ayşe came
    // out of the spreadsheet wrong.
    downloadCSV(
        `sussex-bookings-${today()}.csv`,
        [['ID', 'Date', 'Time', 'Booked at', 'Customer Name', 'Phone', 'Barber',
          'Service', 'Status']].concat(rows.map(b => [
            b.id || '', b.date || '', b.time || '', bookedAtFull(b.bookedAt),
            b.customerName || '', b.customerPhone || '', b.barberName || '',
            b.serviceName || '', b.status || 'Confirmed'
        ])));

    showToast(`Exported ${rows.length} ${rows.length === 1 ? 'booking' : 'bookings'}`, 'success');
}

// The theme needs no JavaScript. admin.css holds the dark values on :root and
// overrides them in a prefers-color-scheme query, so the panel matches whatever
// the device is set to, with nothing to press and nothing stored.

// ---- Admin Multi-Language Engine ----
const ADMIN_I18N = {
    en: {
        bookings: "Bookings",
        week: "Week",
        services: "Services & Pricing",
        hours: "Working Hours",
        gallery: "Gallery",
        cms: "Website Text",
        barbers: "Our Barbers",
        reports: "Reports"
    },
    nl: {
        bookings: "Boekingen",
        week: "Week",
        services: "Diensten & Prijzen",
        hours: "Werktijden",
        gallery: "Galerij",
        cms: "Website Teksten",
        barbers: "Onze Kappers",
        reports: "Rapporten"
    }
};

let currentAdminLang = 'en';

/** Two languages, so the button is the other one. */
function toggleAdminLanguage() {
    setAdminLanguage(currentAdminLang === 'en' ? 'nl' : 'en');
}

function setAdminLanguage(lang) {
    if (!ADMIN_I18N[lang]) return;
    currentAdminLang = lang;
    localStorage.setItem('sussex_admin_lang', lang);

    // The button says which language you are reading, the way the site's does.
    const button = document.getElementById('adminLangBtn');
    if (button) button.textContent = lang.toUpperCase();

    const dict = ADMIN_I18N[lang];
    document.querySelectorAll('[data-admin-i18n]').forEach(el => {
        const key = el.getAttribute('data-admin-i18n');
        if (dict[key]) el.textContent = dict[key];
    });

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle && dict[currentPage]) {
        pageTitle.textContent = dict[currentPage];
    }
}

// Load the saved language on init. The theme is not restored here any more:
// it is the device's to decide, and CSS reads that without being asked.
document.addEventListener('DOMContentLoaded', () => {
    let savedLang = localStorage.getItem('sussex_admin_lang') || 'en';
    // Kurdish was removed. Anyone who had picked it still has 'ku' stored, and
    // setAdminLanguage() would refuse it and leave the panel half-set — the
    // dropdown showing English while storage said otherwise. Fall back and
    // overwrite, so this repairs itself on the next visit.
    if (!ADMIN_I18N[savedLang]) savedLang = 'en';
    setAdminLanguage(savedLang);
});

// Utilities
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** For values sitting inside a double-quoted attribute. escapeHtml() leaves
 *  quotes alone, so a note like `back 5" late` would end the attribute early. */
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? ICON_CHECK : type === 'error' ? ICON_CROSS : ICON_INFO}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}



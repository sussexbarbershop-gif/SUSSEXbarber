// ===========================
// Sussex Barber Shop — Admin Panel JS
// ===========================

const API_URL = "https://script.google.com/macros/s/AKfycbyB3U2n2W2HRn20BxQWLi7Swjq0dSQV6_nnrSXPHRMsx53kP6xy8OpO2w9OTu9cdZvVtQ/exec";

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

// Placeholder only, shown for the instant before the Sheet answers. Kept in
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

// The password is never stored here. It lives in the Apps Script project
// (Script Properties > ADMIN_PASSWORD) and is checked server-side, so reading
// this file tells an attacker nothing. It is held in memory for the session
// only, because every write to the Sheet has to be signed with it.
let adminPassword = sessionStorage.getItem('sussex_admin_pw') || '';

/** POST a JSON action and read the reply. Apps Script allows this as a
 *  "simple" cross-origin request as long as the type stays text/plain. */
async function apiPost(payload) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** Shrink an image in the browser before it ever leaves the machine.
 *  Gallery photos off a phone are several megabytes; at that size the upload
 *  is slow and Drive fills up for no visual benefit on a 400px-wide card. */
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

/** Shrink, upload to Drive, and hand back a URL fit to store in the Sheet. */
async function uploadImage(file) {
    if (!adminPassword) {
        showToast('Session expired — please sign in again', 'error');
        return null;
    }
    showToast('Uploading image...', 'info');
    try {
        const dataUrl = await shrinkImage(file);
        const result = await apiPost({
            action: 'uploadImage',
            password: adminPassword,
            filename: file.name,
            dataUrl: dataUrl
        });
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

/** Push the current content to the Sheet so customers actually see it. */
async function syncToSheet(partial) {
    if (!adminPassword) {
        showToast('Session expired — please sign in again', 'error');
        return false;
    }
    try {
        const result = await apiPost(Object.assign({
            action: 'saveCMS',
            password: adminPassword
        }, partial));

        if (result.status !== 'success') {
            showToast(result.message || 'Server refused the change', 'error');
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
let currentPage = 'dashboard';
let bookings = [];
let services = [];
let hours = [];
let galleryImages = [];
let barbers = [];
let settings = {};
let visitCount = 0;
let barberHours = {};   // { 'Hemen': [{ day, working, from, to, breakFrom, breakTo }] }
let timeOff = [];       // [{ barber, from, to, note }]
// False until the Sheet has answered once, so pages can say "loading" instead
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
            // The visit counter is a row in the Settings sheet now.
            visitCount = parseInt(settings.visit_count || '0', 10) || 0;
        }
        if (data.barbers && data.barbers.length > 0) barbers = data.barbers;
        if (data.gallery && data.gallery.length > 0) {
            galleryImages = data.gallery.map((g, i) => ({ id: i + 1, src: g, name: 'Img ' + (i + 1) }));
        }
        // Services and hours now live in the Sheet too, so the panel shows
        // what customers are actually being served.
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
        showToast('Could not load from the Sheet — retrying', 'error');
        setTimeout(fetchLiveCMS, 5000);
    }
}
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkAuth();
    setupNavigation();
    setupSidebar();
    
    // Ask for both straight away; the 500ms wait only delayed the first paint.
    fetchLiveCMS();
    fetchLiveBookings();

    // Refresh bookings in the background. This polled every 10 seconds, but a
    // round trip to Apps Script takes closer to ten, so the calls piled up and
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

function showAdmin() {
    document.getElementById('loginWrapper').style.display = 'none';
    document.getElementById('adminLayout').classList.add('active');
    navigateTo('today');
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
        // Verified by the Apps Script, not here.
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
    sessionStorage.removeItem('sussex_admin_auth');
    sessionStorage.removeItem('sussex_admin_pw');
    showLogin();
}

// ---- Data Management ----
function loadData() {
    // Placeholders only. fetchLiveCMS() and fetchLiveBookings() replace all of
    // these with the Sheet's contents a moment after load; nothing about the
    // shop is persisted on this device.
    services = [...DEFAULT_SERVICES];
    hours = [...DEFAULT_HOURS];
    bookings = [];
    galleryImages = getDefaultGallery();
    visitCount = 0;
    // Do NOT increment visit counter here — only the main site should track visits
}

/** Kept as a no-op seam. The panel calls this from several places after
 *  mutating its in-memory state; persistence is the Sheet's job now, done by
 *  the syncToSheet() calls below. It was missing entirely before, which made
 *  fetchLiveCMS() and all the barber editing throw. */
function saveData() {
    /* nothing is stored locally */
}

async function saveServices() {
    if (await syncToSheet({ services: services })) {
        showToast('Services updated — customers see this now', 'success');
    }
}

async function saveHours() {
    if (await syncToSheet({ hours: hours })) {
        showToast('Working hours updated — customers see this now', 'success');
    }
}

function saveBookings() {
    // Bookings are owned by the Sheet; fetchLiveBookings() refreshes them.
}

async function saveGallery() {
    // The Sheet stores plain URLs, not the panel's {id, src, name} shape.
    if (await syncToSheet({ gallery: galleryImages.map(g => g.src) })) {
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
}

function navigateTo(page) {
    currentPage = page;

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
        today: 'Today',
        dashboard: 'Dashboard',
        bookings: 'Bookings',
        services: 'Services & Pricing',
        hours: 'Working Hours',
        gallery: 'Gallery',
        cms: 'Website Text',
        barbers: 'Our Barbers',
        analytics: 'Analytics'
    };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    // Render page content
    renderPage(page);
}

function renderPage(page) {
    switch (page) {
        case 'today': renderToday(); break;
        case 'dashboard': renderDashboard(); break;
        case 'bookings': renderBookings(); break;
        case 'services': renderServices(); break;
        case 'hours': renderHours(); break;
        case 'gallery': renderGallery(); break;
        // Missing, so Our Barbers only ever painted when the config happened to
        // arrive while the page was already open. That took seconds before the
        // backend was sped up, which is why it looked like it worked.
        case 'barbers': renderBarbers(); break;
        case 'cms': renderCms(); break;
        case 'analytics': renderAnalytics(); break;
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

// ---- Dashboard ----
function renderDashboard() {
    const today = new Date().toISOString().split('T')[0];
    const todayBookings = bookings.filter(b => b.date === today);
    const upcoming = bookings.filter(b => b.date >= today);

    // Every booking in the sheet is a booking; there is no pending state and
    // no lowercase 'confirmed'. Filtering on those matched nothing, so this
    // total was always €0 and the Pending tile always read zero.
    const totalRevenue = bookings.reduce((sum, b) => {
        const stored = parseFloat(b.price);
        if (!isNaN(stored) && stored > 0) return sum + stored;
        // Older rows were written before the price was stored with them.
        const svc = services.find(s => s.nameEN === b.serviceName ||
                                       s.nameNL === b.serviceName);
        return sum + (svc ? svc.price : 0);
    }, 0);

    document.getElementById('statTodayBookings').textContent = todayBookings.length;
    document.getElementById('statPending').textContent = upcoming.length;
    document.getElementById('statRevenue').textContent = `€${Math.round(totalRevenue)}`;
    document.getElementById('statVisits').textContent = visitCount;

    // The sidebar badge counts what is still to come, which is the number the
    // owner actually wants at a glance.
    const badge = document.getElementById('pendingBadge');
    if (badge) {
        badge.textContent = upcoming.length;
        badge.style.display = upcoming.length > 0 ? 'inline' : 'none';
    }

    // Recent bookings
    renderRecentBookings(todayBookings.length > 0 ? todayBookings : bookings.slice(0, 5));
}

function renderRecentBookings(list) {
    const tbody = document.getElementById('recentBookingsBody');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">No bookings yet</td></tr>`;
        return;
    }

    // Same field-name mismatch as the bookings table: b.name, b.service and
    // b.barber do not exist, so these columns were blank.
    tbody.innerHTML = list.map(b => `
        <tr>
            <td style="color:var(--text-primary);font-weight:500">${escapeHtml(b.customerName)}</td>
            <td>${escapeHtml(b.serviceName)}</td>
            <td>${escapeHtml(b.barberName || 'Any')}</td>
            <td>${escapeHtml(b.time)}</td>
            <td><span class="status-badge confirmed">● Booked</span></td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="cancelBookingById('${escapeAttr(b.id)}')" title="Cancel this booking">Cancel</button>
            </td>
        </tr>
    `).join('');
}

// ---- Bookings ----
let bookingFilter = 'all';

function renderBookings() {
    let filtered = [...bookings];

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    if (bookingFilter === 'today') {
        filtered = filtered.filter(b => b.date === today);
    } else if (bookingFilter === 'week') {
        filtered = filtered.filter(b => b.date >= weekAgo);
    } else if (bookingFilter === 'upcoming') {
        filtered = filtered.filter(b => b.date >= today);
    }

    // Sort by date desc
    filtered.sort((a, b) => new Date(b.date + 'T' + b.time) - new Date(a.date + 'T' + a.time));

    const tbody = document.getElementById('bookingsBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No bookings found</td></tr>`;
        return;
    }

    // The fields are customerName/customerPhone/serviceName/barberName — this
    // read b.name, b.phone, b.service and b.barber, so every one of those four
    // columns rendered blank.
    tbody.innerHTML = filtered.map(b => `
        <tr>
            <td style="color:var(--text-primary);font-weight:500">${escapeHtml(b.customerName)}</td>
            <td>${b.customerPhone
                    ? `<a href="tel:${encodeURIComponent(b.customerPhone)}" style="color:#60a5fa;text-decoration:none">${escapeHtml(b.customerPhone)}</a>`
                    : '—'}</td>
            <td>${escapeHtml(b.serviceName)}</td>
            <td>${escapeHtml(b.barberName || 'Any')}</td>
            <td>${escapeHtml(b.date)}</td>
            <td>${escapeHtml(b.time)}</td>
            <td>${b.date < today
                    ? '<span style="color:var(--text-muted)">Past</span>'
                    : '<span class="status-badge confirmed">● Booked</span>'}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="cancelBookingById('${escapeAttr(b.id)}')" title="Cancel this booking">Cancel</button>
            </td>
        </tr>
    `).join('');

    // Update filter tabs
    document.querySelectorAll('#bookingFilters .filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === bookingFilter);
    });
}

function setBookingFilter(filter) {
    bookingFilter = filter;
    renderBookings();
}

// updateBookingStatus() and deleteBooking() lived here. A booking has no
// pending state — one arrives booked — so the confirm and reject buttons
// never appeared, and both only edited the local array while the Sheet kept
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
    saveHours();
}

function toggleDay(index, isOpen) {
    hours[index].open = isOpen;
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
    cms_maps_embed_url: 'maps_embed_url'
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

    // saveCMS rewrites the whole Settings sheet from what it is sent, so the
    // visit counter has to travel with it or it resets to zero.
    if (settings.visit_count !== undefined) next.visit_count = settings.visit_count;

    if (await syncToSheet({ settings: next })) {
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
function renderBarbers() {
    const container = document.getElementById('barbersContainer');
    if (!container) return;

    // The Sheet takes several seconds to answer. Say so, rather than showing an
    // empty page that reads as "there are no barbers".
    if (!cmsLoaded) {
        container.innerHTML =
            '<p style="color:var(--text-muted);grid-column:1/-1">Loading barbers…</p>';
        return;
    }

    container.innerHTML = '';

    // Add Barber button card
    const addCard = document.createElement('div');
    addCard.className = 'gallery-item add-new';
    addCard.innerHTML = `<span style="font-size:24px;color:var(--gold)">+</span><span style="font-size:12px;color:var(--text-muted);margin-top:5px">Add Barber</span>`;
    addCard.onclick = () => addBarber();
    container.appendChild(addCard);

    barbers.forEach((b, index) => {
        const name = String(b.name).trim();
        const isPlaceholder = name === ANY_BARBER;

        // Show the week at a glance, so the owner can see who covers which day
        // without opening every barber in turn.
        let summary;
        if (isPlaceholder) {
            summary = 'Booking option';
        } else {
            const on = rotaFor(name).filter(r => r.working).map(r => r.day.slice(0, 3));
            summary = on.length ? on.join(' · ') : 'No days set';
        }

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
    row[field] = value;
    // A shift ending before it starts offers nothing, with nothing on screen
    // to explain why.
    if (row.from && row.to && row.to <= row.from) {
        showToast('The end time must be after the start time', 'error');
        row[field] = field === 'to' ? '' : row[field];
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

    if (await syncToSheet({ barbers, barberHours, timeOff })) {
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

    if (await syncToSheet({ barbers, barberHours, timeOff })) {
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
    if (await syncToSheet({ barbers, barberHours })) {
        showToast(`${clean} added — set their working days`, 'success');
        openBarberModal(barbers.length - 1);
    }
}

// ---- Today ----

/** Minutes since midnight, for sorting and for "next up". */
function minutesOf(timeStr) {
    const m = String(timeStr || '').match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 0;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const period = (m[3] || '').toUpperCase();
    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + min;
}

function bookingsOn(dateStr) {
    return bookings
        .filter(b => b.date === dateStr)
        .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

function renderToday() {
    const listEl = document.getElementById('todayList');
    const tomorrowEl = document.getElementById('tomorrowList');
    if (!listEl || !tomorrowEl) return;

    const now = new Date();
    const todayStr = formatDateISO(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDateISO(tomorrow);

    document.getElementById('todayDateLabel').textContent =
        now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    const todays = bookingsOn(todayStr);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = todays.filter(b => minutesOf(b.time) >= nowMinutes);

    const summary = document.getElementById('todaySummary');
    if (todays.length === 0) {
        summary.textContent = 'No appointments booked.';
    } else {
        summary.textContent = `${todays.length} appointment${todays.length === 1 ? '' : 's'}` +
            (upcoming.length ? ` · next at ${upcoming[0].time}` : ' · all done for today');
    }

    listEl.innerHTML = renderDayList(todays, nowMinutes);
    tomorrowEl.innerHTML = renderDayList(bookingsOn(tomorrowStr), null);
}

function renderDayList(list, nowMinutes) {
    if (list.length === 0) {
        return '<div class="today-empty">Nothing booked.</div>';
    }
    return list.map(b => {
        // Grey out what has already happened so the eye lands on what is next.
        const past = nowMinutes !== null && minutesOf(b.time) < nowMinutes;
        // Cancel takes the booking's id, not its details. A phone number is
        // typed by the customer, and pasting one into a quoted onclick let it
        // close the quote and run whatever followed — inside the owner's
        // signed-in panel.
        return `
            <div class="today-row${past ? ' is-past' : ''}">
                <div class="today-time">${escapeHtml(b.time)}</div>
                <div class="today-who">
                    <div class="today-name">${escapeHtml(b.customerName)}</div>
                    <div class="today-service">${escapeHtml(b.serviceName)}${b.barberName ? ' · ' + escapeHtml(b.barberName) : ''}</div>
                </div>
                <div class="today-actions">
                    ${b.customerPhone ? `<a class="today-call" href="tel:${encodeURIComponent(b.customerPhone)}" title="Call ${escapeAttr(b.customerName)}">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                        ${escapeHtml(b.customerPhone)}
                    </a>` : ''}
                    <button type="button" class="today-cancel" onclick="cancelBookingById('${escapeAttr(b.id)}')">Cancel</button>
                </div>
            </div>`;
    }).join('');
}

// ---- Analytics ----
function renderAnalytics() {
    document.getElementById('analyticsTotalVisits').textContent = visitCount;

    // A booking in the sheet is a booking — there is no confirmed/cancelled
    // split to count, and counting one gave 0 and a 0% rate on every screen.
    // What the owner can act on is how much is still to come, and how many
    // visits turn into an appointment.
    const today = new Date().toISOString().split('T')[0];
    const totalBookings = bookings.length;
    const upcoming = bookings.filter(b => b.date >= today).length;
    const bookedShare = visitCount > 0 ? Math.round((totalBookings / visitCount) * 100) : 0;

    document.getElementById('analyticsTotalBookings').textContent = totalBookings;
    document.getElementById('analyticsConfirmed').textContent = upcoming;
    document.getElementById('analyticsConversion').textContent = bookedShare + '%';

    // Simple bar chart
    renderSimpleChart();
}

function renderSimpleChart() {
    const canvas = document.getElementById('analyticsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth;
    const height = canvas.height = 200;

    ctx.clearRect(0, 0, width, height);

    // Generate last 7 days data
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const count = bookings.filter(b => b.date === dateStr).length;
        days.push({
            label: d.toLocaleDateString('en', { weekday: 'short' }),
            value: count
        });
    }

    const maxVal = Math.max(...days.map(d => d.value), 1);
    const barWidth = (width - 80) / days.length;
    const barGap = 8;

    days.forEach((day, i) => {
        const barH = (day.value / maxVal) * (height - 60);
        const x = 40 + i * barWidth + barGap / 2;
        const y = height - 30 - barH;

        // Bar
        ctx.fillStyle = '#d4af37';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - barGap, barH, 4);
        ctx.fill();

        // Label
        ctx.fillStyle = '#666';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(day.label, x + (barWidth - barGap) / 2, height - 10);

        // Value
        if (day.value > 0) {
            ctx.fillStyle = '#f0f0f0';
            ctx.fillText(day.value, x + (barWidth - barGap) / 2, y - 8);
        }
    });
}

// ---- Live Bookings & Weekly Planner Engine ----
let currentWeekOffset = 0;
let bookingViewMode = 'planner';

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
            bookings = data.map((b, idx) => ({
                id: 'BK-' + (100 + idx),
                customerName: b.name || 'Customer',
                customerPhone: b.phone || '',
                serviceName: b.service || 'Haircut',
                barberName: b.barber || 'Any',
                date: b.date || '',
                time: b.time || '',
                price: b.price || '',
                status: 'Confirmed'
            }));
            saveBookings();
            renderToday();
            renderDashboard();
            renderBookings();
            renderWeeklyPlannerGrid();
        }
    } catch (e) {
        console.error("Failed to fetch live bookings", e);
    } finally {
        bookingsFetchInFlight = false;
    }
}

function switchBookingView(mode) {
    bookingViewMode = mode;
    const plannerEl = document.getElementById('bookingPlannerView');
    const listEl = document.getElementById('bookingListView');
    const btnPlanner = document.getElementById('btnViewPlanner');
    const btnList = document.getElementById('btnViewList');

    if (mode === 'planner') {
        if (plannerEl) plannerEl.style.display = 'block';
        if (listEl) listEl.style.display = 'none';
        if (btnPlanner) {
            btnPlanner.style.background = 'var(--gold)';
            btnPlanner.style.color = '#000';
            btnPlanner.style.fontWeight = '600';
        }
        if (btnList) {
            btnList.style.background = 'transparent';
            btnList.style.color = 'var(--text-muted)';
            btnList.style.fontWeight = '500';
        }
        renderWeeklyPlannerGrid();
    } else {
        if (plannerEl) plannerEl.style.display = 'none';
        if (listEl) listEl.style.display = 'block';
        if (btnPlanner) {
            btnPlanner.style.background = 'transparent';
            btnPlanner.style.color = 'var(--text-muted)';
            btnPlanner.style.fontWeight = '500';
        }
        if (btnList) {
            btnList.style.background = 'var(--gold)';
            btnList.style.color = '#000';
            btnList.style.fontWeight = '600';
        }
        renderBookings();
    }
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
    const countEl = document.getElementById('plannerTotalCount');
    const revEl = document.getElementById('plannerEstRevenue');

    if (!container) return;

    const monday = getMondayOfOffsetWeek(currentWeekOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    if (titleEl) {
        titleEl.textContent = `${formatDateShort(monday)} – ${formatDateShort(sunday)}`;
    }

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weekDays = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = formatDateISO(d);
        const dayBookings = bookings.filter(b => b.date === iso);
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

    let totalWeekBookings = 0;
    let totalEstRev = 0;

    const html = weekDays.map(dayData => {
        totalWeekBookings += dayData.bookings.length;
        dayData.bookings.forEach(b => {
            totalEstRev += parseInt(String(b.price).replace(/[^0-9]/g, ''), 10) || 28;
        });

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
                    ${b.price ? `<div class="planner-card-price">€${escapeHtml(String(b.price))}</div>` : ''}
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
    if (countEl) countEl.textContent = totalWeekBookings;
    if (revEl) revEl.textContent = `€${totalEstRev}`;
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
    renderToday();
    renderWeeklyPlannerGrid();
    renderBookings();
    renderDashboard();

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
        // Always re-sync: the Sheet decides what the schedule really is.
        fetchLiveBookings();
    }
}

// ---- CSV Export Engine ----
function exportBookingsCSV() {
    if (!bookings || bookings.length === 0) {
        showToast('No bookings available to export', 'error');
        return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'ID,Date,Time,Customer Name,Phone,Barber,Service,Price,Status\n';

    bookings.forEach(b => {
        const row = [
            `"${b.id || ''}"`,
            `"${b.date || ''}"`,
            `"${b.time || ''}"`,
            `"${(b.customerName || '').replace(/"/g, '""')}"`,
            `"${(b.customerPhone || '').replace(/"/g, '""')}"`,
            `"${(b.barberName || '').replace(/"/g, '""')}"`,
            `"${(b.serviceName || '').replace(/"/g, '""')}"`,
            `"${b.price || ''}"`,
            `"${b.status || 'Confirmed'}"`
        ];
        csvContent += row.join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sussex_barber_bookings_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Bookings exported to CSV (Excel) successfully!', 'success');
}

// ---- Admin Theme Switcher (Dark / Light) ----
// The icon is two SVGs in the button; admin.css shows whichever matches
// body.admin-light-mode, so this only has the state to track.
function toggleAdminTheme() {
    const isLight = document.body.classList.toggle('admin-light-mode');
    localStorage.setItem('sussex_admin_theme', isLight ? 'light' : 'dark');
}

// ---- Admin Multi-Language Engine ----
const ADMIN_I18N = {
    en: {
        dashboard: "Dashboard",
        bookings: "Bookings",
        services: "Services & Pricing",
        hours: "Working Hours",
        gallery: "Gallery",
        cms: "Website Text",
        barbers: "Our Barbers",
        analytics: "Analytics"
    },
    nl: {
        dashboard: "Dashboard",
        bookings: "Boekingen",
        services: "Diensten & Prijzen",
        hours: "Werktijden",
        gallery: "Galerij",
        cms: "Website Teksten",
        barbers: "Onze Kappers",
        analytics: "Analyses"
    },
    ku: {
        dashboard: "داشبۆرد",
        bookings: "حیجزەکان",
        services: "سێرڤسەکان و نرخ",
        hours: "کاتژمێرەکانی کارکردن",
        gallery: "گەلەری",
        cms: "نووسینەکانی وێبسایت",
        barbers: "تراشەرەکان",
        analytics: "ئامارەکان"
    }
};

let currentAdminLang = 'en';

function setAdminLanguage(lang) {
    if (!ADMIN_I18N[lang]) return;
    currentAdminLang = lang;
    localStorage.setItem('sussex_admin_lang', lang);

    const select = document.getElementById('adminLangSelect');
    if (select) select.value = lang;

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

// Load saved theme & language on init
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('sussex_admin_theme') === 'light') {
        document.body.classList.add('admin-light-mode');
    }

    const savedLang = localStorage.getItem('sussex_admin_lang') || 'en';
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

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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



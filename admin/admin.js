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

        saveData();

        if (currentPage === 'barbers') renderBarbers();
        if (currentPage === 'gallery') renderGallery();
        if (currentPage === 'services') renderServices();
        if (currentPage === 'hours') renderHours();
        if (currentPage === 'rota') renderRota();
        if (currentPage === 'dashboard') renderDashboard();
        if (currentPage === 'analytics') renderAnalytics();
    } catch (e) {
        console.error("Failed to fetch live CMS data", e);
    }
}
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkAuth();
    setupNavigation();
    setupSidebar();
    
    // Fetch real CMS data & live bookings from server directly!
    setTimeout(() => {
        fetchLiveCMS();
        fetchLiveBookings();
    }, 500);

    // Auto-refresh live bookings every 10 seconds silently!
    setInterval(fetchLiveBookings, 10000);
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

async function saveBarbers() {
    saveData();
    if (await syncToSheet({ barbers: barbers })) {
        showToast('Barbers updated — customers see this now', 'success');
    }
}

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
        rota: 'Barber Schedules',
        gallery: 'Gallery',
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
        case 'rota': renderRota(); break;
        case 'gallery': renderGallery(); break;
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
    const pendingBookings = bookings.filter(b => b.status === 'pending');
    const confirmedToday = todayBookings.filter(b => b.status === 'confirmed');

    // Revenue — use stored price from booking if available, fallback to service lookup
    const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((sum, b) => {
        if (b.price !== undefined && b.price !== null && b.price > 0) {
            return sum + parseFloat(b.price);
        }
        // Fallback for old bookings without price field
        const svc = services.find(s => s.nameEN === b.service);
        return sum + (svc ? svc.price : 0);
    }, 0);

    document.getElementById('statTodayBookings').textContent = todayBookings.length;
    document.getElementById('statPending').textContent = pendingBookings.length;
    document.getElementById('statRevenue').textContent = `€${totalRevenue}`;
    document.getElementById('statVisits').textContent = visitCount;

    // Update badge
    const badge = document.getElementById('pendingBadge');
    if (badge) {
        badge.textContent = pendingBookings.length;
        badge.style.display = pendingBookings.length > 0 ? 'inline' : 'none';
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

    tbody.innerHTML = list.map(b => `
        <tr>
            <td style="color:var(--text-primary);font-weight:500">${escapeHtml(b.name)}</td>
            <td>${escapeHtml(b.service)}</td>
            <td>${escapeHtml(b.barber || 'Any')}</td>
            <td>${b.time}</td>
            <td><span class="status-badge ${b.status}">● ${capitalize(b.status)}</span></td>
            <td>
                ${b.status === 'pending' ? `
                    <button class="btn btn-success btn-sm" onclick="updateBookingStatus(${b.id}, 'confirmed')">✓</button>
                    <button class="btn btn-danger btn-sm" onclick="updateBookingStatus(${b.id}, 'cancelled')">✕</button>
                ` : '—'}
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
    } else if (bookingFilter === 'pending') {
        filtered = filtered.filter(b => b.status === 'pending');
    }

    // Sort by date desc
    filtered.sort((a, b) => new Date(b.date + 'T' + b.time) - new Date(a.date + 'T' + a.time));

    const tbody = document.getElementById('bookingsBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No bookings found</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(b => `
        <tr>
            <td style="color:var(--text-primary);font-weight:500">${escapeHtml(b.name)}</td>
            <td>${escapeHtml(b.phone || '')}</td>
            <td>${escapeHtml(b.service)}</td>
            <td>${escapeHtml(b.barber || 'Any')}</td>
            <td>${b.date}</td>
            <td>${b.time}</td>
            <td><span class="status-badge ${b.status}">● ${capitalize(b.status)}</span></td>
            <td>
                <div style="display:flex;gap:4px">
                    ${b.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="updateBookingStatus(${b.id}, 'confirmed')" title="Confirm">✓</button>
                        <button class="btn btn-danger btn-sm" onclick="updateBookingStatus(${b.id}, 'cancelled')" title="Cancel">✕</button>
                    ` : ''}
                    <button class="btn btn-danger btn-sm" onclick="deleteBooking(${b.id})" title="Delete">🗑</button>
                </div>
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

function updateBookingStatus(id, status) {
    const booking = bookings.find(b => b.id === id);
    if (booking) {
        booking.status = status;
        saveBookings();
        renderPage(currentPage);
        showToast(`Booking ${status}`, status === 'confirmed' ? 'success' : 'info');
    }
}

function deleteBooking(id) {
    if (confirm('Are you sure you want to delete this booking?')) {
        bookings = bookings.filter(b => b.id !== id);
        saveBookings();
        renderPage(currentPage);
        showToast('Booking deleted', 'info');
    }
}

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
                <button class="btn btn-secondary btn-sm" onclick="editService(${s.id})">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id})">🗑</button>
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

// ---- Barber Schedules ----
// The shop hours above say when the door is open; these say who is behind the
// chair. A slot is only offered when both agree.

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Real barbers only — "Any Available" is a booking option, not a person. */
function rosterableBarbers() {
    return barbers.map(b => String(b.name).trim())
                  .filter(n => n && n !== 'Any Available');
}

/** A barber with no saved rota is shown as off all week, not as a blank page. */
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

function renderRota() {
    const container = document.getElementById('rotaContainer');
    if (!container) return;

    const staff = rosterableBarbers();
    if (staff.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted)">Add a barber on the "Our Barbers" page first.</p>';
        renderTimeOff();
        return;
    }

    // Handlers take the barber's index, not their name: a name with a quote in
    // it would otherwise break out of the attribute.
    container.innerHTML = staff.map((name, bi) => {
        const rota = rotaFor(name);
        const rows = rota.map(r => {
            const i = WEEK.indexOf(r.day);
            return `
            <div class="hours-row">
                <span class="day-name">${escapeHtml(r.day)}</span>
                <div class="time-inputs">
                    ${r.working ? `
                        <input type="time" value="${escapeHtml(r.from || '')}"
                               onchange="updateRota(${bi}, ${i}, 'from', this.value)">
                        <span style="color:var(--text-muted)">—</span>
                        <input type="time" value="${escapeHtml(r.to || '')}"
                               onchange="updateRota(${bi}, ${i}, 'to', this.value)">
                        <span style="color:var(--text-muted);font-size:12px;margin-left:10px">break</span>
                        <input type="time" value="${escapeHtml(r.breakFrom || '')}"
                               onchange="updateRota(${bi}, ${i}, 'breakFrom', this.value)">
                        <span style="color:var(--text-muted)">—</span>
                        <input type="time" value="${escapeHtml(r.breakTo || '')}"
                               onchange="updateRota(${bi}, ${i}, 'breakTo', this.value)">
                    ` : '<span class="day-closed">Off</span>'}
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" ${r.working ? 'checked' : ''}
                           onchange="toggleRotaDay(${bi}, ${i}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>`;
        }).join('');

        const daysOn = rota.filter(r => r.working).map(r => r.day.slice(0, 3));
        return `
        <div style="margin-bottom:28px">
            <h4 style="color:var(--gold);margin-bottom:4px">${escapeHtml(name)}</h4>
            <p style="color:var(--text-muted);font-size:12px;margin-bottom:10px">
                ${daysOn.length ? daysOn.join(', ') : 'No fixed days — books only when switched on'}
            </p>
            ${rows}
        </div>`;
    }).join('');

    renderTimeOff();
}

function updateRota(barberIndex, dayIndex, field, value) {
    const name = rosterableBarbers()[barberIndex];
    if (!name) return;
    const row = rotaFor(name)[dayIndex];
    row[field] = value;
    // A shift that ends before it starts would offer no slots at all, with
    // nothing on screen to say why.
    if (row.from && row.to && row.to <= row.from) {
        showToast('The end time must be after the start time', 'error');
        renderRota();
        return;
    }
    saveRota();
}

function toggleRotaDay(barberIndex, dayIndex, isWorking) {
    const name = rosterableBarbers()[barberIndex];
    if (!name) return;
    rotaFor(name)[dayIndex].working = isWorking;
    saveRota();
    renderRota();
}

async function saveRota() {
    // Send the whole map: the backend rewrites the sheet from it.
    const payload = {};
    rosterableBarbers().forEach(name => { payload[name] = rotaFor(name); });
    if (await syncToSheet({ barberHours: payload })) {
        showToast('Schedules updated — the booking form uses these now', 'success');
    }
}

// ---- Time Off ----
function renderTimeOff() {
    const container = document.getElementById('timeOffContainer');
    if (!container) return;

    if (timeOff.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted)">Nobody is booked off. Add a holiday or sick day above.</p>';
        return;
    }

    const staff = rosterableBarbers();
    container.innerHTML = timeOff.map((row, i) => `
        <div class="hours-row">
            <select onchange="updateTimeOff(${i}, 'barber', this.value)"
                    style="background:var(--bg-input,#222);color:inherit;border:1px solid var(--border,#333);border-radius:6px;padding:6px">
                ${staff.map(n => `<option value="${escapeAttr(n)}" ${n === row.barber ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
            </select>
            <div class="time-inputs">
                <input type="date" value="${escapeAttr(row.from || '')}" onchange="updateTimeOff(${i}, 'from', this.value)">
                <span style="color:var(--text-muted)">—</span>
                <input type="date" value="${escapeAttr(row.to || row.from || '')}" onchange="updateTimeOff(${i}, 'to', this.value)">
                <input type="text" placeholder="Reason (optional)" value="${escapeAttr(row.note || '')}"
                       onchange="updateTimeOff(${i}, 'note', this.value)"
                       style="background:var(--bg-input,#222);color:inherit;border:1px solid var(--border,#333);border-radius:6px;padding:6px;margin-left:10px">
            </div>
            <button class="btn btn-danger btn-sm" onclick="removeTimeOff(${i})">Remove</button>
        </div>
    `).join('');
}

function addTimeOff() {
    const staff = rosterableBarbers();
    if (staff.length === 0) {
        showToast('Add a barber first', 'error');
        return;
    }
    const today = new Date().toISOString().slice(0, 10);
    timeOff.push({ barber: staff[0], from: today, to: today, note: '' });
    renderTimeOff();
    saveTimeOff();
}

function updateTimeOff(index, field, value) {
    timeOff[index][field] = value;
    // An end date before the start would silently block nothing at all.
    if (field === 'from' && timeOff[index].to < value) timeOff[index].to = value;
    if (field === 'to' && value < timeOff[index].from) {
        showToast('The end date cannot be before the start date', 'error');
        renderTimeOff();
        return;
    }
    saveTimeOff();
}

function removeTimeOff(index) {
    timeOff.splice(index, 1);
    renderTimeOff();
    saveTimeOff();
}

async function saveTimeOff() {
    if (await syncToSheet({ timeOff: timeOff })) {
        showToast('Time off updated', 'success');
    }
}

// ---- Gallery ----
function renderGallery() {
    const container = document.getElementById('galleryContainer');
    if (!container) return;

    let html = galleryImages.map(img => `
        <div class="gallery-item">
            <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.name)}" onerror="this.style.display='none'">
            <div class="overlay">
                <button class="btn btn-danger btn-sm" onclick="deleteGalleryImage(${img.id})">🗑 Delete</button>
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

    container.innerHTML = '';
    
    // Add Barber button card
    const addCard = document.createElement('div');
    addCard.className = 'gallery-item add-new';
    addCard.innerHTML = `<span style="font-size:24px;color:var(--gold)">+</span><span style="font-size:12px;color:var(--text-muted);margin-top:5px">Add Barber</span>`;
    addCard.onclick = () => addBarber();
    container.appendChild(addCard);

    barbers.forEach((b, index) => {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.style.position = 'relative';
        item.innerHTML = `
            <img src="${b.image}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">
            <div style="position:absolute;bottom:0;background:rgba(0,0,0,0.8);color:var(--gold);width:100%;text-align:center;padding:8px;font-size:14px;font-weight:bold;">${b.name}</div>
        `;
        item.onclick = () => openBarberModal(index);
        container.appendChild(item);
    });
}

function openBarberModal(index) {
    const b = barbers[index];
    const newName = prompt(`Edit name for ${b.name}:`, b.name);
    if(newName !== null) {
        b.name = newName;
        
        if(confirm(`Do you want to change the image for ${b.name}?`)) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const url = await uploadImage(file);
                if (!url) return;
                b.image = url;
                renderBarbers();
                saveBarbers();
            };
            input.click();
        } else {
            renderBarbers();
            saveBarbers();
        }
    }
}

function addBarber() {
    const name = prompt("Enter barber name:");
    if(!name) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = await uploadImage(file);
        if (!url) return;
        const newId = barbers.length > 0 ? Math.max(...barbers.map(g => g.id || 0)) + 1 : 1;
        barbers.push({ id: newId, name: name, image: url });
        renderBarbers();
        saveBarbers();
    };
    input.click();
}

function deleteBarber(id) {
    if (confirm('Delete this barber?')) {
        barbers = barbers.filter(g => g.id !== id);
        renderBarbers();
        saveBarbers();
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
        return `
            <div class="today-row${past ? ' is-past' : ''}">
                <div class="today-time">${escapeHtml(b.time)}</div>
                <div class="today-who">
                    <div class="today-name">${escapeHtml(b.customerName)}</div>
                    <div class="today-service">${escapeHtml(b.serviceName)}${b.barberName ? ' · ' + escapeHtml(b.barberName) : ''}</div>
                </div>
                <div class="today-actions">
                    ${b.customerPhone ? `<a class="today-call" href="tel:${encodeURIComponent(b.customerPhone)}" title="Call ${escapeHtml(b.customerName)}">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                        ${escapeHtml(b.customerPhone)}
                    </a>` : ''}
                    <button type="button" class="today-cancel" onclick="cancelLiveBookingFromPlanner('${b.date}','${b.time}','${b.customerPhone}')">Cancel</button>
                </div>
            </div>`;
    }).join('');
}

// ---- Analytics ----
function renderAnalytics() {
    document.getElementById('analyticsTotalVisits').textContent = visitCount;

    const totalBookings = bookings.length;
    const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
    const conversionRate = totalBookings > 0 ? Math.round((confirmedBookings / totalBookings) * 100) : 0;

    document.getElementById('analyticsTotalBookings').textContent = totalBookings;
    document.getElementById('analyticsConfirmed').textContent = confirmedBookings;
    document.getElementById('analyticsConversion').textContent = conversionRate + '%';

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

async function fetchLiveBookings() {
    try {
        // Never cached: the panel must show the schedule as it is right now.
        const res = await fetch(API_URL, { cache: 'no-store' });
        const data = await res.json();
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
        titleEl.textContent = `📅 WEEK: ${formatDateShort(monday)} to ${formatDateShort(sunday)}`;
    }

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weekDays = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = formatDateISO(d);
        const dayBookings = bookings.filter(b => b.date === iso);
        weekDays.push({
            name: dayNames[i],
            dateObj: d,
            iso: iso,
            bookings: dayBookings
        });
    }

    let totalWeekBookings = 0;
    let totalEstRev = 0;

    let html = '';

    weekDays.forEach((dayData, colIdx) => {
        totalWeekBookings += dayData.bookings.length;

        // Calculate day revenue
        dayData.bookings.forEach(b => {
            let priceNum = parseInt(String(b.price).replace(/[^0-9]/g, '')) || 28;
            totalEstRev += priceNum;
        });

        const isClosed = (colIdx === 6); // Sunday
        const countText = dayData.bookings.length === 1 ? '1 booking' : `${dayData.bookings.length} bookings`;

        html += `
            <div class="planner-day-col" style="background:var(--bg-secondary); border-radius:10px; border:1px solid var(--border-color); overflow:hidden; display:flex; flex-direction:column;">
                <div class="planner-day-header" style="background:${isClosed ? '#3b1c1c' : '#222'}; padding:12px; text-align:center; border-bottom:1px solid var(--border-color);">
                    <div style="font-weight:700; color:var(--gold); font-size:14px;">${dayData.name}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${formatDateShort(dayData.dateObj)}</div>
                    <div style="font-size:11px; color:#aaa; margin-top:4px; font-weight:600;">${countText}</div>
                </div>
                <div class="planner-day-body" style="padding:10px; flex:1; display:flex; flex-direction:column; gap:10px; min-height:300px; background:${isClosed ? 'rgba(239, 68, 68, 0.03)' : 'transparent'};">
        `;

        if (isClosed && dayData.bookings.length === 0) {
            html += `
                <div style="text-align:center; color:#ef4444; font-size:13px; font-weight:600; padding:20px 0;">
                    🚫 CLOSED
                </div>
            `;
        } else if (dayData.bookings.length === 0) {
            html += `
                <div style="text-align:center; color:var(--text-muted); font-size:12px; padding:20px 0; font-style:italic;">
                    No bookings
                </div>
            `;
        } else {
            // Sort bookings by time
            dayData.bookings.sort((a, b) => a.time.localeCompare(b.time));

            dayData.bookings.forEach(b => {
                html += `
                    <div class="planner-card" style="background:var(--bg-card); border:1px solid var(--border-color); border-left:3px solid var(--gold); border-radius:6px; padding:10px; font-size:12px; transition:transform 0.2s ease;">
                        <div style="font-weight:700; color:var(--gold); font-size:13px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
                            <span>⏰ ${escapeHtml(b.time)}</span>
                            <button onclick="cancelLiveBookingFromPlanner('${escapeHtml(b.date)}', '${escapeHtml(b.time)}', '${escapeHtml(b.customerPhone)}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:12px; padding:0 4px;" title="Cancel Booking">✕</button>
                        </div>
                        <div style="font-weight:600; color:#fff; margin-bottom:2px;">👤 ${escapeHtml(b.customerName)}</div>
                        ${b.customerPhone ? `<div style="margin-bottom:2px;"><a href="tel:${escapeHtml(b.customerPhone)}" style="color:#60a5fa; text-decoration:none;">📞 ${escapeHtml(b.customerPhone)}</a></div>` : ''}
                        <div style="color:var(--text-muted); margin-bottom:2px;">💈 ${escapeHtml(b.barberName)}</div>
                        <div style="color:var(--text-muted); margin-bottom:2px;">✂️ ${escapeHtml(b.serviceName)}</div>
                        ${b.price ? `<div style="color:#4ade80; font-weight:600; margin-top:4px;">💶 €${escapeHtml(String(b.price))}</div>` : ''}
                    </div>
                `;
            });
        }

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    if (countEl) countEl.textContent = totalWeekBookings;
    if (revEl) revEl.textContent = `€${totalEstRev}`;
}

async function cancelLiveBookingFromPlanner(date, time, phone) {
    if (!confirm(`Are you sure you want to cancel the booking on ${date} at ${time}?`)) return;

    showToast('Canceling booking...', 'info');

    // Optimistically remove from local array for instant UI update
    bookings = bookings.filter(b => !(b.date === date && b.time === time && b.customerPhone === phone));
    renderWeeklyPlannerGrid();
    renderBookings();
    renderDashboard();

    try {
        const result = await apiPost({
            action: 'cancelBooking',
            date: date,
            time: time,
            phone: phone
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
function toggleAdminTheme() {
    const isLight = document.body.classList.toggle('admin-light-mode');
    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
        btn.innerHTML = isLight ? '☀️' : '🌙';
    }
    localStorage.setItem('sussex_admin_theme', isLight ? 'light' : 'dark');
}

// ---- Admin Multi-Language Engine ----
const ADMIN_I18N = {
    en: {
        dashboard: "Dashboard",
        bookings: "Bookings",
        services: "Services & Pricing",
        hours: "Working Hours",
        rota: "Barber Schedules",
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
        rota: "Kappersroosters",
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
        rota: "ڕۆژی کاری تراشەرەکان",
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
    const savedTheme = localStorage.getItem('sussex_admin_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('admin-light-mode');
        const btn = document.getElementById('btnThemeToggle');
        if (btn) btn.innerHTML = '☀️';
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
        <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
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



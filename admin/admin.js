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

const DEFAULT_HOURS = [
    { day: 'Monday', dayNL: 'Maandag', open: true, from: '09:00', to: '18:00' },
    { day: 'Tuesday', dayNL: 'Dinsdag', open: true, from: '09:00', to: '18:00' },
    { day: 'Wednesday', dayNL: 'Woensdag', open: true, from: '09:00', to: '18:00' },
    { day: 'Thursday', dayNL: 'Donderdag', open: true, from: '09:00', to: '18:00' },
    { day: 'Friday', dayNL: 'Vrijdag', open: true, from: '09:00', to: '18:00' },
    { day: 'Saturday', dayNL: 'Zaterdag', open: true, from: '09:00', to: '17:00' },
    { day: 'Sunday', dayNL: 'Zondag', open: false, from: '09:00', to: '17:00' },
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

// ---- Init ----
async function fetchLiveCMS() {
    try {
        const res = await fetch(API_URL + "?action=getConfig");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'bad response');

        if (data.settings) settings = data.settings;
        if (data.barbers && data.barbers.length > 0) barbers = data.barbers;
        if (data.gallery && data.gallery.length > 0) {
            galleryImages = data.gallery.map((g, i) => ({ id: i + 1, src: g, name: 'Img ' + (i + 1) }));
        }
        // Services and hours now live in the Sheet too, so the panel shows
        // what customers are actually being served.
        if (data.services && data.services.length > 0) services = data.services;
        if (data.hours && data.hours.length > 0) hours = data.hours;

        saveData();

        if (currentPage === 'barbers') renderBarbers();
        if (currentPage === 'gallery') renderGallery();
        if (currentPage === 'services') renderServices();
        if (currentPage === 'hours') renderHours();
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
    navigateTo('dashboard');
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
    services = JSON.parse(localStorage.getItem('sussex_services')) || [...DEFAULT_SERVICES];
    hours = JSON.parse(localStorage.getItem('sussex_hours')) || [...DEFAULT_HOURS];
    bookings = JSON.parse(localStorage.getItem('sussex_bookings')) || generateSampleBookings();
    galleryImages = JSON.parse(localStorage.getItem('sussex_gallery')) || getDefaultGallery();
    visitCount = parseInt(localStorage.getItem('sussex_visits') || '0');
    // Do NOT increment visit counter here — only the main site should track visits
}

/** Write every cached collection back to localStorage.
 *  Referenced throughout the panel; it was missing entirely, which made
 *  fetchLiveCMS() and all the barber editing throw. */
function saveData() {
    localStorage.setItem('sussex_services', JSON.stringify(services));
    localStorage.setItem('sussex_hours', JSON.stringify(hours));
    localStorage.setItem('sussex_bookings', JSON.stringify(bookings));
    localStorage.setItem('sussex_gallery', JSON.stringify(galleryImages));
}

async function saveServices() {
    localStorage.setItem('sussex_services', JSON.stringify(services));
    if (await syncToSheet({ services: services })) {
        showToast('Services updated — customers see this now', 'success');
    }
}

async function saveHours() {
    localStorage.setItem('sussex_hours', JSON.stringify(hours));
    if (await syncToSheet({ hours: hours })) {
        showToast('Working hours updated — customers see this now', 'success');
    }
}

function saveBookings() {
    localStorage.setItem('sussex_bookings', JSON.stringify(bookings));
}

async function saveGallery() {
    localStorage.setItem('sussex_gallery', JSON.stringify(galleryImages));
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

function generateSampleBookings() {
    const names = ['Ahmad K.', 'Raman H.', 'Hemen S.', 'Jan de Vries', 'Mohammed A.', 'Pieter B.'];
    const phones = ['06 5373 0803', '06 1234 5678', '06 9876 5432', '06 5555 1234', '06 4444 7890', '06 3333 2222'];
    const statuses = ['confirmed', 'pending', 'pending', 'confirmed', 'cancelled', 'confirmed'];
    const sampleBookings = [];
    const today = new Date();

    for (let i = 0; i < 6; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - Math.floor(Math.random() * 7));
        const hour = 9 + Math.floor(Math.random() * 8);
        sampleBookings.push({
            id: i + 1,
            name: names[i],
            phone: phones[i],
            service: services[Math.floor(Math.random() * services.length)].nameEN,
            date: d.toISOString().split('T')[0],
            time: `${hour.toString().padStart(2, '0')}:${Math.random() > 0.5 ? '00' : '30'}`,
            status: statuses[i],
            createdAt: d.toISOString()
        });
    }
    return sampleBookings;
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
        dashboard: 'Dashboard',
        bookings: 'Bookings',
        services: 'Services & Pricing',
        hours: 'Working Hours',
        gallery: 'Gallery',
        analytics: 'Analytics'
    };
    document.getElementById('pageTitle').textContent = titles[page] || page;

    // Render page content
    renderPage(page);
}

function renderPage(page) {
    switch (page) {
        case 'dashboard': renderDashboard(); break;
        case 'bookings': renderBookings(); break;
        case 'services': renderServices(); break;
        case 'hours': renderHours(); break;
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

function handleGalleryUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const newId = galleryImages.length > 0 ? Math.max(...galleryImages.map(g => g.id)) + 1 : 1;
        galleryImages.push({
            id: newId,
            src: e.target.result,
            name: file.name
        });
        saveGallery();
        renderGallery();
        showToast('Image uploaded successfully', 'success');
    };
    reader.readAsDataURL(file);
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
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    b.image = ev.target.result;
                    renderBarbers();
                    saveBarbers();
                };
                reader.readAsDataURL(file);
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
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const newId = barbers.length > 0 ? Math.max(...barbers.map(g => g.id || 0)) + 1 : 1;
            barbers.push({ id: newId, name: name, image: ev.target.result });
            renderBarbers();
            saveBarbers();
        };
        reader.readAsDataURL(file);
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
        const res = await fetch(API_URL);
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
        await fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'cancelBooking',
                date: date,
                time: time,
                phone: phone
            })
        });
        showToast('Booking canceled successfully!', 'success');
        setTimeout(fetchLiveBookings, 1500); // Re-sync after server process
    } catch (e) {
        console.error("Cancel failed", e);
        showToast('Booking canceled locally', 'success');
        setTimeout(fetchLiveBookings, 1500);
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



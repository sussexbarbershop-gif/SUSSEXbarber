// The public config used to return every settings row, including the key
// that signs cancellation links. Anybody could then sign a link for any id.
// The panel also echoed that whole object on save, so hiding the key on reads
// alone still left an old tab able to overwrite it and break existing links.
// Drive the real database reader and HTTP handler, with only SQL replaced.
const assert = require('node:assert/strict');
const Module = require('module');
const { ICON_SETTINGS } = require('../api/_lib/icons');

const KEY = 'synthetic-cancellation-secret-for-this-test-only';
const publicSettings = {
  hero_title: 'Sussex', hero_subtitle: 'Welcome', about_text: 'The shop',
  team_title: 'Our team', team_text: 'Meet the barbers',
  contact_phone: '+31 6 00000000', contact_address: 'Wassenaar',
  instagram_url: 'https://example.com/social', maps_url: 'https://example.com/map',
  maps_embed_url: 'https://example.com/embed', review_url: 'https://example.com/review',
  booking_open: 'yes', barber_priority: 'Amir', visit_count: '123'
};
ICON_SETTINGS.forEach(key => { publicSettings[key] = `https://example.com/${key}.png`; });
let stored;
let writes;
const reset = () => {
  stored = new Map(Object.entries({ ...publicSettings, cancel_key: KEY }));
  writes = [];
};

function execute(query, values) {
  if (/SELECT key, value FROM settings/.test(query)) {
    return [...stored].map(([key, value]) => ({ key, value }));
  }
  if (/SELECT value FROM settings WHERE key = 'cancel_key'/.test(query)) {
    return stored.has('cancel_key') ? [{ value: stored.get('cancel_key') }] : [];
  }
  if (/INSERT INTO settings/.test(query)) {
    const key = /VALUES \('cancel_key'/.test(query) ? 'cancel_key' : values[0];
    const value = key === 'cancel_key' && /VALUES \('cancel_key'/.test(query)
      ? values[0] : values[1];
    writes.push(key);
    if (!/DO NOTHING/.test(query) || !stored.has(key)) stored.set(key, value);
    return [];
  }
  if (/DELETE FROM settings/.test(query)) {
    for (const key of stored.keys()) {
      if (!values[0].includes(key)) stored.delete(key);
    }
    return [];
  }
  if (/FROM barbers ORDER BY/.test(query)) {
    return [{ id: 1, name: 'Amir', image_url: '/amir.jpg', on_team: true }];
  }
  if (/FROM gallery/.test(query)) return [{ image_url: '/shop.jpg' }];
  if (/FROM services/.test(query)) {
    return [{ id: 1, name_en: 'Cut', name_nl: 'Knippen', price: '25', duration_min: 30 }];
  }
  if (/FROM shop_hours/.test(query)) {
    return [{ weekday: 1, is_open: true, opens_at: '10:00:00', closes_at: '18:00:00' }];
  }
  if (/FROM barber_hours|FROM time_off/.test(query)) return [];
  // Keep the real GET fallback from starting a reminder round, at any hour.
  if (/FROM job_runs/.test(query)) return [{ minutes: 0 }];
  throw new Error('Unexpected SQL in private-settings test: ' + query);
}

// Like Neon's queries, these execute when awaited, including in a transaction.
function fakeSql(strings, ...values) {
  const query = strings.join('?');
  return { then(resolve, reject) {
    return Promise.resolve().then(() => execute(query, values)).then(resolve, reject);
  } };
}
fakeSql.transaction = queries => Promise.all(queries);
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => fakeSql };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';
process.env.ADMIN_PASSWORD = 'test-panel-password';
process.env.REPORTS_PIN = 'test-owner-pin';

const dbPath = require.resolve('../api/_lib/db');
const db = require(dbPath);
const api = require('../api');
const auth = require('../api/_lib/auth');

async function request(method, payload) {
  const response = { code: 200, headers: {}, body: null };
  await api({ method, query: method === 'GET' ? payload : {},
    headers: {}, body: method === 'POST' ? JSON.stringify(payload) : undefined }, {
    status(code) { response.code = code; return this; },
    setHeader(name, value) { response.headers[name] = value; },
    send(text) { response.body = JSON.parse(text); }
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, 'success');
  return response;
}
const save = settings => request('POST', { action: 'saveCMS', settings,
  password: process.env.ADMIN_PASSWORD, pin: process.env.REPORTS_PIN });

let failed = 0;
async function check(name, run) {
  reset();
  try { await run(); console.log('PASS  ' + name); }
  catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.message); }
}

async function main() {
  await check('readConfig keeps the signing key private and all public settings intact', async () => {
    const config = await db.readConfig();
    assert.deepEqual(config.settings, publicSettings);
    assert.deepEqual(config.barbers, [{ name: 'Amir', image: '/amir.jpg', onTeam: true }]);
    assert.deepEqual(config.gallery, ['/shop.jpg']);
    assert.deepEqual(config.services, [{ id: 1, nameEN: 'Cut', nameNL: 'Knippen', price: 25, duration: 30 }]);
    assert.deepEqual(config.hours[1], { day: 'Monday', dayNL: 'Maandag', open: true, from: '10:00', to: '18:00' });
  });
  for (const action of ['getConfig', 'getSettings']) {
    await check(`${action} is public but never returns the cancellation secret`, async () => {
      const response = await request('GET', { action });
      assert.equal(Object.hasOwn(response.body.settings, 'cancel_key'), false);
      assert.equal(JSON.stringify(response.body).includes(KEY), false);
      assert.deepEqual(response.body.settings, publicSettings);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      assert.deepEqual(writes, []);
    });
  }
  await check('a partial CMS save ignores an old tab\'s key and still saves its text', async () => {
    await save({ hero_title: 'New title', cancel_key: 'stale-key-from-an-old-tab' });
    assert.deepEqual(writes, ['hero_title']);
    assert.equal(stored.get('hero_title'), 'New title');
    assert.equal(stored.get('booking_open'), 'yes');
    assert.equal(stored.get('cancel_key'), KEY);
  });
  await check('a complete CMS save cannot overwrite the signing key', async () => {
    await save({ ...publicSettings, booking_open: 'no', cancel_key: '' });
    assert.equal(writes.includes('cancel_key'), false);
    assert.equal(stored.get('cancel_key'), KEY);
    assert.equal(stored.get('booking_open'), 'no');
  });
  await check('a complete CMS save without the key preserves it when pruning old settings', async () => {
    stored.set('retired_setting', 'unused');
    const content = { ...publicSettings, hero_title: 'New title' };
    delete content.visit_count;
    ICON_SETTINGS.forEach(key => { delete content[key]; });
    await save(content);
    assert.equal(stored.has('retired_setting'), false);
    assert.equal(stored.get('cancel_key'), KEY);
    assert.equal(stored.get('visit_count'), '123');
    ICON_SETTINGS.forEach(key => assert.equal(stored.get(key), publicSettings[key]));
    assert.equal(stored.get('hero_title'), 'New title');
  });
  await check('a save containing only the private key cannot create or change it', async () => {
    await save({ cancel_key: 'replacement' });
    assert.deepEqual(writes, []);
    assert.equal(stored.get('cancel_key'), KEY);
    stored.delete('cancel_key');
    await save({ cancel_key: 'replacement' });
    assert.equal(stored.has('cancel_key'), false);
  });
  await check('an already-issued link survives a CMS save, a password change and a cold process', async () => {
    const token = auth.cancelToken(41, await db.getCancelKey());
    await save({ ...publicSettings, cancel_key: 'stale-key-from-an-old-tab' });
    process.env.ADMIN_PASSWORD = 'changed-test-password';
    delete require.cache[dbPath];
    const coldDb = require(dbPath);
    assert.equal(auth.bookingFromCancelToken(token, await coldDb.getCancelKey()), 41);
    assert.equal(stored.get('cancel_key'), KEY);
  });
  await check('only the server creates a missing signing key and the config still hides it', async () => {
    stored.delete('cancel_key');
    await db.readConfig();
    assert.equal(stored.has('cancel_key'), false);
    delete require.cache[dbPath];
    const coldDb = require(dbPath);
    const key = await coldDb.getCancelKey();
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(await coldDb.getCancelKey(), key);
    assert.deepEqual((await coldDb.readConfig()).settings, publicSettings);
  });
  Module._load = realLoad;
  console.log(failed ? `\n${failed} FAILED` : '\nAll private settings tests passed.');
  process.exitCode = failed ? 1 : 0;
}
main().catch(err => { console.error(err); process.exitCode = 1; });

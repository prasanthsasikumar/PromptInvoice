const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../api/_lib/analytics.js');

const REQ = { headers: { 'user-agent': 'python-requests/2.32', 'x-vercel-ip-country': 'SG', 'x-vercel-ip-country-region': '01', 'x-vercel-ip-city': 'Singapore' } };

test('clientKind names the caller family', () => {
  assert.equal(analytics.clientKind('curl/8.7.1'), 'curl');
  assert.equal(analytics.clientKind('python-requests/2.32'), 'python');
  assert.equal(analytics.clientKind('Python/3.11 aiohttp/3.9'), 'python');
  assert.equal(analytics.clientKind('node'), 'node');
  assert.equal(analytics.clientKind('undici'), 'node');
  assert.equal(analytics.clientKind('Mozilla/5.0 (Macintosh) Chrome/130'), 'browser');
  assert.equal(analytics.clientKind('Claude-User/1.0'), 'ai-agent');
  assert.equal(analytics.clientKind(''), 'unknown');
});

test('does nothing without GA configuration', async () => {
  let called = false;
  await analytics.track(REQ, 'api_pdf', { status: 'ok' }, { env: {}, fetch: async () => { called = true; } });
  assert.equal(called, false);
});

test('sends one Measurement Protocol event with location and no document content', async () => {
  let url, body;
  await analytics.track(REQ, 'api_pdf', { status: 'ok', doc_type: 'voucher', currency: 'SGD' },
    { env: { GA_MEASUREMENT_ID: 'G-TEST123', GA_API_SECRET: 'sec' }, fetch: async (u, o) => { url = u; body = JSON.parse(o.body); return { ok: true }; } });
  assert.equal(url, 'https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=sec');
  assert.match(body.client_id, /^\d+\.\d+$/);
  assert.equal(body.events.length, 1);
  const e = body.events[0];
  assert.equal(e.name, 'api_pdf');
  assert.deepEqual(
    { s: e.params.status, d: e.params.doc_type, c: e.params.currency, country: e.params.country, region: e.params.region, city: e.params.city, client: e.params.client },
    { s: 'ok', d: 'voucher', c: 'SGD', country: 'SG', region: '01', city: 'Singapore', client: 'python' });
  assert.deepEqual(body.user_location, { country_id: 'SG', city: 'Singapore' });
});

test('decodes city names Vercel sends URL-encoded', async () => {
  let body;
  await analytics.track({ headers: { 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'BR' } }, 'api_pdf', {},
    { env: { GA_MEASUREMENT_ID: 'G-T', GA_API_SECRET: 's' }, fetch: async (u, o) => { body = JSON.parse(o.body); } });
  assert.equal(body.events[0].params.city, 'São Paulo');
});

test('never throws and never waits long when GA fails or hangs', async () => {
  const env = { GA_MEASUREMENT_ID: 'G-T', GA_API_SECRET: 's' };
  await analytics.track(REQ, 'api_pdf', {}, { env, fetch: async () => { throw new Error('network down'); } });
  const t0 = Date.now();
  await analytics.track(REQ, 'api_pdf', {}, { env, timeoutMs: 50, fetch: () => new Promise(() => {}) });
  assert.ok(Date.now() - t0 < 500);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/draft.js');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = function (k, v) { res.headers[k.toLowerCase()] = v; return res; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  return res;
}

function fakeReq(body, method) {
  return { method: method || 'POST', body: body, headers: {} };
}

const DRAFT = {
  docType: 'invoice',
  client: { name: 'Acme Corp', email: 'billing@acme.com', address: null },
  items: [{ description: 'Logo design', qty: 1, rate: 600 }],
  currency: 'USD', taxRate: 8.5, taxLabel: 'Sales tax',
  discountType: null, discountValue: null, shipping: null,
  dueInDays: 15, reference: null, notes: null,
};

function mockUpstream(status, payload) {
  const calls = [];
  global.fetch = async function (url, opts) {
    calls.push({ url: url, opts: opts, body: JSON.parse(opts.body) });
    return { ok: status >= 200 && status < 300, status: status, json: async function () { return payload; } };
  };
  return calls;
}

function completion(content) {
  return { choices: [{ finish_reason: 'stop', message: { content: content } }] };
}

const CTX = { fromName: 'FlowsXR', currency: 'NZD', taxRate: 15, taxLabel: 'GST', today: '2026-09-04', clients: [] };

test.beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'sk-test-key'; });
test.afterEach(() => { delete global.fetch; });

test('rejects non-POST requests', async () => {
  const res = fakeRes();
  await handler(fakeReq({}, 'GET'), res);
  assert.equal(res.statusCode, 405);
});

test('rejects an empty description', async () => {
  const res = fakeRes();
  await handler(fakeReq({ description: '   ', ctx: CTX }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /describe/i);
});

test('reports a missing server key without calling upstream', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const calls = mockUpstream(200, completion(JSON.stringify(DRAFT)));
  const res = fakeRes();
  await handler(fakeReq({ description: 'Logo for Acme', ctx: CTX }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /not configured/i);
  assert.equal(calls.length, 0);
});

test('calls DeepSeek with the server key and JSON mode, returns the drafted fields', async () => {
  const calls = mockUpstream(200, completion(JSON.stringify(DRAFT)));
  const res = fakeRes();
  await handler(fakeReq({ description: 'Designed a logo for Acme Corp', ctx: CTX }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, DRAFT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sk-test-key');
  assert.equal(calls[0].body.model, 'deepseek-chat');
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  const system = calls[0].body.messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /FlowsXR/);
  assert.match(system.content, /NZD/);
  assert.match(system.content, /json/i);
  assert.equal(calls[0].body.messages[1].content, 'Designed a logo for Acme Corp');
});

test('fills in missing fields so the client always gets the full shape', async () => {
  mockUpstream(200, completion(JSON.stringify({ items: [{ description: 'Hours', qty: '3', rate: '80' }], client: { name: 'Bob' } })));
  const res = fakeRes();
  await handler(fakeReq({ description: 'three hours for bob', ctx: CTX }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.docType, 'invoice');
  assert.deepEqual(res.body.client, { name: 'Bob', email: null, address: null });
  assert.deepEqual(res.body.items, [{ description: 'Hours', qty: 3, rate: 80 }]);
  assert.equal(res.body.taxRate, null);
  assert.equal(res.body.dueInDays, null);
});

test('tolerates a JSON answer wrapped in a code fence', async () => {
  mockUpstream(200, completion('```json\n' + JSON.stringify(DRAFT) + '\n```'));
  const res = fakeRes();
  await handler(fakeReq({ description: 'Logo for Acme', ctx: CTX }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.client.name, 'Acme Corp');
});

test('maps upstream auth and rate-limit failures to friendly errors', async () => {
  mockUpstream(401, { error: { message: 'bad key' } });
  let res = fakeRes();
  await handler(fakeReq({ description: 'Logo for Acme', ctx: CTX }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /rejected the server's key/i);

  mockUpstream(429, { error: { message: 'slow down' } });
  res = fakeRes();
  await handler(fakeReq({ description: 'Logo for Acme', ctx: CTX }), res);
  assert.equal(res.statusCode, 429);
  assert.match(res.body.error, /busy/i);
});

test('reports unreadable model output', async () => {
  mockUpstream(200, completion('sorry, cannot do that'));
  const res = fakeRes();
  await handler(fakeReq({ description: 'Logo for Acme', ctx: CTX }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /rephras/i);
});

test('caps very long descriptions', async () => {
  const calls = mockUpstream(200, completion(JSON.stringify(DRAFT)));
  const res = fakeRes();
  await handler(fakeReq({ description: 'x'.repeat(20001), ctx: CTX }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

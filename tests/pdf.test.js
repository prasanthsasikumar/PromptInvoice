const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/pdf.js');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.headers['content-type'] = 'application/json'; res.body = b; res.ended = true; return res; };
  res.end = (b) => { res.body = b; res.ended = true; return res; };
  return res;
}
const req = (method, body) => ({ method: method, body: body, headers: { 'content-type': 'application/json' } });
const DOC = { docType: 'voucher', number: 'PV-001', from: { name: 'FLOWXR PTE. LTD.' }, to: { name: 'Ovindu / Atukorala' },
  items: [{ description: 'September', qty: 1, rate: 350 }], currency: 'SGD' };

test('GET explains the API', async () => {
  const res = fakeRes();
  await handler(req('GET'), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.docs, /\/agents$/);
  assert.equal(res.body.request.method, 'POST');
  assert.ok(res.body.example.items.length > 0);
  assert.ok(res.body.fields.items);
});

test('POST renders and returns a PDF with a safe filename', async () => {
  let seen;
  handler.setRenderer(async (doc) => { seen = doc; return Buffer.from('%PDF-1.7 test'); });
  const res = fakeRes();
  await handler(req('POST', DOC), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(String(res.body), '%PDF-1.7 test');
  assert.equal(res.headers['content-disposition'], 'inline; filename="PV-001 - Ovindu Atukorala.pdf"');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(seen.currency, 'SGD');
});

test('POST accepts a JSON string body', async () => {
  handler.setRenderer(async () => Buffer.from('%PDF'));
  const res = fakeRes();
  await handler(req('POST', JSON.stringify(DOC)), res);
  assert.equal(res.statusCode, 200);
});

test('invalid documents get 400 with every problem listed', async () => {
  handler.setRenderer(async () => { throw new Error('should not render'); });
  const res = fakeRes();
  await handler(req('POST', { items: [] }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.details.length >= 3);
  assert.match(res.body.help, /\/agents/);
});

test('warnings travel in a header', async () => {
  handler.setRenderer(async () => Buffer.from('%PDF'));
  const res = fakeRes();
  await handler(req('POST', Object.assign({ total: 5 }, DOC)), res);
  assert.match(res.headers['x-promptinvoice-warnings'], /total/);
});

test('oversized bodies are refused', async () => {
  const res = fakeRes();
  await handler(req('POST', Object.assign({}, DOC, { notes: 'x'.repeat(4.2 * 1024 * 1024) })), res);
  assert.equal(res.statusCode, 413);
});

test('render failure is a 500 with a message, not a crash', async () => {
  handler.setRenderer(async () => { throw new Error('chromium missing'); });
  const res = fakeRes();
  await handler(req('POST', DOC), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /render/i);
});

test('CORS preflight and other methods', async () => {
  const pre = fakeRes();
  await handler(req('OPTIONS'), pre);
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-origin'], '*');
  const put = fakeRes();
  await handler(req('PUT'), put);
  assert.equal(put.statusCode, 405);
});

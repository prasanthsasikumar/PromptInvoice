const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../js/analytics.js');

function fakeWindow() {
  const added = [];
  return { added, document: { createElement: () => ({}), head: { appendChild: (el) => added.push(el) } } };
}

test('stays off without a Measurement ID', () => {
  const w = fakeWindow();
  const a = create(w, { gaMeasurementId: '' });
  a.event('pdf_download', { doc_type: 'invoice' });
  assert.equal(w.added.length, 0);
  assert.equal(w.dataLayer, undefined);
});

test('loads gtag once and queues config and events', () => {
  const w = fakeWindow();
  const a = create(w, { gaMeasurementId: 'G-ABC123' });
  a.event('pdf_download', { doc_type: 'voucher', currency: 'SGD' });
  assert.equal(w.added.length, 1);
  assert.equal(w.added[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-ABC123');
  const calls = w.dataLayer.map((x) => Array.from(x));
  assert.deepEqual(calls[1], ['config', 'G-ABC123', { anonymize_ip: true }]);
  assert.deepEqual(calls[2], ['event', 'pdf_download', { doc_type: 'voucher', currency: 'SGD' }]);
});

test('rejects a malformed Measurement ID instead of injecting it', () => {
  const w = fakeWindow();
  create(w, { gaMeasurementId: 'G-ABC"><script>' }).event('x');
  assert.equal(w.added.length, 0);
});

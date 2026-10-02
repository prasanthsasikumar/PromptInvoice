const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, LIMITS } = require('../api/_lib/document.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const VOUCHER = {
  docType: 'voucher', number: 'PV-001', issueDate: '2026-10-02',
  from: { name: 'FLOWXR PTE. LTD.', email: 'prasanth@flowsxr.com', signature: PNG },
  to: { name: 'Ovindu Atukorala' },
  items: [{ description: 'Services September 2026', qty: 1, rate: 350 }, { description: 'Advance for October', qty: '1', rate: '200' }],
  currency: 'sgd', paymentMethod: 'Bank transfer', approvedBy: 'Prasanth Sasikumar',
};

test('accepts a voucher and fills defaults', () => {
  const { doc, errors, warnings } = normalize(VOUCHER, '2026-10-02');
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(doc.docType, 'voucher');
  assert.equal(doc.currency, 'SGD');
  assert.equal(doc.items[1].qty, 1);
  assert.equal(doc.items[1].rate, 200);
  assert.equal(doc.from.signature, PNG);
  assert.equal(doc.theme, '#166534');
  assert.equal(doc.notes, '');
  assert.equal(doc.taxRate, 0);
  assert.equal(doc.id, null);
});

test('accepts the body wrapped as { document }', () => {
  assert.deepEqual(normalize({ document: VOUCHER }, '2026-10-02').errors, []);
});

test('invoice defaults: today and due in 14 days, stock note', () => {
  const { doc, errors } = normalize({ number: 'INV-7', from: { name: 'A' }, to: { name: 'B' }, items: [{ description: 'x', qty: 2, rate: 10 }] }, '2026-10-02');
  assert.deepEqual(errors, []);
  assert.equal(doc.docType, 'invoice');
  assert.equal(doc.issueDate, '2026-10-02');
  assert.equal(doc.dueDate, '2026-10-16');
  assert.equal(doc.currency, 'USD');
  assert.match(doc.notes, /Thank you/);
});

test('reports every problem at once with field paths', () => {
  const { errors } = normalize({ docType: 'bill', issueDate: '02/10/2026', currency: 'XYZ', from: {}, to: {}, items: [{ qty: 'lots', rate: 5 }], taxRate: 150, theme: 'green', discountType: 'half' }, '2026-10-02');
  const fields = errors.map((e) => e.field);
  for (const f of ['docType', 'number', 'issueDate', 'currency', 'from.name', 'to.name', 'items[0].description', 'items[0].qty', 'taxRate', 'theme', 'discountType']) {
    assert.ok(fields.includes(f), 'missing error for ' + f + ': ' + JSON.stringify(errors));
  }
});

test('needs at least one item and caps the count', () => {
  assert.ok(normalize({ number: '1', from: { name: 'A' }, to: { name: 'B' }, items: [] }).errors.some((e) => e.field === 'items'));
  const many = Array.from({ length: LIMITS.items + 1 }, () => ({ description: 'x', qty: 1, rate: 1 }));
  assert.ok(normalize({ number: '1', from: { name: 'A' }, to: { name: 'B' }, items: many }).errors.some((e) => e.field === 'items'));
});

test('images must be small base64 data URIs', () => {
  const bad = normalize(Object.assign({}, VOUCHER, { from: { name: 'A', logo: 'https://example.com/logo.png', signature: 'data:image/png;base64,' + 'A'.repeat(LIMITS.imageBytes * 2) } }));
  const fields = bad.errors.map((e) => e.field);
  assert.ok(fields.includes('from.logo'));
  assert.ok(fields.includes('from.signature'));
});

test('unknown fields are ignored with a warning, not an error', () => {
  const { errors, warnings } = normalize(Object.assign({}, VOUCHER, { lineItems: [], total: 999 }));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.sort(), ['Ignored unknown field "lineItems"', 'Ignored unknown field "total" (totals are always calculated)'].sort());
});

test('rejects a non-object body', () => {
  assert.ok(normalize(null).errors.length > 0);
  assert.ok(normalize('hello').errors.length > 0);
});

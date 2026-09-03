const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');

test('computeTotals sums line items', () => {
  const t = calc.computeTotals({
    items: [{ qty: 2, rate: 50 }, { qty: 1, rate: 25.5 }],
    taxRate: 0, discountType: 'percent', discountValue: 0, shipping: 0,
  });
  assert.equal(t.subtotal, 125.5);
  assert.equal(t.discount, 0);
  assert.equal(t.tax, 0);
  assert.equal(t.total, 125.5);
});

test('computeTotals applies percent discount before tax', () => {
  const t = calc.computeTotals({
    items: [{ qty: 1, rate: 100 }],
    taxRate: 10, discountType: 'percent', discountValue: 20, shipping: 0,
  });
  assert.equal(t.discount, 20);
  assert.equal(t.taxable, 80);
  assert.equal(t.tax, 8);
  assert.equal(t.total, 88);
});

test('computeTotals applies fixed discount and shipping (shipping untaxed)', () => {
  const t = calc.computeTotals({
    items: [{ qty: 3, rate: 10 }],
    taxRate: 15, discountType: 'fixed', discountValue: 5, shipping: 7.5,
  });
  assert.equal(t.subtotal, 30);
  assert.equal(t.discount, 5);
  assert.equal(t.tax, 3.75);
  assert.equal(t.shipping, 7.5);
  assert.equal(t.total, 36.25);
});

test('computeTotals tolerates blanks, strings and negatives', () => {
  const t = calc.computeTotals({
    items: [{ qty: '', rate: '12' }, { qty: 'abc', rate: null }],
    taxRate: '', discountType: 'fixed', discountValue: 999, shipping: '',
  });
  assert.equal(t.subtotal, 0);
  assert.equal(t.discount, 0); // discount capped at subtotal
  assert.equal(t.total, 0);
});

test('computeTotals rounds to cents', () => {
  const t = calc.computeTotals({
    items: [{ qty: 3, rate: 0.1 }],
    taxRate: 8.875, discountType: 'percent', discountValue: 0, shipping: 0,
  });
  assert.equal(t.subtotal, 0.3);
  assert.equal(t.tax, 0.03);
  assert.equal(t.total, 0.33);
});

test('formatMoney uses symbol and decimals of the currency', () => {
  assert.equal(calc.formatMoney(1234.5, 'USD'), '$1,234.50');
  assert.equal(calc.formatMoney(1234.5, 'EUR'), '€1,234.50');
  assert.equal(calc.formatMoney(1234, 'JPY'), '¥1,234');
  assert.equal(calc.formatMoney(-5, 'GBP'), '-£5.00');
  assert.equal(calc.formatMoney(9.99, 'NZD'), 'NZ$9.99');
});

test('formatMoney falls back to code for unknown currency', () => {
  assert.equal(calc.formatMoney(3, 'XXX'), 'XXX 3.00');
});

test('nextInvoiceNumber increments and pads', () => {
  assert.equal(calc.nextInvoiceNumber('INV', 0), 'INV-001');
  assert.equal(calc.nextInvoiceNumber('FXR', 41), 'FXR-042');
  assert.equal(calc.nextInvoiceNumber('', 999), 'INV-1000');
  assert.equal(calc.nextInvoiceNumber('AISEE-', 4), 'AISEE-005');
});

test('addDays and formatDate', () => {
  assert.equal(calc.addDays('2026-09-03', 14), '2026-09-17');
  assert.equal(calc.addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(calc.formatDate('2026-09-03'), 'Sep 3, 2026');
  assert.equal(calc.formatDate(''), '');
});

test('parseNumber handles thousands separators and currency noise', () => {
  assert.equal(calc.parseNumber('1,250.75'), 1250.75);
  assert.equal(calc.parseNumber('$80'), 80);
  assert.equal(calc.parseNumber(''), 0);
  assert.equal(calc.parseNumber(undefined), 0);
});

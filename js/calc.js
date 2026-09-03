/* Pure invoice math. Loaded by the browser (global `Calc`) and by node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./currencies.js'));
  } else {
    root.Calc = factory(root.CURRENCIES);
  }
})(typeof self !== 'undefined' ? self : this, function (CURRENCIES) {
  'use strict';

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function parseNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const cleaned = String(v).replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function computeTotals(doc) {
    const items = Array.isArray(doc.items) ? doc.items : [];
    let subtotal = 0;
    const lines = items.map(function (it) {
      const qty = parseNumber(it.qty);
      const rate = parseNumber(it.rate);
      const amount = round2(qty * rate);
      subtotal += amount;
      return amount;
    });
    subtotal = round2(subtotal);

    const discountValue = Math.max(0, parseNumber(doc.discountValue));
    let discount = doc.discountType === 'fixed'
      ? discountValue
      : subtotal * (discountValue / 100);
    discount = round2(Math.min(discount, subtotal));

    const taxable = round2(subtotal - discount);
    const taxRate = Math.max(0, parseNumber(doc.taxRate));
    const tax = round2(taxable * (taxRate / 100));
    const shipping = round2(Math.max(0, parseNumber(doc.shipping)));
    const total = round2(taxable + tax + shipping);

    return { lines: lines, subtotal: subtotal, discount: discount, taxable: taxable, taxRate: taxRate, tax: tax, shipping: shipping, total: total };
  }

  function currencyInfo(code) {
    const list = CURRENCIES || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].code === code) return list[i];
    }
    return null;
  }

  function groupThousands(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatMoney(amount, code) {
    const info = currencyInfo(code);
    const decimals = info ? info.decimals : 2;
    const n = parseNumber(amount);
    const neg = n < 0;
    const abs = Math.abs(n).toFixed(decimals);
    const parts = abs.split('.');
    const body = groupThousands(parts[0]) + (parts[1] !== undefined ? '.' + parts[1] : '');
    const prefix = info ? info.symbol : (code ? code + ' ' : '');
    return (neg ? '-' : '') + prefix + body;
  }

  function nextInvoiceNumber(prefix, lastNumber) {
    let p = (prefix || 'INV').trim();
    if (!/[-_/ ]$/.test(p)) p += '-';
    const n = (parseInt(lastNumber, 10) || 0) + 1;
    return p + String(n).padStart(3, '0');
  }

  function addDays(isoDate, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 0));
    return d.toISOString().slice(0, 10);
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function formatDate(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
    if (!m) return '';
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  function todayISO() {
    const d = new Date();
    const pad = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  return {
    round2: round2,
    parseNumber: parseNumber,
    computeTotals: computeTotals,
    currencyInfo: currencyInfo,
    formatMoney: formatMoney,
    nextInvoiceNumber: nextInvoiceNumber,
    addDays: addDays,
    formatDate: formatDate,
    todayISO: todayISO,
  };
});

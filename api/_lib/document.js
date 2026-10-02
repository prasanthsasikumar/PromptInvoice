/* Turns an agent's JSON into the document shape the app renders, or a list of precise errors.
   Totals are never accepted from the caller: the app computes them in js/calc.js. */
'use strict';

const Calc = require('../../js/calc.js');

const TYPES = ['invoice', 'quote', 'estimate', 'receipt', 'voucher'];
const LIMITS = { items: 200, text: 2000, short: 200, customFields: 10, imageBytes: 1024 * 1024 };
const DEFAULT_NOTES = 'Payment due within 14 days. Thank you for your business!';
const IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
const KNOWN = ['docType', 'number', 'issueDate', 'dueDate', 'from', 'to', 'items', 'currency', 'taxRate', 'taxLabel',
  'discountType', 'discountValue', 'shipping', 'customFields', 'paymentDetails', 'paymentMethod', 'approvedBy', 'notes',
  'theme', 'layout'];
const FROM = ['name', 'email', 'phone', 'address', 'taxId', 'logo', 'signature'];
const TO = ['name', 'email', 'address', 'reference'];

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z')); }
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''));
  return NaN;
}

function normalize(body, today) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ field: field, message: message });
  today = today || new Date().toISOString().slice(0, 10);

  if (isObj(body) && isObj(body.document)) body = body.document;
  if (!isObj(body)) return { doc: null, errors: [{ field: '', message: 'Send a JSON object describing the document (see GET /api/pdf).' }], warnings: warnings };

  Object.keys(body).forEach((k) => {
    if (KNOWN.indexOf(k) < 0) warnings.push('Ignored unknown field "' + k + '"' + (/total|subtotal|amount/i.test(k) ? ' (totals are always calculated)' : ''));
  });

  const str = (field, v, max, required) => {
    if (v === undefined || v === null || v === '') { if (required) err(field, 'is required'); return ''; }
    if (typeof v !== 'string' && typeof v !== 'number') { err(field, 'must be text'); return ''; }
    v = String(v);
    if (v.length > max) err(field, 'is longer than ' + max + ' characters');
    return v;
  };
  const image = (field, v) => {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v !== 'string' || !IMAGE.test(v)) { err(field, 'must be a data URI: data:image/png|jpeg|webp|svg+xml;base64,...'); return ''; }
    if (v.length * 0.75 > LIMITS.imageBytes) err(field, 'is larger than 1 MB');
    return v;
  };
  const party = (key, fields, required) => {
    const src = body[key] === undefined ? {} : body[key];
    if (!isObj(src)) { err(key, 'must be an object'); return {}; }
    Object.keys(src).forEach((k) => { if (fields.indexOf(k) < 0) warnings.push('Ignored unknown field "' + key + '.' + k + '"'); });
    const out = {};
    fields.forEach((f) => {
      out[f] = (f === 'logo' || f === 'signature') ? image(key + '.' + f, src[f])
        : str(key + '.' + f, src[f], f === 'address' ? LIMITS.text : LIMITS.short, required.indexOf(f) >= 0);
    });
    return out;
  };

  const docType = body.docType === undefined ? 'invoice' : String(body.docType).toLowerCase();
  if (TYPES.indexOf(docType) < 0) err('docType', 'must be one of ' + TYPES.join(', '));
  const voucher = docType === 'voucher';

  const number = str('number', body.number, 60, true);
  const issueDate = body.issueDate === undefined ? today : body.issueDate;
  if (!validDate(issueDate)) err('issueDate', 'must be a date as YYYY-MM-DD');
  let dueDate = body.dueDate;
  if (dueDate === undefined || dueDate === null || dueDate === '') {
    dueDate = voucher || !validDate(issueDate) ? '' : Calc.addDays(issueDate, 14);
  } else if (!validDate(dueDate)) { err('dueDate', 'must be a date as YYYY-MM-DD'); }

  const from = party('from', FROM, ['name']);
  const to = party('to', TO, ['name']);

  const items = [];
  if (!Array.isArray(body.items) || body.items.length === 0) err('items', 'needs at least one line: [{ "description", "qty", "rate" }]');
  else if (body.items.length > LIMITS.items) err('items', 'has more than ' + LIMITS.items + ' lines');
  else body.items.forEach((it, i) => {
    const p = 'items[' + i + ']';
    if (!isObj(it)) { err(p, 'must be an object'); return; }
    const description = str(p + '.description', it.description, 500, true);
    const qty = it.qty === undefined ? 1 : num(it.qty);
    const rate = num(it.rate);
    if (isNaN(qty)) err(p + '.qty', 'must be a number');
    if (isNaN(rate)) err(p + '.rate', 'must be a number (the unit price)');
    items.push({ description: description, qty: qty, rate: rate });
  });

  const currency = body.currency === undefined ? 'USD' : String(body.currency).toUpperCase();
  if (!Calc.currencyInfo(currency)) err('currency', 'must be an ISO 4217 code the app knows, for example USD, SGD, NZD, EUR');

  const pct = (field, v, dflt) => {
    if (v === undefined || v === null || v === '') return dflt;
    const n = num(v);
    if (isNaN(n) || n < 0 || n > 100) { err(field, 'must be a number from 0 to 100'); return dflt; }
    return n;
  };
  const money = (field, v) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = num(v);
    if (isNaN(n) || n < 0) { err(field, 'must be a number of 0 or more'); return 0; }
    return n;
  };
  const taxRate = pct('taxRate', body.taxRate, 0);
  const discountType = body.discountType === undefined || body.discountType === null ? 'percent' : body.discountType;
  if (['percent', 'fixed'].indexOf(discountType) < 0) err('discountType', 'must be "percent" or "fixed"');
  const discountValue = discountType === 'percent' ? pct('discountValue', body.discountValue, 0) : money('discountValue', body.discountValue);

  const customFields = [];
  if (body.customFields !== undefined) {
    if (!Array.isArray(body.customFields) || body.customFields.length > LIMITS.customFields) err('customFields', 'must be a list of up to ' + LIMITS.customFields + ' { "label", "value" } pairs');
    else body.customFields.forEach((f, i) => {
      customFields.push({ label: str('customFields[' + i + '].label', isObj(f) ? f.label : undefined, 60, true),
        value: str('customFields[' + i + '].value', isObj(f) ? f.value : undefined, LIMITS.short, false) });
    });
  }

  const theme = body.theme === undefined ? '#166534' : body.theme;
  if (!/^#[0-9a-fA-F]{6}$/.test(theme)) err('theme', 'must be a hex colour like #166534');
  const layout = body.layout === undefined ? 'stacked' : body.layout;
  if (['stacked', 'side'].indexOf(layout) < 0) err('layout', 'must be "stacked" or "side"');

  const doc = {
    id: null, docType: docType, number: number, issueDate: issueDate, dueDate: dueDate,
    from: Object.assign({ profileId: 'api', prefix: '' }, from),
    to: Object.assign({ clientId: null }, to),
    items: items, currency: currency, taxRate: taxRate,
    taxLabel: str('taxLabel', body.taxLabel, 30, false) || 'Tax',
    discountType: discountType, discountValue: discountValue, shipping: money('shipping', body.shipping),
    customFields: customFields,
    paymentDetails: str('paymentDetails', body.paymentDetails, LIMITS.text, false),
    paymentMethod: str('paymentMethod', body.paymentMethod, 100, false),
    approvedBy: str('approvedBy', body.approvedBy, 100, false),
    notes: body.notes === undefined ? (voucher ? '' : DEFAULT_NOTES) : str('notes', body.notes, LIMITS.text, false),
    theme: theme, layout: layout,
  };
  return { doc: errors.length ? null : doc, errors: errors, warnings: warnings };
}

module.exports = { normalize: normalize, LIMITS: LIMITS, TYPES: TYPES, FROM: FROM, TO: TO };

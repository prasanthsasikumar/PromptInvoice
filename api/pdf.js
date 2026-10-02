/* Vercel serverless function: document JSON in, PDF out. Built for agents; see /agents for the full guide.
   GET returns machine-readable usage. POST renders with the app's own page and print styles (api/_lib/render.js). */
'use strict';

const { normalize, LIMITS, TYPES } = require('./_lib/document.js');
const analytics = require('./_lib/analytics.js');

const DOCS = 'https://invoice.flowsxr.com/agents';
const MAX_BODY = 4 * 1024 * 1024;
let renderer = null;
let tracker = null;
const track = (req, params) => (tracker || analytics.track)(req, 'api_pdf', params);

const EXAMPLE = {
  docType: 'voucher',
  number: 'PV-2026-014',
  issueDate: '2026-10-02',
  from: { name: 'Studio Nova Ltd', email: 'billing@studionova.com', address: '12 Example Street\nAuckland 1010' },
  to: { name: 'Jane Contractor', email: 'jane@example.com' },
  items: [
    { description: 'Design services, September 2026', qty: 1, rate: 350 },
    { description: 'Advance for October 2026 (deducted from the October payment)', qty: 1, rate: 200 },
  ],
  currency: 'SGD',
  paymentMethod: 'Bank transfer',
  approvedBy: 'Alex Owner',
};

const USAGE = {
  name: 'PromptInvoice PDF API',
  docs: DOCS,
  request: { method: 'POST', url: 'https://invoice.flowsxr.com/api/pdf', contentType: 'application/json', body: 'the document object (optionally wrapped as { "document": {...} })' },
  response: { success: '200 application/pdf (the file)', invalid: '400 { error, details: [{ field, message }], warnings }', tooLarge: '413', failure: '500 { error, message }' },
  fields: {
    docType: 'one of ' + TYPES.join(', ') + ' (default invoice). "voucher" means you are paying someone.',
    number: 'required, your document number, e.g. INV-0042 or PV-2026-014',
    issueDate: 'YYYY-MM-DD, default today',
    dueDate: 'YYYY-MM-DD, default issueDate + 14 days (not shown on vouchers). For receipts this is the paid-on date.',
    from: '{ name (required), email, phone, address, taxId, logo, signature }; logo and signature are data:image/...;base64 URIs up to 1 MB',
    to: '{ name (required), email, address, reference }',
    items: '1 to ' + LIMITS.items + ' lines of { description, qty (default 1), rate (unit price) }',
    currency: 'ISO 4217 code, default USD',
    taxRate: 'percent 0 to 100, default 0', taxLabel: 'e.g. GST, VAT (default Tax)',
    discountType: 'percent | fixed', discountValue: 'number', shipping: 'number',
    customFields: 'up to ' + LIMITS.customFields + ' { label, value } pairs shown in the header',
    paymentDetails: 'bank details or payment instructions', paymentMethod: 'mainly for vouchers, e.g. Bank transfer',
    approvedBy: 'vouchers: name printed under the signature', notes: 'free text at the bottom',
    theme: 'hex accent colour, default #166534', layout: 'stacked | side (parties side by side)',
  },
  notes: ['Totals are always calculated from the items; do not send them.', 'Nothing is stored. Keep the PDF you receive.'],
  example: EXAMPLE,
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-PromptInvoice-Warnings');
}

function filename(doc) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean(doc.number) + ' - ' + (clean(doc.to.name) || doc.docType)).slice(0, 120) + '.pdf';
}

async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204); return res.end(); }
  if (req.method === 'GET') return res.status(200).json(USAGE);
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).json({ error: 'Use POST with a JSON document, or GET for usage.', help: DOCS }); }

  let body = req.body;
  const size = typeof body === 'string' ? body.length : JSON.stringify(body || {}).length;
  if (size > MAX_BODY) return res.status(413).json({ error: 'Request body is larger than 4 MB. Shrink the logo or signature images.', help: DOCS });
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Body is not valid JSON.', help: DOCS }); }
  }

  const { doc, errors, warnings } = normalize(body);
  if (warnings.length) res.setHeader('X-PromptInvoice-Warnings', JSON.stringify(warnings));
  if (errors.length) {
    await track(req, { status: 'invalid', error_count: errors.length });
    return res.status(400).json({ error: 'The document has problems. Fix the fields listed and send it again.', details: errors, warnings: warnings, help: DOCS });
  }

  try {
    const render = renderer || require('./_lib/render.js').render;
    const pdf = await render(doc);
    await track(req, { status: 'ok', doc_type: doc.docType, currency: doc.currency, line_count: doc.items.length });
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + filename(doc) + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(pdf);
  } catch (e) {
    console.error('pdf render failed', e);
    await track(req, { status: 'error', doc_type: doc.docType });
    return res.status(500).json({ error: 'Could not render the PDF. Try again; if it keeps failing, report it.', message: String(e.message || e).slice(0, 300), help: DOCS });
  }
}

module.exports = handler;
module.exports.setRenderer = function (fn) { renderer = fn; };
module.exports.setTracker = function (fn) { tracker = fn; };
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

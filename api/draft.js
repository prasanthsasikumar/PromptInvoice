/* Vercel serverless function: plain-English description -> structured invoice fields via DeepSeek.
   The API key lives in the DEEPSEEK_API_KEY environment variable and never reaches the browser. */
'use strict';

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const MAX_DESCRIPTION = 20000;

const EXAMPLE = {
  docType: 'invoice | quote | estimate | receipt',
  client: { name: 'string|null', email: 'string|null', address: 'string|null' },
  items: [{ description: 'string', qty: 1, rate: 100 }],
  currency: 'ISO 4217 code|null',
  taxRate: 'number|null',
  taxLabel: 'string|null',
  discountType: 'percent | fixed | null',
  discountValue: 'number|null',
  shipping: 'number|null',
  dueInDays: 'integer|null',
  reference: 'string|null',
  notes: 'string|null',
};

function systemPrompt(ctx) {
  ctx = ctx || {};
  return [
    'You turn a freelancer\'s plain-English description of work into invoice fields.',
    'Respond with a single JSON object only, no prose, matching this shape exactly:',
    JSON.stringify(EXAMPLE),
    'Extract only what the description states or clearly implies. Use null for anything not mentioned.',
    'Rules:',
    '- items: one line per distinct service or product. qty is a count or hours; rate is the unit price. For a flat fee use qty 1.',
    '- currency: ISO 4217 code. Infer from symbols or context ("$" with an NZ address means NZD, "£" means GBP). If unknown, null.',
    '- taxRate: percentage number (15 for 15%). taxLabel: the tax name used (GST, VAT, Sales tax). null if no tax mentioned.',
    '- dueInDays: payment terms in days ("net 30" -> 30, "due on receipt" -> 0).',
    '- reference: PO or project reference if given.',
    '- notes: short payment-terms or thank-you sentence only if the description asks for one.',
    '- docType: quote/estimate/receipt only if the description says so; otherwise "invoice".',
    'Issuing business is already known: ' + (ctx.fromName || 'unknown') + '.',
    'Default currency for this business: ' + (ctx.currency || 'USD') + '. Default tax: ' + (ctx.taxRate || 0) + '% ' + (ctx.taxLabel || '') + '.',
    'Known clients (reuse exact name and details when the description refers to one): ' + (ctx.clients && ctx.clients.length ? JSON.stringify(ctx.clients) : 'none') + '.',
    'Today is ' + (ctx.today || new Date().toISOString().slice(0, 10)) + '.',
  ].join('\n');
}

function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function num(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
function oneOf(v, allowed) { return allowed.indexOf(v) >= 0 ? v : null; }

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const c = d.client && typeof d.client === 'object' ? d.client : {};
  const items = Array.isArray(d.items) ? d.items : [];
  const due = num(d.dueInDays);
  return {
    docType: oneOf(d.docType, ['invoice', 'quote', 'estimate', 'receipt']) || 'invoice',
    client: { name: str(c.name), email: str(c.email), address: str(c.address) },
    items: items
      .filter(function (it) { return it && typeof it === 'object'; })
      .map(function (it) { return { description: str(it.description) || '', qty: num(it.qty) === null ? 1 : num(it.qty), rate: num(it.rate) === null ? 0 : num(it.rate) }; })
      .filter(function (it) { return it.description; }),
    currency: str(d.currency),
    taxRate: num(d.taxRate),
    taxLabel: str(d.taxLabel),
    discountType: oneOf(d.discountType, ['percent', 'fixed']),
    discountValue: num(d.discountValue),
    shipping: num(d.shipping),
    dueInDays: due === null ? null : Math.round(due),
    reference: str(d.reference),
    notes: str(d.notes),
  };
}

function parseJson(text) {
  text = String(text || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* fall through */ }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'Describe the work first.' });
  if (description.length > MAX_DESCRIPTION) return res.status(400).json({ error: 'That description is too long. Keep it under ' + MAX_DESCRIPTION + ' characters.' });

  const apiKey = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'AI drafting is not configured on this server.' });

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(body.ctx) },
          { role: 'user', content: description },
        ],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the AI service. Try again in a moment.' });
  }

  if (!upstream.ok) {
    let msg = 'AI service error ' + upstream.status;
    try { const err = await upstream.json(); if (err && err.error && err.error.message) msg = err.error.message; } catch (e) { /* ignore */ }
    if (upstream.status === 401 || upstream.status === 403) return res.status(502).json({ error: 'The AI service rejected the server\'s key. Contact the site owner.' });
    if (upstream.status === 429 || upstream.status === 503) return res.status(429).json({ error: 'The AI service is busy. Try again in a moment.' });
    return res.status(502).json({ error: msg });
  }

  let data;
  try { data = await upstream.json(); } catch (e) { data = null; }
  const choice = data && data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (choice && choice.finish_reason === 'length') return res.status(502).json({ error: 'The response was cut off. Try a shorter description.' });
  const parsed = parseJson(text);
  if (!parsed) return res.status(502).json({ error: 'Could not read the drafted invoice. Try rephrasing.' });
  return res.status(200).json(normalize(parsed));
};

module.exports.systemPrompt = systemPrompt;
module.exports.normalize = normalize;

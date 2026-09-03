/* AI drafting: plain-English description -> structured invoice fields via the Anthropic Messages API.
   Runs in the browser with the user's own key (stored locally). */
(function (root) {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-opus-5';

  function nullable(type, extra) {
    return { anyOf: [Object.assign({ type: type }, extra || {}), { type: 'null' }] };
  }

  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['docType', 'client', 'items', 'currency', 'taxRate', 'taxLabel', 'discountType', 'discountValue', 'shipping', 'dueInDays', 'reference', 'notes'],
    properties: {
      docType: nullable('string', { enum: ['invoice', 'quote', 'estimate', 'receipt'] }),
      client: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'address'],
        properties: {
          name: nullable('string'),
          email: nullable('string'),
          address: nullable('string'),
        },
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'qty', 'rate'],
          properties: {
            description: { type: 'string' },
            qty: { type: 'number' },
            rate: { type: 'number' },
          },
        },
      },
      currency: nullable('string'),
      taxRate: nullable('number'),
      taxLabel: nullable('string'),
      discountType: nullable('string', { enum: ['percent', 'fixed'] }),
      discountValue: nullable('number'),
      shipping: nullable('number'),
      dueInDays: nullable('integer'),
      reference: nullable('string'),
      notes: nullable('string'),
    },
  };

  function systemPrompt(ctx) {
    return [
      'You turn a freelancer\'s plain-English description of work into invoice fields.',
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
      'Today is ' + ctx.today + '.',
    ].join('\n');
  }

  async function draft(description, ctx, settings) {
    const apiKey = (settings && settings.apiKey || '').trim();
    if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
    const model = (settings && settings.model) || DEFAULT_MODEL;

    const body = {
      model: model,
      max_tokens: 4096,
      system: systemPrompt(ctx),
      messages: [{ role: 'user', content: description }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    };
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (model === 'claude-opus-5') {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }

    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Network error reaching the Anthropic API. Check your connection.');
    }

    if (!res.ok) {
      let msg = 'API error ' + res.status;
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (e) { /* ignore */ }
      if (res.status === 401) msg = 'Invalid API key. Check Settings.';
      if (res.status === 429) msg = 'Rate limited by the API. Try again in a moment.';
      throw new Error(msg);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('The model declined to draft this description.' + (data.stop_details && data.stop_details.explanation ? ' ' + data.stop_details.explanation : ''));
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('The response was cut off. Try a shorter description.');
    }
    const text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('Could not read the drafted invoice. Try rephrasing.');
    }
    return parsed;
  }

  root.AI = { draft: draft, DEFAULT_MODEL: DEFAULT_MODEL, SCHEMA: SCHEMA };
})(window);

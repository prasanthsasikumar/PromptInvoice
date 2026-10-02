/* Anonymous usage events for the PDF API, sent to Google Analytics 4 through the Measurement Protocol.
   Agents never load a web page, so this is the only way to see where API use comes from.
   Sends: event name, status, document type, currency, line count, caller family, and the request's
   country / region / city from Vercel's geo headers. Never names, amounts or any document text.
   Off unless GA_MEASUREMENT_ID and GA_API_SECRET are set. Never throws, never waits more than timeoutMs. */
'use strict';

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';

function clientKind(ua) {
  const s = String(ua || '').toLowerCase();
  if (!s) return 'unknown';
  if (/claude|anthropic|openai|chatgpt|gpt|gemini|perplexity|bot\b|agent/.test(s)) return 'ai-agent';
  if (s.startsWith('curl')) return 'curl';
  if (/python|aiohttp|httpx/.test(s)) return 'python';
  if (/^node|undici|axios|node-fetch/.test(s)) return 'node';
  if (/mozilla|chrome|safari|firefox/.test(s)) return 'browser';
  return 'other';
}

function header(req, name) {
  const v = req && req.headers ? req.headers[name] : '';
  if (!v) return '';
  try { return decodeURIComponent(String(v)); } catch (e) { return String(v); }
}

async function track(req, name, params, opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const doFetch = opts.fetch || globalThis.fetch;
  if (!env.GA_MEASUREMENT_ID || !env.GA_API_SECRET || !doFetch) return;

  const country = header(req, 'x-vercel-ip-country');
  const city = header(req, 'x-vercel-ip-city');
  const body = {
    // A random id per request: no cookies, nothing that identifies the caller across requests.
    client_id: Math.floor(Math.random() * 1e10) + '.' + Math.floor(Date.now() / 1000),
    events: [{ name: name, params: Object.assign({
      country: country, region: header(req, 'x-vercel-ip-country-region'), city: city,
      client: clientKind(header(req, 'user-agent')), engagement_time_msec: 1,
    }, params || {}) }],
  };
  if (country) body.user_location = Object.assign({ country_id: country }, city ? { city: city } : {});

  const url = ENDPOINT + '?measurement_id=' + encodeURIComponent(env.GA_MEASUREMENT_ID) + '&api_secret=' + encodeURIComponent(env.GA_API_SECRET);
  const send = Promise.resolve().then(() => doFetch(url, { method: 'POST', body: JSON.stringify(body) })).catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, opts.timeoutMs || 800));
  await Promise.race([send, timeout]);
}

module.exports = { track: track, clientKind: clientKind };

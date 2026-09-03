// End-to-end smoke test: drives the real page in headless Chrome over the DevTools protocol.
// Run: npm run test:browser   (needs Google Chrome installed; set CHROME to override the path)
import { spawn } from 'node:child_process';
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = 'file://' + path.join(ROOT, 'index.html');

let chrome, ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function navigate() {
  await send('Page.navigate', { url: URL_ });
  await new Promise(r => setTimeout(r, 400));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

before(async () => {
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(ROOT, 'tests', '.chrome-profile'), 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch { }
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await navigate();
  await evalJs('localStorage.clear(); location.reload(); true');
  await sleep(500);
});

after(() => { try { ws.close(); } catch { } chrome.kill(); });

// Helper injected into the page to set a field and fire input.
const setField = (sel, value) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`;

test('seeds a default business and shows INV-001', async () => {
  const opts = await evalJs(`[...document.querySelectorAll('#profile-select option')].map(o => o.textContent)`);
  assert.deepEqual(opts, ['My business']);
  assert.equal(await evalJs(`document.querySelector('[data-bind="number"]').value`), 'INV-001');
  assert.match(await evalJs(`document.querySelector('#paper .p-title').textContent`), /INVOICE/);
});

test('line items and totals update live in the preview', async () => {
  await evalJs(setField('#items .item-row input[data-f=description]', 'Unity development'));
  await evalJs(setField('#items .item-row input[data-f=qty]', '24'));
  await evalJs(setField('#items .item-row input[data-f=rate]', '120'));
  await evalJs(`document.querySelector('#item-add').click(); true`);
  await evalJs(setField('#items .item-row:nth-child(2) input[data-f=description]', 'Quest 3 device'));
  await evalJs(setField('#items .item-row:nth-child(2) input[data-f=rate]', '650'));
  await evalJs(setField('[data-bind="taxRate"]', '15'));
  await evalJs(setField('[data-bind="taxLabel"]', 'GST'));
  const totals = await evalJs(`[...document.querySelectorAll('#paper .p-totals td.r')].map(td => td.textContent)`);
  // 24*120 = 2880 + 650 = 3530; GST 15% = 529.50; total 4059.50
  assert.deepEqual(totals, ['$3,530.00', '$529.50', '$4,059.50']);
  assert.equal(await evalJs(`document.querySelector('#items .item-row .amount').textContent`), '$2,880.00');
});

test('discount, shipping and currency change flow through', async () => {
  await evalJs(setField('[data-bind="discountType"]', 'fixed'));
  await evalJs(setField('[data-bind="discountValue"]', '30'));
  await evalJs(setField('[data-bind="shipping"]', '20'));
  await evalJs(setField('#currency-select', 'EUR'));
  const totals = await evalJs(`[...document.querySelectorAll('#paper .p-totals td.r')].map(td => td.textContent)`);
  // 3530 - 30 = 3500; tax 525; + 20 shipping = 4045
  assert.deepEqual(totals, ['€3,530.00', '-€30.00', '€525.00', '€20.00', '€4,045.00']);
  await evalJs(setField('#currency-select', 'USD'));
});

test('document type switches labels; receipt shows PAID', async () => {
  await evalJs(`document.querySelector('#doc-type [data-doctype=quote]').click(); true`);
  assert.equal(await evalJs(`document.querySelector('#paper .p-title').textContent`), 'QUOTE');
  assert.equal(await evalJs(`document.querySelector('#due-label').textContent`), 'Valid until');
  await evalJs(`document.querySelector('#doc-type [data-doctype=receipt]').click(); true`);
  assert.equal(await evalJs(`!!document.querySelector('#paper .p-paid')`), true);
  await evalJs(`document.querySelector('#doc-type [data-doctype=invoice]').click(); true`);
});

test('payment terms select sets the due date', async () => {
  await evalJs(setField('[data-bind="issueDate"]', '2026-09-03'));
  await evalJs(setField('#terms-select', '30'));
  assert.equal(await evalJs(`document.querySelector('[data-bind="dueDate"]').value`), '2026-10-03');
});

test('client can be saved and re-selected', async () => {
  await evalJs(setField('[data-bind="to.name"]', 'Aisee Ltd'));
  await evalJs(setField('[data-bind="to.email"]', 'accounts@aisee.example'));
  await evalJs(`document.querySelector('#client-save').click(); true`);
  const opts = await evalJs(`[...document.querySelectorAll('#client-select option')].map(o => o.textContent)`);
  assert.ok(opts.includes('Aisee Ltd'));
  await evalJs(setField('[data-bind="to.name"]', ''));
  await evalJs(`{ const s = document.querySelector('#client-select'); s.value = [...s.options].find(o => o.textContent === 'Aisee Ltd').value; s.dispatchEvent(new Event('change')); } true`);
  assert.equal(await evalJs(`document.querySelector('[data-bind="to.name"]').value`), 'Aisee Ltd');
});

test('draft survives reload; save adds to list and bumps the profile counter', async () => {
  await evalJs(`location.reload(); true`);
  await sleep(600);
  assert.equal(await evalJs(`document.querySelector('[data-bind="to.name"]').value`), 'Aisee Ltd');
  assert.equal(await evalJs(`document.querySelectorAll('#items .item-row').length`), 2);
  await evalJs(`document.querySelector('#save-invoice').click(); true`);
  assert.equal(await evalJs(`document.querySelectorAll('#saved-list .saved-item').length`), 1);
  await evalJs(`document.querySelector('#new-invoice').click(); true`);
  assert.equal(await evalJs(`document.querySelector('[data-bind="number"]').value`), 'INV-002');
  assert.equal(await evalJs(`document.querySelectorAll('#items .item-row').length`), 1);
});

test('adding and switching business profile changes prefix and numbering', async () => {
  await evalJs(`window.prompt = () => 'Aisee'; document.querySelector('#profile-new').click(); true`);
  assert.equal(await evalJs(`document.querySelector('[data-bind="number"]').value`), 'AISEE-001');
  await evalJs(`{ const s = document.querySelector('#profile-select'); s.value = [...s.options].find(o => o.textContent === 'My business').value; s.dispatchEvent(new Event('change')); } true`);
  assert.equal(await evalJs(`document.querySelector('[data-bind="number"]').value`), 'INV-002');
  await evalJs(`{ const s = document.querySelector('#profile-select'); s.value = [...s.options].find(o => o.textContent === 'Aisee').value; s.dispatchEvent(new Event('change')); } true`);
  assert.equal(await evalJs(`document.querySelector('[data-bind="number"]').value`), 'AISEE-001');
  assert.equal(await evalJs(`document.querySelector('#paper .p-name').textContent`), 'Aisee');
});

test('AI draft fills the form (API mocked)', async () => {
  await evalJs(`localStorage.setItem('pi.settings', JSON.stringify({apiKey: 'sk-test', model: 'claude-opus-5'})); true`);
  await evalJs(`window.__lastReq = null; window.fetch = async (url, opts) => { window.__lastReq = {url, headers: opts.headers, body: JSON.parse(opts.body)}; return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ docType: 'invoice', client: { name: 'Acme Corp', email: 'billing@acme.com', address: null }, items: [{ description: 'Logo design', qty: 1, rate: 600 }, { description: 'Design hours', qty: 12, rate: 75 }], currency: 'USD', taxRate: 8.5, taxLabel: 'Sales tax', discountType: null, discountValue: null, shipping: null, dueInDays: 15, reference: null, notes: null }) }] }) }; }; true`);
  await evalJs(setField('#ai-prompt', 'Designed a logo and landing page for Acme Corp'));
  await evalJs(`document.querySelector('#ai-generate').click(); true`);
  await sleep(300);
  const req = await evalJs('window.__lastReq');
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(await evalJs(`document.querySelector('[data-bind="to.name"]').value`), 'Acme Corp');
  assert.equal(await evalJs(`document.querySelectorAll('#items .item-row').length`), 2);
  const totals = await evalJs(`[...document.querySelectorAll('#paper .p-totals td.r')].map(td => td.textContent)`);
  // 600 + 900 = 1500; 8.5% = 127.50; total 1627.50
  assert.deepEqual(totals, ['$1,500.00', '$127.50', '$1,627.50']);
  assert.equal(await evalJs(`document.querySelector('[data-bind="dueDate"]').value`), '2026-09-18');
});

test('backup export contains profiles, clients and invoices', async () => {
  const data = await evalJs('Store.exportAll()');
  assert.equal(data.app, 'PromptInvoice');
  assert.equal(data.profiles.length, 2);
  assert.equal(await evalJs('Auth.configured()'), false);
  assert.equal(await evalJs(`document.querySelector('#open-auth').hidden`), true);
  assert.equal(data.clients.length, 1);
  assert.equal(data.invoices.length, 1);
});

test('cloud mode: attaching a remote workspace swaps data and mirrors writes', async () => {
  await evalJs(`window.__remote = { ups: [], dels: [], upsert: async (k, r) => { window.__remote.ups.push([k, r.id]); }, remove: async (k, id) => { window.__remote.dels.push([k, id]); } }; true`);
  await evalJs(`Store.attachRemote(window.__remote, { profiles: [{ id: 'p1', name: 'Aisee Cloud', prefix: 'AC', counter: 7, currency: 'NZD', taxRate: 15, taxLabel: 'GST' }], clients: [], invoices: [] }); true`);
  assert.equal(await evalJs('Store.isRemote()'), true);
  assert.deepEqual(await evalJs(`Store.profiles().map(p => p.name)`), ['Aisee Cloud']);
  await evalJs(`Store.saveClient({ name: 'Remote client' }); true`);
  const ups = await evalJs('window.__remote.ups');
  assert.equal(ups.length, 1);
  assert.equal(ups[0][0], 'clients');
  // local data untouched while remote is attached
  assert.equal(await evalJs('Store.localSnapshot().clients.length'), 1);
  await evalJs('Store.detachRemote(); true');
  assert.deepEqual(await evalJs(`Store.profiles().map(p => p.name)`), ['My business', 'Aisee']);
});

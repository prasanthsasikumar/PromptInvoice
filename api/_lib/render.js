/* Renders a normalised document to PDF with the app's own page, so API output matches the Download PDF button.
   The page, CSS and JS are served from this deployment's files through request interception on a private origin.
   Everything else (sign-in SDK, fonts on other hosts) is blocked: renders are fast, private and repeatable.
   Local runs set CHROME to a Chrome binary; on Vercel the bundled @sparticuz/chromium is used. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ORIGIN = 'https://render.promptinvoice.invalid';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SERVED = /^\/(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js)$/;
const LOCAL_CONFIG = 'window.PI_CONFIG = { supabaseUrl: "", supabaseAnonKey: "" };';

let browserPromise = null;

// Both packages are ES modules: load them with import(), which works in every Node version Vercel runs.
// Literal specifiers matter: Vercel only bundles packages its tracer can see by name.
const loadPuppeteer = () => import('puppeteer-core').then((m) => m.default || m);
const loadChromium = () => import('@sparticuz/chromium').then((m) => m.default || m);

async function launch() {
  const puppeteer = await loadPuppeteer();
  if (process.env.CHROME) {
    return puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  }
  const chromium = await loadChromium();
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
}

async function browser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
  }
  browserPromise = launch();
  return browserPromise;
}

function serve(request) {
  const url = new URL(request.url());
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p === '/js/config.js') return request.respond({ status: 200, contentType: 'text/javascript', body: LOCAL_CONFIG });
  if (!SERVED.test(p)) return request.respond({ status: 404, body: 'not found' });
  const file = path.join(ROOT, p);
  return request.respond({ status: 200, contentType: TYPES[path.extname(file)], body: fs.readFileSync(file) });
}

function profileFor(doc) {
  const f = doc.from;
  return {
    id: f.profileId, name: f.name, email: f.email, phone: f.phone, address: f.address, taxId: f.taxId, logo: f.logo,
    signature: f.signature, prefix: '', counter: 0, currency: doc.currency, taxRate: doc.taxRate, taxLabel: doc.taxLabel,
    paymentDetails: doc.paymentDetails, notes: doc.notes, theme: doc.theme, layout: doc.layout,
  };
}

async function render(doc) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().startsWith(ORIGIN)) return serve(r);
      if (r.url().startsWith('data:')) return r.continue();
      return r.abort();
    });
    await page.evaluateOnNewDocument((profiles, draft) => {
      localStorage.clear();
      localStorage.setItem('pi.profiles', profiles);
      localStorage.setItem('pi.clients', '[]');
      localStorage.setItem('pi.draft', draft);
    }, JSON.stringify([profileFor(doc)]), JSON.stringify(doc));
    await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction((n) => {
      const el = document.querySelector('.paper-wrap');
      return el && el.innerText.indexOf(n) >= 0;
    }, { timeout: 10000 }, doc.number);
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close().catch(() => {});
  }
}

async function close() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close();
}

module.exports = { render: render, close: close, ORIGIN: ORIGIN };

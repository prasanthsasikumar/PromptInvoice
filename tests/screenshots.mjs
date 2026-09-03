// Generates the README screenshots in docs/screenshots using headless Chrome.
// Run: npm run screenshots   (set CHROME to override the browser path)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const URL_ = 'file://' + path.join(ROOT, 'index.html');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const profileDir = path.join(ROOT, 'tests', '.chrome-profile-shots');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + profileDir, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value;

const sample = {
  profiles: [{ id: 'p1', name: 'Studio Nova Ltd', email: 'billing@studionova.com', phone: '+64 21 555 0100', address: '12 Example Street\nAuckland 1010, New Zealand', taxId: '123-456-789', prefix: 'SN', counter: 41, currency: 'NZD', taxRate: 15, taxLabel: 'GST', paymentDetails: 'Bank: Example Bank\nAccount name: Studio Nova Ltd\nAccount no: 01-0000-0000000-00\nReference: SN-042', notes: 'Payment due within 14 days. Thank you for your business!', theme: '#166534' }],
  clients: [{ id: 'c1', name: 'Acme Corp', email: 'ap@acme.com', address: '456 Broadway\nNew York, NY 10013' }],
  invoices: [],
};
const draft = {
  id: null, docType: 'invoice', number: 'SN-042', issueDate: '2026-09-03', dueDate: '2026-09-17',
  from: { profileId: 'p1', name: sample.profiles[0].name, email: sample.profiles[0].email, phone: sample.profiles[0].phone, address: sample.profiles[0].address, taxId: sample.profiles[0].taxId, prefix: 'SN', logo: '' },
  to: { clientId: 'c1', name: 'Acme Corp', email: 'ap@acme.com', address: '456 Broadway\nNew York, NY 10013', reference: 'PO-2026-014' },
  items: [
    { description: 'Mixed-reality prototype — Unity development', qty: 24, rate: 120 },
    { description: 'Meta Quest 3 headset (supplied)', qty: 1, rate: 650 },
    { description: 'On-site user testing session', qty: 2, rate: 450 },
  ],
  currency: 'NZD', taxRate: 15, taxLabel: 'GST', discountType: 'percent', discountValue: 0, shipping: 0,
  customFields: [{ label: 'Project', value: 'September prototype' }],
  paymentDetails: sample.profiles[0].paymentDetails, notes: sample.profiles[0].notes, theme: '#166534',
};

async function shot(file, clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: clip ? { ...clip, scale: 1 } : undefined, captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
  console.log('wrote', file);
}

async function main() {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch { }
    await sleep(200);
  }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(500);
  await evalJs(`localStorage.clear(); localStorage.setItem('pi.profiles', ${JSON.stringify(JSON.stringify(sample.profiles))}); localStorage.setItem('pi.clients', ${JSON.stringify(JSON.stringify(sample.clients))}); localStorage.setItem('pi.draft', ${JSON.stringify(JSON.stringify(draft))}); true`);
  await send('Page.navigate', { url: URL_ });
  await sleep(700);

  // 1. Hero
  await shot('hero.png', { x: 0, y: 0, width: 1440, height: 620 });

  // 2. Generator (form + live preview)
  const gen = await evalJs(`(() => { const r = document.querySelector('#generate').getBoundingClientRect(); return { y: r.top + window.scrollY, h: r.height }; })()`);
  await shot('generator.png', { x: 0, y: gen.y, width: 1440, height: Math.min(gen.h, 1500) });

  // 3. Invoice preview close-up
  const paper = await evalJs(`(() => { const r = document.querySelector('.paper-wrap').getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  await shot('invoice-preview.png', { x: paper.x - 12, y: paper.y - 12, width: paper.w + 24, height: paper.h + 24 });

  // 4. Full page
  const full = await evalJs('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: full, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await shot('full-page.png');

  // 5. The PDF itself
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(OUT, 'sample-invoice.pdf'), Buffer.from(pdf.result.data, 'base64'));
  console.log('wrote sample-invoice.pdf');

  ws.close();
  chrome.kill();
  await sleep(800);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* Chrome may still be closing; the dir is gitignored */ }
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

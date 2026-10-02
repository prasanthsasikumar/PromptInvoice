// Real render through api/_lib/render.js with local Chrome. Run: npm run test:browser
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { render, close } = require('../api/_lib/render.js');
test.after(() => close());
const { normalize } = require('../api/_lib/document.js');

function pdfText(buf) {
  const f = path.join(os.tmpdir(), 'pi-render-' + process.pid + '.pdf');
  fs.writeFileSync(f, buf);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); }
}

test('renders a payment voucher with the app layout and computed total', { timeout: 60000 }, async () => {
  const { doc, errors } = normalize({
    docType: 'voucher', number: 'PV-TEST-01', issueDate: '2026-10-02', currency: 'SGD',
    from: { name: 'FLOWXR PTE. LTD.' }, to: { name: 'Ovindu Atukorala' }, approvedBy: 'Prasanth Sasikumar', paymentMethod: 'Bank transfer',
    items: [{ description: 'Services September 2026', qty: 1, rate: 350 }, { description: 'Advance for October 2026', qty: 1, rate: 200 }],
  });
  assert.deepEqual(errors, []);
  const pdf = await render(doc);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const text = pdfText(pdf);
  for (const s of ['PAYMENT VOUCHER', 'PV-TEST-01', 'Ovindu Atukorala', 'Advance for October 2026', '550.00', 'Bank transfer']) {
    assert.ok(text.includes(s), 'missing "' + s + '" in:\n' + text);
  }
  assert.ok(!/Sign in|Describe the work/.test(text), 'app chrome leaked into the PDF');
});

test('renders an invoice with tax and escapes markup in text', { timeout: 60000 }, async () => {
  const { doc } = normalize({
    number: 'INV-<b>9</b>', from: { name: 'Studio <Nova>' }, to: { name: 'Acme' }, currency: 'NZD', taxRate: 15, taxLabel: 'GST',
    items: [{ description: 'Prototype', qty: 10, rate: 100 }],
  });
  const text = pdfText(await render(doc));
  assert.ok(text.includes('INVOICE'));
  assert.ok(text.includes('INV-<b>9</b>'), text);
  assert.ok(text.includes('1,150.00'), text);
});

test('a business with no contact details does not print the placeholder hint', { timeout: 60000 }, async () => {
  const { doc } = normalize({ number: 'INV-1', from: { name: 'Bare Co' }, to: { name: 'Acme' }, items: [{ description: 'x', rate: 1 }] });
  const text = pdfText(await render(doc));
  assert.ok(text.includes('Bare Co'));
  assert.ok(!text.includes('you@example.com'), text);
  assert.ok(!text.includes('Your address'), text);
});

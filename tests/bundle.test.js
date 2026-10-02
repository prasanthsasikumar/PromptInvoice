// Vercel bundles a function's files by tracing its imports. If the renderer's packages are not traced,
// production fails with "Cannot find package". This runs the same tracer Vercel uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { nodeFileTrace } = require('@vercel/nft');

test('api/pdf.js bundle includes puppeteer-core and the Chromium binary', { timeout: 60000 }, async () => {
  const root = path.join(__dirname, '..');
  const { fileList } = await nodeFileTrace([path.join(root, 'api/pdf.js')], { base: root });
  const files = [...fileList];
  assert.ok(files.some((f) => f.startsWith('node_modules/puppeteer-core/')), 'puppeteer-core not traced');
  assert.ok(files.some((f) => /node_modules\/@sparticuz\/chromium\/bin\/.+\.br$/.test(f)), 'chromium binary not traced');
});

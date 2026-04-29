const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'dist', 'manifest.json');

function fail(message) {
  console.error(`Production manifest validation failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  fail('dist/manifest.json does not exist. Run vite build first.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const serviceWorker = manifest.background?.service_worker;

if (serviceWorker === 'service-worker-loader.js') {
  fail('dist/manifest.json still points to CRXJS dev service-worker-loader.js.');
}

if (typeof serviceWorker === 'string') {
  const serviceWorkerPath = path.join(root, 'dist', serviceWorker);
  if (fs.existsSync(serviceWorkerPath)) {
    const source = fs.readFileSync(serviceWorkerPath, 'utf8');
    if (source.includes('localhost:') || source.includes('/@vite/') || source.includes('/@crx/')) {
      fail(`background service worker ${serviceWorker} contains dev-server imports.`);
    }
  }
}

const resources = manifest.web_accessible_resources ?? [];
const hasDevWideOpenResources = resources.some((entry) => {
  const entryResources = entry.resources ?? [];
  return entryResources.includes('**/*') || entryResources.includes('*');
});

if (hasDevWideOpenResources) {
  fail('dist/manifest.json contains CRXJS dev web_accessible_resources entries.');
}

console.log('Production extension manifest OK.');

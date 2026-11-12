// Shared test plumbing: a tiny static server for the app folder and a fresh browser page per test.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
};

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

// Opens the app with in-app dialogs auto-accepted (queue answers in window.DLG_ANSWERS)
async function openApp({ viewport = { width: 1440, height: 900 } } = {}) {
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.DLG_AUTO = true;
  });
  await page.goto(`http://localhost:${server.address().port}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof EV === 'object');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { page, ev, errors, close, context };
}

const csv = (rows, header = 'Name,Price,Tier') => [header, ...rows].join('\n');
const roster = (n, prefix = 'Player', tiers = ['Platinum', 'Gold', 'Silver', 'Bronze'], prices = [500000, 200000, 50000, 10000]) =>
  csv(
    Array.from(
      { length: n },
      (_, i) => `${prefix} ${String(i + 1).padStart(2, '0')},${prices[i % prices.length]},${tiers[i % tiers.length]}`,
    ),
  );

async function download(page, action) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), path: file, text: () => fs.readFileSync(file, 'utf8') };
}

module.exports = { openApp, csv, roster, download };

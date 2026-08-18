// 從 index.html 抽出 computeChart 的原始輸出,供 crosscheck.py 對照 Swiss Ephemeris。
// 用法:npm i playwright && node tools/extract-chart.mjs   → 產生 tools/chart-data.json
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = pathToFileURL(join(HERE, '..', 'index.html')).href;

const CASES = [
  ['1990-05-15T06:30:00Z',  25.033,  121.565, '台北 1990'],
  ['2000-01-01T12:00:00Z',  51.4779,  -0.0015, '格林威治 J2000'],
  ['1965-11-23T03:15:00Z',  40.7128, -74.0060, '紐約 1965'],
  ['2024-06-21T18:45:00Z', -33.8688, 151.2093, '雪梨 2024'],
  ['1955-03-08T21:05:00Z',  28.6139,  77.2090, '德里 1955'],
  ['2099-12-31T09:00:00Z',  25.033,  121.565, '台北 2099(擬合區間上緣)'],
  ['1860-07-04T00:00:00Z',  48.8566,   2.3522, '巴黎 1860(擬合區間下緣)'],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });

const out = await page.evaluate(cases =>
  cases.map(([iso, lat, lon, label]) => {
    const c = VedicCore.computeChart(new Date(iso), lat, lon);
    return { iso, lat, lon, label, ayanamsa: c.ayanamsa, asc: c.asc,
             planets: Object.fromEntries(Object.entries(c.planets).map(([k, v]) => [k, v.lon])),
             retro: Object.fromEntries(Object.entries(c.planets).map(([k, v]) => [k, v.retro])) };
  }), CASES);

writeFileSync(join(HERE, 'chart-data.json'), JSON.stringify(out, null, 1));
console.log('cases:', out.length, '| pageerrors:', errs.length ? errs.join(';') : '(無)');
await browser.close();

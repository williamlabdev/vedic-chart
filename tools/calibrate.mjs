// 校準掃描:統計 dignity 等級與 toneTag 標籤的分佈。
// 用途 —— 改動任何會動到 score 的規則時,跑前後各一次比對分佈,
// 決定 toneTag 的 TONE_MID／TONE_HIGH 門檻要不要跟著動(分數單位為 virūpa,零點依 BPHS 28.12)。
//
//   node tools/calibrate.mjs before.json     # 改動前
//   node tools/calibrate.mjs after.json      # 改動後
//   node tools/calibrate.mjs --diff before.json after.json
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const args = process.argv.slice(2);

if (args[0] === '--diff') {
  const a = JSON.parse(readFileSync(args[1], 'utf8'));
  const b = JSON.parse(readFileSync(args[2], 'utf8'));
  const pct = (n, tot) => (n / tot * 100).toFixed(1).padStart(5) + '%';
  const table = (title, ka, kb) => {
    const keys = [...new Set([...Object.keys(ka), ...Object.keys(kb)])];
    const ta = Object.values(ka).reduce((x, y) => x + y, 0);
    const tb = Object.values(kb).reduce((x, y) => x + y, 0);
    console.log(`\n=== ${title} (n=${ta} → ${tb}) ===`);
    for (const k of keys) {
      const va = ka[k] || 0, vb = kb[k] || 0;
      const d = (vb / tb - va / ta) * 100;
      const mark = Math.abs(d) >= 3 ? '  ⚠' : '';
      console.log(`  ${k.padEnd(14)} ${pct(va, ta)} → ${pct(vb, tb)}  (${d >= 0 ? '+' : ''}${d.toFixed(1)}pt)${mark}`);
    }
  };
  table('dignity 等級', a.dignity, b.dignity);
  table('層級標籤 toneTag', a.tags, b.tags);
  table('整體基調', a.overall, b.overall);
  const sa = a.scores, sb = b.scores;
  const stat = s => `min=${Math.min(...s)} max=${Math.max(...s)} mean=${(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2)}`;
  console.log(`\n=== 原始 score ===\n  before: ${stat(sa)}\n  after : ${stat(sb)}`);
  const q = (s, p) => [...s].sort((x, y) => x - y)[Math.floor(s.length * p)];
  console.log(`  分位  before: p10=${q(sa, .1)} p50=${q(sa, .5)} p90=${q(sa, .9)}`);
  console.log(`        after : p10=${q(sb, .1)} p50=${q(sb, .5)} p90=${q(sb, .9)}`);
  process.exit(0);
}

const OUT = args[0] || 'calib.json';
const FILE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });

const dignity = {}, tags = {}, overall = {}, scores = [];
const bump = (o, k) => o[k] = (o[k] || 0) + 1;

// 128 張盤:年份與月日拉開讓九顆星輪流落到各種星座與宮位;**出生時刻也必須拉開**
// —— नतोन्नत(晝夜力)與 काल 諸力直接由出生時刻決定,固定單一時刻會讓「哪幾顆星
// 吃虧」變成常數。0818 實測:全批固定 10:45 時,日／水／木在 288 筆中從未落入
// 「艱辛」(0/32),而月 47%、土 44% —— 那是取樣假象,不是命理結論。
const TIMES = ['02:30', '08:15', '14:45', '20:20'];
const CHARTS = [];
for (let y = 1955; y <= 2015; y += 4) for (const md of ['03-08', '09-19'])
  for (const t of TIMES) CHARTS.push([`${y}-${md}`, t]);

for (const [bdate, btime] of CHARTS) {
  await page.fill('#bdate', bdate);
  await page.fill('#btime', btime);
  await page.fill('#btz', '8');
  await page.click('#go');
  await page.waitForTimeout(350);

  const r = await page.evaluate(() => {
    const { dignityOf, buildInterp, toneTag, V, state } = window.__rules;
    const dg = [], tg = [], ov = [], sc = [];
    for (const p of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
      const d = dignityOf(p, state.chart.planets[p].lon);
      if (d) dg.push(d.label.split('，')[0]);
    }
    const t0 = state.mds[0].start, t1 = state.mds[8].end;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t = new Date(t0.getTime() + (t1.getTime() - t0.getTime()) * (i + 0.5) / N);
      const stack = V.dashaStack(state.moonLon, state.birthUT, t);
      const ss = [];
      stack.forEach((p, idx) => {
        const it = buildInterp(p.lord, idx, idx > 0 ? stack[idx - 1].lord : null);
        ss.push(it.score); sc.push(it.score);
        tg.push(toneTag(it.score)[0]);
      });
      const W = [5, 4, 3, 2, 1];
      let ws = 0, wsum = 0;
      ss.forEach((s, i) => { ws += s * W[i]; wsum += W[i]; });
      ov.push(toneTag(ws / wsum)[0]);   // 與 renderStack 一致(同一 virūpa 尺度,零點依 BPHS 28.12)
    }
    return { dg, tg, ov, sc };
  });
  r.dg.forEach(k => bump(dignity, k));
  r.tg.forEach(k => bump(tags, k));
  r.ov.forEach(k => bump(overall, k));
  scores.push(...r.sc);
}

writeFileSync(OUT, JSON.stringify({ dignity, tags, overall, scores }, null, 1));
console.log(`盤數 ${CHARTS.length}、樣本 ${scores.length} 筆 → ${OUT}`);
console.log('dignity:', dignity);
console.log('tags   :', tags);
console.log('overall:', overall);
console.log(`pageerror:${errs.length ? errs.join(';') : '(無)'}`);
await browser.close();

import { chromium } from 'playwright';

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const FILE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;

// 每組:出生日、預期在該盤中「應被判為燃燒」的行星、以及舊規則下會漏掉的理由
const CASES = [
  { bdate: '1990-03-02', planet: '水星', why: '水星順行、距日 13.69°(舊 orb 12 漏判,新 orb 14 應判燃燒)' },
  { bdate: '1990-09-25', planet: '金星', why: '金星順行、距日 9.65°(舊 orb 8 漏判,新 orb 10 應判燃燒)' },
  { bdate: '1990-01-26', planet: '月亮', why: '月亮距日 3.75°(舊版完全不判月亮燃燒)' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });

let pass = 0, fail = 0;

for (const c of CASES) {
  await page.fill('#bdate', c.bdate);
  await page.fill('#btime', '12:00');
  await page.fill('#btz', '8');
  await page.click('#go');
  await page.waitForTimeout(800);

  // 掃 120 年,讓九顆星輪流當大運主星,收集所有大運段落
  const texts = new Set();
  for (let k = 0; k < 13; k++) {
    const y = 1990 + k * 10;
    await page.fill('#qtime', `${y}-06-15T12:00`);
    await page.click('#qgo');
    await page.waitForTimeout(150);
    texts.add(await page.$eval('#stack', el => el.innerText));
  }
  const all = [...texts].join('\n');
  const line = all.split('\n').find(l => l.includes('燃燒') && l.includes(c.planet));
  if (line) { pass++; console.log(`✅ ${c.bdate} ${c.planet}燃燒 — ${c.why}`); }
  else { fail++; console.log(`❌ ${c.bdate} ${c.planet}燃燒 未出現 — ${c.why}`); }
}

// 分級相映:確認四種級別的詞彙都能出現,且舊版的「吉照／刑照」措辭已消失
await page.fill('#bdate', '1990-05-15');
await page.fill('#btime', '14:30');
await page.click('#go');
await page.waitForTimeout(800);
const grades = new Set();
let legacy = false;
for (let k = 0; k < 13; k++) {
  await page.fill('#qtime', `${1990 + k * 10}-06-15T12:00`);
  await page.click('#qgo');
  await page.waitForTimeout(150);
  const t = await page.$eval('#stack', el => el.innerText);
  for (const g of ['一分照', '半照', '三分照', '滿照']) if (t.includes(g)) grades.add(g);
  if (t.includes('吉照') || t.includes('刑照')) legacy = true;
}
console.log(`\n分級相映出現的級別:${[...grades].join('、') || '(無)'}`);
if (grades.size >= 3) { pass++; console.log('✅ 至少三種相映級別實際出現'); }
else { fail++; console.log('❌ 相映級別過少,分級可能沒生效'); }
if (!legacy) { pass++; console.log('✅ 舊措辭「吉照／刑照」已完全移除'); }
else { fail++; console.log('❌ 仍殘留舊措辭'); }

// ── Moolatrikona / 廟旺度數分段(BPHS 3.49–54)──────────────────────────────
// 期望值獨立抄自 docs/SOURCES.md 的原典表,不從 index.html 讀取,
// 因此表格若被抄錯,這裡會抓到。
const ZH = { Sun:'太陽', Moon:'月亮', Mars:'火星', Mercury:'水星', Jupiter:'木星', Venus:'金星', Saturn:'土星' };
const EXPECT = {                       // [星座序, 分界度數, 界線前, 界線後]
  Sun:     [4,  20, '入根本三角', '入廟'],
  Moon:    [1,   3, '旺相',       '入根本三角'],
  Mars:    [0,  12, '入根本三角', '入廟'],
  Jupiter: [8,  10, '入根本三角', '入廟'],
  Venus:   [6,  15, '入根本三角', '入廟'],
  Saturn:  [10, 20, '入根本三角', '入廟'],
};
const MERCURY_VIRGO = [[0, 15, '旺相'], [15, 20, '入根本三角'], [20, 30, '入廟']];

const seen = [];                       // {planet, sign, deg, label}
for (let y = 1960; y <= 2015; y += 5) {
  for (const md of ['02-11', '07-23']) {
    await page.fill('#bdate', `${y}-${md}`);
    await page.fill('#btime', '09:20');
    await page.click('#go');
    await page.waitForTimeout(400);
    const lons = await page.evaluate(() => {
      const c = VedicCore.computeChart(new Date(document.getElementById('bdate').value + 'T01:20:00Z'), 25.033, 121.565);
      return Object.fromEntries(Object.entries(c.planets).map(([k, v]) => [k, v.lon]));
    });
    for (let k = 0; k < 13; k++) {
      await page.fill('#qtime', `${y + k * 9}-06-15T12:00`);
      await page.click('#qgo');
      await page.waitForTimeout(120);
      const t = await page.$eval('#stack', el => el.innerText);
      for (const [en, zh] of Object.entries(ZH)) {
        const m = t.match(new RegExp(`本命${zh}落第 \\d+ 宮（[^（）]*?，([^（）]*?)）`));
        if (!m) continue;
        seen.push({ planet: en, sign: Math.floor(lons[en] / 30), deg: lons[en] % 30, label: m[1] });
      }
    }
  }
}

let zoneChecked = 0, zoneBad = [];
for (const s of seen) {
  let want = null;
  if (s.planet === 'Mercury' && s.sign === 5) {
    want = MERCURY_VIRGO.find(([lo, hi]) => s.deg >= lo && s.deg < hi)[2];
  } else if (EXPECT[s.planet] && EXPECT[s.planet][0] === s.sign) {
    const [, cut, before, after] = EXPECT[s.planet];
    want = s.deg < cut ? before : after;
  }
  if (!want) continue;
  zoneChecked++;
  const got = s.label.split('，')[0];        // 旺相/落陷會帶「，距極點 x°」
  if (got !== want) zoneBad.push(`${ZH[s.planet]} ${s.sign}宮位${s.deg.toFixed(1)}° 期望「${want}」得到「${got}」`);
}
const zoneKinds = new Set(seen.map(s => s.label.split('，')[0]));
console.log(`\n度數分段:比對 ${zoneChecked} 筆落在分段星座的樣本;出現的等級:${[...zoneKinds].join('、')}`);
if (zoneChecked >= 5 && !zoneBad.length) { pass++; console.log('✅ 廟旺／根本三角／本宮的度數分界全部正確'); }
else { fail++; console.log(`❌ 分段有誤(比對 ${zoneChecked} 筆):\n   ${zoneBad.slice(0, 6).join('\n   ') || '樣本不足'}`); }
if (zoneKinds.has('入根本三角')) { pass++; console.log('✅ 新增的「入根本三角」等級實際出現'); }
else { fail++; console.log('❌ 「入根本三角」從未出現'); }
const depth = seen.find(s => s.label.includes('極點'));
if (depth) { pass++; console.log(`✅ 廟旺/落陷附上極點距離,例:「${depth.label}」`); }
else { fail++; console.log('❌ 未見極點距離敘述'); }

// ── Māraka(2／7 宮主)與 Badhaka(動 11／固定 9／雙體 7)────────────────────
// 兩者都由「上升星座 + 該星所掌宮位」完全決定,故在測試裡獨立算一次期望值,
// 再與畫面文字雙向比對(該有的要有、不該有的不能有)。
const SIGN_LORD = ['Mars','Venus','Mercury','Moon','Sun','Mercury','Venus','Mars','Jupiter','Saturn','Saturn','Jupiter'];
const ruledBy = (p, asc) => [...Array(12).keys()].filter(s => SIGN_LORD[s] === p).map(s => ((s - asc) + 12) % 12 + 1);
const badhakaOf = asc => (asc % 3 === 0 ? 11 : asc % 3 === 1 ? 9 : 7);

let mbChecked = 0, mbBad = [], sawMaraka = false, sawBadhaka = false;
for (let y = 1962; y <= 2012; y += 5) {
  await page.fill('#bdate', `${y}-04-17`);
  await page.fill('#btime', '16:40');
  await page.click('#go');
  await page.waitForTimeout(400);
  const asc = await page.evaluate(() =>
    VedicCore.rasiOf(VedicCore.computeChart(
      new Date(document.getElementById('bdate').value + 'T08:40:00Z'), 25.033, 121.565).asc));
  for (let k = 0; k < 13; k++) {
    await page.fill('#qtime', `${y + k * 9}-06-15T12:00`);
    await page.click('#qgo');
    await page.waitForTimeout(120);
    const t = await page.$eval('#stack', el => el.innerText);
    for (const [en, zh] of Object.entries(ZH)) {
      const m = t.match(new RegExp(`本命${zh}落第[\\s\\S]*?。其宿為`));
      if (!m) continue;
      const seg = m[0], ruled = ruledBy(en, asc);
      const wantM = ruled.some(h => h === 2 || h === 7);
      const wantB = ruled.indexOf(badhakaOf(asc)) >= 0;
      const gotM = seg.includes('māraka'), gotB = seg.includes('badhaka');
      mbChecked++;
      if (gotM) sawMaraka = true;
      if (gotB) sawBadhaka = true;
      if (wantM !== gotM) mbBad.push(`${zh}(上升${asc}, 掌 ${ruled}) māraka 期望 ${wantM} 得 ${gotM}`);
      if (wantB !== gotB) mbBad.push(`${zh}(上升${asc}, 掌 ${ruled}) badhaka 期望 ${wantB} 得 ${gotB}`);
    }
  }
}
console.log(`\nMāraka／Badhaka:雙向比對 ${mbChecked} 筆`);
if (mbChecked >= 20 && !mbBad.length) { pass++; console.log('✅ māraka／badhaka 判定與上升星座、宮主完全一致'); }
else { fail++; console.log(`❌ 判定有誤:\n   ${mbBad.slice(0, 6).join('\n   ') || '樣本不足'}`); }
if (sawMaraka && sawBadhaka) { pass++; console.log('✅ 兩種標記都實際出現過(非空判定)'); }
else { fail++; console.log(`❌ 標記未出現 — māraka:${sawMaraka} badhaka:${sawBadhaka}`); }

// 標示修正:頁尾必須把 BPHS 出處與後世傳承分開講
const foot = await page.$eval('#stack', el => el.innerText);
if (foot.includes('非 Parāśara 原文') && !foot.includes('古典規則（BPHS 式）')) {
  pass++; console.log('✅ 頁尾已區分 BPHS 出處與後世實務傳承');
} else { fail++; console.log('❌ 頁尾仍把無出處的規則一併標為 BPHS'); }

// ── 五重友誼 pañcadhā maitrī(BPHS 3.55–58)────────────────────────────────
// 期望值全部獨立重算,不從 index.html 讀:
//   3.55 自然友敵 —— 由 mūlatrikoṇa 星座 + 旺宮主推導,再與頁面的 FRIEND/ENEMY 表比對
//   3.56 臨時友敵 —— 互距 2/3/4/10/11/12 宮
//   3.57–58 疊加 —— 六種組合的期望等級
const MOOLA = { Sun:4, Moon:1, Mars:0, Mercury:5, Jupiter:8, Venus:6, Saturn:10 };
const EXALT_SIGN = { Sun:0, Moon:1, Mars:9, Mercury:5, Jupiter:3, Venus:11, Saturn:6 };
const SEVEN = Object.keys(MOOLA);

// BPHS 3.55:自 mūlatrikoṇa 起算第 2/4/5/8/9/12 宮主 + 旺宮主為友,餘為敵,兼具者為中性
function deriveNatural(p) {
  const m = MOOLA[p];
  const lordAt = h => SIGN_LORD[(m + h - 1) % 12];
  const fr = new Set([2, 4, 5, 8, 9, 12].map(lordAt));
  fr.add(SIGN_LORD[EXALT_SIGN[p]]);
  const en = new Set([1, 3, 6, 7, 10, 11].map(lordAt));
  const out = {};
  for (const q of SEVEN) {
    if (q === p) continue;
    const f = fr.has(q), e = en.has(q);
    out[q] = f && e ? 'neutral' : f ? 'friend' : e ? 'enemy' : 'neutral';
  }
  return out;
}

const natBad = [];
const pageTables = await page.evaluate(() => ({ F: window.__rules.FRIEND, E: window.__rules.ENEMY }));
for (const p of SEVEN) {
  const want = deriveNatural(p);
  for (const q of SEVEN) {
    if (q === p) continue;
    const got = pageTables.F[p].includes(q) ? 'friend' : pageTables.E[p].includes(q) ? 'enemy' : 'neutral';
    if (got !== want[q]) natBad.push(`${ZH[p]}→${ZH[q]} 原典推導「${want[q]}」頁面表「${got}」`);
  }
}
console.log('\n五重友誼 —— 自然友敵(BPHS 3.55)');
if (!natBad.length) { pass++; console.log('✅ 頁面 FRIEND／ENEMY 表與 3.55 推導完全一致(七曜 42 組)'); }
else { fail++; console.log(`❌ 自然友敵表與原典推導不符:\n   ${natBad.slice(0, 8).join('\n   ')}`); }

// BPHS 3.56:臨時友敵,全 144 組互距枚舉
const tatBad = await page.evaluate(() => {
  const { tatkalikaOf } = window.__rules;
  const bad = [];
  for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
    const d = ((b - a) + 12) % 12 + 1;
    const want = [2, 3, 4, 10, 11, 12].includes(d) ? 'friend' : 'enemy';
    const got = tatkalikaOf(a, b);
    if (got !== want) bad.push(`rasi ${a}→${b}(距 ${d} 宮)期望 ${want} 得 ${got}`);
  }
  return bad;
});
if (!tatBad.length) { pass++; console.log('✅ 臨時友敵符合 3.56 的 2/3/4/10/11/12 宮(144 組全枚舉)'); }
else { fail++; console.log(`❌ 臨時友敵有誤:\n   ${tatBad.slice(0, 6).join('\n   ')}`); }

// BPHS 3.57–58:自然 × 臨時 → 五級
const WANT_5 = {
  'friend|friend': '居至友宮', 'friend|enemy': '居中性宮',
  'neutral|friend': '居友宮', 'neutral|enemy': '居敵宮',
  'enemy|friend': '居中性宮', 'enemy|enemy': '居至敵宮',
};
const natMap = Object.fromEntries(SEVEN.map(p => [p, deriveNatural(p)]));
const combo = await page.evaluate(({ SEVEN, natMap, WANT_5 }) => {
  const { panchadhaMaitri, MAITRI_LABEL } = window.__rules;
  const bad = [], seen = {};
  for (const p of SEVEN) for (const q of SEVEN) {
    if (p === q) continue;
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
      const d = ((b - a) + 12) % 12 + 1;
      const tk = [2, 3, 4, 10, 11, 12].includes(d) ? 'friend' : 'enemy';
      const key = `${natMap[p][q]}|${tk}`;
      const got = MAITRI_LABEL[panchadhaMaitri(p, q, a, b)];
      seen[key] = (seen[key] || 0) + 1;
      if (got !== WANT_5[key]) bad.push(`${p}→${q} (${key}) 期望「${WANT_5[key]}」得「${got}」`);
    }
  }
  return { bad, seen };
}, { SEVEN, natMap, WANT_5 });
if (!combo.bad.length && Object.keys(combo.seen).length === 6) {
  pass++; console.log(`✅ 3.57–58 疊加表六種組合全部正確(枚舉 ${Object.values(combo.seen).reduce((a, b) => a + b, 0)} 組)`);
} else {
  fail++; console.log(`❌ 疊加有誤(涵蓋 ${Object.keys(combo.seen).length}/6 種組合):\n   ${combo.bad.slice(0, 6).join('\n   ')}`);
}

// dignityOf 與 relToUpper 必須共用同一套判定(不是兩處各一套)
await page.fill('#bdate', '1978-11-04');
await page.fill('#btime', '07:15');
await page.click('#go');
await page.waitForTimeout(400);
const relMismatch = await page.evaluate(() => {
  const { relToUpper, panchadhaMaitri, MAITRI_REL_TXT, state, V } = window.__rules;
  const P = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];
  const bad = [];
  for (const p of P) for (const u of P) {
    if (p === u) continue;
    const pR = V.rasiOf(state.chart.planets[p].lon), uR = V.rasiOf(state.chart.planets[u].lon);
    const want = MAITRI_REL_TXT[panchadhaMaitri(p, u, pR, uR)];
    if (!relToUpper(p, u).txt.endsWith(want)) bad.push(`${p}→${u} relToUpper 未採用五重友誼結果`);
  }
  return bad;
});
if (!relMismatch.length) { pass++; console.log('✅ relToUpper 與 dignityOf 共用同一套五重友誼(72 組)'); }
else { fail++; console.log(`❌ 兩處判定不一致:\n   ${relMismatch.slice(0, 6).join('\n   ')}`); }

// 五個等級都要在真實盤面出現過,否則等於沒生效
const lvls = new Set();
for (let y = 1958; y <= 2013; y += 5) {
  await page.fill('#bdate', `${y}-06-22`);
  await page.fill('#btime', '21:05');
  await page.click('#go');
  await page.waitForTimeout(350);
  const got = await page.evaluate(() => {
    const { dignityOf, state } = window.__rules;
    return ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
      .map(p => dignityOf(p, state.chart.planets[p].lon))
      .filter(Boolean).map(d => d.label.split('，')[0]);
  });
  got.forEach(l => lvls.add(l));
}
const five = ['居至友宮', '居友宮', '居中性宮', '居敵宮', '居至敵宮'];
const missing = five.filter(l => !lvls.has(l));
if (!missing.length) { pass++; console.log('✅ 五個友誼等級都在實際盤面出現過'); }
else { fail++; console.log(`❌ 未出現的等級:${missing.join('、')}`); }

// ── 位置吉分 शुभाङ्क(BPHS 28.7–9)────────────────────────────────────────
// 期望值獨立抄自梵文的 bhūtasaṅkhyā:「षष्टिरिष्वब्धयस्त्रिंशदाकृतिस्तिथयो गजाः ।
// चत्वारो द्वौ च शून्यं च」= 60／45／30／22(आकृति)／15(तिथि)／8(गज)／4／2／0,
// 依 28.7 的次序配旺・根本三角・本宮・至友・友・中性・敵・至敵・陷。
// 燃燒依 3.59 的 अस्त 歸零(28.7 九級未列燃燒,兩章取聯集,見 docs/SOURCES.md)。
const PHALA_EXPECT = {
  '旺相': 60, '入根本三角': 45, '入廟': 30,
  '居至友宮': 22, '居友宮': 15, '居中性宮': 8,
  '居敵宮': 4, '居至敵宮': 2, '落陷': 0,
};
const phalaSeen = new Set();
let phalaChecked = 0, phalaBad = [], burntSeen = 0;
for (let y = 1956; y <= 2014; y += 2) {
  await page.fill('#bdate', `${y}-01-30`);
  await page.fill('#btime', '05:50');
  await page.click('#go');
  await page.waitForTimeout(320);
  const got = await page.evaluate(() => {
    const { dignityOf, state } = window.__rules;
    return ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
      .map(p => { const d = dignityOf(p, state.chart.planets[p].lon); return d && { p, ...d }; })
      .filter(Boolean);
  });
  for (const d of got) {
    const level = d.label.split('，')[0];
    const burnt = d.label.includes('燃燒');
    const want = burnt ? 0 : PHALA_EXPECT[level];
    if (want === undefined) { phalaBad.push(`未知等級「${level}」`); continue; }
    phalaChecked++;
    phalaSeen.add(level);
    if (burnt) burntSeen++;
    if (d.score !== want) phalaBad.push(`${ZH[d.p]}「${d.label}」期望 ${want} 得 ${d.score}`);
  }
}
console.log(`\n位置吉分(BPHS 28.8):比對 ${phalaChecked} 筆,涵蓋等級 ${[...phalaSeen].join('、')}`);
if (phalaChecked >= 50 && !phalaBad.length) { pass++; console.log('✅ 九級 शुभाङ्क 與分數完全對應(60/45/30/22/15/8/4/2/0)'); }
else { fail++; console.log(`❌ 吉分有誤:\n   ${phalaBad.slice(0, 6).join('\n   ') || '樣本不足'}`); }
if (burntSeen > 0) { pass++; console.log(`✅ 燃燒(अस्त)吉果歸零實際生效(${burntSeen} 筆)`); }
else { fail++; console.log('❌ 掃描中從未出現燃燒歸零的樣本,該分支未被驗證'); }

// 燃燒不得雙重扣分:dignity 已歸零,buildInterp 不可再扣一次。
// 作法 —— 同一顆星,比較「燃燒」與「假裝沒燃燒」兩種情形的 buildInterp 分差,
// 該分差必須恰好等於 dignity 的落差,不能多扣。
const dblBad = await page.evaluate(() => {
  const { buildInterp, dignityOf, state } = window.__rules;
  const bad = [];
  for (const p of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
    const lon = state.chart.planets[p].lon;
    const d = dignityOf(p, lon);
    if (!d || !d.label.includes('燃燒')) continue;
    const withBurn = buildInterp(p, 0, null).score;
    const saved = state.chart.planets[p].lon;
    state.chart.planets.Sun.lon = (state.chart.planets.Sun.lon + 180) % 360;  // 把太陽移開
    const d2 = dignityOf(p, lon), noBurn = buildInterp(p, 0, null).score;
    state.chart.planets.Sun.lon = (state.chart.planets.Sun.lon + 180) % 360;  // 還原
    state.chart.planets[p].lon = saved;
    if (noBurn - withBurn !== d2.score - d.score)
      bad.push(`${p}: buildInterp 差 ${noBurn - withBurn} 但 dignity 差 ${d2.score - d.score}`);
  }
  return bad;
});
if (!dblBad.length) { pass++; console.log('✅ 燃燒只扣一次(dignity 歸零),buildInterp 未重複扣分'); }
else { fail++; console.log(`❌ 燃燒被重複計分:\n   ${dblBad.join('\n   ')}`); }

// ── 位置力 Sthāna Bala(BPHS 27.1–6)──────────────────────────────────────
// 期望值不從實作反推:七分盤的落點照 BPHS 第 6 章的算法手算,五項力的
// virūpa 照 27.1–6 手算,uccha bala 另以 Santhanam p.265 的算例當錨點。
await page.fill('#bdate', '1990-05-15');
await page.fill('#btime', '14:30');
await page.click('#go');
await page.waitForTimeout(600);

const balaBad = await page.evaluate(() => {
  const R = window.__rules, bad = [];
  const eq = (got, want, what) => { if (got !== want) bad.push(`${what}:期望 ${want} 得 ${got}`); };
  const near = (got, want, what) => { if (Math.abs(got - want) > 1e-9) bad.push(`${what}:期望 ${want} 得 ${got}`); };
  const L = (rasi, deg) => rasi * 30 + deg;   // 星座序 + 宮內度數 → 黃經

  // 6.5–6 होरा:奇宮前半屬日(獅子 4)後半屬月(巨蟹 3),偶宮相反
  eq(R.horaRasi(L(0, 5)),  4, 'hora 牡羊5°');
  eq(R.horaRasi(L(0, 20)), 3, 'hora 牡羊20°');
  eq(R.horaRasi(L(1, 5)),  3, 'hora 金牛5°');
  eq(R.horaRasi(L(1, 20)), 4, 'hora 金牛20°');
  // 6.7–8 द्रेष्काण:每 10° 依次為本宮、第 5 宮、第 9 宮
  eq(R.drekkanaRasi(L(0, 5)),  0, 'D3 牡羊5°');
  eq(R.drekkanaRasi(L(0, 15)), 4, 'D3 牡羊15°');
  eq(R.drekkanaRasi(L(0, 25)), 8, 'D3 牡羊25°');
  eq(R.drekkanaRasi(L(1, 25)), 9, 'D3 金牛25°');
  // 6.10 सप्तांश:每 30/7°,奇宮自本宮起、偶宮自第 7 宮起
  eq(R.saptamsaRasi(L(0, 0)),  0, 'D7 牡羊0°');
  eq(R.saptamsaRasi(L(0, 29)), 6, 'D7 牡羊29°');
  eq(R.saptamsaRasi(L(1, 0)),  7, 'D7 金牛0°');
  // 6.15 द्वादशांश:每 2.5°,自本宮起
  eq(R.dvadasamsaRasi(L(0, 0)),   0,  'D12 牡羊0°');
  eq(R.dvadasamsaRasi(L(0, 29)),  11, 'D12 牡羊29°');
  eq(R.dvadasamsaRasi(L(11, 29)), 10, 'D12 雙魚29°');
  // 6.27 त्रिंशांश:奇宮 火5/土5/木8/水7/金5,偶宮次序顛倒(व्यत्ययात्)
  [[3,'Mars'],[7,'Saturn'],[12,'Jupiter'],[20,'Mercury'],[27,'Venus']]
    .forEach(([d, w]) => eq(R.trimsamsaLord(L(0, d)), w, `D30 牡羊${d}°`));
  [[3,'Venus'],[8,'Mercury'],[15,'Jupiter'],[22,'Saturn'],[27,'Mars']]
    .forEach(([d, w]) => eq(R.trimsamsaLord(L(1, d)), w, `D30 金牛${d}°`));

  // 27.3 的七級 virūpa 必須是 45·30·20·15·10·4·2(bhūtasaṅkhyā 讀出的那組)
  const want = { mt:45, own:30, adhimitra:20, mitra:15, sama:10, shatru:4, adhishatru:2 };
  for (const k of Object.keys(want)) eq(R.SAPTAVARGA_VIRUPA[k], want[k], `27.3 ${k} 的 virūpa`);

  // 27.1–2a उच्चबल:Santhanam p.265 的算例 —— 太陽 342°15′、極陷點 190° → 50.75
  near(R.ucchaBala('Sun', 342.25), 50.75, 'uccha 太陽342°15′');
  near(R.ucchaBala('Sun', L(0, 10)), 60, 'uccha 太陽極旺點滿分');
  near(R.ucchaBala('Sun', L(6, 10)), 0,  'uccha 太陽極陷點零分');
  near(R.ucchaBala('Saturn', L(6, 20)), 60, 'uccha 土星極旺點滿分');

  // 27.5a ओजयुग्मराश्यंश:月在金牛(偶宮)其 D9 為摩羯(偶)→ 15+15;太陽同位置全不合 → 0
  eq(R.ojhaYugmaBala('Moon', L(1, 0)), 30, 'ojha 月亮金牛0°');
  eq(R.ojhaYugmaBala('Sun',  L(1, 0)), 0,  'ojha 太陽金牛0°');
  // 27.5b केन्द्रादि:角宮 60、續宮 30、果宮 15
  [60,30,15,60,30,15,60,30,15,60,30,15]
    .forEach((w, i) => eq(R.kendradiBala(i, 0), w, `kendradi 第${i+1}宮`));
  // 27.6 द्रेष्काण(लिङ्ग):依梵文字序 पुं／नपुंसक／योषा → 第一／第二／第三
  eq(R.drekkanaBala('Sun', L(0, 5)),      15, 'linga 太陽第一drekkāṇa');
  eq(R.drekkanaBala('Sun', L(0, 15)),     0,  'linga 太陽第二drekkāṇa');
  eq(R.drekkanaBala('Mercury', L(0, 15)), 15, 'linga 水星第二drekkāṇa');
  eq(R.drekkanaBala('Venus', L(0, 25)),   15, 'linga 金星第三drekkāṇa');
  return bad;
});
if (!balaBad.length) { pass++; console.log('\n✅ 位置力五項與七分盤算法逐點對上原典(BPHS 27.1–6、6.5–27)'); }
else { fail++; console.log(`\n❌ 位置力有誤:\n   ${balaBad.slice(0, 8).join('\n   ')}`); }

// 實際盤面掃描:七分盤必須恰好七盤、各盤 virūpa 只能取原典七值、各項不得超過上限。
const balaSeen = new Set();
let balaChecked = 0; const balaScanBad = [];
for (let y = 1960; y <= 2015; y += 5) {
  await page.fill('#bdate', `${y}-11-08`);
  await page.fill('#btime', '03:40');
  await page.click('#go');
  await page.waitForTimeout(320);
  const got = await page.evaluate(() => {
    const R = window.__rules, out = [];
    for (const p of R.SHADBALA_GRAHAS) {
      const b = R.sthanaBala(p);
      out.push({ p, total: b.total, parts: b.parts,
                 vs: b.places.map(x => x.virupa), grades: b.places.map(x => x.grade) });
    }
    out.push({ p: 'Rahu', nul: R.sthanaBala('Rahu') === null });   // 27 章只論七曜
    return out;
  });
  for (const g of got) {
    if (g.p === 'Rahu') { if (!g.nul) balaScanBad.push('羅睺不該有位置力'); continue; }
    balaChecked++;
    g.grades.forEach(x => balaSeen.add(x));
    if (g.vs.length !== 7) balaScanBad.push(`${g.p} 分盤數 ${g.vs.length} ≠ 7`);
    const allowed = [45, 30, 20, 15, 10, 4, 2];
    if (g.vs.some(v => !allowed.includes(v))) balaScanBad.push(`${g.p} 出現表外 virūpa ${g.vs}`);
    const lim = { uccha: 60, saptavargaja: 315, ojhaYugma: 30, kendradi: 60, drekkana: 15 };
    for (const k of Object.keys(lim))
      if (!(g.parts[k] >= 0 && g.parts[k] <= lim[k])) balaScanBad.push(`${g.p} ${k}=${g.parts[k]} 超出 0..${lim[k]}`);
    const sum = Object.values(g.parts).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - g.total) > 1e-9) balaScanBad.push(`${g.p} total 與各項和不符`);
  }
}
console.log(`位置力掃描:${balaChecked} 筆,出現的分盤等級 ${[...balaSeen].join('、')}`);
if (balaChecked >= 70 && !balaScanBad.length) { pass++; console.log('✅ 七分盤數量、virūpa 取值與各項上限在實際盤面全部成立'); }
else { fail++; console.log(`❌ 位置力掃描有誤:\n   ${balaScanBad.slice(0, 6).join('\n   ') || '樣本不足'}`); }
if (balaSeen.size >= 5) { pass++; console.log(`✅ 七級中的 ${balaSeen.size} 級在實際盤面出現過`); }
else { fail++; console.log(`❌ 分盤等級覆蓋不足,只出現 ${[...balaSeen].join('、')}`); }

// ── 方位力 / 自然力 / 相映力(BPHS 27.7–8、27.13–14、27.19 + 26.5–12)──────
// 精確相映的關鍵驗證:26.5–12 的公式在各宮起點算出的值,必須等於 26.3 pādavṛddhi
// 分級 × 60 —— 兩者是同一章對同一件事的概括版與精確版,對不上就是有一邊解錯。
const balaBad2 = await page.evaluate(() => {
  const R = window.__rules, bad = [];
  const eq = (got, want, what) => { if (Math.abs(got - want) > 1e-9) bad.push(`${what}:期望 ${want} 得 ${got}`); };
  const near = (got, want, tol, what) => { if (Math.abs(got - want) > tol) bad.push(`${what}:期望 ${want}±${tol} 得 ${got}`); };

  // 27.7–8 दिग्बल:得力點滿 60、失力點(對宮)零。日火第 10、木水第 1、金月第 4、土第 7。
  const asc = 100;
  const at = h => (asc + (h - 1) * 30) % 360;      // 第 h 宮起點
  [['Sun',10],['Mars',10],['Jupiter',1],['Mercury',1],['Venus',4],['Moon',4],['Saturn',7]]
    .forEach(([p, h]) => {
      eq(R.digBala(p, at(h), asc), 60, `dig ${p} 得力於第${h}宮`);
      eq(R.digBala(p, at((h + 5) % 12 + 1), asc), 0, `dig ${p} 失力於第${(h + 5) % 12 + 1}宮`);
    });

  // 27.13–14 नैसर्गिक:60/7 × 土1 火2 水3 木4 金5 月6 日7。
  // 期望值取 Santhanam p.276 給的 rūpa 值 ×60,獨立於實作的乘法。
  [['Sun',60.0],['Moon',51.42],['Venus',42.84],['Jupiter',34.26],
   ['Mercury',25.74],['Mars',17.16],['Saturn',8.58]]
    .forEach(([p, v]) => near(R.naisargikaBala(p), v, 0.05, `naisargika ${p}`));

  // 26.5–12 精確相映 vs 26.3 pādavṛddhi:一般行星在 3/4/5/7/8/9/10 宮的值
  const PADA60 = { 3:15, 4:45, 5:30, 7:60, 8:45, 9:30, 10:15 };
  for (const h of Object.keys(PADA60)) {
    const a = (h - 1) * 30;                        // 看者在 0°,被看者在第 h 宮起點
    eq(R.spastaDrsti('Sun', 0, a), PADA60[h], `spaṣṭa dṛṣṭi 一般星第${h}宮`);
  }
  // 26.4 的特殊滿照:土 3·10、火 4·8、木 5·9 —— 精確式必須也給滿分
  [['Saturn',3],['Saturn',10],['Mars',4],['Mars',8],['Jupiter',5],['Jupiter',9]]
    .forEach(([p, h]) => eq(R.spastaDrsti(p, 0, (h - 1) * 30), 60, `${p} 特殊滿照第${h}宮`));
  // 相映不及一宮(30° 內)為零;逾十宮(300° 外)亦為零
  [5, 20, 29, 310, 350].forEach(a => eq(R.spastaDrsti('Sun', 0, a), 0, `一般星 ${a}° 無相映`));
  // 全域值域:0..60,無 NaN
  for (const p of ['Sun','Saturn','Mars','Jupiter'])
    for (let a = 0; a < 360; a += 0.5) {
      const d = R.spastaDrsti(p, 0, a);
      if (!(d >= 0 && d <= 60)) bad.push(`${p} 在 ${a}° 的 dṛṣṭi = ${d} 超出 0..60`);
    }

  // 27.19 दृक्बल:吉星滿照 +1/4、凶星滿照 −1/4。
  // 造一張假盤:除測試星外全部放在被看者前 10°(相映為零),測試星放對宮。
  const mk = (probe, tester) => {
    const planets = {};
    for (const q of R.SHADBALA_GRAHAS) planets[q] = { lon: 90 };
    planets[probe] = { lon: 100 };
    planets[tester] = { lon: 280 };                // 對 probe 而言 antara = 180°
    return { asc: 0, planets };
  };
  eq(R.drikBala('Sun', mk('Sun', 'Jupiter')), 15,  'dṛk 木星(吉)滿照');
  eq(R.drikBala('Sun', mk('Sun', 'Saturn')), -15, 'dṛk 土星(凶)滿照');
  return bad;
});
if (!balaBad2.length) { pass++; console.log('✅ 方位力／自然力／精確相映／相映力逐點對上原典(27.7–8・13–14・19,26.5–12)'); }
else { fail++; console.log(`❌ 三力有誤:\n   ${balaBad2.slice(0, 8).join('\n   ')}`); }

// ── 時間力 Kāla Bala(27.8–17)與動勢力 Cheṣṭā Bala(27.18・24–25a)────────
// 這兩力多半只能靠「結構恆等式」驗:每一項的分配總量、互補關係、與 27.18 的等同關係,
// 都是原典寫死的,算錯任何一環都會破。另外用 Santhanam p.270–271 的 ahargaṇa 算例
// 當外部錨點 —— 那是本工具唯一能拿到的、對年主月主的第三方數值對照。
const kcBad = await page.evaluate(() => {
  const R = window.__rules, V = R.V, bad = [];
  const eq = (got, want, what) => { if (Math.abs(got - want) > 1e-9) bad.push(`${what}:期望 ${want} 得 ${got}`); };
  const near = (got, want, tol, what) => { if (Math.abs(got - want) > tol) bad.push(`${what}:期望 ${want}±${tol} 得 ${got}`); };

  // 27.10–11 पक्षबल:月減日 ÷3 給月水金木,60 − 之給日火土;兩組必互補。
  const mkPak = (moon, sun) => ({ planets: { Moon:{lon:moon}, Sun:{lon:sun} } });
  eq(R.pakshaBala('Moon', mkPak(0, 0)), 0,      'pakṣa 朔日吉曜為零');
  eq(R.pakshaBala('Sun',  mkPak(0, 0)), 60,     'pakṣa 朔日凶曜滿');
  eq(R.pakshaBala('Jupiter', mkPak(180, 0)), 60,'pakṣa 望日吉曜滿');
  eq(R.pakshaBala('Mars',    mkPak(180, 0)), 0, 'pakṣa 望日凶曜為零');
  for (const [m, s] of [[95, 20], [200, 350], [10, 300]]){
    const ch = mkPak(m, s);
    R.PAKSHA_BRIGHT.forEach(q => eq(R.pakshaBala(q, ch), R.pakshaBala('Moon', ch), `pakṣa 吉曜同值 ${q}`));
    eq(R.pakshaBala('Moon', ch) + R.pakshaBala('Saturn', ch), 60, 'pakṣa 吉凶互補為 60');
  }

  // 27.15–17 अयनबल:分點 bhuja=0 → 三宮(90)÷3 = 30(不分吉凶);至點看南北。
  // 折線 khaṇḍa 的三段和必須是 90(= 23°27′ 的放大值),否則整條算式的基準就錯了。
  eq(R.kranti90(0), 0, 'kranti90 春分點為零');
  eq(R.kranti90(90), 90, 'kranti90 夏至滿 90');
  eq(R.kranti90(270), 90, 'kranti90 冬至滿 90(取絕對值)');
  eq(R.kranti90(30), R.AYANA_KHANDA[0], 'kranti90 第一段末 = 第一 khaṇḍa');
  eq(R.kranti90(60), R.AYANA_KHANDA[0]+R.AYANA_KHANDA[1], 'kranti90 第二段末 = 前二 khaṇḍa 和');
  const mkAy = sayana => ({ ayanamsa: 0, planets: Object.fromEntries(
    R.SHADBALA_GRAHAS.map(q => [q, { lon: sayana }])) });
  R.SHADBALA_GRAHAS.forEach(q => eq(R.ayanaBala(q, mkAy(0)), 30, `ayana 分點 ${q} = 30`));
  eq(R.ayanaBala('Sun',     mkAy(90)),  60, 'ayana 日在夏至(北)滿');
  eq(R.ayanaBala('Sun',     mkAy(270)),  0, 'ayana 日在冬至(南)零');
  eq(R.ayanaBala('Moon',    mkAy(90)),   0, 'ayana 月在夏至(北)零');
  eq(R.ayanaBala('Saturn',  mkAy(270)), 60, 'ayana 土在冬至(南)滿');
  eq(R.ayanaBala('Mercury', mkAy(90)),  60, 'ayana 水在夏至恆加');
  eq(R.ayanaBala('Mercury', mkAy(270)), 60, 'ayana 水在冬至恆加');

  // 27.20 星戰:同度 1° 內才觸發;力大者加、力小者減,七曜總和不變。
  eq(R.yuddhaPairs({ planets: Object.fromEntries(
      R.SHADBALA_GRAHAS.map((q, i) => [q, { lon: i*40 }])) }).length, 0, '相距甚遠時無星戰');
  return bad;
});
if (!kcBad.length) { pass++; console.log('✅ पक्ष／अयन／युद्ध 的結構恆等式逐點對上原典(27.10–11・15–17・20)'); }
else { fail++; console.log(`❌ 時間力有誤:\n   ${kcBad.slice(0, 8).join('\n   ')}`); }

// Santhanam p.270–271 的 ahargaṇa 算例:1984-06-01 → abbreviated ahargaṇa 65295、
// 年主木曜(週四)、月主金曜(週五)、日主金曜(週五)。這是年主月主唯一的第三方數值錨點。
const aharBad = await page.evaluate(() => {
  const R = window.__rules, V = R.V, bad = [];
  const ch = V.computeChart(new Date('1984-06-01T06:30:00Z'), 20, 78);   // 印度當地正午
  const L = R.kalaLords(ch);
  if (L.ahar !== 65295) bad.push(`ahargaṇa 期望 65295 得 ${L.ahar}`);
  if (L.varsha !== 'Jupiter') bad.push(`年主期望 Jupiter(週四)得 ${L.varsha}`);
  if (L.masa   !== 'Venus')   bad.push(`月主期望 Venus(週五)得 ${L.masa}`);
  if (L.dina   !== 'Venus')   bad.push(`日主期望 Venus(週五)得 ${L.dina}`);
  // 27.13a 四主的 virūpa 總量恆為 15+30+45+60 = 150,不論落在幾顆星上
  const sum = R.SHADBALA_GRAHAS.reduce((a, q) => a + R.varshaMasaDinaHoraBala(q, ch), 0);
  if (Math.abs(sum - 150) > 1e-9) bad.push(`四主 virūpa 總量 ${sum} ≠ 150`);
  // 日出後第一個 horā 的主必為當日之主(Santhanam p.271)
  const dn = V.dayNight(ch.date, ch.lat, ch.lon);
  const ch2 = V.computeChart(new Date(dn.sunrise.getTime() + 60000), 20, 78);
  const L2 = R.kalaLords(ch2);
  if (L2.horaIndex !== 0 || L2.hora !== L2.dina) bad.push(`日出首 horā 主應為日主 ${L2.dina},得 ${L2.hora}(第 ${L2.horaIndex+1} 時)`);
  return bad;
});
if (!aharBad.length) { pass++; console.log('✅ ahargaṇa／年月日時四主重現 Santhanam p.270–271 算例,四主總量 150'); }
else { fail++; console.log(`❌ 四主有誤:\n   ${aharBad.join('\n   ')}`); }

// 實際盤面掃描:नत 互補與夜曜在子夜為強、त्र्यंश 的分配量、चेष्टा 與 27.18 的等同、
// 逆行必得高 चेष्टा(चेष्टाकेन्द्र 逾 90°)、六力總和與 rūpa 換算。
const scanBad = [];
let scanN = 0, retroN = 0;
for (const [iso, lat, lon] of [['1990-05-15T06:30:00Z',25.033,121.565],
                               ['1990-05-15T18:30:00Z',25.033,121.565],
                               ['1965-11-23T03:15:00Z',40.7128,-74.006],
                               ['2024-06-21T18:45:00Z',-33.8688,151.2093],
                               ['1955-03-08T21:05:00Z',28.6139,77.209],
                               ['1790-04-12T09:00:00Z',48.8566,2.3522]]){   // ahargaṇa 為負(1805 前)
  const r = await page.evaluate(([iso, lat, lon]) => {
    const R = window.__rules, V = R.V, bad = [];
    const ch = V.computeChart(new Date(iso), lat, lon);
    const kb = q => R.kalaBala(q, ch);
    // 27.9:月火土同值、日木金同值、兩組互補為 60、水星恆 60
    const night = R.natonnataBala('Moon', ch), day = R.natonnataBala('Sun', ch);
    ['Mars','Saturn'].forEach(q => { if (Math.abs(R.natonnataBala(q, ch) - night) > 1e-9) bad.push(`${iso} ${q} 的 nata 與月不同值`); });
    ['Jupiter','Venus'].forEach(q => { if (Math.abs(R.natonnataBala(q, ch) - day) > 1e-9) bad.push(`${iso} ${q} 的 nata 與日不同值`); });
    if (Math.abs(night + day - 60) > 1e-9) bad.push(`${iso} nata 晝夜兩組不互補`);
    if (R.natonnataBala('Mercury', ch) !== 60) bad.push(`${iso} 水星 nata ≠ 60`);
    // 夜曜的 nata 必隨太陽時角單調 —— 子夜(時角 180°)為滿 60
    const ha = V.sunHourAngle(ch.date, ch.lat, ch.lon);
    if (Math.abs(night - ha/3) > 1e-9) bad.push(`${iso} 夜曜 nata ≠ 時角/3`);
    // 27.12:木星恆滿,另有恰一顆時段之主得滿(木星不在晝夜兩份名單裡,故恆為兩顆)
    const full = R.SHADBALA_GRAHAS.filter(q => R.tribhagaBala(q, ch) === 60);
    if (full.indexOf('Jupiter') < 0) bad.push(`${iso} 木星未得 त्र्यंश 滿分`);
    if (full.length !== 2) bad.push(`${iso} त्र्यंश 得滿者 ${full.length} 顆,應為 2`);
    // 四主必須都是七曜之一 —— 1805 年前 ahargaṇa 為負,JS 的 % 會給負索引
    const L = R.kalaLords(ch);
    for (const k of ['varsha','masa','dina','hora'])
      if (R.SHADBALA_GRAHAS.indexOf(L[k]) < 0) bad.push(`${iso} ${k} 主 = ${L[k]}(ahar ${L.ahar})`);
    R.SHADBALA_GRAHAS.forEach(q => { const v = R.tribhagaBala(q, ch);
      if (v !== 0 && v !== 60) bad.push(`${iso} ${q} 的 त्र्यंश = ${v},只能是 0 或 60`); });
    // 27.18:日的 चेष्टा 即其 अयन、月的 चेष्टा 即其 पक्ष
    if (Math.abs(R.chestaBala('Sun', ch) - R.ayanaBala('Sun', ch)) > 1e-9) bad.push(`${iso} 日 चेष्टा ≠ अयन`);
    if (Math.abs(R.chestaBala('Moon', ch) - R.pakshaBala('Moon', ch)) > 1e-9) bad.push(`${iso} 月 चेष्टा ≠ पक्ष`);
    let retro = 0;
    for (const q of R.SHADBALA_GRAHAS){
      const b = R.shadbala(q, ch), c = R.chestaBala(q, ch), k = kb(q);
      if (!(c >= 0 && c <= 60)) bad.push(`${iso} ${q} चेष्टा ${c} 超出 0..60`);
      for (const [n, v] of Object.entries(k.parts))
        if (!(v >= 0 && v <= (n === 'varshadi' ? 150 : 60))) bad.push(`${iso} ${q} काल.${n} = ${v} 超出範圍`);
      if (Math.abs(k.total - Object.values(k.parts).reduce((a,x)=>a+x,0)) > 1e-9) bad.push(`${iso} ${q} काल 總和不符`);
      if (Object.values(b.parts).some(v => v === null)) bad.push(`${iso} ${q} 仍有未實作的力`);
      if (Math.abs(b.total - (Object.values(b.parts).reduce((a,x)=>a+x,0) + b.yuddha)) > 1e-9)
        bad.push(`${iso} ${q} 總力 ≠ 六力和 + 星戰修正`);
      // 逆行 ⇒ चेष्टाकेन्द्र 逾 90°(古典逆行界最窄的火金也在 163°–197°,餘裕充足)
      if (ch.planets[q].retro && q !== 'Moon' && q !== 'Sun'){
        retro++;
        if (!(c > 30)) bad.push(`${iso} ${q} 逆行卻只得 चेष्टा ${c.toFixed(2)}`);
      }
    }
    return { bad, retro };
  }, [iso, lat, lon]);
  scanBad.push(...r.bad); scanN++; retroN += r.retro;
}
console.log(`六力掃描:${scanN} 盤,其中逆行星 ${retroN} 顆`);
if (!scanBad.length && retroN >= 3) { pass++; console.log('✅ नत 互補／त्र्यंश 分配／27.18 等同／逆行得高 चेष्टा／總力=六力和+星戰,在實際盤面全部成立'); }
else { fail++; console.log(`❌ 六力掃描有誤:\n   ${scanBad.slice(0, 8).join('\n   ') || `逆行樣本不足(${retroN})`}`); }


// ── 吉凶果 Iṣṭa／Kaṣṭa(BPHS 第 28 章)─────────────────────────────────────
// 期望值獨立抄自梵文,不從 HTML 讀。重點是驗兩章互證的恆等式:
// 28.2「सैको राशिर्…द्विघ्नांशसंयुतः」得 रश्मि = 1 + 弧/30,而 27.1–2a 的 उच्चबल = 弧/3,
// 故 (रश्मि − 1) × 10 必須恰等於該力 —— 這是「第 27 章的力」與「第 28 章的光」為
// 同一個量的證據,不是兩套系統。चेष्टा 同理(火星以下依 27.24 的 चेष्टाकेन्द्र)。
const ik28 = [];
for (let y = 1957; y <= 2013; y += 14) {
  await page.fill('#bdate', `${y}-07-11`);
  await page.fill('#btime', '21:40');
  await page.click('#go');
  await page.waitForTimeout(320);
  ik28.push(await page.evaluate(() => {
    const R = window.__rules, st = R.state, bad = [];
    const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) bad.push(`${msg}:${a.toFixed(4)} vs ${b.toFixed(4)}`); };
    for (const p of R.SHADBALA_GRAHAS) {
      const lon = st.chart.planets[p].lon;
      // ① उच्चरश्मि ↔ उच्चबल
      near((R.ucchaRasmi(p, lon) - 1) * 10, R.ucchaBala(p, lon), 1e-9, `${p} उच्चरश्मि↔उच्चबल`);
      // ② रश्मि 值域 1..7(28.2 的「सैको राशिः」上限為六宮 + 1)
      for (const r of [R.ucchaRasmi(p, lon), R.chestaRasmi(p)])
        if (r < 1 - 1e-9 || r > 7 + 1e-9) bad.push(`${p} रश्मि ${r.toFixed(3)} 逸出 1..7`);
      // ③ 火星以下:चेष्टारश्मि ↔ 27.24 的 चेष्टाबल
      if (['Mars','Mercury','Jupiter','Venus','Saturn'].includes(p))
        near((R.chestaRasmi(p) - 1) * 10, R.chestaBala(p), 1e-9, `${p} चेष्टारश्मि↔चेष्टाबल`);
      // ④ 28.4 月的 चेष्टाकेन्द्र(月 − 日)與 27.10 पक्ष 的弧同源
      if (p === 'Moon') {
        const k = R.chesta28Kendra('Moon'), arc = k > 180 ? 360 - k : k;
        near(arc / 3, R.pakshaBala('Moon'), 1e-9, 'Moon 28.4 केन्द्र ↔ 27.10 पक्ष');
      }
      // ⑤ 28.9・11 的互補:吉分 + 不吉分 = 60
      const ik = R.ishtaKashta(p);
      near(ik.subha + ik.asubha, 60, 1e-9, `${p} शुभ+अशुभ`);
      near(ik.net, 2 * ik.subha - 60, 1e-9, `${p} net`);
      for (const [k] of R.ISHTA_CHANNELS)
        if (ik.vals[k] < -1e-9 || ik.vals[k] > 60 + 1e-9) bad.push(`${p} 子項 ${k} = ${ik.vals[k].toFixed(2)} 逸出 0..60`);
      // ⑤b 七分盤 शुभाङ्क 只作參考:仍要算出且在 0..60,但**不得進入合成**
      //     (0818 判斷:它是九級吉果的絕對量、中性級 sama=8,不是以 30 為中心的力,
      //      併入算術平均會加進恆為負的偏移 —— 見 index.html 的 ISHTA_REF 註)
      for (const [k] of R.ISHTA_REF) {
        if (!(k in ik.vals)) bad.push(`${p} 參考項 ${k} 未算出`);
        else if (ik.vals[k] < -1e-9 || ik.vals[k] > 60 + 1e-9) bad.push(`${p} 參考項 ${k} 逸出 0..60`);
        if (R.ISHTA_CHANNELS.some(([c]) => c === k)) bad.push(`${k} 不應同時列為計分子項`);
      }
      {
        const keys = R.ISHTA_CHANNELS.map(([k]) => k);
        const mean = keys.reduce((a, k) => a + ik.vals[k], 0) / keys.length;
        near(ik.subha, mean, 1e-9, `${p} शुभ 只由計分子項合成`);
      }
    }
    // ⑥ 羅睺計都無自身之力,取星座主星之果(28 章只論七曜)
    for (const n of ['Rahu','Ketu']) {
      const ik = R.ishtaKashta(n);
      const disp = R.SIGN_LORD[R.V.rasiOf(st.chart.planets[n].lon)];
      if (ik.via !== disp) bad.push(`${n} 未循星座主星:${ik.via} ≠ ${disp}`);
      const d = R.ishtaKashta(disp);
      if (Math.abs(ik.net - d.net) > 1e-9) bad.push(`${n} 之果與主星不同`);
    }
    // ⑦ 本命論斷:分數必須與大運層走同一個 28 章的量(不得另立一套),
    //    且敘述不得沾到大運層的時間語境 —— buildNatal 與 buildInterp 分家的理由就在此
    for (const p of ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu']) {
      const nt = R.buildNatal(p);
      if (Math.abs(nt.score - R.ishtaKashta(p).net) > 1e-9)
        bad.push(`${p} 本命論斷的分數 ${nt.score} ≠ 28 章淨吉分`);
      for (const w of ['大運','流年','流月','流日','流時','期間'])
        if (nt.html.indexOf(w) >= 0) bad.push(`${p} 本命論斷混入大運層語彙「${w}」`);
      if (nt.html.indexOf('BPHS 28.6–12') < 0) bad.push(`${p} 本命論斷未標分數出處`);
    }
    return bad;
  }));
}
const ik28Bad = ik28.flat();
console.log(`\n第 28 章掃描:${ik28.length} 盤 × 七曜 + 兩交點`);
if (!ik28Bad.length) { pass++; console.log('✅ (रश्मि−1)×10 = 該力、月 28.4 केन्द्र = 27.10 पक्ष 弧、吉分+不吉分=60,逐盤成立'); }
else { fail++; console.log(`❌ 第 28 章有誤:\n   ${ik28Bad.slice(0, 8).join('\n   ')}`); }

// 28.8 的 शुभाङ्क 與 3.59 的吉果成數必須在共有的四級上一致(概括版 vs 精確版)。
// 3.59:旺滿 1／三角 ¾／本宮 ½／友宮 ¼ —— ×60 得 60／45／30／15。
const shared = { exalt: 1, mt: 0.75, own: 0.5, mitra: 0.25 };
const ankaBad = await page.evaluate((shared) => {
  const S = window.__rules.SUBHANKA, bad = [];
  for (const [k, ratio] of Object.entries(shared))
    if (S[k] !== ratio * 60) bad.push(`${k}:28.8 給 ${S[k]},3.59 成數 ×60 給 ${ratio * 60}`);
  // 九級必須嚴格遞減,且首尾為 60 與 0
  const order = ['exalt','mt','own','adhimitra','mitra','sama','shatru','adhishatru','nica'];
  for (let i = 1; i < order.length; i++)
    if (S[order[i]] >= S[order[i - 1]]) bad.push(`${order[i]} 未低於 ${order[i - 1]}`);
  if (S.exalt !== 60 || S.nica !== 0) bad.push('首尾不是 60 與 0');
  return bad;
}, shared);
if (!ankaBad.length) { pass++; console.log('✅ 28.8 九級 शुभाङ्क 與 3.59 成數在共有四級上一致,且九級嚴格遞減'); }
else { fail++; console.log(`❌ शुभाङ्क 有誤:\n   ${ankaBad.join('\n   ')}`); }

// 頁面上的六力表:七曜各一行、六欄都有數、總力／rūpa／इष्ट／कष्ट 四欄要與引擎相符,
// 且必須指明評分依第 28 章、並列出與英譯的分歧。
const sbUi = await page.evaluate(() => {
  const R = window.__rules;
  const trs = [...document.querySelectorAll('#sbtable tr')].slice(1);
  const bad = [];
  if (trs.length !== 7) bad.push(`表格 ${trs.length} 行,應為七曜 7 行`);
  trs.forEach((tr, i) => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
    const p = R.SHADBALA_GRAHAS[i];
    const b = R.shadbala(p);
    if (tds.slice(1, 7).some(x => x === '—')) bad.push(`${p} 仍有欄位顯示「—」:${tds.slice(1,7)}`);
    if (tds[7] !== b.total.toFixed(2)) bad.push(`${p} 表上總力 ${tds[7]} ≠ ${b.total.toFixed(2)}`);
    if (tds[8] !== (b.total/60).toFixed(2)) bad.push(`${p} 表上 rūpa ${tds[8]} ≠ ${(b.total/60).toFixed(2)}`);
    const ik = R.ishtaKashta(p);
    if (tds[9]  !== ik.subha.toFixed(2))  bad.push(`${p} 表上 इष्ट ${tds[9]} ≠ ${ik.subha.toFixed(2)}`);
    if (tds[10] !== ik.asubha.toFixed(2)) bad.push(`${p} 表上 कष्ट ${tds[10]} ≠ ${ik.asubha.toFixed(2)}`);
    if (Math.abs(ik.subha + ik.asubha - 60) > 1e-9) bad.push(`${p} इष्ट+कष्ट ≠ 60(28.9・11)`);
  });
  const note = document.getElementById('sbnote').textContent;
  if (!note.includes('28.12')) bad.push('註記未指明評分依 BPHS 28.12');
  if (!note.includes('與英譯的分歧')) bad.push('註記未列出與英譯的分歧');
  if (!note.includes('不加倍')) bad.push('註記未聲明月 pakṣa／日 ayana 不加倍');
  return bad;
});
if (!sbUi.length) { pass++; console.log('✅ 頁面六力表六欄齊備,總力／rūpa／इष्ट／कष्ट 與引擎一致,且已聲明分歧與 28.12 依據'); }
else { fail++; console.log(`❌ 六力表有誤:\n   ${sbUi.join('\n   ')}`); }

console.log(`\npageerror:${errs.length ? errs.join(';') : '(無)'}`);
console.log(`結果:${pass} 通過 / ${fail} 失敗`);
await browser.close();
process.exit(fail ? 1 : 0);

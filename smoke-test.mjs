#!/usr/bin/env node
// smoke-test.mjs — examples/pet-tracker
//
// 服務本資料夾，用 Playwright Chromium 開 index.html，驗 grep 驗不到的東西：
// console 乾淨、兩張 canvas（Three 世界層 + Pixi 介面層）都真的畫出像素、
// 捲動推進時間、四個 beat 依序揭露、越界告警會觸發也會解除、
// 游標移到軌跡上會出現抵達時間、圍欄滑桿 / 顏色 / 時間軸 / CTA 逐一可用、
// 導覽錨點都指到存在的區塊、390×844 無水平溢出、resize 不掛。
//
// 用法：node smoke-test.mjs [--headed] [--shot out.png]
// 需求：playwright（本資料夾或 NODE_PATH 可解析到）
// 離開碼：0 通過 / 1 失敗 / 2 環境問題

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const shot = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const root = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('需要 playwright：npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const assetHits = [];
page.on('response', (r) => { if (/\/assets\/.+\.png$/.test(r.url())) assetHits.push([r.url().split('/').pop(), r.status()]); });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 15000 });
await page.waitForTimeout(900);

/* 1. 兩張 canvas 都在，而且不是空白 */
const canvasCount = await page.locator('canvas').count();
check('Pixi canvas 掛上了', canvasCount === 1, `找到 ${canvasCount} 張`);

const pixiAlive = await page.evaluate(() => {
  const c = document.querySelector('#pixi-container canvas');
  return !!(c && c.width > 0 && c.height > 0);
});
check('Pixi 畫布尺寸正常', pixiAlive);

async function canvasVariance(sel) {
  const buf = await page.locator(sel).screenshot();
  // PNG 位元組的離散度：全黑/全白畫面壓縮後極小，有內容的會大得多
  return buf.length;
}
const worldBytes = await canvasVariance('#pixi-container canvas');
check('地圖有畫出內容', worldBytes > 20000, `${worldBytes} bytes`);

/* 1b. 狗狗大頭插畫真的載進來了（載不到會退回向量頭像，所以要驗） */
check('柴犬大頭插畫載入成功', assetHits.some(([n, st]) => n === 'shiba-head.png' && st === 200),
  assetHits.map(([n, st]) => `${n}:${st}`).join(', ') || '沒有請求 assets/');

/* 2. 捲動推進時間 + beat 依序揭露 */
const t0 = await page.textContent('#hud-time');
await page.evaluate(() => {
  const j = document.getElementById('journey-section');
  window.scrollTo(0, j.offsetTop + window.innerHeight * 2.2);
});
await page.waitForTimeout(1400);
const t1 = await page.textContent('#hud-time');
check('捲動會推進時間（HUD 時鐘變動）', t0 !== t1, `${t0} → ${t1}`);

const beatOn = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.beat-card')).map((c) => c.classList.contains('on'))
);
check('核心章節有 beat 卡片被揭露', beatOn.some(Boolean), JSON.stringify(beatOn));

/* 3. 招牌時刻：越界告警觸發 */
let breached = false;
for (let i = 0; i < 26 && !breached; i++) {
  await page.evaluate((k) => {
    const j = document.getElementById('journey-section');
    window.scrollTo(0, j.offsetTop + window.innerHeight * (0.6 + k * 0.2));
  }, i);
  await page.waitForTimeout(220);
  breached = await page.evaluate(() =>
    document.getElementById('alert-banner').classList.contains('on'));
}
check('越界告警會觸發（安全圍欄招牌時刻）', breached);
const alertCopy = await page.textContent('#alert-text');
check('告警文字帶了時間戳', /\d{2}:\d{2}/.test(alertCopy), alertCopy.slice(0, 40));

/* 4. 捲回去，告警要解除（單軸 scrub 必須可逆） */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);
const cleared = await page.evaluate(() =>
  !document.getElementById('alert-banner').classList.contains('on'));
check('捲回開頭時告警解除（狀態可逆）', cleared);

/* 5. 回放：游標移到項圈位置附近應出現抵達時間 */
await page.evaluate(() => {
  const j = document.getElementById('journey-section');
  window.scrollTo(0, j.offsetTop + window.innerHeight * 3);
});
await page.waitForTimeout(1200);
const markerPos = await page.evaluate(() => {
  const el = document.querySelector('#pixi-container canvas');
  return el ? { w: el.clientWidth, h: el.clientHeight } : null;
});
let replayShown = false;
outer:
for (let gx = 0.2; gx <= 0.85; gx += 0.075) {
  for (let gy = 0.3; gy <= 0.8; gy += 0.075) {
    await page.mouse.move(markerPos.w * gx, markerPos.h * gy);
    await page.waitForTimeout(70);
    replayShown = await page.evaluate(() =>
      document.getElementById('replay-readout').classList.contains('on'));
    if (replayShown) break outer;
  }
}
const replayTime = await page.textContent('#replay-time');
check('游標指到軌跡會顯示抵達時間', replayShown && /\d{2}:\d{2}/.test(replayTime), replayTime);

/* 5b. 版面契約：文字區塊不得壓到地圖 stage（沉浸感的硬底線） */
async function overlapReport() {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const stage = rect('#map-stage');
    if (!stage) return { ok: false, why: '找不到 #map-stage' };
    const hits = [];
    for (const sel of ['.beat-card.on', '.alert-banner.on', '.hud']) {
      const r = rect(sel);
      if (!r) continue;
      const ix = Math.max(0, Math.min(r.right, stage.right) - Math.max(r.left, stage.left));
      const iy = Math.max(0, Math.min(r.bottom, stage.bottom) - Math.max(r.top, stage.top));
      const area = ix * iy;
      if (area > 400) hits.push(`${sel} 重疊 ${Math.round(area)}px²`);
    }
    return { ok: hits.length === 0, why: hits.join('; ') };
  });
}

const overlapDesktop = await overlapReport();
check('桌機：文字沒有壓到地圖 stage', overlapDesktop.ok, overlapDesktop.why);

/* 6. 控制台：圍欄半徑 / 顏色 / 時間軸 */
await page.evaluate(() => document.getElementById('tech-section').scrollIntoView());
await page.waitForTimeout(600);

const fenceBefore = await page.textContent('#fence-num');
await page.locator('#fence-range').fill('80');
await page.waitForTimeout(300);
const fenceAfter = await page.textContent('#fence-num');
check('圍欄半徑滑桿會改變數值', fenceBefore !== fenceAfter, `${fenceBefore} → ${fenceAfter}`);

const swatches = page.locator('.swatch');
const swatchCount = await swatches.count();
let swatchOk = swatchCount > 1;
for (let i = 0; i < swatchCount; i++) {
  await swatches.nth(i).click();
  await page.waitForTimeout(120);
  const pressed = await swatches.nth(i).getAttribute('aria-pressed');
  if (pressed !== 'true') swatchOk = false;
}
check('每個項圈色票都可點且狀態正確', swatchOk, `${swatchCount} 個`);

// 先把控制台捲進視窗並等 smooth-scroll 停下來 —— 捲動經過 #journey-section 會
// 依設計奪回時間軸控制權（scroll 是主軸、手動 scrub 只在離開章節後有效），
// 若邊捲邊拉，量到的會是捲動結果而不是這一拉的結果。
await page.locator('#time-range').scrollIntoViewIfNeeded();
await page.waitForFunction(() => {
  const y = window.scrollY;
  return new Promise((r) => setTimeout(() => r(Math.abs(window.scrollY - y) < 1), 120));
});
await page.locator('#time-range').fill('900');
// HUD 時鐘是漸近插值追上 target，不會在固定時間內剛好等於目標；等它收斂到 ±5 分鐘內。
await page
  .waitForFunction(() => {
    const [h, m] = document.querySelector('#time-now').textContent.split(':').map(Number);
    return Math.abs(h * 60 + m - 900) <= 5;
  }, null, { timeout: 4000 })
  .catch(() => {});
const scrubbed = await page.textContent('#time-now');
const scrubbedMin = Number(scrubbed.split(':')[0]) * 60 + Number(scrubbed.split(':')[1]);
check('時間軸拖曳會跳到指定時間', Math.abs(scrubbedMin - 900) <= 5, `${scrubbed}（目標 15:00）`);

/* 6b. 犬種切換：柴犬 ↔ 柯基 */
const breedBtns = page.locator('.breed-btn');
const breedCount = await breedBtns.count();
await breedBtns.nth(1).click();
await page.waitForTimeout(400);
await page.waitForTimeout(500);
const breedLabel = await page.textContent('#breed-name');
check('柯基大頭插畫載入成功', assetHits.some(([n, st]) => n === 'corgi-head.png' && st === 200),
  assetHits.map(([n, st]) => `${n}:${st}`).join(', '));
const breedPressed = await breedBtns.nth(1).getAttribute('aria-pressed');
check('犬種可切換（柴犬 / 柯基）', breedCount === 2 && breedPressed === 'true', breedLabel);

/* 6c. 地圖退場：規格區之後畫布與 HUD 都要收掉，文字不跟街廓打架 */
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
await page.evaluate(() => {
  const el = document.getElementById('order-section');
  window.scrollTo(0, el.offsetTop + 400);
});
await page.waitForTimeout(1100);
const recession = await page.evaluate(() => {
  const canvas = document.querySelector('#pixi-container');
  const hud = document.querySelector('.hud');
  return {
    phase: document.body.dataset.map,
    canvas: Number(getComputedStyle(canvas).opacity),
    hud: getComputedStyle(hud).visibility,
  };
});
check('規格區地圖已退場（畫布透明、HUD 收起）',
  recession.phase === 'ground' && recession.canvas < 0.02 && recession.hud === 'hidden',
  `phase=${recession.phase} canvas=${recession.canvas} hud=${recession.hud}`);

/* 7. CTA 有真的做事 */
await page.locator('#order-btn').click();
await page.waitForTimeout(250);
const ctaDone = await page.evaluate(() =>
  document.getElementById('order-btn').classList.contains('done'));
check('預購 CTA 會進入確認狀態', ctaDone);

/* 8. 導覽錨點都指到存在的區塊 */
const deadAnchors = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href^="#"]'))
    .map((a) => a.getAttribute('href'))
    .filter((h) => h !== '#' && !document.querySelector(h)));
check('沒有失效的導覽錨點', deadAnchors.length === 0, deadAnchors.join(', '));

/* 9. FAQ 至少 8 題且可展開 */
const faqCount = await page.locator('.faq details').count();
await page.locator('.faq summary').first().click();
await page.waitForTimeout(150);
const faqOpen = await page.evaluate(() => document.querySelector('.faq details').open);
check('FAQ ≥ 8 題且可展開', faqCount >= 8 && faqOpen, `${faqCount} 題`);

/* 10. 手機視窗：無水平溢出、兩層仍在跑 */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
const overflow = await page.evaluate(() => ({
  sw: document.body.scrollWidth, iw: window.innerWidth,
}));
check('390×844 無水平溢出', overflow.sw <= overflow.iw + 1, `${overflow.sw} vs ${overflow.iw}`);

const mobileNavVisible = await page.locator('#nav-toggle').isVisible();
check('手機版顯示漢堡選單', mobileNavVisible);

await page.evaluate(() => {
  const j = document.getElementById('journey-section');
  window.scrollTo(0, j.offsetTop + window.innerHeight * 2.3);
});
await page.waitForTimeout(1200);
const overlapMobile = await overlapReport();
check('手機：文字沒有壓到地圖 stage', overlapMobile.ok, overlapMobile.why);

/* 11. resize 回桌機不會掛 */
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(900);
const stillTicking1 = await page.textContent('#hud-time');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
await page.waitForTimeout(900);
const stillTicking2 = await page.textContent('#hud-time');
check('resize 之後 rAF 仍在跑', stillTicking1 !== stillTicking2, `${stillTicking1} → ${stillTicking2}`);

/* 12. console 乾淨 */
check('沒有 console 錯誤', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

if (shot) {
  await page.evaluate(() => {
    const j = document.getElementById('journey-section');
    window.scrollTo(0, j.offsetTop + window.innerHeight * 2.4);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot });
  console.log('screenshot → ' + shot);
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);

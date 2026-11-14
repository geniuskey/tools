// 없는 주소: 짐작한 도구, 404 를 넣어 본 카드, 아무 도구나 뽑기. 실행: npm run build && npx vite preview --port 4317 & npm run e2e
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright-core';
import { tools } from '../src/lib/tools';

const BASE = process.env.BASE_URL ?? 'http://localhost:4317';
const SHOTS = 'e2e/screenshots';
const opened: Browser[] = [];
afterEach(async () => {
  for (const b of opened.splice(0)) await b.close().catch(() => {});
});

async function open(path: string, viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
  opened.push(browser);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  // 없는 주소라서 문서 자체의 404 는 당연하다. 그 밖의 오류만 본다.
  page.on('console', (m) => m.type() === 'error' && !/404 \(Not Found\)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  return { page, errors };
}

test('오타 난 주소는 가까운 도구를 짚어 준다', async () => {
  const { page, errors } = await open('/calulator');
  assert.equal(await page.locator('h1').innerText(), '여기엔 도구가 없습니다.');
  assert.equal(await page.locator('.digits').innerText().then((t) => t.replace(/\s/g, '')), '404');
  assert.equal(await page.locator('.diff .del code').innerText(), '/calulator');
  assert.equal(await page.locator('.diff .add code').innerText(), '/calculator');
  assert.equal(await page.locator('.diff ins').innerText(), 'c');

  // 카드는 도구 엔진이 계산한 값
  const fact = (id: string) => page.locator(`.fact[href="/${id}"] strong`);
  assert.equal(await fact('calculator').innerText(), '20.0997512422');
  assert.equal(await fact('unit').innerText(), '1,335.54 m²');
  assert.equal(await fact('cron').innerText(), '매달 4일 오전 0시 4분');
  assert.equal(await fact('encode').innerText(), 'L2NhbHVsYXRvcg==');
  assert.match(await fact('color').innerText(), /10\.26 : 1/);
  assert.equal(await fact('text').innerText(), '10글자 · 10바이트');
  assert.match(await fact('date').innerText(), /^\d{4}년 \d+월 \d+일 \(.\)$/);
  assert.equal(await page.locator('.fact').count(), 8);
  await page.waitForFunction(() => document.querySelector('.clock')?.textContent?.trim() !== '0:00');

  await page.screenshot({ path: `${SHOTS}/404.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${SHOTS}/404-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${SHOTS}/404-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.locator('.guess .go').click();
  await page.waitForURL(BASE + '/calculator');
  assert.deepEqual(errors, []);
});

test('검색어 · 하위 주소 · 짐작할 수 없는 주소', async () => {
  const a = await open('/json');
  assert.equal(await a.page.locator('.guess .go b').innerText(), '데이터 뷰어');
  assert.equal(await a.page.locator('.diff').count(), 0);

  const b = await open('/qr/abc');
  assert.equal(await b.page.locator('.diff .del code').innerText(), '/qr…');
  assert.equal(await b.page.locator('.guess .go').getAttribute('href'), '/qr');

  const c = await open('/wp-admin');
  assert.equal(await c.page.locator('.guess').count(), 0);
  assert.equal(await c.page.locator('.fact').count(), 8);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
});

test('아무 도구나 뽑기', async () => {
  const { page, errors } = await open('/nowhere-at-all');
  await page.getByRole('button', { name: '아무 도구나 뽑기' }).click();
  const won = page.locator('a.slot.won');
  await won.waitFor();
  const href = await won.getAttribute('href');
  assert.ok(tools.some((t) => t.href === href));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('won')), true);
  await page.screenshot({ path: `${SHOTS}/404-drawn.png` });
  await page.getByRole('button', { name: '다시 뽑기' }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(BASE + href);
  assert.deepEqual(errors, []);
});

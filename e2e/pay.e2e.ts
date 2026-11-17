// 연봉 · 금액의 핵심 흐름. 실행: BASE_URL=http://localhost:4317 npx tsx --test e2e/pay.e2e.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4317';
const SHOTS = 'e2e/screenshots';
const opened: Browser[] = [];
afterEach(async () => {
  for (const b of opened.splice(0)) await b.close().catch(() => {});
});

async function open(path: string, viewport = { width: 1440, height: 900 }, dark = false) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
  opened.push(browser);
  const ctx = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  return { browser, page, errors };
}

test('연봉 · 금액: 실수령액 → 가족 · 자녀 → 거꾸로 → 연봉표', async () => {
  const { page, errors } = await open('/pay');
  const hero = page.locator('.hero-card .hero');
  const salary = page.getByLabel('연봉', { exact: true });
  await salary.fill('4500만');
  assert.equal(await hero.innerText(), '3,259,730원');
  const row = (name: string) => page.locator('.rows li', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).locator('.v');
  assert.equal(await row('국민연금').innerText(), '168,620');
  assert.equal(await row('근로소득세').innerText(), '132,110');
  await page.screenshot({ path: `${SHOTS}/pay-net.png` });

  // 단위 없이 적으면 만 원 단위로
  await salary.fill('4500');
  await page.getByText('만 원 단위로 읽었습니다').waitFor();
  assert.equal(await hero.innerText(), '3,259,730원');

  // 가족 4명 · 자녀 2명이면 세금이 준다
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '한 명 더하기', exact: true }).click();
  await page.getByRole('button', { name: '자녀 한 명 더하기' }).click();
  await page.getByRole('button', { name: '자녀 한 명 더하기' }).click();
  const tax = Number((await row('근로소득세').innerText()).replace(/,/g, ''));
  assert.ok(tax < 132_110 && tax > 0, String(tax));

  // 거꾸로: 실수령 300만이 되려면
  await page.getByLabel('원하는 월 실수령액').fill('300만');
  const need = page.locator('.answer .link');
  await need.waitFor();
  await need.click();
  const net = Number((await hero.innerText()).replace(/\D/g, ''));
  assert.ok(net >= 3_000_000 && net < 3_010_000, String(net));

  // 연봉표: 지금 연봉과 가까운 줄이 강조된다
  await page.getByRole('button', { name: '연봉표' }).click();
  await page.locator('tr.near').waitFor();
  assert.ok((await page.locator('tbody tr').count()) > 50);
  await page.getByRole('button', { name: '엑셀로 복사' }).click();
  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(tsv, /^연봉\t월 세전\t국민연금/);
  await page.screenshot({ path: `${SHOTS}/pay-table.png` });

  // 저장한 값 지우기: 처음 값(연봉 4,500만 · 1명)으로
  await page.getByRole('button', { name: '저장한 값 지우기' }).click();
  await page.getByText('저장한 값을 지우고 처음 값으로 돌렸습니다').waitFor();
  await page.getByRole('button', { name: '실수령액' }).click();
  assert.equal(await hero.innerText(), '3,259,730원');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await hero.innerText(), '3,259,730원');
  assert.deepEqual(errors, []);
});

test('연봉 · 금액: 금액 한글 표기 · 부가세', async () => {
  const { page, errors } = await open('/pay#words');
  const input = page.getByLabel('금액', { exact: true });
  await input.fill('1억 2,345만 6,789원');
  const val = (name: string) => page.locator('.list li', { has: page.locator('.name', { hasText: name }) }).locator('.val');
  assert.equal(await val('계약서').innerText(), '일금 일억이천삼백사십오만육천칠백팔십구원정');
  assert.equal(await val('갖은자').innerText(), '金 壹億貳仟參佰肆拾伍萬陸仟柒佰捌拾玖 圓整');
  assert.equal(await val('숫자 + 단위').innerText(), '1억 2,345만 6,789원');
  await val('계약서').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '일금 일억이천삼백사십오만육천칠백팔십구원정');

  await input.fill('110,000');
  await page.getByRole('button', { name: '부가세 포함 합계다' }).click();
  const vat = page.locator('.rows li', { has: page.locator('b', { hasText: /^부가세$/ }) }).locator('.v');
  assert.equal(await vat.innerText(), '10,000');
  await page.screenshot({ path: `${SHOTS}/pay-words.png` });

  await input.fill('사과');
  await page.getByText('금액으로 읽지 못했습니다').waitFor();
  assert.deepEqual(errors, []);
});

test('연봉 · 금액: 좁은 화면 · 어두운 화면', async () => {
  const { page, errors } = await open('/pay', { width: 390, height: 844 }, true);
  await page.locator('.hero-card').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로로 ${overflow}px 넘친다`);
  await page.screenshot({ path: `${SHOTS}/pay-mobile-dark.png`, fullPage: true });
  assert.deepEqual(errors, []);
});

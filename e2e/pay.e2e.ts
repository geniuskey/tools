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

test('연봉 · 금액: 중소기업 감면 · 회사가 쓰는 돈 · 연봉 비교', async () => {
  const { page, errors } = await open('/pay');
  await page.getByLabel('연봉', { exact: true }).fill('4500만');
  const row = (name: string) => page.locator('.rows li', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).locator('.v');
  await page.getByRole('button', { name: '청년 90%' }).click();
  const tax = Number((await row('근로소득세').innerText()).replace(/,/g, ''));
  assert.ok(tax < 132_110 * 0.2, String(tax));
  await page.getByText('회사가 쓰는 돈').first().waitFor();
  await page.screenshot({ path: `${SHOTS}/pay-net-employer.png`, fullPage: true });

  // 실수령액 → 비교: 지금과 10% 인상
  await page.getByRole('button', { name: '인상 · 이직과 비교 →' }).click();
  await page.locator('.say').waitFor();
  assert.match(await page.locator('.say').innerText(), /세전으로 한 해 450만원/);
  assert.equal(await page.evaluate(() => location.hash), '#compare');
  await page.getByRole('button', { name: '+20%' }).click();
  assert.equal(await page.locator('thead th .name').count(), 3);
  await page.getByLabel('20% 인상 연봉').fill('6000만');
  await page.getByText('60,000,000원').waitFor();
  await page.screenshot({ path: `${SHOTS}/pay-compare.png` });
  await page.getByRole('button', { name: '20% 인상 빼기' }).click();
  assert.equal(await page.locator('thead th .name').count(), 2);
  assert.deepEqual(errors, []);
});

test('연봉 · 금액: 시급 · 퇴직금 · 3.3%', async () => {
  const { page, errors } = await open('/pay#hourly');
  const hero = page.locator('.hero-card .hero');
  assert.equal(await hero.innerText(), '2,156,880원');
  await page.getByRole('button', { name: '1일', exact: true }).click();
  await page.locator('.rows li', { hasText: '주휴수당' }).getByText('15시간 미만').waitFor();
  await page.getByRole('button', { name: '3.3% (프리랜서)' }).click();
  await page.getByText('소득세 3%').waitFor();
  await page.screenshot({ path: `${SHOTS}/pay-hourly.png` });

  await page.keyboard.press('5');
  await page.getByLabel('입사일').fill('2016-11-18');
  await page.getByLabel(/마지막 근무일/).fill('2026-11-17');
  await page.getByLabel(/퇴직 전 3개월 월 임금/).fill('4000000');
  await page.getByText('퇴직소득세', { exact: false }).first().waitFor();
  const pay = Number((await hero.innerText()).replace(/\D/g, ''));
  assert.ok(pay > 39_000_000 && pay < 41_000_000, String(pay));
  await page.screenshot({ path: `${SHOTS}/pay-severance.png` });
  await page.getByLabel('입사일').fill('2026-01-01');
  await page.getByText('1년(365일)을 채우지 못해').waitFor();

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('6'); // 숫자 키로 탭
  await page.getByLabel('금액', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: '받을 돈이다 (세후)' }).click();
  const gross = page.locator('.rows li', { has: page.locator('b', { hasText: /^지급액$/ }) }).locator('.v');
  assert.equal(await gross.innerText(), '1,034,120');
  assert.deepEqual(errors, []);
});

test('연봉 · 금액: 좁은 화면 · 어두운 화면', async () => {
  const { page, errors } = await open('/pay', { width: 390, height: 844 }, true);
  await page.locator('.hero-card').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로로 ${overflow}px 넘친다`);
  await page.screenshot({ path: `${SHOTS}/pay-mobile-dark.png`, fullPage: true });
  for (const tab of ['compare', 'hourly', 'severance', 'words']) {
    await page.goto(`${BASE}/pay#${tab}`, { waitUntil: 'networkidle' });
    await page.locator('.card').first().waitFor();
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(o <= 0, `${tab}: 가로로 ${o}px 넘친다`);
    await page.screenshot({ path: `${SHOTS}/pay-mobile-${tab}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
});

// cron 풀이 도구의 핵심 흐름. 실행: BASE_URL=http://localhost:4317 npx tsx --test e2e/cron.e2e.ts
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
  const ctx = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2, timezoneId: 'Asia/Seoul' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  return { browser, page, errors };
}

test('cron 풀이: 읽기 · 다음 실행 · 형식', async () => {
  const { browser, page, errors } = await open('/cron');
  const input = page.getByRole('textbox', { name: 'cron 식' });
  const sentence = page.locator('.sentence');
  const runs = page.getByRole('list', { name: '다음 실행 시각' }).locator('li');

  // 처음에는 평일 오전 9시
  assert.equal(await sentence.innerText(), '평일 오전 9시');
  assert.equal(await runs.count(), 10);
  assert.match(await runs.first().innerText(), /오전 9:00/);
  await page.screenshot({ path: `${SHOTS}/cron.png` });

  // 칸마다 풀이: 커서가 있는 칸이 강조된다
  await input.click();
  await input.press('End');
  await page.locator('.rows li.on', { hasText: '평일 (월~금요일)' }).waitFor();
  await page.locator('.tok', { hasText: '시' }).first().click();
  await page.locator('.rows li.on', { hasText: '9시' }).waitFor();

  // 함정: 일과 요일을 둘 다 정하면 "또는"
  await input.fill('0 0 13 * 5');
  assert.equal(await sentence.innerText(), '매달 13일 또는 매주 금요일 자정');
  await page.getByText('둘 중 하나만 맞아도 돕니다').first().waitFor();

  // 45분마다가 아니다
  await input.fill('*/45 * * * *');
  await page.getByText('45분마다가 아닙니다').waitFor();

  // 틀린 칸을 짚어 준다
  await input.fill('0 24 * * *');
  await page.getByRole('alert').getByText('시 칸:').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /자정은 0 입니다/);
  assert.equal(await page.locator('.tok.bad').count(), 1);
  await page.screenshot({ path: `${SHOTS}/cron-error.png` });

  // Quartz: 매달 마지막 금요일
  await input.fill('0 30 18 ? * 6L');
  assert.equal(await sentence.innerText(), '매달 마지막 금요일 오후 6시 30분');
  assert.equal(await page.locator('.dialects button[aria-pressed="true"]').innerText(), '자동');
  await page.getByText('Quartz 형식(초 분 시 일 월 요일)').waitFor();
  for (const t of (await runs.allInnerTexts()).slice(0, 5)) assert.match(t, /\(금\)[\s\S]*오후 6:30/);

  // 형식 바꾸기: Unix 로는 적을 수 없고, Spring · AWS 로는 된다
  const formats = page.locator('.formats');
  assert.match(await formats.innerText(), /Unix\s+L · W · #/);
  assert.match(await formats.innerText(), /cron\(30 18 \? \* 6L \*\)/);
  await page.getByRole('button', { name: 'Spring 식으로 바꾸기' }).click();
  assert.equal(await input.inputValue(), '0 30 18 * * FRIL');
  assert.equal(await sentence.innerText(), '매달 마지막 금요일 오후 6시 30분');

  // GitHub Actions: UTC 로 옮겨 준다
  await input.fill('0 9 * * 1-5');
  await page.getByRole('tab', { name: 'GitHub' }).click();
  assert.match(await page.locator('pre.code').innerText(), /- cron: '0 0 \* \* 1-5'/);
  await page.getByRole('button', { name: '복사', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /schedule:/);
  await page.getByRole('tab', { name: 'Kubernetes' }).click();
  assert.match(await page.locator('pre.code').innerText(), /timeZone: "Asia\/Seoul"/);
  await page.screenshot({ path: `${SHOTS}/cron-snippet.png` });

  // 서머타임: 뉴욕 2:30 은 3월 둘째 일요일에 없다
  await input.fill('CRON_TZ=America/New_York 30 2 * * 0');
  await page.locator('.tok', { hasText: 'America/New_York' }).waitFor();
  assert.equal(await page.getByLabel('시간대', { exact: true }).isDisabled(), true);

  // 빌더: 고르면 식이 바뀐다
  await input.fill('0 9 * * 1-5');
  await page.getByRole('group', { name: '얼마나 자주' }).getByRole('button', { name: '매주' }).click();
  const days = page.getByRole('group', { name: '요일', exact: true });
  await days.getByRole('button', { name: '수' }).click();
  await days.getByRole('button', { name: '금' }).click();
  await page.getByLabel('시각', { exact: true }).fill('18:30');
  assert.equal(await input.inputValue(), '30 18 * * 1,3,5');
  assert.equal(await sentence.innerText(), '매주 월 · 수 · 금요일 오후 6시 30분');
  await page.getByRole('group', { name: '얼마나 자주' }).getByRole('button', { name: '매달' }).click();
  await page.getByLabel('어느 날').selectOption('last');
  await page.getByText('Unix cron 에 없습니다').first().waitFor();
  await page.locator('.dialects').getByRole('button', { name: 'Quartz' }).click();
  await page.getByLabel('어느 날').selectOption('lastWeekday');
  assert.equal(await input.inputValue(), '0 30 18 LW * ?');
  assert.equal(await sentence.innerText(), '매달 마지막 평일 오후 6시 30분');
  await page.screenshot({ path: `${SHOTS}/cron-builder.png` });

  // 2월 30일은 오지 않는다
  await page.locator('.dialects').getByRole('button', { name: '자동' }).click();
  await input.fill('0 0 30 2 *');
  await page.getByText('이 식은 한 번도 돌지 않습니다').waitFor();
  assert.match(await page.getByText('이 식은 한 번도 돌지 않습니다').locator('..').innerText(), /2월에는 30일이 없습니다/);

  // 새로 고쳐도 식이 남는다
  await input.fill('*/15 9-18 * * 1-5');
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('textbox', { name: 'cron 식' }).inputValue(), '*/15 9-18 * * 1-5');
  assert.equal(await sentence.innerText(), '평일 오전 9시부터 오후 6시 45분까지 15분마다');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('cron 풀이: 좁은 화면 · 어두운 화면', async () => {
  const { browser, page, errors } = await open('/cron', { width: 390, height: 844 }, true);
  await page.getByRole('textbox', { name: 'cron 식' }).fill('0 30 18 ? * 6L');
  await page.locator('.sentence').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, '가로로 넘치지 않는다');
  await page.screenshot({ path: `${SHOTS}/cron-mobile-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.cron').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.screenshot({ path: `${SHOTS}/cron-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

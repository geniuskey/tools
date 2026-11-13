// 색상 · 대비 도구의 핵심 흐름. 실행: BASE_URL=http://localhost:4317 npx tsx --test e2e/color.e2e.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright-core';

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

const ratio = (page: Page) => page.getByTestId('ratio').innerText();
const tab = (page: Page, name: string) => page.getByRole('group', { name: '무엇을 할까' }).getByRole('button', { name, exact: true }).click();

test('색상 · 대비: 대비 검사와 제안', async () => {
  const { browser, page, errors } = await open('/color');
  const fg = page.getByLabel('글자 색', { exact: true });
  const bg = page.getByLabel('배경 색', { exact: true });
  await fg.fill('#777');
  await bg.fill('white');
  assert.match(await ratio(page), /^4\.47\s*: 1$/);
  const levels = page.locator('.levels li');
  assert.match(await levels.filter({ hasText: 'AA 본문' }).first().innerText(), /✕/);
  assert.match(await levels.nth(2).innerText(), /✓\s*AA 큰 글자/);

  // 가장 가까운 통과 색: #767676
  const pick = page.getByRole('button', { name: /글자 색을 어둡게 — #767676/ });
  await pick.waitFor();
  await page.screenshot({ path: `${SHOTS}/color-contrast-fail.png` });
  await pick.click();
  assert.equal(await fg.inputValue(), '#767676');
  assert.match(await ratio(page), /^4\.54/);
  await page.getByText('기준을 넘습니다').waitFor();

  // 어떤 표기든 받는다 · 반투명 글자
  await fg.fill('oklch(40% 0.2 262)');
  await bg.fill('rgb(248 249 250)');
  await page.getByTestId('ratio').filter({ hasText: /^9\.20/ }).waitFor();
  await fg.fill('rgb(0 0 0 / 50%)');
  await page.getByText(/반투명한 색은 겹쳐 보이는 색으로/).waitFor();
  await fg.fill('이상한 색');
  await page.getByText('알아볼 수 없는 색입니다').waitFor();
  await fg.fill('#c2255c');
  // 글자와 배경 바꾸기 (X)
  await page.locator('h2#h-ratio').click();
  await page.keyboard.press('x');
  assert.equal(await bg.inputValue(), '#c2255c');
  assert.equal(await fg.inputValue(), 'rgb(248 249 250)');
  // 색각 이상 미리보기 다섯 칸
  assert.equal(await page.locator('.tiles .tile').count(), 5);
  await page.getByRole('button', { name: 'AAA 본문 7' }).click();
  await page.screenshot({ path: `${SHOTS}/color-contrast.png`, fullPage: true });

  // 새로고침해도 남는다
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('배경 색', { exact: true }).inputValue(), '#c2255c');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('색상 · 대비: 변환 · 팔레트', async () => {
  const { browser, page, errors } = await open('/color');
  await tab(page, '변환');
  const base = page.getByLabel('아무 표기로나 붙여넣으세요', { exact: true });
  await base.fill('#2563eb');
  const row = (label: string) => page.getByRole('button', { name: new RegExp(`^${label} (?!\\()`) });
  assert.match(await row('RGB').innerText(), /rgb\(37 99 235\)/);
  assert.match(await row('HSL').innerText(), /hsl\(221\.2 83\.2% 53\.3%\)/);
  assert.match(await row('OKLCH').innerText(), /oklch\(54\.6\d?% 0\.2\d+ 262\.\d+\)/);
  await row('OKLCH').click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^oklch\(/);
  await page.getByText('OKLCH 복사했습니다').waitFor();
  await page.screenshot({ path: `${SHOTS}/color-convert.png` });

  // 넓은 색역 → 맞춘 색
  await base.fill('color(display-p3 0 1 0)');
  await page.getByText(/sRGB 밖의 색입니다/).waitFor();
  assert.match(await row('HEX').innerText(), /#00f[0-9a-f]{3}\b/);
  await page.screenshot({ path: `${SHOTS}/color-convert-p3.png` });

  // 팔레트
  await base.fill('#c2255c');
  await tab(page, '팔레트');
  assert.equal(await page.locator('.strip li').count(), 11);
  assert.match(await page.locator('.strip button.base').getAttribute('aria-label') ?? '', /#c2255c/);
  await page.getByRole('button', { name: '삼각' }).click();
  assert.equal(await page.locator('.harm li').count(), 3);
  await page.getByLabel('이름', { exact: true }).fill('Rose');
  await page.locator('select').filter({ hasText: 'Tailwind v4' }).selectOption('tailwind4');
  assert.match(await page.getByLabel('내보낼 코드').innerText(), /--color-rose-500: oklch\(/);
  await page.getByRole('button', { name: '복사', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^@theme \{/);
  await page.screenshot({ path: `${SHOTS}/color-palette.png`, fullPage: true });
  // 대비 칸을 누르면 대비 탭으로
  await page.getByRole('button', { name: /^900 바탕에 흰 글자/ }).click();
  assert.equal(await page.getByLabel('글자 색', { exact: true }).inputValue(), '#ffffff');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('색상 · 대비: 사진에서 따오기', async () => {
  const { browser, page, errors } = await open('/color');
  await tab(page, '사진');
  await page.getByText('스크린샷을 붙여넣거나').waitFor();
  // 네 칸으로 칠한 그림을 만들어 연다
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const x = c.getContext('2d')!;
    for (const [col, a, b] of [['#2563eb', 0, 0], ['#ffd43b', 200, 0], ['#2f9e44', 0, 150], ['#2563eb', 200, 150]] as const) {
      x.fillStyle = col;
      x.fillRect(a, b, 200, 150);
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: '네 칸.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  const cv = page.locator('.stage > canvas');
  await cv.waitFor();
  await page.getByRole('group', { name: '따온 색을 넣을 곳' }).getByRole('button', { name: '배경 색' }).click();
  const box = (await cv.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.25);
  await page.locator('.lens').waitFor();
  await page.screenshot({ path: `${SHOTS}/color-picker.png` });
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);
  await page.getByText('#ffd43b 를 배경 색에 넣었습니다').waitFor();
  // 주요 색: 파랑이 절반
  const dom = page.locator('.dom li');
  assert.equal(await dom.count(), 3);
  assert.match(await dom.first().innerText(), /#2563eb\s*50%/);
  // 키보드: 화살표로 옮기고 Enter
  await page.mouse.move(0, 0);
  await cv.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Enter');
  await page.getByText('#2f9e44 를 배경 색에 넣었습니다').waitFor();
  await tab(page, '대비');
  assert.equal(await page.getByLabel('배경 색', { exact: true }).inputValue(), '#2f9e44');
  // 붙여넣은 색은 마지막으로 고른 칸으로
  await page.getByLabel('글자 색', { exact: true }).focus();
  await page.locator('h2#h-ratio').click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hsl(0 0% 100%)');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  assert.equal(await page.getByLabel('글자 색', { exact: true }).inputValue(), 'hsl(0 0% 100%)');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('색상 · 대비: 휴대폰 · 어두운 화면', async () => {
  const { browser, page, errors } = await open('/color', { width: 390, height: 844 }, true);
  await page.getByLabel('글자 색', { exact: true }).fill('#868e96');
  await page.screenshot({ path: `${SHOTS}/color-mobile-dark.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  await tab(page, '팔레트');
  await page.screenshot({ path: `${SHOTS}/color-palette-mobile.png`, fullPage: true });
  await tab(page, '변환');
  await page.screenshot({ path: `${SHOTS}/color-convert-mobile.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab(page, '대비');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${SHOTS}/color-dark.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

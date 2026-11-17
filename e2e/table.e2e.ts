// 표 변환의 핵심 흐름. 실행: BASE_URL=http://localhost:4317 npx tsx --test e2e/table.e2e.ts
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

/** 엑셀처럼 글과 HTML 을 함께 붙여넣는다 */
async function pasteRich(page: import('playwright-core').Page, text: string, html: string) {
  await page.evaluate(
    ([t, h]) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      dt.setData('text/html', h);
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [text, html],
  );
}

test('표 변환: 붙여넣기 → 고치기 → 마크다운 · 서식 있는 표 · SQL', async () => {
  const { page, errors } = await open('/table');
  const out = page.locator('pre.code');

  // 엑셀에서 합친 칸이 있는 표를 붙여넣는다 (서식 쪽에서 합친 칸까지)
  const html = '<table><tr><td rowspan=2>팀</td><td>이름</td><td align=right>점수</td></tr><tr><td>하늘</td><td align=right>92</td></tr><tr><td>디자인</td><td>서연</td><td align=right>88</td></tr></table>';
  await pasteRich(page, '팀\t이름\t점수\n\t하늘\t92\n디자인\t서연\t88\n', html);
  await page.getByText('서식에서 합친 칸 1개까지 읽었습니다').waitFor();
  assert.match(await page.locator('.read').innerText(), /3줄 × 3칸/);
  assert.match(await out.innerText(), /\| 팀 +\| 이름 \| 점수 \|/);
  await page.screenshot({ path: `${SHOTS}/table-paste.png` });

  // 칸을 고치면 결과가 바로 바뀐다
  const cell = page.getByRole('textbox', { name: 'B2', exact: true });
  await cell.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('김하늘');
  await page.keyboard.press('Enter'); // 아래 칸으로
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-label')), 'B3');
  assert.match(await out.innerText(), /김하늘/);


  // 열 메뉴: 오름차순 정렬 (합친 칸은 풀린다)
  await page.getByRole('button', { name: 'C열 메뉴' }).click();
  await page.getByRole('menuitem', { name: /오름차순 정렬/ }).click();
  assert.match(await out.innerText(), /디자인 \| 서연 +\| +88 \|\n\| 팀 +\| 김하늘 \| +92 \|/);


  // 되돌리기 (칸 밖에서 ⌘Z)
  await page.locator('h2', { hasText: '무엇으로 바꿀까' }).click();
  await page.keyboard.press('ControlOrMeta+Z');
  assert.match(await out.innerText(), /\| +\| 김하늘 \| +92 \|\n\| 디자인/);


  // SQL · CREATE TABLE
  await page.getByRole('radio', { name: 'SQL' }).click();
  await page.getByLabel('CREATE TABLE 도').check();
  assert.match(await out.innerText(), /CREATE TABLE `my_table` \(\n  `팀` VARCHAR\(50\),\n  `이름` VARCHAR\(50\),\n  `점수` INTEGER\n\);/);


  // 서식 있는 표는 진짜 표로 복사된다
  await page.getByRole('radio', { name: '서식 있는 표' }).click();
  await page.locator('.rich table').waitFor();
  await page.getByRole('button', { name: '복사', exact: true }).click();

  await page.getByText('서식 있는 표로 복사했습니다').waitFor();
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return { types: item.types, plain: await (await item.getType('text/plain')).text(), html: await (await item.getType('text/html')).text() };
  });
  assert.ok(clip.types.includes('text/html'));
  assert.match(clip.html, /<th rowspan="2"[^>]*>팀/);
  assert.match(clip.plain, /^팀\t이름\t점수\n/);
  await page.screenshot({ path: `${SHOTS}/table-rich.png` });

  // 새로 고쳐도 그대로
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.rich table').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'B2', exact: true }).innerText(), '김하늘');
  assert.deepEqual(errors, []);
});

test('표 변환: 칸에 여러 칸을 붙여넣으면 표가 늘어난다 · 글자 표 · 행 ↔ 열', async () => {
  const { page, errors } = await open('/table');
  await page.getByRole('button', { name: '빈 표 만들기' }).click();
  const cell = page.getByRole('textbox', { name: 'A1', exact: true });
  await cell.click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '도시\t인구\n서울\t9,386,000\n부산\t3,293,000\n대구\t2,374,000\n인천\t3,000,000\n');
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText('5줄 × 2칸을 붙여넣었습니다').waitFor();
  await page.getByRole('radio', { name: '글자 표' }).click();
  const out = page.locator('pre.code');
  assert.match(await out.innerText(), /│ 서울 │ 9,386,000 │/);
  await page.getByRole('button', { name: '+-+ ASCII' }).click();
  assert.match(await out.innerText(), /^\+------\+-----------\+/);
  await page.getByRole('button', { name: '행 ↔ 열' }).click();
  assert.match(await out.innerText(), /\| 도시 \| +서울 +\| +부산 +\| +대구 +\| +인천 +\|\n\+/);
  assert.deepEqual(errors, []);
});

test('표 변환: 좁은 화면 · 어두운 화면', async () => {
  const { page, errors } = await open('/table', { width: 390, height: 844 }, true);
  await page.getByRole('button', { name: '마크다운', exact: true }).first().click();
  await page.locator('pre.code').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `가로로 ${overflow}px 넘친다`);
  await page.screenshot({ path: `${SHOTS}/table-mobile-dark.png`, fullPage: true });
  assert.deepEqual(errors, []);
});

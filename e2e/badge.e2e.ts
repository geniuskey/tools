// 이름표 · 좌석표. 실행: npx vite dev --port 4331 --strictPort & BASE_URL=http://localhost:4331 npx tsx --test e2e/badge.e2e.ts
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

const DEPTS = ['개발', '디자인', '영업', '인사'];
const NAMES = ['김솔', '남궁하늘', '제갈공명선생님', 'Alexander Maximilian von Humboldt'];
const rows = Array.from({ length: 22 }, (_, i) => `${NAMES[i] ?? `사람${String(i + 1).padStart(2, '0')}`}\t${DEPTS[i % 4]}${i === 1 ? '\t플랫폼개발본부 미래전략기획조정실 수석연구원' : ''}`);

/** 이름표 글자가 제 상자를 넘지 않는가 (넘친 것의 이름을 돌려준다) */
const overflowing = (page: Page) =>
  page.locator('.sheet .face').evaluateAll((faces) =>
    faces.flatMap((f) => {
      const box = f.querySelector('.text')!.getBoundingClientRect();
      const face = f.getBoundingClientRect();
      return [...f.querySelectorAll('.name, .info, .event')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const lim = el.classList.contains('event') ? face : box;
          // 마지막 글자 뒤에 붙는 글자 사이 띄움은 보이지 않으니 뺀다
          const right = r.right - (parseFloat(getComputedStyle(el).letterSpacing) || 0);
          return r.left < lim.left - 0.5 || right > lim.right + 0.5 || r.top < face.top - 0.5 || r.bottom > face.bottom + 0.5;
        })
        .map((el) => el.textContent);
    }),
  );

test('이름표', async () => {
  const { browser, page, errors } = await open('/badge');
  assert.match(await page.locator('.out .empty').innerText(), /명단을 넣으면/);
  await page.getByLabel('참가자 명단').fill(rows.join('\n'));
  assert.equal(await page.locator('.people .count').innerText(), '22명');
  assert.equal(await page.locator('.out .count').innerText(), '3장 · 이름표 22개');
  assert.equal(await page.locator('.sheet').count(), 3);
  assert.equal(await page.locator('.sheet .cell').count(), 22);
  await page.getByLabel('행사 이름').fill('2026 신입사원 환영회');
  await page.getByLabel('번호').check();
  assert.deepEqual(await overflowing(page), []);

  // 종이는 실제 mm 비율, 칸은 90×55mm
  const geo = await page.evaluate(() => {
    const s = document.querySelector('.sheet')!.getBoundingClientRect();
    const c = document.querySelector('.sheet .cell')!.getBoundingClientRect();
    return { ratio: s.height / s.width, cell: c.width / s.width, cellRatio: c.height / c.width };
  });
  assert.ok(Math.abs(geo.ratio - 297 / 210) < 0.002);
  assert.ok(Math.abs(geo.cell - 90 / 210) < 0.002);
  assert.ok(Math.abs(geo.cellRatio - 55 / 90) < 0.005);

  // 이름 크기: 짧은 이름이 가장 크고 벌어져 있다, 긴 이름은 작다, 아주 긴 이름은 두 줄
  const size = (n: number) => page.locator('.sheet .cell').nth(n).locator('.name').first().evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el).letterSpacing) || 0]);
  const [sol, haneul, long] = [await size(0), await size(1), await size(2)];
  assert.ok(sol[0] >= haneul[0] && haneul[0] > long[0], `${sol[0]} ≥ ${haneul[0]} > ${long[0]}`);
  assert.ok(sol[1] > haneul[1] && long[1] === 0);
  assert.equal(await page.locator('.sheet .cell').nth(3).locator('.name').count(), 2);
  assert.equal(await page.locator('.sheet .cell').nth(1).locator('.info').count(), 2, '긴 소속은 두 줄');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/badge-names.png` });

  // 몇 번째 칸부터
  await page.getByLabel('몇 번째 칸부터').fill('4');
  assert.equal(await page.locator('.out .count').innerText(), '3장 · 이름표 22개');
  assert.equal(await page.locator('.sheet').first().locator('.cell').count(), 7);
  await page.getByLabel('몇 번째 칸부터').fill('10');
  assert.equal(await page.locator('.out .count').innerText(), '4장 · 이름표 22개');
  await page.getByLabel('몇 번째 칸부터').fill('1');

  // 사람마다 고치기
  await page.getByRole('button', { name: '남궁하늘 이름표 고치기' }).click();
  await page.getByLabel('이름표에 적을 이름').fill('하늘');
  assert.equal(await page.locator('.sheet .cell').nth(1).locator('.name').innerText(), '하늘');
  await page.getByRole('button', { name: /고친 것 1개 되돌리기/ }).click();
  assert.equal(await page.locator('.sheet .cell').nth(1).locator('.name').innerText(), '남궁하늘');

  // QR, 옆 띠, 왼쪽 맞춤
  await page.getByLabel('사람마다 QR 넣기').check();
  await page.getByLabel('QR 내용').fill('https://example.com/checkin?no={번호}');
  assert.equal(await page.locator('.sheet .qr svg').count(), 22);
  await page.getByRole('group', { name: '색 띠' }).getByRole('button', { name: '옆' }).click();
  await page.getByRole('group', { name: '글자 맞춤' }).getByRole('button', { name: '왼쪽' }).click();
  assert.deepEqual(await overflowing(page), []);
  await page.screenshot({ path: `${SHOTS}/badge-qr.png` });

  // 규격을 바꿔도 넘치지 않는다
  for (const [id, per] of [['63.5x38.1', 21], ['99.1x38.1', 14], ['99.1x67.7', 8], ['100x70', 8]] as const) {
    await page.getByLabel('규격').selectOption(id);
    assert.equal(await page.locator('.out .count').innerText(), `${Math.ceil(22 / per)}장 · 이름표 22개`);
    assert.deepEqual(await overflowing(page), [], id);
    if (id === '63.5x38.1') await page.screenshot({ path: `${SHOTS}/badge-labels.png` });
  }
  // Letter 에는 들어가는 만큼만
  await page.getByLabel('종이').selectOption('Letter');
  assert.match(await page.locator('.setup .note').first().innerText(), /Letter 에는 2×3칸까지/);
  await page.getByLabel('종이').selectOption('A4');

  // 사용자 지정: 종이를 넘으면 알려 준다
  await page.getByLabel('규격').selectOption('custom');
  await page.getByLabel('가로 칸 수').fill('3');
  assert.match(await page.locator('.setup [role=alert]').innerText(), /칸이 종이를 넘어갑니다: 가로로 65mm/);
  assert.equal(await page.locator('.sheet').count(), 0);
  assert.ok(await page.getByRole('button', { name: '인쇄' }).isDisabled());
  await page.getByLabel('가로 칸 수').fill('2');
  assert.equal(await page.locator('.sheet .cell').count(), 22);

  // 접는 명패: 한 장에 한 명, 위쪽은 뒤집어서
  await page.getByLabel('규격').selectOption('tent');
  assert.equal(await page.locator('.out .count').innerText(), '22장 · 명패 22개');
  assert.equal(await page.locator('.sheet').first().locator('.face').count(), 2);
  assert.equal(await page.locator('.sheet').first().locator('.flipped').count(), 1);
  assert.deepEqual(await overflowing(page), []);
  await page.screenshot({ path: `${SHOTS}/badge-tent.png` });

  // 인쇄: 종이만, 실제 크기로
  await page.getByLabel('규격').selectOption('90x55');
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const print = await page.evaluate(() => {
    const s = document.querySelector('.sheet')!.getBoundingClientRect();
    return { w: s.width, h: s.height, header: !!document.querySelector('.shell > header')?.getClientRects().length, setup: !!document.querySelector('.setup')?.getClientRects().length, bg: getComputedStyle(document.querySelector('.face')!).backgroundColor };
  });
  assert.ok(Math.abs(print.w - (210 * 96) / 25.4) < 0.5 && Math.abs(print.h - (297 * 96) / 25.4) < 0.5, '실제 크기');
  assert.deepEqual([print.header, print.setup, print.bg], [false, false, 'rgb(255, 255, 255)']);
  await page.screenshot({ path: `${SHOTS}/badge-print.png`, fullPage: true });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
  assert.equal(pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length, 3, 'PDF 는 3장');
  assert.match(pdf, /\/MediaBox\s*\[\s*0 0 59[45](\.\d+)? 84[12](\.\d+)?\s*\]/);
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: `${SHOTS}/badge-dark.png` });

  // 새로 열어도 그대로
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.out .count').innerText(), '3장 · 이름표 22개');
  assert.equal(await page.getByLabel('행사 이름').inputValue(), '2026 신입사원 환영회');
  assert.equal(await page.locator('.sheet .qr svg').count(), 22);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('좌석표', async () => {
  const { browser, page, errors } = await open('/badge');
  await page.getByLabel('참가자 명단').fill(Array.from({ length: 24 }, (_, i) => `사람${String(i + 1).padStart(2, '0')}\t${DEPTS[i % 4]}`).join('\n'));
  await page.getByRole('button', { name: '좌석표' }).click();
  assert.match(await page.locator('.results .empty').innerText(), /자리 배치/);
  // 테이블 수 맞추기
  await page.getByLabel('테이블당 자리').fill('6');
  assert.match(await page.locator('.note.fit').innerText(), /자리 18개 · 참가자 24명/);
  assert.match(await page.locator('.setup [role=alert]').innerText(), /자리가 6개 모자랍니다/);
  await page.getByRole('button', { name: '테이블 4개로 맞추기' }).click();
  assert.equal(await page.getByLabel('테이블 수').inputValue(), '4');
  await page.getByLabel('앉히는 방법').selectOption('mix');
  await page.getByLabel('떨어뜨릴 사람').fill('사람01, 사람02, 사람03, 없는사람');
  await page.getByLabel('같은 테이블에 넣을 사람').fill('사람05, 사람06');
  assert.match(await page.locator('.setup .alert').innerText(), /명단에 없는 이름: 없는사람/);
  await page.getByRole('button', { name: '자리 배치' }).click();

  const read = () => page.locator('.plan > *').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.seat')].map((s) => ({ name: s.textContent!.trim(), info: s.getAttribute('title') ?? '' }))));
  for (let round = 0; round < 3; round++) {
    const tables = await read();
    assert.deepEqual(tables.map((t) => t.length), [6, 6, 6, 6]);
    assert.equal(new Set(tables.flat().map((s) => s.name)).size, 24);
    const of = (n: string) => tables.findIndex((t) => t.some((s) => s.name === n));
    assert.equal(new Set(['사람01', '사람02', '사람03'].map(of)).size, 3, '떨어뜨리기');
    assert.equal(of('사람05'), of('사람06'), '묶기');
    for (const t of tables) for (const d of DEPTS) assert.ok([1, 2].includes(t.filter((s) => s.info === d).length), `${d} 고르게`);
    await page.getByRole('button', { name: '다시 배치' }).click();
  }
  assert.equal(await page.locator('.results > .head .count').innerText(), '테이블 4개 · 24명');

  // 자리 둘을 눌러 맞바꾸기, 테이블 이름 고치기
  const before = await read();
  const [a, b] = [before[0][0].name, before[2][3].name];
  await page.getByRole('button', { name: `1번 테이블 1번 자리: ${a}` }).click();
  assert.match(await page.locator('.results .hint').innerText(), new RegExp(`${a} — 바꿀 자리를 누르세요`));
  await page.getByRole('button', { name: `3번 테이블 4번 자리: ${b}` }).click();
  const after = await read();
  assert.deepEqual([after[0][0].name, after[2][3].name], [b, a]);
  await page.getByLabel('1번 테이블 이름').fill('신랑측');

  // 이름으로 찾는 표: 가나다순
  const names = await page.locator('.lookup .l-name').evaluateAll((els) => els.map((e) => e.firstChild!.textContent!.trim()));
  assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y, 'ko')));
  assert.equal(names.length, 24);
  assert.equal(await page.locator('.lookup li', { hasText: b }).locator('.l-seat').innerText(), '신랑측 1번');
  await page.getByRole('button', { name: '찾는 표 복사' }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), new RegExp(`^${b} \\(.+\\) → 신랑측 1번$`, 'm'));
  await page.getByRole('button', { name: '복사', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^\[신랑측\] 6명\n1\. /);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 저장' }).click()]);
  assert.match(dl.suggestedFilename(), /^좌석표-\d{8}-\d{6}\.csv$/);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/badge-seating.png`, fullPage: true });

  // 인쇄: 배치도 한 장, 찾는 표는 다음 장부터
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${SHOTS}/badge-seating-print.png`, fullPage: true });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
  assert.equal(pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length, 2);
  await page.emulateMedia({ media: 'screen' });

  // 새로 열어도 같은 자리, 이름표에 테이블이 들어간다
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await read(), after);
  assert.equal(await page.getByLabel('1번 테이블 이름').inputValue(), '신랑측');
  await page.getByRole('button', { name: '이름표', exact: true }).click();
  await page.getByLabel('테이블', { exact: true }).check();
  assert.equal(await page.locator('.sheet .cell', { hasText: b }).locator('.table').innerText(), '신랑측');
  await page.screenshot({ path: `${SHOTS}/badge-table.png` });

  // 긴 탁자, 줄 맞춤
  await page.getByRole('button', { name: '좌석표' }).click();
  await page.getByRole('button', { name: '긴 탁자' }).click();
  await page.getByRole('button', { name: '다시 배치' }).click();
  assert.equal(await page.locator('.plan .long').count(), 4);
  assert.equal(await page.getByLabel('1번 테이블 이름').inputValue(), '1번 테이블', '자리 모양을 바꾸면 이름도 새로');
  await page.screenshot({ path: `${SHOTS}/badge-seating-long.png`, fullPage: true });
  await page.getByRole('button', { name: '줄 맞춤' }).click();
  await page.getByLabel('줄 수').fill('5');
  await page.getByLabel('한 줄 자리').fill('7');
  await page.getByLabel('앉히는 방법').selectOption('order');
  await page.getByRole('button', { name: '다시 배치' }).click();
  assert.deepEqual(await page.locator('.hall .row').evaluateAll((els) => els.map((e) => e.querySelectorAll('.seat:not(.free)').length)), [7, 7, 7, 3, 0]);
  assert.equal(await page.locator('.results > .head .count').innerText(), '4줄 · 24명');
  await page.screenshot({ path: `${SHOTS}/badge-seating-rows.png`, fullPage: true });
  // 명단이 바뀌면 알려 준다
  await page.getByLabel('참가자 명단').press('ControlOrMeta+End');
  await page.getByLabel('참가자 명단').pressSequentially('\n새사람');
  assert.match(await page.locator('.results [role=alert]').innerText(), /자리가 없는 사람 1명: 새사람/);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('이름표 · 좌석표: 좁은 화면', async () => {
  const { browser, page, errors } = await open('/badge', { width: 390, height: 800 });
  await page.getByRole('button', { name: '예시 명단' }).click();
  assert.equal(await page.locator('.out .count').innerText(), '3장 · 이름표 22개');
  assert.ok(await page.evaluate(() => document.querySelector('.page')!.scrollWidth <= 390), '가로로 넘치지 않는다');
  assert.ok((await page.locator('.sheet-wrap').first().boundingBox())!.width <= 390);
  await page.locator('.out').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/badge-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: '좌석표' }).click();
  await page.getByRole('button', { name: '자리 배치' }).click();
  assert.equal(await page.locator('.plan .round').count(), 3);
  assert.ok(await page.evaluate(() => document.querySelector('.page')!.scrollWidth <= 390));
  await page.screenshot({ path: `${SHOTS}/badge-seating-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await browser.close();
});

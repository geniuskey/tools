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
  // 좌석표를 열면 바로 배치도가 나오고, 설정을 바꾸면 그때그때 다시 앉힌다
  assert.equal(await page.locator('.canvas .tbl.round').count(), 3);
  assert.equal(await page.locator('.results > .head .count').innerText(), '테이블 3개 · 24명');
  // 테이블 수 맞추기
  await page.getByLabel('테이블당 자리').fill('6');
  assert.equal(await page.locator('.canvas .tbl.round').first().locator('.seat').count(), 6);
  assert.match(await page.locator('.note.fit').innerText(), /자리 18개 · 참가자 24명/);
  assert.match(await page.locator('.setup [role=alert]').innerText(), /자리가 6개 모자랍니다/);
  // 자리 × 열 × 행: 모자라면 행을 늘려 맞추고, 열을 줄여 2 × 2 로
  await page.getByRole('button', { name: '2행으로 맞추기' }).click();
  assert.equal(await page.getByLabel('행 수').inputValue(), '2');
  assert.equal(await page.locator('.canvas .tbl.round').count(), 6);
  await page.getByLabel('열 수').fill('2');
  assert.match(await page.locator('.note.fit').innerText(), /테이블 4개 · 자리 24개 · 참가자 24명/);
  const cells = await page.locator('.canvas .tbl').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  assert.ok(cells[0][1] === cells[1][1] && cells[0][0] < cells[1][0], JSON.stringify(cells));
  assert.ok(cells[2][0] === cells[0][0] && cells[2][1] > cells[0][1], '셋째는 다음 행 첫 열');
  await page.getByLabel('앉히는 방법').selectOption('mix');
  await page.getByLabel('떨어뜨릴 사람').fill('사람01, 사람02, 사람03, 없는사람');
  await page.getByLabel('같은 테이블에 넣을 사람').fill('사람05, 사람06');
  assert.match(await page.locator('.setup .alert').innerText(), /명단에 없는 이름: 없는사람/);

  const read = () => page.locator('.canvas .tbl').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.seat')].map((s) => ({ name: s.textContent!.trim(), info: s.getAttribute('title') ?? '' }))));
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

  // 사람을 끌어 다른 자리에 놓아 맞바꾸기 (고르기는 남지 않는다)
  const [c, d] = [after[0][1].name, after[1][2].name];
  const src = (await page.getByRole('button', { name: `1번 테이블 2번 자리: ${c}` }).boundingBox())!;
  const dst = (await page.getByRole('button', { name: `2번 테이블 3번 자리: ${d}` }).boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 });
  assert.equal(await page.locator('.carry').innerText(), c);
  await page.mouse.up();
  const dragged = await read();
  assert.deepEqual([dragged[0][1].name, dragged[1][2].name], [d, c]);
  assert.equal(await page.locator('.seat[aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator('.carry').count(), 0);
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
  assert.deepEqual(await read(), dragged);
  assert.equal(await page.getByLabel('1번 테이블 이름').inputValue(), '신랑측');
  await page.getByRole('button', { name: '이름표', exact: true }).click();
  await page.getByLabel('테이블', { exact: true }).check();
  assert.equal(await page.locator('.sheet .cell', { hasText: b }).locator('.table').innerText(), '신랑측');
  await page.screenshot({ path: `${SHOTS}/badge-table.png` });

  // 긴 탁자, 줄 맞춤
  await page.getByRole('button', { name: '좌석표' }).click();
  await page.getByRole('button', { name: '긴 탁자' }).click();
  assert.equal(await page.locator('.tbl.long').count(), 4);
  // 방향: 세로로 돌리면 좁고 길어진다
  const wide = (await page.locator('.tbl.long').first().boundingBox())!;
  await page.getByRole('group', { name: '탁자 방향' }).getByRole('button', { name: '세로' }).click();
  const tall = (await page.locator('.tbl.long').first().boundingBox())!;
  assert.notDeepEqual([wide.width, wide.height], [tall.width, tall.height]);
  // 세로 탁자는 한쪽 자리가 위아래로 놓인다
  const xs = await page.locator('.tbl.long').first().locator('.side').first().locator('.seat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  assert.equal(new Set(xs).size, 1, JSON.stringify(xs));
  assert.equal(await page.locator('.tbl.long.vertical').count(), 4);
  assert.equal(await page.getByLabel('1번 테이블 이름').inputValue(), '1번 테이블', '자리 모양을 바꾸면 이름도 새로');
  await page.screenshot({ path: `${SHOTS}/badge-seating-long.png`, fullPage: true });
  // 어떤 모양이든 앞이 어디인지 보인다
  assert.match(await page.locator('.front').innerText(), /^앞/);

  // 모둠 책상: 2인 책상을 칠판과 직각으로 마주 붙이고, 칠판에서 먼 쪽에 칠판을 보는 책상 하나
  await page.getByRole('button', { name: '모둠 책상' }).click();
  await page.getByLabel('테이블당 자리').fill('6');
  await page.getByLabel('앉히는 방법').selectOption('group');
  assert.equal(await page.locator('.tbl.pod').count(), 4);
  assert.deepEqual(await page.locator('.tbl.pod').first().locator('.desk').evaluateAll((els) => els.map((e) => [e.classList.contains('end'), e.querySelectorAll('.seat').length])), [[false, 2], [false, 2], [true, 2]]);
  assert.equal(await page.getByLabel('1번 모둠 이름').inputValue(), '1모둠');
  const desks = await page.locator('.tbl.pod').first().locator('.desk').evaluateAll((els) =>
    els.map((e) => [...e.querySelectorAll('.seat')].map((s) => { const r = s.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })),
  );
  // 마주 보는 책상: 두 자리가 위아래 (같은 x), 왼쪽 책상과 오른쪽 책상이 나란히
  for (const d of desks.slice(0, 2)) assert.ok(d[0][0] === d[1][0] && d[0][1] < d[1][1], JSON.stringify(desks));
  assert.ok(desks[0][0][0] < desks[1][0][0] && desks[0][0][1] === desks[1][0][1], JSON.stringify(desks));
  // 뒤 책상: 두 자리가 좌우 (같은 y), 마주 보는 책상보다 칠판에서 멀다
  assert.ok(desks[2][0][1] === desks[2][1][1] && desks[2][0][0] < desks[2][1][0], JSON.stringify(desks));
  assert.ok(desks[2][0][1] > desks[0][1][1], JSON.stringify(desks));
  assert.match(await page.locator('.front').innerText(), /^앞/);
  // 같은 소속끼리 앉히면 소속마다 색이 다르다
  assert.equal(await page.getByLabel('소속마다 색으로 표시').isChecked(), true);
  assert.deepEqual(await page.locator('.legend li').allInnerTexts(), DEPTS.map((d) => `${d} 6`));
  const colors = await page.locator('.canvas .seat.tint').evaluateAll((els) => els.map((e) => [e.getAttribute('title'), getComputedStyle(e).borderTopColor]));
  assert.equal(colors.length, 24);
  assert.equal(new Set(colors.map((c) => c[1])).size, 4);
  assert.equal(new Set(colors.map((c) => c.join())).size, 4, '같은 소속은 같은 색');

  // 테이블을 끌어서 옮긴다. 새로 고쳐도 그 자리. 오른쪽 끝을 넘기면 배치도가 넓어진다
  const pod = page.locator('.tbl.pod').nth(1);
  const spot = () => page.locator('.tbl.pod').nth(1).evaluate((e) => [parseFloat((e as HTMLElement).style.left), parseFloat((e as HTMLElement).style.top)]);
  const from = (await pod.boundingBox())!;
  const start = await spot();
  await page.mouse.move(from.x + 6, from.y + 6);
  await page.mouse.down();
  await page.mouse.move(from.x + 46, from.y + 126, { steps: 6 });
  await page.mouse.up();
  const to = await spot();
  assert.ok(Math.abs(to[0] - start[0] - 40) <= 2 && Math.abs(to[1] - start[1] - 120) <= 2, JSON.stringify([start, to]));
  await pod.locator('.grip').focus();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await spot(), [to[0] + 10, to[1]]);
  await page.screenshot({ path: `${SHOTS}/badge-seating-pod.png`, fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await spot(), [to[0] + 10, to[1]]);
  // 전체 화면: 화면에 맞게 키운다
  await page.getByRole('button', { name: '전체 화면' }).click();
  await page.locator('.box.full').waitFor();
  assert.ok((await page.locator('.box.full .title').innerText()).length > 0);
  await page.waitForFunction(() => document.querySelector('.box.full .canvas')!.getBoundingClientRect().height > innerHeight * 0.5);
  await page.screenshot({ path: `${SHOTS}/badge-seating-full.png` });
  await page.getByRole('button', { name: /닫기/ }).click();
  await page.locator('.box.full').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '테이블 자리 정돈' }).click();
  assert.deepEqual(await spot(), start, '정돈하면 제자리로');

  await page.getByRole('button', { name: '줄 맞춤' }).click();
  // 줄 맞춤: 2인 책상 × 3열 × 5행, 책상 사이는 통로
  await page.getByLabel('책상당 자리').fill('2');
  await page.getByLabel('열 수').fill('3');
  await page.getByLabel('행 수').fill('5');
  await page.getByLabel('앉히는 방법').selectOption('order');
  assert.deepEqual(await page.locator('.canvas .row').evaluateAll((els) => els.map((e) => e.querySelectorAll('.seat:not(.free)').length)), [6, 6, 6, 6, 0]);
  assert.equal(await page.locator('.results > .head .count').innerText(), '4줄 · 24명');
  const rowXs = await page.locator('.canvas .row').first().locator('.seat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  const steps = rowXs.slice(1).map((x, i) => x - rowXs[i]);
  assert.ok(steps[1] > steps[0] && steps[3] > steps[2] && steps[0] === steps[2], JSON.stringify(steps));
  await page.screenshot({ path: `${SHOTS}/badge-seating-rows.png`, fullPage: true });
  // 명단이 바뀌면 알려 준다
  await page.getByLabel('참가자 명단').press('ControlOrMeta+End');
  await page.getByLabel('참가자 명단').pressSequentially('\n새사람');
  assert.match(await page.locator('.results [role=alert]').innerText(), /자리가 없는 사람 1명: 새사람/);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('좌석표: 명단 없이 모양 미리 보기', async () => {
  const { browser, page, errors } = await open('/badge');
  await page.getByRole('button', { name: '좌석표' }).click();
  assert.equal(await page.locator('.canvas .tbl.round').count(), 3);
  assert.equal(await page.locator('.canvas .seat.free').count(), 24);
  assert.match(await page.locator('.results .hint').innerText(), /모양을 미리 봅니다/);
  await page.getByRole('button', { name: '줄 맞춤' }).click();
  await page.getByLabel('책상당 자리').fill('1');
  await page.getByLabel('열 수').fill('5');
  await page.getByLabel('행 수').fill('3');
  assert.deepEqual(await page.locator('.canvas .row').evaluateAll((els) => els.map((e) => e.querySelectorAll('.seat.free').length)), [5, 5, 5]);
  assert.equal(await page.locator('.results > .head .count').innerText(), '3줄 · 0명');
  // 명단을 넣으면 바로 앉는다
  await page.getByLabel('참가자 명단').fill('가\n나\n다\n라');
  assert.equal(await page.locator('.canvas .seat:not(.free)').count(), 4);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('좌석표: 오른쪽 클릭으로 자리 · 책상 · 테이블 막기와 치우기', async () => {
  const { browser, page, errors } = await open('/badge');
  await page.getByLabel('참가자 명단').fill(Array.from({ length: 8 }, (_, i) => `사람${String(i + 1).padStart(2, '0')}`).join('\n'));
  await page.getByRole('button', { name: '좌석표' }).click();
  await page.getByRole('button', { name: '모둠 책상' }).click();
  await page.getByLabel('테이블당 자리').fill('6');
  await page.getByLabel('열 수').fill('2');
  await page.getByLabel('앉히는 방법').selectOption('order');
  const seatedCount = () => page.locator('.canvas .seat:not(.free, .closed, .gone)').count();
  assert.equal(await seatedCount(), 8);
  const menu = page.getByRole('menu');

  // 자리 하나를 막는다: 앉아 있던 사람은 같은 모둠 빈 자리로
  await page.getByRole('button', { name: '1모둠 1번 자리: 사람01' }).click({ button: 'right' });
  assert.match(await menu.innerText(), /1모둠 1번 자리/);
  await menu.getByRole('menuitem', { name: '이 자리 앉지 못하게' }).click();
  assert.equal(await menu.count(), 0);
  await page.getByRole('button', { name: '1모둠 1번 자리: 앉지 못함' }).waitFor();
  assert.equal(await seatedCount(), 8);
  assert.equal(await page.locator('.tbl.pod').first().locator('.seat', { hasText: '사람01' }).count(), 1);
  assert.match(await page.locator('.note.fit').innerText(), /자리 11개/);

  // 책상을 치운다: 자리 둘이 사라지고, 앉아 있던 사람은 다른 자리로
  await page.getByRole('button', { name: /^1모둠 3번 자리/ }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '이 책상 치우기' }).click();
  assert.equal(await page.locator('.tbl.pod').first().locator('.seat.gone').count(), 2);
  assert.equal(await page.locator('.tbl.pod').first().locator('.desk.gone').count(), 1);
  assert.equal(await seatedCount(), 8);
  assert.match(await page.locator('.note.fit').innerText(), /자리 9개/);

  // 모둠을 통째로 치운다: 자리가 모자라면 알려 주고, 점선 칸을 눌러 되돌리면 다시 앉는다
  await page.locator('.tbl.pod').nth(1).locator('.cap .n').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '이 모둠 치우기' }).click();
  assert.equal(await page.locator('.tbl.pod').count(), 1);
  assert.match(await page.locator('.results [role=alert]').innerText(), /자리가 없는 사람 5명/);
  await page.getByRole('button', { name: /치운 모둠/ }).click();
  assert.equal(await page.locator('.tbl.pod').count(), 2);
  assert.equal(await seatedCount(), 8);
  assert.equal(await page.locator('.results [role=alert]').count(), 0);

  // 끌어서 막은 자리에 놓을 수 없다
  const closed = (await page.getByRole('button', { name: '1모둠 1번 자리: 앉지 못함' }).boundingBox())!;
  const mover = page.locator('.tbl.pod').nth(1).locator('.seat:not(.free)').first();
  const who = (await mover.innerText()).trim();
  const mb = (await mover.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.mouse.down();
  await page.mouse.move(closed.x + closed.width / 2, closed.y + closed.height / 2, { steps: 6 });
  await page.mouse.up();
  assert.equal((await mover.innerText()).trim(), who);

  // 다시 배치해도 막고 치운 것은 그대로, 새로 고쳐도 그대로
  await page.getByLabel('앉히는 방법').selectOption('random');
  await page.getByRole('button', { name: '1모둠 1번 자리: 앉지 못함' }).waitFor();
  assert.equal(await page.locator('.seat.gone').count(), 2);
  assert.equal(await seatedCount(), 8);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.seat.gone').count(), 2);
  await page.screenshot({ path: `${SHOTS}/badge-seating-off.png`, fullPage: true });
  // Esc 로 메뉴를 닫는다
  await page.locator('.tbl.pod').first().locator('.seat').first().click({ button: 'right' });
  await menu.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  // 모두 되돌리기
  await page.getByRole('button', { name: '막거나 치운 것 모두 되돌리기' }).click();
  assert.equal(await page.locator('.seat.gone, .seat.closed').count(), 0);
  assert.match(await page.locator('.note.fit').innerText(), /자리 12개/);
  // 열 · 자리 수를 바꾸면 막아 둔 것은 비운다
  await page.locator('.tbl.pod').first().locator('.seat').first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '이 자리 앉지 못하게' }).click();
  await page.getByLabel('열 수').fill('3');
  assert.equal(await page.locator('.seat.closed').count(), 0);
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
  assert.equal(await page.locator('.tbl.round').count(), 3);
  assert.ok(await page.evaluate(() => document.querySelector('.page')!.scrollWidth <= 390));
  await page.screenshot({ path: `${SHOTS}/badge-seating-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await browser.close();
});

// 실제 브라우저로 세 도구의 핵심 흐름을 확인한다. 실행: npm run build && npx vite preview --port 4317 & npm run e2e
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

test('랜딩', async () => {
  const { browser, page, errors } = await open('/');
  assert.equal(await page.locator('a.card').count(), 8);
  await page.screenshot({ path: `${SHOTS}/home.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${SHOTS}/home-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${SHOTS}/home-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await browser.close();
});

async function calc(page: Page, keys: string): Promise<string> {
  await page.keyboard.press('Escape');
  await page.keyboard.type(keys);
  await page.keyboard.press('Enter');
  return page.locator('input.expr').inputValue();
}

test('계산기', async () => {
  const { browser, page, errors } = await open('/calculator');
  assert.equal(await calc(page, '0.1+0.2'), '0.3');
  assert.equal(await calc(page, '200+10%'), '220');
  // 결과 뒤에 연산자를 누르면 이어서 계산, 숫자를 누르면 새 계산
  await page.keyboard.type('*2');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('input.expr').inputValue(), '440');
  await page.keyboard.type('7');
  assert.equal(await page.locator('input.expr').inputValue(), '7');
  // 키패드
  await page.keyboard.press('Escape');
  for (const k of ['9', '×', '9', '=']) await page.locator('.pad.basic .key', { hasText: new RegExp(`^${k.replace('×', '×')}$`) }).click();
  assert.equal(await page.locator('input.expr').inputValue(), '81');
  await page.screenshot({ path: `${SHOTS}/calc-basic.png` });

  await page.getByRole('tab', { name: '공학' }).click();
  assert.equal(await calc(page, 'sin(30)+2^10'), '1024.5');
  await page.keyboard.press('Escape');
  await page.keyboard.type('√(2)×π');
  await page.screenshot({ path: `${SHOTS}/calc-sci.png` });
  assert.equal(await calc(page, '1/0'), '1÷0');
  assert.ok(await page.locator('.err').isVisible());

  await page.getByRole('tab', { name: '프로그래머' }).click();
  assert.equal(await calc(page, '255'), '255');
  assert.match(await page.locator('.base-row', { hasText: 'HEX' }).innerText(), /FF/);
  await page.locator('.base-row', { hasText: 'HEX' }).click();
  assert.equal(await page.locator('input.expr').inputValue(), 'FF');
  assert.equal(await calc(page, 'ff and f0'), 'F0');
  await page.locator('.bit[aria-label="비트 0"]').click();
  assert.equal(await page.locator('input.expr').inputValue(), 'F1');
  await page.screenshot({ path: `${SHOTS}/calc-prog.png` });

  // 기록이 남고 새로고침해도 유지된다
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok((await page.locator('.history li').count()) >= 5);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole('tab', { name: '공학' }).click();
  await page.screenshot({ path: `${SHOTS}/calc-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('추첨기', async () => {
  const { browser, page, errors } = await open('/raffle');
  await page.getByRole('button', { name: '예시 명단' }).click();
  const countText = await page.locator('.people .count').innerText();
  const total = Number(countText.replace(/\D/g, ''));
  assert.ok(total > 250, countText);
  await page.locator('input[aria-label="당첨 인원"]').fill('3');
  await page.locator('input[aria-label="당첨 인원"]').blur();
  await page.getByRole('button', { name: '+ 경품 추가' }).click();
  await page.locator('input[aria-label="당첨 인원"]').nth(1).fill('20');
  await page.locator('input[aria-label="당첨 인원"]').nth(1).blur();
  await page.locator('label.event input').fill('2026 송년회 경품 추첨');
  await page.locator('.options label', { hasText: '효과음' }).locator('input').uncheck();
  await page.locator('.seg button', { hasText: '짧게' }).click();
  await page.screenshot({ path: `${SHOTS}/raffle-setup.png` });

  await page.locator('button.open').click();
  await page.screenshot({ path: `${SHOTS}/raffle-stage-intro.png` });
  // 한 명씩 세 번
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Space');
    await page.waitForFunction((n) => document.querySelectorAll('.stage .chip').length === n, i + 1, { timeout: 8000 });
    if (i === 0) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/raffle-stage-one.png` });
    }
  }
  // 당첨 취소 후 재추첨
  await page.locator('.stage .chip').first().click();
  await page.getByRole('button', { name: '취소하기' }).click();
  assert.equal(await page.locator('.stage .chip').count(), 2);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('.stage .chip').length === 3, null, { timeout: 8000 });

  // 다음 경품: 한꺼번에 20명
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('a');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('.stage .chip').length === 20, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/raffle-stage-batch.png` });
  await page.keyboard.press('Escape');

  const names = await page.locator('.result-list li:not(.void) .w-name').allInnerTexts();
  const infos = await page.locator('.result-list li:not(.void) .w-info').allInnerTexts();
  assert.equal(names.length, 23);
  assert.equal(new Set(names.map((n, i) => n + infos[i])).size, 23, '중복 당첨 없음');
  assert.equal(await page.locator('.result-list li.void').count(), 1);
  await page.screenshot({ path: `${SHOTS}/raffle-results.png` });

  // 새로고침 후에도 결과 유지
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.result-list li:not(.void)').count(), 23);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('이미지 편집기', async () => {
  const { browser, page, errors } = await open('/image');
  await page.screenshot({ path: `${SHOTS}/image-empty.png` });
  await page.getByRole('button', { name: '빈 캔버스' }).click();
  const box = (await page.locator('.stage canvas').boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  const dragLine = async (a: readonly [number, number], b: readonly [number, number]) => {
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 });
    await page.mouse.move(...b, { steps: 4 });
    await page.mouse.up();
  };
  const count = async () => Number(((await page.locator('.status').innerText()).match(/주석 (\d+)개/) ?? [0, 0])[1]);

  await page.keyboard.press('r');
  await dragLine(at(0.3, 0.3), at(0.5, 0.5));
  await page.keyboard.press('a');
  await dragLine(at(0.6, 0.3), at(0.45, 0.42));
  await page.keyboard.press('o');
  await dragLine(at(0.55, 0.5), at(0.7, 0.65));
  await page.keyboard.press('h');
  await dragLine(at(0.3, 0.6), at(0.5, 0.6));
  await page.keyboard.press('p');
  await dragLine(at(0.3, 0.68), at(0.45, 0.72));
  await page.keyboard.press('n');
  await page.mouse.click(...at(0.28, 0.28));
  await page.mouse.click(...at(0.62, 0.28));
  await page.keyboard.press('t');
  await page.mouse.click(...at(0.52, 0.36));
  await page.keyboard.type('여기를 확인하세요');
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await dragLine(at(0.32, 0.33), at(0.42, 0.4));
  assert.equal(await count(), 9);
  await page.screenshot({ path: `${SHOTS}/image-annotated.png` });

  // 실행 취소 · 다시 실행 · 삭제
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await count(), 8);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  assert.equal(await count(), 9);
  await page.keyboard.press('v');
  await page.mouse.click(...at(0.62, 0.28));
  await page.keyboard.press('Delete');
  assert.equal(await count(), 8);

  // 자르기
  await page.keyboard.press('c');
  await dragLine(at(0.28, 0.22), at(0.72, 0.76));
  await page.screenshot({ path: `${SHOTS}/image-crop.png` });
  await page.keyboard.press('Enter');
  const size = await page.locator('.status span').first().innerText();
  assert.notEqual(size, '1280 × 720px');

  // 꾸미기 + 보정
  await page.locator('.switch input').check();
  await page.locator('.bg[aria-label="포도"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/image-framed.png` });

  // 내보내기: PNG 로 내려받아 크기를 확인
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /내려받기/ }).click()]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  const w = buf.readUInt32BE(16);
  const [iw] = size.split(' × ').map((x) => parseInt(x));
  assert.equal(w, iw + 128, '배경 여백이 포함된 크기');

  // 클립보드 복사
  await page.getByRole('button', { name: '복사', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('복사'));
  const types = await page.evaluate(async () => (await navigator.clipboard.read())[0].types);
  assert.deepEqual(types, ['image/png']);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/image-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('비교', async () => {
  const { browser, page, errors } = await open('/diff');
  // 텍스트: 예시를 불러와 차이를 센다
  await page.getByRole('button', { name: '예시로 보기' }).click();
  await page.locator('.result .r').first().waitFor();
  assert.match(await page.locator('.stats').innerText(), /추가 4\s*삭제 0\s*수정 7/);
  assert.ok((await page.locator('.result mark').count()) > 8);
  assert.ok((await page.locator('.fold').count()) >= 1);
  await page.screenshot({ path: `${SHOTS}/diff-text.png` });
  // 다음 차이로 이동
  await page.keyboard.press('F7');
  assert.match(await page.locator('.pos').innerText(), /^1 \//);
  assert.ok((await page.locator('.r.cur').count()) > 0);
  // 직접 입력: 같은 내용이면 같다고 알려 준다
  await page.getByLabel('원본', { exact: true }).fill('hello\nworld\n');
  await page.getByLabel('바뀐 내용', { exact: true }).fill('hello\nworld\n');
  await page.getByText('두 내용이 같습니다').waitFor();
  await page.getByLabel('바뀐 내용', { exact: true }).fill('hello\nWorld!\nnew\n');
  await page.locator('.result .r').first().waitFor();
  assert.match(await page.locator('.stats').innerText(), /추가 1\s*삭제 0\s*수정 1/);
  // 패치 복사
  await page.getByRole('button', { name: '패치 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '--- a\n+++ b\n@@ -1,2 +1,3 @@\n hello\n-world\n+World!\n+new\n');
  // 한 줄로 보기
  await page.getByRole('button', { name: '한 줄로' }).click();
  assert.equal(await page.locator('.result.unified .tx.ins').count(), 2);
  await page.getByRole('button', { name: '나란히' }).click();

  // JSON: 키 순서와 들여쓰기는 무시
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.getByLabel('원본', { exact: true }).fill('{"b":1,"a":[1,2]}');
  await page.getByLabel('바뀐 내용', { exact: true }).fill('{\n  "a": [1, 2],\n  "b": 1\n}');
  await page.getByText('두 내용이 같습니다').waitFor();
  await page.getByLabel('바뀐 내용', { exact: true }).fill('{"a":[1,2],"b":');
  await page.getByText('JSON 형식이 올바르지 않습니다').waitFor();
  await page.getByLabel('원본', { exact: true }).fill('');
  await page.getByLabel('바뀐 내용', { exact: true }).fill('');
  await page.getByRole('button', { name: '예시로 보기' }).click();
  await page.locator('.result .r').first().waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${SHOTS}/diff-json-dark.png` });
  await page.emulateMedia({ colorScheme: 'light' });

  // 이미지
  await page.getByRole('button', { name: '이미지', exact: true }).click();
  await page.getByRole('button', { name: '예시로 보기' }).click();
  await page.locator('.swipe').waitFor();
  assert.match(await page.locator('.imgdiff .stats').innerText(), /다른 픽셀 [\d,]+개/);
  await page.screenshot({ path: `${SHOTS}/diff-image-swipe.png` });
  await page.getByRole('button', { name: '차이 강조' }).click();
  await page.locator('.box').waitFor();
  await page.screenshot({ path: `${SHOTS}/diff-image-diff.png` });
  await page.getByRole('button', { name: '나란히' }).last().click();
  assert.equal(await page.locator('.pair canvas').count(), 2);
  // 같은 이미지를 양쪽에 넣으면 같다고 나온다
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    c.getContext('2d')!.fillRect(5, 5, 20, 10);
    return c.toDataURL('image/png').split(',')[1];
  });
  const file = { name: 'same.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await page.locator('.slot input[type=file]').nth(0).setInputFiles(file);
  await page.locator('.slot input[type=file]').nth(1).setInputFiles(file);
  await page.getByText('두 이미지가 같습니다').waitFor();
  // 모드를 오가도 입력은 남아 있다
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  assert.ok((await page.locator('.result .r').count()) > 0);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/diff-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('화면 녹화', async () => {
  const { browser, page, errors } = await open('/recorder');
  await page.getByRole('button', { name: '녹화 시작' }).waitFor();
  await page.screenshot({ path: `${SHOTS}/recorder-idle.png` });
  // 화면 공유 창은 자동화할 수 없으므로, 브라우저에서 만든 영상을 파일로 넣어 편집 · 내보내기를 확인한다
  // tsx 가 이름 붙은 함수에 넣는 도우미를 페이지에도 만들어 둔다
  await page.evaluate('window.__name = (f) => f');
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 300;
    const g = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = '#f4f5f7';
        g.fillRect(0, 0, 480, 300);
        g.fillStyle = '#17181c';
        g.font = '700 28px sans-serif';
        g.fillText('Screen recording', 30, 60);
        g.fillStyle = '#e03131';
        g.fillRect(30 + t * 150, 120, 80, 80);
        g.fillStyle = '#2563eb';
        g.beginPath();
        g.arc(380, 220, 30 + t * 10, 0, 7);
        g.fill();
        if (t < 2) requestAnimationFrame(draw);
        else res();
      };
      draw();
    });
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const v of buf) s += String.fromCharCode(v);
    return btoa(s);
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') });
  await page.locator('.side .est').waitFor();
  await page.waitForFunction(() => /^0:0[12]\.\d$/.test(document.querySelector('.len')?.textContent ?? ''));
  assert.match(await page.locator('.side dl').innerText(), /전체 \(480 × 300\)/);
  // 영역 고르기: 영상 위를 끈다
  const box = (await page.locator('.cropper').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8, { steps: 5 });
  await page.mouse.up();
  assert.match(await page.locator('.crop span').innerText(), /^33[0-9] × 15[0-9]$/);
  // 구간: 끝 손잡이를 당긴다
  const track = (await page.locator('.track').boundingBox())!;
  await page.mouse.move(track.x + track.width + 4, track.y + 10);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.6, track.y + 10, { steps: 5 });
  await page.mouse.up();
  assert.match(await page.locator('.side dl').innerText(), /0:00\.0 – 0:0[01]\.\d/);
  await page.screenshot({ path: `${SHOTS}/recorder-edit.png` });
  // GIF 만들기
  await page.getByRole('button', { name: 'GIF 만들기' }).click();
  await page.locator('.result img').waitFor({ timeout: 30_000 });
  const gif = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.result img')!;
    await img.decode();
    const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    return { w: img.naturalWidth, h: img.naturalHeight, magic: String.fromCharCode(...bytes.slice(0, 6)), size: bytes.length };
  });
  assert.equal(gif.magic, 'GIF89a');
  assert.ok(gif.w >= 330 && gif.w < 340 && gif.h >= 150 && gif.h < 160, JSON.stringify(gif));
  assert.ok(gif.size > 2000 && gif.size < 400_000, `GIF 크기 ${gif.size}`);
  await page.screenshot({ path: `${SHOTS}/recorder-result.png` });
  // 영상으로도
  await page.getByRole('button', { name: /^영상 \(/ }).click();
  await page.getByRole('button', { name: '영상 만들기' }).click();
  await page.locator('.result video').waitFor({ timeout: 30_000 });
  assert.ok((await page.evaluate(async () => (await (await fetch(document.querySelector<HTMLVideoElement>('.result video')!.src)).blob()).size)) > 1000);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/recorder-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('데이터 뷰어', async () => {
  const { browser, page, errors } = await open('/data');
  // JSON 예시: 트리
  await page.getByRole('button', { name: 'JSON 예시' }).click();
  await page.locator('.trow').first().waitFor();
  assert.ok((await page.locator('.trow').count()) < 80, '보이는 줄만 그린다');
  // 찾기 → 결과로 이동하고 경로를 보여 준다
  await page.keyboard.press('Control+f');
  await page.keyboard.type('경비실');
  await page.locator('.trow.sel.hit').waitFor();
  assert.match(await page.locator('.find .count').innerText(), /^1 \/ 19$/);
  assert.equal(await page.locator('.status .path').innerText(), '$.orders[0].memo');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.status .path')?.textContent === '$.orders[13].memo');
  await page.screenshot({ path: `${SHOTS}/data-tree.png` });
  await page.getByRole('button', { name: '경로 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '$.orders[13].memo');
  // 키보드로 접고 펼치기
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '모두 접기' }).click();
  assert.equal(await page.locator('.trow').count(), 6);
  await page.locator('.trow').nth(5).click();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelectorAll('.trow').length > 20);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.trow').count(), 6);
  await page.getByRole('button', { name: '모두 펼치기' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.trow').length > 20);
  // 줄에서 오른쪽 버튼: 복사 · 아래 펼치기 · 표로 보기
  await page.getByRole('button', { name: '모두 접기' }).click();
  await page.locator('.trow', { hasText: 'orders' }).click({ button: 'right' });
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['JSON 복사', '한 줄로 복사', '키 복사', '키와 값 복사', '경로 복사', '표로 보기', '아래 모두 펼치기', '아래 모두 접기', '이 부분만 JSON 저장']);
  await page.screenshot({ path: `${SHOTS}/data-menu.png` });
  await page.getByRole('menuitem', { name: '경로 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '$.orders');
  assert.equal(await page.getByRole('menu').count(), 0);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: '아래 모두 펼치기' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.trow').length > 20);
  await page.locator('.trow', { hasText: '"서울"' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '값 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '서울');
  await page.locator('.trow').first().click({ button: 'right' });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0);
  // 뿌리가 객체여도 안에 든 배열을 표로 본다
  await page.getByRole('button', { name: '표', exact: true }).click();
  await page.locator('.tr').first().waitFor();
  assert.match(await page.locator('.bar .count').innerText(), /^240행 · 9열$/);
  assert.deepEqual(await page.getByLabel('표로 볼 곳').locator('option').allInnerTexts(), ['$.orders · 240행', '$.orders[*].items · 480행 (240곳)']);
  // 주문마다 흩어진 items 를 한 표로
  await page.getByLabel('표로 볼 곳').selectOption('/orders/*/items');
  await page.waitForFunction(() => /^480행 · 4열$/.test(document.querySelector('.bar .count')?.textContent ?? ''));
  assert.deepEqual(await page.locator('.th span').allInnerTexts(), ['orders[*]', 'name', 'qty', 'price']);
  await page.screenshot({ path: `${SHOTS}/data-subtable.png` });
  // 칸에서 오른쪽 버튼: 행을 원래 JSON 으로 복사
  await page.locator('.tr').nth(2).locator('.td').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '행 복사 (JSON)' }).click();
  assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), { name: '마우스', qty: 3, price: 82000 });
  // 칸 → 트리의 같은 자리
  await page.locator('.tr').nth(2).locator('.td').nth(2).click();
  await page.getByRole('button', { name: '트리에서 보기' }).click();
  await page.locator('.trow.sel').waitFor();
  assert.equal(await page.locator('.status .path').innerText(), '$.orders[1].items[1].name');
  // 트리의 배열 → 그 배열만 표로
  await page.locator('.trow:has(.totable)', { hasText: 'items' }).first().locator('.totable').click();
  await page.waitForFunction(() => /^\d행 · 3열$/.test(document.querySelector('.bar .count')?.textContent ?? ''));
  assert.match(await page.getByLabel('표로 볼 곳').locator('option:checked').innerText(), /^\$\.orders\[\d+\]\.items · \d행$/);
  // 표 안의 배열 칸을 두 번 눌러 들어간다
  await page.getByLabel('표로 볼 곳').selectOption('/orders');
  await page.locator('.tr').first().locator('.td').nth(6).dblclick();
  await page.waitForFunction(() => /^1행 · 3열$/.test(document.querySelector('.bar .count')?.textContent ?? ''));

  // 변환: JSON → YAML · TOML · CSV
  await page.getByRole('button', { name: '변환', exact: true }).click();
  const outText = page.getByLabel('바꾼 결과');
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('shop: tools.euiyun.com\n'));
  assert.match(await outText.inputValue(), /\norders:\n  - id: 1001\n    customer:\n      name: 김하늘\n/);
  await page.screenshot({ path: `${SHOTS}/data-convert.png` });
  await page.getByRole('group', { name: '바꿀 형식' }).getByRole('button', { name: 'TOML' }).click();
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.includes('[[orders]]'));
  assert.match(await page.locator('.status').innerText(), /JSON → TOML · TOML 에 없는 null 221개는 뺐습니다/);
  await page.getByRole('group', { name: '바꿀 형식' }).getByRole('button', { name: 'CSV' }).click();
  // 표로 보던 곳이 그대로 CSV 가 된다. 다른 배열로 바꿀 수 있다
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('name,qty,price\n'));
  await page.getByLabel('표로 볼 곳').selectOption('/orders');
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('id,customer.name,'));
  assert.match(await page.locator('.bar .count').innerText(), /^241줄/);
  await page.getByLabel('표로 볼 곳').selectOption('/orders/*/items');
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('orders[*],name,qty,price\n'));
  await page.getByRole('button', { name: '복사', exact: true }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).split('\n').length, 482);
  // 저장: 고른 형식의 파일로
  const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '저장', exact: true }).click()]);
  assert.equal(saved.suggestedFilename(), 'orders.csv');
  await page.getByRole('button', { name: '트리', exact: true }).click();
  await page.getByRole('button', { name: '저장 ▾' }).click();
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['JSON 파일로 저장', 'YAML 파일로 저장', 'TOML 파일로 저장', 'CSV 파일로 저장']);
  const [yamlFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'YAML 파일로 저장' }).click()]);
  assert.equal(yamlFile.suggestedFilename(), 'orders.yaml');

  // YAML · TOML 도 읽는다
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByRole('button', { name: 'YAML 예시' }).click();
  await page.locator('.trow').first().waitFor();
  assert.match(await page.locator('.chip').innerText(), /^YAML · /);
  await page.getByRole('button', { name: '변환', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('{\n  "service": "tools",'));
  assert.equal(JSON.parse(await outText.inputValue()).jobs[0].env.LOG_LEVEL, 'debug');
  await page.getByLabel('한 줄로').check();
  await page.waitForFunction(() => (document.querySelector('.outtext') as HTMLTextAreaElement | null)?.value.startsWith('{"service":"tools",'));
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByRole('button', { name: 'TOML 예시' }).click();
  await page.locator('.trow').first().waitFor();
  assert.match(await page.locator('.chip').innerText(), /^TOML · /);
  await page.getByRole('button', { name: '표', exact: true }).click();
  assert.match(await page.locator('.bar .count').innerText(), /^3행 · 3열$/);
  // 붙여넣은 글의 형식을 알아서 판단한다
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByLabel('데이터 붙여넣기').fill('name: 도구\ntags:\n  - a\n  - b\n');
  await page.getByRole('button', { name: '보기', exact: true }).click();
  await page.getByRole('button', { name: '변환', exact: true }).click();
  await page.getByRole('group', { name: '바꿀 형식' }).getByRole('button', { name: 'TOML' }).click();
  assert.equal(await outText.inputValue(), 'name = "도구"\ntags = [ "a", "b" ]\n');
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByLabel('데이터 붙여넣기').fill('[server]\nport = 80\nhost = \n');
  await page.getByRole('button', { name: '보기', exact: true }).click();
  assert.match(await page.locator('.error').innerText(), /3번째 줄/);
  await page.getByLabel('데이터 붙여넣기').fill('');
  await page.getByRole('button', { name: 'JSON 예시' }).click();

  // CSV 예시: 표
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByRole('button', { name: 'CSV 예시' }).click();
  await page.locator('.tr').first().waitFor();
  assert.match(await page.locator('.bar .count').innerText(), /^400행 · 7열$/);
  assert.ok((await page.locator('.tr').count()) < 80);
  // 정렬: 연봉 내림차순
  const pay = page.locator('button.th', { hasText: '연봉' });
  await pay.click();
  await pay.click();
  assert.equal(await page.locator('.tr').first().locator('.td').nth(6).innerText(), '9100');
  // 거르기
  await page.getByLabel('거르기').fill('팀장');
  await page.waitForFunction(() => /^16 \/ 400행/.test(document.querySelector('.bar .count')?.textContent ?? ''));
  await page.locator('.tr').first().locator('.td').nth(7).click();
  assert.equal(await page.locator('.status .path').innerText(), '"팀장" 겸직');
  await page.screenshot({ path: `${SHOTS}/data-table.png` });
  await page.getByRole('button', { name: '엑셀용 복사' }).click();
  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(tsv.split('\n').length, 18);
  assert.ok(tsv.startsWith('사번\t이름\t'));
  // 표 → 트리 (CSV 를 JSON 으로)
  await page.getByLabel('거르기').fill('');
  await page.getByRole('button', { name: '트리', exact: true }).click();
  await page.locator('.trow').first().waitFor();
  assert.match(await page.locator('.trow').first().innerText(), /\[400\]/);

  // 직접 입력: 오류 위치, JSON 배열은 표로
  await page.getByRole('button', { name: '다른 데이터' }).click();
  await page.getByLabel('데이터 붙여넣기').fill('{\n  "a": 1,\n  "b": oops\n}');
  await page.getByRole('button', { name: '보기', exact: true }).click();
  assert.match(await page.locator('.error').innerText(), /3번째 줄, 8번째 글자/);
  await page.getByLabel('데이터 붙여넣기').fill('[{"id":2,"user":{"name":"이"}},{"id":10,"user":{"name":"김"}}]');
  await page.getByRole('button', { name: '보기', exact: true }).click();
  await page.getByRole('button', { name: '표', exact: true }).click();
  assert.deepEqual(await page.locator('.th span').allInnerTexts(), ['id', 'user.name']);

  // 아주 큰 표도 바로 그린다
  await page.getByRole('button', { name: '다른 데이터' }).click();
  const big = ['n,sq'];
  for (let i = 0; i < 1_000_000; i++) big.push(`${i},${i * i}`);
  await page.locator('.card input[type=file]').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(big.join('\n')) });
  await page.locator('.tr').first().waitFor();
  assert.match(await page.locator('.bar .count').innerText(), /^1,000,000행/);
  await page.evaluate(() => {
    const el = document.querySelector('.vl')!;
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.tr')].some((r) => r.textContent?.includes('999999')));

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/data-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('QR 코드', async () => {
  const { browser, page, errors } = await open('/qr');
  await page.locator('.preview svg').waitFor();
  await page.evaluate('window.__name = (f) => f');
  // 화면의 QR 을 그림으로 바꿔 Chrome 의 바코드 인식기로 읽는다 (인코더와 무관한 검증)
  const scan = () =>
    page.evaluate(async () => {
      const svg = document.querySelector('.preview svg')!;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 900;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 900, 900);
      g.drawImage(img, 0, 0, 900, 900);
      const found = await new (window as any).BarcodeDetector({ formats: ['qr_code'] }).detect(c);
      return found.map((f: { rawValue: string }) => f.rawValue);
    });
  const input = page.getByLabel('주소나 글');
  assert.deepEqual(await scan(), ['https://tools.euiyun.com']);
  await page.locator('.info .ok').waitFor();
  // 여러 길이 · 모드 · 버전
  const cases = [
    '0123456789012345678901234567890123456789',
    'HELLO WORLD $%*+-./: 12345',
    '한글도 잘 읽혀야 합니다. 가나다라마바사 아자차카타파하 🙂',
    'https://example.com/' + 'path/segment-'.repeat(20),
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(14),
  ];
  const versions: number[] = [];
  for (const text of cases) {
    await input.fill(text);
    await page.waitForTimeout(60);
    assert.deepEqual(await scan(), [text.trim()], text.slice(0, 30));
    versions.push(+(await page.locator('.info').innerText()).match(/버전 (\d+)/)![1]);
  }
  assert.ok(versions[4] >= 20 && versions[0] <= 3, String(versions));
  // 주소처럼 보이면 https:// 를 붙인다
  await input.fill('tools.euiyun.com/qr');
  assert.deepEqual(await scan(), ['https://tools.euiyun.com/qr']);
  // 모양을 바꾸고 로고를 넣어도 읽힌다
  await page.getByRole('group', { name: '점 모양' }).getByRole('button', { name: '둥글게' }).click();
  await page.getByRole('group', { name: '귀퉁이 모양' }).getByRole('button', { name: '둥글게' }).click();
  assert.deepEqual(await scan(), ['https://tools.euiyun.com/qr']);
  await page.getByRole('group', { name: '점 모양' }).getByRole('button', { name: '동그라미' }).click();
  await page.getByRole('group', { name: '귀퉁이 모양' }).getByRole('button', { name: '원' }).click();
  assert.deepEqual(await scan(), ['https://tools.euiyun.com/qr']);
  const logo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8590c';
    g.beginPath();
    g.arc(60, 60, 56, 0, 7);
    g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.logo-row input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await page.locator('.preview svg image').waitFor();
  assert.match(await page.locator('.info').innerText(), /오류 정정 H/);
  assert.deepEqual(await scan(), ['https://tools.euiyun.com/qr']);
  await page.locator('.info .ok').waitFor();
  await page.screenshot({ path: `${SHOTS}/qr-styled.png` });
  // 읽히지 않는 색을 고르면 알려 준다
  await page.locator('input[type=color]').first().fill('#f1f3f5');
  await page.locator('.info .bad').waitFor();
  assert.match(await page.locator('.warn').first().innerText(), /읽/);
  await page.getByRole('button', { name: '모양 처음으로' }).click();

  // Wi-Fi
  await page.getByRole('button', { name: 'Wi-Fi' }).click();
  await page.getByLabel('네트워크 이름 (SSID)').fill('Cafe;Guest');
  await page.locator('input[type=password]').fill('p@ss:word');
  assert.deepEqual(await scan(), ['WIFI:T:WPA;S:Cafe\\;Guest;P:p@ss\\:word;;']);
  // 연락처
  await page.getByRole('button', { name: '연락처' }).click();
  await page.getByLabel('이름').fill('김하늘');
  await page.getByLabel('전화').fill('010-1234-5678');
  assert.match((await scan())[0], /^BEGIN:VCARD\nVERSION:3\.0\nN:김하늘;;;;\nFN:김하늘\nTEL;TYPE=CELL:010-1234-5678\nEND:VCARD$/);
  await page.screenshot({ path: `${SHOTS}/qr-contact.png` });
  // 너무 긴 내용
  await page.getByRole('button', { name: '링크 · 글' }).click();
  await input.fill('가'.repeat(1000));
  await page.getByText('내용이 너무 깁니다').waitFor();
  // PNG 저장
  await input.fill('https://tools.euiyun.com');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG 저장' }).click()]);
  assert.match(dl.suggestedFilename(), /^qr-.*\.png$/);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/qr-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('행사 타이머', async () => {
  const { browser, page, errors } = await open('/timer');
  const time = () => page.locator('.stage-box .time').innerText();
  const sheet = page.getByLabel('순서표');
  assert.equal(await time(), '5:00');
  assert.equal(await page.locator('.list li').count(), 4);
  await page.screenshot({ path: `${SHOTS}/timer.png` });
  // 순서표를 고치면 바로 반영된다
  await sheet.fill('발표 0:03\n질의응답\t0:02\n마무리 1시간 30분');
  assert.equal(await time(), '0:03');
  assert.deepEqual(await page.locator('.list .du').allInnerTexts(), ['3초', '2초', '1시간 30분']);
  // 발표자 화면 (두 번째 창) 이 함께 움직인다
  const second = await page.context().newPage();
  second.on('pageerror', (e) => errors.push(String(e)));
  await second.goto(BASE + '/timer?view=display', { waitUntil: 'networkidle' });
  assert.equal(await second.locator('.display .time').innerText(), '0:03');
  assert.equal(await second.locator('header').count(), 0);
  // 다 되면 다음 순서로
  await page.locator('.row select').first().selectOption('next');
  await page.locator('.stage-box').click();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.stage-box .name')?.textContent === '질의응답', null, { timeout: 6000 });
  await second.waitForFunction(() => document.querySelector('.display .name')?.textContent === '질의응답');
  await page.waitForFunction(() => document.querySelector('.stage-box .name')?.textContent === '마무리', null, { timeout: 6000 });
  assert.match(await time(), /^1:(30:00|29:5\d)$/);
  assert.ok(await page.locator('.stage-box .stage.long').count());
  // 메시지
  await page.getByRole('button', { name: '마무리해 주세요' }).click();
  await second.locator('.msg', { hasText: '마무리해 주세요' }).waitFor();
  await second.setViewportSize({ width: 1280, height: 720 });
  await second.waitForTimeout(500);
  await second.screenshot({ path: `${SHOTS}/timer-display.png` });
  await page.getByRole('button', { name: '내리기' }).click();
  await second.waitForFunction(() => !document.querySelector('.msg'));
  // 멈춤 · 시간 조절 · 순서 이동
  await page.locator('.stage-box').click();
  await page.keyboard.press('Space');
  const frozen = await time();
  await page.waitForTimeout(1200);
  assert.equal(await time(), frozen);
  await page.keyboard.press('r');
  assert.equal(await time(), '1:30:00');
  await page.keyboard.press('ArrowDown');
  assert.equal(await time(), '1:29:00');
  await page.locator('.list button').first().click();
  assert.equal(await time(), '0:03');
  assert.equal(await second.locator('.display .time').innerText(), '0:03');
  // 초과 시간 세기 + 경고 색
  await page.locator('.row select').first().selectOption('count');
  await page.locator('.row select').nth(1).selectOption('10');
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await page.locator('.stage-box .stage.warn').waitFor();
  await page.locator('.stage-box .stage.over').waitFor({ timeout: 6000 });
  await page.waitForFunction(() => document.querySelector('.stage-box .time')?.textContent?.startsWith('+0:0'), null, { timeout: 4000 });
  // 새로 고쳐도 이어진다
  await page.reload({ waitUntil: 'networkidle' });
  assert.match(await time(), /^\+0:\d\d$/);
  await page.getByRole('button', { name: '처음 상태로' }).click();
  assert.equal(await time(), '0:03');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/timer-mobile.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

test('오프라인', async () => {
  const { browser, page } = await open('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.context().setOffline(true);
  for (const path of ['/raffle', '/calculator', '/image', '/diff', '/recorder', '/data', '/qr', '/timer', '/']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    assert.ok(await page.locator('header').first().isVisible(), `${path} 오프라인`);
  }
  await page.getByRole('link', { name: /계산기/ }).click();
  await page.locator('input.expr').waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains('expr'));
  await page.keyboard.type('6*7');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('input.expr').inputValue(), '42');
  await browser.close();
});

// 단위 변환의 핵심 흐름. 실행: BASE_URL=http://localhost:4317 npx tsx --test e2e/unit.e2e.ts
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

test('단위 변환: 적은 그대로 읽고 모든 단위로', async () => {
  const { browser, page, errors } = await open('/unit');
  const input = page.getByLabel('바꿀 값', { exact: true });
  const hero = page.locator('.hero-card .hero');
  const read = page.locator('#unit-read');
  const row = (name: string) => page.getByRole('list', { name: '모든 단위' }).locator('li', { has: page.locator('.u b', { hasText: new RegExp(`^${name}$`) }) });

  // 처음 열면 입력칸에 바로 적을 수 있다
  await page.waitForFunction(() => document.activeElement?.id === 'unit-input');
  await page.keyboard.type('32평');
  await read.getByText('넓이').waitFor();
  assert.match(await hero.innerText(), /105\.785\s*m²/);
  assert.match(await row('ft²').locator('.v').innerText(), /1,138\.66/);
  await page.screenshot({ path: `${SHOTS}/unit-area.png` });

  // 값을 누르면 복사, 단위를 누르면 그 단위로 다시 적는다
  await row('m²').locator('.v').click();
  await page.getByText('복사했습니다').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '105.785');
  await row('m²').locator('.u').click();
  assert.match(await input.inputValue(), /^105\.785123967 m²$/);
  assert.match(await hero.innerText(), /32\s*평/);

  // 자릿수: 모두
  await input.fill('121평');
  assert.match(await hero.innerText(), /^400\s*m²$/);
  await input.fill('32평은 몇 제곱미터');
  await page.getByRole('button', { name: '모두' }).click();
  assert.match(await hero.innerText(), /≈ 105\.785123966942148760330578512/);
  await page.getByRole('button', { name: '보통' }).click();

  // 피트 · 인치
  await input.fill(`5'11"`);
  await read.getByText('길이').waitFor();
  assert.match(await hero.innerText(), /180\.34\s*cm/);
  await input.fill('180cm');
  assert.match(await page.locator('.hero-card .sub').innerText(), /5 ft 10\.87 in/);

  // 헷갈리는 이름: 다른 뜻을 누르면 그렇게 읽는다
  await input.fill('3근');
  assert.match(await hero.innerText(), /1,800\s*g/);
  await page.getByRole('group', { name: '다르게 읽기' }).getByRole('button', { name: /근\(채소\)/ }).click();
  assert.match(await hero.innerText(), /1,125\s*g/);
  await input.fill('3킬로');
  await page.getByRole('group', { name: '다르게 읽기' }).getByRole('button', { name: /3 km/ }).click();
  await read.getByText('길이').waitFor();

  // ↑ ↓ 로 숫자 바꾸기
  await input.fill('36.5도');
  assert.match(await hero.innerText(), /97\.7\s*°F/);
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), '37.5도');
  assert.match(await hero.innerText(), /99\.5\s*°F/);
  await page.getByLabel('온도 차이로 바꾸기').check();
  assert.match(await hero.innerText(), /67\.5\s*°F/);
  await page.getByLabel('온도 차이로 바꾸기').uncheck();
  await page.screenshot({ path: `${SHOTS}/unit-temp.png` });

  // 못 읽는 글은 까닭을 말한다
  await input.fill('3 foo');
  await page.getByText('"foo" 은(는) 모르는 단위입니다').waitFor();
  assert.equal(await page.locator('.hero-card.stale').count(), 1);

  // 숫자만 적으면 고른 단위로
  await page.getByRole('group', { name: '분류 고르기' }).getByRole('button', { name: '무게' }).click();
  await input.fill('10');
  await page.getByLabel('적은 단위').selectOption('lb');
  assert.match(await hero.innerText(), /4\.53592\s*kg/);
  assert.equal(await input.inputValue(), '10 lb');

  // 새로 고쳐도 그대로
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('바꿀 값', { exact: true }).inputValue(), '10 lb');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('단위 변환: 데이터 · 전송 속도 · 용지', async () => {
  const { browser, page, errors } = await open('/unit');
  const input = page.getByLabel('바꿀 값', { exact: true });
  const hero = page.locator('.hero-card .hero');

  await input.fill('1 TB');
  assert.match(await hero.innerText(), /931\.323\s*GiB/);
  assert.match(await page.locator('.facts').innerText(), /Windows 탐색기\s*931 GB/);
  await page.getByText('1 TB 디스크가 931 GB 로 보이는').waitFor();
  await page.getByRole('group', { name: '자주 쓰는 속도' }).getByRole('button', { name: '1 Gbps' }).click();
  assert.equal(await page.locator('.answer').innerText(), '2시간 13분 20초');
  await page.screenshot({ path: `${SHOTS}/unit-data.png`, fullPage: true });

  await input.fill('100Mbps');
  assert.match(await hero.innerText(), /12\.5\s*MB\/s/);
  assert.match(await page.getByRole('list', { name: '받는 시간' }).innerText(), /1 GB\s*1분 20초/);

  // 용지: A4 → 300 DPI 에서 2480 × 3508 px
  await input.fill('A4');
  assert.match(await page.locator('.hero-card .hero').innerText(), /210 × 297/);
  await page.getByRole('group', { name: '용지 해상도' }).getByRole('button', { name: '300' }).click();
  assert.match(await page.getByRole('list', { name: '용지 크기' }).innerText(), /2,480 × 3,508/);
  await input.fill('B5');
  await page.getByRole('group', { name: '다른 규격' }).getByRole('button', { name: /B5 \(ISO\)/ }).click();
  assert.match(await page.locator('.hero-card .hero').innerText(), /176 × 250/);
  await page.screenshot({ path: `${SHOTS}/unit-paper.png`, fullPage: true });

  await input.fill('12pt');
  assert.match(await hero.innerText(), /50\s*px/);
  assert.deepEqual(errors, []);
  await browser.close();
});

test('단위 변환: 좁은 화면 · 어두운 화면', async () => {
  const { browser, page, errors } = await open('/unit', { width: 390, height: 844 });
  const input = page.getByLabel('바꿀 값', { exact: true });
  await input.fill('5ft 11in');
  assert.match(await page.locator('.hero-card .hero').innerText(), /180\.34/);
  // 입력 바로 아래에 답이 온다
  const a = (await input.boundingBox())!;
  const h = (await page.locator('.hero-card').boundingBox())!;
  assert.ok(h.y > a.y && h.y - a.y < 260, `${a.y} → ${h.y}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0);
  await page.screenshot({ path: `${SHOTS}/unit-mobile.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await input.fill('32평은 몇 m²');
  await page.screenshot({ path: `${SHOTS}/unit-mobile-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SHOTS}/unit-dark.png` });
  assert.deepEqual(errors, []);
  await browser.close();
});

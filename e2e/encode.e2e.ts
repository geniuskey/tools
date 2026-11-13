// 인코딩 · 해시 도구의 핵심 흐름. 실행: BASE_URL=http://localhost:4332 npx tsx --test e2e/encode.e2e.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright-core';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

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

const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
// 1×1 빨간 점 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('인코딩 · 해시: 풀기', async () => {
  const { browser, page, errors } = await open('/encode');
  const input = page.getByLabel('풀 글', { exact: true }).last();
  const results = page.getByRole('region', { name: '풀어낸 결과' });
  const card = (name: string) => results.getByRole('article', { name, exact: true });

  // 빈 화면: 예시를 누르면 바로 풀린다
  await page.getByText('무엇이든 붙여넣으세요').waitFor();
  await page.screenshot({ path: `${SHOTS}/encode-empty.png` });
  await page.getByRole('button', { name: /^JWT/ }).click();
  await card('JWT').waitFor();
  assert.match(await card('JWT').innerText(), /3시간 1[12]분 뒤 만료/);
  assert.match(await card('JWT').innerText(), /홍길동/);
  assert.match(await card('JWT').innerText(), /서명은 확인하지 않았습니다 — 내용은 누구나 읽을 수 있습니다/);
  await card('JWT').getByLabel('서명 확인용 비밀 키').fill('wrong');
  await card('JWT').getByText('서명이 맞지 않습니다').waitFor();
  await card('JWT').getByLabel('서명 확인용 비밀 키').fill('secret');
  await card('JWT').getByText('서명이 맞습니다').waitFor();
  await page.screenshot({ path: `${SHOTS}/encode-jwt.png` });

  // 알려진 토큰: 만료가 없고, 복사가 된다
  await input.fill(JWT_IO);
  await card('JWT').getByText('John Doe').waitFor();
  await card('JWT').getByLabel('서명 확인용 비밀 키').fill('your-256-bit-secret');
  await card('JWT').getByText('서명이 맞습니다').waitFor();
  await card('JWT').getByRole('button', { name: '복사' }).last().click();
  await page.getByText('복사했습니다').waitFor();
  assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), { sub: '1234567890', name: 'John Doe', iat: 1516239022 });

  // 주소 → 값 다시 풀기 → Base64 안의 JSON, 그리고 길을 따라 돌아오기
  await input.fill('');
  await page.getByRole('button', { name: /^한글이 든 주소/ }).click();
  const url = card('주소 (URL)');
  await url.waitFor();
  assert.match(await url.innerText(), /서울 날씨/);
  assert.match(await url.innerText(), /두 번 인코딩되어 있습니다/);
  await page.screenshot({ path: `${SHOTS}/encode-url.png` });
  await url.getByRole('button', { name: '?state 다시 풀기' }).click();
  await card('Base64').waitFor();
  assert.match(await card('Base64').getByLabel('Base64 결과').innerText(), /"user": "홍길동"/);
  const trail = page.getByRole('navigation', { name: '풀어 온 길' });
  assert.match(await trail.innerText(), /처음\s*›\s*\?state/);
  await trail.getByRole('button', { name: '처음' }).click();
  await url.waitFor();
  assert.equal(await trail.count(), 0);
  // 두 번 인코딩된 값은 두 번 풀면 나온다
  await url.getByRole('button', { name: '?next 다시 풀기' }).click();
  assert.equal(await card('URL 인코딩').getByLabel('URL 인코딩 결과').innerText(), '/home?tab=1');

  // 시각 · 식별자 · 해시 · 깨진 글
  await input.fill('1700000000');
  assert.match(await card('유닉스 시간 (초)').innerText(), /2023-11-15 \(수\) 07:13:20 KST/);
  assert.match(await card('유닉스 시간 (초)').innerText(), /\d년( \d+개월)? 전/);
  await input.fill('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  assert.match(await card('UUID v7').innerText(), /2022-02-23/);
  await input.fill('d41d8cd98f00b204e9800998ecf8427e');
  assert.match(await results.getByRole('article').first().innerText(), /MD5 길이입니다 \(해시는 되돌릴 수 없습니다\)/);
  await input.fill('ì•ˆë…•í•˜ì„¸ìš”');
  assert.equal(await card('깨진 글 되살리기').getByLabel('깨진 글 되살리기 결과').innerText(), '안녕하세요');

  // 글이 아닌 Base64: 파일 종류 · 미리보기 · 내려받기
  await input.fill(PNG);
  await card('Base64').getByText('PNG 이미지', { exact: true }).waitFor();
  await card('Base64').getByRole('img', { name: '풀어낸 이미지 미리보기' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), card('Base64').getByRole('button', { name: '내려받기' }).click()]);
  assert.equal(dl.suggestedFilename(), 'decoded.png');
  await page.screenshot({ path: `${SHOTS}/encode-binary.png` });
  // gzip 은 한 겹 더 푼다
  await input.fill(gzipSync('{"msg":"압축된 글"}').toString('base64'));
  await card('Base64').getByText('gzip 을 풀면').waitFor();
  assert.match(await card('Base64').getByLabel('gzip 을 푼 결과').innerText(), /"msg": "압축된 글"/);

  // 보통 글 · 쓰레기 글에도 죽지 않는다
  await input.fill('오늘 회의는 3시입니다.');
  await page.getByText('특별한 형식으로 보이지 않습니다').waitFor();
  assert.match(await results.innerText(), /글자\s*13/);
  for (const junk of ['%', '=?', 'eyJ.eyJ.', '\\u{110000}', 'data:;base64,@@', 'xn--!!']) await input.fill(junk);
  // 큰 글: 잘라서 보여 준다고 알린다
  await input.fill(Buffer.from('가나다라마바사 '.repeat(20_000)).toString('base64'));
  await card('Base64').getByText(/앞 20,000자만 보여 줍니다/).waitFor();

  // 새로 열어도 남아 있다
  await input.fill('7JWI64WV7ZWY7IS47JqU');
  await card('Base64').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('풀 글', { exact: true }).last().inputValue(), '7JWI64WV7ZWY7IS47JqU');
  assert.equal(await card('Base64').getByLabel('Base64 결과').innerText(), '안녕하세요');
  assert.deepEqual(errors, []);
  await browser.close();
});

test('인코딩 · 해시: 만들기 · 해시 · 생성', async () => {
  const { browser, page, errors } = await open('/encode');
  const tab = (name: string) => page.getByRole('group', { name: '무엇을 할까' }).getByRole('button', { name, exact: true });

  // 만들기
  await tab('만들기').click();
  await page.getByLabel('바꿀 글', { exact: true }).last().fill('가 <a>');
  const made = page.getByRole('region', { name: '바꾼 결과' });
  assert.equal(await made.getByLabel('Base64', { exact: true }).innerText(), '6rCAIDxhPg==');
  assert.equal(await made.getByLabel('URL (값 하나)', { exact: true }).innerText(), '%EA%B0%80%20%3Ca%3E');
  assert.equal(await made.getByLabel('16진수', { exact: true }).innerText(), 'eab080203c613e');
  assert.equal(await made.getByLabel('HTML 엔티티', { exact: true }).innerText(), '가 &lt;a&gt;');
  await made.getByRole('button', { name: 'Base64URL 복사' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '6rCAIDxhPg');
  await page.getByLabel('바꿀 글', { exact: true }).last().fill('한글도메인.한국');
  assert.equal(await made.getByLabel('Punycode (도메인)', { exact: true }).innerText(), 'xn--bj0bj3i97fq8o5lq.xn--3e0b707e');
  await page.getByLabel('data: 주소로 바꿀 파일').setInputFiles({ name: 'dot.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await made.getByText('data:text/plain;base64,aGk=').waitFor();
  await page.getByLabel('바꿀 글', { exact: true }).last().fill('안녕하세요, tools! <b>&</b> 😀');
  await page.screenshot({ path: `${SHOTS}/encode-make.png` });

  // 해시: 글
  await tab('해시').click();
  const hashes = page.getByRole('region', { name: '해시', exact: true });
  const text = page.getByLabel('해시를 만들 글', { exact: true });
  await hashes.getByText('d41d8cd98f00b204e9800998ecf8427e').waitFor();
  await text.fill('abc');
  await hashes.getByText('900150983cd24fb0d6963f7d28e17f72').waitFor();
  await hashes.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad').waitFor();
  assert.equal(await hashes.getByLabel('CRC32', { exact: true }).innerText(), '352441c2');
  // 비교: 길이로 알고리즘을 찾아 맞춰 본다
  await page.getByLabel('비교할 체크섬').fill('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
  await page.getByText('일치 — SHA-256 값이 같습니다.').waitFor();
  await page.getByLabel('HMAC 키').fill('key');
  await hashes.getByLabel('HMAC-SHA-256', { exact: true }).getByText('9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab').waitFor();
  await page.screenshot({ path: `${SHOTS}/encode-hash.png` });
  await page.getByLabel('비교할 체크섬').fill('900150983cd24fb0d6963f7d28e17f73');
  await page.getByText('다름 — MD5 길이인데 값이 다릅니다.').waitFor();
  await page.getByLabel('비교할 체크섬').fill('hello');
  await page.getByText('해시로 보이지 않습니다').waitFor();
  await page.getByLabel('비교할 체크섬').fill('');
  await hashes.getByRole('button', { name: 'Base64', exact: true }).click();
  assert.equal(await hashes.getByLabel('MD5', { exact: true }).innerText(), 'kAFQmDzST7DWlj99KOF/cg==');
  await hashes.getByRole('button', { name: '16진수', exact: true }).click();

  // 해시: 파일 (조각 크기보다 커서 여러 번에 나눠 읽는다)
  const big = Buffer.alloc(9 * 1024 * 1024 + 123);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
  await page.getByLabel('해시를 만들 파일').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: big });
  await page.getByText('다 읽었습니다').waitFor();
  assert.equal(await hashes.getByLabel('MD5', { exact: true }).innerText(), createHash('md5').update(big).digest('hex'));
  assert.equal(await hashes.getByLabel('SHA-512', { exact: true }).innerText(), createHash('sha512').update(big).digest('hex'));
  assert.match(await page.getByRole('region', { name: '해시를 만들 글이나 파일' }).innerText(), /파일은 브라우저 밖으로 나가지 않습니다/);
  await page.getByRole('button', { name: '글로 돌아가기' }).click();
  await hashes.getByText('900150983cd24fb0d6963f7d28e17f72').waitFor();

  // 생성
  await tab('생성').click();
  const list = page.getByRole('list', { name: '만든 값 목록' });
  const kind = (name: string) => page.getByRole('group', { name: '만들 것' }).getByRole('button', { name, exact: true });
  const values = () => list.locator('code').allInnerTexts();
  assert.equal((await values()).length, 5);
  for (const v of await values()) assert.match(v, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const before = await values();
  await page.getByRole('button', { name: '다시 만들기' }).click();
  assert.notDeepEqual(await values(), before);
  await kind('UUID v7').click();
  for (const v of await values()) assert.match(v, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  await kind('ULID').click();
  for (const v of await values()) assert.match(v, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  await kind('무작위 토큰').click();
  await page.getByLabel('토큰 길이').fill('48');
  await page.getByRole('button', { name: 'Base64URL', exact: true }).click();
  for (const v of await values()) assert.match(v, /^[A-Za-z0-9_-]{48}$/);
  await kind('비밀번호').click();
  await page.getByLabel('비밀번호 길이').fill('24');
  for (const v of await values()) {
    assert.equal(v.length, 24);
    assert.doesNotMatch(v, /[0O1lI]/);
  }
  assert.match(await page.getByRole('status', { name: '세기' }).innerText(), /아주 튼튼함 · 엔트로피 147비트/);
  await page.getByLabel('개수').fill('1000');
  await page.getByText('목록에는 처음 200개만 보입니다').waitFor();
  await page.getByRole('button', { name: '모두 복사' }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).split('\n').length, 1000);
  await page.getByLabel('개수').fill('8');
  // 지금 시각은 1초마다 간다
  const sec = page.getByRole('button', { name: '유닉스 시간 (초) 복사' });
  const t0 = Number(await sec.locator('code').innerText());
  assert.ok(Math.abs(t0 - Date.now() / 1000) < 5);
  await page.waitForFunction((v) => document.querySelector('.now code')?.textContent !== String(v), t0);
  await page.screenshot({ path: `${SHOTS}/encode-gen.png` });
  // 만든 비밀번호는 저장하지 않는다
  const stored = await page.evaluate(() => localStorage.getItem('tools:encode:v1') ?? '');
  for (const v of await values()) assert.ok(!stored.includes(v));
  assert.ok(!stored.includes('"key"'));

  assert.deepEqual(errors, []);
  await browser.close();
});

test('인코딩 · 해시: 좁은 화면 · 어두운 테마', async () => {
  const { browser, page, errors } = await open('/encode', { width: 390, height: 800 });
  await page.getByRole('button', { name: /^JWT/ }).click();
  await page.getByRole('article', { name: 'JWT' }).waitFor();
  // 옆으로 넘치지 않는다
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.card, .pane')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1)));
  await page.screenshot({ path: `${SHOTS}/encode-mobile.png` });
  await page.locator('.page').evaluate((e) => e.scrollTo(0, 420));
  await page.screenshot({ path: `${SHOTS}/encode-mobile-2.png` });
  for (const name of ['만들기', '해시', '생성']) {
    await page.getByRole('group', { name: '무엇을 할까' }).getByRole('button', { name, exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name);
    await page.screenshot({ path: `${SHOTS}/encode-mobile-${{ 만들기: 'make', 해시: 'hash', 생성: 'gen' }[name]}.png` });
  }
  assert.deepEqual(errors, []);
  await browser.close();

  const d = await open('/encode', { width: 1440, height: 900 }, true);
  await d.page.getByRole('button', { name: /^한글이 든 주소/ }).click();
  await d.page.getByRole('article', { name: '주소 (URL)' }).waitFor();
  await d.page.screenshot({ path: `${SHOTS}/encode-dark.png` });
  await d.page.getByRole('group', { name: '무엇을 할까' }).getByRole('button', { name: '해시', exact: true }).click();
  await d.page.getByLabel('해시를 만들 글', { exact: true }).fill('abc');
  await d.page.getByLabel('비교할 체크섬').fill('900150983cd24fb0d6963f7d28e17f72');
  await d.page.getByText('일치 — MD5 값이 같습니다.').waitFor();
  await d.page.screenshot({ path: `${SHOTS}/encode-dark-hash.png` });
  assert.deepEqual(d.errors, []);
  await d.browser.close();
});

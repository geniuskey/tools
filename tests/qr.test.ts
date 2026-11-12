import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEcc, alignmentPositions, dataCodewords, encodeQr, formatBits, gfMul, maxLength, pickMode, QrTooLongError, rawModules, rsRemainder, type Ecl } from '../src/lib/qr/core';
import { contactPayload, emailPayload, linkPayload, smsPayload, wifiPayload } from '../src/lib/qr/payload';
import { contrast, defaultStyle, logoBox, renderSvg } from '../src/lib/qr/render';

test('용량 표: 규격의 데이터 코드워드 수와 같다', () => {
  const known: [number, Ecl, number][] = [
    [1, 'L', 19], [1, 'M', 16], [1, 'Q', 13], [1, 'H', 9],
    [2, 'L', 34], [2, 'M', 28], [2, 'Q', 22], [2, 'H', 16],
    [3, 'L', 55], [3, 'M', 44], [3, 'Q', 34], [3, 'H', 26],
    [4, 'L', 80], [4, 'M', 64], [4, 'Q', 48], [4, 'H', 36],
    [5, 'L', 108], [5, 'M', 86], [5, 'Q', 62], [5, 'H', 46],
    [10, 'L', 274], [10, 'M', 216], [10, 'Q', 154], [10, 'H', 122],
    [40, 'L', 2956], [40, 'M', 2334], [40, 'Q', 1666], [40, 'H', 1276],
  ];
  for (const [v, e, n] of known) assert.equal(dataCodewords(v, e), n, `${v}-${e}`);
  assert.equal(rawModules(1), 208);
  assert.equal(rawModules(40), 29648);
  // 버전이 오르면 용량도 늘고, 수준이 오르면 줄어든다
  for (let v = 2; v <= 40; v++) for (const e of ['L', 'M', 'Q', 'H'] as Ecl[]) assert.ok(dataCodewords(v, e) > dataCodewords(v - 1, e), `${v}-${e}`);
  for (let v = 1; v <= 40; v++) assert.ok(dataCodewords(v, 'L') > dataCodewords(v, 'M') && dataCodewords(v, 'M') > dataCodewords(v, 'Q') && dataCodewords(v, 'Q') > dataCodewords(v, 'H'));
  // 규격에 나온 최대 글자 수
  assert.deepEqual([maxLength('numeric', 'L'), maxLength('alphanumeric', 'L'), maxLength('byte', 'L')], [7089, 4296, 2953]);
  assert.deepEqual([maxLength('numeric', 'H'), maxLength('alphanumeric', 'H'), maxLength('byte', 'H')], [3057, 1852, 1273]);
});

test('리드-솔로몬: 코드워드는 생성 다항식의 모든 근에서 0', () => {
  const evalAt = (poly: number[], x: number) => poly.reduce((acc, c) => gfMul(acc, x) ^ c, 0);
  let s = 3;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255;
  for (const degree of [7, 10, 17, 30]) {
    const data = Array.from({ length: 40 }, rnd);
    const word = data.concat(rsRemainder(data, degree));
    let root = 1;
    for (let i = 0; i < degree; i++) {
      assert.equal(evalAt(word, root), 0, `degree ${degree}, root ${i}`);
      root = gfMul(root, 2);
    }
  }
  // 규격 부록의 예 (1-M, "01234567")
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(rsRemainder(data, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test('형식 정보 · 정렬 무늬 위치', () => {
  assert.equal(formatBits('L', 0), 0b111011111000100);
  assert.equal(formatBits('M', 0), 0b101010000010010);
  assert.equal(formatBits('Q', 7), 0b010101111101101);
  assert.equal(formatBits('H', 3), 0b001100111010000);
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('블록 나누기: 모든 버전 · 수준에서 길이가 맞고 각 블록이 올바른 코드워드', () => {
  for (let v = 1; v <= 40; v++) {
    for (const e of ['L', 'M', 'Q', 'H'] as Ecl[]) {
      const data = new Uint8Array(dataCodewords(v, e)).map((_, i) => (i * 31 + v) & 255);
      const out = addEcc(data, v, e);
      assert.equal(out.length, Math.floor(rawModules(v) / 8), `${v}-${e}`);
      // 섞인 앞부분에서 데이터를 다시 모을 수 있어야 한다 (첫 블록의 첫 바이트들)
      assert.equal(out[0], data[0]);
    }
  }
});

test('인코딩: 모드 · 버전 · 구조', () => {
  assert.equal(pickMode('0123456789'), 'numeric');
  assert.equal(pickMode('HELLO WORLD'), 'alphanumeric');
  assert.equal(pickMode('Hello'), 'byte');
  assert.equal(pickMode('한글'), 'byte');

  const q = encodeQr('01234567', { ecl: 'M', boost: false });
  assert.deepEqual([q.version, q.size, q.mode, q.ecl], [1, 21, 'numeric', 'M']);
  const at = (x: number, y: number) => q.modules[y * q.size + x];
  // 위치 찾기 무늬
  for (const [ox, oy] of [[0, 0], [14, 0], [0, 14]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(at(ox + x, oy + y), d !== 2 ? 1 : 0);
    }
  }
  for (let i = 8; i < 13; i++) assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0); // 타이밍
  assert.equal(at(8, 13), 1); // 항상 어두운 모듈
  // 형식 정보를 읽어 보면 수준과 마스크가 나온다
  let bits = 0;
  for (let i = 0; i < 8; i++) bits |= at(q.size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) bits |= at(8, q.size - 15 + i) << i;
  assert.equal(bits, formatBits('M', q.mask));

  // 규격 부록 그림의 예: 1-M, 마스크 2... 대신 마스크를 고정해 데이터 영역을 직접 풀어 본다
  const fixed = encodeQr('01234567', { ecl: 'M', boost: false, mask: 0 });
  const read: number[] = [];
  const isFn = (x: number, y: number) => (x < 9 && y < 9) || (x > 12 && y < 9) || (x < 9 && y > 12) || x === 6 || y === 6;
  for (let right = 20; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < 21; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? 20 - vert : vert;
      if (!isFn(x, y)) read.push(fixed.modules[y * 21 + x] ^ ((x + y) % 2 === 0 ? 1 : 0));
    }
  }
  const bytes = Array.from({ length: 26 }, (_, i) => read.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  assert.deepEqual(bytes, [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);

  // 수준 올리기, 버전 고르기
  assert.equal(encodeQr('A', { ecl: 'L' }).ecl, 'H');
  assert.equal(encodeQr('A', { ecl: 'L', boost: false }).ecl, 'L');
  assert.equal(encodeQr('https://tools.euiyun.com/qr', { ecl: 'M' }).version, 3);
  assert.equal(encodeQr('x'.repeat(2953), { ecl: 'L' }).version, 40);
  assert.throws(() => encodeQr('x'.repeat(2954), { ecl: 'L' }), QrTooLongError);
  assert.equal(encodeQr('9'.repeat(7089), { ecl: 'L' }).version, 40);
  assert.throws(() => encodeQr('9'.repeat(7090), { ecl: 'L' }), QrTooLongError);
  assert.equal(encodeQr('가'.repeat(10)).length, 30);
  // 버전 7 이상은 버전 정보가 들어간다
  const big = encodeQr('x'.repeat(200), { ecl: 'M', boost: false });
  assert.ok(big.version >= 7);
  assert.equal(big.size, big.version * 4 + 17);
});

test('내용 형식', () => {
  assert.equal(wifiPayload({ ssid: 'Cafe;1', password: 'p:a"ss', security: 'WPA', hidden: false }), 'WIFI:T:WPA;S:Cafe\\;1;P:p\\:a\\"ss;;');
  assert.equal(wifiPayload({ ssid: 'Open', password: 'x', security: 'nopass', hidden: true }), 'WIFI:T:nopass;S:Open;H:true;;');
  assert.equal(wifiPayload({ ssid: '', password: 'x', security: 'WPA', hidden: false }), '');
  assert.equal(
    contactPayload({ name: '김하늘', phone: '010-1234-5678', email: 'sky@example.com', org: '운영팀; 본사', title: '', url: '' }),
    'BEGIN:VCARD\nVERSION:3.0\nN:김하늘;;;;\nFN:김하늘\nORG:운영팀\\; 본사\nTEL;TYPE=CELL:010-1234-5678\nEMAIL:sky@example.com\nEND:VCARD',
  );
  assert.equal(contactPayload({ name: '', phone: '', email: '', org: 'x', title: '', url: '' }), '');
  assert.equal(emailPayload('a@b.co', '안녕', 'x y'), 'mailto:a@b.co?subject=%EC%95%88%EB%85%95&body=x%20y');
  assert.equal(emailPayload('a@b.co', '', ''), 'mailto:a@b.co');
  assert.equal(smsPayload('010-1234-5678', ''), 'tel:01012345678');
  assert.equal(smsPayload('+82 10 1234 5678', '곧 도착'), 'SMSTO:+821012345678:곧 도착');
  assert.equal(linkPayload(' tools.euiyun.com/qr '), 'https://tools.euiyun.com/qr');
  assert.equal(linkPayload('http://a.b'), 'http://a.b');
  assert.equal(linkPayload('그냥 글'), '그냥 글');
  assert.equal(linkPayload('a@b.co'), 'a@b.co');
});

test('그리기', () => {
  const q = encodeQr('https://tools.euiyun.com', { ecl: 'H' });
  const svg = renderSvg(q, defaultStyle, 512);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 '));
  assert.ok(svg.includes('width="512"') && svg.includes('fill="#111111"') && svg.includes('<rect'));
  // 네모 모듈: 그린 넓이 = 위치 찾기 무늬 밖의 어두운 모듈 수
  const area = [...svg.matchAll(/M\d+ \d+h(\d+)v1h-\d+z/g)].reduce((n, m) => n + +m[1], 0);
  const n = q.size;
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules[y * n + x] && !((x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7))) dark++;
  assert.equal(area, dark);
  for (const dots of ['rounded', 'dots'] as const) for (const eyes of ['rounded', 'circle'] as const) {
    const s = renderSvg(q, { ...defaultStyle, dots, eyes, transparent: true, fg: 'javascript:x', margin: 0 });
    assert.ok(!s.includes('<rect') && !s.includes('javascript') && s.includes(`viewBox="0 0 ${n} ${n}"`));
  }
  const box = logoBox(q, { ...defaultStyle, logo: 'data:image/png;base64,AAAA' })!;
  assert.equal((n - box.size) % 2, 0);
  assert.ok(box.size / n <= 0.3);
  assert.ok(renderSvg(q, { ...defaultStyle, logo: 'data:image/png;base64,AA"><script>' }).includes('&quot;&gt;') === false);
  assert.ok(!renderSvg(q, { ...defaultStyle, logo: 'data:image/png;base64,AA"><script>' }).includes('"><script>'));
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.ok(contrast('#777777', '#888888') < 1.5);
});

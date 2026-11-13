import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  base64Decode,
  base64Encode,
  encodeAll,
  escapeUnicode,
  fixMojibake,
  gunzip,
  hexDecode,
  hexDump,
  hexEncode,
  htmlDecode,
  htmlEncode,
  isDoubleEncoded,
  mimeWordDecode,
  percentDecode,
  qpBytes,
  sniff,
  textStats,
  unescapeJs,
  urlEncode,
  utf8Decode,
  utf8Encode,
} from '../src/lib/encode/codec';
import { detect } from '../src/lib/encode/detect';
import { Crc32, Md5, crc32, hmac, md5, normalizeChecksum, sha } from '../src/lib/encode/hash';
import { password, passwordBits, passwordSets, parseObjectId, parseUlid, parseUuid, strengthNote, token, ulid, uuidV4, uuidV7 } from '../src/lib/encode/ids';
import { canVerify, explainClaims, parseJwt, signHs256, verifyHmac } from '../src/lib/encode/jwt';
import { punyDecode, punyEncode, toAscii, toUnicode } from '../src/lib/encode/punycode';
import { guessUnix, kst, parseDate, relative, span, utcIso } from '../src/lib/encode/time';

const NOW = Date.UTC(2026, 10, 13, 5, 0, 0); // 2026-11-13 14:00 KST
const kinds = (s: string) => detect(s, NOW).map((c) => c.kind);
const top = (s: string) => detect(s, NOW)[0];
const b64 = (s: string) => base64Encode(utf8Encode(s));
const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

test('UTF-8 · Base64: 한글과 이모지가 그대로 돌아온다', () => {
  for (const s of ['', 'a', 'ab', 'abc', '안녕하세요', '가😀나 👨‍👩‍👧 끝', 'line1\nline2\t', '\u0000\u007f']) {
    const bytes = utf8Encode(s);
    assert.equal(utf8Decode(base64Decode(base64Encode(bytes))!), s);
    assert.equal(utf8Decode(base64Decode(base64Encode(bytes, { url: true }))!), s);
    assert.equal(utf8Decode(hexDecode(hexEncode(bytes)) ?? new Uint8Array()), s);
    assert.equal(base64Encode(bytes), Buffer.from(s).toString('base64'));
    assert.equal(base64Encode(bytes, { url: true }), Buffer.from(s).toString('base64url'));
  }
  assert.equal(utf8Decode(new Uint8Array([0xff, 0xfe])), null);
});

test('Base64: 채움 글자 · URL 꼴 · 틀린 글', () => {
  assert.equal(b64('안녕하세요'), '7JWI64WV7ZWY7IS47JqU');
  assert.deepEqual([...base64Decode('aGk=')!], [104, 105]);
  // = 가 빠져도 읽는다
  assert.deepEqual([...base64Decode('aGk')!], [104, 105]);
  assert.deepEqual([...base64Decode('YQ')!], [97]);
  // - _ 와 + / 모두
  assert.deepEqual([...base64Decode('-_-_')!], [...base64Decode('+/+/')!]);
  assert.deepEqual([...base64Decode('+/+/')!], [0xfb, 0xff, 0xbf]);
  // 줄바꿈은 건너뛴다
  assert.equal(utf8Decode(base64Decode('aGVs\nbG8=\n')!), 'hello');
  // 길이가 4n+1 이거나, 쓸 수 없는 글자, = 가 너무 많거나 자리가 틀리면 null
  assert.equal(base64Decode('abcde'), null);
  assert.equal(base64Decode('ab!d'), null);
  assert.equal(base64Decode('가나다라'), null);
  assert.equal(base64Decode('a==='), null);
  assert.equal(base64Decode('abc=='), null);
  assert.equal(base64Decode('')!.length, 0);
});

test('16진수: 여러 꼴 읽기 · 덤프', () => {
  assert.equal(utf8Decode(hexDecode('48656c6c6f')!), 'Hello');
  assert.equal(utf8Decode(hexDecode('48 65 6C 6C 6F')!), 'Hello');
  assert.equal(utf8Decode(hexDecode('0x48, 0x65, 0x6c')!), 'Hel');
  assert.equal(utf8Decode(hexDecode('\\xea\\xb0\\x80')!), '가');
  assert.equal(hexDecode('abc'), null);
  assert.equal(hexDecode('zz'), null);
  assert.equal(hexDump(utf8Encode('Hello, world! 12345')), '00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 20 31 32  Hello, world! 12\n00000010  33 34 35                                          345');
});

test('URL 인코딩: 풀기 · 두 번 인코딩 · EUC-KR', () => {
  assert.deepEqual(percentDecode('%EA%B0%80%20a'), { text: '가 a', charset: 'utf-8' });
  assert.equal(percentDecode('a+b', true)!.text, 'a b');
  assert.equal(percentDecode('a+b')!.text, 'a+b');
  assert.equal(percentDecode('100%'), null);
  assert.equal(percentDecode('%zz'), null);
  // 옛 사이트: EUC-KR
  assert.deepEqual(percentDecode('%B0%A1'), { text: '가', charset: 'euc-kr' });
  assert.equal(isDoubleEncoded(percentDecode('%25EA%25B0%2580')!.text), true);
  assert.equal(isDoubleEncoded('가'), false);
  assert.equal(urlEncode('가 &'), '%EA%B0%80%20%26');
  assert.equal(urlEncode('https://a.kr/가?b=1', true), 'https://a.kr/%EA%B0%80?b=1');
  // 짝 없는 서로게이트에도 죽지 않는다
  assert.equal(urlEncode('\ud83d'), '%EF%BF%BD');
});

test('HTML 엔티티 · \\u 이스케이프 · quoted-printable · MIME · 깨진 글', () => {
  assert.deepEqual(htmlDecode('&amp;&#44032;&#xAC00;&lt;b&gt;&nbsp;&unknown;'), { text: '&가가<b> &unknown;', count: 6 });
  assert.equal(htmlDecode('&#128512;').text, '😀');
  assert.equal(htmlEncode('<a href="x">가&</a>'), '&lt;a href=&quot;x&quot;&gt;가&amp;&lt;/a&gt;');
  assert.equal(htmlEncode('가😀', true), '&#xAC00;&#x1F600;');
  assert.equal(htmlDecode(htmlEncode('가😀 <&>', true)).text, '가😀 <&>');

  assert.equal(unescapeJs('\\uac00\\u{1F600}\\n\\x41').text, '가😀\nA');
  assert.equal(unescapeJs('\\ud83d\\ude00').text, '😀');
  assert.equal(escapeUnicode('가😀\n"'), '\\uac00\\ud83d\\ude00\\n"');
  assert.equal(unescapeJs(escapeUnicode('한글 😀 \\ tab\t')).text, '한글 😀 \\ tab\t');

  assert.equal(utf8Decode(qpBytes('=EA=B0=80=\r\n=EB=82=98')!), '가나');
  assert.equal(qpBytes('a=b'), null);
  assert.deepEqual(mimeWordDecode('=?UTF-8?B?7JWI64WV?= =?UTF-8?Q?=ED=95=98=EC=84=B8=EC=9A=94_a?='), { text: '안녕하세요 a', charsets: ['UTF-8'] });
  assert.equal(mimeWordDecode('Subject: =?euc-kr?B?sKE=?=')!.text, 'Subject: 가');
  assert.equal(mimeWordDecode('=?nope?B?sKE=?='), null);

  assert.equal(fixMojibake('ê°€'), '가');
  assert.equal(fixMojibake('ì•ˆë…•í•˜ì„¸ìš”'), '안녕하세요');
  assert.equal(fixMojibake('café'), null);
  assert.equal(fixMojibake('안녕'), null);
});

test('파일 종류 · gzip 풀기', async () => {
  assert.equal(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))!.ext, 'png');
  assert.equal(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))!.ext, 'jpg');
  assert.equal(sniff(utf8Encode('GIF89a'))!.ext, 'gif');
  assert.equal(sniff(utf8Encode('%PDF-1.7'))!.ext, 'pdf');
  assert.equal(sniff(utf8Encode('PK\u0003\u0004'))!.ext, 'zip');
  assert.equal(sniff(utf8Encode('hello')), null);
  const gz = new Uint8Array(gzipSync('{"가":1}'));
  assert.equal(sniff(gz)!.ext, 'gz');
  assert.equal(utf8Decode((await gunzip(gz))!), '{"가":1}');
  assert.equal(await gunzip(new Uint8Array([0x1f, 0x8b, 8, 1, 2, 3])), null);
});

test('만들기: 한 번에 모든 꼴', () => {
  const rows = Object.fromEntries(encodeAll('가 <a>').map((r) => [r.id, r.value]));
  assert.equal(rows.base64, '6rCAIDxhPg==');
  assert.equal(rows.base64url, '6rCAIDxhPg');
  assert.equal(rows.url, '%EA%B0%80%20%3Ca%3E');
  assert.equal(rows.hex, 'eab080203c613e');
  assert.equal(rows.html, '가 &lt;a&gt;');
  assert.equal(rows.unicode, '\\uac00 <a>');
  assert.equal(rows.json, '"가 <a>"');
  assert.equal(rows.punycode, undefined);
  assert.equal(encodeAll('한글.kr').find((r) => r.id === 'punycode')!.value, 'xn--bj0bj06e.kr');
  assert.deepEqual(textStats('가😀a'), { chars: 3, bytes: 8, lines: 1 });
});

test('Punycode: 양쪽으로', () => {
  assert.equal(punyEncode('한글'), 'bj0bj06e');
  assert.equal(punyDecode('bj0bj06e'), '한글');
  assert.equal(punyEncode('bücher'), 'bcher-kva');
  assert.equal(punyDecode('bcher-kva'), 'bücher');
  assert.equal(punyDecode('3e0b707e'), '한국');
  assert.equal(punyDecode('!!'), null);
  assert.equal(toUnicode('www.xn--bj0bj06e.xn--3e0b707e'), 'www.한글.한국');
  assert.equal(toUnicode('example.com'), null);
  assert.equal(toAscii('www.한글.한국'), 'www.xn--bj0bj06e.xn--3e0b707e');
  for (const s of ['한글도메인', '日本語', 'ñandú', 'a한b글c', '😀']) assert.equal(punyDecode(punyEncode(s)), s);
});

test('MD5: 알려진 값 · 조각으로 넣어도 같다', () => {
  const h = (s: string) => hexEncode(md5(utf8Encode(s)));
  assert.equal(h(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(h('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(h('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(h('12345678901234567890123456789012345678901234567890123456789012345678901234567890'), '57edf4a22be3c955ac49da2e2107b67a');
  assert.equal(h('가나다'), createHash('md5').update('가나다').digest('hex'));
  // 채움이 갈리는 길이(55 · 56 · 63 · 64 · 65)를 포함해 Node 와 견준다
  const data = new Uint8Array(5000).map((_, i) => (i * 131 + 7) & 255);
  for (const len of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 5000]) {
    const part = data.subarray(0, len);
    assert.equal(hexEncode(md5(part)), createHash('md5').update(part).digest('hex'), `len ${len}`);
  }
  for (const step of [1, 7, 64, 100, 4096]) {
    const m = new Md5();
    for (let i = 0; i < data.length; i += step) m.update(data.subarray(i, i + step));
    assert.equal(hexEncode(m.digest()), hexEncode(md5(data)), `step ${step}`);
  }
});

test('CRC32 · SHA · HMAC · 체크섬 고르기', async () => {
  assert.equal(crc32(utf8Encode('123456789')).toString(16), 'cbf43926');
  assert.equal(crc32(new Uint8Array()), 0);
  const c = new Crc32().update(utf8Encode('1234')).update(utf8Encode('56789'));
  assert.equal(hexEncode(c.digest()), 'cbf43926');
  assert.equal(hexEncode(await sha('SHA-256', utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hexEncode(await sha('SHA-1', utf8Encode('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(hexEncode(await hmac('SHA-256', utf8Encode('key'), utf8Encode('The quick brown fox jumps over the lazy dog'))), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.equal(hexEncode(await hmac('SHA-256', new Uint8Array(), utf8Encode('x'))), createHmac('sha256', '').update('x').digest('hex'));

  const md = 'D41D8CD98F00B204E9800998ECF8427E';
  assert.equal(normalizeChecksum(md), md.toLowerCase());
  assert.equal(normalizeChecksum(`md5: ${md}`), md.toLowerCase());
  assert.equal(normalizeChecksum(`${md.toLowerCase()}  file.zip`), md.toLowerCase());
  assert.equal(normalizeChecksum('SHA256 (file) = x'), null);
  assert.equal(normalizeChecksum('1B2M2Y8AsgTpgAmY7PhCfg=='), md.toLowerCase());
  assert.equal(normalizeChecksum('hello'), null);
  assert.equal(normalizeChecksum(''), null);
});

test('JWT: 읽기 · 클레임 풀이 · HS256 서명 확인', async () => {
  const jwt = parseJwt(JWT_IO)!;
  assert.deepEqual(jwt.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(jwt.payload, { sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  assert.equal(jwt.signature.length, 32);
  assert.equal(canVerify(jwt.alg), true);
  assert.equal(await verifyHmac(jwt, utf8Encode('your-256-bit-secret')), true);
  assert.equal(await verifyHmac(jwt, utf8Encode('wrong')), false);
  assert.equal(await verifyHmac(jwt, new Uint8Array()), false);
  assert.ok(parseJwt('Bearer ' + JWT_IO));
  assert.equal(parseJwt('a.b.c'), null);
  assert.equal(parseJwt('hello world'), null);

  const made = await signHs256({ sub: '홍길동', exp: NOW / 1000 + 3 * 3600 + 12 * 60, iat: NOW / 1000 - 60, nbf: NOW / 1000 + 600, aud: ['a', 'b'] }, 'secret');
  const mine = parseJwt(made)!;
  assert.equal(await verifyHmac(mine, utf8Encode('secret')), true);
  const claims = Object.fromEntries(explainClaims(mine.payload, NOW).map((c) => [c.key, c]));
  assert.equal(claims.exp.value, '2026-11-13 (금) 17:12:00 KST');
  assert.deepEqual([claims.exp.note, claims.exp.tone], ['3시간 12분 뒤 만료', 'ok']);
  assert.equal(claims.iat.note, '1분 전 발급');
  assert.equal(claims.nbf.tone, 'bad');
  assert.equal(claims.sub.value, '홍길동');
  assert.equal(claims.aud.value, '["a","b"]');
  const old = explainClaims({ exp: NOW / 1000 - 2 * 86400 - 3600 }, NOW)[0];
  assert.deepEqual([old.note, old.tone], ['2일 전에 만료됨', 'bad']);

  // RS256 은 확인하지 않는다, none 은 경고
  const none = `${base64Encode(utf8Encode('{"alg":"none"}'), { url: true })}.${base64Encode(utf8Encode('{"a":1}'), { url: true })}.`;
  assert.equal(await verifyHmac(parseJwt(none)!, utf8Encode('x')), null);
  assert.equal(top(none).notes![0].tone, 'bad');
});

test('UUID · ULID · ObjectId: 시각 꺼내기와 만들기', () => {
  const v7 = parseUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')!;
  assert.deepEqual([v7.version, v7.variant, v7.time], [7, 'RFC 4122', 1645557742000]);
  assert.equal(v7.canonical, '017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
  assert.equal(parseUuid('c232ab00-9414-11ec-b3c8-9f6bdeced846')!.time, 1645557742000);
  assert.equal(parseUuid('1ec9414c-232a-6b00-b3c8-9f6bdeced846')!.time, 1645557742000);
  assert.equal(parseUuid('urn:uuid:919108f7-52d1-4320-9bac-f847db4148a8')!.version, 4);
  assert.equal(parseUuid('919108f7-52d1-4320-9bac-f847db4148a8')!.time, null);
  assert.equal(parseUuid('not-a-uuid'), null);
  assert.equal(parseUlid('01ARYZ6S41TSV4RRFFQ69G5FAV')!.time, 1469918176385);
  assert.equal(parseUlid('01aryz6s41tsv4rrffq69g5fav')!.canonical, '01ARYZ6S41TSV4RRFFQ69G5FAV');
  assert.equal(parseUlid('81ARZ3NDEKTSV4RRFFQ69G5FAV'), null);
  assert.equal(parseObjectId('507f1f77bcf86cd799439011')!.time, 0x507f1f77 * 1000);

  const fixed = (buf: Uint8Array) => buf.fill(0xab);
  assert.equal(uuidV4(fixed), 'abababab-abab-4bab-abab-abababababab');
  const made = uuidV7(1645557742000, fixed);
  assert.equal(made, '017f22e2-79b0-7bab-abab-abababababab');
  assert.equal(parseUuid(made)!.time, 1645557742000);
  const u = ulid(1469918176385, fixed);
  assert.equal(u.slice(0, 10), '01ARYZ6S41');
  assert.equal(u.length, 26);
  assert.equal(parseUlid(u)!.time, 1469918176385);
  // 진짜 난수로도 꼴이 맞는다
  for (let i = 0; i < 50; i++) {
    assert.equal(parseUuid(uuidV4())!.version, 4);
    assert.ok(Math.abs(parseUuid(uuidV7())!.time! - Date.now()) < 5000);
    assert.ok(Math.abs(parseUlid(ulid())!.time - Date.now()) < 5000);
  }
});

test('토큰 · 비밀번호', () => {
  assert.match(token(33, 'hex'), /^[0-9a-f]{33}$/);
  assert.match(token(40, 'base64url'), /^[A-Za-z0-9_-]{40}$/);
  assert.match(token(25, 'alnum'), /^[A-Za-z0-9]{25}$/);
  const o = { length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true };
  for (let i = 0; i < 100; i++) {
    const pw = password(o);
    assert.equal(pw.length, 20);
    assert.doesNotMatch(pw, /[0O1lI]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^A-Za-z0-9]/);
  }
  assert.equal(passwordSets(o).join('').length, 25 + 24 + 8 + 13);
  assert.equal(Math.round(passwordBits({ ...o, symbols: false, noAmbiguous: false })), Math.round(20 * Math.log2(62)));
  assert.equal(password({ ...o, lower: false, upper: false, digits: false, symbols: false }), '');
  assert.match(password({ ...o, length: 2 }), /^.{2}$/);
  assert.deepEqual([strengthNote(30).label, strengthNote(50).label, strengthNote(70).label, strengthNote(128).label], ['약함', '보통', '튼튼함', '아주 튼튼함']);
  // 글자가 고르게 나온다 (치우침이 없다)
  const counts = new Map<string, number>();
  for (const ch of token(62_000, 'alnum')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  assert.equal(counts.size, 62);
  for (const v of counts.values()) assert.ok(v > 800 && v < 1200, String(v));
});

test('시각: 단위 짐작 · 한국 시간 · 상대 표현 · 날짜 읽기', () => {
  assert.deepEqual(guessUnix('1700000000'), { unit: 's', ms: 1700000000000, exact: true });
  assert.deepEqual(guessUnix('1700000000123'), { unit: 'ms', ms: 1700000000123, exact: true });
  assert.deepEqual(guessUnix('1700000000123456'), { unit: 'us', ms: 1700000000123, exact: true });
  assert.deepEqual(guessUnix('1700000000123456789'), { unit: 'ns', ms: 1700000000123, exact: true });
  assert.deepEqual(guessUnix('1700000000.5'), { unit: 's', ms: 1700000000500, exact: true });
  assert.equal(guessUnix('999999999')!.exact, false);
  // 전화번호 · 짧은 수 · 글자 섞인 것은 아니다
  assert.equal(guessUnix('01012345678'), null);
  assert.equal(guessUnix('0212345678'), null);
  assert.equal(guessUnix('12345'), null);
  assert.equal(guessUnix('17000000ab'), null);
  assert.equal(guessUnix('99999999999'), null);

  assert.equal(kst(1700000000000), '2023-11-15 (수) 07:13:20 KST');
  assert.equal(utcIso(1700000000000), '2023-11-14T22:13:20Z');
  assert.equal(utcIso(1700000000123), '2023-11-14T22:13:20.123Z');
  assert.deepEqual([45_000, 12 * 60_000, 3 * 3600_000 + 12 * 60_000, 3 * 3600_000, 30 * 3600_000, 3 * 86400_000, 100 * 86400_000, 430 * 86400_000].map(span), ['45초', '12분', '3시간 12분', '3시간', '1일 6시간', '3일', '3개월', '1년 2개월']);
  assert.equal(relative(NOW - 3 * 86400_000, NOW), '3일 전');
  assert.equal(relative(NOW + 90_000, NOW), '1분 뒤');
  assert.equal(relative(NOW, NOW), '지금');

  assert.deepEqual(parseDate('2023-11-14T22:13:20Z'), { ms: 1700000000000, assumedKst: false, dateOnly: false });
  assert.equal(parseDate('2023-11-15T07:13:20+09:00')!.ms, 1700000000000);
  assert.equal(parseDate('2023-11-15 07:13:20')!.ms, 1700000000000);
  assert.equal(parseDate('2023-11-15 07:13:20')!.assumedKst, true);
  assert.deepEqual(parseDate('2023-11-15'), { ms: Date.UTC(2023, 10, 14, 15), assumedKst: true, dateOnly: true });
  assert.equal(parseDate('Tue, 14 Nov 2023 22:13:20 GMT')!.ms, 1700000000000);
  assert.equal(parseDate('2023-02-30'), null);
  assert.equal(parseDate('어제'), null);
});

test('알아보기: 종류마다 맨 위에 온다', () => {
  assert.equal(top(JWT_IO).kind, 'jwt');
  assert.match(top(JWT_IO).reason, /JWT 로 보입니다/);
  assert.equal(top(b64('안녕하세요, 반갑습니다')).text, '안녕하세요, 반갑습니다');
  assert.equal(top(b64('안녕하세요, 반갑습니다')).kind, 'base64');
  assert.equal(top('7JWI64WV7ZWY7IS47JqUPz8_Pw').kind, 'base64url');
  assert.equal(top('%EC%95%88%EB%85%95').kind, 'percent');
  assert.equal(top('%EC%95%88%EB%85%95').text, '안녕');
  assert.equal(top('48 65 6c 6c 6f').kind, 'hex');
  assert.equal(top('0xDEADBEEF').kind, 'hex');
  assert.equal(top('\\xea\\xb0\\x80').text, '가');
  assert.equal(top('&#44032;&amp;&#xAC00;').text, '가&가');
  assert.equal(top('\\uac00\\ub098 \\u{1F600}').text, '가나 😀');
  assert.equal(top('"\\uc548\\ub155\\n"').text, '안녕\n');
  assert.equal(top('=?UTF-8?B?7JWI64WV?=').kind, 'mime');
  assert.equal(top('=EC=95=88=EB=85=95=ED=95=98=EC=84=B8=EC=9A=94').text, '안녕하세요');
  assert.equal(top('xn--bj0bj06e.kr').text, '한글.kr');
  assert.equal(top('한글.kr').text, 'xn--bj0bj06e.kr');
  assert.equal(top('1700000000').kind, 'unix');
  assert.equal(top('1700000000').rows![0].value, '2023-11-15 (수) 07:13:20 KST');
  assert.match(top('1700000000').rows![0].note!, /^2년 \d+개월 전$/);
  assert.equal(top('1700000000123').title, '유닉스 시간 (밀리초)');
  assert.equal(top('2023-11-14T22:13:20Z').rows![0].value, '1700000000');
  assert.equal(top('017f22e2-79b0-7cc3-98c4-dc0c0c07398f').title, 'UUID v7');
  assert.ok(top('017f22e2-79b0-7cc3-98c4-dc0c0c07398f').rows!.some((r) => r.label === '만든 시각' && r.value.startsWith('2022-02-23')));
  assert.equal(top('01ARZ3NDEKTSV4RRFFQ69G5FAV').kind, 'ulid');
  assert.equal(top('507f1f77bcf86cd799439011').kind, 'objectid');
  assert.equal(top('ê°€ë‚˜ë‹¤').text, '가나다');
  assert.equal(top('{"a":[1,2]}').text, '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(top('$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW').title, 'bcrypt 해시');
});

test('알아보기: 헷갈리는 것들', () => {
  // 해시 길이
  const md = 'd41d8cd98f00b204e9800998ecf8427e';
  assert.equal(top(md).kind, 'hash');
  assert.equal(top(md).reason, '32자 16진수 — MD5 길이입니다 (해시는 되돌릴 수 없습니다)');
  assert.match(top('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad').reason, /SHA-256 길이/);
  // 16진수이면서 Base64 로도 읽히는 글 → 16진수가 먼저
  assert.deepEqual(kinds('48656c6c6f20776f726c6421').slice(0, 1), ['hex']);
  assert.equal(top('48656c6c6f20776f726c6421').text, 'Hello world!');
  assert.equal(kinds('deadbeefcafe1234')[0], 'hex');
  assert.ok(detect('deadbeefcafe1234', NOW).filter((c) => c.kind === 'base64').every((c) => c.confidence <= 0.25));
  // 10자리 숫자는 시각, 전화번호 꼴은 아무것도 아니다
  assert.deepEqual(kinds('1700000000'), ['unix']);
  assert.deepEqual(kinds('01012345678'), []);
  assert.deepEqual(kinds('010-1234-5678'), []);
  assert.deepEqual(kinds('12:34:56'), []);
  // 그냥 글
  assert.deepEqual(kinds('안녕하세요. 오늘 회의는 3시입니다.'), []);
  assert.deepEqual(kinds('hello world this is plain text'), []);
  assert.deepEqual(kinds('password'), []);
  assert.deepEqual(kinds('할인 50% 행사'), []);
  assert.deepEqual(kinds(''), []);
  assert.deepEqual(kinds('   \n'), []);
  // 영문 낱말 하나는 Base64 라 해도 맨 아래 · 낮게
  assert.ok(detect('test', NOW).every((c) => c.confidence < 0.6));
  // 줄을 나눈 Base64
  const long = b64('가'.repeat(60));
  assert.equal(top(long.replace(/(.{40})/g, '$1\n')).text, '가'.repeat(60));
  // = 가 빠진 Base64 는 알려 준다
  assert.match(top('7JWI64WV7ZWY7IS47JqUIQ').notes![0].text, /채워서 읽었습니다/);
  // 글이 아닌 Base64 는 바이트로
  const png = base64Encode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  assert.deepEqual([top(png).file!.ext, top(png).bytes!.length, top(png).text], ['png', 12, undefined]);
  // 안에 든 JSON 은 줄을 나눈다
  assert.deepEqual([top(b64('{"가":1}')).json, top(b64('{"가":1}')).text], [true, '{\n  "가": 1\n}']);
  // data: 주소
  assert.equal(top('data:text/plain;base64,7JWI64WV').text, '안녕');
});

test('알아보기: 주소를 나누고 겹친 인코딩을 따라간다', () => {
  const inner = b64('{"user":"홍길동"}');
  const url = `https://xn--bj0bj06e.kr:8443/a%20b/%EA%B0%80?q=%EC%84%9C%EC%9A%B8+%EB%82%A0%EC%94%A8&next=%252Fhome%253Fa%253D1&token=${encodeURIComponent(inner)}#%EC%9C%84`;
  const c = top(url);
  assert.equal(c.kind, 'url');
  const rows = Object.fromEntries(c.rows!.map((r) => [r.label, r]));
  assert.equal(rows['프로토콜'].value, 'https');
  assert.equal(rows['호스트'].value, '한글.kr');
  assert.equal(rows['포트'].value, '8443');
  assert.equal(rows['경로'].value, '/a b/가');
  assert.equal(rows['?q'].value, '서울 날씨');
  assert.equal(rows['?next'].value, '%2Fhome%3Fa%3D1');
  assert.match(rows['?next'].note!, /두 번 인코딩되어 있습니다/);
  assert.equal(rows['# 조각'].value, '위');
  assert.ok(!kinds(url).includes('percent'));
  // 값 → 다시 풀기: URL → Base64 → JSON
  assert.equal(rows['?token'].value, inner);
  assert.equal(top(rows['?token'].value).text, '{\n  "user": "홍길동"\n}');
  assert.equal(top(rows['?next'].value).text, '/home?a=1');
  // 쿼리 문자열만
  const q = top('a=1&name=%ED%99%8D+%EA%B8%B8%EB%8F%99');
  assert.deepEqual(q.rows!.map((r) => [r.label, r.value]), [['a', '1'], ['name', '홍 길동']]);
  assert.equal(top('http://example.com/').text, undefined);
});

test('알아보기: 아무 글에도 죽지 않고 큰 글도 빠르다', () => {
  const junk = ['%', '%%%', '=?', '\\u', '\\', '&#;', '&#99999999;', '....', 'a.b.c', '://', 'data:,', 'data:;base64,@@', '0x', '\\x', '=', '==', 'xn--', 'xn--!!', '$2b$', '\u0000￿', '\ud83d', '{', '[}', '"\\"', 'eyJ.eyJ.', '-1', '1e309', '9'.repeat(40), 'f'.repeat(129), '%EA%B0', '=E', 'Ã', 'https://', 'https://[::1', 'a'.repeat(26)];
  for (const s of junk) assert.doesNotThrow(() => detect(s, NOW), s);
  const big = b64('가나다라마바사 '.repeat(200_000));
  const t0 = performance.now();
  const c = detect(big, NOW);
  assert.equal(c[0].kind, 'base64');
  assert.equal(c[0].text!.length, 8 * 200_000);
  for (const s of ['가나다 '.repeat(500_000), 'ab '.repeat(500_000), '%41'.repeat(300_000), '\\u0041'.repeat(200_000), 'f'.repeat(2_000_000)]) detect(s, NOW);
  assert.ok(performance.now() - t0 < 5000, `${performance.now() - t0}ms`);
});

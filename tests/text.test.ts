import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, patternError, PRESETS, runRegex } from '../src/lib/text/regex';
import { applyOp, countChars, stats } from '../src/lib/text/lines';

test('정규식 실행: JS 와 같은 결과', () => {
  const r = runRegex('(\\d+)-(?<tail>\\d+)?', 'g', 'a 10-20 b 7- c');
  assert.deepEqual(r.matches.map((m) => [m.index, m.end, m.text]), [[2, 7, '10-20'], [10, 12, '7-']]);
  assert.deepEqual(r.matches[0].groups, ['10', '20']);
  assert.deepEqual(r.matches[1].groups, ['7', null]);
  assert.deepEqual(r.matches[1].named, { tail: null });
  // g 가 없으면 첫 일치만
  assert.equal(runRegex('\\d', '', '1 2 3').matches.length, 1);
  // 빈 일치에서 멈추지 않는다 (이모지 가운데를 자르지도 않는다)
  assert.deepEqual(runRegex('x*', 'g', 'ab').matches.map((m) => m.index), [0, 1, 2]);
  assert.deepEqual(runRegex('', 'gu', '😀a').matches.map((m) => m.index), [0, 2, 3]);
  // 너무 많으면 자르고 알린다
  const many = runRegex('a', 'g', 'a'.repeat(50), null, 10);
  assert.deepEqual([many.matches.length, many.truncated], [10, true]);
  // 바꾸기: $1, $<name>, $&
  assert.equal(runRegex('(?<y>\\d{4})-(\\d\\d)', 'g', '2026-11, 2027-01', '$2/$<y> [$&]').replaced, '11/2026 [2026-11], 01/2027 [2027-01]');
  assert.equal(runRegex('a', '', 'aaa', 'b').replaced, 'baa');
  assert.equal(runRegex('a', 'g', 'aaa').replaced, null);
});

test('정규식 오류를 우리말로', () => {
  assert.equal(patternError('a+b', 'g'), null);
  assert.match(patternError('(abc', '')!, /괄호 \( 를 닫지/);
  assert.match(patternError('abc)', '')!, /여는 괄호 없이/);
  assert.match(patternError('[a-', '')!, /대괄호/);
  assert.match(patternError('*a', '')!, /반복할 것이 없습니다/);
  assert.match(patternError('[z-a]', '')!, /범위가 거꾸로/);
  assert.match(patternError('a{3,1}', '')!, /앞 숫자가 더 큽니다/);
  assert.match(patternError('abc\\', '')!, /\\ 로 끝났습니다/);
  assert.ok(patternError('\\p{Nope}', 'u'));
});

test('정규식 풀이', () => {
  const lines = (p: string, f = '') => explain(p, f).map((x) => `${'  '.repeat(x.depth)}${x.text} → ${x.desc}`);
  assert.deepEqual(lines('^01[016789]-?\\d{3,4}$'), [
    '^ → 글 전체의 시작',
    "01 → 글자 그대로 '01'",
    '[016789] → 다음 중 하나: 0, 1, 6, 7, 8, 9',
    "-? → 글자 '-' — 있어도 되고 없어도 됨",
    '\\d{3,4} → 숫자 하나 (0~9) — 3~4번 반복',
    '$ → 글 전체의 끝',
  ]);
  assert.deepEqual(lines('(?<year>\\d{4})|(?:ab)+?x', 'm'), [
    '(?<year> → 묶음 1 ‘year’ 시작 — $<year> 로 꺼내 씁니다',
    '  \\d{4} → 숫자 하나 (0~9) — 정확히 4번',
    ') → 묶음 ‘year’ 끝',
    '| → 또는',
    '(?: → 묶기만 함 (번호를 매기지 않음)',
    "  ab → 글자 그대로 'ab'",
    ')+? → 묶기 끝 — 1번 이상 반복 (되도록 적게)',
    "x → 글자 그대로 'x'",
  ]);
  assert.deepEqual(lines('[^가-힣a-z\\d_\\]]*'), ['[^가-힣a-z\\d_\\]]* → 다음이 아닌 글자 하나: 한글 (가~힣), a~z, 숫자, _, ] — 0번 이상 반복']);
  assert.deepEqual(lines('^a.$', 'ms'), ['^ → 줄의 시작', "a → 글자 그대로 'a'", '. → 아무 글자 하나 (줄바꿈 포함)', '$ → 줄의 끝']);
  assert.deepEqual(lines('(a)\\1(?=b)(?<!c)\\.\\p{Script=Hangul}\\u00e9\\b'), [
    '( → 묶음 1 시작 — 잡은 글은 $1 로 꺼내 씁니다',
    "  a → 글자 그대로 'a'",
    ') → 묶음 1 끝',
    '\\1 → 묶음 1 이 잡은 것과 같은 글',
    '(?= → 바로 뒤에 다음이 오는 자리 (글자를 쓰지는 않음)',
    "  b → 글자 그대로 'b'",
    ') → 조건 끝',
    '(?<! → 바로 앞에 다음이 없는 자리',
    "  c → 글자 그대로 'c'",
    ') → 조건 끝',
    "\\. → 글자 그대로 '.'",
    '\\p{Script=Hangul} → 한글 하나',
    "\\u00e9 → 글자 'é' (유니코드 00E9)",
    '\\b → 낱말의 경계 (글자와 글자 아닌 것 사이)',
  ]);
  // 반복은 마지막 글자에만 걸린다
  assert.deepEqual(lines('abc+d'), ["ab → 글자 그대로 'ab'", "c+ → 글자 'c' — 1번 이상 반복", "d → 글자 그대로 'd'"]);
  // 풀이를 이어 붙이면 원래 식이 된다. 틀린 식에도 죽지 않는다.
  for (const p of [...PRESETS.map((x) => x.pattern), 'a|b|(c|d(e|f))', '[]a]', '[a-]', '\\cA\\x41\\k<n>(?<n>.)', 'a{2,}?', '(((', '[abc', '\\', 'a)b', 'x{', '😀+[😀-😎]']) {
    assert.equal(explain(p).map((x) => x.text).join(''), p, p);
  }
});

test('정규식 모음: 예시에서 실제로 일치한다', () => {
  for (const p of PRESETS) {
    assert.equal(patternError(p.pattern, p.flags), null, p.name);
    assert.ok(runRegex(p.pattern, p.flags, p.sample).matches.length >= 2, p.name);
  }
  const phones = runRegex(PRESETS[1].pattern, 'g', PRESETS[1].sample).matches.map((m) => m.text);
  assert.deepEqual(phones, ['010-1234-5678', '01098765432', '011 234 5678']);
  assert.deepEqual(runRegex(PRESETS[9].pattern, 'g', PRESETS[9].sample).matches.map((m) => m.text), ['192.168.0.1', '10.0.12.254']);
});

test('글자 수 세기', () => {
  const s = stats('안녕하세요, tools 입니다.\n둘째 줄 😀');
  assert.deepEqual(s, { chars: 24, charsNoSpace: 19, words: 6, lines: 2, utf8: 49, euckr: 36, pages: 1 });
  assert.deepEqual(stats(''), { chars: 0, charsNoSpace: 0, words: 0, lines: 0, utf8: 0, euckr: 0, pages: 0 });
  // 눈에 보이는 대로: 가족 이모지 · 국기 · 조합형 한글도 한 글자, 윈도우 줄바꿈도 한 글자
  assert.equal(countChars('👨‍👩‍👧‍👦🇰🇷'), 2);
  assert.equal(countChars('한'), 1);
  assert.deepEqual([stats('a\r\nb').chars, stats('a\r\nb').charsNoSpace, stats('a\r\nb').lines], [3, 2, 2]);
  assert.equal(stats('가'.repeat(401)).pages, 3);
});

test('줄 정리', () => {
  const op = (id: Parameters<typeof applyOp>[0], t: string, a = {}) => applyOp(id, t, a).text;
  // 숫자는 크기대로, 한글이 로마자보다 먼저 (한국어 사전 순서)
  assert.equal(op('sort', '다\n가\n10\n9\nb\nA'), '9\n10\n가\n다\nA\nb');
  assert.equal(op('sortDesc', '1\n3\n2'), '3\n2\n1');
  assert.equal(op('sortLength', 'ccc\na\nbb\n가나'), 'a\n가나\nbb\nccc');
  assert.equal(op('reverse', '1\n2\n3'), '3\n2\n1');
  assert.deepEqual(applyOp('dedupe', 'a\nb\na\nA\nb'), { text: 'a\nb\nA', note: '겹치는 2줄을 지웠습니다' });
  assert.deepEqual(applyOp('trim', '  a \nb\n\tc'), { text: 'a\nb\nc', note: '2줄에서 앞뒤 공백을 지웠습니다' });
  assert.equal(applyOp('trim', 'a\nb').note, '바뀐 줄이 없습니다');
  assert.equal(op('dropBlank', 'a\n\n  \nb\n'), 'a\nb');
  assert.equal(op('squeeze', 'a   b\t\tc　　d'), 'a b c d');
  assert.equal(op('upper', 'abc 가'), 'ABC 가');
  assert.equal(op('title', "hello wORLD, it's me-too"), "Hello World, It's Me-Too");
  assert.equal(op('number', 'a\nb'), '1. a\n2. b');
  assert.equal(op('number', Array(10).fill('x').join('\n')).split('\n')[0], ' 1. x');
  assert.equal(op('join', 'a\n\nb\nc'), 'a, b, c');
  assert.equal(op('join', 'a\nb', { delimiter: '\\t' }), 'a\tb');
  assert.equal(op('split', 'a, b,c\nd', { delimiter: ',' }), 'a\nb\nc\nd');
  assert.equal(op('wrap', 'a\n\nb', { prefix: "'", suffix: "'," }), "'a',\n\n'b',");
  // 섞기: 줄은 그대로, 순서만
  let s = 7;
  const shuffled = op('shuffle', '1\n2\n3\n4\n5\n6', { rand: (n: number) => (s = (s * 31 + 11) % 97) % n });
  assert.notEqual(shuffled, '1\n2\n3\n4\n5\n6');
  assert.equal(shuffled.split('\n').sort().join(''), '123456');
  // 윈도우 줄바꿈은 그대로 둔다
  assert.equal(op('sort', 'b\r\na'), 'a\r\nb');
});

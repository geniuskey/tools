import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffInline, diffLines, diffSeq, normalizeJson, splitLines, unifiedPatch, type Row } from '../src/lib/diff/core';
import { pixelDiff } from '../src/lib/diff/image';

/** rows 로 양쪽 원문을 되살릴 수 있어야 한다 */
function check(a: string, b: string, rows: Row[]) {
  const la = splitLines(a);
  const lb = splitLines(b);
  assert.deepEqual(rows.filter((r) => r.a !== null).map((r) => r.a), la.map((_, i) => i));
  assert.deepEqual(rows.filter((r) => r.b !== null).map((r) => r.b), lb.map((_, i) => i));
  for (const r of rows) {
    if (!r.changed) assert.equal(la[r.a!], lb[r.b!]);
    if (r.segA) assert.equal(r.segA.map((s) => s.text).join(''), la[r.a!]);
    if (r.segB) assert.equal(r.segB.map((s) => s.text).join(''), lb[r.b!]);
  }
}

test('줄 나누기', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n'), ['a']);
  assert.deepEqual(splitLines('a\r\nb\n\n'), ['a', 'b', '']);
});

test('기본 비교', () => {
  const a = 'one\ntwo\nthree\nfour\n';
  const b = 'one\n2\nthree\nfour\nfive\n';
  const r = diffLines(a, b);
  check(a, b, r.rows);
  assert.deepEqual([r.added, r.removed, r.modified], [1, 0, 1]);
  assert.equal(diffLines(a, a).rows.every((x) => !x.changed), true);
  assert.equal(diffLines('', b).added, 5);
  assert.equal(diffLines(a, '').removed, 4);
});

test('닮은 줄끼리 짝짓고 달라진 부분만 표시', () => {
  const a = '회의는 3월 4일 오후 2시에 시작합니다.\n담당: 김하늘\n';
  const b = '안내\n회의는 3월 5일 오후 2시에 시작합니다.\n담당: 김하늘\n';
  const r = diffLines(a, b);
  check(a, b, r.rows);
  assert.deepEqual([r.added, r.removed, r.modified], [1, 0, 1]);
  const row = r.rows.find((x) => x.segA)!;
  assert.deepEqual(row.segA!.filter((s) => s.changed).map((s) => s.text), ['4']);
  assert.deepEqual(row.segB!.filter((s) => s.changed).map((s) => s.text), ['5']);
});

test('줄 안 비교: 단어 일부, 공백, 닮지 않은 줄', () => {
  const x = diffInline('확인했습니다', '확인했어요')!;
  assert.deepEqual(x.segA, [{ text: '확인했', changed: false }, { text: '습니다', changed: true }]);
  const y = diffInline('const total = 1;', 'const count = 1;')!;
  assert.deepEqual(y.segB.filter((s) => s.changed).map((s) => s.text), ['count']);
  assert.equal(diffInline('const a = 1;', 'let b = 2;'), null);
  assert.equal(diffInline('완전히 다른 문장', 'nothing in common here'), null);
  // 바뀐 단어 사이의 공백은 함께 칠한다
  const z = diffInline('a b c d e f g', 'a x y d e f g')!;
  assert.deepEqual(z.segA.filter((s) => s.changed).map((s) => s.text), ['b c']);
});

test('옵션: 공백 · 대소문자 무시', () => {
  const a = '  Hello World  \nfoo\n';
  const b = 'hello   world\nfoo\n';
  assert.equal(diffLines(a, b).modified, 1);
  assert.equal(diffLines(a, b, { ws: 'edge', ignoreCase: true }).modified, 1);
  assert.equal(diffLines(a, b, { ws: 'all', ignoreCase: true }).rows.some((r) => r.changed), false);
  assert.equal(diffLines('a b\n', 'a  b \n', { ws: 'all' }).rows.some((r) => r.changed), false);
});

test('차이가 큰 입력: 예산 초과 시 patience 로 쪼갠다', () => {
  // 예산을 아주 작게 주고도 닻(고유한 공통 줄)을 따라 맞춰야 한다
  const a = ['x1', 'x2', 'KEEP-1', 'x3', 'x4', 'x5', 'KEEP-2', 'x6'];
  const b = ['y1', 'KEEP-1', 'y2', 'y3', 'y4', 'y5', 'y6', 'KEEP-2', 'y7', 'y8'];
  const m = diffSeq(a, b, 2);
  assert.equal(m[2], 1);
  assert.equal(m[6], 7);
  assert.equal([...m].filter((v) => v >= 0).length, 2);

  // 큰 입력에서도 끝나고, 결과가 원문과 맞아야 한다
  const big = (seed: number) => {
    const out: string[] = [];
    for (let i = 0; i < 30000; i++) out.push(i % 7 === seed ? `changed ${seed} ${i}` : `line ${i}`);
    return out.join('\n') + '\n';
  };
  const A = big(1);
  const B = big(3);
  const t = Date.now();
  const r = diffLines(A, B);
  check(A, B, r.rows);
  assert.ok(r.modified > 8000, `modified ${r.modified}`);
  assert.ok(Date.now() - t < 5000, '너무 느림');
});

test('무작위 입력에서도 항상 올바른 편집', () => {
  let s = 12345;
  const rnd = (n: number) => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 8) % n;
  for (let round = 0; round < 200; round++) {
    const gen = () => Array.from({ length: rnd(40) }, () => 'abcdef'[rnd(6)]).join('\n');
    const a = gen();
    const b = gen();
    check(a, b, diffLines(a, b).rows);
    // 최단 편집인지: 짝지어진 수 = LCS 길이
    const la = splitLines(a);
    const lb = splitLines(b);
    const dp = Array.from({ length: la.length + 1 }, () => new Array(lb.length + 1).fill(0));
    for (let i = la.length - 1; i >= 0; i--)
      for (let j = lb.length - 1; j >= 0; j--) dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    assert.equal([...diffSeq(la, lb)].filter((v) => v >= 0).length, dp[0][0]);
  }
});

/** 패치를 직접 적용해 본다 */
function applyPatch(a: string, patch: string): string {
  const src = a === '' ? [] : a.split('\n');
  const srcEol = a.endsWith('\n');
  if (srcEol) src.pop();
  const out: string[] = [];
  let pos = 0;
  let eol = srcEol;
  const lines = patch.split('\n').slice(2, -1);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const noEol = lines[i + 1]?.startsWith('\\');
    if (l.startsWith('@@')) {
      const m = /^@@ -(\d+),(\d+) /.exec(l)!;
      const start = +m[2] ? +m[1] - 1 : +m[1];
      while (pos < start) out.push(src[pos++]);
    } else if (l[0] === ' ') {
      assert.equal(src[pos], l.slice(1));
      out.push(src[pos++]);
      eol = !noEol;
    } else if (l[0] === '-') {
      assert.equal(src[pos++], l.slice(1));
    } else if (l[0] === '+') {
      out.push(l.slice(1));
      eol = !noEol;
    }
  }
  const tail = pos < src.length;
  while (pos < src.length) out.push(src[pos++]);
  if (tail) eol = srcEol;
  return out.join('\n') + (out.length && eol ? '\n' : '');
}

test('패치 내보내기', () => {
  assert.equal(unifiedPatch('a\n', 'a\n'), '');
  assert.equal(
    unifiedPatch('a\nb\nc\n', 'a\nB\nc\nd\n', 'old.txt', 'new.txt'),
    ['--- old.txt', '+++ new.txt', '@@ -1,3 +1,4 @@', ' a', '-b', '+B', ' c', '+d', ''].join('\n'),
  );
  assert.equal(unifiedPatch('', 'x\n'), ['--- a', '+++ b', '@@ -0,0 +1,1 @@', '+x', ''].join('\n'));
  // 마지막 줄바꿈이 없는 경우
  assert.equal(unifiedPatch('a\nb', 'a\nb\n'), ['--- a', '+++ b', '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', ''].join('\n'));

  const cases: [string, string][] = [
    ['a\nb\nc\n', 'a\nB\nc\nd\n'],
    ['a\nb', 'a\nb\n'],
    ['a\nb\n', 'a\nb'],
    ['', 'x\ny'],
    ['x\ny\n', ''],
    [Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n') + '\n', Array.from({ length: 60 }, (_, i) => (i % 17 === 5 ? `L${i}` : `l${i}`)).join('\n')],
  ];
  for (const [a, b] of cases) assert.equal(applyPatch(a, unifiedPatch(a, b)), b, JSON.stringify([a, b]));
});

test('JSON 정규화', () => {
  const a = normalizeJson('{"b":1,"a":{"d":[3,{"z":1,"y":2}],"c":null}}');
  const b = normalizeJson('{ "a": { "c": null, "d": [3, { "y": 2, "z": 1 }] }, "b": 1 }');
  assert.ok(a.ok && b.ok);
  assert.equal(a.text, b.text);
  assert.equal(normalizeJson('  ').ok, true);
  assert.equal(normalizeJson('{"a":}').ok, false);
  const keep = normalizeJson('{"b":1,"a":2}', false);
  assert.ok(keep.ok && keep.text.indexOf('"b"') < keep.text.indexOf('"a"'));
});

test('이미지 픽셀 비교', () => {
  const w = 4;
  const h = 3;
  const a = new Uint8ClampedArray(w * h * 4).fill(255);
  const b = new Uint8ClampedArray(a);
  assert.deepEqual(pixelDiff(a, b, w, h, 0.1), { count: 0, box: null });
  const set = (x: number, y: number, rgb: number[]) => b.set([...rgb, 255], (y * w + x) * 4);
  set(1, 1, [0, 0, 0]);
  set(3, 2, [255, 0, 0]);
  set(0, 0, [254, 255, 254]); // 눈에 안 보이는 차이
  const out = new Uint8ClampedArray(a.length);
  assert.deepEqual(pixelDiff(a, b, w, h, 0.1, out), { count: 2, box: { x: 1, y: 1, w: 3, h: 2 } });
  assert.deepEqual([...out.slice((1 * w + 1) * 4, (1 * w + 1) * 4 + 4)], [255, 0, 85, 255]);
  assert.equal(pixelDiff(a, b, w, h, 0).count, 3);
  // 완전히 투명한 픽셀끼리는 색이 달라도 같다
  const t1 = new Uint8ClampedArray([10, 20, 30, 0]);
  const t2 = new Uint8ClampedArray([200, 100, 50, 0]);
  assert.equal(pixelDiff(t1, t2, 1, 1, 0).count, 0);
});

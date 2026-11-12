import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeText, eligible, maskName, parseParticipants, pick, randomInt, rangeText, remaining, resultsCsv, sampleText, type Prize } from '../src/lib/raffle/core';

test('명단 파싱', () => {
  const r = parseParticipants('이름\t부서\n김하늘\t개발팀\n\n이서연, 디자인팀 , 3년차\n박민준\n김하늘\t개발팀\n');
  assert.equal(r.list.length, 4);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.list.map((p) => p.name), ['김하늘', '이서연', '박민준', '김하늘']);
  assert.equal(r.list[1].info, '디자인팀 · 3년차');
  assert.equal(r.list[2].no, 3);
  // 동명이인은 부가 정보가 다르면 다른 사람
  assert.equal(parseParticipants('김하늘,A\n김하늘,B').duplicates, 0);
});

test('중복 제거와 번호 범위', () => {
  assert.equal(dedupeText('a\nb\na\n\nB\nc'), 'a\nb\nc');
  assert.equal(dedupeText('이름\n김\n김'), '이름\n김');
  assert.equal(rangeText(1, 3), '1\n2\n3');
  assert.equal(rangeText(3, 1, 'A-', '번'), 'A-1번\nA-2번\nA-3번');
  const s = parseParticipants(sampleText(300));
  assert.equal(s.duplicates, 0);
  assert.ok(s.list.length > 250);
});

test('난수: 범위와 균등성', () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) counts[randomInt(7)]++;
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 600, `치우침: ${counts}`);
  // 범위를 벗어난 값은 버린다
  const seq = [0xffffffff, 5];
  assert.equal(randomInt(3, (b) => (b[0] = seq.shift()!)), 2);
});

test('뽑기: 중복 없음', () => {
  const pool = Array.from({ length: 500 }, (_, i) => i);
  const w = pick(pool, 120);
  assert.equal(new Set(w).size, 120);
  assert.equal(pick(pool, 9999).length, 500);
  assert.equal(pool[0], 0);
});

test('대상자 계산', () => {
  const all = parseParticipants('a\nb\nc\nd').list;
  const w = (key: string, v = false) => ({ key, no: 1, name: key, info: '', at: 0, void: v });
  const p1: Prize = { id: '1', name: '1등', count: 2, winners: [w(all[0].key), w(all[1].key, true)] };
  const p2: Prize = { id: '2', name: '2등', count: 2, winners: [] };
  assert.equal(remaining(p1), 1);
  assert.deepEqual(eligible(all, [p1, p2], p2, false).map((x) => x.name), ['c', 'd']);
  assert.deepEqual(eligible(all, [p1, p2], p2, true).map((x) => x.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(eligible(all, [p1, p2], p1, true).map((x) => x.name), ['c', 'd']);
  assert.ok(resultsCsv([p1]).includes('취소'));
});

test('이름 가리기', () => {
  assert.equal(maskName('김하늘'), '김＊늘');
  assert.equal(maskName('남궁민수'), '남＊＊수');
  assert.equal(maskName('이솔'), '이＊');
});

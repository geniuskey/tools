import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjust, advance, clockText, durationText, goto, initial, parseAgenda, parseDuration, pause, phaseOf, remaining, retext, schedule, start, type Shared } from '../src/lib/timer/core';

test('시간 읽기', () => {
  assert.equal(parseDuration('15'), 900);
  assert.equal(parseDuration('1.5'), 90);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('90초'), 90);
  assert.equal(parseDuration('1시간 30분'), 5400);
  assert.equal(parseDuration('2h 5m'), 7500);
  assert.equal(parseDuration('10 min'), 600);
  assert.equal(parseDuration('분'), null);
  assert.equal(parseDuration('abc'), null);
});

test('순서표 읽기', () => {
  const a = parseAgenda('여는 말 5\n\n발표\t15분\nQ&A, 5:30\n쉬는 시간 (10분)\n1부 - 1시간 30분\n점심\n 20 \n3분기 실적 12');
  assert.deepEqual(
    a.map((s) => [s.name, s.seconds, s.guessed]),
    [
      ['여는 말', 300, false],
      ['발표', 900, false],
      ['Q&A', 330, false],
      ['쉬는 시간', 600, false],
      ['1부', 5400, false],
      ['점심', 300, true],
      ['순서 7', 1200, false],
      ['3분기 실적', 720, false],
    ],
  );
  assert.deepEqual(parseAgenda(''), []);
  // 이름 끝의 숫자가 붙어 있으면 이름의 일부다
  assert.deepEqual(parseAgenda('세션2')[0], { name: '세션2', seconds: 300, guessed: true });
});

const agenda = parseAgenda('A 1\nB 2\nC 0:30');
const base: Shared = { ...initial('A 1\nB 2\nC 0:30') };

test('시작 · 멈춤 · 조절', () => {
  assert.equal(base.left, 60_000);
  let s = start(base, 1000);
  assert.equal(remaining(s, 1000), 60_000);
  assert.equal(remaining(s, 11_000), 50_000);
  assert.equal(start(s, 5000), s);
  s = pause(s, 11_000);
  assert.deepEqual([s.running, s.left], [false, 50_000]);
  assert.equal(remaining(s, 999_999), 50_000); // 멈춘 동안은 흐르지 않는다
  s = adjust(s, 60_000, 0);
  assert.equal(s.left, 110_000);
  s = adjust(s, -200_000, 0);
  assert.equal(s.left, 0); // 0 아래로는 줄이지 않는다
  let r = start(base, 0);
  r = adjust(r, -30_000, 10_000);
  assert.equal(remaining(r, 10_000), 20_000);
  // 이미 초과한 상태에서 줄이면 그대로
  assert.equal(remaining(adjust(r, -60_000, 40_000), 40_000), -10_000);
  assert.equal(remaining(adjust(r, 60_000, 40_000), 40_000), 50_000);
});

test('순서 이동', () => {
  let s = goto(base, agenda, 1, 0);
  assert.deepEqual([s.index, s.left, s.running], [1, 120_000, false]);
  s = goto(start(s, 0), agenda, 2, 5000);
  assert.deepEqual([s.index, s.running, remaining(s, 5000)], [2, true, 30_000]);
  assert.equal(goto(base, agenda, 99, 0).index, 2);
  assert.equal(goto(base, agenda, -1, 0).index, 0);
});

test('시간이 다 됐을 때', () => {
  const run = start(base, 0);
  assert.equal(advance(run, agenda, 59_999), run);
  // 초과 시간 세기
  assert.equal(advance(run, agenda, 70_000), run);
  assert.equal(remaining(run, 70_000), -10_000);
  // 멈추기
  const stop = advance({ ...run, over: 'stop' }, agenda, 60_000);
  assert.deepEqual([stop.running, stop.left, stop.index], [false, 0, 0]);
  // 다음 순서로: 넘친 시간은 다음 순서에서 뺀다
  const next = advance({ ...run, over: 'next' }, agenda, 61_000);
  assert.deepEqual([next.index, next.running, remaining(next, 61_000)], [1, true, 119_000]);
  // 오래 잠들었다 깨어나면 여러 순서를 건너뛴다
  const late = advance({ ...run, over: 'next' }, agenda, 190_000);
  assert.deepEqual([late.index, remaining(late, 190_000)], [2, 20_000]);
  // 마지막 순서가 끝나면 멈춘다
  const end = advance({ ...run, over: 'next' }, agenda, 500_000);
  assert.deepEqual([end.index, end.running, end.left], [2, false, 0]);
  assert.equal(advance(base, agenda, 999_999), base);
});

test('순서표를 고치면', () => {
  // 시작 전이면 새 길이를 따른다
  assert.equal(retext(base, 'A 3\nB 2', 0).left, 180_000);
  // 진행 중이던 시간은 건드리지 않는다
  const mid = pause(start(base, 0), 20_000);
  assert.equal(retext(mid, 'A 3\nB 2', 0).left, 40_000);
  const run = start(base, 0);
  assert.equal(remaining(retext(run, 'A 9', 5000), 5000), 55_000);
  // 지금 순서가 사라지면 마지막 순서로
  const last = goto(base, agenda, 2, 0);
  const cut = retext(last, 'A 1', 0);
  assert.deepEqual([cut.index, cut.left], [0, 60_000]);
});

test('표시', () => {
  assert.equal(clockText(60_000), '1:00');
  assert.equal(clockText(59_001), '1:00');
  assert.equal(clockText(59_000), '0:59');
  assert.equal(clockText(1), '0:01');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(-999), '0:00');
  assert.equal(clockText(-1000), '+0:01');
  assert.equal(clockText(-75_500), '+1:15');
  assert.equal(clockText(3_723_000), '1:02:03');
  assert.equal(durationText(5400), '1시간 30분');
  assert.equal(durationText(90), '1분 30초');
  assert.deepEqual([phaseOf(61_000, 60), phaseOf(60_000, 60), phaseOf(0, 60), phaseOf(-5, 60)], ['normal', 'warn', 'over', 'over']);
  const s = goto(start(base, 0), agenda, 1, 0);
  assert.deepEqual(schedule(s, agenda, 20_000), [null, 120_000, 150_000]);
  // 초과 중이면 다음 순서는 지금부터 센다
  assert.deepEqual(schedule(s, agenda, 200_000), [null, 200_000, 230_000]);
});

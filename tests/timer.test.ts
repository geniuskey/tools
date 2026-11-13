import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjust, advance, clockText, durationText, fromQuery, goto, initial, parseAgenda, parseDuration, pause, phaseOf, remaining, retext, schedule, start, targetAt, toQuery, type Shared } from '../src/lib/timer/core';

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

// 시각은 이 컴퓨터의 시간대로 센다
const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m).getTime();

test('몇 시까지 읽기', () => {
  const pick = (t: string) => parseAgenda(t).map((s) => [s.name, s.seconds, s.at ?? null, !!s.flex]);
  assert.deepEqual(pick('쉬는 시간 14:30까지'), [['쉬는 시간', 0, 870, false]]);
  assert.deepEqual(pick('점심 ~13:00\n등록 @09:00\n발표 - 15:10 까지'), [
    ['점심', 0, 780, false],
    ['등록', 0, 540, false],
    ['발표', 0, 910, false],
  ]);
  assert.deepEqual(pick('쉬는시간~14:30'), [['쉬는시간', 0, 870, false]]);
  assert.deepEqual(pick('2부 오후 2시 반까지\n뒤풀이 9pm까지\n밤샘 오전 12시까지'), [
    ['2부', 0, 870, false],
    ['뒤풀이', 0, 1260, false],
    ['밤샘', 0, 0, false],
  ]);
  // 오전 · 오후를 안 쓰면 둘 다 될 수 있다
  assert.deepEqual(pick('발표 2시까지\n토론 10:30까지'), [
    ['발표', 0, 120, true],
    ['토론', 0, 630, true],
  ]);
  // 표시가 없으면 지금처럼 길이 (분:초 · 시간 단위)
  assert.deepEqual(pick('발표 14:30\n1부 1시간 30분까지'), [
    ['발표', 870, null, false],
    ['1부 1시간 30분까지', 300, null, false],
  ]);
  assert.deepEqual(pick('이상한 25:00까지'), [['이상한 25:00까지', 300, null, false]]);
});

test('그 시각이 언제인지', () => {
  const seg = (t: string) => parseAgenda(t)[0];
  assert.equal(targetAt(seg('x 14:30까지'), at(13)), at(14, 30));
  // 조금 지났으면 오늘 (초과로 센다), 한참 지났으면 내일
  assert.equal(targetAt(seg('x 14:30까지'), at(14, 40)), at(14, 30));
  assert.equal(targetAt(seg('x 09:00까지'), at(20)), at(9, 0, 14));
  // 자정을 넘는다
  assert.equal(targetAt(seg('x 0:30까지'), at(23, 50)), at(0, 30, 14));
  // 오전 · 오후가 없으면 가까운 쪽
  assert.equal(targetAt(seg('x 2시까지'), at(13)), at(14));
  assert.equal(targetAt(seg('x 10시까지'), at(9)), at(10));
  assert.equal(targetAt(seg('x 10시까지'), at(21)), at(22));
});

test('시각까지 세는 순서', () => {
  const text = '대기 10:00까지\n여는 말 0:30\n쉬는 시간 10:20까지\n마무리 5';
  const ag = parseAgenda(text);
  // 시작 전에도 시계를 따라 줄어든다
  let s = initial(text, at(9, 50));
  assert.deepEqual([s.running, remaining(s, at(9, 50)), remaining(s, at(9, 55))], [false, 600_000, 300_000]);
  // 언제 시작해도 10:00 에 끝난다
  s = start(s, at(9, 55));
  assert.equal(s.endAt, at(10));
  // 앞이 늦어지면 쉬는 시간이 짧아진다
  s = { ...s, over: 'next' };
  s = advance(s, ag, at(10, 0, 13) + 1);
  assert.deepEqual([s.index, s.anchor, remaining(s, at(10))], [1, 0, 30_000]);
  assert.deepEqual(schedule(s, ag, at(10, 10)), [null, at(10, 10), at(10, 20), at(10, 25)]);
  s = advance(s, ag, at(10, 0, 13) + 30_000);
  assert.deepEqual([s.index, s.anchor, remaining(s, at(10, 15))], [2, at(10, 20), 300_000]);
  // 멈추면 그 자리에서 얼고, 이어서 하면 남은 시간부터
  const p = pause(s, at(10, 15));
  assert.deepEqual([p.anchor, remaining(p, at(10, 18))], [0, 300_000]);
  // 시간을 조절하면 시각에서 풀린다
  const a = adjust(s, 60_000, at(10, 15));
  assert.deepEqual([a.anchor, remaining(a, at(10, 15))], [0, 360_000]);
  // 다시 하면 시각으로 돌아간다
  assert.equal(remaining(goto(a, ag, 2, at(10, 16)), at(10, 16)), 240_000);
  // 이미 지난 시각까지인 순서는 건너뛴다
  const late = advance({ ...goto(s, ag, 1, at(10, 25)), over: 'next' }, ag, at(10, 26));
  assert.deepEqual([late.index, remaining(late, at(10, 26))], [3, 270_000]);
  // 달리는 중에 시각을 고치면 새 시각을 따른다
  const moved = retext(s, '대기 10:00까지\n여는 말 0:30\n쉬는 시간 10:30까지\n마무리 5', at(10, 15));
  assert.equal(remaining(moved, at(10, 15)), 900_000);
});

test('주소에 담는 설정', () => {
  const mine: Shared = { ...initial('발표 15\n질의응답 5:30', 0), warn: 60, over: 'next', scene: 'sand', clock: false };
  const q = toQuery(mine);
  assert.equal(q.toString(), new URLSearchParams({ a: mine.text, warn: '60', over: 'next', bg: 'sand', clock: '0' }).toString());
  // 받은 사람: 순서표와 설정이 같아지고, 처음부터 시작한다
  const theirs = fromQuery(new URLSearchParams(q.toString()), start(initial('회의 30', 0), 0), 1000);
  assert.deepEqual([theirs.text, theirs.warn, theirs.over, theirs.scene, theirs.sound, theirs.clock], [mine.text, 60, 'next', 'sand', true, false]);
  assert.equal(theirs.index, 0);
  // 기본값은 주소에 싣지 않고, 없는 설정은 기본값으로 읽는다
  assert.equal(toQuery(initial('A 1', 0)).toString(), 'a=A+1');
  const back = fromQuery(new URLSearchParams('a=A+1'), { ...initial('A 1', 0), warn: 300, scene: 'stars' }, 0);
  assert.deepEqual([back.warn, back.scene], [10, 'water']);
  // 같으면 그대로 (진행 중인 타이머를 건드리지 않는다), 타이머 주소가 아니어도 그대로
  const running = start(mine, 0);
  assert.equal(fromQuery(toQuery(running), running, 5000), running);
  assert.equal(fromQuery(new URLSearchParams('view=display'), running, 5000), running);
  // 이상한 값은 기본값으로
  const odd = fromQuery(new URLSearchParams('a=A+1&warn=x&over=boom&bg=lava'), mine, 0);
  assert.deepEqual([odd.warn, odd.over, odd.scene], [10, 'count', 'water']);
});

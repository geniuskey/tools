import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRuns, parse, type Dialect, type Spec } from '../src/lib/cron/core';
import { describe, rows, whyNever } from '../src/lib/cron/explain';
import { convert, planOf, planText, snippets, toUtc, defaultPlan } from '../src/lib/cron/format';
import { j } from '../src/lib/cron/ko';

const spec = (e: string, d: Dialect | 'auto' = 'auto'): Spec => {
  const p = parse(e, d);
  assert.deepEqual(p.errors, [], `${e}: ${p.errors.map((x) => x.text).join(', ')}`);
  return p.spec!;
};
const err = (e: string, d: Dialect | 'auto' = 'auto') => {
  const p = parse(e, d);
  assert.ok(p.errors.length, `${e} 은 틀린 식이어야 한다`);
  return p.errors[0];
};
/** 그 시간대 벽시계로 "2026-03-08 03:30" */
const wall = (utc: number, tz: string) => {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return f.format(utc).slice(0, 16);
};
const next = (e: string, from: string, n: number, tz = 'Asia/Seoul', d: Dialect | 'auto' = 'auto') => findRuns(spec(e, d), tz, Date.parse(from), n).runs.map((r) => wall(r.utc, tz));

test('형식 알아보기: 칸 수 · ? · 감싼 것', () => {
  assert.equal(parse('0 9 * * 1-5').dialect, 'unix');
  assert.equal(parse('0 0 9 * * MON-FRI').dialect, 'spring');
  assert.equal(parse('0 0 9 ? * MON-FRI').dialect, 'quartz');
  assert.equal(parse('0 0 9 ? * 2-6 2027').dialect, 'quartz');
  assert.equal(parse('0 9 ? * MON-FRI *').dialect, 'aws');
  assert.equal(parse('cron(0 9 ? * MON-FRI *)').dialect, 'aws');
  // 5칸 뒤는 명령
  const c = parse('0 9 * * 1-5 /usr/bin/backup.sh --all');
  assert.equal(c.dialect, 'unix');
  assert.equal(c.spec!.command!.text, '/usr/bin/backup.sh --all');
  assert.match(c.why, /명령/);
  // 붙여넣은 설정에서 식만 꺼낸다
  assert.equal(spec("- cron: '30 23 * * 0-4'").min.join(), '30');
  assert.equal(spec('schedule: "*/5 * * * *"').min.length, 12);
  assert.equal(spec('@Scheduled(cron = "0 0 9 * * MON-FRI", zone = "Asia/Seoul")').dialect, 'spring');
  assert.equal(spec('ScheduleExpression: "cron(0 9 * * ? *)"').dialect, 'aws');
  // 위치는 원래 글 기준이다
  const g = parse("  - cron: '30 23 * * 0-4'");
  assert.equal(g.tokens[0].start, "  - cron: '".length);
  // 형식을 고르면 그대로 읽는다
  assert.equal(parse('0 0 9 * * *', 'unix').spec!.command!.text, '*');
  assert.ok(parse('0 0 9 * * *').alternatives.includes('unix'));
});

test('Unix: 이름 · 7 = 일요일 · 범위 · 간격 · 목록 · 줄임말', () => {
  const s = spec('*/15 9-17 1,15 jan-mar SUN,7');
  assert.deepEqual(s.min, [0, 15, 30, 45]);
  assert.deepEqual(s.hour, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(s.dom.values, [1, 15]);
  assert.deepEqual(s.month, [1, 2, 3]);
  assert.deepEqual(s.dow.values, [0]);
  assert.deepEqual(spec('0 0 * * 1-7').dow.values, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(spec('0 0 * * 5-0').dow.values, [0, 5, 6]);
  assert.deepEqual(spec('10-50/20 * * * *').min, [10, 30, 50]);
  // 시작값이 있는 간격: 5/15 = 5 · 20 · 35 · 50
  assert.deepEqual(spec('5/15 * * * *').min, [5, 20, 35, 50]);
  assert.match(spec('5/15 * * * *').warnings[0].text, /받지 않는 cron/);
  assert.equal(spec('@daily').macro!.expands, '0 0 * * *');
  assert.equal(describe(spec('@weekly')), '매주 일요일 자정');
  assert.equal(spec('@reboot /opt/start.sh').special!.kind, 'reboot');
  assert.equal(describe(spec('rate(5 minutes)')), '5분마다 (일정을 만든 때부터 셉니다)');
});

test('틀린 식: 칸 · 글자를 짚고 고치는 법을 알려 준다', () => {
  let e = err('0 24 * * *');
  assert.equal(e.text, '시는 0~23 사이입니다 — 24는 쓸 수 없습니다');
  assert.equal(e.fix, '자정은 0 입니다');
  assert.deepEqual([e.start, e.end, e.field], [2, 4, 'hour']);
  e = err('61 * * * *');
  assert.equal(e.text, '분은 0~59 사이입니다 — 61은 쓸 수 없습니다');
  e = err('0 9 * *');
  assert.match(e.text, /칸이 모자랍니다: 4칸/);
  assert.equal(e.fix, '빠진 칸은 * 로 채우세요');
  assert.match(err('0 9 ? * 1').text, /Unix cron 에는 \? 가 없습니다/);
  assert.match(err('0 9 L * *').text, /Unix cron 에 없습니다/);
  assert.match(err('0 22-2 * * *').fix!, /22-23,0-2/);
  assert.match(err('*/0 * * * *').text, /간격은 1 이상/);
  assert.match(err('0 9 1,,2 * *').text, /쉼표 사이가 비었습니다/);
  assert.match(err('0 9 * foo *').text, /foo를 알아볼 수 없습니다/);
  // Quartz · AWS: 일과 요일 중 하나는 ?
  assert.match(err('0 0 9 * * MON', 'quartz').text, /하나를 \? 로 비워야/);
  assert.match(err('0 0 9 ? * ?', 'quartz').text, /둘 다 \? 로/);
  assert.match(err('cron(0 9 * * MON *)').text, /AWS 는 일과 요일 가운데 하나를/);
  assert.match(err('0 0 9 ? * 0', 'quartz').fix!, /1\(일요일\)부터 7\(토요일\)/);
  assert.match(err('CRON_TZ=Asia/Seol 0 9 * * *').text, /알 수 없는 시간대/);
});

test('주의: 흔한 함정을 알려 준다', () => {
  const w = (e: string) => spec(e).warnings.map((x) => x.text).join('\n');
  assert.match(w('0 0 13 * 5'), /둘 중 하나만 맞아도 돕니다/);
  assert.match(w('0 0 */2 * 1'), /둘 다 맞는 날에만/);
  assert.match(w('*/45 * * * *'), /45분마다가 아닙니다 — 0 · 45분에 돌고, 45분 다음은 0분이라서 그 사이는 15분입니다/);
  assert.match(w('0 */5 * * *'), /5시간마다가 아닙니다/);
  assert.equal(w('*/15 * * * *'), '');
  assert.match(w('* 9 * * *'), /9시 동안 1분마다 돕니다/);
  assert.match(w('* 0 9 * * *'), /1초마다/);
  assert.match(w('0 9 31 * *'), /31일이 없는 달에는/);
  assert.match(w('0 0 9 ? * 1-5'), /1-5 는 일~목요일/);
  assert.match(w('0 3 * * * date +%F'), /% 는 줄바꿈/);
  assert.match(w('TZ=Asia/Seoul 0 9 * * *'), /CRON_TZ= 가 맞습니다/);
});

test('풀이: 식 전체를 한 문장으로', () => {
  const cases: [string, string][] = [
    ['0 9 * * 1-5', '평일 오전 9시'],
    ['*/15 * * * *', '15분마다 (매시 0 · 15 · 30 · 45분)'],
    ['0 30 18 ? * 6L', '매달 마지막 금요일 오후 6시 30분'],
    ['0 0 * * *', '매일 자정'],
    ['0 12 * * *', '매일 정오'],
    ['0 9-18 * * 1-5', '평일 오전 9시부터 오후 6시까지 매시 정각'],
    ['*/10 9-17 * * 1-5', '평일 오전 9시부터 오후 5시 50분까지 10분마다'],
    ['0 */2 * * *', '2시간마다 정각 (0 · 2 · 4 … 22시)'],
    ['0 0 1 1 *', '매년 1월 1일 자정'],
    ['0 0 13 * 5', '매달 13일 또는 매주 금요일 자정'],
    ['0 0 */2 * 1', '매달 홀수 날 가운데 월요일인 날 자정'],
    ['0 0 9 ? * 2#2', '매달 둘째 월요일 오전 9시'],
    ['0 0 0 L * ?', '매달 마지막 날 자정'],
    ['0 0 0 L-3 * ?', '매달 마지막 날 3일 전 자정'],
    ['0 0 12 LW * ?', '매달 마지막 평일 정오'],
    ['0 0 12 15W * ?', '매달 15일에서 가장 가까운 평일 정오'],
    ['0 8 * * 6,0', '주말 오전 8시'],
    ['0 0 * * 1-3,5', '매주 월 · 화 · 수 · 금요일 자정'],
    ['0 9,12,18 * * *', '매일 오전 9시 · 정오 · 오후 6시'],
    ['*/5 * * * * *', '5초마다'],
    ['0 0 9 1 */3 *', '3개월마다 (1 · 4 · 7 · 10월) 1일 오전 9시'],
    ['0 0 0 1 1 ? 2027-2030', '2027~2030년 매년 1월 1일 자정'],
    ['cron(0 10 * * ? *)', '매일 오전 10시'],
    ['0 30 4 ? 11 5#4', '매년 11월 넷째 목요일 오전 4시 30분'],
  ];
  for (const [e, want] of cases) assert.equal(describe(spec(e)), want, e);
  const r = rows(spec('*/15 9-18 * * 1-5'));
  assert.deepEqual(
    r.map((x) => [x.label, x.text, x.desc]),
    [
      ['분', '*/15', '15분마다 — 매시 0 · 15 · 30 · 45분'],
      ['시', '9-18', '9~18시 (오전 9시부터 오후 6시까지)'],
      ['일', '*', '* — 날짜는 따지지 않고 요일 칸을 따릅니다'],
      ['월', '*', '매달'],
      ['요일', '1-5', '평일 (월~금요일)'],
    ],
  );
  assert.deepEqual([r[1].start, r[1].end], [5, 9]);
});

test('조사: 받침을 보고 고른다', () => {
  assert.equal(j('분', '은'), '분은');
  assert.equal(j('시', '은'), '시는');
  assert.equal(j('24', '은'), '24는');
  assert.equal(j('61', '은'), '61은');
  assert.equal(j('10', '은'), '10은');
  assert.equal(j('0분', '이라서'), '0분이라서');
  assert.equal(j('3시', '이라서'), '3시라서');
  assert.equal(j('1', '으로'), '1로');
  assert.equal(j('6', '으로'), '6으로');
});

test('다음 실행: 달 · 해를 넘어서, 일 · 요일 "또는"', () => {
  // 2026-11-13 은 금요일
  assert.deepEqual(next('0 9 * * 1-5', '2026-11-13T10:00:00+09:00', 3), ['2026-11-16 09:00', '2026-11-17 09:00', '2026-11-18 09:00']);
  // 바로 그 시각은 "다음" 이 아니다
  assert.deepEqual(next('0 9 * * 1-5', '2026-11-13T09:00:00+09:00', 1), ['2026-11-16 09:00']);
  assert.deepEqual(next('0 0 13 * 5', '2026-11-01T00:00:00+09:00', 5), ['2026-11-06 00:00', '2026-11-13 00:00', '2026-11-20 00:00', '2026-11-27 00:00', '2026-12-04 00:00']);
  assert.deepEqual(next('0 0 1 1 *', '2026-11-13T00:00:00+09:00', 2), ['2027-01-01 00:00', '2028-01-01 00:00']);
  assert.deepEqual(next('0 0 29 2 *', '2026-11-13T00:00:00+09:00', 2), ['2028-02-29 00:00', '2032-02-29 00:00']);
  // Quartz: L · LW · W · # · nL · L-3
  assert.deepEqual(next('0 0 0 L * ?', '2026-01-15T00:00:00+09:00', 3), ['2026-01-31 00:00', '2026-02-28 00:00', '2026-03-31 00:00']);
  assert.deepEqual(next('0 0 0 L-3 * ?', '2026-01-15T00:00:00+09:00', 2), ['2026-01-28 00:00', '2026-02-25 00:00']);
  // 2026-05-31 은 일요일 → 마지막 평일은 29일(금)
  assert.deepEqual(next('0 0 0 LW * ?', '2026-05-01T00:00:00+09:00', 1), ['2026-05-29 00:00']);
  // 2026-11-01 은 일요일 → 1W 는 2일(월), 2026-08-01 은 토요일 → 1W 는 3일(월)
  assert.deepEqual(next('0 0 0 1W * ?', '2026-10-15T00:00:00+09:00', 1), ['2026-11-02 00:00']);
  assert.deepEqual(next('0 0 0 1W * ?', '2026-07-15T00:00:00+09:00', 1), ['2026-08-03 00:00']);
  assert.deepEqual(next('0 0 0 ? * 2#1', '2026-11-13T00:00:00+09:00', 2), ['2026-12-07 00:00', '2027-01-04 00:00']);
  assert.deepEqual(next('0 0 0 ? * 6L', '2026-11-13T00:00:00+09:00', 2), ['2026-11-27 00:00', '2026-12-25 00:00']);
  // Spring 은 0 = 일요일, 일 · 요일은 "그리고"
  assert.deepEqual(next('0 0 0 13 * FRI', '2026-01-01T00:00:00+09:00', 2, 'Asia/Seoul', 'spring'), ['2026-02-13 00:00', '2026-03-13 00:00']);
  assert.deepEqual(next('0 0 0 ? * 5L', '2026-11-13T00:00:00+09:00', 1, 'Asia/Seoul', 'spring'), ['2026-11-27 00:00']);
  // 초 단위
  assert.deepEqual(next('*/20 * * * * *', '2026-11-13T09:00:05+09:00', 3).length, 3);
  // 연도 칸
  assert.deepEqual(next('0 0 0 1 1 ? 2027-2028', '2026-11-13T00:00:00+09:00', 5), ['2027-01-01 00:00', '2028-01-01 00:00']);
  // 이전 실행
  assert.deepEqual(findRuns(spec('0 9 * * 1-5'), 'Asia/Seoul', Date.parse('2026-11-16T08:00:00+09:00'), 1, -1).runs.map((r) => wall(r.utc, 'Asia/Seoul')), ['2026-11-13 09:00']);
});

test('다음 실행: 돌지 않는 식은 끝없이 찾지 않는다', () => {
  const s = spec('0 0 30 2 *');
  const t = performance.now();
  const r = findRuns(s, 'Asia/Seoul', Date.parse('2026-11-13T00:00:00Z'), 10);
  assert.ok(performance.now() - t < 500);
  assert.deepEqual([r.never, r.runs.length], [true, 0]);
  assert.equal(whyNever(s, 2026), '2월에는 30일이 없습니다');
  assert.equal(whyNever(spec('0 0 0 1 1 ? 2020'), 2026), '정한 연도(2020년)가 모두 지났습니다');
  assert.equal(findRuns(spec('0 0 31 4,6 *'), 'UTC', 0, 1).never, true);
  // "또는" 이면 요일로는 돈다
  assert.equal(findRuns(spec('0 0 30 2 1'), 'UTC', Date.parse('2026-11-13T00:00:00Z'), 1).runs.length, 1);
});

test('서머타임: 뉴욕에서 없는 시각은 밀리고, 두 번 오는 시각은 한 번만', () => {
  const NY = 'America/New_York';
  // 2026-03-08 02:00 → 03:00 (2:30 이 없다)
  const s = spec('30 2 * * *');
  const r = findRuns(s, NY, Date.parse('2026-03-07T12:00:00Z'), 3).runs;
  assert.deepEqual(r.map((x) => wall(x.utc, NY)), ['2026-03-08 03:30', '2026-03-09 02:30', '2026-03-10 02:30']);
  assert.equal(r[0].dst, 'gap');
  assert.deepEqual(r[0].planned, { h: 2, mi: 30, s: 0 });
  // 2026-11-01 02:00 → 01:00 (1:30 이 두 번)
  const o = findRuns(spec('30 1 * * *'), NY, Date.parse('2026-10-31T12:00:00Z'), 2).runs;
  assert.equal(o[0].dst, 'overlap');
  assert.equal(new Date(o[0].utc).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(new Date(o[1].utc).toISOString(), '2026-11-02T06:30:00.000Z');
  // 매시 도는 식은 없는 시간을 건너뛰고 겹치지 않는다
  const h = findRuns(spec('0 * * * *'), NY, Date.parse('2026-03-08T05:30:00Z'), 3).runs.map((x) => wall(x.utc, NY));
  assert.deepEqual(h, ['2026-03-08 01:00', '2026-03-08 03:00', '2026-03-08 04:00']);
  // CRON_TZ 줄
  const z = spec('CRON_TZ=America/New_York\n0 9 * * *');
  assert.equal(z.tz!.name, NY);
  assert.equal(spec('CRON_TZ=Europe/London 0 9 * * *').tz!.name, 'Europe/London');
});

test('다른 형식으로 옮기기', () => {
  const all = (e: string) => (['unix', 'spring', 'quartz', 'aws'] as Dialect[]).map((d) => convert(spec(e), d).text ?? null);
  assert.deepEqual(all('0 9 * * 1-5'), ['0 9 * * 1-5', '0 0 9 * * MON-FRI', '0 0 9 ? * MON-FRI', 'cron(0 9 ? * MON-FRI *)']);
  assert.deepEqual(all('0 30 18 ? * 6L'), [null, '0 30 18 * * FRIL', '0 30 18 ? * 6L', 'cron(30 18 ? * 6L *)']);
  assert.deepEqual(all('cron(0 9 ? * MON-FRI *)'), ['0 9 * * 1-5', '0 0 9 * * MON-FRI', '0 0 9 ? * MON-FRI', 'cron(0 9 ? * MON-FRI *)']);
  assert.deepEqual(all('0 0 13 * 5'), ['0 0 13 * 5', null, null, null]);
  assert.deepEqual(all('0 0 22-2 ? * *'), ['0 22-23,0-2 * * *', '0 0 22-23,0-2 * * *', '0 0 22-2 ? * *', 'cron(0 22-2 * * ? *)']);
  assert.deepEqual(all('5/15 * * * *'), ['5/15 * * * *', '0 5/15 * * * *', '0 5/15 * * * ?', 'cron(5/15 * * * ? *)']);
  assert.equal(convert(spec('0 5/15 * * * *'), 'unix').text, '5-59/15 * * * *');
  assert.match(convert(spec('*/10 * * * * *'), 'unix').error!, /초 단위/);
  // 옮긴 식을 다시 읽으면 같은 날 같은 시각에 돈다
  for (const e of ['0 9 * * 1-5', '*/15 9-17 * * 1-5', '0 0 9 ? * 2#2', '0 0 0 L * ?', '30 4 1,15 * *']) {
    const s = spec(e);
    const want = findRuns(s, 'UTC', 0, 20).runs.map((r) => r.utc);
    for (const d of ['unix', 'spring', 'quartz', 'aws'] as Dialect[]) {
      const out = convert(s, d);
      if (!out.text) continue;
      assert.deepEqual(findRuns(spec(out.text, d), 'UTC', 0, 20).runs.map((r) => r.utc), want, `${e} → ${d}: ${out.text}`);
    }
  }
});

test('빌더: 말로 고른 일정 ↔ 식', () => {
  const P = (x: Partial<typeof defaultPlan>) => ({ ...defaultPlan, ...x });
  assert.equal(planText(P({ every: 'weekdays', hour: 9 }), 'unix').text, '0 9 * * 1-5');
  assert.equal(planText(P({ every: 'minutes', n: 10 }), 'unix').text, '*/10 * * * *');
  assert.equal(planText(P({ every: 'hours', n: 2, minute: 30 }), 'quartz').text, '0 30 */2 * * ?');
  assert.equal(planText(P({ every: 'weekly', days: [5, 1, 3], hour: 18, minute: 30 }), 'aws').text, 'cron(30 18 ? * MON,WED,FRI *)');
  assert.equal(planText(P({ every: 'monthly', monthMode: 'last' }), 'quartz').text, '0 0 9 L * ?');
  assert.equal(planText(P({ every: 'monthly', monthMode: 'nth', nth: 0, nthDay: 5 }), 'spring').text, '0 0 9 * * FRIL');
  assert.equal(planText(P({ every: 'yearly', month: 12, day: 25, hour: 0 }), 'unix').text, '0 0 25 12 *');
  assert.match(planText(P({ every: 'monthly', monthMode: 'nth', nth: 2, nthDay: 2 }), 'unix').error!, /8-14일에 돌리고/);
  assert.match(planText(P({ every: 'weekly', days: [] }), 'unix').error!, /요일을 하나 이상/);
  // 식에서 다시 고른 값으로
  assert.equal(planOf(spec('0 9 * * 1-5'))!.every, 'weekdays');
  assert.deepEqual(planOf(spec('30 18 * * 1,3,5'))!.days, [1, 3, 5]);
  assert.deepEqual(planOf(spec('0 30 18 ? * 6L')), P({ every: 'monthly', monthMode: 'nth', nth: 0, nthDay: 5, hour: 18, minute: 30 }));
  assert.equal(planOf(spec('*/15 9-17 * * *')), null);
  for (const e of ['0 9 * * *', '*/5 * * * *', '15 * * * *', '0 */3 * * *', '0 0 1 * *', '0 9 25 12 *', '* * * * *']) assert.equal(planText(planOf(spec(e))!, 'unix').text, e);
});

test('붙여 넣을 설정: GitHub Actions 는 UTC 로 옮긴다', () => {
  assert.deepEqual(toUtc(spec('0 9 * * 1-5'), 'Asia/Seoul').lines, ['0 0 * * 1-5']);
  // 오전 8시는 UTC 로 전날 23시: 요일도 하루 당긴다
  assert.deepEqual(toUtc(spec('0 8 * * 1-5'), 'Asia/Seoul').lines, ['0 23 * * 0-4']);
  // 날이 갈리면 두 줄
  assert.deepEqual(toUtc(spec('0 8,10 * * 1'), 'Asia/Seoul').lines, ['0 1 * * 1', '0 23 * * 0']);
  assert.deepEqual(toUtc(spec('0 0 22-2 ? * *'), 'Asia/Seoul').lines, ['0 13-17 * * *']);
  assert.match(toUtc(spec('0 3 1 * *'), 'Asia/Seoul').error!, /한 줄로 옮길 수 없습니다/);
  assert.match(toUtc(spec('0 9 * * *'), 'America/New_York', Date.UTC(2026, 6, 1)).note!, /UTC-4/);
  assert.match(toUtc(spec('0 9 * * *'), 'Asia/Kolkata').error!, /30분 단위/);
  const s = snippets(spec('0 9 * * 1-5'), 'Asia/Seoul');
  assert.deepEqual(s.map((x) => x.id), ['crontab', 'github', 'k8s', 'spring', 'aws']);
  assert.match(s[1].code!, /- cron: '0 0 \* \* 1-5'  # Asia\/Seoul 기준 평일 오전 9시/);
  assert.match(s[2].code!, /timeZone: "Asia\/Seoul"/);
  assert.match(s[3].code!, /@Scheduled\(cron = "0 0 9 \* \* MON-FRI", zone = "Asia\/Seoul"\)/);
  assert.match(snippets(spec('* * * * *'), 'UTC')[1].note!, /5분보다 짧은 간격/);
});

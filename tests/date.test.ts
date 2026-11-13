import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, dayOfYear, diffYmd, fmt, fromDay, iso, isoWeek, parseDate, toDay, weekday } from '../src/lib/date/core';
import { fromLunar, ganji, leapMonthOf, lunarMonths, newMoonJde, toLunar } from '../src/lib/date/lunar';
import { holidaysOf } from '../src/lib/date/holidays';
import { addWorkdays, between, defaultRules, fmtRange, holidaysIcs, nearestWorkday, offOf, parseCustom, yearSummary } from '../src/lib/date/work';
import { daySlots, findOverlap, fmtClock, fmtDiff, fmtOffset, utcOf, wallOf } from '../src/lib/date/zones';

const D = (s: string) => parseDate(s)!;

test('날짜 기본: 날 수 · 요일 · 읽기', () => {
  assert.equal(toDay(1970, 1, 1), 0);
  assert.deepEqual(fromDay(toDay(2024, 2, 29)), { y: 2024, m: 2, d: 29 });
  assert.equal(weekday(D('2026-11-13')), 5);
  assert.equal(weekday(toDay(1969, 12, 28)), 0);
  assert.equal(fmt(D('2026-11-13')), '2026년 11월 13일 (금)');
  for (const s of ['2026-11-13', '2026.11.13', '2026/11/13', '20261113', '2026년 11월 13일', '2026. 11. 13.', '2026-11-13 (금)']) assert.equal(iso(D(s)), '2026-11-13', s);
  assert.equal(iso(parseDate('11/13', 2026)!), '2026-11-13');
  assert.equal(iso(parseDate('3월 1일', 2027)!), '2027-03-01');
  for (const s of ['2026-02-30', '2025-02-29', '2026-13-01', '내일', '', '13']) assert.equal(parseDate(s), null, s);
  assert.equal(dayOfYear(D('2026-11-13')), 317);
  assert.deepEqual(isoWeek(D('2026-11-13')), { year: 2026, week: 46 });
  // 1월 1일이 금요일이면 앞 해의 53주
  assert.deepEqual(isoWeek(D('2021-01-01')), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek(D('2024-12-30')), { year: 2025, week: 1 });
});

test('달 더하기 · 년월일 차이', () => {
  assert.deepEqual([iso(addMonths(D('2026-01-31'), 1).day), addMonths(D('2026-01-31'), 1).clamped], ['2026-02-28', true]);
  assert.equal(iso(addMonths(D('2024-02-29'), 12).day), '2025-02-28');
  assert.equal(iso(addMonths(D('2026-03-15'), -4).day), '2025-11-15');
  assert.deepEqual(diffYmd(D('2026-11-13'), D('2026-12-25')), { years: 0, months: 1, days: 12 });
  assert.deepEqual(diffYmd(D('2020-02-29'), D('2026-02-28')), { years: 6, months: 0, days: 0 });
  assert.deepEqual(diffYmd(D('2026-01-31'), D('2026-03-01')), { years: 0, months: 1, days: 1 });
});

test('음력: 계산한 설 · 추석 · 부처님오신날이 실제 달력과 같다', () => {
  const table: [number, number, Record<number, string>][] = [
    [1, 1, { 2018: '02-16', 2019: '02-05', 2020: '01-25', 2021: '02-12', 2022: '02-01', 2023: '01-22', 2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-07', 2028: '01-27', 2029: '02-13', 2030: '02-03' }],
    [8, 15, { 2018: '09-24', 2019: '09-13', 2020: '10-01', 2021: '09-21', 2022: '09-10', 2023: '09-29', 2024: '09-17', 2025: '10-06', 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12' }],
    [4, 8, { 2020: '04-30', 2021: '05-19', 2022: '05-08', 2023: '05-27', 2024: '05-15', 2025: '05-05', 2026: '05-24', 2027: '05-13', 2028: '05-02', 2029: '05-20', 2030: '05-09' }],
  ];
  for (const [m, d, years] of table) for (const [y, md] of Object.entries(years)) assert.equal(iso(fromLunar(+y, m, d)!), `${y}-${md}`);
  // 2028년 설은 합삭이 한국 시각으로 자정을 13분 넘겨서 중국보다 하루 늦다
  const utc = new Date((newMoonJde(347) - 2440587.5) * 86400000).toISOString();
  assert.match(utc, /^2028-01-26T15:1/);
});

test('음력: 윤달 · 왕복 · 간지', () => {
  const leaps: Record<number, number> = { 2001: 4, 2004: 2, 2006: 7, 2009: 5, 2012: 3, 2014: 9, 2017: 5, 2020: 4, 2023: 2, 2025: 6, 2028: 5, 2031: 3, 2033: 11, 2036: 6, 2039: 5, 2042: 2, 2044: 7, 2047: 5, 2050: 3 };
  for (let y = 2000; y <= 2050; y++) assert.equal(leapMonthOf(y), leaps[y] ?? 0, `${y}년 윤달`);
  assert.deepEqual(toLunar(D('2026-11-13')), { year: 2026, month: 10, day: 5, leap: false, length: 30 });
  // 윤달: 2025년 윤6월 1일 = 7월 25일
  assert.equal(iso(fromLunar(2025, 6, 1, true)!), '2025-07-25');
  assert.equal(toLunar(D('2025-07-25')).leap, true);
  assert.equal(fromLunar(2026, 6, 1, true), null);
  assert.equal(fromLunar(2026, 13, 1), null);
  // 섣달 그믐은 양력으로 다음 해
  assert.deepEqual(toLunar(D('2026-02-16')), { year: 2025, month: 12, day: 29, leap: false, length: 29 });
  assert.equal(fromLunar(2025, 12, 30), null);
  for (let y = 1990; y <= 2060; y++) {
    const months = lunarMonths(y);
    assert.ok(months.length === 12 || months.length === 13);
    for (const m of months) assert.ok(m.end - m.start === 29 || m.end - m.start === 30);
  }
  for (let d = toDay(1990, 1, 1); d <= toDay(2060, 12, 31); d += 3) {
    const l = toLunar(d);
    assert.equal(fromLunar(l.year, l.month, l.day, l.leap), d);
  }
  assert.deepEqual(ganji(2026), { name: '병오', animal: '말' });
  assert.deepEqual(ganji(2024), { name: '갑진', animal: '용' });
});

test('공휴일과 대체공휴일', () => {
  const extra = (y: number) => holidaysOf(y).filter((h) => h.kind !== 'holiday').map((h) => `${iso(h.day).slice(5)} ${h.name}`);
  assert.deepEqual(extra(2020), ['01-27 대체공휴일 (설날)', '04-15 국회의원 선거', '05-01 근로자의 날', '08-17 임시공휴일']);
  // 2021년부터 국경일도 주말과 겹치면 대체한다. 성탄절은 2023년부터라 이 해에는 없다
  assert.deepEqual(extra(2021), ['05-01 근로자의 날', '08-16 대체공휴일 (광복절)', '10-04 대체공휴일 (개천절)', '10-11 대체공휴일 (한글날)']);
  assert.deepEqual(extra(2023), ['01-24 대체공휴일 (설날)', '05-01 근로자의 날', '05-29 대체공휴일 (부처님오신날)', '10-02 임시공휴일']);
  // 어린이날과 부처님오신날이 같은 날: 대체공휴일은 하루만
  assert.deepEqual(extra(2025), ['01-27 임시공휴일', '03-03 대체공휴일 (삼일절)', '05-01 근로자의 날', '05-06 대체공휴일 (어린이날)', '06-03 대통령 선거', '10-08 대체공휴일 (추석)']);
  assert.equal(holidaysOf(2025).find((h) => iso(h.day) === '2025-05-05')!.name, '어린이날 · 부처님오신날');
  assert.deepEqual(extra(2026), ['03-02 대체공휴일 (삼일절)', '05-01 노동절', '05-25 대체공휴일 (부처님오신날)', '06-03 지방선거', '08-17 대체공휴일 (광복절)', '10-05 대체공휴일 (개천절)']);
  // 추석 연휴가 개천절과 겹친다: 연휴가 끝난 다음 날
  assert.deepEqual(extra(2028), ['04-12 국회의원 선거', '05-01 노동절', '10-05 대체공휴일 (추석)']);
  // 설 · 추석은 토요일과 겹쳐도 대체하지 않는다 (2022년 추석: 금 · 토 · 일 → 월요일 하루)
  assert.deepEqual(extra(2022).filter((x) => x.includes('추석')), ['09-12 대체공휴일 (추석)']);
  // 대체공휴일 제도 전
  assert.deepEqual(extra(2013), ['05-01 근로자의 날']);
  // 제헌절 · 한글날 · 식목일은 해에 따라 다르다
  const has = (y: number, name: string) => holidaysOf(y).some((h) => h.name.includes(name));
  assert.deepEqual([has(2007, '제헌절'), has(2008, '제헌절'), has(2025, '제헌절'), has(2026, '제헌절')], [true, false, false, true]);
  assert.deepEqual([has(2012, '한글날'), has(2013, '한글날'), has(2005, '식목일'), has(2006, '식목일')], [false, true, true, false]);
  assert.equal(holidaysOf(2026, false).some((h) => h.kind === 'labor'), false);
  assert.equal(holidaysOf(2026).length, 22);
});

test('근무일: 사이 세기', () => {
  const r = defaultRules;
  // 금요일 → 다음 금요일: 7일, 근무일 5일
  assert.deepEqual(between(D('2026-11-13'), D('2026-11-20'), r), { sign: 1, days: 7, work: 5, weekend: 2, holidays: [] });
  assert.deepEqual(between(D('2026-11-13'), D('2026-11-20'), r, true), { sign: 1, days: 8, work: 6, weekend: 2, holidays: [] });
  assert.equal(between(D('2026-11-13'), D('2026-11-13'), r).days, 0);
  assert.equal(between(D('2026-11-13'), D('2026-11-13'), r, true).work, 1);
  // 성탄절과 신정이 평일에 걸린다
  const b = between(D('2026-12-21'), D('2027-01-04'), r);
  assert.deepEqual([b.days, b.work, b.weekend, b.holidays.map((h) => h.name)], [14, 8, 4, ['성탄절', '신정']]);
  // 거꾸로 넣으면 부호만 바뀐다
  const back = between(D('2027-01-04'), D('2026-12-21'), r);
  assert.deepEqual([back.sign, back.days, back.work], [-1, 14, 8]);
  // 주말과 겹친 공휴일은 주말로 센다 (2026-08-15 토)
  const aug = between(D('2026-08-13'), D('2026-08-18'), r);
  assert.deepEqual([aug.work, aug.weekend, aug.holidays.map((h) => h.name)], [2, 2, ['대체공휴일 (광복절)']]);
  // 토요일도 일하는 곳
  assert.equal(between(D('2026-11-13'), D('2026-11-20'), { ...r, sat: false }).work, 6);
  assert.equal(between(D('2026-04-30'), D('2026-05-01'), { ...r, labor: false }).work, 1);
  assert.equal(between(D('2026-04-30'), D('2026-05-01'), { ...r, holidays: false }).work, 0);
});

test('근무일: 며칠 뒤 · 며칠 전', () => {
  const r = defaultRules;
  const moved = addWorkdays(D('2026-11-13'), 10, r);
  assert.equal(iso(moved.day), '2026-11-27');
  assert.equal(moved.skipped.length, 4);
  // 설 연휴를 건너뛴다 (2026-02-13 금 + 3 근무일 = 2/23 월)
  const seol = addWorkdays(D('2026-02-13'), 3, r);
  assert.equal(iso(seol.day), '2026-02-23');
  assert.deepEqual(seol.skipped.filter((s) => s.kind === 'holiday').map((s) => s.name), ['설날 연휴', '설날', '설날 연휴']);
  assert.equal(iso(addWorkdays(D('2026-02-23'), -3, r).day), '2026-02-13');
  assert.equal(iso(addWorkdays(D('2026-11-14'), 0, r).day), '2026-11-14');
  // 사이 세기와 서로 맞는다
  for (const n of [1, 7, 30, 250]) {
    const end = addWorkdays(D('2026-01-02'), n, r).day;
    assert.equal(between(D('2026-01-02'), end, r).work, n);
  }
  assert.equal(iso(nearestWorkday(D('2026-11-14'), r)), '2026-11-16');
  assert.equal(iso(nearestWorkday(D('2026-11-14'), r, -1)), '2026-11-13');
  assert.equal(offOf(D('2026-11-14'), r)!.name, '토요일');
  assert.equal(offOf(D('2026-11-13'), r), null);
});

test('회사가 쉬는 날', () => {
  const { list, bad } = parseCustom('2026-12-31 종무식\n11/2 창립기념일\n\n3월 3일\n13/40 없는 날\n그냥 글');
  assert.deepEqual(list, [
    { year: 2026, month: 12, date: 31, name: '종무식' },
    { year: null, month: 11, date: 2, name: '창립기념일' },
    { year: null, month: 3, date: 3, name: '쉬는 날' },
  ]);
  assert.deepEqual(bad, ['13/40 없는 날', '그냥 글']);
  const r = { ...defaultRules, custom: list };
  assert.deepEqual(offOf(D('2026-12-31'), r), { name: '종무식', kind: 'custom' });
  assert.equal(offOf(D('2027-12-31'), r), null);
  assert.equal(offOf(D('2027-11-02'), r)!.name, '창립기념일');
  assert.equal(between(D('2026-12-28'), D('2026-12-31'), r).work, 2);
});

test('한 해: 달마다 근무일 · 연휴 · 연차 붙이기 좋은 날', () => {
  const s = yearSummary(2026, defaultRules);
  assert.equal(s.monthWork.length, 12);
  assert.equal(s.work, s.monthWork.reduce((a, b) => a + b, 0));
  assert.equal(s.monthWork[10], 21);
  assert.equal(s.monthWork[1], 17);
  // 설 연휴: 토 · 일 · 월 · 화 · 수
  const seol = s.runs.find((r) => r.names.includes('설날'))!;
  assert.deepEqual([fmtRange(seol.from, seol.to), seol.days], ['2월 14일 (토) ~ 18일 (수)', 5]);
  // 추석(목 · 금 · 토) 다음 주 금요일 한글날: 그 사이는 나흘이라 다리를 놓을 수 없다. 대신 설 뒤 목 · 금 이틀이면 9일
  const feb = s.bridges.find((b) => b.names.includes('설날'))!;
  assert.deepEqual([feb.leave.map(iso), feb.days], [['2026-02-19', '2026-02-20'], 9]);
  // 현충일(토)은 대체가 없다. 지방선거(수)는 양쪽에 이틀씩
  assert.equal(s.bridges.filter((b) => b.names.includes('지방선거')).length, 2);
  for (const b of s.bridges) assert.ok(b.leave.length <= 2 && b.days >= 4);
  assert.equal(fmtRange(D('2026-09-30'), D('2026-10-04')), '9월 30일 (수) ~ 10월 4일 (일)');
});

test('공휴일 달력 파일', () => {
  const ics = holidaysIcs(holidaysOf(2026).slice(0, 2), new Date(Date.UTC(2026, 10, 13, 1, 2, 3)));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102\r\nSUMMARY:신정\r\n'));
  assert.ok(ics.includes('DTSTAMP:20261113T010203Z'));
  assert.equal(ics.match(/BEGIN:VEVENT/g)!.length, 2);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('시간대: 벽시계 ↔ 절대 시각, 서머타임', () => {
  const utc = utcOf('Asia/Seoul', 2026, 11, 13, 10, 0);
  assert.equal(new Date(utc).toISOString(), '2026-11-13T01:00:00.000Z');
  const ny = wallOf('America/New_York', utc);
  assert.deepEqual([ny.m, ny.d, ny.h, ny.mi, ny.wd, ny.offset], [11, 12, 20, 0, 4, -300]);
  assert.equal(wallOf('America/New_York', utcOf('Asia/Seoul', 2026, 7, 1, 10)).offset, -240);
  assert.equal(wallOf('Asia/Kolkata', utc).offset, 330);
  // 벽시계 → 절대 시각 → 벽시계
  for (const tz of ['Asia/Seoul', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Australia/Sydney', 'UTC']) {
    const w = wallOf(tz, utcOf(tz, 2026, 6, 15, 9, 30));
    assert.deepEqual([w.y, w.m, w.d, w.h, w.mi], [2026, 6, 15, 9, 30], tz);
  }
  // 서머타임이 시작하는 날 뉴욕의 하루는 23시간
  assert.equal(daySlots(['America/New_York'], 2026, 3, 8, { from: 540, to: 1080 }).length, 46);
  assert.deepEqual([fmtOffset(540), fmtOffset(-300), fmtOffset(330)], ['+9', '−5', '+5:30']);
  assert.deepEqual([fmtDiff(0), fmtDiff(-840), fmtDiff(60), fmtDiff(-210)], ['같은 시각', '14시간 늦음', '1시간 빠름', '3시간 30분 늦음']);
  assert.deepEqual([fmtClock(0, 0), fmtClock(9, 30), fmtClock(12, 0), fmtClock(20, 5)], ['오전 12:00', '오전 9:30', '오후 12:00', '오후 8:05']);
});

test('시간대: 겹치는 근무 시간', () => {
  const hours = { from: 9 * 60, to: 18 * 60 };
  // 서울과 싱가포르 (1시간 차이): 서울 10시~18시
  const sg = findOverlap(daySlots(['Asia/Seoul', 'Asia/Singapore'], 2026, 11, 13, hours));
  assert.deepEqual(sg, { kind: 'all', spans: [{ from: 20, to: 36 }] });
  // 서울과 런던 (겨울 9시간): 서울 18시가 런던 9시라 겹치지 않는다. 모두 깨어 있는 때 가운데 한쪽이 근무 중인 때
  const slots = daySlots(['Asia/Seoul', 'Europe/London'], 2026, 11, 13, hours);
  const ldn = findOverlap(slots);
  assert.equal(ldn.kind, 'awake');
  assert.deepEqual(ldn.spans, [{ from: 32, to: 44 }]);
  assert.deepEqual(slots[32].states, ['work', 'awake']);
  assert.deepEqual(slots[36].states, ['awake', 'work']);
  // 서울 · 뉴욕 · 런던: 서울 밤 9시(뉴욕 아침 7시, 런던 낮 12시)부터 한 시간만 셋 다 깨어 있다
  assert.deepEqual(findOverlap(daySlots(['Asia/Seoul', 'America/New_York', 'Europe/London'], 2026, 11, 13, hours)), { kind: 'awake', spans: [{ from: 42, to: 44 }] });
  // 서울 · 런던 · 로스앤젤레스: 누군가는 한밤중
  assert.deepEqual(findOverlap(daySlots(['Asia/Seoul', 'Europe/London', 'America/Los_Angeles'], 2026, 11, 13, hours)), { kind: 'none', spans: [] });
  // 토요일에는 근무 시간이 없다
  assert.equal(findOverlap(daySlots(['Asia/Seoul', 'Asia/Tokyo'], 2026, 11, 14, hours)).kind, 'awake');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualFor, care, childCredit, employerCost, health, incomeTax, monthly, pension, smeReduction, tableRow, tableTax, type Input } from '../src/lib/pay/core';
import { parseDate, retirementTax, serviceYears, severance } from '../src/lib/pay/severance';
import { hourly } from '../src/lib/pay/hourly';
import { grossFor, withhold } from '../src/lib/pay/withhold';

const rows = readFileSync(new URL('./fixtures/ganyi-2026.csv', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.split(',').map(Number));

test('간이세액표: 2026. 2. 27. 개정 표의 모든 칸 (646줄 × 11명)과 같다', () => {
  let bad: string[] = [];
  for (const [lo, hi, ...cells] of rows) {
    const mid = ((lo + hi) / 2) * 1000;
    assert.deepEqual(tableRow(lo * 1000), [lo * 1000, hi * 1000], `${lo}`);
    assert.deepEqual(tableRow(hi * 1000 - 1), [lo * 1000, hi * 1000], `${lo}`);
    cells.forEach((v, k) => {
      const got = tableTax(mid, k + 1);
      if (got !== v) bad.push(`${lo}~${hi}천 ${k + 1}명: 표 ${v} 계산 ${got}`);
      // 줄 안 어디서든 같은 값
      assert.equal(tableTax(lo * 1000, k + 1), got);
    });
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('간이세액표: 1,000만 원 줄과 그 위 구간', () => {
  assert.deepEqual([1, 2, 3, 4, 11].map((n) => tableTax(10_000_000, n)), [1_507_400, 1_431_570, 1_200_840, 1_170_840, 960_840]);
  // 1,500만 원: 1,000만 원 줄 + 1,397,000 + (1,400만 초과분 × 98% × 38%)
  assert.equal(tableTax(15_000_000, 1), 1_507_400 + 1_397_000 + 372_400);
  assert.equal(tableTax(15_000_000, 1), 3_276_800);
  assert.equal(tableTax(12_000_000, 1), 1_507_400 + 25_000 + 686_000);
  assert.equal(tableTax(769_999, 1), 0);
  // 가족 12명: 11명 − (10명 − 11명) × 1
  assert.equal(tableTax(10_000_000, 12), 960_840 - 30_000);
});

test('자녀 공제 · 원천징수 비율', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(childCredit), [0, 20_830, 45_830, 79_160, 112_490]);
  assert.equal(incomeTax(3_000_000, 3, 1), 31_940 - 20_830);
  assert.equal(incomeTax(3_000_000, 4, 2), 0);
  assert.equal(incomeTax(5_000_000, 4, 2), 173_270);
  assert.equal(incomeTax(3_000_000, 1, 0, 0.8), 59_480);
  assert.equal(incomeTax(3_000_000, 1, 0, 1.2), 89_220);
});

test('4대 보험: 2026년 요율, 상한 · 하한, 10원 미만 버림', () => {
  assert.equal(pension(3_000_000, '2026-11'), 142_500);
  assert.equal(pension(3_456_789, '2026-11'), 164_160); // 3,456,000 × 4.75% = 164,160
  assert.equal(pension(9_000_000, '2026-11'), 313_020); // 상한 659만
  assert.equal(pension(9_000_000, '2026-03'), 302_570); // 상반기 상한 637만
  assert.equal(pension(300_000, '2026-11'), 19_470); // 하한 41만
  assert.equal(health(3_000_000), 107_850);
  assert.equal(care(107_850), 14_170);
  assert.equal(health(200_000_000), 4_591_740);
});

const base: Omit<Input, 'annual'> = { severanceIncluded: false, nonTax: 200_000, family: 1, children: 0, ratio: 1, month: '2026-11' };

test('한 달 실수령액: 연봉 4,000만 원, 식대 20만 원, 혼자', () => {
  const r = monthly({ ...base, annual: 40_000_000 });
  assert.equal(r.gross, 3_333_333);
  assert.equal(r.taxable, 3_133_333);
  assert.equal(r.pension, 148_810); // 3,133,000 × 4.75%
  assert.equal(r.health, 112_640);
  assert.equal(r.employment, 28_190);
  assert.equal(r.incomeTax, tableTax(3_133_333, 1));
  assert.equal(r.localTax, Math.floor(r.incomeTax / 100) * 10);
  assert.equal(r.net, r.gross - r.pension - r.health - r.care - r.employment - r.incomeTax - r.localTax);
});

test('거꾸로: 실수령액에서 연봉', () => {
  for (const target of [2_500_000, 3_000_000, 4_200_000, 7_000_000]) {
    const a = annualFor(target, base)!;
    assert.ok(monthly({ ...base, annual: a }).net >= target, `${target}`);
    assert.ok(monthly({ ...base, annual: a - 10_000 }).net < target, `${target} 더 작은 연봉`);
    assert.equal(a % 10_000, 0);
  }
  assert.equal(annualFor(0, base), null);
});

test('중소기업 취업자 감면: 청년 90%, 한 달 한도는 연 200만 원의 1/12', () => {
  const r = monthly({ ...base, annual: 40_000_000, sme: 'youth' });
  const full = monthly({ ...base, annual: 40_000_000 });
  assert.equal(r.smeCut, Math.floor((full.incomeTax * 0.9) / 10) * 10);
  assert.equal(r.incomeTax, full.incomeTax - r.smeCut);
  assert.equal(r.localTax, Math.floor(r.incomeTax / 100) * 10);
  // 연봉이 높으면 한 달 166,660원까지만
  assert.equal(monthly({ ...base, annual: 120_000_000, sme: 'youth' }).smeCut, 166_660);
  assert.equal(smeReduction(100_000, 'other'), 70_000);
  assert.equal(smeReduction(100_000, ''), 0);
});

test('회사가 쓰는 돈: 회사 몫 보험료 + 고용안정 + 산재 + 퇴직금 적립', () => {
  const r = monthly({ ...base, annual: 48_000_000 });
  const e = employerCost(r, base, 0.0025, 0.0147);
  assert.equal(e.pension, r.pension);
  assert.equal(e.stability, Math.floor((r.taxable * 0.0025) / 10) * 10);
  assert.equal(e.accident, Math.floor((r.taxable * 0.0147) / 10) * 10);
  assert.equal(e.severance, Math.floor(4_000_000 / 12));
  assert.equal(e.total, r.gross + e.insurance + e.severance);
  assert.equal(employerCost(r, { noEmployment: true }, 0.0025, 0).employment, 0);
});

test('퇴직소득세: 퇴직금 5,000만 원 · 10년이면 68만 원 + 지방 6만 8천 원', () => {
  const t = retirementTax(50_000_000, 10);
  assert.equal(t.serviceDeduction, 15_000_000);
  assert.equal(t.converted, 42_000_000);
  assert.equal(t.convertedDeduction, 28_400_000);
  assert.equal(t.base, 13_600_000);
  assert.equal(t.incomeTax, 680_000);
  assert.equal(t.total, 748_000);
  assert.equal(retirementTax(100_000_000, 10).total, 3_875_000 + 387_500);
  // 300만 원 · 1년: 공제 100만 → 환산 2,400만 − 공제 1,760만 = 640만 × 6% = 38.4만 ÷ 12 = 3.2만
  assert.equal(retirementTax(3_000_000, 1).total, 35_200);
  assert.equal(retirementTax(1_000_000, 1).total, 0);
});

test('퇴직금: 평균임금 × 30 × 재직일수 ÷ 365, 1년 미만은 없음', () => {
  assert.equal(serviceYears(parseDate('2020-03-02')!, parseDate('2025-03-02')!), 5);
  assert.equal(serviceYears(parseDate('2020-03-02')!, parseDate('2025-03-03')!), 6);
  const s = severance({ start: '2021-01-04', last: '2026-10-31', monthly: 3_500_000, bonus: 0, leave: 0 })!;
  assert.equal(s.periodDays, 92); // 8. 1. ~ 10. 31.
  assert.equal(s.days, 2127);
  assert.equal(s.pay, Math.floor(((10_500_000 / 92) * 30 * 2127) / 365));
  assert.equal(s.tax.years, 6);
  const short = severance({ start: '2026-01-01', last: '2026-12-30', monthly: 3_000_000, bonus: 0, leave: 0 })!;
  assert.equal(short.days, 364);
  assert.equal(short.pay, 0);
  assert.equal(severance({ start: '2026-01-01', last: '2026-12-31', monthly: 3_000_000, bonus: 0, leave: 0 })!.eligible, true);
  // 상여 · 연차수당은 3/12
  const b = severance({ start: '2021-01-04', last: '2026-10-31', monthly: 3_500_000, bonus: 4_000_000, leave: 400_000 })!;
  assert.equal(b.wages, 10_500_000 + 1_000_000 + 100_000);
  assert.equal(severance({ start: '2026-02-30', last: '2026-10-31', monthly: 1, bonus: 0, leave: 0 }), null);
});

test('시급: 주휴 · 연장 · 야간, 주 40시간이면 월 209시간', () => {
  const h = hourly({ wage: 10_320, hoursPerDay: 8, daysPerWeek: 5, nightPerWeek: 0, five: true });
  assert.equal(h.holiday, 82_560);
  assert.equal(h.monthHours, 209);
  assert.equal(h.monthly, 2_156_880);
  const short = hourly({ wage: 12_000, hoursPerDay: 4, daysPerWeek: 3, nightPerWeek: 0, five: true });
  assert.equal(short.holidayOk, false);
  assert.equal(short.weekly, 144_000);
  // 하루 10시간 × 5일: 소정 40 + 연장 10, 야간 4
  const long = hourly({ wage: 10_000, hoursPerDay: 10, daysPerWeek: 5, nightPerWeek: 4, five: true });
  assert.equal(long.overtimeHours, 10);
  assert.equal(long.weekly, 500_000 + 50_000 + 20_000 + 80_000);
  assert.equal(hourly({ wage: 10_000, hoursPerDay: 10, daysPerWeek: 5, nightPerWeek: 4, five: false }).weekly, 500_000 + 80_000);
  // 주 20시간이면 주휴 4시간
  assert.equal(hourly({ wage: 10_000, hoursPerDay: 4, daysPerWeek: 5, nightPerWeek: 0, five: true }).holiday, 40_000);
});

test('원천징수 3.3% · 8.8% 와 거꾸로', () => {
  assert.deepEqual(withhold(1_000_000, 'business'), { gross: 1_000_000, incomeTax: 30_000, localTax: 3_000, net: 967_000 });
  assert.deepEqual(withhold(1_000_000, 'other'), { gross: 1_000_000, incomeTax: 80_000, localTax: 8_000, net: 912_000 });
  assert.equal(withhold(125_000, 'other').incomeTax, 0);
  assert.equal(withhold(125_010, 'other').incomeTax, 10_000);
  for (const kind of ['business', 'other'] as const)
    for (const n of [1, 99_999, 500_000, 967_000, 1_000_000, 12_345_678]) {
      const g = grossFor(n, kind);
      assert.ok(withhold(g, kind).net >= n, `${kind} ${n}`);
      for (let k = 1; k <= 30; k++) assert.ok(withhold(g - k, kind).net < n, `${kind} ${n} 더 작은 ${g - k}`);
    }
});

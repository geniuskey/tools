import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annualFor, care, childCredit, health, incomeTax, monthly, pension, tableRow, tableTax, type Input } from '../src/lib/pay/core';

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

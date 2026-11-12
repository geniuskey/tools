import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, formatNumber, toPlain, CalcError, type AngleUnit } from '../src/lib/calc/engine';
import { evaluateProg, formatBase } from '../src/lib/calc/programmer';

const ev = (s: string, angle: AngleUnit = 'deg') => toPlain(evaluate(s, { angle, ans: null }));

test('기본 연산과 정밀도', () => {
  assert.equal(ev('0.1 + 0.2'), '0.3');
  assert.equal(ev('1/3*3'), '1');
  assert.equal(ev('2 + 3 × 4'), '14');
  assert.equal(ev('(2 + 3) × 4'), '20');
  assert.equal(ev('10 ÷ 4'), '2.5');
  assert.equal(ev('1,234,567 + 1'), '1234568');
  assert.equal(ev('2^100'), '1267650600228229401496703205376');
  assert.equal(ev('9007199254740993 + 1'), '9007199254740994');
  assert.equal(ev('1e3 + 1'), '1001');
  assert.equal(ev('.5 + .5'), '1');
});

test('우선순위와 결합', () => {
  assert.equal(ev('-2^2'), '-4');
  assert.equal(ev('2^3^2'), '512');
  assert.equal(ev('2^-2'), '0.25');
  assert.equal(ev('2--3'), '5');
  assert.equal(ev('6/2(1+2)'), '9');
  assert.equal(ev('10 mod 3'), '1');
  assert.equal(ev('5!'), '120');
  assert.equal(ev('3!!'), '720');
});

test('퍼센트', () => {
  assert.equal(ev('200 + 10%'), '220');
  assert.equal(ev('200 - 10%'), '180');
  assert.equal(ev('200 × 10%'), '20');
  assert.equal(ev('50%'), '0.5');
  assert.equal(ev('100 + 10% + 10%'), '121');
});

test('함수와 상수', () => {
  assert.equal(ev('sin(30)'), '0.5');
  assert.equal(ev('cos(60)'), '0.5');
  assert.equal(ev('sin(180)'), '0');
  assert.equal(ev('sin(pi)', 'rad'), '0');
  assert.equal(ev('tan(45)'), '1');
  assert.equal(ev('asin(1)'), '90');
  assert.equal(ev('√16'), '4');
  assert.equal(ev('sqrt(2)^2'), '2');
  assert.equal(ev('2π', 'rad').slice(0, 10), '6.28318530');
  assert.equal(ev('ln(e)'), '1');
  assert.equal(ev('log(1000)'), '3');
  assert.equal(ev('log(8, 2)'), '3');
  assert.equal(ev('log2(1024)'), '10');
  assert.equal(ev('cbrt(-27)'), '-3');
  assert.equal(ev('(-8)^(1/3)'), '-2');
  assert.equal(ev('ncr(5, 2)'), '10');
  assert.equal(ev('npr(5, 2)'), '20');
  assert.equal(ev('gcd(12, 18)'), '6');
  assert.equal(ev('max(1, 5, 3)'), '5');
  assert.equal(ev('round(2.5)'), '3');
  assert.equal(ev('round(3.14159, 2)'), '3.14');
  assert.equal(ev('2sin(30)'), '1');
  assert.equal(ev('3²'), '9');
  assert.equal(ev('(1+2'), '3');
});

test('오류', () => {
  for (const s of ['1/0', 'tan(90)', 'sqrt(-1)', '2 +', 'foo(1)', '1 2', ')', 'ln(0)', '(-8)^0.5', '']) {
    assert.throws(() => ev(s), CalcError, s);
  }
});

test('표시 형식', () => {
  const f = (s: string) => formatNumber(evaluate(s, { angle: 'deg' }));
  assert.equal(f('1234567.891'), '1,234,567.891');
  assert.equal(f('-1234.5'), '-1,234.5');
  assert.equal(f('1/3'), '0.33333333333333333333');
  assert.equal(f('10^40'), '1e40');
  assert.equal(f('1/10^12'), '1e-12');
  assert.equal(f('100!').startsWith('9.3326215443'), true);
  assert.equal(f('0.000001'), '0.000001');
});

test('프로그래머 모드', () => {
  const c = { base: 10 as const, bits: 32 as const, signed: true };
  assert.equal(evaluateProg('1 << 4', c), 16n);
  assert.equal(evaluateProg('0xFF & 0b1010', c), 10n);
  assert.equal(evaluateProg('~0', c), -1n);
  assert.equal(evaluateProg('2147483647 + 1', c), -2147483648n);
  assert.equal(evaluateProg('7 / 2', c), 3n);
  assert.equal(evaluateProg('-7 % 3', c), -1n);
  assert.equal(evaluateProg('1 | 2 ^ 3 & 4', c), 3n);
  assert.equal(evaluateProg('5 xor 1', c), 4n);
  assert.equal(evaluateProg('-8 >> 1', c), -4n);
  const u = { base: 16 as const, bits: 8 as const, signed: false };
  assert.equal(evaluateProg('FF + 1', u), 0n);
  assert.equal(evaluateProg('F0 >> 4', u), 15n);
  assert.equal(evaluateProg('~0', u), 255n);
  assert.equal(evaluateProg('BEEF and FF', { ...u, bits: 16 }), 0xefn);
  assert.equal(formatBase(-1n, 16, c), 'FFFF FFFF');
  assert.equal(formatBase(10n, 2, c), '1010');
  assert.equal(formatBase(-1n, 10, c), '-1');
  assert.equal(formatBase(1234567n, 10, c), '1,234,567');
  assert.throws(() => evaluateProg('1/0', c), CalcError);
  assert.throws(() => evaluateProg('9', { ...c, base: 8 }), CalcError);
});

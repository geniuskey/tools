// 프로그래머 계산기 엔진. BigInt 로 계산하고 워드 크기에 맞춰 2의 보수로 감싼다.
import { CalcError } from './engine';

export type Base = 2 | 8 | 10 | 16;
export type WordSize = 8 | 16 | 32 | 64;

export interface ProgContext {
  base: Base;
  bits: WordSize;
  signed: boolean;
}

/** 워드 크기로 자르고 (signed 면) 부호 있는 값으로 해석한다. */
export function wrap(v: bigint, ctx: Pick<ProgContext, 'bits' | 'signed'>): bigint {
  return ctx.signed ? BigInt.asIntN(ctx.bits, v) : BigInt.asUintN(ctx.bits, v);
}

type Tok = { t: 'num'; v: bigint } | { t: 'op'; v: string } | { t: 'end' };

const WORD_OPS: Record<string, string> = {
  and: '&',
  or: '|',
  xor: '^',
  not: '~',
  mod: '%',
  shl: '<<',
  shr: '>>',
  lsh: '<<',
  rsh: '>>',
};

const DIGITS = '0123456789abcdef';

function tokenize(src: string, base: Base): Tok[] {
  const s = src.toLowerCase().replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[\s_,]/.test(c)) {
      i++;
      continue;
    }
    // 접두사가 붙은 수는 현재 진법과 무관하게 읽는다
    const pm = /^0([xbo])([0-9a-f]+)/.exec(s.slice(i));
    if (pm && !(base === 16 && pm[1] === 'b')) {
      const b = pm[1] === 'x' ? 16 : pm[1] === 'b' ? 2 : 8;
      out.push({ t: 'num', v: parseDigits(pm[2], b) });
      i += pm[0].length;
      continue;
    }
    // 연산 키워드 (16진수 숫자와 겹치지 않는 것만 먼저 본다: and/or/xor/not/mod/shl/shr)
    const wm = /^(and|or|xor|not|mod|shl|shr|lsh|rsh)(?![0-9a-z])/.exec(s.slice(i));
    if (wm && !(base === 16 && /^[0-9a-f]+$/.test(wm[1]) && false)) {
      out.push({ t: 'op', v: WORD_OPS[wm[1]] });
      i += wm[0].length;
      continue;
    }
    if (DIGITS.slice(0, base).includes(c)) {
      let j = i;
      while (j < s.length && (DIGITS.slice(0, base).includes(s[j]) || s[j] === '_')) j++;
      out.push({ t: 'num', v: parseDigits(s.slice(i, j).replace(/_/g, ''), base) });
      i = j;
      continue;
    }
    if (s.startsWith('<<', i) || s.startsWith('>>', i)) {
      out.push({ t: 'op', v: s.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (DIGITS.includes(c)) throw new CalcError(`${base}진수에서 쓸 수 없는 숫자: ${src[i].toUpperCase()}`);
    throw new CalcError(`알 수 없는 문자: ${src[i]}`);
  }
  out.push({ t: 'end' });
  return out;
}

function parseDigits(s: string, base: number): bigint {
  let v = 0n;
  const b = BigInt(base);
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new CalcError(`${base}진수에서 쓸 수 없는 숫자: ${ch.toUpperCase()}`);
    v = v * b + BigInt(d);
  }
  return v;
}

// C 와 같은 우선순위: |  <  ^  <  &  <  << >>  <  + -  <  * / %  <  단항
const LEVELS: string[][] = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

export function evaluateProg(expr: string, ctx: ProgContext): bigint {
  const toks = tokenize(expr, ctx.base);
  let pos = 0;
  const peek = () => toks[pos];
  const w = (v: bigint) => wrap(v, ctx);

  function binary(level: number): bigint {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || !LEVELS[level].includes(t.v)) break;
      pos++;
      const right = binary(level + 1);
      left = w(apply(t.v, left, right));
    }
    return left;
  }

  function apply(op: string, a: bigint, b: bigint): bigint {
    switch (op) {
      case '|':
        return a | b;
      case '^':
        return a ^ b;
      case '&':
        return a & b;
      case '<<':
      case '>>': {
        if (b < 0n) throw new CalcError('시프트 양은 0 이상이어야 합니다');
        if (b >= BigInt(ctx.bits)) return op === '<<' ? 0n : ctx.signed && a < 0n ? -1n : 0n;
        // 부호 없는 모드에서는 논리 시프트, 부호 있는 모드에서는 산술 시프트
        return op === '<<' ? a << b : a >> b;
      }
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        if (b === 0n) throw new CalcError('0 으로 나눌 수 없습니다');
        return a / b;
      case '%':
        if (b === 0n) throw new CalcError('0 으로 나눌 수 없습니다');
        return a % b;
    }
    throw new CalcError('수식이 올바르지 않습니다');
  }

  function unary(): bigint {
    const t = peek();
    if (t.t === 'op') {
      if (t.v === '-') {
        pos++;
        return w(-unary());
      }
      if (t.v === '+') {
        pos++;
        return unary();
      }
      if (t.v === '~') {
        pos++;
        return w(~unary());
      }
      if (t.v === '(') {
        pos++;
        const v = binary(0);
        const c = peek();
        if (c.t === 'op' && c.v === ')') pos++;
        else if (c.t !== 'end') throw new CalcError('닫는 괄호가 없습니다');
        return v;
      }
    }
    if (t.t === 'num') {
      pos++;
      return w(t.v);
    }
    if (t.t === 'end') throw new CalcError('수식이 끝나지 않았습니다');
    throw new CalcError('수식이 올바르지 않습니다');
  }

  if (peek().t === 'end') throw new CalcError('수식을 입력하세요');
  const v = binary(0);
  if (peek().t !== 'end') throw new CalcError('수식이 올바르지 않습니다');
  return w(v);
}

/** 해당 진법 문자열. 10진수가 아니면 비트 패턴(2의 보수) 그대로 보여준다. */
export function formatBase(v: bigint, base: Base, ctx: Pick<ProgContext, 'bits' | 'signed'>, grouped = true): string {
  if (base === 10) {
    const s = wrap(v, ctx).toString(10);
    return grouped ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
  }
  const s = BigInt.asUintN(ctx.bits, v).toString(base).toUpperCase();
  if (!grouped) return s;
  const size = base === 8 ? 3 : 4;
  const padded = base === 2 ? s.padStart(Math.ceil(s.length / 4) * 4, '0') : s;
  return padded.replace(new RegExp(`\\B(?=(.{${size}})+(?!.))`, 'g'), ' ');
}

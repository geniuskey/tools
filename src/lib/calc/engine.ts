// 수식 계산 엔진. eval 을 쓰지 않고 직접 파싱하며, 모든 수는 임의 정밀도 10진수(Decimal)로 다룬다.
import DecimalJs from 'decimal.js';

// 계산은 50자리로 하고, 결과는 34자리로 반올림해 내부 오차를 숨긴다.
export const Decimal = DecimalJs.clone({ precision: 50, toExpNeg: -9e15, toExpPos: 9e15 });
export type Dec = InstanceType<typeof Decimal>;

const RESULT_DIGITS = 34;
const TRIG_PLACES = 40;
const PI = Decimal.acos(-1);
const E = new Decimal(1).exp();

export type AngleUnit = 'deg' | 'rad';

export interface EvalContext {
  angle: AngleUnit;
  ans?: Dec | null;
}

export class CalcError extends Error {}

type Tok =
  | { t: 'num'; v: Dec }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'end' };

const OP_ALIASES: Record<string, string> = {
  '×': '*',
  '·': '*',
  '⋅': '*',
  '÷': '/',
  '−': '-',
  '–': '-',
  '（': '(',
  '）': ')',
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    let c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    c = OP_ALIASES[c] ?? c;
    // 숫자: 12,345.67 / .5 / 1e-3
    if (/[0-9.]/.test(c)) {
      let j = i;
      let s = '';
      let dot = false;
      while (j < n) {
        const d = src[j];
        if (/[0-9]/.test(d)) s += d;
        else if (d === '.' && !dot) {
          dot = true;
          s += d;
        } else if (d === ',' && /[0-9]/.test(src[j + 1] ?? '') && /[0-9]/.test(src[j - 1] ?? '')) {
          // 천 단위 구분 쉼표는 무시 (단, 함수 인자 구분과 헷갈리지 않게 숫자 사이에서만)
          if (!/^\d{3}(?!\d)/.test(src.slice(j + 1))) break;
        } else break;
        j++;
      }
      if (s === '.') throw new CalcError('숫자가 올바르지 않습니다');
      // 지수 표기
      if (/[eE]/.test(src[j] ?? '')) {
        const m = /^[eE]([+\-−]?\d+)/.exec(src.slice(j));
        if (m) {
          s += 'e' + m[1].replace('−', '-');
          j += m[0].length;
        }
      }
      out.push({ t: 'num', v: new Decimal(s) });
      i = j;
      continue;
    }
    if (c === 'π') {
      out.push({ t: 'id', v: 'pi' });
      i++;
      continue;
    }
    if (c === '√') {
      out.push({ t: 'id', v: 'sqrt' });
      i++;
      continue;
    }
    if (c === '∛') {
      out.push({ t: 'id', v: 'cbrt' });
      i++;
      continue;
    }
    if (c === '²' || c === '³') {
      out.push({ t: 'op', v: '^' }, { t: 'num', v: new Decimal(c === '²' ? 2 : 3) });
      i++;
      continue;
    }
    if (/[A-Za-z_가-힣]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z_0-9가-힣]/.test(src[j])) j++;
      // log2, log10 같은 이름을 위해 숫자를 허용하되 그 외에는 끊는다
      let word = src.slice(i, j).toLowerCase();
      if (!KNOWN.has(word)) {
        const m = /^[a-z_가-힣]+/.exec(word);
        if (m && KNOWN.has(m[0])) {
          word = m[0];
          j = i + word.length;
        }
      }
      out.push({ t: 'id', v: word });
      i = j;
      continue;
    }
    if ('+-*/^%!(),'.includes(c)) {
      // ** 도 거듭제곱으로
      if (c === '*' && src[i + 1] === '*') {
        out.push({ t: 'op', v: '^' });
        i += 2;
        continue;
      }
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new CalcError(`알 수 없는 문자: ${src[i]}`);
  }
  out.push({ t: 'end' });
  return out;
}

function need(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new CalcError(msg);
}

function isInt(x: Dec) {
  return x.isInteger();
}

function factorial(x: Dec): Dec {
  need(isInt(x) && !x.isNegative(), '팩토리얼은 0 이상의 정수만 가능합니다');
  need(x.lte(20000), '팩토리얼이 너무 큽니다');
  let r = new Decimal(1);
  const n = x.toNumber();
  for (let i = 2; i <= n; i++) r = r.times(i);
  return r;
}

function gcd(a: Dec, b: Dec): Dec {
  need(isInt(a) && isInt(b), 'gcd 는 정수만 가능합니다');
  a = a.abs();
  b = b.abs();
  while (!b.isZero()) [a, b] = [b, a.mod(b)];
  return a;
}

type Fn = (args: Dec[], ctx: EvalContext) => Dec;

const toRad = (x: Dec, ctx: EvalContext) => (ctx.angle === 'deg' ? x.times(PI).div(180) : x);
const fromRad = (x: Dec, ctx: EvalContext) => (ctx.angle === 'deg' ? x.times(180).div(PI) : x);
const trigRound = (x: Dec) => x.toDecimalPlaces(TRIG_PLACES);

const FUNCS: Record<string, { arity: number | [number, number]; fn: Fn }> = {
  sin: { arity: 1, fn: ([x], c) => trigRound(toRad(x, c).sin()) },
  cos: { arity: 1, fn: ([x], c) => trigRound(toRad(x, c).cos()) },
  tan: {
    arity: 1,
    fn: ([x], c) => {
      const r = toRad(x, c);
      const cos = trigRound(r.cos());
      need(!cos.isZero(), '정의되지 않는 값입니다 (tan)');
      return trigRound(trigRound(r.sin()).div(cos));
    },
  },
  asin: {
    arity: 1,
    fn: ([x], c) => {
      need(x.abs().lte(1), 'asin 의 정의역은 -1 ~ 1 입니다');
      return trigRound(fromRad(x.asin(), c));
    },
  },
  acos: {
    arity: 1,
    fn: ([x], c) => {
      need(x.abs().lte(1), 'acos 의 정의역은 -1 ~ 1 입니다');
      return trigRound(fromRad(x.acos(), c));
    },
  },
  atan: { arity: 1, fn: ([x], c) => trigRound(fromRad(x.atan(), c)) },
  sinh: { arity: 1, fn: ([x]) => x.sinh() },
  cosh: { arity: 1, fn: ([x]) => x.cosh() },
  tanh: { arity: 1, fn: ([x]) => x.tanh() },
  ln: {
    arity: 1,
    fn: ([x]) => {
      need(x.gt(0), '로그는 양수만 가능합니다');
      return x.ln();
    },
  },
  log: {
    arity: [1, 2],
    fn: ([x, base]) => {
      need(x.gt(0), '로그는 양수만 가능합니다');
      if (base) {
        need(base.gt(0) && !base.eq(1), '로그의 밑이 올바르지 않습니다');
        return x.log(base);
      }
      return x.log(10);
    },
  },
  log2: {
    arity: 1,
    fn: ([x]) => {
      need(x.gt(0), '로그는 양수만 가능합니다');
      return x.log(2);
    },
  },
  exp: { arity: 1, fn: ([x]) => x.exp() },
  sqrt: {
    arity: 1,
    fn: ([x]) => {
      need(!x.isNegative(), '음수의 제곱근은 실수가 아닙니다');
      return x.sqrt();
    },
  },
  cbrt: { arity: 1, fn: ([x]) => x.cbrt() },
  root: {
    arity: 2,
    fn: ([x, n]) => {
      need(!n.isZero(), '0 제곱근은 정의되지 않습니다');
      if (x.isNegative()) {
        need(isInt(n) && n.mod(2).abs().eq(1), '음수의 짝수 제곱근은 실수가 아닙니다');
        return x.abs().pow(new Decimal(1).div(n)).neg();
      }
      return x.pow(new Decimal(1).div(n));
    },
  },
  abs: { arity: 1, fn: ([x]) => x.abs() },
  floor: { arity: 1, fn: ([x]) => x.floor() },
  ceil: { arity: 1, fn: ([x]) => x.ceil() },
  round: {
    arity: [1, 2],
    fn: ([x, p]) => {
      if (!p) return x.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      need(isInt(p) && p.abs().lte(100), '자릿수가 올바르지 않습니다');
      const k = new Decimal(10).pow(p);
      return x.times(k).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).div(k);
    },
  },
  trunc: { arity: 1, fn: ([x]) => x.trunc() },
  sign: { arity: 1, fn: ([x]) => new Decimal(x.isZero() ? 0 : x.isNegative() ? -1 : 1) },
  fact: { arity: 1, fn: ([x]) => factorial(x) },
  min: { arity: [1, 99], fn: (a) => Decimal.min(...a) },
  max: { arity: [1, 99], fn: (a) => Decimal.max(...a) },
  pow: { arity: 2, fn: ([a, b]) => power(a, b) },
  mod: { arity: 2, fn: ([a, b]) => modulo(a, b) },
  gcd: { arity: 2, fn: ([a, b]) => gcd(a, b) },
  lcm: {
    arity: 2,
    fn: ([a, b]) => {
      const g = gcd(a, b);
      return g.isZero() ? g : a.times(b).abs().div(g);
    },
  },
  ncr: {
    arity: 2,
    fn: ([n, r]) => {
      need(isInt(n) && isInt(r) && !n.isNegative() && !r.isNegative(), 'nCr 은 0 이상의 정수만 가능합니다');
      if (r.gt(n)) return new Decimal(0);
      const k = Decimal.min(r, n.minus(r)).toNumber();
      need(k <= 20000, '값이 너무 큽니다');
      let res = new Decimal(1);
      for (let i = 1; i <= k; i++) res = res.times(n.minus(k).plus(i)).div(i);
      return res.toDecimalPlaces(0);
    },
  },
  npr: {
    arity: 2,
    fn: ([n, r]) => {
      need(isInt(n) && isInt(r) && !n.isNegative() && !r.isNegative(), 'nPr 은 0 이상의 정수만 가능합니다');
      if (r.gt(n)) return new Decimal(0);
      const k = r.toNumber();
      need(k <= 20000, '값이 너무 큽니다');
      let res = new Decimal(1);
      for (let i = 0; i < k; i++) res = res.times(n.minus(i));
      return res;
    },
  },
};

const CONSTS: Record<string, (ctx: EvalContext) => Dec> = {
  pi: () => PI,
  e: () => E,
  tau: () => PI.times(2),
  ans: (ctx) => {
    need(ctx.ans != null, '이전 결과(Ans)가 없습니다');
    return ctx.ans!;
  },
};

const KNOWN = new Set([...Object.keys(FUNCS), ...Object.keys(CONSTS), 'mod']);

function power(a: Dec, b: Dec): Dec {
  if (a.isZero() && b.isNegative()) throw new CalcError('0 으로 나눌 수 없습니다');
  if (a.isNegative() && !isInt(b)) {
    // (-8)^(1/3) 처럼 홀수 제곱근이면 실수 해를 준다
    const inv = new Decimal(1).div(b).toDecimalPlaces(30);
    if (isInt(inv) && inv.mod(2).abs().eq(1)) return a.abs().pow(b).neg();
    throw new CalcError('음수의 거듭제곱 결과가 실수가 아닙니다');
  }
  // 지나치게 큰 지수는 미리 막는다 (브라우저가 멈추지 않게)
  if (b.abs().gt(1e7) && !a.abs().eq(1) && !a.isZero()) {
    if (a.abs().gt(1) === b.gt(0)) throw new CalcError('결과가 너무 큽니다');
    return new Decimal(0);
  }
  return a.pow(b);
}

function modulo(a: Dec, b: Dec): Dec {
  need(!b.isZero(), '0 으로 나눌 수 없습니다');
  return a.mod(b);
}

interface Val {
  v: Dec;
  /** `10%` 처럼 단독 퍼센트 항이면 원래 수(10). 덧셈·뺄셈에서 "a 의 10%" 로 해석하기 위해 들고 다닌다. */
  pct?: Dec;
}

class Parser {
  private pos = 0;
  constructor(
    private toks: Tok[],
    private ctx: EvalContext,
  ) {}

  private peek(): Tok {
    return this.toks[this.pos];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private eat(v: string): boolean {
    if (this.isOp(v)) {
      this.pos++;
      return true;
    }
    return false;
  }

  parse(): Dec {
    need(this.peek().t !== 'end', '수식을 입력하세요');
    const r = this.add();
    const t = this.peek();
    if (t.t !== 'end') {
      if (t.t === 'op' && t.v === ')') throw new CalcError('여는 괄호가 없습니다');
      throw new CalcError('수식이 올바르지 않습니다');
    }
    return r.v;
  }

  private add(): Val {
    let left = this.mul();
    for (;;) {
      const plus = this.isOp('+');
      if (!plus && !this.isOp('-')) break;
      this.pos++;
      const right = this.mul();
      // 200 + 10% → 220 (일반 계산기와 같은 해석)
      const rv = right.pct ? left.v.times(right.pct).div(100) : right.v;
      left = { v: plus ? left.v.plus(rv) : left.v.minus(rv) };
    }
    return left;
  }

  private startsOperand(): boolean {
    const t = this.peek();
    return t.t === 'id' ? t.v !== 'mod' : t.t === 'op' && t.v === '(';
  }

  private mul(): Val {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.pos++;
        const right = this.unary();
        if (t.v === '*') left = { v: left.v.times(right.v) };
        else {
          need(!right.v.isZero(), '0 으로 나눌 수 없습니다');
          left = { v: left.v.div(right.v) };
        }
      } else if (t.t === 'id' && t.v === 'mod') {
        this.pos++;
        left = { v: modulo(left.v, this.unary().v) };
      } else if (this.startsOperand()) {
        // 암시적 곱셈: 2π, 3(4+5), 2sin(30)
        left = { v: left.v.times(this.power().v) };
      } else break;
    }
    return left;
  }

  private unary(): Val {
    if (this.eat('-')) return { v: this.unary().v.neg() };
    if (this.eat('+')) return { v: this.unary().v };
    return this.power();
  }

  private power(): Val {
    const base = this.postfix();
    if (this.eat('^')) {
      // 오른쪽 결합, 지수에는 부호 허용: 2^-3, 2^3^2 = 2^9
      const exp = this.unary();
      return { v: power(base.v, exp.v) };
    }
    return base;
  }

  private postfix(): Val {
    let val: Val = { v: this.primary() };
    for (;;) {
      if (this.eat('!')) val = { v: factorial(val.v) };
      else if (this.eat('%')) val = { v: val.v.div(100), pct: val.v };
      else break;
    }
    return val;
  }

  private primary(): Dec {
    const t = this.peek();
    if (t.t === 'num') {
      this.pos++;
      need(this.peek().t !== 'num', '수식이 올바르지 않습니다');
      return t.v;
    }
    if (t.t === 'op' && t.v === '(') {
      this.pos++;
      const v = this.add().v;
      // 닫는 괄호는 끝에서 생략할 수 있다
      if (!this.eat(')')) need(this.peek().t === 'end', '닫는 괄호가 없습니다');
      return v;
    }
    if (t.t === 'id') {
      this.pos++;
      const c = CONSTS[t.v];
      if (c) return c(this.ctx);
      const f = FUNCS[t.v];
      if (!f) throw new CalcError(`알 수 없는 이름: ${t.v}`);
      const args: Dec[] = [];
      if (this.eat('(')) {
        if (!this.isOp(')')) {
          do args.push(this.add().v);
          while (this.eat(','));
        }
        if (!this.eat(')')) need(this.peek().t === 'end', '닫는 괄호가 없습니다');
      } else {
        // √2, sin 30 처럼 괄호 없이 쓰는 경우
        need(this.peek().t !== 'end', `${t.v} 의 인자가 없습니다`);
        args.push(this.unary().v);
      }
      const [lo, hi] = typeof f.arity === 'number' ? [f.arity, f.arity] : f.arity;
      need(args.length >= lo && args.length <= hi, `${t.v} 의 인자 개수가 맞지 않습니다`);
      return f.fn(args, this.ctx);
    }
    if (t.t === 'end') throw new CalcError('수식이 끝나지 않았습니다');
    throw new CalcError('수식이 올바르지 않습니다');
  }
}

export function evaluate(expr: string, ctx: EvalContext): Dec {
  const toks = tokenize(expr);
  let v: Dec;
  try {
    v = new Parser(toks, ctx).parse();
  } catch (e) {
    if (e instanceof CalcError) throw e;
    throw new CalcError('계산할 수 없습니다');
  }
  if (v.isNaN()) throw new CalcError('정의되지 않는 값입니다');
  if (!v.isFinite()) throw new CalcError('결과가 너무 큽니다');
  return v.toSignificantDigits(RESULT_DIGITS);
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatOptions {
  /** 소수 표시 유효숫자 (정수는 34자리까지 그대로 보여준다) */
  digits?: number;
  grouping?: boolean;
}

/** 화면 표시용. 너무 크거나 작은 수는 지수 표기로 바꾼다. */
export function formatNumber(x: Dec, opts: FormatOptions = {}): string {
  const digits = opts.digits ?? 20;
  const grouping = opts.grouping ?? true;
  if (x.isZero()) return '0';
  const exp = x.e;
  let s: string;
  if (exp >= RESULT_DIGITS || exp < -9) {
    const r = x.toSignificantDigits(Math.min(digits, 12));
    const [mant, e] = r.toExponential().split('e');
    return `${mant}e${Number(e)}`;
  }
  if (x.isInteger()) s = x.toFixed(0);
  else s = x.toSignificantDigits(Math.max(digits, exp + 1)).toFixed();
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [i, f] = s.split('.');
  const out = (grouping ? group(i) : i) + (f ? '.' + f : '');
  return (neg ? '-' : '') + out;
}

/** 수식에 다시 넣을 수 있는 형태 (구분 쉼표 없음) */
export function toPlain(x: Dec): string {
  return formatNumber(x, { grouping: false, digits: RESULT_DIGITS });
}

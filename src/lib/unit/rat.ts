// 분수로 들고 다니는 정확한 수. 1평 = 400/121 m² 처럼 끝나지 않는 비율도 마지막에 한 번만 나눈다 —
// 121평을 m² 로 바꾸면 399.999… 가 아니라 정확히 400 이 나온다.
import Decimal from 'decimal.js';

export const Dec = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -1000, toExpPos: 1000 });
export type Dec = Decimal;

export interface Rat {
  n: Dec;
  d: Dec;
}

const ONE = new Dec(1);

/** "400/121", "0.3048", "1e-3", "4.4482216152605/0.00064516" */
export function rat(v: string | number | Dec, d: string | number | Dec = ONE): Rat {
  if (typeof v === 'string' && v.includes('/')) {
    const [a, b] = v.split('/');
    return div(rat(a), rat(b));
  }
  return norm({ n: new Dec(v), d: new Dec(d) });
}

function norm(r: Rat): Rat {
  return r.d.isNeg() ? { n: r.n.neg(), d: r.d.neg() } : r;
}

export const mul = (a: Rat, b: Rat): Rat => norm({ n: a.n.mul(b.n), d: a.d.mul(b.d) });
export const div = (a: Rat, b: Rat): Rat => norm({ n: a.n.mul(b.d), d: a.d.mul(b.n) });
export const add = (a: Rat, b: Rat): Rat => (a.d.eq(b.d) ? { n: a.n.add(b.n), d: a.d } : norm({ n: a.n.mul(b.d).add(b.n.mul(a.d)), d: a.d.mul(b.d) }));
export const sub = (a: Rat, b: Rat): Rat => add(a, { n: b.n.neg(), d: b.d });
export const isZero = (a: Rat) => a.n.isZero();
export const isFiniteRat = (a: Rat) => !a.d.isZero() && a.n.isFinite() && a.d.isFinite();

/** 나눈 값. 끝나지 않으면 120자리에서 자른다 */
export function value(a: Rat): Dec {
  return a.n.div(a.d);
}

/** 끝나는 소수인가 (자르지 않고 정확히 나누어떨어지는가) */
export function exact(a: Rat): boolean {
  const q = value(a);
  return q.mul(a.d).eq(a.n);
}

export const cmp = (a: Rat, b: Rat) => value(a).cmp(value(b));

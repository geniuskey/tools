// 프리랜서 · 강사료 · 원고료처럼 떼고 주는 돈: 사업소득 3.3%, 기타소득 8.8%.
import { RATES } from './rates';

export type Kind = 'business' | 'other';

export interface Withheld {
  gross: number;
  incomeTax: number;
  localTax: number;
  net: number;
}

const floor10 = (v: number) => Math.floor(v / 10 + 1e-9) * 10;

/** 지급액에서 떼는 세금 (10원 미만 버림) */
export function withhold(gross: number, kind: Kind): Withheld {
  const w = RATES.withholding;
  const g = Math.max(0, Math.floor(gross));
  let tax: number;
  if (kind === 'business') tax = floor10(g * w.business);
  else {
    const income = g * (1 - w.otherExpense);
    tax = income <= w.otherMin ? 0 : floor10(income * w.other);
  }
  const local = floor10(tax * RATES.localTax);
  return { gross: g, incomeTax: tax, localTax: local, net: g - tax - local };
}

/** 손에 net 원이 남으려면 얼마를 줘야 하나 (가장 작은 지급액) */
export function grossFor(net: number, kind: Kind): number {
  const n = Math.max(0, Math.floor(net));
  if (!n) return 0;
  if (withhold(n, kind).net >= n) return n; // 떼는 돈이 없는 작은 금액
  // 세금이 10원씩 계단이라 실수령액이 가끔 줄어든다: 조금 아래에서부터 1원씩 올려 가장 작은 값을 찾는다
  const rate = kind === 'business' ? RATES.withholding.business * 1.1 : RATES.withholding.other * (1 - RATES.withholding.otherExpense) * 1.1;
  let g = Math.max(n, Math.floor(n / (1 - rate)) - 100);
  while (withhold(g, kind).net < n) g++;
  return g;
}

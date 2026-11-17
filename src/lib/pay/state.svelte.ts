// 탭이 같이 쓰는 상태: 급여 조건은 실수령액 · 연봉표가 함께 쓴다.
import { annualFor, monthly, thisMonth, type Input } from './core';
import { parseMoney } from './money';
import { RATES } from './rates';

export type Mode = 'net' | 'table' | 'words';
export const MODES: [Mode, string][] = [
  ['net', '실수령액'],
  ['table', '연봉표'],
  ['words', '금액 한글 표기'],
];

export interface Read {
  value: number;
  /** 어떻게 읽었는지 (만 원 단위로 짐작했을 때) */
  note: string;
}

/** 급여 금액을 읽는다. 단위 없이 작은 수를 적으면 만 원 단위로 본다 (4500 → 4,500만 원) */
export function readSalary(text: string, unit: 'annual' | 'monthly'): Read | null {
  const m = parseMoney(text);
  if (!m) return null;
  let v = Number(m.value);
  const bare = /^[\d,.\s]+$/.test(text.trim());
  if (bare && v > 0 && v < (unit === 'annual' ? 100_000 : 10_000)) {
    const p = parseMoney(text.trim() + '만');
    if (p) return { value: Number(p.value), note: '만 원 단위로 읽었습니다' };
  }
  if (!Number.isFinite(v) || v < 0) return null;
  v = Math.min(v, 100 * 1e8 * 100);
  return { value: v, note: '' };
}

class PayState {
  mode = $state<Mode>('net');
  salary = $state('4,500만');
  unit = $state<'annual' | 'monthly'>('annual');
  severance = $state(false);
  nonTax = $state(RATES.nonTax.meal);
  family = $state(1);
  children = $state(0);
  ratio = $state(1);
  noPension = $state(false);
  noEmployment = $state(false);
  target = $state('');
  step = $state(1_000_000);
  words = $state('123456789');
  one = $state(true);
  vatFrom = $state<'supply' | 'total'>('supply');
  toast = $state('');
  month = thisMonth();

  read = $derived(readSalary(this.salary, this.unit));
  /** 연봉으로 맞춘 값 */
  annual = $derived(this.read ? (this.unit === 'annual' ? this.read.value : this.read.value * (this.severance ? 13 : 12)) : 0);
  base = $derived<Omit<Input, 'annual'>>({
    severanceIncluded: this.severance,
    nonTax: this.nonTax || 0,
    family: this.family,
    children: this.children,
    ratio: this.ratio,
    month: this.month,
    noPension: this.noPension,
    noEmployment: this.noEmployment,
  });
  result = $derived(this.read ? monthly({ ...this.base, annual: this.annual }) : null);
  targetRead = $derived(readSalary(this.target, 'monthly'));
  needed = $derived(this.targetRead ? annualFor(this.targetRead.value, this.base) : null);

  say(msg: string) {
    this.toast = msg;
    setTimeout(() => this.toast === msg && (this.toast = ''), 2200);
  }
  async copy(text: string, what = '') {
    try {
      await navigator.clipboard.writeText(text);
      this.say(`${what || text} 복사했습니다`);
    } catch {
      this.say('복사하지 못했습니다');
    }
  }

  snapshot() {
    return {
      mode: this.mode,
      salary: this.salary,
      unit: this.unit,
      severance: this.severance,
      nonTax: this.nonTax,
      family: this.family,
      children: this.children,
      ratio: this.ratio,
      noPension: this.noPension,
      noEmployment: this.noEmployment,
      target: this.target,
      step: this.step,
      words: this.words,
      one: this.one,
      vatFrom: this.vatFrom,
    };
  }
  /** 처음 값으로 */
  reset() {
    const mode = this.mode;
    this.restore(DEFAULTS);
    this.mode = mode;
  }
  restore(s: Record<string, any>) {
    if (MODES.some(([m]) => m === s.mode)) this.mode = s.mode;
    for (const k of ['salary', 'target', 'words'] as const) if (typeof s[k] === 'string') this[k] = s[k].slice(0, 200);
    if (s.unit === 'annual' || s.unit === 'monthly') this.unit = s.unit;
    for (const k of ['severance', 'noPension', 'noEmployment', 'one'] as const) if (typeof s[k] === 'boolean') this[k] = s[k];
    if (Number.isFinite(s.nonTax) && s.nonTax >= 0) this.nonTax = s.nonTax;
    if (Number.isInteger(s.family) && s.family >= 1 && s.family <= 20) this.family = s.family;
    if (Number.isInteger(s.children) && s.children >= 0 && s.children <= 19) this.children = s.children;
    if ([0.8, 1, 1.2].includes(s.ratio)) this.ratio = s.ratio;
    if ([1_000_000, 5_000_000, 10_000_000].includes(s.step)) this.step = s.step;
    if (s.vatFrom === 'supply' || s.vatFrom === 'total') this.vatFrom = s.vatFrom;
  }
}

export const st = new PayState();
const DEFAULTS = st.snapshot();

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

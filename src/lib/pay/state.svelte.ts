// 탭이 같이 쓰는 상태: 급여 조건은 실수령액 · 연봉표가 함께 쓴다.
import { annualFor, employerCost, monthly, thisMonth, type Input, type Sme } from './core';
import { parseMoney } from './money';
import { RATES } from './rates';

export type Mode = 'net' | 'compare' | 'table' | 'hourly' | 'severance' | 'words';
export const MODES: [Mode, string][] = [
  ['net', '실수령액'],
  ['compare', '연봉 비교'],
  ['table', '연봉표'],
  ['hourly', '시급 · 알바'],
  ['severance', '퇴직금'],
  ['words', '금액 표기'],
];

export interface Offer {
  name: string;
  salary: string;
  severance: boolean;
  nonTax: number;
}
export const MAX_OFFERS = 5;

export type HourlyTax = 'none' | 'business' | 'insurance';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());

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
  sme = $state<Sme>('');
  firm = $state(0);
  /** 산재보험료율 (%) */
  accident = $state(RATES.employer.accident * 100);
  offers = $state<Offer[]>([
    { name: '지금', salary: '4,500만', severance: false, nonTax: RATES.nonTax.meal },
    { name: '제안', salary: '5,000만', severance: false, nonTax: RATES.nonTax.meal },
  ]);
  hWage = $state(RATES.minWage.hourly);
  hDay = $state(8);
  hDays = $state(5);
  hNight = $state(0);
  hFive = $state(true);
  hTax = $state<HourlyTax>('none');
  sStart = $state(ymd(threeYearsAgo));
  sLast = $state(ymd(today));
  /** 퇴직 전 3개월 월 임금. 비우면 실수령액 탭의 세전 월급을 쓴다 */
  sMonthly = $state<number | null>(null);
  sBonus = $state(0);
  sLeave = $state(0);
  wKind = $state<'business' | 'other'>('business');
  wFrom = $state<'gross' | 'net'>('gross');
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
    sme: this.sme,
  });
  result = $derived(this.read ? monthly({ ...this.base, annual: this.annual }) : null);
  targetRead = $derived(readSalary(this.target, 'monthly'));
  needed = $derived(this.targetRead ? annualFor(this.targetRead.value, this.base) : null);
  employer = $derived(this.result ? employerCost(this.result, this.base, RATES.employer.stability[this.firm]?.[1] ?? 0, (this.accident || 0) / 100) : null);

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
      sme: this.sme,
      firm: this.firm,
      accident: this.accident,
      offers: this.offers.map((o) => ({ ...o })),
      hWage: this.hWage,
      hDay: this.hDay,
      hDays: this.hDays,
      hNight: this.hNight,
      hFive: this.hFive,
      hTax: this.hTax,
      sStart: this.sStart,
      sLast: this.sLast,
      sMonthly: this.sMonthly,
      sBonus: this.sBonus,
      sLeave: this.sLeave,
      wKind: this.wKind,
      wFrom: this.wFrom,
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
    if (['', 'youth', 'other'].includes(s.sme)) this.sme = s.sme;
    if (Number.isInteger(s.firm) && s.firm >= 0 && s.firm < RATES.employer.stability.length) this.firm = s.firm;
    const n = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    if (n(s.accident, 0, 30)) this.accident = s.accident;
    if (Array.isArray(s.offers) && s.offers.length) {
      const list = s.offers
        .slice(0, MAX_OFFERS)
        .filter((o: any) => o && typeof o.salary === 'string')
        .map((o: any) => ({
          name: typeof o.name === 'string' ? o.name.slice(0, 30) : '',
          salary: o.salary.slice(0, 200),
          severance: o.severance === true,
          nonTax: n(o.nonTax, 0, 1e8) ? o.nonTax : 0,
        }));
      if (list.length) this.offers = list;
    }
    if (n(s.hWage, 0, 1e7)) this.hWage = s.hWage;
    if (n(s.hDay, 0, 24)) this.hDay = s.hDay;
    if (Number.isInteger(s.hDays) && n(s.hDays, 0, 7)) this.hDays = s.hDays;
    if (n(s.hNight, 0, 168)) this.hNight = s.hNight;
    if (typeof s.hFive === 'boolean') this.hFive = s.hFive;
    if (['none', 'business', 'insurance'].includes(s.hTax)) this.hTax = s.hTax;
    for (const k of ['sStart', 'sLast'] as const) if (typeof s[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s[k])) this[k] = s[k];
    for (const k of ['sMonthly', 'sBonus', 'sLeave'] as const) if (n(s[k], 0, 1e11)) this[k] = s[k];
    if (s.wKind === 'business' || s.wKind === 'other') this.wKind = s.wKind;
    if (s.wFrom === 'gross' || s.wFrom === 'net') this.wFrom = s.wFrom;
  }
}

export const st = new PayState();
const DEFAULTS = st.snapshot();

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

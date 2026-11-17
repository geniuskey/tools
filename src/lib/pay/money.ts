// 금액을 읽고 쓴다: "1억 2,345만", "일금 일백만원정", "4.5천만" 을 수로, 수를 한글 · 한자 · 갖은자 · 영어로.
// 큰 수도 정확하게 BigInt 로 다룬다 (경 단위까지).

const BIG: [string, bigint][] = [
  ['경', 10n ** 16n],
  ['조', 10n ** 12n],
  ['억', 10n ** 8n],
  ['만', 10n ** 4n],
];
const BIG_HANJA: Record<string, string> = { 萬: '만', 億: '억', 兆: '조', 京: '경' };
const SMALL: Record<string, bigint> = { 십: 10n, 백: 100n, 천: 1000n, 拾: 10n, 十: 10n, 佰: 100n, 百: 100n, 仟: 1000n, 千: 1000n, 阡: 1000n, 什: 10n };
const DIGIT: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 壱: 1, 貳: 2, 弐: 2, 貮: 2, 參: 3, 参: 3, 肆: 4, 伍: 5, 陸: 6, 柒: 7, 漆: 7, 捌: 8, 玖: 9,
};

/** 소수점 아래를 다루려고 1,000,000 배로 든 수 */
const SCALE = 1_000_000n;
function decimal(s: string): bigint {
  const [i, f = ''] = s.split('.');
  return BigInt(i || '0') * SCALE + BigInt((f + '000000').slice(0, 6));
}

export interface Money {
  value: bigint;
  /** 원 아래(소수)를 버렸으면 */
  truncated: boolean;
}

/**
 * 적은 금액을 읽는다. 숫자 · 쉼표 · 한글 단위(만 · 억 · 조 · 경, 십 · 백 · 천) · 한글 숫자 · 한자 · 갖은자,
 * "일금 … 원정", "₩", "KRW", "원" 을 알아듣는다. 읽지 못하면 null.
 */
export function parseMoney(input: string): Money | null {
  let s = input
    .normalize('NFC')
    .replace(/[\s,_']/g, '')
    .replace(/^(일금|금|金|₩|\\|KRW|krw)+/, '')
    .replace(/(원정|원整|원|정|整|圓|円|KRW|won|₩)+$/i, '')
    .replace(/[萬億兆京]/g, (c) => BIG_HANJA[c]);
  if (/^[+-]/.test(s)) s = s.slice(1);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = decimal(s);
    return { value: v / SCALE, truncated: v % SCALE !== 0n };
  }
  let total = 0n;
  let group = 0n;
  let num: bigint | null = null;
  let lastBig = Infinity as number | bigint;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (m) {
      if (num !== null) return null;
      num = decimal(m[0]);
      i += m[0].length;
      continue;
    }
    if (ch in DIGIT) {
      // 한글 숫자를 이어 적으면 (이공이육) 자리대로
      num = (num ?? 0n) * 10n + BigInt(DIGIT[ch]) * SCALE;
      i++;
      continue;
    }
    if (ch in SMALL) {
      group += (num ?? SCALE) * SMALL[ch];
      num = null;
      i++;
      continue;
    }
    const big = BIG.find(([k]) => k === ch);
    if (big) {
      const unit = big[1];
      if (typeof lastBig === 'bigint' && unit >= lastBig) return null; // 만 다음에 억은 없다
      const g = group + (num ?? 0n);
      total += (g === 0n ? SCALE : g) * unit;
      group = 0n;
      num = null;
      lastBig = unit;
      i++;
      continue;
    }
    return null;
  }
  total += group + (num ?? 0n);
  return { value: total / SCALE, truncated: total % SCALE !== 0n };
}

// ── 쓰기 ─────────────────────────────────────────────────────

const KO_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KO_SMALL = ['', '십', '백', '천'];
const HANJA_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HANJA_SMALL = ['', '十', '百', '千'];
const FORMAL_DIGITS = ['', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const FORMAL_SMALL = ['', '拾', '佰', '仟'];
const KO_BIG = ['', '만', '억', '조', '경', '해'];
const HANJA_BIG = ['', '萬', '億', '兆', '京', '垓'];

/** 만 단위로 끊은 네 자리 묶음 (작은 쪽부터) */
function groups(v: bigint): number[] {
  const out: number[] = [];
  let n = v < 0n ? -v : v;
  do {
    out.push(Number(n % 10000n));
    n /= 10000n;
  } while (n > 0n);
  return out;
}

interface Style {
  digits: string[];
  small: string[];
  big: string[];
  /** 십 · 백 · 천 앞에 '일' 을 붙인다 (일백, 일천) */
  one: boolean;
  /** 만 · 억 앞에 혼자 있는 '일' 을 붙인다 (일만, 일억) */
  oneBig: boolean;
  /** 묶음 사이 띄어쓰기 */
  sep: string;
}

function spell(v: bigint, st: Style): string {
  if (v === 0n) return '';
  const gs = groups(v);
  const parts: string[] = [];
  for (let k = gs.length - 1; k >= 0; k--) {
    const g = gs[k];
    if (!g) continue;
    let t = '';
    for (let p = 3; p >= 0; p--) {
      const d = Math.floor(g / 10 ** p) % 10;
      if (!d) continue;
      t += (d === 1 && p > 0 && !st.one ? '' : st.digits[d]) + st.small[p];
    }
    // 맨 앞의 "일만" 은 보통 "만" 으로 (억 · 조는 "일억" 으로 읽고, 십억 다음의 만은 "일만")
    if (g === 1 && k === 1 && !st.oneBig && k === gs.length - 1) t = '';
    else if (g === 1 && k > 0) t = st.digits[1];
    parts.push(t + st.big[k]);
  }
  return parts.join(st.sep);
}

const KO: Style = { digits: KO_DIGITS, small: KO_SMALL, big: KO_BIG, one: false, oneBig: false, sep: '' };

/** 한글로: 123456789 → 일억이천삼백사십오만육천칠백팔십구 */
export function korean(v: bigint, opts: { one?: boolean; spaced?: boolean } = {}): string {
  if (v === 0n) return '영';
  const s = spell(v, { ...KO, one: !!opts.one, oneBig: !!opts.one, sep: opts.spaced ? ' ' : '' });
  return (v < 0n ? '마이너스 ' : '') + s;
}

/** 계약서 · 영수증: 일금 일억이천삼백사십오만육천칠백팔십구원정 */
export function contract(v: bigint, one = true): string {
  return `일금 ${korean(v, { one })}원정`;
}

/** 한자: 一億二千三百四十五萬六千七百八十九 */
export function hanja(v: bigint): string {
  if (v === 0n) return '零';
  return spell(v, { digits: HANJA_DIGITS, small: HANJA_SMALL, big: HANJA_BIG, one: false, oneBig: false, sep: '' });
}

/** 갖은자 (고쳐 쓰지 못하게 수표 · 계약서에 쓰는 한자): 金 壹億貳仟參佰肆拾伍萬陸仟柒佰捌拾玖 圓整 */
export function formal(v: bigint): string {
  if (v === 0n) return '零';
  return spell(v, { digits: FORMAL_DIGITS, small: FORMAL_SMALL, big: HANJA_BIG, one: true, oneBig: true, sep: '' });
}

/** 숫자 + 한글 단위: 1억 2,345만 6,789 */
export function mixed(v: bigint): string {
  if (v === 0n) return '0';
  const gs = groups(v);
  const parts: string[] = [];
  for (let k = gs.length - 1; k >= 0; k--) if (gs[k]) parts.push(gs[k].toLocaleString('en-US') + KO_BIG[k]);
  return (v < 0n ? '-' : '') + parts.join(' ');
}

/** 쉼표 넣은 숫자 */
export function grouped(v: bigint): string {
  const s = (v < 0n ? -v : v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0n ? '-' : '') + s;
}

/** 어림: 1.23억 · 4,500만 처럼 짧게 */
export function rough(v: bigint): string {
  const n = Number(v);
  const a = Math.abs(n);
  if (a >= 1e12) return `${+(n / 1e12).toFixed(2)}조`;
  if (a >= 1e8) return `${+(n / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${Math.round(n / 1e4).toLocaleString('en-US')}만`;
  return n.toLocaleString('en-US');
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_BIG = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion'];

function en999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? '-' + EN_ONES[r % 10] : '');
  return [h ? `${EN_ONES[h]} hundred` : '', rest].filter(Boolean).join(' ');
}

/** 영어: one hundred twenty-three million four hundred fifty-six thousand seven hundred eighty-nine */
export function english(v: bigint): string {
  if (v === 0n) return 'zero';
  const parts: string[] = [];
  let n = v < 0n ? -v : v;
  let k = 0;
  while (n > 0n) {
    const g = Number(n % 1000n);
    if (g) parts.unshift(en999(g) + (EN_BIG[k] ? ' ' + EN_BIG[k] : ''));
    n /= 1000n;
    k++;
  }
  return (v < 0n ? 'minus ' : '') + parts.join(' ');
}

/** 수표 · 인보이스: KRW One Hundred Twenty-Three Million … Only */
export function englishCheque(v: bigint): string {
  const words = english(v).replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return `KRW ${words} Only`;
}

// ── 부가세 ───────────────────────────────────────────────────

export interface Vat {
  supply: bigint;
  vat: bigint;
  total: bigint;
}

/** 공급가액에서: 부가세는 원 미만 버림 */
export function vatFromSupply(supply: bigint, rate = 10n): Vat {
  const vat = (supply * rate) / 100n;
  return { supply, vat, total: supply + vat };
}

/** 합계(부가세 포함)에서: 공급가액 = 합계 ÷ 1.1 을 원 단위로 반올림, 부가세 = 합계 − 공급가액 (합계가 정확히 맞게) */
export function vatFromTotal(total: bigint, rate = 10n): Vat {
  const supply = (total * 100n * 2n + (100n + rate)) / ((100n + rate) * 2n);
  return { supply, vat: total - supply, total };
}

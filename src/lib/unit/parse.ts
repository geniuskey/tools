// 적은 그대로 알아듣기: "32평", "5ft 11in", "5'11\"", "1.5 GB", "시속 100km", "36.5도", "A4", "32평은 몇 m²".
import { add, mul, rat, type Rat } from './rat';
import { paperById, unitOf, units, type CatId, type Paper } from './units';

interface Alias {
  text: string;
  lower: string;
  id: string;
  cs: boolean;
  weak: boolean;
  only: boolean;
  order: number;
}

const ALIASES: Alias[] = units
  .flatMap((u, order) => [
    ...u.alias.map((a) => {
      const weak = a.startsWith('~');
      const only = a.startsWith('+');
      const text = norm(weak || only ? a.slice(1) : a);
      return { text, lower: text.toLowerCase(), id: u.id, cs: false, weak, only, order };
    }),
    ...(u.cs ?? []).map((a) => ({ text: norm(a), lower: norm(a).toLowerCase(), id: u.id, cs: true, weak: false, only: false, order })),
  ])
  .sort((a, b) => b.text.length - a.text.length);

/** 글자 꼴을 맞춘다: 전각 · ㎡ · ℃ · ″ · 천 단위 쉼표 */
export function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/′′/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[⁄∕÷]/g, '/')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\^\s*([23])/g, '$1')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Part {
  /** 적은 숫자 그대로 (입력창에 다시 쓸 때) */
  raw: string;
  value: Rat;
  id: string;
}

export interface Reading {
  cat: CatId;
  /** 첫 조각의 단위 — "이 단위로 적었다" */
  unit: string;
  parts: Part[];
  /** 입력창에 다시 적으면 이렇게 읽히는 글 */
  text: string;
}

export type Parsed =
  | { kind: 'empty' }
  | { kind: 'number'; value: Rat; raw: string }
  | { kind: 'quantity'; readings: Reading[]; target?: string }
  | { kind: 'paper'; paper: Paper; others: Paper[] }
  | { kind: 'error'; message: string };

interface Opt {
  id: string;
  exact: boolean;
  weak: boolean;
  /** 다른 뜻이 하나도 맞지 않을 때만 ("1h 30m" 의 m = 분) */
  only: boolean;
  order: number;
}
interface Token {
  raw: string;
  value: Rat;
  opts: Opt[];
}

const NUM = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const FRAC = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/y;
const MULT = /(십|백|천)?(만|억|조)?/y;
const MULT_VALUE: Record<string, number> = { 십: 10, 백: 100, 천: 1000, 만: 1e4, 억: 1e8, 조: 1e12 };
const LETTER = /[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]/;

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

/** i 에서 시작하는 단위 이름들. 긴 것부터, 같은 길이끼리 묶어서 */
function unitsAt(s: string, low: string, i: number): { len: number; opts: Opt[] }[] {
  const byLen = new Map<number, Opt[]>();
  for (const a of ALIASES) {
    const hit = a.cs ? s.startsWith(a.text, i) : low.startsWith(a.lower, i);
    if (!hit) continue;
    const end = i + a.text.length;
    // 단위 뒤에 글자가 바로 붙으면 다른 낱말이다 ("m" 뒤 "x")
    if (end < s.length && LETTER.test(s[end]) && LETTER.test(a.text[a.text.length - 1])) continue;
    const list = byLen.get(a.text.length) ?? [];
    const exactHit = s.startsWith(a.text, i);
    const old = list.find((o) => o.id === a.id);
    if (old) {
      old.exact ||= exactHit;
      old.weak &&= a.weak;
      old.only &&= a.only;
    } else list.push({ id: a.id, exact: exactHit, weak: a.weak, only: a.only, order: a.order });
    byLen.set(a.text.length, list);
  }
  return [...byLen.entries()].sort((a, b) => b[0] - a[0]).map(([len, opts]) => ({ len, opts }));
}

function readNumber(s: string, i: number): { raw: string; value: Rat; end: number } | null {
  // 대분수 "1 1/2" 와 분수 "1/2"
  const frac = at(FRAC, s, i);
  const m = at(NUM, s, i);
  if (!m) return null;
  let value: Rat;
  let end: number;
  if (frac && frac.index === i && frac[0].length > m[0].length) {
    value = rat(`${frac[1]}/${frac[2]}`);
    end = i + frac[0].length;
  } else {
    value = rat(m[0].startsWith('+') ? m[0].slice(1) : m[0]);
    end = i + m[0].length;
    const rest = /^ (\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(s.slice(end));
    if (rest && !m[0].includes('.')) {
      const f = rat(`${rest[1]}/${rest[2]}`);
      value = m[0].startsWith('-') ? add(value, { n: f.n.neg(), d: f.d }) : add(value, f);
      end += rest[0].length;
    }
  }
  const mult = at(MULT, s, end);
  if (mult && mult[0]) {
    let k = 1;
    if (mult[1]) k *= MULT_VALUE[mult[1]];
    if (mult[2]) k *= MULT_VALUE[mult[2]];
    value = mul(value, rat(k));
    end += mult[0].length;
  }
  return { raw: s.slice(i, end).replace(/\s+/g, ' '), value, end };
}

/** 숫자-단위 쌍으로 쪼갠다. 단위 이름이 겹치면 (ft2 / ft) 뒤가 맞는 쪽을 고른다 */
function tokenize(s: string): { tokens: Token[] } | { bad: string } {
  const low = s.toLowerCase();
  let worst = 0;
  function go(i: number): Token[] | null {
    while (s[i] === ' ') i++;
    if (i >= s.length) return [];
    worst = Math.max(worst, i);
    const num = readNumber(s, i);
    if (!num) return null;
    let j = num.end;
    while (s[j] === ' ') j++;
    worst = Math.max(worst, j);
    for (const { len, opts } of unitsAt(s, low, j)) {
      const rest = go(j + len);
      if (rest) return [{ raw: num.raw, value: num.value, opts }, ...rest];
    }
    // 단위 없는 숫자는 끝이거나 다음 숫자로 이어질 때만
    if (j >= s.length || at(NUM, s, j)) {
      const rest = go(j);
      if (rest) return [{ raw: num.raw, value: num.value, opts: [] }, ...rest];
    }
    return null;
  }
  const tokens = go(0);
  if (tokens) return { tokens };
  const word = s.slice(worst).match(/^\S+/)?.[0] ?? s;
  return { bad: word };
}

/** 단위 없이 끝난 마지막 숫자: "5'11" → 11 in, "1시간 30" → 30분, "1m 80" → 80 cm */
const NEXT: Record<string, string> = { ft: 'in', h: 'min', min: 's', d: 'h', m: 'cm', km: 'm', kg: 'g', lb: 'oz', yd: 'ft', ja: 'chi', geun: 'nyang', don: 'g' };

function rank(opts: Opt[], prefer?: CatId): Opt[] {
  return [...opts].sort((a, b) => {
    const ua = unitOf(a.id);
    const ub = unitOf(b.id);
    return (
      Number(ub.cat === prefer) - Number(ua.cat === prefer) ||
      Number(b.exact) - Number(a.exact) ||
      Number(a.weak) - Number(b.weak) ||
      Number(!!ub.main) - Number(!!ua.main) ||
      a.order - b.order
    );
  });
}

const canonical = (parts: Part[]) => parts.map((p) => `${p.raw} ${unitOf(p.id).sym}`).join(' ');

/** 입력창 글을 단위 이름으로만 읽는다 ("제곱미터", "평", "°F") */
export function unitNamed(text: string): string[] {
  const s = norm(text);
  if (!s) return [];
  const hit = unitsAt(s, s.toLowerCase(), 0).find((g) => g.len === s.length);
  return hit ? rank(hit.opts).map((o) => o.id) : [];
}

const ENDING = /\s*(?:이에요|예요|이야|이요|인가요|인가|일까요|일까|인지|이죠|입니까|입니다|정도|쯤|가량|짜리|이면|은|는|이|가|을|를|야|요|면)?\s*[?？!.。]*$/;
// 뒤의 빈칸은 먹지 않는다 — "5 ft 11 in to cm" 에서 " in " 다음의 " to " 도 찾게
const TARGET_SPLIT: RegExp[] = [/\s*(?:→|->|=>|⇒)/g, /\s+(?:to|into|in)(?=\s)/gi, /\s*=\s*\??/g, /\s*(?:은|는|이|가|을|를|이면|면)?\s*몇/g];
const PREFIX = /^(섭씨|화씨|시속|초속)\s*/;

function readPaper(s: string): Parsed | null {
  const t = s.toLowerCase().replace(/\s*(?:용지|사이즈|크기|판)$/, '');
  const named: Record<string, string> = { letter: 'letter', 레터: 'letter', legal: 'legal', 리갈: 'legal', 리걸: 'legal', tabloid: 'tabloid', 타블로이드: 'tabloid', 명함: 'card' };
  if (named[t]) return { kind: 'paper', paper: paperById.get(named[t])!, others: [] };
  const m = /^(?:(iso|jis)\s*)?([ab])\s*(\d{1,2})(?:\s*\(?\s*(iso|jis)\s*\)?)?$/.exec(t);
  if (!m || Number(m[3]) > 10) return null;
  const n = Number(m[3]);
  if (m[2] === 'a') return { kind: 'paper', paper: paperById.get(`A${n}`)!, others: [] };
  const iso = (m[1] ?? m[4]) === 'iso';
  const jb = paperById.get(`JB${n}`)!;
  const ib = paperById.get(`IB${n}`)!;
  return iso ? { kind: 'paper', paper: ib, others: [jb] } : { kind: 'paper', paper: jb, others: [ib] };
}

function readQuantity(s: string, prefer?: CatId, target?: string[]): Parsed {
  let text = s;
  let prefix = '';
  const p = PREFIX.exec(text);
  if (p) {
    prefix = p[1];
    text = text.slice(p[0].length);
  }
  const r = tokenize(text);
  if ('bad' in r) return { kind: 'error', message: `"${r.bad}" 은(는) 모르는 단위입니다` };
  const tokens = r.tokens;
  if (!tokens.length) return { kind: 'empty' };

  // 앞에 붙은 말: 섭씨 · 화씨 · 시속 · 초속
  if (prefix) {
    if (tokens.length > 1) return { kind: 'error', message: `${prefix} 뒤에는 숫자 하나만 적어 주세요` };
    const t = tokens[0];
    const ids = t.opts.map((o) => o.id);
    const force =
      prefix === '섭씨' ? (!ids.length || ids.includes('C') ? 'C' : '')
      : prefix === '화씨' ? (!ids.length || ids.includes('C') || ids.includes('F') ? 'F' : '')
      : prefix === '시속' ? (!ids.length || ids.includes('km') ? 'kmh' : ids.includes('mi') ? 'mph' : ids.includes('kn') ? 'kn' : '')
      : !ids.length || ids.includes('m') ? 'mps' : '';
    if (!force) return { kind: 'error', message: `${prefix} 뒤의 단위를 알아보지 못했습니다` };
    const parts = [{ raw: t.raw, value: t.value, id: force }];
    return { kind: 'quantity', readings: [{ cat: unitOf(force).cat, unit: force, parts, text: canonical(parts) }] };
  }

  if (tokens.length === 1 && !tokens[0].opts.length) return { kind: 'number', value: tokens[0].value, raw: tokens[0].raw };

  // 마지막 숫자에 단위가 없으면 앞 단위의 한 단계 아래로
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && !last.opts.length) {
    const prev = tokens[tokens.length - 2];
    last.opts = prev.opts.filter((o) => NEXT[o.id]).map((o) => ({ ...o, id: NEXT[o.id], order: units.findIndex((u) => u.id === NEXT[o.id]) }));
  }
  if (tokens.some((t) => !t.opts.length)) return { kind: 'error', message: '숫자마다 단위를 붙여 주세요 (예: 5ft 11in)' };

  const findCats = (ranked: Opt[][]) => {
    const cats = [...new Set(ranked[0].map((o) => unitOf(o.id).cat))].filter((c) => ranked.every((opts) => opts.some((o) => unitOf(o.id).cat === c)));
    // 0점이 다르거나 거꾸로 가는 단위는 더할 수 없다
    return tokens.length > 1 ? cats.filter((c) => c !== 'temp' && c !== 'fuel') : cats;
  };
  let ranked = tokens.map((t) => rank(t.opts.filter((o) => !o.only), prefer));
  let cats = ranked.every((r) => r.length) ? findCats(ranked) : [];
  if (!cats.length) {
    ranked = tokens.map((t) => rank(t.opts, prefer));
    cats = findCats(ranked);
  }
  if (!cats.length) return { kind: 'error', message: '서로 다른 종류의 단위는 더할 수 없습니다' };
  if (target?.length) {
    const tc = new Set(target.map((id) => unitOf(id).cat));
    cats.sort((a, b) => Number(tc.has(b)) - Number(tc.has(a)));
  }

  const make = (cat: CatId, pick: (i: number, inCat: Opt[]) => Opt): Reading => {
    const parts = tokens.map((t, i) => ({ raw: t.raw, value: t.value, id: pick(i, ranked[i].filter((o) => unitOf(o.id).cat === cat)).id }));
    return { cat, unit: parts[0].id, parts, text: canonical(parts) };
  };
  const readings: Reading[] = [make(cats[0], (_, o) => o[0])];
  // 같은 분류 안의 다른 뜻 (근: 600g / 375g, Mb: 메가비트 / 메가바이트)
  ranked.forEach((opts, i) => {
    const inCat = opts.filter((o) => unitOf(o.id).cat === cats[0]);
    // 대소문자까지 맞게 적은 것 (GB) 은 다르게 읽지 않는다
    for (const alt of inCat.slice(1)) if (!inCat[0].exact || alt.exact) readings.push(make(cats[0], (k, o) => (k === i ? alt : o[0])));
  });
  for (const c of cats.slice(1)) readings.push(make(c, (_, o) => o[0]));
  const seen = new Set<string>();
  const unique = readings.filter((r) => !seen.has(r.text + r.cat) && seen.add(r.text + r.cat)).slice(0, 6);
  const t = target?.find((id) => unitOf(id).cat === unique[0].cat);
  return { kind: 'quantity', readings: unique, ...(t ? { target: t } : {}) };
}

/**
 * 입력을 읽는다. prefer 는 지금 보고 있는 분류 — "mm" 처럼 길이 · 인쇄 둘 다 되는 이름은 이쪽으로.
 */
export function parse(input: string, prefer?: CatId): Parsed {
  const s = norm(input);
  if (!s) return { kind: 'empty' };
  const paper = readPaper(s);
  if (paper) return paper;

  // "32평은 몇 m²", "5 ft to cm", "100 km/h → mph"
  for (const re of TARGET_SPLIT) {
    for (const m of s.matchAll(re)) {
      const left = s.slice(0, m.index).trim();
      const right = s.slice(m.index! + m[0].length).replace(ENDING, '').trim();
      if (!left || !right) continue;
      const target = unitNamed(right);
      if (!target.length) continue;
      const q = readQuantity(left.replace(ENDING, ''), prefer, target);
      if (q.kind === 'quantity') return q;
    }
  }

  const q = readQuantity(s, prefer);
  if (q.kind !== 'error') return q;
  // "32평이요", "3근짜리" 처럼 끝에 붙은 말을 떼고 다시
  const trimmed = s.replace(ENDING, '');
  if (trimmed && trimmed !== s) {
    const again = readQuantity(trimmed, prefer);
    if (again.kind !== 'error') return again;
  }
  return q;
}

/** 입력창에 다시 적을 글: 숫자 + 기호 */
export function write(raw: string, id: string): string {
  return `${raw} ${unitOf(id).sym}`;
}


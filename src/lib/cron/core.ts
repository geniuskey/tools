// cron 식을 읽고, 다음에 언제 도는지 찾는다. 네 가지 형식을 다룬다.
//   unix   분 시 일 월 요일            (Vixie cron · cronie · GitHub Actions · Kubernetes)
//   spring 초 분 시 일 월 요일          (Spring @Scheduled, ? · L · W · # 를 받는다)
//   quartz 초 분 시 일 월 요일 [연도]   (요일은 1 = 일요일, 일 · 요일 중 하나는 ?)
//   aws    분 시 일 월 요일 연도        (EventBridge cron(…), 요일은 1 = 일요일, 일 · 요일 중 하나는 ?)
// 요일은 안에서는 언제나 0 = 일요일 ~ 6 = 토요일로 바꿔 둔다.
import { fromDay, monthLength, toDay, weekday } from '../date/core';
import { isZone, wallOf } from '../date/zones';
import { j } from './ko';

export type Dialect = 'unix' | 'spring' | 'quartz' | 'aws';
export type FieldKey = 'sec' | 'min' | 'hour' | 'dom' | 'month' | 'dow' | 'year';

export const DIALECTS: { id: Dialect; name: string; layout: string; where: string }[] = [
  { id: 'unix', name: 'Unix', layout: '분 시 일 월 요일', where: 'crontab · GitHub Actions · Kubernetes' },
  { id: 'spring', name: 'Spring', layout: '초 분 시 일 월 요일', where: 'Spring @Scheduled' },
  { id: 'quartz', name: 'Quartz', layout: '초 분 시 일 월 요일 [연도]', where: 'Quartz Scheduler' },
  { id: 'aws', name: 'AWS', layout: 'cron(분 시 일 월 요일 연도)', where: 'EventBridge · CloudWatch Events' },
];

export const FIELD_NAME: Record<FieldKey, string> = { sec: '초', min: '분', hour: '시', dom: '일', month: '월', dow: '요일', year: '연도' };

const LAYOUT: Record<Dialect, FieldKey[]> = {
  unix: ['min', 'hour', 'dom', 'month', 'dow'],
  spring: ['sec', 'min', 'hour', 'dom', 'month', 'dow'],
  quartz: ['sec', 'min', 'hour', 'dom', 'month', 'dow', 'year'],
  aws: ['min', 'hour', 'dom', 'month', 'dow', 'year'],
};

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 1 = 일요일로 세는 형식 */
export const sundayIsOne = (d: Dialect) => d === 'quartz' || d === 'aws';

/** 칸마다 적을 수 있는 값 (요일은 그 형식의 번호로) */
export function bounds(key: FieldKey, d: Dialect): [number, number] {
  switch (key) {
    case 'sec':
    case 'min':
      return [0, 59];
    case 'hour':
      return [0, 23];
    case 'dom':
      return [1, 31];
    case 'month':
      return [1, 12];
    case 'dow':
      return sundayIsOne(d) ? [1, 7] : [0, 7];
    case 'year':
      return d === 'aws' ? [1970, 2199] : [1970, 2099];
  }
}

export interface Msg {
  text: string;
  /** 입력 안의 위치 (글자 번호, end 는 포함하지 않는다) */
  start?: number;
  end?: number;
  field?: FieldKey;
  /** 고치는 법 */
  fix?: string;
}

export type Item =
  /** 범위 · 한 값 · 별표. star: * 로 적었다. to 는 감아 돌 수 있다 (Quartz: 22-2) */
  | { kind: 'range'; from: number; to: number; step: number; star: boolean; open: boolean; start: number; end: number }
  /** ? (아무 날이나) */
  | { kind: 'any'; start: number; end: number }
  /** 일: L, L-3 */
  | { kind: 'last'; offset: number; start: number; end: number }
  /** 일: LW (마지막 평일) */
  | { kind: 'lastWeekday'; start: number; end: number }
  /** 일: 15W (15일에서 가장 가까운 평일) */
  | { kind: 'nearest'; day: number; start: number; end: number }
  /** 요일: 2#3 (셋째 월요일), wd 는 0 = 일요일 */
  | { kind: 'nth'; wd: number; n: number; start: number; end: number }
  /** 요일: 5L (마지막 금요일) */
  | { kind: 'lastOf'; wd: number; start: number; end: number };

export interface Field {
  key: FieldKey;
  text: string;
  start: number;
  end: number;
  items: Item[];
  /** 범위 · 목록으로 고른 값, 오름차순 (요일은 0 = 일 ~ 6 = 토) */
  values: number[];
  /** 모든 값 (*, ?, 또는 전부를 덮는 범위). L · W · # 가 섞이면 false */
  all: boolean;
  /** * 로 시작한다 — Vixie cron 은 이것으로 일 · 요일을 "그리고" 로 읽을지 정한다 */
  star: boolean;
  /** ? */
  any: boolean;
}

export type Special = { kind: 'reboot' } | { kind: 'rate'; n: number; unit: 'minute' | 'hour' | 'day' };

export interface Spec {
  dialect: Dialect;
  /** 적힌 순서대로. 없는 칸(Unix 의 초 · 연도)은 없다 */
  fields: Field[];
  f: Partial<Record<FieldKey, Field>>;
  sec: number[];
  min: number[];
  hour: number[];
  month: number[];
  /** null: 해마다 */
  years: number[] | null;
  dom: Field;
  dow: Field;
  /** 일과 요일을 둘 다 정했을 때 둘 중 하나만 맞아도 되는지 (Vixie) */
  join: 'or' | 'and';
  tz: { name: string; kind: 'CRON_TZ' | 'TZ'; start: number; end: number } | null;
  command: { text: string; start: number; end: number } | null;
  macro: { text: string; start: number; end: number; expands: string } | null;
  special: Special | null;
  warnings: Msg[];
}

export interface Token {
  key: FieldKey | 'tz' | 'command' | 'macro' | 'wrap' | 'extra';
  label: string;
  text: string;
  start: number;
  end: number;
  bad?: boolean;
}

export interface Parsed {
  input: string;
  dialect: Dialect;
  /** 형식을 알아서 골랐는지 */
  auto: boolean;
  /** 왜 이 형식으로 읽었는지 */
  why: string;
  spec: Spec | null;
  errors: Msg[];
  tokens: Token[];
  /** 같은 글을 달리 읽을 수 있는 형식 */
  alternatives: Dialect[];
  empty: boolean;
}

export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

interface Piece {
  text: string;
  start: number;
  end: number;
}

interface Prepared {
  pieces: Piece[];
  tz: Spec['tz'];
  wrap: 'cron' | 'rate' | null;
  /** cron( … ) 이나 rate( … ) 자리 */
  wrapAt: Piece | null;
  errors: Msg[];
  empty: boolean;
}

/** 줄 · 인용부호 · YAML · 감싼 것을 벗기고, 칸을 위치와 함께 나눈다 */
function prepare(input: string): Prepared {
  let tz: Spec['tz'] = null;
  const errors: Msg[] = [];
  const setTz = (kind: 'CRON_TZ' | 'TZ', name: string, start: number) => {
    tz = { name, kind, start, end: start + name.length };
    if (!isZone(name)) errors.push({ text: `알 수 없는 시간대입니다: ${name}`, start, end: start + name.length, fix: 'Asia/Seoul · America/New_York · UTC 처럼 IANA 이름으로 적으세요' });
  };
  // 첫 줄부터 보면서 빈 줄 · 주석 · 시간대 줄을 건너뛴다 (crontab 을 통째로 붙여넣어도 된다)
  let s = -1;
  let e = -1;
  let pos = 0;
  for (const line of input.split('\n')) {
    const at = pos;
    pos += line.length + 1;
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const env = /^\s*(CRON_TZ|TZ)\s*=\s*["']?([^\s"']+)["']?\s*$/.exec(line);
    if (env) {
      setTz(env[1] as 'CRON_TZ' | 'TZ', env[2], at + line.indexOf(env[2], line.indexOf('=')));
      continue;
    }
    s = at;
    e = at + line.length;
    break;
  }
  if (s < 0) return { pieces: [], tz, wrap: null, wrapAt: null, errors, empty: errors.length === 0 };

  // 감싼 것을 벗기고 안쪽(첫 묶음)만 남긴다
  const cut = (re: RegExp) => {
    const m = new RegExp(re.source, re.flags + 'd').exec(input.slice(s, e));
    if (!m) return false;
    const [a, b] = m.indices![1];
    e = s + b;
    s = s + a;
    return true;
  };
  const trim = () => {
    while (s < e && /\s/.test(input[s])) s++;
    while (e > s && /\s/.test(input[e - 1])) e--;
  };
  trim();
  // GitHub Actions: - cron: '0 9 * * 1-5' · Kubernetes: schedule: "…" · Spring: @Scheduled(cron = "…")
  cut(/^-?\s*(?:cron|schedule)\s*:\s*(.*)$/i);
  trim();
  cut(/^@Scheduled\s*\(.*?cron\s*=\s*"([^"]*)".*\)$/);
  cut(/^"(.*)"$/) || cut(/^'(.*)'$/);
  trim();
  // AWS 설정: ScheduleExpression: cron(…)
  cut(/^(?:"?ScheduleExpression"?\s*[:=]\s*)(.*)$/i);
  cut(/^"(.*)"$/) || cut(/^'(.*)'$/);
  trim();
  // 앞에 붙은 시간대: CRON_TZ=Asia/Seoul 0 9 * * *
  const pre = /^(CRON_TZ|TZ)=(\S+)\s+/.exec(input.slice(s, e));
  if (pre) {
    setTz(pre[1] as 'CRON_TZ' | 'TZ', pre[2], s + pre[1].length + 1);
    s += pre[0].length;
  }
  let wrap: Prepared['wrap'] = null;
  let wrapAt: Piece | null = null;
  const w = /^(cron|rate)\s*\((.*)\)$/i.exec(input.slice(s, e));
  if (w) {
    wrap = w[1].toLowerCase() as 'cron' | 'rate';
    wrapAt = { text: input.slice(s, e), start: s, end: e };
    s += w[0].indexOf('(') + 1;
    e -= 1;
    trim();
  }
  const pieces: Piece[] = [];
  const re = /\S+/g;
  const body = input.slice(s, e);
  for (let m; (m = re.exec(body)); ) pieces.push({ text: m[0], start: s + m.index, end: s + m.index + m[0].length });
  return { pieces, tz, wrap, wrapAt, errors, empty: false };
}

const fail = (text: string, p: { start: number; end: number }, field?: FieldKey, fix?: string): Msg => ({ text, start: p.start, end: p.end, field, fix });

function valueOf(raw: string, key: FieldKey, d: Dialect): number | null {
  const up = raw.toUpperCase();
  if (/^\d+$/.test(up)) return +up;
  if (key === 'month') {
    const i = MONTH_NAMES.indexOf(up);
    return i < 0 ? null : i + 1;
  }
  if (key === 'dow') {
    const i = DOW_NAMES.indexOf(up);
    return i < 0 ? null : sundayIsOne(d) ? i + 1 : i;
  }
  return null;
}

/** 형식의 요일 번호 → 0 = 일요일 */
const normDow = (v: number, d: Dialect) => (sundayIsOne(d) ? v - 1 : v % 7);

function rangeHint(key: FieldKey, d: Dialect, v: number): string | undefined {
  if (key === 'hour' && v === 24) return '자정은 0 입니다';
  if (key === 'min' && v === 60) return '매시 정각은 0 입니다';
  if (key === 'dow' && sundayIsOne(d) && v === 0) return `${d === 'aws' ? 'AWS' : 'Quartz'} 요일은 1(일요일)부터 7(토요일)까지입니다. 일요일은 1 또는 SUN`;
  if (key === 'dow' && !sundayIsOne(d) && v > 7) return '요일은 0(일요일)부터 6(토요일)까지, 7 도 일요일입니다';
  return undefined;
}

interface FieldOut {
  field?: Field;
  error?: Msg;
  warnings: Msg[];
}

function parseField(key: FieldKey, p: Piece, d: Dialect): FieldOut {
  const [lo, hi] = bounds(key, d);
  const name = FIELD_NAME[key];
  const warnings: Msg[] = [];
  const items: Item[] = [];
  let at = p.start;
  for (const raw of p.text.split(',')) {
    const part = { start: at, end: at + raw.length };
    at += raw.length + 1;
    const up = raw.toUpperCase();
    if (!raw) return { error: fail(`${name} 칸에 쉼표 사이가 비었습니다`, { start: part.start - 1, end: part.start + 1 }, key, '1,15 처럼 값 사이에만 쉼표를 씁니다'), warnings };
    if (up === '?') {
      if (key !== 'dom' && key !== 'dow') return { error: fail(`? 는 일 · 요일 칸에만 씁니다`, part, key, `${name} 칸은 * 로 적으세요`), warnings };
      if (d === 'unix') return { error: fail('Unix cron 에는 ? 가 없습니다', part, key, '* 로 적으세요 (? 는 Quartz · Spring · AWS 형식입니다)'), warnings };
      items.push({ kind: 'any', ...part });
      continue;
    }
    const special = key === 'dom' ? /^(L(-\d+)?|LW|WL|\d+W)$/.test(up) : key === 'dow' ? up.includes('#') || /^(L|(\d|[A-Z]{3})L)$/.test(up) : /^(L|LW|\d+W|.*#.*)$/.test(up);
    if (special) {
      if (d === 'unix') return { error: fail(`${raw} 같은 L · W · # 는 Unix cron 에 없습니다`, part, key, 'Quartz · Spring · AWS 형식에서만 씁니다. 형식을 바꾸거나, 명령 안에서 날짜를 확인하세요'), warnings };
      if (key === 'dom') {
        let m = /^L(?:-(\d+))?$/.exec(up);
        if (m) {
          const off = m[1] ? +m[1] : 0;
          if (off > 30) return { error: fail(`L-${off}: 마지막 날에서 30일보다 더 앞으로는 갈 수 없습니다`, part, key), warnings };
          items.push({ kind: 'last', offset: off, ...part });
          continue;
        }
        if (up === 'LW' || up === 'WL') {
          items.push({ kind: 'lastWeekday', ...part });
          continue;
        }
        m = /^(\d+)W$/.exec(up);
        if (m) {
          const day = +m[1];
          if (day < 1 || day > 31) return { error: fail(`${raw}: 날짜는 1~31 사이입니다`, part, key), warnings };
          items.push({ kind: 'nearest', day, ...part });
          continue;
        }
        return { error: fail(`일 칸의 ${j(raw, '을')} 알아볼 수 없습니다`, part, key, 'L (마지막 날) · L-3 (마지막 날 3일 전) · LW (마지막 평일) · 15W (15일에서 가장 가까운 평일)'), warnings };
      }
      if (key === 'dow') {
        let m = /^(\w+)#(\d+)$/.exec(up);
        if (m) {
          const v = valueOf(m[1], 'dow', d);
          const k = +m[2];
          if (v == null || v < lo || v > hi) return { error: fail(`${raw}: # 앞에는 요일을 적습니다`, part, key, rangeHint('dow', d, v ?? -1) ?? (sundayIsOne(d) ? '2#1 = 첫째 월요일 (1 = 일요일)' : '1#1 = 첫째 월요일')), warnings };
          if (k < 1 || k > 5) return { error: fail(`${raw}: # 뒤에는 1~5 (몇째 주) 를 적습니다`, part, key), warnings };
          items.push({ kind: 'nth', wd: normDow(v, d), n: k, ...part });
          continue;
        }
        if (up === 'L') {
          if (d === 'spring') return { error: fail('요일 칸의 L 앞에 요일을 붙이세요', part, key, '5L 또는 FRIL = 그달 마지막 금요일'), warnings };
          // Quartz · AWS: 요일 칸의 L 만 쓰면 한 주의 마지막 날, 토요일
          items.push({ kind: 'range', from: 7, to: 7, step: 1, star: false, open: false, ...part });
          warnings.push(fail('요일 칸의 L 하나는 "토요일" 입니다 (한 주의 마지막 날)', part, key, '그달 마지막 금요일이라면 6L 또는 FRIL'));
          continue;
        }
        m = /^(\w+?)L$/.exec(up);
        if (m) {
          const v = valueOf(m[1], 'dow', d);
          if (v == null || v < lo || v > hi) return { error: fail(`${raw}: L 앞에는 요일을 적습니다`, part, key, rangeHint('dow', d, v ?? -1)), warnings };
          items.push({ kind: 'lastOf', wd: normDow(v, d), ...part });
          continue;
        }
        return { error: fail(`요일 칸의 ${j(raw, '을')} 알아볼 수 없습니다`, part, key, sundayIsOne(d) ? '6L (마지막 금요일) · 2#3 (셋째 월요일)' : '5L (마지막 금요일) · 1#3 (셋째 월요일)'), warnings };
      }
      return { error: fail(`L · W · # 는 일 · 요일 칸에만 씁니다`, part, key), warnings };
    }

    const m = /^(\*|[A-Za-z0-9]+)(?:-([A-Za-z0-9]+))?(?:\/(\w*))?$/.exec(raw);
    if (!m) return { error: fail(`${name} 칸의 ${j(raw, '을')} 알아볼 수 없습니다`, part, key, '숫자 · 범위(1-5) · 목록(1,15) · 간격(*/15) 으로 적습니다'), warnings };
    const star = m[1] === '*';
    if (star && m[2]) return { error: fail(`*-${m[2]}: * 에는 범위를 붙일 수 없습니다`, part, key, `0-${m[2]} 처럼 숫자로 적으세요`), warnings };
    let step = 1;
    if (m[3] !== undefined) {
      if (!/^\d+$/.test(m[3])) return { error: fail(`/ 뒤에는 간격을 숫자로 적습니다`, part, key, '*/15 = 15마다'), warnings };
      step = +m[3];
      if (step < 1) return { error: fail('간격은 1 이상이어야 합니다', part, key, '*/0 은 쓸 수 없습니다'), warnings };
    }
    let from = lo;
    let to = hi;
    if (!star) {
      const a = valueOf(m[1], key, d);
      if (a == null) return { error: fail(`${name} 칸의 ${j(m[1], '을')} 알아볼 수 없습니다`, part, key, key === 'month' ? '1~12 또는 JAN~DEC' : key === 'dow' ? (sundayIsOne(d) ? '1(일)~7(토) 또는 SUN~SAT' : '0(일)~6(토) 또는 SUN~SAT') : `${lo}~${hi} 사이 숫자`), warnings };
      if (a < lo || a > hi) return { error: fail(`${j(name, '은')} ${lo}~${hi} 사이입니다 — ${j(String(a), '은')} 쓸 수 없습니다`, part, key, rangeHint(key, d, a)), warnings };
      from = a;
      to = a;
      if (m[2] !== undefined) {
        const b = valueOf(m[2], key, d);
        if (b == null) return { error: fail(`${name} 칸의 ${j(m[2], '을')} 알아볼 수 없습니다`, part, key), warnings };
        if (b < lo || b > hi) return { error: fail(`${j(name, '은')} ${lo}~${hi} 사이입니다 — ${j(String(b), '은')} 쓸 수 없습니다`, part, key, rangeHint(key, d, b)), warnings };
        to = b;
        const wrapOk = d === 'quartz' || d === 'aws';
        if (to < from && !wrapOk && !(key === 'dow' && to === 0)) {
          return { error: fail(`범위의 시작(${m[1]})이 끝(${m[2]})보다 큽니다`, part, key, `${from}-${hi},${lo}-${to} 처럼 둘로 나눠 적으세요`), warnings };
        }
        // 5-0 (금~일) 처럼 끝을 0 으로 적은 일요일은 7 로 본다
        if (key === 'dow' && to === 0 && from > 0 && !sundayIsOne(d)) to = 7;
      } else if (m[3] !== undefined) {
        to = hi;
        if (d === 'unix') warnings.push(fail(`${raw}: Vixie cron · cronie 는 이렇게 받지만, 받지 않는 cron 도 있습니다`, part, key, `${from}-${hi}/${step} 처럼 끝까지 적으면 어디서나 됩니다`));
      }
    }
    const span = to >= from ? to - from + 1 : hi - from + 1 + (to - lo + 1);
    if (step > 1 && step >= span) warnings.push(fail(`${raw}: 간격(${step})이 범위보다 커서 ${from} 하나만 맞습니다`, part, key, `${from} 하나면 그냥 ${from} 으로 적으세요`));
    items.push({ kind: 'range', from, to, step, star, open: !star && m[2] === undefined && m[3] !== undefined, ...part });
  }

  // 값 펼치기
  const set = new Set<number>();
  for (const it of items) {
    if (it.kind !== 'range') continue;
    const span = it.to >= it.from ? it.to - it.from : hi - it.from + 1 + (it.to - lo);
    for (let k = 0; k <= span; k += it.step) {
      let v = it.from + k;
      if (v > hi) v = v - hi - 1 + lo;
      set.add(key === 'dow' ? normDow(v, d) : v);
    }
  }
  const values = [...set].sort((a, b) => a - b);
  const full = key === 'dow' ? 7 : hi - lo + 1;
  const plain = items.every((it) => it.kind === 'range' || it.kind === 'any');
  const any = items.some((it) => it.kind === 'any');
  if (any && items.length > 1) return { error: fail('? 는 혼자만 씁니다', p, key, '? 를 빼거나 다른 값을 지우세요'), warnings };
  const field: Field = {
    key,
    text: p.text,
    start: p.start,
    end: p.end,
    items,
    values: any ? Array.from({ length: full }, (_, i) => (key === 'dow' ? i : lo + i)) : values,
    all: any || (plain && values.length === full),
    star: p.text.startsWith('*'),
    any,
  };
  return { field, warnings };
}

/** 간격이 범위를 고르게 나누지 못하면 끝에서 처음으로 넘어갈 때 간격이 짧아진다: 분 칸의 *\/45 */
function stepWarnings(f: Field, d: Dialect): Msg[] {
  const out: Msg[] = [];
  const unit = { sec: '초', min: '분', hour: '시간', dom: '일', month: '개월', dow: '', year: '' }[f.key];
  if (!unit) return out;
  const [lo, hi] = bounds(f.key, d);
  for (const it of f.items) {
    if (it.kind !== 'range' || it.step <= 1 || !(it.star || it.open) || it.step >= hi - lo + 1) continue;
    const vals: number[] = [];
    for (let v = it.from; v <= hi; v += it.step) vals.push(v);
    const last = vals[vals.length - 1];
    const wrapGap = hi - last + 1 + (vals[0] - lo);
    if (f.key === 'dom') {
      if (it.step > 1) out.push(fail(`${it.step}일마다가 아니라 그달의 ${vals.slice(0, 4).join(' · ')}… 일입니다. 달이 바뀌면 처음부터 다시 셉니다`, it, f.key, '31일 다음 날 1일처럼 이틀 연속 돌 수 있습니다'));
      continue;
    }
    if (wrapGap === it.step) continue;
    const u = f.key === 'hour' ? '시' : unit;
    out.push(
      fail(
        `${it.step}${unit}마다가 아닙니다 — ${vals.length <= 6 ? vals.join(' · ') : `${vals.slice(0, 3).join(' · ')} … ${last}`}${u}에 돌고, ${last}${u} 다음은 ${j(`${vals[0]}${u}`, '이라서')} 그 사이는 ${wrapGap}${unit}입니다`,
        it,
        f.key,
        f.key === 'min' ? `정말 ${it.step}분 간격이 필요하면 cron 하나로는 적을 수 없습니다. 60 을 나누는 간격(5 · 10 · 15 · 20 · 30)을 쓰거나 여러 줄로 나누세요` : f.key === 'hour' ? '24 를 나누는 간격(2 · 3 · 4 · 6 · 8 · 12)을 쓰세요' : undefined,
      ),
    );
  }
  return out;
}

function build(d: Dialect, fields: Field[], extra: { tz: Spec['tz']; command: Spec['command']; macro: Spec['macro'] }): { spec?: Spec; errors: Msg[] } {
  const f: Partial<Record<FieldKey, Field>> = {};
  for (const x of fields) f[x.key] = x;
  const dom = f.dom!;
  const dow = f.dow!;
  const errors: Msg[] = [];
  const warnings: Msg[] = [];
  if (d === 'quartz' || d === 'aws') {
    const who = d === 'aws' ? 'AWS' : 'Quartz';
    if (dom.any && dow.any) errors.push({ text: `${who} 는 일과 요일을 둘 다 ? 로 비울 수 없습니다`, start: dom.start, end: dow.end, field: 'dow', fix: '하나는 * 로 적으세요. 매일이면 일 칸을 * 로' });
    else if (!dom.any && !dow.any)
      errors.push({
        text: `${who} 는 일과 요일 가운데 하나를 ? 로 비워야 합니다`,
        start: (dom.all ? dom : dow).start,
        end: (dom.all ? dom : dow).end,
        field: dom.all ? 'dom' : 'dow',
        fix: dow.all ? `요일을 따지지 않으면 요일 칸을 ? 로 (${d === 'aws' ? '0 9 * * ? *' : '0 0 9 * * ?'})` : dom.all ? `요일로 고르면 일 칸을 ? 로 (${d === 'aws' ? '0 9 ? * MON-FRI *' : '0 0 9 ? * MON-FRI'})` : '날짜와 요일을 함께 따질 수 없습니다. 하나를 ? 로 비우세요',
      });
    // 1-5 를 월~금으로 착각하기 쉽다
    for (const it of dow.items) if (it.kind === 'range' && !it.star && /^\d/.test(dow.text) && it.from === 1 && it.to === 5) warnings.push({ text: `${who} 에서 1-5 는 일~목요일입니다`, start: it.start, end: it.end, field: 'dow', fix: '월~금이라면 2-6 또는 MON-FRI' });
  }
  if (errors.length) return { errors };
  const both = !dom.all && !dow.all;
  const join: Spec['join'] = d === 'unix' && both && !dom.star && !dow.star ? 'or' : 'and';
  if (d === 'unix' && both) {
    if (join === 'or')
      warnings.push({
        text: `일(${dom.text})과 요일(${dow.text})을 둘 다 정하면 Unix cron 은 둘 중 하나만 맞아도 돕니다`,
        start: dom.start,
        end: dow.end,
        field: 'dow',
        fix: `"${dom.text}일이면서 그 요일" 인 날만 원하면 요일 칸을 * 로 두고 명령 앞에 [ "$(date +\\%u)" = ${dow.values.map((v) => v || 7).join(' -o … ')} ] && 처럼 확인을 붙이세요`,
      });
    else warnings.push({ text: `${dom.star ? '일' : '요일'} 칸이 * 로 시작해서 Vixie cron 은 일과 요일이 둘 다 맞는 날에만 돕니다`, start: dom.start, end: dow.end, field: 'dom', fix: 'cron 마다 다르게 읽을 수 있습니다. 확실하게 하려면 명령 안에서 날짜를 확인하세요' });
  }
  if (d === 'unix' && f.min!.all && !f.hour!.all) warnings.push({ text: `분 칸이 * 라서 ${f.hour!.values.length === 1 ? `${f.hour!.values[0]}시` : '그 시간'} 동안 1분마다 돕니다`, start: f.min!.start, end: f.min!.end, field: 'min', fix: `한 시간에 한 번이면 분 칸을 0 으로 (0 ${f.hour!.text} …)` });
  if (f.sec && f.sec.all) warnings.push({ text: '초 칸이 * 라서 1초마다 돕니다', start: f.sec.start, end: f.sec.end, field: 'sec', fix: '분마다라면 첫 칸을 0 으로' });
  for (const x of fields) warnings.push(...stepWarnings(x, d));
  // 그런 날이 없는 달
  const plainDom = dom.items.every((it) => it.kind === 'range') && !dom.all;
  if (plainDom && Math.max(...dom.values) > 28) {
    const months = f.month!.values;
    const max = (m: number) => (m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31);
    const missing = months.filter((m) => dom.values.every((v) => v > max(m)));
    const sometimes = months.filter((m) => dom.values.some((v) => v > (m === 2 ? 28 : max(m))) && !missing.includes(m));
    if (missing.length === months.length && join === 'and') {
      // 아예 돌지 않는다 — 다음 실행에서 알려 준다
    } else if (dom.values.some((v) => v >= 29)) {
      const big = dom.values.filter((v) => v >= 29);
      if (missing.length || sometimes.length) warnings.push({ text: `${big.join(' · ')}일이 없는 달에는 그날 돌지 않습니다${missing.length && missing.length < 12 ? ` (${missing.join(' · ')}월)` : ''}`, start: dom.start, end: dom.end, field: 'dom', fix: d === 'unix' ? '매달 마지막 날이 필요하면 28-31 에 돌리고 명령 안에서 내일이 1일인지 확인하세요' : '매달 마지막 날은 L 로 적습니다' });
    }
  }
  if (extra.command && /(^|[^\\])%/.test(extra.command.text)) warnings.push({ text: 'crontab 의 명령 안에서 % 는 줄바꿈으로 바뀝니다', start: extra.command.start, end: extra.command.end, field: undefined, fix: 'date +\\%Y 처럼 \\% 로 적으세요' });
  if (extra.tz?.kind === 'TZ') warnings.push({ text: 'TZ= 보다 CRON_TZ= 가 맞습니다 — cronie 는 CRON_TZ 만 읽고, Kubernetes 는 둘 다 받지 않습니다', start: extra.tz.start, end: extra.tz.end, fix: 'Kubernetes 에서는 spec.timeZone 을 쓰세요' });

  const spec: Spec = {
    dialect: d,
    fields,
    f,
    sec: f.sec?.values ?? [0],
    min: f.min!.values,
    hour: f.hour!.values,
    month: f.month!.values,
    years: f.year && !f.year.all ? f.year.values : null,
    dom,
    dow,
    join,
    tz: extra.tz,
    command: extra.command,
    macro: extra.macro,
    special: null,
    warnings,
  };
  return { spec, errors: [] };
}

function tryDialect(d: Dialect, pieces: Piece[], prep: Prepared, input: string): { spec?: Spec; errors: Msg[]; tokens: Token[] } {
  const tokens: Token[] = [];
  const layout = LAYOUT[d];
  let command: Spec['command'] = null;
  let macro: Spec['macro'] = null;

  if (pieces[0]?.text.startsWith('@')) {
    const name = pieces[0].text.toLowerCase();
    if (d === 'quartz' || d === 'aws') return { errors: [fail(`${pieces[0].text} 같은 줄임말은 Unix · Spring 에서만 씁니다`, pieces[0])], tokens };
    if (name === '@reboot') {
      if (d !== 'unix') return { errors: [fail('@reboot 는 Unix crontab 에서만 씁니다', pieces[0])], tokens };
      tokens.push({ key: 'macro', label: '부팅 때', text: pieces[0].text, start: pieces[0].start, end: pieces[0].end });
      const rest = pieces.slice(1);
      if (rest.length) {
        command = { text: input.slice(rest[0].start, rest[rest.length - 1].end), start: rest[0].start, end: rest[rest.length - 1].end };
        tokens.push({ key: 'command', label: '명령', ...command });
      }
      const dummy = build('unix', fakeFields('0 0 * * *', 'unix'), { tz: prep.tz, command, macro: null }).spec!;
      return { spec: { ...dummy, special: { kind: 'reboot' }, macro: { text: pieces[0].text, start: pieces[0].start, end: pieces[0].end, expands: '' } }, errors: [], tokens };
    }
    const exp = MACROS[name];
    if (!exp) return { errors: [fail(`${pieces[0].text} 는 없는 줄임말입니다`, pieces[0], undefined, '@yearly · @monthly · @weekly · @daily · @hourly · @reboot')], tokens };
    macro = { text: pieces[0].text, start: pieces[0].start, end: pieces[0].end, expands: d === 'spring' ? `0 ${exp}` : exp };
    tokens.push({ key: 'macro', label: '줄임말', text: pieces[0].text, start: pieces[0].start, end: pieces[0].end });
    const rest = pieces.slice(1);
    if (d === 'unix' && rest.length) {
      command = { text: input.slice(rest[0].start, rest[rest.length - 1].end), start: rest[0].start, end: rest[rest.length - 1].end };
      tokens.push({ key: 'command', label: '명령', ...command });
    } else if (rest.length) return { errors: [fail('줄임말 뒤에는 칸을 더 적지 않습니다', { start: rest[0].start, end: rest[rest.length - 1].end })], tokens };
    const fields = fakeFields(macro.expands, d, macro);
    const r = build(d, fields, { tz: prep.tz, command, macro });
    return { spec: r.spec, errors: r.errors, tokens };
  }

  const need = layout.length;
  const min = d === 'quartz' ? 6 : need;
  if (pieces.length < min) {
    const names = layout.map((k) => FIELD_NAME[k]).join(' ');
    const got = pieces.length;
    pieces.forEach((p, i) => tokens.push({ key: layout[i], label: FIELD_NAME[layout[i]], ...p }));
    const end = pieces.length ? pieces[pieces.length - 1].end : input.length;
    return { errors: [{ text: `칸이 모자랍니다: ${got}칸을 적었는데 ${DIALECTS.find((x) => x.id === d)!.name} 형식은 ${min === need ? `${need}칸` : `${min}~${need}칸`}(${names})입니다`, start: end, end, fix: got === 4 ? '빠진 칸은 * 로 채우세요' : undefined }], tokens };
  }
  const used = d === 'quartz' ? Math.min(pieces.length, need) : need;
  if (pieces.length > used) {
    if (d !== 'unix') {
      const extra = pieces.slice(used);
      pieces.slice(0, used).forEach((p, i) => tokens.push({ key: layout[i], label: FIELD_NAME[layout[i]], ...p }));
      extra.forEach((p) => tokens.push({ key: 'extra', label: '남는 칸', ...p, bad: true }));
      return { errors: [fail(`칸이 많습니다: ${DIALECTS.find((x) => x.id === d)!.name} 형식은 ${need}칸까지입니다`, { start: extra[0].start, end: extra[extra.length - 1].end }, undefined, d === 'spring' ? 'Spring 은 연도 칸이 없습니다' : undefined)], tokens };
    }
    const rest = pieces.slice(used);
    command = { text: input.slice(rest[0].start, rest[rest.length - 1].end), start: rest[0].start, end: rest[rest.length - 1].end };
  }
  const fieldsP = pieces.slice(0, used);
  const fields: Field[] = [];
  const errors: Msg[] = [];
  const warnings: Msg[] = [];
  fieldsP.forEach((p, i) => {
    const key = layout[i];
    const r = parseField(key, p, d);
    tokens.push({ key, label: FIELD_NAME[key], ...p, bad: !!r.error });
    if (r.error) errors.push(r.error);
    else fields.push(r.field!);
    warnings.push(...r.warnings);
  });
  if (command) tokens.push({ key: 'command', label: '명령', ...command });
  if (errors.length) return { errors, tokens };
  const r = build(d, fields, { tz: prep.tz, command, macro });
  if (r.spec) r.spec.warnings.unshift(...warnings);
  return { spec: r.spec, errors: r.errors, tokens };
}

/** 줄임말을 펼친 칸. 위치는 줄임말 자리를 가리킨다 */
function fakeFields(text: string, d: Dialect, at?: { start: number; end: number }): Field[] {
  const layout = LAYOUT[d];
  return text.split(' ').map((t, i) => parseField(layout[i], { text: t, start: at?.start ?? 0, end: at?.end ?? 0 }, d).field!);
}

/** 6칸이면 어느 형식인지 짐작하는 순서 */
function guess(pieces: Piece[], wrap: Prepared['wrap']): { order: Dialect[]; why: (d: Dialect) => string } {
  const n = pieces.length;
  const q = (i: number) => pieces[i]?.text === '?';
  const why = (d: Dialect) => {
    if (wrap === 'cron') return 'cron( … ) 으로 감싸서 AWS 형식으로 읽었습니다';
    if (pieces[0]?.text.startsWith('@')) return '줄임말이라 Unix 형식으로 읽었습니다';
    if (d === 'unix') return n > 5 ? '5칸 뒤는 실행할 명령으로 읽었습니다' : '5칸이라 Unix 형식(분 시 일 월 요일)으로 읽었습니다';
    if (d === 'aws') return '셋째나 다섯째 칸이 ? 이고 연도 칸이 있어 AWS 형식으로 읽었습니다';
    if (d === 'quartz') return n === 7 ? '7칸이라 Quartz 형식(초 … 연도)으로 읽었습니다' : '? 가 있어 Quartz 형식(초 분 시 일 월 요일)으로 읽었습니다';
    return '6칸이라 맨 앞을 초로 읽었습니다 (Spring)';
  };
  if (wrap === 'cron') return { order: ['aws'], why };
  if (pieces[0]?.text.startsWith('@')) return { order: ['unix', 'spring'], why };
  if (n <= 5) return { order: ['unix'], why };
  if (n === 6) {
    if ((q(2) || q(4)) && !(q(3) || q(5))) return { order: ['aws', 'quartz', 'spring', 'unix'], why };
    if (q(3) || q(5)) return { order: ['quartz', 'spring', 'aws', 'unix'], why };
    return { order: ['spring', 'unix', 'quartz', 'aws'], why };
  }
  if (n === 7) return { order: ['quartz', 'unix'], why };
  return { order: ['unix'], why };
}

function parseRate(prep: Prepared, input: string): Parsed {
  const at = prep.wrapAt!;
  const tokens: Token[] = [{ key: 'wrap', label: 'rate', text: at.text, start: at.start, end: at.end }];
  const body = prep.pieces.map((p) => p.text).join(' ');
  const m = /^(\d+)\s+(minutes?|hours?|days?)$/i.exec(body);
  const base: Parsed = { input, dialect: 'aws', auto: true, why: 'rate( … ) 는 AWS 의 간격 일정입니다', spec: null, errors: [], tokens, alternatives: [], empty: false };
  if (!m) return { ...base, errors: [fail('rate( … ) 안에는 "5 minutes" 처럼 숫자와 단위를 적습니다', at, undefined, 'rate(1 minute) · rate(5 minutes) · rate(1 hour) · rate(7 days)')] };
  const n = +m[1];
  const unit = m[2].toLowerCase().replace(/s$/, '') as 'minute' | 'hour' | 'day';
  if (n < 1) return { ...base, errors: [fail('간격은 1 이상이어야 합니다', at)] };
  const warnings: Msg[] = [];
  if ((n === 1) !== !/s$/i.test(m[2])) warnings.push(fail(n === 1 ? `1 일 때는 ${unit} 로 적어야 AWS 가 받습니다` : `${n} 일 때는 ${unit}s 로 적어야 AWS 가 받습니다`, at));
  const dummy = build('aws', fakeFields('0 0 * * ? *', 'aws'), { tz: null, command: null, macro: null }).spec!;
  return { ...base, spec: { ...dummy, special: { kind: 'rate', n, unit }, warnings } };
}

/** cron 식을 읽는다. want 가 'auto' 면 칸 수와 ? 로 형식을 짐작한다 */
export function parse(input: string, want: Dialect | 'auto' = 'auto'): Parsed {
  const prep = prepare(input);
  const base = { input, auto: want === 'auto', alternatives: [] as Dialect[], empty: prep.empty };
  if (prep.empty) return { ...base, dialect: want === 'auto' ? 'unix' : want, why: '', spec: null, errors: [], tokens: [] };
  if (prep.wrap === 'rate') {
    const r = parseRate(prep, input);
    return { ...r, errors: [...prep.errors, ...r.errors] };
  }
  const tzTok: Token[] = prep.tz ? [{ key: 'tz', label: '시간대', text: prep.tz.name, start: prep.tz.start, end: prep.tz.end, bad: prep.errors.length > 0 }] : [];
  if (!prep.pieces.length) return { ...base, dialect: want === 'auto' ? 'unix' : want, why: '', spec: null, errors: prep.errors.length ? prep.errors : [{ text: '시간대 뒤에 cron 식을 적으세요' }], tokens: tzTok };
  const g = guess(prep.pieces, prep.wrap);
  const order = want === 'auto' ? g.order : [want];
  const tries = order.map((d) => ({ d, r: tryDialect(d, prep.pieces, prep, input) }));
  const ok = tries.find((t) => t.r.spec && !t.r.errors.length);
  const pick = ok ?? tries[0];
  const alternatives = (['unix', 'spring', 'quartz', 'aws'] as Dialect[]).filter((d) => {
    if (d === pick.d || prep.wrap === 'cron') return false;
    const r = tries.find((t) => t.d === d)?.r ?? tryDialect(d, prep.pieces, prep, input);
    return !!r.spec && !r.errors.length;
  });
  const errors = [...prep.errors, ...pick.r.errors];
  const tokens = [...tzTok, ...pick.r.tokens];
  if (prep.wrap === 'cron' && prep.wrapAt) tokens.unshift({ key: 'wrap', label: 'AWS', text: 'cron( )', start: prep.wrapAt.start, end: prep.wrapAt.start + 5 });
  let why = want === 'auto' ? g.why(pick.d) : `${DIALECTS.find((x) => x.id === pick.d)!.name} 형식으로 읽었습니다`;
  if (want === 'auto' && ok && ok.d === 'unix' && ok.r.spec?.command) why = g.why('unix');
  else if (want === 'auto' && ok && ok.d !== g.order[0]) why = `${DIALECTS.find((x) => x.id === g.order[0])!.name} 형식으로는 읽을 수 없어 ${DIALECTS.find((x) => x.id === ok.d)!.name} 형식으로 읽었습니다`;
  return { ...base, dialect: pick.d, why, spec: errors.length ? null : pick.r.spec!, errors, tokens, alternatives };
}

// ── 날짜 맞추기 ──

function lastWeekdayOf(y: number, m: number, len: number): number {
  const wd = weekday(toDay(y, m, len));
  return wd === 6 ? len - 1 : wd === 0 ? len - 2 : len;
}

/** Quartz 의 15W: 그달 안에서 가장 가까운 평일 (달을 넘지 않는다) */
function nearestWeekday(y: number, m: number, day: number, len: number): number | null {
  if (day > len) return null;
  const wd = weekday(toDay(y, m, day));
  if (wd === 6) return day === 1 ? 3 : day - 1;
  if (wd === 0) return day === len ? day - 2 : day + 1;
  return day;
}

function domOk(f: Field, y: number, m: number, d: number, len: number): boolean {
  if (f.all) return true;
  for (const it of f.items) {
    if (it.kind === 'range' && f.values.includes(d)) return true;
    if (it.kind === 'last' && d === len - it.offset) return true;
    if (it.kind === 'lastWeekday' && d === lastWeekdayOf(y, m, len)) return true;
    if (it.kind === 'nearest' && d === nearestWeekday(y, m, it.day, len)) return true;
  }
  return false;
}

function dowOk(f: Field, d: number, len: number, wd: number): boolean {
  if (f.all) return true;
  for (const it of f.items) {
    if (it.kind === 'range' && f.values.includes(wd)) return true;
    if (it.kind === 'nth' && it.wd === wd && Math.ceil(d / 7) === it.n) return true;
    if (it.kind === 'lastOf' && it.wd === wd && d + 7 > len) return true;
  }
  return false;
}

/** 그날 도는지 */
export function dayMatches(spec: Spec, y: number, m: number, d: number): boolean {
  if (!spec.month.includes(m)) return false;
  if (spec.years && !spec.years.includes(y)) return false;
  const len = monthLength(y, m);
  const wd = weekday(toDay(y, m, d));
  const a = domOk(spec.dom, y, m, d, len);
  const b = dowOk(spec.dow, d, len, wd);
  return spec.join === 'or' ? a || b : a && b;
}

// ── 시간대 ──

interface DayZone {
  /** 그날 앞 · 뒤의 UTC 차이 (분) */
  a: number;
  b: number;
  /** 바뀌는 때 (UTC ms), 없으면 null */
  t: number | null;
}

function dayZone(tz: string, y: number, m: number, d: number): DayZone {
  const D = Date.UTC(y, m - 1, d);
  const lo = D - 15 * 3600_000;
  const hi = D + 37 * 3600_000;
  const a = wallOf(tz, lo).offset;
  const b = wallOf(tz, hi).offset;
  if (a === b) return { a, b, t: null };
  let L = lo;
  let H = hi;
  while (H - L > 60_000) {
    const M = Math.floor((L + H) / 120_000) * 60_000;
    if (wallOf(tz, M).offset === a) L = M;
    else H = M;
  }
  return { a, b, t: H };
}

/** 벽시계 → 절대 시각. 없는 시각(서머타임 시작)은 밀린 시각으로, 두 번 오는 시각(서머타임 끝)은 처음 것으로 */
function resolve(z: DayZone, W: number): { utc: number; dst?: 'gap' | 'overlap' } {
  const u1 = W - z.a * 60_000;
  if (z.t == null) return { utc: u1 };
  const u2 = W - z.b * 60_000;
  const ok1 = u1 < z.t;
  const ok2 = u2 >= z.t;
  if (ok1 && ok2) return { utc: Math.min(u1, u2), dst: 'overlap' };
  if (ok1) return { utc: u1 };
  if (ok2) return { utc: u2 };
  return { utc: Math.max(u1, u2), dst: 'gap' };
}

export interface Run {
  utc: number;
  /** 서머타임: gap = 없는 시각이라 밀려서 돈다 · overlap = 두 번 오는 시각이라 한 번만 돈다 */
  dst?: 'gap' | 'overlap';
  /** 원래 정한 벽시계 (gap 일 때 무엇이 밀렸는지) */
  planned: { h: number; mi: number; s: number };
}

export interface Search {
  runs: Run[];
  /** 찾아본 범위 안에서 한 번도 맞지 않았다 */
  never: boolean;
}

/** 이 해만큼 앞(뒤)까지 찾아본다. 2월 29일 · 연도 칸이 있어도 넉넉하다 */
const SEARCH_YEARS = 30;

/**
 * from(UTC ms) 뒤(dir = 1) 또는 앞(dir = -1)의 실행 시각을 count 개.
 * 날짜는 달력 계산만으로 거르고, 맞는 날만 시간대를 따진다.
 */
export function findRuns(spec: Spec, tz: string, from: number, count: number, dir: 1 | -1 = 1): Search {
  if (spec.special) return { runs: [], never: false };
  const out: Run[] = [];
  const seen = new Set<number>();
  const start = wallOf(tz, from);
  const H = dir > 0 ? spec.hour : [...spec.hour].reverse();
  const M = dir > 0 ? spec.min : [...spec.min].reverse();
  const S = dir > 0 ? spec.sec : [...spec.sec].reverse();
  // 하루 앞(뒤)부터: 서머타임으로 밀린 실행이 자정을 넘을 수 있다
  let day = toDay(start.y, start.m, start.d) - dir;
  let matched = false;
  for (let i = 0; i < SEARCH_YEARS * 366 + 2 && out.length < count; i++, day += dir) {
    const { y, m, d } = fromDay(day);
    if (y > 2199 || y < 1970) break;
    if (spec.years && (dir > 0 ? y > spec.years[spec.years.length - 1] : y < spec.years[0])) break;
    if (!dayMatches(spec, y, m, d)) continue;
    matched = true;
    const z = dayZone(tz, y, m, d);
    const need = count - out.length;
    const found: Run[] = [];
    outer: for (const h of H)
      for (const mi of M)
        for (const s of S) {
          const r = resolve(z, Date.UTC(y, m - 1, d, h, mi, s));
          if (dir > 0 ? r.utc <= from : r.utc >= from) continue;
          if (seen.has(r.utc)) continue;
          seen.add(r.utc);
          found.push({ utc: r.utc, dst: r.dst, planned: { h, mi, s } });
          // 시간대가 바뀌지 않는 날은 적은 순서가 곧 시각 순서다
          if (z.t == null && found.length >= need) break outer;
        }
    found.sort((p, q) => (p.utc - q.utc) * dir);
    out.push(...found.slice(0, need));
  }
  out.sort((p, q) => (p.utc - q.utc) * dir);
  return { runs: out.slice(0, count), never: !matched && out.length === 0 };
}

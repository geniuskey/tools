// 식을 다른 형식으로 옮겨 적기, 말로 고르는 빌더, 붙여 넣을 설정 (crontab · GitHub Actions · Kubernetes · Spring · AWS).
import { wallOf } from '../date/zones';
import { DIALECTS, DOW_NAMES, bounds, parse, type Dialect, type Field, type FieldKey, type Item, type Spec } from './core';
import { describe } from './explain';

const nameOf = (d: Dialect) => DIALECTS.find((x) => x.id === d)!.name;

export type Out = { text: string; error?: undefined } | { error: string; text?: undefined };

/** 값 목록을 이어진 묶음으로: [1,2,3,5] → 1-3,5 */
function spanText(values: number[], show: (v: number) => string = String): string {
  const out: string[] = [];
  let i = 0;
  while (i < values.length) {
    let k = i;
    while (k + 1 < values.length && values[k + 1] === values[k] + 1) k++;
    out.push(k === i ? show(values[i]) : k === i + 1 ? `${show(values[i])},${show(values[k])}` : `${show(values[i])}-${show(values[k])}`);
    i = k + 1;
  }
  return out.join(',');
}

function rangeText(it: Extract<Item, { kind: 'range' }>, key: FieldKey, src: Dialect, to: Dialect): string {
  const [lo, hi] = bounds(key, src);
  if (it.star) return it.step > 1 ? `*/${it.step}` : '*';
  if (it.from === it.to && it.step === 1) return `${it.from}`;
  if (it.to < it.from) {
    // 감아 도는 범위(22-2)는 Quartz · AWS 만 받는다
    if (to === 'quartz' || to === 'aws') return `${it.from}-${it.to}${it.step > 1 ? `/${it.step}` : ''}`;
    if (it.step === 1) return `${it.from}-${hi},${lo}-${it.to}`;
    const n = hi - lo + 1;
    const span = (it.to - it.from + n) % n;
    const vals: number[] = [];
    for (let k = 0; k <= span; k += it.step) vals.push(lo + ((it.from - lo + k) % n));
    return vals.sort((x, y) => x - y).join(',');
  }
  if (it.open) return to === 'unix' ? `${it.from}-${hi}/${it.step}` : `${it.from}/${it.step}`;
  return `${it.from}-${it.to}${it.step > 1 ? `/${it.step}` : ''}`;
}

function plainText(f: Field, src: Dialect, to: Dialect): string {
  return f.items.map((it) => (it.kind === 'range' ? rangeText(it, f.key, src, to) : '*')).join(',');
}

/** 요일 번호를 그 형식으로 */
const dowNum = (wd: number, to: Dialect) => (to === 'quartz' || to === 'aws' ? wd + 1 : wd);

function dowText(f: Field, to: Dialect): string {
  const bits: string[] = [];
  const plain = f.items.filter((it) => it.kind === 'range');
  if (plain.length) {
    // Unix 는 숫자(0 = 일요일), 나머지는 1 = 일요일과 헷갈리지 않게 이름으로
    if (to === 'unix') bits.push(spanText(f.values));
    else bits.push(spanText(f.values, (v) => DOW_NAMES[v]));
  }
  for (const it of f.items) {
    // Spring 은 이름이 읽기 쉽고, Quartz · AWS 는 # · L 앞에 숫자를 쓰는 것이 문서의 모양이다
    const w = (wd: number) => (to === 'spring' ? DOW_NAMES[wd] : `${dowNum(wd, to)}`);
    if (it.kind === 'nth') bits.push(`${w(it.wd)}#${it.n}`);
    if (it.kind === 'lastOf') bits.push(`${w(it.wd)}L`);
  }
  return bits.join(',');
}

function domText(f: Field, src: Dialect, to: Dialect): string {
  const bits: string[] = [];
  for (const it of f.items) {
    if (it.kind === 'range') bits.push(rangeText(it, 'dom', src, to));
    if (it.kind === 'last') bits.push(it.offset ? `L-${it.offset}` : 'L');
    if (it.kind === 'lastWeekday') bits.push('LW');
    if (it.kind === 'nearest') bits.push(`${it.day}W`);
  }
  return bits.join(',');
}

const hasSpecial = (f: Field) => f.items.some((it) => it.kind !== 'range' && it.kind !== 'any');

/** 같은 일정을 다른 형식의 식으로 */
export function convert(spec: Spec, to: Dialect): Out {
  if (spec.special) return { error: spec.special.kind === 'reboot' ? '@reboot 는 시각이 아니라 다른 형식으로 옮길 수 없습니다' : 'rate( … ) 는 AWS 에만 있습니다' };
  const src = spec.dialect;
  const T = nameOf(to);
  if (to === src && !spec.macro) {
    const same = spec.fields.map((f) => f.text).join(' ');
    return { text: to === 'aws' ? `cron(${same})` : same };
  }
  const f = spec.f;
  const dom = spec.dom;
  const dow = spec.dow;
  const both = !dom.all && !dow.all;
  if (both) {
    if (spec.join === 'or' && to !== 'unix') return { error: `일과 요일 중 하나만 맞아도 도는 식은 ${T} 형식으로 적을 수 없습니다` };
    if (spec.join === 'and' && to !== 'spring') return { error: to === 'unix' ? 'Unix cron 은 일과 요일을 둘 다 정하면 "둘 중 하나" 로 읽어서, 둘 다 맞는 날은 적을 수 없습니다' : `${T} 는 일과 요일 가운데 하나를 ? 로 비워야 해서 둘 다 따지는 식은 적을 수 없습니다` };
  }
  if (to === 'unix' && (hasSpecial(dom) || hasSpecial(dow))) return { error: 'L · W · # (마지막 날 · 가까운 평일 · 몇째 요일) 은 Unix cron 에 없습니다' };
  const parts: string[] = [];
  if (to === 'spring' || to === 'quartz') parts.push(f.sec ? plainText(f.sec, src, to) : '0');
  else if (spec.sec.length !== 1 || spec.sec[0] !== 0) return { error: `초 단위로 도는 식은 ${T} 형식으로 적을 수 없습니다 (분 단위가 가장 작습니다)` };
  parts.push(plainText(f.min!, src, to), plainText(f.hour!, src, to));
  let d = dom.all ? '*' : domText(dom, src, to);
  let w = dow.all ? '*' : dowText(dow, to);
  if (to === 'quartz' || to === 'aws') {
    if (!dow.all) d = '?';
    else w = '?';
  }
  parts.push(d, plainText(f.month!, src, to), w);
  if (spec.years) {
    if (to !== 'quartz' && to !== 'aws') return { error: `연도를 정한 식은 ${T} 형식으로 적을 수 없습니다` };
    parts.push(f.year!.items.map((it) => (it.kind === 'range' ? rangeText(it, 'year', src, to) : '*')).join(','));
  } else if (to === 'aws') parts.push('*');
  const text = parts.join(' ');
  return { text: to === 'aws' ? `cron(${text})` : text };
}

// ── 빌더 ──

export type Every = 'minute' | 'minutes' | 'hourly' | 'hours' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type MonthMode = 'day' | 'last' | 'lastWeekday' | 'nth';

export interface Plan {
  every: Every;
  /** n분마다 · n시간마다 */
  n: number;
  hour: number;
  minute: number;
  /** 매주: 고른 요일 (0 = 일) */
  days: number[];
  monthMode: MonthMode;
  /** 매달 · 매년: 며칠 */
  day: number;
  /** 몇째 (1~5, 0 = 마지막) 무슨 요일 */
  nth: number;
  nthDay: number;
  /** 매년: 몇 월 */
  month: number;
}

export const EVERY: [Every, string][] = [
  ['minute', '매분'],
  ['minutes', '몇 분마다'],
  ['hourly', '매시'],
  ['hours', '몇 시간마다'],
  ['daily', '매일'],
  ['weekdays', '평일'],
  ['weekly', '매주'],
  ['monthly', '매달'],
  ['yearly', '매년'],
];

export const defaultPlan: Plan = { every: 'daily', n: 15, hour: 9, minute: 0, days: [1], monthMode: 'day', day: 1, nth: 1, nthDay: 1, month: 1 };

/** 말로 고른 일정을 Spring 식(무엇이든 적을 수 있다)으로 쓴 뒤 원하는 형식으로 옮긴다 */
export function planText(p: Plan, to: Dialect): Out {
  const mi = p.minute;
  const h = p.hour;
  let s: string;
  switch (p.every) {
    case 'minute':
      s = '0 * * * * *';
      break;
    case 'minutes':
      s = `0 */${p.n} * * * *`;
      break;
    case 'hourly':
      s = `0 ${mi} * * * *`;
      break;
    case 'hours':
      s = `0 ${mi} */${p.n} * * *`;
      break;
    case 'daily':
      s = `0 ${mi} ${h} * * *`;
      break;
    case 'weekdays':
      s = `0 ${mi} ${h} * * MON-FRI`;
      break;
    case 'weekly':
      if (!p.days.length) return { error: '요일을 하나 이상 고르세요' };
      s = `0 ${mi} ${h} * * ${[...p.days].sort((a, b) => a - b).map((d) => DOW_NAMES[d]).join(',')}`;
      break;
    case 'monthly':
    case 'yearly': {
      const mon = p.every === 'yearly' ? `${p.month}` : '*';
      if (p.monthMode === 'nth') s = `0 ${mi} ${h} * ${mon} ${p.nth ? `${DOW_NAMES[p.nthDay]}#${p.nth}` : `${DOW_NAMES[p.nthDay]}L`}`;
      else s = `0 ${mi} ${h} ${p.monthMode === 'last' ? 'L' : p.monthMode === 'lastWeekday' ? 'LW' : p.day} ${mon} *`;
      break;
    }
  }
  const r = parse(s, 'spring');
  if (!r.spec) return { error: r.errors[0]?.text ?? '만들 수 없습니다' };
  const out = convert(r.spec, to);
  if (out.error && to === 'unix' && (p.every === 'monthly' || p.every === 'yearly')) {
    const wd = p.nthDay || 7;
    const hint =
      p.monthMode === 'nth'
        ? p.nth
          ? `${(p.nth - 1) * 7 + 1}-${p.nth * 7}일에 돌리고 (요일 칸은 * 로) 명령 앞에 [ "$(date +\\%u)" = ${wd} ] && 를 붙입니다`
          : `22-31일에 돌리고 (요일 칸은 * 로) 명령 앞에 [ "$(date +\\%u)" = ${wd} ] && [ "$(date -d '+7 days' +\\%d)" -le 7 ] && 를 붙입니다`
        : p.monthMode === 'last'
          ? '28-31일에 돌리고 명령 앞에 [ "$(date -d tomorrow +\\%d)" = 01 ] && 를 붙입니다'
          : '평일 가운데 그달 마지막 날을 명령 안에서 확인합니다';
    return { error: `${out.error}. 흔히 ${hint}` };
  }
  return out;
}

/** 식이 빌더로 고를 수 있는 모양이면 그 Plan, 아니면 null */
export function planOf(spec: Spec): Plan | null {
  if (spec.special || spec.years) return null;
  if (spec.sec.length !== 1 || spec.sec[0] !== 0) return null;
  const f = spec.f;
  const single = (x: Field | undefined) => !!x && x.values.length === 1 && x.items.length === 1 && x.items[0].kind === 'range';
  const starStep = (x: Field | undefined) => {
    const it = x?.items.length === 1 ? x.items[0] : null;
    return it && it.kind === 'range' && it.star && it.step > 1 ? it.step : 0;
  };
  const p: Plan = { ...defaultPlan, days: [...defaultPlan.days] };
  const anyDay = spec.dom.all && spec.dow.all && spec.month.length === 12;
  if (f.min!.all && f.hour!.all) return anyDay ? { ...p, every: 'minute' } : null;
  const ms = starStep(f.min);
  if (ms && f.hour!.all) return anyDay ? { ...p, every: 'minutes', n: ms } : null;
  if (!single(f.min)) return null;
  p.minute = spec.min[0];
  if (f.hour!.all) return anyDay ? { ...p, every: 'hourly' } : null;
  const hs = starStep(f.hour);
  if (hs) return anyDay ? { ...p, every: 'hours', n: hs } : null;
  if (!single(f.hour)) return null;
  p.hour = spec.hour[0];
  const dom = spec.dom;
  const dow = spec.dow;
  const monthAll = spec.month.length === 12;
  if (!monthAll && !single(f.month)) return null;
  if (!monthAll) p.month = spec.month[0];
  const every: Every = monthAll ? 'monthly' : 'yearly';
  if (dom.all && dow.all) return monthAll ? { ...p, every: 'daily' } : null;
  if (dom.all && !dow.all) {
    const its = dow.items;
    if (its.length === 1 && its[0].kind === 'nth') return { ...p, every, monthMode: 'nth', nth: its[0].n, nthDay: its[0].wd };
    if (its.length === 1 && its[0].kind === 'lastOf') return { ...p, every, monthMode: 'nth', nth: 0, nthDay: its[0].wd };
    if (!monthAll || its.some((it) => it.kind !== 'range')) return null;
    if (dow.values.join() === '1,2,3,4,5') return { ...p, every: 'weekdays' };
    return { ...p, every: 'weekly', days: [...dow.values] };
  }
  if (!dom.all && dow.all) {
    const its = dom.items;
    if (its.length !== 1) return null;
    const it = its[0];
    if (it.kind === 'last' && !it.offset) return { ...p, every, monthMode: 'last' };
    if (it.kind === 'lastWeekday') return { ...p, every, monthMode: 'lastWeekday' };
    if (it.kind === 'range' && single(dom)) return { ...p, every, monthMode: 'day', day: dom.values[0] };
  }
  return null;
}

// ── 붙여 넣을 설정 ──

export interface Utc {
  lines: string[];
  note?: string;
  error?: string;
}

/**
 * 그 시간대의 일정을 UTC 의 Unix 식으로 (GitHub Actions 는 UTC 로만 돈다).
 * 시만 옮기고, 날이 바뀌는 시각은 요일을 하루 옮긴 줄로 따로 적는다.
 */
export function toUtc(spec: Spec, tz: string, now = Date.now()): Utc {
  const unix = convert(spec, 'unix');
  if (unix.text === undefined) return { lines: [], error: unix.error };
  if (tz === 'UTC' || tz === 'Etc/UTC') return { lines: [unix.text] };
  const year = new Date(now).getUTCFullYear();
  const winter = wallOf(tz, Date.UTC(year, 0, 15)).offset;
  const summer = wallOf(tz, Date.UTC(year, 6, 15)).offset;
  const off = wallOf(tz, now).offset;
  if (off === 0 && winter === summer) return { lines: [unix.text] };
  if (off % 60) return { lines: [], error: `UTC 와 ${Math.abs(off % 60)}분 단위로 차이 나는 시간대라 분 칸까지 옮겨야 합니다. 직접 옮겨 적으세요` };
  const k = off / 60;
  const [mi, , d, mo, w] = unix.text.split(' ');
  const groups = new Map<number, number[]>();
  for (const h of spec.hour) {
    const nh = h - k;
    const delta = nh < 0 ? -1 : nh > 23 ? 1 : 0;
    groups.set(delta, [...(groups.get(delta) ?? []), ((nh % 24) + 24) % 24]);
  }
  // 날짜 칸이 같은 줄끼리는 시를 합친다
  const byDays = new Map<string, number[]>();
  for (const [delta, hours] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    if (!delta) {
      byDays.set(`${d} ${mo} ${w}`, [...(byDays.get(`${d} ${mo} ${w}`) ?? []), ...hours]);
      continue;
    }
    if (!spec.dom.all || spec.month.length !== 12) return { lines: [], error: `UTC 로 옮기면 ${delta < 0 ? '전날' : '다음 날'}로 넘어가는 시각이 있는데, 날짜(일 · 월)를 정한 식이라 한 줄로 옮길 수 없습니다. 시간대를 정할 수 있는 곳(Kubernetes · Spring · AWS Scheduler)을 쓰세요` };
    const days = spec.dow.all ? '*' : spanText([...new Set(spec.dow.values.map((v) => (((v + delta) % 7) + 7) % 7))].sort((a, b) => a - b));
    byDays.set(`${d} ${mo} ${days}`, [...(byDays.get(`${d} ${mo} ${days}`) ?? []), ...hours]);
  }
  const lines = [...byDays.entries()].map(([days, hours]) => `${mi} ${hours.length === 24 ? '*' : spanText([...new Set(hours)].sort((a, b) => a - b))} ${days}`);
  const merged = spec.hour.length === 24 ? [unix.text] : lines;
  const note = winter !== summer ? `서머타임이 있는 시간대라 UTC 식 하나로는 여름과 겨울 중 한쪽이 한 시간 어긋납니다. 지금 시차(UTC${k >= 0 ? '+' : ''}${k})로 옮겼습니다` : undefined;
  return { lines: merged, note };
}

export interface Snippet {
  id: 'crontab' | 'github' | 'k8s' | 'spring' | 'aws';
  name: string;
  code?: string;
  note?: string;
  error?: string;
}

export function snippets(spec: Spec, tz: string, now = Date.now()): Snippet[] {
  const what = describe(spec);
  const out: Snippet[] = [];
  const unix = convert(spec, 'unix');
  const cmd = spec.command?.text ?? '/path/to/command';
  out.push(
    unix.text === undefined
      ? { id: 'crontab', name: 'crontab', error: unix.error }
      : { id: 'crontab', name: 'crontab', code: `# ${what}\nCRON_TZ=${tz}\n${unix.text} ${cmd}`, note: 'CRON_TZ 는 cronie(레드햇 계열 · 아치)가 읽습니다. 읽지 않는 cron 은 서버 시간대를 따릅니다.' },
  );
  const utc = toUtc(spec, tz, now);
  if (utc.error) out.push({ id: 'github', name: 'GitHub Actions', error: utc.error });
  else {
    const gaps = spec.min.length > 1 ? Math.min(...spec.min.slice(1).map((v, i) => v - spec.min[i]), 60 - spec.min[spec.min.length - 1] + spec.min[0]) : 60;
    const notes = ['GitHub Actions 는 UTC 로 돌고, 붐빌 때는 몇 분씩 늦거나 건너뜁니다.'];
    if (gaps < 5 && spec.hour.length) notes.push('5분보다 짧은 간격은 받지 않습니다.');
    if (utc.note) notes.push(utc.note + '.');
    out.push({ id: 'github', name: 'GitHub Actions', code: `on:\n  schedule:\n${utc.lines.map((l, i) => `    - cron: '${l}'${i === 0 ? `  # ${tz === 'UTC' ? '' : `${tz} 기준 `}${what}` : ''}`).join('\n')}`, note: notes.join(' ') });
  }
  out.push(
    unix.text === undefined
      ? { id: 'k8s', name: 'Kubernetes', error: unix.error }
      : {
          id: 'k8s',
          name: 'Kubernetes',
          code: `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: my-job\nspec:\n  schedule: "${unix.text}"  # ${what}\n  timeZone: "${tz}"\n  concurrencyPolicy: Forbid\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: OnFailure\n          containers:\n            - name: job\n              image: busybox\n              command: ["date"]`,
          note: 'timeZone 은 Kubernetes 1.27 부터 씁니다. 없으면 kube-controller-manager 의 시간대(보통 UTC)를 따릅니다.',
        },
  );
  const spring = convert(spec, 'spring');
  out.push(spring.text === undefined ? { id: 'spring', name: 'Spring', error: spring.error } : { id: 'spring', name: 'Spring', code: `// ${what}\n@Scheduled(cron = "${spring.text}", zone = "${tz}")\npublic void run() {\n}` });
  const aws = convert(spec, 'aws');
  out.push(
    aws.text === undefined
      ? { id: 'aws', name: 'AWS', error: aws.error }
      : {
          id: 'aws',
          name: 'AWS',
          code: `# ${what}\naws scheduler create-schedule \\\n  --name my-job \\\n  --schedule-expression "${aws.text}" \\\n  --schedule-expression-timezone "${tz}" \\\n  --flexible-time-window Mode=OFF \\\n  --target '{"Arn": "…", "RoleArn": "…"}'`,
          note: 'EventBridge Scheduler 는 시간대를 고를 수 있습니다. EventBridge 규칙(rule)의 cron 은 언제나 UTC 입니다.',
        },
  );
  return out;
}

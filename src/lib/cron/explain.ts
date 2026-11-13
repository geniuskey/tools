// cron 식을 우리말로: 식 전체를 한 문장으로, 그리고 칸마다 한 줄씩.
import { FIELD_NAME, WEEKDAY_KO, bounds, type Field, type FieldKey, type Spec } from './core';

const join = (xs: (string | number)[]) => xs.join(' · ');

/** 오전 9시 · 오후 6시 30분 · 자정 · 정오 */
export function clock(h: number, mi = 0, s = 0): string {
  if (!mi && !s && h === 0) return '자정';
  if (!mi && !s && h === 12) return '정오';
  const hh = h < 12 ? h : h - 12 || 12;
  return `${h < 12 ? '오전' : '오후'} ${hh}시${mi ? ` ${mi}분` : ''}${s ? ` ${s}초` : ''}`;
}

/** 이어지는 값을 묶는다: [1,2,3,5] → [[1,3],[5,5]] */
function spans(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v - 1) last[1] = v;
    else out.push([v, v]);
  }
  return out;
}

/** 1~5 · 10 · 20~25 */
function compact(values: number[], unit: string): string {
  return join(spans(values).map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a} · ${b}` : `${a}~${b}`))) + unit;
}

/** 등차면 간격 */
function arith(values: number[]): number | null {
  if (values.length < 2) return null;
  const d = values[1] - values[0];
  for (let i = 2; i < values.length; i++) if (values[i] - values[i - 1] !== d) return null;
  return d;
}

/** 0 · 15 · 30 · 45분, 많으면 0 · 2 · 4 … 22시 */
function list(values: number[], unit: string, max = 6): string {
  if (values.length <= max) return join(values) + unit;
  if (arith(values) != null) return `${join(values.slice(0, 3))} … ${values[values.length - 1]}${unit}`;
  return `${join(values.slice(0, 4))} … ${values[values.length - 1]}${unit} (${values.length}개)`;
}

/** 범위 끝까지 고르게 도는 간격: *\/15 · 5/15 · 0,15,30,45 */
function periodic(f: Field | undefined, key: FieldKey): { step: number; start: number } | null {
  if (!f || f.items.some((it) => it.kind !== 'range')) return null;
  const v = f.values;
  const step = arith(v);
  if (step == null || step < 2 || v.length < 2) return null;
  const [lo, hi] = bounds(key, 'unix');
  // 처음이 간격보다 작고, 마지막 뒤로 한 번 더 가면 범위를 넘는다 → 끝까지 고르게
  if (v[0] - lo >= step || v[v.length - 1] + step <= hi) return null;
  return { step, start: v[0] };
}

const contiguous = (v: number[]) => v.length > 1 && v[v.length - 1] - v[0] === v.length - 1;

// ── 시각 ──

function timePart(spec: Spec): { text: string; frequent: boolean } {
  const S = spec.sec;
  const M = spec.min;
  const H = spec.hour;
  const count = S.length * M.length * H.length;
  if (count <= 4) {
    const times: string[] = [];
    for (const h of H) for (const mi of M) for (const s of S) times.push(clock(h, mi, s));
    return { text: join(times), frequent: false };
  }
  const lastH = H[H.length - 1];
  const ph = periodic(spec.f.hour, 'hour');
  if (S.length > 1) {
    const ps = periodic(spec.f.sec, 'sec');
    const sp = S.length === 60 ? '매초' : ps ? `${ps.step}초마다` : `매분 ${compact(S, '초')}`;
    if (M.length === 60 && H.length === 24) return { text: sp, frequent: true };
    if (M.length === 60 && contiguous(H)) return { text: `${clock(H[0])}부터 ${clock(lastH, 59, 59)}까지 ${sp}`, frequent: true };
    if (M.length === 60 && H.length === 1) return { text: `${clock(H[0])}부터 ${clock(H[0], 59, 59)}까지 ${sp}`, frequent: true };
    if (M.length === 1 && H.length === 24) return { text: `매시 ${M[0] ? `${M[0]}분` : '정각'}부터 1분 동안 ${sp}`, frequent: true };
    if (M.length === 1 && H.length === 1) return { text: `${clock(H[0], M[0])}부터 1분 동안 ${sp}`, frequent: true };
    return { text: `${H.length === 24 ? '매시' : list(H, '시')} ${M.length === 60 ? '매분' : list(M, '분')}에 ${sp}`, frequent: true };
  }
  const s0 = S[0];
  const sx = s0 ? ` ${s0}초` : '';
  if (M.length === 1) {
    const m0 = M[0];
    const mm = m0 ? `${m0}분` : '정각';
    if (H.length === 24) return { text: `매시 ${mm}${sx}`, frequent: true };
    if (ph) return { text: `${ph.step}시간마다 ${mm}${sx} (${list(H, '시')})`, frequent: true };
    if (contiguous(H)) return { text: `${clock(H[0], m0, s0)}부터 ${clock(lastH, m0, s0)}까지 매시 ${mm}`, frequent: true };
    return { text: `${list(H, '시')} ${mm}${sx}`, frequent: false };
  }
  const pm = periodic(spec.f.min, 'min');
  const everyMin = M.length === 60;
  const minPhrase = everyMin ? '매분' : pm ? `${pm.step}분마다` : `매시 ${compact(M, '분')}`;
  const detail = pm && M.length <= 6 ? ` (매시 ${list(M, '분')})` : '';
  if (H.length === 24) return { text: `${minPhrase}${detail}${sx}`, frequent: true };
  if ((pm || everyMin) && (contiguous(H) || H.length === 1)) return { text: `${clock(H[0], M[0], s0)}부터 ${clock(lastH, M[M.length - 1], s0)}까지 ${minPhrase}`, frequent: true };
  if (contiguous(H)) return { text: `${clock(H[0])}~${clock(lastH)} 사이 ${minPhrase}`, frequent: true };
  if (H.length === 1) return { text: `${clock(H[0])}대 ${minPhrase}`, frequent: true };
  if (ph) return { text: `${ph.step}시간마다 (${list(H, '시')}) ${minPhrase}${detail}`, frequent: true };
  return { text: `${list(H, '시')}에 ${minPhrase}${detail}`, frequent: true };
}

// ── 날짜 ──

/** 월요일부터 세는 순서 */
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

function weekdays(values: number[]): string {
  const set = new Set(values);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((v) => set.has(v))) return '평일';
  if (set.size === 2 && set.has(0) && set.has(6)) return '주말';
  const ordered = MON_FIRST.filter((v) => set.has(v));
  const idx = ordered.map((v) => MON_FIRST.indexOf(v));
  if (ordered.length === 1) return `${WEEKDAY_KO[ordered[0]]}요일`;
  if (ordered.length >= 3 && idx[idx.length - 1] - idx[0] === idx.length - 1) return `${WEEKDAY_KO[ordered[0]]}~${WEEKDAY_KO[ordered[ordered.length - 1]]}요일`;
  return `${join(ordered.map((v) => WEEKDAY_KO[v]))}요일`;
}

const ORD = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];

function domText(f: Field): string {
  const bits: string[] = [];
  const plain = f.items.filter((it) => it.kind === 'range');
  if (plain.length) {
    const p = periodic(f, 'dom');
    if (p && p.step === 2 && p.start === 1) bits.push('홀수 날');
    else if (p && p.step === 2 && p.start === 2) bits.push('짝수 날');
    else if (p) bits.push(`${p.start}일부터 ${p.step}일 간격 (${list(f.values, '일')})`);
    else bits.push(compact(f.values, '일'));
  }
  for (const it of f.items) {
    if (it.kind === 'last') bits.push(it.offset ? `마지막 날 ${it.offset}일 전` : '마지막 날');
    if (it.kind === 'lastWeekday') bits.push('마지막 평일');
    if (it.kind === 'nearest') bits.push(`${it.day}일에서 가장 가까운 평일`);
  }
  return join(bits);
}

/** 요일 칸. 몇째 · 마지막 요일만 있으면 nth = true ("매달 …" 로 시작) */
function dowText(f: Field): { text: string; nth: boolean; group: boolean } {
  const bits: string[] = [];
  const plain = f.items.some((it) => it.kind === 'range');
  let group = false;
  if (plain) {
    const w = weekdays(f.values);
    group = w === '평일' || w === '주말';
    bits.push(w);
  }
  for (const it of f.items) {
    if (it.kind === 'nth') bits.push(`${ORD[it.n]} ${WEEKDAY_KO[it.wd]}요일`);
    if (it.kind === 'lastOf') bits.push(`마지막 ${WEEKDAY_KO[it.wd]}요일`);
  }
  return { text: join(bits), nth: !plain, group };
}

function monthText(f: Field): { text: string; single: boolean } {
  const p = periodic(f, 'month');
  if (p && p.start === 1) return { text: `${p.step}개월마다 (${list(f.values, '월')})`, single: false };
  return { text: compact(f.values, '월'), single: f.values.length === 1 };
}

function datePart(spec: Spec): string {
  const dom = spec.dom.all ? null : domText(spec.dom);
  const dow = spec.dow.all ? null : dowText(spec.dow);
  const mon = spec.month.length === 12 ? null : monthText(spec.f.month!);
  const every = mon?.single ? `매년 ${mon.text}` : mon?.text;
  let day = '';
  if (!dom && !dow) day = mon ? `${mon.text} 매일` : '';
  else if (dom && !dow) day = every ? `${every} ${dom}` : `매달 ${dom}`;
  else if (!dom && dow) {
    if (dow.nth) day = every ? `${every} ${dow.text}` : `매달 ${dow.text}`;
    else {
      const w = dow.group ? dow.text : `매주 ${dow.text}`;
      day = mon ? `${mon.text} ${w}` : w;
    }
  } else if (dom && dow) {
    const d = every ? `${every} ${dom}` : `매달 ${dom}`;
    if (spec.join === 'or') day = `${d} 또는 ${dow.group || dow.nth ? dow.text : `매주 ${dow.text}`}`;
    else day = `${d} 가운데 ${dow.text}인 날`;
  }
  if (spec.years) day = `${compact(spec.years, '년')} ${day || '매일'}`;
  return day;
}

/** 식 전체를 한 문장으로: "평일 오전 9시", "15분마다 (매시 0 · 15 · 30 · 45분)" */
export function describe(spec: Spec): string {
  if (spec.special?.kind === 'reboot') return '컴퓨터가 켜질 때 한 번';
  if (spec.special?.kind === 'rate') {
    const { n, unit } = spec.special;
    return `${n}${{ minute: '분', hour: '시간', day: '일' }[unit]}마다 (일정을 만든 때부터 셉니다)`;
  }
  const t = timePart(spec);
  const d = datePart(spec);
  if (!d) return t.frequent ? t.text : `매일 ${t.text}`;
  return `${d} ${t.text}`;
}

export interface Row {
  key: FieldKey;
  label: string;
  text: string;
  start: number;
  end: number;
  desc: string;
}

function fieldDesc(spec: Spec, f: Field): string {
  const v = f.values;
  switch (f.key) {
    case 'sec': {
      if (f.all) return '매초';
      const p = periodic(f, 'sec');
      if (p) return `${p.step}초마다 — ${list(v, '초')}`;
      if (v.length === 1) return v[0] ? `${v[0]}초` : '0초 (분이 바뀔 때)';
      return compact(v, '초');
    }
    case 'min': {
      if (f.all) return '매분';
      const p = periodic(f, 'min');
      if (p) return `${p.step}분마다 — 매시 ${list(v, '분')}`;
      if (v.length === 1) return v[0] ? `${v[0]}분` : '0분 (정각)';
      return compact(v, '분');
    }
    case 'hour': {
      if (f.all) return '매시';
      const p = periodic(f, 'hour');
      if (p) return `${p.step}시간마다 — ${list(v, '시')}`;
      if (v.length === 1) return `${v[0]}시 (${clock(v[0]).replace(/^(자정|정오)$/, (m) => (m === '자정' ? '오전 0시' : '오후 12시'))})`;
      if (contiguous(v)) return `${v[0]}~${v[v.length - 1]}시 (${clock(v[0])}부터 ${clock(v[v.length - 1])}까지)`;
      return compact(v, '시');
    }
    case 'dom':
      if (f.any) return '? — 날짜는 따지지 않고 요일 칸을 따릅니다';
      if (f.all) return spec.dow.all ? '매일' : spec.dialect === 'unix' ? '* — 날짜는 따지지 않고 요일 칸을 따릅니다' : '매일 (요일 칸과 함께 따집니다)';
      return domText(f);
    case 'month': {
      if (f.all) return '매달';
      return monthText(f).text;
    }
    case 'dow': {
      if (f.any) return '? — 요일은 따지지 않고 일 칸을 따릅니다';
      if (f.all) return spec.dom.all ? '모든 요일' : '* — 요일은 따지지 않습니다';
      const t = dowText(f).text;
      return t === '평일' ? '평일 (월~금요일)' : t === '주말' ? '주말 (토 · 일요일)' : t;
    }
    case 'year':
      return f.all ? '해마다' : compact(v, '년');
  }
}

/** 칸마다 한 줄 */
export function rows(spec: Spec): Row[] {
  if (spec.special) return [];
  return spec.fields.map((f) => ({ key: f.key, label: FIELD_NAME[f.key], text: f.text, start: f.start, end: f.end, desc: fieldDesc(spec, f) }));
}

/** 한 번도 돌지 않는 까닭 */
export function whyNever(spec: Spec, nowYear: number): string {
  if (spec.years && spec.years[spec.years.length - 1] < nowYear) return `정한 연도(${compact(spec.years, '년')})가 모두 지났습니다`;
  const plain = spec.dom.items.every((it) => it.kind === 'range') && !spec.dom.all;
  if (plain && (spec.join === 'and' || spec.dow.all)) {
    const max = (m: number) => (m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31);
    if (spec.month.every((m) => spec.dom.values.every((v) => v > max(m)))) return `${compact(spec.month, '월')}에는 ${compact(spec.dom.values, '일')}이 없습니다`;
  }
  return '앞으로 30년 안에 맞는 날이 없습니다';
}

// 행사 타이머의 계산 부분. 시간은 "끝나는 시각"으로 기억해서 탭이 잠들거나 새로 고쳐도 어긋나지 않는다.

export interface Segment {
  name: string;
  seconds: number;
  /** 시간을 적지 않아 기본값을 쓴 줄 */
  guessed: boolean;
  /** "14:30까지" 처럼 시각으로 끝나는 순서: 자정부터 분. 이때 seconds 는 0 */
  at?: number;
  /** 오전·오후를 안 써서 12시간 뒤일 수도 있는 시각 ("2시까지" → 2:00 또는 14:00) */
  flex?: boolean;
}

export type OverMode = 'count' | 'next' | 'stop';

/** 창끼리 주고받는 상태 전체 */
export interface Shared {
  text: string;
  index: number;
  running: boolean;
  /** 달리는 중: 지금 순서가 끝나는 시각 (epoch ms) */
  endAt: number;
  /** 멈춘 동안: 남은 시간 (ms). 음수면 초과 */
  left: number;
  message: string;
  /** 이만큼 남으면 경고 (초) */
  warn: number;
  over: OverMode;
  sound: boolean;
  clock: boolean;
  /** 지금 순서가 시각에 묶여 있으면 그 시각 (epoch ms). 멈추거나 시간을 조절하면 풀린다 (0) */
  anchor?: number;
  /** 지금 순서의 처음 길이 (ms). 진행 막대에 쓴다 */
  span?: number;
}

export const DEFAULT_SECONDS = 300;
export const sampleText = '여는 말 5\n발표 15\n질의응답 5\n쉬는 시간 10';

const UNIT: Record<string, number> = { 시간: 3600, h: 3600, hr: 3600, 분: 60, m: 60, min: 60, 초: 1, s: 1, sec: 1 };
const PART = '\\d+(?:\\.\\d+)?\\s*(?:시간|hr|h|분|min|m|초|sec|s)';
const TAIL = new RegExp(`(?:^|[\\s,\\t·\\-–:(])((?:${PART}\\s*)+|\\d+:\\d{2}(?::\\d{2})?|\\d+(?:\\.\\d+)?)\\)?\\s*$`, 'i');

/** "1:30" · "90초" · "1시간 30분" · "15"(분) → 초. 읽을 수 없으면 null */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (/^\d+:\d{2}(:\d{2})?$/.test(s)) {
    const p = s.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s * 60);
  let total = 0;
  let rest = s;
  const re = /^(\d+(?:\.\d+)?)\s*(시간|hr|h|분|min|m|초|sec|s)\s*/;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    total += +m[1] * UNIT[m[2]];
    rest = rest.slice(m[0].length);
  }
  return rest === '' && total > 0 ? Math.round(total) : null;
}

// "~14:30" · "@14:30" · "14:30까지" · "오후 2시 반까지" · "2:30pm까지". 앞의 ~ · @ 나 뒤의 '까지' 가 있어야 시각으로 본다
// (그냥 "1:30" 은 지금처럼 1분 30초)
const UNTIL = /(^|[\s,\t·\-–(]|[~@])\s*([~@])?\s*(오전|오후|am|pm)?\s*(\d{1,2})(?::(\d{2})|\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?)?\s*(am|pm)?\s*(까지)?\)?\s*$/i;

/** 줄 끝의 "몇 시까지" → { at: 자정부터 분, flex, cut: 이름이 끝나는 자리 }. 아니면 null */
function parseUntil(t: string): { at: number; flex: boolean; cut: number } | null {
  const m = UNTIL.exec(t);
  if (!m || !(/[~@]/.test(m[1]) || m[2] || m[9])) return null;
  const ampm = (m[3] || m[8] || '').toLowerCase();
  // "~14" 처럼 숫자만 있으면 시각인지 알 수 없다 (9pm 은 된다)
  if (!m[5] && !/시/.test(m[0]) && !ampm) return null;
  let h = +m[4];
  const min = m[5] ? +m[5] : m[6] ? +m[6] : m[7] ? 30 : 0;
  if (min > 59 || h > 23 || (ampm && (h > 12 || h === 0))) return null;
  if (ampm === '오후' || ampm === 'pm') h = h === 12 ? 12 : h + 12;
  else if ((ampm === '오전' || ampm === 'am') && h === 12) h = 0;
  // "09:00" 처럼 0 을 붙였거나 13시 이후면 24시간제로 본다
  const flex = !ampm && h >= 1 && h <= 11 && !m[4].startsWith('0');
  return { at: h * 60 + min, flex, cut: m.index + (/[~@]/.test(m[1]) ? 0 : m[1].length) };
}

/** 넉넉히 이만큼 지난 시각까지는 "오늘의 그 시각" 으로 보고 초과를 센다 */
const GRACE = 3 * 3600_000;

/** 시각으로 끝나는 순서가 실제로 끝나는 때 (epoch ms): ref 에서 GRACE 전 이후 처음 오는 그 시각 */
export function targetAt(seg: Pick<Segment, 'at' | 'flex'>, ref: number): number {
  const mins = seg.flex ? [seg.at!, seg.at! + 720] : [seg.at!];
  let best = Infinity;
  for (const day of [-1, 0, 1, 2])
    for (const mm of mins) {
      const d = new Date(ref);
      d.setDate(d.getDate() + day);
      d.setHours(0, mm, 0, 0);
      const v = d.getTime();
      if (v > ref - GRACE && v < best) best = v;
    }
  return best;
}

/** 한 줄에 순서 하나: "이름 시간". 엑셀에서 붙여넣은 탭 구분도 된다. */
export function parseAgenda(text: string): Segment[] {
  const out: Segment[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const u = parseUntil(t);
    if (u) {
      const name = t.slice(0, u.cut).replace(/[\s,\t·\-–:(]+$/, '').trim();
      out.push({ name: name || `순서 ${out.length + 1}`, seconds: 0, guessed: false, at: u.at, flex: u.flex });
      continue;
    }
    const m = TAIL.exec(t);
    const seconds = m ? parseDuration(m[1]) : null;
    const name = (m && seconds ? t.slice(0, t.length - m[0].length) : t).replace(/[\s,\t·\-–:(]+$/, '').trim();
    out.push({ name: name || `순서 ${out.length + 1}`, seconds: Math.min(seconds || DEFAULT_SECONDS, 24 * 3600), guessed: !seconds });
  }
  return out;
}

/** from 에 시작하는 i 번째 순서가 끝나는 때 · 시각에 묶였으면 그 시각 */
function endOf(agenda: Segment[], i: number, from: number): { end: number; anchor: number } {
  const g = agenda[i];
  if (g?.at != null) {
    const t = targetAt(g, from);
    return { end: t, anchor: t };
  }
  return { end: from + (g?.seconds ?? DEFAULT_SECONDS) * 1000, anchor: 0 };
}

export function initial(text = sampleText, now = Date.now()): Shared {
  const base: Shared = { text, index: 0, running: false, endAt: 0, left: 0, message: '', warn: 60, over: 'count', sound: true, clock: true, anchor: 0, span: 0 };
  return goto(base, parseAgenda(text), 0, now);
}

/** 시각에 묶인 순서는 멈춰 있어도 시계를 따라 줄어든다 (행사 시작 전 대기 화면) */
export const remaining = (s: Shared, now: number) => (s.anchor ? s.anchor - now : s.running ? s.endAt - now : s.left);

export function start(s: Shared, now: number): Shared {
  if (s.running) return s;
  return s.anchor ? { ...s, running: true, endAt: s.anchor } : { ...s, running: true, endAt: now + s.left };
}
/** 멈추면 시각에 묶인 순서도 그 자리에서 얼린다 (이어서 하면 남은 시간부터) */
export function pause(s: Shared, now: number): Shared {
  return s.running ? { ...s, running: false, left: remaining(s, now), anchor: 0 } : s;
}

/** i 번째 순서를 처음부터. 달리는 중이면 계속 달린다. */
export function goto(s: Shared, agenda: Segment[], i: number, now: number): Shared {
  const index = Math.min(Math.max(0, agenda.length - 1), Math.max(0, i));
  const { end, anchor } = endOf(agenda, index, now);
  return { ...s, index, left: end - now, endAt: end, anchor, span: end - now };
}

/** 남은 시간을 늘리거나 줄인다 (0 아래로는 줄이지 않는다). 시각에 묶인 순서는 풀린다. */
export function adjust(s: Shared, delta: number, now: number): Shared {
  const rem = remaining(s, now);
  const next = delta < 0 ? Math.max(Math.min(rem, 0), rem + delta) : rem + delta;
  return s.running ? { ...s, endAt: now + next, anchor: 0 } : { ...s, left: next, anchor: 0 };
}

/** 시간이 다 됐을 때 할 일을 한다. 바뀐 게 없으면 같은 객체를 돌려준다. */
export function advance(s: Shared, agenda: Segment[], now: number): Shared {
  if (!s.running || s.endAt > now || s.over === 'count') return s;
  if (s.over === 'stop') return { ...s, running: false, left: 0, anchor: 0 };
  let { index, endAt } = s;
  let anchor = 0;
  let span = s.span;
  // 늦게 깨어났어도 흘러간 시간만큼 건너뛴다. 이미 지난 시각까지인 순서도 건너뛴다
  while (endAt <= now && index < agenda.length - 1) {
    index++;
    const e = endOf(agenda, index, endAt);
    // 이미 지난 시각까지인 순서는 길이 0 으로 지나간다 (시간을 거꾸로 돌리지 않는다)
    const end = Math.max(e.end, endAt);
    span = end - endAt;
    anchor = e.anchor && end === e.end ? e.anchor : 0;
    endAt = end;
  }
  if (endAt <= now) return { ...s, index, running: false, left: 0, anchor: 0 };
  return { ...s, index, endAt, anchor, span };
}

/** 순서표를 고쳤을 때: 아직 시작하지 않은 순서라면 새 길이를 따른다. */
export function retext(s: Shared, text: string, now: number): Shared {
  const before = parseAgenda(s.text);
  const after = parseAgenda(text);
  const index = Math.min(s.index, Math.max(0, after.length - 1));
  const untouched = !s.running && (!!s.anchor || s.left === (s.span || endOf(before, s.index, now).end - now));
  if (untouched || index !== s.index) return goto({ ...s, text }, after, index, now);
  // 달리는 중에 지금 줄의 시각을 고치면 새 시각을 따른다
  const cur = after[index];
  if (s.anchor && cur?.at != null) {
    const t = targetAt(cur, now);
    return { ...s, text, anchor: t, endAt: t };
  }
  return s.anchor && cur ? { ...s, text, anchor: 0 } : { ...s, text };
}

export type Phase = 'normal' | 'warn' | 'over';
export const phaseOf = (rem: number, warn: number): Phase => (rem <= 0 ? 'over' : rem <= warn * 1000 ? 'warn' : 'normal');

/** 남은 시간 표시. 올림해서 0:00 이 되는 순간이 정확히 끝이다. 초과는 +0:05 */
export function clockText(ms: number): string {
  const over = ms <= -1000;
  const total = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return (over ? '+' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`);
}

/** 자정부터 분 → "14:30" */
export const atText = (at: number) => `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;

/** 순서 길이 표시: "15분" 또는 "14:30까지" */
export const segText = (g: Segment) => (g.at != null ? `${atText(g.at)}까지` : durationText(g.seconds));

export function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}시간`, m && `${m}분`, s && `${s}초`].filter(Boolean).join(' ') || '0초';
}

/** 각 순서가 끝날 것으로 보이는 시각 (지난 순서는 null) */
export function schedule(s: Shared, agenda: Segment[], now: number): (number | null)[] {
  let t = now + Math.max(0, remaining(s, now));
  return agenda.map((seg, i) => {
    if (i < s.index) return null;
    // 시각까지인 순서는 앞이 늦어지면 짧아진다 (이미 지났으면 바로 끝)
    if (i > s.index) t = seg.at != null ? Math.max(t, targetAt(seg, t)) : t + seg.seconds * 1000;
    return t;
  });
}

export function isShared(v: unknown): v is Shared {
  const o = v as Shared;
  return !!o && typeof o.text === 'string' && typeof o.index === 'number' && typeof o.running === 'boolean' && Number.isFinite(o.endAt) && Number.isFinite(o.left) && typeof o.message === 'string';
}

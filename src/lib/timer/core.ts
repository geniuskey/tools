// 행사 타이머의 계산 부분. 시간은 "끝나는 시각"으로 기억해서 탭이 잠들거나 새로 고쳐도 어긋나지 않는다.

export interface Segment {
  name: string;
  seconds: number;
  /** 시간을 적지 않아 기본값을 쓴 줄 */
  guessed: boolean;
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

/** 한 줄에 순서 하나: "이름 시간". 엑셀에서 붙여넣은 탭 구분도 된다. */
export function parseAgenda(text: string): Segment[] {
  const out: Segment[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = TAIL.exec(t);
    const seconds = m ? parseDuration(m[1]) : null;
    const name = (m && seconds ? t.slice(0, t.length - m[0].length) : t).replace(/[\s,\t·\-–:(]+$/, '').trim();
    out.push({ name: name || `순서 ${out.length + 1}`, seconds: Math.min(seconds || DEFAULT_SECONDS, 24 * 3600), guessed: !seconds });
  }
  return out;
}

const dur = (agenda: Segment[], i: number) => (agenda[i]?.seconds ?? DEFAULT_SECONDS) * 1000;

export function initial(text = sampleText): Shared {
  return { text, index: 0, running: false, endAt: 0, left: dur(parseAgenda(text), 0), message: '', warn: 60, over: 'count', sound: true, clock: true };
}

export const remaining = (s: Shared, now: number) => (s.running ? s.endAt - now : s.left);

export function start(s: Shared, now: number): Shared {
  return s.running ? s : { ...s, running: true, endAt: now + s.left };
}
export function pause(s: Shared, now: number): Shared {
  return s.running ? { ...s, running: false, left: s.endAt - now } : s;
}

/** i 번째 순서를 처음부터. 달리는 중이면 계속 달린다. */
export function goto(s: Shared, agenda: Segment[], i: number, now: number): Shared {
  const index = Math.min(Math.max(0, agenda.length - 1), Math.max(0, i));
  return { ...s, index, left: dur(agenda, index), endAt: now + dur(agenda, index) };
}

/** 남은 시간을 늘리거나 줄인다 (0 아래로는 줄이지 않는다). */
export function adjust(s: Shared, delta: number, now: number): Shared {
  const rem = remaining(s, now);
  const next = delta < 0 ? Math.max(Math.min(rem, 0), rem + delta) : rem + delta;
  return s.running ? { ...s, endAt: now + next } : { ...s, left: next };
}

/** 시간이 다 됐을 때 할 일을 한다. 바뀐 게 없으면 같은 객체를 돌려준다. */
export function advance(s: Shared, agenda: Segment[], now: number): Shared {
  if (!s.running || s.endAt > now || s.over === 'count') return s;
  if (s.over === 'stop') return { ...s, running: false, left: 0 };
  let { index, endAt } = s;
  // 늦게 깨어났어도 흘러간 시간만큼 건너뛴다
  while (endAt <= now && index < agenda.length - 1) {
    index++;
    endAt += dur(agenda, index);
  }
  if (endAt <= now) return { ...s, index, running: false, left: 0 };
  return { ...s, index, endAt };
}

/** 순서표를 고쳤을 때: 아직 시작하지 않은 순서라면 새 길이를 따른다. */
export function retext(s: Shared, text: string, now: number): Shared {
  const before = parseAgenda(s.text);
  const after = parseAgenda(text);
  const index = Math.min(s.index, Math.max(0, after.length - 1));
  const untouched = !s.running && s.left === dur(before, s.index);
  if (untouched || index !== s.index) return { ...s, text, index, left: dur(after, index), endAt: now + dur(after, index) };
  return { ...s, text };
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
    if (i > s.index) t += seg.seconds * 1000;
    return t;
  });
}

export function isShared(v: unknown): v is Shared {
  const o = v as Shared;
  return !!o && typeof o.text === 'string' && typeof o.index === 'number' && typeof o.running === 'boolean' && Number.isFinite(o.endAt) && Number.isFinite(o.left) && typeof o.message === 'string';
}

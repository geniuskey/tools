// 시간대. 규칙(서머타임 포함)은 브라우저의 Intl 이 가진 것을 쓰고, 여기서는 벽시계 ↔ 절대 시각 변환과 겹치는 시간 찾기를 한다.

export interface City {
  tz: string;
  /** 우리말 이름 */
  name: string;
  /** 찾을 때 쓰는 말 (나라 · 영어 이름 · 다른 도시) */
  find: string;
}

export const CITIES: City[] = [
  { tz: 'Asia/Seoul', name: '서울', find: '한국 대한민국 korea seoul kst 부산' },
  { tz: 'Asia/Tokyo', name: '도쿄', find: '일본 japan tokyo jst 오사카' },
  { tz: 'Asia/Shanghai', name: '베이징 · 상하이', find: '중국 china beijing shanghai 선전 shenzhen' },
  { tz: 'Asia/Hong_Kong', name: '홍콩', find: 'hong kong hk' },
  { tz: 'Asia/Taipei', name: '타이베이', find: '대만 taiwan taipei' },
  { tz: 'Asia/Singapore', name: '싱가포르', find: 'singapore sg 쿠알라룸푸르 말레이시아' },
  { tz: 'Asia/Ho_Chi_Minh', name: '호찌민 · 하노이', find: '베트남 vietnam hanoi ho chi minh' },
  { tz: 'Asia/Bangkok', name: '방콕', find: '태국 thailand bangkok' },
  { tz: 'Asia/Jakarta', name: '자카르타', find: '인도네시아 indonesia jakarta' },
  { tz: 'Asia/Manila', name: '마닐라', find: '필리핀 philippines manila' },
  { tz: 'Asia/Kolkata', name: '뭄바이 · 벵갈루루', find: '인도 india mumbai bengaluru bangalore delhi 델리 ist' },
  { tz: 'Asia/Dubai', name: '두바이', find: '아랍에미리트 uae dubai abu dhabi 아부다비' },
  { tz: 'Asia/Riyadh', name: '리야드', find: '사우디아라비아 saudi riyadh' },
  { tz: 'Asia/Jerusalem', name: '텔아비브', find: '이스라엘 israel tel aviv' },
  { tz: 'Europe/Istanbul', name: '이스탄불', find: '튀르키예 터키 turkey istanbul' },
  { tz: 'Europe/Moscow', name: '모스크바', find: '러시아 russia moscow' },
  { tz: 'Europe/London', name: '런던', find: '영국 uk england london gmt bst' },
  { tz: 'Europe/Dublin', name: '더블린', find: '아일랜드 ireland dublin' },
  { tz: 'Europe/Paris', name: '파리', find: '프랑스 france paris cet' },
  { tz: 'Europe/Berlin', name: '베를린 · 프랑크푸르트', find: '독일 germany berlin frankfurt munich 뮌헨 cet' },
  { tz: 'Europe/Amsterdam', name: '암스테르담', find: '네덜란드 netherlands amsterdam' },
  { tz: 'Europe/Madrid', name: '마드리드', find: '스페인 spain madrid barcelona 바르셀로나' },
  { tz: 'Europe/Rome', name: '로마 · 밀라노', find: '이탈리아 italy rome milan' },
  { tz: 'Europe/Zurich', name: '취리히', find: '스위스 switzerland zurich geneva 제네바' },
  { tz: 'Europe/Stockholm', name: '스톡홀름', find: '스웨덴 sweden stockholm' },
  { tz: 'Europe/Warsaw', name: '바르샤바', find: '폴란드 poland warsaw' },
  { tz: 'Europe/Budapest', name: '부다페스트', find: '헝가리 hungary budapest' },
  { tz: 'Africa/Cairo', name: '카이로', find: '이집트 egypt cairo' },
  { tz: 'Africa/Johannesburg', name: '요하네스버그', find: '남아프리카 south africa johannesburg' },
  { tz: 'America/New_York', name: '뉴욕', find: '미국 동부 usa new york boston 보스턴 washington 워싱턴 atlanta 애틀랜타 est edt et' },
  { tz: 'America/Chicago', name: '시카고 · 오스틴', find: '미국 중부 usa chicago austin dallas 댈러스 houston 휴스턴 cst cdt ct' },
  { tz: 'America/Denver', name: '덴버', find: '미국 산악 usa denver mst mdt' },
  { tz: 'America/Los_Angeles', name: '샌프란시스코 · 로스앤젤레스', find: '미국 서부 usa san francisco los angeles la seattle 시애틀 실리콘밸리 pst pdt pt' },
  { tz: 'America/Toronto', name: '토론토', find: '캐나다 canada toronto' },
  { tz: 'America/Vancouver', name: '밴쿠버', find: '캐나다 canada vancouver' },
  { tz: 'America/Mexico_City', name: '멕시코시티', find: '멕시코 mexico' },
  { tz: 'America/Sao_Paulo', name: '상파울루', find: '브라질 brazil sao paulo' },
  { tz: 'Pacific/Honolulu', name: '호놀룰루', find: '미국 하와이 hawaii honolulu' },
  { tz: 'Australia/Sydney', name: '시드니 · 멜버른', find: '호주 australia sydney melbourne' },
  { tz: 'Australia/Perth', name: '퍼스', find: '호주 australia perth' },
  { tz: 'Pacific/Auckland', name: '오클랜드', find: '뉴질랜드 new zealand auckland' },
  { tz: 'UTC', name: 'UTC', find: '협정 세계시 gmt utc zulu' },
];

/** 목록에 없는 시간대는 Asia/Almaty → Almaty 처럼 보여 준다 */
export function cityName(tz: string): string {
  return CITIES.find((c) => c.tz === tz)?.name ?? tz.split('/').pop()!.replace(/_/g, ' ');
}

export interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  /** 0 = 일요일 */
  wd: number;
  /** UTC 와의 차이 (분, 서울 +540) */
  offset: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(tz, f);
  }
  return f;
}

export function isZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** 절대 시각(ms) → 그 시간대의 벽시계 */
export function wallOf(tz: string, utc: number): Wall {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(utc)) if (part.type !== 'literal') p[part.type] = +part.value;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, wd: new Date(asUtc).getUTCDay(), offset: Math.round((asUtc - Math.floor(utc / 1000) * 1000) / 60000) };
}

/** 그 시간대의 벽시계 → 절대 시각. 서머타임으로 없는 시각은 한 시간 뒤로 밀린다 */
export function utcOf(tz: string, y: number, m: number, d: number, h = 0, mi = 0): number {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let utc = wall - wallOf(tz, wall).offset * 60000;
  utc = wall - wallOf(tz, utc).offset * 60000;
  return utc;
}

/** +9, −5, +5:30 */
export function fmtOffset(min: number): string {
  const a = Math.abs(min);
  return `${min < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/** 기준보다 얼마나 빠르고 늦은지: "14시간 늦음", "같은 시각" */
export function fmtDiff(min: number): string {
  if (!min) return '같은 시각';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  return `${h ? `${h}시간` : ''}${a % 60 ? `${h ? ' ' : ''}${a % 60}분` : ''} ${min > 0 ? '빠름' : '늦음'}`;
}

export interface Hours {
  /** 근무 시작 · 끝 (자정부터의 분) */
  from: number;
  to: number;
}

export type SlotState = 'work' | 'awake' | 'night';

export interface Slot {
  utc: number;
  /** 시간대마다 그때의 벽시계와 상태 */
  walls: Wall[];
  states: SlotState[];
}

function stateOf(w: Wall, hours: Hours): SlotState {
  const t = w.h * 60 + w.mi;
  if (w.wd !== 0 && w.wd !== 6 && t >= hours.from && t < hours.to) return 'work';
  return t >= 7 * 60 && t < 22 * 60 ? 'awake' : 'night';
}

/** 첫 시간대의 하루(0시~24시)를 step 분 간격으로 나눠, 칸마다 다른 곳은 몇 시인지 */
export function daySlots(zones: string[], y: number, m: number, d: number, hours: Hours, step = 30): Slot[] {
  const start = utcOf(zones[0], y, m, d);
  const end = utcOf(zones[0], y, m, d + 1);
  const out: Slot[] = [];
  for (let utc = start; utc < end; utc += step * 60000) {
    const walls = zones.map((z) => wallOf(z, utc));
    out.push({ utc, walls, states: walls.map((w) => stateOf(w, hours)) });
  }
  return out;
}

export interface Span {
  /** 칸 번호 (to 는 포함하지 않는다) */
  from: number;
  to: number;
}

export interface Overlap {
  /** all: 모두 근무 시간 · awake: 모두 깨어 있는 시간 (근무 밖인 곳이 있다) · none: 누군가는 한밤중 */
  kind: 'all' | 'awake' | 'none';
  spans: Span[];
}

function spansWhere(slots: Slot[], ok: (s: Slot) => boolean): Span[] {
  const out: Span[] = [];
  slots.forEach((s, i) => {
    if (!ok(s)) return;
    const last = out[out.length - 1];
    if (last && last.to === i) last.to = i + 1;
    else out.push({ from: i, to: i + 1 });
  });
  return out;
}

/** 모두 근무 시간인 때를 찾고, 없으면 모두 깨어 있는 때 가운데 근무 중인 곳이 가장 많은 때를 고른다 */
export function findOverlap(slots: Slot[]): Overlap {
  const all = spansWhere(slots, (s) => s.states.every((x) => x === 'work'));
  if (all.length) return { kind: 'all', spans: all };
  const working = (s: Slot) => s.states.filter((x) => x === 'work').length;
  const awake = slots.filter((s) => s.states.every((x) => x !== 'night'));
  if (!awake.length) return { kind: 'none', spans: [] };
  const best = Math.max(...awake.map(working));
  return { kind: 'awake', spans: spansWhere(slots, (s) => s.states.every((x) => x !== 'night') && working(s) === best) };
}

/** 오전 9:30 */
export function fmtClock(h: number, mi: number): string {
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(mi).padStart(2, '0')}`;
}

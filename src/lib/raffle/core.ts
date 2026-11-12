// 추첨 로직. 화면 연출과 무관하게, 당첨자는 여기서 암호학적 난수로 먼저 정해진다.

export interface Participant {
  /** 명단에서의 순번 (1부터) */
  no: number;
  name: string;
  info: string;
  /** 중복 판정용 키 */
  key: string;
}

export interface ParseResult {
  list: Participant[];
  duplicates: number;
}

const HEADER = /^(이름|성명|성함|name|names?|참가자|번호|no\.?)$/i;

/** 한 줄에 한 명. 엑셀에서 복사한 탭 구분, CSV 쉼표 구분 모두 받는다. 첫 칸이 이름, 나머지는 부가 정보(소속 등). */
export function parseParticipants(text: string): ParseResult {
  const list: Participant[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const lines = text.split(/\r?\n/);
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cols = (line.includes('\t') ? line.split('\t') : line.split(','))
      .map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
      .filter(Boolean);
    if (cols.length === 0) continue;
    if (first) {
      first = false;
      if (HEADER.test(cols[0])) continue;
    }
    const name = cols[0];
    const info = cols.slice(1).join(' · ');
    const key = `${name}\u0000${info}`.toLowerCase();
    if (seen.has(key)) duplicates++;
    seen.add(key);
    list.push({ no: list.length + 1, name, info, key });
  }
  return { list, duplicates };
}

/** 완전히 같은 줄(이름+부가 정보)을 한 번만 남긴다. */
export function dedupeText(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let first = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // 머리글 줄은 그대로 둔다
    const parsed = parseParticipants(first ? line : `\n${line}`).list[0];
    first = false;
    const key = parsed?.key ?? `#${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n');
}

export function rangeText(from: number, to: number, prefix = '', suffix = ''): string {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(`${prefix}${i}${suffix}`);
  return out.join('\n');
}

export type RandomSource = (buf: Uint32Array) => void;

const cryptoSource: RandomSource = (buf) => {
  crypto.getRandomValues(buf);
};

/** 0 이상 n 미만의 균등 난수. 나머지 연산의 치우침을 없애기 위해 범위를 벗어난 값은 버리고 다시 뽑는다. */
export function randomInt(n: number, source: RandomSource = cryptoSource): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error('n must be a positive integer');
  if (n === 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    source(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** pool 에서 count 명을 중복 없이 뽑는다 (부분 피셔-예이츠 셔플). 뽑힌 순서가 당첨 순서. */
export function pick<T>(pool: readonly T[], count: number, source: RandomSource = cryptoSource): T[] {
  const a = pool.slice();
  const k = Math.min(count, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(a.length - i, source);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

export interface Winner {
  key: string;
  no: number;
  name: string;
  info: string;
  at: number;
  /** 부재 등으로 취소된 당첨 */
  void?: boolean;
}

export interface Prize {
  id: string;
  name: string;
  count: number;
  winners: Winner[];
}

export const validWinners = (p: Prize) => p.winners.filter((w) => !w.void);
export const remaining = (p: Prize) => Math.max(0, p.count - validWinners(p).length);

/**
 * 이번 경품에서 뽑을 수 있는 사람들.
 * - 이 경품에서 이미 뽑힌 사람(취소 포함)은 항상 제외
 * - allowRepeat 가 아니면 다른 경품 당첨자(취소 포함)도 제외
 */
export function eligible(all: readonly Participant[], prizes: readonly Prize[], prize: Prize, allowRepeat: boolean): Participant[] {
  const out = new Set<string>();
  for (const p of prizes) {
    if (p.id !== prize.id && allowRepeat) continue;
    for (const w of p.winners) out.add(w.key);
  }
  return all.filter((x) => !out.has(x.key));
}

export function maskName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return name;
  if (chars.length === 2) return chars[0] + '＊';
  return chars[0] + '＊'.repeat(chars.length - 2) + chars[chars.length - 1];
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultsCsv(prizes: readonly Prize[]): string {
  const rows = [['경품', '순서', '이름', '부가 정보', '명단 번호', '추첨 시각', '상태']];
  for (const p of prizes) {
    let n = 0;
    for (const w of p.winners) {
      rows.push([
        p.name,
        w.void ? '' : String(++n),
        w.name,
        w.info,
        String(w.no),
        new Date(w.at).toLocaleString('ko-KR'),
        w.void ? '취소' : '당첨',
      ]);
    }
  }
  // 엑셀이 한글을 제대로 읽도록 BOM 을 붙인다
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function resultsText(prizes: readonly Prize[]): string {
  return prizes
    .filter((p) => validWinners(p).length)
    .map((p) => `[${p.name}]\n` + validWinners(p).map((w, i) => `${i + 1}. ${w.name}${w.info ? ` (${w.info})` : ''}`).join('\n'))
    .join('\n\n');
}

const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민'.split('');
const GIVEN = [
  '하늘', '서연', '민준', '지우', '도윤', '서윤', '예준', '하은', '시우', '지호', '수아', '주원', '지유', '건우', '채원',
  '현우', '다은', '우진', '유나', '선우', '소율', '연우', '예린', '정우', '수빈', '승현', '지민', '준서', '은서', '태윤',
  '가은', '민재', '윤서', '시현', '나연', '동현', '혜원', '재윤', '유진', '성민', '아린', '준혁', '소연', '지환', '미래',
];
const TEAMS = ['기획팀', '개발1팀', '개발2팀', '디자인팀', '영업팀', '인사팀', '재무팀', '마케팅팀', '고객지원팀', '품질팀'];

/** 체험용 예시 명단 */
export function sampleText(n = 300): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = SURNAMES[(i * 7 + Math.floor(i / SURNAMES.length)) % SURNAMES.length];
    const g = GIVEN[(i * 13 + Math.floor(i / 5)) % GIVEN.length];
    out.push(`${s}${g}\t${TEAMS[(i * 3 + Math.floor(i / 11)) % TEAMS.length]}`);
  }
  return dedupeText(out.join('\n'));
}

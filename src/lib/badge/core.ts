// 이름표 · 좌석표 계산. 종이에 칸 놓기, 글자 크기 맞추기, 자리 배치 — 화면(DOM) 없이 돌아간다. 길이는 모두 mm.
import type { Participant } from '../raffle/core';
import { attrsOf, shuffle, splitTeams, teamSizes, type Rand } from '../team/core';

// ── 종이와 칸 ─────────────────────────────────────────────────────────────

export type PaperId = 'A4' | 'Letter';
export interface Paper {
  id: PaperId;
  name: string;
  w: number;
  h: number;
}
export const PAPERS: Record<PaperId, Paper> = {
  A4: { id: 'A4', name: 'A4 (210×297mm)', w: 210, h: 297 },
  Letter: { id: 'Letter', name: 'Letter (216×279mm)', w: 215.9, h: 279.4 },
};

/** 한 장에 칸을 어떻게 놓는가 */
export interface Grid {
  pageW: number;
  pageH: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  left: number;
  top: number;
  gapX: number;
  gapY: number;
  /** 접는 명패: 한 장을 반으로 접고, 위쪽 반은 뒤집어 찍는다 */
  tent: boolean;
}

export interface Preset {
  id: string;
  kind: '명찰' | '라벨';
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  gapX: number;
  gapY: number;
}

/** 상표 이름 대신 크기로 고른다. 여백은 종이 가운데에 오게 계산한다 (시중 라벨 용지가 그렇게 나온다). */
export const PRESETS: Preset[] = [
  { id: '90x55', kind: '명찰', cellW: 90, cellH: 55, cols: 2, rows: 5, gapX: 0, gapY: 0 },
  { id: '100x70', kind: '명찰', cellW: 100, cellH: 70, cols: 2, rows: 4, gapX: 0, gapY: 0 },
  { id: '99.1x67.7', kind: '라벨', cellW: 99.1, cellH: 67.7, cols: 2, rows: 4, gapX: 2.5, gapY: 0 },
  { id: '99.1x38.1', kind: '라벨', cellW: 99.1, cellH: 38.1, cols: 2, rows: 7, gapX: 2.5, gapY: 0 },
  { id: '63.5x38.1', kind: '라벨', cellW: 63.5, cellH: 38.1, cols: 3, rows: 7, gapX: 2.5, gapY: 0 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
/** 화면에 보여 줄 mm (필요할 때만 소수) */
export const mm = (n: number) => String(Math.round(n * 10) / 10);

export const presetName = (p: Preset) => `${p.kind} ${mm(p.cellW)}×${mm(p.cellH)}mm (${p.cols}×${p.rows}칸)`;

/** 규격을 종이 가운데에 놓는다. 종이가 작아 다 못 넣으면 들어가는 만큼만 줄인다 (Letter 에 A4 규격). */
export function presetGrid(p: Preset, paper: Paper): Grid {
  const fit = (page: number, cell: number, gap: number, want: number) => Math.max(1, Math.min(want, Math.floor((page + gap + 1e-6) / (cell + gap))));
  const cols = fit(paper.w, p.cellW, p.gapX, p.cols);
  const rows = fit(paper.h, p.cellH, p.gapY, p.rows);
  return {
    pageW: paper.w,
    pageH: paper.h,
    cellW: p.cellW,
    cellH: p.cellH,
    cols,
    rows,
    left: r2((paper.w - cols * p.cellW - (cols - 1) * p.gapX) / 2),
    top: r2((paper.h - rows * p.cellH - (rows - 1) * p.gapY) / 2),
    gapX: p.gapX,
    gapY: p.gapY,
    tent: false,
  };
}

/** 접는 명패: 종이를 가로로 놓고 가운데를 접는다. 한 장에 한 사람. */
export function tentGrid(paper: Paper): Grid {
  return { pageW: paper.h, pageH: paper.w, cellW: paper.h, cellH: paper.w / 2, cols: 1, rows: 1, left: 0, top: 0, gapX: 0, gapY: 0, tent: true };
}

export interface CustomSheet {
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  top: number;
  left: number;
  gapX: number;
  gapY: number;
}
export const DEFAULT_CUSTOM: CustomSheet = { cellW: 85, cellH: 54, cols: 2, rows: 5, top: 13.5, left: 20, gapX: 0, gapY: 0 };

export function customGrid(c: CustomSheet, paper: Paper): Grid {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    pageW: paper.w,
    pageH: paper.h,
    cellW: n(c.cellW),
    cellH: n(c.cellH),
    cols: Math.floor(n(c.cols)),
    rows: Math.floor(n(c.rows)),
    left: n(c.left),
    top: n(c.top),
    gapX: n(c.gapX),
    gapY: n(c.gapY),
    tent: false,
  };
}

/** 칸이 종이에 들어가는가. 안 들어가면 까닭을 우리말로 돌려준다. */
export function checkGrid(g: Grid): string | null {
  if (!(g.cellW > 0 && g.cellH > 0)) return '칸 너비와 높이는 0보다 커야 합니다.';
  if (!(g.cols >= 1 && g.rows >= 1)) return '가로 · 세로 칸 수는 1 이상이어야 합니다.';
  if (g.left < 0 || g.top < 0 || g.gapX < 0 || g.gapY < 0) return '여백과 간격은 0 이상이어야 합니다.';
  if (g.cellW < 15 || g.cellH < 10) return '칸이 너무 작습니다. 너비 15mm, 높이 10mm 이상으로 잡아 주세요.';
  const needW = g.left + g.cols * g.cellW + (g.cols - 1) * g.gapX;
  const needH = g.top + g.rows * g.cellH + (g.rows - 1) * g.gapY;
  const over: string[] = [];
  if (needW > g.pageW + 0.01) over.push(`가로로 ${mm(needW - g.pageW)}mm (필요한 너비 ${mm(needW)}mm, 종이 ${mm(g.pageW)}mm)`);
  if (needH > g.pageH + 0.01) over.push(`세로로 ${mm(needH - g.pageH)}mm (필요한 높이 ${mm(needH)}mm, 종이 ${mm(g.pageH)}mm)`);
  if (over.length) return `칸이 종이를 넘어갑니다: ${over.join(', ')}. 칸 크기나 칸 수, 여백을 줄여 주세요.`;
  return null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 한 장의 칸 자리 (왼쪽 위부터 오른쪽으로, 다음 줄로) */
export function cellRects(g: Grid): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) out.push({ x: r2(g.left + c * (g.cellW + g.gapX)), y: r2(g.top + r * (g.cellH + g.gapY)), w: g.cellW, h: g.cellH });
  return out;
}

export const perPage = (g: Grid) => Math.max(1, g.cols * g.rows);

/**
 * 사람을 장마다 칸에 놓는다. start(1부터)는 첫 장에서 몇 번째 칸부터 쓰는가 — 쓰다 남은 라벨 용지용.
 * 돌려주는 값: 장마다 칸 수만큼의 배열, 값은 사람의 자리(0부터) 또는 빈칸(null).
 */
export function paginate(count: number, g: Grid, start = 1): (number | null)[][] {
  const per = perPage(g);
  const skip = Math.max(0, Math.min(per - 1, Math.floor(start || 1) - 1));
  const pages: (number | null)[][] = [];
  if (count <= 0) return pages;
  const total = Math.ceil((count + skip) / per);
  for (let p = 0; p < total; p++) {
    const page: (number | null)[] = [];
    for (let i = 0; i < per; i++) {
      const idx = p * per + i - skip;
      page.push(idx >= 0 && idx < count ? idx : null);
    }
    pages.push(page);
  }
  return pages;
}

// ── 글자 크기 맞추기 ──────────────────────────────────────────────────────

/** 글자 크기가 size 일 때 text 의 너비 (size 와 같은 단위). 브라우저에서는 캔버스로, 테스트에서는 글자 수로 잰다. */
export type Measure = (text: string, size: number) => number;

const REF = 100;
const unit = (measure: Measure, text: string) => measure(text, REF) / REF;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

export const NAME_LINE = 1.16;
export const INFO_LINE = 1.28;

/** 짧은 이름은 글자 사이를 벌려 준다 (글자 수 → em). 띄어쓰기가 있는 이름은 그대로. */
export function nameSpacing(name: string): number {
  const chars = [...name.trim()];
  if (chars.some((c) => /\s/.test(c))) return 0;
  return chars.length === 2 ? 0.5 : chars.length === 3 ? 0.2 : chars.length === 4 ? 0.06 : 0;
}

export interface NameFit {
  /** 글자 크기 */
  size: number;
  /** 글자 사이 (em) */
  spacing: number;
  lines: string[];
}

/** 띄어쓰기 자리에서 두 줄로 나눈 것 가운데 긴 쪽이 가장 짧은 것 */
function bestSplit(measure: Measure, text: string, anywhere = false): [string, string] | null {
  let best: [string, string] | null = null;
  let bestW = Infinity;
  const chars = [...text];
  for (let i = 1; i < chars.length; i++) {
    if (!anywhere && !/\s/.test(chars[i])) continue;
    const a = chars.slice(0, i).join('').trim().replace(/\s*·$/, '');
    const b = chars.slice(i).join('').trim().replace(/^·\s*/, '');
    if (!a || !b) continue;
    const w = Math.max(unit(measure, a), unit(measure, b));
    if (w < bestW) (bestW = w), (best = [a, b]);
  }
  return best;
}

/**
 * 이름을 칸 너비에 꽉 차게. 높이가 허락하는 가장 큰 크기에서 시작해 너비에 맞게 줄인다.
 * 많이 줄여야 하는 긴 이름은 띄어쓰기에서 두 줄로 나눠 본다.
 */
export function fitName(name: string, boxW: number, boxH: number, measure: Measure, max = Infinity): NameFit {
  const text = name.trim().replace(/\s+/g, ' ');
  if (!text || boxW <= 0 || boxH <= 0) return { size: 0, spacing: 0, lines: text ? [text] : [] };
  const spacing = nameSpacing(text);
  const n = [...text].length;
  const cap = Math.min(max, boxH / NAME_LINE);
  const one = Math.min(cap, boxW / (unit(measure, text) + spacing * (n - 1)));
  if (one < cap * 0.6) {
    const split = bestSplit(measure, text);
    if (split) {
      const two = Math.min(max, boxH / (2 * NAME_LINE), boxW / Math.max(unit(measure, split[0]), unit(measure, split[1])));
      if (two > one * 1.15) return { size: floor2(two), spacing: 0, lines: split };
    }
  }
  return { size: floor2(one), spacing, lines: [text] };
}

export interface InfoFit {
  size: number;
  lines: string[];
}

/** 소속 · 직함: 한 줄에 안 들어가면 두 줄로, 그래도 넘치면 줄인다. 가장 작은 크기에서도 넘치면 끝을 … 로 줄인다. */
export function fitInfo(info: string, boxW: number, measure: Measure, size: number, min = size * 0.6): InfoFit {
  const text = info.trim().replace(/\s+/g, ' ');
  if (!text || boxW <= 0) return { size, lines: [] };
  const fits = (t: string, s: number) => measure(t, s) <= boxW;
  let s = size;
  for (;;) {
    if (fits(text, s)) return { size: floor2(s), lines: [text] };
    const split = bestSplit(measure, text) ?? bestSplit(measure, text, true);
    if (split && fits(split[0], s) && fits(split[1], s)) return { size: floor2(s), lines: split };
    if (s <= min) break;
    s = Math.max(min, s * 0.94);
  }
  // 끝까지 안 들어간다: 첫 줄을 채우고 나머지는 … 로
  const chars = [...text];
  let cut = chars.length;
  while (cut > 1 && !fits(chars.slice(0, cut).join('').trim(), s)) cut--;
  const first = chars.slice(0, cut).join('').trim();
  let rest = chars.slice(cut).join('').trim();
  while (rest.length > 1 && !fits(rest + '…', s)) rest = [...rest].slice(0, -1).join('').trim();
  return { size: floor2(s), lines: [first, rest + '…'] };
}

export type Band = 'top' | 'side' | 'none';

export interface BadgeContent {
  name: string;
  info: string;
  event: string;
  band: Band;
  /** 아래 줄(번호 · 테이블)을 보이는가 */
  foot: boolean;
  qr: boolean;
  /** 로고의 가로/세로 비. 없으면 0 */
  logoAspect: number;
  /** 사람마다 고친 이름 크기 (1 = 알아서) */
  scale?: number;
}

export interface BadgeLayout {
  pad: number;
  /** 위 띠(행사 이름) 높이. 없으면 0 */
  headH: number;
  eventSize: number;
  /** 옆 띠 너비. 없으면 0 */
  sideW: number;
  footH: number;
  footSize: number;
  logoW: number;
  logoH: number;
  /** QR 한 변. 없으면 0 */
  qr: number;
  /** 이름과 소속이 들어가는 상자 */
  text: Rect;
  name: NameFit;
  info: InfoFit;
  /** 이름과 소속 사이 */
  gap: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 이름표 한 칸 안의 배치. 칸 크기에 비례하므로 작은 라벨부터 접는 명패까지 같은 규칙으로 그린다. */
export function badgeLayout(w: number, h: number, c: BadgeContent, measure: Measure, bold: Measure = measure): BadgeLayout {
  const pad = clamp(Math.min(w, h) * 0.07, 1.5, 9);
  const sideW = c.band === 'side' ? clamp(w * 0.05, 2.5, 12) : 0;
  const event = c.event.trim();
  const hasLogo = c.logoAspect > 0;
  let headH = 0;
  if (event || hasLogo) headH = c.band === 'top' ? clamp(h * 0.2, 5, 24) : clamp(h * 0.17, 4.5, 20);
  else if (c.band === 'top') headH = clamp(h * 0.09, 2.5, 10);
  const logoH = hasLogo ? headH * (c.band === 'top' ? 0.66 : 0.8) : 0;
  const logoW = hasLogo ? Math.min(logoH * c.logoAspect, w * 0.3) : 0;
  const innerW = w - sideW - pad * 2;
  const eventW = innerW - (logoW ? logoW + pad * 0.5 : 0);
  const eventSize = event ? floor2(Math.min(headH * 0.46, eventW / unit(bold, event))) : 0;

  const footH = c.foot ? clamp(h * 0.11, 2.8, 10) : 0;
  const footSize = floor2(footH * 0.66);
  const topGap = headH && c.band === 'top' ? pad * 0.45 : headH ? 0 : pad * 0.8;
  const bottomGap = footH ? pad * 0.45 + footH + pad * 0.2 : pad * 0.8;
  const textH = Math.max(0, h - headH - topGap - bottomGap);
  const qr = c.qr ? floor2(Math.max(0, Math.min(textH, w * 0.3, 45))) : 0;
  const text: Rect = { x: sideW + pad, y: headH + topGap, w: Math.max(0, innerW - (qr ? qr + pad * 0.6 : 0)), h: textH };

  const infoBase = clamp(text.h * 0.17, 2.1, 11);
  const info = c.info.trim() ? fitInfo(c.info, text.w, measure, infoBase, Math.max(1.7, infoBase * 0.6)) : { size: infoBase, lines: [] };
  const gap = info.lines.length ? Math.min(text.h * 0.05, info.size * 0.5) : 0;
  const nameH = text.h - gap - info.lines.length * info.size * INFO_LINE;
  // 칸에 꽉 차되 가장자리에 붙지 않게 너비의 92% 까지만 쓴다
  const name = fitName(c.name, text.w * 0.92, Math.max(0, nameH), bold);
  const scale = c.scale && c.scale > 0 ? c.scale : 1;
  if (scale !== 1) name.size = floor2(name.size * scale);
  return { pad, headH, eventSize, sideW, footH, footSize, logoW, logoH, qr, text, name, info, gap };
}

/** QR 내용 틀의 {이름} {소속} {번호} 를 그 사람 것으로 바꾼다 */
export function fillTemplate(tpl: string, p: { name: string; info: string; no: number }): string {
  return tpl.replace(/\{\s*(이름|소속|번호)\s*\}/g, (_, k: string) => (k === '이름' ? p.name : k === '소속' ? p.info : String(p.no)));
}

// ── 좌석 ──────────────────────────────────────────────────────────────────

export type Shape = 'round' | 'long' | 'pod' | 'rows';
export type Method = 'order' | 'random' | 'mix' | 'group';

export interface Seat {
  name: string;
  info: string;
  key: string;
}
/** 앉지 못하는 자리: closed 는 그대로 보이되 비워 두고, gone 은 치워서 배치도에 그리지 않는다 */
export type SeatOff = 'closed' | 'gone';
export interface SeatTable {
  name: string;
  /** 자리 수만큼. 빈 자리는 null */
  seats: (Seat | null)[];
  /** 격자(열 · 행)에서 몇 번째 칸인가. 치운 테이블이 있으면 번호가 건너뛴다. 없으면 배열 순서 */
  slot?: number;
  /** 자리마다 앉지 못하는지 */
  off?: (SeatOff | null)[];
}

/**
 * 손으로 막거나 치운 것. 열쇠는 격자 칸 번호(slot) — "3" 은 그 테이블을 치움, "3:2" 는 그 테이블 3번째 자리.
 * 테이블 수만 바뀌면 그대로 쓰고, 모양 · 열 · 자리 수가 바뀌면 비운다.
 */
export type Offs = Record<string, SeatOff | 'removed'>;
export const offKey = (slot: number, seat?: number) => (seat == null ? `${slot}` : `${slot}:${seat}`);
export const slotOf = (t: SeatTable, i: number) => t.slot ?? i;

/** 격자 칸 count 개 가운데 남은 칸과 칸마다 막힌 자리 */
export function openSlots(offs: Offs, count: number, seats: number): { slots: number[]; off: (SeatOff | null)[][] } {
  const slots = Array.from({ length: count }, (_, i) => i).filter((i) => offs[offKey(i)] !== 'removed');
  const off = slots.map((slot) => Array.from({ length: seats }, (_, s) => {
    const v = offs[offKey(slot, s)];
    return v === 'closed' || v === 'gone' ? v : null;
  }));
  return { slots, off };
}
export const openCount = (off: readonly (SeatOff | null)[][]) => off.reduce((n, o) => n + o.filter((x) => !x).length, 0);

/** 이 인원이 앉으려면 테이블(줄)이 몇 개 있어야 하는가 */
export const suggestTables = (people: number, seats: number) => Math.max(1, Math.ceil(people / Math.max(1, Math.floor(seats) || 1)));

export interface SeatOptions {
  /** 테이블 수 (줄 맞춤이면 줄 수) */
  tables: number;
  /** 테이블마다 자리 수 (줄 맞춤이면 한 줄의 자리 수) */
  seats: number;
  method: Method;
  /** 테이블마다 앉을 수 있는 자리 수 (막은 자리를 뺀). 없으면 모두 seats */
  caps?: number[];
  /** 앞에서부터 꽉 채운다 (줄 맞춤). 아니면 테이블마다 고르게 */
  front?: boolean;
  apart?: number[][];
  together?: number[][];
  rand?: Rand;
}

export interface SeatResult {
  /** 테이블마다 사람의 자리(0부터). 길이는 늘 tables */
  tables: number[][];
  /** 끝내 같은 테이블이 된 '떨어뜨릴' 쌍 */
  unmet: [number, number][];
  /** 자리가 모자라 앉지 못한 사람 */
  left: number[];
}

/** 테이블마다 몇 명씩 앉는가 */
export function tableSizes(people: number, tables: number, seats: number, front = false): number[] {
  const k = Math.max(1, Math.floor(tables) || 1);
  const s = Math.max(1, Math.floor(seats) || 1);
  return fillSizes(people, Array(k).fill(s), front);
}

/**
 * 테이블마다 앉을 수 있는 자리(caps)가 다를 때 몇 명씩 앉는가.
 * front 면 앞 테이블부터 꽉 채우고, 아니면 자리가 남는 테이블끼리 인원 차이가 많아야 1명이 되게.
 */
export function fillSizes(people: number, caps: readonly number[], front = false): number[] {
  const c = caps.map((x) => Math.max(0, Math.floor(x) || 0));
  let n = Math.min(Math.max(0, people), c.reduce((a, b) => a + b, 0));
  const out = c.map(() => 0);
  if (front) {
    c.forEach((cap, i) => {
      out[i] = Math.min(cap, n);
      n -= out[i];
    });
    return out;
  }
  // 물 채우듯: 가장 적게 앉은 (자리가 남은) 테이블에 한 명씩
  for (; n > 0; n--) {
    let best = -1;
    for (let i = 0; i < c.length; i++) if (out[i] < c[i] && (best < 0 || out[i] < out[best])) best = i;
    out[best]++;
  }
  return out;
}

export function assignSeats(people: readonly Participant[], o: SeatOptions): SeatResult {
  const k = Math.max(1, Math.floor(o.tables) || 1);
  const seats = Math.max(1, Math.floor(o.seats) || 1);
  const caps = Array.from({ length: k }, (_, i) => clamp(Math.floor(o.caps?.[i] ?? seats), 0, seats));
  const cap = caps.reduce((a, b) => a + b, 0);
  const all = people.map((_, i) => i);
  const pad = (t: number[][]) => Array.from({ length: k }, (_, i) => t[i] ?? []);

  if (o.method === 'random' || o.method === 'mix') {
    // 자리가 모자라면 누가 못 앉는지도 무작위로
    const order = people.length > cap ? shuffle(all, o.rand) : all;
    const seated = order.slice(0, cap).sort((a, b) => a - b);
    const left = order.slice(cap).sort((a, b) => a - b);
    const at = new Map(seated.map((p, i) => [p, i]));
    const groups = (gs?: number[][]) => (gs ?? []).map((g) => g.filter((i) => at.has(i)).map((i) => at.get(i)!)).filter((g) => g.length >= 2);
    // 줄 맞춤은 앞에서부터 다 앉을 만큼의 줄만 쓰고, 그 줄끼리 고르게 나눈다
    let used = k;
    if (o.front) for (let i = 0, sum = 0; i < k; i++) if ((sum += caps[i]) >= seated.length) {
      used = i + 1;
      break;
    }
    const sizes = fillSizes(seated.length, caps.slice(0, used));
    const r = seated.length
      ? splitTeams(seated.map((i) => people[i]), { teams: used, sizes, balance: o.method === 'mix', apart: groups(o.apart), together: groups(o.together), rand: o.rand })
      : { teams: [], unmet: [] };
    return { tables: pad(r.teams.map((t) => t.map((i) => seated[i]))), unmet: r.unmet.map(([a, b]) => [seated[a], seated[b]]), left };
  }

  let order = all;
  if (o.method === 'group') {
    // 첫 부가 정보(소속)가 같은 사람끼리 모은다. 큰 소속부터, 소속이 없는 사람은 맨 뒤
    const by = new Map<string, number[]>();
    for (const i of all) {
      const key = attrsOf(people[i])[0] ?? '';
      by.set(key, [...(by.get(key) ?? []), i]);
    }
    order = [...by].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || b[1].length - a[1].length).flatMap(([, g]) => g);
  }
  const sizes = fillSizes(order.length, caps, o.front);
  const tables: number[][] = [];
  let at = 0;
  for (const size of sizes) tables.push(order.slice(at, (at += size)));
  return { tables, unmet: [], left: order.slice(at) };
}

export const tableName = (i: number, shape: Shape) => (shape === 'rows' ? `${i + 1}줄` : shape === 'pod' ? `${i + 1}모둠` : `${i + 1}번 테이블`);

/**
 * 뽑은 결과를 화면에 그릴 모양으로. 이름을 바꿔 둔 테이블은 그 이름을 쓴다.
 * grid 를 주면 테이블마다 격자 칸과 막은 자리를 붙이고, 사람은 막지 않은 자리에만 앉힌다.
 */
export function toTables(
  r: SeatResult, people: readonly Participant[], seats: number, shape: Shape, names: readonly string[] = [],
  grid?: { slots: readonly number[]; off: readonly (SeatOff | null)[][] },
): SeatTable[] {
  return r.tables.map((idx, i) => {
    const off = grid?.off[i] ?? [];
    const list: (Seat | null)[] = Array(seats).fill(null);
    let s = 0;
    for (const j of idx) {
      while (s < seats && off[s]) s++;
      if (s >= seats) break;
      list[s++] = { name: people[j].name, info: people[j].info, key: people[j].key };
    }
    const t: SeatTable = { name: names[i]?.trim() || tableName(i, shape), seats: list };
    if (grid) (t.slot = grid.slots[i]), (t.off = Array.from({ length: seats }, (_, k) => off[k] ?? null));
    return t;
  });
}

/**
 * 막거나 치운 것을 지금 배치에 반영한다. 다시 섞지 않고, 막힌 자리에 앉아 있던 사람만 빈 자리로 옮긴다
 * (같은 테이블 → 사람이 가장 적은 테이블 순으로). waiting(자리가 없던 사람)도 빈 자리가 생기면 앉힌다. 자리가 없으면 left 로.
 * 기본 이름(1번 테이블 …)은 남은 테이블 순서대로 다시 매긴다.
 */
export function reshape(
  tables: readonly SeatTable[], offs: Offs, count: number, seats: number, shape: Shape, waiting: readonly Seat[] = [],
): { tables: SeatTable[]; left: Seat[] } {
  const { slots, off } = openSlots(offs, count, seats);
  const bySlot = new Map(tables.map((t, i) => [slotOf(t, i), { t, i }]));
  const left: Seat[] = [];
  const homeOf = new Map<Seat, number>();
  for (const [slot, { t }] of bySlot) if (!slots.includes(slot)) for (const s of t.seats) s && left.push(s);
  const out: SeatTable[] = slots.map((slot, ni) => {
    const old = bySlot.get(slot);
    const list: (Seat | null)[] = Array.from({ length: seats }, (_, s) => old?.t.seats[s] ?? null);
    off[ni].forEach((o, s) => {
      if (o && list[s]) {
        homeOf.set(list[s]!, ni);
        left.push(list[s]!);
        list[s] = null;
      }
    });
    const renamed = old && old.t.name !== tableName(old.i, shape);
    return { name: renamed ? old.t.name : tableName(ni, shape), seats: list, slot, off: off[ni].slice() };
  });
  left.push(...waiting);
  const free = (t: SeatTable) => t.seats.findIndex((s, k) => !s && !t.off?.[k]);
  const rest: Seat[] = [];
  for (const p of left) {
    const home = homeOf.get(p);
    let ti = home != null && free(out[home]) >= 0 ? home : -1;
    if (ti < 0) {
      let best = Infinity;
      out.forEach((t, i) => {
        const n = t.seats.filter(Boolean).length;
        if (free(t) >= 0 && n < best) (best = n), (ti = i);
      });
    }
    if (ti < 0) rest.push(p);
    else out[ti].seats[free(out[ti])] = p;
  }
  return { tables: out, left: rest };
}

export type SeatRef = [table: number, seat: number];

/** 두 자리를 맞바꾼다 (한쪽이 빈 자리면 옮기는 것). 막은 자리로는 옮기지 않는다 */
export function swapSeats(tables: readonly SeatTable[], a: SeatRef, b: SeatRef): SeatTable[] {
  const out = tables.map((t) => ({ ...t, seats: t.seats.slice() }));
  const x = out[a[0]]?.seats[a[1]];
  const y = out[b[0]]?.seats[b[1]];
  if (x === undefined || y === undefined || out[a[0]].off?.[a[1]] || out[b[0]].off?.[b[1]]) return out;
  out[a[0]].seats[a[1]] = y;
  out[b[0]].seats[b[1]] = x;
  return out;
}

export interface LookupRow {
  name: string;
  info: string;
  table: string;
  /** 테이블 안에서 몇 번째 자리 (1부터) */
  seat: number;
}

const collator = new Intl.Collator('ko', { numeric: true });

/** 이름으로 찾는 표: 가나다순. 이름이 같으면 테이블 순서로. */
export function lookup(tables: readonly SeatTable[]): LookupRow[] {
  const rows: (LookupRow & { t: number })[] = [];
  tables.forEach((t, ti) => t.seats.forEach((s, si) => s && rows.push({ name: s.name, info: s.info, table: t.name, seat: si + 1, t: ti })));
  return rows.sort((a, b) => collator.compare(a.name, b.name) || a.t - b.t || a.seat - b.seat).map(({ t: _, ...row }) => row);
}

/** 사람(key) → 앉은 테이블 */
export function seatIndex(tables: readonly SeatTable[]): Map<string, { table: string; seat: number }> {
  const m = new Map<string, { table: string; seat: number }>();
  for (const t of tables) t.seats.forEach((s, i) => s && !m.has(s.key) && m.set(s.key, { table: t.name, seat: i + 1 }));
  return m;
}

export const seated = (tables: readonly SeatTable[]) => tables.reduce((n, t) => n + t.seats.filter(Boolean).length, 0);

export function seatingText(tables: readonly SeatTable[]): string {
  return tables
    .filter((t) => t.seats.some(Boolean))
    .map((t) => {
      const lines = t.seats.flatMap((s, i) => (s ? [`${i + 1}. ${s.name}${s.info ? ` (${s.info})` : ''}`] : []));
      return `[${t.name}] ${lines.length}명\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function lookupText(tables: readonly SeatTable[]): string {
  return lookup(tables)
    .map((r) => `${r.name}${r.info ? ` (${r.info})` : ''} → ${r.table} ${r.seat}번`)
    .join('\n');
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function seatingCsv(tables: readonly SeatTable[]): string {
  const rows = [['이름', '부가 정보', '테이블', '자리']];
  for (const r of lookup(tables)) rows.push([r.name, r.info, r.table, String(r.seat)]);
  // 엑셀이 한글을 제대로 읽도록 BOM 을 붙인다
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ── 배치도 ────────────────────────────────────────────────────────────────

/** 배치도에서 자리 하나의 크기와 사이 (px) */
export const SEAT_W = 68;
export const SEAT_H = 26;
export const SEAT_GAP = 6;

export interface Box {
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

/** 둥근 테이블: 자리를 두를 원의 반지름 */
export const ringRadius = (n: number) => Math.max(74, Math.round((n * 62) / (2 * Math.PI)));

export interface Pod {
  /** 마주 보는 두 줄에 놓는 2인 책상 수 (한 줄에) */
  desks: number;
  /** 왼줄 · 오른줄 자리 수 */
  row: number;
  /** 뒤쪽에 칠판을 보게 놓는 책상의 자리 수 (0~2) */
  side: number;
}

/**
 * 모둠 책상. 교실에서 흔히 하듯 2인 책상을 칠판과 직각으로 돌려 마주 보게 붙이고(옆으로 앉아 고개만 돌리면 칠판),
 * 다섯 명부터는 칠판에서 먼 쪽 끝에 칠판을 바라보는 책상을 하나 더 놓는다 (여섯 명 = 책상 셋).
 * 자리 번호는 왼줄 앞에서 뒤로, 오른줄 앞에서 뒤로, 그다음 뒤 책상 왼쪽부터.
 */
export function podPlan(seats: number): Pod {
  const n = Math.max(1, Math.floor(seats) || 1);
  const side = n <= 4 ? 0 : n % 2 ? 1 : 2;
  const row = Math.ceil((n - side) / 2);
  return { desks: Math.ceil(row / 2), row, side };
}

export const POD_DESK_PAD = 9;
export const POD_DESK_H = SEAT_H + POD_DESK_PAD;
export const POD_CAPTION = 24;

/** 테이블 하나가 배치도에서 차지하는 크기. vertical 은 긴 탁자를 세로로 놓을 때 */
export function tableBox(shape: Shape, seats: number, vertical = false): Box {
  const n = Math.max(1, Math.floor(seats) || 1);
  if (shape === 'round') {
    const r = ringRadius(n);
    return { w: (r + 14) * 2 + SEAT_W + 8, h: r * 2 + SEAT_H + 18 };
  }
  if (shape === 'long') {
    const half = Math.ceil(n / 2);
    const run = (size: number) => half * size + (half - 1) * SEAT_GAP;
    return vertical ? { w: SEAT_W * 2 + SEAT_GAP * 2 + 96, h: Math.max(run(SEAT_H), 64) } : { w: Math.max(run(SEAT_W), 150), h: SEAT_H * 2 + SEAT_GAP * 2 + 34 };
  }
  if (shape === 'pod') {
    const p = podPlan(n);
    // 책상 하나 = 자리 둘 + 사이 4 + 테두리와 안쪽 여백 9. 마주 보는 책상은 세로로 서 있다
    const across = (seats: number) => seats * SEAT_W + (seats - 1) * 4 + POD_DESK_PAD;
    const down = (seats: number) => seats * SEAT_H + (seats - 1) * 4 + POD_DESK_PAD;
    const column = Math.floor(p.row / 2) * down(2) + (p.row % 2 ? down(1) : 0) + (p.desks - 1) * 4;
    return { w: Math.max(across(1) * 2 + 4, p.side ? across(p.side) : 0), h: POD_CAPTION + column + (p.side ? 4 + POD_DESK_H : 0) };
  }
  return { w: n * SEAT_W + (n - 1) * SEAT_GAP, h: SEAT_H };
}

/** 줄 맞춤에서 책상 묶음 사이 통로 (자리 사이 간격에 더해) */
export const AISLE = 22;

/**
 * 테이블을 열 · 행 격자로 놓는다. 앞(칠판)에 가까운 행부터, 왼쪽 열부터 차례로.
 * 열 너비 · 행 높이는 그 열 · 행에서 가장 큰 테이블에 맞추고, 칸 안에서는 가운데에. 격자 전체는 width 가운데에.
 */
export function gridPlace(
  boxes: readonly Box[], cols: number, width = 0, gapX = 28, gapY = 30, top = 0, slots?: readonly number[],
): { at: Point[]; w: number } {
  // slots: 테이블마다 격자 칸 번호. 치운 칸은 비워 두되 자리는 지킨다 (가장 큰 테이블 크기로)
  const cell = (i: number) => slots?.[i] ?? i;
  const count = Math.max(boxes.length, ...boxes.map((_, i) => cell(i) + 1));
  const c = Math.max(1, Math.min(count || 1, Math.floor(cols) || 1));
  const rows = Math.ceil(count / c);
  const maxW = Math.max(0, ...boxes.map((b) => b.w));
  const maxH = Math.max(0, ...boxes.map((b) => b.h));
  const pick = (f: (i: number) => boolean, get: (b: Box) => number, fallback: number) => {
    const v = boxes.filter((_, i) => f(i)).map(get);
    return v.length ? Math.max(...v) : fallback;
  };
  const colW = Array.from({ length: c }, (_, j) => pick((i) => cell(i) % c === j, (b) => b.w, maxW));
  const rowH = Array.from({ length: rows }, (_, r) => pick((i) => Math.floor(cell(i) / c) === r, (b) => b.h, maxH));
  const gridW = colW.reduce((a, b) => a + b, 0) + (c - 1) * gapX;
  const w = Math.max(width, gridW);
  const left = Math.round((w - gridW) / 2);
  const xs = colW.map((_, j) => left + colW.slice(0, j).reduce((a, b) => a + b, 0) + j * gapX);
  const ys = rowH.map((_, r) => top + rowH.slice(0, r).reduce((a, b) => a + b, 0) + r * gapY);
  const at = boxes.map((b, i) => {
    const j = cell(i) % c;
    const r = Math.floor(cell(i) / c);
    return { x: xs[j] + Math.round((colW[j] - b.w) / 2), y: ys[r] + Math.round((rowH[r] - b.h) / 2) };
  });
  return { at, w };
}

/** 놓인 테이블을 모두 담는 크기 */
export function planSize(boxes: readonly Box[], at: readonly Point[], minW = 0): Box {
  let w = minW;
  let h = 0;
  boxes.forEach((b, i) => {
    w = Math.max(w, (at[i]?.x ?? 0) + b.w);
    h = Math.max(h, (at[i]?.y ?? 0) + b.h);
  });
  return { w, h };
}

/** 소속(첫 부가 정보) */
export const groupOf = (s: { info: string } | null) => (s?.info ? s.info.split(' · ')[0] : '');

/** 배치도에 나온 소속과 인원. 처음 나온 순서대로 — 색은 이 순서로 매긴다 */
export function seatGroups(tables: readonly SeatTable[]): { name: string; count: number }[] {
  const by = new Map<string, number>();
  for (const t of tables) for (const s of t.seats) if (s && groupOf(s)) by.set(groupOf(s), (by.get(groupOf(s)) ?? 0) + 1);
  return [...by].map(([name, count]) => ({ name, count }));
}

/** 소속 색. 서로 멀리 떨어진 색상부터 쓴다 */
export function groupHue(i: number): number {
  const HUES = [210, 25, 140, 330, 265, 50, 180, 0, 95, 295, 230, 160];
  return i < HUES.length ? HUES[i] : Math.round((i * 137.508) % 360);
}

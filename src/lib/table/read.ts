// 붙여넣은 글을 표로 읽는다. 어떤 형식인지는 생김새로 알아본다.
// 엑셀 · 구글 시트(탭), CSV, 마크다운 · psql · 글자 상자 표(세로줄), HTML(합친 칸까지), 미디어위키, Jira, JSON, 공백으로 맞춘 표.
import { detectDelimiter, parseCsv } from '../data/core';
import { blankGrid, normalize, type Align, type Grid, type Merge } from './grid';

export type Source = 'html' | 'tsv' | 'csv' | 'markdown' | 'box' | 'mediawiki' | 'jira' | 'json' | 'spaces' | 'lines';

export const SOURCE_NAMES: Record<Source, string> = {
  html: 'HTML 표',
  tsv: '탭으로 나눈 표 (엑셀 · 시트)',
  csv: 'CSV',
  markdown: '마크다운 표',
  box: '글자로 그린 표',
  mediawiki: '미디어위키 표',
  jira: 'Jira · Confluence 표',
  json: 'JSON',
  spaces: '공백으로 맞춘 표',
  lines: '한 줄에 한 칸',
};

export interface Reading {
  grid: Grid;
  source: Source;
  /** 첫 줄이 머리글로 보이는지 */
  header: boolean;
  /** 원문에 적힌 정렬 (마크다운 :--: 따위). 없으면 빈 배열 */
  aligns: Align[];
  /** 읽으면서 알려 줄 것 */
  note?: string;
}

// ── HTML ────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  middot: '·', bull: '•', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', deg: '°', plusmn: '±', yen: '¥', euro: '€', won: '₩', pound: '£', cent: '¢',
  laquo: '«', raquo: '»', larr: '←', rarr: '→', uarr: '↑', darr: '↓', hearts: '♥', check: '✓',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 칸 안의 HTML 을 글로. 줄바꿈 태그와 문단만 줄을 나누고, 나머지 공백은 브라우저처럼 하나로. */
function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>\s*(?=\S)/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};
const span = (tag: string, name: string) => Math.min(1000, Math.max(1, parseInt(attr(tag, name) ?? '1', 10) || 1));

function alignOf(tag: string): Align | undefined {
  const a = (attr(tag, 'align') ?? /text-align\s*:\s*(left|right|center)/i.exec(attr(tag, 'style') ?? '')?.[1] ?? '').toLowerCase();
  return a === 'left' || a === 'right' || a === 'center' ? a : undefined;
}

/** 칸 목록(줄마다 [태그, 내용])을 합친 칸을 고려해 네모난 표로 놓는다 */
function place(rows: { tag: string; html: string; head: boolean }[][]): { grid: Grid; heads: boolean[][]; aligns: (Align | undefined)[][] } {
  const taken: boolean[][] = [];
  const cells: { r: number; c: number; rs: number; cs: number; text: string }[] = [];
  const heads: boolean[][] = [];
  const aligns: (Align | undefined)[][] = [];
  let width = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (taken[r]?.[c]) c++;
      const rs = Math.min(span(cell.tag, 'rowspan'), rows.length - r);
      const cs = span(cell.tag, 'colspan');
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) (taken[i] ??= [])[j] = true;
      cells.push({ r, c, rs, cs, text: cellText(cell.html) });
      (heads[r] ??= [])[c] = cell.head;
      (aligns[r] ??= [])[c] = alignOf(cell.tag);
      c += cs;
      width = Math.max(width, c);
    }
  });
  const grid = blankGrid(rows.length, width);
  for (const k of cells) {
    grid.rows[k.r][k.c] = k.text;
    if (k.rs > 1 || k.cs > 1) grid.merges.push({ r: k.r, c: k.c, rs: k.rs, cs: Math.min(k.cs, width - k.c) });
  }
  return { grid, heads, aligns };
}

/** 문서에서 첫 번째 표를 읽는다. 표 안의 표는 바깥 칸의 글로 친다. */
export function readHtml(html: string): Reading | null {
  const start = html.search(/<table\b/i);
  const src = start >= 0 ? html.slice(start) : html;
  if (!/<t[dh]\b/i.test(src)) return null;
  // 태그를 하나씩 따라가며 깊이를 센다
  const re = /<(\/?)(table|tr|td|th|thead|tbody|tfoot|caption)\b[^>]*>/gi;
  const rows: { tag: string; html: string; head: boolean }[][] = [];
  let depth = 0;
  let row: { tag: string; html: string; head: boolean }[] | null = null;
  let cell: { tag: string; from: number; head: boolean } | null = null;
  let inHead = false;
  let m: RegExpExecArray | null;
  const closeCell = (at: number) => {
    if (cell && row) row.push({ tag: cell.tag, html: src.slice(cell.from, at), head: cell.head });
    cell = null;
  };
  const closeRow = (at: number) => {
    closeCell(at);
    if (row) rows.push(row);
    row = null;
  };
  while ((m = re.exec(src))) {
    const close = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'table') {
      if (!close) depth++;
      else if (--depth === 0) {
        closeRow(m.index);
        break;
      }
      continue;
    }
    if (depth > 1) continue;
    if (name === 'thead') inHead = !close;
    else if (name === 'tr') {
      closeRow(m.index);
      if (!close) row = [];
    } else if (name === 'td' || name === 'th') {
      closeCell(m.index);
      if (!close) {
        row ??= [];
        cell = { tag: m[0], from: m.index + m[0].length, head: name === 'th' || inHead };
      }
    }
  }
  closeRow(src.length);
  const kept = rows.filter((r) => r.length);
  if (!kept.length) return null;
  const { grid, heads, aligns } = place(kept);
  const header = heads[0]?.length > 0 && heads[0].every((h) => h !== false);
  // 열마다 몸통 칸에 같은 정렬이 붙어 있으면 그대로 쓴다
  const colAligns: Align[] = Array.from({ length: grid.rows[0].length }, (_, c) => {
    const seen = aligns.slice(header ? 1 : 0).map((r) => r?.[c]).filter((a) => a !== undefined);
    return seen.length && seen.every((a) => a === seen[0]) ? seen[0]! : 'auto';
  });
  return { grid: normalize(grid), source: 'html', header, aligns: colAligns.some((a) => a !== 'auto') ? colAligns : [] };
}

// ── 세로줄 표: 마크다운 · psql · 글자 상자 ───────────────────

const BAR = /[|│┃║]/;
/** 가로줄(테두리): 줄 · 십자 · 모서리 · 마크다운 :--: 만 있는 줄 */
const RULE = /^[\s|│┃║+\-=_:─━═┄┈┌┐└┘├┤┬┴┼╭╮╰╯╔╗╚╝╠╣╦╩╬╒╕╘╛╞╡╤╧╪┏┓┗┛┣┫┳┻╋]+$/;
const isRule = (l: string) => RULE.test(l) && /[-=─━═┄┈_]/.test(l);

/** 이스케이프하지 않은 세로줄로 나눈다 */
function splitBars(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && BAR.test(line[i + 1] ?? '')) {
      cur += line[++i];
      continue;
    }
    if (ch === '`') code = !code;
    if (BAR.test(ch) && !code) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  const t = line.trim();
  if (BAR.test(t[0] ?? '')) out.shift();
  if (BAR.test(t[t.length - 1] ?? '') && !/\\[|│┃║]$/.test(t)) out.pop();
  return out;
}

function mdAlign(rule: string): Align[] {
  return splitBars(rule.replace(/[+┼]/g, '|')).map((c) => {
    const t = c.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : 'auto';
  });
}

const fromMd = (s: string) => s.replace(/<br\s*\/?>/gi, '\n');

export function readBars(text: string): Reading | null {
  // psql 의 "(3 rows)" 꼬리는 뺀다
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\(\d+ (rows?|줄|행)\)\s*$/.test(l));
  if (lines.length < 1 || lines.filter((l) => !isRule(l) && BAR.test(l)).length < 1) return null;
  // 테두리로 나뉜 덩어리. 몸통 줄 사이마다 테두리가 있으면 덩어리 하나가 한 줄 (칸 안의 여러 줄)
  const groups: string[][] = [[]];
  for (const l of lines) {
    if (isRule(l)) groups.push([]);
    else groups[groups.length - 1].push(l);
  }
  const kept = groups.filter((g) => g.length);
  if (!kept.length) return null;
  const md = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1] ?? '') && lines[1].includes('-');
  const multi = kept.length > 2;
  const header = kept.length > 1 && (multi || kept[0].length === 1);
  const groupsOut = kept;
  const raw: string[][] = [];
  if (multi) {
    for (const g of groupsOut) {
      const parts = g.map(splitBars);
      const w = Math.max(...parts.map((p) => p.length));
      raw.push(Array.from({ length: w }, (_, c) => parts.map((p) => (p[c] ?? '').trim()).filter((s, i, a) => s || i < a.length - 1).join('\n').replace(/\n+$/, '')));
    }
  } else for (const g of groupsOut) for (const l of g) raw.push(splitBars(l).map((c) => c.trim()));
  if (raw.every((r) => r.length < 2) && !lines.some(isRule)) return null;
  const grid = normalize({ rows: raw.map((r) => r.map(fromMd)), merges: [] });
  const aligns = md ? mdAlign(lines[1]) : [];
  return { grid, source: md ? 'markdown' : 'box', header, aligns };
}

// ── Jira · Confluence 위키 ────────────────────────────────────

export function readJira(text: string): Reading | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !lines[0].trim().startsWith('||')) return null;
  const rows = lines.map((l) => {
    const t = l.trim();
    const sep = t.startsWith('||') ? '||' : '|';
    let body = t.slice(sep.length);
    if (body.endsWith(sep)) body = body.slice(0, -sep.length);
    else if (body.endsWith('|')) body = body.slice(0, -1);
    // \| 는 글자 그대로
    return body
      .replace(/\\\|/g, '\u0000')
      .split(/\|\|?/)
      .map((c) => c.replace(/\u0000/g, '|').replace(/\\\\/g, '\n').trim());
  });
  return { grid: normalize({ rows, merges: [] }), source: 'jira', header: true, aligns: [] };
}

// ── 미디어위키 ───────────────────────────────────────────────

export function readMediaWiki(text: string): Reading | null {
  if (!/^\s*\{\|/.test(text)) return null;
  type Raw = { tag: string; html: string; head: boolean };
  const rows: Raw[][] = [];
  let row: Raw[] | null = null;
  const push = (cell: string, head: boolean) => {
    // "속성 | 글" (속성 쪽에 [[ ]] 가 없을 때만)
    const m = /^([^|[\]]*?=[^|[\]]*?)\|(?!\|)(.*)$/s.exec(cell);
    const tag = m ? `<td ${m[1]}>` : '<td>';
    row ??= [];
    row.push({ tag, html: (m ? m[2] : cell).trim(), head });
  };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{|') || t.startsWith('|+')) continue;
    if (t.startsWith('|}')) break;
    if (t.startsWith('|-')) {
      if (row) rows.push(row);
      row = [];
      continue;
    }
    if (t.startsWith('!')) for (const c of t.slice(1).split(/!!|\|\|/)) push(c, true);
    else if (t.startsWith('|')) for (const c of t.slice(1).split('||')) push(c, false);
    else if (row?.length) row[row.length - 1].html += '\n' + t;
  }
  if (row) rows.push(row);
  const kept = rows.filter((r) => r.length);
  if (!kept.length) return null;
  const { grid, heads } = place(kept.map((r) => r.map((c) => ({ ...c, html: c.html.replace(/\n/g, '<br>') }))));
  // 위키 글자 꾸밈은 걷어 낸다
  grid.rows = grid.rows.map((r) => r.map((c) => c.replace(/'''?/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')));
  return { grid: normalize(grid), source: 'mediawiki', header: heads[0]?.every((h) => h !== false) ?? false, aligns: [] };
}

// ── JSON ─────────────────────────────────────────────────────

const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function readJson(text: string): Reading | null {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  // { "data": [...] } 처럼 배열 하나를 싼 객체는 벗긴다
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const arrays = Object.values(v).filter(Array.isArray);
    if (arrays.length === 1 && Object.keys(v).length <= 3) v = arrays[0];
    else v = [v];
  }
  if (!Array.isArray(v) || !v.length) return null;
  if (v.every((x) => Array.isArray(x))) {
    return { grid: normalize({ rows: v.map((r: unknown[]) => r.map(show)), merges: [] }), source: 'json', header: false, aligns: [] };
  }
  if (v.every((x) => x && typeof x === 'object')) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const o of v) for (const k of Object.keys(o)) if (!seen.has(k)) seen.add(k), keys.push(k);
    const rows = [keys, ...v.map((o: Record<string, unknown>) => keys.map((k) => show(o[k])))];
    return { grid: normalize({ rows, merges: [] }), source: 'json', header: true, aligns: [] };
  }
  return { grid: normalize({ rows: v.map((x) => [show(x)]), merges: [] }), source: 'json', header: false, aligns: [] };
}

// ── 공백으로 맞춘 표 (docker ps · kubectl get …) ──────────────

export function readSpaces(text: string): Reading | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  // 모든 줄에서 비어 있는 글자 위치를 찾아 열 경계로 쓴다 (빈 칸이 있는 열도 맞게)
  const width = Math.max(...lines.map((l) => l.length));
  const blank = Array.from({ length: width }, (_, i) => lines.every((l) => i >= l.length || l[i] === ' '));
  const starts: number[] = [];
  for (let i = 0; i < width; i++) {
    if (!blank[i] && (i === 0 || (blank[i - 1] && (i < 2 || blank[i - 2])))) starts.push(i);
  }
  if (starts.length >= 2) {
    const rows = lines.map((l) => starts.map((s, k) => l.slice(s, starts[k + 1] ?? undefined).trim()));
    if (rows[0].every((c) => c)) return { grid: normalize({ rows, merges: [] }), source: 'spaces', header: true, aligns: [] };
  }
  const split = lines.map((l) => l.trim().split(/\s{2,}/));
  if (split[0].length >= 2 && split.every((r) => r.length === split[0].length)) {
    return { grid: normalize({ rows: split, merges: [] }), source: 'spaces', header: true, aligns: [] };
  }
  return null;
}

// ── 알아보기 ─────────────────────────────────────────────────

const NUM = /^[-+]?[₩$€£¥]?\s?\d[\d,]*(\.\d+)?\s?(%|원|개|명|건|만|억|달러|kg|km|m|g)?$/i;
export const looksNumber = (s: string) => NUM.test(s.trim());

/** 첫 줄이 머리글인지 짐작: 첫 줄이 숫자가 아니고, 아래에 숫자 열이 있거나 첫 줄 글자가 모두 다르면 */
export function guessHeader(g: Grid): boolean {
  const [first, ...rest] = g.rows;
  if (!first || !rest.length) return false;
  if (first.some((c) => c && looksNumber(c))) return false;
  if (first.filter(Boolean).length < first.length / 2) return false;
  const numericBelow = first.some((_, c) => rest.slice(0, 20).every((r) => !r[c] || looksNumber(r[c])) && rest.some((r) => r[c]));
  return numericBelow || (first.length > 1 && new Set(first).size === first.length);
}

export function readText(text: string): Reading | null {
  const t = text.replace(/^﻿/, '');
  if (!t.trim()) return null;
  if (/<t(able|r|d|h)\b/i.test(t)) {
    const r = readHtml(t);
    if (r) return r;
  }
  for (const f of [readJson, readMediaWiki, readJira]) {
    const r = f(t);
    if (r) return r;
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  if (tabbed && tabbed >= lines.length * 0.5) {
    const rows = parseCsv(t, '\t');
    const grid = normalize({ rows, merges: [] });
    return { grid, source: 'tsv', header: guessHeader(grid), aligns: [] };
  }
  const barred = lines.filter((l) => BAR.test(l) || isRule(l)).length;
  if (barred >= lines.length * 0.6) {
    const r = readBars(t);
    if (r) return r;
  }
  const d = detectDelimiter(t);
  const rows = parseCsv(t, d);
  if (rows.length && rows.some((r) => r.length > 1) && rows.every((r) => r.length === rows[0].length || r.length > 1)) {
    const grid = normalize({ rows, merges: [] });
    return { grid, source: 'csv', header: guessHeader(grid), aligns: [], note: d === ',' ? undefined : `구분자: ${d === ';' ? '세미콜론' : d === '|' ? '세로줄' : d}` };
  }
  const sp = readSpaces(t);
  if (sp) return sp;
  const grid = normalize({ rows: lines.map((l) => [l.trim()]), merges: [] });
  return { grid, source: 'lines', header: guessHeader(grid), aligns: [] };
}

export type { Grid, Merge };

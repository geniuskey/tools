// 데이터 뷰어의 계산 부분: JSON 트리 펼치기 · 검색 · 경로, CSV 읽기/쓰기, 표 변환 · 정렬.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ── 읽기 ────────────────────────────────────────────────────

export type Parsed =
  | { kind: 'json'; value: Json; lines: boolean }
  | { kind: 'csv'; rows: string[][]; delimiter: string }
  | { kind: 'error'; message: string; line?: number; column?: number };

/** 문법에 어긋나는 첫 위치를 찾는다 (엔진마다 오류 메시지에 위치가 없을 수 있어서 직접 훑는다). 문제없으면 -1. */
export function jsonErrorOffset(text: string): number {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++;
  };
  const lit = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const str = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const take = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m || !m[0]) return false;
    i += m[0].length;
    return true;
  };
  // 재귀 대신 스택: 아주 깊은 문서에서도 죽지 않는다
  const stack: ('{' | '[')[] = [];
  let expect: 'value' | 'key' | 'keyOrEnd' | 'valueOrEnd' | 'colon' | 'commaOrEnd' = 'value';
  for (;;) {
    ws();
    if (i >= n) return expect === 'commaOrEnd' && !stack.length ? -1 : i;
    const ch = text[i];
    if (expect === 'commaOrEnd') {
      if (!stack.length) return i;
      const top = stack[stack.length - 1];
      if (ch === ',') {
        i++;
        expect = top === '{' ? 'key' : 'value';
      } else if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
        i++;
        stack.pop();
      } else return i;
    } else if (expect === 'colon') {
      if (ch !== ':') return i;
      i++;
      expect = 'value';
    } else if (expect === 'key' || expect === 'keyOrEnd') {
      if (ch === '}' && expect === 'keyOrEnd') {
        i++;
        stack.pop();
        expect = 'commaOrEnd';
      } else if (ch === '"' && take(str)) expect = 'colon';
      else return i;
    } else {
      if (ch === ']' && expect === 'valueOrEnd') {
        i++;
        stack.pop();
        expect = 'commaOrEnd';
      } else if (ch === '{') {
        i++;
        stack.push('{');
        expect = 'keyOrEnd';
      } else if (ch === '[') {
        i++;
        stack.push('[');
        expect = 'valueOrEnd';
      } else if (ch === '"' ? take(str) : take(lit)) expect = 'commaOrEnd';
      else return i;
    }
  }
}

function jsonError(text: string, e: unknown): Parsed {
  const raw = e instanceof Error ? e.message : String(e);
  const message = raw.replace(/ in JSON at position \d+.*$| at position \d+.*$|, \.\.\."[\s\S]*$/, '');
  const at = jsonErrorOffset(text);
  if (at < 0) return { kind: 'error', message };
  const before = text.slice(0, at);
  return { kind: 'error', message, line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
}

/** 내용을 보고 JSON · JSON Lines · CSV 가운데 무엇인지 판단해 읽는다. */
export function parseAny(input: string, hint?: 'json' | 'csv'): Parsed {
  const text = input.replace(/^﻿/, '');
  const head = text.trimStart()[0];
  const looksJson = hint === 'json' || (hint !== 'csv' && (head === '{' || head === '['));
  if (looksJson) {
    try {
      return { kind: 'json', value: JSON.parse(text), lines: false };
    } catch (e) {
      // 한 줄에 값 하나씩 (JSON Lines)
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length > 1) {
        try {
          return { kind: 'json', value: lines.map((l) => JSON.parse(l)), lines: true };
        } catch {}
      }
      return jsonError(text, e);
    }
  }
  if (!text.trim()) return { kind: 'error', message: '내용이 비어 있습니다' };
  const delimiter = detectDelimiter(text);
  return { kind: 'csv', rows: parseCsv(text, delimiter), delimiter };
}

/** 앞쪽 몇 줄에서 가장 고르게 나오는 구분자를 고른다. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20000).split('\n').slice(0, 12);
  if (sample.length > 1 && text.length > 20000) sample.pop();
  let best = ',';
  let bestScore = 0;
  for (const d of [',', '\t', ';', '|']) {
    const counts = sample.filter((l) => l.trim()).map((line) => {
      let n = 0;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    const min = Math.min(...counts);
    if (!counts.length || min === 0) continue;
    const score = min * (counts.every((c) => c === counts[0]) ? 2 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 방식. 따옴표 안의 구분자 · 줄바꿈 · "" 를 처리한다. */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let field: string;
    if (text[i] === '"') {
      let out = '';
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          out += text.slice(i);
          i = n;
          break;
        }
        out += text.slice(i, q);
        if (text[q + 1] === '"') {
          out += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // 닫는 따옴표 뒤에 붙은 글자는 그대로 잇는다
      const s = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      field = out + text.slice(s, i);
    } else {
      const s = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      field = text.slice(s, i);
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    i++;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  // 빈 줄은 뺀다
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// ── 표 ──────────────────────────────────────────────────────

export interface Table {
  columns: string[];
  rows: string[][];
}

export function csvToTable(rows: string[][], header: boolean): Table {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const columns = Array.from({ length: width }, (_, i) => (header ? rows[0]?.[i]?.trim() : '') || `열 ${i + 1}`);
  const body = (header ? rows.slice(1) : rows).map((r) => (r.length === width ? r : Array.from({ length: width }, (_, i) => r[i] ?? '')));
  return { columns, rows: body };
}

function cellText(v: Json): string {
  if (v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** JSON 에서 만든 표. 줄과 칸이 원래 문서의 어디인지 기억한다. */
export interface JsonTable extends Table {
  /** 줄마다 원래 노드 이름 */
  ids: string[];
  /** 열마다 줄 노드 아래의 키 경로. 위치를 알려 주는 열([*])이면 null */
  keys: (string[] | null)[];
}

const NO_KEYS: string[] = [];

/**
 * pattern 이 가리키는 배열(들)을 표로 바꾼다. 안쪽 객체는 a.b 처럼 펼친다.
 * pattern 의 * 는 배열의 모든 항목: $.orders[*].items 꼴이면 주문마다 있는 items 를 한 표로 잇고,
 * 어느 주문의 것인지를 앞쪽 열에 적는다. 표로 볼 수 없으면 null.
 */
export function tableAt(root: Json, pattern = ''): JsonTable | null {
  const segs = pattern ? pattern.slice(1).split('/') : [];
  let nodes: { value: Json; id: string; lead: string[] }[] = [{ value: root, id: '', lead: [] }];
  const columns: string[] = [];
  const keys: (string[] | null)[] = [];
  segs.forEach((raw, s) => {
    const next: typeof nodes = [];
    if (raw === '*') {
      columns.push(`${s && segs[s - 1] !== '*' ? unescKey(segs[s - 1]) : ''}[*]`);
      keys.push(null);
    }
    for (const n of nodes) {
      const v = n.value;
      if (raw === '*') {
        if (Array.isArray(v)) for (let i = 0; i < v.length; i++) next.push({ value: v[i], id: `${n.id}/${i}`, lead: [...n.lead, String(i)] });
      } else if (Array.isArray(v)) {
        if (v[+raw] !== undefined) next.push({ value: v[+raw], id: `${n.id}/${raw}`, lead: n.lead });
      } else if (isBox(v)) {
        const k = unescKey(raw);
        if (Object.prototype.hasOwnProperty.call(v, k)) next.push({ value: v[k], id: `${n.id}/${raw}`, lead: n.lead });
      }
    }
    nodes = next;
  });

  const leads = columns.length;
  const index = new Map<string, number>();
  const rows: string[][] = [];
  const ids: string[] = [];
  const put = (row: string[], name: string, prefix: string[], k: string | null, v: Json) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
      const path = k === null ? prefix : [...prefix, k];
      for (const k2 of Object.keys(v)) put(row, `${name}.${k2}`, path, k2, v[k2]);
      return;
    }
    let c = index.get(name);
    if (c === undefined) {
      c = columns.length;
      index.set(name, c);
      columns.push(name);
      keys.push(k === null ? prefix : [...prefix, k]);
    }
    row[c] = cellText(v);
  };
  let objects = 0;
  let lists = 0;
  for (const n of nodes) {
    if (!Array.isArray(n.value)) continue;
    for (let i = 0; i < n.value.length; i++) {
      const item = n.value[i];
      const row: string[] = n.lead.slice();
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        objects++;
        for (const k of Object.keys(item)) put(row, k, NO_KEYS, k, item[k]);
      } else {
        if (Array.isArray(item)) lists++;
        put(row, '값', NO_KEYS, null, item);
      }
      rows.push(row);
      ids.push(`${n.id}/${i}`);
    }
  }
  if (!rows.length || (!objects && lists)) return null;
  for (const r of rows) for (let i = leads; i < columns.length; i++) r[i] ??= '';
  return { columns, rows, ids, keys };
}

/** 객체(또는 값)의 배열을 표로 바꾼다. 표로 볼 수 없으면 null. */
export function jsonToTable(value: Json): Table | null {
  const t = tableAt(value);
  return t && { columns: t.columns, rows: t.rows };
}

/** 객체가 줄지어 있는 배열인지 (list[dict]). 큰 배열은 앞쪽만 본다. */
export function looksTabular(value: Json | undefined, sample = 50): value is Json[] {
  if (!Array.isArray(value) || !value.length) return false;
  const n = Math.min(value.length, sample);
  let objects = 0;
  for (let i = 0; i < n; i++) {
    const v = value[i];
    if (Array.isArray(v)) return false;
    if (v !== null && typeof v === 'object') objects++;
  }
  return objects * 2 >= n;
}

export interface TableSpot {
  /** tableAt 에 넘길 이름. 배열 항목 자리는 * */
  id: string;
  /** 합친 줄 수 */
  rows: number;
  /** 이 모양으로 흩어져 있는 배열의 수 */
  nodes: number;
}

/** 문서를 훑어 표로 볼 만한 곳을 얕은 곳부터 찾는다. 같은 자리에 반복되는 배열은 하나로 묶는다. */
export function findTables(root: Json, budget = 3_000_000, limit = 60): TableSpot[] {
  const found = new Map<string, TableSpot>();
  let level: [Json, string][] = isBox(root) ? [[root, '']] : [];
  let seen = 0;
  while (level.length && seen < budget) {
    const next: [Json, string][] = [];
    for (const [value, id] of level) {
      if (seen >= budget) break;
      if (Array.isArray(value)) {
        if (looksTabular(value)) {
          let spot = found.get(id);
          if (!spot && found.size < limit) found.set(id, (spot = { id, rows: 0, nodes: 0 }));
          if (spot) {
            spot.rows += value.length;
            spot.nodes++;
          }
        }
        seen += value.length;
        const child = `${id}/*`;
        for (const v of value) if (isBox(v)) next.push([v, child]);
      } else {
        for (const k of Object.keys(value as object)) {
          seen++;
          const v = (value as { [k: string]: Json })[k];
          if (isBox(v)) next.push([v, childId(id, k)]);
        }
      }
    }
    level = next;
  }
  return [...found.values()];
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** 표를 객체 배열로. infer 면 숫자 · 참/거짓 · 빈 값을 알맞은 형으로 바꾼다 (007 같은 값은 글자로 둔다). */
export function tableToJson(table: Table, infer = true): Json[] {
  return table.rows.map((r) => {
    const o: { [k: string]: Json } = {};
    table.columns.forEach((c, i) => {
      const s = r[i] ?? '';
      if (!infer) o[c] = s;
      else if (s === '') o[c] = null;
      else if (s === 'true' || s === 'false') o[c] = s === 'true';
      else if (NUMBER.test(s) && s.length < 16) o[c] = Number(s);
      else o[c] = s;
    });
    return o;
  });
}

export function toCsv(table: Table, delimiter = ',', order?: ArrayLike<number>): string {
  const esc = (s: string) => (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s);
  const out = [table.columns.map(esc).join(delimiter)];
  const n = order ? order.length : table.rows.length;
  for (let i = 0; i < n; i++) out.push(table.rows[order ? order[i] : i].map(esc).join(delimiter));
  return out.join('\n') + '\n';
}

const toNumber = (s: string) => (s !== '' && NUMBER.test(s.replace(/,/g, '')) ? Number(s.replace(/,/g, '')) : NaN);

/** 열의 값이 (빈 칸을 빼고) 모두 숫자인지. 앞쪽 일부만 본다. */
export function numericColumns(table: Table, sample = 500): boolean[] {
  return table.columns.map((_, c) => {
    let seen = 0;
    for (let r = 0; r < table.rows.length && r < sample; r++) {
      const s = table.rows[r][c];
      if (s === '') continue;
      if (Number.isNaN(toNumber(s))) return false;
      seen++;
    }
    return seen > 0;
  });
}

/** 걸러 내고 정렬한 뒤의 행 번호. 빈 칸은 항상 맨 뒤. */
export function viewOrder(table: Table, filter: string, sort: { col: number; dir: 1 | -1 } | null): Int32Array {
  const q = filter.trim().toLowerCase();
  let order: number[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (!q || table.rows[i].some((c) => c.toLowerCase().includes(q))) order.push(i);
  }
  if (sort) {
    const { col, dir } = sort;
    const text = order.map((i) => table.rows[i][col]);
    const num = text.map(toNumber);
    const allNum = num.every((v, k) => !Number.isNaN(v) || text[k] === '');
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    const pos = order.map((_, k) => k);
    pos.sort((a, b) => {
      const ea = text[a] === '';
      const eb = text[b] === '';
      if (ea || eb) return ea === eb ? a - b : ea ? 1 : -1;
      const c = allNum ? num[a] - num[b] : collator.compare(text[a], text[b]);
      return c ? c * dir : a - b;
    });
    order = pos.map((k) => order[k]);
  }
  return Int32Array.from(order);
}

// ── 트리 ────────────────────────────────────────────────────

export interface TreeRow {
  id: string;
  depth: number;
  key: string | number | null;
  value: Json;
  /** 자식 수. 값이면 -1 */
  size: number;
  open: boolean;
}

// 노드 이름은 JSON Pointer (RFC 6901) 와 같다. 뿌리는 ''.
// 다만 * 는 "배열의 모든 항목" 을 뜻하는 자리로 쓰려고, 키에 든 * 는 ~2 로 적는다.
const escKey = (k: string | number) => String(k).replace(/~/g, '~0').replace(/\//g, '~1').replace(/\*/g, '~2');
const unescKey = (s: string) => s.replace(/~[012]/g, (m) => (m === '~0' ? '~' : m === '~1' ? '/' : '*'));
export const childId = (parent: string, key: string | number) => `${parent}/${escKey(key)}`;
export const idKeys = (id: string) => (id ? id.slice(1).split('/').map(unescKey) : []);

const isBox = (v: Json): v is Json[] | { [k: string]: Json } => v !== null && typeof v === 'object';
export const sizeOf = (v: Json) => (Array.isArray(v) ? v.length : isBox(v) ? Object.keys(v).length : -1);

/** 펼쳐진 노드만 따라가며 화면에 보일 줄을 만든다. */
export function flatten(root: Json, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (value: Json, key: string | number | null, id: string, depth: number) => {
    const size = sizeOf(value);
    const open = size > 0 && expanded.has(id);
    rows.push({ id, depth, key, value, size, open });
    if (!open) return;
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) walk(value[i], i, `${id}/${i}`, depth + 1);
    else for (const k of Object.keys(value as object)) walk((value as { [k: string]: Json })[k], k, childId(id, k), depth + 1);
  };
  walk(root, null, '', 0);
  return rows;
}

/** 위에서부터 차례로 펼치되 줄 수가 limit 을 넘지 않게 한다. 다 펼쳤으면 complete. */
export function expandAll(root: Json, limit = 200_000): { expanded: Set<string>; complete: boolean } {
  const expanded = new Set<string>();
  let rows = 1;
  let level: [Json, string][] = [[root, '']];
  while (level.length) {
    const next: [Json, string][] = [];
    for (const [value, id] of level) {
      const size = sizeOf(value);
      if (size <= 0) continue;
      if (rows + size > limit) return { expanded, complete: false };
      rows += size;
      expanded.add(id);
      if (Array.isArray(value)) value.forEach((v, i) => isBox(v) && next.push([v, `${id}/${i}`]));
      else for (const k of Object.keys(value as object)) {
        const v = (value as { [k: string]: Json })[k];
        if (isBox(v)) next.push([v, childId(id, k)]);
      }
    }
    level = next;
  }
  return { expanded, complete: true };
}

/** 이 노드가 보이려면 펼쳐야 하는 조상들. */
export function ancestors(id: string): string[] {
  const out = [''];
  for (let i = id.indexOf('/', 1); i > 0; i = id.indexOf('/', i + 1)) out.push(id.slice(0, i));
  return id ? out : [];
}

/** 키나 값에 글자가 들어 있는 노드를 문서 순서대로 찾는다. */
export function search(root: Json, query: string, limit = 5000): { ids: string[]; more: boolean } {
  const q = query.trim().toLowerCase();
  const ids: string[] = [];
  if (!q) return { ids, more: false };
  let more = false;
  const walk = (value: Json, key: string | number | null, id: string): boolean => {
    const hit = (typeof key === 'string' && key.toLowerCase().includes(q)) || (!isBox(value) && String(value).toLowerCase().includes(q));
    if (hit) {
      if (ids.length >= limit) {
        more = true;
        return false;
      }
      ids.push(id);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) if (!walk(value[i], i, `${id}/${i}`)) return false;
    } else if (isBox(value)) {
      for (const k of Object.keys(value)) if (!walk(value[k], k, childId(id, k))) return false;
    }
    return true;
  };
  walk(root, null, '');
  return { ids, more };
}

export function valueAt(root: Json, id: string): Json | undefined {
  let cur: Json | undefined = root;
  for (const k of idKeys(id)) {
    if (!isBox(cur as Json)) return undefined;
    cur = Array.isArray(cur) ? cur[+k] : (cur as { [k: string]: Json })[k];
  }
  return cur;
}

/** 코드에 붙여넣을 수 있는 경로: $.items[0]["이름 with space"]. 모든 항목 자리는 [*] */
export function pathText(root: Json, id: string): string {
  let out = '$';
  let cur: Json | undefined = root;
  for (const raw of id ? id.slice(1).split('/') : []) {
    const k = unescKey(raw);
    if (raw === '*') {
      out += '[*]';
      cur = Array.isArray(cur) ? cur.find(isBox) : undefined;
    } else if (Array.isArray(cur)) {
      out += `[${k}]`;
      cur = cur[+k];
    } else {
      out += /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
      cur = isBox(cur as Json) ? (cur as { [k: string]: Json })[k] : undefined;
    }
  }
  return out;
}

/** 접힌 노드 옆에 보여 줄 짧은 내용. 큰 값도 앞부분만 훑는다. */
export function preview(value: Json, max = 70): string {
  let out = '';
  const walk = (v: Json): boolean => {
    if (out.length > max) return false;
    if (Array.isArray(v)) {
      out += '[';
      for (let i = 0; i < v.length; i++) {
        if (i) out += ', ';
        if (!walk(v[i])) return false;
      }
      out += ']';
    } else if (isBox(v)) {
      out += '{';
      let first = true;
      for (const k of Object.keys(v)) {
        if (!first) out += ', ';
        first = false;
        out += `${k}: `;
        if (!walk(v[k])) return false;
      }
      out += '}';
    } else out += typeof v === 'string' ? JSON.stringify(v.length > max ? v.slice(0, max) : v) : String(v);
    return out.length <= max;
  };
  return walk(value) ? out : out.slice(0, max) + '…';
}

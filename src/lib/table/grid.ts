// 표 한 장: 네모난 글자 칸 + 합친 칸 목록. 합친 칸의 글은 왼쪽 위 칸에 있고, 덮인 칸은 비어 있다.

export type Align = 'auto' | 'left' | 'center' | 'right';

export interface Merge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

export interface Grid {
  rows: string[][];
  merges: Merge[];
}

export const blankGrid = (h: number, w: number): Grid => ({ rows: Array.from({ length: h }, () => new Array<string>(w).fill('')), merges: [] });

export const width = (g: Grid) => g.rows[0]?.length ?? 0;

/** 줄 길이를 맞추고, 끝의 빈 줄 · 빈 열을 떼고, 표 밖으로 나가는 합친 칸을 자른다 */
export function normalize(g: Grid): Grid {
  let rows = g.rows.map((r) => r.map((c) => (c ?? '').replace(/\r\n?/g, '\n')));
  const rowUsed = (r: number) => g.merges.some((m) => r >= m.r && r < m.r + m.rs);
  const colUsed = (c: number) => g.merges.some((m) => c >= m.c && c < m.c + m.cs);
  while (rows.length > 1 && rows[rows.length - 1].every((c) => !c) && !rowUsed(rows.length - 1)) rows.pop();
  let w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  while (w > 1 && rows.every((r) => !r[w - 1]) && !colUsed(w - 1)) w--;
  rows = rows.map((r) => (r.length === w ? r : Array.from({ length: w }, (_, i) => r[i] ?? '')));
  const merges = g.merges
    .filter((m) => m.r < rows.length && m.c < w)
    .map((m) => ({ ...m, rs: Math.min(m.rs, rows.length - m.r), cs: Math.min(m.cs, w - m.c) }))
    .filter((m) => m.rs > 1 || m.cs > 1);
  return { rows, merges };
}

export const clone = (g: Grid): Grid => ({ rows: g.rows.map((r) => [...r]), merges: g.merges.map((m) => ({ ...m })) });

/** (r, c) 를 덮는 합친 칸. 왼쪽 위 칸이면 head */
export function mergeAt(g: Grid, r: number, c: number): (Merge & { head: boolean }) | null {
  for (const m of g.merges) if (r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs) return { ...m, head: r === m.r && c === m.c };
  return null;
}

/** 칸마다 덮인 칸인지 (빠르게 찾으려고 한 번에) */
export function coveredMap(g: Grid): boolean[][] {
  const out = g.rows.map((r) => new Array<boolean>(r.length).fill(false));
  for (const m of g.merges) for (let i = m.r; i < m.r + m.rs; i++) for (let j = m.c; j < m.c + m.cs; j++) if (i !== m.r || j !== m.c) out[i][j] = true;
  return out;
}

/** 합친 칸을 푼다. fill 이면 덮였던 칸에 같은 글을 채운다 */
export function unmerge(g: Grid, fill: boolean): Grid {
  const out = clone(g);
  if (fill) for (const m of g.merges) for (let i = m.r; i < m.r + m.rs; i++) for (let j = m.c; j < m.c + m.cs; j++) out.rows[i][j] = g.rows[m.r][m.c];
  out.merges = [];
  return out;
}

export function transpose(g: Grid): Grid {
  const w = width(g);
  return {
    rows: Array.from({ length: w }, (_, c) => g.rows.map((r) => r[c])),
    merges: g.merges.map((m) => ({ r: m.c, c: m.r, rs: m.cs, cs: m.rs })),
  };
}

/** 줄을 하나 지운다. 걸친 합친 칸은 한 줄 줄인다 */
export function deleteRow(g: Grid, r: number): Grid {
  if (g.rows.length <= 1) return g;
  const out = clone(g);
  // 지우는 줄이 합친 칸의 첫 줄이면 글을 아래로 내린다
  for (const m of out.merges) if (m.r === r && m.rs > 1) out.rows[r + 1][m.c] = out.rows[r][m.c];
  out.rows.splice(r, 1);
  out.merges = out.merges
    .map((m) => (r < m.r ? { ...m, r: m.r - 1 } : r < m.r + m.rs ? { ...m, rs: m.rs - 1 } : m))
    .filter((m) => m.rs > 1 || m.cs > 1);
  return out;
}

export function deleteCol(g: Grid, c: number): Grid {
  if (width(g) <= 1) return g;
  return transpose(deleteRow(transpose(g), c));
}

/** at 자리에 빈 줄을 넣는다 (at = 줄 수 이면 맨 끝) */
export function insertRow(g: Grid, at: number): Grid {
  const out = clone(g);
  out.rows.splice(at, 0, new Array<string>(width(g) || 1).fill(''));
  out.merges = out.merges.map((m) => (at <= m.r ? { ...m, r: m.r + 1 } : at < m.r + m.rs ? { ...m, rs: m.rs + 1 } : m));
  return out;
}

export function insertCol(g: Grid, at: number): Grid {
  return transpose(insertRow(transpose(g), at));
}

/** 줄 from 을 to 자리로 (합친 칸은 풀어서) */
export function moveRow(g: Grid, from: number, to: number): Grid {
  const out = g.merges.length ? unmerge(g, true) : clone(g);
  const [row] = out.rows.splice(from, 1);
  out.rows.splice(to, 0, row);
  return out;
}

export function moveCol(g: Grid, from: number, to: number): Grid {
  return transpose(moveRow(transpose(g), from, to));
}

const NUMERIC = /^[-+]?[₩$€£¥]?\s?\d[\d,]*(\.\d+)?\s?%?$/;
/** 정렬에 쓰는 숫자. 숫자가 아니면 NaN */
export function numberOf(s: string): number {
  const t = s.trim().replace(/\s?(원|개|명|건|%)$/, '');
  if (!NUMERIC.test(t) && !NUMERIC.test(s.trim())) return NaN;
  return Number(t.replace(/[,₩$€£¥\s%]/g, ''));
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }) : null;

/** 머리글을 빼고 한 열로 줄을 정렬한다. 숫자는 숫자로, 글은 가나다 · 숫자가 섞인 이름은 자연스러운 순서로, 빈 칸은 맨 뒤 */
export function sortRows(g: Grid, col: number, dir: 1 | -1, header: boolean): Grid {
  const out = g.merges.length ? unmerge(g, true) : clone(g);
  const head = header ? out.rows.slice(0, 1) : [];
  const body = header ? out.rows.slice(1) : out.rows;
  const allNum = body.every((r) => !r[col].trim() || !Number.isNaN(numberOf(r[col])));
  const keyed = body.map((r, i) => ({ r, i, n: numberOf(r[col]) }));
  keyed.sort((a, b) => {
    const ea = !a.r[col].trim();
    const eb = !b.r[col].trim();
    if (ea !== eb) return ea ? 1 : -1;
    if (ea) return a.i - b.i;
    const d = allNum ? a.n - b.n : collator ? collator.compare(a.r[col], b.r[col]) : a.r[col] < b.r[col] ? -1 : a.r[col] > b.r[col] ? 1 : 0;
    return d * dir || a.i - b.i;
  });
  out.rows = [...head, ...keyed.map((k) => k.r)];
  return out;
}

/** 칸마다 앞뒤 공백을 지우고, 칸 안의 연속 공백을 하나로 */
export function tidy(g: Grid): Grid {
  return { rows: g.rows.map((r) => r.map((c) => c.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').trim())), merges: g.merges.map((m) => ({ ...m })) };
}

/** 모두 빈 줄 · 빈 열을 지운다 (합친 칸이 걸친 곳은 둔다) */
export function dropEmpty(g: Grid): Grid {
  let out = clone(g);
  for (let r = out.rows.length - 1; r >= 0 && out.rows.length > 1; r--) {
    if (out.rows[r].every((c) => !c.trim()) && !out.merges.some((m) => r >= m.r && r < m.r + m.rs)) out = deleteRow(out, r);
  }
  for (let c = width(out) - 1; c >= 0 && width(out) > 1; c--) {
    if (out.rows.every((r) => !r[c].trim()) && !out.merges.some((m) => c >= m.c && c < m.c + m.cs)) out = deleteCol(out, c);
  }
  return out;
}

/** 위아래로 같은 글이 이어지는 칸을 합친다 (한 열씩) */
export function mergeSame(g: Grid, col: number, header: boolean): Grid {
  const out = clone(g);
  const start = header ? 1 : 0;
  let r = start;
  while (r < out.rows.length) {
    let e = r + 1;
    if (out.rows[r][col] && !mergeAt(out, r, col)) {
      while (e < out.rows.length && out.rows[e][col] === out.rows[r][col] && !mergeAt(out, e, col)) e++;
      if (e - r > 1) {
        for (let i = r + 1; i < e; i++) out.rows[i][col] = '';
        out.merges.push({ r, c: col, rs: e - r, cs: 1 });
      }
    }
    r = e;
  }
  return out;
}

/** 열이 숫자 열인지: 머리글을 빼고 빈 칸이 아닌 칸이 모두 숫자 */
export function numericCols(g: Grid, header: boolean, sample = 400): boolean[] {
  const body = g.rows.slice(header ? 1 : 0, (header ? 1 : 0) + sample);
  return Array.from({ length: width(g) }, (_, c) => {
    const vals = body.map((r) => r[c].trim()).filter(Boolean);
    return vals.length > 0 && vals.every((v) => !Number.isNaN(numberOf(v)));
  });
}

/** 'auto' 를 실제 정렬로: 숫자 열은 오른쪽, 나머지는 왼쪽 */
export function resolveAligns(g: Grid, aligns: Align[], header: boolean): Exclude<Align, 'auto'>[] {
  const num = numericCols(g, header);
  return num.map((n, c) => {
    const a = aligns[c] ?? 'auto';
    return a === 'auto' ? (n ? 'right' : 'left') : a;
  });
}

/** 화면 · 고정폭 글꼴에서 차지하는 칸 수. 한글 · 한자 · 전각 · 그림 문자는 2칸, 결합 문자는 0칸 */
export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f || (cp >= 0x1160 && cp <= 0x11ff)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

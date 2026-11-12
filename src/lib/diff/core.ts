// 줄 단위 비교 엔진.
// 1) 앞뒤 공통 부분을 걷어내고 2) Myers O(ND) 로 최단 편집을 찾는다.
// 차이가 너무 커서 Myers 가 예산을 넘으면 3) 양쪽에 한 번씩만 나오는 줄을 닻으로 삼아(patience) 구간을 쪼갠 뒤 다시 푼다.
// 바뀐 구간 안에서는 비슷한 줄끼리 짝지어 단어 단위로 한 번 더 비교한다.

export type WsMode = 'none' | 'edge' | 'all';

export interface DiffOptions {
  /** 공백 무시: 줄 앞뒤만 / 모든 공백 */
  ws: WsMode;
  ignoreCase: boolean;
}

export interface Seg {
  text: string;
  changed: boolean;
}

/** 화면의 한 줄. a/b 는 0부터 세는 줄 번호, 한쪽에만 있으면 다른 쪽은 null. */
export interface Row {
  a: number | null;
  b: number | null;
  changed: boolean;
  segA?: Seg[];
  segB?: Seg[];
}

export interface DiffResult {
  linesA: string[];
  linesB: string[];
  rows: Row[];
  added: number;
  removed: number;
  modified: number;
}

export const defaultOptions: DiffOptions = { ws: 'none', ignoreCase: false };

/** 줄로 나눈다. 마지막 줄바꿈 하나는 줄 끝 표시로 보고 빈 줄을 만들지 않는다. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lineKey(line: string, o: DiffOptions): string {
  let s = line;
  if (o.ws === 'edge') s = s.trim();
  else if (o.ws === 'all') s = s.replace(/\s+/g, '');
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

function intern(keysA: string[], keysB: string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const conv = (keys: string[]) => {
    const out = new Int32Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      let id = ids.get(keys[i]);
      if (id === undefined) ids.set(keys[i], (id = ids.size));
      out[i] = id;
    }
    return out;
  };
  return [conv(keysA), conv(keysB)];
}

/** 편집 거리 예산. 경로 기록이 d² 에 비례하므로 이 이상은 patience 로 쪼갠다. */
const MAX_D = 2000;

/** Myers 최단 편집. 짝지어진 위치를 out[a] = b 로 적는다. 예산을 넘으면 false. */
function myers(a: Int32Array, b: Int32Array, a0: number, a1: number, b0: number, b1: number, out: Int32Array, maxD: number): boolean {
  const N = a1 - a0;
  const M = b1 - b0;
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  const V = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // d 단계에 들어가기 전의 V (k = -d-1 .. d+1) 를 남긴다
    trace.push(V.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= N && y >= M) {
        for (let dd = d; dd > 0; dd--) {
          const P = trace[dd];
          const base = dd + 1;
          const kk = x - y;
          const pk = kk === -dd || (kk !== dd && P[kk - 1 + base] < P[kk + 1 + base]) ? kk + 1 : kk - 1;
          const px = P[pk + base];
          const py = px - pk;
          while (x > px && y > py) {
            x--;
            y--;
            out[a0 + x] = b0 + y;
          }
          x = px;
          y = py;
        }
        while (x > 0 && y > 0) {
          x--;
          y--;
          out[a0 + x] = b0 + y;
        }
        return true;
      }
    }
  }
  return false;
}

/** 양쪽 구간에 정확히 한 번씩 나오는 줄 가운데 순서가 유지되는 가장 긴 열 (patience). */
function anchors(a: Int32Array, b: Int32Array, a0: number, a1: number, b0: number, b1: number): [number, number][] {
  const seen = new Map<number, { ca: number; cb: number; ia: number; ib: number }>();
  for (let i = a0; i < a1; i++) {
    const e = seen.get(a[i]);
    if (e) e.ca++;
    else seen.set(a[i], { ca: 1, cb: 0, ia: i, ib: -1 });
  }
  for (let j = b0; j < b1; j++) {
    const e = seen.get(b[j]);
    if (e) {
      e.cb++;
      e.ib = j;
    }
  }
  const pairs: [number, number][] = [];
  for (const e of seen.values()) if (e.ca === 1 && e.cb === 1) pairs.push([e.ia, e.ib]);
  if (!pairs.length) return pairs;
  // pairs 는 a 순서 (Map 삽입 순서). b 위치의 최장 증가 부분열을 구한다.
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    const v = pairs[p][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[p] = tails[lo - 1];
    tails[lo] = p;
  }
  const res: [number, number][] = [];
  for (let p = tails[tails.length - 1]; p >= 0; p = prev[p]) res.push(pairs[p]);
  return res.reverse();
}

function diffRange(a: Int32Array, b: Int32Array, a0: number, a1: number, b0: number, b1: number, out: Int32Array, maxD: number): void {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) out[a0++] = b0++;
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) out[--a1] = --b1;
  if (a0 === a1 || b0 === b1) return;
  if (myers(a, b, a0, a1, b0, b1, out, maxD)) return;
  const anc = anchors(a, b, a0, a1, b0, b1);
  if (!anc.length) return; // 공통점을 찾을 수 없는 구간: 통째로 삭제 + 추가
  let pa = a0;
  let pb = b0;
  for (const [i, j] of anc) {
    diffRange(a, b, pa, i, pb, j, out, maxD);
    out[i] = j;
    pa = i + 1;
    pb = j + 1;
  }
  diffRange(a, b, pa, a1, pb, b1, out, maxD);
}

/** 두 열을 비교해 a 의 각 원소가 짝지어진 b 위치(없으면 -1)를 돌려준다. */
export function diffSeq(keysA: string[], keysB: string[], maxD = MAX_D): Int32Array {
  const [a, b] = intern(keysA, keysB);
  const out = new Int32Array(a.length).fill(-1);
  diffRange(a, b, 0, a.length, 0, b.length, out, maxD);
  return out;
}

// ── 줄 안 비교 ──────────────────────────────────────────────

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const isSpace = (s: string) => /^\s+$/.test(s);

function tokenize(line: string): string[] {
  return line.match(TOKEN) ?? [];
}

function pushSeg(segs: Seg[], text: string, changed: boolean) {
  if (!text) return;
  const last = segs[segs.length - 1];
  if (last && last.changed === changed) last.text += text;
  else segs.push({ text, changed });
}

/** 바뀐 조각 사이에 낀 공백은 같이 바뀐 것으로 본다 (띄엄띄엄 칠해지지 않게). */
function absorbSpaces(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const bridge = !s.changed && isSpace(s.text) && i > 0 && i < segs.length - 1;
    pushSeg(out, s.text, s.changed || bridge);
  }
  return out;
}

/** 한 줄이 다른 줄로 바뀌었을 때 달라진 부분만 표시한다. 닮은 데가 거의 없으면 null. */
export function diffInline(lineA: string, lineB: string, ignoreCase = false): { segA: Seg[]; segB: Seg[] } | null {
  const ta = tokenize(lineA);
  const tb = tokenize(lineB);
  if (!ta.length || !tb.length || ta.length > 4000 || tb.length > 4000) return null;
  const norm = (t: string[]) => (ignoreCase ? t.map((s) => s.toLowerCase()) : t);
  const [ia, ib] = intern(norm(ta), norm(tb));
  const out = new Int32Array(ia.length).fill(-1);
  if (!myers(ia, ib, 0, ia.length, 0, ib.length, out, 600)) return null;

  let common = 0;
  let solidA = 0;
  let solidB = 0;
  for (let i = 0; i < ta.length; i++) {
    if (isSpace(ta[i])) continue;
    solidA += ta[i].length;
    if (out[i] >= 0) common += ta[i].length;
  }
  for (const t of tb) if (!isSpace(t)) solidB += t.length;

  const segA: Seg[] = [];
  const segB: Seg[] = [];
  let i = 0;
  let j = 0;
  while (i < ta.length || j < tb.length) {
    if (i < ta.length && out[i] === j) {
      pushSeg(segA, ta[i++], false);
      pushSeg(segB, tb[j++], false);
      continue;
    }
    let i2 = i;
    while (i2 < ta.length && out[i2] < 0) i2++;
    const j2 = i2 < ta.length ? out[i2] : tb.length;
    const da = ta.slice(i, i2).join('');
    const db = tb.slice(j, j2).join('');
    // 단어가 통째로 바뀐 게 아니라 일부만 달라졌다면 (했습니다 → 했어요) 같은 앞뒤는 남긴다
    let p = 0;
    let s = 0;
    if (da && db) {
      const min = Math.min(da.length, db.length);
      while (p < min && da[p] === db[p]) p++;
      while (s < min - p && da[da.length - 1 - s] === db[db.length - 1 - s]) s++;
      if ((p + s) * 2 < min) p = s = 0;
      else common += p + s;
    }
    pushSeg(segA, da.slice(0, p), false);
    pushSeg(segA, da.slice(p, da.length - s), true);
    pushSeg(segA, da.slice(da.length - s), false);
    pushSeg(segB, db.slice(0, p), false);
    pushSeg(segB, db.slice(p, db.length - s), true);
    pushSeg(segB, db.slice(db.length - s), false);
    i = i2;
    j = j2;
  }
  if (common < Math.max(solidA, solidB) * 0.3) return null;
  return { segA: absorbSpaces(segA), segB: absorbSpaces(segB) };
}

/** 공백을 뺀 토큰이 얼마나 겹치는지 (0..1). 줄 짝짓기용이라 순서는 보지 않는다. */
function similarity(ta: string[], tb: string[]): number {
  const bag = new Map<string, number>();
  let na = 0;
  let nb = 0;
  for (const t of ta) {
    if (isSpace(t)) continue;
    na++;
    bag.set(t, (bag.get(t) ?? 0) + 1);
  }
  let hit = 0;
  for (const t of tb) {
    if (isSpace(t)) continue;
    nb++;
    const c = bag.get(t);
    if (c) {
      bag.set(t, c - 1);
      hit++;
    }
  }
  return na + nb ? (2 * hit) / (na + nb) : 0;
}

/** 바뀐 구간에서 지워진 줄과 추가된 줄을 닮은 것끼리 짝짓는다 (순서 유지). */
function pairBlock(dels: number[], inss: number[], linesA: string[], linesB: string[], ignoreCase: boolean, rows: Row[]): void {
  const k = dels.length;
  const m = inss.length;
  const pairs: [number, number][] = []; // dels/inss 안의 위치
  if (k && m && k * m <= 2500) {
    const lower = (s: string) => (ignoreCase ? s.toLowerCase() : s);
    const ta = dels.map((i) => tokenize(lower(linesA[i])));
    const tb = inss.map((j) => tokenize(lower(linesB[j])));
    const W = m + 1;
    const score = new Float64Array((k + 1) * W);
    const sim = new Float64Array(k * m);
    for (let i = k - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const s = similarity(ta[i], tb[j]);
        sim[i * m + j] = s;
        let best = Math.max(score[(i + 1) * W + j], score[i * W + j + 1]);
        if (s >= 0.4) best = Math.max(best, score[(i + 1) * W + j + 1] + s);
        score[i * W + j] = best;
      }
    }
    let i = 0;
    let j = 0;
    while (i < k && j < m) {
      const s = sim[i * m + j];
      if (s >= 0.4 && score[i * W + j] === score[(i + 1) * W + j + 1] + s) pairs.push([i++, j++]);
      else if (score[i * W + j] === score[(i + 1) * W + j]) i++;
      else j++;
    }
  }
  // 짝 사이의 남은 줄은 위에서부터 나란히 놓는다
  const flush = (d0: number, d1: number, i0: number, i1: number) => {
    const n = Math.max(d1 - d0, i1 - i0);
    for (let t = 0; t < n; t++) {
      rows.push({ a: d0 + t < d1 ? dels[d0 + t] : null, b: i0 + t < i1 ? inss[i0 + t] : null, changed: true });
    }
  };
  let pd = 0;
  let pi = 0;
  for (const [d, i] of pairs) {
    flush(pd, d, pi, i);
    const inline = diffInline(linesA[dels[d]], linesB[inss[i]], ignoreCase);
    rows.push({ a: dels[d], b: inss[i], changed: true, segA: inline?.segA, segB: inline?.segB });
    pd = d + 1;
    pi = i + 1;
  }
  flush(pd, k, pi, m);
}

function buildRows(linesA: string[], linesB: string[], match: Int32Array, ignoreCase: boolean): Row[] {
  const rows: Row[] = [];
  const n = linesA.length;
  const m = linesB.length;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && match[i] === j) {
      rows.push({ a: i++, b: j++, changed: false });
      continue;
    }
    const dels: number[] = [];
    const inss: number[] = [];
    while (i < n && match[i] < 0) dels.push(i++);
    const stop = i < n ? match[i] : m;
    while (j < stop) inss.push(j++);
    pairBlock(dels, inss, linesA, linesB, ignoreCase, rows);
  }
  return rows;
}

export function diffLines(textA: string, textB: string, options: Partial<DiffOptions> = {}): DiffResult {
  const o = { ...defaultOptions, ...options };
  const linesA = splitLines(textA);
  const linesB = splitLines(textB);
  const plain = o.ws === 'none' && !o.ignoreCase;
  const match = diffSeq(plain ? linesA : linesA.map((l) => lineKey(l, o)), plain ? linesB : linesB.map((l) => lineKey(l, o)));
  const rows = buildRows(linesA, linesB, match, o.ignoreCase);
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const r of rows) {
    if (!r.changed) continue;
    if (r.a === null) added++;
    else if (r.b === null) removed++;
    else modified++;
  }
  return { linesA, linesB, rows, added, removed, modified };
}

// ── 패치 (unified diff) ─────────────────────────────────────

const NO_EOL = '\\ No newline at end of file';

/** git apply / patch 로 적용할 수 있는 unified diff. 차이가 없으면 빈 문자열. */
export function unifiedPatch(textA: string, textB: string, nameA = 'a', nameB = 'b', context = 3): string {
  const linesA = splitLines(textA);
  const linesB = splitLines(textB);
  const noEolA = textA !== '' && !/[\r\n]$/.test(textA);
  const noEolB = textB !== '' && !/[\r\n]$/.test(textB);
  // 마지막 줄바꿈 유무가 다르면 마지막 줄은 다른 줄이다
  const keys = (lines: string[], noEol: boolean) => (noEol ? lines.map((l, i) => (i === lines.length - 1 ? l + '\u0000' : l)) : lines);
  const match = diffSeq(keys(linesA, noEolA), keys(linesB, noEolB));

  interface Op {
    t: ' ' | '-' | '+';
    a: number;
    b: number;
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < linesA.length || j < linesB.length) {
    if (i < linesA.length && match[i] === j) {
      ops.push({ t: ' ', a: i++, b: j++ });
      continue;
    }
    while (i < linesA.length && match[i] < 0) ops.push({ t: '-', a: i++, b: j });
    const stop = i < linesA.length ? match[i] : linesB.length;
    while (j < stop) ops.push({ t: '+', a: i, b: j++ });
  }
  const changes: number[] = [];
  ops.forEach((op, idx) => op.t !== ' ' && changes.push(idx));
  if (!changes.length) return '';

  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  let c = 0;
  while (c < changes.length) {
    const start = Math.max(0, changes[c] - context);
    let last = changes[c];
    while (c + 1 < changes.length && changes[c + 1] - last <= context * 2) last = changes[++c];
    c++;
    const end = Math.min(ops.length, last + context + 1);
    let lenA = 0;
    let lenB = 0;
    const body: string[] = [];
    for (let k = start; k < end; k++) {
      const op = ops[k];
      if (op.t !== '+') lenA++;
      if (op.t !== '-') lenB++;
      body.push(op.t + (op.t === '+' ? linesB[op.b] : linesA[op.a]));
      const lastA = op.t !== '+' && op.a === linesA.length - 1 && noEolA;
      const lastB = op.t !== '-' && op.b === linesB.length - 1 && noEolB;
      if (lastA || lastB) body.push(NO_EOL);
    }
    const first = ops[start];
    const range = (at: number, len: number) => `${len ? at + 1 : at},${len}`;
    out.push(`@@ -${range(first.a, lenA)} +${range(first.b, lenB)} @@`, ...body);
  }
  return out.join('\n') + '\n';
}

// ── JSON ────────────────────────────────────────────────────

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

/** 들여쓰기와 키 순서 차이를 없애 내용만 비교할 수 있게 한다. */
export function normalizeJson(text: string, sort = true): { ok: true; text: string } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, text: '' };
  try {
    const v = JSON.parse(text);
    return { ok: true, text: JSON.stringify(sort ? sortKeys(v) : v, null, 2) + '\n' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 조 편성과 사다리. 결과는 암호학적 난수로 먼저 정하고, 화면은 그 결과를 보여 줄 뿐이다.
import { randomInt, type Participant } from '../raffle/core';

/** 0 이상 n 미만의 정수 난수 */
export type Rand = (n: number) => number;
const cryptoRand: Rand = (n) => randomInt(n);

export function shuffle<T>(list: readonly T[], rand: Rand = cryptoRand): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 조 편성 ───────────────────────────────────────────────────────────────

/** 부가 정보를 칸별로 나눈다 (명단 파서가 ' · ' 로 이어 붙여 둔 것) */
export const attrsOf = (p: Participant): string[] => (p.info ? p.info.split(' · ') : []);

export interface NameGroups {
  /** 명단에서의 자리(0부터)로 바꾼 묶음들. 두 명 이상인 것만 */
  groups: number[][];
  /** 명단에 없는 이름 */
  unknown: string[];
}

/** "김하늘, 이서연" 처럼 한 줄에 한 묶음씩 적은 이름을 명단의 자리로 바꾼다. 같은 이름이 여럿이면 모두 넣는다. */
export function parseGroups(text: string, people: readonly Participant[]): NameGroups {
  const byName = new Map<string, number[]>();
  people.forEach((p, i) => byName.set(p.name, [...(byName.get(p.name) ?? []), i]));
  const groups: number[][] = [];
  const unknown: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = new Set<number>();
    for (const raw of line.split(/[,;\t/]|\s{2,}/)) {
      const name = raw.trim();
      if (!name) continue;
      const found = byName.get(name);
      if (found) found.forEach((i) => idx.add(i));
      else if (!unknown.includes(name)) unknown.push(name);
    }
    if (idx.size >= 2) groups.push([...idx]);
  }
  return { groups, unknown };
}

export interface SplitOptions {
  teams: number;
  /** 부가 정보(소속 · 성별 등)가 조마다 고르게 섞이게 한다 */
  balance: boolean;
  /** 같은 조에 넣지 않을 사람 묶음 */
  apart?: number[][];
  /** 같은 조에 넣을 사람 묶음 */
  together?: number[][];
  rand?: Rand;
}

export interface SplitResult {
  /** 조마다 사람의 자리(0부터) */
  teams: number[][];
  /** 끝내 같은 조가 된 '떨어뜨릴' 쌍 */
  unmet: [number, number][];
}

/** 조 수만큼 인원을 고르게 나눈 크기 (차이는 많아야 1명) */
export function teamSizes(people: number, teams: number): number[] {
  const k = Math.max(1, Math.min(Math.floor(teams) || 1, Math.max(1, people)));
  const base = Math.floor(people / k);
  return Array.from({ length: k }, (_, i) => base + (i < people % k ? 1 : 0));
}

const W_SIZE = 10_000;
const W_APART = 1_000;

/**
 * 무작위로 나눈 뒤, 두 사람을 맞바꾸거나 한 사람을 옮겨 보며 나아질 때만 받아들인다.
 * 따지는 것: 조 인원이 고른가 → 떨어뜨릴 사람이 갈렸는가 → 부가 정보가 고르게 섞였는가.
 */
export function splitTeams(people: readonly Participant[], opts: SplitOptions): SplitResult {
  const rand = opts.rand ?? cryptoRand;
  const n = people.length;
  const target = teamSizes(n, opts.teams);
  const k = target.length;
  if (n === 0) return { teams: target.map(() => []), unmet: [] };

  // 같은 조에 넣을 사람들은 한 덩어리로 움직인다
  const parent = people.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const g of opts.together ?? []) for (const i of g) parent[find(i)] = find(g[0]);
  const unitOf = new Map<number, number[]>();
  for (let i = 0; i < n; i++) unitOf.set(find(i), [...(unitOf.get(find(i)) ?? []), i]);
  const units = shuffle([...unitOf.values()], rand);

  // 떨어뜨릴 상대
  const foes: number[][] = people.map(() => []);
  for (const g of opts.apart ?? [])
    for (const a of g)
      for (const b of g)
        if (a !== b && !foes[a].includes(b)) foes[a].push(b);

  // 부가 정보 값에 번호를 매긴다. 한 명뿐인 값은 섞을 것이 없으니 뺀다.
  const valueIds: number[][] = people.map(() => []);
  const totals: number[] = [];
  if (opts.balance) {
    const ids = new Map<string, number>();
    const seen = new Map<string, number>();
    const keys = people.map((p) => attrsOf(p).map((v, c) => `${c}\u0000${v}`));
    for (const ks of keys) for (const key of ks) seen.set(key, (seen.get(key) ?? 0) + 1);
    keys.forEach((ks, i) => {
      for (const key of ks) {
        if (seen.get(key)! < 2) continue;
        if (!ids.has(key)) {
          ids.set(key, totals.length);
          totals.push(seen.get(key)!);
        }
        valueIds[i].push(ids.get(key)!);
      }
    });
  }
  const V = totals.length;
  const expected = target.map((size) => totals.map((t) => (t * size) / n));

  const teamOf = new Int32Array(n);
  const size = new Array<number>(k).fill(0);
  const counts = target.map(() => new Float64Array(V));
  const place = (unit: number[], t: number, sign: 1 | -1) => {
    size[t] += sign * unit.length;
    for (const i of unit) {
      if (sign > 0) teamOf[i] = t;
      for (const v of valueIds[i]) counts[t][v] += sign;
    }
  };

  // 처음: 큰 덩어리부터, 자리가 가장 많이 남은 조에
  const order = units.map((u, i) => ({ u, i })).sort((a, b) => b.u.length - a.u.length || a.i - b.i);
  const unitTeam = new Map<number[], number>();
  for (const { u } of order) {
    let best: number[] = [];
    let room = -Infinity;
    for (let t = 0; t < k; t++) {
      const r = target[t] - size[t];
      if (r > room) (room = r), (best = [t]);
      else if (r === room) best.push(t);
    }
    const t = best[rand(best.length)];
    place(u, t, 1);
    unitTeam.set(u, t);
  }

  const clash = (unit: number[], t: number) => {
    let c = 0;
    for (const i of unit) for (const f of foes[i]) if (teamOf[f] === t && !unit.includes(f)) c++;
    return c;
  };
  const cost = (t: number, vals: Set<number>) => {
    let c = W_SIZE * (size[t] - target[t]) ** 2;
    for (const v of vals) c += (counts[t][v] - expected[t][v]) ** 2;
    return c;
  };

  if (k > 1 && units.length > 1) {
    const rounds = Math.min(300_000, Math.max(4_000, n * 300));
    for (let it = 0; it < rounds; it++) {
      const u = units[rand(units.length)];
      const a = unitTeam.get(u)!;
      // 절반은 맞바꾸기, 절반은 옮기기 (덩어리 크기가 다르면 옮겨야 인원이 맞는다)
      const w = rand(2) ? units[rand(units.length)] : null;
      const b = w ? unitTeam.get(w)! : (a + 1 + rand(k - 1)) % k;
      if (a === b) continue;
      const vals = new Set<number>();
      for (const i of u) for (const v of valueIds[i]) vals.add(v);
      if (w) for (const i of w) for (const v of valueIds[i]) vals.add(v);
      const before = cost(a, vals) + cost(b, vals) + W_APART * (clash(u, a) + (w ? clash(w, b) : 0));
      place(u, a, -1);
      place(u, b, 1);
      if (w) {
        place(w, b, -1);
        place(w, a, 1);
      }
      const after = cost(a, vals) + cost(b, vals) + W_APART * (clash(u, b) + (w ? clash(w, a) : 0));
      if (after <= before) {
        unitTeam.set(u, b);
        if (w) unitTeam.set(w, a);
      } else {
        place(u, b, -1);
        place(u, a, 1);
        if (w) {
          place(w, a, -1);
          place(w, b, 1);
        }
      }
    }
  }

  const teams: number[][] = target.map(() => []);
  // 조 안에서의 순서도 무작위
  for (const i of shuffle(people.map((_, i) => i), rand)) teams[teamOf[i]].push(i);
  const unmet: [number, number][] = [];
  for (let a = 0; a < n; a++) for (const b of foes[a]) if (a < b && teamOf[a] === teamOf[b]) unmet.push([a, b]);
  return { teams, unmet };
}

export type TeamStyle = '1조' | 'A조' | '1팀' | 'A팀';
export function teamName(i: number, style: TeamStyle): string {
  const unit = style.slice(1);
  if (style[0] === '1') return `${i + 1}${unit}`;
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return `${s}${unit}`;
}

export interface Team {
  name: string;
  members: { name: string; info: string; leader?: boolean }[];
}

export function teamsText(teams: readonly Team[]): string {
  return teams.map((t) => `[${t.name}] ${t.members.length}명\n` + t.members.map((m) => `${m.name}${m.info ? ` (${m.info})` : ''}${m.leader ? ' ★' : ''}`).join('\n')).join('\n\n');
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function teamsCsv(teams: readonly Team[]): string {
  const rows = [['조', '이름', '부가 정보', '조장']];
  for (const t of teams) for (const m of t.members) rows.push([t.name, m.name, m.info, m.leader ? '조장' : '']);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** 조마다 부가 정보가 어떻게 섞였는지 (칸별로 많은 순) */
export function mix(members: readonly { info: string }[]): [string, number][] {
  const m = new Map<string, number>();
  for (const p of members) for (const v of p.info ? p.info.split(' · ') : []) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

// ── 사다리 ────────────────────────────────────────────────────────────────

export interface Ladder {
  cols: number;
  /** rungs[r][c] = r번째 줄에서 c 와 c+1 세로줄을 잇는 가로대가 있는가 */
  rungs: boolean[][];
  /** 가로대를 그릴 높이 (줄 번호 + 조금 어긋남). 같은 줄 안에서만 어긋나 순서는 바뀌지 않는다 */
  y: number[][];
  /** perm[위 자리] = 아래 자리 */
  perm: number[];
}

/**
 * 결과(누가 어디로 가는가)를 먼저 공평하게 뽑고, 그 결과가 나오는 사다리를 그린다.
 * 위쪽은 아무렇게나 놓은 가로대, 아래쪽은 거기서 정해 둔 결과까지 가는 데 필요한 가로대다.
 * 아래쪽은 이웃끼리만 바꾸는 정렬(홀짝 정렬)의 맞바꿈 하나하나가 가로대가 된다.
 */
export function makeLadder(cols: number, rand: Rand = cryptoRand, perm: number[] = shuffle(Array.from({ length: cols }, (_, i) => i), rand)): Ladder {
  const rows: boolean[][] = [];
  // 지금 각 세로줄에 있는 사람이 가야 할 아래 자리
  const arr = perm.slice();
  const free = cols > 1 ? Math.max(5, Math.min(12, cols + 2)) : 0;
  for (let r = 0; r < free; r++) {
    const row = new Array<boolean>(cols - 1).fill(false);
    let any = false;
    for (let c = 0; c < cols - 1; c++) {
      if (rand(5) < 2) {
        row[c] = any = true;
        c++;
      }
    }
    if (!any) row[rand(cols - 1)] = true;
    for (let c = 0; c < cols - 1; c++) if (row[c]) [arr[c], arr[c + 1]] = [arr[c + 1], arr[c]];
    rows.push(row);
  }
  for (let round = 0, parity = rand(2); round < cols + 1; round++, parity ^= 1) {
    const row = new Array<boolean>(Math.max(0, cols - 1)).fill(false);
    let any = false;
    for (let c = parity; c + 1 < cols; c += 2) {
      if (arr[c] > arr[c + 1]) {
        [arr[c], arr[c + 1]] = [arr[c + 1], arr[c]];
        row[c] = any = true;
      }
    }
    if (any) rows.push(row);
  }
  const y = rows.map((row, r) => row.map(() => r + (rand(61) - 30) / 100));
  return { cols, rungs: rows, y, perm };
}

export interface Trace {
  end: number;
  /** 꺾이는 점들 [세로줄, 높이]. 높이 -1 이 맨 위, 줄 수가 맨 아래 */
  points: [number, number][];
}

export function trace(l: Ladder, start: number): Trace {
  let c = start;
  const points: [number, number][] = [[c, -1]];
  l.rungs.forEach((row, r) => {
    const to = row[c] ? c + 1 : c > 0 && row[c - 1] ? c - 1 : c;
    if (to !== c) {
      const y = l.y[r][Math.min(c, to)];
      points.push([c, y], [to, y]);
      c = to;
    }
  });
  points.push([c, l.rungs.length]);
  return { end: c, points };
}

/** 아래에 놓을 것들. 사람보다 모자라면 fill 로 채우고, 많으면 자른다. */
export function ladderResults(text: string, cols: number, fill = '꽝'): string[] {
  const list = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cols);
  while (list.length < cols) list.push(fill);
  return list;
}

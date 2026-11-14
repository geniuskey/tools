// 없는 주소로 들어왔을 때, 무엇을 찾으려 했는지 짐작한다.
// 1) 주소 조각이 도구 주소 그대로 (/qr/abc, /qr.html) 2) 도구의 검색어 (/json, /정규식) 3) 오타 (/calulator)
import { tools, type ToolInfo } from './tools';

export interface Guess {
  tool: ToolInfo;
  /** exact: 도구 주소가 들어 있다 · keyword: 검색어와 같다 · typo: 한두 글자 다르다 */
  via: 'exact' | 'keyword' | 'typo';
  /** 주소에서 읽은 낱말 */
  typed: string;
  /** 그 낱말이 가리킨다고 본 말 (도구 주소 또는 검색어) */
  word: string;
}

export interface Seg {
  text: string;
  changed: boolean;
}

/** 주소를 낱말로. 퍼센트 인코딩을 풀고, 확장자를 떼고, 소문자로. */
export function words(pathname: string): string[] {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // 깨진 퍼센트 인코딩은 그대로 둔다
  }
  return path
    .normalize('NFC')
    .toLowerCase()
    .split('/')
    .map((s) => s.trim().replace(/\.(html?|php|aspx?)$/, ''))
    .filter(Boolean);
}

/** 글자를 바꾸기 · 넣기 · 빼기 · 이웃한 두 글자 맞바꾸기를 한 번으로 세는 거리 */
export function distance(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => [i, ...new Array<number>(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** 이 길이의 낱말에서 오타로 봐 줄 수 있는 글자 수 */
const slack = (len: number) => (len < 4 ? 0 : len < 6 ? 1 : len < 10 ? 2 : 3);

const vocab: { tool: ToolInfo; id: string; keys: string[] }[] = tools.map((tool) => ({
  tool,
  id: tool.href.slice(1),
  keys: [...new Set(`${tool.name} ${tool.keywords}`.toLowerCase().split(/[\s·]+/).filter(Boolean))],
}));

export function guess(pathname: string): Guess | null {
  const typed = words(pathname);
  if (!typed.length) return null;

  for (const w of typed) {
    const hit = vocab.find((v) => v.id === w);
    if (hit) return { tool: hit.tool, via: 'exact', typed: w, word: hit.id };
  }
  for (const w of typed) {
    const hit = vocab.find((v) => v.keys.includes(w));
    if (hit) return { tool: hit.tool, via: 'keyword', typed: w, word: w };
  }

  // 오타: 도구 주소를 먼저 보고, 같은 거리면 주소 쪽을 고른다
  let best: (Guess & { d: number }) | null = null;
  for (const w of typed) {
    for (const v of vocab) {
      for (const [k, target] of [v.id, ...v.keys].entries()) {
        const max = Math.min(slack(target.length), slack(w.length));
        if (!max || Math.abs([...target].length - [...w].length) > max) continue;
        const d = distance(w, target) + (k === 0 ? 0 : 0.5);
        if (d - (k === 0 ? 0 : 0.5) <= max && (!best || d < best.d)) best = { tool: v.tool, via: 'typo', typed: w, word: target, d };
      }
    }
  }
  if (!best) return null;
  const { d: _d, ...found } = best;
  return found;
}

/** 두 낱말을 글자 단위로 견주어 달라진 글자를 표시한다 (가장 긴 공통 부분열) */
export function charDiff(a: string, b: string): { segA: Seg[]; segB: Seg[] } {
  const s = [...a];
  const t = [...b];
  const lcs: number[][] = Array.from({ length: s.length + 1 }, () => new Array<number>(t.length + 1).fill(0));
  for (let i = s.length - 1; i >= 0; i--) {
    for (let j = t.length - 1; j >= 0; j--) {
      lcs[i][j] = s[i] === t[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const segA: Seg[] = [];
  const segB: Seg[] = [];
  const push = (out: Seg[], text: string, changed: boolean) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < s.length || j < t.length) {
    if (i < s.length && j < t.length && s[i] === t[j]) {
      push(segA, s[i++], false);
      push(segB, t[j++], false);
    } else if (j >= t.length || (i < s.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      push(segA, s[i++], true);
    } else {
      push(segB, t[j++], true);
    }
  }
  return { segA, segB };
}

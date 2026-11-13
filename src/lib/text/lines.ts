// 줄 단위 정리와 글자 수 세기.

export interface Stats {
  /** 글자 수 (공백 포함). 이모지 · 조합 글자도 눈에 보이는 대로 한 글자 */
  chars: number;
  charsNoSpace: number;
  words: number;
  lines: number;
  /** UTF-8 바이트 (한글 3바이트) */
  utf8: number;
  /** EUC-KR 식 바이트 (한글 2바이트). 지원서 · 문자 메시지에서 흔히 쓰는 기준 */
  euckr: number;
  /** 200자 원고지 장수 */
  pages: number;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;

export function countChars(text: string): number {
  // 순수 BMP 글만 있으면 길이가 곧 글자 수 (긴 글에서 빠르게)
  if (!/[\ud800-\udfff̀-ͯ‍️ᄀ-ᇿ\r]/.test(text)) return text.length;
  if (!segmenter) return [...text].length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

export function stats(text: string): Stats {
  const chars = countChars(text);
  const spaces = text.match(/\s/g)?.length ?? 0;
  // \r\n 은 한 글자로 세었으므로 공백에서도 한 번만 뺀다
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  let utf8 = 0;
  let euckr = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    utf8 += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    euckr += cp < 0x80 ? 1 : 2;
  }
  return {
    chars,
    charsNoSpace: chars - (spaces - crlf),
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    lines: text ? text.split(/\r?\n/).length : 0,
    utf8,
    euckr,
    pages: Math.ceil(chars / 200),
  };
}

export interface OpResult {
  text: string;
  /** 무엇이 바뀌었는지 한마디 */
  note: string;
}

export type OpId =
  | 'sort'
  | 'sortDesc'
  | 'sortLength'
  | 'reverse'
  | 'shuffle'
  | 'dedupe'
  | 'trim'
  | 'dropBlank'
  | 'squeeze'
  | 'upper'
  | 'lower'
  | 'title'
  | 'number'
  | 'join'
  | 'split'
  | 'wrap';

export interface OpArgs {
  /** 잇기 · 나누기에 쓰는 구분자 (\n, \t 를 글자 그대로 적을 수 있다) */
  delimiter?: string;
  prefix?: string;
  suffix?: string;
  /** 섞기용 난수: 0 이상 n 미만 */
  rand?: (n: number) => number;
}

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'variant' });
const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

export function applyOp(id: OpId, text: string, args: OpArgs = {}): OpResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = (ls: string[], note: string): OpResult => ({ text: ls.join(eol), note });
  const each = (f: (l: string) => string, what: string) => {
    let changed = 0;
    const ls = lines.map((l) => {
      const r = f(l);
      if (r !== l) changed++;
      return r;
    });
    return out(ls, changed ? `${changed.toLocaleString('ko-KR')}줄에서 ${what}` : '바뀐 줄이 없습니다');
  };
  switch (id) {
    case 'sort':
      return out([...lines].sort(collator.compare), '가나다 · 숫자 순으로 정렬했습니다');
    case 'sortDesc':
      return out([...lines].sort((a, b) => collator.compare(b, a)), '거꾸로 정렬했습니다');
    case 'sortLength':
      return out([...lines].sort((a, b) => [...a].length - [...b].length || collator.compare(a, b)), '짧은 줄부터 정렬했습니다');
    case 'reverse':
      return out([...lines].reverse(), '줄 순서를 뒤집었습니다');
    case 'shuffle': {
      const rand = args.rand ?? ((n: number) => Math.floor(Math.random() * n));
      const a = [...lines];
      for (let i = a.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return out(a, '줄을 섞었습니다');
    }
    case 'dedupe': {
      const seen = new Set<string>();
      const kept = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
      const n = lines.length - kept.length;
      return out(kept, n ? `겹치는 ${n.toLocaleString('ko-KR')}줄을 지웠습니다` : '겹치는 줄이 없습니다');
    }
    case 'trim':
      return each((l) => l.trim(), '앞뒤 공백을 지웠습니다');
    case 'dropBlank': {
      const kept = lines.filter((l) => l.trim() !== '');
      const n = lines.length - kept.length;
      return out(kept, n ? `빈 줄 ${n.toLocaleString('ko-KR')}개를 지웠습니다` : '빈 줄이 없습니다');
    }
    case 'squeeze':
      return each((l) => l.replace(/[ \t 　]{2,}/g, ' '), '이어진 공백을 하나로 줄였습니다');
    case 'upper':
      return each((l) => l.toUpperCase(), '대문자로 바꿨습니다');
    case 'lower':
      return each((l) => l.toLowerCase(), '소문자로 바꿨습니다');
    case 'title':
      return each((l) => l.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()), '낱말 첫 글자를 대문자로 바꿨습니다');
    case 'number': {
      const width = String(lines.length).length;
      return out(lines.map((l, i) => `${String(i + 1).padStart(width, ' ')}. ${l}`), '줄 번호를 붙였습니다');
    }
    case 'join': {
      const d = unescape(args.delimiter ?? ', ');
      const kept = lines.filter((l) => l.trim() !== '');
      return { text: kept.join(d), note: `${kept.length.toLocaleString('ko-KR')}줄을 한 줄로 이었습니다` };
    }
    case 'split': {
      const d = unescape(args.delimiter ?? ',');
      if (!d) return { text, note: '나눌 구분자를 적어 주세요' };
      const parts = lines.flatMap((l) => l.split(d).map((s) => s.trim())).filter((s) => s !== '');
      return out(parts, `${parts.length.toLocaleString('ko-KR')}줄로 나눴습니다`);
    }
    case 'wrap': {
      const p = unescape(args.prefix ?? '');
      const s = unescape(args.suffix ?? '');
      return out(lines.map((l) => (l === '' ? l : p + l + s)), '줄마다 앞뒤에 붙였습니다');
    }
  }
}

// 정규식: 실행(일치 찾기 · 바꾸기)과 풀이(식을 한국어로 읽어 주기).

export interface Match {
  index: number;
  end: number;
  text: string;
  /** 묶음 1, 2, … (잡히지 않았으면 null) */
  groups: (string | null)[];
  named: Record<string, string | null>;
}

export interface RunResult {
  matches: Match[];
  /** 일치가 더 있었지만 잘랐는가 */
  truncated: boolean;
  /** 바꾼 결과 (replacement 를 준 경우) */
  replaced: string | null;
}

export const MAX_MATCHES = 5000;

/** 식이 틀렸으면 이유를, 맞으면 null 을 돌려준다 */
export function patternError(pattern: string, flags: string): string | null {
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (e) {
    return translateError(e instanceof Error ? e.message : String(e));
  }
}

const ERRORS: [RegExp, string][] = [
  [/Unterminated group/i, '괄호 ( 를 닫지 않았습니다.'],
  [/Unmatched '\)'/i, '여는 괄호 없이 ) 가 나왔습니다.'],
  [/Unterminated character class|missing \/|Lone quantifier brackets/i, '대괄호 [ 를 닫지 않았습니다.'],
  [/Nothing to repeat/i, '반복 기호(* + ? {n}) 앞에 반복할 것이 없습니다.'],
  [/Invalid group/i, '괄호 안의 (? … ) 꼴이 올바르지 않습니다.'],
  [/Range out of order in character class/i, '대괄호 안의 범위가 거꾸로입니다 (예: z-a).'],
  [/numbers out of order in \{\} quantifier/i, '{n,m} 에서 앞 숫자가 더 큽니다.'],
  [/\\ at end of pattern/i, '식이 \\ 로 끝났습니다. 뒤에 글자가 필요합니다.'],
  [/Invalid escape|Invalid unicode escape|Invalid Unicode escape/i, '쓸 수 없는 \\ 표현입니다.'],
  [/Invalid capture group name|Invalid named reference|Invalid named capture referenced/i, '묶음 이름이 올바르지 않거나 없는 이름을 가리킵니다.'],
  [/Duplicate capture group name/i, '같은 이름의 묶음이 두 번 나왔습니다.'],
  [/Invalid property name/i, '\\p{…} 안의 유니코드 속성 이름을 알 수 없습니다.'],
  [/Invalid flags/i, '쓸 수 없는 옵션 조합입니다.'],
  [/Incomplete quantifier/i, '{ } 반복 표현이 끝나지 않았습니다.'],
  [/Invalid quantifier/i, '반복 기호를 쓸 수 없는 자리입니다.'],
];
function translateError(msg: string): string {
  for (const [re, ko] of ERRORS) if (re.test(msg)) return ko;
  return msg.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '');
}

/** JS 와 똑같이 동작한다: g 가 없으면 첫 일치만. */
export function runRegex(pattern: string, flags: string, text: string, replacement: string | null = null, limit = MAX_MATCHES): RunResult {
  const re = new RegExp(pattern, flags);
  const matches: Match[] = [];
  let truncated = false;
  const push = (m: RegExpExecArray) =>
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: m.slice(1).map((g) => g ?? null),
      named: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? null])),
    });
  if (re.global || re.sticky) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      push(m);
      if (!re.global) break;
      // 빈 일치에서 제자리걸음하지 않게 한 글자 나아간다
      if (m[0] === '') re.lastIndex += re.unicode && text.codePointAt(re.lastIndex)! > 0xffff ? 2 : 1;
    }
  } else {
    const m = re.exec(text);
    if (m) push(m);
  }
  return { matches, truncated, replaced: replacement == null ? null : text.replace(new RegExp(pattern, flags), replacement) };
}

// ── 풀이 ──────────────────────────────────────────────────────────────────

export interface Part {
  /** 식에서 이 부분의 글자 */
  text: string;
  desc: string;
  /** 괄호 안으로 들어간 깊이 */
  depth: number;
  kind: 'literal' | 'class' | 'escape' | 'anchor' | 'group' | 'alt';
}

const SIMPLE: Record<string, [string, Part['kind']]> = {
  d: ['숫자 하나 (0~9)', 'class'],
  D: ['숫자가 아닌 글자 하나', 'class'],
  w: ['영문자 · 숫자 · 밑줄(_) 중 하나', 'class'],
  W: ['영문자 · 숫자 · 밑줄이 아닌 글자 하나', 'class'],
  s: ['공백 하나 (띄어쓰기 · 탭 · 줄바꿈)', 'class'],
  S: ['공백이 아닌 글자 하나', 'class'],
  b: ['낱말의 경계 (글자와 글자 아닌 것 사이)', 'anchor'],
  B: ['낱말의 경계가 아닌 자리', 'anchor'],
  n: ['줄바꿈', 'escape'],
  r: ['캐리지 리턴 (\\r)', 'escape'],
  t: ['탭', 'escape'],
  f: ['폼 피드', 'escape'],
  v: ['세로 탭', 'escape'],
  '0': ['널 문자', 'escape'],
};
const SCRIPTS: Record<string, string> = { Hangul: '한글', Han: '한자', Latin: '로마자', Hiragana: '히라가나', Katakana: '가타카나', Cyrillic: '키릴 문자', Greek: '그리스 문자' };
const PROPS: Record<string, string> = { L: '글자', Letter: '글자', Lu: '대문자', Ll: '소문자', N: '숫자', Nd: '숫자', P: '문장 부호', S: '기호', Z: '공백', Emoji: '이모지', Emoji_Presentation: '이모지', Extended_Pictographic: '그림 문자' };

function propName(body: string): string {
  const m = /^(?:Script|sc|Script_Extensions|scx)=(.+)$/.exec(body);
  if (m) return SCRIPTS[m[1]] ?? `${m[1]} 문자`;
  return PROPS[body] ?? `유니코드 속성 ${body}`;
}

const show = (ch: string) => (ch === ' ' ? '띄어쓰기' : ch === '\t' ? '탭' : ch === '\n' ? '줄바꿈' : `'${ch}'`);

/** 식을 앞에서부터 읽어 한 줄씩 풀이한다. 올바른 식을 넣는다고 보지만, 틀린 식에도 죽지 않는다. */
export function explain(pattern: string, flags = ''): Part[] {
  const parts: Part[] = [];
  const multi = flags.includes('m');
  const dotAll = flags.includes('s');
  let i = 0;
  let depth = 0;
  let groupNo = 0;
  /** 열린 괄호마다 닫을 때 쓸 말 */
  const open: string[] = [];

  const add = (text: string, desc: string, kind: Part['kind']) => parts.push({ text, desc, depth, kind });

  const quantifier = (): { text: string; desc: string } | null => {
    const rest = pattern.slice(i);
    const m = /^(?:[*+?]|\{(\d+)(,(\d*))?\})/.exec(rest);
    if (!m) return null;
    let desc: string;
    if (m[0] === '*') desc = '0번 이상 반복';
    else if (m[0] === '+') desc = '1번 이상 반복';
    else if (m[0] === '?') desc = '있어도 되고 없어도 됨';
    else if (m[2] == null) desc = `정확히 ${m[1]}번`;
    else if (m[3] === '') desc = `${m[1]}번 이상 반복`;
    else desc = `${m[1]}~${m[3]}번 반복`;
    let text = m[0];
    if (rest[text.length] === '?') {
      text += '?';
      desc += ' (되도록 적게)';
    }
    i += text.length;
    return { text, desc };
  };
  /** 방금 넣은 부분 뒤에 반복 기호가 오면 그 풀이에 덧붙인다 */
  const withQuantifier = () => {
    const q = quantifier();
    if (!q) return false;
    const last = parts[parts.length - 1];
    last.text += q.text;
    last.desc += ` — ${q.desc}`;
    return true;
  };

  const escape = (inClass: boolean): { text: string; desc: string; kind: Part['kind']; char?: string } => {
    const start = i;
    i++; // '\'
    const c = pattern[i++] ?? '';
    let m: RegExpExecArray | null;
    if (c === 'b' && inClass) return { text: '\\b', desc: '백스페이스', kind: 'escape' };
    if (SIMPLE[c]) return { text: `\\${c}`, desc: SIMPLE[c][0], kind: SIMPLE[c][1] };
    if ((c === 'p' || c === 'P') && (m = /^\{([^}]*)\}/.exec(pattern.slice(i)))) {
      i += m[0].length;
      return { text: pattern.slice(start, i), desc: c === 'p' ? `${propName(m[1])} 하나` : `${propName(m[1])}가 아닌 글자 하나`, kind: 'class' };
    }
    if (c === 'u' && (m = /^(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(pattern.slice(i)))) {
      i += m[0].length;
      const ch = String.fromCodePoint(parseInt(m[1] ?? m[2], 16));
      return { text: pattern.slice(start, i), desc: `글자 ${show(ch)} (유니코드 ${(m[1] ?? m[2]).toUpperCase()})`, kind: 'escape', char: ch };
    }
    if (c === 'x' && (m = /^[0-9a-fA-F]{2}/.exec(pattern.slice(i)))) {
      i += 2;
      const ch = String.fromCharCode(parseInt(m[0], 16));
      return { text: pattern.slice(start, i), desc: `글자 ${show(ch)}`, kind: 'escape', char: ch };
    }
    if (c === 'c' && /^[A-Za-z]/.test(pattern[i] ?? '')) {
      i++;
      return { text: pattern.slice(start, i), desc: `제어 문자 Ctrl+${pattern[i - 1].toUpperCase()}`, kind: 'escape' };
    }
    if (c === 'k' && !inClass && (m = /^<([^>]*)>/.exec(pattern.slice(i)))) {
      i += m[0].length;
      return { text: pattern.slice(start, i), desc: `묶음 ‘${m[1]}’ 이 잡은 것과 같은 글`, kind: 'escape' };
    }
    if (/[1-9]/.test(c) && !inClass) {
      while (/\d/.test(pattern[i] ?? '')) i++;
      return { text: pattern.slice(start, i), desc: `묶음 ${pattern.slice(start + 1, i)} 이 잡은 것과 같은 글`, kind: 'escape' };
    }
    return { text: `\\${c}`, desc: `글자 ${show(c)} 그대로`, kind: 'literal', char: c };
  };

  const charClass = () => {
    const start = i;
    i++; // '['
    const negated = pattern[i] === '^';
    if (negated) i++;
    const items: string[] = [];
    let first = true;
    while (i < pattern.length && (pattern[i] !== ']' || first)) {
      first = false;
      let lo: string | undefined;
      let label: string;
      if (pattern[i] === '\\') {
        const e = escape(true);
        lo = e.char;
        label = e.char != null ? show(e.char).replace(/^'|'$/g, '') : e.desc.replace(/ 하나.*$| 중 하나$/, '');
      } else {
        lo = String.fromCodePoint(pattern.codePointAt(i)!);
        i += lo.length;
        label = show(lo).replace(/^'|'$/g, '');
      }
      // 범위 a-z
      if (lo != null && pattern[i] === '-' && pattern[i + 1] !== ']' && i + 1 < pattern.length) {
        i++;
        let hi: string | undefined;
        if (pattern[i] === '\\') hi = escape(true).char;
        else {
          hi = String.fromCodePoint(pattern.codePointAt(i)!);
          i += hi.length;
        }
        if (hi != null) {
          const range = `${lo}~${hi}`;
          label = range === '가~힣' ? '한글 (가~힣)' : range === 'ㄱ~ㅎ' ? '한글 자음 (ㄱ~ㅎ)' : range === 'ㅏ~ㅣ' ? '한글 모음 (ㅏ~ㅣ)' : range;
        }
      }
      items.push(label);
    }
    i++; // ']'
    const list = items.join(', ');
    add(pattern.slice(start, i), negated ? `다음이 아닌 글자 하나: ${list}` : items.length === 1 && !/[~(]/.test(list) ? `글자 '${list}'` : `다음 중 하나: ${list}`, 'class');
  };

  try {
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '(') {
        const m = /^\((\?(?:<([^>=!][^>]*)>|:|=|!|<=|<!))?/.exec(pattern.slice(i))!;
        const head = m[1];
        let desc: string;
        let close: string;
        if (!head) {
          groupNo++;
          desc = `묶음 ${groupNo} 시작 — 잡은 글은 $${groupNo} 로 꺼내 씁니다`;
          close = `묶음 ${groupNo} 끝`;
        } else if (m[2]) {
          groupNo++;
          desc = `묶음 ${groupNo} ‘${m[2]}’ 시작 — $<${m[2]}> 로 꺼내 씁니다`;
          close = `묶음 ‘${m[2]}’ 끝`;
        } else if (head === '?:') {
          desc = '묶기만 함 (번호를 매기지 않음)';
          close = '묶기 끝';
        } else {
          desc = { '?=': '바로 뒤에 다음이 오는 자리 (글자를 쓰지는 않음)', '?!': '바로 뒤에 다음이 오지 않는 자리', '?<=': '바로 앞에 다음이 있는 자리', '?<!': '바로 앞에 다음이 없는 자리' }[head]!;
          close = '조건 끝';
        }
        add(m[0], desc, 'group');
        open.push(close);
        depth++;
        i += m[0].length;
      } else if (c === ')') {
        depth = Math.max(0, depth - 1);
        i++;
        add(')', open.pop() ?? '괄호 닫기', 'group');
        withQuantifier();
      } else if (c === '|') {
        depth = Math.max(0, depth - 1);
        add('|', '또는', 'alt');
        depth = open.length;
        i++;
      } else if (c === '[') {
        charClass();
        withQuantifier();
      } else if (c === '^') {
        i++;
        add('^', multi ? '줄의 시작' : '글 전체의 시작', 'anchor');
      } else if (c === '$') {
        i++;
        add('$', multi ? '줄의 끝' : '글 전체의 끝', 'anchor');
      } else if (c === '.') {
        i++;
        add('.', dotAll ? '아무 글자 하나 (줄바꿈 포함)' : '아무 글자 하나 (줄바꿈 제외)', 'class');
        withQuantifier();
      } else if (c === '\\') {
        const e = escape(false);
        if (e.kind === 'literal' && e.char != null) literal(e.text, e.char);
        else {
          add(e.text, e.desc, e.kind);
          withQuantifier();
        }
      } else {
        const ch = String.fromCodePoint(pattern.codePointAt(i)!);
        i += ch.length;
        literal(ch, ch);
      }
    }
  } catch {
    // 풀다 만 데까지만 보여 준다
  }
  return parts;

  /** 이어지는 보통 글자는 한 줄로 모은다. 반복 기호는 마지막 한 글자에만 걸리므로 그 글자는 따로 둔다. */
  function literal(text: string, ch: string) {
    const q = quantifier();
    const last = parts[parts.length - 1];
    if (!q && last && last.kind === 'literal' && last.depth === depth && lits.has(last)) {
      last.text += text;
      lits.set(last, lits.get(last)! + ch);
      last.desc = `글자 그대로 '${lits.get(last)}'`;
      return;
    }
    const part: Part = { text: text + (q?.text ?? ''), desc: q ? `글자 ${show(ch)} — ${q.desc}` : `글자 그대로 '${ch}'`, depth, kind: 'literal' };
    parts.push(part);
    if (!q) lits.set(part, ch);
  }
}
/** 이어 붙일 수 있는 글자 줄과 그 실제 글자 */
const lits = new WeakMap<Part, string>();

export interface Preset {
  name: string;
  pattern: string;
  flags: string;
  sample: string;
}
export const PRESETS: Preset[] = [
  { name: '이메일', pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', flags: 'g', sample: '문의: help@example.com, 담당 kim.haneul+work@corp.co.kr' },
  { name: '휴대폰 번호', pattern: '01[016789][-. ]?\\d{3,4}[-. ]?\\d{4}', flags: 'g', sample: '010-1234-5678, 01098765432, 011 234 5678' },
  { name: '주소(URL)', pattern: 'https?://[^\\s<>"\']+', flags: 'g', sample: '자료는 https://tools.euiyun.com/text 와 http://example.com/a?b=1 에 있습니다.' },
  { name: '날짜', pattern: '(?<year>\\d{4})[-./](?<month>\\d{1,2})[-./](?<day>\\d{1,2})', flags: 'g', sample: '시작 2026-11-13, 마감 2026.12.1, 발표 2027/1/15' },
  { name: '한글만', pattern: '[가-힣]+', flags: 'g', sample: 'Hello 안녕하세요 world 반갑습니다 123' },
  { name: '숫자 (쉼표 · 소수점)', pattern: '-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?', flags: 'g', sample: '합계 1,234,567원, 할인 -12.5%, 수량 42개' },
  { name: '빈 줄', pattern: '^\\s*$\\n?', flags: 'gm', sample: '첫 줄\n\n   \n둘째 줄\n' },
  { name: '줄 앞뒤 공백', pattern: '^[ \\t]+|[ \\t]+$', flags: 'gm', sample: '  앞에 공백\n뒤에 공백   \n\t탭으로 시작' },
  { name: '색 코드', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g', sample: 'color: #2563eb; background: #fff; border: #1b1d21' },
  { name: 'IP 주소', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g', sample: '접속 192.168.0.1 → 10.0.12.254 (실패 1.2.3)' },
];

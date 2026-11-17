// 표를 여러 형식의 글로 쓴다.
import { coveredMap, numberOf, strWidth, unmerge, width, type Align, type Grid } from './grid';

export type Format = 'markdown' | 'html' | 'rich' | 'text' | 'slack' | 'jira' | 'mediawiki' | 'redmine' | 'latex' | 'csv' | 'tsv' | 'json' | 'sql';
export type Side = Exclude<Align, 'auto'>;
export type BoxStyle = 'unicode' | 'rounded' | 'double' | 'ascii' | 'rst' | 'plain';
export type Dialect = 'mysql' | 'postgres' | 'sqlite' | 'sqlserver' | 'oracle';
export type MergeMode = 'keep' | 'fill' | 'blank';

export interface FormatInfo {
  id: Format;
  name: string;
  /** 어디에 붙여넣는지 */
  where: string;
  ext: string;
  mime: string;
  /** 합친 칸을 그대로 쓸 수 있는지 */
  merges: boolean;
}

export const FORMATS: FormatInfo[] = [
  { id: 'markdown', name: '마크다운', where: 'GitHub · Notion · 블로그 · README', ext: 'md', mime: 'text/markdown', merges: false },
  { id: 'rich', name: '서식 있는 표', where: '메일 · 워드 · 한글 · 구글 문서에 붙여넣기', ext: 'html', mime: 'text/html', merges: true },
  { id: 'html', name: 'HTML', where: '웹 페이지 · 블로그 HTML 편집', ext: 'html', mime: 'text/html', merges: true },
  { id: 'text', name: '글자 표', where: '코드 주석 · 터미널 · 고정폭 글꼴', ext: 'txt', mime: 'text/plain', merges: false },
  { id: 'slack', name: '슬랙 · 디스코드', where: '코드 블록으로 감싼 글자 표', ext: 'txt', mime: 'text/plain', merges: false },
  { id: 'jira', name: 'Jira · Confluence', where: '위키 마크업 (Jira 서버 · 옛 Confluence)', ext: 'txt', mime: 'text/plain', merges: false },
  { id: 'redmine', name: 'Redmine', where: 'Textile 표 — 일감 · 위키', ext: 'txt', mime: 'text/plain', merges: true },
  { id: 'mediawiki', name: '미디어위키', where: '위키백과 · 나무위키와 비슷한 사내 위키', ext: 'txt', mime: 'text/plain', merges: true },
  { id: 'latex', name: 'LaTeX', where: 'tabular — 논문 · 보고서', ext: 'tex', mime: 'application/x-tex', merges: true },
  { id: 'csv', name: 'CSV', where: '쉼표로 나눈 값', ext: 'csv', mime: 'text/csv', merges: false },
  { id: 'tsv', name: 'TSV (엑셀)', where: '탭으로 나눈 값 — 엑셀 · 시트에 그대로 붙여넣기', ext: 'tsv', mime: 'text/tab-separated-values', merges: false },
  { id: 'json', name: 'JSON', where: '객체 배열 · 배열의 배열', ext: 'json', mime: 'application/json', merges: false },
  { id: 'sql', name: 'SQL', where: 'INSERT 문 · CREATE TABLE', ext: 'sql', mime: 'application/sql', merges: false },
];
export const formatById = new Map(FORMATS.map((f) => [f.id, f]));

export interface Options {
  header: boolean;
  aligns: Side[];
  merges: MergeMode;
  /** 마크다운: 칸 너비를 맞춰 쓰기 */
  pad: boolean;
  box: BoxStyle;
  /** 글자 표: 몸통 줄마다 가로줄 */
  rowLines: boolean;
  /** HTML: 테두리 · 여백을 style 로 */
  inlineStyle: boolean;
  jsonShape: 'objects' | 'arrays';
  /** JSON · SQL: 숫자 · 빈 칸을 알맞은 값으로 */
  infer: boolean;
  sqlTable: string;
  dialect: Dialect;
  sqlCreate: boolean;
  /** SQL: INSERT 하나에 여러 줄 */
  sqlBatch: boolean;
  booktabs: boolean;
}

export const defaultOptions: Options = {
  header: true,
  aligns: [],
  merges: 'keep',
  pad: true,
  box: 'unicode',
  rowLines: false,
  inlineStyle: true,
  jsonShape: 'objects',
  infer: true,
  sqlTable: 'my_table',
  dialect: 'mysql',
  sqlCreate: false,
  sqlBatch: true,
  booktabs: true,
};

const alignOf = (o: Options, c: number): Side => o.aligns[c] ?? 'left';

/** 형식이 합친 칸을 못 쓰면 풀어 둔다 */
function prepared(g: Grid, f: Format, o: Options): Grid {
  if (!g.merges.length) return g;
  const can = formatById.get(f)!.merges;
  if (can && o.merges === 'keep') return g;
  return unmerge(g, o.merges === 'fill');
}

/** 머리글 이름: 비었거나 겹치면 열 번호 · 꼬리표를 붙인다 */
export function columnNames(g: Grid, header: boolean): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width(g) }, (_, c) => {
    let name = (header ? g.rows[0][c].replace(/\s+/g, ' ').trim() : '') || `열${c + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n) name = `${name}_${n + 1}`;
    return name;
  });
}

// ── 마크다운 ─────────────────────────────────────────────────

const mdCell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function padTo(s: string, w: number, a: Side): string {
  const gap = Math.max(0, w - strWidth(s));
  if (a === 'right') return ' '.repeat(gap) + s;
  if (a === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
  return s + ' '.repeat(gap);
}

function markdown(g: Grid, o: Options): string {
  const w = width(g);
  const head = o.header ? g.rows[0].map(mdCell) : new Array<string>(w).fill('');
  const body = (o.header ? g.rows.slice(1) : g.rows).map((r) => r.map(mdCell));
  const widths = Array.from({ length: w }, (_, c) => (o.pad ? Math.max(3, strWidth(head[c]), ...body.map((r) => strWidth(r[c]))) : 3));
  const line = (cells: string[]) => `| ${cells.map((s, c) => (o.pad ? padTo(s, widths[c], alignOf(o, c)) : s)).join(' | ')} |`;
  const rule = widths.map((n, c) => {
    const a = alignOf(o, c);
    const dashes = '-'.repeat(Math.max(1, n - (a === 'center' ? 2 : a === 'right' ? 1 : 0)));
    return a === 'center' ? `:${dashes}:` : a === 'right' ? `${dashes}:` : dashes;
  });
  return [line(head), `| ${rule.join(' | ')} |`, ...body.map(line)].join('\n') + '\n';
}

// ── HTML ─────────────────────────────────────────────────────

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlCell = (s: string) => escHtml(s).replace(/\n/g, '<br>');

export function html(g: Grid, o: Options, inline = o.inlineStyle): string {
  const covered = coveredMap(g);
  const spans = new Map(g.merges.map((m) => [`${m.r},${m.c}`, m]));
  const cellStyle = (head: boolean, a: Side) => {
    const parts: string[] = [];
    if (inline) parts.push('border:1px solid #d0d5dd', 'padding:6px 10px', head ? 'background:#f2f4f7' : '', head ? 'font-weight:700' : '', 'vertical-align:top');
    if (a !== 'left' || (inline && head)) parts.push(`text-align:${a}`);
    const s = parts.filter(Boolean).join(';');
    return s ? ` style="${s}"` : '';
  };
  const row = (r: number, head: boolean) => {
    const tag = head ? 'th' : 'td';
    const cells: string[] = [];
    g.rows[r].forEach((v, c) => {
      if (covered[r][c]) return;
      const m = spans.get(`${r},${c}`);
      const attrs = (m && m.rs > 1 ? ` rowspan="${m.rs}"` : '') + (m && m.cs > 1 ? ` colspan="${m.cs}"` : '');
      cells.push(`<${tag}${attrs}${cellStyle(head, alignOf(o, c))}>${htmlCell(v)}</${tag}>`);
    });
    return `    <tr>${cells.length ? '\n      ' + cells.join('\n      ') + '\n    ' : ''}</tr>`;
  };
  const table = inline ? '<table style="border-collapse:collapse;border:1px solid #d0d5dd">' : '<table>';
  const out = [table];
  // 머리글 칸이 아래로 합쳐져 몸통까지 내려가면 rowspan 은 thead · tbody 를 넘지 못하니 한 묶음에 둔다
  const split = o.header && !g.merges.some((m) => m.r === 0 && m.rs > 1);
  const start = split ? 1 : 0;
  if (split) out.push('  <thead>', row(0, true), '  </thead>');
  if (g.rows.length > start) {
    out.push('  <tbody>');
    for (let r = start; r < g.rows.length; r++) out.push(row(r, o.header && r === 0));
    out.push('  </tbody>');
  }
  out.push('</table>');
  return out.join('\n') + '\n';
}

// ── 글자 표 ──────────────────────────────────────────────────

interface Box {
  top: [string, string, string];
  mid: [string, string, string];
  head: [string, string, string];
  bottom: [string, string, string];
  h: string;
  hh: string;
  v: string;
}

const BOXES: Record<Exclude<BoxStyle, 'plain'>, Box> = {
  unicode: { top: ['┌', '┬', '┐'], mid: ['├', '┼', '┤'], head: ['├', '┼', '┤'], bottom: ['└', '┴', '┘'], h: '─', hh: '─', v: '│' },
  rounded: { top: ['╭', '┬', '╮'], mid: ['├', '┼', '┤'], head: ['├', '┼', '┤'], bottom: ['╰', '┴', '╯'], h: '─', hh: '─', v: '│' },
  double: { top: ['╔', '╦', '╗'], mid: ['╠', '╬', '╣'], head: ['╠', '╬', '╣'], bottom: ['╚', '╩', '╝'], h: '═', hh: '═', v: '║' },
  ascii: { top: ['+', '+', '+'], mid: ['+', '+', '+'], head: ['+', '+', '+'], bottom: ['+', '+', '+'], h: '-', hh: '-', v: '|' },
  rst: { top: ['+', '+', '+'], mid: ['+', '+', '+'], head: ['+', '+', '+'], bottom: ['+', '+', '+'], h: '-', hh: '=', v: '|' },
};

export function textTable(g: Grid, o: Options): string {
  const w = width(g);
  const lines = g.rows.map((r) => r.map((c) => c.split('\n')));
  const widths = Array.from({ length: w }, (_, c) => Math.max(1, ...lines.map((r) => Math.max(...r[c].map(strWidth)))));
  const out: string[] = [];
  const emit = (r: number) => {
    const h = Math.max(...lines[r].map((l) => l.length));
    for (let k = 0; k < h; k++) {
      const cells = lines[r].map((l, c) => padTo(l[k] ?? '', widths[c], o.header && r === 0 && o.box !== 'plain' ? 'center' : alignOf(o, c)));
      if (o.box === 'plain') out.push(cells.join('  ').replace(/\s+$/, ''));
      else {
        const b = BOXES[o.box];
        out.push(`${b.v} ${cells.join(` ${b.v} `)} ${b.v}`);
      }
    }
  };
  if (o.box === 'plain') {
    g.rows.forEach((_, r) => {
      emit(r);
      if (o.header && r === 0) out.push(widths.map((n) => '-'.repeat(n)).join('  '));
    });
    return out.join('\n') + '\n';
  }
  const b = BOXES[o.box];
  const rule = ([l, m, r]: [string, string, string], h: string) => l + widths.map((n) => h.repeat(n + 2)).join(m) + r;
  const every = o.rowLines || o.box === 'rst';
  out.push(rule(b.top, b.h));
  g.rows.forEach((_, r) => {
    emit(r);
    if (r === g.rows.length - 1) return;
    if (o.header && r === 0) out.push(rule(b.head, b.hh));
    else if (every) out.push(rule(b.mid, b.h));
  });
  out.push(rule(b.bottom, b.h));
  return out.join('\n') + '\n';
}

// ── 위키들 ───────────────────────────────────────────────────

function jira(g: Grid, o: Options): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' \\\\ ') || ' ';
  return (
    g.rows
      .map((r, i) => {
        const sep = o.header && i === 0 ? '||' : '|';
        return sep + r.map(cell).join(sep) + sep;
      })
      .join('\n') + '\n'
  );
}

function mediawiki(g: Grid, o: Options): string {
  const covered = coveredMap(g);
  const spans = new Map(g.merges.map((m) => [`${m.r},${m.c}`, m]));
  const out = ['{| class="wikitable"'];
  g.rows.forEach((row, r) => {
    if (r > 0) out.push('|-');
    const head = o.header && r === 0;
    const cells: string[] = [];
    row.forEach((v, c) => {
      if (covered[r][c]) return;
      const m = spans.get(`${r},${c}`);
      const a = alignOf(o, c);
      const attrs = [m && m.rs > 1 ? `rowspan="${m.rs}"` : '', m && m.cs > 1 ? `colspan="${m.cs}"` : '', !head && a !== 'left' ? `style="text-align: ${a};"` : ''].filter(Boolean).join(' ');
      const text = v.replace(/\|/g, '{{!}}').replace(/\n/g, '<br />');
      cells.push(attrs ? `${attrs} | ${text}` : text);
    });
    out.push(head ? `! ${cells.join(' !! ')}` : `| ${cells.join(' || ')}`);
  });
  out.push('|}');
  return out.join('\n') + '\n';
}

function redmine(g: Grid, o: Options): string {
  const covered = coveredMap(g);
  const spans = new Map(g.merges.map((m) => [`${m.r},${m.c}`, m]));
  const mark: Record<Side, string> = { left: '', right: '>', center: '=' };
  return (
    g.rows
      .map((row, r) => {
        const head = o.header && r === 0;
        const cells: string[] = [];
        row.forEach((v, c) => {
          if (covered[r][c]) return;
          const m = spans.get(`${r},${c}`);
          const mod = (head ? '_' : '') + (m && m.cs > 1 ? `\\${m.cs}` : '') + (m && m.rs > 1 ? `/${m.rs}` : '') + (head ? '' : mark[alignOf(o, c)]);
          const text = v.replace(/\|/g, '&#124;').replace(/\n/g, ' ');
          cells.push(mod ? `${mod}. ${text} ` : ` ${text} `);
        });
        return `|${cells.join('|')}|`;
      })
      .join('\n') + '\n'
  );
}

// ── LaTeX ───────────────────────────────────────────────────

const TEX: Record<string, string> = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
const texCell = (s: string) => s.replace(/[\\&%$#_{}~^]/g, (ch) => TEX[ch]).replace(/\n/g, ' ');

function latex(g: Grid, o: Options): string {
  const w = width(g);
  const letter: Record<Side, string> = { left: 'l', right: 'r', center: 'c' };
  const cols = Array.from({ length: w }, (_, c) => letter[alignOf(o, c)]).join(o.booktabs ? '' : '|');
  const spans = new Map(g.merges.map((m) => [`${m.r},${m.c}`, m]));
  // 위에서 내려온 합친 칸: 그 줄에서는 빈 칸(열을 합쳤으면 빈 \multicolumn)
  const below = new Map<string, number>();
  for (const m of g.merges) for (let i = m.r + 1; i < m.r + m.rs; i++) below.set(`${i},${m.c}`, m.cs);
  const covered = coveredMap(g);
  const hasRowspan = g.merges.some((m) => m.rs > 1);
  const hasKorean = g.rows.some((r) => r.some((c) => /[가-힣]/.test(c)));
  const top = o.booktabs ? '\\toprule' : '\\hline';
  const mid = o.booktabs ? '\\midrule' : '\\hline';
  const bottom = o.booktabs ? '\\bottomrule' : '\\hline';
  const out: string[] = [];
  const pkgs = [o.booktabs ? '\\usepackage{booktabs}' : '', hasRowspan ? '\\usepackage{multirow}' : '', hasKorean ? '\\usepackage{kotex} % 한글' : ''].filter(Boolean);
  if (pkgs.length) out.push(...pkgs.map((p) => `% ${p}`), '');
  out.push(`\\begin{tabular}{${o.booktabs ? cols : `|${cols}|`}}`, top);
  g.rows.forEach((row, r) => {
    const cells: string[] = [];
    for (let c = 0; c < w; c++) {
      const key = `${r},${c}`;
      if (below.has(key)) {
        const cs = below.get(key)!;
        cells.push(cs > 1 ? `\\multicolumn{${cs}}{c}{}` : '');
        c += cs - 1;
        continue;
      }
      if (covered[r][c]) continue;
      const m = spans.get(key);
      let t = texCell(row[c]);
      if (o.header && r === 0) t = t ? `\\textbf{${t}}` : t;
      if (m && m.rs > 1) t = `\\multirow{${m.rs}}{*}{${t}}`;
      if (m && m.cs > 1) {
        t = `\\multicolumn{${m.cs}}{${m.r === 0 && o.header ? 'c' : letter[alignOf(o, c)]}}{${t}}`;
        c += m.cs - 1;
      }
      cells.push(t);
    }
    out.push(`${cells.join(' & ')} \\\\`);
    if (o.header && r === 0 && g.rows.length > 1) out.push(mid);
    else if (!o.booktabs && r < g.rows.length - 1) out.push('\\hline');
  });
  out.push(bottom, '\\end{tabular}');
  return out.join('\n') + '\n';
}

// ── CSV · TSV ───────────────────────────────────────────────

export function delimited(g: Grid, d: string): string {
  const needs = d === '\t' ? /[\t\n\r"]/ : new RegExp(`[${d === ',' ? ',' : '\\' + d}\\n\\r"]|^\\s|\\s$`);
  const esc = (s: string) => (needs.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return g.rows.map((r) => r.map(esc).join(d)).join('\n') + '\n';
}

// ── JSON ────────────────────────────────────────────────────

const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const GROUPED_NUMBER = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/;

/** 숫자로 볼 수 있는 글이면 그 숫자 (007 · 01012345678 같은 것은 글로 둔다) */
export function asNumber(s: string): number | null {
  const t = s.trim();
  if (PLAIN_NUMBER.test(t) && t.replace(/[-.]/g, '').length <= 15) return Number(t);
  if (GROUPED_NUMBER.test(t) && t.replace(/[-.,]/g, '').length <= 15) return Number(t.replace(/,/g, ''));
  return null;
}

type Json = string | number | boolean | null;
function jsonValue(s: string, infer: boolean): Json {
  if (!infer) return s;
  if (s === '') return null;
  if (s === 'true' || s === 'false') return s === 'true';
  return asNumber(s) ?? s;
}

function json(g: Grid, o: Options): string {
  const body = o.header ? g.rows.slice(1) : g.rows;
  if (o.jsonShape === 'arrays') {
    const rows = (o.header ? [g.rows[0], ...body] : body).map((r, i) => r.map((c) => (o.header && i === 0 ? c : jsonValue(c, o.infer))));
    return '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n';
  }
  const names = columnNames(g, o.header);
  const objs = body.map((r) => Object.fromEntries(names.map((n, c) => [n, jsonValue(r[c], o.infer)])));
  return JSON.stringify(objs, null, 2) + '\n';
}

// ── SQL ─────────────────────────────────────────────────────

export const DIALECTS: { id: Dialect; name: string }[] = [
  { id: 'mysql', name: 'MySQL · MariaDB' },
  { id: 'postgres', name: 'PostgreSQL' },
  { id: 'sqlite', name: 'SQLite' },
  { id: 'sqlserver', name: 'SQL Server' },
  { id: 'oracle', name: 'Oracle' },
];

function quoteId(name: string, d: Dialect): string {
  if (d === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (d === 'sqlserver') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

function sqlString(s: string, d: Dialect): string {
  let t = s.replace(/'/g, "''");
  if (d === 'mysql') t = t.replace(/\\/g, '\\\\');
  return (d === 'sqlserver' && /[^\x00-\x7f]/.test(s) ? 'N' : '') + `'${t}'`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** 열 값으로 짐작한 SQL 형 */
export function sqlType(values: string[], d: Dialect): string {
  const vals = values.filter((v) => v !== '');
  const len = Math.max(1, ...vals.map((v) => [...v].length));
  if (vals.length && vals.every((v) => PLAIN_NUMBER.test(v) && !/[.eE]/.test(v) && v.replace('-', '').length <= 18)) {
    const big = vals.some((v) => Math.abs(Number(v)) > 2147483647);
    if (d === 'oracle') return 'NUMBER(19)';
    return big ? 'BIGINT' : 'INTEGER';
  }
  if (vals.length && vals.every((v) => PLAIN_NUMBER.test(v) && !/[eE]/.test(v))) {
    const scale = Math.max(...vals.map((v) => v.split('.')[1]?.length ?? 0));
    const ints = Math.max(...vals.map((v) => v.replace('-', '').split('.')[0].length));
    const p = Math.min(38, ints + scale);
    return d === 'oracle' ? `NUMBER(${p}, ${scale})` : `DECIMAL(${p}, ${scale})`;
  }
  if (vals.length && vals.every((v) => DATE.test(v))) return 'DATE';
  if (vals.length && vals.every((v) => DATETIME.test(v))) return d === 'mysql' ? 'DATETIME' : d === 'sqlserver' ? 'DATETIME2' : 'TIMESTAMP';
  const n = len <= 50 ? 50 : len <= 100 ? 100 : len <= 255 ? 255 : len <= 1000 ? 1000 : 0;
  if (d === 'sqlite') return 'TEXT';
  if (d === 'sqlserver') return n ? `NVARCHAR(${n})` : 'NVARCHAR(MAX)';
  if (d === 'oracle') return n ? `VARCHAR2(${n} CHAR)` : 'CLOB';
  if (d === 'postgres') return n ? `VARCHAR(${n})` : 'TEXT';
  return n ? `VARCHAR(${n})` : 'TEXT';
}

function sql(g: Grid, o: Options): string {
  const d = o.dialect;
  const names = columnNames(g, o.header);
  const body = o.header ? g.rows.slice(1) : g.rows;
  const table = (o.sqlTable.trim() || 'my_table')
    .split('.')
    .map((p) => quoteId(p.trim(), d))
    .join('.');
  const cols = names.map((n) => quoteId(n, d)).join(', ');
  const numeric = names.map((_, c) => body.some((r) => r[c] !== '') && body.every((r) => r[c] === '' || asNumber(r[c]) !== null));
  const value = (s: string, c: number) => {
    if (o.infer && s === '') return 'NULL';
    if (o.infer && numeric[c]) return String(asNumber(s));
    return sqlString(s, d);
  };
  const out: string[] = [];
  if (o.sqlCreate) {
    const defs = names.map((n, c) => `  ${quoteId(n, d)} ${sqlType(body.map((r) => r[c]), d)}`);
    out.push(`CREATE TABLE ${table} (\n${defs.join(',\n')}\n);`, '');
  }
  if (!body.length) return out.join('\n') + (out.length ? '' : '\n');
  const tuples = body.map((r) => `(${r.map(value).join(', ')})`);
  if (o.sqlBatch && d !== 'oracle') {
    // SQL Server 는 VALUES 한 번에 1000줄까지
    const chunk = d === 'sqlserver' ? 1000 : 5000;
    for (let i = 0; i < tuples.length; i += chunk) {
      out.push(`INSERT INTO ${table} (${cols}) VALUES\n  ${tuples.slice(i, i + chunk).join(',\n  ')};`);
    }
  } else for (const t of tuples) out.push(`INSERT INTO ${table} (${cols}) VALUES ${t};`);
  return out.join('\n') + '\n';
}

// ── 하나로 ──────────────────────────────────────────────────

export function write(grid: Grid, f: Format, o: Options): string {
  const g = prepared(grid, f, o);
  switch (f) {
    case 'markdown':
      return markdown(g, o);
    case 'html':
      return html(g, o);
    case 'rich':
      return html(g, o, true);
    case 'text':
      return textTable(g, o);
    case 'slack':
      return '```\n' + textTable(g, o) + '```\n';
    case 'jira':
      return jira(g, o);
    case 'mediawiki':
      return mediawiki(g, o);
    case 'redmine':
      return redmine(g, o);
    case 'latex':
      return latex(g, o);
    case 'csv':
      return delimited(g, ',');
    case 'tsv':
      return delimited(g, '\t');
    case 'json':
      return json(g, o);
    case 'sql':
      return sql(g, o);
  }
}

export { numberOf };

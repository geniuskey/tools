<script lang="ts">
  import { tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import VirtualList from '$lib/ui/VirtualList.svelte';
  import { downloadBlob, timestamp } from '$lib/download';
  import { sendTo } from '$lib/handoff';
  import {
    ancestors,
    csvToTable,
    childId,
    expandAll,
    findTables,
    flatten,
    looksTabular,
    numericColumns,
    parseAny,
    pathText,
    preview,
    search,
    tableAt,
    tableToJson,
    toCsv,
    toJson,
    toToml,
    toYaml,
    valueAt,
    viewOrder,
    type Hint,
    type Json,
    type Parsed,
    type Table,
    type TableSpot,
    type TreeRow,
  } from '$lib/data/core';
  import { sampleCsv, sampleJson, sampleToml, sampleYaml } from '$lib/data/samples';

  const MAX_FILE = 200 * 1024 * 1024;
  const EXT_HINT: Record<string, Hint | undefined> = { json: 'json', jsonl: 'json', ndjson: 'json', jsonc: 'json', csv: 'csv', tsv: 'csv', yaml: 'yaml', yml: 'yaml', toml: 'toml' };
  const ROW = 24;

  type Loaded = Extract<Parsed, { kind: 'json' | 'csv' }>;
  let input = $state('');
  let inputEl = $state<HTMLTextAreaElement>();
  let error = $state<Extract<Parsed, { kind: 'error' }> | null>(null);
  let loaded = $state.raw<{ data: Loaded; name: string; bytes: number } | null>(null);
  let mode = $state<'tree' | 'table' | 'text'>('tree');
  let header = $state(true);
  let dragOver = $state(false);
  let toast = $state('');

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }

  async function open(text: string, name = '', hint?: Hint) {
    const p = parseAny(text, hint);
    if (p.kind === 'error') {
      error = p;
      loaded = null;
      if (text.length < 2_000_000) {
        input = text;
        await tick();
        if (p.line && inputEl) {
          // 오류가 난 곳에 커서를 둔다
          const lines = text.split('\n');
          const at = lines.slice(0, p.line - 1).reduce((n, l) => n + l.length + 1, 0) + (p.column ?? 1) - 1;
          inputEl.focus();
          inputEl.setSelectionRange(at, Math.min(text.length, at + 1));
        }
      }
      return;
    }
    error = null;
    loaded = { data: p, name, bytes: text.length };
    input = text.length < 2_000_000 ? text : '';
    mode = p.kind === 'csv' ? 'table' : 'tree';
    expanded = new Set(['']);
    selected = '';
    query = '';
    filter = '';
    sort = null;
    cell = null;
    // 바꿀 형식은 들어온 것과 다른 것으로
    out = p.kind === 'json' && (p.format === 'json' || p.format === 'jsonl') ? 'yaml' : 'json';
    // 표로 볼 곳: 뿌리가 표면 뿌리, 아니면 문서에서 가장 얕은 곳의 배열
    spots = p.kind === 'json' ? findTables(p.value) : [];
    target = p.kind !== 'json' || tableAt(p.value) ? '' : (spots[0]?.id ?? '');
    if (p.kind === 'json' && Array.isArray(p.value) && p.value.length <= 2000) expanded = expandAll(p.value, 3000).expanded;
    else if (p.kind === 'json') expanded = levelSet(p.value, 2);
  }

  /** 위에서 n단계까지만 펼친다 (너무 길어지면 멈춘다) */
  function levelSet(root: Json, depth: number): Set<string> {
    const out = new Set<string>(['']);
    let rows = flatten(root, out);
    for (let d = 1; d < depth; d++) {
      const next = new Set(out);
      for (const r of rows) if (r.size > 0 && r.depth === d) next.add(r.id);
      const grown = flatten(root, next);
      if (grown.length > 5000) break;
      rows = grown;
      for (const id of next) out.add(id);
    }
    return out;
  }

  async function openFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE) return say('파일이 너무 큽니다 (최대 200MB)');
    const ext = f.name.split('.').pop()?.toLowerCase();
    open(await f.text(), f.name, EXT_HINT[ext ?? '']);
  }

  function reset() {
    loaded = null;
    error = null;
  }

  // ── 데이터 ────────────────────────────────────────────
  /** 문서에서 표로 볼 수 있는 곳들 */
  let spots = $state.raw<TableSpot[]>([]);
  /** 지금 표로 보는 곳 (뿌리는 '', 배열의 모든 항목은 *) */
  let target = $state('');
  const jtable = $derived(loaded?.data.kind === 'json' ? tableAt(loaded.data.value, target) : null);
  const table = $derived.by<Table | null>(() => {
    const d = loaded?.data;
    if (!d) return null;
    return d.kind === 'csv' ? csvToTable(d.rows, header) : jtable;
  });
  const root = $derived.by<Json>(() => {
    const d = loaded?.data;
    if (!d) return null;
    return d.kind === 'json' ? d.value : tableToJson(table!);
  });
  const kindLabel = $derived.by(() => {
    const d = loaded?.data;
    if (!d) return '';
    if (d.kind === 'json') return { json: 'JSON', jsonl: 'JSON Lines', yaml: 'YAML', toml: 'TOML' }[d.format];
    return { ',': 'CSV', '\t': 'TSV (탭)', ';': 'CSV (세미콜론)', '|': 'CSV (세로줄)' }[d.delimiter] ?? 'CSV';
  });
  const bytes = (b: number) => (b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);
  const num = (n: number) => n.toLocaleString('ko-KR');

  // ── 트리 ──────────────────────────────────────────────
  let expanded = $state.raw(new Set<string>(['']));
  let selected = $state('');
  let query = $state('');
  let hits = $state.raw<{ ids: string[]; more: boolean }>({ ids: [], more: false });
  let hitAt = $state(-1);
  let treeList = $state<VirtualList>();
  let searchEl = $state<HTMLInputElement>();

  const rows = $derived(mode === 'tree' && loaded ? flatten(root, expanded) : []);
  const hitSet = $derived(new Set(hits.ids));

  $effect(() => {
    const q = query;
    const r = root;
    if (mode !== 'tree' || !q.trim()) {
      hits = { ids: [], more: false };
      hitAt = -1;
      return;
    }
    const t = setTimeout(() => {
      hits = search(r, q);
      hitAt = -1;
      if (hits.ids.length) gotoHit(0);
    }, 200);
    return () => clearTimeout(t);
  });

  async function reveal(id: string) {
    const need = ancestors(id).filter((a) => !expanded.has(a));
    if (need.length) expanded = new Set([...expanded, ...need]);
    selected = id;
    await tick();
    treeList?.scrollToIndex(rows.findIndex((r) => r.id === id));
  }
  function gotoHit(i: number) {
    const n = hits.ids.length;
    if (!n) return;
    hitAt = ((i % n) + n) % n;
    reveal(hits.ids[hitAt]);
  }

  function toggle(r: TreeRow, open = !r.open) {
    if (r.size <= 0) return;
    const next = new Set(expanded);
    if (open) next.add(r.id);
    else next.delete(r.id);
    expanded = next;
  }
  function openAll() {
    const r = expandAll(root);
    expanded = r.expanded;
    if (!r.complete) say('너무 커서 위쪽 단계까지만 펼쳤습니다');
  }

  /** 키보드로 메뉴 열기 (메뉴 키 · Shift+F10): 고른 줄 · 칸 바로 아래에 띄운다 */
  function menuKey(e: KeyboardEvent, at: string, items: () => MenuItem[]) {
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return false;
    const el = document.querySelector(at);
    if (el) {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      openMenu(b.left + Math.min(b.width, 120), b.bottom, items());
    }
    return true;
  }

  function onTreeKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = rows.findIndex((r) => r.id === selected);
    const r = rows[i];
    if (r && menuKey(e, '.trow.sel', () => treeMenu(r))) return;
    let to = -1;
    if (e.key === 'ArrowDown') to = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') to = Math.max(0, i - 1);
    else if (e.key === 'PageDown') to = Math.min(rows.length - 1, i + 20);
    else if (e.key === 'PageUp') to = Math.max(0, i - 20);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = rows.length - 1;
    else if (e.key === 'ArrowRight' && r) {
      if (r.size > 0 && !r.open) toggle(r, true);
      else if (r.open) to = i + 1;
    } else if (e.key === 'ArrowLeft' && r) {
      if (r.open) toggle(r, false);
      else to = rows.findIndex((x) => x.id === r.id.slice(0, r.id.lastIndexOf('/')));
    } else if ((e.key === 'Enter' || e.key === ' ') && r) toggle(r);
    else return;
    e.preventDefault();
    if (to >= 0 && rows[to]) {
      selected = rows[to].id;
      treeList?.scrollToIndex(to);
    }
  }

  const typeOf = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const shown = (v: Json) => (typeof v === 'string' ? JSON.stringify(v.length > 400 ? v.slice(0, 400) + '…' : v) : String(v));
  const selValue = $derived(loaded && mode === 'tree' ? valueAt(root, selected) : undefined);

  // ── 표 ────────────────────────────────────────────────
  let filter = $state('');
  let filterNow = $state('');
  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null);
  let cell = $state<{ row: number; col: number } | null>(null);
  let tableList = $state<VirtualList>();

  $effect(() => {
    const f = filter;
    const t = setTimeout(() => (filterNow = f), 180);
    return () => clearTimeout(t);
  });
  const order = $derived(mode === 'table' && table ? viewOrder(table, filterNow, sort) : new Int32Array(0));
  const numeric = $derived(table ? numericColumns(table) : []);
  const NUMW = 58;
  const widths = $derived.by(() => {
    if (!table) return [];
    const len = (s: string) => {
      let n = 0;
      for (let i = 0; i < s.length && n < 60; i++) n += s.charCodeAt(i) > 0x2e7f ? 1.75 : 1;
      return n;
    };
    return table.columns.map((c, i) => {
      let m = len(c) + 3;
      for (let r = 0; r < table.rows.length && r < 200; r++) m = Math.max(m, len(table.rows[r][i]));
      return Math.round(Math.min(360, Math.max(64, m * 7.8 + 28)));
    });
  });
  const tableWidth = $derived(widths.reduce((a, b) => a + b, NUMW));
  const cellValue = $derived(cell && table ? (table.rows[order[cell.row]]?.[cell.col] ?? '') : '');

  // 표로 볼 곳 고르기
  const spotLabel = (id: string, rows: number, nodes = 1) => `${pathText(root, id)} · ${num(rows)}행${nodes > 1 ? ` (${num(nodes)}곳)` : ''}`;
  const places = $derived.by(() => {
    if (loaded?.data.kind !== 'json') return [];
    const out = spots.map((s) => ({ id: s.id, label: spotLabel(s.id, s.rows, s.nodes) }));
    if (!out.some((o) => o.id === target) && jtable) out.unshift({ id: target, label: spotLabel(target, jtable.rows.length) });
    return out;
  });
  function showTable(id: string) {
    target = id;
    mode = 'table';
    filter = '';
    sort = null;
    cell = null;
  }
  /** 고른 칸이 원래 문서의 어느 노드인지 */
  const cellId = $derived.by(() => {
    const row = cell && jtable ? jtable.ids[order[cell.row]] : undefined;
    if (!cell || !jtable || row === undefined) return null;
    return (jtable.keys[cell.col] ?? []).reduce((id, k) => childId(id, k), row);
  });
  const cellNode = $derived(cellId === null ? undefined : valueAt(root, cellId));
  function showInTree() {
    if (cellId === null || !jtable || !cell) return;
    const id = cellNode === undefined ? jtable.ids[order[cell.row]] : cellId;
    mode = 'tree';
    reveal(id);
  }

  function sortBy(col: number) {
    sort = sort?.col !== col ? { col, dir: 1 } : sort.dir === 1 ? { col, dir: -1 } : null;
    cell = null;
  }
  function onTableKey(e: KeyboardEvent) {
    if (!cell || !table || e.ctrlKey || e.metaKey || e.altKey) return;
    if (menuKey(e, '.td.sel', tableMenu)) return;
    const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [20, 0], PageUp: [-20, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    cell = { row: Math.min(order.length - 1, Math.max(0, cell.row + d[0])), col: Math.min(table.columns.length - 1, Math.max(0, cell.col + d[1])) };
    tableList?.scrollToIndex(cell.row);
  }

  // ── 내보내기 ──────────────────────────────────────────
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} 복사했습니다`);
    } catch {
      say('클립보드에 복사하지 못했습니다');
    }
  }
  const base = () => {
    const name = loaded?.name ? loaded.name.replace(/\.[^.]+$/, '') : `data-${timestamp()}`;
    // 문서의 일부를 표로 보고 있으면 어디인지 이름에 붙인다
    const part = mode === 'table' && jtable ? target.split('/').filter((s) => s && s !== '*' && !/^\d+$/.test(s)).pop() : '';
    return part ? `${name}-${part.replace(/~[012]|[\\/:*?"<>|]/g, '_')}` : name;
  };
  const viewJson = (): Json => {
    if (mode !== 'table' || !table) return root;
    // JSON 에서 온 표는 펼치기 전의 원래 항목을 그대로 낸다
    if (jtable) return Array.from(order, (i) => valueAt(root, jtable.ids[i]) ?? null);
    return tableToJson({ columns: table.columns, rows: Array.from(order, (i) => table.rows[i]) });
  };

  // ── 다른 형식으로 ─────────────────────────────────────
  type Format = 'json' | 'yaml' | 'toml' | 'csv';
  const FORMATS: { id: Format; label: string; mime: string }[] = [
    { id: 'json', label: 'JSON', mime: 'application/json' },
    { id: 'yaml', label: 'YAML', mime: 'application/yaml' },
    { id: 'toml', label: 'TOML', mime: 'application/toml' },
    { id: 'csv', label: 'CSV', mime: 'text/csv' },
  ];
  const SHOW_MAX = 500_000;
  let out = $state<Format>('yaml');
  let oneLine = $state(false);

  /** CSV 로 낼 표. 표로 볼 배열이 없으면 객체 하나를 한 행으로 펼친다. */
  const csvTable = $derived.by<Table | null>(() => {
    if (table) return table;
    return loaded && root !== null && typeof root === 'object' && !Array.isArray(root) ? tableAt([root]) : null;
  });

  /** whole 이면 문서 전체, 아니면 지금 화면에 보이는 것(표에서는 거르고 정렬한 행). */
  function render(format: Format, whole: boolean): { text: string; note: string } {
    if (format === 'csv') {
      if (!csvTable) throw new Error('표로 펼칠 수 있는 배열이나 객체가 없어 CSV 로 바꿀 수 없습니다');
      const part = jtable && target ? `${pathText(root, target)} 부분만 표로 바꿨습니다. 안쪽 객체는 a.b 열로 펼칩니다.` : !table ? '객체 하나를 한 행으로 펼쳤습니다.' : '';
      return { text: toCsv(csvTable, ',', !whole && mode === 'table' ? order : undefined), note: part };
    }
    const value = whole ? root : viewJson();
    if (format === 'json') return { text: toJson(value, !oneLine || !whole), note: '' };
    if (format === 'yaml') return { text: toYaml(value), note: '' };
    const t = toToml(value);
    const notes = [];
    if (t.wrapped) notes.push(`TOML 은 맨 위가 객체여야 해서 ${t.wrapped} 아래에 넣었습니다.`);
    if (t.dropped) notes.push(`TOML 에 없는 null ${num(t.dropped)}개는 뺐습니다.`);
    return { text: t.text, note: notes.join(' ') };
  }

  const converted = $derived.by(() => {
    if (mode !== 'text' || !loaded) return { text: '', note: '', error: '' };
    try {
      return { ...render(out, true), error: '' };
    } catch (e) {
      return { text: '', note: '', error: e instanceof Error ? e.message : String(e) };
    }
  });
  const shownText = $derived(converted.text.length > SHOW_MAX ? converted.text.slice(0, SHOW_MAX) : converted.text);
  const lineCount = $derived.by(() => {
    let n = 0;
    for (let i = converted.text.indexOf('\n'); i >= 0; i = converted.text.indexOf('\n', i + 1)) n++;
    return n;
  });

  function save(format: Format) {
    const f = FORMATS.find((x) => x.id === format)!;
    try {
      const { text, note } = mode === 'text' && format === out ? converted : render(format, mode === 'text');
      // 엑셀이 한글을 알아보도록 CSV 에는 BOM 을 붙인다
      downloadBlob(new Blob([format === 'csv' ? '﻿' + text : text], { type: f.mime }), `${base()}.${format}`);
      if (note) say(note);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  }
  function saveMenu(e: MouseEvent) {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(b.left, b.bottom + 4, FORMATS.filter((f) => f.id !== 'csv' || csvTable).map((f) => ({ label: `${f.label} 파일로 저장`, run: () => save(f.id) })));
  }

  // ── 오른쪽 버튼 메뉴 ──────────────────────────────────
  type MenuItem = { label: string; run: () => void } | null; // null 은 구분선
  let menu = $state.raw<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let menuEl = $state<HTMLDivElement>();

  async function openMenu(x: number, y: number, items: MenuItem[]) {
    menu = { x, y, items };
    await tick();
    if (!menuEl) return;
    // 화면 밖으로 나가지 않게 당긴다
    const r = menuEl.getBoundingClientRect();
    menu = { items, x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) };
    menuEl.querySelector<HTMLButtonElement>('button')?.focus();
  }
  async function closeMenu(refocus = true) {
    if (!menu) return;
    menu = null;
    if (!refocus) return;
    await tick();
    (mode === 'tree' ? treeList : tableList)?.focus();
  }
  function pick(item: MenuItem) {
    menu = null;
    item?.run();
    tick().then(() => (mode === 'tree' ? treeList : tableList)?.focus());
  }
  function onMenuKey(e: KeyboardEvent) {
    const buttons = [...(menuEl?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (e.key === 'Escape' || e.key === 'Tab') closeMenu();
    else if (to !== undefined) buttons[(to + buttons.length) % buttons.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const asText = (v: Json, pretty = true) => (typeof v === 'string' ? v : JSON.stringify(v, null, pretty ? 2 : 0));

  // 비교 도구로 넘기기: 한쪽을 담아 두고, 다른 쪽에서 비교를 연다
  let held = $state.raw<{ text: string; label: string } | null>(null);
  function compareWith(text: string) {
    if (!held) return;
    if (!sendTo('/diff', { kind: 'diff', a: held.text, b: text, json: true })) say('새 탭을 열 수 없습니다. 팝업 차단을 풀어 주세요');
  }

  function treeMenu(r: TreeRow): MenuItem[] {
    const box = r.size >= 0;
    const items: MenuItem[] = [{ label: box ? 'JSON 복사' : '값 복사', run: () => copy(asText(r.value), box ? 'JSON 을' : '값을') }];
    if (box) items.push({ label: '한 줄로 복사', run: () => copy(JSON.stringify(r.value), '한 줄 JSON 을') });
    if (typeof r.key === 'string') {
      items.push({ label: '키 복사', run: () => copy(r.key as string, '키를') });
      items.push({ label: '키와 값 복사', run: () => copy(`${JSON.stringify(r.key)}: ${JSON.stringify(r.value, null, 2)}`, '키와 값을') });
    }
    items.push({ label: '경로 복사', run: () => copy(pathText(root, r.id), '경로를') });
    if (r.size > 0) {
      items.push(null);
      if (looksTabular(r.value)) items.push({ label: '표로 보기', run: () => showTable(r.id) });
      items.push({
        label: '아래 모두 펼치기',
        run: () => {
          const sub = expandAll(r.value);
          expanded = new Set([...expanded, ...Array.from(sub.expanded, (id) => r.id + id)]);
          if (!sub.complete) say('너무 커서 위쪽 단계까지만 펼쳤습니다');
        },
      });
      items.push({ label: '아래 모두 접기', run: () => (expanded = new Set([...expanded].filter((id) => id !== r.id && !id.startsWith(r.id + '/')))) });
      items.push({
        label: '이 부분만 JSON 저장',
        run: () => {
          const name = loaded?.name ? loaded.name.replace(/\.[^.]+$/, '') : `data-${timestamp()}`;
          const part = r.key === null ? '' : `-${String(r.key).replace(/[\\/:*?"<>|]/g, '_')}`;
          downloadBlob(new Blob([JSON.stringify(r.value, null, 2) + '\n'], { type: 'application/json' }), `${name}${part}.json`);
        },
      });
    }
    if (box) {
      const label = r.key === null ? '전체' : String(r.key);
      items.push(null);
      items.push({
        label: '비교할 것으로 담기',
        run: () => {
          held = { text: JSON.stringify(r.value, null, 2), label };
          say(`‘${label}’ 부분을 담았습니다. 견줄 곳에서 ‘담은 것과 비교’를 고르세요`);
        },
      });
      if (held) items.push({ label: `담은 것(${held.label.slice(0, 12)})과 비교 ↗`, run: () => compareWith(JSON.stringify(r.value, null, 2)) });
    }
    if (!box && String(r.value) !== '') {
      items.push(null);
      items.push({ label: '같은 값 찾기', run: () => (query = String(r.value)) });
    }
    return items;
  }

  function tableMenu(): MenuItem[] {
    if (!cell || !table) return [];
    const t = table;
    const r = order[cell.row];
    const value = cellValue;
    const rowJson = (): Json => (jtable ? (valueAt(root, jtable.ids[r]) ?? null) : tableToJson({ columns: t.columns, rows: [t.rows[r]] })[0]);
    const items: MenuItem[] = [
      { label: '값 복사', run: () => copy(value, '값을') },
      { label: '행 복사 (JSON)', run: () => copy(JSON.stringify(rowJson(), null, 2), '행을') },
      { label: '행 복사 (엑셀용)', run: () => copy(toCsv({ columns: t.columns, rows: [t.rows[r]] }, '\t').split('\n')[1] ?? '', '행을') },
      { label: '열 이름 복사', run: () => copy(t.columns[cell!.col], '열 이름을') },
    ];
    if (cellId !== null) {
      const id = cellId;
      items.push({ label: '경로 복사', run: () => copy(pathText(root, cellNode === undefined ? jtable!.ids[r] : id), '경로를') });
      items.push(null);
      if (looksTabular(cellNode)) items.push({ label: '표로 열기', run: () => showTable(id) });
      items.push({ label: '트리에서 보기', run: showInTree });
    }
    if (value !== '') {
      if (cellId === null) items.push(null);
      items.push({ label: '이 값으로 거르기', run: () => ((filter = value), (cell = null)) });
    }
    return items;
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!loaded || mode === 'text') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchEl?.focus();
      searchEl?.select();
    }
  }
  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && mode === 'tree') {
      e.preventDefault();
      gotoHit(hitAt + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      query = '';
      filter = '';
      (mode === 'tree' ? treeList : tableList)?.focus();
    }
  }
</script>

<svelte:window
  onkeydown={onWindowKey}
  onpointerdown={(e) => menu && !menuEl?.contains(e.target as Node) && closeMenu(false)}
  onwheel={() => closeMenu(false)}
  onresize={() => closeMenu(false)}
  onblur={() => closeMenu(false)}
/>

<ToolShell tool="data">
  {#snippet actions()}
    {#if loaded}
      <span class="chip">{kindLabel} · {bytes(loaded.bytes)}</span>
      <button class="btn sm" onclick={reset}>다른 데이터</button>
    {/if}
  {/snippet}

  {#if !loaded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="start"
      class:over={dragOver}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragOver = false;
        openFile(e.dataTransfer?.files[0]);
      }}
    >
      <div class="card">
        <h2>JSON · YAML · TOML · CSV 를 펼쳐 보고 서로 바꿉니다</h2>
        <p>붙여넣거나 파일을 끌어다 놓으세요. 형식은 알아서 판단합니다. 수십만 줄도 바로 열리고, 내용은 이 브라우저 밖으로 나가지 않습니다.</p>
        <textarea
          class="field"
          bind:this={inputEl}
          bind:value={input}
          spellcheck="false"
          autocapitalize="off"
          aria-label="데이터 붙여넣기"
          placeholder={'{"여기에": "JSON, YAML, TOML, CSV 무엇이든 붙여넣으세요"}'}
          onpaste={(e) => {
            const t = e.clipboardData?.getData('text/plain');
            if (!input && t) {
              e.preventDefault();
              open(t);
            }
          }}
          onkeydown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && open(input)}
        ></textarea>
        {#if error}
          <p class="error" role="alert">
            읽을 수 없습니다{#if error.line} — {error.line}번째 줄, {error.column}번째 글자{/if}
            <br /><span>{error.message}</span>
          </p>
        {/if}
        <div class="start-row">
          <button class="btn primary" disabled={!input.trim()} onclick={() => open(input)}>보기</button>
          <label class="btn">
            파일 열기
            <input
              type="file"
              accept=".json,.jsonl,.ndjson,.jsonc,.yaml,.yml,.toml,.csv,.tsv,.txt,application/json,application/yaml,application/toml,text/csv,text/plain"
              hidden
              onchange={(e) => {
                openFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <span class="gap"></span>
          <button class="btn ghost" onclick={() => open(sampleJson(), 'orders.json')}>JSON 예시</button>
          <button class="btn ghost" onclick={() => open(sampleYaml(), 'deploy.yaml')}>YAML 예시</button>
          <button class="btn ghost" onclick={() => open(sampleToml(), 'config.toml')}>TOML 예시</button>
          <button class="btn ghost" onclick={() => open(sampleCsv(), 'members.csv')}>CSV 예시</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="viewer">
      <div class="bar">
        <div class="seg" role="group" aria-label="보기 방식">
          <button aria-pressed={mode === 'tree'} onclick={() => (mode = 'tree')}>트리</button>
          <button aria-pressed={mode === 'table'} disabled={!table} title={table ? '' : '객체의 배열이 있어야 표로 볼 수 있습니다'} onclick={() => (mode = 'table')}>표</button>
          <button aria-pressed={mode === 'text'} title="다른 형식의 글로 바꿉니다" onclick={() => (mode = 'text')}>변환</button>
        </div>
        {#if mode === 'tree'}
          <div class="find">
            <input class="field" bind:this={searchEl} bind:value={query} onkeydown={onSearchKey} placeholder="키 · 값 찾기 (Ctrl+F)" aria-label="찾기" />
            {#if query.trim()}
              <span class="count">{hits.ids.length ? `${num(hitAt + 1)} / ${num(hits.ids.length)}${hits.more ? '+' : ''}` : '없음'}</span>
              <button class="btn sm" disabled={!hits.ids.length} onclick={() => gotoHit(hitAt - 1)} aria-label="이전">↑</button>
              <button class="btn sm" disabled={!hits.ids.length} onclick={() => gotoHit(hitAt + 1)} aria-label="다음">↓</button>
            {/if}
          </div>
          <button class="btn sm" onclick={openAll}>모두 펼치기</button>
          <button class="btn sm" onclick={() => (expanded = new Set(['']))}>모두 접기</button>
        {:else if mode === 'table' && table}
          {#if places.length > 1 || target}
            <select class="field place" aria-label="표로 볼 곳" title="문서에서 표로 볼 수 있는 곳" value={target} onchange={(e) => showTable(e.currentTarget.value)}>
              {#each places as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
            </select>
          {/if}
          <div class="find">
            <input class="field" bind:this={searchEl} bind:value={filter} onkeydown={onSearchKey} placeholder="행 거르기 (Ctrl+F)" aria-label="거르기" />
          </div>
          <span class="count">{order.length === table.rows.length ? `${num(table.rows.length)}행` : `${num(order.length)} / ${num(table.rows.length)}행`} · {table.columns.length}열</span>
          {#if loaded.data.kind === 'csv'}
            <label class="opt"><input type="checkbox" bind:checked={header} onchange={() => ((sort = null), (cell = null))} /> 첫 줄은 제목</label>
          {/if}
        {:else if mode === 'text'}
          <div class="seg" role="group" aria-label="바꿀 형식">
            {#each FORMATS as f (f.id)}
              <button aria-pressed={out === f.id} onclick={() => (out = f.id)}>{f.label}</button>
            {/each}
          </div>
          {#if out === 'json'}
            <label class="opt"><input type="checkbox" bind:checked={oneLine} /> 한 줄로</label>
          {:else if out === 'csv' && places.length > 1}
            <select class="field place" aria-label="표로 볼 곳" title="CSV 로 바꿀 배열" value={target} onchange={(e) => (target = e.currentTarget.value)}>
              {#each places as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
            </select>
          {:else if out === 'csv' && loaded.data.kind === 'csv'}
            <label class="opt"><input type="checkbox" bind:checked={header} /> 첫 줄은 제목</label>
          {/if}
          {#if !converted.error}<span class="count">{num(lineCount)}줄 · {bytes(converted.text.length)}</span>{/if}
        {/if}
        <div class="right">
          {#if toast}<span class="toast" role="status">{toast}</span>{/if}
          {#if mode === 'tree'}
            <button class="btn sm" onclick={() => copy(JSON.stringify(root, null, 2), 'JSON 을')}>JSON 복사</button>
            <button class="btn sm" onclick={() => copy(JSON.stringify(root), '한 줄 JSON 을')} title="공백을 모두 뺀 한 줄">한 줄로 복사</button>
          {:else if mode === 'table' && table}
            <button class="btn sm" onclick={() => copy(toCsv(table, '\t', order), '표를')} title="엑셀 · 시트에 바로 붙여넣을 수 있습니다">엑셀용 복사</button>
          {:else if mode === 'text'}
            <button class="btn sm" disabled={!!converted.error} onclick={() => copy(converted.text, `${FORMATS.find((f) => f.id === out)?.label} 을`)}>복사</button>
            <button class="btn sm" disabled={!!converted.error} onclick={() => save(out)}>저장</button>
          {/if}
          {#if mode !== 'text'}
            <button class="btn sm" aria-haspopup="menu" onclick={saveMenu} title={mode === 'table' ? '지금 보이는 행을 고른 형식으로 저장합니다' : '고른 형식으로 저장합니다'}>저장 ▾</button>
          {/if}
        </div>
      </div>

      <div class="box">
        {#if mode === 'tree'}
          {#snippet treeRow(i: number)}
            {@const r = rows[i]}
            {#if r}
              {@const t = typeOf(r.value)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div
                class="trow"
                class:sel={r.id === selected}
                class:hit={hitSet.has(r.id)}
                style:padding-left="{r.depth * 18 + 6}px"
                onclick={() => (selected = r.id)}
                ondblclick={() => toggle(r)}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  selected = r.id;
                  openMenu(e.clientX, e.clientY, treeMenu(r));
                }}
              >
                {#if r.size > 0}
                  <button class="caret" class:open={r.open} tabindex="-1" aria-label={r.open ? '접기' : '펼치기'} onclick={(e) => (e.stopPropagation(), (selected = r.id), toggle(r))}>
                    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </button>
                {:else}
                  <span class="caret"></span>
                {/if}
                {#if r.key !== null}<span class={typeof r.key === 'number' ? 'idx' : 'key'}>{r.key}</span><span class="colon">:</span>{/if}
                {#if r.size >= 0}
                  <span class="meta">{t === 'array' ? `[${num(r.size)}]` : `{${num(r.size)}}`}</span>
                  {#if looksTabular(r.value)}
                    <button class="totable" tabindex="-1" aria-label="이 배열을 표로 보기" title="이 배열을 표로 보기" onclick={(e) => (e.stopPropagation(), showTable(r.id))}>표</button>
                  {/if}
                  {#if !r.open && r.size > 0}<span class="pv">{preview(r.value)}</span>{/if}
                {:else}
                  <span class="v {t}">{shown(r.value)}</span>
                {/if}
              </div>
            {/if}
          {/snippet}
          <VirtualList bind:this={treeList} count={rows.length} rowHeight={ROW} row={treeRow} label="JSON 트리" onkeydown={onTreeKey} />
        {:else if mode === 'text'}
          {#if converted.error}
            <p class="none">{converted.error}</p>
          {:else}
            <textarea class="outtext" readonly spellcheck="false" aria-label="바꾼 결과" value={shownText}></textarea>
          {/if}
        {:else if table}
          {#snippet tableHead()}
            <div class="thead">
              <span class="th n" style:width="{NUMW}px">#</span>
              {#each table.columns as c, i (i)}
                <button class="th" class:num={numeric[i]} style:width="{widths[i]}px" onclick={() => sortBy(i)} title="{c} — 눌러서 정렬">
                  <span>{c}</span>
                  {#if sort?.col === i}<b>{sort.dir === 1 ? '▲' : '▼'}</b>{/if}
                </button>
              {/each}
            </div>
          {/snippet}
          {#snippet tableRow(i: number)}
            {@const r = table.rows[order[i]]}
            {#if r}
              <div class="tr" class:odd={i % 2 === 1}>
                <span class="td n" style:width="{NUMW}px">{num(order[i] + 1)}</span>
                {#each r as v, c (c)}
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                  <span class="td" class:num={numeric[c]} class:sel={cell?.row === i && cell.col === c} style:width="{widths[c]}px" onclick={() => (cell = { row: i, col: c })}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      cell = { row: i, col: c };
                      openMenu(e.clientX, e.clientY, tableMenu());
                    }}
                    ondblclick={() => looksTabular(cellNode) && cellId !== null && showTable(cellId)}>{v}</span>
                {/each}
              </div>
            {/if}
          {/snippet}
          <VirtualList bind:this={tableList} count={order.length} rowHeight={ROW + 4} width={tableWidth} header={tableHead} headerHeight={32} row={tableRow} label="표" onkeydown={onTableKey} />
          {#if !order.length}<p class="none">조건에 맞는 행이 없습니다</p>{/if}
        {/if}
      </div>

      <div class="status">
        {#if mode === 'tree'}
          <code class="path">{pathText(root, selected)}</code>
          <button class="btn sm ghost" onclick={() => copy(pathText(root, selected), '경로를')}>경로 복사</button>
          <button class="btn sm ghost" disabled={selValue === undefined} onclick={() => copy(typeof selValue === 'string' ? selValue : JSON.stringify(selValue, null, 2), '값을')}>값 복사</button>
        {:else if mode === 'text'}
          <span class="hint">{[`${kindLabel} → ${FORMATS.find((f) => f.id === out)?.label}`, converted.note, converted.text.length > SHOW_MAX ? `앞 ${num(SHOW_MAX)}자만 보여 줍니다. 복사 · 저장에는 전체가 들어갑니다.` : ''].filter(Boolean).join(' · ')}</span>
        {:else if cell && table}
          <b class="where">{table.columns[cell.col]} · {num(order[cell.row] + 1)}행</b>
          <code class="path">{cellValue.length > 600 ? cellValue.slice(0, 600) + '…' : cellValue}</code>
          {#if cellId !== null}
            {#if looksTabular(cellNode)}<button class="btn sm ghost" onclick={() => showTable(cellId)} title="이 칸의 배열을 표로 엽니다 (두 번 눌러도 됩니다)">표로 열기</button>{/if}
            <button class="btn sm ghost" onclick={showInTree}>트리에서 보기</button>
          {/if}
          <button class="btn sm ghost" onclick={() => copy(cellValue, '값을')}>값 복사</button>
        {:else}
          <span class="hint">칸을 누르면 전체 내용을 여기에 보여 줍니다. 제목을 누르면 정렬합니다.</span>
        {/if}
      </div>
    </div>
    {#if menu}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="menu" role="menu" tabindex="-1" bind:this={menuEl} style:left="{menu.x}px" style:top="{menu.y}px" onkeydown={onMenuKey} oncontextmenu={(e) => e.preventDefault()}>
        {#each menu.items as item, i (i)}
          {#if item}
            <button role="menuitem" tabindex="-1" onclick={() => pick(item)}>{item.label}</button>
          {:else}
            <hr />
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</ToolShell>

<style>
  .chip {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .start {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    overflow: auto;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(720px, 100%);
    padding: 26px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
  }
  .start.over .card {
    border-color: var(--app);
    box-shadow: 0 0 0 4px var(--app-soft);
  }
  .card h2 {
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .card p {
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.7;
  }
  .card textarea {
    height: min(300px, 36vh);
    font-family: var(--mono);
    font-size: 12.5px;
    white-space: pre;
    resize: vertical;
  }
  .card .error {
    padding: 8px 12px;
    border-radius: 10px;
    color: var(--bad);
    background: color-mix(in srgb, var(--bad) 9%, var(--surface));
    font-weight: 600;
    line-height: 1.5;
  }
  .card .error span {
    font: 400 12px/1.5 var(--mono);
  }
  .start-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .gap {
    flex: 1;
  }

  .viewer {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 10px 12px;
  }
  .bar .seg button {
    height: 24px;
    font-size: 12.5px;
  }
  .bar .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .find {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .find input {
    width: 220px;
    height: 28px;
    font-size: 12.5px;
  }
  .find .btn {
    width: 28px;
    padding: 0;
  }
  .place {
    height: 28px;
    max-width: 320px;
    padding: 0 6px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .count {
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .opt input {
    accent-color: var(--app);
    margin: 0;
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .toast {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ok);
    margin-right: 4px;
  }

  .box {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    margin: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--surface);
    overflow: hidden;
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .box :global(.vl:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--app-line);
  }

  .outtext {
    flex: 1;
    min-width: 0;
    padding: 10px 14px;
    border: 0;
    outline: none;
    resize: none;
    background: none;
    color: inherit;
    font: inherit;
    line-height: 1.6;
    white-space: pre;
    tab-size: 2;
  }

  /* 트리 */
  .trow {
    display: flex;
    align-items: center;
    height: 24px;
    padding-right: 12px;
    white-space: nowrap;
    cursor: default;
  }
  .trow:hover {
    background: var(--surface-2);
  }
  .trow.hit {
    background: color-mix(in srgb, #f5b800 20%, var(--surface));
  }
  .trow.sel {
    background: var(--app-soft);
    box-shadow: inset 2px 0 0 var(--app);
  }
  .caret {
    flex: none;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-right: 2px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--faint);
  }
  button.caret:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .caret svg {
    transition: transform 0.1s;
  }
  .caret.open svg {
    transform: rotate(90deg);
  }
  .key {
    color: var(--app);
    font-weight: 600;
  }
  .idx {
    color: var(--faint);
  }
  .colon {
    color: var(--faint);
    margin-right: 7px;
  }
  .meta {
    color: var(--faint);
    font-size: 11.5px;
  }
  .totable {
    flex: none;
    height: 18px;
    margin-left: 6px;
    padding: 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted);
    font: 600 11px/1 var(--font);
  }
  .totable:hover {
    border-color: var(--app);
    color: var(--app);
    background: var(--app-soft);
  }
  .pv {
    margin-left: 8px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .v.string {
    color: #2b8a3e;
  }
  .v.number {
    color: #1971c2;
  }
  .v.boolean {
    color: #9c36b5;
  }
  .v.null {
    color: var(--faint);
    font-style: italic;
  }
  :global(:root[data-theme='dark']) .v.string {
    color: #8ce99a;
  }
  :global(:root[data-theme='dark']) .v.number {
    color: #74c0fc;
  }
  :global(:root[data-theme='dark']) .v.boolean {
    color: #e599f7;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .v.string {
      color: #8ce99a;
    }
    :global(:root:not([data-theme='light'])) .v.number {
      color: #74c0fc;
    }
    :global(:root:not([data-theme='light'])) .v.boolean {
      color: #e599f7;
    }
  }

  /* 표 */
  .thead,
  .tr {
    display: flex;
    width: max-content;
    min-width: 100%;
  }
  .thead {
    height: 32px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
    font-family: var(--font);
  }
  .th {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    border: 0;
    border-right: 1px solid var(--border);
    background: none;
    font-size: 12.5px;
    font-weight: 650;
    text-align: left;
    min-width: 0;
  }
  button.th:hover {
    background: var(--surface-3);
  }
  .th span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .th b {
    flex: none;
    font-size: 9px;
    color: var(--app);
  }
  .th.num {
    justify-content: flex-end;
  }
  .tr {
    height: 28px;
    border-bottom: 1px solid var(--border);
  }
  .tr.odd {
    background: color-mix(in srgb, var(--surface-2) 45%, var(--surface));
  }
  .td {
    flex: none;
    padding: 0 10px;
    line-height: 27px;
    border-right: 1px solid var(--border);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: cell;
  }
  .td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .td.sel {
    box-shadow: inset 0 0 0 2px var(--app);
    background: var(--app-soft);
  }
  .n {
    position: sticky;
    left: 0;
    z-index: 1;
    justify-content: flex-end;
    text-align: right;
    color: var(--faint);
    font-size: 11.5px;
    background: var(--surface-2);
    cursor: default;
    font-family: var(--mono);
  }
  .none {
    position: absolute;
    inset: 80px 0 auto;
    text-align: center;
    color: var(--faint);
    font-family: var(--font);
    font-size: 13.5px;
  }

  .status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    margin: 0 12px 12px;
    padding: 4px 6px 4px 12px;
    border: 1px solid var(--border);
    border-top: 0;
    border-radius: 0 0 var(--radius) var(--radius);
    background: var(--surface-2);
    font-size: 12.5px;
  }
  .path {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .where {
    flex: none;
    font-weight: 650;
    white-space: nowrap;
  }
  .hint {
    color: var(--faint);
  }

  .menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 176px;
    padding: 5px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
  }
  .menu button {
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--app-soft);
    outline: none;
  }
  .menu hr {
    margin: 4px 6px;
    border: 0;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 760px) {
    .chip {
      display: none;
    }
    .bar {
      padding: 8px;
    }
    .find {
      flex: 1;
    }
    .find input {
      flex: 1;
      width: auto;
      min-width: 120px;
    }
    .place {
      max-width: 100%;
    }
    .right {
      margin-left: 0;
    }
    .box {
      margin: 0 8px;
    }
    .status {
      margin: 0 8px 8px;
    }
    .card {
      padding: 18px;
    }
  }
</style>

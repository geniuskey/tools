<script lang="ts">
  import { tick } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import VirtualList from '$lib/ui/VirtualList.svelte';
  import { downloadBlob, timestamp } from '$lib/download';
  import {
    ancestors,
    csvToTable,
    expandAll,
    flatten,
    jsonToTable,
    numericColumns,
    parseAny,
    pathText,
    preview,
    search,
    tableToJson,
    toCsv,
    valueAt,
    viewOrder,
    type Json,
    type Parsed,
    type Table,
    type TreeRow,
  } from '$lib/data/core';
  import { sampleCsv, sampleJson } from '$lib/data/samples';

  const MAX_FILE = 200 * 1024 * 1024;
  const ROW = 24;

  type Loaded = Extract<Parsed, { kind: 'json' | 'csv' }>;
  let input = $state('');
  let inputEl = $state<HTMLTextAreaElement>();
  let error = $state<Extract<Parsed, { kind: 'error' }> | null>(null);
  let loaded = $state.raw<{ data: Loaded; name: string; bytes: number } | null>(null);
  let mode = $state<'tree' | 'table'>('tree');
  let header = $state(true);
  let dragOver = $state(false);
  let toast = $state('');

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }

  async function open(text: string, name = '', hint?: 'json' | 'csv') {
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
    open(await f.text(), f.name, ext === 'json' || ext === 'jsonl' || ext === 'ndjson' ? 'json' : ext === 'csv' || ext === 'tsv' ? 'csv' : undefined);
  }

  function reset() {
    loaded = null;
    error = null;
  }

  // ── 데이터 ────────────────────────────────────────────
  const table = $derived.by<Table | null>(() => {
    const d = loaded?.data;
    if (!d) return null;
    return d.kind === 'csv' ? csvToTable(d.rows, header) : jsonToTable(d.value);
  });
  const root = $derived.by<Json>(() => {
    const d = loaded?.data;
    if (!d) return null;
    return d.kind === 'json' ? d.value : tableToJson(table!);
  });
  const kindLabel = $derived.by(() => {
    const d = loaded?.data;
    if (!d) return '';
    if (d.kind === 'json') return d.lines ? 'JSON Lines' : 'JSON';
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

  function onTreeKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = rows.findIndex((r) => r.id === selected);
    const r = rows[i];
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

  function sortBy(col: number) {
    sort = sort?.col !== col ? { col, dir: 1 } : sort.dir === 1 ? { col, dir: -1 } : null;
    cell = null;
  }
  function onTableKey(e: KeyboardEvent) {
    if (!cell || !table || e.ctrlKey || e.metaKey || e.altKey) return;
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
  const base = () => (loaded?.name ? loaded.name.replace(/\.[^.]+$/, '') : `data-${timestamp()}`);
  const viewJson = () => (mode === 'table' && table ? tableToJson({ columns: table.columns, rows: Array.from(order, (i) => table.rows[i]) }) : root);
  function saveJson() {
    downloadBlob(new Blob([JSON.stringify(viewJson(), null, 2) + '\n'], { type: 'application/json' }), `${base()}.json`);
  }
  function saveCsv() {
    if (!table) return;
    // 엑셀이 한글을 알아보도록 BOM 을 붙인다
    downloadBlob(new Blob(['﻿' + toCsv(table, ',', mode === 'table' ? order : undefined)], { type: 'text/csv' }), `${base()}.csv`);
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!loaded) return;
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

<svelte:window onkeydown={onWindowKey} />

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
        <h2>JSON · CSV 를 펼쳐 봅니다</h2>
        <p>붙여넣거나 파일을 끌어다 놓으세요. 형식은 알아서 판단합니다. 수십만 줄도 바로 열리고, 내용은 이 브라우저 밖으로 나가지 않습니다.</p>
        <textarea
          class="field"
          bind:this={inputEl}
          bind:value={input}
          spellcheck="false"
          autocapitalize="off"
          aria-label="데이터 붙여넣기"
          placeholder={'{"여기에": "JSON 이나 CSV 를 붙여넣으세요"}'}
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
              accept=".json,.jsonl,.ndjson,.csv,.tsv,.txt,application/json,text/csv,text/plain"
              hidden
              onchange={(e) => {
                openFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <span class="gap"></span>
          <button class="btn ghost" onclick={() => open(sampleJson(), 'orders.json')}>JSON 예시</button>
          <button class="btn ghost" onclick={() => open(sampleCsv(), 'members.csv')}>CSV 예시</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="viewer">
      <div class="bar">
        <div class="seg" role="group" aria-label="보기 방식">
          <button aria-pressed={mode === 'tree'} onclick={() => (mode = 'tree')}>트리</button>
          <button aria-pressed={mode === 'table'} disabled={!table} title={table ? '' : '객체의 배열일 때만 표로 볼 수 있습니다'} onclick={() => (mode = 'table')}>표</button>
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
        {:else if table}
          <div class="find">
            <input class="field" bind:this={searchEl} bind:value={filter} onkeydown={onSearchKey} placeholder="행 거르기 (Ctrl+F)" aria-label="거르기" />
          </div>
          <span class="count">{order.length === table.rows.length ? `${num(table.rows.length)}행` : `${num(order.length)} / ${num(table.rows.length)}행`} · {table.columns.length}열</span>
          {#if loaded.data.kind === 'csv'}
            <label class="opt"><input type="checkbox" bind:checked={header} onchange={() => ((sort = null), (cell = null))} /> 첫 줄은 제목</label>
          {/if}
        {/if}
        <div class="right">
          {#if toast}<span class="toast" role="status">{toast}</span>{/if}
          {#if mode === 'tree'}
            <button class="btn sm" onclick={() => copy(JSON.stringify(root, null, 2), 'JSON 을')}>JSON 복사</button>
            <button class="btn sm" onclick={() => copy(JSON.stringify(root), '한 줄 JSON 을')} title="공백을 모두 뺀 한 줄">한 줄로 복사</button>
          {:else if table}
            <button class="btn sm" onclick={() => copy(toCsv(table, '\t', order), '표를')} title="엑셀 · 시트에 바로 붙여넣을 수 있습니다">엑셀용 복사</button>
          {/if}
          <button class="btn sm" onclick={saveJson}>JSON 저장</button>
          <button class="btn sm" disabled={!table} onclick={saveCsv}>CSV 저장</button>
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
                  {#if !r.open && r.size > 0}<span class="pv">{preview(r.value)}</span>{/if}
                {:else}
                  <span class="v {t}">{shown(r.value)}</span>
                {/if}
              </div>
            {/if}
          {/snippet}
          <VirtualList bind:this={treeList} count={rows.length} rowHeight={ROW} row={treeRow} label="JSON 트리" onkeydown={onTreeKey} />
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
                  <span class="td" class:num={numeric[c]} class:sel={cell?.row === i && cell.col === c} style:width="{widths[c]}px" onclick={() => (cell = { row: i, col: c })}>{v}</span>
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
        {:else if cell && table}
          <b class="where">{table.columns[cell.col]} · {num(order[cell.row] + 1)}행</b>
          <code class="path">{cellValue.length > 600 ? cellValue.slice(0, 600) + '…' : cellValue}</code>
          <button class="btn sm ghost" onclick={() => copy(cellValue, '값을')}>값 복사</button>
        {:else}
          <span class="hint">칸을 누르면 전체 내용을 여기에 보여 줍니다. 제목을 누르면 정렬합니다.</span>
        {/if}
      </div>
    </div>
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

<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { receive } from '$lib/handoff';
  import Editor from '$lib/table/Editor.svelte';
  import {
    blankGrid,
    clone,
    deleteCol,
    deleteRow,
    dropEmpty,
    insertCol,
    insertRow,
    mergeSame,
    moveCol,
    moveRow,
    normalize,
    numericCols,
    resolveAligns,
    sortRows,
    tidy,
    transpose,
    unmerge,
    width,
    type Align,
    type Grid,
  } from '$lib/table/grid';
  import { readHtml, readText, SOURCE_NAMES, type Reading } from '$lib/table/read';
  import { defaultOptions, DIALECTS, FORMATS, formatById, write, type BoxStyle, type Format, type Options } from '$lib/table/write';

  const KEY = 'tools:table:v1';
  const SHOWN = 300;
  const PREVIEW = 200_000;
  const EXAMPLES: [string, string][] = [
    ['엑셀에서 복사한 표', '이름\t부서\t입사일\t연봉\n김하늘\t개발팀\t2021-03-02\t52,000,000\n이서연\t디자인팀\t2022-07-18\t48,500,000\n박민준\t개발팀\t2019-11-04\t61,200,000\n최지우\t영업팀\t2023-01-09\t43,000,000\n'],
    ['마크다운', '| 기능 | 무료 | 유료 |\n| :--- | :--: | ---: |\n| 저장 공간 | 5 GB | 2 TB |\n| 공유 링크 | ✓ | ✓ |\n| 지원 | 메일 | 전화 · 메일 |\n'],
    ['psql 결과', ' id | name   | city  | score\n----+--------+-------+-------\n  1 | 하늘   | 서울  |  92.5\n  2 | 서연   | 부산  |  88.0\n  3 | 민준   | 대구  |  79.25\n(3 rows)\n'],
    ['합친 칸이 있는 HTML', '<table><tr><th rowspan="2">분기</th><th colspan="2">매출</th></tr><tr><th>국내</th><th>해외</th></tr><tr><td>1분기</td><td>1,200</td><td>340</td></tr><tr><td>2분기</td><td>1,450</td><td>410</td></tr></table>'],
  ];
  const BOX_STYLES: [BoxStyle, string][] = [
    ['unicode', '┌─┐ 선'],
    ['rounded', '╭─╮ 둥근'],
    ['double', '╔═╗ 겹선'],
    ['ascii', '+-+ ASCII'],
    ['rst', 'reST 격자'],
    ['plain', '공백만'],
  ];

  // ── 상태 ──
  let src = $state('');
  let grid = $state<Grid>(blankGrid(0, 0));
  let source = $state<Reading['source'] | null>(null);
  let note = $state('');
  let header = $state(true);
  let aligns = $state<Align[]>([]);
  let format = $state<Format>('markdown');
  let opts = $state<Options>({ ...defaultOptions });
  let ready = $state(false);
  let toast = $state('');
  let fromHtml = $state(false);
  let srcEl = $state<HTMLTextAreaElement>();

  const empty = $derived(grid.rows.length === 0);
  const w = $derived(width(grid));
  const info = $derived(formatById.get(format)!);
  const sides = $derived(empty ? [] : resolveAligns(grid, aligns, header));
  const nums = $derived(empty ? [] : numericCols(grid, header));
  const colAligns = $derived(sides.map((side, c) => ({ set: aligns[c] ?? 'auto', side })));
  const output = $derived(empty ? '' : write(grid, format, { ...opts, header, aligns: sides }));
  const preview = $derived(format === 'rich' && !empty ? write(grid, 'rich', { ...opts, header, aligns: sides }) : '');
  const bodyRows = $derived(Math.max(0, grid.rows.length - (header ? 1 : 0)));

  function say(msg: string) {
    toast = msg;
    setTimeout(() => toast === msg && (toast = ''), 2200);
  }

  // ── 되돌리기 ──
  type Snap = { grid: Grid; aligns: Align[]; header: boolean };
  let past: Snap[] = [];
  let future: Snap[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  const snap = (): Snap => ({ grid: clone(grid), aligns: [...aligns], header });
  function remember() {
    past.push(snap());
    if (past.length > 80) past.shift();
    future = [];
    canUndo = true;
    canRedo = false;
  }
  function restore(s: Snap) {
    grid = s.grid;
    aligns = s.aligns;
    header = s.header;
  }
  function undo() {
    const s = past.pop();
    if (!s) return;
    future.push(snap());
    restore(s);
    canUndo = past.length > 0;
    canRedo = true;
  }
  function redo() {
    const s = future.pop();
    if (!s) return;
    past.push(snap());
    restore(s);
    canUndo = true;
    canRedo = future.length > 0;
  }
  function change(next: Grid, nextAligns = aligns) {
    remember();
    grid = next;
    aligns = nextAligns;
  }

  // ── 읽기 ──
  function use(r: Reading | null, how: string) {
    if (!r) {
      grid = blankGrid(0, 0);
      source = null;
      note = '';
      return;
    }
    remember();
    grid = r.grid;
    source = r.source;
    header = r.header;
    aligns = r.aligns.length ? [...r.aligns] : [];
    note = [r.note, how].filter(Boolean).join(' · ');
  }
  function onsrc() {
    fromHtml = false;
    use(readText(src), '');
  }
  /** 클립보드: HTML 표가 있으면 그쪽(합친 칸 · 정렬까지), 없으면 글 */
  function fromClipboard(text: string, htmlText: string): boolean {
    const h = /<t[dh]\b/i.test(htmlText) ? readHtml(htmlText) : null;
    if (h && h.grid.rows.length && (h.grid.rows.length > 1 || width(h.grid) > 1)) {
      // 엑셀 · 시트는 머리글을 th 로 주지 않으니 글 모양으로 다시 짐작한다
      const t = text.trim() ? readText(text) : null;
      if (!h.header && t) h.header = t.header;
      src = text || htmlText;
      fromHtml = true;
      use(h, h.grid.merges.length ? `서식에서 합친 칸 ${h.grid.merges.length}개까지 읽었습니다` : '서식에서 읽었습니다');
      return true;
    }
    if (!text.trim()) return false;
    src = text;
    fromHtml = false;
    use(readText(text), '');
    return true;
  }
  function onSrcPaste(e: ClipboardEvent) {
    const h = e.clipboardData?.getData('text/html') ?? '';
    if (!/<t[dh]\b/i.test(h)) return; // 글은 그냥 붙여넣고 oninput 에서 읽는다
    e.preventDefault();
    fromClipboard(e.clipboardData?.getData('text/plain') ?? '', h);
  }
  const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');
  function onWindowPaste(e: ClipboardEvent) {
    if (typing(e.target)) return;
    if (fromClipboard(e.clipboardData?.getData('text/plain') ?? '', e.clipboardData?.getData('text/html') ?? '')) {
      e.preventDefault();
      say('붙여넣었습니다');
    }
  }
  function loadExample(t: string) {
    src = t;
    fromHtml = false;
    use(readText(t), '');
  }
  function clear() {
    remember();
    src = '';
    fromHtml = false;
    grid = blankGrid(0, 0);
    source = null;
    note = '';
    aligns = [];
    srcEl?.focus();
  }
  function newTable() {
    remember();
    grid = blankGrid(4, 3);
    source = null;
    header = true;
    aligns = [];
    note = '';
  }

  // 파일: 한국어 엑셀이 저장한 CSV(EUC-KR)도 읽는다
  async function readFile(file: File) {
    const buf = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('euc-kr').decode(buf);
    }
    if (/\.(xlsx?|numbers|hwp)$/i.test(file.name)) {
      say('엑셀 파일은 열어서 표를 복사해 붙여넣어 주세요');
      return;
    }
    src = text.slice(0, 5_000_000);
    fromHtml = false;
    use(readText(src), file.name);
  }
  let dragging = $state(false);
  function ondrop(e: DragEvent) {
    dragging = false;
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    readFile(f);
  }
  function pickFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) readFile(f);
    (e.currentTarget as HTMLInputElement).value = '';
  }

  // ── 다듬기 ──
  let cellStart = false;
  function oncell(r: number, c: number, t: string) {
    if (cellStart) {
      remember();
      cellStart = false;
    }
    grid.rows[r][c] = t;
  }
  const onbegin = () => (cellStart = true);

  function spread(r0: number, c0: number, text: string, htmlText: string): boolean {
    const h = /<t[dh]\b/i.test(htmlText) ? readHtml(htmlText) : null;
    const piece = h && h.grid.rows.length ? h.grid : readText(text)?.grid;
    if (!piece || (piece.rows.length < 2 && width(piece) < 2)) return false;
    // 빈 표에 붙여넣으면 표를 통째로 바꾼다
    if (grid.rows.every((row) => row.every((v) => !v))) {
      change(normalize(piece));
      header = readText(text)?.header ?? true;
      say(`${piece.rows.length}줄 × ${width(piece)}칸을 붙여넣었습니다`);
      return true;
    }
    let g = unmerge(grid, true);
    const need = r0 + piece.rows.length;
    const needW = c0 + width(piece);
    while (g.rows.length < need) g = insertRow(g, g.rows.length);
    while (width(g) < needW) g = insertCol(g, width(g));
    piece.rows.forEach((row, i) => row.forEach((v, j) => (g.rows[r0 + i][c0 + j] = v)));
    change(g);
    say(`${piece.rows.length}줄 × ${width(piece)}칸을 붙여넣었습니다`);
    return true;
  }

  const shiftAligns = (fn: (a: Align[]) => Align[]) => fn([...Array.from({ length: w }, (_, i) => aligns[i] ?? 'auto')]);
  function oncol(c: number, a: string) {
    if (a.startsWith('align-')) {
      remember();
      const next = shiftAligns((x) => x);
      next[c] = a.slice(6) as Align;
      aligns = next;
      return;
    }
    if (a === 'sort-asc' || a === 'sort-desc') {
      change(sortRows(grid, c, a === 'sort-asc' ? 1 : -1, header));
      if (grid.merges.length === 0 && past.at(-1)?.grid.merges.length) say('정렬하느라 합친 칸을 풀었습니다');
      return;
    }
    if (a === 'move-left' || a === 'move-right') {
      const to = a === 'move-left' ? c - 1 : c + 1;
      change(moveCol(grid, c, to), shiftAligns((x) => (x.splice(to, 0, x.splice(c, 1)[0]), x)));
      return;
    }
    if (a === 'insert-left' || a === 'insert-right') {
      const at = a === 'insert-left' ? c : c + 1;
      change(insertCol(grid, at), shiftAligns((x) => (x.splice(at, 0, 'auto'), x)));
      return;
    }
    if (a === 'merge-same') {
      const next = mergeSame(grid, c, header);
      if (next.merges.length === grid.merges.length) say('위아래로 이어지는 같은 값이 없습니다');
      else change(next);
      return;
    }
    if (a === 'delete') change(deleteCol(grid, c), shiftAligns((x) => (x.splice(c, 1), x)));
  }
  function onrow(r: number, a: string) {
    if (a === 'insert-above') change(insertRow(grid, r));
    else if (a === 'insert-below') change(insertRow(grid, r + 1));
    else if (a === 'move-up') change(moveRow(grid, r, r - 1));
    else if (a === 'move-down') change(moveRow(grid, r, r + 1));
    else if (a === 'delete') change(deleteRow(grid, r));
  }
  function doTranspose() {
    change(transpose(grid), []);
  }
  function doTidy() {
    const next = tidy(grid);
    if (JSON.stringify(next.rows) === JSON.stringify(grid.rows)) return say('정리할 공백이 없습니다');
    change(next);
    say('앞뒤 공백을 정리했습니다');
  }
  function doDrop() {
    const next = dropEmpty(grid);
    const dr = grid.rows.length - next.rows.length;
    const dc = w - width(next);
    if (!dr && !dc) return say('빈 줄 · 빈 열이 없습니다');
    // 지운 열의 정렬도 같이 맞춘다
    const keep = Array.from({ length: w }, (_, c) => grid.rows.some((row) => row[c].trim()) || grid.merges.some((m) => c >= m.c && c < m.c + m.cs));
    change(next, aligns.filter((_, c) => keep[c]));
    say([dr ? `빈 줄 ${dr}개` : '', dc ? `빈 열 ${dc}개` : ''].filter(Boolean).join(', ') + '를 지웠습니다');
  }
  function doUnmerge() {
    change(unmerge(grid, opts.merges === 'fill'));
    say('합친 칸을 풀었습니다');
  }
  function toggleHeader() {
    remember();
    header = !header;
  }

  // ── 내보내기 ──
  async function copy() {
    if (!output) return;
    try {
      if (format === 'rich' && typeof ClipboardItem !== 'undefined') {
        const plain = write(grid, 'tsv', { ...opts, header, aligns: sides, merges: 'fill' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([preview], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
        say('서식 있는 표로 복사했습니다 — 메일 · 문서에 붙여넣으세요');
      } else {
        await navigator.clipboard.writeText(output);
        say(`${info.name} 복사했습니다`);
      }
    } catch {
      say('복사하지 못했습니다');
    }
  }
  function download() {
    if (!output) return;
    // 엑셀이 한글을 깨뜨리지 않게 CSV · TSV 에는 BOM 을 붙인다
    const bom = format === 'csv' || format === 'tsv' ? '﻿' : '';
    const body = format === 'rich' || format === 'html' ? `<!doctype html>\n<meta charset="utf-8">\n${output}` : output;
    downloadBlob(new Blob([bom + body], { type: `${info.mime};charset=utf-8` }), `표-${timestamp()}.${info.ext}`);
  }

  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || typing(e.target)) return;
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }

  // ── 저장 ──
  onMount(() => {
    const s = load<Record<string, any>>(KEY, {});
    if (typeof s.src === 'string') src = s.src;
    if (s.grid && Array.isArray(s.grid.rows) && s.grid.rows.every((r: unknown) => Array.isArray(r))) grid = normalize({ rows: s.grid.rows.map((r: unknown[]) => r.map(String)), merges: Array.isArray(s.grid.merges) ? s.grid.merges : [] });
    if (typeof s.source === 'string' && s.source in SOURCE_NAMES) source = s.source as Reading['source'];
    if (typeof s.header === 'boolean') header = s.header;
    if (Array.isArray(s.aligns)) aligns = s.aligns.filter((a: string) => ['auto', 'left', 'center', 'right'].includes(a));
    if (formatById.has(s.format)) format = s.format;
    if (s.opts && typeof s.opts === 'object') {
      const o = { ...defaultOptions };
      for (const k of Object.keys(o) as (keyof Options)[]) if (k !== 'aligns' && k !== 'header' && typeof s.opts[k] === typeof o[k]) (o as any)[k] = s.opts[k];
      opts = o;
    }
    fromHtml = s.fromHtml === true;
    ready = true;
    // 다른 도구(연봉표 …)에서 넘긴 표
    receive().then((h) => {
      if (h?.kind === 'table') fromClipboard(h.text, '');
    });
  });
  // 바뀔 때마다 쓰면 큰 표에서 느려서 잠깐 모았다가 쓴다. 창을 닫거나 숨길 때는 바로 쓴다.
  let pending: (() => void) | null = null;
  const flush = () => {
    pending?.();
    pending = null;
  };
  $effect(() => {
    const data = { src: src.length < 400_000 ? src : '', grid: $state.snapshot(grid), source, header, aligns: [...aligns], format, opts: $state.snapshot(opts), fromHtml };
    if (!ready) return;
    pending = () => {
      if (src.length >= 400_000 || data.grid.rows.length * width(data.grid) > 200_000) save(KEY, { ...data, src: '', grid: null });
      else save(KEY, data);
    };
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  });
</script>

<svelte:window onpaste={onWindowPaste} {onkeydown} onpagehide={flush} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && flush()} />

<ToolShell tool="table">
  {#snippet actions()}
    <button class="btn sm ghost" disabled={!canUndo} onclick={undo} title="되돌리기 (⌘Z)">되돌리기</button>
    <button class="btn sm ghost" disabled={!canRedo} onclick={redo} title="다시 하기 (⌘⇧Z)">다시</button>
  {/snippet}

  <div class="table-tool">
    <div class="page">
      <section class="col left" aria-label="표">
        <div class="card" class:drag={dragging} ondragover={(e) => (e.preventDefault(), (dragging = true))} ondragleave={() => (dragging = false)} {ondrop} role="group" aria-label="붙여넣기">
          <div class="cardhead">
            <h2>붙여넣기 <small>엑셀 · 구글 시트 · 웹 페이지 · 마크다운 · CSV · JSON …</small></h2>
            <div class="tools">
              <label class="btn sm ghost file">파일 열기<input type="file" accept=".csv,.tsv,.txt,.md,.html,.htm,.json,text/*" onchange={pickFile} /></label>
              <button class="btn sm ghost" disabled={!src && empty} onclick={clear}>비우기</button>
            </div>
          </div>
          <label class="sr-only" for="table-src">표 원문</label>
          <textarea
            id="table-src"
            class="field src"
            bind:this={srcEl}
            bind:value={src}
            oninput={onsrc}
            onpaste={onSrcPaste}
            spellcheck="false"
            placeholder="표를 복사해서 여기에 붙여넣으세요 (⌘V / Ctrl+V). 엑셀에서 합친 칸도 그대로 읽습니다."
          ></textarea>
          <p class="read" aria-live="polite">
            {#if source && !empty}
              <b>{SOURCE_NAMES[source]}</b> · {grid.rows.length}줄 × {w}칸으로 읽었습니다{#if note}{' · '}{note}{/if}
            {:else if src.trim()}
              표로 읽지 못했습니다.
            {:else}
              <span>예시:</span>
              {#each EXAMPLES as [name, t] (name)}<button class="chip" onclick={() => loadExample(t)}>{name}</button>{/each}
              <button class="chip" onclick={newTable}>빈 표 만들기</button>
            {/if}
          </p>
          {#if fromHtml && !empty}<p class="hint">서식(HTML)에서 읽은 표입니다. 위 글을 고치면 글에서 다시 읽습니다.</p>{/if}
        </div>

        {#if !empty}
          <div class="card">
            <div class="cardhead">
              <h2>표 다듬기 <small>칸을 눌러 고치고, 열 · 줄 머리를 눌러 정렬 · 옮기기</small></h2>
            </div>
            <div class="bar" role="toolbar" aria-label="표 다듬기">
              <label class="check"><input type="checkbox" checked={header} onchange={toggleHeader} /> 첫 줄은 머리글</label>
              <button class="btn sm" onclick={doTranspose} title="줄과 열을 맞바꿉니다">행 ↔ 열</button>
              <button class="btn sm" onclick={doTidy}>공백 정리</button>
              <button class="btn sm" onclick={doDrop}>빈 줄 · 열 지우기</button>
              {#if grid.merges.length}<button class="btn sm" onclick={doUnmerge}>합친 칸 풀기 <small>{grid.merges.length}</small></button>{/if}
            </div>
            <Editor {grid} {header} aligns={colAligns} shown={SHOWN} {oncell} {onbegin} {oncol} {onrow} onspread={spread} />
            <div class="foot">
              <button class="btn sm ghost" onclick={() => change(insertRow(grid, grid.rows.length))}>+ 줄</button>
              <button class="btn sm ghost" onclick={() => change(insertCol(grid, w), [...aligns.slice(0, w), 'auto'])}>+ 열</button>
              <span>
                {#if grid.rows.length > SHOWN}앞의 {SHOWN}줄만 보여 줍니다 (모두 {grid.rows.length.toLocaleString()}줄, 결과에는 모두 들어갑니다) · {/if}
                {#if nums.some(Boolean)}숫자 열은 오른쪽 정렬 ·{/if} 칸 안 줄바꿈은 <kbd>Shift</kbd>+<kbd>Enter</kbd>
              </span>
            </div>
          </div>
        {:else}
          <div class="card blank">
            <p>표를 붙여넣으면 여기서 바로 고칠 수 있습니다.</p>
            <p class="hint">칸 고치기 · 열 정렬 · 행 ↔ 열 바꾸기 · 오름차순 정렬 · 같은 값 합치기 · 되돌리기</p>
          </div>
        {/if}
      </section>

      <section class="col right" aria-label="결과">
        <div class="card">
          <h2>무엇으로 바꿀까</h2>
          <div class="formats" role="radiogroup" aria-label="형식">
            {#each FORMATS as f (f.id)}
              <button role="radio" aria-checked={format === f.id} onclick={() => (format = f.id)}>{f.name}</button>
            {/each}
          </div>
          <p class="where">{info.where}</p>

          <div class="opts">
            {#if format === 'markdown'}
              <label class="check"><input type="checkbox" bind:checked={opts.pad} /> 칸 너비 맞추기 <small>(한글은 두 칸으로 셉니다)</small></label>
            {:else if format === 'text' || format === 'slack'}
              <div class="seg wrapseg" role="group" aria-label="테두리">
                {#each BOX_STYLES as [id, name] (id)}<button aria-pressed={opts.box === id} onclick={() => (opts.box = id)}>{name}</button>{/each}
              </div>
              {#if opts.box !== 'plain' && opts.box !== 'rst'}<label class="check"><input type="checkbox" bind:checked={opts.rowLines} /> 줄마다 가로줄</label>{/if}
            {:else if format === 'html'}
              <label class="check"><input type="checkbox" bind:checked={opts.inlineStyle} /> 테두리 · 여백을 style 로 넣기 <small>(CSS 를 못 쓰는 곳)</small></label>
            {:else if format === 'json'}
              <div class="seg" role="group" aria-label="JSON 모양">
                <button aria-pressed={opts.jsonShape === 'objects'} onclick={() => (opts.jsonShape = 'objects')}>객체 배열</button>
                <button aria-pressed={opts.jsonShape === 'arrays'} onclick={() => (opts.jsonShape = 'arrays')}>배열의 배열</button>
              </div>
              <label class="check"><input type="checkbox" bind:checked={opts.infer} /> 숫자 · true/false · 빈 칸(null) 알아보기 <small>(007 은 글로 둡니다)</small></label>
            {:else if format === 'sql'}
              <div class="row2">
                <label class="f"><span>테이블 이름</span><input class="field" bind:value={opts.sqlTable} spellcheck="false" /></label>
                <label class="f"><span>DB</span>
                  <select class="field" bind:value={opts.dialect}>{#each DIALECTS as d (d.id)}<option value={d.id}>{d.name}</option>{/each}</select>
                </label>
              </div>
              <label class="check"><input type="checkbox" bind:checked={opts.sqlCreate} /> CREATE TABLE 도 <small>(값을 보고 형을 짐작)</small></label>
              <label class="check"><input type="checkbox" bind:checked={opts.sqlBatch} disabled={opts.dialect === 'oracle'} /> INSERT 하나에 여러 줄</label>
              <label class="check"><input type="checkbox" bind:checked={opts.infer} /> 숫자는 따옴표 없이 · 빈 칸은 NULL</label>
            {:else if format === 'latex'}
              <label class="check"><input type="checkbox" bind:checked={opts.booktabs} /> booktabs 가로줄 <small>(\toprule · \midrule)</small></label>
            {:else if format === 'rich'}
              <p class="hint">복사하면 진짜 표로 붙습니다: Gmail · Outlook · 워드 · 한글 · 구글 문서 · 노션. 받는 쪽이 서식을 못 받으면 탭으로 나눈 글이 붙습니다.</p>
            {/if}
            {#if grid.merges.length}
              <div class="f">
                <span>합친 칸 {grid.merges.length}개 {info.merges ? '' : `— ${info.name}는 칸을 합칠 수 없습니다`}</span>
                <div class="seg" role="group" aria-label="합친 칸">
                  {#if info.merges}<button aria-pressed={opts.merges === 'keep'} onclick={() => (opts.merges = 'keep')}>합친 채로</button>{/if}
                  <button aria-pressed={opts.merges === 'fill'} onclick={() => (opts.merges = 'fill')}>같은 값 채우기</button>
                  <button aria-pressed={opts.merges === 'blank' || (!info.merges && opts.merges === 'keep')} onclick={() => (opts.merges = 'blank')}>비우기</button>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="card out">
          <div class="cardhead">
            <h2>{info.name} {#if output}<small>{output.length.toLocaleString()}자</small>{/if}</h2>
            <div class="tools">
              <button class="btn sm ghost" disabled={!output} onclick={download}>.{info.ext} 받기</button>
              <button class="btn sm primary" disabled={!output} onclick={copy}>복사</button>
            </div>
          </div>
          {#if empty}
            <p class="none">왼쪽에 표를 붙여넣으면 여기에 나옵니다.</p>
          {:else if format === 'rich'}
            <!-- 우리가 만든 HTML (모든 글자를 이스케이프했다) -->
            <div class="rich">{@html preview}</div>
          {:else}
            <pre class="code" class:wrap={format === 'json' || format === 'sql'} aria-label="{info.name} 결과">{output.length > PREVIEW ? output.slice(0, PREVIEW) + '\n…' : output}</pre>
            {#if output.length > PREVIEW}<p class="hint">앞부분만 보여 줍니다. 복사 · 받기에는 모두 들어갑니다.</p>{/if}
          {/if}
          {#if (format === 'text' || format === 'slack') && !empty}
            <p class="hint">한글은 고정폭 글꼴에서 두 칸으로 맞췄습니다. 글꼴에 따라 조금 어긋날 수 있습니다.</p>
          {/if}
          {#if format === 'markdown' && !header && !empty}
            <p class="hint">마크다운 표에는 머리글 줄이 꼭 있어야 해서 빈 머리글을 넣었습니다.</p>
          {/if}
          {#if bodyRows === 0 && !empty && (format === 'json' || format === 'sql') && header}
            <p class="hint">머리글만 있고 내용 줄이 없습니다.</p>
          {/if}
        </div>
      </section>
    </div>
  </div>
  {#if toast}<p class="toast" role="status">{toast}</p>{/if}
</ToolShell>

<style>
  .table-tool {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    padding: 14px;
    max-width: 1440px;
    margin: 0 auto;
  }
  .col {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .right {
    position: sticky;
    top: 14px;
  }
  .card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .card.drag {
    border-color: var(--app);
    box-shadow: 0 0 0 3px var(--app-soft);
  }
  .card h2 {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .card h2 small {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .cardhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tools {
    display: flex;
    gap: 6px;
  }
  .file {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }
  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .src {
    width: 100%;
    min-height: 110px;
    max-height: 260px;
    resize: vertical;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
    tab-size: 8;
    white-space: pre;
  }
  .src:focus {
    border-color: var(--app);
    outline: 3px solid var(--app-soft);
    outline-offset: 0;
  }
  .read {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    color: var(--muted);
  }
  .read b {
    color: var(--app);
  }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--app-line);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    font-weight: 600;
  }
  .chip:hover {
    background: var(--app-soft);
  }
  .hint {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .bar .check {
    margin-right: 6px;
  }
  .bar small {
    margin-left: 3px;
    color: var(--faint);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .check input {
    accent-color: var(--app);
  }
  .check small {
    font-size: 12px;
    color: var(--faint);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--faint);
  }
  .foot span {
    margin-left: auto;
  }
  .blank {
    place-items: center;
    padding: 40px 16px;
    text-align: center;
    color: var(--muted);
    border-style: dashed;
  }
  .formats {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .formats button {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    color: var(--muted);
  }
  .formats button:hover {
    border-color: var(--app-line);
    color: var(--text);
  }
  .formats button[aria-checked='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .where {
    font-size: 12.5px;
    color: var(--faint);
  }
  .opts {
    display: grid;
    gap: 8px;
    justify-items: start;
  }
  .opts:empty {
    display: none;
  }
  .wrapseg {
    flex-wrap: wrap;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
  }
  .f {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .f .field {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .out {
    gap: 8px;
  }
  .code {
    margin: 0;
    max-height: min(60vh, 620px);
    overflow: auto;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre;
  }
  .code.wrap {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .rich {
    max-height: min(60vh, 620px);
    overflow: auto;
    padding: 12px;
    border-radius: 10px;
    background: #fff;
    color: #111;
    font-size: 13px;
    color-scheme: light;
  }
  .none {
    padding: 30px 0;
    text-align: center;
    font-size: 13px;
    color: var(--faint);
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--text);
    color: var(--bg);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    z-index: 60;
  }
  @media (max-width: 960px) {
    .page {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
    .right {
      position: static;
    }
  }
  @media (max-width: 520px) {
    .card {
      padding: 12px;
    }
    .row2 {
      grid-template-columns: 1fr;
    }
    .foot span {
      margin-left: 0;
    }
  }
</style>

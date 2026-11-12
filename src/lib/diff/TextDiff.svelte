<script lang="ts">
  import { onMount } from 'svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { diffLines, normalizeJson, unifiedPatch, type Row, type Seg, type WsMode } from './core';
  import { sampleJson, sampleText } from './samples';

  let { json = false, active = true }: { json?: boolean; active?: boolean } = $props();

  // Beyond Compare 처럼 왼쪽 · 오른쪽 두 창이 곧 편집기이자 비교 결과다.
  // 같은 줄끼리 높이를 맞추고(빈 자리는 빗금), 한 줄 높이가 고정이라 보이는 줄만 그린다.

  type Side = 'a' | 'b';
  const SIDES: Side[] = ['a', 'b'];
  const KEY = 'tools:diff:v1';
  const CONTEXT = 3;
  const H = 20;
  const OVERSCAN = 12;
  const MAX_FILE = 40 * 1024 * 1024;
  const label = { a: '원본', b: '바뀐 내용' };

  function lineCount(t: string) {
    if (!t) return 0;
    let n = 1;
    for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) n++;
    return t.endsWith('\n') ? n - 1 : n;
  }

  let doc = $state({ a: { text: '', name: '' }, b: { text: '', name: '' } });
  let opts = $state({ ws: 'none' as WsMode, ignoreCase: false, fold: true, sortKeys: true });
  let editing = $state({ a: false, b: false });
  let ready = false;
  let notice = $state('');
  let copied = $state(false);
  let dropSide = $state<Side | null>(null);

  // 입력이 멈춘 뒤에 비교한다. 줄 편집 · 블록 복사는 flush() 로 바로 반영한다.
  let src = $state.raw({ a: '', b: '' });
  $effect(() => {
    const a = doc.a.text;
    const b = doc.b.text;
    if (a === src.a && b === src.b) return;
    const t = setTimeout(() => (src = { a, b }), a.length + b.length > 300_000 ? 300 : 100);
    return () => clearTimeout(t);
  });
  function flush() {
    src = { a: doc.a.text, b: doc.b.text };
  }

  const prepared = $derived.by(() => {
    if (!json) return { a: src.a, b: src.b, errA: '', errB: '' };
    const a = normalizeJson(src.a, opts.sortKeys);
    const b = normalizeJson(src.b, opts.sortKeys);
    return { a: a.ok ? a.text : '', b: b.ok ? b.text : '', errA: a.ok ? '' : a.error, errB: b.ok ? '' : b.error };
  });
  const has = $derived({ a: prepared.a !== '', b: prepared.b !== '' });
  const blank = $derived(!doc.a.text && !doc.b.text);
  /** 한쪽만 있으면 그쪽을 그대로 보여 주고, 빈 쪽에는 입력 칸을 띄운다 */
  const solo = $derived(has.a !== has.b);
  const result = $derived.by(() => {
    const o = { ws: opts.ws, ignoreCase: opts.ignoreCase };
    if (has.a && has.b) return diffLines(prepared.a, prepared.b, o);
    if (has.a || has.b) {
      const t = has.a ? prepared.a : prepared.b;
      return diffLines(t, t, o);
    }
    return null;
  });
  const changes = $derived(result && !solo ? result.added + result.removed + result.modified : 0);
  const same = $derived(!!result && !solo && !changes);

  type RowItem = { k: 'row'; row: Row; block: number; first: boolean; pa: number; pb: number };
  type Item = { k: 'fold'; key: number; count: number } | RowItem;
  interface Block {
    at: number;
    a0: number;
    a1: number;
    b0: number;
    b1: number;
  }

  let expanded = $state.raw(new Set<number>());
  let cur = $state(-1);
  let edit = $state<{ side: Side; line: number; caret: number } | null>(null);
  let keepView = false;

  $effect(() => {
    result;
    if (keepView) {
      keepView = false;
      return;
    }
    expanded = new Set();
    cur = -1;
  });

  const built = $derived.by(() => {
    const items: Item[] = [];
    const blocks: Block[] = [];
    if (!result) return { items, blocks };
    const rows = result.rows;
    const ed = edit;
    let pa = 0;
    let pb = 0;
    const push = (r: Row, block: number, first: boolean) => {
      // pa · pb: 이 줄 앞에 있는 각 쪽 줄 수 (빈 자리에 새 줄을 끼울 위치)
      items.push({ k: 'row', row: r, block, first, pa: r.a ?? pa, pb: r.b ?? pb });
      if (r.a !== null) pa = r.a + 1;
      if (r.b !== null) pb = r.b + 1;
    };
    let i = 0;
    while (i < rows.length) {
      let e = i;
      if (!rows[i].changed) {
        while (e < rows.length && !rows[e].changed) e++;
        const head = i === 0 ? 0 : CONTEXT;
        const tail = e === rows.length ? 0 : CONTEXT;
        const f0 = i + head;
        const f1 = e - tail;
        // 고치고 있는 줄, 문서 전체가 같은 경우는 접지 않는다
        const holdsEdit = !!ed && f1 > f0 && rows[f0][ed.side]! <= ed.line && ed.line <= rows[f1 - 1][ed.side]!;
        if (opts.fold && (head || tail) && e - i > head + tail + 1 && !expanded.has(i) && !holdsEdit) {
          for (let r = i; r < f0; r++) push(rows[r], -1, false);
          items.push({ k: 'fold', key: i, count: f1 - f0 });
          pa = rows[f1 - 1].a! + 1;
          pb = rows[f1 - 1].b! + 1;
          for (let r = f1; r < e; r++) push(rows[r], -1, false);
        } else {
          for (let r = i; r < e; r++) push(rows[r], -1, false);
        }
      } else {
        while (e < rows.length && rows[e].changed) e++;
        const blk: Block = { at: items.length, a0: pa, a1: pa, b0: pb, b1: pb };
        for (let r = i; r < e; r++) push(rows[r], blocks.length, r === i);
        blk.a1 = pa;
        blk.b1 = pb;
        blocks.push(blk);
      }
      i = e;
    }
    return { items, blocks };
  });
  const items = $derived(built.items);
  const lnw = $derived(
    `${String(Math.max(result?.linesA.length ?? 0, result?.linesB.length ?? 0, lineCount(doc.a.text), lineCount(doc.b.text), 10)).length + 1.5}ch`,
  );

  // ── 보이는 줄만 그리기 ─────────────────────────────────────
  let scroller = $state<HTMLElement>();
  let top = $state(0);
  let vh = $state(600);
  let sbw = $state(0);
  const start = $derived(Math.max(0, Math.floor(top / H) - OVERSCAN));
  const end = $derived(Math.min(items.length, Math.ceil((top + vh) / H) + OVERSCAN));
  const win = $derived(items.slice(start, end));

  $effect(() => {
    const el = scroller;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      vh = el.clientHeight;
      sbw = el.offsetWidth - el.clientWidth;
    });
    ro.observe(el);
    // 가로 휠 · Shift+휠은 두 창을 함께 가로로 민다
    const wheel = (e: WheelEvent) => {
      const dx = e.shiftKey ? e.deltaX || e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (!dx || maxSx <= 0) return;
      e.preventDefault();
      sx = Math.max(0, Math.min(maxSx, sx + dx));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  });

  function reveal(index: number) {
    if (scroller) scroller.scrollTop = Math.max(0, index * H - vh / 2 + H / 2);
  }

  function go(delta: number) {
    const n = built.blocks.length;
    if (!n) return;
    cur = cur < 0 || cur >= n ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n;
    reveal(built.blocks[cur].at);
  }

  function expand(key: number) {
    expanded = new Set(expanded).add(key);
  }

  // ── 가로 스크롤: 두 창이 같이 움직인다 ──────────────────────
  let sx = $state(0);
  let colW = $state(0);
  let ctx: CanvasRenderingContext2D | null = null;
  function textWidth(lines: string[], el: HTMLElement | undefined): number {
    if (!lines.length || !el) return 0;
    let maxLen = 0;
    for (const l of lines) if (l.length > maxLen) maxLen = l.length;
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return maxLen * 8;
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    let w = 0;
    let seen = 0;
    for (const l of lines) {
      if (l.length < maxLen / 2) continue;
      w = Math.max(w, ctx.measureText(l.replace(/\t/g, '    ')).width);
      if (++seen > 300) break;
    }
    return Math.ceil(w);
  }
  const maxW = $derived(result ? Math.max(textWidth(result.linesA, scroller), textWidth(result.linesB, scroller)) + 20 : 0);
  const maxSx = $derived(Math.max(0, maxW - colW));
  $effect(() => {
    if (sx > maxSx) sx = maxSx;
  });

  let hbars: HTMLElement[] = $state([]);
  $effect(() => {
    const el = hbars[0];
    if (!el) return;
    const ro = new ResizeObserver(() => (colW = el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  });
  $effect(() => {
    for (const el of hbars) if (el && Math.abs(el.scrollLeft - sx) > 0.5) el.scrollLeft = sx;
  });

  // 한쪽 글만 골라 복사할 수 있게, 누른 쪽이 아닌 창은 선택되지 않게 한다
  let selSide = $state<Side>('a');

  // 스크롤 옆 지도: 전체에서 바뀐 곳이 어디쯤인지
  const map = $derived.by(() => {
    const n = Math.min(items.length, 220);
    const cells = new Array<string>(n).fill('');
    if (!changes) return cells;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k !== 'row' || !it.row.changed) continue;
      const kind = it.row.a === null ? 'ins' : it.row.b === null ? 'del' : 'mod';
      const c = Math.floor((i / items.length) * n);
      cells[c] = cells[c] && cells[c] !== kind ? 'mod' : kind;
    }
    return cells;
  });

  function onMap(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    reveal(Math.min(items.length - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * items.length))));
  }

  // ── 고치기 · 되돌리기 ─────────────────────────────────────
  type Snap = { a: { text: string; name: string }; b: { text: string; name: string } };
  let past = $state.raw<Snap[]>([]);
  let future = $state.raw<Snap[]>([]);

  function snap(): Snap {
    return { a: { ...doc.a }, b: { ...doc.b } };
  }
  function remember() {
    const s = snap();
    const last = past[past.length - 1];
    if (last && last.a.text === s.a.text && last.b.text === s.b.text) return;
    const cap = s.a.text.length + s.b.text.length > 2_000_000 ? 5 : 100;
    past = [...past.slice(-(cap - 1)), s];
    future = [];
  }
  function restore(from: Snap[], to: Snap[]): [Snap[], Snap[]] {
    if (!from.length) return [from, to];
    const s = from[from.length - 1];
    const now = snap();
    doc = { a: { ...s.a }, b: { ...s.b } };
    edit = null;
    keepView = true;
    flush();
    return [from.slice(0, -1), [...to, now]];
  }
  function undo() {
    [past, future] = restore(past, future);
  }
  function redo() {
    [future, past] = restore(future, past);
  }

  const linesOf = (side: Side) => (side === 'a' ? result?.linesA : result?.linesB) ?? [];

  function setLines(side: Side, lines: string[]) {
    const old = doc[side].text;
    const eol = old.includes('\r\n') ? '\r\n' : '\n';
    const tail = json || old === '' || old.endsWith('\n') ? eol : '';
    const text = lines.length ? lines.join(eol) + tail : '';
    if (text === old) return;
    remember();
    doc[side].text = text;
    keepView = true;
    flush();
  }

  function copyBlock(b: Block, to: Side) {
    const from = to === 'a' ? linesOf('b').slice(b.b0, b.b1) : linesOf('a').slice(b.a0, b.a1);
    const L = linesOf(to);
    const [x0, x1] = to === 'a' ? [b.a0, b.a1] : [b.b0, b.b1];
    setLines(to, L.slice(0, x0).concat(from, L.slice(x1)));
  }

  function caretFrom(cell: Element): number {
    try {
      const sel = getSelection();
      if (!sel?.rangeCount || !cell.contains(sel.anchorNode)) return Infinity;
      const r = document.createRange();
      r.selectNodeContents(cell);
      r.setEnd(sel.anchorNode!, sel.anchorOffset);
      return r.toString().length;
    } catch {
      return Infinity;
    }
  }

  // 두 번 누르면 그 줄을 바로 고친다. 빈 자리를 누르면 그 자리에 새 줄을 끼운다.
  function startEdit(side: Side, it: RowItem, e: MouseEvent) {
    if (!result || !has[side]) return;
    const line = it.row[side];
    if (line === null) {
      const at = side === 'a' ? it.pa : it.pb;
      const L = linesOf(side);
      setLines(side, L.slice(0, at).concat('', L.slice(at)));
      edit = { side, line: at, caret: 0 };
      return;
    }
    edit = { side, line, caret: caretFrom(e.currentTarget as Element) };
  }

  // 키로 이미 처리한 뒤 입력 칸이 사라지며 생기는 blur 는 무시한다
  let skipBlur: HTMLInputElement | null = null;

  function finish(el: HTMLInputElement, next: { line: number; caret: number } | null, lines?: string[]) {
    const ed = edit;
    if (!ed || skipBlur === el) return;
    skipBlur = el;
    const L = lines ?? linesOf(ed.side).slice();
    if (!lines) L[ed.line] = el.value;
    setLines(ed.side, L);
    edit = next ? { side: ed.side, ...next } : null;
  }

  function onEditKey(e: KeyboardEvent) {
    const el = e.currentTarget as HTMLInputElement;
    const ed = edit;
    if (!ed || e.isComposing || e.altKey) return;
    const v = el.value;
    const s = el.selectionStart ?? 0;
    const t = el.selectionEnd ?? 0;
    const L = linesOf(ed.side).slice();
    if (e.key === 'Escape') {
      skipBlur = el;
      edit = null;
    } else if (e.key === 'Enter') {
      L.splice(ed.line, 1, v.slice(0, s), v.slice(t));
      finish(el, { line: ed.line + 1, caret: 0 }, L);
    } else if (e.key === 'Backspace' && s === 0 && t === 0 && ed.line > 0) {
      const prev = L[ed.line - 1];
      L.splice(ed.line - 1, 2, prev + v);
      finish(el, { line: ed.line - 1, caret: prev.length }, L);
    } else if (e.key === 'Delete' && s === v.length && t === v.length && ed.line < L.length - 1) {
      L.splice(ed.line, 2, v + L[ed.line + 1]);
      finish(el, { line: ed.line, caret: v.length }, L);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const line = ed.line + (e.key === 'ArrowUp' ? -1 : 1);
      if (line < 0 || line >= L.length) return;
      finish(el, { line, caret: s });
    } else return;
    e.preventDefault();
  }

  function onEditPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const ed = edit;
    if (!ed || !/[\r\n]/.test(text)) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    const v = el.value;
    const parts = text.replace(/\r\n?/g, '\n').split('\n');
    const last = parts.length - 1;
    const caret = parts[last].length;
    parts[0] = v.slice(0, el.selectionStart ?? 0) + parts[0];
    parts[last] += v.slice(el.selectionEnd ?? v.length);
    const L = linesOf(ed.side).slice();
    L.splice(ed.line, 1, ...parts);
    finish(el, { line: ed.line + last, caret }, L);
  }

  function focusAt(caret: number) {
    return (el: HTMLInputElement) => {
      skipBlur = null;
      el.focus();
      const c = Math.min(caret, el.value.length);
      el.setSelectionRange(c, c);
      el.parentElement?.parentElement?.scrollIntoView({ block: 'nearest' });
    };
  }

  // ── 파일 · 입력 ───────────────────────────────────────────
  async function readFile(side: Side, f: File) {
    if (f.size > MAX_FILE) return flash(`${f.name}: 파일이 너무 큽니다 (최대 40MB)`);
    const text = await f.text();
    if (text.slice(0, 4000).includes('\u0000')) return flash(`${f.name}: 텍스트 파일이 아닙니다`);
    remember();
    doc[side] = { text, name: f.name };
    editing[side] = false;
  }

  // 파일 두 개를 한꺼번에 놓으면 왼쪽 · 오른쪽에 차례로 넣는다
  function takeFiles(side: Side, files: FileList | null | undefined) {
    if (!files?.length) return;
    if (files.length >= 2) {
      readFile('a', files[0]);
      readFile('b', files[1]);
    } else readFile(side, files[0]);
  }

  function sideAt(e: DragEvent): Side {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'a' : 'b';
  }

  function flash(msg: string) {
    notice = msg;
    setTimeout(() => notice === msg && (notice = ''), 4000);
  }

  function swap() {
    remember();
    doc = { a: doc.b, b: doc.a };
    edit = null;
  }
  function clear(side: Side) {
    remember();
    doc[side] = { text: '', name: '' };
    edit = null;
  }
  function sample() {
    remember();
    const s = json ? sampleJson : sampleText;
    doc = { a: { text: s.a, name: '' }, b: { text: s.b, name: '' } };
    editing = { a: false, b: false };
  }
  function saveSide(side: Side) {
    downloadBlob(new Blob([doc[side].text], { type: 'text/plain' }), doc[side].name || `${side === 'a' ? 'left' : 'right'}-${timestamp()}.${json ? 'json' : 'txt'}`);
  }
  function toggleEditor(side: Side) {
    edit = null;
    if (editing[side]) {
      editing[side] = false;
      flush();
    } else {
      editing[side] = true;
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`.ovl textarea[data-side="${side}"]`)?.focus());
    }
  }
  const showEditor = (side: Side) => editing[side] || !has[side];

  // 입력 칸에도 줄 번호를 붙인다. 보이는 부분의 번호만 그리고 입력 칸 스크롤을 따라간다.
  let edTop = $state({ a: 0, b: 0 });
  function edNumbers(side: Side) {
    const n = Math.max(1, lineCount(doc[side].text) + (doc[side].text.endsWith('\n') ? 1 : 0));
    const first = Math.min(n - 1, Math.floor(edTop[side] / H));
    const last = Math.min(n, first + Math.ceil(vh / H) + 2);
    let text = '';
    for (let i = first; i < last; i++) text += i + 1 + '\n';
    return { text, y: first * H - edTop[side] };
  }

  function patch() {
    return unifiedPatch(prepared.a, prepared.b, doc.a.name || 'a', doc.b.name || 'b');
  }
  async function copyPatch() {
    try {
      await navigator.clipboard.writeText(patch());
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      flash('클립보드에 복사하지 못했습니다');
    }
  }
  function savePatch() {
    downloadBlob(new Blob([patch()], { type: 'text/x-diff' }), `diff-${timestamp()}.patch`);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    const typing = (e.target as HTMLElement)?.matches?.('input, textarea');
    if ((e.metaKey || e.ctrlKey) && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    const down = (e.altKey && e.key === 'ArrowDown') || (e.key === 'F7' && !e.shiftKey);
    const up = (e.altKey && e.key === 'ArrowUp') || (e.key === 'F7' && e.shiftKey);
    if (!down && !up) return;
    e.preventDefault();
    go(down ? 1 : -1);
  }

  const ignored = $derived([opts.ws !== 'none' && '공백', opts.ignoreCase && '대소문자', json && opts.sortKeys && '키 순서'].filter(Boolean).join(' · '));

  onMount(() => {
    const saved = load<Record<string, unknown>>(KEY, {});
    delete saved.view;
    opts = { ...opts, ...saved };
    ready = true;
  });
  $effect(() => {
    const snapOpts = $state.snapshot(opts);
    if (ready) save(KEY, snapOpts);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet tx(segs: Seg[] | undefined, text: string)}{#if segs}{#each segs as g, i (i)}{#if g.changed}<mark>{g.text}</mark>{:else}{g.text}{/if}{/each}{:else}{text}{/if}{/snippet}

{#snippet cell(side: Side, it: RowItem)}
  {@const r = it.row}
  {@const line = r[side]}
  {#if edit && edit.side === side && line === edit.line}
    <span class="tx editing s{side}">
      <input
        class="line-in"
        value={linesOf(side)[line]}
        spellcheck="false"
        autocapitalize="off"
        aria-label="{label[side]} {line + 1}번째 줄"
        onkeydown={onEditKey}
        onpaste={onEditPaste}
        onblur={(e) => finish(e.currentTarget, null)}
        {@attach focusAt(edit.caret)}
      />
    </span>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="tx s{side}"
      class:del={side === 'a' && r.changed && line !== null}
      class:ins={side === 'b' && r.changed && line !== null}
      class:void={line === null}
      onmousedown={() => (selSide = side)}
      ondblclick={(e) => startEdit(side, it, e)}
      ><span class="t">{#if line !== null}{@render tx(side === 'a' ? r.segA : r.segB, linesOf(side)[line])}{/if}</span></span
    >
  {/if}
{/snippet}

<div class="diff" style:--lnw={lnw}>
  <div class="bar">
    <button class="btn sm" onclick={swap} disabled={blank} title="왼쪽과 오른쪽을 바꿉니다">⇄ 바꾸기</button>
    <span class="nav">
      <button class="btn sm" disabled={!past.length} onclick={undo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
      <button class="btn sm" disabled={!future.length} onclick={redo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
    </span>
    <label class="opt">
      공백
      <select class="field" bind:value={opts.ws}>
        <option value="none">그대로 비교</option>
        <option value="edge">줄 앞뒤 무시</option>
        <option value="all">모두 무시</option>
      </select>
    </label>
    <label class="opt"><input type="checkbox" bind:checked={opts.ignoreCase} /> 대소문자 무시</label>
    <label class="opt"><input type="checkbox" bind:checked={opts.fold} /> 같은 부분 접기</label>
    {#if json}
      <label class="opt" title="키 순서만 다른 것은 차이로 보지 않습니다"><input type="checkbox" bind:checked={opts.sortKeys} /> 키 정렬</label>
    {/if}
    {#if blank}<button class="btn sm primary" onclick={sample}>예시로 보기</button>{/if}

    <div class="right">
      {#if notice}<span class="notice" role="status">{notice}</span>{/if}
      {#if same}
        <span class="same" role="status" title={ignored ? `${ignored} 차이는 빼고 본 결과입니다` : ''}>✓ 두 내용이 같습니다</span>
      {:else if result && !solo}
        <span class="stats" aria-label="차이 요약">
          <span class="ins">추가 {result.added.toLocaleString('ko-KR')}</span>
          <span class="del">삭제 {result.removed.toLocaleString('ko-KR')}</span>
          <span class="mod">수정 {result.modified.toLocaleString('ko-KR')}</span>
        </span>
      {/if}
      {#if result && !solo}
        <span class="nav">
          <button class="btn sm" disabled={!built.blocks.length} onclick={() => go(-1)} title="이전 차이 (Alt+↑ · Shift+F7)" aria-label="이전 차이">↑</button>
          <span class="pos">{cur < 0 || cur >= built.blocks.length ? '–' : cur + 1} / {built.blocks.length.toLocaleString('ko-KR')}</span>
          <button class="btn sm" disabled={!built.blocks.length} onclick={() => go(1)} title="다음 차이 (Alt+↓ · F7)" aria-label="다음 차이">↓</button>
        </span>
        <button class="btn sm" disabled={!changes} onclick={copyPatch} title="git apply 로 적용할 수 있는 형식">{copied ? '복사됨' : '패치 복사'}</button>
        <button class="btn sm" disabled={!changes} onclick={savePatch}>.patch 저장</button>
      {/if}
    </div>
  </div>

  <div class="frame">
    <div class="heads" style:padding-right="{sbw + 14}px">
      {#each SIDES as side (side)}
        {@const err = side === 'a' ? prepared.errA : prepared.errB}
        <div class="head h{side}">
          <b>{label[side]}</b>
          {#if doc[side].name}<span class="name" title={doc[side].name}>{doc[side].name}</span>{/if}
          {#if err}
            <span class="err" title={err}>JSON 형식이 올바르지 않습니다 — {err}</span>
          {:else}
            <span class="meta">{lineCount(doc[side].text).toLocaleString('ko-KR')}줄</span>
          {/if}
          <span class="acts">
            <label class="btn sm ghost">
              파일
              <input
                type="file"
                hidden
                onchange={(e) => {
                  takeFiles(side, e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button class="btn sm ghost" disabled={!has[side]} aria-pressed={editing[side]} onmousedown={(e) => e.preventDefault()} onclick={() => toggleEditor(side)} title="글 전체를 한 번에 고칩니다. 한 줄만 고칠 때는 그 줄을 두 번 누르세요">
              {editing[side] && has[side] ? '완료' : '편집'}
            </button>
            <button class="btn sm ghost" disabled={!doc[side].text} onclick={() => saveSide(side)}>저장</button>
            <button class="btn sm ghost" disabled={!doc[side].text} onclick={() => clear(side)}>지우기</button>
          </span>
        </div>
        {#if side === 'a'}<div class="gap"></div>{/if}
      {/each}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="out"
      ondragover={(e) => {
        e.preventDefault();
        dropSide = sideAt(e);
      }}
      ondragleave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && (dropSide = null)}
      ondrop={(e) => {
        e.preventDefault();
        const s = sideAt(e);
        dropSide = null;
        takeFiles(s, e.dataTransfer?.files);
      }}
    >
      <div class="body">
        <div class="result sel-{selSide}" bind:this={scroller} onscroll={(e) => (top = e.currentTarget.scrollTop)} style:--sx={sx} tabindex="-1">
          <div class="space" style:height="{items.length * H}px">
            <div class="win" style:transform="translateY({start * H}px)">
              {#each win as it, w (start + w)}
                {#if it.k === 'fold'}
                  <button class="fold" onclick={() => expand(it.key)}>같은 내용 {it.count.toLocaleString('ko-KR')}줄 펼치기</button>
                {:else}
                  {@const r = it.row}
                  {@const blk = it.first && !solo ? built.blocks[it.block] : null}
                  <div class="r" class:cur={it.block === cur && cur >= 0} class:chg={r.changed && !solo}>
                    <span class="ln">{r.a === null ? '' : r.a + 1}</span>
                    {@render cell('a', it)}
                    <span class="gut">
                      {#if blk}
                        <button class="cp" onclick={() => copyBlock(blk, 'b')} title="이 차이를 오른쪽에 덮어씁니다" aria-label="오른쪽으로 복사">→</button>
                        <button class="cp" onclick={() => copyBlock(blk, 'a')} title="이 차이를 왼쪽에 덮어씁니다" aria-label="왼쪽으로 복사">←</button>
                      {/if}
                    </span>
                    <span class="ln">{r.b === null ? '' : r.b + 1}</span>
                    {@render cell('b', it)}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>

        <!-- 빈 쪽 · 전체 편집 중인 쪽은 그 칸 위에 입력 칸을 띄운다 -->
        <div class="ovl" style:right="{sbw}px">
          {#each SIDES as side (side)}
            <div class="slot o{side}" class:drop={dropSide === side}>
              {#if showEditor(side)}
                {@const nums = edNumbers(side)}
                <div class="ed-ln" aria-hidden="true"><div style:transform="translateY({nums.y}px)">{nums.text}</div></div>
                <textarea
                  class="field"
                  data-side={side}
                  bind:value={doc[side].text}
                  spellcheck="false"
                  autocapitalize="off"
                  aria-label={label[side]}
                  placeholder={(side === 'a' ? '원본' : '바뀐 내용') + '을 붙여넣거나 파일을 끌어다 놓으세요.\n파일 두 개를 한꺼번에 놓으면 양쪽에 들어갑니다.\n\n내용은 이 브라우저 밖으로 나가지 않습니다.'}
                  onfocus={() => {
                    remember();
                    editing[side] = true;
                  }}
                  onblur={() => {
                    if (doc[side].text.trim()) editing[side] = false;
                    flush();
                  }}
                  onkeydown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                  onscroll={(e) => (edTop[side] = e.currentTarget.scrollTop)}
                ></textarea>
              {:else if dropSide === side}
                <div class="drop-hint">여기에 놓으면 {label[side]}을 바꿉니다</div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="map" onclick={onMap} title="눌러서 그 위치로 이동">
        {#each map as c, i (i)}<i class={c}></i>{/each}
        {#if items.length * H > vh}
          <span class="view" style:top="{(top / (items.length * H)) * 100}%" style:height="{Math.max(2, (vh / (items.length * H)) * 100)}%"></span>
        {/if}
      </div>
    </div>

    <div class="hbar" class:on={maxSx > 0} style:padding-right="{sbw + 14}px">
      {#each SIDES as side, k (side)}
        <div class="hs" bind:this={hbars[k]} onscroll={(e) => (sx = e.currentTarget.scrollLeft)}>
          <div style:width="{maxW}px"></div>
        </div>
        {#if side === 'a'}<div></div>{/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .diff {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    --add: color-mix(in srgb, var(--ok) 13%, var(--surface));
    --add-hl: color-mix(in srgb, var(--ok) 36%, var(--surface));
    --rem: color-mix(in srgb, var(--bad) 11%, var(--surface));
    --rem-hl: color-mix(in srgb, var(--bad) 32%, var(--surface));
    --mod: #c77700;
    --gw: 40px;
    --cols: var(--lnw) minmax(0, 1fr) var(--gw) var(--lnw) minmax(0, 1fr);
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 10px 12px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .opt select {
    height: 28px;
    font-size: 12.5px;
    padding: 0 6px;
    color: var(--text);
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
    gap: 6px 10px;
  }
  .notice {
    font-size: 12.5px;
    color: var(--bad);
  }
  .same {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--ok);
    white-space: nowrap;
  }
  .stats {
    display: inline-flex;
    gap: 10px;
    font-size: 12.5px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stats .ins {
    color: var(--ok);
  }
  .stats .del {
    color: var(--bad);
  }
  .stats .mod {
    color: var(--mod);
  }
  .nav {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .nav .btn {
    width: 28px;
    padding: 0;
  }
  .pos {
    min-width: 54px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .frame {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: 0 12px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .heads {
    flex: none;
    display: grid;
    grid-template-columns: calc(var(--lnw) + (100% - 2 * var(--lnw) - var(--gw)) / 2) var(--gw) 1fr;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    font-size: 13px;
  }
  .heads,
  .hbar {
    box-sizing: border-box;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 36px;
    padding: 0 4px 0 10px;
  }
  .head b {
    white-space: nowrap;
  }
  .head .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
  }
  .head .meta {
    color: var(--faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .head .err {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--bad);
  }
  .acts {
    margin-left: auto;
    display: inline-flex;
    flex: none;
  }
  .gap {
    border-inline: 1px solid var(--border);
  }

  .out {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .result {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 20px;
    tab-size: 4;
    outline: none;
  }
  .space {
    position: relative;
  }
  .win {
    position: absolute;
    inset: 0 0 auto;
  }
  .r {
    display: grid;
    grid-template-columns: var(--cols);
    height: 20px;
  }
  .r.cur .gut {
    box-shadow:
      inset 2px 0 0 var(--app),
      inset -2px 0 0 var(--app);
  }
  .ln {
    padding: 0 6px 0 0;
    text-align: right;
    color: var(--faint);
    font-size: 11.5px;
    user-select: none;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }
  .gut {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border-inline: 1px solid var(--border);
    background: var(--surface-2);
    user-select: none;
  }
  .chg .gut {
    background: color-mix(in srgb, var(--mod) 14%, var(--surface-2));
  }
  .cp {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font);
    font-size: 12px;
    line-height: 18px;
  }
  .cp:hover {
    background: var(--app);
    color: #fff;
  }
  .tx {
    position: relative;
    overflow: hidden;
    padding: 0 8px;
    white-space: pre;
  }
  .tx .t {
    display: inline-block;
    transform: translateX(calc(var(--sx) * -1px));
  }
  .sel-a .tx.sb,
  .sel-b .tx.sa {
    user-select: none;
  }
  .tx.del {
    background: var(--rem);
  }
  .tx.ins {
    background: var(--add);
  }
  .tx.void {
    background: repeating-linear-gradient(-45deg, transparent 0 5px, var(--surface-2) 5px 6.5px);
  }
  .tx :global(mark) {
    color: inherit;
    border-radius: 3px;
  }
  .tx.del :global(mark) {
    background: var(--rem-hl);
  }
  .tx.ins :global(mark) {
    background: var(--add-hl);
  }
  .tx.editing {
    padding: 0;
  }
  .line-in {
    width: 100%;
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--app);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    outline: none;
  }
  .fold {
    display: block;
    width: 100%;
    height: 20px;
    padding: 0 12px;
    border: 0;
    box-shadow:
      inset 0 1px 0 var(--border),
      inset 0 -1px 0 var(--border);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font);
    font-size: 12px;
    line-height: 20px;
    text-align: center;
  }
  .fold:hover {
    background: var(--app-soft);
    color: var(--text);
  }

  .ovl {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: var(--cols);
    pointer-events: none;
  }
  .slot {
    position: relative;
    display: flex;
    min-width: 0;
  }
  .oa {
    grid-column: 1 / 3;
  }
  .ob {
    grid-column: 4 / 6;
  }
  .slot.drop {
    box-shadow: inset 0 0 0 2px var(--app);
    background: color-mix(in srgb, var(--app) 6%, transparent);
  }
  .ed-ln {
    pointer-events: auto;
    flex: none;
    width: var(--lnw);
    overflow: hidden;
    background: var(--surface);
    color: var(--faint);
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 20px;
    text-align: right;
    white-space: pre;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .ed-ln > div {
    padding-right: 6px;
  }
  .slot textarea {
    padding: 0 8px;
    pointer-events: auto;
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
    resize: none;
    background: var(--surface);
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 20px;
    tab-size: 4;
    white-space: pre;
    overflow: auto;
    outline-offset: -2px;
  }
  .drop-hint {
    margin: auto;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--app);
    color: #fff;
    font-size: 13px;
  }

  .hbar {
    flex: none;
    display: grid;
    grid-template-columns: calc(var(--lnw) + (100% - 2 * var(--lnw) - var(--gw)) / 2) var(--gw) 1fr;
    height: 0;
    overflow: hidden;
  }
  .hbar.on {
    height: 12px;
    border-top: 1px solid var(--border);
  }
  .hs {
    margin-left: var(--lnw);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .hs > div {
    height: 1px;
  }
  .hs::-webkit-scrollbar {
    height: 10px;
  }
  .hs::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 5px;
  }

  .map {
    position: relative;
    flex: none;
    width: 14px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    background: var(--surface-2);
    cursor: pointer;
  }
  .map i {
    flex: 1;
    min-height: 0;
  }
  .map .ins {
    background: var(--ok);
  }
  .map .del {
    background: var(--bad);
  }
  .map .mod {
    background: var(--mod);
  }
  .map .view {
    position: absolute;
    inset-inline: 0;
    border: 1px solid var(--muted);
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    pointer-events: none;
  }

  @media (max-width: 760px) {
    .diff {
      --gw: 26px;
    }
    .bar {
      padding: 8px;
    }
    .right {
      margin-left: 0;
    }
    .frame {
      margin: 0 8px 8px;
    }
    .head .name,
    .head .meta,
    .head b {
      display: none;
    }
    .head {
      padding-left: 2px;
    }
    .acts {
      margin-left: 0;
      flex-wrap: wrap;
    }
    .cp {
      width: 12px;
      font-size: 11px;
    }
    .result,
    .slot textarea {
      font-size: 11.5px;
    }
  }
</style>

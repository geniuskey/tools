<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { load, save } from '$lib/storage';
  import { downloadBlob, timestamp } from '$lib/download';
  import { diffLines, normalizeJson, unifiedPatch, type Row, type Seg, type WsMode } from './core';
  import { sampleJson, sampleText } from './samples';

  let { json = false, active = true }: { json?: boolean; active?: boolean } = $props();

  type Side = 'a' | 'b';
  const KEY = 'tools:diff:v1';
  const CONTEXT = 3;
  const PAGE = 1500;
  const MAX_FILE = 40 * 1024 * 1024;
  const label = { a: '원본', b: '바뀐 내용' };

  let doc = $state({ a: { text: '', name: '' }, b: { text: '', name: '' } });
  let opts = $state({ view: 'split' as 'split' | 'unified', ws: 'none' as WsMode, ignoreCase: false, fold: true, sortKeys: true });
  let inputOpen = $state(true);
  let narrow = $state(false);
  let ready = false;
  let notice = $state('');
  let copied = $state(false);
  let dragging = $state<Side | null>(null);

  // 입력이 멈춘 뒤에 비교한다
  let src = $state.raw({ a: '', b: '' });
  $effect(() => {
    const a = doc.a.text;
    const b = doc.b.text;
    const t = setTimeout(() => (src = { a, b }), a.length + b.length > 300_000 ? 300 : 100);
    return () => clearTimeout(t);
  });

  const prepared = $derived.by(() => {
    if (!json) return { a: src.a, b: src.b, errA: '', errB: '' };
    const a = normalizeJson(src.a, opts.sortKeys);
    const b = normalizeJson(src.b, opts.sortKeys);
    return { a: a.ok ? a.text : '', b: b.ok ? b.text : '', errA: a.ok ? '' : a.error, errB: b.ok ? '' : b.error };
  });
  const blank = $derived(!src.a && !src.b);
  const result = $derived(blank || prepared.errA || prepared.errB ? null : diffLines(prepared.a, prepared.b, { ws: opts.ws, ignoreCase: opts.ignoreCase }));
  const changes = $derived(result ? result.added + result.removed + result.modified : 0);
  const view = $derived(narrow ? 'unified' : opts.view);

  type Item =
    | { k: 'fold'; key: number; count: number }
    | { k: 'row'; row: Row; block: number; first: boolean }
    | { k: 'line'; sign: ' ' | '-' | '+'; a: number | null; b: number | null; text: string; segs?: Seg[]; block: number; first: boolean };

  let expanded = $state.raw(new Set<number>());
  let limit = $state(PAGE);
  let cur = $state(-1);

  $effect(() => {
    result;
    expanded = new Set();
    limit = PAGE;
    cur = -1;
  });

  const built = $derived.by(() => {
    const items: Item[] = [];
    if (!result) return { items, blocks: 0 };
    const { rows, linesA, linesB } = result;
    const unified = view === 'unified';
    const same = (r: Row) => {
      if (unified) items.push({ k: 'line', sign: ' ', a: r.a, b: r.b, text: linesB[r.b!], block: -1, first: false });
      else items.push({ k: 'row', row: r, block: -1, first: false });
    };
    let block = 0;
    let i = 0;
    while (i < rows.length) {
      let e = i;
      if (!rows[i].changed) {
        while (e < rows.length && !rows[e].changed) e++;
        const head = i === 0 ? 0 : CONTEXT;
        const tail = e === rows.length ? 0 : CONTEXT;
        if (opts.fold && e - i > head + tail + 1 && !expanded.has(i)) {
          for (let r = i; r < i + head; r++) same(rows[r]);
          items.push({ k: 'fold', key: i, count: e - i - head - tail });
          for (let r = e - tail; r < e; r++) same(rows[r]);
        } else {
          for (let r = i; r < e; r++) same(rows[r]);
        }
      } else {
        while (e < rows.length && rows[e].changed) e++;
        const at = items.length;
        if (unified) {
          for (let r = i; r < e; r++) {
            const x = rows[r];
            if (x.a !== null) items.push({ k: 'line', sign: '-', a: x.a, b: null, text: linesA[x.a], segs: x.segA, block, first: false });
          }
          for (let r = i; r < e; r++) {
            const x = rows[r];
            if (x.b !== null) items.push({ k: 'line', sign: '+', a: null, b: x.b, text: linesB[x.b], segs: x.segB, block, first: false });
          }
        } else {
          for (let r = i; r < e; r++) items.push({ k: 'row', row: rows[r], block, first: false });
        }
        (items[at] as { first: boolean }).first = true;
        block++;
      }
      i = e;
    }
    return { items, blocks: block };
  });
  const items = $derived(built.items);
  const shown = $derived(items.length > limit ? items.slice(0, limit) : items);
  const lnw = $derived(`${String(Math.max(result?.linesA.length ?? 0, result?.linesB.length ?? 0, 10)).length + 1.5}ch`);

  // 스크롤 옆 지도: 전체에서 바뀐 곳이 어디쯤인지
  const map = $derived.by(() => {
    const n = Math.min(items.length, 220);
    const cells = new Array<string>(n).fill('');
    if (!changes) return cells;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let kind = '';
      if (it.k === 'row' && it.row.changed) kind = it.row.a === null ? 'ins' : it.row.b === null ? 'del' : 'mod';
      else if (it.k === 'line' && it.sign !== ' ') kind = it.sign === '+' ? 'ins' : 'del';
      if (!kind) continue;
      const c = Math.floor((i / items.length) * n);
      cells[c] = cells[c] && cells[c] !== kind ? 'mod' : kind;
    }
    return cells;
  });

  let scroller = $state<HTMLElement>();
  let sentinel = $state<HTMLElement>();

  $effect(() => {
    if (!sentinel || !scroller) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (limit += PAGE), { root: scroller, rootMargin: '600px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  async function reveal(index: number) {
    if (index >= limit) limit = index + 300;
    await tick();
    scroller?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'center' });
  }

  function go(delta: number) {
    if (!built.blocks) return;
    cur = cur < 0 ? (delta > 0 ? 0 : built.blocks - 1) : (cur + delta + built.blocks) % built.blocks;
    reveal(items.findIndex((it) => it.k !== 'fold' && it.first && it.block === cur));
  }

  function onMap(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    reveal(Math.min(items.length - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * items.length))));
  }

  function expand(key: number) {
    expanded = new Set(expanded).add(key);
  }

  async function readFile(side: Side, f: File) {
    if (f.size > MAX_FILE) return flash(`${f.name}: 파일이 너무 큽니다 (최대 40MB)`);
    const text = await f.text();
    if (text.slice(0, 4000).includes('\u0000')) return flash(`${f.name}: 텍스트 파일이 아닙니다`);
    doc[side] = { text, name: f.name };
  }

  // 파일 두 개를 한꺼번에 놓으면 왼쪽 · 오른쪽에 차례로 넣는다
  function takeFiles(side: Side, files: FileList | null | undefined) {
    if (!files?.length) return;
    if (files.length >= 2) {
      readFile('a', files[0]);
      readFile('b', files[1]);
    } else readFile(side, files[0]);
  }

  function flash(msg: string) {
    notice = msg;
    setTimeout(() => notice === msg && (notice = ''), 4000);
  }

  function swap() {
    doc = { a: doc.b, b: doc.a };
  }
  function sample() {
    const s = json ? sampleJson : sampleText;
    doc = { a: { text: s.a, name: '' }, b: { text: s.b, name: '' } };
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
    const down = (e.altKey && e.key === 'ArrowDown') || (e.key === 'F7' && !e.shiftKey);
    const up = (e.altKey && e.key === 'ArrowUp') || (e.key === 'F7' && e.shiftKey);
    if (!down && !up) return;
    e.preventDefault();
    go(down ? 1 : -1);
  }

  const lineCount = (t: string) => (t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0);

  onMount(() => {
    opts = { ...opts, ...load(KEY, {}) };
    ready = true;
    const mq = matchMedia('(max-width: 760px)');
    const on = () => (narrow = mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  $effect(() => {
    const snap = $state.snapshot(opts);
    if (ready) save(KEY, snap);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet tx(segs: Seg[] | undefined, text: string)}{#if segs}{#each segs as g, i (i)}{#if g.changed}<mark>{g.text}</mark>{:else}{g.text}{/if}{/each}{:else}{text}{/if}{/snippet}

{#snippet pane(side: Side)}
  {@const err = side === 'a' ? prepared.errA : prepared.errB}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="in"
    class:dragging={dragging === side}
    ondragover={(e) => {
      e.preventDefault();
      dragging = side;
    }}
    ondragleave={() => (dragging = null)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = null;
      takeFiles(side, e.dataTransfer?.files);
    }}
  >
    <div class="in-head">
      <b>{label[side]}</b>
      {#if doc[side].name}<span class="name" title={doc[side].name}>{doc[side].name}</span>{/if}
      <span class="meta">{lineCount(doc[side].text).toLocaleString('ko-KR')}줄</span>
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
      <button class="btn sm ghost" disabled={!doc[side].text} onclick={() => (doc[side] = { text: '', name: '' })}>지우기</button>
    </div>
    <textarea
      class="field"
      bind:value={doc[side].text}
      spellcheck="false"
      autocapitalize="off"
      aria-label={label[side]}
      placeholder={side === 'a' ? '원본을 붙여넣거나 파일을 끌어다 놓으세요' : '바뀐 내용을 붙여넣거나 파일을 끌어다 놓으세요'}
    ></textarea>
    {#if err}<p class="err">JSON 을 읽을 수 없습니다 — {err}</p>{/if}
  </div>
{/snippet}

<div class="diff">
  {#if inputOpen}
    <section class="inputs" aria-label="비교할 내용">
      {@render pane('a')}
      {@render pane('b')}
    </section>
  {/if}

  <div class="bar">
    <button class="btn sm" onclick={() => (inputOpen = !inputOpen)} aria-expanded={inputOpen} title="입력 칸을 접어 결과를 넓게 봅니다">
      입력 {inputOpen ? '접기' : '펴기'}
    </button>
    <button class="btn sm" onclick={swap} disabled={blank} title="왼쪽과 오른쪽을 바꿉니다">⇄ 바꾸기</button>
    {#if !narrow}
      <div class="seg" role="group" aria-label="보기 방식">
        <button aria-pressed={opts.view === 'split'} onclick={() => (opts.view = 'split')}>나란히</button>
        <button aria-pressed={opts.view === 'unified'} onclick={() => (opts.view = 'unified')}>한 줄로</button>
      </div>
    {/if}
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

    <div class="right">
      {#if notice}<span class="notice" role="status">{notice}</span>{/if}
      {#if result}
        <span class="stats" aria-label="차이 요약">
          <span class="ins">추가 {result.added.toLocaleString('ko-KR')}</span>
          <span class="del">삭제 {result.removed.toLocaleString('ko-KR')}</span>
          <span class="mod">수정 {result.modified.toLocaleString('ko-KR')}</span>
        </span>
        <span class="nav">
          <button class="btn sm" disabled={!built.blocks} onclick={() => go(-1)} title="이전 차이 (Alt+↑ · Shift+F7)" aria-label="이전 차이">↑</button>
          <span class="pos">{cur < 0 ? '–' : cur + 1} / {built.blocks.toLocaleString('ko-KR')}</span>
          <button class="btn sm" disabled={!built.blocks} onclick={() => go(1)} title="다음 차이 (Alt+↓ · F7)" aria-label="다음 차이">↓</button>
        </span>
        <button class="btn sm" disabled={!changes} onclick={copyPatch} title="git apply 로 적용할 수 있는 형식">{copied ? '복사됨' : '패치 복사'}</button>
        <button class="btn sm" disabled={!changes} onclick={savePatch}>.patch 저장</button>
      {/if}
    </div>
  </div>

  {#if blank}
    <div class="empty">
      <h2>{json ? '두 JSON 을 비교합니다' : '두 글을 비교합니다'}</h2>
      <p>
        {#if json}
          들여쓰기와 키 순서는 맞춘 뒤, 실제로 달라진 값만 보여 줍니다.
        {:else}
          달라진 줄을 찾고, 그 안에서 바뀐 단어까지 표시합니다. 파일 두 개를 한꺼번에 끌어다 놓아도 됩니다.
        {/if}
        <br />내용은 이 브라우저 밖으로 나가지 않습니다.
      </p>
      <button class="btn primary" onclick={sample}>예시로 보기</button>
    </div>
  {:else if !result}
    <div class="empty">
      <h2>JSON 형식이 올바르지 않습니다</h2>
      <p>위 입력 칸의 오류를 고치면 바로 비교합니다. 형식을 따지지 않으려면 텍스트 모드를 쓰세요.</p>
    </div>
  {:else if !changes}
    <div class="empty same">
      <div class="check" aria-hidden="true">✓</div>
      <h2>두 내용이 같습니다</h2>
      <p>
        {result.linesA.length.toLocaleString('ko-KR')}줄을 비교했습니다.
        {#if opts.ws !== 'none' || opts.ignoreCase || (json && opts.sortKeys)}무시하도록 설정한 차이({[opts.ws !== 'none' && '공백', opts.ignoreCase && '대소문자', json && opts.sortKeys && '키 순서'].filter(Boolean).join(' · ')})는 빼고 본 결과입니다.{/if}
      </p>
    </div>
  {:else}
    <div class="out">
      <div class="result" class:unified={view === 'unified'} bind:this={scroller} style:--lnw={lnw} tabindex="-1">
        {#if view === 'split'}
          <div class="cols" aria-hidden="true"><span>{doc.a.name || label.a}</span><span>{doc.b.name || label.b}</span></div>
        {/if}
        {#each shown as it, i (i)}
          {#if it.k === 'fold'}
            <button class="fold" data-i={i} onclick={() => expand(it.key)}>같은 내용 {it.count.toLocaleString('ko-KR')}줄 펼치기</button>
          {:else if it.k === 'row'}
            {@const r = it.row}
            <div class="r" class:cur={it.block === cur && cur >= 0} data-i={i}>
              <span class="ln">{r.a === null ? '' : r.a + 1}</span>
              <span class="tx" class:del={r.changed && r.a !== null} class:void={r.a === null}>{#if r.a !== null}{@render tx(r.segA, result.linesA[r.a])}{/if}</span>
              <span class="ln">{r.b === null ? '' : r.b + 1}</span>
              <span class="tx" class:ins={r.changed && r.b !== null} class:void={r.b === null}>{#if r.b !== null}{@render tx(r.segB, result.linesB[r.b])}{/if}</span>
            </div>
          {:else}
            <div class="r" class:cur={it.block === cur && cur >= 0} data-i={i}>
              <span class="ln">{it.a === null ? '' : it.a + 1}</span>
              <span class="ln">{it.b === null ? '' : it.b + 1}</span>
              <span class="tx" class:del={it.sign === '-'} class:ins={it.sign === '+'}><span class="sign">{it.sign}</span>{@render tx(it.segs, it.text)}</span>
            </div>
          {/if}
        {/each}
        {#if items.length > limit}<div class="more" bind:this={sentinel}>불러오는 중…</div>{/if}
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="map" onclick={onMap} title="눌러서 그 위치로 이동">
        {#each map as c, i (i)}<i class={c}></i>{/each}
      </div>
    </div>
  {/if}
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
  }

  .inputs {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 10px 12px 0;
    height: clamp(150px, 32vh, 320px);
  }
  .in {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .in.dragging {
    border-color: var(--app);
    box-shadow: 0 0 0 3px var(--app-soft);
  }
  .in-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .in-head b {
    white-space: nowrap;
  }
  .in-head .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
  }
  .in-head .meta {
    margin-left: auto;
    color: var(--faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .in textarea {
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
    resize: none;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
    tab-size: 4;
    white-space: pre;
    overflow: auto;
    outline-offset: -2px;
  }
  .err {
    flex: none;
    padding: 5px 12px;
    font-size: 12px;
    color: var(--bad);
    background: var(--rem);
    border-top: 1px solid var(--border);
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

  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
  }
  .empty h2 {
    font-size: 18px;
    letter-spacing: -0.02em;
  }
  .empty p {
    max-width: 440px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.7;
  }
  .empty .btn {
    margin-top: 6px;
  }
  .check {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--add);
    color: var(--ok);
    font-size: 22px;
    font-weight: 700;
  }

  .out {
    flex: 1;
    min-height: 0;
    display: flex;
    margin: 0 12px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .result {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.6;
    tab-size: 4;
    outline: none;
  }
  .cols {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    font-family: var(--font);
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .cols span {
    padding: 4px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cols span + span {
    border-left: 1px solid var(--border);
  }
  .r {
    display: grid;
    grid-template-columns: var(--lnw) minmax(0, 1fr) var(--lnw) minmax(0, 1fr);
  }
  .unified .r {
    grid-template-columns: var(--lnw) var(--lnw) minmax(0, 1fr);
  }
  .r.cur {
    box-shadow: inset 3px 0 0 var(--app);
  }
  .ln {
    padding: 0 6px 0 0;
    text-align: right;
    color: var(--faint);
    font-size: 11.5px;
    line-height: 1.74;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .r > .tx + .ln {
    border-left: 1px solid var(--border);
  }
  .tx {
    min-height: 1.6em;
    padding: 0 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
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
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .tx.del :global(mark) {
    background: var(--rem-hl);
  }
  .tx.ins :global(mark) {
    background: var(--add-hl);
  }
  .sign {
    display: inline-block;
    width: 1.6ch;
    color: var(--faint);
    user-select: none;
  }
  .fold {
    display: block;
    width: 100%;
    padding: 3px 12px;
    border: 0;
    border-block: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font);
    font-size: 12px;
    text-align: center;
  }
  .fold:hover {
    background: var(--app-soft);
    color: var(--text);
  }
  .more {
    padding: 14px;
    text-align: center;
    color: var(--faint);
    font-family: var(--font);
  }

  .map {
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

  @media (max-width: 760px) {
    .inputs {
      height: clamp(180px, 36vh, 300px);
      gap: 6px;
      padding: 8px 8px 0;
    }
    .in-head .name,
    .in-head .meta {
      display: none;
    }
    .in-head label {
      margin-left: auto;
    }
    .bar {
      padding: 8px;
    }
    .right {
      margin-left: 0;
    }
    .out {
      margin: 0 8px 8px;
    }
    .result {
      font-size: 12px;
    }
  }
</style>

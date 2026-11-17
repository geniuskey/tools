<script lang="ts">
  // 바로 고치는 표. 칸을 눌러 적고, 열 · 줄 머리를 눌러 정렬 · 옮기기 · 넣기 · 지우기.
  import { coveredMap, width, type Align, type Grid } from './grid';

  type ColAction = 'align-auto' | 'align-left' | 'align-center' | 'align-right' | 'sort-asc' | 'sort-desc' | 'move-left' | 'move-right' | 'insert-left' | 'insert-right' | 'merge-same' | 'delete';
  type RowAction = 'insert-above' | 'insert-below' | 'move-up' | 'move-down' | 'delete';

  let {
    grid,
    header,
    aligns,
    shown,
    oncell,
    onbegin,
    oncol,
    onrow,
    onspread,
  }: {
    grid: Grid;
    header: boolean;
    /** 실제로 적용되는 정렬 (auto 를 푼 것) 과 사용자가 고른 것 */
    aligns: { set: Align; side: 'left' | 'center' | 'right' }[];
    shown: number;
    oncell: (r: number, c: number, text: string) => void;
    /** 칸 하나를 고치기 시작할 때 (되돌리기용) */
    onbegin: () => void;
    oncol: (c: number, a: ColAction) => void;
    onrow: (r: number, a: RowAction) => void;
    /** 칸에 여러 칸짜리 표를 붙여넣었을 때 */
    onspread: (r: number, c: number, text: string, html: string) => boolean;
  } = $props();

  const w = $derived(width(grid));
  const covered = $derived(coveredMap(grid));
  const spans = $derived(new Map(grid.merges.map((m) => [`${m.r},${m.c}`, m])));
  const rows = $derived(grid.rows.slice(0, shown));

  const letter = (c: number) => {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  // 칸 글: 고치는 중인 칸은 건드리지 않는다 (커서가 튀지 않게)
  function text(el: HTMLElement, v: string) {
    el.textContent = v;
    return {
      update(next: string) {
        if (document.activeElement !== el && el.textContent !== next) el.textContent = next;
      },
    };
  }
  const read = (el: HTMLElement) => el.innerText.replace(/\n$/, '');

  let editing: string | null = null;
  function focusCell(r: number, c: number) {
    const el = document.querySelector<HTMLElement>(`[data-cell="${r},${c}"]`);
    if (!el) return;
    el.focus();
    const sel = getSelection();
    sel?.selectAllChildren(el);
    sel?.collapseToEnd();
  }
  function onfocus(r: number, c: number) {
    const key = `${r},${c}`;
    if (editing !== key) onbegin();
    editing = key;
  }
  function onkey(e: KeyboardEvent, r: number, c: number) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      let next = r + 1;
      while (next < rows.length && covered[next]?.[c]) next++;
      if (next < rows.length) focusCell(next, c);
      else (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  }
  function onpaste(e: ClipboardEvent, r: number, c: number) {
    const t = e.clipboardData?.getData('text/plain') ?? '';
    const h = e.clipboardData?.getData('text/html') ?? '';
    if ((/[\t\n]/.test(t.replace(/\n$/, '')) || /<t[dr]\b/i.test(h)) && onspread(r, c, t, h)) {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
    }
  }

  // ── 메뉴 ──
  let menu = $state<{ kind: 'col' | 'row'; i: number; x: number; y: number } | null>(null);
  function open(e: MouseEvent, kind: 'col' | 'row', i: number) {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu?.kind === kind && menu.i === i ? null : { kind, i, x: Math.min(b.left, innerWidth - 230), y: b.bottom + 4 };
  }
  function close(e: MouseEvent) {
    if (menu && !(e.target as Element).closest('.menu, .handle')) menu = null;
  }
  const col = (a: ColAction) => {
    if (menu) oncol(menu.i, a);
    menu = null;
  };
  const row = (a: RowAction) => {
    if (menu) onrow(menu.i, a);
    menu = null;
  };
  const ALIGN_ICON = { left: '⇤', center: '↔', right: '⇥' };
</script>

<svelte:window onclick={close} onkeydown={(e) => e.key === 'Escape' && (menu = null)} onscroll={() => (menu = null)} />

<div class="wrap" onscroll={() => (menu = null)}>
  <table class="grid" class:head={header}>
    <thead>
      <tr>
        <th class="corner"></th>
        {#each Array(w) as _, c (c)}
          <th class="colh">
            <button class="handle" aria-label="{letter(c)}열 메뉴" aria-expanded={menu?.kind === 'col' && menu.i === c} onclick={(e) => open(e, 'col', c)}>
              <span>{letter(c)}</span>
              <i class:set={aligns[c]?.set !== 'auto'} title="정렬">{ALIGN_ICON[aligns[c]?.side ?? 'left']}</i>
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as cells, r (r)}
        <tr class:hrow={header && r === 0}>
          <th class="rowh">
            <button class="handle" aria-label="{r + 1}번째 줄 메뉴" aria-expanded={menu?.kind === 'row' && menu.i === r} onclick={(e) => open(e, 'row', r)}>{header && r === 0 ? '머리' : header ? r : r + 1}</button>
          </th>
          {#each cells as v, c (c)}
            {#if !covered[r]?.[c]}
              {@const m = spans.get(`${r},${c}`)}
              <td
                rowspan={m && m.rs > 1 ? Math.min(m.rs, rows.length - r) : undefined}
                colspan={m && m.cs > 1 ? m.cs : undefined}
                class:merged={!!m}
                style:text-align={aligns[c]?.side ?? 'left'}
                data-cell="{r},{c}"
                contenteditable="plaintext-only"
                role="textbox"
                tabindex="0"
                aria-label="{letter(c)}{r + 1}"
                spellcheck="false"
                use:text={v}
                onfocus={() => onfocus(r, c)}
                onblur={() => (editing = null)}
                oninput={(e) => oncell(r, c, read(e.currentTarget))}
                onkeydown={(e) => onkey(e, r, c)}
                onpaste={(e) => onpaste(e, r, c)}
              ></td>
            {/if}
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if menu}
  <div class="menu" role="menu" style:left="{menu.x}px" style:top="{menu.y}px">
    {#if menu.kind === 'col'}
      {@const a = aligns[menu.i]?.set ?? 'auto'}
      <div class="aligns" role="group" aria-label="정렬">
        {#each [['auto', '자동'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as const as [id, name] (id)}
          <button role="menuitemradio" aria-checked={a === id} onclick={() => col(`align-${id}`)}>{name}</button>
        {/each}
      </div>
      <button role="menuitem" onclick={() => col('sort-asc')}>오름차순 정렬 <small>ㄱ→ㅎ · 1→9</small></button>
      <button role="menuitem" onclick={() => col('sort-desc')}>내림차순 정렬</button>
      <hr />
      <button role="menuitem" disabled={menu.i === 0} onclick={() => col('move-left')}>왼쪽으로 옮기기</button>
      <button role="menuitem" disabled={menu.i === w - 1} onclick={() => col('move-right')}>오른쪽으로 옮기기</button>
      <button role="menuitem" onclick={() => col('insert-left')}>왼쪽에 열 넣기</button>
      <button role="menuitem" onclick={() => col('insert-right')}>오른쪽에 열 넣기</button>
      <button role="menuitem" onclick={() => col('merge-same')}>위아래 같은 값 합치기</button>
      <hr />
      <button role="menuitem" class="danger" disabled={w <= 1} onclick={() => col('delete')}>열 지우기</button>
    {:else}
      <button role="menuitem" onclick={() => row('insert-above')}>위에 줄 넣기</button>
      <button role="menuitem" onclick={() => row('insert-below')}>아래에 줄 넣기</button>
      <button role="menuitem" disabled={menu.i === 0} onclick={() => row('move-up')}>위로 옮기기</button>
      <button role="menuitem" disabled={menu.i === grid.rows.length - 1} onclick={() => row('move-down')}>아래로 옮기기</button>
      <hr />
      <button role="menuitem" class="danger" disabled={grid.rows.length <= 1} onclick={() => row('delete')}>줄 지우기</button>
    {/if}
  </div>
{/if}

<style>
  .wrap {
    overflow: auto;
    max-height: min(62vh, 640px);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .grid {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
    min-width: 100%;
  }
  .grid th,
  .grid td {
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-2);
  }
  .corner {
    left: 0;
    z-index: 3;
    width: 44px;
  }
  .rowh {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface-2);
    width: 44px;
  }
  .handle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 26px;
    padding: 0 8px;
    border: 0;
    background: none;
    font-size: 11.5px;
    font-weight: 650;
    color: var(--faint);
    white-space: nowrap;
  }
  .handle:hover,
  .handle[aria-expanded='true'] {
    background: var(--app-soft);
    color: var(--text);
  }
  .handle i {
    font-style: normal;
    font-size: 11px;
    opacity: 0.55;
  }
  .handle i.set {
    opacity: 1;
    color: var(--app);
  }
  .rowh .handle {
    min-height: 32px;
    font-variant-numeric: tabular-nums;
  }
  td {
    min-width: 72px;
    max-width: 360px;
    padding: 6px 9px;
    vertical-align: top;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
    outline: none;
    font-variant-numeric: tabular-nums;
  }
  td:focus {
    box-shadow: inset 0 0 0 2px var(--app);
    background: var(--surface);
  }
  td.merged {
    background: color-mix(in srgb, var(--app) 5%, var(--surface));
  }
  .head .hrow td {
    font-weight: 700;
    background: var(--app-soft);
  }
  .menu {
    position: fixed;
    z-index: 50;
    display: grid;
    min-width: 210px;
    padding: 5px;
    border: 1px solid var(--border-strong);
    border-radius: 11px;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }
  .menu > button {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 10px;
    border: 0;
    border-radius: 7px;
    background: none;
    text-align: left;
    font-size: 13px;
  }
  .menu > button:hover:not(:disabled) {
    background: var(--app-soft);
  }
  .menu > button:disabled {
    opacity: 0.4;
  }
  .menu small {
    color: var(--faint);
    font-size: 11.5px;
  }
  .menu .danger {
    color: var(--bad);
  }
  .menu hr {
    margin: 4px 2px;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .aligns {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 2px 2px 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .aligns button {
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .aligns button[aria-checked='true'] {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
</style>

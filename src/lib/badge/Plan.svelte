<script lang="ts">
  // 배치도. 테이블(모둠)은 끌어서 옮길 수 있고, 프로젝터에 띄울 수 있게 전체 화면으로도 보여 준다.
  // 오른쪽 클릭(또는 Shift+F10)으로 자리 · 책상 · 테이블을 막거나 치운다.
  import { onMount, tick } from 'svelte';
  import {
    AISLE, POD_CAPTION, SEAT_GAP, SEAT_H, SEAT_W, gridPlace, groupHue, groupOf, offKey, planSize, podPlan, ringRadius, seatGroups, slotOf, tableBox,
    type Point, type SeatOff, type SeatRef, type SeatTable, type Shape,
  } from './core';

  export type OffChange = [key: string, value: SeatOff | 'removed' | null];

  export interface Layout {
    /** 이 자리를 잡을 때의 배치도 너비 */
    w: number;
    at: Point[];
  }

  let {
    tables = $bindable(),
    shape,
    vertical = false,
    cols = 1,
    block = 0,
    layout = $bindable(),
    colorBy = false,
    title = '',
    picked = null,
    onpick,
    onswap,
    holes = [],
    onoff,
  }: {
    tables: SeatTable[];
    shape: Shape;
    /** 긴 탁자를 세로로 */
    vertical?: boolean;
    /** 테이블을 놓는 열 수 (앞에서부터 행을 채운다) */
    cols?: number;
    /** 줄 맞춤: 몇 자리마다 통로를 둘까 (0 이면 통로 없이) */
    block?: number;
    /** 손으로 옮긴 자리. null 이면 알아서 늘어놓는다 */
    layout: Layout | null;
    /** 소속마다 색으로 */
    colorBy?: boolean;
    title?: string;
    picked?: SeatRef | null;
    onpick: (table: number, seat: number) => void;
    /** 사람을 끌어 다른 자리에 놓았을 때 */
    onswap: (from: SeatRef, to: SeatRef) => void;
    /** 치운 테이블(줄)의 격자 칸. 자리에 점선으로 두고 누르면 되돌린다 */
    holes?: number[];
    /** 막기 · 치우기 · 되돌리기 */
    onoff?: (changes: OffChange[]) => void;
  } = $props();

  const FRONT_H = 30;
  const TOP = FRONT_H + 24;
  const ROW_LABEL = 72;

  let box = $state<HTMLElement>();
  let availW = $state(0);
  let availH = $state(0);
  let full = $state(false);

  const boxes = $derived(tables.map((t) => tableBox(shape, t.seats.length, vertical)));
  const widest = $derived(Math.max(0, ...boxes.map((b) => b.w)));
  const holeBox = $derived(boxes[0] ?? { w: 120, h: 80 });
  const moved = $derived(shape !== 'rows' && layout != null && layout.at.length === tables.length);
  // 치운 칸은 손으로 옮기지 않았을 때만 제자리에 점선으로
  const shownHoles = $derived(moved || full ? [] : holes);
  // 칠판이 너무 짧아 보이지 않게 배치도는 이 정도 너비는 둔다
  const grid = $derived(gridPlace([...boxes, ...shownHoles.map(() => holeBox)], cols, 420, 28, 30, TOP, [...tables.map(slotOf), ...shownHoles]));
  const baseW = $derived(moved ? Math.max(layout!.w, widest) : grid.w);
  const at = $derived(moved ? layout!.at : grid.at);
  const holeAt = $derived(grid.at.slice(tables.length));
  const aisles = (n: number) => (block > 0 ? Math.ceil(n / block) - 1 : 0);
  const aisleAt = (si: number) => block > 0 && si > 0 && si % block === 0;
  const rowTop = (slot: number) => TOP + slot * (SEAT_H + SEAT_GAP);
  const lineW = $derived((boxes[0]?.w ?? 0) + aisles(tables[0]?.seats.length ?? 0) * AISLE);
  const size = $derived.by(() => {
    if (shape === 'rows') return { w: ROW_LABEL + lineW, h: rowTop(Math.max(tables.length, ...tables.map((t, i) => slotOf(t, i) + 1), ...shownHoles.map((h) => h + 1))) };
    const s = planSize([...boxes, ...shownHoles.map(() => holeBox)], [...at, ...holeAt], baseW);
    return { w: s.w, h: s.h + 8 };
  });
  // 보통은 줄이기만 하고, 전체 화면에서는 화면에 꽉 차게 키운다
  const scale = $derived(!availW ? 1 : full ? Math.max(0.2, Math.min(3, availW / size.w, availH / size.h)) : Math.min(1, availW / size.w));
  const printScale = $derived(Math.min(1, 690 / size.w));

  const groups = $derived(colorBy ? seatGroups(tables) : []);
  const hueOf = $derived(new Map(groups.map((g, i) => [g.name, groupHue(i)])));
  const tint = (t: SeatTable, s: number) => {
    const h = hueOf.get(groupOf(t.seats[s]));
    return h == null ? null : `hsl(${h} 62% 46%)`;
  };
  const isPicked = (t: number, s: number) => picked != null && picked[0] === t && picked[1] === s;
  const offOf = (t: SeatTable, s: number) => t.off?.[s] ?? null;
  const seatLabel = (t: SeatTable, s: number) => `${t.name} ${s + 1}번 자리: ${offOf(t, s) ? '앉지 못함' : (t.seats[s]?.name ?? '빈 자리')}`;
  const unit = $derived(({ round: '테이블', long: '탁자', pod: '모둠', rows: '줄' } as const)[shape]);
  const around = (i: number, n: number, r: number) => {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    // 이름이 가로로 길어 좌우를 조금 더 벌린다
    return { x: Math.cos(a) * (r + 14), y: Math.sin(a) * r };
  };
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  /** 한 줄의 자리를 2인 책상 단위로 묶는다 */
  const desks = (seats: number[]) => seats.reduce<number[][]>((out, s, i) => (i % 2 ? out[out.length - 1].push(s) : out.push([s]), out), []);
  /** 이 자리가 놓인 책상의 자리들 (모둠 책상 · 줄 맞춤의 책상 묶음). 책상이 없는 모양이면 null */
  function deskOf(t: SeatTable, si: number): number[] | null {
    const n = t.seats.length;
    if (shape === 'pod') {
      const p = podPlan(n);
      const all = [...desks(range(0, p.row)), ...desks(range(p.row, n - p.side)), ...(p.side ? [range(n - p.side, n)] : [])];
      return all.find((d) => d.includes(si)) ?? null;
    }
    if (shape === 'rows' && block > 1) {
      const from = Math.floor(si / block) * block;
      return range(from, Math.min(n, from + block));
    }
    return null;
  }

  // ── 오른쪽 클릭 메뉴 ──
  interface MenuItem {
    label: string;
    act: () => void;
    disabled?: boolean;
  }
  let menu = $state<{ x: number; y: number; title: string; groups: MenuItem[][] } | null>(null);
  let menuEl = $state<HTMLElement>();
  function menuFor(ti: number, si: number | null, desk: number[] | null) {
    const t = tables[ti];
    const slot = slotOf(t, ti);
    const all = range(0, t.seats.length);
    const set = (seats: number[], v: SeatOff | null) => () => onoff?.(seats.map((s) => [offKey(slot, s), v]));
    const groups: MenuItem[][] = [];
    if (si != null && offOf(t, si) !== 'gone') {
      groups.push([
        offOf(t, si) === 'closed' ? { label: '이 자리 다시 쓰기', act: set([si], null) } : { label: '이 자리 앉지 못하게', act: set([si], 'closed') },
        { label: '이 자리 치우기', act: set([si], 'gone') },
      ]);
    }
    if (desk && desk.length > 1) {
      const closed = desk.every((s) => offOf(t, s) === 'closed');
      groups.push([
        closed ? { label: '이 책상 다시 쓰기', act: set(desk, null) } : { label: '이 책상 앉지 못하게', act: set(desk, 'closed') },
        { label: '이 책상 치우기', act: set(desk, 'gone') },
      ]);
    }
    const table: MenuItem[] = [];
    if (t.off?.some(Boolean)) table.push({ label: '막거나 치운 자리 되돌리기', act: set(all, null) });
    if (!all.every((s) => offOf(t, s) === 'closed')) table.push({ label: `${unit} 전체 앉지 못하게`, act: set(all, 'closed') });
    table.push({ label: `이 ${unit} 치우기`, act: () => onoff?.([[offKey(slot), 'removed']]), disabled: tables.length <= 1 });
    groups.push(table);
    return { title: si == null ? t.name : `${t.name} ${si + 1}번 자리`, groups };
  }
  async function openMenu(e: MouseEvent) {
    if (!onoff) return;
    const el = e.target as HTMLElement;
    const seatEl = el.closest<HTMLElement>('.seat[data-t]');
    const tblEl = el.closest<HTMLElement>('[data-ti]');
    if (!seatEl && !tblEl) return;
    e.preventDefault();
    const ti = Number(seatEl ? seatEl.dataset.t : tblEl!.dataset.ti);
    const si = seatEl ? Number(seatEl.dataset.s) : null;
    const deskEl = el.closest<HTMLElement>('[data-desk]');
    const desk = si != null ? deskOf(tables[ti], si) : deskEl ? deskEl.dataset.desk!.split(',').map(Number) : null;
    // 키보드로 열면 (좌표가 0) 그 요소 아래에
    let { clientX: x, clientY: y } = e;
    if (!x && !y) {
      const r = (seatEl ?? tblEl)!.getBoundingClientRect();
      (x = r.left), (y = r.bottom);
    }
    menu = { x, y, ...menuFor(ti, si, desk) };
    await tick();
    if (!menuEl) return;
    // 화면 밖으로 나가지 않게
    const r = menuEl.getBoundingClientRect();
    menu = { ...menu, x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) };
    menuEl.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }
  function closeMenu() {
    menu = null;
  }
  function menuKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menuEl!.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  function run(item: MenuItem) {
    closeMenu();
    item.act();
  }

  // ── 테이블 옮기기 ──
  let drag: { i: number; sx: number; sy: number; ox: number; oy: number } | null = null;
  let dragging = $state(-1);
  function place(i: number, x: number, y: number) {
    const cur: Layout = moved ? layout! : { w: baseW, at: at.map((p) => ({ ...p })) };
    const next = cur.at.map((p) => ({ ...p }));
    // 오른쪽 끝을 넘겨 끌면 배치도가 그만큼 넓어진다
    next[i] = { x: Math.round(Math.max(0, Math.min(4000, x))), y: Math.round(Math.max(TOP, Math.min(4000, y))) };
    layout = { w: Math.max(cur.w, next[i].x + boxes[i].w), at: next };
  }
  function down(e: PointerEvent, i: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.seat, input')) return;
    drag = { i, sx: e.clientX, sy: e.clientY, ox: at[i].x, oy: at[i].y };
    dragging = i;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    place(drag.i, drag.ox + (e.clientX - drag.sx) / scale, drag.oy + (e.clientY - drag.sy) / scale);
  }
  function up() {
    drag = null;
    dragging = -1;
  }
  function nudge(e: KeyboardEvent, i: number) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    place(i, at[i].x + d[0] * step, at[i].y + d[1] * step);
  }

  // ── 사람 끌어 옮기기 ──
  // 누르기만 하면 지금처럼 고르기(onpick), 조금이라도 끌면 놓은 자리와 맞바꾼다
  let grab = $state.raw<{ from: SeatRef; sx: number; sy: number; id: number } | null>(null);
  let ghost = $state<{ name: string; x: number; y: number } | null>(null);
  let over = $state<SeatRef | null>(null);
  let swallowClick = false;
  const seatAt = (x: number, y: number): SeatRef | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.seat[data-t]:not(.closed)');
    return el && box?.contains(el) ? [Number(el.dataset.t), Number(el.dataset.s)] : null;
  };
  const isOver = (t: number, s: number) => over != null && over[0] === t && over[1] === s;
  function seatDown(e: PointerEvent, t: number, s: number) {
    if (e.button !== 0 || !tables[t]?.seats[s]) return;
    grab = { from: [t, s], sx: e.clientX, sy: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function seatMove(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    if (!ghost && Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) < 6) return;
    const [t, s] = grab.from;
    ghost = { name: tables[t].seats[s]!.name, x: e.clientX, y: e.clientY };
    const to = seatAt(e.clientX, e.clientY);
    over = to && !(to[0] === t && to[1] === s) ? to : null;
  }
  function seatUp(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    if (ghost) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false));
      if (over && e.type === 'pointerup') onswap(grab.from, over);
    }
    grab = null;
    ghost = null;
    over = null;
  }
  function seatClick(t: number, s: number) {
    if (swallowClick || offOf(tables[t], s)) return;
    onpick(t, s);
  }

  // ── 전체 화면 ──
  export function enter() {
    box?.requestFullscreen?.().catch(() => {});
  }
  onMount(() => {
    const onChange = () => (full = document.fullscreenElement === box);
    const outside = (e: PointerEvent) => menu && !menuEl?.contains(e.target as Node) && closeMenu();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  });
</script>

{#snippet seat(t: SeatTable, ti: number, si: number)}
  {#if offOf(t, si) === 'gone'}
    <span class="seat gone" aria-hidden="true"></span>
  {:else}
  <button
    class="seat"
    class:free={!t.seats[si] && !offOf(t, si)}
    class:closed={offOf(t, si) === 'closed'}
    class:tint={!!tint(t, si)}
    class:over={isOver(ti, si)}
    class:lifted={ghost != null && grab?.from[0] === ti && grab?.from[1] === si}
    style:--g={tint(t, si)}
    data-t={ti}
    data-s={si}
    aria-pressed={isPicked(ti, si)}
    aria-label={seatLabel(t, si)}
    title={t.seats[si]?.info || undefined}
    onclick={() => seatClick(ti, si)}
    onpointerdown={(e) => seatDown(e, ti, si)}
    onpointermove={seatMove}
    onpointerup={seatUp}
    onpointercancel={seatUp}
  >
    {offOf(t, si) ? '못 앉음' : (t.seats[si]?.name ?? '빈 자리')}
  </button>
  {/if}
{/snippet}

{#snippet caption(t: SeatTable, ti: number)}
  <input class="tname" bind:value={t.name} aria-label="{ti + 1}번 {shape === 'pod' ? '모둠' : '테이블'} 이름" />
  <span class="n">{t.seats.filter(Boolean).length}명</span>
{/snippet}

<div class="box" class:full bind:this={box}>
  <h3 class="title">{title || '좌석표'}</h3>
  {#if full}<button class="btn sm close" onclick={() => document.exitFullscreen()}>닫기 <kbd>Esc</kbd></button>{/if}
  <div class="view" bind:clientWidth={availW} bind:clientHeight={availH}>
    <div class="fit" style:width="{size.w * scale}px" style:height="{size.h * scale}px" style:--w={size.w} style:--h={size.h} style:--ps={printScale}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="canvas" class:rows={shape === 'rows'} oncontextmenu={openMenu} style:width="{size.w}px" style:height="{size.h}px" style:transform="scale({scale})">
        <div class="front" style:left={shape === 'rows' ? `${ROW_LABEL}px` : '20%'} style:right={shape === 'rows' ? '0' : '20%'} style:height="{FRONT_H}px">앞 <small>칠판 · 스크린</small></div>
        {#if shape === 'rows'}
          {#each shownHoles as h (h)}
            <button class="hole noprint" style:top="{rowTop(h)}px" style:left="{ROW_LABEL}px" style:width="{lineW}px" style:height="{SEAT_H}px" onclick={() => onoff?.([[offKey(h), null]])}>치운 줄 · 눌러서 되돌리기</button>
          {/each}
          {#each tables as t, ti (ti)}
            <div class="row" data-ti={ti} style:top="{rowTop(slotOf(t, ti))}px">
              <input class="tname" bind:value={t.name} aria-label="{ti + 1}번째 줄 이름" style:width="{ROW_LABEL - 8}px" />
              <div class="line">{#each t.seats as _, si (si)}{#if aisleAt(si)}<i class="aisle" style:width="{AISLE - SEAT_GAP}px"></i>{/if}{@render seat(t, ti, si)}{/each}</div>
            </div>
          {/each}
        {:else}
          {#each shownHoles as h, hi (h)}
            <button class="hole noprint" style:left="{holeAt[hi]?.x ?? 0}px" style:top="{holeAt[hi]?.y ?? 0}px" style:width="{holeBox.w}px" style:height="{holeBox.h}px" onclick={() => onoff?.([[offKey(h), null]])}>치운 {unit}<br /><small>눌러서 되돌리기</small></button>
          {/each}
          {#each tables as t, ti (ti)}
            {@const n = t.seats.length}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="tbl {shape}"
              data-ti={ti}
              class:vertical
              class:dragging={dragging === ti}
              style:left="{at[ti]?.x ?? 0}px"
              style:top="{at[ti]?.y ?? 0}px"
              style:width="{boxes[ti].w}px"
              style:height="{boxes[ti].h}px"
              onpointerdown={(e) => down(e, ti)}
              onpointermove={move}
              onpointerup={up}
              onpointercancel={up}
            >
              <button class="grip" aria-label="{t.name} 옮기기 (화살표 키)" title="끌어서 옮기기 · 화살표 키로도 옮깁니다" onkeydown={(e) => nudge(e, ti)}>⠿</button>
              {#if shape === 'round'}
                {@const r = ringRadius(n)}
                <div class="disc" style:width="{(r - 30) * 2}px" style:height="{(r - 30) * 2}px">{@render caption(t, ti)}</div>
                {#each t.seats as _, si (si)}
                  {@const p = around(si, n, r)}
                  <div class="spot" style:left="calc(50% + {p.x}px)" style:top="calc(50% + {p.y}px)">{@render seat(t, ti, si)}</div>
                {/each}
              {:else if shape === 'long'}
                {@const half = Math.ceil(n / 2)}
                <div class="side">{#each range(0, half) as si (si)}{@render seat(t, ti, si)}{/each}</div>
                <div class="bar">{@render caption(t, ti)}</div>
                <div class="side">{#each range(half, n) as si (si)}{@render seat(t, ti, si)}{/each}</div>
              {:else}
                {@const p = podPlan(n)}
                <div class="cap" style:height="{POD_CAPTION}px">{@render caption(t, ti)}</div>
                <div class="podbody">
                  <div class="core">
                    {#each [range(0, p.row), range(p.row, n - p.side)] as line, li (li)}
                      <div class="deskrow">
                        {#each desks(line) as d (d[0])}<div class="desk" class:gone={d.every((si) => offOf(t, si) === 'gone')} data-desk={d.join(',')}>{#each d as si (si)}{@render seat(t, ti, si)}{/each}</div>{/each}
                      </div>
                    {/each}
                  </div>
                  {#if p.side}<div class="desk end" class:gone={range(n - p.side, n).every((si) => offOf(t, si) === 'gone')} data-desk={range(n - p.side, n).join(',')}>{#each range(n - p.side, n) as si (si)}{@render seat(t, ti, si)}{/each}</div>{/if}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
  {#if groups.length}
    <ul class="legend" aria-label="소속 색">
      {#each groups as g, i (g.name)}<li style:--g="hsl({groupHue(i)} 62% 46%)"><i></i>{g.name} <small>{g.count}</small></li>{/each}
    </ul>
  {/if}
  {#if menu}
    <div class="menu" role="menu" tabindex="-1" aria-label="{menu.title} 메뉴" bind:this={menuEl} style:left="{menu.x}px" style:top="{menu.y}px" onkeydown={menuKey}>
      <div class="menu-title">{menu.title}</div>
      {#each menu.groups as g, gi (gi)}
        {#if gi}<hr />{/if}
        {#each g as item (item.label)}<button role="menuitem" disabled={item.disabled} onclick={() => run(item)}>{item.label}</button>{/each}
      {/each}
    </div>
  {/if}
  {#if ghost}<div class="carry" style:left="{ghost.x}px" style:top="{ghost.y}px" aria-hidden="true">{ghost.name}</div>{/if}
  {#if moved && !full}
    <p class="tidy noprint"><button class="btn sm" onclick={() => (layout = null)}>테이블 자리 정돈</button> 옮겨 둔 자리를 지우고 다시 가지런히 놓습니다.</p>
  {/if}
</div>

<style>
  .box {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .title,
  .close {
    display: none;
  }
  .view {
    min-width: 0;
    overflow: hidden;
  }
  .fit {
    margin: 0 auto;
  }
  .canvas {
    position: relative;
    transform-origin: 0 0;
  }
  .front {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;
    background: var(--app-soft);
    border: 1.5px solid var(--app-line);
    font-size: 13px;
    font-weight: 700;
  }
  .front small {
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
  }

  .tbl {
    position: absolute;
    border-radius: 12px;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .tbl:hover,
  .tbl:focus-within {
    outline: 1.5px dashed var(--border-strong);
    outline-offset: 5px;
  }
  .tbl.dragging {
    cursor: grabbing;
    outline: 1.5px solid var(--app);
    outline-offset: 5px;
    z-index: 2;
  }
  .grip {
    position: absolute;
    left: -4px;
    top: -6px;
    z-index: 1;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    line-height: 1;
    color: var(--faint);
    cursor: grab;
    opacity: 0;
  }
  .tbl:hover .grip,
  .grip:focus-visible {
    opacity: 1;
  }

  .seat {
    flex: none;
    width: 68px;
    height: 26px;
    padding: 0 5px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seat.tint {
    border-color: var(--g);
    background: color-mix(in srgb, var(--g) 22%, var(--surface));
  }
  .seat:hover {
    border-color: var(--app);
  }
  .seat.free {
    border-style: dashed;
    color: var(--faint);
    font-weight: 400;
    font-size: 11.5px;
    background: transparent;
  }
  /* 앉지 못하는 자리: 빗금, 치운 자리: 자리만 비워 둔다 */
  .seat.closed {
    border-style: dashed;
    color: var(--faint);
    font-weight: 400;
    font-size: 11px;
    background: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--faint) 22%, transparent) 5px 6px);
    cursor: default;
  }
  .seat.gone,
  .desk.gone {
    visibility: hidden;
  }
  .seat.gone {
    display: inline-block;
  }
  .hole {
    position: absolute;
    display: grid;
    place-content: center;
    gap: 2px;
    padding: 0;
    border: 1.5px dashed var(--border-strong);
    border-radius: 12px;
    background: transparent;
    color: var(--faint);
    font-size: 12px;
    line-height: 1.4;
    cursor: pointer;
    opacity: 0.7;
  }
  .hole:hover,
  .hole:focus-visible {
    opacity: 1;
    border-color: var(--app);
    color: var(--app);
  }
  .hole small {
    font-size: 11px;
  }
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 180px;
    padding: 4px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    font-size: 13px;
  }
  .menu-title {
    padding: 5px 10px 4px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--muted);
  }
  .menu hr {
    margin: 4px 6px;
    border: 0;
    border-top: 1px solid var(--app-line);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--app-soft);
    outline: none;
  }
  .menu button:disabled {
    color: var(--faint);
    cursor: default;
  }
  .seat[aria-pressed='true'] {
    background: var(--app);
    border-color: var(--app);
    color: var(--on-app);
  }
  .seat:not(.free, .closed, .gone) {
    cursor: grab;
    touch-action: none;
  }
  .seat.lifted {
    opacity: 0.35;
  }
  .seat.over {
    outline: 2px solid var(--app);
    outline-offset: 2px;
    border-color: var(--app);
  }
  .carry {
    position: fixed;
    z-index: 50;
    transform: translate(-50%, -60%);
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--app);
    color: var(--on-app);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
    pointer-events: none;
    cursor: grabbing;
  }
  .tname {
    width: 100%;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    color: var(--text);
  }
  .tname:hover,
  .tname:focus {
    border-color: var(--app-line);
    background: var(--surface);
  }
  .n {
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
  }

  /* 둥근 테이블 */
  .disc {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--app-soft);
    border: 1.5px solid var(--app-line);
  }
  .spot {
    position: absolute;
    transform: translate(-50%, -50%);
  }

  /* 긴 탁자 */
  .long {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .long.vertical {
    flex-direction: row;
  }
  .side {
    display: flex;
    justify-content: center;
    gap: 6px;
  }
  .vertical .side {
    flex-direction: column;
    justify-content: flex-start;
  }
  .bar {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--app-soft);
    border: 1.5px solid var(--app-line);
  }
  .vertical .bar {
    flex-direction: column;
    gap: 0;
    padding: 2px 4px;
  }

  /* 모둠 책상 */
  .cap {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .cap .tname {
    text-align: left;
  }
  /* 마주 보는 두 줄은 칠판과 직각으로 (책상이 세로로 선다), 뒤 책상은 칠판을 바라본다 */
  .podbody {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .core {
    display: flex;
    gap: 4px;
  }
  .deskrow {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .deskrow .desk {
    flex-direction: column;
  }
  .desk {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 9px;
    background: var(--app-soft);
    border: 1.5px solid var(--app-line);
  }

  /* 줄 맞춤 */
  .row {
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .line {
    display: flex;
    gap: 6px;
  }
  /* 통로: 양옆 간격 6 + 너비(AISLE - 6) = 자리 사이보다 AISLE 만큼 넓다 */
  .aisle {
    flex: none;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
    font-size: 12.5px;
  }
  .legend i {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 5px;
    border-radius: 4px;
    border: 1px solid var(--g);
    background: color-mix(in srgb, var(--g) 30%, var(--surface));
    vertical-align: -1px;
  }
  .legend small {
    color: var(--faint);
  }
  .tidy {
    font-size: 12px;
    color: var(--faint);
  }

  /* 전체 화면: 프로젝터에 띄워 놓고 그대로 앉게 */
  .box.full {
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 14px;
    padding: 24px 28px;
    background: var(--bg);
    color: var(--text);
  }
  .full .title {
    display: block;
    font-size: clamp(20px, 3vh, 34px);
    text-align: center;
  }
  .full .close {
    display: inline-flex;
    position: absolute;
    top: 16px;
    right: 18px;
    opacity: 0.6;
  }
  .full .close:hover {
    opacity: 1;
  }
  .full .view {
    display: grid;
    place-items: center;
  }
  .full .legend {
    font-size: clamp(13px, 2vh, 20px);
  }
  .full .grip {
    display: none;
  }

  @media print {
    .title {
      display: block;
      margin-bottom: 8mm;
      font-size: 20pt;
      text-align: center;
    }
    .view {
      overflow: visible;
    }
    .fit {
      width: calc(var(--w) * var(--ps) * 1px) !important;
      height: calc(var(--h) * var(--ps) * 1px) !important;
    }
    .canvas {
      transform: scale(var(--ps)) !important;
    }
    .tbl {
      outline: none !important;
    }
    .grip,
    .noprint {
      display: none !important;
    }
    .seat,
    .disc,
    .bar,
    .desk,
    .front,
    .legend i {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .seat.free {
      color: transparent;
    }
  }
</style>

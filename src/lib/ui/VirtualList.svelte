<script lang="ts">
  import type { Snippet } from 'svelte';

  // 보이는 줄만 그리는 목록. 줄이 수백만 개라 실제 높이가 브라우저 한계를 넘으면 스크롤 위치를 비례로 환산한다.
  let {
    count,
    rowHeight = 24,
    width,
    header,
    headerHeight = 0,
    row,
    label,
    onkeydown,
  }: {
    count: number;
    rowHeight?: number;
    /** 가로로 넘치는 내용의 너비(px) */
    width?: number;
    header?: Snippet;
    headerHeight?: number;
    row: Snippet<[number]>;
    label?: string;
    onkeydown?: (e: KeyboardEvent) => void;
  } = $props();

  const MAX = 15_000_000;
  const OVERSCAN = 6;
  let el: HTMLDivElement;
  let scrollTop = $state(0);
  let viewH = $state(0);

  const body = $derived(Math.max(0, viewH - headerHeight));
  const total = $derived(count * rowHeight);
  const height = $derived(Math.min(total, MAX));
  const ratio = $derived(total > height && height > body ? (total - body) / (height - body) : 1);
  const win = $derived.by(() => {
    const realTop = scrollTop * ratio;
    const first = Math.max(0, Math.floor(realTop / rowHeight) - OVERSCAN);
    const last = Math.min(count, first + Math.ceil(body / rowHeight) + OVERSCAN * 2 + 1);
    return { first, last, offset: scrollTop - (realTop - first * rowHeight) };
  });
  const indices = $derived(Array.from({ length: Math.max(0, win.last - win.first) }, (_, k) => win.first + k));

  /** 그 줄이 보이게 한다. 이미 보이면 움직이지 않는다. */
  export function scrollToIndex(i: number, center = false) {
    if (!el) return;
    const realTop = el.scrollTop * ratio;
    const top = i * rowHeight;
    let next = realTop;
    if (center || top < realTop || top + rowHeight > realTop + body) next = center || Math.abs(top - realTop) > body * 2 ? top - body / 2 + rowHeight / 2 : top < realTop ? top : top + rowHeight - body;
    else return;
    el.scrollTop = Math.max(0, next) / ratio;
  }
  export function focus() {
    el?.focus({ preventScroll: true });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="vl" bind:this={el} bind:clientHeight={viewH} onscroll={() => (scrollTop = el.scrollTop)} tabindex="0" role="group" aria-label={label} {onkeydown}>
  {#if header}
    <div class="vh" style:min-width={width ? `${width}px` : undefined} style:height="{headerHeight}px">{@render header()}</div>
  {/if}
  <div class="vs" style:height="{height}px" style:min-width={width ? `${width}px` : undefined}>
    <div class="vb" style:transform="translateY({win.offset}px)">
      {#each indices as i (i)}{@render row(i)}{/each}
    </div>
  </div>
</div>

<style>
  .vl {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    outline: none;
    overflow-anchor: none;
  }
  .vh {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .vs {
    position: relative;
    overflow: clip;
  }
  .vb {
    position: absolute;
    inset: 0 0 auto 0;
    will-change: transform;
  }
</style>

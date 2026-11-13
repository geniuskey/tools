<script lang="ts">
  import { st, TARGET_NAMES } from './state.svelte';

  /** 지금 기준이 되는 색 (모아 두기 단추가 이 색을 모은다) */
  let { current }: { current: string } = $props();
  const savedNow = $derived(st.saved.includes(current));
</script>

<section class="card sw" aria-labelledby="h-sw">
  <div class="head">
    <h2 id="h-sw">모아 둔 색 · 최근 색</h2>
    <button class="btn sm" class:on={savedNow} onclick={() => st.toggleSaved(current)} aria-pressed={savedNow}>
      {savedNow ? '★ 모아 둠' : '☆ 지금 색 모아 두기'}
    </button>
  </div>
  {#if st.saved.length}
    <ul class="list" aria-label="모아 둔 색">
      {#each st.saved as hex (hex)}
        <li>
          <button class="dot" style:--c={hex} onclick={() => st.set(st.target, hex)} title="{hex} — {TARGET_NAMES[st.target]}에 넣기" aria-label="{hex}를 {TARGET_NAMES[st.target]}에 넣기"></button>
          <button class="x" onclick={() => st.toggleSaved(hex)} aria-label="{hex} 빼기" title="빼기">×</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if st.recent.length}
    <ul class="list" aria-label="최근 색">
      {#each st.recent as hex (hex)}
        <li><button class="dot" style:--c={hex} onclick={() => st.set(st.target, hex)} title="{hex} — {TARGET_NAMES[st.target]}에 넣기" aria-label="{hex}를 {TARGET_NAMES[st.target]}에 넣기"></button></li>
      {/each}
    </ul>
  {:else if !st.saved.length}
    <p class="hint">쓴 색이 여기에 남습니다. 누르면 <b>{TARGET_NAMES[st.target]}</b>에 들어갑니다.</p>
  {/if}
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .btn.on {
    border-color: var(--app);
    color: var(--app);
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
  }
  .dot {
    display: block;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
    background: linear-gradient(var(--c), var(--c)), repeating-conic-gradient(#d9dce1 0 25%, #fff 0 50%) 0 0 / 8px 8px;
    padding: 0;
  }
  .dot:hover {
    transform: scale(1.08);
  }
  .x {
    position: absolute;
    right: -5px;
    top: -5px;
    display: none;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
    font-size: 11px;
    line-height: 16px;
  }
  li:hover .x,
  .x:focus-visible {
    display: block;
  }
</style>

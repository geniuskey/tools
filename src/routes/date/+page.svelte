<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { today } from '$lib/date/core';
  import { st, type Mode } from '$lib/date/state.svelte';
  import Calc from '$lib/date/Calc.svelte';
  import Year from '$lib/date/Year.svelte';
  import Zones from '$lib/date/Zones.svelte';
  import Lunar from '$lib/date/Lunar.svelte';

  const KEY = 'tools:date:v1';
  const MODES: [Mode, string][] = [
    ['calc', '날짜'],
    ['year', '공휴일'],
    ['zones', '시간대'],
    ['lunar', '음력'],
  ];
  let ready = $state(false);

  onMount(() => {
    st.today = today();
    st.restore(load<Record<string, any>>(KEY, {}));
    ready = true;
    // 자정을 넘기면 오늘을 바꾼다
    const tick = setInterval(() => (st.today = today()), 60_000);
    return () => clearInterval(tick);
  });
  $effect(() => {
    const snap = st.snapshot();
    if (ready) save(KEY, snap);
  });
</script>

<ToolShell tool="date">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      {#each MODES as [id, name] (id)}<button aria-pressed={st.mode === id} onclick={() => (st.mode = id)}>{name}</button>{/each}
    </div>
  {/snippet}

  <div class="date">
    {#if !ready}
      <div></div>
    {:else if st.mode === 'calc'}
      <Calc />
    {:else if st.mode === 'year'}
      <Year />
    {:else if st.mode === 'zones'}
      <Zones />
    {:else}
      <Lunar />
    {/if}
  </div>
  {#if st.toast}<p class="toast" role="status">{st.toast}</p>{/if}
</ToolShell>

<style>
  .date {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  /* 탭마다 같이 쓰는 모양 */
  .date :global(.page) {
    display: grid;
    gap: 12px;
    padding: 14px;
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
  }
  .date :global(.col) {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .date :global(.card) {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .date :global(.card h2) {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .date :global(.f) {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .date :global(.f .field) {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .date :global(input[type='date']),
  .date :global(input[type='time']),
  .date :global(input[type='number']) {
    font-variant-numeric: tabular-nums;
  }
  .date :global(.chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .date :global(.chips button) {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .date :global(.chips button:hover) {
    border-color: var(--app-line);
    color: var(--text);
  }
  .date :global(.chips button[aria-pressed='true']) {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .date :global(.result) {
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--app-soft);
  }
  .date :global(.sub) {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .date :global(.warn) {
    margin-top: 6px;
    font-size: 13px;
    color: var(--bad);
  }
  .date :global(.warn b) {
    font-weight: 700;
  }
  .date :global(.hint) {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .date :global(.foot) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .date :global(.check) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    font-size: 13px;
  }
  .date :global(.check input) {
    accent-color: var(--app);
  }
  .date :global(.check small) {
    font-size: 12px;
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
    z-index: 5;
  }
  @media (max-width: 820px) {
    .date :global(.page) {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
  }
  @media (max-width: 520px) {
    .date :global(.card) {
      padding: 12px;
    }
  }
</style>

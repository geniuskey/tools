<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { MODES, st } from '$lib/pay/state.svelte';
  import Net from '$lib/pay/Net.svelte';
  import SalaryTable from '$lib/pay/SalaryTable.svelte';
  import Words from '$lib/pay/Words.svelte';

  const KEY = 'tools:pay:v1';
  let ready = $state(false);

  onMount(() => {
    st.restore(load<Record<string, any>>(KEY, {}));
    // 주소로 바로 들어오면 그 탭으로 (/pay#words)
    const tab = location.hash.slice(1);
    if (MODES.some(([m]) => m === tab)) st.mode = tab as typeof st.mode;
    ready = true;
  });
  $effect(() => {
    const snap = st.snapshot();
    if (ready) save(KEY, snap);
  });

  function forget() {
    st.reset();
    try {
      localStorage.removeItem(KEY);
    } catch {}
    st.say('저장한 값을 지우고 처음 값으로 돌렸습니다');
  }

  const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');
  function onkeydown(e: KeyboardEvent) {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) {
      e.preventDefault();
      st.mode = MODES[i][0];
    }
  }
</script>

<svelte:window {onkeydown} />

<ToolShell tool="pay">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      {#each MODES as [id, name], i (id)}<button aria-pressed={st.mode === id} onclick={() => (st.mode = id)} title="{name} ({i + 1})">{name}</button>{/each}
    </div>
  {/snippet}

  <div class="pay">
    {#if !ready}
      <div></div>
    {:else if st.mode === 'net'}
      <Net />
    {:else if st.mode === 'table'}
      <SalaryTable />
    {:else}
      <Words />
    {/if}
    {#if ready}
      <p class="stored">
        적은 금액과 조건은 이 브라우저에만 저장되어 다음에 열 때 그대로 나옵니다. 서버로는 보내지 않습니다.
        <button onclick={forget}>저장한 값 지우기</button>
      </p>
    {/if}
  </div>
  {#if st.toast}<p class="toast" role="status">{st.toast}</p>{/if}
</ToolShell>

<style>
  .stored {
    max-width: 1180px;
    margin: 0 auto;
    padding: 2px 16px 24px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .stored button {
    margin-left: 4px;
    padding: 0;
    border: 0;
    background: none;
    font-size: 12px;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .stored button:hover {
    color: var(--text);
  }
  .pay {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .pay :global(.page) {
    display: grid;
    gap: 12px;
    padding: 14px;
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
    align-content: start;
  }
  .pay :global(.page.two) {
    grid-template-columns: minmax(300px, 440px) minmax(0, 1fr);
    align-items: start;
  }
  .pay :global(.col) {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .pay :global(.card) {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .pay :global(.card h2) {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .pay :global(.card h2 small) {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .pay :global(.big) {
    width: 100%;
    height: 48px;
    font-size: 19px;
    font-weight: 600;
    padding: 0 14px;
  }
  .pay :global(.big:focus) {
    border-color: var(--app);
    outline: 3px solid var(--app-soft);
    outline-offset: 0;
  }
  .pay :global(.read) {
    font-size: 13px;
    color: var(--muted);
  }
  .pay :global(.read b) {
    color: var(--app);
  }
  .pay :global(.read.bad),
  .pay :global(.bad) {
    color: var(--bad);
  }
  .pay :global(.f) {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .pay :global(.f small) {
    font-weight: 400;
    color: var(--faint);
  }
  .pay :global(.f .seg) {
    justify-self: start;
  }
  .pay :global(.f .hint) {
    font-weight: 400;
  }
  .pay :global(.f .field) {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .pay :global(.cats),
  .pay :global(.chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .pay :global(.cats button),
  .pay :global(.chips button) {
    height: 28px;
    padding: 0 11px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12.5px;
    color: var(--muted);
  }
  .pay :global(.chips button) {
    height: 26px;
    font-size: 12px;
  }
  .pay :global(.cats button:hover),
  .pay :global(.chips button:hover) {
    border-color: var(--app-line);
    color: var(--text);
  }
  .pay :global(.cats button[aria-pressed='true']),
  .pay :global(.chips button[aria-pressed='true']) {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .pay :global(.hint) {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .pay :global(.check) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .pay :global(.check input) {
    accent-color: var(--app);
  }
  .pay :global(.check small) {
    font-size: 12px;
    color: var(--faint);
  }
  .pay :global(.hero-card) {
    gap: 4px;
    background: var(--app-soft);
    border-color: var(--app-line);
  }
  .pay :global(.said) {
    font-size: 14px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .pay :global(.said small) {
    margin-left: 4px;
    color: var(--faint);
  }
  .pay :global(.hero) {
    justify-self: start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: clamp(28px, 5vw, 40px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
    border-radius: 8px;
  }
  .pay :global(.hero small) {
    font-size: 0.55em;
    font-weight: 700;
    color: var(--app);
  }
  .pay :global(.hero:hover) {
    color: color-mix(in srgb, var(--text) 80%, var(--app));
  }
  .pay :global(.sub) {
    font-size: 13.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .pay :global(.rows) {
    list-style: none;
    margin: 0 -8px;
    padding: 0;
    display: grid;
  }
  .pay :global(.rows li) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-radius: 9px;
  }
  .pay :global(.rows li + li) {
    border-top: 1px solid var(--border);
  }
  .pay :global(.u) {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 7px 8px;
    border: 0;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--muted);
    border-radius: 8px;
  }
  .pay :global(.u b) {
    flex: none;
    min-width: 58px;
    font-weight: 700;
    color: var(--text);
  }
  .pay :global(.u span) {
    min-width: 0;
  }
  .pay :global(.u small) {
    font-size: 11.5px;
    color: var(--faint);
  }
  .pay :global(.v) {
    padding: 7px 10px;
    border: 0;
    background: none;
    font-size: 15px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    text-align: right;
    border-radius: 8px;
    word-break: break-all;
  }
  .pay :global(button.v:hover:not(:disabled)) {
    background: var(--app-soft);
    color: var(--text);
  }
  .pay :global(.v.static) {
    font-weight: 600;
  }
  .pay :global(.facts) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0;
  }
  .pay :global(.facts div) {
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .pay :global(.facts dt) {
    font-size: 12px;
    color: var(--muted);
  }
  .pay :global(.facts dd) {
    margin: 2px 0 0;
    font-size: 18px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
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
  .pay :global(.u) {
    cursor: default;
  }
  .pay :global(.hero) {
    cursor: pointer;
  }
  @media (max-width: 860px) {
    .pay :global(.page.two) {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
  }
  @media (max-width: 520px) {
    .pay :global(.card) {
      padding: 12px;
    }
    .pay :global(.facts) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

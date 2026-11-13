<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import { load, save } from '$lib/storage';
  import { receive } from '$lib/handoff';
  import { parseColor } from '$lib/color/parse';
  import { MODES, st, TARGET_NAMES } from '$lib/color/state.svelte';
  import Contrast from '$lib/color/Contrast.svelte';
  import Convert from '$lib/color/Convert.svelte';
  import Palette from '$lib/color/Palette.svelte';
  import Picker from '$lib/color/Picker.svelte';

  const KEY = 'tools:color:v1';
  let ready = $state(false);

  onMount(() => {
    st.restore(load<Record<string, any>>(KEY, {}));
    ready = true;
    // 다른 도구(이미지 편집기 · 화면 녹화)에서 넘긴 그림
    receive().then((h) => {
      if (h?.kind === 'image') {
        st.image = { blob: h.blob, name: h.name };
        st.mode = 'picker';
      }
    });
  });
  $effect(() => {
    const snap = st.snapshot();
    if (ready) save(KEY, snap);
  });

  const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');
  // 어디서든 붙여넣기: 그림이면 사진 탭으로, 색이면 지금 고른 칸에
  function onpaste(e: ClipboardEvent) {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      st.image = { blob: file, name: file.name && file.name !== 'image.png' ? file.name : '붙여넣은 그림' };
      st.mode = 'picker';
      return;
    }
    if (typing(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (parseColor(text)) {
      e.preventDefault();
      const where = st.mode === 'contrast' ? (st.target === 'base' ? 'fg' : st.target) : st.mode === 'picker' ? st.target : 'base';
      st.set(where, text.trim());
      st.say(`${TARGET_NAMES[where]}에 붙여넣었습니다`);
    }
  }
  function onkeydown(e: KeyboardEvent) {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) {
      e.preventDefault();
      st.mode = MODES[i][0];
    }
  }
  // 탭을 바꾸면 그 탭이 쓰는 칸을 고른다
  $effect(() => {
    const m = st.mode;
    if ((m === 'convert' || m === 'palette') && st.target !== 'base') st.target = 'base';
    if (m === 'contrast' && st.target === 'base') st.target = 'fg';
  });
</script>

<svelte:window {onpaste} {onkeydown} />

<ToolShell tool="color">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="무엇을 할까">
      {#each MODES as [id, name], i (id)}<button aria-pressed={st.mode === id} onclick={() => (st.mode = id)} title="{name} ({i + 1})">{name}</button>{/each}
    </div>
  {/snippet}

  <div class="color">
    {#if !ready}
      <div></div>
    {:else if st.mode === 'contrast'}
      <Contrast />
    {:else if st.mode === 'convert'}
      <Convert />
    {:else if st.mode === 'palette'}
      <Palette />
    {/if}
    <!-- 사진 탭은 그림을 들고 있어야 해서 숨기기만 한다 -->
    <div class="keep" hidden={!ready || st.mode !== 'picker'}><Picker /></div>
  </div>
  {#if st.toast}<p class="toast" role="status">{st.toast}</p>{/if}
</ToolShell>

<style>
  .color {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .keep[hidden] {
    display: none;
  }
  .color :global(.page) {
    display: grid;
    gap: 12px;
    padding: 14px;
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
    align-content: start;
  }
  .color :global(.page.two) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
  .color :global(.col) {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .color :global(.card) {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .color :global(.card h2) {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .color :global(.f) {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .color :global(.f .field) {
    width: 100%;
    font-weight: 400;
    color: var(--text);
  }
  .color :global(.chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .color :global(.chips button) {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 99px;
    background: var(--surface);
    font-size: 12px;
    color: var(--muted);
  }
  .color :global(.chips button:hover) {
    border-color: var(--app-line);
    color: var(--text);
  }
  .color :global(.chips button[aria-pressed='true']) {
    border-color: var(--app);
    background: var(--app-soft);
    color: var(--text);
    font-weight: 650;
  }
  .color :global(.hint) {
    font-size: 12px;
    line-height: 1.7;
    color: var(--faint);
  }
  .color :global(.foot) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
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
    .color :global(.page),
    .color :global(.page.two) {
      grid-template-columns: minmax(0, 1fr);
      padding: 10px;
      gap: 10px;
    }
  }
  @media (max-width: 520px) {
    .color :global(.card) {
      padding: 12px;
    }
    .seg button {
      padding: 0 9px;
    }
  }
</style>

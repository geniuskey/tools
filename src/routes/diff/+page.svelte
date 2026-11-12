<script lang="ts">
  import { onMount } from 'svelte';
  import ToolShell from '$lib/ui/ToolShell.svelte';
  import TextDiff from '$lib/diff/TextDiff.svelte';
  import ImageDiff from '$lib/diff/ImageDiff.svelte';
  import { load, save } from '$lib/storage';

  type Mode = 'text' | 'json' | 'image';
  const KEY = 'tools:diff:mode';
  const modes: [Mode, string][] = [
    ['text', '텍스트'],
    ['json', 'JSON'],
    ['image', '이미지'],
  ];

  let mode = $state<Mode>('text');

  onMount(() => {
    const m = load<Mode>(KEY, 'text');
    if (modes.some(([id]) => id === m)) mode = m;
  });

  function pick(m: Mode) {
    mode = m;
    save(KEY, m);
  }
</script>

<ToolShell tool="diff">
  {#snippet actions()}
    <div class="seg" role="group" aria-label="비교 대상">
      {#each modes as [id, name] (id)}
        <button aria-pressed={mode === id} onclick={() => pick(id)}>{name}</button>
      {/each}
    </div>
  {/snippet}

  <!-- 모드를 오가도 입력이 사라지지 않게 둘 다 살려 둔다 -->
  <div class="pane" hidden={mode === 'image'}>
    <TextDiff json={mode === 'json'} active={mode !== 'image'} />
  </div>
  <div class="pane" hidden={mode !== 'image'}>
    <ImageDiff active={mode === 'image'} />
  </div>
</ToolShell>

<style>
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .pane[hidden] {
    display: none;
  }
</style>

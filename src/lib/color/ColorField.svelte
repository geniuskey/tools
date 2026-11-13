<script lang="ts">
  import { untrack } from 'svelte';
  import { parseColor } from './parse';
  import { toHex, toHex6 } from './format';
  import { st, type Target } from './state.svelte';

  let { target, label, big = false }: { target: Target; label: string; big?: boolean } = $props();

  // 치는 동안의 글. 읽을 수 있는 색이 되면 바로 상태에 넣는다
  let text = $state(untrack(() => st[target]));
  let last = untrack(() => st[target]);
  $effect(() => {
    const v = st[target];
    if (v !== last) {
      last = v;
      text = v;
    }
  });
  const parsed = $derived(parseColor(text));
  const bad = $derived(text.trim() !== '' && !parsed);
  const color = $derived(parsed?.color ?? parseColor(st[target])?.color);
  const css = $derived(color ? toHex(color) : 'transparent');

  function oninput(e: Event) {
    text = (e.currentTarget as HTMLInputElement).value;
    const p = parseColor(text);
    if (p) {
      last = text.trim();
      st[target] = last;
    }
  }
  function commit() {
    if (parsed) st.remember(text);
    else if (!text.trim()) text = st[target];
  }
  function onpicker(e: Event) {
    const hex = (e.currentTarget as HTMLInputElement).value;
    // 알파는 그대로 둔다
    const a = color && color.alpha < 0.9995 ? toHex(color).slice(7) : '';
    st[target] = hex + a;
  }

  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function dropper() {
    if (!canDrop) {
      st.say('이 브라우저는 화면에서 색 따오기를 지원하지 않습니다 — 크롬 · 엣지에서 됩니다');
      return;
    }
    try {
      const r = await new (window as any).EyeDropper().open();
      st.set(target, r.sRGBHex);
    } catch {}
  }
</script>

<div class="cf" class:big>
  <label class="name" for="cf-{target}">{label}</label>
  <div class="row" class:on={st.target === target}>
    <span class="chip">
      <i style:background={css}></i>
      <input type="color" value={color ? toHex6(color) : '#000000'} oninput={onpicker} onchange={commit} aria-label="{label} 고르기" tabindex="-1" />
    </span>
    <input
      id="cf-{target}"
      class="field text"
      class:bad
      value={text}
      {oninput}
      onchange={commit}
      onfocus={() => (st.target = target)}
      onkeydown={(e) => e.key === 'Enter' && commit()}
      spellcheck="false"
      autocomplete="off"
      aria-invalid={bad}
      aria-describedby={bad ? `cf-${target}-err` : undefined}
    />
    <button class="btn sm ghost icon" onclick={dropper} title="화면에서 색 따오기" aria-label="{label}을 화면에서 따오기">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5l3 3M19.6 4.4a2.1 2.1 0 0 0-3 0l-2.1 2.1-1-1-1.4 1.4 1 1-7.6 7.6-.5 2.6-1 1 1.4 1.4 1-1 2.6-.5 7.6-7.6 1 1 1.4-1.4-1-1 2.1-2.1a2.1 2.1 0 0 0 0-3z" /></svg>
    </button>
  </div>
  {#if bad}<p class="err" id="cf-{target}-err">알아볼 수 없는 색입니다. 예: <code>#2563eb</code> · <code>rgb(37 99 235)</code> · <code>oklch(55% 0.2 262)</code> · <code>tomato</code></p>{/if}
</div>

<style>
  .cf {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .name {
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .chip {
    position: relative;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    background: repeating-conic-gradient(#d9dce1 0 25%, #fff 0 50%) 0 0 / 10px 10px;
  }
  .chip i {
    position: absolute;
    inset: 0;
  }
  .chip input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }
  .text {
    flex: 1;
    width: 100%;
    font-family: var(--mono);
    font-size: 13px;
  }
  .text.bad {
    border-color: var(--bad);
  }
  .row.on .text:not(:focus) {
    border-color: var(--app-line);
  }
  .icon {
    width: 34px;
    height: 34px;
    padding: 0;
    flex: none;
  }
  .big .chip {
    width: 44px;
    height: 44px;
    border-radius: 11px;
  }
  .big .text {
    height: 44px;
    font-size: 15px;
  }
  .big .icon {
    height: 44px;
  }
  .err {
    font-size: 12px;
    color: var(--bad);
    line-height: 1.6;
  }
  .err code {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
  }
</style>

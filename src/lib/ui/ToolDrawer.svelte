<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { tools } from '$lib/tools';
  import Logo from './Logo.svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  let dialog: HTMLDialogElement;
  let open = $state(false);

  const path = $derived(page.url.pathname.replace(/\/$/, '') || '/');

  function show() {
    dialog.showModal();
    open = true;
  }
  function close() {
    dialog.close();
  }

  afterNavigate(() => {
    if (dialog?.open) dialog.close();
  });
</script>

<button class="trigger" onclick={show} aria-label="도구 목록 열기" aria-haspopup="dialog" aria-expanded={open} title="도구 목록">
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
</button>

<!-- 도구마다 window 단축키가 있다. 서랍 안에서 누른 키가 뒤의 도구로 새지 않게 막는다. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<dialog
  bind:this={dialog}
  aria-label="도구 목록"
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialog && close()}
  onkeydown={(e) => e.stopPropagation()}
  onkeyup={(e) => e.stopPropagation()}
>
  <div class="panel">
    <div class="top">
      <a class="brand" href="/" onclick={close}>
        <Logo size={22} />
        <span>tools<span class="dim">.euiyun.com</span></span>
      </a>
      <button class="icon" onclick={close} aria-label="닫기">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <nav aria-label="도구">
      <a class="item" href="/" aria-current={path === '/' ? 'page' : undefined} onclick={close}>
        <span class="tile plain">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5" />
          </svg>
        </span>
        <span class="text"><b>모든 도구</b><small>첫 화면</small></span>
      </a>

      <h2>도구</h2>
      {#each tools as t (t.id)}
        <a class="item app-scope" href={t.href} style:--app={t.color} aria-current={path === t.href ? 'page' : undefined} onclick={close}>
          <span class="tile">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
          </span>
          <span class="text"><b>{t.name}</b><small>{t.short}</small></span>
        </a>
      {/each}
    </nav>

    <div class="bottom">
      <a class="ext" href="https://office.euiyun.com" rel="noopener">office.euiyun.com ↗</a>
      <ThemeToggle />
    </div>
  </div>
</dialog>

<style>
  .trigger,
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
  }
  .trigger:hover,
  .icon:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  dialog {
    position: fixed;
    inset: 0 auto 0 0;
    margin: 0;
    padding: 0;
    border: 0;
    width: min(300px, 86vw);
    height: 100dvh;
    max-width: none;
    max-height: none;
    background: var(--surface);
    color: var(--text);
    border-right: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    transform: translateX(-100%);
    transition:
      transform 0.2s ease,
      overlay 0.2s allow-discrete,
      display 0.2s allow-discrete;
  }
  dialog[open] {
    transform: none;
  }
  @starting-style {
    dialog[open] {
      transform: translateX(-100%);
    }
  }
  dialog::backdrop {
    background: rgb(10 12 16 / 0);
    transition:
      background 0.2s ease,
      overlay 0.2s allow-discrete,
      display 0.2s allow-discrete;
  }
  dialog[open]::backdrop {
    background: rgb(10 12 16 / 0.42);
  }
  @starting-style {
    dialog[open]::backdrop {
      background: rgb(10 12 16 / 0);
    }
  }

  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-left: env(safe-area-inset-left);
  }
  .top {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 750;
    letter-spacing: -0.02em;
    text-decoration: none;
    border-radius: 6px;
  }
  .dim {
    color: var(--faint);
    font-weight: 550;
  }

  nav {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 8px;
    display: grid;
    align-content: start;
    gap: 2px;
  }
  h2 {
    margin: 12px 8px 4px;
    font-size: 11.5px;
    font-weight: 650;
    letter-spacing: 0.04em;
    color: var(--faint);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 7px 8px;
    border-radius: 10px;
    text-decoration: none;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item[aria-current='page'] {
    background: var(--app-soft);
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--app-soft);
    color: var(--app);
  }
  .item[aria-current='page'] .tile {
    background: var(--app);
    color: var(--on-app);
  }
  .tile.plain {
    background: var(--surface-2);
    color: var(--muted);
  }
  .item[aria-current='page'] .tile.plain {
    background: var(--surface);
    color: var(--text);
  }
  .text {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .text b {
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .text small {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bottom {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom)) 16px;
    border-top: 1px solid var(--border);
  }
  .ext {
    font-size: 12.5px;
    color: var(--muted);
    text-decoration: none;
  }
  .ext:hover {
    color: var(--text);
  }
</style>

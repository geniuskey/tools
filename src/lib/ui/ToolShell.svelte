<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toolById } from '$lib/tools';
  import Logo from './Logo.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import ToolDrawer from './ToolDrawer.svelte';

  let {
    tool,
    actions,
    children,
  }: { tool: string; actions?: Snippet; children: Snippet } = $props();

  const info = $derived(toolById(tool));
</script>

<svelte:head>
  <title>{info.name} — tools.euiyun.com</title>
  <meta name="description" content={info.tagline} />
</svelte:head>

<div class="shell app-scope" style:--app={info.color}>
  <header>
    <ToolDrawer />
    <a class="home" href="/" aria-label="도구 모음으로">
      <Logo />
      <span class="site">tools</span>
    </a>
    <span class="sep" aria-hidden="true">/</span>
    <h1>{info.name}</h1>
    <div class="actions">
      {#if actions}{@render actions()}{/if}
      <span class="theme"><ThemeToggle /></span>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    min-height: 0;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    padding: 0 10px 0 8px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .home {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    border-radius: 6px;
  }
  .site {
    font-weight: 750;
    letter-spacing: -0.02em;
    color: var(--muted);
  }
  .home:hover .site {
    color: var(--text);
  }
  .sep {
    color: var(--border-strong);
  }
  h1 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .theme {
    display: contents;
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 520px) {
    .home,
    .sep {
      display: none;
    }
    /* 좁은 화면에서는 도구 버튼에 자리를 내준다 (첫 화면 · 테마는 서랍에 있다) */
    .theme {
      display: none;
    }
    header {
      padding: 0 8px 0 6px;
      gap: 6px;
    }
  }
</style>

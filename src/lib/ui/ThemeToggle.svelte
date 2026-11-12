<script lang="ts">
  import { theme } from '$lib/theme.svelte';
</script>

<button class="toggle" onclick={() => theme.toggle()} aria-label="밝은/어두운 테마 전환" title="테마 전환">
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
  </svg>
</button>

<style>
  .toggle {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
  }
  .toggle:hover {
    background: var(--surface-2);
    color: var(--text);
  }
</style>

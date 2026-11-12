<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { theme } from '$lib/theme.svelte';

  let { children } = $props();

  onMount(() => {
    theme.init();
    if ('serviceWorker' in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  });
</script>

{@render children()}

<script lang="ts">
  let { size = 22 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
  <rect x="3" y="3" width="12" height="12" rx="3.2" fill="var(--c-calc)" />
  <rect x="17" y="3" width="12" height="12" rx="3.2" fill="var(--c-image)" />
  <rect x="3" y="17" width="12" height="12" rx="3.2" fill="var(--c-raffle)" />
  <rect x="17" y="17" width="12" height="12" rx="3.2" fill="var(--c-diff)" />
</svg>

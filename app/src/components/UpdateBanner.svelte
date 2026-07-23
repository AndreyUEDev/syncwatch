<script lang="ts">
  import { updater } from '$lib/stores/updater.svelte';
</script>

{#if updater.available}
  <div class="banner flex items-center gap-3 px-4 py-2 text-sm">
    <span>🚀 Доступно обновление <b>v{updater.version}</b></span>

    {#if updater.readyToRestart}
      <button class="act" onclick={() => updater.restart()}>Перезапустить</button>
    {:else if updater.downloading}
      <span class="text-muted">загрузка…</span>
    {:else}
      <button class="act" onclick={() => updater.install()}>Обновить</button>
    {/if}

    {#if updater.error}
      <span class="text-xs" style="color:var(--danger)">{updater.error}</span>
    {/if}
  </div>
{/if}

<style>
  .banner {
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .act {
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.2rem 0.8rem;
    font-weight: 600;
  }
  .act:hover {
    filter: brightness(1.06);
  }
</style>

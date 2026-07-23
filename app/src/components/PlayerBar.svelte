<script lang="ts">
  import { player } from '$lib/stores/player.svelte';
  import { room } from '$lib/stores/room.svelte';

  let scrubbing = $state(false);
  let scrubPos = $state(0);

  const shown = $derived(scrubbing ? scrubPos : player.position);
  const current = $derived(room.playlistIndex >= 0 ? room.playlist[room.playlistIndex] : null);

  function fmt(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
</script>

<div class="glass space-y-3 p-4">
  {#if !player.path}
    <p class="text-dim py-2 text-center text-sm">
      {current ? `Серия «${current.name}» не найдена локально` : 'Плеер запустится после выбора серии'}
    </p>
  {:else}
    <div class="text-muted flex items-center gap-2 text-sm">
      {#if room.playlistIndex >= 0}
        <span class="bg-surface2 shrink-0 rounded px-1.5 text-xs">{room.playlistIndex + 1}</span>
      {/if}
      <span class="truncate">{current?.name ?? player.path}</span>
    </div>

    <input
      class="w-full"
      style="accent-color:var(--accent)"
      type="range"
      min="0"
      max={player.duration || 1}
      step="0.1"
      value={shown}
      oninput={(e) => {
        scrubbing = true;
        scrubPos = e.currentTarget.valueAsNumber;
      }}
      onchange={(e) => {
        scrubbing = false;
        room.seek(e.currentTarget.valueAsNumber);
      }}
    />

    <div class="flex items-center gap-3">
      <button
        class="nav"
        title="Предыдущая серия"
        disabled={room.playlistIndex <= 0}
        onclick={() => room.selectEpisode(room.playlistIndex - 1)}
      >
        ⏮
      </button>
      <button class="play" onclick={() => room.togglePause()}>
        {player.paused ? '▶' : '⏸'}
      </button>
      <button
        class="nav"
        title="Следующая серия"
        disabled={room.playlistIndex < 0 || room.playlistIndex >= room.playlist.length - 1}
        onclick={() => room.selectEpisode(room.playlistIndex + 1)}
      >
        ⏭
      </button>
      <span class="text-muted font-mono text-sm">{fmt(shown)} / {fmt(player.duration)}</span>

      <select
        class="bg-surface2 border-token ml-auto rounded-lg border px-2 py-1 text-sm"
        value={player.speed}
        onchange={(e) => room.setSpeed(Number(e.currentTarget.value))}
      >
        {#each speeds as s}
          <option value={s}>×{s}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if room.fileMismatch}
    <div class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      ⚠ Твой файл отличается от файла комнаты — синхронизация может быть неточной
    </div>
  {/if}
</div>

<style>
  .play {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 1rem;
  }
  .play:hover {
    filter: brightness(1.06);
  }
  .nav {
    color: var(--muted);
    font-size: 1.1rem;
  }
  .nav:hover:not(:disabled) {
    color: var(--text);
  }
  .nav:disabled {
    opacity: 0.3;
  }
</style>

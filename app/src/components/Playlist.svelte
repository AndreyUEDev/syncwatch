<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { room } from '$lib/stores/room.svelte';

  async function addFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Видео', extensions: ['mkv', 'mp4', 'avi', 'webm', 'ts', 'm2ts', 'mov'] }],
    });
    if (Array.isArray(picked) && picked.length) await room.addFiles(picked);
    else if (typeof picked === 'string') await room.addFiles([picked]);
  }

  async function addFolder() {
    const dir = await open({ directory: true });
    if (typeof dir === 'string') await room.addFolder(dir);
  }

  const mb = (size: number) => (size / 1_048_576).toFixed(0) + ' МБ';

  function statusIcon(i: number): { icon: string; title: string; cls: string } {
    switch (room.localMatch[i]) {
      case 'exact':
        return { icon: '✓', title: 'файл есть', cls: 'text-green-600 dark:text-green-400' };
      case 'approx':
        return { icon: '⚠', title: 'имя совпало, но размер отличается', cls: 'text-amber-600 dark:text-amber-400' };
      default:
        return { icon: '✗', title: 'файла нет', cls: 'text-red-600 dark:text-red-400' };
    }
  }
</script>

<div class="glass flex min-h-0 flex-col p-4">
  <div class="mb-2 flex items-center gap-2">
    <h3 class="text-dim text-xs font-semibold tracking-wide uppercase">
      Плейлист · {room.playlist.length}
    </h3>
    <button class="add" onclick={addFiles}>+ файлы</button>
    <button class="add" onclick={addFolder}>+ папка</button>
  </div>

  {#if room.playlist.length === 0}
    <p class="text-dim py-3 text-center text-sm">
      Добавь серии — файлы или папку целиком.<br />
      У остальных они подтянутся из их папки автоматически.
    </p>
  {:else}
    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
      {#each room.playlist as item, i}
        {@const st = statusIcon(i)}
        {@const avail = room.itemAvailability(i)}
        <div
          class="plrow group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition"
          class:row-active={i === room.playlistIndex}
          role="button"
          tabindex="0"
          ondblclick={() => room.selectEpisode(i)}
          onkeydown={(e) => e.key === 'Enter' && room.selectEpisode(i)}
        >
          <span class="text-dim w-5 shrink-0 text-right text-xs">{i + 1}</span>
          <span class={st.cls} title={st.title}>{st.icon}</span>
          <span class="min-w-0 truncate" title={item.name}>{item.name}</span>
          <span class="text-dim ml-auto shrink-0 text-xs">{mb(item.size)}</span>
          <span
            class="shrink-0 rounded px-1 text-xs"
            class:text-dim={!avail.mismatch}
            class:bg-amber-500-10={avail.mismatch}
            class:text-amber-600={avail.mismatch}
            class:dark:text-amber-400={avail.mismatch}
            title="у скольких участников есть этот файл"
          >
            {avail.have}/{avail.total}
          </span>
          <button
            class="bg-accent invisible shrink-0 rounded px-1.5 text-xs group-hover:visible"
            title="Включить эту серию всем"
            onclick={() => room.selectEpisode(i)}
          >
            ▶
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .add {
    border-radius: 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 0.15rem 0.6rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .add:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .plrow:hover:not(.row-active) {
    background: var(--surface-hover);
  }
  .row-active {
    background: var(--accent-soft);
  }
  .bg-amber-500-10 {
    background: rgba(245, 158, 11, 0.12);
  }
</style>

<script lang="ts">
  import { room } from '$lib/stores/room.svelte';
  import PlayerBar from '../components/PlayerBar.svelte';
  import Playlist from '../components/Playlist.svelte';
  import PeerList from '../components/PeerList.svelte';
  import Chat from '../components/Chat.svelte';

  let copied = $state(false);

  async function copyCode() {
    await navigator.clipboard.writeText(room.code);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<main class="flex h-full flex-col gap-3 p-4">
  <header class="flex items-center gap-3">
    <span class="text-grad text-lg font-bold tracking-tight">🎬 Syncwatch</span>

    <button
      class="glass hover:border-[var(--accent)] flex items-center gap-2 px-3 py-1.5 font-mono text-sm tracking-[0.25em] transition"
      style="border-radius:0.75rem"
      onclick={copyCode}
      title="Скопировать код комнаты"
    >
      {room.code}
      <span class="text-accent text-xs">{copied ? '✓' : '⧉'}</span>
    </button>

    {#if !room.signalOk}
      <span class="animate-pulse rounded-full px-3 py-1 text-xs text-amber-600 dark:text-amber-400" style="background:rgba(245,158,11,.12)">
        ⟳ переподключение…
      </span>
    {/if}

    <button
      class="text-muted hover:bg-[var(--surface-hover)] ml-auto rounded-xl px-3 py-1.5 text-sm transition hover:text-[var(--text)]"
      onclick={() => room.leave()}
    >
      Выйти
    </button>
  </header>

  <div class="grid min-h-0 flex-1 grid-cols-[1fr_19rem] gap-3">
    <div class="flex min-h-0 flex-col gap-3">
      <PlayerBar />
      <Playlist />
      <PeerList />
    </div>
    <Chat />
  </div>
</main>

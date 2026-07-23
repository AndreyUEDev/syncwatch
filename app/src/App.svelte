<script lang="ts">
  import { onMount } from 'svelte';
  import { player } from '$lib/stores/player.svelte';
  import { room } from '$lib/stores/room.svelte';
  import { updater } from '$lib/stores/updater.svelte';
  import { initDeepLinks } from '$lib/net/deeplink';
  import Home from './routes/Home.svelte';
  import Room from './routes/Room.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';

  onMount(async () => {
    await player.init();
    player.onUserAction = (kind) => room.userActionFromMpv(kind);
    player.onFileLoaded = () => room.fileLoaded();
    player.onEof = () => room.eofReached();
    updater.start();
    initDeepLinks((a) => room.fromDeepLink(a));
  });

  $effect(() => {
    if (player.duration > 0) room.updateLocalDuration(player.duration);
  });
</script>

<div class="flex h-screen flex-col">
  <UpdateBanner />
  <div class="min-h-0 flex-1">
    {#if room.phase === 'in_room'}
      <Room />
    {:else if room.phase === 'connecting'}
      <main class="text-muted flex h-full items-center justify-center">
        Подключение…
      </main>
    {:else}
      <Home />
    {/if}
  </div>
</div>

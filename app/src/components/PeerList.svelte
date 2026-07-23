<script lang="ts">
  import { room } from '$lib/stores/room.svelte';

  const self = $derived({
    peerId: room.selfId,
    name: room.name || 'User',
    file: room.localFile,
    connected: true,
  });

  const mb = (size: number) => (size / 1_048_576).toFixed(0) + ' МБ';
</script>

<div class="glass space-y-1 p-4">
  <h3 class="text-dim mb-2 text-xs font-semibold tracking-wide uppercase">
    Участники · {room.peers.length + 1}
  </h3>

  {#each [self, ...room.peers] as p (p.peerId)}
    <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        class:bg-green-500={p.connected}
        class:bg-zinc-400={!p.connected}
      ></span>
      <span class="shrink-0">
        {p.name}
        {#if p.peerId === room.selfId}<span class="text-dim"> (вы)</span>{/if}
      </span>
      {#if p.peerId === room.hostId}
        <span class="text-accent bg-accent-soft shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold">ХОСТ</span>
      {/if}
      {#if p.file}
        <span class="text-dim ml-auto min-w-0 truncate text-xs" title={p.file.name}>
          🎞 {p.file.name}
        </span>
        <span class="text-dim shrink-0 text-xs">{mb(p.file.size)}</span>
      {:else}
        <span class="text-dim ml-auto shrink-0 text-xs">без файла</span>
      {/if}
    </div>
  {/each}
</div>

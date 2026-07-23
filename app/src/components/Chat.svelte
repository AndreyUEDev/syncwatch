<script lang="ts">
  import { room } from '$lib/stores/room.svelte';

  let text = $state('');
  let scroller: HTMLElement | null = $state(null);
  let emojiOpen = $state(false);

  const EMOJI = [
    '😂', '🤣', '😊', '😍', '🥰', '😎', '🤔', '😴',
    '😱', '😭', '🥺', '😳', '🤯', '💀', '👀', '🔥',
    '❤️', '💜', '👍', '👎', '👏', '🙏', '🎉', '🍿',
  ];

  $effect(() => {
    room.chat.length;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    room.sendChat(trimmed);
    text = '';
  }

  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
</script>

<div class="glass flex h-full min-h-0 flex-col">
  <div bind:this={scroller} class="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
    {#each room.chat as m}
      {#if m.system}
        <div class="text-dim py-0.5 text-center text-xs">{m.text}</div>
      {:else}
        <div class="text-sm leading-snug">
          <span class="text-dim text-[11px]">{hhmm(m.time)}</span>
          <span class="ml-1 font-semibold" class:text-accent={m.from === room.selfId}>
            {m.name}
          </span>
          <span class="ml-1 break-words">{m.text}</span>
        </div>
      {/if}
    {/each}
  </div>

  <div class="border-token relative border-t p-3">
    {#if emojiOpen}
      <div class="glass absolute bottom-full left-3 mb-2 grid grid-cols-8 gap-1 p-2">
        {#each EMOJI as e}
          <button
            class="hover:bg-[var(--surface-hover)] rounded-lg p-1 text-lg transition"
            onclick={() => {
              text += e;
              emojiOpen = false;
            }}
          >
            {e}
          </button>
        {/each}
      </div>
    {/if}
    <div class="flex gap-2">
      <button
        class="border-token hover:bg-[var(--surface-hover)] rounded-xl border px-2.5 text-lg transition"
        title="Смайлики"
        onclick={() => (emojiOpen = !emojiOpen)}
      >
        😊
      </button>
      <input
        class="field min-w-0 flex-1 py-2"
        placeholder="Сообщение…"
        maxlength="500"
        bind:value={text}
        onkeydown={(e) => e.key === 'Enter' && send()}
      />
      <button
        class="btn-grad px-3.5 py-2 text-sm disabled:opacity-40"
        disabled={!text.trim()}
        onclick={send}
      >
        ➤
      </button>
    </div>
  </div>
</div>

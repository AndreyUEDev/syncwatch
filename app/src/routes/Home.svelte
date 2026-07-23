<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { room } from '$lib/stores/room.svelte';
  import { updater } from '$lib/stores/updater.svelte';

  let joinCode = $state('');

  const DONATE_YOOKASSA = 'https://yookassa.ru/my/i/al5wQ1YjHkZQ/l';
  const DONATE_TRIBUTE = 'https://t.me/tribute/app?startapp=dNr0';
</script>

<main class="h-full overflow-y-auto">
  <div class="flex min-h-full items-center justify-center px-6 py-8">
    <div class="w-full max-w-md">
    <div class="mb-7 text-center">
      <div
        class="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-3xl text-4xl"
        style="background:var(--logo-grad);box-shadow:0 16px 40px -16px var(--accent)"
      >
        🎬
      </div>
      <h1 class="text-grad text-4xl font-bold tracking-tight">Syncwatch</h1>
      <p class="text-muted mt-2 text-sm">Смотрите видео вместе — каждый со своим файлом</p>
    </div>

    <div class="glass space-y-4 p-6">
      <input class="field" placeholder="Ваше имя" maxlength="24" bind:value={room.name} />

      <button
        class="btn-grad w-full"
        disabled={room.phase === 'connecting'}
        onclick={() => room.create()}
      >
        {room.phase === 'connecting' ? 'Подключение…' : 'Создать комнату'}
      </button>

      <div class="flex items-center gap-2">
        <div class="bg-divider h-px flex-1"></div>
        <span class="text-dim text-xs">или войти по коду</span>
        <div class="bg-divider h-px flex-1"></div>
      </div>

      <div class="flex gap-2">
        <input
          class="field flex-1 text-center font-mono text-lg uppercase tracking-[0.4em]"
          placeholder="КОД"
          maxlength="6"
          bind:value={joinCode}
          onkeydown={(e) => e.key === 'Enter' && joinCode.length >= 4 && room.join(joinCode)}
        />
        <button
          class="btn-ghost"
          disabled={joinCode.length < 4 || room.phase === 'connecting'}
          onclick={() => room.join(joinCode)}
        >
          Войти
        </button>
      </div>

      {#if room.phase === 'dead'}
        <p class="rounded-lg px-3 py-2 text-sm" style="background:var(--danger-soft);color:var(--danger)">
          {room.deadReason === 'room_not_found'
            ? 'Комната не найдена или закрыта'
            : `Ошибка: ${room.deadReason}`}
        </p>
      {/if}
    </div>

    <div class="glass mt-4 space-y-3 p-5 text-sm">
      <div class="flex items-center gap-3">
        <span class="text-muted">Плеер</span>
        <div class="bg-surface2 flex gap-1 rounded-xl p-1">
          <button
            class="seg rounded-lg px-3 py-1 text-xs transition"
            class:seg-on={room.player === 'mpv'}
            onclick={() => room.setPlayer('mpv')}
          >
            встроенный
          </button>
          <button
            class="seg rounded-lg px-3 py-1 text-xs transition"
            class:seg-on={room.player === 'vlc'}
            onclick={() => room.setPlayer('vlc')}
          >
            VLC
          </button>
        </div>
      </div>
      {#if room.player === 'vlc'}
        <p class="text-dim text-[11px] leading-relaxed">
          VLC запустится сам (должен быть установлен). Чат поверх видео — только во встроенном плеере.
        </p>
      {/if}

      <label class="text-muted flex cursor-pointer items-center gap-2.5 text-xs">
        <input
          type="checkbox"
          style="accent-color:var(--accent)"
          checked={updater.autoInstall}
          onchange={(e) => updater.setAutoInstall(e.currentTarget.checked)}
        />
        Автоматически устанавливать обновления
      </label>
      <label class="text-muted flex cursor-pointer items-center gap-2.5 text-xs">
        <input type="checkbox" style="accent-color:var(--accent)" bind:checked={room.relayOnly} />
        Всегда через relay (TURN)
      </label>
      <p class="text-dim -mt-1.5 pl-6 text-[11px]">Включи, если под VPN не соединяется напрямую.</p>
    </div>

    <div class="mt-6 text-center">
      <p class="text-dim mb-3 text-xs">Проект существует только благодаря вашим пожертвованиям</p>
      <div class="flex justify-center gap-2">
        <button class="pill text-sm" onclick={() => openUrl(DONATE_YOOKASSA)}>💳 ЮKassa</button>
        <button class="pill text-sm" onclick={() => openUrl(DONATE_TRIBUTE)}>💜 Tribute</button>
      </div>
    </div>
    </div>
  </div>
</main>

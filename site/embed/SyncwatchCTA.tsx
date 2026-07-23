'use client';

// Ненавязчивый блок «Смотреть вместе» для страницы тайтла AniTrack (Next.js 16 / React 19).
// Клиентский компонент: localStorage-скрытие + deep-link в приложение с фолбэком на скачивание.
//
// Использование на серверной странице тайтла:
//   import { SyncwatchCTA } from '@/components/SyncwatchCTA';
//   <SyncwatchCTA title={anime.title} />
//
// Кнопка пытается открыть установленное приложение через syncwatch://create?title=...,
// если приложение не установлено — уводит на страницу/релиз загрузки.

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'sw_rec_dismissed';
const DOWNLOAD_URL = 'https://github.com/AndreyUEDev/syncwatch/releases/latest';

export function SyncwatchCTA({
  title,
  downloadUrl = DOWNLOAD_URL,
}: {
  title: string;
  downloadUrl?: string;
}) {
  // На сервере и до гидрации ничего не показываем — иначе рассинхрон с localStorage.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) !== '1') setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  }

  function open() {
    const link = `syncwatch://create?title=${encodeURIComponent(title)}`;
    // Если приложение не откроется за 1.5с — уводим на загрузку.
    const fallback = setTimeout(() => {
      window.location.href = downloadUrl;
    }, 1500);
    // Приложение открылось → вкладка теряет фокус → отменяем фолбэк.
    window.addEventListener('blur', () => clearTimeout(fallback), { once: true });
    window.location.href = link;
  }

  return (
    <div className="relative flex max-w-2xl items-center gap-3 rounded-xl border border-violet-500/35 bg-gradient-to-br from-violet-600/12 to-violet-400/5 px-4 py-3 text-zinc-100">
      <span className="shrink-0 text-2xl">🎬</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Смотреть вместе с друзьями</div>
        <div className="mt-0.5 text-xs text-zinc-400">
          Синхронный просмотр с чатом через Syncwatch — каждый со своим файлом.
        </div>
      </div>
      <button
        type="button"
        onClick={open}
        className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold hover:bg-violet-500"
      >
        Создать комнату
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Скрыть"
        className="absolute right-2 top-1.5 text-zinc-500 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

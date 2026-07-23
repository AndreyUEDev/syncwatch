import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';

/**
 * Обработка ссылок syncwatch://
 *   syncwatch://create?title=<название>  — создать комнату (title = метка сессии)
 *   syncwatch://join?code=<код>          — войти в комнату по коду
 */
export interface DeepLinkAction {
  kind: 'create' | 'join';
  title?: string;
  code?: string;
}

function parse(url: string): DeepLinkAction | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'syncwatch:') return null;
  // syncwatch://create?... → host = "create"
  const action = u.host || u.pathname.replace(/^\/+/, '');
  if (action === 'create') {
    return { kind: 'create', title: u.searchParams.get('title') ?? undefined };
  }
  if (action === 'join') {
    const code = u.searchParams.get('code');
    if (code) return { kind: 'join', code };
  }
  return null;
}

/** Подписка на входящие ссылки + разбор ссылки, с которой приложение было запущено. */
export async function initDeepLinks(handle: (a: DeepLinkAction) => void) {
  try {
    const startup = await getCurrent();
    for (const url of startup ?? []) {
      const a = parse(url);
      if (a) handle(a);
    }
  } catch {
    // getCurrent недоступен вне десктопа — не критично
  }

  try {
    await onOpenUrl((urls) => {
      for (const url of urls) {
        const a = parse(url);
        if (a) handle(a);
      }
    });
  } catch {
    // плагин недоступен — тихо игнорируем
  }
}

// Статичная страница загрузки: i18n ru/en, ссылки, подтягивание версии из GitHub Releases.

const GITHUB_REPO = 'AndreyUEDev/syncwatch';
const YOOKASSA_URL = 'https://yookassa.ru/my/i/al5wQ1YjHkZQ/l';
const TRIBUTE_URL = 'https://t.me/tribute/app?startapp=dNr0';
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

const I18N = {
  ru: {
    nav_how: 'Как работает',
    nav_faq: 'Вопросы',
    hero_title: 'Смотрите вместе — каждый со своим файлом',
    hero_sub:
      'Syncwatch синхронизирует воспроизведение между всеми участниками комнаты: пауза, перемотка и выбор серии происходят у всех одновременно. Плюс чат поверх видео.',
    download: 'Скачать для Windows',
    download_hint: 'Бесплатно · Windows 10/11 · ~90 МБ',
    disclaimer:
      'Syncwatch — инструмент синхронного воспроизведения. Приложение не содержит, не хостит и не распространяет видеоконтент; воспроизводятся только локальные файлы участников.',
    how_title: 'Как это работает',
    step1_t: 'Создайте комнату',
    step1_d: 'Получите короткий код и отправьте друзьям.',
    step2_t: 'Все выбирают файлы',
    step2_d: 'У каждого своя локальная копия. Добавьте папку с сериями — плейлист соберётся сам.',
    step3_t: 'Смотрите синхронно',
    step3_d: 'Пауза и перемотка у одного — у всех. Чат отображается поверх видео.',
    support_title: 'Поддержите проект',
    support_text:
      'Syncwatch существует только благодаря вашим пожертвованиям. Серверы, разработка и обновления — на энтузиазме. Любая помощь ускоряет развитие.',
    faq_title: 'Частые вопросы',
    faq1_q: 'Работает ли под VPN?',
    faq1_a:
      'Да. Если прямое соединение не проходит (VPN, строгий NAT), Syncwatch автоматически использует защищённый relay-сервер на порту 443. Синхронизация продолжает работать.',
    faq2_q: 'Нужно ли всем иметь одинаковый файл?',
    faq2_a:
      'Желательно. Программа сверяет имя и размер и подсвечивает несовпадения. При разных файлах синхронизация по времени всё равно работает, но точность может снизиться.',
    faq3_q: 'Windows пишет «Защита SmartScreen»?',
    faq3_a:
      'Приложение новое и пока без платной подписи. Нажмите «Подробнее» → «Выполнить в любом случае». Все релизы проверяются на VirusTotal.',
    faq4_q: 'Передаётся ли видео через интернет?',
    faq4_a:
      'Нет. Передаются только команды управления и чат — считанные килобайты. Видео каждый воспроизводит со своего диска.',
    footer_legal: 'Правовая информация',
  },
  en: {
    nav_how: 'How it works',
    nav_faq: 'FAQ',
    hero_title: 'Watch together — each with your own file',
    hero_sub:
      'Syncwatch keeps playback in sync for everyone in the room: pause, seek and episode switching happen for all at once. Plus chat on top of the video.',
    download: 'Download for Windows',
    download_hint: 'Free · Windows 10/11 · ~90 MB',
    disclaimer:
      'Syncwatch is a playback synchronization tool. It does not contain, host or distribute any video content; only participants’ local files are played.',
    how_title: 'How it works',
    step1_t: 'Create a room',
    step1_d: 'Get a short code and send it to friends.',
    step2_t: 'Everyone picks files',
    step2_d: 'Each has their own local copy. Add a folder of episodes — the playlist builds itself.',
    step3_t: 'Watch in sync',
    step3_d: 'One person pauses or seeks — everyone follows. Chat shows over the video.',
    support_title: 'Support the project',
    support_text:
      'Syncwatch exists only thanks to your donations. Servers, development and updates run on enthusiasm. Any help speeds things up.',
    faq_title: 'FAQ',
    faq1_q: 'Does it work under a VPN?',
    faq1_a:
      'Yes. If a direct connection fails (VPN, strict NAT), Syncwatch automatically falls back to a secure relay on port 443. Sync keeps working.',
    faq2_q: 'Does everyone need the same file?',
    faq2_a:
      'Preferably. The app compares name and size and highlights mismatches. With different files time-based sync still works, but accuracy may drop.',
    faq3_q: 'Windows shows a SmartScreen warning?',
    faq3_a:
      'The app is new and not yet code-signed. Click "More info" → "Run anyway". Every release is checked on VirusTotal.',
    faq4_q: 'Is video sent over the internet?',
    faq4_a:
      'No. Only control commands and chat are sent — a few kilobytes. Everyone plays the video from their own disk.',
    footer_legal: 'Legal',
  },
};

function applyLang(lang) {
  document.documentElement.lang = lang;
  const dict = I18N[lang];
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  }
  document.getElementById('langToggle').textContent = lang === 'ru' ? 'EN' : 'RU';
  localStorage.setItem('sw_lang', lang);
}

function initLang() {
  const saved = localStorage.getItem('sw_lang');
  const lang = saved || (navigator.language.startsWith('ru') ? 'ru' : 'en');
  applyLang(lang);
  document.getElementById('langToggle').addEventListener('click', () => {
    applyLang(document.documentElement.lang === 'ru' ? 'en' : 'ru');
  });
}

function initLinks() {
  document.getElementById('downloadBtn').href = RELEASES_URL;
  document.getElementById('yookassaBtn').href = YOOKASSA_URL;
  document.getElementById('tributeBtn').href = TRIBUTE_URL;
}

// Подтянуть версию и прямую ссылку на .exe из последнего релиза (не критично при ошибке).
async function fetchLatest() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!r.ok) return;
    const data = await r.json();
    if (data.tag_name) document.getElementById('verLabel').textContent = data.tag_name;
    const setup = (data.assets || []).find((a) => /\.(exe|msi)$/i.test(a.name));
    if (setup) document.getElementById('downloadBtn').href = setup.browser_download_url;
  } catch {
    // офлайн или нет релизов — остаётся ссылка на страницу релизов
  }
}

initLang();
initLinks();
fetchLatest();

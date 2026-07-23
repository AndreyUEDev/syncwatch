# Syncwatch — контекст проекта

P2P-клон Syncplay для совместного просмотра аниме. Каждый участник — со своей локальной копией файла; синхронизируются play/pause/seek/скорость + чат. Автор: Andrey. Язык общения и UI — русский (en на странице загрузки).

## Архитектура

```
Клиент (Tauri 2 + Svelte 5 + Tailwind 4, Windows)
├── WebView2: весь сетевой код (WebRTC RTCPeerConnection, full mesh ≤10 чел)
│   ├── ctrl-канал: reliable+ordered — actions, чат, room_state, clock ping
│   └── telemetry-канал: unordered, maxRetransmits:0 — state_report 1 Гц
├── Rust: player.rs — диспетчер плееров (mpv/VLC), оба шлют события в mpv://prop/event
│   ├── mpv: JSON IPC named pipe \\.\pipe\syncwatch-mpv-{pid}, бандлится, дефолт
│   └── VLC: HTTP-интерфейс (status.json 4Гц, pl_forcepause/seek/rate/in_play), опция
└── Плеер — отдельное окно; юзер может управлять хоткеями (эхо-фильтр отличает от sync)

Сервер (Cloudflare Worker + Durable Object, бесплатный тир)
├── 1 комната = 1 DO (WebSocket Hibernation), код 6 символов без 0O1IL
├── чистый relay SDP/ICE, комната умирает через 10 мин пустоты (alarm)
└── TURN: Cloudflare Realtime TURN, эфемерные креды из Worker (секреты TURN_KEY_ID/TOKEN)
```

**VPN-требование**: юзеры часто под VPN → обязательный TURN fallback `turns:443?tcp`, WS reconnect с resumeToken (тот же peerId), ICE restart, никакой привязки к IP.

## Ключевые решения

- **Фильтр эха mpv** (сердце UX): перед своей командой Rust ставит expectation (prop, value, TTL 500мс); совпавшее property-change = эхо (origin `own`), несовпавшее = юзер нажал хоткей в mpv (origin `user`) → уходит в комнату как action. Первое уведомление свойства = `init` (не действие). Свои seek считаются счётчиком own_seeks.
- **Sync-модель**: leaderless last-action-wins (Lamport seq + tiebreak peerId); эталон времени для дрейфа — хост (создатель), хост не подстраивается. Миграция хоста: сервер назначает min peerId, шлёт host_changed.
- **Дрейф** (не-хост): <0.1с ничего; 0.1–2.5с speed ×1.05/0.95; ≥2.5с seek absolute+exact. Компенсация RTT: NTP-подобные clock_ping/pong, медиана 8 замеров.
- **Загрузка файла** не автоиграет: file-loaded → engine.syncToRoom() (встать в состояние комнаты).
- EOF при keep-open → mpv сам ставит паузу → уходит как pause-action всем (фича: все встали в конце).
- Комментарии в коде — русские; Tauri identifier: app.syncwatch.desktop.

## Протокол (shared/src/protocol.ts — единый источник типов)

Сигналинг: WS `/ws/new` или `/ws/{code}`, первое сообщение `auth{name,resumeToken,ver}` → `created/joined{peerId,resumeToken,hostId,peers,turn}`; `signal` relay; `peer_joined/peer_left/host_changed`.
P2P ctrl: `hello, action{seq,actorId,kind,pos,speed,tSent}, room_state, chat, ready, file, clock_ping/pong` (+ план: `playlist`, `have`).
Telemetry: `state_report{pos,paused,speed,tSent}`.

## Структура

- `app/src/lib/net/` — signaling.ts (reconnect backoff+resume), peer.ts (RTCPeerConnection, glare), mesh.ts
- `app/src/lib/sync/` — engine.ts (last-wins, drift, RTT), clock.ts
- `app/src/lib/stores/` — player.svelte.ts (зеркало mpv), room.svelte.ts (клей всего)
- `app/src/routes/` Home/Room; `app/src/components/` PlayerBar, PeerList, Chat
- `app/src-tauri/src/mpv/` — mod.rs (supervisor), ipc.rs (pipe, эхо-фильтр), locate.rs (SYNCWATCH_MPV env → рядом с exe → ресурсы → PATH)
- `server/src/` — index.ts (роутинг+коды), room.ts (DO), turn.ts (минт кредов, кэш)
- `site/` — статичная страница загрузки (ru/en, Boosty/Ko-fi) для вставки на сайт автора

## Статус (2026-07-18)

**Готово (код + проверки):**
- Комнаты, mesh, чат, sync play/pause/seek/speed, файл-диалог, фильтр эха, EOF-пауза — проверено живьём (2 инстанса).
- Сервер-смоук: create/join/relay/resume/host-миграция. 19 юнит-тестов (vitest): median, last-wins, дрейф, natural sort, коды комнат.
- Плейлист серий: добавление файлов/папки, natural sort, размеры МБ, локальное соответствие ✓/⚠/✗, счётчик «у скольких есть» n/N, двойной клик = серия всем, автопереход хоста на EOF, авто-подтягивание из последней папки.
- OSD-чат поверх mpv (ass-overlay {\an7} слева сверху, автоскрытие 8с), эмодзи-панель.
- PeerList показывает файл и размер каждого участника.
- Автообновления (tauri-plugin-updater): плашка «Обновить»/«Перезапустить», настройка автоустановки. Ключ minisign сгенерирован, pubkey в конфиге.
- Донаты Boosty + Tribute, дисклеймер в приложении. Метаданные exe (publisher/copyright).
- Юр-часть: LEGAL.md, THIRD-PARTY.md, дисклеймеры.
- Страница загрузки site/ (ru/en, Boosty/Tribute, версия из Releases API, FAQ VPN/SmartScreen) — проверена в браузере.
- RELEASE.md: пошаговый деплой + AV white-lists.
- Устойчивость: WS reconnect (backoff+resumeToken), ICE restart (peer.ts), хост-миграция.

**Задеплоено (2026-07-18):**
- Worker: https://syncwatch-signal.andrey3dcg.workers.dev (боевой смоук OK). VITE_SIGNAL_URL в app/.env.
- GitHub: https://github.com/AndreyUEDev/syncwatch (публичный). Релиз v0.1.0: setup.exe (37МБ, mpv внутри) + .sig + latest.json. Updater endpoint отдаёт latest.json, setup.exe качается (HTTP 200).
- mpv.exe забандлен в инсталлятор (app/src-tauri/mpv/, gitignore для бинаря).

**Донаты:** только Tribute `https://t.me/tribute/app?startapp=dNr0` (Boosty убран по решению автора — комиссия). В Home.svelte, site/, релизном инсталляторе.

**Осталось (не код):**
- TURN key для VPN-юзеров без прямого пути (СЛЕДУЮЩИЙ ШАГ): CF dashboard → Realtime → TURN → Create → взять Key ID + Token → `wrangler secret put TURN_KEY_ID` + `TURN_KEY_TOKEN` в server/, redeploy. turn.ts уже готов минтить креды. Без него — только STUN (часть VPN не соединится).
- Выложить site/ на AnimeDB + встроить site/embed/syncwatch-embed.html на страницы тайтлов.
- Сабмиты в AV white-lists (Kaspersky Allowlist и др.) — setup.exe готов в релизе v0.1.0.
- Реконнект-тест под реальным VPN.
- **Отозвать токены GH_TOKEN и CLOUDFLARE_API_TOKEN** (засветились в чате). Для новых действий (wrangler/gh) завтра создать свежие.

## Dev-заметки

- `pnpm tauri dev` в app/ (env `SYNCWATCH_MPV=D:\mpv-x86_64-20260626-git-c75b8d2cca\mpv.exe`); vite строго 127.0.0.1:5173 (IPv6-бага) и игнорит src-tauri в watcher.
- Сигналка локально: `npx wrangler dev --port 8787` в server/; клиент берёт `VITE_SIGNAL_URL` или ws://127.0.0.1:8787.
- Второй инстанс для P2P-теста: скопировать target/debug/syncwatch.exe в другую папку и запустить (pipe per-PID). ОБА инстанса делят WebView2-профиль (один identifier) → общий localStorage.
- Касперский: папка Z:\Git\Syncwatch в исключениях (иначе жрёт свежий exe). Vite watcher + cargo → EBUSY без ignored src-tauri.
- tauri build падал «Отказано в доступе» если dev-инстанс запущен (exe залочен).

## Антивирусы / SmartScreen (релизный чеклист)

Бесплатной подписи кода НЕ существует; бесплатно доступны white-lists:
1. **Kaspersky Allowlist**: https://allowlist.kaspersky.com → отправить релизный exe/инсталлятор (бесплатно, 1-3 дня).
2. **Microsoft**: https://www.microsoft.com/en-us/wdsi/filesubmission → «software developer» submission (Defender + SmartScreen репутация).
3. **VirusTotal** прогон каждого релиза; каждому сработавшему вендору — false positive репорт.
4. **Dr.Web**: https://vms.drweb.ru/sendvirus (для RU-аудитории актуально).
5. Метаданные exe (publisher/copyright/description в tauri.conf) — снижают эвристику.
6. Раздача только с GitHub Releases (репутация домена).
7. Позже за деньги: OV-сертификат (~$70–200/год) или Azure Trusted Signing — убирает SmartScreen полностью.
Пока без подписи: на странице загрузки инструкция «SmartScreen → Подробнее → Выполнить в любом случае».

## Внешние зависимости от юзера

- Cloudflare аккаунт (бесплатный) для деплоя Worker + TURN key.
- Ссылки Boosty/Ko-fi (сейчас заглушки boosty.to/syncwatch, ko-fi.com/syncwatch).
- GitHub-репо для Releases.
- Сабмиты в AV white-lists после первого релизного билда.

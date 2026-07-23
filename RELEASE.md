# Релиз Syncwatch

## Разовая подготовка

1. **Cloudflare (сигналинг + TURN)** — бесплатно:
   ```
   cd server
   npx wrangler login
   npx wrangler deploy
   ```
   Получишь адрес `https://syncwatch-signal.<аккаунт>.workers.dev`. В `app/` создай `.env` с
   `VITE_SIGNAL_URL=wss://syncwatch-signal.<аккаунт>.workers.dev`.
   TURN: дашборд Cloudflare → Realtime → TURN → создать ключ, затем:
   ```
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_TOKEN
   ```

2. **Ключ обновлений** — уже сгенерирован: `C:\Users\andre\.syncwatch\updater.key(.pub)`.
   Публичный ключ вписан в `tauri.conf.json`. Приватный держи в секрете, для CI — в `TAURI_SIGNING_PRIVATE_KEY`.

3. **mpv для бандла**: положить `mpv.exe` + `COPYING` в `app/src-tauri/mpv/`, включить в
   `tauri.conf.json → bundle.resources`. (Пока dev использует `SYNCWATCH_MPV`.)

## Сборка релиза

```
set TAURI_SIGNING_PRIVATE_KEY_PATH=C:\Users\andre\.syncwatch\updater.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
cd app
pnpm tauri build
```
Артефакты: NSIS-инсталлятор `.exe`, `.sig`, `latest.json` в `app/src-tauri/target/release/bundle/`.

## Публикация

1. Создать GitHub-репо `AndreyUEDev/syncwatch`, тег версии.
2. Залить в GitHub Release: инсталлятор `.exe`, `.sig`, `latest.json`.
   (Автообновление в приложении читает `latest.json` из latest-релиза.)
3. Обновить `site/` (ссылки Boosty/Tribute), выложить на сайт автора — версия и прямая ссылка
   подтянутся из Releases API автоматически.

## Антивирусы / SmartScreen (после первого билда)

Бесплатной подписи кода нет; бесплатны white-lists (снижают/убирают детекты):

| Куда | Ссылка | Что даёт |
|---|---|---|
| Kaspersky Allowlist | https://allowlist.kaspersky.com | RU-аудитория, приоритет |
| Microsoft (SmartScreen+Defender) | https://www.microsoft.com/en-us/wdsi/filesubmission | «software developer» → репутация |
| Dr.Web | https://vms.drweb.ru/sendvirus | RU |
| VirusTotal | https://www.virustotal.com | прогон + отправка FP-репортов сработавшим вендорам |

Метаданные exe (publisher/copyright/description) уже прописаны — снижают эвристику.
Раздача только через GitHub Releases (репутация домена).
Платно позже: OV code-signing (~$70–200/год) или **Azure Trusted Signing** (~$10/мес, дешевле) —
полностью убирает SmartScreen.

На странице загрузки уже есть FAQ-пункт «SmartScreen → Выполнить в любом случае».

# Стороннее ПО в составе Syncwatch

## mpv

- Назначение: воспроизведение видео (отдельный процесс, управляется по JSON IPC).
- Лицензия: GNU GPL v2 или новее (части — LGPLv2.1+). Текст: https://github.com/mpv-player/mpv/blob/master/Copyright
- Исходный код: https://github.com/mpv-player/mpv
- Используемая Windows-сборка: https://github.com/shinchiro/mpv-winbuild-cmake (исходники сборочной системы там же).
- Форма распространения: немодифицированный отдельный исполняемый файл рядом с приложением (mere aggregation, GPL §2). По запросу на почту автора предоставим копию исходников соответствующей версии.

В инсталлятор включается файл `mpv/COPYING` с текстом лицензии из сборки mpv.

## Основные библиотеки приложения (статически/npm)

- Tauri (MIT/Apache-2.0), Svelte (MIT), Tailwind CSS (MIT), tokio (MIT), serde (MIT/Apache-2.0).
- Полный список: `pnpm licenses list` и `cargo license` по репозиторию.

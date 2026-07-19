# CONTEXT — HushHush Project

**Desktop-приложение для слайд-шоу** на Wails v2 (Go + Vue/Vite).

## Стек

- **Go 1.26.5** — бэкенд (чтение файлов, EXIF, конфиг, предзагрузка)
- **Wails v2.13.0** — десктопный шелл + WebView2
- **Vanilla JS** — фронтенд без фреймворков (ES modules)
- **Vite 6.4.3** — сборка и hot-reload

## Текущее состояние (19.07.2026)

### Что работает
- ✅ Выбор папки через диалог
- ✅ Drag & drop папки
- ✅ Слайд-шоу с настраиваемым интервалом (1–3600 с)
- ✅ Cover (без полей) при совпадении ориентаций изображения и экрана
- ✅ Contain + размытый фон при несовпадении ориентаций
- ✅ EXIF-ориентация (1–8)
- ✅ 4 эффекта входа (Fade / Ken Burns / Zoom / Blur) — переключаются через меню ✨
- ✅ Эффект Zoom: от увеличенного центра (scale 1.06–1.12) к нормальному
- ✅ Эффект Blur: размытие blur(6px) → чётко за 0.6s
- ✅ Ken Burns: медленный zoom + панорамирование на всё время показа
- ✅ Fullscreen (F / кнопка ⛶)
- ✅ Пауза (Space) — заморозка анимации
- ✅ Кнопка выхода (✕ / Q)
- ✅ Клавиши: ← → Space +/- F S Q Esc
- ✅ Курсор: видим, скрывается через 3с без движения
- ✅ Определение размеров изображений (JPEG, PNG, GIF, WebP)
- ✅ Конфиг сохраняется в %APPDATA%/HushHush/config.json
- ✅ Автозагрузка последней папки
- ✅ Предзагрузка 3 следующих кадров

### Известные проблемы
- AVIF: размеры не определяются (нет декодера в Go) — fallback на contain+blur
- При первом запуске после выбора папки первый кадр показывается без вступительной анимации

### Архитектура

```
app.go          — Go-бэкенд: GetImageData, OpenFolderDialog, GetImages, Config, Preloader
exif.go         — Парсер EXIF-ориентации (без внешних зависимостей)
preloader.go    — Конкурентный кеш с предзагрузкой

frontend/
  index.html    — Два img-слоя + stage-bg + controls + effects menu
  src/
    main.js     — Точка входа: создаёт UI + Slider
    ui.js       — Отображение: setImage, Ken Burns, эффекты входа, fullscreen, quit
    slider.js   — Логика: смена кадров, таймер, клавиши, интервал
    styles.css  — Тёмная тема, два слоя, blur-фон, меню эффектов
```

### Эффекты (меню ✨)
| Эффект | Вход | Ken Burns |
|---|---|---|
| Fade | только cross-fade | да |
| Ken Burns | без входа | да |
| Zoom | scale(1.06–1.12) → scale(1.0), 0.6s | да |
| Blur | blur(6px) → none, 0.6s | да |

### Сборка
```powershell
cd D:\GitHub\HushHush
wails build          # -> build/bin/HushHush.exe
wails dev            # dev-режим с hot-reload
```

### История сессий

#### Сессия 1 (первый запуск)
- Установлен Wails CLI
- Исправлена ошибка `UseToolbar` (удалено поле)
- Исправлен импорт `../../wailsjs` → `../wailsjs` в slider.js
- Первый успешный `wails dev`

#### Сессия 2 (курсор + картинки)
- Курсор: скрывается через 3с без движения, видим при движении
- Изображения: через `GetImageData()` с base64 data URI
- Добавлен прелоадер

#### Сессия 3 (fullscreen + cross-fade + ориентация)
- Fullscreen через `window.runtime.WindowFullscreen()`
- Два img-слоя для cross-fade
- EXIF-ориентация (exif.go + CSS transform)
- Ken Burns эффект

#### Сессия 4 (cover + blur)
- Обнаружена проблема: `image.DecodeConfig` без blank-imports не работал
- Добавлены `_ "image/jpeg"`, `_ "image/png"`, `_ "image/gif"`
- Добавлен `golang.org/x/image/webp` для WebP
- Cover/contain + размытый фон

#### Сессия 5 (эффекты + кнопка выхода)
- Система эффектов: Fade, Ken Burns, Zoom, Blur
- Кнопка выхода ✕
- Исправления:
  - Zoom: от увеличенного (1.06–1.12) → нормальному
  - Blur: добавил `filter: ''` после force reflow (было размыто навсегда)
  - Кнопки: `bindEvents()` вынесен в конструктор Slider
  - Fullscreen: try/catch + fallback
  - Интервал: `syncControls` после изменения
  - **Критический баг:** в HTML отсутствовал `<button id="btn-folder">` — конструктор Slider падал при попытке повесить обработчик на null → все кнопки были мёртвыми. Добавлена кнопка в controls-right.

# HushHush

Кастомный слайдер для демонстрации фото и изображений из каталога на Windows 10/11.

## Стек

- **Backend**: Go (чтение файловой системы, предзагрузка, настройки)
- **Frontend**: HTML/CSS/JS через [Wails](https://wails.io) (нативный WebView2)
- **Сборка**: `wails build` → один `.exe` ~8–12 MB

## Ключевые возможности

- ✅ Настраиваемый интервал смены кадра (горячие клавиши `+` / `-`, слайдер в UI)
- ✅ Предзагрузка следующих 2–3 кадров в фоне — нет зависаний
- ✅ Чистый полноэкранный режим без всплывающих элементов управления
- ✅ Элементы управления показываются только по явному действию (клик / `Esc`)
- ✅ Запоминание последней папки и настроек (`%APPDATA%/HushHush/config.json`)
- ✅ Зацикливание и режим Shuffle (случайный порядок)
- ✅ Поддержка форматов: JPG, PNG, GIF, WebP, AVIF

## Установка и запуск (dev)

```bash
# Требования: Go 1.21+, Node.js, Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Клонировать и запустить
git clone https://github.com/AlexanderKuzikov/HushHush
cd HushHush
wails dev
```

## Сборка

```bash
wails build
# Результат: build/bin/HushHush.exe
```

## Контекст проекта

См. [CONTEXT.md](./CONTEXT.md)

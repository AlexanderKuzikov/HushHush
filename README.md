<div align="center">

# 🖼 HushHush

**Кастомный слайдер для демонстрации фото и изображений из каталога на Windows 10/11**

[![Go](https://img.shields.io/badge/Go-1.26.5-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev)
[![Wails](https://img.shields.io/badge/Wails-v2.12.0-FF3E00?style=for-the-badge&logo=wails&logoColor=white)](https://wails.io)
[![Node.js](https://img.shields.io/badge/Node.js-v24_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-In_Development-orange?style=for-the-badge)]()

</div>

---

## 📋 О проекте

**HushHush** — замена стандартному Photos slideshow для Windows. Создан чтобы исправить его главные недостатки: зависания при смене кадров, всплывающие элементы управления и невозможность гибко настроить интервал показа.

### Чем отличается от Photos

| Функция | Windows Photos | HushHush |
|---|---|---|
| Настройка интервала | ❌ Фиксированный | ✅ 1–999 сек, горячие клавиши `+`/`-` |
| Зависания при загрузке | ❌ Есть | ✅ Предзагрузка 2–3 кадров в фоне |
| Чистый экран | ❌ Всплывают панели | ✅ UI скрыт в режиме показа |
| Запоминание настроек | ❌ Нет | ✅ `%APPDATA%/HushHush/config.json` |
| Размер приложения | ~500 MB (UWP) | ~10 MB (нативный .exe) |

---

## ✨ Функциональность

### MVP
- 📁 Выбор папки с изображениями через диалог
- 🖥 Полноэкранный показ изображений
- ⏱ Настраиваемый интервал смены кадра (1 сек – 60+ сек)
  - Слайдер / поле ввода прямо в UI
  - Горячие клавиши `+` / `-` во время показа
- ⚡ Предзагрузка следующих 2–3 кадров в фоновой горутине (нет зависаний)
- 🔁 Зацикливание слайд-шоу
- 🔀 Режим Shuffle (случайный порядок)
- 💾 Запоминание последней папки и настроек
- 🙈 Чистый экран — UI скрыт в режиме показа, появляется по клику или `Esc`

### Запланировано (v2)
- 🎞 Эффекты переходов (fade, slide)
- 📂 Поддержка нескольких папок
- 🚫 Исключение отдельных файлов из показа
- 🏷 Показ имени файла / даты (опционально)
- ⏸ Пауза при движении мыши
- 🖱 Drag & Drop папки на окно
- ⚙️ Разные интервалы для разных папок

### Поддерживаемые форматы
`JPG` `JPEG` `PNG` `GIF` `WebP` `AVIF`

---

## 🛠 Стек

| Слой | Технология | Версия | Назначение |
|---|---|---|---|
| Backend / логика | [Go](https://go.dev) | 1.26.5 | Чтение ФС, предзагрузка, настройки |
| Desktop bridge | [Wails](https://wails.io) | v2.12.0 | Нативный WebView2, сборка в .exe |
| Frontend / UI | HTML + CSS + JS | — | Интерфейс слайдера |
| Runtime (Windows) | Node.js | v24 LTS | Сборка frontend |

> **Почему не Electron?** Wails использует нативный WebView2, уже встроенный в Windows 10/11. Итоговый `.exe` весит ~10 MB против ~150 MB у Electron, а сборка — одна команда.

---

## 🚀 Быстрый старт (разработка)

### Требования

```bash
go 1.26.5+
node.js v24 LTS
wails v2.12.0
```

### Установка Wails CLI

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor   # проверка окружения
```

### Запуск в dev-режиме

```bash
git clone https://github.com/AlexanderKuzikov/HushHush
cd HushHush
wails dev
```

---

## 📦 Сборка

```bash
wails build
# Результат: build/bin/HushHush.exe (~10 MB)
```

---

## 📁 Структура проекта

```
HushHush/
├── main.go              # Точка входа, инициализация Wails-приложения
├── app.go               # Логика: чтение папки, фильтрация, настройки
├── preloader.go         # Фоновая предзагрузка изображений (горутины)
├── wails.json           # Конфигурация Wails
├── go.mod
├── build/
│   └── windows/         # Иконка, манифест Windows
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── main.js      # Инициализация
│   │   ├── slider.js    # Навигация, интервал, горячие клавиши
│   │   └── ui.js        # Управление видимостью элементов UI
│   └── styles.css
├── README.md
└── CONTEXT.md           # История разработки и контекст сессий
```

---

## ⌨️ Горячие клавиши

| Клавиша | Действие |
|---|---|
| `→` / `Space` | Следующее изображение |
| `←` | Предыдущее изображение |
| `+` | Увеличить интервал на 1 сек |
| `-` | Уменьшить интервал на 1 сек |
| `F` | Полный экран |
| `Esc` / Click | Показать / скрыть панель управления |
| `S` | Включить / выключить Shuffle |

---

## 📄 Лицензия

[MIT](LICENSE) © 2026 Alexander Kuzikov

# BUG REPORT — HushHush

**Дата:** 2026-07-19  
**Репозиторий:** [AlexanderKuzikov/HushHush](https://github.com/AlexanderKuzikov/HushHush)  

---

## BUG-001 — EXIF ориентация не работает для Big Endian файлов

**Severity:** 🔴 Critical  
**Файл:** `exif.go`, строка ~98  
**Статус:** Open

### Описание
Ориентация из EXIF читается как один байт без учёта ByteOrder:
```go
orientation := int(tiffHeader[entryOffset+8])
```
Для Big Endian (формат MM, используется в большинстве камер Canon, Nikon, DJI, некоторых iPhone) значение SHORT хранится в байтах `[0x00, 0x06]`. Код читает только первый байт `0x00`, возвращает `0`, что не входит в диапазон 1–8, и функция возвращает `1` (нормальная ориентация).

### Воспроизведение
1. Сделать фото вертикально камерой Canon / Nikon (или большинством зеркалок)
2. Открыть папку с этим фото в HushHush
3. Фото отображается горизонтально (повёрнуто на 90°)

### Ожидаемое поведение
Фото должно отображаться вертикально, как снято.

### Фикс
```go
// Было:
orientation := int(tiffHeader[entryOffset+8])

// Стало:
orientation := int(bo.Uint16(tiffHeader[entryOffset+8 : entryOffset+10]))
```

---

## BUG-002 — Drag & Drop папки не работает

**Severity:** 🔴 Critical  
**Файл:** `frontend/src/slider.js`, строки ~150–157  
**Статус:** Open

### Описание
`webkitGetAsEntry().fullPath` в Wails WebView (Chromium-embedded) возвращает виртуальный путь файловой системы браузера, например `/MyFolder`, а не реальный путь Windows `C:\Users\user\Pictures\MyFolder`. Функция `GetImages(folder)` на Go-стороне пытается открыть виртуальный путь, получает ошибку и возвращает `nil`.

### Воспроизведение
1. Перетащить папку с изображениями на окно HushHush
2. Ничего не происходит, изображения не загружаются
3. В консоли Wails никакой ошибки нет — silent fail

### Ожидаемое поведение
Папка должна открыться и начать воспроизведение.

### Фикс
Использовать Wails Events или диалог для получения пути вместо `webkitGetAsEntry`. Либо использовать `e.dataTransfer.files[0]` и Wails-специфичный API для получения нативного пути. В текущей архитектуре — убрать Drag & Drop или пометить как неработающий.

---

## BUG-003 — Утечка памяти: кэш preloader растёт без ограничений

**Severity:** 🔴 Critical  
**Файл:** `preloader.go`  
**Статус:** Open

### Описание
`Preloader.cache` — это `map[string][]byte`, который никогда не очищается. Метод `Evict()` существует, но нигде не вызывается. При просмотре большой папки (500+ фото по 5–15MB) приложение будет потреблять несколько гигабайт RAM и в конечном счёте упадёт из-за OOM.

### Воспроизведение
1. Открыть папку с 200+ фотографиями высокого разрешения (JPEG ~10MB каждая)
2. Запустить слайдшоу с минимальным интервалом (1 сек)
3. Через 5–10 минут мониторить RAM через Task Manager
4. RAM будет расти линейно, не освобождаясь

### Ожидаемое поведение
Память должна оставаться стабильной. Старые изображения должны вытесняться из кэша.

### Фикс
Реализовать LRU-кэш с ограничением размера (например, 50 изображений или 500MB). После вызова `showCurrent()` вызывать `Evict()` для изображений, выходящих за пределы окна ±N.

---

## BUG-004 — Double-Stop() вызывает panic

**Severity:** 🟠 High  
**Файл:** `preloader.go`, метод `Stop()`  
**Статус:** Open

### Описание
```go
func (p *Preloader) Stop() {
    close(p.stopChan) // panic если вызвать дважды
}
```
Повторный вызов `Stop()` вызывает `panic: close of closed channel`. В текущем коде это возникает только при одном `shutdown()`, но это хрупко.

### Фикс
```go
func (p *Preloader) Stop() {
    select {
    case <-p.stopChan:
        // уже остановлен
    default:
        close(p.stopChan)
    }
}
```

---

## BUG-005 — Ken Burns ghost-анимация при быстром переключении

**Severity:** 🟠 High  
**Файл:** `frontend/src/ui.js`, метод `setImage()`  
**Статус:** Open

### Описание
При Ken Burns-эффекте запускается `setTimeout` с задержкой 700ms. Если пользователь нажимает `next` до истечения 700ms, double-buffer меняет слои местами. Когда `setTimeout` срабатывает, он применяет анимацию к уже новому изображению (которое стало `newImg` в следующем вызове), создавая визуальный артефакт — следующее фото «прыгает».

### Воспроизведение
1. Установить эффект Ken Burns
2. Быстро нажимать `→` несколько раз подряд (быстрее 700ms)
3. На некоторых изображениях будет видна резкая смена transform в начале

### Фикс
Добавить счётчик поколений:
```javascript
this._generation = 0
// в setImage:
const gen = ++this._generation
setTimeout(() => {
    if (this._generation !== gen) return // уже устарело
    newImg.style.transition = ...
}, delay)
```

---

## BUG-006 — EXIF файл читается дважды (двойной I/O)

**Severity:** 🟠 High  
**Файл:** `app.go` + `exif.go`  
**Статус:** Open

### Описание
В `GetImageData()` данные файла загружаются через `preloader.Get(path)` или `os.ReadFile(path)`. Затем сразу вызывается `readExifOrientation(path)`, который открывает **тот же файл заново** через `os.Open(path)`. На SSD это незначительно, но на сетевых дисках или медленных HDD это удваивает время загрузки каждого изображения.

### Фикс
Изменить сигнатуру:
```go
func readExifOrientation(data []byte) int
```
И передавать уже загруженные `data` вместо `path`.

---

## BUG-007 — Path traversal в GetImageData

**Severity:** 🟠 High  
**Файл:** `app.go`, метод `GetImageData()`  
**Статус:** Open

### Описание
Фронтенд передаёт произвольный путь `path` в `GetImageData`. Нет проверки, что путь находится внутри выбранной папки (`LastFolder`). Если JavaScript-код (например, через XSS или модифицированный фронтенд) передаст `../../sensitive/file`, Go-код прочитает и вернёт его содержимое как base64.

### Фикс
```go
cleanPath := filepath.Clean(path)
cleanBase := filepath.Clean(a.config.LastFolder)
if !strings.HasPrefix(cleanPath, cleanBase+string(filepath.Separator)) {
    return result // отклонить
}
```

---

## BUG-008 — Повреждённый config.json приводит к смешанному состоянию

**Severity:** 🟡 Medium  
**Файл:** `app.go`, метод `loadConfig()`  
**Статус:** Open

### Описание
```go
_ = json.Unmarshal(data, &a.config)
```
При частично повреждённом JSON (например, файл был обрезан при записи) `Unmarshal` вернёт ошибку после частичной десериализации. Часть полей в `a.config` будет из файла, часть останется дефолтной. Возможны неочевидные баги поведения.

### Фикс
При ошибке десериализации — полностью сбрасывать к дефолтам:
```go
var loaded Config
if err := json.Unmarshal(data, &loaded); err == nil {
    a.config = loaded
}
// иначе остаётся дефолт из NewApp()
```

---

## BUG-009 — Swap Width/Height не применяется для ориентаций 5 и 7

**Severity:** 🟡 Medium  
**Файл:** `app.go`, метод `GetImageData()`  
**Статус:** Open

### Описание
```go
if result.Orientation == 6 || result.Orientation == 8 {
    result.Width, result.Height = h, w
}
```
Ориентации 5 и 7 (повёрнутые на 90° с зеркальным отражением) также требуют swap Width/Height, но код их не обрабатывает. `useCover` в `ui.js` будет вычислен неправильно для таких изображений.

### Фикс
```go
if result.Orientation == 5 || result.Orientation == 6 ||
   result.Orientation == 7 || result.Orientation == 8 {
    result.Width, result.Height = h, w
}
```

---

## BUG-010 — Клик по empty-state не открывает панель управления

**Severity:** 🟡 Medium  
**Файл:** `frontend/src/ui.js`, метод `_bindToggle()`  
**Статус:** Open

### Описание
```javascript
if (!inControls && !inEmpty) {
    this.toggleControls()
}
```
Клик по стартовому экрану (`emptyState`) явно исключён из условия `toggleControls()`. Пользователь, который уже открыл панель и закрыл её кликом, не может снова открыть её кликом по пустому экрану — нужно знать, что панель появляется только при клике на область **вне** emptyState и controls.

### Фикс
Убрать `!inEmpty` из условия, либо добавить отдельный обработчик клика на `emptyState`.

---

## BUG-011 — `package.json.md5` и `wailsjs/` в репозитории

**Severity:** 🟢 Low  
**Файл:** `.gitignore`  
**Статус:** Open

### Описание
`frontend/package.json.md5` — служебный файл Wails, генерируется автоматически. Файлы `wailsjs/` генерируются командой `wails generate module`. Оба типа не должны коммититься.

### Фикс
Добавить в `.gitignore`:
```
frontend/package.json.md5
frontend/wailsjs/
```

---

## Сводная таблица

| ID | Severity | Файл | Краткое описание |
|----|----------|------|------------------|
| BUG-001 | 🔴 Critical | `exif.go` | EXIF ориентация сломана для Big Endian (Canon, Nikon, DJI) |
| BUG-002 | 🔴 Critical | `slider.js` | Drag & Drop не работает в Wails — `fullPath` невалиден |
| BUG-003 | 🔴 Critical | `preloader.go` | Утечка памяти — кэш не ограничен |
| BUG-004 | 🟠 High | `preloader.go` | Double-Stop() → panic |
| BUG-005 | 🟠 High | `ui.js` | Ken Burns ghost-анимация при быстром переключении |
| BUG-006 | 🟠 High | `app.go`+`exif.go` | Двойное чтение файла при каждом изображении |
| BUG-007 | 🟠 High | `app.go` | Path traversal в GetImageData |
| BUG-008 | 🟡 Medium | `app.go` | Повреждённый config → смешанное состояние |
| BUG-009 | 🟡 Medium | `app.go` | Swap W/H не для ориентаций 5 и 7 |
| BUG-010 | 🟡 Medium | `ui.js` | Клик по empty-state не показывает controls |
| BUG-011 | 🟢 Low | `.gitignore` | Служебные файлы Wails в репозитории |

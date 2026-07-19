# BUG REPORT — HushHush

**Дата:** 2026-07-19 (обновлено: 2026-07-19 v2)  
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
Повторный вызов `Stop()` вызывает `panic: close of closed channel`.

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
При Ken Burns-эффекте запускается `setTimeout` с задержкой 700ms. Если пользователь нажимает `next` до истечения 700ms, double-buffer меняет слои местами. Когда `setTimeout` срабатывает, он применяет анимацию к уже новому изображению, создавая визуальный артефакт — следующее фото «прыгает».

### Воспроизведение
1. Установить эффект Ken Burns
2. Быстро нажимать `→` несколько раз подряд (быстрее 700ms)
3. На некоторых изображениях будет видна резкая смена transform в начале

### Фикс
```javascript
this._generation = (this._generation || 0) + 1
const gen = this._generation
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
При частично повреждённом JSON `Unmarshal` вернёт ошибку после частичной десериализации. Часть полей в `a.config` будет из файла, часть останется дефолтной.

### Фикс
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
Ориентации 5 и 7 тоже требуют swap Width/Height, но код их не обрабатывает. `useCover` в `ui.js` будет вычислен неправильно.

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
Клик по стартовому экрану явно исключён из условия `toggleControls()`. Пользователь не может снова открыть панель кликом по пустому экрану.

### Фикс
Убрать `!inEmpty` из условия, либо добавить отдельный обработчик клика на `emptyState`.

---

## BUG-011 — `package.json.md5` и `wailsjs/` в репозитории

**Severity:** 🟢 Low  
**Файл:** `.gitignore`  
**Статус:** Open

### Описание
`frontend/package.json.md5` — служебный файл Wails, генерируется автоматически. Файлы `wailsjs/` также генерируются автоматически. Оба не должны коммититься.

### Фикс
```
frontend/package.json.md5
frontend/wailsjs/
```

---

## BUG-012 — ❌ НОВОЕ: `exif.go` не валидирует `dataType` тега Orientation

**Severity:** 🟠 High  
**Файл:** `exif.go`  
**Статус:** Open

### Описание
По стандарту EXIF/TIFF тег `0x0112` (Orientation) имеет тип `SHORT` (dataType == 3). Код читает и дискардирует `dataType` без проверки:
```go
dataType := bo.Uint16(tiffHeader[entryOffset+2 : entryOffset+4])
_ = dataType
```
Если повреждённый EXIF содержит тег 0x0112 с другим типом данных, код прочитает неверное значение ориентации.

### Фикс
```go
dataType := bo.Uint16(tiffHeader[entryOffset+2 : entryOffset+4])
if dataType != 3 { // 3 = SHORT в TIFF
    break
}
```

---

## BUG-013 — ❌ НОВОЕ: Множественные `setTimeout(800ms)` при быстром переключении удаляют классы активной анимации

**Severity:** 🟠 High  
**Файл:** `frontend/src/ui.js`, метод `setImage()`  
**Статус:** Open

### Описание
```javascript
setTimeout(() => {
    ;[this.imgFront, this.imgBack].forEach(img => {
        img.classList.remove('enter', 'exit')
    })
}, 800)
```
Каждый вызов `setImage()` создаёт новый `setTimeout(800ms)`. При быстром переключении (каждые 200–500ms) создаётся 4–5 таймаутов, которые сработают почти одновременно и удалят классы с текущего активного `newImg`, прерывая его анимацию входа.

### Воспроизведение
1. Быстро нажимать `→` 5 раз за 2 секунды
2. На последнем изображении анимация появления резко обрывается

### Фикс
Хранить ID таймаута очистки и сбрасывать его:
```javascript
clearTimeout(this._cleanupTimer)
this._cleanupTimer = setTimeout(() => {
    ;[this.imgFront, this.imgBack].forEach(img => {
        img.classList.remove('enter', 'exit')
    })
}, 800)
```

---

## BUG-014 — ❌ НОВОЕ: Запись конфига на диск 60+ раз в секунду при движении слайдера

**Severity:** 🟡 Medium  
**Файл:** `frontend/src/slider.js`, метод `bindEvents()`  
**Статус:** Open

### Описание
```javascript
intervalSlider.addEventListener('input', (e) => {
    const v = parseInt(e.target.value)
    intervalInput.value = v
    this.setInterval(v) // → SetInterval(v) → saveConfig() → os.WriteFile()
})
```
Событие `input` на range-слайдере стреляет при каждом движении мыши. Каждый вызов проходит цепочку JS → Go IPC → `saveConfig()` → запись на диск. При быстром перетаскивании это 30–60 записей/сек — избыточная нагрузка на I/O и IPC.

### Фикс
Добавить debounce с задержкой 300ms:
```javascript
let debounceTimer
intervalSlider.addEventListener('input', (e) => {
    const v = parseInt(e.target.value)
    intervalInput.value = v
    this.interval = v
    this.ui.setDuration(v)
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => this.setInterval(v), 300)
})
```

---

## BUG-015 — ❌ НОВОЕ: Отсутствует Content-Security-Policy — XSS может вызвать Go API

**Severity:** 🔴 Critical  
**Файл:** `frontend/index.html`  
**Статус:** Open

### Описание
Wails v2 предоставляет JS-доступ к Go-методам через `window.go.*`. Без CSP любой инъецированный JS (например, через уязвимость в обработке имён файлов с HTML-символами) может:
- Вызвать `GetImageData()` с произвольным путём
- Вызвать `OpenFolderDialog()` без взаимодействия пользователя
- В теории — добраться до чувствительных файлов ОС

### Воспроизведение
Теоретическая атака: файл с именем `<img src=x onerror="GetImageData('/etc/passwd')">` в папке, отображаемый через `setName()`.

> **Примечание:** `setName()` использует `textContent`, а не `innerHTML`, поэтому данная конкретная атака не работает. Но CSP остаётся важной защитой in depth.

### Фикс
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
```

---

## BUG-016 — ❌ НОВОЕ: `showStage()` не сбрасывает состояние `imgBack`

**Severity:** 🟡 Medium  
**Файл:** `frontend/src/ui.js`, метод `showStage()`  
**Статус:** Open

### Описание
При смене папки вызывается `showStage()`, который сбрасывает только `imgFront`. `imgBack` содержит старое изображение, старые inline-стили и классы от предыдущей сессии. Первый переход после смены папки может дать неожиданный visual artifact.

### Фикс
```javascript
showStage() {
    this.emptyState.style.display = 'none'
    // Сброс обоих буферов
    ;[this.imgFront, this.imgBack].forEach(img => {
        img.src = ''
        img.style.cssText = ''
        img.className = ''
    })
    this.imgFront.style.display = 'block'
    this.imgFront.style.opacity = '1'
    this.imgFront.style.transform = orientationCSS(1) + ' scale(1.0)'
    this.imgFront.classList.add('active')
    this._activeImg = this.imgFront
}
```

---

## BUG-017 — ❌ НОВОЕ: `#stage-bg` blur выходит за границы (overflow не ограничен)

**Severity:** 🟢 Low  
**Файл:** `frontend/src/styles.css`  
**Статус:** Open

### Описание
Элемент `#stage-bg` имеет CSS `filter: blur()`, но родительский контейнер `#stage` не имеет `overflow: hidden`. Размытие «вытекает» за границы элемента, создавая полупрозрачные артефакты по краям экрана, особенно заметные на изображениях с контрастным фоном.

### Фикс
Добавить в CSS:
```css
#stage {
    overflow: hidden;
}
```

---

## BUG-018 — ❌ НОВОЕ: Нет обработки потери видимости окна (Page Visibility API)

**Severity:** 🟢 Low  
**Файл:** `frontend/src/slider.js`  
**Статус:** Open

### Описание
Когда окно Wails сворачивается, слайдшоу продолжает работать: таймеры тикают, `GetImageData()` читает файлы и кодирует их в base64, `PreloadImages()` загружает следующие изображения — всё это впустую расходует CPU и I/O.

### Фикс
```javascript
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearTimeout(this.timer)
    } else if (this.playing) {
        this.scheduleNext()
    }
})
```

---

## Сводная таблица

| ID | Severity | Файл | Краткое описание |
|----|----------|------|------------------|
| BUG-001 | 🔴 Critical | `exif.go` | EXIF ориентация сломана для Big Endian (Canon, Nikon, DJI) |
| BUG-002 | 🔴 Critical | `slider.js` | Drag & Drop не работает в Wails — `fullPath` невалиден |
| BUG-003 | 🔴 Critical | `preloader.go` | Утечка памяти — кэш не ограничен |
| BUG-015 | 🔴 Critical | `index.html` | Отсутствует CSP — уязвимость в глубину |
| BUG-004 | 🟠 High | `preloader.go` | Double-Stop() → panic |
| BUG-005 | 🟠 High | `ui.js` | Ken Burns ghost-анимация при быстром переключении |
| BUG-006 | 🟠 High | `app.go`+`exif.go` | Двойное чтение файла при каждом изображении |
| BUG-007 | 🟠 High | `app.go` | Path traversal в GetImageData |
| BUG-012 | 🟠 High | `exif.go` | dataType тега Orientation не валидируется |
| BUG-013 | 🟠 High | `ui.js` | Множественные setTimeout(800ms) обрывают анимацию |
| BUG-008 | 🟡 Medium | `app.go` | Повреждённый config → смешанное состояние |
| BUG-009 | 🟡 Medium | `app.go` | Swap W/H не для ориентаций 5 и 7 |
| BUG-010 | 🟡 Medium | `ui.js` | Клик по empty-state не показывает controls |
| BUG-014 | 🟡 Medium | `slider.js` | 60+ записей/сек на диск при движении слайдера |
| BUG-016 | 🟡 Medium | `ui.js` | showStage() не сбрасывает imgBack |
| BUG-011 | 🟢 Low | `.gitignore` | Служебные файлы Wails в репозитории |
| BUG-017 | 🟢 Low | `styles.css` | #stage-bg blur за пределами экрана |
| BUG-018 | 🟢 Low | `slider.js` | Нет обработки Page Visibility API |

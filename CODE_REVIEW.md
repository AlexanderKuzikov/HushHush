# CODE REVIEW — HushHush

**Дата:** 2026-07-19  
**Ревьюер:** Perplexity AI (claude-sonnet-4-5)  
**Репозиторий:** [AlexanderKuzikov/HushHush](https://github.com/AlexanderKuzikov/HushHush)  
**Стек:** Go + Wails v2 + Vanilla JS (Vite)

---

## Общая оценка

Проект — десктопный слайдер на Wails v2. Код **читаемый**, архитектура **понятная**. Однако при детальном разборе выявляется ряд серьёзных проблем: утечки памяти, race conditions, багованный EXIF-парсер, Drag & Drop не работает в Wails окружении, отсутствие тестов и error handling в критических местах.

**Общая оценка: 6/10**

---

## `app.go`

### ✅ Хорошо
- Валидация `SetInterval` (min 1 / max 3600) — правильно.
- Валидация `SetTransition` через `EffectNames` — правильно.
- Дефолтная конфигурация задаётся в `NewApp()` — правильно.
- `saveConfig()` создаёт директорию через `MkdirAll` — правильно.

### ❌ Критично

**1. `NewApp()` игнорирует ошибку `os.UserConfigDir()`**
```go
configDir, _ := os.UserConfigDir() // ошибка проглочена
```
Если `UserConfigDir()` вернёт ошибку (сломанная среда, Docker, headless), `configPath` станет `"/HushHush/config.json"` — относительный путь без директории. Конфиг будет записан в корень рабочей директории или упадёт.

**Фикс:**
```go
configDir, err := os.UserConfigDir()
if err != nil {
    configDir = "." // fallback
}
```

**2. `loadConfig()` игнорирует ошибку `json.Unmarshal`**
```go
_ = json.Unmarshal(data, &a.config)
```
Если файл конфига повреждён (обрезан, невалидный JSON), `Unmarshal` вернёт ошибку, которая молча игнорируется. При этом `a.config` может оказаться в частично десериализованном состоянии — часть полей из дефолтов, часть из файла.

**Фикс:** при ошибке Unmarshal — сбрасывать к дефолтам или логировать.

**3. `saveConfig()` игнорирует ошибку записи файла**
```go
_ = os.WriteFile(a.configPath, data, 0644)
```
Пользователь не получит никакого уведомления, если конфиг не сохранился (нет прав, диск полон). Настройки молча теряются.

**4. `GetImages()` не рекурсивная, но это не задокументировано**
Функция читает только верхний уровень папки. Это может быть намеренным решением, но нигде не задокументировано. Если пользователь выберет папку с подпапками — изображения из них молча игнорируются.

**5. `GetImageData()` — нет защиты от path traversal**
```go
func (a *App) GetImageData(path string) ImageData {
```
Фронтенд передаёт произвольный `path`. Хотя Wails ограничивает scope, на уровне Go нет проверки, что `path` находится внутри `LastFolder`. Теоретически JS-код (или XSS в будущем) может запросить любой файл файловой системы.

**Фикс:**
```go
if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(a.config.LastFolder)) {
    return result
}
```

**6. `decodeImageConfig()` возвращает 0,0 для AVIF без комментария о последствиях**
```go
if strings.ToLower(ext) == ".avif" {
    return 0, 0
}
```
В `GetImageData` нулевые размеры приводят к тому, что `useCover` всегда `false` для AVIF — изображение всегда будет в режиме `contain` с размытым фоном. Это silent fallback без информирования пользователя.

**7. Ориентация применяется только для значений 6 и 8**
```go
if result.Orientation == 6 || result.Orientation == 8 {
    result.Width, result.Height = h, w
}
```
Ориентации 5 и 7 (повёрнутые + зеркальные) тоже требуют swap Width/Height, но здесь не обрабатываются.

---

## `exif.go`

### ✅ Хорошо
- Ручной парсинг EXIF без внешних зависимостей — лёгкий, без overhead.
- Правильное определение byte order (II/MM).
- Bounds checking перед каждым доступом.

### ❌ Критично

**1. Ориентация читается неправильно для Big Endian**
```go
orientation := int(tiffHeader[entryOffset+8])
```
Значение ориентации (SHORT, 2 байта) читается как один байт напрямую, игнорируя `ByteOrder`. Для Little Endian это случайно работает (значение 1–8 влезает в первый байт), но для Big Endian (камеры Canon, Nikon, DJI) значение будет прочитано из старшего байта, что всегда даст `0` → вернётся `1` (нормальная ориентация). Фото с iPhone/Android, снятые вертикально, могут отображаться боком.

**Фикс:**
```go
orientation := int(bo.Uint16(tiffHeader[entryOffset+8 : entryOffset+10]))
```

**2. Маркер 0xD8 в цикле — неправильная логика**
```go
if marker == 0xD8 || marker == 0xD9 {
    pos += 2
    continue
}
```
`0xD8` — это SOI (Start of Image), встречается только в самом начале. В середине JPEG он не может появиться как валидный маркер секции. Обработка его как "перейти к следующему" — неверна. `0xD9` (EOI) должен завершать парсинг, а не пропускаться.

**Фикс:**
```go
if marker == 0xD9 {
    break // EOI — конец файла
}
```

**3. Чтение 65KB в стек — проблема для больших файлов**
```go
buf := make([]byte, 65536)
```
Для большинства файлов EXIF данные находятся в первых 64KB, но если APP0 (JFIF) очень большой, APP1 может выйти за пределы буфера и не будет найден. Надёжнее читать только заголовки секций и переходить к нужной.

**4. Функция читает файл заново, хотя данные уже в `preloader.cache`**
В `GetImageData` данные файла уже загружены через `preloader.Get(path)`, но затем вызывается `readExifOrientation(path)`, который открывает файл ещё раз с диска. Двойной I/O на каждое изображение.

**Фикс:** передавать `[]byte` в `readExifOrientation` вместо `path`.

---

## `preloader.go`

### ✅ Хорошо
- Корректная синхронизация через `sync.RWMutex`.
- Non-blocking send в канал (`select { case ... default: }`) — правильно.
- `Stop()` через `close(stopChan)` — правильно.

### ❌ Проблемы

**1. Неограниченный рост кэша (утечка памяти)**
Кэш `map[string][]byte` никогда не очищается автоматически. При просмотре папки с 1000+ фотографиями по 5–10MB каждая, RAM будет расти до OOM. `Evict()` объявлен, но **нигде не вызывается** — ни в `slider.js`, ни в `app.go`.

**Фикс:** LRU-кэш с ограничением (например, 20 изображений или 200MB).

**2. После `Stop()` воркеры завершаются, но `queue` не дренируется**
Если в момент `Stop()` в очереди есть задачи, они остаются необработанными. Это нормально для данного приложения, но при повторном вызове `NewPreloader` (если он будет добавлен) старые горутины уже мертвы, а новый `stopChan` создаётся.

**3. `workers` поле хранится, но не используется**
```go
workers int
```
Поле используется только в конструкторе для цикла `for i := 0; i < workers; i++`, но затем нигде не читается. Можно удалить.

**4. Нет защиты от двойного `Stop()`**
```go
func (p *Preloader) Stop() {
    close(p.stopChan) // panic если вызвать дважды
}
```
Повторный вызов `Stop()` вызовет `panic: close of closed channel`. В `app.go` shutdown вызывается один раз, но это хрупко.

**Фикс:**
```go
func (p *Preloader) Stop() {
    select {
    case <-p.stopChan: // уже закрыт
    default:
        close(p.stopChan)
    }
}
```

---

## `main.go`

### ❌ Проблемы

**1. Ошибка запуска логируется через `println`, не через `log`**
```go
println("Ошибка запуска:", err.Error())
```
`println` — встроенная Go-функция, пишет в stderr без форматирования, без timestamp, не перехватывается логгером. Использовать `log.Fatal(err)` или `fmt.Fprintf(os.Stderr, ...)`.

**2. Хардкод размеров окна без учёта DPI**
```go
Width: 1280, Height: 800,
```
На экранах с высоким DPI (4K, Retina через Wine/Parallels) окно будет маленьким. Wails v2 не масштабирует автоматически. Следует использовать `ZoomFactor` или читать размер экрана.

**3. `HideWindowOnClose: false` — окно не скрывается, а закрывается**
При закрытии окна приложение полностью завершается. Это может быть намеренным, но для слайдера-скринсейвера типичнее сворачивание в трей.

---

## `frontend/src/slider.js`

### ✅ Хорошо
- Корректный алгоритм Fisher-Yates для shuffle.
- `_changing` флаг предотвращает race condition при быстром клике.
- `resetTimer()` корректно сбрасывает таймер при ручной навигации.
- Предзагрузка следующих 3 изображений.

### ❌ Критично

**1. Drag & Drop не работает в Wails**
```javascript
document.addEventListener('drop', async (e) => {
    const entry = item.webkitGetAsEntry()
    if (entry?.isDirectory) await this.loadFolder(entry.fullPath)
})
```
`webkitGetAsEntry()` в Wails WebView возвращает виртуальный путь браузера, а не реальный путь файловой системы. `entry.fullPath` будет что-то вроде `/FolderName`, а не `C:\Users\...\FolderName`. `GetImages()` с таким путём вернёт пустой массив. **Функция фактически сломана.**

**Фикс:** использовать Wails Runtime API для получения реального пути или убрать Drag & Drop из интерфейса до реализации.

**2. `scheduleNext()` — двойной вызов при быстром next()**
```javascript
scheduleNext() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
        if (!this.playing) return
        this.next()
        if (this.playing) this.scheduleNext() // рекурсивно
    }, this.interval * 1000)
}
```
Если пользователь нажимает `next()` вручную, `resetTimer()` вызывает `scheduleNext()`. Но `next()` внутри таймаута также вызывает `scheduleNext()` в конце. При очень быстром взаимодействии возможно появление двух активных таймеров одновременно, если `clearTimeout` не успевает сработать до следующего tick. Безопаснее использовать `setInterval` или ID-based guard.

**3. Ошибка при потере фокуса `_changing = true` навсегда**
```javascript
try {
    const imgData = await GetImageData(path)
    ...
} finally {
    this._changing = false
}
```
Если `GetImageData` завершится с исключением, `finally` сбросит `_changing = false` — это правильно. Но если JS-движок упадёт в `ui.setImage()` **после** `finally` — `_changing` уже `false`, а UI в неконсистентном состоянии. Нет восстановления после ошибки отображения.

**4. `buildShuffleOrder()` синтаксическая странность**
```javascript
for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));[
    this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]]
}
```
Точка с запятой стоит **перед** `[`, что выглядит как конец выражения и начало нового array literal. Это работает только потому что деструктуризация читается как одно выражение через `;[...] = [...]`. Это крайне неочевидно и может сломаться при минификации или автоформатировании.

**Фикс:**
```javascript
const j = Math.floor(Math.random() * (i + 1));
[this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
```

**5. Нет обработки пустого результата `GetImages`**
```javascript
images = await GetImages(folder)
if (!images || images.length === 0) return
```
При возврате молча выходим без сообщения пользователю. Если папка содержит только видеофайлы или другие форматы — пользователь не поймёт почему ничего не загрузилось.

---

## `frontend/src/ui.js`

### ✅ Хорошо
- `ORIENTATION_MAP` — чистая и полная таблица для всех 8 значений EXIF.
- Double-buffering через `imgFront`/`imgBack` — грамотное решение для плавных переходов.
- `freezeAnimation()` корректно фиксирует текущий transform через `getComputedStyle`.

### ❌ Проблемы

**1. `setImage()` — размытый фон (`stageBg`) получает полный base64 Data URI**
```javascript
this.stageBg.style.backgroundImage = `url('${dataUri}')`
```
`dataUri` — это полная base64-строка изображения (может быть 10–50MB для RAW-converted). Устанавливать её как CSS `background-image` означает, что браузер декодирует изображение **дважды**: один раз для `<img>`, второй раз для `background-image`. Двойное потребление памяти и двойной decode.

**Фикс:** создавать `<canvas>` с низким разрешением (например, 32×32) для blur-эффекта фона.

**2. `toggleFullscreen()` — fallback через `window.runtime` не работает в Wails v2**
```javascript
try { window.runtime.WindowFullscreen() } catch (_) {}
```
`window.runtime` в Wails v2 не существует. Правильный путь — только через импортированные функции из `wailsjs/runtime/runtime.js`. Этот fallback никогда не сработает, ошибка молча глотается.

**3. Ken Burns применяется к `newImg`, но при быстром переключении старый `setTimeout` срабатывает на уже замененном слое**
```javascript
setTimeout(() => {
    newImg.style.transition = `transform ${Math.max(dur, 2)}s linear ...`
    newImg.style.transform = kbEnd
}, delay)
```
Если пользователь нажал `next` до истечения `delay` (700ms), `newImg` уже стал `oldImg` (через double-buffer swap). `setTimeout` запустится и применит Ken Burns анимацию к уже скрытому слою, что вызовет ghost-анимацию на следующем изображении.

**Фикс:** хранить cancellation token (например, инкрементный счётчик) и проверять его в `setTimeout`.

**4. `_bindToggle()` — клик по `emptyState` не переключает контролы**
```javascript
if (!inControls && !inEmpty) {
    this.toggleControls()
}
```
Клик по пустому экрану (до загрузки папки) ничего не делает. Пользователь не может открыть панель управления кликом в начальном состоянии. Это UX-баг.

**5. Нет debounce на `mousemove` для курсора**
```javascript
document.addEventListener('mousemove', showCursor)
```
`showCursor` вызывается на каждое событие `mousemove` — это может быть 100+ раз в секунду. Каждый раз вызывается `clearTimeout` и `setTimeout`. Производительность не катастрофическая, но это стандартная практика — добавить debounce.

---

## Структура проекта

### ❌ Проблемы

**1. `frontend/package.json.md5` закоммичен в репозиторий**
Это служебный файл Wails для отслеживания изменений зависимостей. Его не должно быть в git. Добавить в `.gitignore`.

**2. `build/` директория — содержимое не проверено**
Если в `build/` находятся скомпилированные бинарники — их не должно быть в git.

**3. Нет тестов**
Ни unit, ни integration. Критическая логика (EXIF-парсинг, shuffle, конфиг-валидация) ничем не покрыта.

**4. Нет CI/CD**
Нет `.github/workflows/`. Нет автоматической сборки, нет линтера (golangci-lint, eslint).

**5. `wailsjs/` директория должна быть в `.gitignore`**
Файлы `wailsjs/go/main/App.js` и `wailsjs/runtime/runtime.js` генерируются автоматически командой `wails generate module`. Коммитить их — антипаттерн.

---

## Приоритизация фиксов

| Приоритет | Файл | Проблема |
|-----------|------|----------|
| 🔴 CRITICAL | `exif.go` | Ориентация читается без ByteOrder → поломанный EXIF для Big Endian |
| 🔴 CRITICAL | `preloader.go` | Утечка памяти — кэш неограничен, `Evict` нигде не вызывается |
| 🔴 CRITICAL | `slider.js` | Drag & Drop сломан в Wails — `fullPath` невалиден |
| 🟠 HIGH | `exif.go` | Двойное чтение файла — данные уже в кэше preloader |
| 🟠 HIGH | `app.go` | Path traversal в `GetImageData` — нет проверки что path внутри LastFolder |
| 🟠 HIGH | `ui.js` | Ken Burns ghost-анимация при быстром переключении |
| 🟡 MEDIUM | `app.go` | Ошибки `loadConfig`/`saveConfig` молча игнорируются |
| 🟡 MEDIUM | `preloader.go` | Double-`Stop()` вызовет panic |
| 🟡 MEDIUM | `ui.js` | `stageBg` декодирует base64 дважды — двойная память |
| 🟢 LOW | `main.go` | `println` вместо `log.Fatal` |
| 🟢 LOW | `slider.js` | Синтаксическая аномалия в `buildShuffleOrder` |
| 🟢 LOW | `.gitignore` | `package.json.md5` и `wailsjs/` не исключены |

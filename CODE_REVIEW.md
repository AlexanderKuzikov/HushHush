# CODE REVIEW — HushHush

**Дата:** 2026-07-19 (обновлено: 2026-07-19 v2)  
**Ревьюер:** Perplexity AI (claude-sonnet-4-5 → claude-sonnet-4-6)  
**Репозиторий:** [AlexanderKuzikov/HushHush](https://github.com/AlexanderKuzikov/HushHush)  
**Стек:** Go + Wails v2 + Vanilla JS (Vite)

---

## Общая оценка

Проект — десктопный слайдер на Wails v2. Код **читаемый**, архитектура **понятная**. Однако при детальном разборе выявляется ряд серьёзных проблем: утечки памяти, race conditions, багованный EXIF-парсер, Drag & Drop не работает в Wails окружении, отсутствие тестов и error handling в критических местах.

**Общая оценка: 6/10** → после фикса критических багов: потенциально 8/10

---

## `app.go`

### ✅ Хорошо
- Валидация `SetInterval` (min 1 / max 3600) — правильно.
- Валидация `SetTransition` через `EffectNames` — правильно.
- Дефолтная конфигурация задаётся в `NewApp()` — правильно.
- `saveConfig()` создаёт директорию через `MkdirAll` — правильно.
- `SetTransition` использует линейный поиск по `EffectNames` вместо map — для 4 элементов нормально, но при расширении стоит перейти к `map[string]bool`.

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

**8. `GetConfig()` возвращает копию Config по значению — нет защиты от изменений**
```go
func (a *App) GetConfig() Config {
    return a.config
}
```
Это нормально для Go (возврат по значению безопасен), но если `Config` в будущем получит поля со слайсами/mapами — копия станет shallow и мутация со стороны фронтенда будет изменять внутреннее состояние. Стоит держать это в уме.

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

**3. Чтение 65KB в буфер — может не захватить APP1 в некоторых файлах**
```go
buf := make([]byte, 65536)
```
Для большинства файлов EXIF данные находятся в первых 64KB, но если APP0 (JFIF thumbnail) очень большой, APP1 может выйти за пределы буфера и не будет найден.

**4. Функция читает файл заново, хотя данные уже в `preloader.cache`**
В `GetImageData` данные файла уже загружены через `preloader.Get(path)`, но затем вызывается `readExifOrientation(path)`, который открывает файл ещё раз с диска. Двойной I/O на каждое изображение.

**Фикс:** передавать `[]byte` в `readExifOrientation` вместо `path`.

**5. ❌ НОВОЕ: `dataType` считывается но немедленно дискардится**
```go
dataType := bo.Uint16(tiffHeader[entryOffset+2 : entryOffset+4])
_ = dataType // Для orientation значение хранится прямо в поле value
```
По стандарту EXIF/TIFF тег `0x0112` (Orientation) ДОЛЖЕН иметь тип `SHORT` (dataType == 3). Код не валидирует это. Если файл содержит повреждённый EXIF, где тег 0x0112 имеет другой тип (например, LONG=4 или RATIONAL=5), код всё равно попытается прочитать 2 байта как SHORT и вернёт мусорное значение.

**Фикс:**
```go
dataType := bo.Uint16(tiffHeader[entryOffset+2 : entryOffset+4])
if dataType != 3 { // 3 = SHORT
    pos += 2 + length
    continue
}
```

**6. ❌ НОВОЕ: Нет проверки `count` поля IFD-записи**
Каждая IFD-запись содержит поле `count` (количество значений). Для Orientation count всегда должен быть 1. Код не читает и не проверяет это поле — при повреждённых данных можно прочитать за пределы допустимого.

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
Повторный вызов `Stop()` вызовет `panic: close of closed channel`.

**Фикс:**
```go
func (p *Preloader) Stop() {
    select {
    case <-p.stopChan:
    default:
        close(p.stopChan)
    }
}
```

**5. ❌ НОВОЕ: `Preload()` не проверяет, что `stopChan` не закрыт перед отправкой в канал**
```go
case p.queue <- path:
```
Если `Stop()` уже вызван и воркеры завершились, канал `queue` пуст, но никто его не читает. `select { case p.queue <- path: default: }` не вызовет panic (буферизованный канал), но задачи в очереди не будут обработаны — тихая потеря. Более серьёзно: при `queue` capacity=32 и вызове `Preload` после `Stop()` с >32 путями произойдёт silent drop без диагностики.

**6. ❌ НОВОЕ: Нет метрик / диагностики кэша**
Нет возможности узнать текущий размер кэша в байтах, hit-rate, количество загруженных файлов. При дебаггинге утечки памяти это критично.

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
На экранах с высоким DPI (4K, Retina через Wine/Parallels) окно будет маленьким.

**3. `HideWindowOnClose: false` — окно не скрывается, а закрывается**
При закрытии окна приложение полностью завершается.

**4. ❌ НОВОЕ: `StartHidden: false` — явно указывает не скрывать при старте**
Это нормально, но для приложения-слайдера, которое может стартовать в последнем состоянии (fullscreen), стоит рассмотреть управление видимостью через `OnStartup`.

**5. ❌ НОВОЕ: `Frameless: false` — без кастомного chrome**
Для слайдер-приложения frameless режим с кастомным drag-регионом был бы более подходящим UX. Стандартный Windows chrome выглядит неуместно для медиа-приложения полного экрана.

---

## `frontend/src/slider.js`

### ✅ Хорошо
- Корректный алгоритм Fisher-Yates для shuffle.
- `_changing` флаг предотвращает race condition при быстром клике.
- `resetTimer()` корректно сбрасывает таймер при ручной навигации.
- Предзагрузка следующих 3 изображений.
- Разделение ответственности: `Slider` управляет логикой, `UI` — отображением.
- `e.stopPropagation()` на всех кнопках — предотвращает всплытие к `_bindToggle`.

### ❌ Критично

**1. Drag & Drop не работает в Wails**
```javascript
const entry = item.webkitGetAsEntry()
if (entry?.isDirectory) await this.loadFolder(entry.fullPath)
```
`webkitGetAsEntry()` в Wails WebView возвращает виртуальный путь браузера, а не реальный путь файловой системы. `entry.fullPath` будет что-то вроде `/FolderName`, а не `C:\Users\...\FolderName`. `GetImages()` с таким путём вернёт пустой массив. **Функция фактически сломана.**

**2. `scheduleNext()` — потенциально двойной таймер**
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
Если `next()` вызывает `resetTimer()` → `scheduleNext()` до завершения текущего колбека таймаута, образуется два параллельных расписания.

**3. `buildShuffleOrder()` синтаксическая аномалия**
```javascript
const j = Math.floor(Math.random() * (i + 1));[
this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]]
```
Точка с запятой стоит **перед** `[`, что выглядит как конец выражения и начало нового array literal. Это работает только потому что деструктуризация читается как одно выражение через `;[...] = [...]`. Крайне неочевидно и может сломаться при минификации или автоформатировании.

**Фикс:**
```javascript
const j = Math.floor(Math.random() * (i + 1));
[this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
```

**4. Нет обработки пустого результата `GetImages` — UX-провал**
```javascript
if (!images || images.length === 0) return
```
При возврате молча выходим без сообщения пользователю. Пользователь не поймёт, почему ничего не загрузилось.

**5. ❌ НОВОЕ: `prev()` не проверяет `_ready`**
```javascript
prev() {
    if (this.images.length === 0 || this._changing) return
    this.index = this.index > 0 ? this.index - 1 : this.images.length - 1
    this.showCurrent()
}
```
`prev()` (в отличие от `next()`) не использует флаг `this._ready`. Хотя `images.length === 0` и защищает, семантически стоит использовать единый флаг готовности.

**6. ❌ НОВОЕ: `setInterval()` в `Slider` конфликтует с глобальным `window.setInterval`**
```javascript
setInterval(seconds) { ... }
```
Метод класса называется `setInterval` — точно как глобальная браузерная функция `window.setInterval`. Внутри класса коллизии нет (`this.setInterval` vs `window.setInterval`), но это ловушка для будущих разработчиков и порождает путаницу. Стоит переименовать в `setSlideInterval()` или `updateInterval()`.

**7. ❌ НОВОЕ: Отсутствует обработка события потери видимости страницы**
Если окно Wails сворачивается или перекрывается, слайдшоу продолжает работать, загружая изображения из файловой системы и делая base64-кодирование без надобности. Нет обработки `document.addEventListener('visibilitychange', ...)`.

**8. ❌ НОВОЕ: `PreloadImages` вызывается без ожидания и ошибки игнорируются**
```javascript
PreloadImages(nextPaths).catch(() => {})
```
Ошибка полностью подавляется. Если preloader упал (например, Go-паника в другом потоке), фронтенд никогда об этом не узнает.

**9. ❌ НОВОЕ: Нет debounce на `setInterval()` при изменении слайдера**
```javascript
intervalSlider.addEventListener('input', (e) => {
    const v = parseInt(e.target.value)
    intervalInput.value = v
    this.setInterval(v) // вызывает SetInterval() → saveConfig() на каждый пиксель движения
})
```
Событие `input` на range-слайдере стреляет при каждом движении мыши. Каждый раз вызывается `SetInterval(v)` → Go-метод → `saveConfig()` → запись на диск. При быстром перетаскивании слайдера это 30–60 записей в секунду.

---

## `frontend/src/ui.js`

### ✅ Хорошо
- `ORIENTATION_MAP` — чистая и полная таблица для всех 8 значений EXIF.
- Double-buffering через `imgFront`/`imgBack` — грамотное решение для плавных переходов.
- `freezeAnimation()` корректно фиксирует текущий transform через `getComputedStyle`.
- Корректный импорт из `wailsjs/runtime/runtime.js` — не использует устаревший `window.runtime`.
- Все эффекты (fade/zoom/blur/kenburns) реализованы через CSS transitions без сторонних библиотек.

### ❌ Проблемы

**1. `setImage()` — размытый фон (`stageBg`) получает полный base64 Data URI**
```javascript
this.stageBg.style.backgroundImage = `url('${dataUri}')`
```
`dataUri` — это полная base64-строка изображения (может быть 10–50MB). Устанавливать её как CSS `background-image` означает, что браузер декодирует изображение **дважды**: один раз для `<img>`, второй раз для `background-image`. Двойное потребление памяти и двойной decode.

**Фикс:** использовать `<canvas>` с низким разрешением (например, 32×32) для blur-эффекта фона или `URL.createObjectURL(blob)`.

**2. `toggleFullscreen()` — fallback через `window.runtime` не работает в Wails v2**
```javascript
try { window.runtime.WindowFullscreen() } catch (_) {}
```
`window.runtime` в Wails v2 не существует. Правильный путь — только через импортированные функции из `wailsjs/runtime/runtime.js`. Этот fallback никогда не сработает.

**3. Ken Burns ghost-анимация при быстром переключении**
```javascript
setTimeout(() => {
    newImg.style.transition = `transform ${Math.max(dur, 2)}s linear ...`
    newImg.style.transform = kbEnd
}, delay)
```
Если пользователь нажал `next` до истечения `delay` (700ms), `newImg` уже стал `oldImg`. `setTimeout` запустится и применит Ken Burns анимацию к уже скрытому слою — ghost-анимация.

**Фикс:**
```javascript
this._generation = (this._generation || 0) + 1
const gen = this._generation
setTimeout(() => {
    if (this._generation !== gen) return
    newImg.style.transition = ...
}, delay)
```

**4. `_bindToggle()` — клик по `emptyState` не переключает контролы**
```javascript
if (!inControls && !inEmpty) {
    this.toggleControls()
}
```
Клик по пустому экрану (до загрузки папки) ничего не делает — UX-баг.

**5. Нет debounce на `mousemove` для курсора**
```javascript
document.addEventListener('mousemove', showCursor)
```
`showCursor` вызывается 60–120 раз в секунду при движении мыши. Стандартная практика — добавить throttle (requestAnimationFrame) или debounce.

**6. ❌ НОВОЕ: `oldImg.style.opacity = '0'` — конфликт с CSS классом `exit`**
```javascript
oldImg.classList.add('exit')
oldImg.style.opacity = '0'
```
Одновременно устанавливается CSS класс `exit` (который, судя по `styles.css`, тоже может задавать opacity) и inline style `opacity: '0'`. Inline style имеет более высокую специфичность и перезаписывает CSS-класс, делая класс `exit` бесполезным для opacity-анимации. Стоит убрать inline style и полностью делегировать анимацию CSS-классу.

**7. ❌ НОВОЕ: `newImg.classList.remove('enter', 'exit')` вызывается через 800ms для обоих элементов**
```javascript
setTimeout(() => {
    ;[this.imgFront, this.imgBack].forEach(img => {
        img.classList.remove('enter', 'exit')
    })
}, 800)
```
Если в течение 800ms было запущено несколько переходов подряд, каждый создаёт свой `setTimeout(800ms)`. Все они сработают и удалят классы `enter`/`exit` у текущего `newImg`, прерывая его активную анимацию входа.

**8. ❌ НОВОЕ: `showStage()` не сбрасывает `imgBack`**
```javascript
showStage() {
    this.emptyState.style.display = 'none'
    this.imgFront.style.display = 'block'
    this.imgFront.style.opacity = '1'
    ...
}
```
`imgBack` не сбрасывается. Если `showStage()` вызывается повторно (например, после смены папки), `imgBack` может содержать старое изображение с устаревшими стилями.

**9. ❌ НОВОЕ: В zoom-эффекте используется `void newImg.offsetHeight` для форс-reflow, но это вызов layout thrashing**
```javascript
void newImg.offsetHeight
newImg.style.transition = `transform 0.6s ease-out...`
newImg.style.transform = `${orient} scale(1.0) translate(0, 0)`
```
Для принудительного reflow лучше использовать `requestAnimationFrame(() => { ... })` — это запрашивает reflow через браузерный планировщик, а не блокирует основной поток.

**10. ❌ НОВОЕ: Нет обработки ошибки `SetTransition`**
```javascript
try { await SetTransition(effect) } catch (_) {}
```
Ошибка полностью поглощается. Если Go-метод вернёт ошибку (например, невалидное имя эффекта), UI покажет выбранный эффект активным, но сервер его не применит — UI и backend рассинхронизированы.

---

## `frontend/src/styles.css`

### ✅ Хорошо
- Использование CSS custom properties (`--control-bg`, `--control-hover`) — хороший тон.
- `will-change: transform, opacity` на img элементах — GPU-ускорение переходов.
- `-webkit-app-region: drag` для перетаскивания окна — Wails-specific правильно применён.

### ❌ Проблемы

**1. ❌ НОВОЕ: `.exit` класс не задаёт собственный `transition`**
Класс `exit` в CSS не содержит `transition` свойства, значит анимация исчезновения старого изображения полностью управляется inline styles из `ui.js`. Это антипаттерн: анимации должны быть в CSS, JS только управляет классами.

**2. ❌ НОВОЕ: `#stage-bg` имеет `filter: blur()` но нет `overflow: hidden` на родителе**
Размытый фон выходит за границы элемента. Если blur radius большой, артефакты видны по краям экрана. Нужен `overflow: hidden` на `#stage` или отрицательный `margin`.

**3. ❌ НОВОЕ: `cursor: none` применяется глобально через `body.cursor-hidden`**
Это скрывает курсор и в системных диалогах Wails (если они открыты поверх). Ограничить до `#stage` или `main`.

---

## `frontend/index.html`

### ❌ Проблемы

**1. ❌ НОВОЕ: Нет `<meta name="viewport">` для корректного масштабирования**
Хотя приложение десктопное, отсутствие viewport meta может привести к неожиданному масштабированию WebView при изменении DPI.

**2. ❌ НОВОЕ: Нет `<meta http-equiv="Content-Security-Policy">`**
Для Wails-приложений CSP критически важен: без него XSS в WebView может выполнить произвольный Go-код через `window.go.*`. Минимальный CSP:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">
```

---

## `wails.json`

### ❌ Проблемы

**1. ❌ НОВОЕ: `wailsVersion` не зафиксирован**
В `wails.json` нет явного указания минимальной версии Wails. Разные версии Wails v2 имеют breaking changes в runtime API. Зафиксировать в `go.mod` и `README`.

---

## Структура проекта

### ❌ Проблемы

**1. `frontend/package.json.md5` закоммичен в репозиторий**
Это служебный файл Wails для отслеживания изменений зависимостей. Добавить в `.gitignore`.

**2. `build/` директория — содержимое не проверено**
Если в `build/` находятся скомпилированные бинарники — их не должно быть в git.

**3. Нет тестов**
Ни unit, ни integration. Критическая логика (EXIF-парсинг, shuffle, конфиг-валидация) ничем не покрыта.

**4. Нет CI/CD**
Нет `.github/workflows/`. Нет автоматической сборки, нет линтера (golangci-lint, eslint).

**5. `wailsjs/` директория должна быть в `.gitignore`**
Файлы `wailsjs/go/main/App.js` и `wailsjs/runtime/runtime.js` генерируются автоматически командой `wails generate module`. Коммитить их — антипаттерн.

**6. ❌ НОВОЕ: Нет `CHANGELOG.md`**
Для десктопного приложения с binary releases отсутствие changelog затрудняет отслеживание изменений между версиями.

**7. ❌ НОВОЕ: Нет `LICENSE` файла**
Репозиторий публичный, но без лицензии — по умолчанию «все права защищены», что делает форки невозможными юридически.

---

## Приоритизация фиксов

| Приоритет | Файл | Проблема |
|-----------|------|----------|
| 🔴 CRITICAL | `exif.go` | Ориентация читается без ByteOrder → поломанный EXIF для Big Endian |
| 🔴 CRITICAL | `preloader.go` | Утечка памяти — кэш неограничен, `Evict` нигде не вызывается |
| 🔴 CRITICAL | `slider.js` | Drag & Drop сломан в Wails — `fullPath` невалиден |
| 🔴 CRITICAL | `index.html` | Отсутствует CSP — XSS может вызвать Go код |
| 🟠 HIGH | `exif.go` | Двойное чтение файла — данные уже в кэше preloader |
| 🟠 HIGH | `exif.go` | `dataType` не валидируется для тега Orientation |
| 🟠 HIGH | `app.go` | Path traversal в `GetImageData` |
| 🟠 HIGH | `ui.js` | Ken Burns ghost-анимация при быстром переключении |
| 🟠 HIGH | `ui.js` | Множественные `setTimeout(800ms)` удаляют классы активной анимации |
| 🟡 MEDIUM | `app.go` | Ошибки `loadConfig`/`saveConfig` молча игнорируются |
| 🟡 MEDIUM | `preloader.go` | Double-`Stop()` вызовет panic |
| 🟡 MEDIUM | `preloader.go` | `Preload()` не защищён от вызова после `Stop()` |
| 🟡 MEDIUM | `ui.js` | `stageBg` декодирует base64 дважды — двойная память |
| 🟡 MEDIUM | `slider.js` | `setInterval` конфликтует по имени с `window.setInterval` |
| 🟡 MEDIUM | `slider.js` | Нет debounce при изменении слайдера интервала — 60 записей/сек на диск |
| 🟡 MEDIUM | `styles.css` | `#stage-bg` без `overflow: hidden` — артефакты blur по краям |
| 🟢 LOW | `main.go` | `println` вместо `log.Fatal` |
| 🟢 LOW | `main.go` | `Frameless: false` — стандартный chrome неуместен для медиа-приложения |
| 🟢 LOW | `slider.js` | Синтаксическая аномалия в `buildShuffleOrder` |
| 🟢 LOW | `.gitignore` | `package.json.md5` и `wailsjs/` не исключены |
| 🟢 LOW | repo root | Отсутствует `LICENSE` файл |

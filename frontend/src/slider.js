import {
  OpenFolderDialog,
  GetImages,
  GetConfig,
  SetInterval,
  SetShuffle,
  SetLoop,
  GetLastFolder,
  PreloadImages,
  GetImageData,
} from '../wailsjs/go/main/App.js'

export class Slider {
  constructor(ui) {
    this.ui = ui
    this.images = []
    this.index = 0
    this.timer = null
    this.playing = false
    this.shuffle = false
    this.loop = true
    this.interval = 5
    this.shuffleOrder = []
    this._cursorTimer = null
    this._changing = false
    this._ready = false

    // bindEvents вызывается в конструкторе — кнопки работают сразу
    this.bindEvents()
  }

  async init() {
    try {
      const config = await GetConfig()
      this.interval = config.interval || 5
      this.shuffle  = !!config.shuffle
      this.loop     = config.loop !== false
      this.ui.applyConfig(config)
      this.ui.setDuration(this.interval)
      this.ui.syncControls(this)

      const lastFolder = await GetLastFolder()
      if (lastFolder) {
        await this.loadFolder(lastFolder)
      }
    } catch (err) {
      console.error('Init error:', err)
    }
  }

  async loadFolder(folder) {
    let images
    try {
      images = await GetImages(folder)
    } catch (e) {
      return
    }
    if (!images || images.length === 0) return

    this.images = images
    this.buildShuffleOrder()
    this.index = 0
    this._ready = true
    this.ui.showStage()
    await this.showCurrent(true)
    this.play()
  }

  async showCurrent(immediate) {
    if (this._changing || this.images.length === 0) return
    this._changing = true

    const idx  = this.shuffle ? this.shuffleOrder[this.index] : this.index
    const path = this.images[idx]

    try {
      const imgData = await GetImageData(path)
      this.ui.setImage(imgData, immediate ? 0 : this.interval)
      this.ui.setCounter(this.index + 1, this.images.length)
      this.ui.setName(path.split(/[\\/]/).pop())
    } finally {
      this._changing = false
    }

    // Предзагрузка следующих 3
    const nextPaths = []
    for (let i = 1; i <= 3; i++) {
      const ni = (this.shuffle
        ? this.shuffleOrder[(this.index + i) % this.images.length]
        : (this.index + i) % this.images.length)
      nextPaths.push(this.images[ni])
    }
    PreloadImages(nextPaths).catch(() => {})
  }

  next() {
    if (this.images.length === 0 || this._changing) return
    if (this.index < this.images.length - 1) {
      this.index++
    } else if (this.loop) {
      this.index = 0
      if (this.shuffle) this.buildShuffleOrder()
    } else {
      this.pause()
      return
    }
    this.showCurrent()
  }

  prev() {
    if (this.images.length === 0 || this._changing) return
    this.index = this.index > 0 ? this.index - 1 : this.images.length - 1
    this.showCurrent()
  }

  play() {
    if (this.playing) return
    this.playing = true
    this.ui.setPlayState(true)
    this.scheduleNext()
  }

  pause() {
    this.playing = false
    this.ui.setPlayState(false)
    clearTimeout(this.timer)
    this.ui.freezeAnimation()
  }

  togglePlay() {
    this.playing ? this.pause() : this.play()
  }

  scheduleNext() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.playing) return
      this.next()
      if (this.playing) this.scheduleNext()
    }, this.interval * 1000)
  }

  setInterval(seconds) {
    this.interval = Math.max(1, Math.min(3600, seconds))
    this.ui.setDuration(this.interval)
    this.ui.syncControls(this)
    SetInterval(this.interval)
    if (this.playing) {
      clearTimeout(this.timer)
      this.scheduleNext()
    }
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle
    if (this.shuffle) this.buildShuffleOrder()
    SetShuffle(this.shuffle)
    this.ui.setShuffleState(this.shuffle)
  }

  buildShuffleOrder() {
    this.shuffleOrder = [...Array(this.images.length).keys()]
    for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));[
      this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]]
    }
  }

  bindEvents() {
    const $ = (id) => document.getElementById(id)

    // Эти кнопки работают всегда, даже до загрузки изображений
    $('btn-folder').addEventListener('click',    (e) => { e.stopPropagation(); this.openFolder() })
    $('btn-open').addEventListener('click',      (e) => { e.stopPropagation(); this.openFolder() })
    $('btn-play').addEventListener('click',      (e) => { e.stopPropagation(); this.togglePlay() })
    $('btn-shuffle').addEventListener('click',   (e) => { e.stopPropagation(); this.toggleShuffle() })
    $('btn-fullscreen').addEventListener('click',(e) => { e.stopPropagation(); this.ui.toggleFullscreen() })
    $('btn-quit').addEventListener('click',      (e) => { e.stopPropagation(); this.ui.quit() })

    // Prev/Next — проверяют images.length
    $('btn-prev').addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.images.length === 0) return
      this.prev()
      this.resetTimer()
    })
    $('btn-next').addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.images.length === 0) return
      this.next()
      this.resetTimer()
    })

    // Интервал
    const intervalInput  = $('interval-input')
    const intervalSlider = $('interval-slider')

    const applyInterval = () => {
      const v = parseInt(intervalInput.value) || 5
      intervalInput.value = v
      this.setInterval(v)
    }

    intervalInput.addEventListener('change', applyInterval)
    intervalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); intervalInput.blur() }
    })

    intervalSlider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value)
      intervalInput.value = v
      this.setInterval(v)
    })

    // Курсор
    const showCursor = () => {
      document.body.classList.remove('cursor-hidden')
      clearTimeout(this._cursorTimer)
      if (this.playing) {
        this._cursorTimer = setTimeout(() => {
          if (!this.ui.isVisible()) {
            document.body.classList.add('cursor-hidden')
          }
        }, 3000)
      }
    }
    document.addEventListener('mousemove', showCursor)
    document.addEventListener('mousedown', showCursor)
    document.addEventListener('keydown', showCursor)

    // Клавиатура
    document.addEventListener('keydown', (e) => {
      // Не обрабатываем если фокус в поле ввода
      if (e.target.tagName === 'INPUT') return

      switch (e.key) {
        case 'ArrowRight':
          if (this.images.length === 0) break
          e.preventDefault(); this.next(); this.resetTimer(); break
        case ' ':
          if (this.images.length === 0) break
          e.preventDefault(); this.togglePlay(); break
        case 'ArrowLeft':
          if (this.images.length === 0) break
          e.preventDefault(); this.prev(); this.resetTimer(); break
        case '+':
        case '=': this.setInterval(this.interval + 1); break
        case '-': this.setInterval(this.interval - 1); break
        case 'f':
        case 'F': this.ui.toggleFullscreen(); break
        case 's':
        case 'S': this.toggleShuffle(); break
        case 'Escape': this.ui.hideControls(); break
        case 'q':
        case 'Q': this.ui.quit(); break
      }
    })

    // Drag & Drop
    document.addEventListener('dragover', (e) => e.preventDefault())
    document.addEventListener('drop', async (e) => {
      e.preventDefault()
      const item = e.dataTransfer.items?.[0]
      if (item?.kind === 'file') {
        const entry = item.webkitGetAsEntry()
        if (entry?.isDirectory) await this.loadFolder(entry.fullPath)
      }
    })
  }

  async openFolder() {
    const folder = await OpenFolderDialog()
    if (folder) await this.loadFolder(folder)
  }

  resetTimer() {
    if (this.playing) {
      clearTimeout(this.timer)
      this.scheduleNext()
    }
  }
}

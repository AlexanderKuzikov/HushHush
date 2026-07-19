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
    this._changing = false // защита от двойной смены
  }

  async init() {
    const config = await GetConfig()
    this.interval = config.interval
    this.shuffle  = config.shuffle
    this.loop     = config.loop
    this.ui.setDuration(this.interval)
    this.ui.syncControls(this)

    const lastFolder = await GetLastFolder()
    if (lastFolder) {
      await this.loadFolder(lastFolder)
    }

    this.bindEvents()
  }

  async loadFolder(folder) {
    const images = await GetImages(folder)
    if (!images || images.length === 0) return

    this.images = images
    this.buildShuffleOrder()
    this.index = 0
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
      this.ui.setImage(imgData.data, imgData.orientation, immediate ? 0 : this.interval)
      this.ui.setCounter(this.index + 1, this.images.length)
      this.ui.setName(path.split(/[\\/]/).pop())
    } finally {
      this._changing = false
    }

    // Фоновая предзагрузка следующих 3 кадров
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
    // Возобновляем Ken Burns (просто перезапускаем таймер)
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
    this.interval = seconds
    this.ui.setDuration(seconds)
    SetInterval(seconds)
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
    document.getElementById('btn-folder').addEventListener('click',    (e) => { e.stopPropagation(); this.openFolder() })
    document.getElementById('btn-open').addEventListener('click',      (e) => { e.stopPropagation(); this.openFolder() })
    document.getElementById('btn-prev').addEventListener('click',      (e) => { e.stopPropagation(); this.prev();         this.resetTimer() })
    document.getElementById('btn-next').addEventListener('click',      (e) => { e.stopPropagation(); this.next();         this.resetTimer() })
    document.getElementById('btn-play').addEventListener('click',      (e) => { e.stopPropagation(); this.togglePlay() })
    document.getElementById('btn-shuffle').addEventListener('click',   (e) => { e.stopPropagation(); this.toggleShuffle() })
    document.getElementById('btn-fullscreen').addEventListener('click',(e) => { e.stopPropagation(); this.ui.toggleFullscreen() })

    // Интервал: числовое поле
    const intervalInput  = document.getElementById('interval-input')
    const intervalSlider = document.getElementById('interval-slider')
    intervalInput.addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(3600, parseInt(e.target.value) || 5))
      intervalInput.value  = v
      intervalSlider.value = Math.min(v, 60)
      this.setInterval(v)
    })
    intervalSlider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value)
      intervalInput.value = v
      this.setInterval(v)
    })

    // Управление курсором: показываем при любом движении, скрываем через 3 сек бездействия
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
      switch (e.key) {
        case 'ArrowRight':
        case ' ':       e.preventDefault(); this.next();  this.resetTimer(); break
        case 'ArrowLeft': e.preventDefault(); this.prev(); this.resetTimer(); break
        case '+':
        case '=':       this.setInterval(Math.min(this.interval + 1, 3600)); this.ui.syncControls(this); break
        case '-':       this.setInterval(Math.max(this.interval - 1, 1));    this.ui.syncControls(this); break
        case 'f':
        case 'F':       this.ui.toggleFullscreen(); break
        case 's':
        case 'S':       this.toggleShuffle(); break
        case 'Escape':  this.ui.hideControls(); break
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

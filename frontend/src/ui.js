export class UI {
  constructor() {
    this.stage      = document.getElementById('stage')
    this.imgEl      = document.getElementById('current-img')
    this.emptyState = document.getElementById('empty-state')
    this.controls   = document.getElementById('controls')
    this.counter    = document.getElementById('img-counter')
    this.nameEl     = document.getElementById('img-name')
    this.btnPlay    = document.getElementById('btn-play')
    this.btnShuffle = document.getElementById('btn-shuffle')
    this.intervalInput  = document.getElementById('interval-input')
    this.intervalSlider = document.getElementById('interval-slider')

    this._controlsTimeout = null
    this._bindHover()
  }

  setImage(path) {
    this.imgEl.classList.add('fade-out')
    setTimeout(() => {
      // Wails передаёт нативный путь — оборачиваем в URL
      this.imgEl.src = `data-path:${encodeURIComponent(path)}`
      // Для Wails используем прямой путь через asset handler
      this.imgEl.src = path.replace(/\\/g, '/')
      this.imgEl.classList.remove('fade-out')
      this.imgEl.classList.add('fade-in')
    }, 200)
  }

  showStage() {
    this.emptyState.style.display = 'none'
    this.imgEl.style.display = 'block'
  }

  setCounter(current, total) {
    this.counter.textContent = `${current} / ${total}`
  }

  setName(name) {
    this.nameEl.textContent = name
  }

  setPlayState(playing) {
    this.btnPlay.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;'
    this.btnPlay.title = playing ? 'Пауза [Space]' : 'Воспроизведение [Space]'
  }

  setShuffleState(active) {
    this.btnShuffle.classList.toggle('active', active)
  }

  syncControls(slider) {
    this.intervalInput.value  = slider.interval
    this.intervalSlider.value = Math.min(slider.interval, 60)
    this.setShuffleState(slider.shuffle)
    this.setPlayState(slider.playing)
  }

  showControls() {
    this.controls.classList.add('visible')
    clearTimeout(this._controlsTimeout)
    this._controlsTimeout = setTimeout(() => this.hideControls(), 3000)
  }

  hideControls() {
    this.controls.classList.remove('visible')
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  _bindHover() {
    // Панель управления появляется при движении мыши, скрывается через 3 сек
    document.addEventListener('mousemove', () => this.showControls())
    document.addEventListener('click',     () => this.showControls())
  }
}

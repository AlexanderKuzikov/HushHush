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

    this._visible = false
    this._bindToggle()
  }

  setImage(dataUri) {
    this.imgEl.classList.add('fade-out')
    setTimeout(() => {
      this.imgEl.src = dataUri
      this.imgEl.classList.remove('fade-out')
      this.imgEl.classList.add('fade-in')
    }, 200)

    // Сбрасываем скрытие курсора при смене кадра
    document.body.classList.remove('cursor-hidden')
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

  isVisible() {
    return this._visible
  }

  // Панель показывается / скрывается только по явному действию
  toggleControls() {
    this._visible ? this.hideControls() : this.showControls()
  }

  showControls() {
    this._visible = true
    this.controls.classList.add('visible')
    document.body.classList.remove('cursor-hidden')
    document.body.classList.add('controls-visible')
  }

  hideControls() {
    this._visible = false
    this.controls.classList.remove('visible')
    document.body.classList.remove('controls-visible')
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // Клик по экрану — переключить панель;
  // клик по кнопке панели — не скрывать
  _bindToggle() {
    document.addEventListener('click', (e) => {
      const inControls = this.controls.contains(e.target)
      const inEmpty    = this.emptyState.contains(e.target)
      if (!inControls && !inEmpty) {
        this.toggleControls()
      }
    })
  }
}

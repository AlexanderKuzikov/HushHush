import { WindowFullscreen, WindowUnfullscreen, WindowIsFullscreen } from '../wailsjs/runtime/runtime.js'

// Маппинг EXIF-ориентации на CSS-трансформации
const ORIENTATION_MAP = {
  1: { rotate: 0,       scaleX: 1, scaleY: 1 },
  2: { rotate: 0,       scaleX: -1, scaleY: 1 },
  3: { rotate: 180,     scaleX: 1, scaleY: 1 },
  4: { rotate: 180,     scaleX: -1, scaleY: 1 },
  5: { rotate: 90,      scaleX: -1, scaleY: 1 },
  6: { rotate: 90,      scaleX: 1, scaleY: 1 },
  7: { rotate: -90,     scaleX: -1, scaleY: 1 },
  8: { rotate: -90,     scaleX: 1, scaleY: 1 },
}

function orientationCSS(orientation) {
  const t = ORIENTATION_MAP[orientation] || ORIENTATION_MAP[1]
  return `rotate(${t.rotate}deg) scale(${t.scaleX}, ${t.scaleY})`
}

// Ken Burns: случайное начальное смещение для эффекта панорамирования
function randomKenBurnsOrigin() {
  const positions = [
    '50% 50%',   // центр
    '30% 30%',   // верхний левый
    '70% 30%',   // верхний правый
    '30% 70%',   // нижний левый
    '70% 70%',   // нижний правый
    '50% 20%',   // верх
    '50% 80%',   // низ
    '20% 50%',   // лево
    '80% 50%',   // право
  ]
  return positions[Math.floor(Math.random() * positions.length)]
}

export class UI {
  constructor() {
    this.stage      = document.getElementById('stage')
    this.imgFront   = document.getElementById('img-front')
    this.imgBack    = document.getElementById('img-back')
    this.emptyState = document.getElementById('empty-state')
    this.controls   = document.getElementById('controls')
    this.counter    = document.getElementById('img-counter')
    this.nameEl     = document.getElementById('img-name')
    this.btnPlay    = document.getElementById('btn-play')
    this.btnShuffle = document.getElementById('btn-shuffle')
    this.intervalInput  = document.getElementById('interval-input')
    this.intervalSlider = document.getElementById('interval-slider')

    this._visible = false
    this._activeImg = this.imgFront
    this._currentDuration = 5 // текущий interval для анимации zoom
    this._bindToggle()
  }

  setDuration(seconds) {
    this._currentDuration = Math.max(seconds, 1)
  }

  setImage(dataUri, orientation, duration) {
    this._currentDuration = Math.max(duration || this._currentDuration, 1)

    const backImg = this._activeImg === this.imgFront ? this.imgBack : this.imgFront

    // Сброс анимации на заднем слое
    backImg.style.transition = 'none'
    const orient = orientationCSS(orientation || 1)
    const origin = randomKenBurnsOrigin()
    backImg.style.transformOrigin = origin

    // Начальное состояние: небольшой zoom + смещение от центра
    backImg.style.transform = `${orient} scale(1.0) translate(0, 0)`
    void backImg.offsetHeight // force reflow

    // Устанавливаем src и показываем
    backImg.src = dataUri
    backImg.classList.remove('exit')
    backImg.classList.add('active', 'enter')

    // Запускаем Ken Burns анимацию: плавный zoom + небольшое движение
    backImg.style.transition = `transform ${this._currentDuration}s linear`
    // Конечное состояние: zoom ~1.08 со случайным направлением
    const zoomTarget = 1.06 + Math.random() * 0.04 // 1.06–1.10
    const dx = (Math.random() - 0.5) * 2  // -1..1
    const dy = (Math.random() - 0.5) * 2
    backImg.style.transform = `${orient} scale(${zoomTarget}) translate(${dx}%, ${dy}%)`

    // Старый передний слой — fade out с остановкой его анимации
    this._activeImg.style.transition = `opacity 0.6s ease`
    this._activeImg.classList.remove('active')
    this._activeImg.classList.add('exit')
    this._activeImg.style.opacity = '0'

    // Меняем активный слой
    this._activeImg = backImg

    // Сбрасываем скрытие курсора
    document.body.classList.remove('cursor-hidden')

    // Убираем временные классы после анимации
    setTimeout(() => {
      const allImgs = [this.imgFront, this.imgBack]
      allImgs.forEach(img => {
        img.classList.remove('enter', 'exit')
      })
    }, 700)
  }

  // Остановить Ken Burns анимацию на текущем слое
  freezeAnimation() {
    // Сбрасываем transition и фиксируем текущее состояние
    const style = window.getComputedStyle(this._activeImg)
    const currentTransform = style.transform
    this._activeImg.style.transition = 'none'
    this._activeImg.style.transform = currentTransform
  }

  showStage() {
    this.emptyState.style.display = 'none'
    this.imgFront.style.display = 'block'
    this.imgBack.style.display = 'block'
    this.imgFront.style.opacity = '1'
    this.imgFront.classList.add('active')
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

  async toggleFullscreen() {
    const isFs = await WindowIsFullscreen()
    if (isFs) {
      WindowUnfullscreen()
    } else {
      WindowFullscreen()
    }
  }

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

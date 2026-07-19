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

// Ken Burns: случайное начальное смещение
function randomKenBurnsOrigin() {
  const positions = [
    '50% 50%', '30% 30%', '70% 30%', '30% 70%',
    '70% 70%', '50% 20%', '50% 80%', '20% 50%', '80% 50%',
  ]
  return positions[Math.floor(Math.random() * positions.length)]
}

export class UI {
  constructor() {
    this.stageBg   = document.getElementById('stage-bg')
    this.imgFront  = document.getElementById('img-front')
    this.imgBack   = document.getElementById('img-back')
    this.emptyState = document.getElementById('empty-state')
    this.controls  = document.getElementById('controls')
    this.counter   = document.getElementById('img-counter')
    this.nameEl    = document.getElementById('img-name')
    this.btnPlay   = document.getElementById('btn-play')
    this.btnShuffle = document.getElementById('btn-shuffle')
    this.intervalInput  = document.getElementById('interval-input')
    this.intervalSlider = document.getElementById('interval-slider')

    this._visible = false
    this._activeImg = this.imgFront
    this._currentDuration = 5
    this._bindToggle()
  }

  setDuration(seconds) {
    this._currentDuration = Math.max(seconds, 1)
  }

  setImage(imgData, duration) {
    const { data: dataUri, orientation, width, height } = imgData
    const dur = Math.max(duration || this._currentDuration, 1)
    this._currentDuration = dur

    // Определяем ориентацию изображения и экрана
    const imgLandscape = width > 0 && height > 0 ? width > height : null
    const screenLandscape = window.innerWidth > window.innerHeight

    // Если размеры известны и ориентации совпадают — cover, иначе contain + blur
    const useCover = imgLandscape !== null && imgLandscape === screenLandscape
    const objectFit = useCover ? 'cover' : 'contain'

    // Какой слой будет задним
    const backImg = this._activeImg === this.imgFront ? this.imgBack : this.imgFront

    // === Сброс backImg ===
    backImg.style.transition = 'none'
    backImg.style.opacity = '1'
    backImg.style.display = 'block'

    // Применяем object-fit
    backImg.style.objectFit = objectFit

    // Устанавливаем transform для EXIF-ориентации и Ken Burns
    const orient = orientationCSS(orientation || 1)
    const origin = randomKenBurnsOrigin()
    backImg.style.transformOrigin = origin
    backImg.style.transform = `${orient} scale(1.0) translate(0, 0)`

    void backImg.offsetHeight

    // Загружаем новое изображение
    backImg.src = dataUri

    // Классы
    backImg.classList.remove('exit')
    backImg.classList.add('active', 'enter')

    // Ken Burns анимация
    const zoomTarget = 1.06 + Math.random() * 0.04
    const dx = (Math.random() - 0.5) * 2
    const dy = (Math.random() - 0.5) * 2
    backImg.style.transition = `transform ${dur}s linear, opacity 0.6s ease`
    backImg.style.transform = `${orient} scale(${zoomTarget}) translate(${dx}%, ${dy}%)`

    // === Старый слой: fade out ===
    this._activeImg.style.transition = `opacity 0.6s ease, transform 0.6s ease`
    this._activeImg.classList.remove('active')
    this._activeImg.classList.add('exit')
    this._activeImg.style.opacity = '0'

    // Меняем активный слой
    this._activeImg = backImg

    // === Размытый фон (только для contain) ===
    if (!useCover) {
      this.stageBg.style.backgroundImage = `url('${dataUri}')`
      this.stageBg.style.display = 'block'
    } else {
      this.stageBg.style.display = 'none'
    }

    // Сброс курсора
    document.body.classList.remove('cursor-hidden')

    // Убираем временные классы
    setTimeout(() => {
      ;[this.imgFront, this.imgBack].forEach(img => {
        img.classList.remove('enter', 'exit')
      })
    }, 700)
  }

  freezeAnimation() {
    const style = window.getComputedStyle(this._activeImg)
    this._activeImg.style.transition = 'none'
    this._activeImg.style.transform = style.transform
  }

  showStage() {
    this.emptyState.style.display = 'none'
    this.imgFront.style.display = 'block'
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

  isVisible() { return this._visible }

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
    if (isFs) WindowUnfullscreen()
    else WindowFullscreen()
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

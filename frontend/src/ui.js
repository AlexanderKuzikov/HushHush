import {
  WindowFullscreen, WindowUnfullscreen, WindowIsFullscreen,
  Quit
} from '../wailsjs/runtime/runtime.js'
import { SetTransition, SetKenBurns } from '../wailsjs/go/main/App.js'

// EXIF-ориентация
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

// Ken Burns random origin
function randomKBOrigin() {
  const pos = ['50% 50%','30% 30%','70% 30%','30% 70%','70% 70%','50% 20%','50% 80%','20% 50%','80% 50%']
  return pos[Math.floor(Math.random() * pos.length)]
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
    this.btnEffects = document.getElementById('btn-effects')
    this.effectsMenu = document.getElementById('effects-menu')
    this.intervalInput  = document.getElementById('interval-input')
    this.intervalSlider = document.getElementById('interval-slider')

    this._visible = false
    this._activeImg = this.imgFront
    this._currentDuration = 5
    this._effectsVisible = false

    // Настройки эффектов (из конфига)
    this.effects = {
      transition: 'kenburns', // fade | kenburns | zoom | blur
      kenBurns: true,
    }

    this._bindToggle()
    this._bindEffects()
  }

  // Загрузить настройки из конфига
  applyConfig(config) {
    if (config.effects) {
      this.effects.transition = config.effects.transition || 'kenburns'
      this.effects.kenBurns = config.effects.kenBurns !== false
    }
    this._highlightEffect()
  }

  setDuration(seconds) {
    this._currentDuration = Math.max(seconds, 1)
  }

  setImage(imgData, duration) {
    const { data: dataUri, orientation, width, height } = imgData
    const dur = Math.max(duration || this._currentDuration, 1)
    this._currentDuration = dur

    // Определяем ориентацию для cover/contain
    const imgLandscape = width > 0 && height > 0 ? width > height : null
    const scrLandscape = window.innerWidth > window.innerHeight
    const useCover = imgLandscape !== null && imgLandscape === scrLandscape
    const objectFit = useCover ? 'cover' : 'contain'

    // Какой слой будет новым
    const newImg = this._activeImg === this.imgFront ? this.imgBack : this.imgFront
    const oldImg = this._activeImg

    // Сброс нового слоя
    newImg.style.transition = 'none'
    newImg.style.opacity = '1'
    newImg.style.display = 'block'
    newImg.style.objectFit = objectFit
    newImg.style.filter = 'none'

    // EXIF-трансформация
    const orient = orientationCSS(orientation || 1)
    const origin = randomKBOrigin()
    newImg.style.transformOrigin = origin

    // Начальное состояние в зависимости от типа перехода
    let startTransform, endTransform, transitionProps
    const baseEnd = `${orient} scale(1.0) translate(0, 0)`
    const { transition, kenBurns } = this.effects

    switch (transition) {
      case 'fade':
        // Только cross-fade, без zoom
        startTransform = orient
        transitionProps = `opacity 0.6s ease`
        break

      case 'zoom':
        // Zoom-in при входе: scale(0.92) → scale(1.0) за 0.5s
        newImg.style.transform = `${orient} scale(0.92)`
        void newImg.offsetHeight
        startTransform = `${orient} scale(1.0)`
        transitionProps = `transform 0.5s ease-out, opacity 0.6s ease`
        break

      case 'blur':
        // Blur-in: blur(6px) → none за 0.6s
        newImg.style.filter = 'blur(6px)'
        newImg.style.transform = orient
        void newImg.offsetHeight
        newImg.style.transform = orient
        startTransform = orient
        transitionProps = `filter 0.6s ease-out, opacity 0.6s ease`
        break

      default: // kenburns
        newImg.style.transform = `${orient} scale(1.0) translate(0, 0)`
        void newImg.offsetHeight
        startTransform = baseEnd
        transitionProps = `opacity 0.6s ease`
        break
    }

    newImg.src = dataUri
    newImg.classList.remove('exit')
    newImg.classList.add('active', 'enter')

    // Применяем начальный transform
    if (transition !== 'fade' && transition !== 'blur') {
      newImg.style.transform = startTransform
    }

    // Запускаем Ken Burns (медленный zoom) если включён
    if (kenBurns) {
      const zoomTarget = 1.06 + Math.random() * 0.04
      const dx = (Math.random() - 0.5) * 2
      const dy = (Math.random() - 0.5) * 2
      const kbEnd = `${orient} scale(${zoomTarget}) translate(${dx}%, ${dy}%)`

      // Если transition уже задаёт transform через animation, комбинируем
      if (transition === 'kenburns' || transition === 'fade') {
        // Плавный переход от scale(1) к scale(target) за время показа
        newImg.style.transition = `transform ${dur}s linear, opacity 0.6s ease`
        newImg.style.transform = kbEnd
      } else {
        // После того как transition закончится (0.5-0.6s), запускаем Ken Burns
        newImg.style.transition = `transform ${dur}s linear, opacity 0.6s ease, filter 0.6s ease`
        setTimeout(() => {
          newImg.style.transform = kbEnd
        }, 600)
      }
    } else {
      // Без Ken Burns — только transition (если есть)
      if (transition !== 'fade') {
        newImg.style.transition = transitionProps
      }
    }

    // Старый слой: fade out
    oldImg.style.transition = `opacity 0.6s ease, transform 0.6s ease`
    oldImg.classList.remove('active')
    oldImg.classList.add('exit')
    oldImg.style.opacity = '0'

    // Меняем активный
    this._activeImg = newImg

    // Размытый фон (только для contain)
    if (!useCover) {
      this.stageBg.style.backgroundImage = `url('${dataUri}')`
      this.stageBg.style.display = 'block'
    } else {
      this.stageBg.style.display = 'none'
    }

    document.body.classList.remove('cursor-hidden')

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
    this._hideEffects()
  }

  async toggleFullscreen() {
    const isFs = await WindowIsFullscreen()
    if (isFs) WindowUnfullscreen()
    else WindowFullscreen()
  }

  // Кнопка выхода
  quit() {
    Quit()
  }

  // === Эффекты ===

  _bindEffects() {
    // Кнопка открытия меню
    this.btnEffects.addEventListener('click', (e) => {
      e.stopPropagation()
      this._effectsVisible ? this._hideEffects() : this._showEffects()
    })

    // Кнопки выбора эффекта
    document.querySelectorAll('.effect-opt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const effect = btn.dataset.effect
        this.effects.transition = effect
        SetTransition(effect)
        this._highlightEffect()
        this._hideEffects()
      })
    })
  }

  _showEffects() {
    this._effectsVisible = true
    this.effectsMenu.classList.add('visible')
  }

  _hideEffects() {
    this._effectsVisible = false
    this.effectsMenu.classList.remove('visible')
  }

  _highlightEffect() {
    document.querySelectorAll('.effect-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.effect === this.effects.transition)
    })
  }

  // Клик вне меню — закрыть
  _bindToggle() {
    document.addEventListener('click', (e) => {
      const inControls = this.controls.contains(e.target)
      const inEmpty    = this.emptyState.contains(e.target)
      const inEffects  = this.effectsMenu.contains(e.target)

      if (inEffects) return // клик по меню не закрывает

      if (!inControls && !inEmpty) {
        this.toggleControls()
      }

      if (!this.btnEffects.contains(e.target)) {
        this._hideEffects()
      }
    })
  }
}

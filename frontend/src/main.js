import { Slider } from './slider.js'
import { UI } from './ui.js'

window.addEventListener('DOMContentLoaded', async () => {
  const ui     = new UI()
  const slider = new Slider(ui)

  // Синхронизируем класс тела с видимостью курсора
  const controls = document.getElementById('controls')
  new MutationObserver(() => {
    document.body.classList.toggle('controls-visible', controls.classList.contains('visible'))
  }).observe(controls, { attributes: true, attributeFilter: ['class'] })

  await slider.init()
})

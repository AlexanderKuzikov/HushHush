import { Slider } from './slider.js'
import { UI } from './ui.js'

// Инициализация после загрузки DOM
window.addEventListener('DOMContentLoaded', async () => {
  const ui = new UI()
  const slider = new Slider(ui)

  await slider.init()
})

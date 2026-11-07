// The offline screen's words and theme (offline.html, shown by sw.js). The words are the
// shell's Offline gate's (@ppe/app-shell text.ts) and Retry (@ppe/ui text.ts); a test keeps
// them in step. The language and theme are the ones this device last used (@ppe/i18n,
// @ppe/app-shell theme.ts), read from the same keys.
;(() => {
  const words = {
    en: {
      title: 'The server cannot be reached',
      hint: 'Check your connection. The app tries again when you are back online.',
      retry: 'Retry',
    },
    lt: {
      title: 'Nepavyksta pasiekti serverio',
      hint: 'Patikrinkite ryšį. Programa bandys dar kartą, kai ryšys atsiras.',
      retry: 'Bandyti dar kartą',
    },
    ru: {
      title: 'Сервер недоступен',
      hint: 'Проверьте подключение. Приложение попробует снова, когда связь восстановится.',
      retry: 'Повторить',
    },
  }
  let lang = null
  let theme = null
  try {
    lang = localStorage.getItem('workwear.language')
    theme = localStorage.getItem('workwear.theme')
  } catch {
    // Storage refused: the browser's language and the device's theme.
  }
  if (!words[lang]) lang = (navigator.language || '').slice(0, 2)
  if (!words[lang]) lang = 'en'
  const root = document.documentElement
  root.lang = lang
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
  for (const el of document.querySelectorAll('[data-word]')) el.textContent = words[lang][el.dataset.word]
  // Back online, or Retry: load the page that could not be loaded.
  const again = () => window.location.reload()
  document.querySelector('button').addEventListener('click', again)
  window.addEventListener('online', again)
})()

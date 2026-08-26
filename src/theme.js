const THEME_KEY = 'exam_theme' // 'light' | 'dark'
const LEGACY_KEY = 'exam_dark_mode'

function getPreferredTheme(){
  const saved = localStorage.getItem(THEME_KEY)
  if(saved === 'light' || saved === 'dark') return saved
  // migrate legacy
  const legacy = localStorage.getItem(LEGACY_KEY)
  if(legacy === 'true') return 'dark'
  if(legacy === 'false') return 'light'
  // default is light as requested
  return 'light'
}

function applyTheme(theme){
  const html = document.documentElement
  if(theme === 'dark'){
    html.classList.add('dark')
    html.setAttribute('data-theme','dark')
  } else {
    html.classList.remove('dark')
    html.setAttribute('data-theme','light')
  }
  localStorage.setItem(THEME_KEY, theme)
  updateThemeUI(theme)
  // also keep legacy key for compatibility
  localStorage.setItem(LEGACY_KEY, theme === 'dark' ? 'true' : 'false')
}

function updateThemeUI(theme){
  // header button
  const btn = document.getElementById('darkModeBtn')
  if(btn){
    // moon for light (click to go dark), sun for dark (click to go light)
    if(theme === 'dark'){
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
      btn.setAttribute('aria-label','ライトモードに切替')
      btn.setAttribute('title','ライトモードに切替')
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
      btn.setAttribute('aria-label','ダークモードに切替')
      btn.setAttribute('title','ダークモードに切替')
    }
  }
  // menu item icon/text
  const menuIcon = document.querySelector('.menu-item[data-action="toggleDarkMode"] .menu-icon')
  const menuText = document.querySelector('.menu-item[data-action="toggleDarkMode"]')
  if(menuIcon){
    if(theme === 'dark'){
      menuIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    } else {
      menuIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
    }
  }
  if(menuText){
    // keep text but ensure it reflects action
    const label = menuText.childNodes[menuText.childNodes.length-1]
    // not needed to change text, keep "テーマ切替"
  }
  // meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]')
  if(meta){
    meta.setAttribute('content', theme === 'dark' ? '#070A14' : '#f8fafc')
  }
}

export function initTheme(){
  const theme = getPreferredTheme()
  applyTheme(theme)
  // bind header button
  document.getElementById('darkModeBtn')?.addEventListener('click', toggleTheme)
  // menu toggle is handled in main.js via data-action, but also handle here for other pages
  document.querySelector('.menu-item[data-action="toggleDarkMode"]')?.addEventListener('click', (e)=>{
    // prevent double handling if main.js also handles
    // we will handle here and stop propagation
    e.stopPropagation()
    toggleTheme()
  })
}

export function toggleTheme(){
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  const next = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
}

export function getTheme(){
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

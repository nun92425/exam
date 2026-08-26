export const $ = (s, r=document) => r.querySelector(s)
export const $$ = (s, r=document) => [...r.querySelectorAll(s)]
export const show = el => el && el.classList.remove('hidden')
export const hide = el => el && el.classList.add('hidden')

export function toast(msg, ms=2600){
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(()=> t.remove(), ms)
}

export function escHtml(s){
  if(!s) return ''
  const d=document.createElement('div')
  d.textContent=s
  return d.innerHTML
}
export function escAttr(s){
  if(!s) return ''
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export function formatICSDate(d){
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0')
}
export function parseScheduleDate(str){
  const m = String(str||'').match(/(\d{1,2})\/(\d{1,2})/)
  if(!m) return null
  const now=new Date(); now.setHours(0,0,0,0)
  const d=new Date(now.getFullYear(), parseInt(m[1])-1, parseInt(m[2]))
  d.setHours(0,0,0,0)
  if(d < now) d.setFullYear(d.getFullYear()+1)
  return d
}
export function escapeICS(s){
  return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n')
}

export function getProgressKey(ver, course, subject, notes, idx){
  const notePart = (notes||'').replace(/[^a-zA-Z0-9\u3000-\u9FFF]/g,'').slice(0,20)
  return ['exam_sub_progress',ver,course,subject,notePart||idx].filter(Boolean).join('_')
}

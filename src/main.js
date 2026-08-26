import './style.css'
import { COURSES, STORAGE_KEYS, SUBJECT_COLORS, getSubjects } from './constants.js'
import { $, show, hide, toast, escHtml, escAttr, parseScheduleDate, escapeICS, formatICSDate, getProgressKey } from './utils.js'
import { initAuth, bindAuthModals, getIsAdmin, authReady } from './auth.js'
import { getConfig, getSchedules, getSubmissions } from './firestore.js'

let state = { course: null, config: null, schedule: [], submissions: [], subjects: [] }

// ---------- helpers ----------
const CIRCUMFERENCE = 2 * Math.PI * 78 // ~490.09
let FOCUS_SEC = 25*60, BREAK_SEC=5*60
let timer = { mode:'focus', left:FOCUS_SEC, running:false, subject:'', interval:null }

function updateMenuCourseLabel(){
  const l=$('#menuCourseLabel')
  if(l) l.textContent = '現在: ' + (state.course || '--')
  const v=$('#menuVersionLabel')
  if(v) v.textContent = state.config?.version || '--'
  const adminLink=$('#menuAdminLink')
  if(adminLink) {
    if(getIsAdmin()) { adminLink.classList.remove('hidden'); adminLink.classList.add('flex') }
    else { adminLink.classList.add('hidden'); adminLink.classList.remove('flex') }
  }
}

// ---------- Course ----------
function getSavedCourse(){ return localStorage.getItem(STORAGE_KEYS.course) }
function saveCourse(c){
  localStorage.setItem(STORAGE_KEYS.course, c)
  state.course=c
  updateMenuCourseLabel()
}
function showCourseModal(){
  const m=$('#courseModal'); m.classList.remove('hidden')
  document.querySelectorAll('.course-btn').forEach(b=>{
    b.classList.toggle('selected', b.dataset.course===state.course)
  })
}
function hideCourseModal(){ $('#courseModal')?.classList.add('hidden') }
function initCourse(){
  const saved=getSavedCourse()
  if(saved){ state.course=saved; hideCourseModal(); loadData() }
  else showCourseModal()
  document.querySelectorAll('.course-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      saveCourse(btn.dataset.course)
      hideCourseModal()
      loadData()
    })
  })
}

// ---------- Data ----------
async function loadData(){
  const loading=$('#loading'), errorBox=$('#errorBox')
  show(loading); hide(errorBox); hide($('#emptyState')); hide($('#subEmptyState'))
  try{
    const config = await getConfig()
    state.config = config
    state.subjects = getSubjects(state.course, config.version)
    const [schedules, submissions] = await Promise.all([
      getSchedules(config.version, state.course),
      getSubmissions(config.version, state.course),
    ])
    // sort schedule by date then period
    schedules.sort((a,b)=>{
      const da=a.date||'', db=b.date||''; if(da<db) return -1; if(da>db) return 1
      const pa=parseInt(a.period)||0, pb=parseInt(b.period)||0; return pa-pb
    })
    state.schedule=schedules
    state.submissions=submissions
    renderInfo(); renderSchedule(); renderSubmissions(); renderCountdown(); updateProgressUI(); updateLastUpdated(); updateTimerSubjects()
  } catch(e){
    show(errorBox); $('#errorMessage').textContent='データの読み込みに失敗しました: '+ (e.message||e)
  } finally { hide(loading) }
}

function renderInfo(){
  if(state.config){
    $('#versionBadge').textContent = state.config.version || '--'
    $('#versionLabel').textContent = state.config.versionLabel || ''
  }
  if(state.course) $('#courseBadge').textContent = state.course
  updateMenuCourseLabel()
}

function renderSchedule(){
  const tbody=$('#scheduleBody'), empty=$('#emptyState')
  tbody.innerHTML=''
  if(!state.schedule || state.schedule.length===0){ show(empty); return }
  hide(empty)
  let lastDate=''
  state.schedule.forEach(row=>{
    const color=row.color || SUBJECT_COLORS[row.subject] || '#3B82F6'
    const date=row.date||''
    if(date && date!==lastDate){
      lastDate=date
      const tr=document.createElement('tr')
      tr.innerHTML=`<td colspan="5" class="!py-2 !px-3 bg-gradient-to-r from-white/[0.07] to-transparent border-y border-white/5 text-xs font-bold tracking-wide text-zinc-300">📅 ${escHtml(date)}</td>`
      tbody.appendChild(tr)
    }
    const tr=document.createElement('tr')
    tr.innerHTML=`
      <td><div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}; box-shadow:0 0 8px ${color}66"></span><span class="font-semibold text-zinc-100">${escHtml(row.subject)}</span></div></td>
      <td class="font-mono text-xs text-zinc-300 whitespace-nowrap">${escHtml(date)}</td>
      <td class="text-center"><span class="inline-flex px-2 py-1 rounded-full bg-white/10 border border-white/10 text-[11px] font-bold">${escHtml(row.period||'')}</span></td>
      <td class="text-zinc-300 leading-relaxed text-[13px] whitespace-pre-wrap">${escHtml(row.scope||'').replace(/\n/g,'<br>')}</td>
      <td class="text-zinc-400 text-xs leading-relaxed">${escHtml(row.notes||'').replace(/\n/g,'<br>')}</td>`
    tbody.appendChild(tr)
  })
}

function renderSubmissions(){
  const tbody=$('#submissionBody'), empty=$('#subEmptyState')
  tbody.innerHTML=''
  if(!state.submissions || state.submissions.length===0){ show(empty); updateSubProgressMini(); return }
  hide(empty)
  state.submissions.forEach((row,i)=>{
    const key=getProgressKey(state.config?.version, state.course, row.subject, row.notes, i)
    const checked=localStorage.getItem(key)==='true'
    const color=row.color || SUBJECT_COLORS[row.subject] || '#6B7280'
    const tr=document.createElement('tr')
    if(checked) tr.classList.add('row-completed')
    tr.innerHTML=`
      <td><div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}"></span><span class="font-semibold">${escHtml(row.subject)}</span></div></td>
      <td class="text-zinc-300 text-[13px] whitespace-pre-wrap leading-relaxed">${escHtml(row.notes||'')}</td>
      <td class="text-center"><input type="checkbox" ${checked?'checked':''} class="w-5 h-5 accent-cyan-400 rounded cursor-pointer"></td>`
    const cb=tr.querySelector('input')
    cb.addEventListener('change', ()=>{
      localStorage.setItem(key, cb.checked?'true':'false')
      tr.classList.toggle('row-completed', cb.checked)
      updateProgressUI()
    })
    tbody.appendChild(tr)
  })
  updateSubProgressMini()
}

function updateProgressUI(){
  const boxes=[...document.querySelectorAll('#submissionBody input[type="checkbox"]')]
  const total=boxes.length, done=boxes.filter(cb=>cb.checked).length
  const pct= total? (done/total)*100 : 0
  const text=`${done} / ${total}`
  const topText=$('#topProgressText'); if(topText) topText.textContent=text
  const mini=$('#subProgressMini'); if(mini) mini.textContent=text
  const badge=$('#subProgressBadge'); if(badge) badge.textContent=text
  const bar=$('#topProgressBar'); if(bar) bar.style.width=pct+'%'
}
function updateSubProgressMini(){ updateProgressUI() }
function updateLastUpdated(){
  const el=$('#lastUpdated'); if(!el) return
  const now=new Date()
  el.textContent = now.toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
}

function resetProgress(){
  document.querySelectorAll('#submissionBody input[type="checkbox"]').forEach(cb=>{
    const tr=cb.closest('tr')
    const rowIdx=[...tr.parentNode.children].indexOf(tr) // not reliable, use key re-eval: just clear storage keys for this version/course
    // simpler: uncheck and clear localStorage for this view by brute force: clear all exam_sub_progress_ keys for current ver+course
  })
  // brute clear for current ver/course
  const prefix=`exam_sub_progress_${state.config?.version}_${state.course}`
  for(let i=localStorage.length-1;i>=0;i--){
    const k=localStorage.key(i)
    if(k && k.startsWith(prefix)) localStorage.removeItem(k)
  }
  // also clear any matching view
  document.querySelectorAll('#submissionBody input[type="checkbox"]').forEach(cb=>{
    cb.checked=false; cb.closest('tr')?.classList.remove('row-completed')
  })
  updateProgressUI(); toast('進捗をリセットしました')
}

// ---------- Countdown ----------
function renderCountdown(){
  const card=$('#countdownCard')
  if(!state.schedule || state.schedule.length===0){ card.classList.add('hidden'); return }
  const today=new Date(); today.setHours(0,0,0,0)
  let earliest=null, earliestRow=null
  for(const r of state.schedule){
    const d=parseScheduleDate(r.date); if(!d) continue
    if(d>=today && (!earliest || d<earliest)){ earliest=d; earliestRow=r }
  }
  if(!earliest){ card.classList.add('hidden'); return }
  const diff=Math.ceil((earliest - today)/(1000*60*60*24))
  $('#countdownNumber').textContent = String(diff)
  $('#countdownSub').textContent = earliestRow ? `${earliestRow.subject} (${earliestRow.date})` : ''
  card.classList.remove('hidden')
}

// ---------- Timer ----------
const TIMER_PREFIX='exam_timer_'
function openTimerModal(){
  $('#timerModal').classList.remove('hidden')
  updateTimerSubjects(); updateTimerStats(); applyTimerDuration()
}
function closeTimerModal(){
  pauseTimer(); $('#timerModal').classList.add('hidden')
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{})
}
function applyTimerDuration(){
  const f=parseInt($('#timerFocusMin').value)||25, b=parseInt($('#timerBreakMin').value)||5
  FOCUS_SEC=Math.max(1,Math.min(120,f))*60; BREAK_SEC=Math.max(1,Math.min(30,b))*60
  if(!timer.running) resetTimer()
}
function updateTimerSubjects(){
  const sel=$('#timerSubject'); if(!sel) return
  const cur=sel.value
  sel.innerHTML='<option value="">教科を選択</option>'
  state.subjects.forEach(s=>{
    const subj = typeof s==='string' ? s : s.subject
    const o=document.createElement('option'); o.value=subj; o.textContent=subj; sel.appendChild(o)
  })
  if(cur) sel.value=cur
}
function toggleTimer(){ timer.running ? pauseTimer() : startTimer() }
function startTimer(){
  if(timer.mode==='focus' && !$('#timerSubject').value){ toast('教科を選択してください'); return }
  timer.subject=$('#timerSubject').value
  timer.running=true
  timer.interval=setInterval(tick, 1000)
  $('#timerToggleBtn').textContent='⏸ 一時停止'
  $('#timerToggleBtn').className='btn-ghost !bg-amber-500/15 !border-amber-500/20 !text-amber-200'
}
function pauseTimer(){
  timer.running=false
  if(timer.interval){ clearInterval(timer.interval); timer.interval=null }
  const btn=$('#timerToggleBtn'); if(btn){ btn.textContent='▶ 開始'; btn.className='btn-primary !px-8' }
}
function resetTimer(){
  pauseTimer(); timer.mode='focus'; timer.left=FOCUS_SEC
  updateTimerDisplay(); updateTimerRing()
  $('#timerModeLabel').textContent='📚 集中'
}
function tick(){
  timer.left--
  updateTimerDisplay(); updateTimerRing()
  if(timer.left<=0){
    if(timer.mode==='focus'){
      saveStudyTime(timer.subject, FOCUS_SEC); updateTimerStats()
      timer.mode='break'; timer.left=BREAK_SEC; $('#timerModeLabel').textContent='☕ 休憩'; toast(`お疲れ様！${Math.round(BREAK_SEC/60)}分休憩`)
    } else {
      timer.mode='focus'; timer.left=FOCUS_SEC; $('#timerModeLabel').textContent='📚 集中'; toast('休憩終了！集中しましょう')
    }
    updateTimerDisplay(); updateTimerRing(); pauseTimer()
  }
}
function updateTimerDisplay(){
  const m=String(Math.floor(timer.left/60)).padStart(2,'0'), s=String(timer.left%60).padStart(2,'0')
  $('#timerDisplay').textContent=m+':'+s
}
function updateTimerRing(){
  const total=timer.mode==='focus'?FOCUS_SEC:BREAK_SEC
  const offset=CIRCUMFERENCE*(1 - timer.left/total)
  const c=$('#timerProgressCircle'); if(c) c.setAttribute('stroke-dashoffset', offset)
  // color switch
  if(timer.mode==='break') c?.setAttribute('stroke','#ec4899')
  else c?.setAttribute('stroke','url(#grad)')
}
function saveStudyTime(subject, sec){
  if(!subject) return
  const today=new Date().toISOString().slice(0,10)
  const key=TIMER_PREFIX+today+'_'+subject
  localStorage.setItem(key, (parseInt(localStorage.getItem(key))||0)+sec)
}
function updateTimerStats(){
  const container=$('#timerStats')
  const today=new Date().toISOString().slice(0,10)
  let html='<div class="text-xs font-bold tracking-wide text-zinc-400">今日の勉強時間</div>'
  let has=false
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i)
    if(k && k.startsWith(TIMER_PREFIX+today)){
      const subj=k.replace(TIMER_PREFIX+today+'_','')
      const sec=parseInt(localStorage.getItem(k))||0, min=Math.round(sec/60)
      if(min>0){ has=true; html+=`<div class="flex justify-between text-sm py-1"><span>${escHtml(subj)}</span><span class="font-mono text-zinc-400">${min}分</span></div>` }
    }
  }
  if(!has) html+='<div class="text-xs text-zinc-500 mt-1">まだ記録がありません</div>'
  container.innerHTML=html
}

// ---------- Calendar ----------
function exportCalendar(){
  if(!state.schedule || state.schedule.length===0){ toast('エクスポートするデータがありません'); return }
  const now=new Date(), ds=formatICSDate(now)
  let ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ExamCoverage//JP\r\n'
  state.schedule.forEach((row,i)=>{
    if(!row.date||!row.subject) return
    const d=parseICSDate(row.date); if(!d) return
    const summary=escapeICS(row.subject)+(row.period?` (${escapeICS(row.period)})`:'')
    let desc=''
    if(row.scope) desc+='範囲: '+escapeICS(row.scope)
    if(row.notes) desc+=(desc?'\\n':'')+'備考: '+escapeICS(row.notes)
    if(state.course) desc+=(desc?'\\n':'')+'コース: '+escapeICS(state.course)
    const uid=`${d}-${row.subject.replace(/[^a-zA-Z0-9]/g,'')}-${i}@exam`
    ics+=`BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${ds}T000000Z\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${addDays(d,1)}\r\n`
    if(desc) ics+=`DESCRIPTION:${desc}\r\n`
    ics+=`END:VEVENT\r\n`
  })
  ics+='END:VCALENDAR'
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download='test_schedule.ics'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  toast('📅 カレンダーファイルをダウンロードしました')
}
function parseICSDate(str){
  const m=String(str).match(/(\d{1,2})\/(\d{1,2})/); if(!m) return null
  const today=new Date(); let y=today.getFullYear()
  let d=new Date(y, parseInt(m[1])-1, parseInt(m[2])); d.setHours(0,0,0,0)
  if(d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d=new Date(y+1, parseInt(m[1])-1, parseInt(m[2]))
  return formatICSDate(d)
}
function addDays(s,n){
  const y=parseInt(s.slice(0,4)), m=parseInt(s.slice(4,6))-1, d=parseInt(s.slice(6,8))
  const dt=new Date(y,m,d); dt.setDate(dt.getDate()+n); return formatICSDate(dt)
}

// ---------- Menu ----------
function initMenu(){
  const btn=$('#menuBtn'), overlay=$('#menuOverlay'), dropdown=$('#menuDropdown')
  const toggle=()=>{ const open=dropdown.classList.toggle('hidden'); overlay.classList.toggle('hidden', open); }
  const close=()=>{ dropdown.classList.add('hidden'); overlay.classList.add('hidden') }
  btn?.addEventListener('click', e=>{ e.stopPropagation(); dropdown.classList.contains('hidden') ? (dropdown.classList.remove('hidden'), overlay.classList.remove('hidden')) : close() })
  overlay?.addEventListener('click', close)
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close() })
  dropdown?.addEventListener('click', e=>{
    const item=e.target.closest('.menu-item'); if(!item) return
    const a=item.dataset.action
    if(a==='changeCourse'){ close(); showCourseModal() }
    else if(a==='exportCalendar'){ close(); exportCalendar() }
    else if(a==='toggleDarkMode'){ close(); toast('テーマはダーククールを維持しています') }
    else if(a==='openTimer'){ close(); openTimerModal() }
    else if(a==='scrollTo'){ close(); const t=document.getElementById(item.dataset.target); t?.scrollIntoView({behavior:'smooth',block:'start'}) }
  })
}

// ---------- Dark (keep subtle) ----------
function initDark(){
  // 画面は常にダーククール。ボタンはトーストのみ
  $('#darkModeBtn')?.addEventListener('click', ()=> toast('ダーククールテーマで固定表示しています'))
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  initAuth(); bindAuthModals()
  initMenu(); initDark()
  $('#printBtn')?.addEventListener('click', ()=> window.print())
  $('#calendarExportBtn')?.addEventListener('click', exportCalendar)
  $('#resetProgressBtn')?.addEventListener('click', resetProgress)
  // timer
  $('#timerToggleBtn')?.addEventListener('click', toggleTimer)
  $('#timerResetBtn')?.addEventListener('click', resetTimer)
  $('#timerCloseBtn')?.addEventListener('click', closeTimerModal)
  $('#timerFullscreenBtn')?.addEventListener('click', ()=>{
    const m=$('#timerModal'); if(!document.fullscreenElement) m.requestFullscreen().catch(()=>{}); else document.exitFullscreen()
  })
  $('#timerSubject')?.addEventListener('change', e=>{ timer.subject=e.target.value; if(!timer.running) resetTimer() })
  $('#timerFocusMin')?.addEventListener('change', applyTimerDuration)
  $('#timerBreakMin')?.addEventListener('change', applyTimerDuration)
  $('#timerModal')?.addEventListener('click', e=>{ if(e.target===$('#timerModal')) closeTimerModal() })
  // course
  initCourse()
  // auth ready then update admin link
  await authReady
  updateMenuCourseLabel()
  // if course already selected but not loaded (initCourse loads), ensure load
  if(state.course && state.schedule.length===0){
    // already triggered
  }
  // timer initial display
  updateTimerDisplay(); updateTimerRing()
})

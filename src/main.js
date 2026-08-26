import './style.css'
import { COURSES, STORAGE_KEYS, SUBJECT_COLORS, getSubjects } from './constants.js'
import { $, show, hide, toast, escHtml, escAttr, parseScheduleDate, escapeICS, formatICSDate, getProgressKey } from './utils.js'
import { initAuth, bindAuthModals, getIsAdmin, authReady } from './auth.js'
import { getConfig, getSchedules, getSubmissions } from './firestore.js'

let state = {
  course: null, config: null, schedule: [], submissions: [], subjects: [],
  filterQuery: '',
  filterSubject: '',
  todayOnly: false,
  sortBy: 'date',
  viewMode: localStorage.getItem('exam_view_mode') || 'table', // table | card
  density: localStorage.getItem('exam_density') || 'comfortable', // comfortable | compact
  subFilter: 'all', // all | todo | done
}

const CIRCUMFERENCE = 2 * Math.PI * 78
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
    // initial sort by date then period
    schedules.sort((a,b)=>{
      const da=a.date||'', db=b.date||''; if(da<db) return -1; if(da>db) return 1
      const pa=parseInt(a.period)||0, pb=parseInt(b.period)||0; return pa-pb
    })
    state.schedule=schedules
    state.submissions=submissions
    renderInfo(); renderSubjectChips(); renderSchedule(); renderSubmissions(); renderCountdown(); updateProgressUI(); updateLastUpdated(); updateTimerSubjects()
    updateScheduleCount()
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

function getMemoKey(row,i){
  const ver=state.config?.version||'v'
  const c=state.course||'c'
  return `exam_memo_${ver}_${c}_${row.subject}_${row.date||''}_${row.period||''}_${i}`
}
function getDateBadge(dateStr){
  const d=parseScheduleDate(dateStr)
  if(!d) return null
  const today=new Date(); today.setHours(0,0,0,0)
  const diff=Math.ceil((d - today)/(1000*60*60*24))
  if(diff===0) return { label:'TODAY', cls:'bg-red-500 text-white border-red-600 shadow-[0_0_10px_rgba(239,68,68,0.4)]' }
  if(diff===1) return { label:'TOMORROW', cls:'bg-orange-500 text-white border-orange-600' }
  if(diff>1 && diff<=3) return { label:`あと${diff}日`, cls:'bg-amber-500/15 text-amber-200 border-amber-500/30' }
  if(diff<0) return { label:'終了', cls:'bg-zinc-700 text-zinc-400 border-zinc-600' }
  return null
}

function filteredSchedules(){
  let rows=[...state.schedule]
  // today only
  if(state.todayOnly){
    const today=new Date(); today.setHours(0,0,0,0)
    rows=rows.filter(r=>{ const d=parseScheduleDate(r.date); return d && d>=today })
  }
  // subject filter
  if(state.filterSubject){
    rows=rows.filter(r=> r.subject===state.filterSubject)
  }
  // search query
  if(state.filterQuery){
    const q=state.filterQuery.toLowerCase()
    rows=rows.filter(r=> [r.subject,r.scope,r.notes,r.date,r.period].join(' ').toLowerCase().includes(q))
  }
  // sort
  if(state.sortBy==='subject'){
    rows.sort((a,b)=> (a.subject||'').localeCompare(b.subject||'','ja'))
  } else if(state.sortBy==='period'){
    rows.sort((a,b)=> (parseInt(a.period)||99)-(parseInt(b.period)||99))
  } else {
    rows.sort((a,b)=>{
      const da=parseScheduleDate(a.date), db=parseScheduleDate(b.date)
      if(!da && !db) return 0
      if(!da) return 1
      if(!db) return -1
      if(da-db!==0) return da-db
      return (parseInt(a.period)||0)-(parseInt(b.period)||0)
    })
  }
  return rows
}

function updateScheduleCount(){
  const el=$('#scheduleCount')
  if(!el) return
  const total=state.schedule.length
  const filtered=filteredSchedules().length
  el.textContent = state.filterQuery||state.filterSubject||state.todayOnly ? `${filtered} / ${total}件` : `${total}件`
}

function renderSubjectChips(){
  const wrap=$('#subjectChips')
  if(!wrap) return
  wrap.innerHTML=''
  const allBtn=document.createElement('button')
  allBtn.textContent='すべて'
  allBtn.className = !state.filterSubject ? 'px-2.5 py-1 rounded-full text-xs font-bold bg-white text-zinc-900' : 'px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 border border-white/10'
  allBtn.addEventListener('click', ()=>{ state.filterSubject=''; renderSubjectChips(); renderSchedule() })
  wrap.appendChild(allBtn)
  const uniq=[...new Set(state.subjects.map(s=> typeof s==='string'?s:s.subject))]
  // also include any subject in schedule not in list
  for(const r of state.schedule){ if(!uniq.includes(r.subject)) uniq.push(r.subject) }
  uniq.forEach(sub=>{
    const btn=document.createElement('button')
    const active=state.filterSubject===sub
    btn.className = active ? 'px-2.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-cyan-500 to-violet-500 text-white' : 'px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 border border-white/10 hover:bg-white/15'
    btn.textContent=sub
    btn.style.borderLeftColor= SUBJECT_COLORS[sub] || '#fff'
    if(active) btn.style.boxShadow=`0 0 0 1px ${SUBJECT_COLORS[sub]||'#fff'}40`
    btn.addEventListener('click', ()=>{ state.filterSubject= active ? '' : sub; renderSubjectChips(); renderSchedule() })
    wrap.appendChild(btn)
  })
}

function renderSchedule(){
  const rows=filteredSchedules()
  updateScheduleCount()
  const tbody=$('#scheduleBody'), empty=$('#emptyState'), cards=$('#scheduleCards'), tableWrap=$('#scheduleTable')?.parentElement
  const isCard = state.viewMode==='card'
  // view toggle UI
  $('#viewTableBtn')?.classList.toggle('bg-white', !isCard)
  $('#viewTableBtn')?.classList.toggle('text-zinc-900', !isCard)
  $('#viewTableBtn')?.classList.toggle('bg-white/10', isCard)
  $('#viewCardBtn')?.classList.toggle('bg-white', isCard)
  $('#viewCardBtn')?.classList.toggle('text-zinc-900', isCard)
  $('#viewCardBtn')?.classList.toggle('bg-white/10', !isCard)
  // density button label
  const dBtn=$('#densityBtn')
  if(dBtn) dBtn.textContent = state.density==='compact' ? '↕ コンパクト' : '↕ ゆったり'
  // density class
  document.documentElement.setAttribute('data-density', state.density)

  if(isCard){
    if(tableWrap) tableWrap.classList.add('hidden')
    cards.classList.remove('hidden')
  } else {
    if(tableWrap) tableWrap.classList.remove('hidden')
    cards.classList.add('hidden')
  }

  // render table
  tbody.innerHTML=''
  cards.innerHTML=''
  if(rows.length===0){
    show(empty)
    if(isCard) cards.classList.add('hidden')
    return
  }
  hide(empty)

  let lastDate=''
  rows.forEach((row, idx)=>{
    const globalIdx=state.schedule.indexOf(row)
    const color=row.color || SUBJECT_COLORS[row.subject] || '#3B82F6'
    const date=row.date||''
    const badge=getDateBadge(date)
    const memoKey=getMemoKey(row, globalIdx)
    const memoVal=localStorage.getItem(memoKey)||''
    const hasMemo=!!memoVal

    // table row
    if(!isCard){
      if(date && date!==lastDate){
        lastDate=date
        const tr=document.createElement('tr')
        tr.innerHTML=`<td colspan="5" class="!py-2 !px-3 bg-gradient-to-r from-white/[0.07] to-transparent border-y border-white/5 text-xs font-bold tracking-wide text-zinc-300 flex items-center gap-2">📅 ${escHtml(date)} ${badge?`<span class="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-black border ${badge.cls}">${badge.label}</span>`:''}</td>`
        // colspan td is inside tr, but we used flex; fix: wrap
        // redo correctly
        tr.innerHTML=`<td colspan="5" class="!py-2 !px-3 bg-gradient-to-r from-white/[0.07] to-transparent border-y border-white/5 text-xs font-bold tracking-wide text-zinc-300">📅 ${escHtml(date)} ${badge?`<span class="ml-2 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-black border ${badge.cls}">${badge.label}</span>`:''}</td>`
        tbody.appendChild(tr)
      }
      const tr=document.createElement('tr')
      tr.className = state.density==='compact' ? '[&>td]:!py-2 [&>td]:!text-xs' : ''
      tr.innerHTML=`
        <td><div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}; box-shadow:0 0 8px ${color}66"></span><span class="font-semibold text-zinc-100">${escHtml(row.subject)}</span>${hasMemo?'<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>':''}</div></td>
        <td class="font-mono text-xs whitespace-nowrap"><span class="inline-flex items-center gap-1.5">${escHtml(date)} ${badge&&date===lastDate?'': badge?`<span class="px-1.5 py-0.5 rounded-full text-[10px] font-black border ${badge.cls}">${badge.label}</span>`:''}</span></td>
        <td class="text-center"><span class="inline-flex px-2 py-1 rounded-full bg-white/10 border border-white/10 text-[11px] font-bold">${escHtml(row.period||'')}</span></td>
        <td class="text-zinc-300 leading-relaxed text-[13px] whitespace-pre-wrap">${escHtml(row.scope||'').replace(/\n/g,'<br>')}</td>
        <td class="text-zinc-400 text-xs leading-relaxed"><div>${escHtml(row.notes||'').replace(/\n/g,'<br>')}</div>${hasMemo?`<div class="mt-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">📝 ${escHtml(memoVal)}</div>`:''}<button data-memo="${globalIdx}" class="mt-1 text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10">${hasMemo?'メモ編集':'＋メモ'}</button></td>`
      tbody.appendChild(tr)
      // memo expand row
      const memoBtn=tr.querySelector(`[data-memo="${globalIdx}"]`)
      memoBtn?.addEventListener('click', ()=>{
        const cur=localStorage.getItem(memoKey)||''
        const nv=prompt('個人メモ（自分だけに表示、端末に保存）', cur)
        if(nv===null) return
        if(nv) localStorage.setItem(memoKey, nv); else localStorage.removeItem(memoKey)
        renderSchedule()
      })
    }

    // card
    const card=document.createElement('div')
    card.className='p-3 rounded-2xl glass-subtle card-hover flex flex-col gap-2 ' + (state.density==='compact'?'!p-2.5':'')
    card.innerHTML=`
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span><span class="font-bold text-sm">${escHtml(row.subject)}</span></div>
        <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 border border-white/10">${escHtml(date)} ${escHtml(row.period||'')}</span>
      </div>
      ${badge?`<div class="inline-flex self-start px-2 py-0.5 rounded-full text-[11px] font-black border ${badge.cls}">${badge.label} • ${escHtml(date)}</div>`:''}
      <div class="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed bg-white/[0.03] border border-white/5 rounded-xl p-2.5">${escHtml(row.scope||'（範囲なし）').replace(/\n/g,'<br>')}</div>
      ${row.notes?`<div class="text-xs text-zinc-400">${escHtml(row.notes).replace(/\n/g,'<br>')}</div>`:''}
      ${hasMemo?`<div class="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">📝 ${escHtml(memoVal)}</div>`:''}
      <button data-memo-card="${globalIdx}" class="self-start text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10">📝 ${hasMemo?'メモ編集':'メモ追加'}</button>
    `
    card.querySelector(`[data-memo-card="${globalIdx}"]`)?.addEventListener('click', ()=>{
      const cur=localStorage.getItem(memoKey)||''
      const nv=prompt('個人メモ', cur)
      if(nv===null) return
      if(nv) localStorage.setItem(memoKey, nv); else localStorage.removeItem(memoKey)
      renderSchedule()
    })
    cards.appendChild(card)
  })
}

function renderSubmissions(){
  const tbody=$('#submissionBody'), empty=$('#subEmptyState')
  tbody.innerHTML=''
  // filter
  let rows=[...state.submissions]
  if(state.subFilter==='todo'){
    rows=rows.filter((r,i)=> localStorage.getItem(getProgressKey(state.config?.version, state.course, r.subject, r.notes, i))!=='true')
  } else if(state.subFilter==='done'){
    rows=rows.filter((r,i)=> localStorage.getItem(getProgressKey(state.config?.version, state.course, r.subject, r.notes, i))==='true')
  }
  if(rows.length===0){
    if(state.submissions.length===0){
      show(empty); empty.querySelector('p').textContent='提出物データがありません'
    } else {
      show(empty); empty.querySelector('p').textContent='条件に一致する提出物がありません'
      // still show but with empty message; keep table empty
    }
    updateSubProgressMini()
    return
  }
  hide(empty)
  rows.forEach((row)=>{
    const origIdx=state.submissions.indexOf(row)
    const key=getProgressKey(state.config?.version, state.course, row.subject, row.notes, origIdx)
    const checked=localStorage.getItem(key)==='true'
    const color=row.color || SUBJECT_COLORS[row.subject] || '#6B7280'
    const memoKey=`exam_memo_sub_${state.config?.version}_${state.course}_${row.subject}_${origIdx}`
    const memoVal=localStorage.getItem(memoKey)||''
    const hasMemo=!!memoVal
    const tr=document.createElement('tr')
    if(checked) tr.classList.add('row-completed')
    tr.innerHTML=`
      <td><div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}"></span><span class="font-semibold">${escHtml(row.subject)}</span></div></td>
      <td class="text-zinc-300 text-[13px] whitespace-pre-wrap leading-relaxed"><div>${escHtml(row.notes||'')}</div>${hasMemo?`<div class="mt-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">📝 ${escHtml(memoVal)}</div>`:''}</td>
      <td class="text-center"><input type="checkbox" ${checked?'checked':''} class="w-5 h-5 accent-cyan-400 rounded cursor-pointer"></td>
      <td class="text-center"><button data-memo-sub="${origIdx}" class="w-6 h-6 grid place-items-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-[11px]">${hasMemo?'📝':'＋'}</button></td>`
    const cb=tr.querySelector('input')
    cb.addEventListener('change', ()=>{
      localStorage.setItem(key, cb.checked?'true':'false')
      tr.classList.toggle('row-completed', cb.checked)
      updateProgressUI()
      // re-apply filter if needed
      if(state.subFilter!=='all') renderSubmissions()
    })
    tr.querySelector(`[data-memo-sub="${origIdx}"]`)?.addEventListener('click', ()=>{
      const cur=localStorage.getItem(memoKey)||''
      const nv=prompt('提出物の個人メモ', cur)
      if(nv===null) return
      if(nv) localStorage.setItem(memoKey, nv); else localStorage.removeItem(memoKey)
      renderSubmissions()
    })
    tbody.appendChild(tr)
  })
  updateSubProgressMini()
}

function updateProgressUI(){
  const boxes=[...document.querySelectorAll('#submissionBody input[type="checkbox"]')]
  const totalFiltered=boxes.length
  // total for top bar = all submissions (unfiltered) to avoid confusion? Use filtered vs total? Use all for top
  const allBoxesTotal=state.submissions.length
  const allDone=state.submissions.filter((r,i)=> localStorage.getItem(getProgressKey(state.config?.version, state.course, r.subject, r.notes, i))==='true').length
  const pct= allBoxesTotal? (allDone/allBoxesTotal)*100 : 0
  const text=`${allDone} / ${allBoxesTotal}`
  const topText=$('#topProgressText'); if(topText) topText.textContent=text
  const badge=$('#subProgressBadge'); if(badge) badge.textContent=text
  const bar=$('#topProgressBar'); if(bar) bar.style.width=pct+'%'
  const mini=$('#subProgressMini'); if(mini) mini.textContent = `${boxes.filter(cb=>cb.checked).length} / ${boxes.length}（表示中）`
  // update sub filter buttons active
  for(const id of ['subAllBtn','subTodoBtn','subDoneBtn']){
    const el=document.getElementById(id)
    if(!el) continue
    const want = (id==='subAllBtn'&&state.subFilter==='all')||(id==='subTodoBtn'&&state.subFilter==='todo')||(id==='subDoneBtn'&&state.subFilter==='done')
    el.className = want ? 'px-2.5 py-1 rounded-full text-xs font-bold bg-white text-zinc-900' : 'px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 border border-white/10'
  }
}
function updateSubProgressMini(){ updateProgressUI() }
function updateLastUpdated(){
  const el=$('#lastUpdated'); if(!el) return
  const now=new Date()
  el.textContent = now.toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
}

function resetProgress(){
  const prefix=`exam_sub_progress_${state.config?.version}_${state.course}`
  for(let i=localStorage.length-1;i>=0;i--){
    const k=localStorage.key(i)
    if(k && k.startsWith(prefix)) localStorage.removeItem(k)
  }
  document.querySelectorAll('#submissionBody input[type="checkbox"]').forEach(cb=>{
    cb.checked=false; cb.closest('tr')?.classList.remove('row-completed')
  })
  updateProgressUI(); renderSubmissions(); toast('進捗をリセットしました')
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
      try{ new Notification('集中完了', { body: `${timer.subject} ${Math.round(FOCUS_SEC/60)}分お疲れ様！` }) }catch{}
    } else {
      timer.mode='focus'; timer.left=FOCUS_SEC; $('#timerModeLabel').textContent='📚 集中'; toast('休憩終了！集中しましょう')
      try{ new Notification('休憩終了', { body: '集中再開！' }) }catch{}
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
function initDark(){
  $('#darkModeBtn')?.addEventListener('click', ()=> toast('ダーククールテーマで固定表示しています'))
}

function initFilters(){
  const search=$('#searchInput'), sort=$('#sortSelect'), viewT=$('#viewTableBtn'), viewC=$('#viewCardBtn'), dens=$('#densityBtn'), todayBtn=$('#todayFilterBtn')
  search?.addEventListener('input', e=>{ state.filterQuery=e.target.value.trim(); renderSchedule() })
  sort?.addEventListener('change', e=>{ state.sortBy=e.target.value; renderSchedule() })
  viewT?.addEventListener('click', ()=>{ state.viewMode='table'; localStorage.setItem('exam_view_mode','table'); renderSchedule() })
  viewC?.addEventListener('click', ()=>{ state.viewMode='card'; localStorage.setItem('exam_view_mode','card'); renderSchedule() })
  dens?.addEventListener('click', ()=>{
    state.density = state.density==='compact' ? 'comfortable' : 'compact'
    localStorage.setItem('exam_density', state.density)
    renderSchedule()
    toast(state.density==='compact'?'コンパクト表示':'ゆったり表示')
  })
  todayBtn?.addEventListener('click', ()=>{
    state.todayOnly=!state.todayOnly
    todayBtn.classList.toggle('bg-white', state.todayOnly)
    todayBtn.classList.toggle('text-zinc-900', state.todayOnly)
    todayBtn.classList.toggle('bg-white/10', !state.todayOnly)
    renderSchedule()
  })
  // submission filters
  $('#subAllBtn')?.addEventListener('click', ()=>{ state.subFilter='all'; renderSubmissions() })
  $('#subTodoBtn')?.addEventListener('click', ()=>{ state.subFilter='todo'; renderSubmissions() })
  $('#subDoneBtn')?.addEventListener('click', ()=>{ state.subFilter='done'; renderSubmissions() })
  $('#subCheckAllBtn')?.addEventListener('click', ()=>{
    state.submissions.forEach((r,i)=>{
      const k=getProgressKey(state.config?.version, state.course, r.subject, r.notes, i)
      localStorage.setItem(k,'true')
    })
    renderSubmissions(); updateProgressUI(); toast('すべて完了にしました')
  })
  $('#subUncheckAllBtn')?.addEventListener('click', ()=>{
    state.submissions.forEach((r,i)=>{
      const k=getProgressKey(state.config?.version, state.course, r.subject, r.notes, i)
      localStorage.removeItem(k)
    })
    renderSubmissions(); updateProgressUI(); toast('すべて未完了に戻しました')
  })
  // keyboard shortcuts
  document.addEventListener('keydown', e=>{
    const tag=(document.activeElement?.tagName||'').toLowerCase()
    const isInput=['input','textarea','select'].includes(tag)
    if(e.key==='/' && !isInput){ e.preventDefault(); search?.focus() }
    if(!isInput && e.key.toLowerCase()==='t'){ openTimerModal() }
    if(!isInput && e.key.toLowerCase()==='c'){ showCourseModal() }
    if(e.key==='Escape' && state.filterQuery){ state.filterQuery=''; if(search) search.value=''; renderSchedule() }
  })
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  initAuth(); bindAuthModals()
  initMenu(); initDark(); initFilters()
  $('#printBtn')?.addEventListener('click', ()=> window.print())
  $('#calendarExportBtn')?.addEventListener('click', exportCalendar)
  $('#resetProgressBtn')?.addEventListener('click', resetProgress)
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
  initCourse()
  await authReady
  updateMenuCourseLabel()
  updateTimerDisplay(); updateTimerRing()
  // request notification permission lazily
  if('Notification' in window && Notification.permission==='default'){
    $('#timerToggleBtn')?.addEventListener('click', ()=> Notification.requestPermission().catch(()=>{}), { once:true })
  }
})

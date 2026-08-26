import './style.css'
import { $, show, hide, toast, escHtml, escAttr } from './utils.js'
import { initAuth, bindAuthModals, getIsAdmin, getCurrentUser, authReady } from './auth.js'
import { isConfigured, db } from './firebase.js'
import { initTheme } from './theme.js'
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, limit,
  serverTimestamp, writeBatch, updateDoc
} from 'firebase/firestore'
import { SUBJECT_COLORS } from './constants.js'

let state = { config:null, versions:[], suggestions:[], filter:'all', editVersion:'', editCourse:'共通', scheduleData:[], subData:[] }

// ---------- Config / Versions ----------
async function loadConfig(){
  if(!isConfigured){
    state.config={ version:'2学期 中間テスト', versionLabel:'2026年度 2学期' }
    state.versions=['2学期 中間テスト','2学期 期末テスト','3学期 学年末テスト']
    renderVersionUI()
    return
  }
  try{
    const snap = await getDoc(doc(db,'config','main'))
    if(snap.exists()) state.config=snap.data()
    else state.config={ version:'2学期 中間テスト', versionLabel:'2026年度 2学期', updatedAt: serverTimestamp() }
    const vSnap = await getDocs(collection(db,'versions'))
    state.versions = vSnap.docs.map(d=> d.id)
    if(state.versions.length===0) state.versions=[state.config.version]
    renderVersionUI()
  } catch(e){
    console.warn(e); toast('設定の読み込みに失敗')
  }
}
function renderVersionUI(){
  const cur=$('#currentVersion'); if(cur) cur.textContent=state.config?.version || '--'
  const sel=$('#versionSelect'), sel2=$('#editVersionSelect'), sel3=$('#subVersionSelect')
  for(const s of [sel, sel2, sel3]){
    if(!s) continue
    const curVal=s.value
    s.innerHTML='<option value="">バージョンを選択</option>'
    state.versions.forEach(v=>{
      const o=document.createElement('option'); o.value=v; o.textContent=v; s.appendChild(o)
    })
    if(state.config?.version) s.value=state.config.version
    else if(curVal) s.value=curVal
  }
}
async function updateVersion(){
  const nv=$('#versionSelect').value
  if(!nv){ toast('バージョンを選択してください'); return }
  if(!isConfigured){ state.config.version=nv; renderVersionUI(); toast(`「${nv}」を反映しました（デモ）`); return }
  try{
    await setDoc(doc(db,'config','main'), { version:nv, versionLabel: state.config.versionLabel || '', updatedAt: serverTimestamp() }, { merge:true })
    // ensure versions collection has doc
    await setDoc(doc(db,'versions', nv), { name:nv, createdAt: serverTimestamp() }, { merge:true })
    state.config.version=nv; renderVersionUI(); toast(`「${nv}」を反映しました`)
  } catch(e){ toast('更新に失敗: '+(e.message||e)) }
}
async function addVersion(){
  const name=prompt('新しいバージョン名を入力（例: 2学期 期末テスト）:')
  if(!name || !name.trim()) return
  const v=name.trim()
  if(!isConfigured){
    if(!state.versions.includes(v)) state.versions.push(v)
    state.config.version=v; renderVersionUI(); toast(`「${v}」を作成しました（デモ）`); return
  }
  try{
    await setDoc(doc(db,'versions', v), { name:v, createdAt: serverTimestamp() })
    await setDoc(doc(db,'config','main'), { version:v, updatedAt: serverTimestamp() }, { merge:true })
    state.config.version=v
    if(!state.versions.includes(v)) state.versions.push(v)
    renderVersionUI(); toast(`「${v}」を作成しました`)
  } catch(e){ toast('作成に失敗') }
}

// ---------- Schedule editor ----------
async function loadScheduleForEdit(){
  const version=$('#editVersionSelect').value, course=$('#editCourseSelect').value
  if(!version){ toast('バージョンを選択してください'); return }
  state.editVersion=version; state.editCourse=course
  if(!isConfigured){
    // demo: filter mock via firestore.js fallback? just use empty
    state.scheduleData=[
      { subject:'論理国語', date:'9/10(水)', period:'1限', scope:'教科書 p.10〜48', notes:'', color:SUBJECT_COLORS['論理国語'] },
    ]
    renderScheduleEditor(); return
  }
  try{
    const qy=query(collection(db,'schedules'), where('version','==', version), where('course','==', course))
    const snap=await getDocs(qy)
    state.scheduleData=snap.docs.map(d=> ({ id:d.id, ...d.data() }))
    renderScheduleEditor()
  } catch(e){ toast('読み込み失敗: '+(e.message||e)) }
}
function renderScheduleEditor(){
  const el=$('#scheduleEditor')
  if(state.scheduleData.length===0){
    el.innerHTML='<div class="p-8 text-center text-sm text-zinc-500">データがありません。「+ 行を追加」で追加してください</div>'; return
  }
  let html='<table class="w-full text-sm"><thead><tr class="text-[11px] tracking-widest font-bold text-zinc-400 border-b border-white/10"><th class="text-left px-2 py-2">教科</th><th class="text-left px-2 py-2">日程</th><th class="text-left px-2 py-2">時限</th><th class="text-left px-2 py-2">範囲</th><th class="text-left px-2 py-2">備考</th><th class="px-2 py-2">操作</th></tr></thead><tbody>'
  state.scheduleData.forEach((row,i)=>{
    html+=`<tr data-idx="${i}" class="border-b border-white/5">
      <td class="p-1"><input data-field="subject" value="${escAttr(row.subject||'')}" class="input !py-1.5 !text-xs"></td>
      <td class="p-1"><input data-field="date" value="${escAttr(row.date||'')}" placeholder="9/10(水)" class="input !py-1.5 !text-xs"></td>
      <td class="p-1"><input data-field="period" value="${escAttr(row.period||'')}" placeholder="1限" class="input !py-1.5 !text-xs"></td>
      <td class="p-1"><textarea data-field="scope" rows="2" class="input !py-1.5 !text-xs min-h-[40px]">${escAttr(row.scope||'')}</textarea></td>
      <td class="p-1"><textarea data-field="notes" rows="2" class="input !py-1.5 !text-xs min-h-[40px]">${escAttr(row.notes||'')}</textarea></td>
      <td class="p-1"><button data-del="${i}" class="btn-danger">削除</button></td>
    </tr>`
  })
  html+='</tbody></table>'; el.innerHTML=html
  el.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{
    const idx=parseInt(b.dataset.del); state.scheduleData.splice(idx,1); renderScheduleEditor()
  }))
}
function addEmptyRow(){
  if(!state.editVersion){ toast('先にバージョンを選択してください'); return }
  state.scheduleData.push({ version:state.editVersion, course:state.editCourse, subject:'', date:'', period:'', scope:'', notes:'', color:'#0ea5e9' })
  renderScheduleEditor()
}
async function saveSchedule(){
  const version=state.editVersion, course=state.editCourse
  if(!version){ toast('バージョンを選択してください'); return }
  const rows=[]
  $('#scheduleEditor').querySelectorAll('tr[data-idx]').forEach(tr=>{
    const obj={}; tr.querySelectorAll('[data-field]').forEach(inp=> obj[inp.dataset.field]=inp.value )
    if(obj.subject && obj.subject.trim()){
      rows.push({ subject:obj.subject.trim(), date:obj.date||'', period:obj.period||'', scope:obj.scope||'', notes:obj.notes||'', color: SUBJECT_COLORS[obj.subject] || '#0ea5e9' })
    }
  })
  if(!isConfigured){ toast(`保存しました（デモ: ${rows.length}件）`); return }
  try{
    // delete existing then batch create
    const qy=query(collection(db,'schedules'), where('version','==', version), where('course','==', course))
    const snap=await getDocs(qy)
    const batch=writeBatch(db)
    snap.docs.forEach(d=> batch.delete(d.ref))
    rows.forEach(r=>{
      const ref=doc(collection(db,'schedules'))
      batch.set(ref, { version, course, ...r, updatedAt: serverTimestamp() })
    })
    await batch.commit()
    toast(`保存しました（${rows.length}件）`)
    loadScheduleForEdit()
  } catch(e){ toast('保存に失敗: '+(e.message||e)) }
}

// ---------- Submissions editor ----------
async function loadSubForEdit(){
  const version=$('#subVersionSelect').value, course=$('#subCourseSelect').value
  if(!version){ toast('バージョンを選択してください'); return }
  state.subVersion=version; state.subCourse=course
  if(!isConfigured){
    state.subData=[{ subject:'論理国語', notes:'ワーク p.2〜20', color:SUBJECT_COLORS['論理国語'] }]
    renderSubEditor(); return
  }
  try{
    const qy=query(collection(db,'submissions'), where('version','==', version), where('course','==', course))
    const snap=await getDocs(qy)
    state.subData=snap.docs.map(d=> ({ id:d.id, ...d.data() }))
    renderSubEditor()
  } catch(e){ toast('読み込み失敗') }
}
function renderSubEditor(){
  const el=$('#submissionEditor')
  if(!state.subData || state.subData.length===0){ el.innerHTML='<div class="p-8 text-center text-sm text-zinc-500">データがありません。「+ 行を追加」で追加</div>'; return }
  let html='<table class="w-full text-sm"><thead><tr class="text-[11px] tracking-widest font-bold text-zinc-400 border-b border-white/10"><th class="text-left px-2 py-2">教科</th><th class="text-left px-2 py-2">提出物詳細</th><th class="px-2 py-2">操作</th></tr></thead><tbody>'
  state.subData.forEach((row,i)=>{
    html+=`<tr data-idx="${i}" class="border-b border-white/5">
      <td class="p-1"><input data-field="subject" value="${escAttr(row.subject||'')}" class="input !py-1.5 !text-xs"></td>
      <td class="p-1"><textarea data-field="notes" rows="2" class="input !py-1.5 !text-xs min-h-[40px]">${escAttr(row.notes||'')}</textarea></td>
      <td class="p-1"><button data-del="${i}" class="btn-danger">削除</button></td>
    </tr>`
  })
  html+='</tbody></table>'; el.innerHTML=html
  el.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{ const idx=parseInt(b.dataset.del); state.subData.splice(idx,1); renderSubEditor() }))
}
function addEmptySubRow(){
  if(!state.subVersion){ toast('先にバージョンを選択してください'); return }
  state.subData.push({ version:state.subVersion, course:state.subCourse, subject:'', notes:'', color:'#0ea5e9' })
  renderSubEditor()
}
async function saveSubs(){
  const version=state.subVersion, course=state.subCourse
  if(!version){ toast('バージョンを選択してください'); return }
  const rows=[]
  $('#submissionEditor').querySelectorAll('tr[data-idx]').forEach(tr=>{
    const obj={}; tr.querySelectorAll('[data-field]').forEach(inp=> obj[inp.dataset.field]=inp.value )
    if(obj.subject && obj.subject.trim()) rows.push({ subject:obj.subject.trim(), notes:obj.notes||'', color: SUBJECT_COLORS[obj.subject]||'#0ea5e9' })
  })
  if(!isConfigured){ toast(`保存しました（デモ: ${rows.length}件）`); return }
  try{
    const qy=query(collection(db,'submissions'), where('version','==', version), where('course','==', course))
    const snap=await getDocs(qy)
    const batch=writeBatch(db)
    snap.docs.forEach(d=> batch.delete(d.ref))
    rows.forEach(r=>{
      const ref=doc(collection(db,'submissions'))
      batch.set(ref, { version, course, ...r, updatedAt: serverTimestamp() })
    })
    await batch.commit()
    toast(`保存しました（${rows.length}件）`)
    loadSubForEdit()
  } catch(e){ toast('保存に失敗: '+(e.message||e)) }
}

// ---------- Suggestions ----------
async function loadSuggestions(){
  const list=$('#suggestionList'), loading=$('#sugLoading')
  show(loading); list.innerHTML=''
  if(!isConfigured){ hide(loading); list.innerHTML='<div class="text-center text-sm text-zinc-500 py-6">デモモード: Firestore未接続のため表示できません</div>'; return }
  try{
    const qy=query(collection(db,'suggestions'), orderBy('createdAt','desc'), limit(100))
    const snap=await getDocs(qy)
    state.suggestions=snap.docs.map(d=> ({ id:d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toLocaleString('ja-JP') || '' }))
    renderSuggestions()
  } catch(e){
    list.innerHTML='<div class="text-center text-sm text-zinc-500">読み込みに失敗しました</div>'
  } finally { hide(loading) }
}
function renderSuggestions(){
  const list=$('#suggestionList'); list.innerHTML=''
  const filtered = state.filter==='all' ? state.suggestions : state.suggestions.filter(s=> s.type===state.filter)
  if(filtered.length===0){ list.innerHTML='<div class="text-center py-8 text-zinc-500"><div class="text-2xl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 inline"><path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8"/><rect x="3" y="8" width="18" height="10" rx="2"/></svg></div><p class="text-sm mt-2">提案はありません</p></div>'; return }
  const pending=filtered.filter(s=> s.status==='承認待ち'), done=filtered.filter(s=> s.status!=='承認待ち')
  const mk=(arr, title)=>{
    if(arr.length===0) return
    const sec=document.createElement('div')
    sec.innerHTML=`<div class="text-xs font-bold tracking-wide text-zinc-400 mt-2 mb-2">${title} (${arr.length})</div>`
    arr.forEach(s=> sec.appendChild(createSuggestionEl(s)))
    list.appendChild(sec)
  }
  mk(pending, '承認待ち'); mk(done, '処理済み')
}
function createSuggestionEl(s){
  const div=document.createElement('div')
  div.className='p-4 rounded-2xl glass-subtle'
  const statusClass = s.status==='承認待ち' ? 'bg-amber-500/15 border-amber-500/20 text-amber-200' : s.status==='承認済み' ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-200' : 'bg-red-500/15 border-red-500/20 text-red-200'
  const isScope = s.type==='test_scope' || !s.type
  div.innerHTML=`
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-sm">${escHtml(s.subject)}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border ${isScope?'bg-cyan-500/15 border-cyan-500/20 text-cyan-200':'bg-violet-500/15 border-violet-500/20 text-violet-200'}">${isScope?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 inline"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z"/></svg> 範囲':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 inline"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> 提出物'}</span>
        <span class="text-xs text-zinc-400">${escHtml(s.course||'')}</span>
      </div>
      <span class="text-[11px] font-bold px-2 py-1 rounded-full border ${statusClass}">${escHtml(s.status||'承認待ち')}</span>
    </div>
    <div class="text-xs text-zinc-300 mt-2 space-y-0.5 leading-relaxed">
      <div><span class="text-zinc-500">バージョン:</span> ${escHtml(s.version||'')}</div>
      ${isScope?`<div><span class="text-zinc-500">日程:</span> ${escHtml(s.date||'未設定')} ${s.period?escHtml('/ '+s.period):''}</div><div><span class="text-zinc-500">範囲:</span> ${escHtml(s.scope||'未設定')}</div>`:''}
      <div><span class="text-zinc-500">${isScope?'備考':'提出物詳細'}:</span> ${escHtml(s.notes||'未設定')}</div>
      <div class="text-[11px] text-zinc-500">${escHtml(s.createdAt||'')}</div>
    </div>
    ${s.status==='承認待ち'?`<div class="flex gap-2 mt-3"><button data-act="approve" data-id="${s.id}" class="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-bold">承認</button><button data-act="reject" data-id="${s.id}" class="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold">却下</button></div>`:''}
  `
  div.querySelectorAll('[data-act="approve"]').forEach(b=> b.addEventListener('click', ()=> handleSuggestion(b.dataset.id,'approve')))
  div.querySelectorAll('[data-act="reject"]').forEach(b=> b.addEventListener('click', ()=> handleSuggestion(b.dataset.id,'reject')))
  return div
}
async function handleSuggestion(id, act){
  if(!isConfigured){ toast('デモモードでは処理できません'); return }
  try{
    const ref=doc(db,'suggestions', id)
    if(act==='approve'){
      await updateDoc(ref, { status:'承認済み' })
      toast('承認しました')
    } else {
      await updateDoc(ref, { status:'却下' })
      toast('却下しました')
    }
    loadSuggestions()
  } catch(e){ toast('処理に失敗: '+(e.message||e)) }
}

// ---------- Gate ----------
async function checkGate(){
  await authReady
  const user=getCurrentUser()
  const gate=$('#adminGate'), content=$('#adminContent'), info=$('#gateInfo')
  if(!isConfigured){
    // デモモードは無条件で開く
    hide(gate); show(content)
    loadConfig(); loadSuggestions()
    return
  }
  if(!user){
    show(gate); hide(content)
    info.textContent='未ログイン'
    return
  }
  if(!getIsAdmin()){
    show(gate); hide(content)
    info.textContent=`ログイン中: ${user.email} — 管理者権限がありません`
    return
  }
  hide(gate); show(content)
  loadConfig(); loadSuggestions()
}

// ---------- Bind ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  initTheme(); initAuth(); bindAuthModals()
  await authReady
  checkGate()
  $('#gateLoginBtn')?.addEventListener('click', ()=> show($('#loginModal')))
  // top links are plain <a>, ensure they work even when JS is busy
  document.querySelectorAll('a[href="index.html"]')?.forEach(a=>{
    a.addEventListener('click', e=>{
      // allow native navigation, but prevent any stray preventDefault
      e.stopPropagation()
    })
  })
  $('#updateVersionBtn')?.addEventListener('click', updateVersion)
  $('#addVersionBtn')?.addEventListener('click', addVersion)
  $('#loadScheduleBtn')?.addEventListener('click', loadScheduleForEdit)
  $('#addEntryBtn')?.addEventListener('click', addEmptyRow)
  $('#saveScheduleBtn')?.addEventListener('click', saveSchedule)
  $('#loadSubBtn')?.addEventListener('click', loadSubForEdit)
  $('#addSubEntryBtn')?.addEventListener('click', addEmptySubRow)
  $('#saveSubBtn')?.addEventListener('click', saveSubs)
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(x=>{ x.classList.remove('active','bg-white','text-zinc-900'); x.classList.add('bg-white/10','border','border-white/10') })
      b.classList.add('active','bg-white','text-zinc-900'); b.classList.remove('bg-white/10','border','border-white/10')
      state.filter=b.dataset.filter; renderSuggestions()
    })
  })
  // re-check gate only on auth state change, not via polling/observer (was causing heavy load and click blocking)
  // authReady already resolves once; also listen for future auth changes via a simple interval that is much lighter (10s) and only if needed
  // No MutationObserver – it was observing entire body and causing performance issues
})

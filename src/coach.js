import { getFunctions, httpsCallable } from 'firebase/functions'
import { app, isConfigured } from './firebase.js'
import { $, toast } from './utils.js'

let chatHistory = [] // {role, content}

function buildContext(state){
  const today = new Date().toISOString().slice(0,10)
  let todayMin = 0
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i)
    if(k && k.startsWith('exam_timer_'+today)) todayMin += Math.round((parseInt(localStorage.getItem(k))||0)/60)
  }
  const subs = state.submissions || []
  const done = subs.filter((r,i)=>{
    const ver=state.config?.version||'v', course=state.course||'c'
    const key = `exam_sub_progress_${ver}_${course}_${r.subject}_${(r.notes||'').replace(/[^a-zA-Z0-9\u3000-\u9FFF]/g,'').slice(0,20) || i}`
    // fallback to generic key used in main.js
    return localStorage.getItem(key)==='true' || localStorage.getItem(`exam_sub_progress_${ver}_${course}_${r.subject}_${i}`)==='true'
  }).length
  return {
    course: state.course,
    version: state.config?.version || null,
    subjects: state.subjects || [],
    schedule: (state.schedule||[]).slice(0,20).map(s=> ({subject:s.subject, date:s.date, period:s.period})),
    scheduleCount: state.schedule?.length || 0,
    submissionsProgress: { done, total: subs.length },
    timerWeekMin: todayMin,
    streak: getStreak()
  }
}

function getStreak(){
  let streak=0
  const today=new Date()
  for(let i=0;i<30;i++){
    const d=new Date(today); d.setDate(d.getDate()-i)
    const iso=d.toISOString().slice(0,10)
    let has=false
    for(let j=0;j<localStorage.length;j++){ const k=localStorage.key(j); if(k&&k.startsWith('exam_timer_'+iso) && parseInt(localStorage.getItem(k))>0) has=true }
    if(has) streak++; else if(i>0) break
  }
  return streak
}

export function initCoach(stateRef){
  // stateRef is a getter for current state
  const btn = document.getElementById('coachBtn')
  const modal = document.getElementById('coachModal')
  const closeBtn = document.getElementById('coachCloseBtn')
  const sendBtn = document.getElementById('coachSendBtn')
  const input = document.getElementById('coachInput')
  const container = document.getElementById('coachChatContainer')
  if(!btn || !modal) return

  // load history from localStorage
  try{
    const raw=localStorage.getItem('exam_coach_history')
    if(raw) chatHistory = JSON.parse(raw)
  }catch{}

  function saveHistory(){
    try{ localStorage.setItem('exam_coach_history', JSON.stringify(chatHistory.slice(-20))) }catch{}
  }
  function render(){
    if(!container) return
    container.innerHTML=''
    if(chatHistory.length===0){
      container.innerHTML='<div class="p-4 text-center text-sm text-zinc-500">学習の悩みを気軽にどうぞ。<br>例: 「数学の二次関数が分からない」「来週までに歴史を1日1時間で終わらせたい」</div>'
      return
    }
    for(const m of chatHistory){
      const isUser=m.role==='user'
      const div=document.createElement('div')
      div.className=`flex ${isUser?'justify-end':'justify-start'}`
      div.innerHTML=`<div class="max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${isUser?'bg-gradient-to-r from-cyan-500 to-violet-500 text-white':'bg-white dark:bg-white/[0.06] border border-zinc-200 dark:border-white/10 text-zinc-800 dark:text-zinc-200'}">${escapeHtml(m.content).replace(/\n/g,'<br>')}</div>`
      container.appendChild(div)
    }
    container.scrollTop=container.scrollHeight
  }
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML }

  btn.addEventListener('click', ()=>{
    modal.classList.remove('hidden')
    render()
    updateContextBadge(stateRef())
  })
  closeBtn?.addEventListener('click', ()=> modal.classList.add('hidden'))
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.classList.add('hidden') })

  async function send(){
    const text=input.value.trim()
    if(!text) return
    if(text.length>1000){ toast('メッセージが長すぎます'); return }
    // disclaimer check: warn if contains personal-like patterns (simple)
    if(/(学籍|住所|電話|本名)/.test(text)){
      toast('個人情報は入力しないでください')
      return
    }
    chatHistory.push({role:'user', content:text})
    input.value=''
    render()
    saveHistory()
    sendBtn.disabled=true
    sendBtn.textContent='送信中...'
    try{
      const state = stateRef()
      const context = buildContext(state)
      let reply
      if(!isConfigured){
        reply = `（デモ）\n質問: ${text}\n\nヒント: 範囲を日割りし、1日3科目まで、試験前日は復習日にしてください。詳細は「学習計画」ボタンで生成できます。`
      } else {
        try{
          const functions = getFunctions(app, 'asia-northeast1')
          const fn = httpsCallable(functions, 'coachChat')
          const res = await fn({ message: text, context, history: chatHistory.slice(-6) })
          reply = res.data.reply
        } catch(fnErr){
          // Functions未デプロイやinternalエラーはデモとして親切にフォールバック
          const code = fnErr?.code || ''
          const rawMsg = fnErr?.message || ''
          if(code.includes('not-found') || code.includes('unavailable') || rawMsg.includes('not found') || code==='internal' || rawMsg.includes('internal')){
            reply = `AIコーチは現在準備中（Functions未デプロイ）です。\n\n質問: ${text}\n\nヒント: 範囲を日割りし、1日3科目まで、試験前日は復習日に。詳細は「学習計画」ボタンで生成できます。\n\n※ 管理者は Firebase Console → Functions → coachChat をデプロイし、GEMINI_API_KEY を設定してください。`
          } else {
            throw fnErr
          }
        }
      }
      chatHistory.push({role:'assistant', content:reply})
      render()
      saveHistory()
    } catch(e){
      const msg=e?.message||'エラーが発生しました。しばらくしてから再試行してください。'
      const code=e?.code||''
      if(msg.includes('混雑') || msg.includes('resource-exhausted') || code.includes('resource-exhausted')){
        chatHistory.push({role:'assistant', content:'混雑中です。30秒後に再試行してください。（Gemini Free Tierの60回/分制限）'})
      } else if(code.includes('internal') || msg.includes('internal')){
        chatHistory.push({role:'assistant', content:'AIの呼び出しで内部エラーが発生しました。Functionsが未デプロイか、GEMINI_API_KEYが未設定の可能性があります。しばらくしてから再試行するか、「学習計画」ボタンで日割り計画を生成してください。'})
      } else {
        chatHistory.push({role:'assistant', content: msg})
      }
      render()
    } finally{
      sendBtn.disabled=false
      sendBtn.textContent='送信'
    }
  }

  sendBtn?.addEventListener('click', send)
  input?.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send() } })

  function updateContextBadge(state){
    const badge=document.getElementById('coachContextBadge')
    if(!badge) return
    const ctx=buildContext(state)
    badge.textContent=`${ctx.course||'コース未選択'} / ${ctx.version||'-'} / 提出${ctx.submissionsProgress.done}/${ctx.submissionsProgress.total}`
  }

  // expose for external
  window._coachUpdateContext = ()=> updateContextBadge(stateRef())
}

export function clearCoachHistory(){
  chatHistory=[]
  localStorage.removeItem('exam_coach_history')
}

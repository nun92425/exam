import './style.css'
import { $, show, hide, toast, escHtml } from './utils.js'
import { getSubjects } from './constants.js'
import { initAuth, bindAuthModals, getCurrentUser, authReady } from './auth.js'
import { getConfig, getVersions } from './firestore.js'
import { auth, db, isConfigured } from './firebase.js'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'

let versions=[]

function getMockVersions(){
  return ['2学期 中間テスト','2学期 期末テスト','3学期 学年末テスト']
}

async function loadVersions(){
  const sel=$('#sugVersion')
  try{
    const [config, vers] = await Promise.all([getConfig(), getVersions()])
    versions = vers && vers.length ? vers : getMockVersions()
    const cur = config?.version || versions[0]
    sel.innerHTML='<option value="">選択してください</option>'
    versions.forEach(v=>{
      const o=document.createElement('option'); o.value=v; o.textContent=v; if(v===cur) o.selected=true; sel.appendChild(o)
    })
    // if course saved, load subjects
    const saved=localStorage.getItem('exam_course_selected')
    if(saved && $('#sugCourse').value===saved) loadSubjects(saved, sel.value)
    else if($('#sugCourse').value) loadSubjects($('#sugCourse').value, sel.value)
  } catch(e){
    sel.innerHTML='<option value="">読み込みに失敗しました</option>'
  }
}

function loadSubjects(course, version){
  const sel=$('#sugSubject')
  try{
    const subs=getSubjects(course, version)
    sel.innerHTML='<option value="">選択してください</option>'
    subs.forEach(s=>{
      const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o)
    })
  } catch{
    sel.innerHTML='<option value="">科目の読み込みに失敗しました</option>'
  }
}

function toggleType(){
  const type=document.querySelector('input[name="sugType"]:checked')?.value
  if(type==='submission'){ hide($('#scopeFields')); show($('#submissionFields')) }
  else { show($('#scopeFields')); hide($('#submissionFields')) }
}

window.resetSuggestionForm = function(){
  document.getElementById('suggestForm')?.reset()
  hide($('#successState')); show($('#suggestForm')); hide($('#errorBox')); hide($('#loading'))
  // restore defaults
  const r=document.querySelector('input[name="sugType"][value="test_scope"]'); if(r) r.checked=true; toggleType()
}

async function handleSubmit(e){
  e.preventDefault()
  const type=document.querySelector('input[name="sugType"]:checked')?.value || 'test_scope'
  const version=$('#sugVersion').value, course=$('#sugCourse').value, subject=$('#sugSubject').value
  const date=$('#sugDate').value.trim(), period=$('#sugPeriod').value.trim()
  const scope=$('#sugScope').value.trim()
  const notes = type==='submission' ? $('#sugSubNotes').value.trim() : $('#sugNotes').value.trim()

  if(!version || !course || !subject){
    show($('#errorBox')); $('#errorMessage').textContent='定期テスト、コース、教科は必須です'; return
  }
  if(type==='submission' && !notes){
    show($('#errorBox')); $('#errorMessage').textContent='提出物の詳細を入力してください'; return
  }
  hide($('#errorBox'))

  // auth check
  await authReady
  const user=getCurrentUser()
  if(!isConfigured){
    // デモモードはそのまま成功扱い
    hide($('#suggestForm')); show($('#loading'))
    setTimeout(()=>{ hide($('#loading')); show($('#successState')); toast('デモモード: 提案を送信しました（ローカル）') }, 600)
    return
  }
  if(!user){
    toast('提案にはログインが必要です'); show($('#loginModal')); return
  }

  hide($('#suggestForm')); show($('#loading'))
  try{
    await addDoc(collection(db,'suggestions'), {
      type, version, course, subject, date, period, scope, notes,
      status:'承認待ち',
      authorUid: user.uid,
      authorEmail: user.email,
      createdAt: serverTimestamp()
    })
    hide($('#loading')); show($('#successState')); toast('提案を送信しました')
  } catch(err){
    hide($('#loading')); show($('#suggestForm'))
    show($('#errorBox')); $('#errorMessage').textContent='送信に失敗しました: '+(err.message||err)
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  initAuth(); bindAuthModals()
  loadVersions()
  const saved=localStorage.getItem('exam_course_selected')
  if(saved) $('#sugCourse').value=saved
  $('#sugCourse')?.addEventListener('change', e=>{
    const c=e.target.value
    if(c) loadSubjects(c, $('#sugVersion').value)
    else $('#sugSubject').innerHTML='<option value="">先にコースを選択してください</option>'
  })
  $('#sugVersion')?.addEventListener('change', e=>{
    const c=$('#sugCourse').value
    if(c) loadSubjects(c, e.target.value)
  })
  document.querySelectorAll('input[name="sugType"]').forEach(r=> r.addEventListener('change', toggleType))
  $('#suggestForm')?.addEventListener('submit', handleSubmit)
  await authReady
  // 画面表示後にログイン必須の旨を出す場合は自動でモーダルは出さない（送信時に出す）
})

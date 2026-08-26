import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, isConfigured } from './firebase.js'
import { $, show, hide, toast } from './utils.js'

let currentUser = null
let isAdmin = false
let authReadyResolve
export const authReady = new Promise(r => authReadyResolve = r)

export function initAuth(){
  if(!isConfigured || !auth){
    // デモモード: ローカルでログイン不要
    hide($('#loginModal')); hide($('#registerModal'))
    authReadyResolve(null)
    updateAuthUI(null)
    return
  }
  onAuthStateChanged(auth, async (user)=>{
    currentUser = user
    if(user){
      try{
        const snap = await getDoc(doc(db,'users',user.uid))
        if(!snap.exists()){
          // 初回: usersドキュメント作成
          await setDoc(doc(db,'users',user.uid), {
            email: user.email,
            displayName: user.displayName || '',
            isAdmin: false,
            createdAt: serverTimestamp(),
          })
          isAdmin = false
        } else {
          isAdmin = !!snap.data().isAdmin
        }
      } catch(e){
        console.warn('users fetch failed', e)
        isAdmin = false
      }
    } else {
      isAdmin = false
    }
    updateAuthUI(user)
    authReadyResolve(user)
  })
}

export function getCurrentUser(){ return currentUser }
export function getIsAdmin(){ return isAdmin }

function updateAuthUI(user){
  const c = $('#accountContainer')
  if(!c) return
  if(user){
    const name = user.displayName || user.email?.split('@')[0] || 'User'
    const initial = name.charAt(0).toUpperCase()
    c.innerHTML = `
      <div class="relative">
        <button id="accountBtn" class="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white/[0.07] border border-white/10 hover:bg-white/10 transition">
          <span class="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 grid place-items-center text-xs font-bold text-white">${initial}</span>
          <span class="text-xs font-medium max-w-[86px] truncate">${esc(name)}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div id="accountMenu" class="hidden absolute right-0 mt-2 w-56 rounded-2xl glass-strong p-2 z-50">
          <div class="px-3 py-2">
            <div class="text-sm font-semibold truncate">${esc(name)}</div>
            <div class="text-[11px] text-zinc-400 truncate">${esc(user.email||'')}</div>
            ${isAdmin ? '<div class="mt-1 inline-flex px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-[10px] font-bold tracking-wide text-violet-300">ADMIN</div>' : ''}
          </div>
          <div class="h-px bg-white/10 my-1"></div>
          ${isAdmin ? '<a href="admin.html" class="block w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-white/10"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 inline"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg> 管理者画面</a>' : ''}
          <button id="logoutBtn" class="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-white/10 text-red-300">ログアウト</button>
        </div>
      </div>`
    $('#accountBtn')?.addEventListener('click', e=>{
      e.stopPropagation()
      $('#accountMenu')?.classList.toggle('hidden')
    })
    document.addEventListener('click', ()=> hide($('#accountMenu')), { once: false })
    $('#logoutBtn')?.addEventListener('click', handleLogout)
  } else {
    c.innerHTML = `
      <button id="openLoginBtn" class="px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 border border-white/10 hover:bg-white/15 transition">ログイン</button>
      <button id="openRegisterBtn" class="px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-400 to-violet-500 text-white shadow-glow">新規登録</button>
    `
    $('#openLoginBtn')?.addEventListener('click', ()=> show($('#loginModal')))
    $('#openRegisterBtn')?.addEventListener('click', ()=> show($('#registerModal')))
  }
}
function esc(s){
  const d=document.createElement('div'); d.textContent=s; return d.innerHTML
}

export async function handleLogin(){
  const email = $('#loginEmail')?.value.trim()
  const pw = $('#loginPassword')?.value
  if(!email||!pw) return showErr('loginError','メールアドレスとパスワードを入力してください')
  hideErr('loginError')
  if(!isConfigured) { toast('デモモード: Firebase未設定のためログインをスキップ'); hide($('#loginModal')); return }
  try{
    await signInWithEmailAndPassword(auth, email, pw)
    hide($('#loginModal')); toast('ログインしました')
  } catch(e){
    showErr('loginError', mapAuthErr(e))
  }
}
export async function handleRegister(){
  const name = $('#regDisplayName')?.value.trim()
  const email = $('#regEmail')?.value.trim()
  const pw = $('#regPassword')?.value
  if(!name||!email||!pw) return showErr('regError','全ての項目を入力してください')
  if(pw.length<8) return showErr('regError','パスワードは8文字以上必要です')
  hideErr('regError')
  if(!isConfigured) { toast('デモモード: 登録をスキップ'); hide($('#registerModal')); return }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pw)
    await updateProfile(cred.user, { displayName: name })
    await setDoc(doc(db,'users',cred.user.uid), {
      email, displayName: name, isAdmin: false, createdAt: serverTimestamp()
    }, { merge:true })
    hide($('#registerModal')); toast('登録しました')
  } catch(e){
    showErr('regError', mapAuthErr(e))
  }
}
export async function handleLogout(){
  if(!isConfigured) { toast('ログアウト（デモ）'); return }
  await signOut(auth); toast('ログアウトしました')
}
export async function handleForgot(){
  const email = $('#forgotEmail')?.value.trim()
  if(!email) return showErr('forgotError','メールアドレスを入力してください')
  hideErr('forgotError')
  if(!isConfigured) return showErr('forgotError','Firebase未設定（デモモード）')
  try{
    await sendPasswordResetEmail(auth, email)
    $('#forgotError')?.classList.add('hidden')
    const s=$('#forgotSuccess')
    if(s){ s.textContent='リセットメールを送信しました。メールをご確認ください。'; s.classList.remove('hidden') }
    setTimeout(()=> hide($('#forgotPasswordModal')), 3000)
  } catch(e){ showErr('forgotError', mapAuthErr(e)) }
}

function showErr(id, msg){
  const el=document.getElementById(id)
  if(el){ el.textContent=msg; el.classList.remove('hidden') }
}
function hideErr(id){ document.getElementById(id)?.classList.add('hidden') }
function mapAuthErr(e){
  const c=e?.code||''
  if(c.includes('user-not-found')||c.includes('wrong-password')||c.includes('invalid-credential')) return 'メールアドレスまたはパスワードが間違っています'
  if(c.includes('email-already-in-use')) return 'このメールアドレスは既に登録されています'
  if(c.includes('invalid-email')) return 'メールアドレスの形式が正しくありません'
  if(c.includes('weak-password')) return 'パスワードが弱すぎます'
  if(c.includes('too-many-requests')) return '試行回数が多すぎます。しばらく待ってください'
  return e?.message || 'エラーが発生しました'
}

export function bindAuthModals(){
  // 画面遷移
  $('#loginToRegister')?.addEventListener('click', ()=>{ hide($('#loginModal')); show($('#registerModal')) })
  $('#registerToLogin')?.addEventListener('click', ()=>{ hide($('#registerModal')); show($('#loginModal')) })
  $('#forgotPasswordLink')?.addEventListener('click', ()=>{ hide($('#loginModal')); show($('#forgotPasswordModal')) })
  $('#forgotToLogin')?.addEventListener('click', ()=>{ hide($('#forgotPasswordModal')); show($('#loginModal')) })
  $('#forgotSubmitBtn')?.addEventListener('click', handleForgot)
  $('#loginSubmitBtn')?.addEventListener('click', handleLogin)
  $('#regSubmitBtn')?.addEventListener('click', handleRegister)
  // 背景クリックで閉じる
  for(const id of ['loginModal','registerModal','forgotPasswordModal','resetPasswordModal']){
    const el=document.getElementById(id)
    el?.addEventListener('click', e=>{ if(e.target===el) hide(el) })
  }
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      for(const id of ['loginModal','registerModal','forgotPasswordModal']) hide(document.getElementById(id))
    }
  })
  // Enterで送信
  $('#loginPassword')?.addEventListener('keydown', e=>{ if(e.key==='Enter') handleLogin() })
  $('#regPassword')?.addEventListener('keydown', e=>{ if(e.key==='Enter') handleRegister() })
}

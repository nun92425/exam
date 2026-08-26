import { collection, doc, getDoc, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db, isConfigured } from './firebase.js'

// --- Mock fallback (Firebase未設定時のデモデータ) ---
const MOCK = {
  config: { version: '2学期 中間テスト', versionLabel: '2026年度 2学期' },
  versions: ['2学期 中間テスト','2学期 期末テスト','3学期 学年末テスト'],
  schedules: [
    { id:'1', version:'2学期 中間テスト', course:'共通', subject:'論理国語', date:'9/10(水)', period:'1限', scope:'教科書 p.10〜48\nワーク p.2〜20', notes:'漢字小テストあり', color:'#ef4444' },
    { id:'2', version:'2学期 中間テスト', course:'共通', subject:'数学①', date:'9/10(水)', period:'2限', scope:'教科書 p.88〜120\nプリントNo.1〜10', notes:'', color:'#0ea5e9' },
    { id:'3', version:'2学期 中間テスト', course:'共通', subject:'英C', date:'9/11(木)', period:'1限', scope:'教科書 Lesson3〜4\n単語帳 p.30〜60', notes:'リスニングあり', color:'#10b981' },
    { id:'4', version:'2学期 中間テスト', course:'共通', subject:'化学', date:'9/11(木)', period:'3限', scope:'教科書 p.60〜92\nセミナー p.40〜55', notes:'計算問題多め', color:'#14b8a6' },
    { id:'5', version:'2学期 中間テスト', course:'K/文系', subject:'歴史', date:'9/12(金)', period:'2限', scope:'教科書 p.102〜150', notes:'記述あり', color:'#f59e0b' },
    { id:'6', version:'2学期 中間テスト', course:'K/理系（物理）', subject:'物理', date:'9/12(金)', period:'2限', scope:'教科書 p.40〜88\nリードα p.20〜45', notes:'', color:'#06b6d4' },
    { id:'7', version:'2学期 中間テスト', course:'K/理系（物理）', subject:'地理', date:'9/12(金)', period:'4限', scope:'資料集 p.10〜35', notes:'地図あり', color:'#8b5cf6' },
  ],
  submissions: [
    { id:'a', version:'2学期 中間テスト', course:'K/文系', subject:'論理国語', notes:'漢字ワーク p.2〜20 提出\n授業ノート提出', color:'#ef4444' },
    { id:'b', version:'2学期 中間テスト', course:'K/文系', subject:'数学①', notes:'教科書 章末問題 提出', color:'#0ea5e9' },
    { id:'c', version:'2学期 中間テスト', course:'K/文系', subject:'英C', notes:'ワーク Lesson3〜4 提出', color:'#10b981' },
    { id:'d', version:'2学期 中間テスト', course:'K/理系（物理）', subject:'物理', notes:'リードα p.20〜45 提出', color:'#06b6d4' },
  ],
  suggestions: []
}

export async function getConfig(){
  if(!isConfigured) return MOCK.config
  try{
    const snap = await getDoc(doc(db,'config','main'))
    if(!snap.exists()) return MOCK.config
    return snap.data()
  } catch{ return MOCK.config }
}

export async function getVersions(){
  if(!isConfigured) return MOCK.versions
  try{
    const snap = await getDocs(collection(db,'versions'))
    if(snap.empty) return MOCK.versions
    return snap.docs.map(d=> d.id || d.data().name).sort()
  } catch{ return MOCK.versions }
}

export async function getSchedules(version, course){
  if(!isConfigured){
    return MOCK.schedules.filter(r=>{
      if(version && r.version!==version) return false
      if(course && r.course!==course && r.course!=='共通') return false
      return true
    })
  }
  try{
    // フィルタはクライアント側で（index不要＆コース共通を簡単にする）
    const qy = query(collection(db,'schedules'), where('version','==', version))
    const snap = await getDocs(qy)
    const rows = snap.docs.map(d=> ({ id:d.id, ...d.data() }))
    return rows.filter(r=> r.course===course || r.course==='共通')
  } catch(e){
    console.warn('getSchedules', e); return []
  }
}

export async function getSubmissions(version, course){
  if(!isConfigured){
    return MOCK.submissions.filter(r=> r.version===version && r.course===course)
  }
  try{
    const qy = query(collection(db,'submissions'), where('version','==', version), where('course','==', course))
    const snap = await getDocs(qy)
    return snap.docs.map(d=> ({ id:d.id, ...d.data() }))
  } catch(e){
    console.warn('getSubmissions', e); return []
  }
}

export async function getAllSchedulesRaw(){
  if(!isConfigured) return MOCK.schedules
  const snap = await getDocs(collection(db,'schedules')); return snap.docs.map(d=>({id:d.id,...d.data()}))
}
export async function getAllSubmissionsRaw(){
  if(!isConfigured) return MOCK.submissions
  const snap = await getDocs(collection(db,'submissions')); return snap.docs.map(d=>({id:d.id,...d.data()}))
}

export async function getSuggestions(){
  if(!isConfigured) return []
  try{
    const qy = query(collection(db,'suggestions'), orderBy('createdAt','desc'), limit(100))
    const snap = await getDocs(qy)
    return snap.docs.map(d=> ({ id:d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() || d.data().createdAt }))
  } catch(e){ console.warn(e); return [] }
}

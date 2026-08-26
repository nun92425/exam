#!/usr/bin/env node
// Firestore初期データ投入スクリプト
// 使い方:  .env に Firebase設定を入れて node scripts/seed.js

import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, collection, writeBatch, serverTimestamp } from 'firebase/firestore'
import dotenv from 'dotenv'
import fs from 'fs'

if (fs.existsSync('.env')) dotenv.config()
else if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local' })

const cfg = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
}
if (!cfg.apiKey) {
  console.error('❌ .env が未設定です。 .env.example をコピーして設定してください')
  process.exit(1)
}
const app = initializeApp(cfg)
const db = getFirestore(app)

const COLORS = {
  '論理国語': '#ef4444', '古典国語': '#dc2626',
  '数学①': '#0ea5e9', '数学②': '#0284c7',
  '英C': '#10b981', '論表': '#f97316',
  '化学': '#14b8a6', '公共': '#64748b',
  '情報': '#6366f1', '保健': '#ec4899',
  '地理': '#8b5cf6', '歴史': '#f59e0b',
  '物理': '#06b6d4', '生物': '#84cc16',
}

async function main(){
  console.log('🚀 Seeding Firestore...', cfg.projectId)

  // config
  await setDoc(doc(db,'config','main'), {
    version: '2学期 中間テスト',
    versionLabel: '2026年度 2学期',
    updatedAt: serverTimestamp()
  })
  console.log('✓ config/main')

  // versions
  for(const v of ['2学期 中間テスト','2学期 期末テスト','3学期 学年末テスト']){
    await setDoc(doc(db,'versions', v), { name:v, createdAt: serverTimestamp() })
    console.log('✓ versions/'+v)
  }

  // schedules
  const schedules = [
    { version:'2学期 中間テスト', course:'共通', subject:'論理国語', date:'9/10(水)', period:'1限', scope:'教科書 p.10〜48\nワーク p.2〜20', notes:'漢字小テストあり' },
    { version:'2学期 中間テスト', course:'共通', subject:'数学①', date:'9/10(水)', period:'2限', scope:'教科書 p.88〜120\nプリントNo.1〜10', notes:'' },
    { version:'2学期 中間テスト', course:'共通', subject:'英C', date:'9/11(木)', period:'1限', scope:'教科書 Lesson3〜4\n単語帳 p.30〜60', notes:'リスニングあり' },
    { version:'2学期 中間テスト', course:'共通', subject:'論表', date:'9/11(木)', period:'2限', scope:'教科書 p.20〜45', notes:'' },
    { version:'2学期 中間テスト', course:'共通', subject:'化学', date:'9/11(木)', period:'3限', scope:'教科書 p.60〜92\nセミナー p.40〜55', notes:'計算問題多め' },
    { version:'2学期 中間テスト', course:'共通', subject:'公共', date:'9/11(木)', period:'4限', scope:'教科書 p.30〜58', notes:'' },
    { version:'2学期 中間テスト', course:'K/文系', subject:'歴史', date:'9/12(金)', period:'2限', scope:'教科書 p.102〜150', notes:'記述あり' },
    { version:'2学期 中間テスト', course:'K/理系（物理）', subject:'物理', date:'9/12(金)', period:'2限', scope:'教科書 p.40〜88\nリードα p.20〜45', notes:'' },
    { version:'2学期 中間テスト', course:'K/理系（生物）', subject:'生物', date:'9/12(金)', period:'2限', scope:'教科書 p.20〜60', notes:'' },
    { version:'2学期 中間テスト', course:'K/理系（物理）', subject:'地理', date:'9/12(金)', period:'4限', scope:'資料集 p.10〜35', notes:'地図あり' },
    { version:'2学期 中間テスト', course:'K/理系（生物）', subject:'地理', date:'9/12(金)', period:'4限', scope:'資料集 p.10〜35', notes:'地図あり' },
    { version:'2学期 中間テスト', course:'SS/理系（物理）', subject:'物理', date:'9/12(金)', period:'2限', scope:'教科書 p.40〜88\nリードα p.20〜45', notes:'応用問題あり' },
    { version:'2学期 中間テスト', course:'SS/理系（物理）', subject:'地理', date:'9/12(金)', period:'4限', scope:'資料集 p.10〜35', notes:'地図あり' },
    // 期末サンプル
    { version:'2学期 期末テスト', course:'共通', subject:'情報', date:'11/20(木)', period:'2限', scope:'教科書 p.1〜50\n実技あり', notes:'PC持参' },
    { version:'2学期 期末テスト', course:'共通', subject:'保健', date:'11/20(木)', period:'3限', scope:'プリント全範囲', notes:'' },
  ]
  let batch = writeBatch(db); let cnt=0
  for(const r of schedules){
    const ref = doc(collection(db,'schedules'))
    batch.set(ref, { ...r, color: COLORS[r.subject]||'#0ea5e9', updatedAt: serverTimestamp() })
    cnt++
    if(cnt%400===0){ await batch.commit(); batch=writeBatch(db) }
  }
  await batch.commit()
  console.log(`✓ schedules ${schedules.length}件`)

  // submissions
  const submissions = [
    { version:'2学期 中間テスト', course:'K/文系', subject:'論理国語', notes:'漢字ワーク p.2〜20 提出\n授業ノート提出' },
    { version:'2学期 中間テスト', course:'K/文系', subject:'数学①', notes:'教科書 章末問題 提出' },
    { version:'2学期 中間テスト', course:'K/文系', subject:'英C', notes:'ワーク Lesson3〜4 提出' },
    { version:'2学期 中間テスト', course:'K/文系', subject:'歴史', notes:'ワーク p.10〜30 提出' },
    { version:'2学期 中間テスト', course:'K/理系（物理）', subject:'物理', notes:'リードα p.20〜45 提出' },
    { version:'2学期 中間テスト', course:'K/理系（物理）', subject:'地理', notes:'ワーク p.5〜18 提出' },
    { version:'2学期 中間テスト', course:'SS/理系（物理）', subject:'物理', notes:'リードα p.20〜45 提出\nレポート提出' },
  ]
  batch = writeBatch(db); cnt=0
  for(const r of submissions){
    const ref = doc(collection(db,'submissions'))
    batch.set(ref, { ...r, color: COLORS[r.subject]||'#0ea5e9', updatedAt: serverTimestamp() })
    cnt++
  }
  await batch.commit()
  console.log(`✓ submissions ${submissions.length}件`)

  console.log('✅ Seed完了！ Firebaseコンソールで確認してください')
  console.log('   次: 初回ログイン後、Firestore > users > {uid} の isAdmin を true にしてください')
}
main().catch(e=>{ console.error(e); process.exit(1) })

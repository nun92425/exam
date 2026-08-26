import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

// Free Tier: set via `firebase functions:secrets:set GEMINI_API_KEY`
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')

// Simple in-memory rate limiting (per instance, resets on cold start)
// For 30 users, 60 QPM is enough, but we add a per-user 5/min check via Firestore in future
const rateMap = new Map() // uid -> {count, resetTime}

function checkRate(uid){
  const now = Date.now()
  const rec = rateMap.get(uid) || { count: 0, reset: now + 60000 }
  if(now > rec.reset){
    rec.count = 0
    rec.reset = now + 60000
  }
  rec.count++
  rateMap.set(uid, rec)
  if(rec.count > 8) throw new HttpsError('resource-exhausted', '混雑中です。1分後に再試行してください。')
}

export const coachChat = onCall({ region: 'asia-northeast1', secrets: [GEMINI_API_KEY], enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid || 'anonymous'
  checkRate(uid)

  const { message, context, history = [] } = request.data || {}
  if(!message || typeof message !== 'string' || message.trim().length < 2){
    throw new HttpsError('invalid-argument', 'メッセージを入力してください')
  }
  if(message.length > 2000) throw new HttpsError('invalid-argument', 'メッセージが長すぎます')

  // Never send personal info: filter context
  const safeContext = {
    course: context?.course || null,
    version: context?.version || null,
    subjects: context?.subjects || [],
    scheduleCount: context?.schedule?.length || 0,
    submissionsProgress: context?.submissionsProgress || null,
    timerWeekMin: context?.timerWeekMin || 0,
    streak: context?.streak || 0,
    // do NOT include email, displayName, UID, memos
  }

  const apiKey = GEMINI_API_KEY.value()
  if(!apiKey){
    // Fallback when key not set (demo)
    return {
      reply: `（デモ）Gemini APIキーが未設定のため、ローカルで回答します。\n\n質問: ${message}\n\nヒント: 範囲を日割りし、1日3科目まで、試験前日は復習日にしてください。詳細は「学習計画」ボタンで生成できます。`,
      demo: true
    }
  }

  // Build prompt
  const system = `あなたは高校の学習コーチ。丁寧な日本語で、答えを直接書かずヒントと次の1手を3段階で導く。個人情報は受け取っていない。余白20%と復習日を必ず入れ、1日3科目・90分上限を守る。タイマーは参考程度。ユーザーの「1日1時間しかできない」等の要望を最優先。`
  const contextText = `【学習状況】コース:${safeContext.course||'未選択'} バージョン:${safeContext.version||'-'} 科目:${(safeContext.subjects||[]).join(',')} 範囲件数:${safeContext.scheduleCount} 提出物:${safeContext.submissionsProgress? `${safeContext.submissionsProgress.done}/${safeContext.submissionsProgress.total}`:'-'} 直近7日学習:${safeContext.timerWeekMin}分 連続:${safeContext.streak}日`

  const contents = [
    { role: 'user', parts: [{ text: system + '\n' + contextText }] },
    ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] }
  ]

  try{
    // Free Tier now uses gemini-3.6-flash / gemma; try primary then fallback
    const tryModels = ['gemini-3.6-flash', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it']
    let resp, data
    let lastErr = null
    for(const model of tryModels){
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800 } })
      })
      data = await resp.json()
      if(resp.ok) break
      lastErr = data
      // if not quota/billing, try next model
      if(resp.status !== 404) break
    }
    if(!resp.ok){
      const msg = (data || lastErr)?.error?.message || `Geminiエラー: ${resp.status}`
      if(resp.status === 429) throw new HttpsError('resource-exhausted', '混雑中です。30秒後に再試行してください。')
      throw new HttpsError('internal', msg)
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'すみません、うまく回答できませんでした。もう一度お試しください。'
    return { reply }
  } catch(e){
    if(e instanceof HttpsError) throw e
    console.error('coachChat error', e)
    throw new HttpsError('internal', 'AIの呼び出しに失敗しました。しばらくしてから再試行してください。')
  }
})

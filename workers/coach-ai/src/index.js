import { SYSTEM_PROMPT } from '../../../src/coachPrompt.js'

// Cloudflare Workers AI を使う、任意のクラウドAIプロキシ。
// - APIキーはWorker側に隠す（ブラウザには出さない）
// - 入力は必要最小限の学習状況だけに絞る
// - 1人あたり・全体の1日回数を制限し、超えたら簡易コーチへフォールバックさせる

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8'
const MAX_MESSAGE_CHARS = 1000
const MAX_HISTORY = 4
const MAX_HISTORY_CHARS = 600
const MAX_OUTPUT_TOKENS = 300
const DEFAULT_PER_USER_LIMIT = 20
const DEFAULT_GLOBAL_LIMIT = 400

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Coach-Client',
  'Access-Control-Max-Age': '86400',
}

// KVを未設定でも動かせるように、isolate内の簡易カウンタも持つ。
// 本番で日付をまたいで正確に制限したい場合は COACH_KV を設定する。
const memoryUsage = {
  date: '',
  total: 0,
  users: new Map(),
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (request.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, model: env.AI_MODEL || DEFAULT_MODEL })
      }
      return json({ error: 'not_found', message: 'Not found' }, 404)
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed', message: 'POSTのみ対応しています' }, 405)
    }
    if (url.pathname !== '/' && url.pathname !== '/coach') {
      return json({ error: 'not_found', message: 'Not found' }, 404)
    }

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > 32_000) {
      return json({ error: 'too_large', message: 'リクエストが大きすぎます' }, 413)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid_json', message: 'JSONを読み取れませんでした' }, 400)
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > MAX_MESSAGE_CHARS) {
      return json({ error: 'invalid_message', message: `メッセージは1〜${MAX_MESSAGE_CHARS}文字にしてください` }, 400)
    }

    if (!env.AI) {
      return json({ error: 'ai_binding_missing', message: 'Workers AI のバインディングがありません' }, 500)
    }

    const clientId = normalizeClientId(request.headers.get('X-Coach-Client'))
      || `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`
    const limit = await checkRateLimit(env, clientId)
    if (!limit.ok) {
      return json(
        { error: 'quota_exceeded', message: limit.message },
        429,
        { 'Retry-After': String(limit.retryAfter || 3600) },
      )
    }

    const contextText = formatContext(body?.context)
    const history = sanitizeHistory(body?.history)
    const model = env.AI_MODEL || DEFAULT_MODEL
    const messages = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n【学習状況】\n${contextText}` },
      ...history,
      { role: 'user', content: message },
    ]

    try {
      const result = await env.AI.run(model, {
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.6,
      })
      const reply = cleanReply(extractReply(result))
      if (!reply) throw new Error('empty reply')
      return json({ reply, source: 'cloudflare', model })
    } catch (e) {
      const detail = String(e?.message || e || '')
      if (/neuron|quota|free allocation|daily limit/i.test(detail)) {
        console.warn('coach-ai free allocation reached')
        return json(
          { error: 'quota_exceeded', message: '本日のクラウドAI無料枠に達しました。簡易コーチで回答します。' },
          429,
          { 'Retry-After': String(secondsUntilUtcMidnight()) },
        )
      }
      console.error('coach-ai inference failed', detail)
      return json(
        { error: 'ai_failed', message: 'AIの呼び出しに失敗しました。簡易コーチで回答します。' },
        502,
      )
    }
  },
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function normalizeClientId(value) {
  const id = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return ''
  // オブジェクトの特殊キーとして扱われるIDは拒否する
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return ''
  return id
}

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function secondsUntilUtcMidnight() {
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000))
}

async function checkRateLimit(env, clientId) {
  const date = new Date().toISOString().slice(0, 10)
  const perUserLimit = toPositiveInt(env.PER_USER_DAILY_LIMIT, DEFAULT_PER_USER_LIMIT)
  const globalLimit = toPositiveInt(env.DAILY_REQUEST_LIMIT, DEFAULT_GLOBAL_LIMIT)

  // KV未設定時のフォールバック。isolateが再起動するとリセットされる。
  if (!env.COACH_KV) {
    if (memoryUsage.date !== date) {
      memoryUsage.date = date
      memoryUsage.total = 0
      memoryUsage.users.clear()
    }
    const count = memoryUsage.users.get(clientId) || 0
    const denied = denialMessage(memoryUsage.total, count, globalLimit, perUserLimit)
    if (denied) return denied

    memoryUsage.total += 1
    memoryUsage.users.set(clientId, count + 1)
    return { ok: true }
  }

  const key = `coach:usage:${date}`
  let usage
  try {
    usage = await env.COACH_KV.get(key, { type: 'json' })
  } catch (e) {
    // KV障害でAI自体を止めない。Cloudflare側のNeuron上限は別途効く。
    console.warn('coach-ai kv read failed', e?.message || e)
    return { ok: true }
  }

  if (!usage || typeof usage !== 'object') usage = { total: 0, users: {} }
  if (!usage.users || typeof usage.users !== 'object') usage.users = {}

  const count = Number(usage.users[clientId]) || 0
  const denied = denialMessage(Number(usage.total) || 0, count, globalLimit, perUserLimit)
  if (denied) return denied

  usage.total = (Number(usage.total) || 0) + 1
  usage.users[clientId] = count + 1

  try {
    await env.COACH_KV.put(key, JSON.stringify(usage), { expirationTtl: 172800 })
  } catch (e) {
    console.warn('coach-ai kv write failed', e?.message || e)
  }
  return { ok: true }
}

function denialMessage(total, userCount, globalLimit, perUserLimit) {
  if (total >= globalLimit) {
    return {
      ok: false,
      message: '本日のクラウドAI全体の上限に達しました。簡易コーチで回答します。',
      retryAfter: secondsUntilUtcMidnight(),
    }
  }
  if (userCount >= perUserLimit) {
    return {
      ok: false,
      message: `クラウドAIは1日${perUserLimit}回までです。簡易コーチで回答します。`,
      retryAfter: secondsUntilUtcMidnight(),
    }
  }
  return null
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map(m => ({
      role: m.role,
      content: m.content.slice(0, MAX_HISTORY_CHARS),
    }))
}

function formatContext(context) {
  const c = context && typeof context === 'object' ? context : {}
  const subjects = Array.isArray(c.subjects)
    ? c.subjects.filter(s => typeof s === 'string').slice(0, 20).map(s => s.slice(0, 30))
    : []
  const schedule = Array.isArray(c.schedule)
    ? c.schedule.filter(r => r && typeof r.subject === 'string').slice(0, 20)
    : []

  const scheduleText = schedule.map((r) => {
    const subject = String(r.subject).slice(0, 30)
    const date = typeof r.date === 'string' ? ` ${r.date.slice(0, 20)}` : ''
    const period = typeof r.period === 'string' ? ` ${r.period.slice(0, 10)}` : ''
    return `${subject}${date}${period}`
  }).join(' / ')

  const progress = c.submissionsProgress && typeof c.submissionsProgress === 'object'
    ? c.submissionsProgress
    : null

  return [
    `コース: ${String(c.course || '未選択').slice(0, 40)}`,
    `テスト: ${String(c.version || '-').slice(0, 60)}`,
    subjects.length ? `科目: ${subjects.join('・')}` : '',
    scheduleText ? `範囲: ${scheduleText}` : '',
    progress ? `提出物: ${Number(progress.done) || 0}/${Number(progress.total) || 0}完了` : '',
    `学習時間: 今日 ${Number(c.timerTodayMin) || 0}分 / 直近7日 ${Number(c.timerWeekMin) || 0}分 / 連続 ${Number(c.streak) || 0}日`,
  ].filter(Boolean).join('\n')
}

function extractReply(result) {
  if (typeof result === 'string') return result
  if (result && typeof result.response === 'string') return result.response

  const choice = result?.choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  if (typeof choice?.text === 'string') return choice.text
  return ''
}

function cleanReply(text) {
  return String(text || '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim()
}

import { getFunctions, httpsCallable } from 'firebase/functions'
import { app, isConfigured } from './firebase.js'
import { toast, getProgressKey, parseScheduleDateForFuture } from './utils.js'
import {
  classifyCoachIntent,
  generateLocalReply,
  formatCoachContext,
  shouldUseOnDeviceAI,
} from './coachEngine.js'
import {
  getOnDeviceAIStatus,
  createOnDeviceSession,
  askOnDeviceAI,
  destroyOnDeviceSession,
} from './coachAI.js'

const AI_MODE = (import.meta.env.VITE_AI_MODE || 'local').trim().toLowerCase()
const CLOUD_AI_ENABLED = AI_MODE === 'cloud'
const CLOUDFLARE_AI_URL = (import.meta.env.VITE_CLOUDFLARE_AI_URL || '').replace(/\/+$/, '')
const CLOUDFLARE_AI_MODE = AI_MODE === 'cloudflare'
const CLOUDFLARE_AI_ENABLED = CLOUDFLARE_AI_MODE && !!CLOUDFLARE_AI_URL
const CLOUDFLARE_AI_ENDPOINT = CLOUDFLARE_AI_ENABLED
  ? (CLOUDFLARE_AI_URL.endsWith('/coach') ? CLOUDFLARE_AI_URL : `${CLOUDFLARE_AI_URL}/coach`)
  : ''
const ON_DEVICE_PREF_KEY = 'exam_coach_ondevice'
const HISTORY_KEY = 'exam_coach_history'
const CLIENT_ID_KEY = 'exam_coach_client_id'

let chatHistory = [] // { role, content, source? }
let busy = false
let memoryClientId = ''

if (CLOUDFLARE_AI_MODE && !CLOUDFLARE_AI_URL) {
  console.warn('[coach] VITE_CLOUDFLARE_AI_URL が未設定です。簡易コーチで動作します。')
}

const onDevice = {
  supported: false,
  status: 'unknown',
  session: null,
  contextKey: '',
  enabled: false,
  preparing: false,
  progress: 0,
}

function buildContext(state = {}) {
  const version = state.config?.version || ''
  const course = state.course || ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const schedule = (state.schedule || []).map((row) => {
    const d = parseScheduleDateForFuture(row.date)
    const daysUntil = d ? Math.round((d - today) / (1000 * 60 * 60 * 24)) : null
    return { ...row, daysUntil }
  })

  const submissions = (state.submissions || []).map((row, index) => ({
    ...row,
    done: localStorage.getItem(getProgressKey(version, course, row.subject, row.notes, index)) === 'true',
  }))

  const upcoming = schedule
    .filter(row => typeof row.daysUntil === 'number' && row.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)
  const first = upcoming[0]
  const nextTest = first
    ? {
        date: first.date,
        daysUntil: first.daysUntil,
        subjects: [...new Set(upcoming.filter(r => r.daysUntil === first.daysUntil).map(r => r.subject))],
      }
    : null

  const timer = getTimerSummary()
  const done = submissions.filter(s => s.done).length

  return {
    course,
    version,
    subjects: state.subjects || [],
    schedule,
    scheduleCount: schedule.length,
    submissions,
    submissionsProgress: { done, total: submissions.length },
    timerTodayMin: timer.todayMin,
    timerWeekMin: timer.weekMin,
    streak: timer.streak,
    nextTest,
  }
}

function getTimerSummary() {
  const now = new Date()
  let todayMin = 0
  let weekMin = 0

  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    let sec = 0
    for (let j = 0; j < localStorage.length; j++) {
      const key = localStorage.key(j)
      if (key && key.startsWith(`exam_timer_${iso}`)) {
        sec += parseInt(localStorage.getItem(key), 10) || 0
      }
    }
    const min = Math.round(sec / 60)
    weekMin += min
    if (i === 0) todayMin = min
  }

  let streak = 0
  for (let i = 0; i < 30; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    let has = false
    for (let j = 0; j < localStorage.length; j++) {
      const key = localStorage.key(j)
      if (key && key.startsWith(`exam_timer_${iso}`) && parseInt(localStorage.getItem(key), 10) > 0) {
        has = true
        break
      }
    }
    if (has) streak++
    else if (i > 0) break
  }

  return { todayMin, weekMin, streak }
}

function buildCloudContext(context) {
  // Functions側でも個人情報は落とすが、送る前に必要最小限にする
  return {
    course: context.course,
    version: context.version,
    subjects: context.subjects,
    schedule: (context.schedule || []).slice(0, 20).map(r => ({ subject: r.subject, date: r.date, period: r.period })),
    scheduleCount: context.scheduleCount,
    submissionsProgress: context.submissionsProgress,
    timerTodayMin: context.timerTodayMin,
    timerWeekMin: context.timerWeekMin,
    streak: context.streak,
  }
}

function randomClientId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {}
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function getClientId() {
  if (memoryClientId) return memoryClientId
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY)
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = randomClientId()
      localStorage.setItem(CLIENT_ID_KEY, id)
    }
    memoryClientId = id
    return id
  } catch {
    memoryClientId = randomClientId()
    return memoryClientId
  }
}

async function askCloudflareAI(text, context) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(CLOUDFLARE_AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Coach-Client': getClientId(),
      },
      body: JSON.stringify({
        message: text,
        context: buildCloudContext(context),
        history: chatHistory.slice(-7, -1),
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = new Error(data?.message || `クラウドAIエラー (${res.status})`)
      error.status = res.status
      error.code = data?.error
      throw error
    }
    if (!data?.reply || typeof data.reply !== 'string') throw new Error('空の回答')
    return data.reply
  } finally {
    clearTimeout(timer)
  }
}

function contextKey(context) {
  return [
    context.course,
    context.version,
    context.scheduleCount,
    context.submissionsProgress.done,
    context.submissionsProgress.total,
    context.nextTest?.date || '',
  ].join('|')
}

async function ensureOnDeviceSession(context, { force = false } = {}) {
  const key = contextKey(context)
  if (onDevice.session && onDevice.contextKey === key && !force) return onDevice.session

  if (onDevice.session) {
    destroyOnDeviceSession(onDevice.session)
    onDevice.session = null
    onDevice.contextKey = ''
  }

  onDevice.session = await createOnDeviceSession({
    contextText: formatCoachContext(context),
    onProgress: (progress) => {
      onDevice.progress = progress
      updateAIUI()
    },
  })
  onDevice.contextKey = key
  onDevice.progress = 0
  return onDevice.session
}

function disableOnDeviceAI({ silent = false } = {}) {
  destroyOnDeviceSession(onDevice.session)
  onDevice.session = null
  onDevice.contextKey = ''
  onDevice.enabled = false
  onDevice.progress = 0
  try { localStorage.setItem(ON_DEVICE_PREF_KEY, 'false') } catch {}
  updateAIUI()
  if (!silent) toast('端末AIをオフにしました（簡易コーチで動作します）')
}

async function enableOnDeviceAI() {
  if (onDevice.preparing) return
  if (busy) {
    toast('回答中です。少し待ってから切り替えてください')
    return
  }
  if (onDevice.enabled) {
    disableOnDeviceAI()
    return
  }
  if (!onDevice.supported) {
    toast('このブラウザは端末AIに対応していません')
    return
  }

  onDevice.preparing = true
  onDevice.progress = 0
  updateAIUI()

  try {
    const status = await getOnDeviceAIStatus()
    onDevice.status = status.status
    if (status.status === 'unavailable' || status.status === 'error') {
      toast('この端末では端末AIを利用できません。簡易コーチで続けます')
      return
    }

    const context = buildContext(window._coachStateRef?.() || {})
    await ensureOnDeviceSession(context, { force: true })
    onDevice.enabled = true
    try { localStorage.setItem(ON_DEVICE_PREF_KEY, 'true') } catch {}
    toast('端末AIを有効化しました（無料・端末内処理）')
  } catch (e) {
    console.warn('[coach] on-device init failed', e)
    onDevice.enabled = false
    onDevice.status = 'error'
    toast('端末AIを開始できませんでした。簡易コーチで続けます')
  } finally {
    onDevice.preparing = false
    updateAIUI()
  }
}

function updateAIUI() {
  const btn = document.getElementById('coachAiBtn')
  const note = document.getElementById('coachModeNote')
  if (btn) {
    const show = onDevice.enabled || (onDevice.supported && ['available', 'downloadable', 'downloading', 'error'].includes(onDevice.status))
    btn.disabled = onDevice.preparing
    btn.removeAttribute('title')
    if (onDevice.preparing) {
      const pct = Math.round((onDevice.progress || 0) * 100)
      btn.textContent = pct > 0 ? `端末AIを準備中… ${pct}%` : '端末AIを準備中…'
      btn.className = 'text-xs px-2.5 py-1 rounded-full font-bold border bg-zinc-100 dark:bg-white/10 border-zinc-200 dark:border-white/10 text-zinc-500 opacity-70 cursor-wait'
    } else if (onDevice.enabled) {
      btn.textContent = '端末AI ON'
      btn.className = 'text-xs px-2.5 py-1 rounded-full font-bold border bg-emerald-500/15 border-emerald-500/25 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/25 transition'
      btn.title = 'クリックで端末AIをオフ'
    } else if (onDevice.status === 'downloadable' || onDevice.status === 'downloading') {
      btn.textContent = '端末AIを有効化（初回DL）'
      btn.className = 'text-xs px-2.5 py-1 rounded-full font-bold border bg-cyan-500/15 border-cyan-500/25 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 transition'
      btn.title = '初回のみモデルをダウンロードします（無料）'
    } else if (onDevice.status === 'error') {
      btn.textContent = '端末AIを再試行'
      btn.className = 'text-xs px-2.5 py-1 rounded-full font-bold border bg-amber-500/15 border-amber-500/25 text-amber-700 dark:text-amber-200 hover:bg-amber-500/25 transition'
    } else {
      btn.textContent = '端末AIを使う（無料）'
      btn.className = 'text-xs px-2.5 py-1 rounded-full font-bold border bg-cyan-500/15 border-cyan-500/25 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25 transition'
      btn.title = 'Chrome内蔵AI（Gemini Nano）を端末内で使います'
    }
    // classNameの上書きでhiddenが消えないよう、最後に切り替える
    btn.classList.toggle('hidden', !show)
  }

  if (note) {
    if (onDevice.preparing) {
      const pct = Math.round((onDevice.progress || 0) * 100)
      note.textContent = pct > 0 ? `端末AIを準備中… ${pct}%（無料・端末内処理）` : '端末AIを準備中…（無料・端末内処理）'
    } else if (onDevice.enabled) {
      note.textContent = '端末AI（Gemini Nano）が有効。自由質問は端末内で処理されます。'
    } else if (CLOUDFLARE_AI_ENABLED) {
      note.textContent = 'クラウドAI（Cloudflare）モード。無料枠の範囲で動作します。'
    } else if (CLOUDFLARE_AI_MODE) {
      note.textContent = 'CloudflareのURLが未設定のため、簡易コーチで動作中。'
    } else if (CLOUD_AI_ENABLED && isConfigured) {
      note.textContent = 'クラウドAI（Gemini）モード。無料枠の範囲で動作します。'
    } else if (onDevice.status === 'available') {
      note.textContent = '端末AI（Gemini Nano）が使えます。無料・端末内処理。'
    } else if (onDevice.status === 'downloadable' || onDevice.status === 'downloading') {
      note.textContent = '端末AIは初回のみモデルDLが必要です（無料）。未使用時は簡易コーチで動作します。'
    } else if (onDevice.status === 'error') {
      note.textContent = '端末AIの準備に失敗しました。簡易コーチ（無料・端末内）で動作中。'
    } else {
      note.textContent = '簡易コーチ（無料・端末内）で動作中。入力は外部に送信されません。'
    }
  }
}

async function refreshOnDeviceStatus() {
  try {
    const status = await getOnDeviceAIStatus()
    onDevice.supported = status.supported
    onDevice.status = status.status
    if (status.status === 'available' && localStorage.getItem(ON_DEVICE_PREF_KEY) === 'true') {
      onDevice.enabled = true
    }
    updateAIUI()
  } catch (e) {
    onDevice.supported = false
    onDevice.status = 'error'
    updateAIUI()
  }
}

export function initCoach(stateRef) {
  const btn = document.getElementById('coachBtn')
  const modal = document.getElementById('coachModal')
  const closeBtn = document.getElementById('coachCloseBtn')
  const sendBtn = document.getElementById('coachSendBtn')
  const input = document.getElementById('coachInput')
  const container = document.getElementById('coachChatContainer')
  if (!btn || !modal) return

  window._coachStateRef = stateRef

  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        chatHistory = parsed.filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      }
    }
  } catch {}

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory.slice(-30)))
    } catch {}
  }

  function escapeHtml(s) {
    const d = document.createElement('div')
    d.textContent = s
    return d.innerHTML
  }

  function render() {
    if (!container) return
    container.innerHTML = ''
    if (chatHistory.length === 0) {
      container.innerHTML = '<div class="p-4 text-center text-sm text-zinc-500">学習の悩みを気軽にどうぞ。すべて無料で動きます。<br>例: 「今日の計画」「提出物を確認」「数学の勉強法」「やる気が出ない」</div>'
      return
    }
    for (const m of chatHistory) {
      const isUser = m.role === 'user'
      const sourceLabel = m.source === 'on-device' ? '端末AI'
        : m.source === 'cloudflare' ? 'クラウドAI（Cloudflare）'
        : m.source === 'cloud' ? 'クラウドAI（Gemini）'
        : m.source === 'local' ? '簡易コーチ'
        : ''
      const div = document.createElement('div')
      div.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`
      div.innerHTML = `<div class="max-w-[82%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${isUser ? 'bg-gradient-to-r from-cyan-500 to-violet-500 text-white' : 'bg-white dark:bg-white/[0.06] border border-zinc-200 dark:border-white/10 text-zinc-800 dark:text-zinc-200'}">${escapeHtml(m.content || '').replace(/\n/g, '<br>')}${!isUser && sourceLabel ? `<div class="mt-1 text-[10px] opacity-55">${sourceLabel}</div>` : ''}</div>`
      container.appendChild(div)
    }
    container.scrollTop = container.scrollHeight
  }

  btn.addEventListener('click', () => {
    modal.classList.remove('hidden')
    render()
    updateContextBadge(stateRef())
    updateAIUI()
    refreshOnDeviceStatus()
  })
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'))
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden')
  })

  document.getElementById('coachAiBtn')?.addEventListener('click', enableOnDeviceAI)
  document.getElementById('coachClearBtn')?.addEventListener('click', () => {
    clearCoachHistory()
    render()
    toast('履歴をクリアしました')
  })

  document.querySelectorAll('[data-coach-prompt]').forEach((el) => {
    el.addEventListener('click', () => send(el.dataset.coachPrompt))
  })

  async function send(presetText) {
    if (busy) return
    const text = (typeof presetText === 'string' ? presetText : input?.value || '').trim()
    if (!text) return
    if (text.length > 1000) {
      toast('メッセージが長すぎます')
      return
    }
    if (/(学籍|住所|電話|本名)/.test(text)) {
      toast('個人情報は入力しないでください')
      return
    }

    busy = true
    chatHistory.push({ role: 'user', content: text })
    if (input) input.value = ''
    render()
    saveHistory()
    if (sendBtn) {
      sendBtn.disabled = true
      sendBtn.textContent = '考え中...'
    }

    try {
      const state = stateRef()
      const context = buildContext(state)
      const intent = classifyCoachIntent(text)
      let reply = ''
      let source = 'local'

      if (onDevice.enabled && shouldUseOnDeviceAI(intent)) {
        try {
          await ensureOnDeviceSession(context)
          reply = await askOnDeviceAI(onDevice.session, text)
          source = 'on-device'
        } catch (e) {
          console.warn('[coach] on-device reply failed', e)
          const local = generateLocalReply(text, context)
          reply = local.text
          source = 'local'
          destroyOnDeviceSession(onDevice.session)
          onDevice.session = null
          onDevice.contextKey = ''
          onDevice.enabled = false
          onDevice.status = 'error'
          try { localStorage.setItem(ON_DEVICE_PREF_KEY, 'false') } catch {}
          updateAIUI()
          toast('端末AIが応答できなかったため、簡易コーチで回答しました')
        }
      } else if (CLOUDFLARE_AI_ENABLED && shouldUseOnDeviceAI(intent)) {
        try {
          reply = await askCloudflareAI(text, context)
          source = 'cloudflare'
        } catch (e) {
          console.warn('[coach] cloudflare reply failed', e)
          const local = generateLocalReply(text, context)
          reply = local.text
          source = 'local'
          if (e?.status === 429) {
            toast('本日のクラウドAI枠が上限に達したため、簡易コーチで回答しました')
          } else {
            toast('クラウドAIが使えないため、簡易コーチで回答しました')
          }
        }
      } else if (CLOUD_AI_ENABLED && isConfigured && shouldUseOnDeviceAI(intent)) {
        try {
          const functions = getFunctions(app, 'asia-northeast1')
          const fn = httpsCallable(functions, 'coachChat')
          const res = await fn({ message: text, context: buildCloudContext(context), history: chatHistory.slice(-7, -1) })
          reply = res.data?.reply || ''
          source = 'cloud'
        } catch (e) {
          console.warn('[coach] cloud reply failed', e)
          const local = generateLocalReply(text, context)
          reply = local.text
          source = 'local'
          toast('クラウドAIが使えないため、簡易コーチで回答しました')
        }
      } else {
        const local = generateLocalReply(text, context)
        reply = local.text
        source = local.source
      }

      if (!reply || !String(reply).trim()) {
        const local = generateLocalReply(text, context)
        reply = local.text
        source = local.source
      }

      chatHistory.push({ role: 'assistant', content: String(reply).trim(), source })
      render()
      saveHistory()
    } catch (e) {
      console.error('[coach] send failed', e)
      chatHistory.push({ role: 'assistant', content: '回答の生成に失敗しました。もう一度お試しください。', source: 'local' })
      render()
      saveHistory()
    } finally {
      busy = false
      if (sendBtn) {
        sendBtn.disabled = false
        sendBtn.textContent = '送信'
      }
    }
  }

  sendBtn?.addEventListener('click', () => send())
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })

  function updateContextBadge(state) {
    const badge = document.getElementById('coachContextBadge')
    if (!badge) return
    const ctx = buildContext(state)
    const pending = ctx.submissionsProgress.total - ctx.submissionsProgress.done
    badge.textContent = `${ctx.course || 'コース未選択'} / ${ctx.version || '-'} / 提出${ctx.submissionsProgress.done}/${ctx.submissionsProgress.total}${pending ? `（未完了${pending}）` : ''}`
  }

  // 外部（loadDataなど）から学習状況の表示を更新するためのフック
  window._coachUpdateContext = () => updateContextBadge(stateRef())

  render()
  updateContextBadge(stateRef())
  refreshOnDeviceStatus()
}

export function clearCoachHistory() {
  chatHistory = []
  try { localStorage.removeItem(HISTORY_KEY) } catch {}
}

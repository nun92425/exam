import { SYSTEM_PROMPT } from './coachPrompt.js'

// Chrome 148+ の Prompt API（Gemini Nano）を使うための薄いラッパー。
// 非対応ブラウザでは何もしない。呼び出し側は必ずローカルコーチへフォールバックする。

const AI_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
}

function getLanguageModelApi() {
  if (typeof globalThis.LanguageModel !== 'undefined') return globalThis.LanguageModel
  // 将来の別名やpolyfillに備えた逃げ道
  if (globalThis.ai?.languageModel) return globalThis.ai.languageModel
  return null
}

export function isOnDeviceAISupported() {
  return !!getLanguageModelApi()
}

export async function getOnDeviceAIStatus() {
  const api = getLanguageModelApi()
  if (!api) return { supported: false, status: 'unsupported' }

  try {
    const availability = await api.availability(AI_OPTIONS)
    return normalizeStatus(availability)
  } catch (e) {
    // オプション非対応の実装では、引数なしで再試行する
    try {
      const availability = await api.availability()
      return normalizeStatus(availability)
    } catch (e2) {
      return { supported: true, status: 'error', error: e2 }
    }
  }
}

function normalizeStatus(availability) {
  return {
    supported: true,
    status: availability,
    canUse: availability === 'available',
    needsDownload: availability === 'downloadable',
    downloading: availability === 'downloading',
  }
}

export async function createOnDeviceSession({ contextText = '', onProgress } = {}) {
  const api = getLanguageModelApi()
  if (!api) throw new Error('このブラウザは端末AIに対応していません')

  const initialPrompts = [{
    role: 'system',
    content: SYSTEM_PROMPT + (contextText ? `\n\n【学習状況】\n${contextText}` : ''),
  }]

  const options = {
    ...AI_OPTIONS,
    initialPrompts,
    monitor(m) {
      m.addEventListener('downloadprogress', (event) => {
        try {
          const loaded = Number(event?.loaded)
          if (Number.isFinite(loaded)) onProgress?.(Math.max(0, Math.min(1, loaded)))
        } catch {}
      })
    },
  }

  try {
    return await api.create(options)
  } catch (e) {
    // オプションを受け付けない実装だけ、最小構成で再試行する
    const optionError = e?.name === 'TypeError' || e?.name === 'NotSupportedError'
    if (!optionError) throw e
    return await api.create({ initialPrompts })
  }
}

export async function askOnDeviceAI(session, message, { timeoutMs = 30000 } = {}) {
  if (!session) throw new Error('端末AIのセッションがありません')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    try {
      return await session.prompt(message, { signal: controller.signal })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      // signalオプション非対応の実装だけ再試行する
      const optionError = e?.name === 'TypeError' || e?.name === 'NotSupportedError'
      if (!optionError) throw e
      return await session.prompt(message)
    }
  } finally {
    clearTimeout(timer)
  }
}

export function destroyOnDeviceSession(session) {
  try {
    session?.destroy?.()
  } catch {}
}

export function describeOnDeviceStatus(status) {
  switch (status) {
    case 'available': return '端末AIが利用できます'
    case 'downloadable': return '初回のみモデルのダウンロードが必要です'
    case 'downloading': return 'モデルをダウンロード中です'
    case 'unavailable': return 'この端末では端末AIを利用できません'
    case 'unsupported': return 'このブラウザは端末AI非対応です'
    default: return '端末AIの状態を確認できませんでした'
  }
}

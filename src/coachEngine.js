import { parseScheduleDateForFuture } from './utils.js'

// 完全無料で動くローカルコーチ。
// 範囲表・提出物・タイマー記録だけを使い、外部APIには一切送信しない。
// 返り値は { text, intent, source } で、呼び出し側がUIに表示する。

const DAY_MS = 24 * 60 * 60 * 1000

const SUBJECT_ALIASES = [
  { re: /数学|数I|数A|数II|数B|数Ⅲ|数3/i, subjects: ['数学①', '数学②'] },
  { re: /英語|英C|英文|リスニング|英単語/i, subjects: ['英C', '論表'] },
  { re: /国語|現代文|論理国語|古典|古文|漢文/i, subjects: ['論理国語', '古典国語'] },
  { re: /化学/i, subjects: ['化学'] },
  { re: /物理/i, subjects: ['物理'] },
  { re: /生物/i, subjects: ['生物'] },
  { re: /歴史|日本史|世界史/i, subjects: ['歴史'] },
  { re: /地理/i, subjects: ['地理'] },
  { re: /公共|公民|倫理|政治経済/i, subjects: ['公共'] },
  { re: /情報/i, subjects: ['情報'] },
  { re: /保健/i, subjects: ['保健'] },
]

const STUDY_TIPS = {
  '数学': '例題を1問、解説を閉じて再現。間違えた問題だけ翌日もう一度。公式は使う直前に確認すると定着します。',
  '英語': '単語は1日20個を朝・夕・寝る前の3回。長文は音読→設問→根拠の順で読むと、なんとなく読むより伸びます。',
  '国語': '漢字は書き取りより小テスト形式で。古文は助動詞・敬語を表にまとめ、省略された主語を補って読みます。',
  '理科': '用語→図→計算の順。化学は反応式を書いてから量関係、物理は図とv-tグラフをセットで確認。',
  '社会': '年表と因果（原因→出来事→結果）で覚える。一問一答は寝る前と翌朝の2回が効率的です。',
  'default': '25分集中＋5分休憩。教科書を読むより、何も見ずに思い出す「テスト形式」の方が記憶に残ります。',
}

const TOPIC_HINTS = [
  { re: /二次関数|放物線/, label: '二次関数', text: 'y=a(x-p)^2+q の形に直せるか確認。頂点・軸・定義域の端をチェックし、最大最小は「頂点が定義域に入るか」で場合分けします。' },
  { re: /確率|場合の数/, label: '確率', text: '数える前に「同様に確からしいか」を確認。直接数えにくいときは余事象を検討し、分母と分子を分けて書きます。' },
  { re: /微分|導関数/, label: '微分', text: '微分の意味（傾き）に戻る。f\'(x)=0 の点と増減表を書き、定義域の端も忘れずに確認します。' },
  { re: /積分/, label: '積分', text: '面積と原始関数の関係を確認。積分区間の上下を入れ替えたときの符号に注意します。' },
  { re: /化学反応式|反応式|mol|モル/, label: '化学反応式', text: '反応物と生成物を書き、原子の数を左右で合わせる。係数は最後に整え、molに直してから量関係を見ます。' },
  { re: /英文法|英語|長文|関係詞|時制/, label: '英語', text: '主語と動詞を先に探す。時制・態・関係詞・前置詞を順に確認。長文は設問の根拠を本文から1文だけ抜きます。' },
  { re: /古文|漢文|助動詞|敬語/, label: '古文・漢文', text: '敬語の向き（誰から誰へ）を確認し、省略された主語を補う。古文は助動詞、漢文は返り点と置き字をチェックします。' },
  { re: /歴史|日本史|世界史|年表/, label: '歴史', text: '年代だけでなく「原因→出来事→結果」の3つで覚える。人物と政策をセットにすると混ざりにくくなります。' },
  { re: /物理|力|運動|速度/, label: '物理', text: 'まず図を描く。力なら合力、運動ならv-tグラフの面積と傾きを確認します。' },
]

function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function daysUntil(dateStr, today = startOfDay()) {
  const d = parseScheduleDateForFuture(dateStr)
  if (!d) return null
  return Math.round((startOfDay(d) - today) / DAY_MS)
}

function dayLabel(days) {
  if (days === 0) return '今日'
  if (days === 1) return '明日'
  return `あと${days}日`
}

function formatToday() {
  return new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))]
}

function firstLine(s) {
  return String(s || '').split(/\n/).map(x => x.trim()).filter(Boolean)[0] || ''
}

function shorten(s, n = 28) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function parseScopePages(scope) {
  const text = String(scope || '')
  const patterns = [
    /p\.?\s*(\d+)\s*(?:[〜~\-ー–—]|から)\s*(\d+)/i,
    /(\d+)\s*ページ\s*(?:[〜~\-ー–—]|から)\s*(\d+)\s*ページ/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      return { start: a, end: b, total: b - a + 1 }
    }
  }
  return null
}

function availableSubjects(context = {}) {
  const fromState = Array.isArray(context.subjects) ? context.subjects : []
  const fromSchedule = (context.schedule || []).map(r => r.subject)
  return unique([...fromState, ...fromSchedule])
}

function upcomingRows(context = {}, today = startOfDay()) {
  const rows = (context.schedule || []).map((r, index) => {
    const days = typeof r.daysUntil === 'number' ? r.daysUntil : daysUntil(r.date, today)
    return { ...r, daysUntil: days, _index: index }
  }).filter(r => typeof r.daysUntil === 'number' && r.daysUntil >= 0)

  rows.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil
    return (parseInt(a.period, 10) || 99) - (parseInt(b.period, 10) || 99)
  })
  return rows
}

function nextTest(rows) {
  if (!rows.length) return null
  const first = rows[0]
  return {
    date: first.date,
    daysUntil: first.daysUntil,
    subjects: unique(rows.filter(r => r.daysUntil === first.daysUntil).map(r => r.subject)),
  }
}

export function findSubjectsInMessage(message, available = []) {
  const text = String(message || '')
  const pool = unique(available)
  const exact = pool.filter(s => text.includes(s))
  if (exact.length) return unique(exact)

  const found = []
  for (const alias of SUBJECT_ALIASES) {
    if (!alias.re.test(text)) continue
    for (const s of alias.subjects) {
      if (!pool.length || pool.includes(s)) found.push(s)
    }
  }
  return unique(found)
}

export function classifyCoachIntent(message) {
  const m = String(message || '').trim()
  if (!m) return 'fallback'

  if (/ありがとう|助かった|感謝|thanks/i.test(m)) return 'thanks'
  if (/提出|課題|ワーク|レポート|プリント|宿題/.test(m)) return 'submission'
  if (/進捗|どれくらい|どのくらい|残り|完了|終わった|チェック|学習時間|勉強時間|タイマー/.test(m)) return 'progress'
  if (/テスト.*(いつ|日程|範囲|何日|時間割|何曜日)|範囲表|日程|時間割|テスト範囲/.test(m)) return 'test_info'
  if (/やる気|疲れ|眠い|不安|緊張|焦|無理|つら|しんど|サボ/.test(m)) return 'motivation'
  if (/勉強法|覚え方|暗記|集中|復習|勉強.*(コツ|仕方)|どうやって(覚|勉強)/.test(m)) return 'study_method'
  if (/計画|予定|スケジュール|日割り|何を(すれば|やれば|する)|何から|優先|順番|間に合|終わらせ|(\d+)\s*(分|時間)/.test(m)) return 'plan'
  if (/分から|わから|解け|できない|教えて|ヒント|問題|二次関数|確率|微分|積分|化学反応式|英文法|古文|漢文|単語|計算/.test(m)) return 'subject_question'
  if (/^(こんにちは|こんばんは|おはよう|やあ|はじめまして|hi|hello)/i.test(m)) return 'greeting'
  return 'fallback'
}

export function shouldUseOnDeviceAI(intent) {
  return ['subject_question', 'study_method', 'motivation', 'fallback'].includes(intent)
}

export function getTimeBudget(message, fallback = 90) {
  const m = String(message || '')
  const hour = m.match(/(\d+(?:\.\d+)?)\s*時間/)
  const minute = m.match(/(\d+)\s*分/)
  let budget = fallback
  if (hour) budget = Math.round(parseFloat(hour[1]) * 60)
  else if (minute) budget = parseInt(minute[1], 10)
  if (!Number.isFinite(budget)) budget = fallback
  return Math.max(20, Math.min(180, budget))
}

function taskForRow(row, days) {
  if (days <= 0) return `${row.subject}: 公式・用語の最終確認（復習）`
  if (days === 1) return `${row.subject}: 間違い直し＋用語確認（前日は復習）`

  const pages = parseScopePages(row.scope)
  if (pages) {
    const perDay = Math.max(1, Math.ceil(pages.total / days))
    // 25分で現実的に進められる量を目安にする（全体の日割りは「学習計画」ボタン）
    const chunk = Math.min(perDay, 5)
    const start = pages.start
    const end = Math.min(pages.end, start + chunk - 1)
    return `${row.subject}: p.${start}〜${end}（${Math.max(1, end - start + 1)}ページ）を目安に`
  }

  const line = firstLine(row.scope) || firstLine(row.notes)
  return line ? `${row.subject}: ${shorten(line, 24)} を1つ` : `${row.subject}: 範囲を1見出し`
}

function planReply(message, context) {
  const rows = upcomingRows(context)
  if (!rows.length) {
    return '今後のテスト日程が範囲表に見つかりません。コースとテストのバージョンが合っているか確認してください。'
  }

  const budget = getTimeBudget(message)
  const sessions = Math.max(1, Math.min(3, Math.floor(budget / 30) || 1))
  const mentionedAll = findSubjectsInMessage(message, availableSubjects(context))
  const incomplete = new Set((context.submissions || []).filter(s => !s.done).map(s => s.subject))

  // 同じ教科は、いちばん近いテストだけを使う
  const bySubject = new Map()
  for (const r of rows) {
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, r)
  }
  const candidates = [...bySubject.values()]
  const mentioned = mentionedAll.filter(subject => candidates.some(c => c.subject === subject))
  candidates.sort((a, b) => {
    const aPriority = (mentioned.includes(a.subject) ? -100 : 0) + (incomplete.has(a.subject) ? -10 : 0)
    const bPriority = (mentioned.includes(b.subject) ? -100 : 0) + (incomplete.has(b.subject) ? -10 : 0)
    return (aPriority + a.daysUntil) - (bPriority + b.daysUntil)
  })

  const picked = candidates.slice(0, sessions)
  const lines = picked.map((r, i) => `${i + 1}. ${taskForRow(r, r.daysUntil)}（${r.date} / ${dayLabel(r.daysUntil)}）`)
  const totalMin = picked.length * 25 + Math.max(0, picked.length - 1) * 5
  const intro = mentioned.length
    ? `${mentioned.join('・')}を優先して、25分×${picked.length}セット（約${totalMin}分）がおすすめです。`
    : `今日（${formatToday()}）のおすすめは、25分×${picked.length}セット（約${totalMin}分）です。`
  const review = picked.some(r => r.daysUntil <= 1)
    ? '前日は新しい範囲を増やさず、間違い直しに充ててください。'
    : '終わったら5分休憩。90分を超えたら切り上げてOKです。'

  return `${intro}\n${lines.join('\n')}\n${review}\n「学習計画」ボタンでテスト前日までの日割りも自動作成できます。`
}

function submissionReply(context) {
  const subs = context.submissions || []
  if (!subs.length) return 'このコースの提出物データがありません。管理画面から登録すると、ここで確認できます。'

  const pending = subs.filter(s => !s.done)
  if (!pending.length) {
    return `提出物はすべて完了しています（${subs.length}/${subs.length}）。この調子で、テスト範囲の復習に時間を使ってください。`
  }

  const rows = upcomingRows(context)
  const lines = pending.slice(0, 5).map(s => {
    const test = rows.find(r => r.subject === s.subject)
    const when = test ? `${test.date} / ${dayLabel(test.daysUntil)}` : 'テスト日程は未設定'
    return `・${s.subject}: ${shorten(firstLine(s.notes) || '提出物', 30)}（${when}）`
  })
  const more = pending.length > 5 ? `\nほか${pending.length - 5}件あります。` : ''
  return `未完了の提出物は${pending.length}件です。\n${lines.join('\n')}${more}\n今日は1件だけ、25分で終わるものから始めましょう。終わったら提出物のチェックを入れてください。`
}

function progressReply(context) {
  const subs = context.submissions || []
  const done = subs.filter(s => s.done).length
  const pending = subs.filter(s => !s.done).map(s => s.subject)
  const pct = subs.length ? Math.round((done / subs.length) * 100) : 0
  const today = context.timerTodayMin || 0
  const week = context.timerWeekMin || 0
  const streak = context.streak || 0

  const parts = []
  if (subs.length) {
    parts.push(`提出物は ${done}/${subs.length} 完了（${pct}%）${pending.length ? `。未完了は ${pending.slice(0, 4).join('・')} です` : '。全部終わっています'}。`)
  } else {
    parts.push('提出物データはまだありません。')
  }

  if (today || week || streak) {
    parts.push(`今日の学習は${today}分、直近7日は${week}分、連続${streak}日です。`)
  } else {
    parts.push('タイマーの記録はまだありません。まず25分だけ測ってみましょう。')
  }

  const next = nextTest(upcomingRows(context))
  if (next) {
    parts.push(`次のテストは ${next.date} の ${next.subjects.slice(0, 2).join('・')}（${dayLabel(next.daysUntil)}）。1日25分×2を目安に、範囲を1周する計画を立てられます。`)
  }

  return parts.join('\n')
}

function testInfoReply(context) {
  const rows = upcomingRows(context)
  if (!rows.length) return '今後のテスト日程が範囲表に見つかりません。コースとテストのバージョンを確認してください。'

  const byDate = new Map()
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date).push(r)
  }
  const dates = [...byDate.entries()].slice(0, 2)
  const first = dates[0]
  const firstDays = first[1][0].daysUntil

  let text = `次のテストは ${first[0]}（${dayLabel(firstDays)}）。\n`
  text += first[1].slice(0, 4).map(r => {
    const period = r.period ? `${r.period} ` : ''
    const scope = shorten(firstLine(r.scope), 34)
    return `・${r.subject} ${period}${scope ? `: ${scope}` : ''}`
  }).join('\n')
  if (dates[1]) {
    const second = dates[1]
    text += `\n次は ${second[0]}（${dayLabel(second[1][0].daysUntil)}）: ${unique(second[1].map(r => r.subject)).slice(0, 4).join('・')}`
  }
  text += '\n前日は新しい範囲を増やさず、間違い直しと用語確認に充てるのがコツです。'
  return text
}

function studyMethodReply(message, context) {
  const subjects = findSubjectsInMessage(message, availableSubjects(context))
  const subject = subjects[0] || ''
  const key = /数学/.test(subject) ? '数学'
    : /英/.test(subject) ? '英語'
    : /国語/.test(subject) ? '国語'
    : /化学|物理|生物/.test(subject) ? '理科'
    : /歴史|地理|公共/.test(subject) ? '社会'
    : 'default'
  const tip = STUDY_TIPS[key]
  const lead = subject ? `${subject}ですね。` : '勉強法ですね。'
  return `${lead}\n${tip}\n今日は25分だけ、タイマーで測ってやってみましょう。`
}

function motivationReply(context) {
  const next = nextTest(upcomingRows(context))
  const streak = context.streak || 0
  const lines = ['やる気は「始めてから」出ることが多いです。今日は「1問だけ」「5分だけ」にハードルを下げましょう。']
  if (streak > 0) lines.push(`連続${streak}日できています。今日も5分でつなげましょう。`)
  if (next) lines.push(`次のテストは ${next.date}（${dayLabel(next.daysUntil)}）。焦らず、今日の1問だけ。`)
  lines.push('タイマーを25分にして、終わったら5分休憩。始めたら「始めた」と送ってください。')
  return lines.join('\n')
}

function subjectQuestionReply(message, context) {
  const subjects = findSubjectsInMessage(message, availableSubjects(context))
  const subject = subjects[0] || ''
  const topic = TOPIC_HINTS.find(t => t.re.test(message))
  const lead = subject ? `${subject}ですね。` : ''
  if (topic) {
    return `${lead}答えは書かず、ヒントを3段階で。\n${topic.label}のポイントは「${topic.text}」\n1. 分かっていること・求めることを書き出す\n2. 上のポイントから、使えそうな公式・定義を1つ選ぶ\n3. 似た例題の最初の1手だけ真似する\n問題文を1行で要約して送ってもらえれば、ヒントを絞ります。`
  }
  return `${lead}答えは書かず、ヒントを3段階で出します。\n1. 分かっていること・求めることを書き出す\n2. 使えそうな公式・定義を1つ確認する\n3. 似た例題の最初の1手だけ真似する\nまずは問題文を1行で要約して送ってください。「どこで止まったか」も添えると、ヒントを絞れます。`
}

function greetingReply(context) {
  const rows = upcomingRows(context)
  const next = nextTest(rows)
  const pending = (context.submissions || []).filter(s => !s.done)
  const lines = ['こんにちは！学習コーチです。']
  if (next) {
    lines.push(`次のテストは ${next.date} の ${next.subjects.slice(0, 2).join('・')}（${dayLabel(next.daysUntil)}）。`)
  } else {
    lines.push('範囲表がまだ読み込まれていないようです。コースを選ぶと、テスト日程に合わせて提案できます。')
  }
  if (pending.length) lines.push(`未完了の提出物が${pending.length}件あります。`)
  lines.push('「今日の計画」「提出物を確認」「数学の勉強法」など、短く話しかけてください。')
  return lines.join('\n')
}

function fallbackReply() {
  return 'うまく意図を読めませんでした。次のように話しかけてください。\n・「今日の計画」…日割りを提案\n・「提出物を確認」…未完了を一覧\n・「数学の勉強法」…教科別のコツ\n・「やる気が出ない」…5分だけ始める作戦\n端末AIが使えるブラウザなら「端末AIを使う」から自由な質問もできます。'
}

export function generateLocalReply(message, context = {}) {
  const intent = classifyCoachIntent(message)
  let text
  switch (intent) {
    case 'thanks':
      text = 'どういたしまして。今日も25分だけ、一緒に進めましょう。'
      break
    case 'submission':
      text = submissionReply(context)
      break
    case 'progress':
      text = progressReply(context)
      break
    case 'test_info':
      text = testInfoReply(context)
      break
    case 'motivation':
      text = motivationReply(context)
      break
    case 'study_method':
      text = studyMethodReply(message, context)
      break
    case 'plan':
      text = planReply(message, context)
      break
    case 'subject_question':
      text = subjectQuestionReply(message, context)
      break
    case 'greeting':
      text = greetingReply(context)
      break
    default:
      text = fallbackReply()
  }
  return { text, intent, source: 'local' }
}

// 端末AIに渡す、個人情報を含まない学習状況の要約
export function formatCoachContext(context = {}) {
  const rows = upcomingRows(context)
  const next = nextTest(rows)
  const lines = []
  lines.push(`コース: ${context.course || '未選択'} / テスト: ${context.version || '-'}`)
  if (next) lines.push(`次のテスト: ${next.date} ${next.subjects.join('・')}（あと${next.daysUntil}日）`)
  if (rows.length) {
    const schedule = rows.slice(0, 8).map(r => `${r.subject} ${r.date}${r.period ? ` ${r.period}` : ''}`)
    lines.push(`範囲: ${schedule.join(' / ')}`)
  }
  const subs = context.submissions || []
  const done = subs.filter(s => s.done).length
  const pending = subs.filter(s => !s.done).map(s => s.subject)
  lines.push(`提出物: ${done}/${subs.length}完了${pending.length ? `（未完了: ${pending.slice(0, 5).join('・')}）` : ''}`)
  lines.push(`今日の学習: ${context.timerTodayMin || 0}分 / 直近7日: ${context.timerWeekMin || 0}分 / 連続${context.streak || 0}日`)
  return lines.join('\n')
}

// コース定義（旧GAS版と互換）
export const COURSES = [
  { id: 'K/文系', label: 'K / 文系', desc: '基本教科 + 歴史', icon: '📜' },
  { id: 'K/理系（物理）', label: 'K / 理系 物理', desc: '基本教科 + 地理 + 物理', icon: '⚛️' },
  { id: 'K/理系（生物）', label: 'K / 理系 生物', desc: '基本教科 + 地理 + 生物', icon: '🧬' },
  { id: 'SS/理系（物理）', label: 'SS / 理系 物理', desc: '基本教科 + 地理 + 物理', icon: '🚀' },
  { id: 'SS/理系（生物）', label: 'SS / 理系 生物', desc: '基本教科 + 地理 + 生物', icon: '🌿' },
]

export const BASIC_SUBJECTS = {
  mid: ['論理国語','古典国語','数学①','数学②','英C','論表','化学','公共'],
  final: ['論理国語','古典国語','数学①','数学②','英C','論表','化学','公共','情報','保健'],
}

export const SUBJECT_COLORS = {
  '論理国語': '#ef4444', '古典国語': '#dc2626',
  '数学①': '#0ea5e9', '数学②': '#0284c7',
  '英C': '#10b981', '論表': '#f97316',
  '化学': '#14b8a6', '公共': '#64748b',
  '情報': '#6366f1', '保健': '#ec4899',
  '地理': '#8b5cf6', '歴史': '#f59e0b',
  '物理': '#06b6d4', '生物': '#84cc16',
}

export function getSubjects(course, version) {
  const isFinal = version && version.includes('期末')
  const basic = isFinal ? BASIC_SUBJECTS.final : BASIC_SUBJECTS.mid
  let elective = []
  if (course === 'K/文系') elective = ['歴史']
  else if (course === 'K/理系（物理）' || course === 'SS/理系（物理）') elective = ['地理','物理']
  else if (course === 'K/理系（生物）' || course === 'SS/理系（生物）') elective = ['地理','生物']
  return [...basic, ...elective]
}

export const STORAGE_KEYS = {
  course: 'exam_course_selected',
  darkMode: 'exam_dark_mode',
  progressPrefix: 'exam_sub_progress',
  timerPrefix: 'exam_timer_',
}

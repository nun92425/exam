import { COURSES, BASIC_SUBJECTS } from './constants.js'

// コースの並びは constants.js の COURSES を正とする。
export const ALL_COURSES = COURSES.map(c => c.id)

export const COURSE_GROUPS = {
  all: [...ALL_COURSES],
  k: ALL_COURSES.filter(c => c.startsWith('K/')),
  ss: ALL_COURSES.filter(c => c.startsWith('SS/')),
  science: ALL_COURSES.filter(c => c.includes('理系')),
  physics: ALL_COURSES.filter(c => c.includes('（物理）')),
  biology: ALL_COURSES.filter(c => c.includes('（生物）')),
  humanities: ['K/文系'],
}

export const GROUP_LABELS = {
  all: '全5コース',
  k: 'K（3コース）',
  ss: 'SS（2コース）',
  science: '理系4コース',
  physics: '物理2コース',
  biology: '生物2コース',
  humanities: 'K文系',
  custom: '個別',
}

// 教科ごとの初期共有先。数学は K / SS の2行に分けるため別扱い。
export const SUBJECT_GROUP = {
  '論理国語': 'all',
  '古典国語': 'all',
  '英C': 'all',
  '論表': 'all',
  '化学': 'all',
  '公共': 'all',
  '情報': 'all',
  '保健': 'all',
  '地理': 'science',
  '物理': 'physics',
  '生物': 'biology',
  '歴史': 'humanities',
}

export const MATH_SUBJECTS = ['数学①', '数学②']

export function isFinalVersion(version) {
  return /期末|学年末/.test(String(version || ''))
}

export function courseLabel(id) {
  return COURSES.find(c => c.id === id)?.label || id
}

export function normalizeCourses(row = {}) {
  const valid = new Set(ALL_COURSES)
  if (Array.isArray(row.courses)) {
    const list = [...new Set(row.courses.filter(c => valid.has(c)))]
    if (list.length) return list
  }
  // 旧形式（course: '共通' / 'K/文系' など）との互換
  if (row.course === '共通') return [...ALL_COURSES]
  if (valid.has(row.course)) return [row.course]
  return []
}

export function normalizeScheduleRow(row = {}) {
  return { ...row, courses: normalizeCourses(row) }
}

export function rowAppliesTo(row, course) {
  const courses = Array.isArray(row.courses) ? row.courses : normalizeCourses(row)
  return courses.includes(course)
}

export function overlaps(a = [], b = []) {
  return a.some(c => b.includes(c))
}

export function groupKeyForCourses(courses = []) {
  for (const [key, list] of Object.entries(COURSE_GROUPS)) {
    if (list.length === courses.length && list.every(c => courses.includes(c))) return key
  }
  return 'custom'
}

export function groupLabelForCourses(courses = []) {
  if (!courses.length) return '共有先を選択'
  const key = groupKeyForCourses(courses)
  if (key === 'custom') return `個別（${courses.length}コース）`
  return GROUP_LABELS[key] || `${courses.length}コース`
}

export function defaultCoursesForSubject(subject) {
  if (MATH_SUBJECTS.includes(subject)) return [...COURSE_GROUPS.k]
  const group = SUBJECT_GROUP[subject] || 'all'
  return [...COURSE_GROUPS[group]]
}

export function templateRowsForVersion(version) {
  const basic = isFinalVersion(version) ? BASIC_SUBJECTS.final : BASIC_SUBJECTS.mid
  const subjects = [...new Set([...basic, '地理', '物理', '生物', '歴史'])]
  const rows = []
  for (const subject of subjects) {
    if (MATH_SUBJECTS.includes(subject)) {
      rows.push({ subject, courses: [...COURSE_GROUPS.k], group: 'k' })
      rows.push({ subject, courses: [...COURSE_GROUPS.ss], group: 'ss' })
      continue
    }
    const group = SUBJECT_GROUP[subject] || 'all'
    rows.push({ subject, courses: [...COURSE_GROUPS[group]], group })
  }
  return rows
}

export function subjectsForVersion(version) {
  return [...new Set(templateRowsForVersion(version).map(r => r.subject))]
}

export function validateRows(rows = []) {
  const errors = []
  for (const row of rows) {
    const subject = String(row.subject || '').trim()
    if (!subject) errors.push('教科名が空の行があります')
    if (!Array.isArray(row.courses) || row.courses.length === 0) {
      errors.push(`「${subject || '無題'}」の共有先が選ばれていません`)
    }
  }

  const bySubject = new Map()
  for (const row of rows) {
    const subject = String(row.subject || '').trim()
    if (!subject) continue
    const list = bySubject.get(subject) || []
    if (list.some(other => overlaps(other.courses, row.courses))) {
      errors.push(`「${subject}」の共有先が重複しています。例外の範囲を確認してください。`)
    }
    list.push(row)
    bySubject.set(subject, list)
  }
  return [...new Set(errors)]
}

export function sortRowsForEditor(rows = [], version) {
  const order = subjectsForVersion(version)
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.subject)
    const bi = order.indexOf(b.subject)
    if (ai !== bi) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    return b.courses.length - a.courses.length
  })
}

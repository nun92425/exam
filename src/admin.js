import './style.css'
import { $, show, hide, toast, escHtml, escAttr } from './utils.js'
import { initAuth, bindAuthModals, getIsAdmin, getCurrentUser, authReady } from './auth.js'
import { isConfigured, db } from './firebase.js'
import { initTheme } from './theme.js'
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit,
  serverTimestamp, writeBatch, updateDoc
} from 'firebase/firestore'
import { COURSES, SUBJECT_COLORS } from './constants.js'
import {
  ALL_COURSES, COURSE_GROUPS, GROUP_LABELS,
  defaultCoursesForSubject, templateRowsForVersion, subjectsForVersion,
  validateRows, sortRowsForEditor, groupLabelForCourses, overlaps, courseLabel,
} from './scheduleModel.js'
import { getSchedulesForVersion, getSubmissionsForVersion } from './firestore.js'

let keySeq = 0
const nextKey = () => `k${Date.now()}_${++keySeq}`

let state = {
  config: null,
  versions: [],
  suggestions: [],
  filter: 'all',
  editVersion: '',
  scheduleData: [],
  subVersion: '',
  subData: [],
  shareTarget: null,
  shareCourses: [],
  exceptionTarget: null,
  exceptionCourses: [],
  previewCourse: '',
}

// ---------- Helpers ----------
function rowList(kind) {
  return kind === 'schedule' ? state.scheduleData : state.subData
}
function findRow(kind, key) {
  return rowList(kind).find(r => r._key === key)
}
function renderEditor(kind) {
  if (kind === 'schedule') renderScheduleEditor()
  else renderSubEditor()
}
function sameSet(a = [], b = []) {
  return a.length === b.length && a.every(x => b.includes(x))
}
function hasMergeTarget(kind, row) {
  return rowList(kind).some(r =>
    !r._deleted &&
    r._key !== row._key &&
    String(r.subject || '').trim() === String(row.subject || '').trim() &&
    !overlaps(r.courses, row.courses)
  )
}
function updateSubjectOptions() {
  const subjects = [...new Set([
    ...subjectsForVersion(state.editVersion || state.subVersion),
    ...state.scheduleData.map(r => r.subject),
    ...state.subData.map(r => r.subject),
  ].filter(Boolean))]
  const dl = $('#subjectOptions')
  if (dl) dl.innerHTML = subjects.map(s => `<option value="${escAttr(s)}"></option>`).join('')
}

// ---------- Config / Versions ----------
async function loadConfig() {
  if (!isConfigured) {
    state.config = { version: '2学期 中間テスト', versionLabel: '2026年度 2学期' }
    state.versions = ['2学期 中間テスト', '2学期 期末テスト', '3学期 学年末テスト']
    if (!state.editVersion) state.editVersion = state.config.version
    if (!state.subVersion) state.subVersion = state.config.version
    renderVersionUI()
    await loadScheduleForEdit()
    await loadSubForEdit()
    return
  }
  try {
    const snap = await getDoc(doc(db, 'config', 'main'))
    if (snap.exists()) state.config = snap.data()
    else state.config = { version: '2学期 中間テスト', versionLabel: '2026年度 2学期', updatedAt: serverTimestamp() }
    const vSnap = await getDocs(collection(db, 'versions'))
    state.versions = vSnap.docs.map(d => d.id)
    if (state.versions.length === 0) state.versions = [state.config.version]
    if (!state.editVersion) state.editVersion = state.config.version
    if (!state.subVersion) state.subVersion = state.config.version
    renderVersionUI()
    await loadScheduleForEdit()
    await loadSubForEdit()
  } catch (e) {
    console.warn(e); toast('設定の読み込みに失敗')
  }
}

function renderVersionUI() {
  const current = state.config?.version || ''
  const cur = $('#currentVersion')
  if (cur) cur.textContent = current || '--'

  const all = [...new Set([...state.versions, current].filter(Boolean))]
  const selects = [
    { el: $('#versionSelect'), value: current },
    { el: $('#editVersionSelect'), value: state.editVersion || current },
    { el: $('#subVersionSelect'), value: state.subVersion || current },
  ]
  for (const { el, value } of selects) {
    if (!el) continue
    const keep = value || el.value
    el.innerHTML = '<option value="">バージョンを選択</option>' + all.map(v =>
      `<option value="${escAttr(v)}">${escHtml(v)}</option>`
    ).join('')
    if (keep && all.includes(keep)) el.value = keep
    else if (current) el.value = current
  }

  const pv = $('#schedulePreviewCourse')
  if (pv) {
    const keep = state.previewCourse || pv.value
    pv.innerHTML = '<option value="">表示プレビュー</option>' + COURSES.map(c =>
      `<option value="${escAttr(c.id)}">${escHtml(c.label)}</option>`
    ).join('')
    if (keep && ALL_COURSES.includes(keep)) pv.value = keep
  }
}

async function updateVersion() {
  const nv = $('#versionSelect').value
  if (!nv) { toast('バージョンを選択してください'); return }
  if (!isConfigured) {
    state.config.version = nv
    renderVersionUI()
    toast(`「${nv}」を反映しました（デモ）`)
    return
  }
  try {
    const rows = await getSchedulesForVersion(nv)
    if (!rows.length && !confirm('このバージョンには範囲表がありません。生徒側に反映しますか？')) return
    await setDoc(doc(db, 'config', 'main'), {
      version: nv,
      versionLabel: state.config.versionLabel || '',
      updatedAt: serverTimestamp(),
    }, { merge: true })
    await setDoc(doc(db, 'versions', nv), { name: nv, createdAt: serverTimestamp() }, { merge: true })
    state.config.version = nv
    renderVersionUI()
    toast(`「${nv}」を反映しました`)
  } catch (e) { toast('更新に失敗: ' + (e.message || e)) }
}

async function addVersion() {
  const name = prompt('新しいバージョン名を入力（例: 2学期 期末テスト）:')
  if (!name || !name.trim()) return
  const v = name.trim()
  if (state.versions.includes(v)) { toast('同じ名前のバージョンがあります'); return }

  if (!isConfigured) {
    state.versions.push(v)
    state.editVersion = v
    state.subVersion = v
    state.scheduleData = []
    state.subData = []
    renderVersionUI()
    generateScheduleTemplate()
    renderSubEditor()
    toast(`「${v}」を作成しました。教科の雛形を追加しました（デモ）`)
    return
  }

  try {
    await setDoc(doc(db, 'versions', v), { name: v, createdAt: serverTimestamp() })
    state.versions.push(v)
    state.editVersion = v
    state.subVersion = v
    renderVersionUI()
    $('#editVersionSelect').value = v
    $('#subVersionSelect').value = v
    await loadScheduleForEdit()
    generateScheduleTemplate()
    await loadSubForEdit()
    toast(`「${v}」を作成しました。雛形を確認して保存してください`)
  } catch (e) { toast('作成に失敗: ' + (e.message || e)) }
}

// ---------- Schedule editor ----------
async function loadScheduleForEdit() {
  const version = $('#editVersionSelect')?.value || state.editVersion
  if (!version) {
    state.editVersion = ''
    state.scheduleData = []
    renderScheduleEditor()
    return
  }
  state.editVersion = version
  const rows = await getSchedulesForVersion(version)
  state.scheduleData = rows.map(r => ({ ...r, _key: r.id || nextKey() }))
  updateSubjectOptions()
  renderScheduleEditor()
  renderSchedulePreview()
}

function renderScheduleEditor() {
  const el = $('#scheduleEditor')
  if (!el) return
  if (!state.editVersion) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-zinc-500">バージョンを選択してください</div>'
    return
  }
  const rows = sortRowsForEditor(state.scheduleData.filter(r => !r._deleted), state.editVersion)
  if (!rows.length) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-zinc-500">行がありません。「教科の雛形を追加」か「行を追加」から始めてください</div>'
    return
  }

  const body = rows.map(row => {
    const shareLabel = groupLabelForCourses(row.courses)
    const merge = hasMergeTarget('schedule', row)
    return `<tr data-key="${escAttr(row._key)}" class="border-b border-white/5 align-top">
      <td class="p-1 min-w-[130px]"><input list="subjectOptions" data-field="subject" value="${escAttr(row.subject || '')}" placeholder="教科名" class="input !py-1.5 !text-xs"></td>
      <td class="p-1 min-w-[130px]">
        <button type="button" data-share="${escAttr(row._key)}" class="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold border ${row.courses.length ? 'bg-cyan-500/15 border-cyan-500/25 text-cyan-200 hover:bg-cyan-500/25' : 'bg-amber-500/15 border-amber-500/25 text-amber-200'}">${escHtml(shareLabel)}</button>
        <div class="text-[10px] text-zinc-500 mt-1 leading-tight">${row.courses.length ? escHtml(row.courses.map(courseLabel).join('・')) : 'クリックして選択'}</div>
      </td>
      <td class="p-1 min-w-[105px]"><input data-field="date" value="${escAttr(row.date || '')}" placeholder="11/20(木)" class="input !py-1.5 !text-xs"></td>
      <td class="p-1 min-w-[70px]"><input data-field="period" value="${escAttr(row.period || '')}" placeholder="1限" class="input !py-1.5 !text-xs"></td>
      <td class="p-1 min-w-[220px]"><textarea data-field="scope" rows="2" class="input !py-1.5 !text-xs min-h-[44px]">${escHtml(row.scope || '')}</textarea></td>
      <td class="p-1 min-w-[150px]"><textarea data-field="notes" rows="2" class="input !py-1.5 !text-xs min-h-[44px]">${escHtml(row.notes || '')}</textarea></td>
      <td class="p-1 whitespace-nowrap">
        ${row.courses.length > 1 ? `<button type="button" data-exception="${escAttr(row._key)}" class="px-2 py-1 rounded-lg text-[11px] font-bold bg-white/10 border border-white/10 hover:bg-white/15">例外</button>` : ''}
        ${merge ? `<button type="button" data-merge="${escAttr(row._key)}" class="px-2 py-1 rounded-lg text-[11px] font-bold bg-white/10 border border-white/10 hover:bg-white/15">共有に戻す</button>` : ''}
        <button type="button" data-delete="${escAttr(row._key)}" class="btn-danger !px-2 !py-1 !text-[11px]">削除</button>
      </td>
    </tr>`
  }).join('')

  el.innerHTML = `<table class="w-full text-sm min-w-[1000px]">
    <thead><tr class="text-[11px] tracking-widest font-bold text-zinc-400 border-b border-white/10">
      <th class="text-left px-2 py-2">教科</th>
      <th class="text-left px-2 py-2">共有先</th>
      <th class="text-left px-2 py-2">日程</th>
      <th class="text-left px-2 py-2">時限</th>
      <th class="text-left px-2 py-2">範囲</th>
      <th class="text-left px-2 py-2">備考</th>
      <th class="text-left px-2 py-2">操作</th>
    </tr></thead><tbody>${body}</tbody></table>`

  bindRowInputs(el, 'schedule')
  el.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => openShareModal('schedule', b.dataset.share)))
  el.querySelectorAll('[data-exception]').forEach(b => b.addEventListener('click', () => openExceptionModal('schedule', b.dataset.exception)))
  el.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', () => mergeRow('schedule', b.dataset.merge)))
  el.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteRow('schedule', b.dataset.delete)))
}

function bindRowInputs(container, kind) {
  container.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.closest('[data-key]')?.dataset.key
      const row = findRow(kind, key)
      if (!row) return
      row[inp.dataset.field] = inp.value
      if (inp.dataset.field === 'subject' && !row.id && !row._coursesTouched) {
        const def = defaultCoursesForSubject(inp.value.trim())
        if (def.length) {
          row.courses = def
          const btn = inp.closest('tr')?.querySelector('[data-share]')
          if (btn) btn.textContent = groupLabelForCourses(row.courses)
        }
      }
      // 日程・時限は同じ教科ならコース共通。例外行にも同じ値を反映する。
      if (inp.dataset.field === 'date' || inp.dataset.field === 'period') {
        const subject = String(row.subject || '').trim()
        if (subject) {
          for (const other of rowList(kind)) {
            if (other === row || other._deleted) continue
            if (String(other.subject || '').trim() !== subject) continue
            other[inp.dataset.field] = inp.value
            for (const tr of container.querySelectorAll('tr[data-key]')) {
              if (tr.dataset.key !== other._key) continue
              const otherInput = tr.querySelector(`[data-field="${inp.dataset.field}"]`)
              if (otherInput && otherInput !== inp) otherInput.value = inp.value
            }
          }
        }
      }
      if (kind === 'schedule' && state.previewCourse) renderSchedulePreview()
    })
  })
}

function addScheduleRow() {
  if (!state.editVersion) { toast('バージョンを選択してください'); return }
  state.scheduleData.push({
    _key: nextKey(),
    version: state.editVersion,
    subject: '', date: '', period: '', scope: '', notes: '',
    courses: [...ALL_COURSES],
    color: '#0ea5e9',
  })
  renderScheduleEditor()
}

function generateScheduleTemplate() {
  if (!state.editVersion) { toast('バージョンを選択してください'); return }
  const template = templateRowsForVersion(state.editVersion)
  let added = 0
  for (const t of template) {
    const exists = state.scheduleData.some(r =>
      !r._deleted &&
      String(r.subject || '').trim() === t.subject &&
      overlaps(r.courses, t.courses)
    )
    if (exists) continue
    state.scheduleData.push({
      _key: nextKey(),
      version: state.editVersion,
      subject: t.subject,
      date: '', period: '', scope: '', notes: '',
      courses: [...t.courses],
      color: SUBJECT_COLORS[t.subject] || '#0ea5e9',
    })
    added++
  }
  renderScheduleEditor()
  toast(added ? `教科の雛形を${added}行追加しました。内容を入れて保存してください` : '追加する教科はありません')
}

function renderSchedulePreview() {
  const box = $('#schedulePreview')
  if (!box) return
  const course = state.previewCourse
  if (!course) { hide(box); return }
  const rows = sortRowsForEditor(
    state.scheduleData.filter(r => !r._deleted && r.courses.includes(course)),
    state.editVersion
  )
  show(box)
  if (!rows.length) {
    box.innerHTML = `<div class="p-4 text-center text-sm text-zinc-500">${escHtml(courseLabel(course))}に表示される教科はありません</div>`
    return
  }
  box.innerHTML = `<div class="flex items-center justify-between mb-2">
      <div class="font-bold text-sm">${escHtml(courseLabel(course))} の表示プレビュー</div>
      <div class="text-xs text-zinc-500">${rows.length}件</div>
    </div>
    <div class="overflow-x-auto rounded-xl border border-white/5">
      <table class="w-full text-xs">
        <thead><tr class="text-[10px] tracking-widest font-bold text-zinc-400 border-b border-white/10">
          <th class="text-left px-2 py-1.5">教科</th><th class="text-left px-2 py-1.5">日程</th><th class="text-left px-2 py-1.5">時限</th><th class="text-left px-2 py-1.5">範囲</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr class="border-b border-white/5">
          <td class="px-2 py-1.5 font-bold">${escHtml(r.subject || '')}</td>
          <td class="px-2 py-1.5">${escHtml(r.date || '未設定')}</td>
          <td class="px-2 py-1.5">${escHtml(r.period || '')}</td>
          <td class="px-2 py-1.5 text-zinc-400">${escHtml((r.scope || '').split('\n')[0] || '')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`
}

// ---------- Submissions editor ----------
async function loadSubForEdit() {
  const version = $('#subVersionSelect')?.value || state.subVersion
  if (!version) {
    state.subVersion = ''
    state.subData = []
    renderSubEditor()
    return
  }
  state.subVersion = version
  const rows = await getSubmissionsForVersion(version)
  state.subData = rows.map(r => ({ ...r, _key: r.id || nextKey() }))
  updateSubjectOptions()
  renderSubEditor()
}

function renderSubEditor() {
  const el = $('#submissionEditor')
  if (!el) return
  if (!state.subVersion) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-zinc-500">バージョンを選択してください</div>'
    return
  }
  const rows = sortRowsForEditor(state.subData.filter(r => !r._deleted), state.subVersion)
  if (!rows.length) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-zinc-500">行がありません。「行を追加」から始めてください</div>'
    return
  }
  const body = rows.map(row => {
    const merge = hasMergeTarget('submission', row)
    return `<tr data-key="${escAttr(row._key)}" class="border-b border-white/5 align-top">
      <td class="p-1 min-w-[130px]"><input list="subjectOptions" data-field="subject" value="${escAttr(row.subject || '')}" placeholder="教科名" class="input !py-1.5 !text-xs"></td>
      <td class="p-1 min-w-[130px]">
        <button type="button" data-share="${escAttr(row._key)}" class="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold border ${row.courses.length ? 'bg-violet-500/15 border-violet-500/25 text-violet-200 hover:bg-violet-500/25' : 'bg-amber-500/15 border-amber-500/25 text-amber-200'}">${escHtml(groupLabelForCourses(row.courses))}</button>
        <div class="text-[10px] text-zinc-500 mt-1 leading-tight">${row.courses.length ? escHtml(row.courses.map(courseLabel).join('・')) : 'クリックして選択'}</div>
      </td>
      <td class="p-1 min-w-[320px]"><textarea data-field="notes" rows="2" class="input !py-1.5 !text-xs min-h-[44px]">${escHtml(row.notes || '')}</textarea></td>
      <td class="p-1 whitespace-nowrap">
        ${row.courses.length > 1 ? `<button type="button" data-exception="${escAttr(row._key)}" class="px-2 py-1 rounded-lg text-[11px] font-bold bg-white/10 border border-white/10 hover:bg-white/15">例外</button>` : ''}
        ${merge ? `<button type="button" data-merge="${escAttr(row._key)}" class="px-2 py-1 rounded-lg text-[11px] font-bold bg-white/10 border border-white/10 hover:bg-white/15">共有に戻す</button>` : ''}
        <button type="button" data-delete="${escAttr(row._key)}" class="btn-danger !px-2 !py-1 !text-[11px]">削除</button>
      </td>
    </tr>`
  }).join('')

  el.innerHTML = `<table class="w-full text-sm min-w-[760px]">
    <thead><tr class="text-[11px] tracking-widest font-bold text-zinc-400 border-b border-white/10">
      <th class="text-left px-2 py-2">教科</th>
      <th class="text-left px-2 py-2">共有先</th>
      <th class="text-left px-2 py-2">提出物詳細</th>
      <th class="text-left px-2 py-2">操作</th>
    </tr></thead><tbody>${body}</tbody></table>`

  bindRowInputs(el, 'submission')
  el.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => openShareModal('submission', b.dataset.share)))
  el.querySelectorAll('[data-exception]').forEach(b => b.addEventListener('click', () => openExceptionModal('submission', b.dataset.exception)))
  el.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', () => mergeRow('submission', b.dataset.merge)))
  el.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteRow('submission', b.dataset.delete)))
}

function addSubRow() {
  if (!state.subVersion) { toast('バージョンを選択してください'); return }
  state.subData.push({
    _key: nextKey(),
    version: state.subVersion,
    subject: '', notes: '',
    courses: [...ALL_COURSES],
    color: '#0ea5e9',
  })
  renderSubEditor()
}

// ---------- Share / exception / merge / delete ----------
function openShareModal(kind, key) {
  const row = findRow(kind, key)
  if (!row) return
  state.shareTarget = { kind, key }
  state.shareCourses = [...(row.courses || [])]
  renderShareModal()
  show($('#shareModal'))
}

function renderShareModal() {
  if (!state.shareTarget) return
  const row = findRow(state.shareTarget.kind, state.shareTarget.key)
  const subject = row?.subject || '教科未入力'
  $('#shareModalSubject').textContent = subject
  $('#shareModalHint').textContent = '選んだコースに同じ内容が表示されます。コースごとに変えたい場合は「例外」を使ってください。'

  const presets = Object.entries(COURSE_GROUPS)
  $('#sharePresetList').innerHTML = presets.map(([key, list]) =>
    `<button type="button" data-group="${key}" class="px-3 py-1.5 rounded-full text-xs font-bold border ${sameSet(state.shareCourses, list) ? 'bg-white text-zinc-900 border-white' : 'bg-white/10 border-white/10 text-zinc-300 hover:bg-white/15'}">${GROUP_LABELS[key]}</button>`
  ).join('')
  $('#sharePresetList').querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', () => {
    state.shareCourses = [...COURSE_GROUPS[b.dataset.group]]
    renderShareModal()
  }))

  $('#shareCourseList').innerHTML = ALL_COURSES.map(c => {
    const checked = state.shareCourses.includes(c)
    return `<label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
      <input type="checkbox" data-course="${escAttr(c)}" ${checked ? 'checked' : ''} class="w-4 h-4 accent-cyan-500">
      <span class="text-sm">${escHtml(courseLabel(c))}</span>
      <span class="text-[10px] text-zinc-500 ml-auto">${escHtml(c)}</span>
    </label>`
  }).join('')
  $('#shareCourseList').querySelectorAll('[data-course]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) {
      if (!state.shareCourses.includes(cb.dataset.course)) state.shareCourses.push(cb.dataset.course)
    } else {
      state.shareCourses = state.shareCourses.filter(c => c !== cb.dataset.course)
    }
    $('#sharePresetList').querySelectorAll('[data-group]').forEach(b => {
      const on = sameSet(state.shareCourses, COURSE_GROUPS[b.dataset.group])
      b.className = `px-3 py-1.5 rounded-full text-xs font-bold border ${on ? 'bg-white text-zinc-900 border-white' : 'bg-white/10 border-white/10 text-zinc-300 hover:bg-white/15'}`
    })
  }))
}

function applyShare() {
  if (!state.shareTarget) return
  if (!state.shareCourses.length) { toast('共有先を1つ以上選んでください'); return }
  const row = findRow(state.shareTarget.kind, state.shareTarget.key)
  if (!row) return
  row.courses = [...new Set(state.shareCourses)]
  row._coursesTouched = true
  const kind = state.shareTarget.kind
  hide($('#shareModal'))
  state.shareTarget = null
  renderEditor(kind)
  toast('共有先を変更しました。保存を押してください')
}

function openExceptionModal(kind, key) {
  const row = findRow(kind, key)
  if (!row || row.courses.length < 2) { toast('共有先が1コースだけの行は例外にできません'); return }
  state.exceptionTarget = { kind, key }
  state.exceptionCourses = []
  renderExceptionModal()
  show($('#exceptionModal'))
}

function renderExceptionModal() {
  const target = state.exceptionTarget
  if (!target) return
  const row = findRow(target.kind, target.key)
  if (!row) return
  $('#exceptionHint').textContent = `「${row.subject || '教科未入力'}」のうち、別データにするコースを選んでください。選んだコースだけ新しい行になります。`
  $('#exceptionCourseList').innerHTML = row.courses.map(c =>
    `<label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
      <input type="checkbox" data-exception-course="${escAttr(c)}" class="w-4 h-4 accent-amber-500">
      <span class="text-sm">${escHtml(courseLabel(c))}</span>
      <span class="text-[10px] text-zinc-500 ml-auto">${escHtml(c)}</span>
    </label>`
  ).join('')
  $('#exceptionCourseList').querySelectorAll('[data-exception-course]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) {
      if (!state.exceptionCourses.includes(cb.dataset.exceptionCourse)) state.exceptionCourses.push(cb.dataset.exceptionCourse)
    } else {
      state.exceptionCourses = state.exceptionCourses.filter(c => c !== cb.dataset.exceptionCourse)
    }
  }))
}

function applyException() {
  const target = state.exceptionTarget
  if (!target) return
  const row = findRow(target.kind, target.key)
  if (!row) return
  const selected = [...state.exceptionCourses]
  if (!selected.length) { toast('例外にするコースを選んでください'); return }
  if (selected.length >= row.courses.length) { toast('一部のコースだけ選んでください'); return }

  const copy = {
    ...row,
    _key: nextKey(),
    id: undefined,
    courses: [...selected],
  }
  row.courses = row.courses.filter(c => !selected.includes(c))
  rowList(target.kind).push(copy)
  hide($('#exceptionModal'))
  state.exceptionTarget = null
  state.exceptionCourses = []
  renderEditor(target.kind)
  toast('例外を作成しました。内容を編集して保存してください')
}

function mergeRow(kind, key) {
  const rows = rowList(kind).filter(r => !r._deleted)
  const row = rows.find(r => r._key === key)
  if (!row) return
  const siblings = rows.filter(r =>
    r._key !== key &&
    String(r.subject || '').trim() === String(row.subject || '').trim() &&
    !overlaps(r.courses, row.courses)
  )
  if (!siblings.length) { toast('戻す先の共通行がありません'); return }
  siblings.sort((a, b) => b.courses.length - a.courses.length)
  const parent = siblings[0]
  if (!confirm(`「${row.subject || '無題'}」を「${groupLabelForCourses(parent.courses)}」に戻します。\nこの行の内容は破棄され、戻す先の内容が使われます。よろしいですか？`)) return
  parent.courses = [...new Set([...parent.courses, ...row.courses])]
  if (row.id) row._deleted = true
  else rowList(kind).splice(rowList(kind).indexOf(row), 1)
  renderEditor(kind)
  toast('共通行に戻しました。保存を押してください')
}

function deleteRow(kind, key) {
  const row = findRow(kind, key)
  if (!row) return
  if (!confirm(`「${row.subject || '無題'}」を${groupLabelForCourses(row.courses)}から削除しますか？`)) return
  if (row.id) row._deleted = true
  else rowList(kind).splice(rowList(kind).indexOf(row), 1)
  renderEditor(kind)
}

// ---------- Save ----------
async function saveSchedule() {
  if (!state.editVersion) { toast('バージョンを選択してください'); return }
  const rows = state.scheduleData.filter(r => !r._deleted)
  const errors = validateRows(rows)
  if (errors.length) { toast(errors[0]); return }

  if (!isConfigured) {
    state.scheduleData = rows
    toast(`保存しました（デモ: ${rows.length}件）`)
    renderScheduleEditor()
    return
  }

  try {
    const batch = writeBatch(db)
    for (const r of state.scheduleData) {
      if (r._deleted) {
        if (r.id) batch.delete(doc(db, 'schedules', r.id))
        continue
      }
      const data = {
        version: state.editVersion,
        subject: String(r.subject || '').trim(),
        date: r.date || '',
        period: r.period || '',
        scope: r.scope || '',
        notes: r.notes || '',
        color: SUBJECT_COLORS[String(r.subject || '').trim()] || r.color || '#0ea5e9',
        courses: [...new Set(r.courses)],
        updatedAt: serverTimestamp(),
      }
      if (r.id) batch.set(doc(db, 'schedules', r.id), data)
      else batch.set(doc(collection(db, 'schedules')), data)
    }
    await batch.commit()
    toast(`保存しました（${rows.length}件）`)
    await loadScheduleForEdit()
  } catch (e) { toast('保存に失敗: ' + (e.message || e)) }
}

async function saveSubs() {
  if (!state.subVersion) { toast('バージョンを選択してください'); return }
  const rows = state.subData.filter(r => !r._deleted)
  const errors = validateRows(rows)
  if (errors.length) { toast(errors[0]); return }

  if (!isConfigured) {
    state.subData = rows
    toast(`保存しました（デモ: ${rows.length}件）`)
    renderSubEditor()
    return
  }

  try {
    const batch = writeBatch(db)
    for (const r of state.subData) {
      if (r._deleted) {
        if (r.id) batch.delete(doc(db, 'submissions', r.id))
        continue
      }
      const data = {
        version: state.subVersion,
        subject: String(r.subject || '').trim(),
        notes: r.notes || '',
        color: SUBJECT_COLORS[String(r.subject || '').trim()] || r.color || '#0ea5e9',
        courses: [...new Set(r.courses)],
        updatedAt: serverTimestamp(),
      }
      if (r.id) batch.set(doc(db, 'submissions', r.id), data)
      else batch.set(doc(collection(db, 'submissions')), data)
    }
    await batch.commit()
    toast(`保存しました（${rows.length}件）`)
    await loadSubForEdit()
  } catch (e) { toast('保存に失敗: ' + (e.message || e)) }
}

// ---------- Suggestions ----------
async function loadSuggestions() {
  const list = $('#suggestionList'), loading = $('#sugLoading')
  show(loading); list.innerHTML = ''
  if (!isConfigured) {
    hide(loading)
    list.innerHTML = '<div class="text-center text-sm text-zinc-500 py-6">デモモード: Firestore未接続のため表示できません</div>'
    return
  }
  try {
    const qy = query(collection(db, 'suggestions'), orderBy('createdAt', 'desc'), limit(100))
    const snap = await getDocs(qy)
    state.suggestions = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toLocaleString('ja-JP') || '',
    }))
    renderSuggestions()
  } catch (e) {
    list.innerHTML = '<div class="text-center text-sm text-zinc-500">読み込みに失敗しました</div>'
  } finally { hide(loading) }
}

function renderSuggestions() {
  const list = $('#suggestionList'); list.innerHTML = ''
  const filtered = state.filter === 'all' ? state.suggestions : state.suggestions.filter(s => s.type === state.filter)
  if (filtered.length === 0) {
    list.innerHTML = '<div class="text-center py-8 text-zinc-500"><div class="text-2xl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 inline"><path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8"/><rect x="3" y="8" width="18" height="10" rx="2"/></svg></div><p class="text-sm mt-2">提案はありません</p></div>'
    return
  }
  const pending = filtered.filter(s => s.status === '承認待ち'), done = filtered.filter(s => s.status !== '承認待ち')
  const mk = (arr, title) => {
    if (arr.length === 0) return
    const sec = document.createElement('div')
    sec.innerHTML = `<div class="text-xs font-bold tracking-wide text-zinc-400 mt-2 mb-2">${title} (${arr.length})</div>`
    arr.forEach(s => sec.appendChild(createSuggestionEl(s)))
    list.appendChild(sec)
  }
  mk(pending, '承認待ち'); mk(done, '処理済み')
}

function createSuggestionEl(s) {
  const div = document.createElement('div')
  div.className = 'p-4 rounded-2xl glass-subtle'
  const statusClass = s.status === '承認待ち' ? 'bg-amber-500/15 border-amber-500/20 text-amber-200' : s.status === '承認済み' ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-200' : 'bg-red-500/15 border-red-500/20 text-red-200'
  const isScope = s.type === 'test_scope' || !s.type
  div.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-sm">${escHtml(s.subject)}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border ${isScope ? 'bg-cyan-500/15 border-cyan-500/20 text-cyan-200' : 'bg-violet-500/15 border-violet-500/20 text-violet-200'}">${isScope ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 inline"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z"/></svg> 範囲' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 inline"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> 提出物'}</span>
        <span class="text-xs text-zinc-400">${escHtml(s.course || '')}</span>
      </div>
      <span class="text-[11px] font-bold px-2 py-1 rounded-full border ${statusClass}">${escHtml(s.status || '承認待ち')}</span>
    </div>
    <div class="text-xs text-zinc-300 mt-2 space-y-0.5 leading-relaxed">
      <div><span class="text-zinc-500">バージョン:</span> ${escHtml(s.version || '')}</div>
      ${isScope ? `<div><span class="text-zinc-500">日程:</span> ${escHtml(s.date || '未設定')} ${s.period ? escHtml('/ ' + s.period) : ''}</div><div><span class="text-zinc-500">範囲:</span> ${escHtml(s.scope || '未設定')}</div>` : ''}
      <div><span class="text-zinc-500">${isScope ? '備考' : '提出物詳細'}:</span> ${escHtml(s.notes || '未設定')}</div>
      <div class="text-[11px] text-zinc-500">${escHtml(s.createdAt || '')}</div>
    </div>
    ${s.status === '承認待ち' ? `<div class="flex gap-2 mt-3"><button data-act="approve" data-id="${s.id}" class="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-bold">承認</button><button data-act="reject" data-id="${s.id}" class="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-xs font-bold">却下</button></div>` : ''}
  `
  div.querySelectorAll('[data-act="approve"]').forEach(b => b.addEventListener('click', () => handleSuggestion(b.dataset.id, 'approve')))
  div.querySelectorAll('[data-act="reject"]').forEach(b => b.addEventListener('click', () => handleSuggestion(b.dataset.id, 'reject')))
  return div
}

async function handleSuggestion(id, act) {
  if (!isConfigured) { toast('デモモードでは処理できません'); return }
  try {
    const ref = doc(db, 'suggestions', id)
    if (act === 'approve') {
      await updateDoc(ref, { status: '承認済み' })
      toast('承認しました')
    } else {
      await updateDoc(ref, { status: '却下' })
      toast('却下しました')
    }
    loadSuggestions()
  } catch (e) { toast('処理に失敗: ' + (e.message || e)) }
}

// ---------- Gate ----------
async function checkGate() {
  await authReady
  const user = getCurrentUser()
  const gate = $('#adminGate'), content = $('#adminContent'), info = $('#gateInfo')
  if (!isConfigured) {
    hide(gate); show(content)
    loadConfig(); loadSuggestions()
    return
  }
  if (!user) {
    show(gate); hide(content)
    info.textContent = '未ログイン'
    return
  }
  if (!getIsAdmin()) {
    show(gate); hide(content)
    info.textContent = `ログイン中: ${user.email} — 管理者権限がありません`
    return
  }
  hide(gate); show(content)
  loadConfig(); loadSuggestions()
}

// ---------- Bind ----------
document.addEventListener('DOMContentLoaded', async () => {
  initTheme(); initAuth(); bindAuthModals()
  const { onAuthStateChanged } = await import('firebase/auth')
  const { auth } = await import('./firebase.js')
  if (auth) onAuthStateChanged(auth, () => checkGate())
  await authReady
  checkGate()
  $('#gateLoginBtn')?.addEventListener('click', () => show($('#loginModal')))

  document.querySelectorAll('a[href="index.html"]')?.forEach(a => {
    a.addEventListener('click', e => e.stopPropagation())
  })

  $('#updateVersionBtn')?.addEventListener('click', updateVersion)
  $('#addVersionBtn')?.addEventListener('click', addVersion)
  $('#loadScheduleBtn')?.addEventListener('click', loadScheduleForEdit)
  $('#generateScheduleTemplateBtn')?.addEventListener('click', generateScheduleTemplate)
  $('#addEntryBtn')?.addEventListener('click', addScheduleRow)
  $('#saveScheduleBtn')?.addEventListener('click', saveSchedule)
  $('#editVersionSelect')?.addEventListener('change', () => {
    state.editVersion = $('#editVersionSelect').value
    loadScheduleForEdit()
  })
  $('#schedulePreviewCourse')?.addEventListener('change', () => {
    state.previewCourse = $('#schedulePreviewCourse').value
    renderSchedulePreview()
  })

  $('#loadSubBtn')?.addEventListener('click', loadSubForEdit)
  $('#addSubEntryBtn')?.addEventListener('click', addSubRow)
  $('#saveSubBtn')?.addEventListener('click', saveSubs)
  $('#subVersionSelect')?.addEventListener('change', () => {
    state.subVersion = $('#subVersionSelect').value
    loadSubForEdit()
  })

  $('#shareApplyBtn')?.addEventListener('click', applyShare)
  $('#shareCancelBtn')?.addEventListener('click', () => { hide($('#shareModal')); state.shareTarget = null })
  $('#exceptionApplyBtn')?.addEventListener('click', applyException)
  $('#exceptionCancelBtn')?.addEventListener('click', () => { hide($('#exceptionModal')); state.exceptionTarget = null })
  $('#shareModal')?.addEventListener('click', e => { if (e.target === $('#shareModal')) { hide($('#shareModal')); state.shareTarget = null } })
  $('#exceptionModal')?.addEventListener('click', e => { if (e.target === $('#exceptionModal')) { hide($('#exceptionModal')); state.exceptionTarget = null } })

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(x => { x.classList.remove('active', 'bg-white', 'text-zinc-900'); x.classList.add('bg-white/10', 'border', 'border-white/10') })
      b.classList.add('active', 'bg-white', 'text-zinc-900'); b.classList.remove('bg-white/10', 'border', 'border-white/10')
      state.filter = b.dataset.filter
      renderSuggestions()
    })
  })
})

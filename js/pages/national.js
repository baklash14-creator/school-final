// National examinations (BECE and WASSCE): results entry for administrators, a report, and a read-only view for students and parents.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, loadingBlock, errorBlock, formHtml, readForm, resolveFields, exportButtons, wireExports } from '../ui.js';

const TYPES = ['BECE', 'WASSCE'];
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => thisYear - i);
// WASSCE grades A1 to C6 are credit passes; the report shows the spread of whatever grades were entered.
const isCredit = (g) => /^(A1|B2|B3|C4|C5|C6)$/i.test(g);
const WASSCE_SUBJECTS = ['English Language', 'Mathematics', 'Integrated Science', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Geography', 'Government', 'History', 'Literature in English', 'Commerce', 'Financial Accounting', 'Agricultural Science', 'French', 'Religious Studies', 'Technical Drawing', 'Computer Studies'];
const BECE_SUBJECTS = ['English Language', 'Mathematics', 'Integrated Science', 'Social Studies', 'French', 'Religious and Moral Education', 'Business Studies', 'Agricultural Science', 'Creative Arts', 'Home Economics', 'Computer Studies'];
const subjectsFor = (t) => (t === 'BECE' ? BECE_SUBJECTS : WASSCE_SUBJECTS);

export function nationalExams() {
  return async (view) => {
    view.innerHTML = `<div class="tabs" id="nx-tabs"><button class="tab active" data-t="results">Results</button><button class="tab" data-t="report">Report</button></div><div id="nx-pane"></div>`;
    const pane = $('#nx-pane', view), st = { type: 'WASSCE', year: thisYear };
    const show = async (t) => {
      $$('#nx-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await (t === 'results' ? resultsPane(pane, st) : reportPane(pane, st)); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#nx-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('results');
  };
}

const filterBar = (st) => `<div class="toolbar"><select class="input sm" id="nx-type" aria-label="Examination">${TYPES.map((t) => `<option ${t === st.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
  <select class="input sm" id="nx-year" aria-label="Year">${YEARS.map((y) => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`;
const bindFilter = (pane, st, reload) => { $('#nx-type', pane).onchange = (e) => { st.type = e.target.value; reload(); }; $('#nx-year', pane).onchange = (e) => { st.year = Number(e.target.value); reload(); }; };

async function loadRows(st) {
  return must(sb.from('national_exam_results').select('*, students(full_name,student_no,classes(name))').eq('exam_type', st.type).eq('exam_year', st.year).order('subject').limit(10000));
}
const byStudent = (rows) => {
  const m = new Map();
  rows.forEach((r) => { if (!m.has(r.student_id)) m.set(r.student_id, { s: r.students, index: r.index_number, id: r.student_id, items: [] }); const o = m.get(r.student_id); o.items.push(r); if (r.index_number) o.index = r.index_number; });
  return [...m.values()].sort((a, b) => (a.s?.full_name || '').localeCompare(b.s?.full_name || ''));
};

async function resultsPane(pane, st) {
  const rows = await loadRows(st), groups = byStudent(rows);
  pane.innerHTML = `<div class="page-head"><div><h2>${esc(st.type)} results</h2><p class="muted">Enter each candidate's index number and subject grades as released by the examinations council.</p></div>
      <div class="head-actions">${exportButtons()}<button class="btn primary" id="nx-add">${icon('plus', 16)} Enter results</button></div></div>${filterBar(st)}
    <div class="card flush" id="nx-list">${tableHtml({
      columns: [
        { label: 'Candidate', render: (g) => `<b>${esc(g.s?.full_name || '-')}</b><span class="sub">${esc(g.s?.classes?.name || '')}${g.index ? ` | Index ${esc(g.index)}` : ''}</span>` },
        { label: 'Grades', render: (g) => g.items.map((r) => `<span class="chip">${esc(r.subject)}: <b>${esc(r.grade)}</b></span>`).join(' ') },
        { label: '', cls: 'actions', render: (g) => `<button class="btn ghost sm" data-edit="${g.id}">Edit</button><button class="icon-btn" data-del="${g.id}" title="Delete all grades" aria-label="Delete all grades">${icon('trash', 16)}</button>` },
      ], rows: groups, empty: `No ${st.type} ${st.year} results yet`, emptyText: 'Use "Enter results" to add a candidate.',
    })}</div>`;
  const reload = () => resultsPane(pane, st).catch((e) => { pane.innerHTML = errorBlock(e); });
  bindFilter(pane, st, reload);
  wireExports(pane, `${st.type} ${st.year}`, async () => rows.map((r) => ({ Candidate: r.students?.full_name, 'Index number': r.index_number || '', Class: r.students?.classes?.name || '', Subject: r.subject, Grade: r.grade })));
  $('#nx-add', pane).onclick = () => entryDialog(st, null, reload);
  $('#nx-list', pane).onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) entryDialog(st, groups.find((g) => g.id === ed.dataset.edit), reload);
    if (del) {
      const g = groups.find((x) => x.id === del.dataset.del);
      if (!(await confirmBox({ title: 'Delete these grades?', message: `All ${st.type} ${st.year} grades for ${g?.s?.full_name || 'this candidate'} will be removed.`, confirmText: 'Delete', danger: true }))) return;
      try { await must(sb.from('national_exam_results').delete().eq('student_id', del.dataset.del).eq('exam_type', st.type).eq('exam_year', st.year)); toast('Deleted'); reload(); } catch (err) { fail(err); }
    }
  };
}

async function entryDialog(st, group, reload) {
  const f = await resolveFields([{ name: 'student_id', label: 'Candidate', type: 'select', blank: 'Choose a student', required: true, options: lookup('students', 'full_name', { extra: 'student_no', format: (r) => `${r.full_name} (${r.student_no})` }) }]);
  const lines = group ? group.items.map((r) => [r.subject, r.grade]) : subjectsFor(st.type).slice(0, 8).map((s) => [s, '']);
  const rowHtml = ([s, g]) => `<div class="nx-line"><input class="input" data-s list="nx-subj" value="${esc(s)}" maxlength="80" aria-label="Subject"><input class="input" data-g value="${esc(g)}" maxlength="4" placeholder="Grade" aria-label="Grade"><button type="button" class="icon-btn" data-rm aria-label="Remove subject">${icon('x', 16)}</button></div>`;
  const m = modal({
    title: `${st.type} ${st.year}: ${group ? group.s?.full_name || 'candidate' : 'enter results'}`, size: 'lg',
    html: `${group ? '' : formHtml(f, {})}<div class="field"><label for="nx-index">Index number</label><input class="input" id="nx-index" maxlength="30" value="${esc(group?.index || '')}"></div>
      <div id="nx-lines">${lines.map(rowHtml).join('')}</div><datalist id="nx-subj">${subjectsFor(st.type).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <button type="button" class="btn ghost sm" id="nx-more">${icon('plus', 15)} Add a subject</button><p class="muted" style="font-size:13px">Leave a grade empty to skip that subject. Examples: ${st.type === 'WASSCE' ? 'A1, B2, C6, D7, E8, F9' : 'grades as printed on the statement of results'}.</p>`,
    footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nx-save">Save results</button>',
  });
  $('#nx-more', m.el).onclick = () => $('#nx-lines', m.el).insertAdjacentHTML('beforeend', rowHtml(['', '']));
  $('#nx-lines', m.el).onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) b.closest('.nx-line').remove(); };
  $('#nx-save', m.el).onclick = async (e) => {
    let sid = group?.id;
    if (!group) { const r = readForm($('form', m.el), f); if (!r.ok) return; sid = r.values.student_id; }
    const index = $('#nx-index', m.el).value.trim() || null, seen = new Set(), out = [];
    for (const row of $$('.nx-line', m.el)) {
      const s = $('[data-s]', row).value.trim(), g = $('[data-g]', row).value.trim().toUpperCase(); if (!s && !g) continue; if (!g) continue;
      if (s.length < 2) return toast('Every grade needs a subject name', 'error');
      if (seen.has(s.toLowerCase())) return toast(`${s} appears twice`, 'error'); seen.add(s.toLowerCase());
      out.push({ student_id: sid, exam_type: st.type, exam_year: st.year, index_number: index, subject: s, grade: g });
    }
    if (!out.length) return toast('Enter at least one grade', 'error');
    setBusy(e.currentTarget, true, 'Saving');
    try {
      if (group) { const keep = out.map((o) => o.subject); const gone = group.items.filter((r) => !keep.includes(r.subject)).map((r) => r.id); if (gone.length) await must(sb.from('national_exam_results').delete().in('id', gone)); }
      await must(sb.from('national_exam_results').upsert(out, { onConflict: 'student_id,exam_type,exam_year,subject' }));
      toast('Results saved'); m.close(); reload();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

async function reportPane(pane, st) {
  const rows = await loadRows(st), groups = byStudent(rows);
  const subj = new Map(); rows.forEach((r) => { if (!subj.has(r.subject)) subj.set(r.subject, { n: 0, credit: 0, grades: {} }); const o = subj.get(r.subject); o.n++; if (isCredit(r.grade)) o.credit++; o.grades[r.grade] = (o.grades[r.grade] || 0) + 1; });
  const list = [...subj].sort((a, b) => a[0].localeCompare(b[0]));
  const full = groups.filter((g) => ['english', 'math'].every((k) => g.items.some((r) => r.subject.toLowerCase().includes(k) && isCredit(r.grade)))).length;
  pane.innerHTML = `<div class="page-head"><div><h2>${esc(st.type)} ${st.year} report</h2><p class="muted">How the candidates did, subject by subject.</p></div></div>${filterBar(st)}
    ${st.type === 'WASSCE' ? '' : '<p class="notice">Credit passes are only counted for WASSCE grades (A1 to C6).</p>'}
    <div class="stats"><div class="stat info"><span class="ico">${icon('student', 22)}</span><div><b>${groups.length}</b><span>Candidates</span></div></div>
      ${st.type === 'WASSCE' ? `<div class="stat ok"><span class="ico">${icon('check', 22)}</span><div><b>${full}</b><span>Credit in English and Maths</span></div></div>` : ''}</div>
    <div class="card flush">${tableHtml({
      columns: [{ label: 'Subject', render: ([s]) => `<b>${esc(s)}</b>` }, { label: 'Candidates', cls: 'num', render: ([, o]) => o.n },
        ...(st.type === 'WASSCE' ? [{ label: 'Credit passes', cls: 'num', render: ([, o]) => `${o.credit} (${Math.round((o.credit / o.n) * 100)}%)` }] : []),
        { label: 'Grade spread', render: ([, o]) => Object.entries(o.grades).sort().map(([g, n]) => `<span class="chip">${esc(g)} x${n}</span>`).join(' ') }],
      rows: list, empty: `No ${st.type} ${st.year} results yet`,
    })}</div>`;
  bindFilter(pane, st, () => reportPane(pane, st).catch((e) => { pane.innerHTML = errorBlock(e); }));
}

export async function nationalResultsView(view, studentId) {
  try {
    const rows = await must(sb.from('national_exam_results').select('*').eq('student_id', studentId).order('exam_year', { ascending: false }).limit(300));
    const groups = new Map(); rows.forEach((r) => { const k = `${r.exam_type} ${r.exam_year}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    view.innerHTML = `<div class="page-head"><div><h2>BECE and WASSCE results</h2><p class="muted">National examination results recorded by the school.</p></div></div>
      ${groups.size ? [...groups].map(([k, items]) => `<div class="card"><div class="card-head"><h3>${esc(k)}</h3>${items[0].index_number ? `<span class="muted">Index ${esc(items[0].index_number)}</span>` : ''}</div>${tableHtml({ columns: [{ label: 'Subject', render: (r) => esc(r.subject) }, { label: 'Grade', render: (r) => badge(r.grade, k.startsWith('WASSCE') ? (isCredit(r.grade) ? 'ok' : 'warn') : 'info') }], rows: items.sort((a, b) => a.subject.localeCompare(b.subject)) })}</div>`).join('')
        : '<div class="card"><p class="muted">No national examination results have been recorded yet.</p></div>'}`;
  } catch (e) { view.innerHTML = errorBlock(e); }
}

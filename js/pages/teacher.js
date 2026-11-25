// Teacher portal
import { sb } from '../supabase.js';
import { startPortal } from '../portal-shell.js';
import { must, lookup, nameMap } from '../api.js';
import { crudPage } from '../crud.js';
import { messagesView } from './messages.js';
import { teacherTimetableView } from './timetable.js';
import { quizManager } from './quizzes.js';
import { libraryView } from './library.js';
import { myLeave } from './teacher-leave.js';
import { conductManager, healthDirectory } from './wellbeing.js';
import { attendanceTaker, scoreEntry, announcementsView, profileView } from './shared.js';
import {
  $, $$, esc, icon, toast, fail, modal, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, fmtDate, fmtDateTime, today, num,
} from '../ui.js';

let teacher = null;
async function getTeacher(ctx) {
  if (!teacher) teacher = await must(sb.from('teachers').select('*').eq('profile_id', ctx.user.id).maybeSingle());
  return teacher;
}
const noRecord = (view) => { view.innerHTML = emptyState('Your account is not linked to a teacher record', 'Ask the school administrator to link your account to your teacher profile.', 'teacher'); };

async function myClasses(t) {
  const [a, c] = await Promise.all([
    must(sb.from('teacher_assignments').select('class_id,subject_id,classes(id,name),subjects(id,name)').eq('teacher_id', t.id)),
    must(sb.from('classes').select('id,name').eq('class_teacher_id', t.id)),
  ]);
  const map = new Map();
  a.forEach((x) => x.classes && map.set(x.classes.id, x.classes.name));
  c.forEach((x) => map.set(x.id, x.name));
  return { assignments: a, classTeacherOf: c, classes: [...map].map(([value, label]) => ({ value, label })).sort((x, y) => x.label.localeCompare(y.label)) };
}

async function overview(view, ctx) {
  const t = await getTeacher(ctx); if (!t) return noRecord(view);
  const my = await myClasses(t);
  const [done, due] = await Promise.all([
    my.classes.length ? must(sb.from('attendance').select('class_id').eq('attendance_date', today()).in('class_id', my.classes.map((c) => c.value)).limit(5000)) : [],
    must(sb.from('assignments').select('id,title,due_date,classes(name)').eq('teacher_id', t.id).gte('due_date', today()).order('due_date').limit(5)),
  ]);
  const taken = new Set(done.map((d) => d.class_id));
  view.innerHTML = `
    <div class="page-head"><div><h2>Hello, ${esc(t.full_name.split(' ')[0])}</h2><p class="muted">${esc(t.job_title || 'Teacher')} | ${esc(t.staff_no)}</p></div><div class="head-actions"><a class="btn primary" href="#/attendance">${icon('calendar', 16)} Take attendance</a></div></div>
    <div class="stats">
      <div class="stat"><span class="ico">${icon('class', 22)}</span><div><b>${my.classes.length}</b><span>My classes</span></div></div>
      <div class="stat gold"><span class="ico">${icon('book', 22)}</span><div><b>${my.assignments.length}</b><span>Subjects taught</span></div></div>
      <div class="stat ${taken.size === my.classes.length && my.classes.length ? 'ok' : 'bad'}"><span class="ico">${icon('calendar', 22)}</span><div><b>${taken.size}/${my.classes.length}</b><span>Classes marked today</span></div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>My classes today</h3><a href="#/classes">Open</a></div>${my.classes.length ? `<div class="list">${my.classes.map((c) => `<div class="list-item"><b>${esc(c.label)}</b>${badge(taken.has(c.value) ? 'marked' : 'not marked', taken.has(c.value) ? 'ok' : 'warn')}</div>`).join('')}</div>` : emptyState('No classes yet', 'The administrator will assign your classes and subjects.', 'class')}</div>
      <div class="card"><div class="card-head"><h3>Assignments due soon</h3><a href="#/assignments">Manage</a></div>${due.length ? `<div class="list">${due.map((a) => `<div class="list-item"><div><b>${esc(a.title)}</b><small>${esc(a.classes?.name)}</small></div><span class="muted">${fmtDate(a.due_date)}</span></div>`).join('')}</div>` : emptyState('Nothing due', 'Create an assignment for your class.', 'clipboard')}</div>
    </div>`;
}

async function classesPage(view, ctx) {
  const t = await getTeacher(ctx); if (!t) return noRecord(view);
  const my = await myClasses(t);
  if (!my.classes.length) { view.innerHTML = emptyState('No classes assigned yet', 'The administrator will assign your classes.', 'class'); return; }
  view.innerHTML = `<div class="page-head"><div><h2>My classes</h2><p class="muted">Subjects you teach and the students in each class.</p></div></div>
    <div class="grid cols-2">${my.classes.map((c) => `<div class="card"><div class="card-head"><h3>${esc(c.label)}</h3>${my.classTeacherOf.some((x) => x.id === c.value) ? badge('class teacher', 'info') : ''}</div>
      <p class="muted" style="margin-bottom:12px">${my.assignments.filter((a) => a.class_id === c.value).map((a) => esc(a.subjects?.name)).join(', ') || 'Class teacher'}</p><button class="btn ghost sm" data-class="${c.value}">${icon('users', 15)} View students</button></div>`).join('')}</div>`;
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-class]'); if (!b) return;
    const c = my.classes.find((x) => x.value === b.dataset.class);
    const m = modal({ title: `${c.label}: students`, size: 'lg', html: loadingBlock() });
    try {
      const rows = await must(sb.from('students').select('student_no,full_name,gender,phone').eq('class_id', c.value).eq('status', 'active').order('full_name').limit(500));
      m.body.innerHTML = tableHtml({ columns: [{ label: 'Student no', key: 'student_no' }, { label: 'Name', render: (r) => `<b>${esc(r.full_name)}</b>` }, { label: 'Gender', render: (r) => esc(r.gender || '-') }], rows, empty: 'No students in this class yet' });
    } catch (err) { m.body.innerHTML = errorBlock(err); }
  });
}

const attendance = async (view, ctx) => { const t = await getTeacher(ctx); if (!t) return noRecord(view); const my = await myClasses(t); return attendanceTaker(view, ctx, { classOptions: async () => my.classes }); };
const scores = async (view, ctx) => { const t = await getTeacher(ctx); if (!t) return noRecord(view); return scoreEntry(view, ctx, { teacherId: t.id }); };

async function assignmentsPage(view, ctx) {
  const t = await getTeacher(ctx); if (!t) return noRecord(view);
  const my = await myClasses(t);
  const subjOpts = async () => { const m = new Map(); my.assignments.forEach((a) => a.subjects && m.set(a.subjects.id, a.subjects.name)); return [...m].map(([value, label]) => ({ value, label })); };
  return crudPage({
    table: 'assignments', title: 'Assignments', singular: 'assignment', description: 'Set homework for your classes and grade what students hand in.',
    select: '*, classes(name), subjects(name), assignment_submissions(id)', search: ['title'], order: { col: 'created_at', asc: false },
    baseFilter: (q) => q.eq('teacher_id', t.id),
    columns: [{ label: 'Assignment', render: (r) => `<b>${esc(r.title)}</b><span class="sub">${esc(r.subjects?.name || '')}</span>` }, { label: 'Class', render: (r) => esc(r.classes?.name) },
      { label: 'Due', render: (r) => fmtDate(r.due_date) }, { label: 'Submitted', render: (r) => r.assignment_submissions.length }],
    fields: [
      { name: 'title', label: 'Title', required: true, full: true, maxlength: 150 },
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: async () => my.classes },
      { name: 'subject_id', label: 'Subject', type: 'select', options: subjOpts },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'description', label: 'Instructions', type: 'textarea', rows: 4, full: true, maxlength: 3000 },
    ],
    beforeSave: (v, row, isNew) => { if (isNew) v.teacher_id = t.id; return v; },
    rowActions: (r) => `<button class="icon-btn" data-act="subs" data-id="${r.id}" title="Submissions" aria-label="Submissions">${icon('inbox', 16)}</button>`,
    onAction: (act, row) => { if (act === 'subs') submissions(row); },
  })(view, ctx);
}

async function submissions(a) {
  const m = modal({ title: `Submissions: ${a.title}`, size: 'xl', html: loadingBlock() });
  try {
    const [subs, studs] = await Promise.all([
      must(sb.from('assignment_submissions').select('*, students(full_name,student_no)').eq('assignment_id', a.id).order('submitted_at')),
      must(sb.from('students').select('id,full_name').eq('class_id', a.class_id).eq('status', 'active').limit(500)),
    ]);
    const missing = studs.filter((s) => !subs.some((x) => x.student_id === s.id));
    const links = {};
    await Promise.all(subs.filter((s) => s.file_path).map(async (s) => { const { data } = await sb.storage.from('submissions').createSignedUrl(s.file_path, 600); links[s.id] = data?.signedUrl; }));
    m.body.innerHTML = `<p class="muted" style="margin-bottom:12px">${subs.length} of ${studs.length} students have submitted.${missing.length ? ` Not yet: ${esc(missing.map((s) => s.full_name).join(', '))}.` : ''}</p>
      ${subs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Work</th><th class="num">Score</th><th>Feedback</th><th></th></tr></thead><tbody>${subs.map((s) => `<tr data-id="${s.id}">
        <td><b>${esc(s.students?.full_name)}</b><span class="sub">${fmtDateTime(s.submitted_at)}${a.due_date && s.submitted_at.slice(0, 10) > a.due_date ? ' | late' : ''}</span></td>
        <td style="max-width:280px">${s.content ? `<div style="white-space:pre-wrap">${esc(s.content)}</div>` : ''}${links[s.id] ? `<a href="${esc(links[s.id])}" target="_blank" rel="noopener">${icon('download', 14)} Open file</a>` : ''}</td>
        <td class="num"><input class="input score-input" type="number" min="0" max="1000" step="0.01" name="sc" value="${s.score ?? ''}" aria-label="Score"></td>
        <td><input class="input" name="fb" maxlength="500" value="${esc(s.feedback || '')}" aria-label="Feedback"></td>
        <td><button class="btn ghost sm" data-save="${s.id}">Save</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Nothing submitted yet', '', 'inbox')}`;
    m.body.onclick = async (e) => {
      const b = e.target.closest('[data-save]'); if (!b) return;
      const tr = b.closest('tr'); const score = $('[name=sc]', tr).value;
      setBusy(b, true);
      try { await must(sb.from('assignment_submissions').update({ score: score === '' ? null : Number(score), feedback: $('[name=fb]', tr).value.trim() || null }).eq('id', b.dataset.save)); toast('Grade saved'); } catch (err) { fail(err); } finally { setBusy(b, false); }
    };
  } catch (e) { m.body.innerHTML = errorBlock(e); }
}

startPortal({
  roles: ['teacher'], home: 'overview',
  nav: [
    { id: 'overview', label: 'Overview', icon: 'grid', render: overview },
    { id: 'classes', label: 'My classes', icon: 'class', render: classesPage },
    { id: 'timetable', label: 'My timetable', icon: 'table', render: async (v, c) => { const t = await getTeacher(c); if (!t) return noRecord(v); return teacherTimetableView(v, t); } },
    { id: 'attendance', label: 'Attendance', icon: 'calendar', render: attendance },
    { id: 'scores', label: 'Enter scores', icon: 'edit', render: scores },
    { id: 'assignments', label: 'Assignments', icon: 'clipboard', render: assignmentsPage },
    { id: 'quizzes', label: 'Online quizzes', icon: 'list', render: async (v, c) => { const t = await getTeacher(c); if (!t) return noRecord(v); const my = await myClasses(t); return quizManager({ teacher: t, classOptions: my.classes, subjectOptions: lookup('subjects', 'name') })(v, c); } },
    { id: 'conduct', label: 'Conduct', icon: 'alert', render: (v, c) => conductManager({ teacher: true })(v, c) },
    { id: 'health', label: 'Student health', icon: 'shield', render: (v) => healthDirectory(v) },
    { id: 'library', label: 'Library', icon: 'book', render: async (v, c) => { const t = await getTeacher(c); if (!t) return noRecord(v); return libraryView(v, { teacherId: t.id }); } },
    { id: 'leave', label: 'Leave & payslips', icon: 'calendar', render: (v, c) => myLeave()(v, c) },
    { id: 'messages', label: 'Messages', icon: 'message', render: messagesView },
    { id: 'announcements', label: 'Announcements', icon: 'megaphone', render: announcementsView },
    { id: 'profile', label: 'My profile', icon: 'user', render: profileView },
  ],
});

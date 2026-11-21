// Admin: overview, students, teachers, parents, classes, subjects, class subjects
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { must, lookup, currentYear } from '../api.js';
import { crudPage } from '../crud.js';
import { openCreateAccount } from './admin-system.js';
import { attachPhotoUrls, avatarHtml, photoDialog, guardiansDialog, idCardsDialog } from './people-tools.js';
import { openImporter } from './importer.js';
import {
  $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock,
  fmtDate, fmtDateTime, fmtMoney, today, formHtml, readForm, resolveFields, initials,
} from '../ui.js';

const yearOpts = lookup('academic_years', 'name', { order: 'start_date' });
const classOpts = lookup('classes', 'name');
const countOf = async (q) => { const { count, error } = await q; if (error) throw error; return count || 0; };
const head = (t) => sb.from(t).select('id', { count: 'exact', head: true });

/* ---------------- overview ---------------- */
export async function overview(view, ctx) {
  const d = today();
  const [students, teachers, classes, subjects, parents, balances, att, apps, logs] = await Promise.all([
    countOf(head('students').eq('status', 'active')), countOf(head('teachers').eq('status', 'active')),
    countOf(head('classes')), countOf(head('subjects')), countOf(head('parents')),
    sb.from('student_fee_balances').select('total_paid,balance').limit(5000).then((r) => r.data || []),
    sb.from('attendance').select('status').eq('attendance_date', d).limit(5000).then((r) => r.data || []),
    sb.from('admission_applications').select('id,applicant_name,grade_applying,status,created_at').order('created_at', { ascending: false }).limit(5).then((r) => r.data || []),
    sb.from('audit_logs').select('user_name,action,entity,created_at').order('created_at', { ascending: false }).limit(8).then((r) => r.data || []),
  ]);
  const collected = balances.reduce((a, b) => a + Number(b.total_paid), 0);
  const outstanding = balances.reduce((a, b) => a + Math.max(0, Number(b.balance)), 0);
  const c = { present: 0, absent: 0, late: 0 }; att.forEach((a) => c[a.status]++);
  const marked = att.length, rate = marked ? Math.round(((c.present + c.late) / marked) * 100) : null;
  const verb = { INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' };
  const tile = (href, cls, ic, val, label) => `<a class="stat ${cls}" href="${href}"><span class="ico">${icon(ic, 22)}</span><div><b>${val}</b><span>${label}</span></div></a>`;
  const first = ctx.profile.full_name?.split(' ')[0] || 'there';
  view.innerHTML = `
    <div class="page-head"><div><h2>Welcome back, ${esc(first)}</h2><p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="head-actions"><a class="btn ghost" href="#/students">${icon('plus', 16)} New student</a><a class="btn primary" href="#/attendance">${icon('calendar', 16)} Take attendance</a></div></div>
    <div class="stats">
      ${tile('#/students', '', 'student', students, 'Active students')}
      ${tile('#/teachers', 'info', 'teacher', teachers, 'Teachers')}
      ${tile('#/classes', '', 'class', classes, 'Classes')}
      ${tile('#/subjects', 'gold', 'book', subjects, 'Subjects')}
      ${tile('#/parents', 'info', 'users', parents, 'Parents')}
      ${tile('#/fees', 'ok', 'wallet', fmtMoney(collected), 'Fees collected')}
      ${tile('#/fees', 'bad', 'alert', fmtMoney(outstanding), 'Outstanding fees')}
      ${tile('#/attendance', rate == null ? '' : rate >= 90 ? 'ok' : 'gold', 'calendar', rate == null ? 'Not taken' : rate + '%', "Today's attendance")}
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Today's attendance</h3><a href="#/attendance">Take attendance</a></div>
        ${marked ? `<div class="list">${[['Present', c.present, ''], ['Late', c.late, 'warn'], ['Absent', c.absent, 'bad']].map(([l, n, k]) => `<div class="list-item"><span>${l}</span><b>${n}</b></div><div class="bar ${k}"><i style="width:${Math.round((n / marked) * 100)}%"></i></div>`).join('')}</div>` : emptyState('No attendance recorded today', 'Teachers or administrators can record it from the Attendance page.', 'calendar')}</div>
      <div class="card"><div class="card-head"><h3>Recent admissions</h3><a href="#/admissions">View all</a></div>
        ${apps.length ? `<div class="list">${apps.map((a) => `<div class="list-item"><div><b>${esc(a.applicant_name)}</b><small>${esc(a.grade_applying)} | ${fmtDate(a.created_at)}</small></div>${badge(a.status)}</div>`).join('')}</div>` : emptyState('No applications yet', 'Applications from the website appear here.', 'inbox')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Recent activity</h3>${ctx.profile.role === 'super_admin' || ctx.profile.permissions?.audit !== false ? '<a href="#/audit">Full audit log</a>' : ''}</div>
      ${logs.length ? `<div class="list">${logs.map((l) => `<div class="list-item"><span><b>${esc(l.user_name || 'System')}</b> ${verb[l.action] || esc(l.action)} ${esc(String(l.entity).replace(/_/g, ' '))}</span><small>${fmtDateTime(l.created_at)}</small></div>`).join('')}</div>` : emptyState('No activity yet', 'Changes made by administrators will be listed here.', 'list')}</div>`;
}

/* ---------------- students ---------------- */
const accountBtn = (r) => (r.profile_id ? '' : `<button class="icon-btn" data-act="login" data-id="${r.id}" title="Create sign-in account" aria-label="Create sign-in account">${icon('key', 16)}</button>`);
const STATUSES = ['active', 'suspended', 'graduated', 'withdrawn', 'transferred'].map((v) => ({ value: v, label: v }));

export function students(ctx) {
  const page = crudPage({
    table: 'students', title: 'Students', singular: 'student', description: 'Register students, assign classes and manage their status.',
    select: '*, classes(name), parents(full_name), student_guardians(id)', afterLoad: (rows) => attachPhotoUrls(rows, 'student'), search: ['full_name', 'student_no', 'phone'], searchPlaceholder: 'Search name, ID or phone', order: { col: 'created_at', asc: false },
    exportName: 'Students', formSize: 'lg',
    filters: [{ name: 'class_id', label: 'All classes', options: classOpts }, { name: 'status', label: 'Any status', options: STATUSES }],
    columns: [
      { label: 'Student', render: (r) => `<div style="display:flex;gap:10px;align-items:center">${avatarHtml(r)}<div><b>${esc(r.full_name)}</b><span class="sub">${esc(r.student_no)}</span></div></div>` },
      { label: 'Class', render: (r) => esc(r.classes?.name || 'Not assigned') },
      { label: 'Parent', render: (r) => `${esc(r.parents?.full_name || '-')}${r.student_guardians?.length ? `<span class="sub">+${r.student_guardians.length} more guardian${r.student_guardians.length === 1 ? '' : 's'}</span>` : ''}` },
      { label: 'Gender', render: (r) => esc(r.gender || '-') },
      { label: 'Status', render: (r) => badge(r.status) },
      { label: 'Login', render: (r) => badge(r.profile_id ? 'linked' : 'none', r.profile_id ? 'ok' : 'muted') },
    ],
    exportMap: (r) => ({ 'Student no': r.student_no, Name: r.full_name, Gender: r.gender || '', Class: r.classes?.name || '', Parent: r.parents?.full_name || '', Status: r.status, Admitted: r.admitted_on }),
    fields: [
      { name: 'student_no', label: 'Student ID', readonly: true, lockOnEdit: true, hideOnCreate: true, noSave: true, help: 'Assigned automatically.' },
      { name: 'full_name', label: 'Full name', required: true, full: true },
      { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
      { name: 'date_of_birth', label: 'Date of birth', type: 'date', max: today() },
      { name: 'class_id', label: 'Class', type: 'select', options: classOpts },
      { name: 'academic_year_id', label: 'Academic year', type: 'select', options: yearOpts },
      { name: 'parent_id', label: 'Parent / guardian', type: 'select', blank: 'Not linked', options: lookup('parents', 'full_name') },
      { name: 'status', label: 'Status', type: 'select', required: true, options: STATUSES },
      { name: 'admitted_on', label: 'Admission date', type: 'date' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', type: 'textarea', full: true, rows: 2 },
    ],
    defaults: async () => ({ academic_year_id: (await currentYear())?.id || '', status: 'active', admitted_on: today() }),
    async beforeSave(v, row, isNew) {
      if (v.class_id && v.status === 'active' && (isNew || row.class_id !== v.class_id || row.status !== 'active')) {
        const cls = await must(sb.from('classes').select('name,capacity').eq('id', v.class_id).single());
        const n = await countOf(head('students').eq('class_id', v.class_id).eq('status', 'active'));
        if (n >= cls.capacity) throw new Error(`${cls.name} is full (capacity ${cls.capacity}). Increase the capacity or choose another class.`);
      }
      return v;
    },
    async afterSave(s) {
      if (s.class_id && s.academic_year_id) {
        await sb.from('student_enrollments').upsert({ student_id: s.id, class_id: s.class_id, academic_year_id: s.academic_year_id }, { onConflict: 'student_id,academic_year_id' });
      }
    },
    deleteMessage: (r) => `${r.full_name} and all of their attendance, results and payment records will be permanently removed. To keep the records, set the status to Withdrawn instead.`,
    headerExtra: `<button class="btn ghost" id="import">${icon('upload', 16)} Import</button><button class="btn ghost" id="idcards">${icon('idcard', 16)} ID cards</button><button class="btn ghost" id="promote">${icon('up', 16)} Promote</button>`,
    rowActions: (r) => `${accountBtn(r)}<button class="icon-btn" data-act="photo" data-id="${r.id}" title="Photo" aria-label="Photo">${icon('camera', 16)}</button><button class="icon-btn" data-act="guardians" data-id="${r.id}" title="Parents and guardians" aria-label="Parents and guardians">${icon('users', 16)}</button>`,
    onMount: (v, { reload }) => { $('#promote', v).onclick = () => promoteDialog(reload); $('#idcards', v).onclick = () => idCardsDialog(); $('#import', v).onclick = () => openImporter('students', reload); },
    onAction: (act, row, { reload }) => {
      if (act === 'photo') photoDialog('student', row, reload);
      if (act === 'guardians') guardiansDialog(row, reload);
      if (act === 'login') openCreateAccount(ctx, { role: 'student', link: { table: 'students', id: row.id }, name: row.full_name, email: row.email, phone: row.phone }, reload); },
  });
  return page;
}

async function promoteDialog(done) {
  const [classes, years] = await Promise.all([classOpts(), yearOpts()]);
  const cy = await currentYear();
  const m = modal({
    title: 'Promote students', size: 'lg',
    html: `<div class="form-grid"><div class="field"><label for="pr-from">From class</label><select class="input" id="pr-from"><option value="">Select class</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="pr-to">Promote to</label><select class="input" id="pr-to"><option value="">Select class</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}<option value="graduate">Graduate (leave school)</option></select></div>
      <div class="field"><label for="pr-year">New academic year</label><select class="input" id="pr-year">${years.map((y) => `<option value="${y.value}" ${y.value === cy?.id ? 'selected' : ''}>${esc(y.label)}</option>`).join('')}</select></div></div>
      <div id="pr-list" style="margin-top:16px"><p class="muted">Choose the class to promote from.</p></div>`,
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pr-go" disabled>Promote selected</button>`,
  });
  let studs = [];
  $('#pr-from', m.el).onchange = async (e) => {
    const box = $('#pr-list', m.el);
    if (!e.target.value) { box.innerHTML = '<p class="muted">Choose the class to promote from.</p>'; $('#pr-go', m.el).disabled = true; return; }
    box.innerHTML = loadingBlock();
    try {
      studs = await must(sb.from('students').select('id,full_name,student_no').eq('class_id', e.target.value).eq('status', 'active').order('full_name').limit(500));
      box.innerHTML = studs.length ? `<label class="check" style="margin-bottom:8px"><input type="checkbox" id="pr-all" checked><span>Select all (${studs.length})</span></label><div class="pick-list">${studs.map((s) => `<label><input type="checkbox" value="${s.id}" checked><span>${esc(s.full_name)} <small class="muted">${esc(s.student_no)}</small></span></label>`).join('')}</div>` : emptyState('No active students in this class', '', 'users');
      $('#pr-go', m.el).disabled = !studs.length;
      $('#pr-all', m.el)?.addEventListener('change', (ev) => $$('.pick-list input', m.el).forEach((c) => (c.checked = ev.target.checked)));
    } catch (err) { box.innerHTML = errorBlock(err); }
  };
  $('#pr-go', m.el).onclick = async (e) => {
    const from = $('#pr-from', m.el).value, to = $('#pr-to', m.el).value, year = $('#pr-year', m.el).value;
    const ids = $$('.pick-list input:checked', m.el).map((c) => c.value);
    if (!to) return toast('Choose where to promote the students', 'error');
    if (to === from) return toast('The new class must be different from the current class', 'error');
    if (!ids.length) return toast('Select at least one student', 'error');
    setBusy(e.currentTarget, true, 'Promoting');
    try {
      if (to === 'graduate') {
        await must(sb.from('students').update({ status: 'graduated' }).in('id', ids));
      } else {
        const cls = await must(sb.from('classes').select('name,capacity').eq('id', to).single());
        const n = await countOf(head('students').eq('class_id', to).eq('status', 'active'));
        if (n + ids.length > cls.capacity) throw new Error(`${cls.name} has room for ${Math.max(0, cls.capacity - n)} more students (capacity ${cls.capacity}). Select fewer students or raise the capacity.`);
        await must(sb.from('students').update({ class_id: to, academic_year_id: year }).in('id', ids));
        await must(sb.from('student_enrollments').upsert(ids.map((student_id) => ({ student_id, class_id: to, academic_year_id: year, status: 'enrolled' })), { onConflict: 'student_id,academic_year_id' }));
      }
      toast(`${ids.length} student${ids.length === 1 ? '' : 's'} ${to === 'graduate' ? 'graduated' : 'promoted'}`);
      m.close(); done();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

/* ---------------- teachers ---------------- */
export function teachers(ctx) {
  return crudPage({
    table: 'teachers', title: 'Teachers', singular: 'teacher', description: 'Teacher records, qualifications and subject assignments.',
    select: '*, teacher_assignments(id)', afterLoad: (rows) => attachPhotoUrls(rows, 'teacher'), search: ['full_name', 'staff_no', 'phone', 'email'], searchPlaceholder: 'Search name, staff no or phone', order: { col: 'created_at', asc: false },
    exportName: 'Teachers', formSize: 'lg',
    filters: [{ name: 'status', label: 'Any status', options: ['active', 'on_leave', 'resigned'].map((v) => ({ value: v, label: v.replace('_', ' ') })) }],
    columns: [
      { label: 'Teacher', render: (r) => `<div style="display:flex;gap:10px;align-items:center">${avatarHtml(r)}<div><b>${esc(r.full_name)}</b><span class="sub">${esc(r.staff_no)}</span></div></div>` },
      { label: 'Role', render: (r) => esc(r.job_title || '-') },
      { label: 'Contact', render: (r) => `${esc(r.phone || '-')}<span class="sub">${esc(r.email || '')}</span>` },
      { label: 'Assignments', render: (r) => r.teacher_assignments.length },
      { label: 'Status', render: (r) => badge(r.status) },
      { label: 'Login', render: (r) => badge(r.profile_id ? 'linked' : 'none', r.profile_id ? 'ok' : 'muted') },
    ],
    exportMap: (r) => ({ 'Staff no': r.staff_no, Name: r.full_name, 'Job title': r.job_title || '', Phone: r.phone || '', Email: r.email || '', Status: r.status, Hired: r.hire_date || '' }),
    fields: [
      { name: 'staff_no', label: 'Staff ID', readonly: true, lockOnEdit: true, hideOnCreate: true, noSave: true, help: 'Assigned automatically.' },
      { name: 'full_name', label: 'Full name', required: true, full: true },
      { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
      { name: 'job_title', label: 'Job title', placeholder: 'e.g. Mathematics Teacher' },
      { name: 'qualification', label: 'Qualification', placeholder: 'e.g. BSc Education' },
      { name: 'hire_date', label: 'Date hired', type: 'date' },
      { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On leave' }, { value: 'resigned', label: 'Resigned' }] },
      { name: 'show_on_website', label: 'Show on public website', type: 'checkbox' },
      { name: 'bio', label: 'Short bio', type: 'textarea', full: true, rows: 3, maxlength: 1000 },
    ],
    defaults: () => ({ status: 'active', show_on_website: true }),
    headerExtra: `<button class="btn ghost" id="import">${icon('upload', 16)} Import</button>`,
    onMount: (v, { reload }) => { $('#import', v).onclick = () => openImporter('teachers', reload); },
    rowActions: (r) => `${accountBtn(r)}<button class="icon-btn" data-act="photo" data-id="${r.id}" title="Photo" aria-label="Photo">${icon('camera', 16)}</button><button class="icon-btn" data-act="assign" data-id="${r.id}" title="Subjects and classes" aria-label="Subjects and classes">${icon('book', 16)}</button>`,
    deleteMessage: (r) => `${r.full_name} will be removed. Their class and subject assignments will be cleared.`,
    onAction: (act, row, { reload }) => {
      if (act === 'login') openCreateAccount(ctx, { role: 'teacher', link: { table: 'teachers', id: row.id }, name: row.full_name, email: row.email, phone: row.phone }, reload);
      if (act === 'photo') photoDialog('teacher', row, reload);
      if (act === 'assign') teacherAssignments(row, reload);
    },
  });
}

async function teacherAssignments(t, done) {
  const [classes, subjects, year] = await Promise.all([classOpts(), lookup('subjects', 'name')(), currentYear()]);
  const m = modal({ title: `${t.full_name}: subjects and classes`, size: 'lg', html: `<div id="ta-body">${loadingBlock()}</div>` });
  async function draw() {
    const rows = await must(sb.from('teacher_assignments').select('id,classes(name),subjects(name,code)').eq('teacher_id', t.id).order('created_at'));
    $('#ta-body', m.el).innerHTML = `
      <div class="form-grid" style="grid-template-columns:1fr 1fr auto;align-items:end;margin-bottom:16px">
        <div class="field"><label for="ta-c">Class</label><select class="input" id="ta-c"><option value="">Select class</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="ta-s">Subject</label><select class="input" id="ta-s"><option value="">Select subject</option>${subjects.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>
        <button class="btn primary" id="ta-add">${icon('plus', 16)} Assign</button></div>
      ${tableHtml({ columns: [{ label: 'Class', render: (r) => esc(r.classes?.name) }, { label: 'Subject', render: (r) => `${esc(r.subjects?.name)} <span class="muted">(${esc(r.subjects?.code)})</span>` }, { label: '', cls: 'actions', render: (r) => `<button class="icon-btn danger" data-rm="${r.id}" aria-label="Remove">${icon('trash', 16)}</button>` }], rows, empty: 'No assignments yet', emptyText: 'Pick a class and subject above.' })}`;
    $('#ta-add', m.el).onclick = async (e) => {
      const class_id = $('#ta-c', m.el).value, subject_id = $('#ta-s', m.el).value;
      if (!class_id || !subject_id) return toast('Choose a class and a subject', 'error');
      setBusy(e.currentTarget, true);
      try {
        const ex = await must(sb.from('teacher_assignments').select('id,teachers(full_name)').eq('class_id', class_id).eq('subject_id', subject_id).maybeSingle());
        if (ex) await must(sb.from('teacher_assignments').update({ teacher_id: t.id }).eq('id', ex.id));
        else await must(sb.from('teacher_assignments').insert({ class_id, subject_id, teacher_id: t.id, academic_year_id: year?.id || null }));
        toast('Assignment saved'); done(); draw();
      } catch (err) { fail(err); setBusy(e.currentTarget, false); }
    };
    $('#ta-body', m.el).onclick = async (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      try { await must(sb.from('teacher_assignments').update({ teacher_id: null }).eq('id', b.dataset.rm)); toast('Teacher removed from this subject'); done(); draw(); } catch (err) { fail(err); }
    };
  }
  draw().catch((e) => { $('#ta-body', m.el).innerHTML = errorBlock(e); });
}

/* ---------------- parents ---------------- */
const kidsOf = (r) => [...r.students.map((s) => s.full_name), ...(r.student_guardians || []).map((g) => g.students?.full_name).filter(Boolean)];
export function parents(ctx) {
  return crudPage({
    table: 'parents', title: 'Parents and guardians', singular: 'parent', plural: 'parents', description: 'Parent records are linked to students and receive absence, result and fee notifications.',
    select: '*, students(id,full_name), student_guardians(students(full_name))', search: ['full_name', 'phone', 'email'], searchPlaceholder: 'Search name, phone or email', order: { col: 'created_at', asc: false }, exportName: 'Parents',
    columns: [
      { label: 'Parent', render: (r) => `<b>${esc(r.full_name)}</b><span class="sub">${esc(r.occupation || '')}</span>` },
      { label: 'Contact', render: (r) => `${esc(r.phone || '-')}<span class="sub">${esc(r.email || '')}</span>` },
      { label: 'Children', render: (r) => (kidsOf(r).length ? esc(kidsOf(r).join(', ')) : '<span class="muted">None linked</span>') },
      { label: 'Login', render: (r) => badge(r.profile_id ? 'linked' : 'none', r.profile_id ? 'ok' : 'muted') },
    ],
    exportMap: (r) => ({ Name: r.full_name, Phone: r.phone || '', Email: r.email || '', Children: kidsOf(r).join(', ') }),
    fields: [
      { name: 'full_name', label: 'Full name', required: true, full: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'occupation', label: 'Occupation' }, { name: 'address', label: 'Address', type: 'textarea', rows: 2, full: true },
    ],
    headerExtra: `<button class="btn ghost" id="import">${icon('upload', 16)} Import</button>`,
    onMount: (v, { reload }) => { $('#import', v).onclick = () => openImporter('parents', reload); },
    rowActions: accountBtn,
    onAction: (act, row, { reload }) => { if (act === 'login') openCreateAccount(ctx, { role: 'parent', link: { table: 'parents', id: row.id }, name: row.full_name, email: row.email, phone: row.phone }, reload); },
  });
}

/* ---------------- classes ---------------- */
export function classes() {
  return crudPage({
    table: 'classes', title: 'Classes', singular: 'class', plural: 'classes', description: 'Create classes, set capacity and assign class teachers.',
    select: '*, teachers(full_name), academic_years(name), students(id,status)', search: ['name', 'level'], order: { col: 'name', asc: true }, exportName: 'Classes',
    filters: [{ name: 'academic_year_id', label: 'All years', options: yearOpts }],
    columns: [
      { label: 'Class', render: (r) => `<b>${esc(r.name)}</b><span class="sub">${esc(r.level || '')}</span>` },
      { label: 'Class teacher', render: (r) => esc(r.teachers?.full_name || 'Not assigned') },
      { label: 'Enrolled', render: (r) => { const n = r.students.filter((s) => s.status === 'active').length; const p = Math.min(100, Math.round((n / r.capacity) * 100)); return `${n} / ${r.capacity}<div class="bar ${p >= 100 ? 'bad' : p >= 85 ? 'warn' : ''}" style="margin-top:4px;width:110px"><i style="width:${p}%"></i></div>`; } },
      { label: 'Year', render: (r) => esc(r.academic_years?.name || '-') },
    ],
    exportMap: (r) => ({ Class: r.name, Level: r.level || '', 'Class teacher': r.teachers?.full_name || '', Enrolled: r.students.filter((s) => s.status === 'active').length, Capacity: r.capacity }),
    fields: [
      { name: 'name', label: 'Class name', required: true, placeholder: 'e.g. Primary 4 A' },
      { name: 'level', label: 'Level', type: 'select', blank: 'Not set', options: () => CONFIG.LEVELS.map((l) => ({ value: l.name, label: l.name })) },
      { name: 'capacity', label: 'Capacity', type: 'number', required: true, min: 1, max: 500, value: 40 },
      { name: 'class_teacher_id', label: 'Class teacher', type: 'select', blank: 'Not assigned', options: lookup('teachers', 'full_name') },
      { name: 'academic_year_id', label: 'Academic year', type: 'select', options: yearOpts },
    ],
    defaults: async () => ({ capacity: 40, academic_year_id: (await currentYear())?.id || '' }),
    rowActions: (r) => `<button class="icon-btn" data-act="students" data-id="${r.id}" title="Manage students" aria-label="Manage students">${icon('users', 16)}</button>`,
    deleteMessage: (r) => `${r.name} will be deleted along with its attendance, examinations and fee structure. Students in it will be left without a class.`,
    onAction: (act, row, { reload }) => { if (act === 'students') classStudents(row, reload); },
  });
}

async function classStudents(cls, done) {
  const m = modal({ title: `${cls.name}: students`, size: 'lg', html: `<div id="cs-body">${loadingBlock()}</div>`, footer: `<button class="btn primary" data-close>Done</button>` });
  async function draw() {
    const [inClass, free] = await Promise.all([
      must(sb.from('students').select('id,full_name,student_no').eq('class_id', cls.id).eq('status', 'active').order('full_name')),
      must(sb.from('students').select('id,full_name,student_no').is('class_id', null).eq('status', 'active').order('full_name').limit(500)),
    ]);
    const left = cls.capacity - inClass.length;
    $('#cs-body', m.el).innerHTML = `<div class="grid cols-2">
      <div><h3>In this class (${inClass.length}/${cls.capacity})</h3>${inClass.length ? `<div class="pick-list">${inClass.map((s) => `<label style="justify-content:space-between;cursor:default"><span>${esc(s.full_name)} <small class="muted">${esc(s.student_no)}</small></span><button class="icon-btn danger" data-rm="${s.id}" aria-label="Remove ${esc(s.full_name)}">${icon('x', 16)}</button></label>`).join('')}</div>` : emptyState('No students yet', '', 'users')}</div>
      <div><h3>Students without a class</h3>${free.length ? `<div class="pick-list" id="cs-free">${free.map((s) => `<label><input type="checkbox" value="${s.id}"><span>${esc(s.full_name)} <small class="muted">${esc(s.student_no)}</small></span></label>`).join('')}</div>
        <p style="margin-top:10px"><button class="btn primary sm" id="cs-add" ${left <= 0 ? 'disabled' : ''}>Add selected</button> <small class="muted">${left > 0 ? `${left} place${left === 1 ? '' : 's'} left` : 'Class is full'}</small></p>` : emptyState('Everyone has a class', '', 'check')}</div></div>`;
    $('#cs-add', m.el)?.addEventListener('click', async (e) => {
      const ids = $$('#cs-free input:checked', m.el).map((c) => c.value);
      if (!ids.length) return toast('Select at least one student', 'error');
      if (ids.length > left) return toast(`Only ${left} place${left === 1 ? '' : 's'} left in this class`, 'error');
      setBusy(e.currentTarget, true);
      try {
        await must(sb.from('students').update({ class_id: cls.id, academic_year_id: cls.academic_year_id }).in('id', ids));
        if (cls.academic_year_id) await sb.from('student_enrollments').upsert(ids.map((student_id) => ({ student_id, class_id: cls.id, academic_year_id: cls.academic_year_id })), { onConflict: 'student_id,academic_year_id' });
        toast('Students added'); done(); draw();
      } catch (err) { fail(err); setBusy(e.currentTarget, false); }
    });
    $('#cs-body', m.el).onclick = async (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      try { await must(sb.from('students').update({ class_id: null }).eq('id', b.dataset.rm)); toast('Student removed from class'); done(); draw(); } catch (err) { fail(err); }
    };
  }
  draw().catch((e) => { $('#cs-body', m.el).innerHTML = errorBlock(e); });
}

/* ---------------- subjects + class subjects ---------------- */
export function subjects() {
  return crudPage({
    table: 'subjects', title: 'Subjects', singular: 'subject', description: 'The subjects taught at the school.',
    select: '*, teacher_assignments(id)', afterLoad: (rows) => attachPhotoUrls(rows, 'teacher'), search: ['name', 'code'], order: { col: 'name', asc: true }, exportName: 'Subjects',
    columns: [{ label: 'Subject', render: (r) => `<b>${esc(r.name)}</b><span class="sub">${esc(r.description || '')}</span>` }, { label: 'Code', render: (r) => esc(r.code) }, { label: 'Used in classes', render: (r) => r.teacher_assignments.length }],
    exportMap: (r) => ({ Subject: r.name, Code: r.code, Classes: r.teacher_assignments.length }),
    fields: [
      { name: 'name', label: 'Subject name', required: true, placeholder: 'e.g. Mathematics' },
      { name: 'code', label: 'Code', required: true, maxlength: 12, pattern: '[A-Za-z0-9]{2,12}', patternMsg: 'Use 2 to 12 letters or numbers', placeholder: 'e.g. MATH' },
      { name: 'description', label: 'Description', type: 'textarea', rows: 2, full: true },
    ],
    beforeSave: (v) => ({ ...v, code: v.code.toUpperCase() }),
    deleteMessage: (r) => `${r.name} will be removed from every class, along with its exam scores.`,
  });
}

export function classSubjects() {
  return crudPage({
    table: 'teacher_assignments', title: 'Class subjects and teachers', singular: 'assignment', plural: 'subject assignments',
    description: 'Decide which subjects each class studies and which teacher teaches them.',
    select: '*, classes(name), subjects(name,code), teachers(full_name)', order: { col: 'created_at', asc: false }, pageSize: 20, exportName: 'Class subjects',
    filters: [{ name: 'class_id', label: 'All classes', options: classOpts }, { name: 'teacher_id', label: 'All teachers', options: lookup('teachers', 'full_name') }],
    columns: [{ label: 'Class', render: (r) => `<b>${esc(r.classes?.name)}</b>` }, { label: 'Subject', render: (r) => `${esc(r.subjects?.name)} <span class="muted">(${esc(r.subjects?.code)})</span>` }, { label: 'Teacher', render: (r) => esc(r.teachers?.full_name || 'Not assigned') }],
    exportMap: (r) => ({ Class: r.classes?.name, Subject: r.subjects?.name, Teacher: r.teachers?.full_name || '' }),
    fields: [
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpts, lockOnEdit: true },
      { name: 'subject_id', label: 'Subject', type: 'select', required: true, options: lookup('subjects', 'name'), lockOnEdit: true },
      { name: 'teacher_id', label: 'Teacher', type: 'select', blank: 'Not assigned', options: lookup('teachers', 'full_name'), full: true },
    ],
    async beforeSave(v, row) { if (row) { delete v.class_id; delete v.subject_id; } else v.academic_year_id = (await currentYear())?.id || null; return v; },
  });
}

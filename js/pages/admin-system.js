// Admin: users & permissions, reports, gallery, website messages, audit log, account creation
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { must, lookup, callFunction, logEvent, nameMap } from '../api.js';
import { crudPage } from '../crud.js';
import { ROLE_LABEL } from '../auth.js';
import {
  $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock,
  fmtDate, fmtDateTime, fmtMoney, num, today, formHtml, readForm, resolveFields, exportButtons, wireExports,
} from '../ui.js';

/* ---------------- account creation (also used from People pages) ---------------- */
const genPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return [...r].map((n) => a[n % a.length]).join('');
};
const grantable = (ctx) => [['teacher', 'Teacher'], ['student', 'Student'], ['parent', 'Parent'],
  ...(ctx.profile.role === 'super_admin' ? [['school_admin', 'School Administrator'], ['super_admin', 'Super Administrator']] : [])]
  .map(([value, label]) => ({ value, label }));

export function openCreateAccount(ctx, preset = {}, onDone = () => {}) {
  const link = preset.link;
  const fields = [
    { name: 'full_name', label: 'Full name', required: true, full: true, value: preset.name || '' },
    { name: 'email', label: 'Email (used to sign in)', type: 'email', required: true, value: preset.email || '' },
    { name: 'phone', label: 'Phone', type: 'tel', value: preset.phone || '' },
    { name: 'role', label: 'Role', type: 'select', required: true, options: grantable(ctx), value: preset.role || '', disabled: !!link },
    ...(link ? [] : [{ name: 'link_table', label: 'Link to existing record', type: 'select', blank: 'No link', options: [{ value: 'students', label: 'Student' }, { value: 'teachers', label: 'Teacher' }, { value: 'parents', label: 'Parent' }] },
      { name: 'link_id', label: 'Record', type: 'select', blank: 'Choose a record', options: [] }]),
    { name: 'password', label: 'Temporary password', type: 'text', required: true, minlength: 8, full: true, value: genPassword(), help: 'Share this with the user. They can change it after signing in.' },
  ];
  const m = modal({
    title: 'Create account', html: formHtml(fields, {}),
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ca-save">${icon('key', 16)} Create account</button>`,
  });
  const form = $('form', m.el);
  const roleSel = form.elements.role;
  if (link) { roleSel.value = preset.role; roleSel.disabled = true; }
  const typeSel = form.elements.link_table, recSel = form.elements.link_id;
  if (typeSel) typeSel.onchange = async () => {
    const t = typeSel.value;
    recSel.innerHTML = '<option value="">Choose a record</option>';
    if (!t) return;
    roleSel.value = { students: 'student', teachers: 'teacher', parents: 'parent' }[t];
    try {
      const rows = await must(sb.from(t).select('id,full_name,email,phone').is('profile_id', null).order('full_name').limit(500));
      recSel.innerHTML = '<option value="">Choose a record</option>' + rows.map((r) => `<option value="${r.id}" data-n="${esc(r.full_name)}" data-e="${esc(r.email || '')}" data-p="${esc(r.phone || '')}">${esc(r.full_name)}</option>`).join('');
      if (!rows.length) toast('Every record of that type already has an account', 'info');
    } catch (e) { fail(e); }
  };
  if (recSel) recSel.onchange = () => {
    const o = recSel.selectedOptions[0]; if (!o?.dataset.n) return;
    form.elements.full_name.value = o.dataset.n; if (o.dataset.e) form.elements.email.value = o.dataset.e; if (o.dataset.p) form.elements.phone.value = o.dataset.p;
  };
  $('#ca-save', m.el).onclick = async (e) => {
    const { ok, values } = readForm(form, fields.map((f) => (f.name === 'role' ? { ...f, disabled: false } : f)));
    if (!ok) return;
    const body = { action: 'create_user', email: values.email, password: values.password, full_name: values.full_name, role: link ? preset.role : values.role, phone: values.phone };
    if (link) body.link = link; else if (values.link_table && values.link_id) body.link = { table: values.link_table, id: values.link_id };
    setBusy(e.currentTarget, true, 'Creating');
    try {
      await callFunction('admin-users', body);
      m.body.innerHTML = `<div class="state"><span class="badge ok">Account created</span><h4>${esc(values.full_name)} can now sign in</h4>
        <p>Email: <b>${esc(values.email)}</b><br>Temporary password: <b>${esc(values.password)}</b></p><p class="muted">Copy these details now. The password is not shown again.</p></div>`;
      m.foot.innerHTML = `<button class="btn primary" data-close>Done</button>`;
      onDone();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

/* ---------------- users ---------------- */
const PERMS = [['fees', 'Fees and payments'], ['admissions', 'Admissions'], ['users', 'User accounts'], ['audit', 'Audit logs']];
export function users() {
  return async (view, ctx) => {
    const page = crudPage({
      table: 'profiles', title: 'User accounts', singular: 'account', description: 'Create accounts, assign roles, reset passwords and switch access on or off.',
      select: '*', order: { col: 'created_at', asc: false }, search: ['full_name', 'email'], searchPlaceholder: 'Search name or email',
      canCreate: false, canEdit: false, canDelete: false, exportName: 'User accounts',
      filters: [{ name: 'role', label: 'All roles', options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) },
        { name: 'is_active', label: 'Any status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }],
      columns: [
        { label: 'User', render: (r) => `<b>${esc(r.full_name || '(no name)')}</b><span class="sub">${esc(r.email || '')}</span>` },
        { label: 'Role', render: (r) => badge(ROLE_LABEL[r.role] || r.role, r.role.includes('admin') ? 'info' : 'muted') },
        { label: 'Status', render: (r) => badge(r.is_active ? 'active' : 'inactive') },
        { label: 'Last sign-in', render: (r) => fmtDateTime(r.last_login) },
      ],
      exportMap: (r) => ({ Name: r.full_name, Email: r.email, Role: ROLE_LABEL[r.role], Status: r.is_active ? 'Active' : 'Inactive', 'Last sign-in': r.last_login || '' }),
      headerExtra: `<button class="btn primary" id="mk-user">${icon('plus', 16)} Create account</button>`,
      rowActions: (r) => `<button class="icon-btn" data-act="role" data-id="${r.id}" title="Role and permissions" aria-label="Role and permissions">${icon('shield', 16)}</button>
        <button class="icon-btn" data-act="reset" data-id="${r.id}" title="Reset password" aria-label="Reset password">${icon('key', 16)}</button>
        <button class="icon-btn ${r.is_active ? 'danger' : ''}" data-act="toggle" data-id="${r.id}" title="${r.is_active ? 'Deactivate' : 'Activate'}" aria-label="${r.is_active ? 'Deactivate' : 'Activate'}">${icon(r.is_active ? 'lock' : 'check', 16)}</button>`,
      onMount: (v, { reload }) => { $('#mk-user', v).onclick = () => openCreateAccount(ctx, {}, reload); },
      onAction: async (act, row, { reload }) => {
        const self = row.id === ctx.user.id;
        if (act === 'toggle') {
          if (self) return toast('You cannot deactivate your own account', 'error');
          const ok = await confirmBox({ title: row.is_active ? 'Deactivate account?' : 'Activate account?', message: row.is_active ? `${row.full_name} will be signed out and unable to sign in.` : `${row.full_name} will be able to sign in again.`, confirmText: row.is_active ? 'Deactivate' : 'Activate', danger: row.is_active });
          if (!ok) return;
          try { await callFunction('admin-users', { action: 'set_active', user_id: row.id, active: !row.is_active }); toast(`Account ${row.is_active ? 'deactivated' : 'activated'}`); reload(); } catch (e) { fail(e); }
        }
        if (act === 'reset') {
          const fields = [{ name: 'password', label: 'New temporary password', type: 'text', required: true, minlength: 8, value: genPassword(), full: true, help: 'Share it with the user securely.' }];
          const m = modal({ title: `Reset password for ${row.full_name}`, size: 'sm', html: formHtml(fields), footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rp">Reset password</button>` });
          $('#rp', m.el).onclick = async (e) => {
            const { ok, values } = readForm($('form', m.el), fields); if (!ok) return;
            setBusy(e.currentTarget, true, 'Resetting');
            try { await callFunction('admin-users', { action: 'reset_password', user_id: row.id, password: values.password }); toast('Password reset'); m.close(); } catch (err) { fail(err); setBusy(e.currentTarget, false); }
          };
        }
        if (act === 'role') {
          const canRole = !self && (ctx.profile.role === 'super_admin' || !['super_admin', 'school_admin'].includes(row.role));
          const perms = row.permissions || {};
          const m = modal({
            title: `Role and permissions`, size: 'sm',
            html: `<p class="muted" style="margin-bottom:12px"><b>${esc(row.full_name)}</b> (${esc(row.email || '')})</p>
              ${formHtml([{ name: 'role', label: 'Role', type: 'select', options: grantable(ctx).concat(row.role === 'super_admin' && !grantable(ctx).some((o) => o.value === 'super_admin') ? [{ value: 'super_admin', label: 'Super Administrator' }] : []), disabled: !canRole, full: true }], { role: row.role })}
              ${row.role === 'school_admin' ? `<div class="field full" style="margin-top:14px"><label>Modules this administrator can use</label>${PERMS.map(([k, l]) => `<label class="check"><input type="checkbox" data-perm="${k}" ${perms[k] === false ? '' : 'checked'}><span>${l}</span></label>`).join('')}<small class="help">Super administrators always have full access.</small></div>` : ''}`,
            footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rl">Save</button>`,
          });
          $('#rl', m.el).onclick = async (e) => {
            setBusy(e.currentTarget, true, 'Saving');
            try {
              const role = $('select[name=role]', m.el).value;
              if (canRole && role !== row.role) await callFunction('admin-users', { action: 'set_role', user_id: row.id, role });
              if (row.role === 'school_admin' && role === 'school_admin') {
                const p = {}; $$('[data-perm]', m.el).forEach((c) => { p[c.dataset.perm] = c.checked; });
                await must(sb.from('profiles').update({ permissions: p }).eq('id', row.id));
              }
              toast('Saved'); m.close(); reload();
            } catch (err) { fail(err); setBusy(e.currentTarget, false); }
          };
        }
      },
    });
    const info = `<div class="notice">${icon('info', 18)}<span>Accounts are created by administrators only. New users receive a temporary password and can change it from <b>My profile</b>.</span></div>`;
    await page(view, ctx);
    $('.page-head', view).insertAdjacentHTML('afterend', info);
  };
}

/* ---------------- audit log ---------------- */
export function audit() {
  return crudPage({
    table: 'audit_logs', title: 'Audit logs', singular: 'log', plural: 'audit entries', description: 'Every important change is recorded by the database and cannot be edited.',
    order: { col: 'created_at', asc: false }, pageSize: 25, search: ['user_name', 'entity'], searchPlaceholder: 'Search user or record type',
    canCreate: false, canEdit: false, canDelete: false, exportName: 'Audit log',
    filters: [{ name: 'action', label: 'All actions', options: ['INSERT', 'UPDATE', 'DELETE', 'login'].map((v) => ({ value: v, label: v })) }],
    columns: [
      { label: 'When', render: (r) => fmtDateTime(r.created_at) },
      { label: 'User', render: (r) => esc(r.user_name || 'System') },
      { label: 'Action', render: (r) => badge({ INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' }[r.action] || r.action, { INSERT: 'ok', UPDATE: 'info', DELETE: 'bad' }[r.action] || 'muted') },
      { label: 'Record type', render: (r) => esc(String(r.entity).replace(/_/g, ' ')) },
      { label: 'Details', cls: 'actions', render: (r) => `<button class="icon-btn" data-act="view" data-id="${r.id}" aria-label="View details">${icon('eye', 16)}</button>` },
    ],
    exportMap: (r) => ({ When: r.created_at, User: r.user_name || 'System', Action: r.action, Record: r.entity, 'Record id': r.entity_id || '' }),
    onAction: (act, row) => { if (act === 'view') modal({ title: 'Audit details', size: 'lg', html: `<pre class="json">${esc(JSON.stringify(row.details, null, 2) || 'No details')}</pre>` }); },
  });
}

/* ---------------- website messages ---------------- */
export function messages() {
  return crudPage({
    table: 'contact_messages', title: 'Website messages', singular: 'message', description: 'Messages sent from the contact form on the public website.',
    search: ['name', 'email', 'subject'], canCreate: false, canEdit: false, canDelete: true,
    filters: [{ name: 'is_read', label: 'All messages', options: [{ value: 'false', label: 'Unread' }, { value: 'true', label: 'Read' }] }],
    columns: [
      { label: 'From', render: (r) => `<b>${esc(r.name)}</b><span class="sub">${esc(r.email)}</span>` },
      { label: 'Subject', render: (r) => esc(r.subject || '(no subject)') },
      { label: 'Received', render: (r) => fmtDateTime(r.created_at) },
      { label: 'Status', render: (r) => badge(r.is_read ? 'read' : 'new', r.is_read ? 'muted' : 'warn') },
    ],
    rowActions: (r) => `<button class="icon-btn" data-act="open" data-id="${r.id}" title="Read message" aria-label="Read message">${icon('eye', 16)}</button>`,
    onAction: async (act, row, { reload }) => {
      if (act !== 'open') return;
      modal({ title: row.subject || 'Message', html: `<p class="muted">From <b>${esc(row.name)}</b> (${esc(row.email)}) on ${fmtDateTime(row.created_at)}</p><p style="white-space:pre-wrap;margin-top:12px">${esc(row.message)}</p>` });
      if (!row.is_read) { await sb.from('contact_messages').update({ is_read: true }).eq('id', row.id); reload(); }
    },
  });
}

/* ---------------- gallery ---------------- */
export function gallery() {
  return async (view) => {
    const url = (p) => sb.storage.from('gallery').getPublicUrl(p).data.publicUrl;
    view.innerHTML = `<div class="page-head"><div><h2>Photo gallery</h2><p class="muted">Photos shown in the gallery on the public website. JPG, PNG or WebP, up to 5 MB.</p></div></div>
      <div class="card" style="margin-bottom:16px"><form id="gal-form" class="form-grid" novalidate>
        <div class="field"><label for="g-title">Caption <i class="req">*</i></label><input class="input" id="g-title" name="title" maxlength="120" required placeholder="e.g. Science fair"><small class="err" data-err="title"></small></div>
        <div class="field"><label for="g-file">Photo <i class="req">*</i></label><input class="input" id="g-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required><small class="err" data-err="file"></small></div>
        <div class="field full"><button class="btn primary" id="g-up" type="submit" style="width:fit-content">${icon('upload', 16)} Upload photo</button></div></form></div>
      <div id="gal-list">${loadingBlock()}</div>`;
    const listEl = $('#gal-list', view);
    async function load() {
      const rows = await must(sb.from('gallery_items').select('*').order('created_at', { ascending: false }).limit(200));
      listEl.innerHTML = rows.length ? `<div class="thumb-grid">${rows.map((r) => `<figure class="thumb" style="margin:0"><img src="${esc(url(r.image_path))}" alt="${esc(r.title)}" loading="lazy"><figcaption><span>${esc(r.title)}</span><button class="icon-btn danger" data-del="${r.id}" aria-label="Delete photo">${icon('trash', 16)}</button></figcaption></figure>`).join('')}</div>` : emptyState('No photos yet', 'Upload the first photo using the form above.', 'image');
      listEl.onclick = async (e) => {
        const b = e.target.closest('[data-del]'); if (!b) return;
        const row = rows.find((r) => r.id === b.dataset.del);
        if (!(await confirmBox({ title: 'Delete photo?', message: 'It will disappear from the website.', confirmText: 'Delete', danger: true }))) return;
        try { await sb.storage.from('gallery').remove([row.image_path]); await must(sb.from('gallery_items').delete().eq('id', row.id)); toast('Photo deleted'); load(); } catch (err) { fail(err); }
      };
    }
    $('#gal-form', view).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, title = f.title.value.trim(), file = f.file.files[0];
      $$('[data-err]', f).forEach((x) => (x.textContent = ''));
      if (title.length < 2) return ($('[data-err=title]', f).textContent = 'Enter a caption');
      if (!file) return ($('[data-err=file]', f).textContent = 'Choose a photo');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return ($('[data-err=file]', f).textContent = 'Use a JPG, PNG or WebP image');
      if (file.size > 5 * 1024 * 1024) return ($('[data-err=file]', f).textContent = 'The photo is larger than 5 MB');
      const btn = $('#g-up', view); setBusy(btn, true, 'Uploading');
      try {
        const path = `${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
        const { error } = await sb.storage.from('gallery').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
        if (error) throw error;
        await must(sb.from('gallery_items').insert({ title, image_path: path }));
        f.reset(); toast('Photo uploaded'); load();
      } catch (err) { fail(err); } finally { setBusy(btn, false); }
    };
    await load();
  };
}

/* ---------------- reports ---------------- */
const classOpt = lookup('classes', 'name');
const monthEnd = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth() + 1, 0).toISOString().slice(0, 10); };
const REPORTS = [
  { id: 'students', label: 'Student registration', fields: [{ name: 'class_id', label: 'Class', type: 'select', blank: 'All classes', options: classOpt }, { name: 'status', label: 'Status', type: 'select', blank: 'Any status', options: ['active', 'suspended', 'graduated', 'withdrawn', 'transferred'].map((v) => ({ value: v, label: v })) }],
    async run(v) {
      let q = sb.from('students').select('*, classes(name), parents(full_name,phone)').order('full_name').limit(5000);
      if (v.class_id) q = q.eq('class_id', v.class_id); if (v.status) q = q.eq('status', v.status);
      return (await must(q)).map((s) => ({ 'Student no': s.student_no, Name: s.full_name, Gender: s.gender || '', 'Date of birth': s.date_of_birth || '', Class: s.classes?.name || '', Parent: s.parents?.full_name || '', 'Parent phone': s.parents?.phone || '', Status: s.status, Admitted: s.admitted_on || '' }));
    } },
  { id: 'attendance', label: 'Attendance', fields: [{ name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpt }, { name: 'from', label: 'From', type: 'date', required: true, value: today().slice(0, 8) + '01' }, { name: 'to', label: 'To', type: 'date', required: true, value: today() }],
    async run(v) {
      const [studs, att] = await Promise.all([
        must(sb.from('students').select('id,full_name,student_no').eq('class_id', v.class_id).eq('status', 'active').order('full_name')),
        must(sb.from('attendance').select('student_id,status,attendance_date').eq('class_id', v.class_id).gte('attendance_date', v.from).lte('attendance_date', v.to).limit(20000)),
      ]);
      const days = new Set(att.map((a) => a.attendance_date)).size;
      return studs.map((s) => { const mine = att.filter((a) => a.student_id === s.id); const c = (k) => mine.filter((a) => a.status === k).length;
        return { 'Student no': s.student_no, Name: s.full_name, Present: c('present'), Absent: c('absent'), Late: c('late'), 'School days': days, 'Attendance %': days ? Math.round(((c('present') + c('late')) / days) * 100) : 0 }; });
    } },
  { id: 'exams', label: 'Examination performance', fields: [{ name: 'exam_id', label: 'Examination', type: 'select', required: true, full: true, options: lookup('examinations', 'name', { extra: 'term,classes(name)', format: (r) => `${r.name} - ${r.classes?.name || ''} (${r.term})` }) }],
    async run(v) {
      const exam = await must(sb.from('examinations').select('max_score').eq('id', v.exam_id).single());
      const res = await must(sb.from('exam_results').select('student_id,score,subjects(name),students(full_name,student_no)').eq('exam_id', v.exam_id).limit(10000));
      const by = {};
      res.forEach((r) => { const o = (by[r.student_id] ||= { s: r.students, total: 0, n: 0, subs: {} }); o.total += Number(r.score); o.n++; o.subs[r.subjects?.name] = Number(r.score); });
      const rows = Object.values(by).map((o) => { const avg = (o.total / (o.n * exam.max_score)) * 100; return { 'Student no': o.s?.student_no, Name: o.s?.full_name, ...o.subs, Total: num(o.total, 2), 'Average %': num(avg), Grade: (CONFIG.GRADES.find((g) => avg >= g.min) || {}).grade }; });
      rows.sort((a, b) => Number(b.Total) - Number(a.Total)); rows.forEach((r, i) => { r.Position = i + 1; });
      return rows;
    } },
  { id: 'fees', label: 'Fee collection', fields: [{ name: 'from', label: 'From', type: 'date', required: true, value: today().slice(0, 8) + '01' }, { name: 'to', label: 'To', type: 'date', required: true, value: today() }],
    async run(v) {
      const rows = await must(sb.from('fee_payments').select('*, students(full_name,student_no,classes(name)), school_fees(name)').gte('paid_on', v.from).lte('paid_on', v.to).order('paid_on', { ascending: false }).limit(10000));
      const out = rows.map((p) => ({ Receipt: p.receipt_no, Date: p.paid_on, Student: p.students?.full_name, Class: p.students?.classes?.name || '', Fee: p.school_fees?.name || 'General', Method: p.method, Amount: Number(p.amount) }));
      if (out.length) out.push({ Receipt: 'TOTAL', Date: '', Student: '', Class: '', Fee: '', Method: '', Amount: out.reduce((a, r) => a + r.Amount, 0) });
      return out;
    } },
  { id: 'outstanding', label: 'Outstanding payments', fields: [{ name: 'class_id', label: 'Class', type: 'select', blank: 'All classes', options: classOpt }],
    async run(v) {
      let q = sb.from('student_fee_balances').select('*').gt('balance', 0).order('balance', { ascending: false }).limit(1000);
      if (v.class_id) q = q.eq('class_id', v.class_id);
      const [rows, cm, pr] = await Promise.all([must(q), nameMap('classes', 'name'), must(sb.from('parents').select('id,full_name,phone').limit(1000))]);
      const pm = Object.fromEntries(pr.map((p) => [p.id, p]));
      return rows.map((b) => ({ 'Student no': b.student_no, Name: b.full_name, Class: cm[b.class_id] || '', Parent: pm[b.parent_id]?.full_name || '', 'Parent phone': pm[b.parent_id]?.phone || '', 'Total fees': Number(b.total_fees), Paid: Number(b.total_paid), Outstanding: Number(b.balance) }));
    } },
  { id: 'teachers', label: 'Teacher report', fields: [{ name: 'status', label: 'Status', type: 'select', blank: 'Any status', options: ['active', 'on_leave', 'resigned'].map((v) => ({ value: v, label: v.replace('_', ' ') })) }],
    async run(v) {
      let q = sb.from('teachers').select('*, teacher_assignments(classes(name), subjects(name))').order('full_name').limit(2000);
      if (v.status) q = q.eq('status', v.status);
      return (await must(q)).map((t) => ({ 'Staff no': t.staff_no, Name: t.full_name, 'Job title': t.job_title || '', Qualification: t.qualification || '', Phone: t.phone || '', Email: t.email || '', Status: t.status, Hired: t.hire_date || '', Classes: [...new Set(t.teacher_assignments.map((a) => a.classes?.name))].filter(Boolean).join(', '), Subjects: [...new Set(t.teacher_assignments.map((a) => a.subjects?.name))].filter(Boolean).join(', ') }));
    } },
  { id: 'admissions', label: 'Admissions', fields: [{ name: 'status', label: 'Status', type: 'select', blank: 'Any status', options: ['pending', 'reviewing', 'accepted', 'rejected', 'enrolled'].map((v) => ({ value: v, label: v })) }, { name: 'from', label: 'From', type: 'date' }, { name: 'to', label: 'To', type: 'date' }],
    async run(v) {
      let q = sb.from('admission_applications').select('*').order('created_at', { ascending: false }).limit(5000);
      if (v.status) q = q.eq('status', v.status); if (v.from) q = q.gte('created_at', v.from); if (v.to) q = q.lte('created_at', v.to + 'T23:59:59');
      return (await must(q)).map((a) => ({ Reference: a.reference, Date: a.created_at.slice(0, 10), Applicant: a.applicant_name, Level: a.grade_applying, Parent: a.parent_name, Phone: a.parent_phone, Email: a.parent_email || '', Status: a.status }));
    } },
];

export function reports(ctx) {
  const allowed = REPORTS.filter((r) => !['fees', 'outstanding'].includes(r.id) || ctx.profile.role === 'super_admin' || ctx.profile.permissions?.fees !== false);
  return async (view) => {
    view.innerHTML = `<div class="page-head"><div><h2>Reports</h2><p class="muted">Generate a report, then download it as Excel or PDF.</p></div></div>
      <div class="tabs" id="rp-tabs">${allowed.map((r, i) => `<button class="tab ${i ? '' : 'active'}" data-id="${r.id}">${esc(r.label)}</button>`).join('')}</div>
      <div class="card" id="rp-filters"></div><div class="card flush" style="margin-top:16px" id="rp-out"></div>`;
    let cur, fields, data = [];
    async function pick(id) {
      cur = allowed.find((r) => r.id === id);
      $$('#rp-tabs .tab', view).forEach((t) => t.classList.toggle('active', t.dataset.id === id));
      fields = await resolveFields(cur.fields);
      $('#rp-filters', view).innerHTML = `${formHtml(fields)}<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="rp-go">${icon('chart', 16)} Generate report</button><span id="rp-ex" hidden>${exportButtons()}</span></div>`;
      $('#rp-out', view).innerHTML = emptyState('No report yet', 'Choose your filters and press Generate report.', 'chart');
      $('#rp-ex', view).hidden = true;
      wireExports($('#rp-filters', view), cur.label, async () => data);
      $('#rp-go', view).onclick = async (e) => {
        const { ok, values } = readForm($('form', $('#rp-filters', view)), fields); if (!ok) return;
        setBusy(e.currentTarget, true, 'Generating');
        $('#rp-out', view).innerHTML = loadingBlock();
        try {
          data = await cur.run(values);
          const keys = data.length ? [...new Set(data.flatMap((r) => Object.keys(r)))] : [];
          $('#rp-out', view).innerHTML = data.length
            ? `<div class="pad"><b>${esc(cur.label)}</b> <span class="muted">| ${data.length} row${data.length === 1 ? '' : 's'} | ${fmtDateTime(new Date())}</span></div>` + tableHtml({ columns: keys.map((k) => ({ label: k, cls: typeof data.find((r) => r[k] !== undefined)?.[k] === 'number' ? 'num' : '', render: (r) => (typeof r[k] === 'number' && /amount|fees|paid|outstanding/i.test(k) ? fmtMoney(r[k]) : esc(r[k] ?? '')) })), rows: data })
            : emptyState('No data for these filters', 'Try a wider date range or different filters.', 'inbox');
          $('#rp-ex', view).hidden = !data.length;
          logEvent('report', cur.id, { rows: data.length });
        } catch (err) { fail(err); $('#rp-out', view).innerHTML = emptyState('Report failed', 'Check your filters and try again.', 'alert'); } finally { setBusy(e.currentTarget, false); }
      };
    }
    $('#rp-tabs', view).onclick = (e) => { const t = e.target.closest('.tab'); if (t) pick(t.dataset.id); };
    await pick(allowed[0].id);
  };
}

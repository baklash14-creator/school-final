// Admin: attendance, examinations, scores, fees, announcements, admissions
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { must, lookup, currentYear, notifyUsers, profileIdsByRole, nameMap, guardianProfiles } from '../api.js';
import { crudPage } from '../crud.js';
import { attendanceTaker, scoreEntry, loadReportCard, reportCardHtml, showPrintable, receiptHtml } from './shared.js';
import {
  $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock,
  fmtDate, fmtDateTime, fmtMoney, num, today, formHtml, readForm, exportButtons, wireExports, pad, gradeFor,
} from '../ui.js';

const classOpts = lookup('classes', 'name');
const yearOpts = lookup('academic_years', 'name', { order: 'start_date' });
const studentOpts = lookup('students', 'full_name', { extra: 'student_no', format: (r) => `${r.full_name} (${r.student_no})` });

/* =========================================================
   ATTENDANCE: take + monthly report
   ========================================================= */
export function attendance() {
  return async (view, ctx) => {
    view.innerHTML = `<div class="tabs" id="at-tabs"><button class="tab active" data-t="take">Take attendance</button><button class="tab" data-t="report">Monthly report</button></div><div id="at-pane"></div>`;
    const pane = $('#at-pane', view);
    const show = async (t) => {
      $$('#at-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { t === 'take' ? await attendanceTaker(pane, ctx, { classOptions: classOpts }) : await monthlyReport(pane); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#at-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('take');
  };
}

async function monthlyReport(pane) {
  const classes = await classOpts();
  if (!classes.length) { pane.innerHTML = emptyState('No classes yet', 'Create a class first.', 'class'); return; }
  const now = new Date();
  pane.innerHTML = `<div class="page-head"><div><h2>Monthly attendance report</h2><p class="muted">Days present, absent and late for every student in a class.</p></div><div class="head-actions">${exportButtons()}</div></div>
    <div class="toolbar"><select id="mr-class" class="input sm" aria-label="Class">${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>
    <input id="mr-month" type="month" class="input sm" value="${now.getFullYear()}-${pad(now.getMonth() + 1)}" aria-label="Month"></div>
    <div class="card flush" id="mr-out">${loadingBlock()}</div>`;
  let rows = [];
  async function load() {
    const out = $('#mr-out', pane); out.innerHTML = loadingBlock();
    try {
      const cid = $('#mr-class', pane).value, month = $('#mr-month', pane).value;
      const [y, m] = month.split('-').map(Number);
      const from = `${y}-${pad(m)}-01`, to = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
      const [studs, att] = await Promise.all([
        must(sb.from('students').select('id,full_name,student_no').eq('class_id', cid).eq('status', 'active').order('full_name')),
        must(sb.from('attendance').select('student_id,status,attendance_date').eq('class_id', cid).gte('attendance_date', from).lte('attendance_date', to).limit(10000)),
      ]);
      const days = new Set(att.map((a) => a.attendance_date)).size;
      rows = studs.map((s) => { const mine = att.filter((a) => a.student_id === s.id); const c = (k) => mine.filter((a) => a.status === k).length;
        return { 'Student no': s.student_no, Name: s.full_name, Present: c('present'), Absent: c('absent'), Late: c('late'), 'School days': days, 'Attendance %': days ? Math.round(((c('present') + c('late')) / days) * 100) : 0 }; });
      out.innerHTML = tableHtml({ columns: Object.keys(rows[0] || { Name: 1 }).map((k) => ({ label: k, cls: typeof rows[0]?.[k] === 'number' ? 'num' : '', render: (r) => (k === 'Attendance %' ? `<span class="badge ${r[k] >= 90 ? 'ok' : r[k] >= 75 ? 'warn' : 'bad'}">${r[k]}%</span>` : esc(r[k])) })), rows, empty: 'No students in this class', emptyText: days ? '' : 'No attendance has been recorded for this month.' });
      if (rows.length && !days) out.insertAdjacentHTML('afterbegin', `<div class="notice" style="margin:12px">${icon('info', 18)}<span>No attendance was recorded in this month yet.</span></div>`);
    } catch (e) { out.innerHTML = errorBlock(e); }
  }
  $('#mr-class', pane).onchange = load; $('#mr-month', pane).onchange = load;
  wireExports(pane, 'Monthly attendance', async () => rows);
  await load();
}

/* =========================================================
   EXAMINATIONS
   ========================================================= */
async function familyIds(classId) {
  const rows = await must(sb.from('students').select('id').eq('class_id', classId).eq('status', 'active').limit(2000));
  const map = Object.values(await guardianProfiles(rows.map((r) => r.id)));
  return { students: map.map((m) => m.student).filter(Boolean), parents: [...new Set(map.flatMap((m) => m.parents))] };
}

export function exams() {
  return crudPage({
    table: 'examinations', title: 'Examinations', singular: 'examination', description: 'Create examinations per class, enter scores, then publish results to students and parents.',
    select: '*, classes(name), academic_years(name)', search: ['name'], order: { col: 'created_at', asc: false }, exportName: 'Examinations',
    filters: [{ name: 'class_id', label: 'All classes', options: classOpts }],
    columns: [
      { label: 'Examination', render: (r) => `<b>${esc(r.name)}</b><span class="sub">${esc(r.term)} | ${esc(r.academic_years?.name || '')}</span>` },
      { label: 'Class', render: (r) => esc(r.classes?.name) },
      { label: 'Dates', render: (r) => (r.start_date ? `${fmtDate(r.start_date)}${r.end_date ? ' to ' + fmtDate(r.end_date) : ''}` : '-') },
      { label: 'Max score', cls: 'num', render: (r) => num(r.max_score) },
      { label: 'Results', render: (r) => badge(r.is_published ? 'published' : 'draft') },
    ],
    exportMap: (r) => ({ Examination: r.name, Class: r.classes?.name, Term: r.term, 'Max score': r.max_score, Published: r.is_published ? 'Yes' : 'No' }),
    fields: [
      { name: 'name', label: 'Examination name', required: true, full: true, placeholder: 'e.g. End of term examination' },
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpts },
      { name: 'term', label: 'Term', type: 'select', required: true, options: ['Term 1', 'Term 2', 'Term 3'].map((v) => ({ value: v, label: v })) },
      { name: 'academic_year_id', label: 'Academic year', type: 'select', options: yearOpts },
      { name: 'max_score', label: 'Maximum score per subject', type: 'number', required: true, min: 1, max: 1000, value: 100 },
      { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'end_date', label: 'End date', type: 'date' },
    ],
    defaults: async () => ({ term: 'Term 1', max_score: 100, academic_year_id: (await currentYear())?.id || '' }),
    beforeSave(v) { if (v.start_date && v.end_date && v.end_date < v.start_date) throw new Error('The end date cannot be before the start date.'); return v; },
    rowActions: (r) => `<button class="icon-btn" data-act="cards" data-id="${r.id}" title="Report cards" aria-label="Report cards">${icon('file', 16)}</button>
      <button class="icon-btn ${r.is_published ? '' : 'ok'}" data-act="publish" data-id="${r.id}" title="${r.is_published ? 'Unpublish results' : 'Publish results'}" aria-label="${r.is_published ? 'Unpublish results' : 'Publish results'}">${icon(r.is_published ? 'eye' : 'send', 16)}</button>`,
    deleteMessage: (r) => `${r.name} and all of its scores will be permanently deleted.`,
    onAction: async (act, row, { reload }) => {
      if (act === 'cards') return classCards(row);
      if (act === 'publish') {
        try {
          if (!row.is_published) {
            const { count } = await sb.from('exam_results').select('id', { count: 'exact', head: true }).eq('exam_id', row.id);
            if (!count) return toast('There are no scores for this examination yet. Enter scores first.', 'error');
            if (!(await confirmBox({ title: 'Publish results?', message: `${count} scores will become visible to the students and parents of ${row.classes?.name}. Teachers will no longer be able to edit them.`, confirmText: 'Publish' }))) return;
            await must(sb.from('examinations').update({ is_published: true }).eq('id', row.id));
            const f = await familyIds(row.class_id);
            await notifyUsers(f.students, { title: 'Results published', body: `${row.name} results are now available.`, type: 'results', link: 'student.html#/results' });
            await notifyUsers(f.parents, { title: 'Results published', body: `${row.name} results for your child are now available.`, type: 'results', link: 'parent.html#/results' });
            toast('Results published and families notified');
          } else {
            if (!(await confirmBox({ title: 'Unpublish results?', message: 'Students and parents will no longer see these results.', confirmText: 'Unpublish', danger: true }))) return;
            await must(sb.from('examinations').update({ is_published: false }).eq('id', row.id));
            toast('Results unpublished');
          }
          reload();
        } catch (e) { fail(e); }
      }
    },
  });
}

async function classCards(exam) {
  const m = modal({ title: `Report cards: ${exam.name}`, size: 'xl', html: loadingBlock(), footer: `<button class="btn ghost" data-close>Close</button><button class="btn primary" id="rc-print" disabled>${icon('printer', 16)} Print all / Save as PDF</button>` });
  try {
    const [studs, res, yearName] = await Promise.all([
      must(sb.from('students').select('id,full_name,student_no').eq('class_id', exam.class_id).eq('status', 'active').order('full_name').limit(500)),
      must(sb.from('exam_results').select('student_id,score,grade,remarks,subjects(name)').eq('exam_id', exam.id).limit(10000)),
      Promise.resolve(exam.academic_years?.name),
    ]);
    const totals = {}; res.forEach((r) => { totals[r.student_id] = (totals[r.student_id] || 0) + Number(r.score); });
    const sorted = Object.values(totals).sort((a, b) => b - a);
    const cards = studs.map((s) => {
      const rows = res.filter((r) => r.student_id === s.id).map((r) => ({ subject: r.subjects?.name, score: r.score, max: exam.max_score, grade: r.grade, remarks: r.remarks })).sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
      return rows.length ? reportCardHtml({ student: s, className: exam.classes?.name, exam, yearName, rows, rank: sorted.indexOf(totals[s.id]) + 1, classSize: sorted.length }).replace('paper print-area', 'paper') : '';
    }).filter(Boolean);
    if (!cards.length) { m.body.innerHTML = emptyState('No scores entered yet', 'Enter scores for this examination to generate report cards.', 'file'); return; }
    m.body.innerHTML = `<div class="notice">${icon('info', 18)}<span>${cards.length} report card${cards.length === 1 ? '' : 's'} ready. Positions are ranked by total score.</span></div><div class="print-area" style="display:grid;gap:16px">${cards.join('')}</div>`;
    const p = $('#rc-print', m.el); p.disabled = false; p.onclick = () => window.print();
  } catch (e) { m.body.innerHTML = errorBlock(e); }
}

export const scores = () => (view, ctx) => scoreEntry(view, ctx, { isAdmin: true });

/* =========================================================
   FEES
   ========================================================= */
export function fees() {
  return async (view, ctx) => {
    const tabs = [['structure', 'Fee structure'], ['payments', 'Payments'], ['claims', 'Payment claims'], ['outstanding', 'Outstanding'], ['report', 'Financial report']];
    view.innerHTML = `<div class="tabs" id="fee-tabs">${tabs.map(([id, l], i) => `<button class="tab ${i ? '' : 'active'}" data-t="${id}">${l}</button>`).join('')}</div><div id="fee-pane"></div>`;
    const pane = $('#fee-pane', view);
    const show = async (t) => {
      $$('#fee-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await ({ structure: feeStructure, payments: payments, claims: claims, outstanding: outstanding, report: financeReport }[t])(pane, ctx); } catch (e) { pane.innerHTML = errorBlock(e); $('[data-retry]', pane)?.addEventListener('click', () => show(t)); }
    };
    $('#fee-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('structure');
  };
}

const feeStructure = crudPage({
  table: 'school_fees', title: 'Fee structure', singular: 'fee', plural: 'fees', description: 'Set the fees each class pays per term.',
  select: '*, classes(name), academic_years(name)', search: ['name'], order: { col: 'created_at', asc: false }, exportName: 'Fee structure',
  filters: [{ name: 'class_id', label: 'All classes', options: classOpts }],
  columns: [
    { label: 'Fee', render: (r) => `<b>${esc(r.name)}</b><span class="sub">${esc(r.term)}</span>` }, { label: 'Class', render: (r) => esc(r.classes?.name) },
    { label: 'Year', render: (r) => esc(r.academic_years?.name || '-') }, { label: 'Due date', render: (r) => fmtDate(r.due_date) },
    { label: 'Amount', cls: 'num', render: (r) => `<b>${fmtMoney(r.amount)}</b>` },
  ],
  exportMap: (r) => ({ Fee: r.name, Class: r.classes?.name, Term: r.term, Amount: Number(r.amount), 'Due date': r.due_date || '' }),
  fields: [
    { name: 'name', label: 'Fee name', required: true, placeholder: 'e.g. Tuition', full: true },
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOpts },
    { name: 'term', label: 'Term', type: 'select', required: true, options: ['Term 1', 'Term 2', 'Term 3', 'Full year'].map((v) => ({ value: v, label: v })) },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: yearOpts },
    { name: 'amount', label: 'Amount', type: 'number', required: true, min: 0, step: '0.01' },
    { name: 'due_date', label: 'Due date', type: 'date' },
  ],
  defaults: async () => ({ term: 'Term 1', academic_year_id: (await currentYear())?.id || '' }),
});

const payments = crudPage({
  table: 'fee_payments', title: 'Payments', singular: 'payment', description: 'Record payments and print receipts. A receipt number is generated automatically.',
  select: '*, students(full_name,student_no,classes(name)), school_fees(name,term)', search: ['receipt_no', 'reference'], searchPlaceholder: 'Search receipt number or reference',
  order: { col: 'created_at', asc: false }, exportName: 'Payments', createLabel: 'Record payment',
  filters: [{ name: 'method', label: 'All methods', options: ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque'].map((v) => ({ value: v, label: v.replace('_', ' ') })) }],
  columns: [
    { label: 'Receipt', render: (r) => `<b>${esc(r.receipt_no)}</b><span class="sub">${fmtDate(r.paid_on)}</span>` },
    { label: 'Student', render: (r) => `${esc(r.students?.full_name)}<span class="sub">${esc(r.students?.classes?.name || '')}</span>` },
    { label: 'For', render: (r) => esc(r.school_fees ? `${r.school_fees.name} (${r.school_fees.term})` : 'General payment') },
    { label: 'Method', render: (r) => esc(r.method.replace('_', ' ')) }, { label: 'Amount', cls: 'num', render: (r) => `<b>${fmtMoney(r.amount)}</b>` },
  ],
  exportMap: (r) => ({ Receipt: r.receipt_no, Date: r.paid_on, Student: r.students?.full_name, Class: r.students?.classes?.name || '', Fee: r.school_fees?.name || 'General', Method: r.method, Amount: Number(r.amount), Reference: r.reference || '' }),
  fields: [
    { name: 'student_id', label: 'Student', type: 'select', required: true, options: studentOpts, full: true, lockOnEdit: true },
    { name: 'fee_id', label: 'Fee being paid', type: 'select', blank: 'General payment', options: lookup('school_fees', 'name', { extra: 'term,classes(name)', format: (r) => `${r.name} - ${r.classes?.name || ''} (${r.term})` }), full: true },
    { name: 'amount', label: 'Amount paid', type: 'number', required: true, min: 0.01, step: '0.01' },
    { name: 'method', label: 'Payment method', type: 'select', required: true, options: ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
    { name: 'paid_on', label: 'Date paid', type: 'date', required: true, max: today() },
    { name: 'reference', label: 'Reference / transaction ID' },
    { name: 'note', label: 'Note', type: 'textarea', rows: 2, full: true },
  ],
  defaults: () => ({ method: 'cash', paid_on: today() }),
  beforeSave: (v, row, isNew, ctx) => { if (isNew) v.recorded_by = ctx.user.id; if (row) delete v.student_id; return v; },
  async afterSave(p, row, isNew) {
    if (!isNew) return;
    const s = await must(sb.from('students').select('id,full_name,student_no,profile_id,classes(name)').eq('id', p.student_id).single());
    const fam = (await guardianProfiles([p.student_id]))[p.student_id] || { parents: [] };
    const bal = await must(sb.from('student_fee_balances').select('balance').eq('student_id', p.student_id).maybeSingle());
    await notifyUsers(fam.parents, { title: 'Payment received', body: `${fmtMoney(p.amount)} received for ${s.full_name}. Receipt ${p.receipt_no}.`, type: 'fees', link: 'parent.html#/fees' });
    await notifyUsers([s.profile_id].filter(Boolean), { title: 'Payment received', body: `${fmtMoney(p.amount)} received. Receipt ${p.receipt_no}.`, type: 'fees', link: 'student.html#/fees' });
    showPrintable('Payment receipt', receiptHtml(p, s, s.classes?.name, bal?.balance));
  },
  deletable: (r, ctx) => ctx.profile.role === 'super_admin',
  rowActions: (r) => `<button class="icon-btn" data-act="receipt" data-id="${r.id}" title="Receipt" aria-label="Receipt">${icon('receipt', 16)}</button>`,
  deleteMessage: (r) => `Receipt ${r.receipt_no} will be deleted and the student's balance will increase. Only a super administrator can do this.`,
  onAction: async (act, row) => {
    if (act !== 'receipt') return;
    const bal = await must(sb.from('student_fee_balances').select('balance').eq('student_id', row.student_id).maybeSingle());
    showPrintable('Payment receipt', receiptHtml(row, row.students, row.students?.classes?.name, bal?.balance));
  },
});

async function claims(pane, ctx) {
  pane.innerHTML = `<div class="page-head"><div><h2>Payment claims</h2><p class="muted">Payments that parents say they made by mobile money or bank. Check the reference against your statement, then approve to record the payment and issue a receipt.</p></div></div>
    <div class="toolbar"><select id="cl-st" class="input sm" aria-label="Status"><option value="pending">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select></div>
    <div class="card flush" id="cl-out">${loadingBlock()}</div>`;
  let rows = [];
  async function load() {
    const out = $('#cl-out', pane); out.innerHTML = loadingBlock();
    try {
      let q = sb.from('payment_claims').select('*, students(full_name,student_no,profile_id,classes(name)), school_fees(name,term)').order('created_at', { ascending: false }).limit(200);
      const st = $('#cl-st', pane).value; if (st) q = q.eq('status', st);
      rows = await must(q);
      const links = {};
      await Promise.all(rows.filter((r) => r.proof_path).map(async (r) => { const { data } = await sb.storage.from('payment-proofs').createSignedUrl(r.proof_path, 600); links[r.id] = data?.signedUrl; }));
      out.innerHTML = tableHtml({ columns: [
        { label: 'Student', render: (r) => `<b>${esc(r.students?.full_name)}</b><span class="sub">${esc(r.students?.classes?.name || '')} | ${fmtDateTime(r.created_at)}</span>` },
        { label: 'Reference', render: (r) => `<b>${esc(r.reference)}</b><span class="sub">${esc(r.method.replace('_', ' '))} | paid ${fmtDate(r.paid_on)}</span>${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}` },
        { label: 'For', render: (r) => esc(r.school_fees ? `${r.school_fees.name} (${r.school_fees.term})` : 'General payment') },
        { label: 'Amount', cls: 'num', render: (r) => `<b>${fmtMoney(r.amount)}</b>` },
        { label: 'Proof', render: (r) => (links[r.id] ? `<a href="${esc(links[r.id])}" target="_blank" rel="noopener">${icon('download', 14)} Open</a>` : '-') },
        { label: 'Status', render: (r) => badge(r.status, r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn') + (r.review_note ? `<span class="sub">${esc(r.review_note)}</span>` : '') },
        { label: '', cls: 'actions', render: (r) => (r.status === 'pending' ? `<div class="row-actions"><button class="btn primary sm" data-ok="${r.id}">Approve</button><button class="btn ghost sm" data-no="${r.id}">Reject</button></div>` : '') }],
        rows, empty: 'No claims here', emptyText: 'When a parent reports a payment it will appear here.' });
    } catch (e) { out.innerHTML = errorBlock(e); }
  }
  const tellSubmitter = async (claim, title, body) => {
    if (!claim.submitted_by) return;
    const p = await must(sb.from('profiles').select('role').eq('id', claim.submitted_by).maybeSingle());
    await notifyUsers([claim.submitted_by], { title, body, type: 'fees', link: `${p?.role === 'student' ? 'student' : 'parent'}.html#/fees` });
  };
  $('#cl-st', pane).onchange = load;
  $('#cl-out', pane).onclick = async (e) => {
    const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
    if (ok) {
      const c = rows.find((r) => r.id === ok.dataset.ok);
      if (!(await confirmBox({ title: 'Approve this payment?', message: `${fmtMoney(c.amount)} for ${c.students?.full_name} (reference ${c.reference}) will be recorded and a receipt issued. Only approve after checking the reference in your bank or mobile money statement.`, confirmText: 'Approve and record' }))) return;
      setBusy(ok, true);
      try {
        const dupe = await must(sb.from('fee_payments').select('id').eq('reference', c.reference).limit(1));
        if (dupe.length && !(await confirmBox({ title: 'Same reference already recorded', message: 'A payment with this reference exists already. Record it again anyway?', confirmText: 'Record again', danger: true }))) { setBusy(ok, false); return; }
        const pay = await must(sb.from('fee_payments').insert({ student_id: c.student_id, fee_id: c.fee_id, amount: c.amount, method: c.method, reference: c.reference, paid_on: c.paid_on, note: 'Reported by family and verified', recorded_by: ctx.user.id }).select().single());
        await must(sb.from('payment_claims').update({ status: 'approved', reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString(), payment_id: pay.id }).eq('id', c.id).select('id'));
        await tellSubmitter(c, 'Payment confirmed', `Your payment of ${fmtMoney(c.amount)} (reference ${c.reference}) was confirmed. Receipt ${pay.receipt_no}.`);
        const bal = await must(sb.from('student_fee_balances').select('balance').eq('student_id', c.student_id).maybeSingle());
        toast('Payment recorded'); await load();
        showPrintable('Payment receipt', receiptHtml(pay, c.students, c.students?.classes?.name, bal?.balance));
      } catch (err) { fail(err); setBusy(ok, false); }
    }
    if (no) {
      const c = rows.find((r) => r.id === no.dataset.no);
      const m = modal({ title: 'Reject this claim', size: 'sm', html: `<div class="field"><label for="rj">Reason (the parent will see this)</label><textarea id="rj" class="input" rows="3" maxlength="300" placeholder="e.g. We could not find this reference in our statement"></textarea></div>`, footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rj-go">Reject claim</button>` });
      $('#rj-go', m.el).onclick = async (ev) => {
        const reason = $('#rj', m.el).value.trim(); if (!reason) return toast('Please give a reason', 'error');
        setBusy(ev.currentTarget, true, 'Saving');
        try {
          await must(sb.from('payment_claims').update({ status: 'rejected', reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString(), review_note: reason }).eq('id', c.id).select('id'));
          await tellSubmitter(c, 'Payment could not be confirmed', `Reference ${c.reference}: ${reason}`);
          m.close(); toast('Claim rejected'); load();
        } catch (err) { fail(err); setBusy(ev.currentTarget, false); }
      };
    }
  };
  await load();
}

async function outstanding(pane) {
  const classes = await classOpts();
  pane.innerHTML = `<div class="page-head"><div><h2>Outstanding balances</h2><p class="muted">Students who still owe fees. Send a reminder to their parents.</p></div>
    <div class="head-actions">${exportButtons()}<button class="btn primary" id="ob-all">${icon('send', 16)} Remind all listed</button></div></div>
    <div class="toolbar"><select id="ob-class" class="input sm" aria-label="Class"><option value="">All classes</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>
    <div class="card flush" id="ob-out">${loadingBlock()}</div>`;
  let rows = [];
  async function load() {
    const out = $('#ob-out', pane); out.innerHTML = loadingBlock();
    try {
      let q = sb.from('student_fee_balances').select('*').gt('balance', 0).order('balance', { ascending: false }).limit(1000);
      const cid = $('#ob-class', pane).value; if (cid) q = q.eq('class_id', cid);
      rows = await must(q);
      const [cm, pm] = await Promise.all([nameMap('classes', 'name'), nameMap('parents', 'full_name')]);
      rows.forEach((r) => { r.className = cm[r.class_id] || '-'; r.parentName = pm[r.parent_id] || '-'; });
      const total = rows.reduce((a, r) => a + Number(r.balance), 0);
      out.innerHTML = (rows.length ? `<div class="pad"><b>${rows.length}</b> students owe <b>${fmtMoney(total)}</b> in total.</div>` : '') + tableHtml({
        columns: [{ label: 'Student', render: (r) => `<b>${esc(r.full_name)}</b><span class="sub">${esc(r.student_no)}</span>` }, { label: 'Class', render: (r) => esc(r.className) }, { label: 'Parent', render: (r) => esc(r.parentName) },
          { label: 'Billed', cls: 'num', render: (r) => fmtMoney(r.total_fees) }, { label: 'Paid', cls: 'num', render: (r) => fmtMoney(r.total_paid) }, { label: 'Balance', cls: 'num', render: (r) => `<b style="color:var(--bad)">${fmtMoney(r.balance)}</b>` },
          { label: '', cls: 'actions', render: (r) => `<button class="btn ghost sm" data-remind="${r.student_id}">${icon('bell', 14)} Remind</button>` }],
        rows, empty: 'Nobody owes fees', emptyText: 'Every student in this selection is fully paid.',
      });
    } catch (e) { out.innerHTML = errorBlock(e); }
  }
  async function remind(list) {
    const ids = list.map((r) => r.student_id);
    const by = await guardianProfiles(ids);
    let n = 0;
    for (const r of list) {
      const s = by[r.student_id]; const text = `${r.full_name} has an outstanding fee balance of ${fmtMoney(r.balance)}. Please settle it as soon as possible.`;
      n += await notifyUsers(s?.parents || [], { title: 'Fee reminder', body: text, type: 'fees', link: 'parent.html#/fees' });
      await notifyUsers([s?.student].filter(Boolean), { title: 'Fee reminder', body: text, type: 'fees', link: 'student.html#/fees' });
    }
    toast(n ? `Reminder sent to ${n} parent${n === 1 ? '' : 's'}` : 'No parent accounts are linked to these students', n ? 'success' : 'info');
  }
  $('#ob-class', pane).onchange = load;
  $('#ob-out', pane).onclick = async (e) => { const b = e.target.closest('[data-remind]'); if (!b) return; setBusy(b, true); try { await remind(rows.filter((r) => r.student_id === b.dataset.remind)); } catch (err) { fail(err); } finally { setBusy(b, false); } };
  $('#ob-all', pane).onclick = async (e) => {
    if (!rows.length) return toast('There is nobody to remind', 'info');
    if (!(await confirmBox({ title: 'Send reminders?', message: `A fee reminder will be sent to the parents of ${rows.length} students.`, confirmText: 'Send reminders' }))) return;
    setBusy(e.currentTarget, true, 'Sending'); try { await remind(rows); } catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
  wireExports(pane, 'Outstanding fees', async () => rows.map((r) => ({ 'Student no': r.student_no, Name: r.full_name, Class: r.className, Parent: r.parentName, Billed: Number(r.total_fees), Paid: Number(r.total_paid), Balance: Number(r.balance) })));
  await load();
}

async function financeReport(pane) {
  const [bal, pays, cm] = await Promise.all([
    must(sb.from('student_fee_balances').select('class_id,total_fees,total_paid,balance').limit(1000)),
    must(sb.from('fee_payments').select('amount,paid_on').order('paid_on', { ascending: false }).limit(1000)),
    nameMap('classes', 'name'),
  ]);
  const billed = bal.reduce((a, b) => a + Number(b.total_fees), 0), paid = bal.reduce((a, b) => a + Number(b.total_paid), 0);
  const owed = bal.reduce((a, b) => a + Math.max(0, Number(b.balance)), 0), rate = billed ? Math.round((paid / billed) * 100) : 0;
  const byClass = {}; bal.forEach((b) => { const o = (byClass[b.class_id] ||= { Class: cm[b.class_id] || 'No class', Billed: 0, Collected: 0, Outstanding: 0 }); o.Billed += Number(b.total_fees); o.Collected += Number(b.total_paid); o.Outstanding += Math.max(0, Number(b.balance)); });
  const classRows = Object.values(byClass).sort((a, b) => b.Outstanding - a.Outstanding);
  const byMonth = {}; pays.forEach((p) => { const k = p.paid_on.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + Number(p.amount); });
  const monthRows = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([k, v]) => ({ Month: k, Collected: v }));
  const max = Math.max(1, ...monthRows.map((m) => m.Collected));
  pane.innerHTML = `<div class="page-head"><div><h2>Financial report</h2><p class="muted">Billing, collections and balances across the school.</p></div><div class="head-actions">${exportButtons()}</div></div>
    <div class="stats"><div class="stat"><span class="ico">${icon('wallet')}</span><div><b>${fmtMoney(billed)}</b><span>Total billed</span></div></div>
      <div class="stat ok"><span class="ico">${icon('check')}</span><div><b>${fmtMoney(paid)}</b><span>Collected</span></div></div>
      <div class="stat bad"><span class="ico">${icon('alert')}</span><div><b>${fmtMoney(owed)}</b><span>Outstanding</span></div></div>
      <div class="stat gold"><span class="ico">${icon('chart')}</span><div><b>${rate}%</b><span>Collection rate</span></div></div></div>
    <div class="grid cols-2"><div class="card flush"><div class="pad"><h3>By class</h3></div>${tableHtml({ columns: [{ label: 'Class', render: (r) => esc(r.Class) }, { label: 'Billed', cls: 'num', render: (r) => fmtMoney(r.Billed) }, { label: 'Collected', cls: 'num', render: (r) => fmtMoney(r.Collected) }, { label: 'Outstanding', cls: 'num', render: (r) => fmtMoney(r.Outstanding) }], rows: classRows, empty: 'No billing data yet', emptyText: 'Set fees per class and assign students to classes.' })}</div>
    <div class="card"><h3>Collections by month</h3>${monthRows.length ? monthRows.map((m) => `<div class="list-item" style="display:grid;grid-template-columns:70px 1fr auto;gap:12px"><span class="muted">${esc(m.Month)}</span><div class="bar"><i style="width:${Math.round((m.Collected / max) * 100)}%"></i></div><b>${fmtMoney(m.Collected)}</b></div>`).join('') : emptyState('No payments yet', '', 'wallet')}</div></div>`;
  wireExports(pane, 'Financial report', async () => classRows.map((r) => ({ ...r, 'Collection %': r.Billed ? Math.round((r.Collected / r.Billed) * 100) : 0 })));
}

/* =========================================================
   ANNOUNCEMENTS
   ========================================================= */
export function announcements() {
  return crudPage({
    table: 'announcements', title: 'Announcements', singular: 'announcement', description: 'Publish news and events on the website and notify students, parents and teachers.',
    search: ['title', 'body'], order: { col: 'created_at', asc: false },
    filters: [{ name: 'kind', label: 'All types', options: [{ value: 'news', label: 'News' }, { value: 'event', label: 'Event' }, { value: 'notice', label: 'Notice' }] }],
    columns: [
      { label: 'Announcement', render: (r) => `<b>${esc(r.title)}</b><span class="sub">${esc(r.body.slice(0, 90))}${r.body.length > 90 ? '...' : ''}</span>` },
      { label: 'Type', render: (r) => badge(r.kind, r.kind === 'event' ? 'info' : 'muted') },
      { label: 'Audience', render: (r) => esc(r.audience.join(', ')) },
      { label: 'Website', render: (r) => badge(r.is_public ? 'public' : 'private', r.is_public ? 'ok' : 'muted') },
      { label: 'Status', render: (r) => badge(r.published ? 'published' : 'draft') },
      { label: 'Posted', render: (r) => fmtDate(r.created_at) },
    ],
    formSize: 'lg',
    fields: [
      { name: 'title', label: 'Title', required: true, full: true, maxlength: 150 },
      { name: 'body', label: 'Message', type: 'textarea', required: true, full: true, rows: 5, maxlength: 5000 },
      { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'news', label: 'News' }, { value: 'event', label: 'Event' }, { value: 'notice', label: 'Notice' }] },
      { name: 'event_date', label: 'Event date', type: 'date', help: 'Only for events.' },
      { name: 'audience', label: 'Who should see it', type: 'multiselect', full: true, options: [{ value: 'all', label: 'Everyone' }, { value: 'student', label: 'Students' }, { value: 'parent', label: 'Parents' }, { value: 'teacher', label: 'Teachers' }] },
      { name: 'is_public', label: 'Show on the public website', type: 'checkbox', full: true },
      { name: 'published', label: 'Published (untick to save as a draft)', type: 'checkbox', full: true },
      { name: 'notify', label: 'Send an in-app notification now', type: 'checkbox', full: true, noSave: true },
    ],
    defaults: () => ({ kind: 'news', audience: ['all'], published: true, is_public: false, notify: true }),
    toForm: (r) => ({ ...r, notify: false }),
    beforeSave(v, row, isNew, ctx) { if (!v.audience?.length) v.audience = ['all']; if (isNew) v.created_by = ctx.user.id; return v; },
    async afterSave(a, row, isNew, ctx, extras) {
      if (!extras.notify || !a.published) return;
      const roles = a.audience.includes('all') ? ['student', 'parent', 'teacher'] : a.audience;
      let n = 0;
      for (const role of roles) n += await notifyUsers(await profileIdsByRole([role]), { title: a.kind === 'event' ? `Upcoming event: ${a.title}` : a.title, body: a.body.slice(0, 140), type: a.kind === 'event' ? 'event' : 'announcement', link: `${role}.html#/announcements` });
      toast(`${n} notification${n === 1 ? '' : 's'} sent`, 'info');
    },
  });
}

/* =========================================================
   ADMISSIONS
   ========================================================= */
const ADM = ['pending', 'reviewing', 'accepted', 'rejected', 'enrolled'];
export function admissions(ctx) {
  return crudPage({
    table: 'admission_applications', title: 'Admissions', singular: 'application', plural: 'applications', description: 'Applications submitted on the public website. Review them, update the status and enrol accepted students.',
    search: ['applicant_name', 'reference', 'parent_name', 'parent_phone'], searchPlaceholder: 'Search name, reference or phone', order: { col: 'created_at', asc: false },
    canCreate: false, canDelete: true, exportName: 'Admissions',
    filters: [{ name: 'status', label: 'Any status', options: ADM.map((v) => ({ value: v, label: v })) }, { name: 'grade_applying', label: 'All levels', options: () => CONFIG.LEVELS.map((l) => ({ value: l.name, label: l.name })) }],
    columns: [
      { label: 'Applicant', render: (r) => `<b>${esc(r.applicant_name)}</b><span class="sub">${esc(r.reference)}</span>` }, { label: 'Level', render: (r) => esc(r.grade_applying) },
      { label: 'Parent', render: (r) => `${esc(r.parent_name)}<span class="sub">${esc(r.parent_phone)}</span>` }, { label: 'Applied', render: (r) => fmtDate(r.created_at) }, { label: 'Status', render: (r) => badge(r.status) },
    ],
    exportMap: (r) => ({ Reference: r.reference, Applicant: r.applicant_name, Level: r.grade_applying, Parent: r.parent_name, Phone: r.parent_phone, Email: r.parent_email || '', Status: r.status, Applied: r.created_at.slice(0, 10) }),
    fields: [
      { name: 'status', label: 'Status', type: 'select', required: true, options: ADM.filter((s) => s !== 'enrolled').map((v) => ({ value: v, label: v })), full: true },
      { name: 'admin_note', label: 'Internal note', type: 'textarea', rows: 3, full: true, help: 'Only administrators can see this.' },
    ],
    rowActions: (r) => `<button class="icon-btn" data-act="view" data-id="${r.id}" title="View application" aria-label="View application">${icon('eye', 16)}</button>
      ${r.status === 'accepted' ? `<button class="icon-btn" data-act="enrol" data-id="${r.id}" title="Enrol as student" aria-label="Enrol as student">${icon('student', 16)}</button>` : ''}`,
    editable: (r) => r.status !== 'enrolled',
    async onAction(act, a, { reload }) {
      if (act === 'view') {
        const rows = [['Reference', a.reference], ['Applicant', a.applicant_name], ['Date of birth', fmtDate(a.date_of_birth)], ['Gender', a.gender || '-'], ['Level applied for', a.grade_applying], ['Previous school', a.previous_school || '-'], ['Parent / guardian', a.parent_name], ['Phone', a.parent_phone], ['Email', a.parent_email || '-'], ['Address', a.address || '-'], ['Message', a.message || '-'], ['Applied', fmtDateTime(a.created_at)], ['Internal note', a.admin_note || '-']];
        modal({ title: 'Application', size: 'lg', html: `<div class="paper" style="border:0;padding:0"><table>${rows.map(([k, v]) => `<tr><th style="width:34%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>` });
      }
      if (act === 'enrol') {
        if (!(await confirmBox({ title: 'Enrol this applicant?', message: `${a.applicant_name} will be added as a student and ${a.parent_name} as a parent. You can then assign a class.`, confirmText: 'Enrol student' }))) return;
        try {
          const year = await currentYear();
          const parent = await must(sb.from('parents').insert({ full_name: a.parent_name, phone: a.parent_phone, email: a.parent_email, address: a.address }).select().single());
          await must(sb.from('students').insert({ full_name: a.applicant_name, gender: a.gender, date_of_birth: a.date_of_birth, address: a.address, parent_id: parent.id, academic_year_id: year?.id || null, status: 'active' }));
          await must(sb.from('admission_applications').update({ status: 'enrolled' }).eq('id', a.id));
          toast('Student enrolled. Assign a class from the Students page.'); reload();
        } catch (e) { fail(e); }
      }
    },
  });
}

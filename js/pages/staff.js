// Staff leave and payroll.
//  * Teachers ask for leave, cancel pending requests and read their own paid payslips.
//  * Administrators approve or reject leave. Payroll (salaries, payslips) is only for people with payroll access:
//    the super administrator, or a school administrator who was given the "Staff payroll" permission.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { CONFIG } from '../config.js';
import { crudPage } from '../crud.js';
import { showPrintable } from './shared.js';
import {
  $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, formHtml, readForm, resolveFields,
  fmtDate, fmtMoney, today, pad,
} from '../ui.js';

const LEAVE_TYPES = [['annual', 'Annual leave'], ['sick', 'Sick leave'], ['maternity', 'Maternity leave'], ['paternity', 'Paternity leave'],
  ['compassionate', 'Compassionate leave'], ['study', 'Study leave'], ['unpaid', 'Unpaid leave'], ['other', 'Other']];
const typeLabel = (t) => (LEAVE_TYPES.find((x) => x[0] === t) || [, t])[1];
const STATUS_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'muted' };
const statusBadge = (s) => badge(s, STATUS_TONE[s] || 'muted');
const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const monthLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dates = (l) => (l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}`);
const leaveError = (e) => e;

/* =========================================================================
   Teacher: request leave
   ========================================================================= */
export async function teacherLeave(view, teacher) {
  const draw = async () => {
    view.innerHTML = loadingBlock();
    const rows = await must(sb.from('leave_requests').select('*').eq('teacher_id', teacher.id).order('start_date', { ascending: false }).limit(200));
    const yr = String(new Date().getFullYear());
    const taken = rows.filter((l) => l.status === 'approved' && l.start_date.startsWith(yr)).reduce((a, l) => a + l.days, 0);
    const waiting = rows.filter((l) => l.status === 'pending').length;
    view.innerHTML = `<div class="page-head"><div><h2>My leave</h2><p class="muted">Ask for time off. Only Monday to Friday count as leave days.</p></div>
        <div class="head-actions"><button class="btn primary" id="lv-new">${icon('plus', 16)} Request leave</button></div></div>
      <div class="stats">
        <div class="stat ok"><span class="ico">${icon('calendar', 22)}</span><div><b>${taken}</b><span>Days approved this year</span></div></div>
        <div class="stat gold"><span class="ico">${icon('clock', 22)}</span><div><b>${waiting}</b><span>Waiting for a decision</span></div></div>
      </div>
      <div class="card flush" id="lv-list">${tableHtml({
        columns: [
          { label: 'Type', render: (l) => `<b>${esc(typeLabel(l.leave_type))}</b>${l.reason ? `<span class="sub">${esc(l.reason)}</span>` : ''}` },
          { label: 'Dates', render: dates },
          { label: 'Days', cls: 'num', render: (l) => l.days },
          { label: 'Status', render: (l) => `${statusBadge(l.status)}${l.review_note ? `<span class="sub">${esc(l.review_note)}</span>` : ''}` },
          { label: '', cls: 'actions', render: (l) => (l.status === 'pending' ? `<button class="btn ghost sm" data-cancel="${l.id}">Cancel request</button>` : '') },
        ], rows, empty: 'No leave requests yet', emptyText: 'Use "Request leave" when you need time off.',
      })}</div>`;
    $('#lv-new', view).onclick = () => requestLeave(teacher, draw);
    $('#lv-list', view).onclick = async (e) => {
      const b = e.target.closest('[data-cancel]'); if (!b) return;
      if (!(await confirmBox({ title: 'Cancel this request?', message: 'The administrators will no longer see it as pending.', confirmText: 'Cancel request', danger: true }))) return;
      try {
        const done = await must(sb.from('leave_requests').update({ status: 'cancelled' }).eq('id', b.dataset.cancel).select('id'));
        if (!done.length) throw new Error('This request can no longer be cancelled.');
        toast('Request cancelled'); draw();
      } catch (err) { fail(err); }
    };
  };
  try { await draw(); } catch (e) { view.innerHTML = errorBlock(e); }
}

function requestLeave(teacher, reload) {
  const fields = [
    { name: 'leave_type', label: 'Type of leave', type: 'select', required: true, options: LEAVE_TYPES.map(([value, label]) => ({ value, label })) },
    { name: 'start_date', label: 'First day', type: 'date', required: true },
    { name: 'end_date', label: 'Last day', type: 'date', required: true },
    { name: 'reason', label: 'Reason (optional)', type: 'textarea', full: true, maxlength: 1000 },
  ];
  const m = modal({
    title: 'Request leave', html: formHtml(fields, { leave_type: 'annual', start_date: today(), end_date: today() }),
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lv-go">Send request</button>`,
  });
  $('#lv-go', m.el).onclick = async (e) => {
    const { ok, values: v } = readForm($('form', m.el), fields);
    if (!ok) return;
    if (v.end_date < v.start_date) return toast('The last day cannot be before the first day', 'error');
    setBusy(e.currentTarget, true, 'Sending');
    try {
      await must(sb.from('leave_requests').insert({ teacher_id: teacher.id, leave_type: v.leave_type, start_date: v.start_date, end_date: v.end_date, reason: v.reason }));
      toast('Request sent to the administrators'); m.close(); reload();
    } catch (err) { fail(leaveError(err)); setBusy(e.currentTarget, false); }
  };
}

/* =========================================================================
   Teacher: payslips (only paid ones are visible to the teacher)
   ========================================================================= */
export function payslipHtml(p, teacher) {
  const row = (l, v, b) => `<tr><td>${l}</td><td class="num">${b ? `<b>${fmtMoney(v)}</b>` : fmtMoney(v)}</td></tr>`;
  return `<div class="paper print-area">
    <header><div><h2>${esc(CONFIG.SCHOOL.name)}</h2><small>Payslip for ${esc(monthLabel(p.period))}</small></div></header>
    <div class="meta"><span><b>Name:</b> ${esc(teacher?.full_name || '-')}</span><span><b>Staff no:</b> ${esc(teacher?.staff_no || '-')}</span>
      <span><b>Status:</b> ${esc(p.status)}</span>${p.paid_on ? `<span><b>Paid on:</b> ${fmtDate(p.paid_on)}</span>` : ''}</div>
    <table><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>
      ${row('Basic salary', p.basic)}${row('Allowances', p.allowances)}${row('Deductions', -p.deductions)}${row('Net pay', p.net, true)}
    </tbody></table>${p.note ? `<p style="margin-top:12px"><b>Note:</b> ${esc(p.note)}</p>` : ''}
    <div class="sign"><span>Bursar</span><span>Employee</span></div></div>`;
}

export async function teacherPayslips(view, teacher) {
  try {
    const rows = await must(sb.from('payslips').select('*').eq('teacher_id', teacher.id).eq('status', 'paid').order('period', { ascending: false }).limit(60));
    view.innerHTML = `<div class="page-head"><div><h2>My payslips</h2><p class="muted">Payslips appear here once the school has paid them.</p></div></div>
      <div class="card flush" id="ps-list">${tableHtml({
        columns: [
          { label: 'Month', render: (p) => `<b>${esc(monthLabel(p.period))}</b>` },
          { label: 'Basic', cls: 'num', render: (p) => fmtMoney(p.basic) },
          { label: 'Allowances', cls: 'num', render: (p) => fmtMoney(p.allowances) },
          { label: 'Deductions', cls: 'num', render: (p) => fmtMoney(p.deductions) },
          { label: 'Net pay', cls: 'num', render: (p) => `<b>${fmtMoney(p.net)}</b>` },
          { label: 'Paid on', render: (p) => fmtDate(p.paid_on) },
          { label: '', cls: 'actions', render: (p) => `<button class="btn ghost sm" data-view="${p.id}">${icon('printer', 15)} View</button>` },
        ], rows, empty: 'No payslips yet', emptyText: 'Your first payslip will show here after payday.',
      })}</div>`;
    $('#ps-list', view).onclick = (e) => {
      const b = e.target.closest('[data-view]'); if (!b) return;
      const p = rows.find((x) => x.id === b.dataset.view); if (p) showPrintable(`Payslip ${monthLabel(p.period)}`, payslipHtml(p, teacher));
    };
  } catch (e) { view.innerHTML = errorBlock(e); }
}

/* =========================================================================
   Administrator: leave approvals
   ========================================================================= */
export function adminLeave() {
  return crudPage({
    table: 'leave_requests', title: 'Staff leave', singular: 'leave request', plural: 'leave requests', exportName: 'Staff leave',
    description: 'Approve or reject leave requests from teachers. Teachers are notified of the decision.',
    select: '*, teachers(full_name)', order: { col: 'created_at', asc: false },
    search: ['reason'],
    columns: [
      { label: 'Teacher', render: (l) => `<b>${esc(l.teachers?.full_name || '-')}</b>` },
      { label: 'Type', render: (l) => esc(typeLabel(l.leave_type)) },
      { label: 'Dates', render: dates },
      { label: 'Days', cls: 'num', render: (l) => l.days },
      { label: 'Reason', render: (l) => esc(l.reason || '-') },
      { label: 'Status', render: (l) => `${statusBadge(l.status)}${l.review_note ? `<span class="sub">${esc(l.review_note)}</span>` : ''}` },
    ],
    exportMap: (l) => ({ Teacher: l.teachers?.full_name || '', Type: typeLabel(l.leave_type), From: l.start_date, To: l.end_date, Days: l.days, Status: l.status, Reason: l.reason || '' }),
    canCreate: false, canEdit: false, canDelete: false,
    rowActions: (l) => (l.status === 'pending'
      ? `<button class="icon-btn" data-act="approved" data-id="${l.id}" title="Approve" aria-label="Approve">${icon('check', 16)}</button>
         <button class="icon-btn" data-act="rejected" data-id="${l.id}" title="Reject" aria-label="Reject">${icon('x', 16)}</button>` : ''),
    onAction: (act, row, { reload }) => {
      if (act !== 'approved' && act !== 'rejected') return;
      const fields = [{ name: 'review_note', label: act === 'rejected' ? 'Reason for rejecting' : 'Note (optional)', type: 'textarea', full: true, maxlength: 500, required: act === 'rejected' }];
      const m = modal({
        title: `${act === 'approved' ? 'Approve' : 'Reject'} leave for ${row.teachers?.full_name || 'teacher'}`, size: 'sm',
        html: `<p class="muted">${esc(typeLabel(row.leave_type))}: ${esc(dates(row))} (${row.days} working day${row.days === 1 ? '' : 's'})</p>${formHtml(fields, {})}`,
        footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lv-ok">${act === 'approved' ? 'Approve' : 'Reject'}</button>`,
      });
      $('#lv-ok', m.el).onclick = async (e) => {
        const { ok, values } = readForm($('form', m.el), fields);
        if (!ok) return;
        setBusy(e.currentTarget, true, 'Saving');
        try {
          const done = await must(sb.from('leave_requests').update({ status: act, review_note: values.review_note || null }).eq('id', row.id).eq('status', 'pending').select('id'));
          if (!done.length) throw new Error('This request was already decided.');
          toast(`Leave ${act}`); m.close(); reload();
        } catch (err) { fail(leaveError(err)); setBusy(e.currentTarget, false); }
      };
    },
  });
}

/* =========================================================================
   Administrator: payroll (needs the payroll permission; the database enforces it too)
   ========================================================================= */
export function adminPayroll() {
  return async (view, ctx) => {
    view.innerHTML = `<div class="tabs" id="pay-tabs"><button class="tab active" data-t="slips">Payslips</button><button class="tab" data-t="pay">Salaries</button></div><div id="pay-pane"></div>`;
    const pane = $('#pay-pane', view);
    const show = async (t) => {
      $$('#pay-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await (t === 'slips' ? slipsPane(pane) : salariesPane(pane, ctx)); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#pay-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('slips');
  };
}

const salariesPane = (pane, ctx) => crudPage({
  table: 'staff_pay_profiles', title: 'Staff salaries', singular: 'salary', plural: 'salaries', exportName: 'Staff salaries',
  description: 'Monthly pay for each teacher. Payslips are generated from these figures.',
  select: '*, teachers(full_name,staff_no)', order: { col: 'updated_at', asc: false },
  columns: [
    { label: 'Teacher', render: (r) => `<b>${esc(r.teachers?.full_name || '-')}</b><span class="sub">${esc(r.teachers?.staff_no || '')}</span>` },
    { label: 'Basic', cls: 'num', render: (r) => fmtMoney(r.base_salary) },
    { label: 'Allowances', cls: 'num', render: (r) => fmtMoney(r.allowances) },
    { label: 'Deductions', cls: 'num', render: (r) => fmtMoney(r.deductions) },
    { label: 'Net', cls: 'num', render: (r) => `<b>${fmtMoney(Number(r.base_salary) + Number(r.allowances) - Number(r.deductions))}</b>` },
  ],
  exportMap: (r) => ({ Teacher: r.teachers?.full_name || '', Basic: r.base_salary, Allowances: r.allowances, Deductions: r.deductions }),
  fields: [
    { name: 'teacher_id', label: 'Teacher', type: 'select', required: true, lockOnEdit: true, options: lookup('teachers', 'full_name', { where: { status: 'active' } }) },
    { name: 'base_salary', label: 'Basic salary per month', type: 'number', min: 0, step: '0.01', required: true },
    { name: 'allowances', label: 'Allowances', type: 'number', min: 0, step: '0.01', value: 0 },
    { name: 'deductions', label: 'Deductions', type: 'number', min: 0, step: '0.01', value: 0 },
  ],
  beforeSave: (v) => {
    if (Number(v.deductions) > Number(v.base_salary) + Number(v.allowances || 0)) throw new Error('Deductions cannot be more than the pay.');
    return v;
  },
  deleteMessage: (r) => `Remove the salary record of ${r.teachers?.full_name || 'this teacher'}? Existing payslips are kept.`,
})(pane, ctx);

async function slipsPane(pane) {
  const state = { period: monthStart() };
  pane.innerHTML = `<div class="page-head"><div><h2>Payslips</h2><p class="muted">Create the month's payslips from the salary records, check them, then mark them paid. Paid payslips are locked and visible to teachers.</p></div></div>
    <div class="toolbar"><label>Month <input type="month" class="input sm" id="ps-month" value="${state.period.slice(0, 7)}" aria-label="Month"></label>
      <button class="btn ghost" id="ps-gen">${icon('refresh', 16)} Create payslips</button>
      <button class="btn primary" id="ps-paid">${icon('check', 16)} Mark all paid</button></div>
    <div id="ps-stats"></div><div class="card flush" id="ps-list">${loadingBlock()}</div>`;
  const list = $('#ps-list', pane);
  let rows = [];
  const load = async () => {
    list.innerHTML = loadingBlock();
    try {
      rows = await must(sb.from('payslips').select('*, teachers(full_name,staff_no)').eq('period', state.period).order('created_at').limit(500));
      const total = rows.reduce((a, p) => a + Number(p.net), 0), paid = rows.filter((p) => p.status === 'paid').length;
      $('#ps-stats', pane).innerHTML = `<div class="stats"><div class="stat info"><span class="ico">${icon('wallet', 22)}</span><div><b>${esc(fmtMoney(total))}</b><span>Total net pay</span></div></div>
        <div class="stat ${rows.length && paid === rows.length ? 'ok' : 'gold'}"><span class="ico">${icon('check', 22)}</span><div><b>${paid} of ${rows.length}</b><span>Paid</span></div></div></div>`;
      list.innerHTML = tableHtml({
        columns: [
          { label: 'Teacher', render: (p) => `<b>${esc(p.teachers?.full_name || '-')}</b><span class="sub">${esc(p.teachers?.staff_no || '')}</span>` },
          { label: 'Basic', cls: 'num', render: (p) => fmtMoney(p.basic) },
          { label: 'Allowances', cls: 'num', render: (p) => fmtMoney(p.allowances) },
          { label: 'Deductions', cls: 'num', render: (p) => fmtMoney(p.deductions) },
          { label: 'Net', cls: 'num', render: (p) => `<b>${fmtMoney(p.net)}</b>` },
          { label: 'Status', render: (p) => (p.status === 'paid' ? badge(`paid ${fmtDate(p.paid_on)}`, 'ok') : badge('draft', 'warn')) },
          { label: '', cls: 'actions', render: (p) => `<button class="icon-btn" data-print="${p.id}" title="View payslip" aria-label="View payslip">${icon('printer', 16)}</button>${p.status === 'draft' ? `<button class="icon-btn" data-del="${p.id}" title="Delete draft" aria-label="Delete draft">${icon('trash', 16)}</button>` : ''}` },
        ], rows, empty: `No payslips for ${monthLabel(state.period)}`, emptyText: 'Choose "Create payslips" to make one for every teacher who has a salary record.',
      });
    } catch (e) { list.innerHTML = errorBlock(e); }
  };
  $('#ps-month', pane).onchange = (e) => { if (e.target.value) { state.period = `${e.target.value}-01`; load(); } };
  $('#ps-gen', pane).onclick = async (e) => {
    setBusy(e.currentTarget, true, 'Creating');
    try { const n = await must(sb.rpc('generate_payslips', { p_period: state.period })); toast(n ? `${n} payslip${n === 1 ? '' : 's'} created` : 'Nothing new to create', n ? 'success' : 'info'); await load(); }
    catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
  $('#ps-paid', pane).onclick = async (e) => {
    const drafts = rows.filter((p) => p.status === 'draft').length;
    if (!drafts) return toast('There are no draft payslips to pay', 'info');
    if (!(await confirmBox({ title: 'Mark payslips as paid?', message: `${drafts} payslip${drafts === 1 ? '' : 's'} for ${monthLabel(state.period)} become locked and the teachers are notified.`, confirmText: 'Mark paid' }))) return;
    setBusy(e.currentTarget, true, 'Saving');
    try { const n = await must(sb.rpc('mark_payslips_paid', { p_period: state.period, p_paid_on: today() })); toast(`${n} payslip${n === 1 ? '' : 's'} marked paid`); await load(); }
    catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
  list.onclick = async (e) => {
    const pr = e.target.closest('[data-print]'), del = e.target.closest('[data-del]');
    if (pr) { const p = rows.find((x) => x.id === pr.dataset.print); if (p) showPrintable(`Payslip ${monthLabel(p.period)}`, payslipHtml(p, p.teachers)); }
    if (del) {
      if (!(await confirmBox({ title: 'Delete this draft payslip?', message: 'You can create it again from the salary record.', confirmText: 'Delete', danger: true }))) return;
      try { await must(sb.from('payslips').delete().eq('id', del.dataset.del)); toast('Draft deleted'); load(); } catch (err) { fail(err); }
    }
  };
  await load();
}

// Admin "Payroll" and "Staff leave" tabs.
// Save as: js/pages/admin-payroll.js
import {
  db, esc, money, fmtDate, fmtDateTime, badge, thisMonth, monthLabel, leaveDays,
  currentUserId, downloadPayslip,
} from './sb-lite.js';

const inputStyle = 'padding:6px 8px;border-radius:8px;border:1px solid rgba(0,0,0,.2);width:110px';

/* ------------------------------------------------------------------ */
/* PAYROLL                                                             */
/* ------------------------------------------------------------------ */
export function payroll() {
  return async function render(view) {
    let period = thisMonth();
    let teachers = [];
    let salaries = new Map();
    let slips = new Map();

    view.innerHTML = `
      <div style="display:grid;gap:16px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
          <div>
            <h2 style="margin:0">Staff payroll</h2>
            <p style="margin:4px 0 0;opacity:.7">Set each teacher's salary, generate monthly payslips and mark them paid.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="pr-month" type="month" value="${period}" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(0,0,0,.2)">
            <button id="pr-generate" class="btn" type="button">Generate payslips</button>
          </div>
        </div>
        <div id="pr-msg" style="display:none;padding:10px 12px;border-radius:8px"></div>
        <div id="pr-totals" style="display:flex;gap:12px;flex-wrap:wrap"></div>
        <div id="pr-list" class="card" style="overflow:auto;padding:0"></div>
      </div>`;

    const $ = (s) => view.querySelector(s);
    const list = $('#pr-list');
    const msg = $('#pr-msg');

    const say = (text, ok = false) => {
      msg.textContent = text;
      msg.style.display = text ? 'block' : 'none';
      msg.style.background = ok ? '#dcfce7' : '#fee2e2';
      msg.style.color = ok ? '#166534' : '#991b1b';
    };

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const draw = () => {
      const slipList = [...slips.values()];
      const total = slipList.reduce((a, s) => a + Number(s.net_pay || 0), 0);
      const paid = slipList.filter((s) => s.status === 'paid').reduce((a, s) => a + Number(s.net_pay || 0), 0);
      const card = (label, value) =>
        `<div class="card" style="padding:12px 16px;min-width:170px"><div style="opacity:.7;font-size:.85em">${label}</div><div style="font-size:1.3em;font-weight:700">${value}</div></div>`;
      $('#pr-totals').innerHTML =
        card(`Payslips for ${esc(monthLabel(period))}`, slipList.length) +
        card('Total net pay', money(total)) +
        card('Paid so far', money(paid)) +
        card('Still to pay', money(total - paid));

      if (!teachers.length) {
        list.innerHTML = '<p style="padding:24px;text-align:center;opacity:.7">No staff found. Add teachers first.</p>';
        return;
      }

      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:980px">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid rgba(0,0,0,.1)">
              <th style="padding:12px">Teacher</th>
              <th style="padding:12px">Basic salary</th>
              <th style="padding:12px">Allowances</th>
              <th style="padding:12px">Deductions</th>
              <th style="padding:12px">Net</th>
              <th style="padding:12px">${esc(monthLabel(period))}</th>
              <th style="padding:12px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map((t) => {
              const s = salaries.get(t.id) || { basic_salary: 0, allowances: 0, deductions: 0 };
              const slip = slips.get(t.id);
              const net = Number(s.basic_salary) + Number(s.allowances) - Number(s.deductions);
              return `
              <tr data-tid="${esc(t.id)}" style="border-bottom:1px solid rgba(0,0,0,.06);vertical-align:middle">
                <td style="padding:12px"><div style="font-weight:600">${esc(t.full_name)}</div><div style="opacity:.6;font-size:.85em">${esc(t.staff_no || '')} ${esc(t.job_title || '')}</div></td>
                <td style="padding:12px"><input data-f="basic_salary" type="number" min="0" step="0.01" value="${esc(s.basic_salary)}" style="${inputStyle}"></td>
                <td style="padding:12px"><input data-f="allowances" type="number" min="0" step="0.01" value="${esc(s.allowances)}" style="${inputStyle}"></td>
                <td style="padding:12px"><input data-f="deductions" type="number" min="0" step="0.01" value="${esc(s.deductions)}" style="${inputStyle}"></td>
                <td style="padding:12px;white-space:nowrap" data-net>${money(net)}</td>
                <td style="padding:12px;white-space:nowrap">
                  ${slip ? `${badge(slip.status)} <span style="opacity:.7">${money(slip.net_pay)}</span>${slip.paid_on ? `<div style="opacity:.6;font-size:.8em">Paid ${esc(fmtDate(slip.paid_on))}</div>` : ''}` : '<span style="opacity:.5">No payslip</span>'}
                </td>
                <td style="padding:12px;white-space:nowrap">
                  <button class="btn" type="button" data-act="save">Save salary</button>
                  ${slip && slip.status === 'draft' ? '<button class="btn" type="button" data-act="paid">Mark paid</button>' : ''}
                  ${slip && slip.status === 'paid' ? '<button class="btn" type="button" data-act="unpaid">Undo paid</button>' : ''}
                  ${slip ? '<button class="btn" type="button" data-act="print">Payslip PDF</button>' : ''}
                  ${slip && slip.status === 'draft' ? '<button class="btn" type="button" data-act="delslip" style="color:#b91c1c">Delete</button>' : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    };

    const load = async () => {
      say('');
      list.innerHTML = '<p style="padding:24px;text-align:center;opacity:.7">Loading...</p>';
      const [tRes, sRes, pRes] = await Promise.all([
        db.from('teachers').select('id, full_name, staff_no, job_title, status').neq('status', 'resigned').order('full_name'),
        db.from('teacher_salaries').select('*'),
        db.from('payslips').select('*').eq('period', period),
      ]);
      const err = tRes.error || sRes.error || pRes.error;
      if (err) {
        list.innerHTML = '';
        say(`Could not load payroll: ${err.message}. Make sure you are signed in as an administrator with payroll access.`);
        return;
      }
      teachers = tRes.data || [];
      salaries = new Map((sRes.data || []).map((r) => [r.teacher_id, r]));
      slips = new Map((pRes.data || []).map((r) => [r.teacher_id, r]));
      draw();
    };

    // live net preview while typing
    list.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-tid]');
      if (!tr) return;
      const v = (f) => num(tr.querySelector(`[data-f="${f}"]`).value);
      tr.querySelector('[data-net]').textContent = money(v('basic_salary') + v('allowances') - v('deductions'));
    });

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr[data-tid]');
      const tid = tr.dataset.tid;
      const teacher = teachers.find((t) => t.id === tid);
      const slip = slips.get(tid);
      const act = btn.dataset.act;
      say('');
      btn.disabled = true;
      try {
        if (act === 'save') {
          const v = (f) => num(tr.querySelector(`[data-f="${f}"]`).value);
          const row = { teacher_id: tid, basic_salary: v('basic_salary'), allowances: v('allowances'), deductions: v('deductions'), updated_at: new Date().toISOString() };
          const { error } = await db.from('teacher_salaries').upsert(row);
          if (error) throw error;
          salaries.set(tid, row);
          // keep an unpaid draft for this month in sync with the new salary
          if (slip && slip.status === 'draft') {
            const { data, error: e2 } = await db.from('payslips')
              .update({ basic: row.basic_salary, allowances: row.allowances, deductions: row.deductions })
              .eq('id', slip.id).select().single();
            if (e2) throw e2;
            slips.set(tid, data);
          }
          say(`Salary saved for ${teacher.full_name}.`, true);
        } else if (act === 'paid' || act === 'unpaid') {
          const patch = act === 'paid'
            ? { status: 'paid', paid_on: new Date().toISOString().slice(0, 10) }
            : { status: 'draft', paid_on: null };
          const { data, error } = await db.from('payslips').update(patch).eq('id', slip.id).select().single();
          if (error) throw error;
          slips.set(tid, data);
        } else if (act === 'delslip') {
          if (!confirm('Delete this draft payslip?')) { btn.disabled = false; return; }
          const { error } = await db.from('payslips').delete().eq('id', slip.id);
          if (error) throw error;
          slips.delete(tid);
        } else if (act === 'print') {
          await downloadPayslip({ name: teacher.full_name, staffNo: teacher.staff_no, jobTitle: teacher.job_title }, slip);
        }
        draw();
      } catch (err) {
        btn.disabled = false;
        say(`Action failed: ${err.message || err}`);
      }
    });

    $('#pr-generate').addEventListener('click', async () => {
      say('');
      const uid = await currentUserId();
      const rows = teachers
        .filter((t) => !slips.has(t.id) && salaries.get(t.id) && Number(salaries.get(t.id).basic_salary) > 0)
        .map((t) => {
          const s = salaries.get(t.id);
          return { teacher_id: t.id, period, basic: s.basic_salary, allowances: s.allowances, deductions: s.deductions, created_by: uid };
        });
      if (!rows.length) {
        say('Nothing to generate. Every teacher with a salary already has a payslip for this month (or has no salary set yet).');
        return;
      }
      const { error } = await db.from('payslips').insert(rows);
      if (error) { say(`Could not generate payslips: ${error.message}`); return; }
      await load();
      say(`${rows.length} payslip${rows.length === 1 ? '' : 's'} generated for ${monthLabel(period)}.`, true);
    });

    $('#pr-month').addEventListener('change', async (e) => {
      if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
      period = e.target.value;
      await load();
    });

    await load();
  };
}

/* ------------------------------------------------------------------ */
/* STAFF LEAVE (admin approves / rejects)                              */
/* ------------------------------------------------------------------ */
export function staffLeave() {
  return async function render(view) {
    let filter = 'pending';
    let rows = [];
    let names = new Map();

    view.innerHTML = `
      <div style="display:grid;gap:16px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
          <div>
            <h2 style="margin:0">Staff leave <span id="lv-badge"></span></h2>
            <p style="margin:4px 0 0;opacity:.7">Leave requests sent by teachers.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="lv-filter" style="padding:8px 10px;border-radius:8px">
              <option value="pending">Pending</option>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <button id="lv-refresh" class="btn" type="button">Refresh</button>
          </div>
        </div>
        <div id="lv-msg" style="display:none;padding:10px 12px;border-radius:8px;background:#fee2e2;color:#991b1b"></div>
        <div id="lv-list" class="card" style="overflow:auto;padding:0"></div>
      </div>`;

    const $ = (s) => view.querySelector(s);
    const list = $('#lv-list');
    const msg = $('#lv-msg');
    const showError = (t) => { msg.textContent = t; msg.style.display = t ? 'block' : 'none'; };

    const draw = () => {
      const pending = rows.filter((r) => r.status === 'pending').length;
      $('#lv-badge').innerHTML = pending
        ? `<span style="font-size:.7em;background:#f59e0b;color:#fff;border-radius:999px;padding:2px 10px;vertical-align:middle">${pending} waiting</span>` : '';

      const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
      if (!shown.length) {
        list.innerHTML = `<p style="padding:24px;text-align:center;opacity:.7">No ${filter === 'all' ? '' : filter + ' '}leave requests.</p>`;
        return;
      }
      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:900px">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid rgba(0,0,0,.1)">
              <th style="padding:12px">Teacher</th><th style="padding:12px">Type</th>
              <th style="padding:12px">Dates</th><th style="padding:12px">Reason</th>
              <th style="padding:12px">Status</th><th style="padding:12px">Decision</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((r) => `
              <tr data-id="${esc(r.id)}" style="border-bottom:1px solid rgba(0,0,0,.06);vertical-align:top">
                <td style="padding:12px;font-weight:600">${esc(names.get(r.teacher_id) || 'Unknown')}<div style="font-weight:400;opacity:.6;font-size:.8em">Sent ${esc(fmtDateTime(r.created_at))}</div></td>
                <td style="padding:12px;text-transform:capitalize">${esc(r.leave_type)}</td>
                <td style="padding:12px;white-space:nowrap">${esc(fmtDate(r.start_date))} - ${esc(fmtDate(r.end_date))}<div style="opacity:.6;font-size:.85em">${leaveDays(r.start_date, r.end_date)} day(s)</div></td>
                <td style="padding:12px;max-width:260px;white-space:pre-wrap">${esc(r.reason || '-')}</td>
                <td style="padding:12px">${badge(r.status)}</td>
                <td style="padding:12px">
                  ${r.status === 'pending'
                    ? `<input data-note type="text" maxlength="500" placeholder="Note (optional)" style="padding:6px 8px;border-radius:8px;border:1px solid rgba(0,0,0,.2);width:180px;margin-bottom:6px"><br>
                       <button class="btn" type="button" data-act="approved">Approve</button>
                       <button class="btn" type="button" data-act="rejected" style="color:#b91c1c">Reject</button>`
                    : `${r.admin_note ? `<div>${esc(r.admin_note)}</div>` : ''}<div style="opacity:.6;font-size:.8em">${r.reviewed_at ? 'Decided ' + esc(fmtDateTime(r.reviewed_at)) : ''}</div>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    };

    const load = async () => {
      showError('');
      list.innerHTML = '<p style="padding:24px;text-align:center;opacity:.7">Loading...</p>';
      const [lRes, tRes] = await Promise.all([
        db.from('leave_requests').select('*').order('created_at', { ascending: false }),
        db.from('teachers').select('id, full_name'),
      ]);
      const err = lRes.error || tRes.error;
      if (err) { list.innerHTML = ''; showError(`Could not load leave requests: ${err.message}`); return; }
      rows = lRes.data || [];
      names = new Map((tRes.data || []).map((t) => [t.id, t.full_name]));
      draw();
    };

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const status = btn.dataset.act;
      const note = tr.querySelector('[data-note]')?.value.trim() || null;
      btn.disabled = true;
      showError('');
      const { data, error } = await db.from('leave_requests')
        .update({ status, admin_note: note, reviewed_by: await currentUserId(), reviewed_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) { btn.disabled = false; showError(`Action failed: ${error.message}`); return; }
      rows = rows.map((r) => (r.id === id ? data : r));
      draw();
    });

    $('#lv-filter').addEventListener('change', (e) => { filter = e.target.value; draw(); });
    $('#lv-refresh').addEventListener('click', load);
    await load();
  };
}

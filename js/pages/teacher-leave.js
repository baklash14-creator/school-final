// Teacher "Leave & payslips" tab: request leave, track requests, download own payslips.
// Save as: js/pages/teacher-leave.js
import { db, esc, money, fmtDate, badge, monthLabel, leaveDays, downloadPayslip } from './sb-lite.js';

export function myLeave() {
  return async function render(view) {
    let teacherId = null;
    let me = { name: 'Staff', staffNo: '', jobTitle: '' };
    let requests = [];
    let slips = [];

    const today = new Date().toISOString().slice(0, 10);

    view.innerHTML = `
      <div style="display:grid;gap:20px">
        <div>
          <h2 style="margin:0">Leave &amp; payslips</h2>
          <p style="margin:4px 0 0;opacity:.7">Ask for leave and download your payslips.</p>
        </div>
        <div id="ml-msg" style="display:none;padding:10px 12px;border-radius:8px"></div>

        <form id="ml-form" class="card" style="padding:16px;display:grid;gap:12px">
          <h3 style="margin:0">Request leave</h3>
          <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            <label style="display:grid;gap:4px">Type
              <select name="leave_type" style="padding:8px;border-radius:8px">
                <option value="annual">Annual</option>
                <option value="sick">Sick</option>
                <option value="maternity">Maternity</option>
                <option value="paternity">Paternity</option>
                <option value="compassionate">Compassionate</option>
                <option value="unpaid">Unpaid</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style="display:grid;gap:4px">From
              <input name="start_date" type="date" required min="${today}" style="padding:8px;border-radius:8px">
            </label>
            <label style="display:grid;gap:4px">To
              <input name="end_date" type="date" required min="${today}" style="padding:8px;border-radius:8px">
            </label>
          </div>
          <label style="display:grid;gap:4px">Reason
            <textarea name="reason" rows="3" maxlength="1000" placeholder="Short reason for the leave" style="padding:8px;border-radius:8px"></textarea>
          </label>
          <div><button class="btn" type="submit">Send request</button></div>
        </form>

        <div>
          <h3 style="margin:0 0 8px">My leave requests</h3>
          <div id="ml-requests" class="card" style="overflow:auto;padding:0"></div>
        </div>

        <div>
          <h3 style="margin:0 0 8px">My payslips</h3>
          <div id="ml-slips" class="card" style="overflow:auto;padding:0"></div>
        </div>
      </div>`;

    const $ = (s) => view.querySelector(s);
    const msg = $('#ml-msg');
    const say = (text, ok = false) => {
      msg.textContent = text;
      msg.style.display = text ? 'block' : 'none';
      msg.style.background = ok ? '#dcfce7' : '#fee2e2';
      msg.style.color = ok ? '#166534' : '#991b1b';
    };

    const drawRequests = () => {
      const box = $('#ml-requests');
      if (!requests.length) { box.innerHTML = '<p style="padding:20px;text-align:center;opacity:.7">You have not requested any leave yet.</p>'; return; }
      box.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:640px">
          <thead><tr style="text-align:left;border-bottom:1px solid rgba(0,0,0,.1)">
            <th style="padding:12px">Type</th><th style="padding:12px">Dates</th>
            <th style="padding:12px">Status</th><th style="padding:12px">Admin note</th><th style="padding:12px"></th>
          </tr></thead>
          <tbody>
            ${requests.map((r) => `
              <tr data-id="${esc(r.id)}" style="border-bottom:1px solid rgba(0,0,0,.06)">
                <td style="padding:12px;text-transform:capitalize">${esc(r.leave_type)}</td>
                <td style="padding:12px;white-space:nowrap">${esc(fmtDate(r.start_date))} - ${esc(fmtDate(r.end_date))}<div style="opacity:.6;font-size:.85em">${leaveDays(r.start_date, r.end_date)} day(s)</div></td>
                <td style="padding:12px">${badge(r.status)}</td>
                <td style="padding:12px">${esc(r.admin_note || '-')}</td>
                <td style="padding:12px">${r.status === 'pending' ? '<button class="btn" type="button" data-act="cancel" style="color:#b91c1c">Cancel</button>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    };

    const drawSlips = () => {
      const box = $('#ml-slips');
      if (!slips.length) { box.innerHTML = '<p style="padding:20px;text-align:center;opacity:.7">No payslips available yet. A payslip appears here once it has been paid.</p>'; return; }
      box.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:520px">
          <thead><tr style="text-align:left;border-bottom:1px solid rgba(0,0,0,.1)">
            <th style="padding:12px">Month</th><th style="padding:12px">Net pay</th><th style="padding:12px">Paid on</th><th style="padding:12px"></th>
          </tr></thead>
          <tbody>
            ${slips.map((s) => `
              <tr data-id="${esc(s.id)}" style="border-bottom:1px solid rgba(0,0,0,.06)">
                <td style="padding:12px;font-weight:600">${esc(monthLabel(s.period))}</td>
                <td style="padding:12px">${money(s.net_pay)}</td>
                <td style="padding:12px">${esc(fmtDate(s.paid_on) || '-')}</td>
                <td style="padding:12px"><button class="btn" type="button" data-act="pdf">Download PDF</button></td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    };

    const load = async () => {
      const idRes = await db.rpc('my_teacher_id');
      if (idRes.error || !idRes.data) {
        $('#ml-form').style.display = 'none';
        say('Your account is not linked to a teacher record yet, so leave and payslips are not available. Please ask the school administrator.');
        $('#ml-requests').innerHTML = ''; $('#ml-slips').innerHTML = '';
        return;
      }
      teacherId = idRes.data;

      const [tRes, rRes, sRes] = await Promise.all([
        db.from('teachers').select('full_name, staff_no, job_title').eq('id', teacherId).maybeSingle(),
        db.from('leave_requests').select('*').order('created_at', { ascending: false }),
        db.from('payslips').select('*').order('period', { ascending: false }),
      ]);
      if (tRes.data) me = { name: tRes.data.full_name, staffNo: tRes.data.staff_no, jobTitle: tRes.data.job_title };
      const err = rRes.error || sRes.error;
      if (err) say(`Could not load your data: ${err.message}`);
      requests = rRes.data || [];
      slips = sRes.data || [];
      drawRequests();
      drawSlips();
    };

    $('#ml-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      say('');
      const f = new FormData(e.target);
      const start = f.get('start_date');
      const end = f.get('end_date');
      if (end < start) { say('The end date cannot be before the start date.'); return; }
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { data, error } = await db.from('leave_requests').insert({
        teacher_id: teacherId,
        leave_type: f.get('leave_type'),
        start_date: start,
        end_date: end,
        reason: (f.get('reason') || '').trim() || null,
        status: 'pending',
      }).select().single();
      btn.disabled = false;
      if (error) { say(`Could not send your request: ${error.message}`); return; }
      requests = [data, ...requests];
      e.target.reset();
      drawRequests();
      say('Your leave request was sent to the administrator.', true);
    });

    $('#ml-requests').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act="cancel"]');
      if (!btn) return;
      if (!confirm('Cancel this leave request?')) return;
      const id = btn.closest('tr').dataset.id;
      btn.disabled = true;
      const { error } = await db.from('leave_requests').delete().eq('id', id);
      if (error) { btn.disabled = false; say(`Could not cancel: ${error.message}`); return; }
      requests = requests.filter((r) => r.id !== id);
      drawRequests();
    });

    $('#ml-slips').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act="pdf"]');
      if (!btn) return;
      const slip = slips.find((s) => s.id === btn.closest('tr').dataset.id);
      if (!slip) return;
      btn.disabled = true;
      try { await downloadPayslip(me, slip); } catch (err) { say(`Could not create the PDF: ${err.message}`); }
      btn.disabled = false;
    });

    await load();
  };
}

// Admin "Alumni" tab: shows everyone who submitted the Join the Alumni form.
// Save as: js/pages/admin-alumni.js
import { db, esc, fmtDateTime as fmtDate } from './sb-lite.js';

const COLORS = {
  pending: ['#fef3c7', '#92400e'],
  approved: ['#dcfce7', '#166534'],
  rejected: ['#fee2e2', '#991b1b'],
};

export function alumni() {
  return async function render(view) {
    let filter = 'all';
    let rows = [];

    view.innerHTML = `
      <div class="alumni-admin" style="display:grid;gap:16px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
          <div>
            <h2 style="margin:0">Alumni <span id="al-badge"></span></h2>
            <p style="margin:4px 0 0;opacity:.7">People who joined the alumni network through the website form.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="al-filter" class="input" style="padding:8px 10px;border-radius:8px">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <button id="al-refresh" class="btn" type="button">Refresh</button>
          </div>
        </div>
        <div id="al-msg" style="display:none;padding:10px 12px;border-radius:8px;background:#fee2e2;color:#991b1b"></div>
        <div id="al-list" class="card" style="overflow:auto;padding:0"></div>
      </div>`;

    const $ = (sel) => view.querySelector(sel);
    const list = $('#al-list');
    const msg = $('#al-msg');

    const showError = (text) => { msg.textContent = text; msg.style.display = text ? 'block' : 'none'; };

    const draw = () => {
      const pending = rows.filter((r) => r.status === 'pending').length;
      $('#al-badge').innerHTML = pending
        ? `<span style="font-size:.7em;background:#f59e0b;color:#fff;border-radius:999px;padding:2px 10px;vertical-align:middle">${pending} new</span>`
        : '';

      const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
      if (!shown.length) {
        list.innerHTML = `<p style="padding:24px;text-align:center;opacity:.7">No alumni submissions${filter === 'all' ? ' yet' : ' with this status'}.</p>`;
        return;
      }

      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;min-width:760px">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid rgba(0,0,0,.1)">
              <th style="padding:12px">Name</th>
              <th style="padding:12px">Class of</th>
              <th style="padding:12px">Current work</th>
              <th style="padding:12px">Contact</th>
              <th style="padding:12px">Message</th>
              <th style="padding:12px">Sent</th>
              <th style="padding:12px">Status</th>
              <th style="padding:12px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((r) => {
              const [bg, fg] = COLORS[r.status] || ['#e5e7eb', '#374151'];
              return `
              <tr data-id="${esc(r.id)}" style="border-bottom:1px solid rgba(0,0,0,.06);vertical-align:top">
                <td style="padding:12px;font-weight:600">${esc(r.full_name)}</td>
                <td style="padding:12px">${esc(r.graduation_year || '-')}</td>
                <td style="padding:12px">${esc(r.current_work || '-')}</td>
                <td style="padding:12px">
                  ${r.phone ? `<div>${esc(r.phone)}</div>` : ''}
                  ${r.email ? `<div><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div>` : ''}
                  ${!r.phone && !r.email ? '-' : ''}
                </td>
                <td style="padding:12px;max-width:260px;white-space:pre-wrap">${esc(r.message || '-')}</td>
                <td style="padding:12px;white-space:nowrap">${esc(fmtDate(r.created_at))}</td>
                <td style="padding:12px"><span style="background:${bg};color:${fg};border-radius:999px;padding:3px 10px;font-size:.85em;text-transform:capitalize">${esc(r.status)}</span></td>
                <td style="padding:12px;white-space:nowrap">
                  ${r.status !== 'approved' ? `<button type="button" class="btn" data-act="approved">Approve</button>` : ''}
                  ${r.status !== 'rejected' ? `<button type="button" class="btn" data-act="rejected">Reject</button>` : ''}
                  <button type="button" class="btn" data-act="delete" style="color:#b91c1c">Delete</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    };

    const load = async () => {
      showError('');
      list.innerHTML = '<p style="padding:24px;text-align:center;opacity:.7">Loading...</p>';
      const { data, error } = await db
        .from('alumni')
        .select('id, full_name, graduation_year, current_work, phone, email, message, status, created_at')
        .order('created_at', { ascending: false });
      if (error) {
        rows = [];
        list.innerHTML = '';
        showError(`Could not load alumni: ${error.message}. Make sure you are signed in as an administrator, then refresh.`);
        return;
      }
      rows = data || [];
      draw();
    };

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = tr?.dataset.id;
      const act = btn.dataset.act;
      if (!id) return;

      if (act === 'delete' && !confirm('Delete this alumni submission permanently?')) return;

      btn.disabled = true;
      showError('');
      const { error } = act === 'delete'
        ? await db.from('alumni').delete().eq('id', id)
        : await db.from('alumni').update({ status: act }).eq('id', id);

      if (error) { btn.disabled = false; showError(`Action failed: ${error.message}`); return; }

      if (act === 'delete') rows = rows.filter((r) => r.id !== id);
      else rows = rows.map((r) => (r.id === id ? { ...r, status: act } : r));
      draw();
    });

    $('#al-filter').addEventListener('change', (e) => { filter = e.target.value; draw(); });
    $('#al-refresh').addEventListener('click', load);

    await load();
  };
}

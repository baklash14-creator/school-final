// Admin: data backup (download tables as CSV or one JSON file) and bulk import of pupils from a CSV file.
import { sb } from '../supabase.js';
import { must, logEvent, downloadBlob, clearLookups } from '../api.js';
import { $, $$, esc, icon, toast, fail, setBusy, badge, tableHtml } from '../ui.js';

const TABLES = [
  ['students', 'Pupils'], ['parents', 'Parents'], ['teachers', 'Teachers'], ['classes', 'Classes'], ['subjects', 'Subjects'],
  ['academic_years', 'Academic years'], ['teacher_assignments', 'Teacher assignments'], ['attendance', 'Attendance'],
  ['examinations', 'Exams'], ['exam_results', 'Exam results'], ['school_fees', 'Fee items'], ['fee_payments', 'Fee payments'],
  ['announcements', 'Announcements'], ['admission_applications', 'Admission applications'],
];
const COLS = ['full_name', 'gender', 'date_of_birth', 'class', 'phone', 'email', 'address'];

// ---- CSV helpers (quoted fields, commas, newlines) ----
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
const csvCell = (v) => {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
};
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await must(sb.from(table).select('*').range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const normDate = (s) => {
  s = (s || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || null, y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) [, d, mo, y] = m;
  else return undefined;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(iso + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === iso && +y > 1980 && t < new Date() ? iso : undefined;
};

export function backupAndImport() {
  return async (view) => {
    view.innerHTML = `<div class="page-head"><div><h2>Backup and import</h2><p class="muted">Download a copy of the school's data, or add many pupils at once from a spreadsheet.</p></div></div>
      <div class="card"><h3>Backup</h3><p class="muted">Downloads only what your account is allowed to see. Keep backup files safe: they contain personal data.</p>
        <div class="head-actions" style="margin:10px 0"><button class="btn primary" id="bk-all">${icon('download', 16)} Download everything (JSON)</button></div>
        <div class="bk-grid">${TABLES.map(([t, l]) => `<button class="btn ghost sm" data-csv="${t}">${icon('download', 14)} ${esc(l)} (CSV)</button>`).join('')}</div></div>
      <div class="card" style="margin-top:16px"><h3>Import pupils</h3>
        <p class="muted">Use the template: columns <b>${COLS.join(', ')}</b>. Class must match an existing class name. Dates as YYYY-MM-DD or DD/MM/YYYY. Rows that look like an existing pupil (same name and birth date) are skipped.</p>
        <div class="head-actions" style="margin:10px 0"><button class="btn ghost" id="im-tpl">${icon('download', 16)} Template</button>
          <input type="file" id="im-file" accept=".csv,text/csv" aria-label="CSV file"></div>
        <div id="im-out"></div></div>`;

    $$('[data-csv]', view).forEach((b) => b.addEventListener('click', async () => {
      setBusy(b, true);
      try {
        const rows = await fetchAll(b.dataset.csv);
        if (!rows.length) toast('Nothing to download yet.', 'info');
        else { downloadBlob(`${b.dataset.csv}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['﻿' + toCsv(rows)], { type: 'text/csv' })); logEvent('backup', b.dataset.csv, { rows: rows.length }); }
      } catch (e) { fail(e); } finally { setBusy(b, false); }
    }));
    $('#bk-all', view).addEventListener('click', async (ev) => {
      const b = ev.currentTarget; setBusy(b, true);
      try {
        const data = { exported_at: new Date().toISOString(), tables: {} };
        for (const [t] of TABLES) { try { data.tables[t] = await fetchAll(t); } catch { data.tables[t] = { error: 'not available' }; } }
        downloadBlob(`school-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
        logEvent('backup', 'all', { tables: TABLES.length });
      } catch (e) { fail(e); } finally { setBusy(b, false); }
    });
    $('#im-tpl', view).addEventListener('click', () => downloadBlob('pupils-template.csv', new Blob([`${COLS.join(',')}\r\nAmina Kamara,female,2012-05-14,JSS 1A,076000000,,Freetown\r\n`], { type: 'text/csv' })));

    const out = $('#im-out', view);
    $('#im-file', view).addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      if (f.size > 2e6) { out.innerHTML = '<p class="error">File is too large (limit 2 MB).</p>'; return; }
      try {
        const rows = parseCsv(await f.text());
        const head = rows.shift()?.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')) || [];
        if (!head.includes('full_name')) { out.innerHTML = '<p class="error">The first row must be a header containing full_name. Download the template.</p>'; return; }
        if (rows.length > 1000) { out.innerHTML = '<p class="error">Maximum 1000 rows per import.</p>'; return; }
        const [classes, existing] = await Promise.all([must(sb.from('classes').select('id,name').limit(1000)), fetchAll('students')]);
        const cmap = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c.id]));
        const seen = new Set(existing.map((s) => `${s.full_name.trim().toLowerCase()}|${s.date_of_birth || ''}`));
        const items = rows.map((r, i) => {
          const g = (k) => (r[head.indexOf(k)] ?? '').trim();
          const err = [], name = g('full_name').replace(/\s+/g, ' '), gender = g('gender').toLowerCase();
          if (name.length < 2 || name.length > 120) err.push('name 2-120 characters');
          if (gender && !['male', 'female'].includes(gender)) err.push('gender must be male or female');
          const dob = normDate(g('date_of_birth')); if (dob === undefined) err.push('bad date of birth');
          const cls = g('class'); if (cls && !cmap.has(cls.toLowerCase())) err.push(`unknown class "${cls}"`);
          const email = g('email'); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err.push('bad email');
          const key = `${name.toLowerCase()}|${dob || ''}`;
          const dup = !err.length && seen.has(key); if (!err.length) seen.add(key);
          return { n: i + 2, err, dup, rec: { full_name: name, gender: gender || null, date_of_birth: dob || null, class_id: cls ? cmap.get(cls.toLowerCase()) : null,
            phone: g('phone') || null, email: email || null, address: g('address') || null } };
        });
        const good = items.filter((x) => !x.err.length && !x.dup);
        out.innerHTML = `<p>${badge(`${good.length} ready`, 'success')} ${badge(`${items.filter((x) => x.dup).length} duplicates skipped`, 'warning')} ${badge(`${items.filter((x) => x.err.length).length} with errors`, 'danger')}</p>
          ${tableHtml({ columns: [{ label: 'Row', key: 'n' }, { label: 'Name', render: (x) => esc(x.rec.full_name) }, { label: 'Status', render: (x) => esc(x.err.length ? x.err.join('; ') : x.dup ? 'Duplicate, skipped' : 'OK') }], rows: items.slice(0, 200) })}
          ${items.length > 200 ? '<p class="muted">Showing the first 200 rows.</p>' : ''}
          <button class="btn primary" id="im-go" ${good.length ? '' : 'disabled'}>${icon('check', 16)} Import ${good.length} pupil${good.length === 1 ? '' : 's'}</button>`;
        $('#im-go', out)?.addEventListener('click', async (e) => {
          const b = e.currentTarget; setBusy(b, true);
          try {
            for (let i = 0; i < good.length; i += 100) await must(sb.from('students').insert(good.slice(i, i + 100).map((x) => x.rec)));
            clearLookups(); logEvent('import', 'students', { rows: good.length });
            toast(`${good.length} pupils imported.`); out.innerHTML = `<p>${badge('Done', 'success')} ${good.length} pupils added. Open Pupils to review them.</p>`; ev.target.value = '';
          } catch (er) { fail(er); setBusy(b, false); }
        });
      } catch (e) { fail(e); }
    });
  };
}

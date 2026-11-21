// Bulk import of students, teachers and parents from CSV or Excel files
import { sb } from '../supabase.js';
import { must, currentYear, clearLookups, downloadBlob } from '../api.js';
import { $, esc, icon, toast, fail, modal, setBusy, badge, today } from '../ui.js';

const GENDER = { m: 'male', male: 'male', boy: 'male', f: 'female', female: 'female', girl: 'female' };
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (p) => String(p ?? '').replace(/\D/g, '');
const clean = (v) => { const t = String(v ?? '').trim(); return t === '' ? null : t; };

function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? undefined : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);   // day/month/year
  if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

// Each entity: columns (header label, key, synonyms), how to validate one row, how to save
const ENTITIES = {
  parents: {
    title: 'parents and guardians', table: 'parents',
    columns: [['Full name', 'full_name', ['name', 'fullname', 'parentname']], ['Phone', 'phone', ['telephone', 'mobile', 'phonenumber']], ['Email', 'email', []], ['Occupation', 'occupation', ['job']], ['Address', 'address', []]],
    sample: [['Aminata Kamara', '+232 76 123456', 'aminata@example.com', 'Trader', '12 Wilkinson Rd, Freetown']],
  },
  teachers: {
    title: 'teachers', table: 'teachers',
    columns: [['Full name', 'full_name', ['name', 'fullname', 'teachername']], ['Gender', 'gender', ['sex']], ['Job title', 'job_title', ['title', 'position', 'role']], ['Qualification', 'qualification', ['degree']], ['Phone', 'phone', ['telephone', 'mobile']], ['Email', 'email', []], ['Date hired', 'hire_date', ['hiredate', 'datehired', 'startdate']], ['Status', 'status', []]],
    sample: [['Ibrahim Sesay', 'male', 'Mathematics Teacher', 'BSc Education', '+232 77 654321', 'ibrahim@example.com', '2024-09-01', 'active']],
  },
  students: {
    title: 'students', table: 'students',
    columns: [['Full name', 'full_name', ['name', 'fullname', 'studentname']], ['Gender', 'gender', ['sex']], ['Date of birth', 'date_of_birth', ['dob', 'birthdate', 'dateofbirth']], ['Class', 'class_name', ['classname', 'grade', 'form']], ['Parent name', 'parent_name', ['guardianname', 'parent', 'guardian']], ['Parent phone', 'parent_phone', ['guardianphone', 'parentmobile']], ['Parent email', 'parent_email', ['guardianemail']], ['Phone', 'phone', ['telephone', 'mobile']], ['Email', 'email', []], ['Address', 'address', []], ['Admission date', 'admitted_on', ['admissiondate', 'admitted', 'dateadmitted']]],
    sample: [['Fatmata Kamara', 'female', '2014-03-21', 'Grade 5', 'Aminata Kamara', '+232 76 123456', 'aminata@example.com', '', '', '12 Wilkinson Rd, Freetown', '2026-09-07']],
  },
};

function readSheet(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) return reject(new Error('The spreadsheet library did not load. Check your connection and refresh.'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('That file is larger than 5 MB. Split it into smaller files.'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => {
      try {
        const wb = window.XLSX.read(r.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false }));
      } catch { reject(new Error('That does not look like a CSV or Excel file.')); }
    };
    r.readAsArrayBuffer(file);
  });
}

function mapRows(entity, grid) {
  if (grid.length < 2) throw new Error('The file has no data rows. Use the template: first row is the headings.');
  const heads = grid[0].map(norm);
  const idx = {};
  entity.columns.forEach(([label, key, syn]) => {
    const names = [norm(label), norm(key), ...syn];
    const i = heads.findIndex((h) => names.includes(h));
    if (i >= 0) idx[key] = i;
  });
  if (idx.full_name == null) throw new Error('Could not find a "Full name" column. Download the template to see the expected headings.');
  return grid.slice(1).map((row, n) => {
    const o = { _line: n + 2 };
    for (const [, key] of entity.columns) o[key] = idx[key] != null ? row[idx[key]] : '';
    return o;
  }).filter((o) => entity.columns.some(([, k]) => String(o[k] ?? '').trim() !== ''));
}

export async function openImporter(kind, done) {
  const E = ENTITIES[kind];
  const m = modal({
    title: `Import ${E.title}`, size: 'lg',
    html: `<div id="im-body">
      <ol class="im-steps"><li>Download the template and fill it in (keep the first row).</li><li>Choose your completed CSV or Excel file.</li><li>Check the preview, then import.</li></ol>
      <div class="im-actions"><button class="btn ghost" id="im-tpl">${icon('download', 16)} Download template (.csv)</button>
        <label class="btn primary" for="im-file">${icon('upload', 16)} Choose file</label><input id="im-file" type="file" accept=".csv,.xlsx,.xls" hidden></div>
      ${kind === 'students' ? '<p class="muted" style="font-size:13px;margin-top:12px">Class names must match your existing classes exactly. A parent is matched by phone, then email, then name; parents not found are created automatically. Students already in the system (same name and date of birth) are skipped.</p>' : '<p class="muted" style="font-size:13px;margin-top:12px">Records already in the system (matching phone, email or name) are skipped, so it is safe to run an import twice.</p>'}
      <div id="im-out"></div></div>`,
    footer: `<button class="btn ghost" data-close>Close</button><button class="btn primary" id="im-go" disabled>Import</button>`,
  });
  const out = $('#im-out', m.el), go = $('#im-go', m.el);
  $('#im-tpl', m.el).onclick = () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [E.columns.map((c) => q(c[0])).join(','), ...E.sample.map((r) => r.map(q).join(','))].join('\r\n');
    downloadBlob(`${kind}-import-template.csv`, new Blob(['﻿' + csv], { type: 'text/csv' }));
  };

  let plan = null;
  $('#im-file', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    out.innerHTML = '<p class="muted" style="margin-top:14px">Reading and checking the file...</p>'; go.disabled = true; plan = null;
    try {
      const rows = mapRows(E, await readSheet(f));
      if (rows.length > 1000) throw new Error('A file can hold at most 1000 rows. Split it and import in parts.');
      plan = await prepare(kind, rows);
      const ok = plan.filter((p) => p.state === 'ok').length, skip = plan.filter((p) => p.state === 'skip').length, bad = plan.filter((p) => p.state === 'error').length;
      out.innerHTML = `<div class="im-sum" style="margin-top:16px"><span class="badge ok">${ok} ready</span><span class="badge muted">${skip} already exist</span><span class="badge ${bad ? 'bad' : 'muted'}">${bad} with problems</span></div>
        <div class="table-wrap" style="max-height:300px;overflow:auto;margin-top:10px"><table class="table"><thead><tr><th>Row</th><th>Name</th><th>Result</th></tr></thead><tbody>
        ${plan.slice(0, 200).map((p) => `<tr><td>${p.row._line}</td><td>${esc(p.row.full_name || '-')}</td><td>${p.state === 'ok' ? badge('ready', 'ok') : p.state === 'skip' ? badge('skipped', 'muted') + ' <small class="muted">' + esc(p.msg) + '</small>' : badge('problem', 'bad') + ' <small>' + esc(p.msg) + '</small>'}</td></tr>`).join('')}</tbody></table></div>
        ${plan.length > 200 ? `<p class="muted">Showing the first 200 of ${plan.length} rows.</p>` : ''}`;
      go.disabled = !ok; go.textContent = ok ? `Import ${ok} ${E.title}` : 'Nothing to import';
    } catch (err) { out.innerHTML = `<div class="msg err show" style="margin-top:14px">${esc(err.message)}</div>`; }
    e.target.value = '';
  };

  go.onclick = async () => {
    setBusy(go, true, 'Importing');
    try {
      const res = await commit(kind, plan);
      clearLookups();
      out.innerHTML = `<div class="msg ok show" style="margin-top:16px">${res.added} ${E.title} imported${res.parentsCreated ? `, ${res.parentsCreated} new parent${res.parentsCreated === 1 ? '' : 's'} created` : ''}.</div>
        ${res.failed.length ? `<div class="msg err show" style="margin-top:10px;display:block"><b>${res.failed.length} row${res.failed.length === 1 ? '' : 's'} could not be saved:</b><br>${res.failed.slice(0, 20).map((f) => `Row ${f.line}: ${esc(f.msg)}`).join('<br>')}</div>` : ''}`;
      go.textContent = 'Done'; go.disabled = true; toast(`${res.added} imported`); done?.();
    } catch (err) { fail(err); setBusy(go, false); }
  };
}

/* ---------- validation: decide what will happen to every row ---------- */
async function prepare(kind, rows) {
  const plan = [];
  if (kind === 'parents') {
    const ex = await must(sb.from('parents').select('full_name,phone,email').limit(5000));
    const phones = new Set(ex.map((x) => digits(x.phone)).filter(Boolean)), emails = new Set(ex.map((x) => (x.email || '').toLowerCase()).filter(Boolean));
    for (const r of rows) {
      const name = clean(r.full_name); const email = clean(r.email)?.toLowerCase(); const ph = digits(r.phone);
      if (!name || name.length < 2) { plan.push({ row: r, state: 'error', msg: 'Full name is required' }); continue; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { plan.push({ row: r, state: 'error', msg: 'Email is not valid' }); continue; }
      if ((ph && phones.has(ph)) || (email && emails.has(email))) { plan.push({ row: r, state: 'skip', msg: 'A parent with this phone or email exists' }); continue; }
      if (ph) phones.add(ph); if (email) emails.add(email);
      plan.push({ row: r, state: 'ok', rec: { full_name: name, phone: clean(r.phone), email, occupation: clean(r.occupation), address: clean(r.address) } });
    }
  } else if (kind === 'teachers') {
    const ex = await must(sb.from('teachers').select('full_name,phone,email').limit(5000));
    const seen = new Set(ex.flatMap((x) => [digits(x.phone), (x.email || '').toLowerCase()]).filter(Boolean));
    for (const r of rows) {
      const name = clean(r.full_name); const email = clean(r.email)?.toLowerCase(); const ph = digits(r.phone);
      if (!name || name.length < 2) { plan.push({ row: r, state: 'error', msg: 'Full name is required' }); continue; }
      const g = clean(r.gender) ? GENDER[String(r.gender).trim().toLowerCase()] : null;
      if (clean(r.gender) && !g) { plan.push({ row: r, state: 'error', msg: 'Gender must be male or female' }); continue; }
      const hd = toDate(r.hire_date); if (hd === undefined) { plan.push({ row: r, state: 'error', msg: 'Date hired is not a valid date (use YYYY-MM-DD)' }); continue; }
      const st = clean(r.status)?.toLowerCase().replace(/\s+/g, '_') || 'active';
      if (!['active', 'on_leave', 'resigned'].includes(st)) { plan.push({ row: r, state: 'error', msg: 'Status must be active, on leave or resigned' }); continue; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { plan.push({ row: r, state: 'error', msg: 'Email is not valid' }); continue; }
      if ((email && seen.has(email)) || (ph && seen.has(ph))) { plan.push({ row: r, state: 'skip', msg: 'A teacher with this phone or email exists' }); continue; }
      if (email) seen.add(email); if (ph) seen.add(ph);
      plan.push({ row: r, state: 'ok', rec: { full_name: name, gender: g, job_title: clean(r.job_title), qualification: clean(r.qualification), phone: clean(r.phone), email, hire_date: hd, status: st, show_on_website: true } });
    }
  } else {
    const [classes, parents, existing, year] = await Promise.all([
      must(sb.from('classes').select('id,name,capacity').limit(1000)),
      must(sb.from('parents').select('id,full_name,phone,email').limit(5000)),
      must(sb.from('students').select('full_name,date_of_birth,class_id,status').limit(5000)),
      currentYear(),
    ]);
    const cls = Object.fromEntries(classes.map((c) => [c.name.trim().toLowerCase(), c]));
    const room = Object.fromEntries(classes.map((c) => [c.id, c.capacity - existing.filter((s) => s.class_id === c.id && s.status === 'active').length]));
    const dup = new Set(existing.map((s) => `${s.full_name.trim().toLowerCase()}|${s.date_of_birth || ''}`));
    const byPhone = {}, byEmail = {}, byName = {};
    parents.forEach((p) => { if (digits(p.phone)) byPhone[digits(p.phone)] = p; if (p.email) byEmail[p.email.toLowerCase()] = p; byName[p.full_name.trim().toLowerCase()] = p; });
    const newParents = {};   // key -> record to create
    for (const r of rows) {
      const name = clean(r.full_name);
      if (!name || name.length < 2) { plan.push({ row: r, state: 'error', msg: 'Full name is required' }); continue; }
      const g = clean(r.gender) ? GENDER[String(r.gender).trim().toLowerCase()] : null;
      if (clean(r.gender) && !g) { plan.push({ row: r, state: 'error', msg: 'Gender must be male or female' }); continue; }
      const dob = toDate(r.date_of_birth), adm = toDate(r.admitted_on);
      if (dob === undefined) { plan.push({ row: r, state: 'error', msg: 'Date of birth is not a valid date (use YYYY-MM-DD)' }); continue; }
      if (adm === undefined) { plan.push({ row: r, state: 'error', msg: 'Admission date is not a valid date (use YYYY-MM-DD)' }); continue; }
      if (dob && dob > today()) { plan.push({ row: r, state: 'error', msg: 'Date of birth is in the future' }); continue; }
      if (dup.has(`${name.toLowerCase()}|${dob || ''}`)) { plan.push({ row: r, state: 'skip', msg: 'Student already exists' }); continue; }
      let c = null;
      if (clean(r.class_name)) {
        c = cls[String(r.class_name).trim().toLowerCase()];
        if (!c) { plan.push({ row: r, state: 'error', msg: `Class "${r.class_name}" does not exist. Create it first or fix the name.` }); continue; }
        if (room[c.id] <= 0) { plan.push({ row: r, state: 'error', msg: `${c.name} is full` }); continue; }
      }
      const pn = clean(r.parent_name), pp = digits(r.parent_phone), pe = clean(r.parent_email)?.toLowerCase();
      if (pe && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pe)) { plan.push({ row: r, state: 'error', msg: 'Parent email is not valid' }); continue; }
      let parent = (pp && byPhone[pp]) || (pe && byEmail[pe]) || (pn && byName[pn.toLowerCase()]) || null, parentKey = null;
      if (!parent && (pn || pp || pe)) {
        if (!pn) { plan.push({ row: r, state: 'error', msg: 'Parent name is needed to create a new parent' }); continue; }
        parentKey = pp || pe || pn.toLowerCase();
        newParents[parentKey] ||= { full_name: pn, phone: clean(r.parent_phone), email: pe };
      }
      if (c) room[c.id]--;
      dup.add(`${name.toLowerCase()}|${dob || ''}`);
      plan.push({ row: r, state: 'ok', parentId: parent?.id || null, parentKey, rec: { full_name: name, gender: g, date_of_birth: dob, class_id: c?.id || null, academic_year_id: year?.id || null, phone: clean(r.phone), email: clean(r.email), address: clean(r.address), admitted_on: adm || today(), status: 'active' } });
    }
    plan.newParents = newParents;
  }
  return plan;
}

/* ---------- save ---------- */
async function insertBatch(table, recs, lines, failed) {
  let saved = [];
  for (let i = 0; i < recs.length; i += 100) {
    const chunk = recs.slice(i, i + 100);
    const { data, error } = await sb.from(table).insert(chunk).select('id');
    if (!error) { saved.push(...data.map((d, k) => ({ id: d.id, i: i + k }))); continue; }
    for (let k = 0; k < chunk.length; k++) {   // isolate the bad rows
      const one = await sb.from(table).insert(chunk[k]).select('id');
      if (one.error) failed.push({ line: lines[i + k], msg: one.error.message });
      else saved.push({ id: one.data[0].id, i: i + k });
    }
  }
  return saved;
}

async function commit(kind, plan) {
  const E = ENTITIES[kind], failed = [];
  const ready = plan.filter((p) => p.state === 'ok');
  let parentsCreated = 0;
  if (kind === 'students') {
    const keys = Object.keys(plan.newParents || {});
    if (keys.length) {
      const created = await insertBatch('parents', keys.map((k) => plan.newParents[k]), keys.map(() => 0), failed);
      const idByKey = {}; created.forEach((c) => { idByKey[keys[c.i]] = c.id; }); parentsCreated = created.length;
      ready.forEach((p) => { if (p.parentKey) p.parentId = idByKey[p.parentKey] || null; });
    }
  }
  const recs = ready.map((p) => (kind === 'students' ? { ...p.rec, parent_id: p.parentId } : p.rec));
  const saved = await insertBatch(E.table, recs, ready.map((p) => p.row._line), failed);
  if (kind === 'students' && saved.length) {
    const enr = saved.map((s) => ({ student_id: s.id, class_id: recs[s.i].class_id, academic_year_id: recs[s.i].academic_year_id })).filter((e) => e.class_id && e.academic_year_id);
    if (enr.length) await sb.from('student_enrollments').upsert(enr, { onConflict: 'student_id,academic_year_id' });
  }
  return { added: saved.length, failed, parentsCreated };
}

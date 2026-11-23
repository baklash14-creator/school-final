// Student wellbeing: conduct (incidents and commendations), health profiles and sickbay visits.
//  * Administrators and teachers record conduct; teachers only for students they teach (the database enforces this).
//  * Parents keep the health profile of their child up to date and see shared conduct and sickbay notes.
//  * Teachers can read health profiles of their own students (allergies, conditions, emergency contacts).
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { crudPage } from '../crud.js';
import {
  $, $$, esc, icon, toast, fail, modal, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, formHtml, readForm, resolveFields,
  fmtDate, fmtDateTime, today, debounce,
} from '../ui.js';

const SEVERITY_TONE = { minor: 'info', moderate: 'warn', serious: 'bad' };
const OUTCOMES = [['returned_to_class', 'Returned to class'], ['resting', 'Resting in sickbay'], ['sent_home', 'Sent home'], ['referred', 'Referred to a clinic'], ['emergency', 'Emergency']];
const outcomeLabel = (o) => (OUTCOMES.find((x) => x[0] === o) || [, o])[1];
const studentOptions = lookup('students', 'full_name', { extra: 'student_no', where: { status: 'active' }, format: (r) => `${r.full_name} (${r.student_no})` });
const kindBadge = (r) => (r.kind === 'commendation' ? badge('commendation', 'ok') : badge(`${r.severity || 'incident'}`, SEVERITY_TONE[r.severity] || 'info'));

/* =========================================================================
   Conduct: admin and teacher
   ========================================================================= */
export function conductManager({ teacher = false } = {}) {
  return crudPage({
    table: 'discipline_records', title: 'Conduct records', singular: 'record', plural: 'records', exportName: 'Conduct records',
    description: teacher ? 'Record incidents and commendations for the students you teach.' : 'Incidents and commendations for all students.',
    select: '*, students(full_name,student_no)', search: ['category', 'description'], order: { col: 'incident_date', asc: false },
    filters: [{ name: 'kind', label: 'All kinds', options: [{ value: 'incident', label: 'Incidents' }, { value: 'commendation', label: 'Commendations' }] }],
    columns: [
      { label: 'Date', render: (r) => fmtDate(r.incident_date) },
      { label: 'Student', render: (r) => `<b>${esc(r.students?.full_name || '-')}</b><span class="sub">${esc(r.students?.student_no || '')}</span>` },
      { label: 'Type', render: (r) => `${kindBadge(r)}<span class="sub">${esc(r.category)}</span>` },
      { label: 'What happened', render: (r) => `${esc(r.description)}${r.action_taken ? `<span class="sub">Action: ${esc(r.action_taken)}</span>` : ''}` },
      { label: 'Parents', render: (r) => (r.share_with_family ? badge('shared', 'muted') : badge('private', 'warn')) },
      { label: 'By', render: (r) => esc(r.reporter_name || '-') },
    ],
    exportMap: (r) => ({ Date: r.incident_date, Student: r.students?.full_name || '', Kind: r.kind, Category: r.category, Severity: r.severity || '', Description: r.description, Action: r.action_taken || '', Shared: r.share_with_family ? 'yes' : 'no', By: r.reporter_name || '' }),
    fields: [
      { name: 'student_id', label: 'Student', type: 'select', blank: 'Choose a student', required: true, lockOnEdit: true, full: true, options: studentOptions },
      { name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'incident', label: 'Incident' }, { value: 'commendation', label: 'Commendation' }] },
      { name: 'category', label: 'Category', required: true, maxlength: 40, placeholder: 'e.g. Late to class, Helpfulness' },
      { name: 'severity', label: 'Severity (incidents)', type: 'select', blank: 'Not applicable', options: [{ value: 'minor', label: 'Minor' }, { value: 'moderate', label: 'Moderate' }, { value: 'serious', label: 'Serious' }] },
      { name: 'incident_date', label: 'Date', type: 'date', required: true, value: today() },
      { name: 'description', label: 'What happened', type: 'textarea', required: true, full: true, maxlength: 2000 },
      { name: 'action_taken', label: 'Action taken (optional)', type: 'textarea', full: true, maxlength: 1000 },
      { name: 'share_with_family', label: 'Share with the student and parents', type: 'checkbox', value: true },
    ],
    defaults: () => ({ kind: 'incident', incident_date: today(), share_with_family: true }),
    beforeSave: (v) => {
      if (v.kind === 'incident' && !v.severity) throw new Error('Choose how serious the incident was.');
      if (v.kind === 'commendation') v.severity = null;
      return v;
    },
    deleteMessage: () => 'Delete this conduct record? This cannot be undone.',
  });
}

/* Read-only list for a student or a parent (only records that were shared are visible) */
export async function conductView(view, studentId) {
  try {
    const rows = await must(sb.from('discipline_records').select('*').eq('student_id', studentId).order('incident_date', { ascending: false }).limit(200));
    const good = rows.filter((r) => r.kind === 'commendation').length;
    view.innerHTML = `<div class="page-head"><div><h2>Conduct</h2><p class="muted">Commendations and incidents shared by the school.</p></div></div>
      <div class="stats"><div class="stat ok"><span class="ico">${icon('check', 22)}</span><div><b>${good}</b><span>Commendations</span></div></div>
        <div class="stat ${rows.length - good ? 'gold' : 'ok'}"><span class="ico">${icon('alert', 22)}</span><div><b>${rows.length - good}</b><span>Incidents</span></div></div></div>
      <div class="card flush">${tableHtml({
        columns: [
          { label: 'Date', render: (r) => fmtDate(r.incident_date) },
          { label: 'Type', render: (r) => `${kindBadge(r)}<span class="sub">${esc(r.category)}</span>` },
          { label: 'Details', render: (r) => `${esc(r.description)}${r.action_taken ? `<span class="sub">Action: ${esc(r.action_taken)}</span>` : ''}` },
        ], rows, empty: 'No conduct records', emptyText: 'Nothing has been recorded.',
      })}</div>`;
  } catch (e) { view.innerHTML = errorBlock(e); }
}

/* =========================================================================
   Health profile
   ========================================================================= */
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const healthFields = [
  { name: 'blood_group', label: 'Blood group', type: 'select', blank: 'Unknown', options: BLOOD.map((b) => ({ value: b, label: b })) },
  { name: 'allergies', label: 'Allergies', type: 'textarea', full: true, maxlength: 500, placeholder: 'Food, medicine, insect stings...' },
  { name: 'conditions', label: 'Medical conditions', type: 'textarea', full: true, maxlength: 500 },
  { name: 'medications', label: 'Regular medication', type: 'textarea', full: true, maxlength: 500 },
  { name: 'emergency_name', label: 'Emergency contact', maxlength: 120 },
  { name: 'emergency_phone', label: 'Emergency phone', type: 'tel', maxlength: 30 },
  { name: 'doctor_name', label: 'Family doctor', maxlength: 120 },
  { name: 'doctor_phone', label: 'Doctor phone', type: 'tel', maxlength: 30 },
  { name: 'notes', label: 'Other notes', type: 'textarea', full: true, maxlength: 1000 },
];

function editHealth(studentId, studentName, current, reload) {
  const m = modal({
    title: `Health profile: ${studentName}`, size: 'lg', html: formHtml(healthFields, current || {}),
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="hp-go">Save</button>`,
  });
  $('#hp-go', m.el).onclick = async (e) => {
    const { ok, values } = readForm($('form', m.el), healthFields);
    if (!ok) return;
    setBusy(e.currentTarget, true, 'Saving');
    try {
      await must(sb.from('student_health_profiles').upsert({ student_id: studentId, ...values }, { onConflict: 'student_id' }));
      toast('Health profile saved'); m.close(); reload();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

const healthDetail = (h) => `<dl class="kv">
  ${[['Blood group', h.blood_group], ['Allergies', h.allergies], ['Conditions', h.conditions], ['Medication', h.medications],
    ['Emergency contact', [h.emergency_name, h.emergency_phone].filter(Boolean).join(' | ')], ['Doctor', [h.doctor_name, h.doctor_phone].filter(Boolean).join(' | ')], ['Notes', h.notes]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">Not given</span>'}</dd></div>`).join('')}</dl>`;

/* Parent: edit own child's profile. Student: read only. */
export async function healthProfileView(view, studentId, studentName, { canEdit = false } = {}) {
  const draw = async () => {
    view.innerHTML = loadingBlock();
    try {
      const h = await must(sb.from('student_health_profiles').select('*').eq('student_id', studentId).maybeSingle());
      view.innerHTML = `<div class="page-head"><div><h2>Health profile</h2><p class="muted">Used by the school in an emergency. Please keep it up to date.</p></div>
          ${canEdit ? `<div class="head-actions"><button class="btn primary" id="hp-edit">${icon('edit', 16)} ${h ? 'Update' : 'Fill in'}</button></div>` : ''}</div>
        <div class="card">${h ? healthDetail(h) : emptyState('No health information yet', canEdit ? 'Use "Fill in" to tell the school about allergies, conditions and emergency contacts.' : 'Nothing has been recorded.', 'shield')}</div>
        <div class="card"><div class="card-head"><h3>Sickbay visits</h3></div><div id="sick-list">${loadingBlock()}</div></div>`;
      if (canEdit) $('#hp-edit', view).onclick = () => editHealth(studentId, studentName, h, draw);
      await sickbayList($('#sick-list', view), studentId);
    } catch (e) { view.innerHTML = errorBlock(e); }
  };
  await draw();
}

async function sickbayList(el, studentId) {
  try {
    const rows = await must(sb.from('sickbay_visits').select('*').eq('student_id', studentId).order('visited_at', { ascending: false }).limit(100));
    el.innerHTML = tableHtml({
      columns: [
        { label: 'When', render: (r) => fmtDateTime(r.visited_at) },
        { label: 'Complaint', render: (r) => esc(r.complaint) },
        { label: 'Temp', cls: 'num', render: (r) => (r.temperature != null ? `${r.temperature}&deg;C` : '-') },
        { label: 'Treatment', render: (r) => esc(r.treatment || '-') },
        { label: 'Outcome', render: (r) => badge(outcomeLabel(r.outcome), r.outcome === 'emergency' ? 'bad' : r.outcome === 'returned_to_class' ? 'ok' : 'warn') },
      ], rows, empty: 'No sickbay visits', emptyText: 'Visits to the school sickbay will be listed here.',
    });
  } catch (e) { el.innerHTML = errorBlock(e); }
}

/* Teacher and admin: directory of health profiles of the students they can see */
export async function healthDirectory(view, { canEdit = false } = {}) {
  view.innerHTML = loadingBlock();
  try {
    const rows = await must(sb.from('student_health_profiles').select('*, students(full_name,student_no)').order('updated_at', { ascending: false }).limit(1000));
    view.innerHTML = `<div class="page-head"><div><h2>Health profiles</h2><p class="muted">Allergies, conditions and emergency contacts. Parents keep these up to date. Handle with care.</p></div>
        ${canEdit ? `<div class="head-actions"><button class="btn primary" id="hd-new">${icon('plus', 16)} Add or edit a profile</button></div>` : ''}</div>
      <div class="toolbar"><label class="search">${icon('search', 16)}<input id="hd-q" type="search" placeholder="Search student, allergy or condition..." aria-label="Search health profiles"></label>
        <label class="chip"><input type="checkbox" id="hd-alert"><span>Only with allergies or conditions</span></label></div>
      <div class="card flush" id="hd-list"></div>`;
    const list = $('#hd-list', view);
    const draw = () => {
      const t = $('#hd-q', view).value.toLowerCase().trim(), onlyAlert = $('#hd-alert', view).checked;
      const shown = rows.filter((h) => (!onlyAlert || h.allergies || h.conditions)
        && (!t || `${h.students?.full_name} ${h.students?.student_no} ${h.allergies || ''} ${h.conditions || ''}`.toLowerCase().includes(t)));
      list.innerHTML = tableHtml({
        columns: [
          { label: 'Student', render: (h) => `<b>${esc(h.students?.full_name || '-')}</b><span class="sub">${esc(h.students?.student_no || '')}</span>` },
          { label: 'Blood', render: (h) => esc(h.blood_group || '-') },
          { label: 'Allergies', render: (h) => (h.allergies ? badge(h.allergies, 'bad') : '-') },
          { label: 'Conditions', render: (h) => esc(h.conditions || '-') },
          { label: 'Emergency contact', render: (h) => `${esc(h.emergency_name || '-')}<span class="sub">${esc(h.emergency_phone || '')}</span>` },
          { label: '', cls: 'actions', render: (h) => `<button class="btn ghost sm" data-hp="${h.id}">${canEdit ? 'Open' : 'View'}</button>` },
        ], rows: shown, empty: 'No health profiles', emptyText: 'Parents can fill these in from their portal.',
      });
    };
    draw();
    $('#hd-q', view).oninput = debounce(draw, 200); $('#hd-alert', view).onchange = draw;
    list.onclick = (e) => {
      const b = e.target.closest('[data-hp]'); if (!b) return;
      const h = rows.find((x) => x.id === b.dataset.hp); if (!h) return;
      if (canEdit) return editHealth(h.student_id, h.students?.full_name || 'student', h, () => healthDirectory(view, { canEdit }));
      const m = modal({ title: `Health: ${h.students?.full_name}`, html: healthDetail(h), footer: '<button class="btn ghost" data-close>Close</button>' });
    };
    if (canEdit) {
      $('#hd-new', view).onclick = async () => {
        const f = await resolveFields([{ name: 'student_id', label: 'Student', type: 'select', blank: 'Choose a student', required: true, options: studentOptions }]);
        const m = modal({ title: 'Choose a student', size: 'sm', html: formHtml(f, {}), footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="hn-go">Continue</button>' });
        $('#hn-go', m.el).onclick = async () => {
          const { ok, values } = readForm($('form', m.el), f); if (!ok) return;
          const label = $('select', m.el).selectedOptions[0]?.textContent || 'student';
          try {
            const cur = await must(sb.from('student_health_profiles').select('*').eq('student_id', values.student_id).maybeSingle());
            m.close(); editHealth(values.student_id, label, cur, () => healthDirectory(view, { canEdit }));
          } catch (err) { fail(err); }
        };
      };
    }
  } catch (e) { view.innerHTML = errorBlock(e); }
}

/* =========================================================================
   Sickbay visits (administrator)
   ========================================================================= */
export function sickbayManager() {
  return crudPage({
    table: 'sickbay_visits', title: 'Sickbay visits', singular: 'visit', plural: 'visits', exportName: 'Sickbay visits',
    description: 'Record visits to the sickbay. Parents are told by notification unless you switch that off.',
    select: '*, students(full_name,student_no)', search: ['complaint', 'treatment'], order: { col: 'visited_at', asc: false },
    columns: [
      { label: 'When', render: (r) => fmtDateTime(r.visited_at) },
      { label: 'Student', render: (r) => `<b>${esc(r.students?.full_name || '-')}</b><span class="sub">${esc(r.students?.student_no || '')}</span>` },
      { label: 'Complaint', render: (r) => esc(r.complaint) },
      { label: 'Treatment', render: (r) => esc(r.treatment || '-') },
      { label: 'Outcome', render: (r) => badge(outcomeLabel(r.outcome), r.outcome === 'emergency' ? 'bad' : r.outcome === 'returned_to_class' ? 'ok' : 'warn') },
    ],
    exportMap: (r) => ({ When: r.visited_at, Student: r.students?.full_name || '', Complaint: r.complaint, Temperature: r.temperature ?? '', Treatment: r.treatment || '', Outcome: outcomeLabel(r.outcome) }),
    fields: [
      { name: 'student_id', label: 'Student', type: 'select', blank: 'Choose a student', required: true, lockOnEdit: true, full: true, options: studentOptions },
      { name: 'complaint', label: 'Complaint', required: true, full: true, maxlength: 500 },
      { name: 'temperature', label: 'Temperature (C)', type: 'number', min: 30, max: 45, step: '0.1' },
      { name: 'outcome', label: 'Outcome', type: 'select', required: true, options: OUTCOMES.map(([value, label]) => ({ value, label })) },
      { name: 'treatment', label: 'Treatment given', type: 'textarea', full: true, maxlength: 1000 },
      { name: 'notify_family', label: 'Notify the parents', type: 'checkbox', value: true },
    ],
    defaults: () => ({ outcome: 'returned_to_class', notify_family: true }),
    deleteMessage: () => 'Delete this sickbay visit?',
  });
}

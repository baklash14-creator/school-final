// Weekly timetable: admin editor, teacher / student / parent read-only views
import { sb } from '../supabase.js';
import { must, lookup, clearLookups } from '../api.js';
import { $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, formHtml, readForm, resolveFields, emptyState, loadingBlock, errorBlock, exportButtons, wireExports } from '../ui.js';

const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']];
const hm = (t) => String(t || '').slice(0, 5);
const SELECT = 'id,class_id,subject_id,teacher_id,day_of_week,start_time,end_time,room,label,classes(name),subjects(name),teachers(full_name)';

function weekHtml(slots, { showClass = false, showTeacher = false, editable = false } = {}) {
  const days = DAYS.filter(([n]) => n <= 5 || slots.some((s) => s.day_of_week === n));
  const todayN = ((new Date().getDay() + 6) % 7) + 1;
  return `<div class="tt-week">${days.map(([n, name]) => {
    const list = slots.filter((s) => s.day_of_week === n).sort((a, b) => a.start_time.localeCompare(b.start_time));
    return `<section class="tt-day ${n === todayN ? 'today' : ''}"><h4>${name}${n === todayN ? ' <small>today</small>' : ''}</h4>
      ${list.length ? list.map((s) => `<div class="tt-slot ${s.label && !s.subject_id ? 'brk' : ''}" ${editable ? `data-edit="${s.id}" tabindex="0" role="button"` : ''}>
        <b>${hm(s.start_time)} - ${hm(s.end_time)}</b>
        <span>${esc(s.subjects?.name || s.label || 'Lesson')}</span>
        <small>${[showClass ? s.classes?.name : '', showTeacher ? s.teachers?.full_name : '', s.room ? 'Room ' + s.room : ''].filter(Boolean).map(esc).join(' | ')}</small></div>`).join('') : '<p class="muted tt-none">Free</p>'}</section>`;
  }).join('')}</div>`;
}

/* ---------- read-only views ---------- */
export async function classTimetableView(view, classId) {
  view.innerHTML = loadingBlock();
  if (!classId) { view.innerHTML = emptyState('No class yet', 'The timetable appears once a class is assigned.', 'table'); return; }
  const slots = await must(sb.from('timetable_slots').select(SELECT).eq('class_id', classId).limit(500));
  view.innerHTML = `<div class="page-head"><div><h2>Weekly timetable</h2><p class="muted">Lessons for the week. Today is highlighted.</p></div></div>${slots.length ? weekHtml(slots, { showTeacher: true }) : emptyState('No timetable yet', 'The school has not published a timetable for this class.', 'table')}`;
}
export async function teacherTimetableView(view, teacher) {
  view.innerHTML = loadingBlock();
  const slots = await must(sb.from('timetable_slots').select(SELECT).eq('teacher_id', teacher.id).limit(500));
  view.innerHTML = `<div class="page-head"><div><h2>My timetable</h2><p class="muted">Your lessons for the week. Today is highlighted.</p></div></div>${slots.length ? weekHtml(slots, { showClass: true }) : emptyState('No lessons scheduled', 'The administrator has not placed you on the timetable yet.', 'table')}`;
}

/* ---------- admin editor ---------- */
export function adminTimetable() {
  return async (view, ctx) => {
    const [classes, teachers] = await Promise.all([lookup('classes', 'name')(), lookup('teachers', 'full_name')()]);
    if (!classes.length) { view.innerHTML = emptyState('Create a class first', 'Timetables are built per class.', 'class'); return; }
    view.innerHTML = `<div class="page-head"><div><h2>Timetable</h2><p class="muted">Build each class's week. The system stops two lessons overlapping for a class or a teacher.</p></div>
      <div class="head-actions">${exportButtons()}<button class="btn primary" id="tt-add">${icon('plus', 16)} Add lesson</button></div></div>
      <div class="toolbar"><select id="tt-mode" class="input sm" aria-label="View by"><option value="class">View by class</option><option value="teacher">View by teacher</option></select>
        <select id="tt-who" class="input sm" aria-label="Choose"></select></div><div id="tt-body"></div>`;
    const mode = $('#tt-mode', view), who = $('#tt-who', view), body = $('#tt-body', view);
    let slots = [];
    const fillWho = () => { const list = mode.value === 'class' ? classes : teachers; who.innerHTML = list.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('') || '<option value="">None</option>'; };
    async function load() {
      body.innerHTML = loadingBlock();
      try {
        if (!who.value) { body.innerHTML = emptyState('Nothing to show', 'Add teachers first.', 'teacher'); return; }
        slots = await must(sb.from('timetable_slots').select(SELECT).eq(mode.value === 'class' ? 'class_id' : 'teacher_id', who.value).limit(500));
        body.innerHTML = slots.length ? weekHtml(slots, { showClass: mode.value === 'teacher', showTeacher: mode.value === 'class', editable: true }) : emptyState('No lessons yet', 'Use "Add lesson" to start building this timetable.', 'table');
      } catch (e) { body.innerHTML = errorBlock(e); }
    }
    mode.onchange = () => { fillWho(); load(); }; who.onchange = load;
    fillWho(); if (classes.length) who.value = classes[0].value;

    async function editor(slot) {
      const fields = await resolveFields([
        { name: 'class_id', label: 'Class', type: 'select', required: true, options: classes },
        { name: 'day_of_week', label: 'Day', type: 'select', required: true, options: DAYS.map(([v, l]) => ({ value: String(v), label: l })) },
        { name: 'start_time', label: 'Starts', type: 'time', required: true }, { name: 'end_time', label: 'Ends', type: 'time', required: true },
        { name: 'subject_id', label: 'Subject', type: 'select', blank: 'None (break, assembly...)', options: lookup('subjects', 'name') },
        { name: 'teacher_id', label: 'Teacher', type: 'select', blank: 'Not assigned', options: teachers },
        { name: 'room', label: 'Room', maxlength: 40 }, { name: 'label', label: 'Label (if no subject)', maxlength: 60, placeholder: 'e.g. Break, Assembly' },
      ]);
      const init = slot ? { ...slot, day_of_week: String(slot.day_of_week), start_time: hm(slot.start_time), end_time: hm(slot.end_time) } : { class_id: mode.value === 'class' ? who.value : '', teacher_id: mode.value === 'teacher' ? who.value : '', day_of_week: '1', start_time: '08:00', end_time: '08:40' };
      const m = modal({ title: slot ? 'Edit lesson' : 'Add lesson', size: 'md', html: formHtml(fields, init),
        footer: `${slot ? '<button class="btn ghost danger-text" id="tt-del">Delete</button><span style="flex:1"></span>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tt-save">Save</button>` });
      const form = $('form', m.el);
      $('#tt-save', m.el).onclick = async (e) => {
        const { ok, values } = readForm(form, fields); if (!ok) return;
        if (values.end_time <= values.start_time) return toast('The end time must be after the start time', 'error');
        if (!values.subject_id && !values.label) return toast('Choose a subject or give the slot a label', 'error');
        values.day_of_week = Number(values.day_of_week);
        setBusy(e.currentTarget, true, 'Saving');
        try {
          await must(slot ? sb.from('timetable_slots').update(values).eq('id', slot.id).select('id') : sb.from('timetable_slots').insert(values).select('id'));
          toast('Timetable updated'); m.close(); load();
        } catch (err) { fail(err); setBusy(e.currentTarget, false); }
      };
      $('#tt-del', m.el)?.addEventListener('click', async () => {
        if (!(await confirmBox({ title: 'Delete lesson?', message: 'It will be removed from the timetable.', confirmText: 'Delete', danger: true }))) return;
        try { const g = await must(sb.from('timetable_slots').delete().eq('id', slot.id).select('id')); if (!g.length) throw new Error('You do not have permission to delete this lesson.'); m.close(); load(); } catch (err) { fail(err); }
      });
    }
    $('#tt-add', view).onclick = () => editor(null);
    body.addEventListener('click', (e) => { const el = e.target.closest('[data-edit]'); if (el) editor(slots.find((s) => s.id === el.dataset.edit)); });
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('[data-edit]')?.click(); });
    wireExports(view, 'Timetable', async () => [...slots].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)).map((s) => ({ Day: DAYS[s.day_of_week - 1][1], Start: hm(s.start_time), End: hm(s.end_time), Class: s.classes?.name || '', Subject: s.subjects?.name || s.label || '', Teacher: s.teachers?.full_name || '', Room: s.room || '' })));
    await load();
  };
}

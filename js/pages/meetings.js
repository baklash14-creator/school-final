// Parent-teacher meetings.
//  * Teachers publish time slots (several at once) and see who booked.
//  * Parents pick a free slot with one of their child's teachers; both sides are notified.
import { sb } from '../supabase.js';
import { must } from '../api.js';
import { $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, formHtml, readForm, fmtDateTime, today, pad } from '../ui.js';

const when = (s) => `${fmtDateTime(s.starts_at)} - ${new Date(s.ends_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
const statusBadge = (s) => badge(s.status, { open: 'ok', booked: 'info', cancelled: 'muted' }[s.status] || 'muted');

/* ---------------- Teacher ---------------- */
export async function teacherMeetings(view, teacher) {
  const draw = async () => {
    view.innerHTML = loadingBlock();
    try {
      const slots = await must(sb.from('meeting_slots').select('*, students(full_name, classes(name))').eq('teacher_id', teacher.id).gte('starts_at', new Date(Date.now() - 36e5).toISOString()).order('starts_at').limit(300));
      const booked = slots.filter((s) => s.status === 'booked').length;
      view.innerHTML = `<div class="page-head"><div><h2>Parent meetings</h2><p class="muted">Publish the times you can meet parents. They choose a slot and you are notified.</p></div>
          <div class="head-actions"><button class="btn primary" id="mt-new">${icon('plus', 16)} Add time slots</button></div></div>
        <div class="stats"><div class="stat info"><span class="ico">${icon('calendar', 22)}</span><div><b>${booked}</b><span>Booked</span></div></div>
          <div class="stat ok"><span class="ico">${icon('clock', 22)}</span><div><b>${slots.filter((s) => s.status === 'open').length}</b><span>Open slots</span></div></div></div>
        <div class="card flush" id="mt-list">${tableHtml({
          columns: [
            { label: 'When', render: (s) => `<b>${esc(when(s))}</b>${s.location ? `<span class="sub">${esc(s.location)}</span>` : ''}` },
            { label: 'Status', render: statusBadge },
            { label: 'Parent of', render: (s) => (s.students ? `${esc(s.students.full_name)}<span class="sub">${esc(s.students.classes?.name || '')}${s.note ? ` | ${esc(s.note)}` : ''}</span>` : '-') },
            { label: '', cls: 'actions', render: (s) => (s.status === 'booked' ? `<button class="btn ghost sm" data-cancel="${s.id}">Cancel booking</button>` : s.status === 'open' ? `<button class="icon-btn" data-del="${s.id}" title="Remove slot" aria-label="Remove slot">${icon('trash', 16)}</button>` : '') },
          ], rows: slots, empty: 'No meeting slots yet', emptyText: 'Use "Add time slots" to publish times for parents.',
        })}</div>`;
      $('#mt-new', view).onclick = () => addSlots(teacher, draw);
      $('#mt-list', view).onclick = async (e) => {
        const c = e.target.closest('[data-cancel]'), d = e.target.closest('[data-del]');
        try {
          if (c) {
            if (!(await confirmBox({ title: 'Cancel this meeting?', message: 'The parent is notified and asked to book another time.', confirmText: 'Cancel meeting', danger: true }))) return;
            await must(sb.rpc('cancel_meeting', { p_slot: c.dataset.cancel })); toast('Meeting cancelled'); draw();
          } else if (d) {
            const done = await must(sb.from('meeting_slots').delete().eq('id', d.dataset.del).select('id'));
            if (!done.length) throw new Error('This slot was booked in the meantime. Cancel the booking instead.');
            toast('Slot removed'); draw();
          }
        } catch (err) { fail(err); draw(); }
      };
    } catch (e) { view.innerHTML = errorBlock(e); }
  };
  await draw();
}

function addSlots(teacher, reload) {
  const fields = [
    { name: 'day', label: 'Date', type: 'date', required: true },
    { name: 'start', label: 'First slot starts at', type: 'time', required: true },
    { name: 'minutes', label: 'Minutes per meeting', type: 'number', min: 5, max: 120, required: true },
    { name: 'count', label: 'How many slots', type: 'number', min: 1, max: 20, required: true },
    { name: 'location', label: 'Where', full: true, maxlength: 120, placeholder: 'e.g. Staff room' },
  ];
  const m = modal({
    title: 'Add meeting slots', html: `${formHtml(fields, { day: today(), start: '14:00', minutes: 15, count: 6 })}<p class="muted">Slots are created back to back, starting at the time above.</p>`,
    footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="sl-go">Publish slots</button>',
  });
  $('#sl-go', m.el).onclick = async (e) => {
    const { ok, values: v } = readForm($('form', m.el), fields); if (!ok) return;
    const start = new Date(`${v.day}T${v.start}:00`);
    if (isNaN(start) || start <= new Date()) return toast('Choose a time in the future', 'error');
    const mins = Math.round(Number(v.minutes)), n = Math.round(Number(v.count));
    const rows = Array.from({ length: n }, (_, i) => ({ teacher_id: teacher.id, location: v.location || null,
      starts_at: new Date(start.getTime() + i * mins * 6e4).toISOString(), ends_at: new Date(start.getTime() + (i + 1) * mins * 6e4).toISOString() }));
    setBusy(e.currentTarget, true, 'Saving');
    try { await must(sb.from('meeting_slots').insert(rows)); toast(`${n} slot${n === 1 ? '' : 's'} published`); m.close(); reload(); }
    catch (err) { fail(err.code === '23505' ? new Error('One of these times is already published.') : err); setBusy(e.currentTarget, false); }
  };
}

/* ---------------- Parent ---------------- */
export async function parentMeetings(view, child) {
  const draw = async () => {
    view.innerHTML = loadingBlock();
    try {
      const [ta, cls] = await Promise.all([
        must(sb.from('teacher_assignments').select('teacher_id').eq('class_id', child.class_id)),
        must(sb.from('classes').select('class_teacher_id').eq('id', child.class_id).maybeSingle()),
      ]);
      const ids = new Set(ta.map((t) => t.teacher_id)); if (cls?.class_teacher_id) ids.add(cls.class_teacher_id);
      const all = await must(sb.from('meeting_slots').select('*, teachers(full_name, job_title)').gt('starts_at', new Date().toISOString()).order('starts_at').limit(300));
      const mine = all.filter((s) => s.status === 'booked' && s.student_id === child.id);
      const free = all.filter((s) => s.status === 'open' && ids.has(s.teacher_id));
      view.innerHTML = `<div class="page-head"><div><h2>Meet the teachers</h2><p class="muted">Book a short meeting with one of ${esc(child.full_name.split(' ')[0])}'s teachers.</p></div></div>
        <div class="card"><div class="card-head"><h3>Your bookings</h3></div><div id="mp-mine">${tableHtml({
          columns: [
            { label: 'Teacher', render: (s) => `<b>${esc(s.teachers?.full_name || '-')}</b>` },
            { label: 'When', render: (s) => `${esc(when(s))}${s.location ? `<span class="sub">${esc(s.location)}</span>` : ''}` },
            { label: '', cls: 'actions', render: (s) => `<button class="btn ghost sm" data-cancel="${s.id}">Cancel</button>` },
          ], rows: mine, empty: 'No meetings booked', emptyText: 'Pick a free time below.',
        })}</div></div>
        <div class="card"><div class="card-head"><h3>Free times</h3></div><div id="mp-free">${tableHtml({
          columns: [
            { label: 'Teacher', render: (s) => `<b>${esc(s.teachers?.full_name || '-')}</b><span class="sub">${esc(s.teachers?.job_title || '')}</span>` },
            { label: 'When', render: (s) => `${esc(when(s))}${s.location ? `<span class="sub">${esc(s.location)}</span>` : ''}` },
            { label: '', cls: 'actions', render: (s) => `<button class="btn primary sm" data-book="${s.id}">Book</button>` },
          ], rows: free, empty: 'No free times right now', emptyText: 'Teachers have not published times yet. Check again later.',
        })}</div></div>`;
      view.onclick = async (e) => {
        const b = e.target.closest('[data-book]'), c = e.target.closest('[data-cancel]');
        if (b) bookDialog(free.find((s) => s.id === b.dataset.book), child, draw);
        if (c) {
          if (!(await confirmBox({ title: 'Cancel this meeting?', message: 'The time becomes free for other parents.', confirmText: 'Cancel meeting', danger: true }))) return;
          try { await must(sb.rpc('cancel_meeting', { p_slot: c.dataset.cancel })); toast('Meeting cancelled'); draw(); } catch (err) { fail(err); }
        }
      };
    } catch (e) { view.innerHTML = errorBlock(e); }
  };
  await draw();
}

function bookDialog(slot, child, reload) {
  if (!slot) return;
  const fields = [{ name: 'note', label: 'What would you like to talk about? (optional)', type: 'textarea', full: true, maxlength: 500 }];
  const m = modal({
    title: 'Book this meeting', size: 'sm', html: `<p><b>${esc(slot.teachers?.full_name || '')}</b><br><span class="muted">${esc(when(slot))}${slot.location ? ` | ${esc(slot.location)}` : ''}</span></p>${formHtml(fields, {})}`,
    footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="bk-go">Confirm booking</button>',
  });
  $('#bk-go', m.el).onclick = async (e) => {
    const { values } = readForm($('form', m.el), fields);
    setBusy(e.currentTarget, true, 'Booking');
    try { await must(sb.rpc('book_meeting', { p_slot: slot.id, p_student: child.id, p_note: values.note })); toast('Meeting booked'); m.close(); reload(); }
    catch (err) { fail(err); m.close(); reload(); }
  };
}

/* ---------------- Student: read only ---------------- */
export async function studentMeetings(view, student) {
  try {
    const rows = await must(sb.from('meeting_slots').select('*, teachers(full_name)').eq('student_id', student.id).eq('status', 'booked').gt('starts_at', new Date().toISOString()).order('starts_at'));
    view.innerHTML = `<div class="page-head"><div><h2>Parent meetings</h2><p class="muted">Meetings your parents have booked with your teachers.</p></div></div><div class="card flush">${tableHtml({
      columns: [{ label: 'Teacher', render: (s) => `<b>${esc(s.teachers?.full_name || '-')}</b>` }, { label: 'When', render: (s) => esc(when(s)) }, { label: 'Where', render: (s) => esc(s.location || '-') }],
      rows, empty: 'No meetings booked', emptyText: 'Your parents can book from their portal.',
    })}</div>`;
  } catch (e) { view.innerHTML = errorBlock(e); }
}

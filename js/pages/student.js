// Student portal
import { sb } from '../supabase.js';
import { startPortal } from '../portal-shell.js';
import { must } from '../api.js';
import { messagesView } from './messages.js';
import { classTimetableView } from './timetable.js';
import { nationalResultsView } from './national.js';
import { pastQuestions } from './past-questions.js';
import { calendarView } from './calendar.js';
import { studentMeetings } from './meetings.js';
import { certificatesView } from './certificates.js';
import { studentQuizzes } from './quizzes.js';
import { libraryView } from './library.js';
import { conductView, healthProfileView } from './wellbeing.js';
import { attendanceView, resultsView, feesView, announcementsView, profileView, childHeader } from './shared.js';
import { $, $$, esc, icon, toast, fail, modal, setBusy, badge, emptyState, loadingBlock, errorBlock, fmtDate, fmtDateTime, fmtMoney, today, num } from '../ui.js';

let me = null;
async function getMe(ctx) {
  if (!me) me = await must(sb.from('students').select('*, classes(name)').eq('profile_id', ctx.user.id).maybeSingle());
  return me;
}
const noRecord = (v) => { v.innerHTML = emptyState('Your account is not linked to a student record', 'Ask the school administrator to link your account.', 'student'); };
const wrap = (fn) => async (view, ctx) => { const s = await getMe(ctx); if (!s) return noRecord(view); return fn(view, ctx, s); };

const overview = wrap(async (view, ctx, s) => {
  const [att, bal, asg, subs, ann] = await Promise.all([
    must(sb.from('attendance').select('status').eq('student_id', s.id).limit(1000)),
    must(sb.from('student_fee_balances').select('balance').eq('student_id', s.id).maybeSingle()),
    s.class_id ? must(sb.from('assignments').select('id,title,due_date,subjects(name)').eq('class_id', s.class_id).gte('due_date', today()).order('due_date').limit(20)) : [],
    must(sb.from('assignment_submissions').select('assignment_id').eq('student_id', s.id).limit(500)),
    must(sb.from('announcements').select('id,title,kind,created_at').eq('published', true).order('created_at', { ascending: false }).limit(4)),
  ]);
  const rate = att.length ? Math.round((att.filter((a) => a.status !== 'absent').length / att.length) * 100) : null;
  const done = new Set(subs.map((x) => x.assignment_id));
  const todo = asg.filter((a) => !done.has(a.id));
  const owed = Number(bal?.balance || 0);
  view.innerHTML = `${childHeader(s)}
    <div class="stats">
      <a class="stat ok" href="#/attendance"><span class="ico">${icon('calendar', 22)}</span><div><b>${rate == null ? '-' : rate + '%'}</b><span>Attendance</span></div></a>
      <a class="stat gold" href="#/assignments"><span class="ico">${icon('clipboard', 22)}</span><div><b>${todo.length}</b><span>Assignments to do</span></div></a>
      <a class="stat ${owed > 0 ? 'bad' : 'ok'}" href="#/fees"><span class="ico">${icon('wallet', 22)}</span><div><b>${fmtMoney(Math.max(0, owed))}</b><span>Fees outstanding</span></div></a>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Assignments due</h3><a href="#/assignments">See all</a></div>${todo.length ? `<div class="list">${todo.slice(0, 5).map((a) => `<div class="list-item"><div><b>${esc(a.title)}</b><small>${esc(a.subjects?.name || '')}</small></div><span class="muted">${fmtDate(a.due_date)}</span></div>`).join('')}</div>` : emptyState('You are up to date', 'No assignments are waiting.', 'check')}</div>
      <div class="card"><div class="card-head"><h3>Latest announcements</h3><a href="#/announcements">See all</a></div>${ann.length ? `<div class="list">${ann.map((a) => `<div class="list-item"><div><b>${esc(a.title)}</b><small>${fmtDate(a.created_at)}</small></div>${badge(a.kind, a.kind === 'event' ? 'info' : 'muted')}</div>`).join('')}</div>` : emptyState('No announcements', '', 'megaphone')}</div>
    </div>`;
});

const assignments = wrap(async (view, ctx, s) => {
  if (!s.class_id) { view.innerHTML = emptyState('You are not in a class yet', '', 'class'); return; }
  const [rows, subs] = await Promise.all([
    must(sb.from('assignments').select('*, subjects(name)').eq('class_id', s.class_id).order('due_date', { ascending: false, nullsFirst: false }).limit(100)),
    must(sb.from('assignment_submissions').select('*').eq('student_id', s.id).limit(500)),
  ]);
  const by = Object.fromEntries(subs.map((x) => [x.assignment_id, x]));
  view.innerHTML = `<div class="page-head"><div><h2>Assignments</h2><p class="muted">Homework from your teachers. Hand in your work before the due date.</p></div></div>` +
    (rows.length ? `<div class="grid">${rows.map((a) => { const sub = by[a.id]; const late = a.due_date && a.due_date < today() && !sub;
      return `<article class="card"><div class="card-head"><div><h3 style="margin:0">${esc(a.title)}</h3><small class="muted">${esc(a.subjects?.name || '')} | Due ${fmtDate(a.due_date)}</small></div>
        ${sub ? badge(sub.score != null ? `graded ${num(sub.score)}` : 'submitted', 'ok') : badge(late ? 'overdue' : 'to do', late ? 'bad' : 'warn')}</div>
        ${a.description ? `<p style="white-space:pre-wrap;margin-bottom:12px">${esc(a.description)}</p>` : ''}
        ${sub?.feedback ? `<div class="notice">${icon('info', 18)}<span><b>Teacher feedback:</b> ${esc(sub.feedback)}</span></div>` : ''}
        <button class="btn ${sub ? 'ghost' : 'primary'} sm" data-sub="${a.id}">${icon('upload', 15)} ${sub ? 'Update submission' : 'Submit work'}</button></article>`; }).join('')}</div>` : emptyState('No assignments yet', 'Your teachers have not set any homework.', 'clipboard'));
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]'); if (!b) return;
    const a = rows.find((x) => x.id === b.dataset.sub), prev = by[a.id];
    const m = modal({ title: `Submit: ${a.title}`, html: `<form class="form-grid" novalidate>
      <div class="field full"><label for="s-text">Your answer</label><textarea class="input" id="s-text" name="content" rows="5" maxlength="5000" placeholder="Type your answer here (optional if you attach a file)">${esc(prev?.content || '')}</textarea></div>
      <div class="field full"><label for="s-file">Attach a file</label><input class="input" id="s-file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.txt,.docx"><small class="help">PDF, JPG, PNG, TXT or DOCX, up to 10 MB.${prev?.file_path ? ' Choosing a new file replaces the old one.' : ''}</small><small class="err" data-err="file"></small></div></form>`,
      footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="s-go">Submit</button>` });
    $('#s-go', m.el).onclick = async (ev) => {
      const f = $('form', m.el), content = f.content.value.trim(), file = f.file.files[0];
      $('[data-err=file]', f).textContent = '';
      if (!content && !file && !prev?.file_path) return toast('Write an answer or attach a file', 'error');
      const ok = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (file && !ok.includes(file.type)) return ($('[data-err=file]', f).textContent = 'This file type is not allowed');
      if (file && file.size > 10 * 1024 * 1024) return ($('[data-err=file]', f).textContent = 'The file is larger than 10 MB');
      setBusy(ev.currentTarget, true, 'Submitting');
      try {
        let file_path = prev?.file_path || null;
        if (file) {
          const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5).toLowerCase();
          const path = `${ctx.user.id}/${a.id}-${Date.now()}.${ext}`;
          const { error } = await sb.storage.from('submissions').upload(path, file, { contentType: file.type });
          if (error) throw error;
          if (file_path) await sb.storage.from('submissions').remove([file_path]);
          file_path = path;
        }
        await must(sb.from('assignment_submissions').upsert({ assignment_id: a.id, student_id: s.id, content: content || null, file_path, submitted_at: new Date().toISOString() }, { onConflict: 'assignment_id,student_id' }));
        toast('Work submitted'); m.close(); assignments(view, ctx);
      } catch (err) { fail(err); setBusy(ev.currentTarget, false); }
    };
  });
});

startPortal({
  roles: ['student'], home: 'overview',
  nav: [
    { id: 'overview', label: 'Overview', icon: 'grid', render: overview },
    { id: 'results', label: 'My results', icon: 'file', render: wrap((v, c, s) => resultsView(v, s.id)) },
    { id: 'timetable', label: 'Timetable', icon: 'table', render: wrap((v, c, s) => classTimetableView(v, s.class_id)) },
    { id: 'attendance', label: 'My attendance', icon: 'calendar', render: wrap((v, c, s) => attendanceView(v, s.id)) },
    { id: 'assignments', label: 'Assignments', icon: 'clipboard', render: assignments },
    { id: 'national', label: 'BECE and WASSCE', icon: 'file', render: wrap((v, c, s) => nationalResultsView(v, s.id)) },
    { id: 'past-questions', label: 'Past questions', icon: 'book', render: (v, c) => pastQuestions({ userId: c.user.id })(v, c) },
    { id: 'quizzes', label: 'Online quizzes', icon: 'list', render: wrap((v, c, s) => studentQuizzes(v, c, s)) },
    { id: 'library', label: 'Library', icon: 'book', render: wrap((v, c, s) => libraryView(v, { studentId: s.id })) },
    { id: 'conduct', label: 'Conduct', icon: 'alert', render: wrap((v, c, s) => conductView(v, s.id)) },
    { id: 'health', label: 'Health', icon: 'shield', render: wrap((v, c, s) => healthProfileView(v, s.id, s.full_name)) },
    { id: 'fees', label: 'School fees', icon: 'wallet', render: wrap((v, c, s) => feesView(v, s.id, c)) },
    { id: 'calendar', label: 'School calendar', icon: 'calendar', render: calendarView },
    { id: 'meetings', label: 'Parent meetings', icon: 'users', render: wrap((v, c, s) => studentMeetings(v, s)) },
    { id: 'certificates', label: 'Certificates', icon: 'idcard', render: wrap((v, c, s) => certificatesView(v, s)) },
    { id: 'messages', label: 'Messages', icon: 'message', render: messagesView },
    { id: 'announcements', label: 'Announcements', icon: 'megaphone', render: announcementsView },
    { id: 'profile', label: 'My profile', icon: 'user', render: profileView },
  ],
});

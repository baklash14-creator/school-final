// Parent portal: one account, one or more children
import { sb } from '../supabase.js';
import { startPortal } from '../portal-shell.js';
import { must } from '../api.js';
import { messagesView } from './messages.js';
import { classTimetableView } from './timetable.js';
import { nationalResultsView } from './national.js';
import { calendarView } from './calendar.js';
import { parentMeetings } from './meetings.js';
import { certificatesView } from './certificates.js';
import { quizResultsView } from './quizzes.js';
import { libraryView } from './library.js';
import { conductView, healthProfileView } from './wellbeing.js';
import { attendanceView, resultsView, feesView, announcementsView, profileView, childHeader } from './shared.js';
import { $, esc, icon, badge, emptyState, fmtDate, fmtMoney } from '../ui.js';

let kids = null;
async function getKids(ctx) {
  if (!kids) {
    const parent = await must(sb.from('parents').select('id').eq('profile_id', ctx.user.id).maybeSingle());
    if (parent) {
      const [own, extra] = await Promise.all([
        must(sb.from('students').select('*, classes(name)').eq('parent_id', parent.id)),
        must(sb.from('student_guardians').select('students(*, classes(name))').eq('parent_id', parent.id)),
      ]);
      const map = new Map(); own.forEach((k) => map.set(k.id, k)); extra.forEach((g) => g.students && map.set(g.students.id, g.students));
      kids = [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else kids = [];
  }
  return kids;
}
const KEY = 'aiass_child';
const selected = (list) => { let id = null; try { id = sessionStorage.getItem(KEY); } catch { /* ignore */ } return list.find((k) => k.id === id) || list[0]; };

// Renders a child switcher (when needed) then calls fn(container, child)
function forChild(fn) {
  return async (view, ctx) => {
    const list = await getKids(ctx);
    if (!list.length) { view.innerHTML = emptyState('No children linked to your account', 'Ask the school administrator to link your children to your parent record.', 'users'); return; }
    const render = async () => {
      const child = selected(list);
      view.innerHTML = `${list.length > 1 ? `<div class="toolbar"><label for="kid" class="muted">Viewing:</label><select id="kid" class="input sm">${list.map((k) => `<option value="${k.id}" ${k.id === child.id ? 'selected' : ''}>${esc(k.full_name)}</option>`).join('')}</select></div>` : ''}<div id="kid-body"></div>`;
      $('#kid', view)?.addEventListener('change', (e) => { try { sessionStorage.setItem(KEY, e.target.value); } catch { /* ignore */ } render(); });
      const body = $('#kid-body', view);
      await fn(body, ctx, child);
    };
    await render();
  };
}

const overview = forChild(async (view, ctx, c) => {
  const [att, bal, ann] = await Promise.all([
    must(sb.from('attendance').select('status').eq('student_id', c.id).limit(1000)),
    must(sb.from('student_fee_balances').select('total_fees,total_paid,balance').eq('student_id', c.id).maybeSingle()),
    must(sb.from('announcements').select('id,title,kind,created_at').eq('published', true).order('created_at', { ascending: false }).limit(4)),
  ]);
  const rate = att.length ? Math.round((att.filter((a) => a.status !== 'absent').length / att.length) * 100) : null;
  const absent = att.filter((a) => a.status === 'absent').length, owed = Number(bal?.balance || 0);
  view.innerHTML = `${childHeader(c)}
    <div class="stats">
      <a class="stat ok" href="#/attendance"><span class="ico">${icon('calendar', 22)}</span><div><b>${rate == null ? '-' : rate + '%'}</b><span>Attendance</span></div></a>
      <a class="stat ${absent ? 'bad' : 'ok'}" href="#/attendance"><span class="ico">${icon('x', 22)}</span><div><b>${absent}</b><span>Days absent</span></div></a>
      <a class="stat ${owed > 0 ? 'bad' : 'ok'}" href="#/fees"><span class="ico">${icon('wallet', 22)}</span><div><b>${fmtMoney(Math.max(0, owed))}</b><span>Fees outstanding</span></div></a>
      <a class="stat info" href="#/results"><span class="ico">${icon('file', 22)}</span><div><b>View</b><span>Latest results</span></div></a>
    </div>
    <div class="card"><div class="card-head"><h3>School announcements</h3><a href="#/announcements">See all</a></div>${ann.length ? `<div class="list">${ann.map((a) => `<div class="list-item"><div><b>${esc(a.title)}</b><small>${fmtDate(a.created_at)}</small></div>${badge(a.kind, a.kind === 'event' ? 'info' : 'muted')}</div>`).join('')}</div>` : emptyState('No announcements', '', 'megaphone')}</div>`;
});

startPortal({
  roles: ['parent'], home: 'overview',
  nav: [
    { id: 'overview', label: 'Overview', icon: 'grid', render: overview },
    { id: 'results', label: 'Results', icon: 'file', render: forChild((v, c, k) => resultsView(v, k.id)) },
    { id: 'timetable', label: 'Timetable', icon: 'table', render: forChild((v, c, k) => classTimetableView(v, k.class_id)) },
    { id: 'attendance', label: 'Attendance', icon: 'calendar', render: forChild((v, c, k) => attendanceView(v, k.id)) },
    { id: 'national', label: 'BECE and WASSCE', icon: 'file', render: forChild((v, c, k) => nationalResultsView(v, k.id)) },
    { id: 'quizzes', label: 'Quiz results', icon: 'list', render: forChild((v, c, k) => quizResultsView(v, k.id)) },
    { id: 'library', label: 'Library', icon: 'book', render: forChild((v, c, k) => libraryView(v, { studentId: k.id, browse: false })) },
    { id: 'conduct', label: 'Conduct', icon: 'alert', render: forChild((v, c, k) => conductView(v, k.id)) },
    { id: 'health', label: 'Health', icon: 'shield', render: forChild((v, c, k) => healthProfileView(v, k.id, k.full_name, { canEdit: true })) },
    { id: 'fees', label: 'School fees', icon: 'wallet', render: forChild((v, c, k) => feesView(v, k.id, c)) },
    { id: 'calendar', label: 'School calendar', icon: 'calendar', render: calendarView },
    { id: 'meetings', label: 'Teacher meetings', icon: 'users', render: forChild((v, c, k) => parentMeetings(v, k)) },
    { id: 'certificates', label: 'Certificates', icon: 'idcard', render: forChild((v, c, k) => certificatesView(v, k)) },
    { id: 'messages', label: 'Messages', icon: 'message', render: messagesView },
    { id: 'announcements', label: 'Announcements', icon: 'megaphone', render: announcementsView },
    { id: 'profile', label: 'My profile', icon: 'user', render: profileView },
  ],
});

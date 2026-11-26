// House-plan guide: static, no backend. Each room = one module.
const ROLES = { admin: 'Admin', teacher: 'Teacher', student: 'Student', parent: 'Parent' };
const P = { admin: 'admin.html', teacher: 'teacher.html', student: 'student.html', parent: 'parent.html' };
// links: role -> nav id (only ids that exist in that portal)
const ROOMS = [
  { id: 'gate', name: 'Main Gate', area: 'gate', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Everyone enters here. Sign in with your school email and password.',
    steps: ['Open Portal sign in.', 'Enter email and password (use "Forgot password?" if needed).', 'You land in your own portal automatically.', 'Install it on your phone from the browser menu.'],
    links: { admin: ['overview', 'Dashboard'], teacher: ['overview', 'Dashboard'], student: ['overview', 'Dashboard'], parent: ['overview', 'Dashboard'] } },
  { id: 'front', name: 'Front Office', area: 'front', who: ['admin'],
    what: 'Admissions, website messages and the public site content.',
    steps: ['Review new admission applications.', 'Answer messages sent from the website.', 'Post photos to the gallery.', 'Admit an applicant to create the student record.'],
    links: { admin: ['admissions', 'Admissions'] } },
  { id: 'principal', name: "Principal's Office", area: 'princ', who: ['admin'],
    what: 'Oversight: school-wide analytics, users, permissions and the login and change logs.',
    steps: ['Open Insights for attendance, fees and results charts.', 'Manage users and permissions.', 'Check Audit: login activity and change log.', 'Edit school settings.'],
    links: { admin: ['insights', 'Insights'] } },
  { id: 'bursar', name: "Bursar's Office", area: 'bursar', who: ['admin', 'student', 'parent'],
    what: 'Fees, payments and receipts.',
    steps: ['Admin: set fee items and record payments.', 'Student or parent: see balance and receipts.', 'Print a receipt for any payment.'],
    links: { admin: ['fees', 'Fees'], student: ['fees', 'My fees'], parent: ['fees', 'Fees'] } },
  { id: 'staff', name: 'Staff Room', area: 'staff', who: ['admin', 'teacher'],
    what: 'Teachers, leave, staff attendance and scan stations.',
    steps: ['Admin: add teachers and assign classes.', 'Scan staff or pupil ID cards at the station.', 'Teachers see their own attendance and request leave.', 'Admin approves or declines leave.'],
    links: { admin: ['teachers', 'Teachers'], teacher: ['my-attendance', 'My attendance'] } },
  { id: 'class', name: 'Classrooms', area: 'class', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Daily teaching: attendance, timetable, assignments and scores.',
    steps: ['Teacher: take the register and enter scores.', 'Teacher: set assignments and quizzes.', 'Student: see timetable and hand in work.', 'Parent: watch attendance live.'],
    links: { admin: ['attendance', 'Attendance'], teacher: ['attendance', 'Attendance'], student: ['assignments', 'Assignments'], parent: ['attendance', 'Attendance'] } },
  { id: 'exam', name: 'Exam Hall', area: 'exam', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Exams, results, grade sheets, report cards and BECE/WASSCE records.',
    steps: ['Admin: create exams.', 'Teacher: enter scores, then print the grade sheet.', 'Student or parent: read results and report cards.', 'Admin: record national exam results.'],
    links: { admin: ['exams', 'Exams'], teacher: ['gradesheets', 'Grade sheets'], student: ['results', 'My results'], parent: ['results', 'Results'] } },
  { id: 'library', name: 'Library', area: 'lib', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Books, loans and past exam questions to download.',
    steps: ['Browse the catalogue.', 'Admin: lend and return books.', 'Open Past questions to practise.', 'Teachers upload new papers.'],
    links: { admin: ['library', 'Library'], teacher: ['past-questions', 'Past questions'], student: ['past-questions', 'Past questions'], parent: ['library', 'Library'] } },
  { id: 'sick', name: 'Sickbay', area: 'sick', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Health records and sickbay visits.',
    steps: ['Record allergies and conditions.', 'Log a sickbay visit.', 'Parents see visits for their child.'],
    links: { admin: ['sickbay', 'Sickbay'], teacher: ['health', 'Health'], student: ['health', 'Health'], parent: ['health', 'Health'] } },
  { id: 'disc', name: 'Discipline Office', area: 'disc', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Conduct: merits and demerits.',
    steps: ['Teacher: record a merit or incident.', 'Parents are notified.', 'Admin reviews the full record.'],
    links: { admin: ['conduct', 'Conduct'], teacher: ['conduct', 'Conduct'], student: ['conduct', 'Conduct'], parent: ['conduct', 'Conduct'] } },
  { id: 'hall', name: 'Notice Hall', area: 'hall', who: ['admin', 'teacher', 'student', 'parent'],
    what: 'Announcements, school calendar and events, and messages.',
    steps: ['Admin posts announcements and events.', 'Everyone sees the calendar.', 'Messages reach you in the bell icon.'],
    links: { admin: ['announcements', 'Announcements'], teacher: ['calendar', 'Calendar'], student: ['calendar', 'Calendar'], parent: ['calendar', 'Calendar'] } },
  { id: 'lounge', name: "Parents' Lounge", area: 'lounge', who: ['admin', 'teacher', 'parent'],
    what: 'Parent-teacher meetings.',
    steps: ['Teacher: open meeting slots.', 'Parent: book a slot for a child.', 'Cancel any time before the meeting.'],
    links: { teacher: ['meetings', 'Meetings'], parent: ['meetings', 'Meetings'] } },
  { id: 'cert', name: 'Certificate Room', area: 'cert', who: ['admin', 'student', 'parent'],
    what: 'Certificates with a QR code anyone can verify.',
    steps: ['Admin issues a certificate.', 'Student or parent prints it.', 'Anyone scans the QR to verify it is genuine.'],
    links: { admin: ['certificates', 'Certificates'], student: ['certificates', 'Certificates'], parent: ['certificates', 'Certificates'] } }
];

let role = 'all', open = 'gate';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function draw() {
  $('#roles').innerHTML = [['all', 'Everyone'], ...Object.entries(ROLES)]
    .map(([k, v]) => `<button type="button" class="${k === role ? 'on' : ''}" data-r="${k}">${v}</button>`).join('');
  $('#house').innerHTML = '<div class="pl-roof">Alfrian Int\'l Academy · ground floor</div>' + ROOMS.map((r) => {
    const dim = role !== 'all' && !r.who.includes(role);
    return `<button type="button" class="room a-${r.area} ${dim ? 'dim' : ''} ${r.id === open ? 'sel' : ''}" data-id="${r.id}"><b>${esc(r.name)}</b><small>${r.who.map((w) => ROLES[w][0]).join(' ')}</small></button>`;
  }).join('') + '<div class="pl-door">Entrance</div>';
  const r = ROOMS.find((x) => x.id === open);
  const links = Object.entries(r.links).filter(([k]) => role === 'all' || k === role)
    .map(([k, [id, label]]) => `<a class="pl-btn sm" href="${P[k]}#/${id}">${ROLES[k]}: ${esc(label)}</a>`).join('');
  $('#panel').innerHTML = `<h2>${esc(r.name)}</h2><p class="who">Used by: ${r.who.map((w) => ROLES[w]).join(', ')}</p><p>${esc(r.what)}</p>
    <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${links ? `<div class="pl-links">${links}</div>` : '<p class="who">Not used by this role.</p>'}`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-r]'), b = e.target.closest('[data-id]');
  if (a) { role = a.dataset.r; draw(); }
  if (b) { open = b.dataset.id; draw(); if (innerWidth < 800) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
});
draw();

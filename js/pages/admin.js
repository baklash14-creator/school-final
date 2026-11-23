// Administrator dashboard entry point (super administrator + school administrator)
import { startPortal } from '../portal-shell.js';
import { profileView, announcementsView } from './shared.js';
import * as core from './admin-core.js';
import * as ops from './admin-ops.js';
import * as sys from './admin-system.js';
import { adminTimetable } from './timetable.js';
import { messagesView } from './messages.js';
import { settingsView } from './settings.js';
import { quizManager } from './quizzes.js';
import { adminLibrary } from './library.js';
import { conductManager, healthDirectory, sickbayManager } from './wellbeing.js';
import { lookup } from '../api.js';
import { alumni } from './admin-alumni.js';
import { payroll, staffLeave } from './admin-payroll.js';

startPortal({
  roles: ['super_admin', 'school_admin'],
  home: 'overview',
  nav: [
    { id: 'overview', label: 'Overview', icon: 'grid', render: core.overview },
    { id: 'students', label: 'Students', icon: 'student', group: 'People', render: (v, c) => core.students(c)(v, c) },
    { id: 'teachers', label: 'Teachers', icon: 'teacher', render: (v, c) => core.teachers(c)(v, c) },
    { id: 'parents', label: 'Parents', icon: 'users', render: (v, c) => core.parents(c)(v, c) },
    { id: 'staff-leave', label: 'Staff leave', icon: 'calendar', render: (v, c) => staffLeave()(v, c) },
    { id: 'conduct', label: 'Conduct', icon: 'alert', render: (v, c) => conductManager()(v, c) },
    { id: 'health', label: 'Health profiles', icon: 'shield', render: (v) => healthDirectory(v, { canEdit: true }) },
    { id: 'sickbay', label: 'Sickbay', icon: 'clipboard', render: (v, c) => sickbayManager()(v, c) },
    { id: 'classes', label: 'Classes', icon: 'class', group: 'Academics', render: (v, c) => core.classes()(v, c) },
    { id: 'subjects', label: 'Subjects', icon: 'book', render: (v, c) => core.subjects()(v, c) },
    { id: 'class-subjects', label: 'Class subjects', icon: 'clipboard', render: (v, c) => core.classSubjects()(v, c) },
    { id: 'timetable', label: 'Timetable', icon: 'table', render: (v, c) => adminTimetable()(v, c) },
    { id: 'attendance', label: 'Attendance', icon: 'calendar', render: (v, c) => ops.attendance()(v, c) },
    { id: 'exams', label: 'Examinations', icon: 'file', render: (v, c) => ops.exams()(v, c) },
    { id: 'scores', label: 'Enter scores', icon: 'edit', render: (v, c) => ops.scores()(v, c) },
    { id: 'quizzes', label: 'Online quizzes', icon: 'list', render: (v, c) => quizManager({ classOptions: lookup('classes', 'name'), subjectOptions: lookup('subjects', 'name') })(v, c) },
    { id: 'library', label: 'Library', icon: 'book', render: (v, c) => adminLibrary()(v, c) },
    { id: 'fees', label: 'School fees', icon: 'wallet', group: 'Finance', perm: 'fees', render: (v, c) => ops.fees()(v, c) },
    { id: 'payroll', label: 'Staff payroll', icon: 'wallet', perm: 'payroll', render: (v, c) => payroll()(v, c) },
    { id: 'announcements', label: 'Announcements', icon: 'megaphone', group: 'Communication', render: (v, c) => ops.announcements()(v, c) },
    { id: 'admissions', label: 'Admissions', icon: 'inbox', perm: 'admissions', render: (v, c) => ops.admissions(c)(v, c) },
    { id: 'alumni', label: 'Alumni', icon: 'users', render: (v, c) => alumni()(v, c) },
    { id: 'inbox', label: 'Messages', icon: 'message', render: messagesView },
    { id: 'messages', label: 'Website messages', icon: 'mail', render: (v, c) => sys.messages()(v, c) },
    { id: 'gallery', label: 'Photo gallery', icon: 'image', render: (v, c) => sys.gallery()(v, c) },
    { id: 'reports', label: 'Reports', icon: 'chart', group: 'System', render: (v, c) => sys.reports(c)(v, c) },
    { id: 'settings', label: 'Email, SMS, payments', icon: 'send', perm: 'users', render: settingsView },
    { id: 'users', label: 'User accounts', icon: 'shield', perm: 'users', render: (v, c) => sys.users()(v, c) },
    { id: 'audit', label: 'Audit logs', icon: 'list', perm: 'audit', render: (v, c) => sys.audit()(v, c) },
    { id: 'profile', label: 'My profile', icon: 'user', render: profileView },
  ],
});
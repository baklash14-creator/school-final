// Loads the numbers the smart assistant needs, using the signed-in user's own access rules.
import { sb } from '../supabase.js';
import { must } from '../api.js';

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const inList = async (table, select, col, ids, extra = (q) => q) => {
  const out = [];
  for (const part of chunk(ids, 150)) out.push(...await must(extra(sb.from(table).select(select).in(col, part).limit(20000))));
  return out;
};

/** Stats per pupil. students: [{id, full_name, gender, class_id}] */
export async function loadStats(students, { term = '' } = {}) {
  const ids = students.map((s) => s.id), map = new Map();
  if (!ids.length) return map;
  const [res, att, disc] = await Promise.all([
    inList('exam_results', 'student_id,score,exam_id,subjects(name),examinations(term,max_score,created_at)', 'student_id', ids),
    inList('attendance', 'student_id,status,attendance_date', 'student_id', ids),
    inList('discipline_records', 'student_id,kind,severity', 'student_id', ids).catch(() => []),
  ]);
  const twoWeeks = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  for (const s of students) map.set(s.id, { student: s, rows: [], exams: new Map(), days: 0, present: 0, absentRecent: 0, incidents: 0, serious: 0, commendations: 0 });
  for (const r of res) {
    const m = map.get(r.student_id), ex = r.examinations; if (!m || !ex || !(ex.max_score > 0)) continue;
    if (term && ex.term !== term) continue;
    const pct = (Number(r.score) / Number(ex.max_score)) * 100;
    m.rows.push({ subject: r.subjects?.name || 'Subject', pct });
    const e = m.exams.get(r.exam_id) || { at: ex.created_at, sum: 0, n: 0 }; e.sum += pct; e.n++; m.exams.set(r.exam_id, e);
  }
  for (const a of att) { const m = map.get(a.student_id); if (!m) continue; m.days++; if (a.status !== 'absent') m.present++; else if (a.attendance_date >= twoWeeks) m.absentRecent++; }
  for (const d of disc) { const m = map.get(d.student_id); if (!m) continue; if (d.kind === 'commendation') m.commendations++; else { m.incidents++; if (d.severity === 'serious') m.serious++; } }
  for (const m of map.values()) {
    const ex = [...m.exams.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((e) => e.sum / e.n);
    m.avg = m.rows.length ? m.rows.reduce((a, r) => a + r.pct, 0) / m.rows.length : null;
    m.latest = ex.at(-1) ?? null; m.prevAvg = ex.length > 1 ? ex.at(-2) : null;
    m.trend = ex.length > 1 ? ex.at(-1) - ex.at(-2) : 0;
    m.attendancePct = m.days >= 5 ? (m.present / m.days) * 100 : null;
  }
  return map;
}

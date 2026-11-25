// Insights: charts for the head teacher. Everything is calculated in the browser from rows the administrator is allowed to read.
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { $, esc, icon, loadingBlock, errorBlock, fmtMoney, today, pad } from '../ui.js';

// Fetch every page of a query (Supabase returns at most 1000 rows per request)
async function all(make, max = 10000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const dayStr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const tone = (p) => (p == null ? 'muted' : p >= 90 ? 'ok' : p >= 75 ? 'warn' : 'bad');

const hbars = (rows, { suffix = '', max = null } = {}) => {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span class="hb-l" title="${esc(r.label)}">${esc(r.label)}</span>
    <span class="hb-t"><span class="hb-f ${r.tone || 'info'}" style="width:${r.value == null ? 0 : Math.max(2, Math.round((r.value / top) * 100))}%"></span></span>
    <span class="hb-v">${r.value == null ? 'No data' : `${r.text ?? r.value}${suffix}`}</span></div>`).join('')}</div>`;
};
const empty = (t) => `<p class="muted">${esc(t)}</p>`;

export async function insights(view) {
  view.innerHTML = loadingBlock('Crunching the numbers...');
  try {
    const since = dayStr(-29);
    const [classes, students, teachers, att, pay, results, balances] = await Promise.all([
      all(() => sb.from('classes').select('id,name').order('name')),
      all(() => sb.from('students').select('id,class_id,status,full_name').eq('status', 'active')),
      all(() => sb.from('teachers').select('id').eq('status', 'active')),
      all(() => sb.from('attendance').select('student_id,class_id,status').gte('attendance_date', since)),
      all(() => sb.from('fee_payments').select('amount,paid_on').gte('paid_on', dayStr(-180)).order('paid_on')),
      all(() => sb.from('exam_results').select('grade').not('grade', 'is', null), 5000),
      all(() => sb.from('student_fee_balances').select('balance,total_fees,total_paid')).catch(() => []),
    ]);

    const present = att.filter((a) => a.status !== 'absent').length;
    const rate = pct(present, att.length);
    const owed = balances.reduce((s, b) => s + Math.max(0, Number(b.balance) || 0), 0);
    const billed = balances.reduce((s, b) => s + (Number(b.total_fees) || 0), 0), paid = balances.reduce((s, b) => s + (Number(b.total_paid) || 0), 0);

    const byClass = classes.map((c) => {
      const rows = att.filter((a) => a.class_id === c.id);
      return { label: c.name, value: pct(rows.filter((a) => a.status !== 'absent').length, rows.length), tone: '' };
    }).map((r) => ({ ...r, tone: tone(r.value), text: r.value })).filter((r) => classes.length < 40 || r.value != null);

    const sizes = classes.map((c) => ({ label: c.name, value: students.filter((s) => s.class_id === c.id).length, tone: 'info' }));

    // fee collection per month, last six months
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleDateString(undefined, { month: 'short' }), value: 0 }; });
    pay.forEach((p) => { const m = months.find((x) => p.paid_on.startsWith(x.key)); if (m) m.value += Number(p.amount); });
    const peak = Math.max(1, ...months.map((m) => m.value));

    const grades = ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => ({ label: `Grade ${g}`, value: results.filter((r) => r.grade === g).length, tone: g <= 'B' ? 'ok' : g <= 'D' ? 'warn' : 'bad' }));

    const absences = new Map();
    att.filter((a) => a.status === 'absent').forEach((a) => absences.set(a.student_id, (absences.get(a.student_id) || 0) + 1));
    const names = new Map(students.map((s) => [s.id, s]));
    const clsName = new Map(classes.map((c) => [c.id, c.name]));
    const risk = [...absences].filter(([id]) => names.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ label: `${names.get(id).full_name} (${clsName.get(names.get(id).class_id) || '-'})`, value: n, tone: n >= 6 ? 'bad' : 'warn', text: n }));

    view.innerHTML = `<div class="page-head"><div><h2>School insights</h2><p class="muted">A live picture of attendance, results and fees. Attendance covers the last 30 days.</p></div></div>
      <div class="stats">
        <div class="stat info"><span class="ico">${icon('student', 22)}</span><div><b>${students.length}</b><span>Active students</span></div></div>
        <div class="stat info"><span class="ico">${icon('teacher', 22)}</span><div><b>${teachers.length}</b><span>Active teachers</span></div></div>
        <div class="stat ${rate == null ? '' : rate >= 90 ? 'ok' : rate >= 75 ? 'gold' : 'bad'}"><span class="ico">${icon('calendar', 22)}</span><div><b>${rate == null ? '-' : rate + '%'}</b><span>Attendance (30 days)</span></div></div>
        <div class="stat ${owed ? 'gold' : 'ok'}"><span class="ico">${icon('wallet', 22)}</span><div><b>${esc(fmtMoney(owed))}</b><span>Fees still owed${billed ? ` (${pct(paid, billed)}% collected)` : ''}</span></div></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h3>Attendance by class</h3></div>${byClass.length ? hbars(byClass, { suffix: '%', max: 100 }) : empty('No attendance has been taken in the last 30 days.')}</div>
        <div class="card"><div class="card-head"><h3>Students per class</h3></div>${sizes.length ? hbars(sizes) : empty('No classes yet.')}</div>
        <div class="card"><div class="card-head"><h3>Fees collected, last 6 months</h3></div>${pay.length ? `<div class="vbars">${months.map((m) => `<div class="vbar"><span class="vb-v">${m.value ? esc(fmtMoney(m.value)) : ''}</span><span class="vb-t"><span class="vb-f" style="height:${m.value ? Math.max(3, Math.round((m.value / peak) * 100)) : 0}%"></span></span><span class="vb-l">${esc(m.label)}</span></div>`).join('')}</div>` : empty('No payments recorded in this period (or you do not have the fees permission).')}</div>
        <div class="card"><div class="card-head"><h3>Grade spread (all published and unpublished results)</h3></div>${results.length ? hbars(grades) : empty('No exam results yet.')}</div>
        <div class="card full"><div class="card-head"><h3>Most absences, last 30 days</h3></div>${risk.length ? hbars(risk, { suffix: ' days' }) : empty('No absences recorded. Well done!')}</div>
      </div>`;
  } catch (e) { view.innerHTML = errorBlock(e); }
}

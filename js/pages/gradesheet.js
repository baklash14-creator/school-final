// Class grade sheets: every pupil's average per subject for one term or the whole year, with total, average, grade and position.
// Calculated from entered scores (published or not), so staff can use it before results are released.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { CONFIG } from '../config.js';
import { showPrintable } from './shared.js';
import { $, esc, icon, badge, tableHtml, loadingBlock, errorBlock, exportButtons, wireExports, gradeFor } from '../ui.js';

const r1 = (n) => Math.round(n * 10) / 10;

export function gradeSheet({ classOptions = null } = {}) {
  return async (view) => {
    const classes = classOptions || (await lookup('classes', 'name')());
    const st = { cls: '', year: '', scope: 'yearly' };
    view.innerHTML = `<div class="page-head"><div><h2>Class grade sheets</h2><p class="muted">Average score for each subject, for a term or the whole year. Positions use the overall average.</p></div>
        <div class="head-actions">${exportButtons()}<button class="btn ghost" id="gs-print" disabled>${icon('printer', 16)} Print</button></div></div>
      <div class="toolbar"><select class="input sm" id="gs-class" aria-label="Class"><option value="">Choose a class</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>
        <select class="input sm" id="gs-year" aria-label="Academic year" disabled><option value="">All years</option></select>
        <select class="input sm" id="gs-scope" aria-label="Period"><option value="yearly">Whole year</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></div>
      <div class="card flush" id="gs-out"><p class="muted" style="padding:16px">Choose a class to see its grade sheet.</p></div>`;
    let model = null;
    const out = $('#gs-out', view);
    const load = async () => {
      if (!st.cls) { out.innerHTML = '<p class="muted" style="padding:16px">Choose a class to see its grade sheet.</p>'; $('#gs-print', view).disabled = true; return; }
      out.innerHTML = loadingBlock();
      try {
        const exams = await must(sb.from('examinations').select('id,name,term,max_score,academic_year_id,academic_years(name)').eq('class_id', st.cls).limit(500));
        const yrSel = $('#gs-year', view), years = [...new Map(exams.filter((e) => e.academic_year_id).map((e) => [e.academic_year_id, e.academic_years?.name || ''])).entries()];
        if (!yrSel.dataset.for || yrSel.dataset.for !== st.cls) { yrSel.innerHTML = `<option value="">All years</option>${years.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}`; yrSel.disabled = !years.length; yrSel.dataset.for = st.cls; st.year = ''; }
        const inScope = exams.filter((e) => (!st.year || e.academic_year_id === st.year) && (st.scope === 'yearly' || e.term === st.scope));
        const [students, results, subjects] = await Promise.all([
          must(sb.from('students').select('id,full_name,student_no').eq('class_id', st.cls).eq('status', 'active').order('full_name').limit(500)),
          inScope.length ? must(sb.from('exam_results').select('exam_id,student_id,subject_id,score').in('exam_id', inScope.map((e) => e.id)).limit(50000)) : [],
          must(sb.from('subjects').select('id,name').order('name').limit(500)),
        ]);
        const max = new Map(inScope.map((e) => [e.id, Number(e.max_score) || 100]));
        const subjUsed = new Set(results.map((r) => r.subject_id)), cols = subjects.filter((s) => subjUsed.has(s.id));
        const acc = new Map(); // student|subject -> [percent...]
        results.forEach((r) => { const k = `${r.student_id}|${r.subject_id}`; if (!acc.has(k)) acc.set(k, []); acc.get(k).push((Number(r.score) / max.get(r.exam_id)) * 100); });
        const rows = students.map((s) => {
          const avgs = cols.map((c) => { const a = acc.get(`${s.id}|${c.id}`); return a ? a.reduce((x, y) => x + y, 0) / a.length : null; });
          const have = avgs.filter((v) => v != null), total = have.reduce((x, y) => x + y, 0);
          return { s, avgs, total, avg: have.length ? total / have.length : null, n: have.length };
        });
        const ranked = rows.filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg);
        ranked.forEach((r, i) => { r.pos = i > 0 && Math.abs(ranked[i - 1].avg - r.avg) < 0.005 ? ranked[i - 1].pos : i + 1; });
        model = { cols, rows: [...rows].sort((a, b) => (a.pos || 1e9) - (b.pos || 1e9) || a.s.full_name.localeCompare(b.s.full_name)), exams: inScope.length };
        const title = `${classes.find((c) => c.value === st.cls)?.label || ''} | ${st.scope === 'yearly' ? 'Whole year' : st.scope}${st.year ? ` | ${$('#gs-year', view).selectedOptions[0].textContent}` : ''}`;
        model.title = title;
        out.innerHTML = !inScope.length ? '<p class="muted" style="padding:16px">No examinations were found for this class and period.</p>'
          : !cols.length ? '<p class="muted" style="padding:16px">No scores have been entered yet for these examinations.</p>' : sheetHtml(model);
        $('#gs-print', view).disabled = !cols.length;
      } catch (e) { out.innerHTML = errorBlock(e); }
    };
    $('#gs-class', view).onchange = (e) => { st.cls = e.target.value; $('#gs-year', view).dataset.for = ''; load(); };
    $('#gs-year', view).onchange = (e) => { st.year = e.target.value; load(); };
    $('#gs-scope', view).onchange = (e) => { st.scope = e.target.value; load(); };
    $('#gs-print', view).onclick = () => model && showPrintable('Grade sheet', `<div class="paper print-area gradesheet"><header><div><h2>${esc(CONFIG.SCHOOL.name)}</h2><small>Grade sheet: ${esc(model.title)}</small></div></header>${sheetHtml(model)}</div>`);
    wireExports(view, 'Grade sheet', async () => {
      if (!model) throw new Error('Choose a class first');
      return model.rows.map((r) => ({ Position: r.pos || '', Pupil: r.s.full_name, ...Object.fromEntries(model.cols.map((c, i) => [c.name, r.avgs[i] == null ? '' : r1(r.avgs[i])])), Total: r1(r.total), Average: r.avg == null ? '' : r1(r.avg), Grade: r.avg == null ? '' : gradeFor(r.avg).grade }));
    });
  };
}

const sheetHtml = (m) => `<div class="table-wrap"><table class="table gs-table"><thead><tr><th>Pos</th><th>Pupil</th>${m.cols.map((c) => `<th title="${esc(c.name)}">${esc(c.name.length > 12 ? c.name.slice(0, 11) + '.' : c.name)}</th>`).join('')}<th>Total</th><th>Avg</th><th>Grade</th></tr></thead><tbody>
  ${m.rows.map((r) => `<tr><td>${r.pos || '-'}</td><td><b>${esc(r.s.full_name)}</b></td>${r.avgs.map((v) => `<td>${v == null ? '-' : r1(v)}</td>`).join('')}<td>${r1(r.total)}</td><td><b>${r.avg == null ? '-' : r1(r.avg)}</b></td><td>${r.avg == null ? '-' : badge(gradeFor(r.avg).grade, r.avg >= 50 ? 'ok' : 'bad')}</td></tr>`).join('')}</tbody></table></div>
  <p class="muted" style="padding:10px 16px;font-size:12px">${m.exams} examination${m.exams === 1 ? '' : 's'} counted. Each subject score is the average percentage across them.</p>`;

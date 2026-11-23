// Online quizzes.
//  * Teachers and administrators build and publish multiple-choice quizzes (quizManager).
//  * Students take them once, against a clock the server keeps (studentQuizzes).
//  * Marking happens in the database (submit_quiz), so a score cannot be changed from the browser.
//  * Parents see their child's results (quizResultsView).
import { sb } from '../supabase.js';
import { must, pct } from '../api.js';
import { crudPage } from '../crud.js';
import {
  $, $$, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, emptyState, loadingBlock, errorBlock, fmtDate, fmtDateTime, num,
} from '../ui.js';

const p2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const toIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const pctText = (score, total) => (Number(total) > 0 ? `${num(pct(score, total), 0)}%` : '-');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${p2(Math.floor(s / 60))}:${p2(s % 60)}`; };

/* =========================================================================
   Teacher / administrator: manage quizzes
   ========================================================================= */
export function quizManager({ teacher = null, classOptions, subjectOptions }) {
  return crudPage({
    table: 'quizzes', title: 'Online quizzes', singular: 'quiz', plural: 'quizzes',
    description: 'Build multiple-choice quizzes that are marked automatically. Add the questions, then publish the quiz so students can take it.',
    select: '*, classes(name), subjects(name), quiz_questions(id), quiz_attempts(id,submitted_at)',
    search: ['title'], order: { col: 'created_at', asc: false }, formSize: 'lg',
    baseFilter: teacher ? (q) => q.eq('teacher_id', teacher.id) : undefined,
    columns: [
      { label: 'Quiz', render: (r) => `<b>${esc(r.title)}</b><span class="sub">${esc(r.subjects?.name || 'No subject')}${r.duration_minutes ? ` | ${r.duration_minutes} min` : ' | untimed'}</span>` },
      { label: 'Class', render: (r) => esc(r.classes?.name || '-') },
      { label: 'Questions', cls: 'num', render: (r) => r.quiz_questions.length },
      { label: 'Handed in', cls: 'num', render: (r) => r.quiz_attempts.filter((a) => a.submitted_at).length },
      { label: 'Open window', render: (r) => (r.opens_at || r.closes_at ? `${r.opens_at ? fmtDateTime(r.opens_at) : 'Any time'}<span class="sub">until ${r.closes_at ? fmtDateTime(r.closes_at) : 'no end'}</span>` : 'Always open') },
      { label: 'Status', render: (r) => badge(r.is_published ? 'published' : 'draft') },
    ],
    fields: [
      { name: 'title', label: 'Quiz title', required: true, full: true, maxlength: 150, minlength: 3 },
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: classOptions },
      { name: 'subject_id', label: 'Subject', type: 'select', options: subjectOptions },
      { name: 'duration_minutes', label: 'Time limit (minutes)', type: 'number', min: 1, max: 300, help: 'Leave empty for no time limit.' },
      { name: 'opens_at', label: 'Opens at', type: 'datetime-local', help: 'Leave empty to open as soon as it is published.' },
      { name: 'closes_at', label: 'Closes at', type: 'datetime-local', help: 'Students cannot start the quiz after this time.' },
      { name: 'instructions', label: 'Instructions for students', type: 'textarea', rows: 3, full: true, maxlength: 2000 },
      { name: 'show_answers', label: 'Let students and parents review the right answers after handing in', type: 'checkbox', full: true },
      { name: 'is_published', label: 'Published (students can see and take this quiz)', type: 'checkbox', full: true, hideOnCreate: true },
    ],
    defaults: async () => ({ show_answers: true }),
    toForm: (r) => ({ ...r, opens_at: toLocalInput(r.opens_at), closes_at: toLocalInput(r.closes_at) }),
    beforeSave: async (v, row, isNew) => {
      v.opens_at = toIso(v.opens_at); v.closes_at = toIso(v.closes_at);
      if (v.opens_at && v.closes_at && v.closes_at <= v.opens_at) throw new Error('The closing time must be after the opening time.');
      if (isNew && teacher) v.teacher_id = teacher.id;
      if (!isNew && v.is_published && !row.is_published && !row.quiz_questions.length) throw new Error('Add at least one question before publishing this quiz.');
      return v;
    },
    deleteMessage: (r) => `Delete "${r.title}" together with its questions and every student's attempt? This cannot be undone.`,
    rowActions: (r) => `<button class="icon-btn" data-act="questions" data-id="${r.id}" title="Questions" aria-label="Edit questions">${icon('list', 16)}</button>
      <button class="icon-btn" data-act="results" data-id="${r.id}" title="Results" aria-label="View results">${icon('chart', 16)}</button>`,
    onAction: (act, row, { reload }) => {
      if (act === 'questions') editQuestions(row, reload);
      if (act === 'results') quizResults(row);
    },
  });
}

/* ---------- question builder ---------- */
async function editQuestions(quiz, reload) {
  const m = modal({
    title: `Questions: ${quiz.title}`, size: 'xl', html: loadingBlock(),
    footer: `<button class="btn ghost" data-close>Close</button><button class="btn primary" id="q-save">Save questions</button>`,
  });
  $('#q-save', m.el).hidden = true;
  try {
    const qs = await must(sb.from('quiz_questions').select('id,position,question,options,marks').eq('quiz_id', quiz.id).order('position'));
    const keys = qs.length ? await must(sb.from('quiz_answer_keys').select('question_id,correct_index').in('question_id', qs.map((q) => q.id))) : [];
    const { count } = await sb.from('quiz_attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quiz.id);
    const locked = (count || 0) > 0;
    const keyOf = Object.fromEntries(keys.map((k) => [k.question_id, k.correct_index]));
    let items = qs.map((q) => ({ question: q.question, options: [...q.options], correct: keyOf[q.id] ?? -1, marks: q.marks }));
    if (!items.length) items = [blankQuestion()];
    const dis = locked ? 'disabled' : '';

    m.body.innerHTML = `${locked ? `<div class="notice">${icon('lock', 18)}<span>Students have already started this quiz, so its questions can no longer be changed. Create a new quiz if you need different questions.</span></div>`
      : `<div class="notice">${icon('info', 18)}<span>Type each question and its answer options, then tick the <b>round button</b> beside the right answer. Students never see which one is right until they hand in (if you allow it).</span></div>`}
      <div id="qlist"></div>
      <div class="head-actions" style="margin-top:8px;justify-content:space-between;display:flex;gap:8px;flex-wrap:wrap">
        ${locked ? '' : `<button class="btn ghost" id="q-add">${icon('plus', 16)} Add question</button>`}
        <span class="muted" id="q-sum"></span>
      </div>`;
    const read =() => $$('.qb', m.body).map((el) => ({
      question: $('[name=q]', el).value,
      marks: $('[name=m]', el).value,
      options: $$('[name=o]', el).map((i) => i.value),
      correct: Number($('input[type=radio]:checked', el)?.value ?? -1),
    }));
    const summary = () => {
      const cur = locked ? items : read();
      const total = cur.reduce((a, q) => a + (Number(q.marks) || 0), 0);
      $('#q-sum', m.body).textContent = `${cur.length} question${cur.length === 1 ? '' : 's'} | ${num(total, 2)} marks in total`;
    };
    const draw = () => {
      $('#qlist', m.body).innerHTML = items.map((it, qi) => `<div class="card qb" style="margin-bottom:12px">
        <div class="card-head"><h3>Question ${qi + 1}</h3><div class="row-actions">
          <label class="muted" style="font-size:13px">Marks <input class="input score-input" name="m" type="number" min="0.5" max="100" step="0.5" value="${esc(it.marks)}" ${dis} aria-label="Marks for question ${qi + 1}"></label>
          ${locked || items.length < 2 ? '' : `<button class="icon-btn danger" data-rm="${qi}" title="Remove question" aria-label="Remove question ${qi + 1}">${icon('trash', 16)}</button>`}</div></div>
        <div class="field full" style="margin-bottom:10px"><textarea class="input" name="q" rows="2" maxlength="1000" placeholder="Type the question" aria-label="Question ${qi + 1}" ${dis}>${esc(it.question)}</textarea></div>
        ${it.options.map((o, oi) => `<div class="list-item" style="gap:10px;align-items:center">
          <input type="radio" name="c${qi}" value="${oi}" ${it.correct === oi ? 'checked' : ''} ${dis} aria-label="Option ${oi + 1} is the right answer">
          <input class="input" name="o" maxlength="300" value="${esc(o)}" placeholder="Answer option ${oi + 1}" aria-label="Answer option ${oi + 1}" ${dis}>
          ${!locked && it.options.length > 2 ? `<button class="icon-btn" data-rmo="${qi}:${oi}" title="Remove option" aria-label="Remove option ${oi + 1}">${icon('x', 16)}</button>` : ''}</div>`).join('')}
        ${!locked && it.options.length < 6 ? `<button class="btn ghost sm" data-addo="${qi}" style="margin-top:8px">${icon('plus', 15)} Add option</button>` : ''}</div>`).join('');
      summary();
    };
    draw();

    if (locked) return;
    $('#q-save', m.el).hidden = false;
    m.body.addEventListener('input', summary);
    m.body.addEventListener('click', (e) => {
      const add = e.target.closest('#q-add'), rm = e.target.closest('[data-rm]'), ao = e.target.closest('[data-addo]'), ro = e.target.closest('[data-rmo]');
      if (!add && !rm && !ao && !ro) return;
      items = read();
      if (add) { items.push(blankQuestion()); }
      if (rm) items.splice(Number(rm.dataset.rm), 1);
      if (ao) items[Number(ao.dataset.addo)].options.push('');
      if (ro) {
        const [qi, oi] = ro.dataset.rmo.split(':').map(Number);
        items[qi].options.splice(oi, 1);
        if (items[qi].correct === oi) items[qi].correct = -1; else if (items[qi].correct > oi) items[qi].correct -= 1;
      }
      draw();
      if (add) $$('.qb', m.body).at(-1)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#q-save', m.el).onclick = async (e) => {
      const data = read();
      for (let i = 0; i < data.length; i++) {
        const d = data[i], n = i + 1;
        if (d.question.trim().length < 3) return toast(`Question ${n} needs some text`, 'error');
        if (d.options.some((o) => !o.trim())) return toast(`Question ${n} has an empty answer option`, 'error');
        if (new Set(d.options.map((o) => o.trim().toLowerCase())).size !== d.options.length) return toast(`Question ${n} has two identical answer options`, 'error');
        if (d.correct < 0) return toast(`Choose the right answer for question ${n}`, 'error');
        if (!(Number(d.marks) > 0 && Number(d.marks) <= 100)) return toast(`Question ${n} needs marks between 0.5 and 100`, 'error');
      }
      setBusy(e.currentTarget, true, 'Saving');
      try {
        await must(sb.rpc('save_quiz_questions', {
          p_quiz: quiz.id,
          p_questions: data.map((d) => ({ question: d.question.trim(), options: d.options.map((o) => o.trim()), correct: d.correct, marks: Number(d.marks) })),
        }));
        toast('Questions saved'); m.close(); reload?.();
      } catch (err) { fail(err); setBusy(e.currentTarget, false); }
    };
  } catch (e) { m.body.innerHTML = errorBlock(e); }
}
const blankQuestion = () => ({ question: '', options: ['', '', '', ''], correct: -1, marks: 1 });

/* ---------- results for one quiz ---------- */
async function quizResults(quiz) {
  const m = modal({ title: `Results: ${quiz.title}`, size: 'xl', html: loadingBlock() });
  try {
    const [atts, studs] = await Promise.all([
      must(sb.from('quiz_attempts').select('*, students(full_name,student_no)').eq('quiz_id', quiz.id).limit(1000)),
      must(sb.from('students').select('id,full_name').eq('class_id', quiz.class_id).eq('status', 'active').limit(500)),
    ]);
    const done = atts.filter((a) => a.submitted_at).sort((a, b) => Number(b.score) - Number(a.score));
    const open = atts.filter((a) => !a.submitted_at);
    const missing = studs.filter((s) => !atts.some((a) => a.student_id === s.id));
    const avg = done.length ? done.reduce((t, a) => t + pct(a.score, a.total), 0) / done.length : null;
    m.body.innerHTML = `<div class="stats">
        <div class="stat ok"><span class="ico">${icon('check', 22)}</span><div><b>${done.length}/${studs.length}</b><span>Handed in</span></div></div>
        <div class="stat gold"><span class="ico">${icon('clock', 22)}</span><div><b>${open.length}</b><span>Started, not handed in</span></div></div>
        <div class="stat info"><span class="ico">${icon('chart', 22)}</span><div><b>${avg == null ? '-' : num(avg, 0) + '%'}</b><span>Class average</span></div></div></div>
      ${tableHtml({
        columns: [
          { label: 'Student', render: (a) => `<b>${esc(a.students?.full_name)}</b><span class="sub">${esc(a.students?.student_no || '')}</span>` },
          { label: 'Score', cls: 'num', render: (a) => `${num(a.score, 2)} / ${num(a.total, 2)}` },
          { label: '%', cls: 'num', render: (a) => pctText(a.score, a.total) },
          { label: 'Handed in', render: (a) => `${fmtDateTime(a.submitted_at)}${a.overtime ? ` ${badge('over time', 'warn')}` : ''}` },
          { label: '', cls: 'actions', render: (a) => `<button class="btn ghost sm" data-review="${a.student_id}">Review</button>` },
        ], rows: done, empty: 'Nobody has handed this quiz in yet',
      })}
      ${open.length ? `<p class="muted" style="margin-top:12px">Started but not handed in: ${esc(open.map((a) => a.students?.full_name).join(', '))}.</p>` : ''}
      ${missing.length ? `<p class="muted" style="margin-top:8px">Not started: ${esc(missing.map((s) => s.full_name).join(', '))}.</p>` : ''}`;
    m.body.onclick = (e) => {
      const b = e.target.closest('[data-review]'); if (!b) return;
      const a = done.find((x) => x.student_id === b.dataset.review);
      reviewAttempt(quiz.id, b.dataset.review, `${a?.students?.full_name || 'Student'}: ${quiz.title}`);
    };
  } catch (e) { m.body.innerHTML = errorBlock(e); }
}

/* ---------- question-by-question review (teacher, student or parent) ---------- */
export async function reviewAttempt(quizId, studentId, heading) {
  const m = modal({ title: heading, size: 'lg', html: loadingBlock() });
  try {
    const rows = await must(sb.rpc('quiz_review', { p_quiz: quizId, p_student: studentId }));
    m.body.innerHTML = rows.length ? rows.map((q, i) => {
      const right = q.answer === q.correct;
      return `<div class="card" style="margin-bottom:12px"><div class="card-head"><h3>${i + 1}. ${esc(q.question)}</h3>${badge(right ? 'correct' : q.answer == null ? 'not answered' : 'wrong', right ? 'ok' : 'bad')}</div>
        <div class="list">${q.options.map((o, oi) => `<div class="list-item"><span>${esc(o)}</span><span>${oi === q.correct ? badge('right answer', 'ok') : ''} ${oi === q.answer ? badge('chosen', right ? 'ok' : 'bad') : ''}</span></div>`).join('')}</div></div>`;
    }).join('') : emptyState('No questions', '', 'list');
  } catch (e) { m.body.innerHTML = errorBlock(e); }
}

/* =========================================================================
   Student: list quizzes and take them
   ========================================================================= */
export async function studentQuizzes(view, ctx, s) {
  if (!s.class_id) { view.innerHTML = emptyState('You are not in a class yet', '', 'class'); return; }
  const [quizzes, attempts] = await Promise.all([
    must(sb.from('quizzes').select('*, subjects(name)').eq('class_id', s.class_id).order('created_at', { ascending: false }).limit(100)),
    must(sb.from('quiz_attempts').select('*').eq('student_id', s.id).limit(500)),
  ]);
  const by = Object.fromEntries(attempts.map((a) => [a.quiz_id, a]));
  const now = Date.now();
  view.innerHTML = `<div class="page-head"><div><h2>Quizzes</h2><p class="muted">Online quizzes from your teachers. You get one attempt at each quiz and it is marked as soon as you hand it in.</p></div></div>` +
    (quizzes.length ? `<div class="grid cols-2">${quizzes.map((q) => {
      const a = by[q.id];
      const opens = q.opens_at ? new Date(q.opens_at).getTime() : null, closes = q.closes_at ? new Date(q.closes_at).getTime() : null;
      let state, action = '';
      if (a?.submitted_at) {
        state = badge(`${num(a.score, 2)} / ${num(a.total, 2)} (${pctText(a.score, a.total)})`, 'ok');
        action = q.show_answers ? `<button class="btn ghost sm" data-review="${q.id}">${icon('eye', 15)} Review answers</button>` : '<span class="muted">Answers are not shown for this quiz.</span>';
      } else if (a) {
        state = badge('in progress', 'warn');
        action = `<button class="btn primary sm" data-take="${q.id}">${icon('clock', 15)} Continue</button>`;
      } else if (opens && now < opens) {
        state = badge('not open yet', 'muted'); action = `<span class="muted">Opens ${fmtDateTime(q.opens_at)}</span>`;
      } else if (closes && now > closes) {
        state = badge('closed', 'bad'); action = '<span class="muted">You did not take this quiz.</span>';
      } else {
        state = badge('available', 'info');
        action = `<button class="btn primary sm" data-take="${q.id}">${icon('send', 15)} Start quiz</button>`;
      }
      return `<article class="card"><div class="card-head"><div><h3 style="margin:0">${esc(q.title)}</h3><small class="muted">${esc(q.subjects?.name || '')}${q.duration_minutes ? ` | ${q.duration_minutes} minutes` : ' | no time limit'}${q.closes_at ? ` | closes ${fmtDateTime(q.closes_at)}` : ''}</small></div>${state}</div>
        ${q.instructions ? `<p style="white-space:pre-wrap;margin-bottom:12px">${esc(q.instructions)}</p>` : ''}${action}</article>`;
    }).join('')}</div>` : emptyState('No quizzes yet', 'Your teachers have not published any quizzes for your class.', 'clipboard'));

  const reload = () => studentQuizzes(view, ctx, s);
  // onclick (not addEventListener) so re-rendering this page never stacks a second handler
  view.onclick = async (e) => {
    const take = e.target.closest('[data-take]'), rev = e.target.closest('[data-review]');
    if (rev) { const q = quizzes.find((x) => x.id === rev.dataset.review); return reviewAttempt(q.id, s.id, q.title); }
    if (!take) return;
    const q = quizzes.find((x) => x.id === take.dataset.take);
    if (!by[q.id]) {
      const ok = await confirmBox({
        title: `Start "${q.title}"?`, confirmText: 'Start now',
        message: `You only get one attempt.${q.duration_minutes ? ` The ${q.duration_minutes}-minute clock starts immediately and keeps running even if you close this window.` : ''} Make sure you have a steady connection.`,
      });
      if (!ok) return;
    }
    takeQuiz(q, s, reload);
  };
}

async function takeQuiz(quiz, student, onClose) {
  let info, qs;
  try {
    info = await must(sb.rpc('start_quiz', { p_quiz: quiz.id }));
    qs = await must(sb.from('quiz_questions').select('id,position,question,options,marks').eq('quiz_id', quiz.id).order('position'));
  } catch (e) { fail(e); onClose?.(); return; }

  // The clock is the server's: measure how far this device is from it.
  const skew = Date.now() - new Date(info.server_now).getTime();
  const deadline = quiz.duration_minutes ? new Date(info.started_at).getTime() + quiz.duration_minutes * 60000 + skew : null;
  const store = `quiz-${quiz.id}`;
  let picked = {};
  try { picked = JSON.parse(sessionStorage.getItem(store) || '{}') || {}; } catch { picked = {}; }
  const valid = new Set(qs.map((q) => q.id));
  Object.keys(picked).forEach((k) => { if (!valid.has(k)) delete picked[k]; });
  const keep = () => { try { sessionStorage.setItem(store, JSON.stringify(picked)); } catch { /* ignore */ } };

  const m = modal({
    title: quiz.title, size: 'xl',
    html: `<div class="notice" id="q-timer" style="position:sticky;top:0;z-index:2;justify-content:space-between;align-items:center">
        <span>${icon('clock', 18)} ${deadline ? 'Time left' : 'No time limit'}</span><b id="q-left" style="font-variant-numeric:tabular-nums">${deadline ? mmss(deadline - Date.now()) : ''}</b></div>
      ${quiz.instructions ? `<p class="muted" style="white-space:pre-wrap;margin-bottom:14px">${esc(quiz.instructions)}</p>` : ''}
      <div id="q-body">${qs.map((q, i) => `<fieldset class="card" style="margin-bottom:12px;border:1px solid var(--line)"><legend style="padding:0 6px;font-weight:700">Question ${i + 1} <span class="muted" style="font-weight:400">(${num(q.marks, 2)} mark${Number(q.marks) === 1 ? '' : 's'})</span></legend>
        <p style="margin-bottom:10px;white-space:pre-wrap">${esc(q.question)}</p>
        ${q.options.map((o, oi) => `<label class="check" style="display:flex;margin-bottom:6px"><input type="radio" name="a-${q.id}" value="${oi}" ${picked[q.id] === oi ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}</div>`,
    footer: `<span class="muted" id="q-count" style="margin-right:auto"></span><button class="btn primary" id="q-submit">Hand in quiz</button>`,
  });
  // Stop a stray click outside the window from throwing the quiz away
  $('.modal-backdrop', m.el)?.removeAttribute('data-close');
  const count = () => { $('#q-count', m.el).textContent = `${Object.keys(picked).length} of ${qs.length} answered`; };
  count();
  m.body.addEventListener('change', (e) => {
    const r = e.target.closest('input[type=radio]'); if (!r) return;
    picked[r.name.replace(/^a-/, '')] = Number(r.value); keep(); count();
  });

  let finished = false, tick = null;
  const btn = $('#q-submit', m.el);
  const submit = async (auto) => {
    if (finished) return;
    const blank = qs.length - Object.keys(picked).length;
    if (!auto && blank) {
      const ok = await confirmBox({ title: 'Hand in with unanswered questions?', message: `${blank} question${blank === 1 ? ' has' : 's have'} no answer yet. Unanswered questions score zero.`, confirmText: 'Hand in anyway' });
      if (!ok || finished) return;
    }
    finished = true; clearInterval(tick); setBusy(btn, true, 'Handing in');
    try {
      const res = await must(sb.rpc('submit_quiz', { p_quiz: quiz.id, p_answers: picked }));
      try { sessionStorage.removeItem(store); } catch { /* ignore */ }
      $('#q-timer', m.el)?.remove();
      m.body.innerHTML = `<div class="state">${icon('check', 40)}<h4>${auto ? 'Time is up. Your quiz was handed in.' : 'Quiz handed in'}</h4>
        <p style="font-size:22px;font-weight:800;margin:6px 0">${num(res.score, 2)} out of ${num(res.total, 2)} (${pctText(res.score, res.total)})</p>
        ${quiz.show_answers ? `<button class="btn ghost" id="q-rev">${icon('eye', 15)} Review the right answers</button>` : ''}</div>`;
      $('#q-rev', m.body)?.addEventListener('click', () => reviewAttempt(quiz.id, student.id, quiz.title));
      btn.remove();
    } catch (err) { finished = false; fail(err); setBusy(btn, false); if (deadline) startTick(); }
  };
  btn.onclick = () => submit(false);

  function startTick() {
    clearInterval(tick);
    const step = () => {
      const left = deadline - Date.now();
      const el = $('#q-left', m.el); if (el) { el.textContent = mmss(left); el.style.color = left < 60000 ? 'var(--bad)' : ''; }
      if (left <= 0) { clearInterval(tick); toast('Time is up. Handing in your answers.', 'info'); submit(true); }
    };
    tick = setInterval(step, 1000); step();
  }
  if (deadline) startTick();

  // If the window is closed, stop the timer and refresh the list behind it
  const obs = new MutationObserver(() => {
    if (!document.body.contains(m.el)) { clearInterval(tick); obs.disconnect(); onClose?.(); }
  });
  obs.observe(document.body, { childList: true });
}

/* =========================================================================
   Parent: a child's quiz results
   ========================================================================= */
export async function quizResultsView(view, studentId) {
  const rows = await must(sb.from('quiz_attempts')
    .select('id,quiz_id,score,total,submitted_at,overtime,quizzes(title,show_answers,subjects(name))')
    .eq('student_id', studentId).not('submitted_at', 'is', null).order('submitted_at', { ascending: false }).limit(100));
  view.innerHTML = `<div class="page-head"><div><h2>Quiz results</h2><p class="muted">Scores from online quizzes your child has handed in.</p></div></div>
    <div class="card flush">${tableHtml({
      columns: [
        { label: 'Quiz', render: (r) => `<b>${esc(r.quizzes?.title || 'Quiz')}</b><span class="sub">${esc(r.quizzes?.subjects?.name || '')}</span>` },
        { label: 'Score', cls: 'num', render: (r) => `${num(r.score, 2)} / ${num(r.total, 2)}` },
        { label: '%', cls: 'num', render: (r) => pctText(r.score, r.total) },
        { label: 'Handed in', render: (r) => fmtDate(r.submitted_at) },
        { label: '', cls: 'actions', render: (r) => (r.quizzes?.show_answers ? `<button class="btn ghost sm" data-review="${r.quiz_id}">Review</button>` : '') },
      ], rows, empty: 'No quiz results yet', emptyText: 'Results appear here once your child hands in a quiz.',
    })}</div>`;
  view.onclick = (e) => {
    const b = e.target.closest('[data-review]'); if (!b) return;
    const r = rows.find((x) => x.quiz_id === b.dataset.review);
    reviewAttempt(b.dataset.review, studentId, r?.quizzes?.title || 'Quiz');
  };
}

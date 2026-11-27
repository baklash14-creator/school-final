// Smart assistant: free, on-device helpers (no AI service, no cost, no data leaves the browser).
// Pure functions so they can be tested. They draft; a person always reviews.
const r0 = (n) => Math.round(n);
const first = (name) => String(name || 'The pupil').trim().split(/\s+/)[0];
const pron = (g) => (g === 'female' ? { s: 'she', o: 'her', p: 'her', S: 'She' } : g === 'male' ? { s: 'he', o: 'him', p: 'his', S: 'He' } : { s: 'they', o: 'them', p: 'their', S: 'They' });
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1));
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/* ---- subject strengths from rows [{subject, pct}] ---- */
export function strengths(rows, n = 2) {
  const by = new Map();
  for (const r of rows) { const a = by.get(r.subject) || []; a.push(r.pct); by.set(r.subject, a); }
  const avg = [...by].map(([subject, a]) => ({ subject, pct: a.reduce((x, y) => x + y, 0) / a.length })).sort((a, b) => b.pct - a.pct);
  return { all: avg, best: avg.filter((x) => x.pct >= 60).slice(0, n), weak: avg.filter((x) => x.pct < 50).slice(-n).reverse() };
}

/* ---- report card comment ---- */
export function reportComment({ name, gender, avg, best = [], weak = [], attendancePct = null, commendations = 0, incidents = 0, trend = 0 }) {
  const n = first(name), p = pron(gender), seed = hash(name);
  const level = avg >= 80 ? 'an outstanding' : avg >= 70 ? 'a very good' : avg >= 60 ? 'a good' : avg >= 50 ? 'a fair' : 'a weak';
  const out = [`${n} has had ${level} term with an average of ${r0(avg)}%.`];
  if (best.length) out.push(`${p.S} did especially well in ${list(best)}.`);
  if (weak.length) out.push(`${p.S} needs more practice in ${list(weak)}.`);
  if (trend >= 5) out.push(`${p.p[0].toUpperCase() + p.p.slice(1)} results have improved, which is encouraging.`);
  else if (trend <= -5) out.push(`${p.p[0].toUpperCase() + p.p.slice(1)} results have dropped since the last term and need attention.`);
  if (attendancePct != null) {
    if (attendancePct < 85) out.push(`Attendance is ${r0(attendancePct)}%; ${p.s} must attend school more regularly.`);
    else if (attendancePct >= 97) out.push(`${p.p[0].toUpperCase() + p.p.slice(1)} attendance has been excellent.`);
  }
  if (incidents >= 3) out.push(`${n} must work on ${p.p} conduct in class.`);
  else if (commendations >= 2 && incidents === 0) out.push(`${n} is a polite and well-behaved pupil.`);
  out.push(avg >= 70 ? pick(['Keep up the good work.', 'Well done, keep it up.'], seed)
    : avg >= 50 ? pick([`With more effort, ${n} can do even better.`, `${n} can reach ${p.p} full potential with steady revision.`], seed)
    : pick([`${n} needs extra support and daily revision at home.`, `We encourage regular revision and extra help to improve.`], seed));
  return out.join(' ');
}

/* ---- plain-language result explainer for families ---- */
export function explainResults({ name, gender, rows, prevAvg = null, gradeOf }) {
  if (!rows.length) return { summary: 'No published results yet.', tips: [] };
  const n = first(name), avg = rows.reduce((a, r) => a + r.pct, 0) / rows.length, s = strengths(rows);
  const parts = [`${n}'s overall average is ${r0(avg)}% (${gradeOf ? gradeOf(avg).grade || gradeOf(avg).name || '' : ''}).`.replace(' ().', '.')];
  if (s.best.length) parts.push(`Strongest: ${list(s.best.map((x) => `${x.subject} (${r0(x.pct)}%)`))}.`);
  if (s.weak.length) parts.push(`Needs help: ${list(s.weak.map((x) => `${x.subject} (${r0(x.pct)}%)`))}.`);
  if (prevAvg != null) { const d = avg - prevAvg; parts.push(Math.abs(d) < 2 ? 'This is about the same as the previous exam.' : d > 0 ? `This is ${r0(d)} points higher than the previous exam.` : `This is ${r0(-d)} points lower than the previous exam.`); }
  const tips = [];
  if (s.weak.length) tips.push(`Spend 20 to 30 minutes a day on ${s.weak[0].subject}; start with past questions.`);
  if (s.weak.length > 1) tips.push(`Then move on to ${s.weak[1].subject} using class notes.`);
  if (avg < 50) tips.push('Ask the class teacher about extra lessons or a study group.');
  if (avg >= 70) tips.push('Keep the routine and try harder past questions to stay ahead.');
  tips.push('Sleep well, eat before school, and revise a little every day rather than all at once.');
  return { summary: parts.join(' '), tips, avg };
}

/* ---- at-risk pupils ---- */
export function riskFor({ attendancePct = null, absentRecent = 0, avg = null, prevAvg = null, incidents = 0, serious = 0, balancePct = 0 }) {
  const why = []; let score = 0;
  if (attendancePct != null && attendancePct < 80) { score += 3; why.push(`attendance ${r0(attendancePct)}%`); } else if (attendancePct != null && attendancePct < 90) { score += 1; why.push(`attendance ${r0(attendancePct)}%`); }
  if (absentRecent >= 3) { score += 2; why.push(`${absentRecent} absences in the last 2 weeks`); }
  if (avg != null && avg < 40) { score += 3; why.push(`average ${r0(avg)}%`); } else if (avg != null && avg < 50) { score += 2; why.push(`average ${r0(avg)}%`); }
  if (avg != null && prevAvg != null && prevAvg - avg >= 10) { score += 2; why.push(`average fell ${r0(prevAvg - avg)} points`); }
  if (serious > 0) { score += 3; why.push('serious conduct record'); } else if (incidents >= 3) { score += 2; why.push(`${incidents} conduct incidents`); }
  if (balancePct >= 0.75) { score += 1; why.push('large unpaid fees'); }
  return { score, level: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low', why };
}

/* ---- announcement writer ---- */
export function writeAnnouncement({ kind = 'notice', topic, date = '', time = '', place = '', details = [], school = 'the school', signer = 'The Principal' }) {
  const fmt = (d) => { if (!d) return ''; const t = new Date(d + 'T00:00:00'); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
  const when = [fmt(date), time && `at ${time}`].filter(Boolean).join(' ');
  const opener = { event: `${school} invites parents, guardians and pupils to ${topic}${when ? ` on ${when}` : ''}${place ? ` at ${place}` : ''}.`,
    notice: `Please note the following notice from ${school} about ${topic}${when ? `, effective ${when}` : ''}.`,
    news: `We are pleased to share news from ${school}: ${topic}${when ? ` (${when})` : ''}.` }[kind] || '';
  const body = [opener, ...(details.length ? ['', details.length > 1 ? 'Key points:' : '', ...details.map((d) => `• ${d}`)] : []), '', 'Thank you for your continued support.', '', signer].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  const title = kind === 'event' ? `Invitation: ${topic}` : kind === 'news' ? topic : `Notice: ${topic}`;
  return { title: title.slice(0, 150), body };
}

/* ---- lesson plan template ---- */
export function lessonPlan({ subject, topic, level, minutes = 40, objectives = [], resources = '' }) {
  const m = Math.max(20, Math.min(120, +minutes || 40)), a = r0(m * 0.1), b = r0(m * 0.25), c = r0(m * 0.3), d = r0(m * 0.2), e = m - a - b - c - d;
  const obj = objectives.length ? objectives : [`explain the main ideas of ${topic}`, `solve or answer simple questions on ${topic}`, `apply ${topic} to a real-life example`];
  return [`LESSON PLAN`, `Subject: ${subject}    Class: ${level}    Topic: ${topic}    Time: ${m} minutes`, '',
    'Objectives. By the end of the lesson pupils should be able to:', ...obj.map((o, i) => `  ${i + 1}. ${o}`), '',
    `Resources: ${resources || 'chalkboard, textbook, charts or real objects'}`, '',
    `1. Introduction (${a} min): greet the class, check homework and ask 2 or 3 questions to link to the last lesson.`,
    `2. Presentation (${b} min): introduce ${topic}, explain key words, and give worked examples on the board.`,
    `3. Guided practice (${c} min): pupils work examples in pairs while the teacher moves around and corrects.`,
    `4. Independent practice (${d} min): each pupil answers 3 to 5 questions alone.`,
    `5. Conclusion (${e} min): summarise, answer questions, and set homework on ${topic}.`, '',
    `Assessment: oral questions during the lesson and marking of the independent practice.`, 'Homework: ________________________'].join('\n');
}

/* ---- quiz from notes (fill-the-gap multiple choice) ---- */
const STOP = new Set('the a an and or but of to in on at for with by from as is are was were be been it its this that these those which who whom what when where why how not no yes can may will would should could has have had do does did into than then so such also very more most other some any each both many much'.split(' '));
export function quizFromNotes(notes, count = 5) {
  const sents = String(notes).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 6 && s.length <= 220);
  const words = (s) => s.match(/[A-Za-z][A-Za-z'-]{3,}/g) || [];
  const pool = [...new Set(sents.flatMap((s) => words(s).filter((w) => !STOP.has(w.toLowerCase())).map((w) => w.toLowerCase())))];
  const out = [];
  for (const [i, s] of sents.entries()) {
    if (out.length >= count) break;
    const cands = words(s).filter((w) => !STOP.has(w.toLowerCase()) && w.length >= 5);
    const answer = cands.sort((x, y) => y.length - x.length)[0]; if (!answer) continue;
    const low = answer.toLowerCase(), near = pool.filter((w) => w !== low && Math.abs(w.length - low.length) <= 3 && w[0] !== low[0]);
    const dist = [...new Set(near.sort((x, y) => hash(x + i) - hash(y + i)).slice(0, 3))];
    if (dist.length < 3) continue;
    const cap = (w) => (answer[0] === answer[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w);
    const options = [answer, ...dist.map(cap)].sort((x, y) => hash(x + i) - hash(y + i));
    out.push({ question: s.replace(new RegExp(`\\b${answer}\\b`), '________'), options, correct: options.indexOf(answer), marks: 1 });
  }
  return out;
}

/* ---- essay / short answer check against teacher's key points ---- */
const stem = (w) => w.toLowerCase().replace(/(ing|ed|es|s)$/, '');
export function essayCheck(answer, keyPoints, maxMarks = 10) {
  const text = String(answer).toLowerCase(), toks = new Set((text.match(/[a-z']+/g) || []).map(stem));
  const found = [], missing = [];
  for (const kp of keyPoints.map((k) => k.trim()).filter(Boolean)) {
    const w = (kp.toLowerCase().match(/[a-z']{3,}/g) || []).filter((x) => !STOP.has(x)).map(stem);
    const hit = w.length ? w.filter((x) => toks.has(x)).length / w.length : 0;
    (hit >= 0.5 ? found : missing).push(kp);
  }
  const total = found.length + missing.length, words = (text.match(/[a-z']+/g) || []).length;
  const mark = total ? Math.round((found.length / total) * maxMarks * 2) / 2 : 0;
  const notes = [];
  if (words < 15) notes.push('The answer is very short; ask for more explanation.');
  if (missing.length) notes.push(`Not covered: ${missing.join('; ')}.`);
  if (!missing.length && total) notes.push('All key points are covered.');
  return { mark, max: maxMarks, found, missing, notes: notes.join(' '), words };
}

/* ---- admission screening ---- */
export function screenApplication(a, today = new Date()) {
  const flags = [], ok = [];
  if (!a.date_of_birth) flags.push('No date of birth'); else {
    const age = (today - new Date(a.date_of_birth)) / 31557600000;
    const range = { Nursery: [2.5, 6.5], Primary: [5, 13], 'Junior Secondary': [10, 16], 'Senior Secondary': [13, 20] }[a.grade_applying];
    if (range && (age < range[0] || age > range[1])) flags.push(`Age ${age.toFixed(1)} is unusual for ${a.grade_applying}`); else ok.push('Age fits the level');
  }
  if (!a.gender) flags.push('Gender not given');
  if (!a.parent_email) flags.push('No parent email (contact by phone only)');
  const digits = String(a.parent_phone || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) flags.push('Phone number looks wrong');
  if (!a.address) flags.push('No address');
  if (!a.previous_school && a.grade_applying && a.grade_applying !== 'Nursery') flags.push('No previous school given');
  if (a.parent_name && a.applicant_name && a.parent_name.trim().toLowerCase() === a.applicant_name.trim().toLowerCase()) flags.push('Parent and child names are identical');
  return { flags, ok, summary: `${a.applicant_name} applies for ${a.grade_applying}${a.previous_school ? `, from ${a.previous_school}` : ''}. ${flags.length ? `${flags.length} thing${flags.length > 1 ? 's' : ''} to check.` : 'Looks complete.'}` };
}

/* ---- school bot: answers from school data, never invented ---- */
export function schoolBot(q, { faq = [], ctx = {} }) {
  const t = String(q).toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  if (has('balance', 'owe', 'fee') && ctx.balance != null) return ctx.balance > 0 ? `The outstanding fee balance is ${ctx.money(ctx.balance)}. Open Fees to see items and receipts.` : 'There is no outstanding fee balance. Open Fees for receipts.';
  if (has('result', 'score', 'grade', 'average') && ctx.avg != null) return `The latest published average is ${Math.round(ctx.avg)}%. Open Results for each subject.`;
  if (has('absent', 'attendance', 'present') && ctx.attendancePct != null) return `Attendance so far is ${Math.round(ctx.attendancePct)}%. Open Attendance for the daily record.`;
  if (has('event', 'holiday', 'term start', 'when is', 'next') && ctx.nextEvent) return `Next on the calendar: ${ctx.nextEvent}.`;
  const words = t.match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) || [];
  let best = null, bs = 0;
  for (const f of faq) { const hay = `${f.q} ${f.a}`.toLowerCase(); const s = words.filter((w) => hay.includes(w)).length; if (s > bs) { bs = s; best = f; } }
  return best && bs >= 1 ? best.a : 'I do not have that information. Please call or visit the school office, or send a message to the class teacher.';
}

/* ---- smart reports: map a plain question to a known report ---- */
export function reportIntent(q) {
  const t = String(q).toLowerCase(), has = (...w) => w.some((x) => t.includes(x));
  const dir = has('lowest', 'worst', 'least', 'poor', 'bottom', 'weak') ? 'low' : 'high';
  if (has('owe', 'debt', 'unpaid', 'defaulter', 'outstanding', 'balance')) return { key: 'fees', dir: 'high' };
  if (has('attendance', 'absent', 'absence', 'present')) return { key: 'attendance', dir: has('highest', 'best', 'most present') ? 'high' : 'low', by: has('pupil', 'student') ? 'student' : 'class' };
  if (has('score', 'result', 'average', 'perform', 'top', 'best', 'grade')) return { key: 'results', dir: has('top', 'best', 'highest') ? 'high' : dir, by: has('pupil', 'student', 'top') ? 'student' : 'class' };
  if (has('conduct', 'discipline', 'incident', 'behaviour', 'behavior')) return { key: 'conduct', dir: 'high' };
  return null;
}

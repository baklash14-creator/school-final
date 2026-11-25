// Scan check-in (pupils and staff) and the staff attendance register and report.
//  * Scan station: a USB barcode scanner (or the camera, where the browser supports it) reads the ID card barcode,
//    which holds the student number or staff number. Typing the number and pressing Enter works too.
//  * Staff attendance: daily register, monthly report and printable staff badges.
import { sb } from '../supabase.js';
import { must } from '../api.js';
import { CONFIG } from '../config.js';
import { code39Svg } from './people-tools.js';
import { showPrintable } from './shared.js';
import { $, $$, esc, icon, toast, fail, setBusy, badge, tableHtml, loadingBlock, errorBlock, fmtDate, today, pad, exportButtons, wireExports, LOGO } from '../ui.js';

const KEY = 'aiass_late_after';
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const lateAfter = () => { try { return localStorage.getItem(KEY) || '08:00'; } catch { return '08:00'; } };
const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;

function beep(ok) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.35));
  } catch { /* sound is optional */ }
}

/* ---------------------------------------------------------------- scan station */
export function scanStation() {
  return async (view) => {
    const st = { mode: 'student', feed: [], counts: { in: 0, late: 0, miss: 0 }, cam: null };
    view.innerHTML = `<div class="page-head"><div><h2>Scan attendance</h2><p class="muted">Scan an ID card barcode, or type the number and press Enter. Arrivals after the cut-off time are marked late.</p></div></div>
      <div class="card scan-card">
        <div class="seg" id="sc-mode" role="tablist"><button class="active" data-m="student">Pupils</button><button data-m="staff">Staff</button></div>
        <div class="scan-row"><label class="field"><span class="lbl">Late after</span><input type="time" class="input" id="sc-late" value="${lateAfter()}"></label>
          <label class="field scan-in"><span class="lbl" id="sc-lbl">Student number</span><input class="input scan-input" id="sc-in" autocomplete="off" autofocus placeholder="Scan or type, then Enter" inputmode="text" aria-label="Scan or type the number"></label>
          ${'BarcodeDetector' in window ? `<button class="btn ghost" id="sc-cam" type="button">${icon('camera', 16)} Use camera</button>` : ''}</div>
        <video id="sc-vid" class="scan-vid" hidden playsinline muted></video>
        <div id="sc-res" class="scan-res" aria-live="assertive"></div>
        <div class="stats"><div class="stat ok"><span class="ico">${icon('check', 22)}</span><div><b id="sc-n-in">0</b><span>On time</span></div></div>
          <div class="stat gold"><span class="ico">${icon('clock', 22)}</span><div><b id="sc-n-late">0</b><span>Late</span></div></div>
          <div class="stat bad"><span class="ico">${icon('x', 22)}</span><div><b id="sc-n-miss">0</b><span>Not recognised</span></div></div></div>
      </div>
      <div class="card"><div class="card-head"><h3>Recent scans</h3></div><div id="sc-feed"></div></div>`;
    const input = $('#sc-in', view), res = $('#sc-res', view);
    const drawFeed = () => { $('#sc-feed', view).innerHTML = st.feed.length ? `<div class="list">${st.feed.slice(0, 12).map((f) => `<div class="list-item"><div><b>${esc(f.name)}</b><span class="sub">${esc(f.sub)}</span></div>${badge(f.label, f.tone)}<span class="muted">${esc(f.at)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing scanned yet this session.</p>'; };
    const show = (ok, title, sub) => { res.className = `scan-res ${ok ? 'ok' : 'bad'}`; res.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`; beep(ok); };
    $('#sc-late', view).onchange = (e) => { try { localStorage.setItem(KEY, e.target.value); } catch { /* ignore */ } };
    $('#sc-mode', view).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.m;
      $$('#sc-mode button', view).forEach((x) => x.classList.toggle('active', x === b));
      $('#sc-lbl', view).textContent = st.mode === 'student' ? 'Student number' : 'Staff number'; res.innerHTML = ''; input.focus();
    };
    let busy = false;
    const handle = async (raw) => {
      const code = String(raw || '').trim().toUpperCase().replace(/[^0-9A-Z\-. ]/g, ''); if (!code || busy) return; busy = true;
      try {
        const late = nowHM() > $('#sc-late', view).value, status = late ? 'late' : 'present', at = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        if (st.mode === 'student') {
          const s = await must(sb.from('students').select('id,full_name,student_no,class_id,status,classes(name)').ilike('student_no', code).maybeSingle());
          if (!s || s.status !== 'active' || !s.class_id) { st.counts.miss++; show(false, 'Not recognised', `No active pupil with number ${code}`); }
          else {
            const ex = await must(sb.from('attendance').select('id,status').eq('student_id', s.id).eq('attendance_date', today()).maybeSingle());
            if (ex && ex.status !== 'absent') show(true, `${s.full_name}: already in`, `Marked ${ex.status} earlier today`);
            else {
              await must(sb.from('attendance').upsert({ student_id: s.id, class_id: s.class_id, attendance_date: today(), status, note: `Scanned ${at}` }, { onConflict: 'student_id,attendance_date' }));
              st.counts[late ? 'late' : 'in']++; st.feed.unshift({ name: s.full_name, sub: s.classes?.name || '', label: status, tone: late ? 'warn' : 'ok', at }); show(true, s.full_name, `${s.classes?.name || ''} | ${late ? 'Late' : 'On time'} at ${at}`);
            }
          }
        } else {
          const t = await must(sb.from('teachers').select('id,full_name,staff_no,status,job_title').ilike('staff_no', code).maybeSingle());
          if (!t || t.status !== 'active') { st.counts.miss++; show(false, 'Not recognised', `No active staff member with number ${code}`); }
          else {
            const ex = await must(sb.from('staff_attendance').select('id,status').eq('teacher_id', t.id).eq('attendance_date', today()).maybeSingle());
            if (ex && ex.status !== 'absent') show(true, `${t.full_name}: already in`, `Marked ${ex.status} earlier today`);
            else {
              await must(sb.from('staff_attendance').upsert({ teacher_id: t.id, attendance_date: today(), status, checked_in_at: new Date().toISOString() }, { onConflict: 'teacher_id,attendance_date' }));
              st.counts[late ? 'late' : 'in']++; st.feed.unshift({ name: t.full_name, sub: t.job_title || 'Staff', label: status, tone: late ? 'warn' : 'ok', at }); show(true, t.full_name, `${t.job_title || 'Staff'} | ${late ? 'Late' : 'On time'} at ${at}`);
            }
          }
        }
      } catch (err) { show(false, 'Could not save', err.message || String(err)); fail(err); }
      finally { busy = false; $('#sc-n-in', view).textContent = st.counts.in; $('#sc-n-late', view).textContent = st.counts.late; $('#sc-n-miss', view).textContent = st.counts.miss; drawFeed(); input.value = ''; input.focus(); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handle(input.value); } });
    view.addEventListener('click', (e) => { if (!e.target.closest('input,button,select,a,label')) input.focus(); });
    // camera scanning where the browser supports BarcodeDetector (Chrome on Android and desktop)
    const cam = $('#sc-cam', view);
    if (cam) cam.onclick = async () => {
      const vid = $('#sc-vid', view);
      if (st.cam) { st.cam.getTracks().forEach((t) => t.stop()); st.cam = null; vid.hidden = true; cam.textContent = 'Use camera'; return; }
      try {
        st.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); vid.srcObject = st.cam; vid.hidden = false; await vid.play(); cam.textContent = 'Stop camera';
        const det = new window.BarcodeDetector({ formats: ['code_39', 'qr_code', 'code_128'] }); let last = '', lastAt = 0;
        const loop = async () => {
          if (!st.cam || !view.isConnected) { st.cam?.getTracks().forEach((t) => t.stop()); return; }
          try { const found = await det.detect(vid); const v = found[0]?.rawValue; if (v && (v !== last || Date.now() - lastAt > 4000)) { last = v; lastAt = Date.now(); await handle(v); } } catch { /* keep scanning */ }
          setTimeout(loop, 350);
        };
        loop();
      } catch { toast('The camera could not be opened. Allow camera access, or use a barcode scanner.', 'error'); }
    };
    drawFeed(); input.focus();
  };
}

/* ---------------------------------------------------------------- staff register and report */
const CODE = { present: 'P', late: 'L', absent: 'A', leave: 'V' };
const TONE = { present: 'ok', late: 'warn', absent: 'bad', leave: 'info' };

export function staffAttendance() {
  return async (view) => {
    view.innerHTML = `<div class="tabs" id="sa-tabs"><button class="tab active" data-t="day">Daily register</button><button class="tab" data-t="month">Monthly report</button><button class="tab" data-t="badges">Staff badges</button></div><div id="sa-pane"></div>`;
    const pane = $('#sa-pane', view);
    const show = async (t) => {
      $$('#sa-tabs .tab', view).forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      pane.innerHTML = loadingBlock();
      try { await ({ day: dayPane, month: monthPane, badges: badgePane })[t](pane); } catch (e) { pane.innerHTML = errorBlock(e); }
    };
    $('#sa-tabs', view).onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); };
    await show('day');
  };
}

async function dayPane(pane) {
  const state = { date: today() };
  const teachers = await must(sb.from('teachers').select('id,full_name,staff_no,job_title').eq('status', 'active').order('full_name').limit(500));
  pane.innerHTML = `<div class="page-head"><div><h2>Staff register</h2><p class="muted">Mark who is in today. Scanned check-ins appear here too.</p></div>
      <div class="head-actions"><button class="btn ghost" id="sa-allp">All present</button><button class="btn primary" id="sa-save">${icon('check', 16)} Save register</button></div></div>
    <div class="toolbar"><label>Date <input type="date" class="input sm" id="sa-date" value="${state.date}" max="${today()}"></label></div><div class="card flush" id="sa-list"></div>`;
  let recs = new Map();
  const load = async () => {
    const rows = await must(sb.from('staff_attendance').select('teacher_id,status,checked_in_at,note').eq('attendance_date', state.date).limit(1000));
    recs = new Map(rows.map((r) => [r.teacher_id, r]));
    $('#sa-list', pane).innerHTML = tableHtml({
      columns: [
        { label: 'Staff', render: (t) => `<b>${esc(t.full_name)}</b><span class="sub">${esc(t.staff_no)}${t.job_title ? ` | ${esc(t.job_title)}` : ''}</span>` },
        { label: 'Status', render: (t) => `<select class="input sm" data-t="${t.id}" aria-label="Status of ${esc(t.full_name)}"><option value="">Not marked</option>${Object.keys(CODE).map((k) => `<option value="${k}" ${recs.get(t.id)?.status === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>` },
        { label: 'Checked in', render: (t) => (recs.get(t.id)?.checked_in_at ? new Date(recs.get(t.id).checked_in_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '-') },
      ], rows: teachers, empty: 'No active staff', emptyText: 'Add teachers first.',
    });
  };
  $('#sa-date', pane).onchange = (e) => { if (e.target.value) { state.date = e.target.value; load(); } };
  $('#sa-allp', pane).onclick = () => $$('#sa-list select', pane).forEach((s) => { if (!s.value) s.value = 'present'; });
  $('#sa-save', pane).onclick = async (e) => {
    const rows = $$('#sa-list select', pane).filter((s) => s.value).filter((s) => recs.get(s.dataset.t)?.status !== s.value).map((s) => ({ teacher_id: s.dataset.t, attendance_date: state.date, status: s.value }));
    if (!rows.length) return toast('Nothing changed', 'info');
    setBusy(e.currentTarget, true, 'Saving');
    try { await must(sb.from('staff_attendance').upsert(rows, { onConflict: 'teacher_id,attendance_date' })); toast(`${rows.length} saved`); await load(); } catch (err) { fail(err); } finally { setBusy(e.currentTarget, false); }
  };
  await load();
}

async function monthPane(pane) {
  const state = { month: monthStart().slice(0, 7) };
  pane.innerHTML = `<div class="page-head"><div><h2>Monthly staff attendance</h2><p class="muted">P present, L late, A absent, V on leave.</p></div><div class="head-actions">${exportButtons()}</div></div>
    <div class="toolbar"><label>Month <input type="month" class="input sm" id="sm-month" value="${state.month}"></label></div><div class="card flush" id="sm-out"></div>`;
  let rowsOut = [];
  const load = async () => {
    const [y, m] = state.month.split('-').map(Number), days = new Date(y, m, 0).getDate(), first = `${state.month}-01`, last = `${state.month}-${pad(days)}`;
    const [teachers, recs] = await Promise.all([
      must(sb.from('teachers').select('id,full_name,staff_no').eq('status', 'active').order('full_name').limit(500)),
      must(sb.from('staff_attendance').select('teacher_id,attendance_date,status').gte('attendance_date', first).lte('attendance_date', last).limit(20000)),
    ]);
    const map = new Map(); recs.forEach((r) => map.set(`${r.teacher_id}|${r.attendance_date}`, r.status));
    const body = teachers.map((t) => {
      const counts = { present: 0, late: 0, absent: 0, leave: 0 };
      const cells = Array.from({ length: days }, (_, i) => { const s = map.get(`${t.id}|${state.month}-${pad(i + 1)}`); if (s) counts[s]++; return s; });
      return { t, cells, counts };
    });
    rowsOut = body.map(({ t, counts }) => ({ Staff: t.full_name, 'Staff no': t.staff_no, Present: counts.present, Late: counts.late, Absent: counts.absent, Leave: counts.leave }));
    $('#sm-out', pane).innerHTML = body.length ? `<div class="table-wrap"><table class="table att-matrix"><thead><tr><th>Staff</th>${Array.from({ length: days }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>P</th><th>L</th><th>A</th><th>V</th></tr></thead><tbody>
      ${body.map(({ t, cells, counts }) => `<tr><td><b>${esc(t.full_name)}</b></td>${cells.map((s) => `<td>${s ? `<span class="am ${TONE[s]}">${CODE[s]}</span>` : ''}</td>`).join('')}<td>${counts.present}</td><td>${counts.late}</td><td>${counts.absent}</td><td>${counts.leave}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="padding:16px">No active staff.</p>';
  };
  wireExports(pane, 'Staff attendance', async () => rowsOut);
  $('#sm-month', pane).onchange = (e) => { if (e.target.value) { state.month = e.target.value; load(); } };
  await load();
}

async function badgePane(pane) {
  const teachers = await must(sb.from('teachers').select('id,full_name,staff_no,job_title').eq('status', 'active').order('full_name').limit(500));
  pane.innerHTML = `<div class="page-head"><div><h2>Staff badges</h2><p class="muted">Print badges with a barcode of the staff number so staff can check in at the scan station.</p></div>
    <div class="head-actions"><button class="btn primary" id="sb-print">${icon('printer', 16)} Preview badges (${teachers.length})</button></div></div>
    <div class="card flush">${tableHtml({ columns: [{ label: 'Staff', render: (t) => `<b>${esc(t.full_name)}</b>` }, { label: 'Staff number', render: (t) => `<code>${esc(t.staff_no)}</code>` }, { label: 'Role', render: (t) => esc(t.job_title || '-') }], rows: teachers, empty: 'No active staff' })}</div>`;
  $('#sb-print', pane).onclick = () => {
    if (!teachers.length) return toast('There are no staff to print', 'info');
    showPrintable(`Staff badges (${teachers.length})`, `<div class="idsheet print-area">${teachers.map((t) => `<div class="idcard">
      <div class="idc-top"><span class="logo">${LOGO}</span><div><b>${esc(CONFIG.SCHOOL.name)}</b><small>Staff identity card</small></div></div>
      <div class="idc-mid"><div class="idc-info"><b class="idc-name">${esc(t.full_name)}</b><span>${esc(t.job_title || 'Staff')}</span><span>No: <b>${esc(t.staff_no)}</b></span></div></div>
      <div class="idc-bar">${code39Svg(t.staff_no)}<small>${esc(t.staff_no)}</small></div></div>`).join('')}</div>`);
  };
}

/* ---------------------------------------------------------------- teacher: own attendance */
export async function myStaffAttendance(view, teacher) {
  try {
    const rows = await must(sb.from('staff_attendance').select('attendance_date,status,checked_in_at').eq('teacher_id', teacher.id).gte('attendance_date', monthStart()).order('attendance_date', { ascending: false }).limit(60));
    const c = (s) => rows.filter((r) => r.status === s).length;
    view.innerHTML = `<div class="page-head"><div><h2>My attendance</h2><p class="muted">Your school attendance this month.</p></div></div>
      <div class="stats"><div class="stat ok"><span class="ico">${icon('check', 22)}</span><div><b>${c('present')}</b><span>Present</span></div></div><div class="stat gold"><span class="ico">${icon('clock', 22)}</span><div><b>${c('late')}</b><span>Late</span></div></div><div class="stat bad"><span class="ico">${icon('x', 22)}</span><div><b>${c('absent')}</b><span>Absent</span></div></div></div>
      <div class="card flush">${tableHtml({ columns: [{ label: 'Date', render: (r) => fmtDate(r.attendance_date) }, { label: 'Status', render: (r) => badge(r.status, TONE[r.status]) }, { label: 'Checked in', render: (r) => (r.checked_in_at ? new Date(r.checked_in_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '-') }], rows, empty: 'No attendance recorded this month' })}</div>`;
  } catch (e) { view.innerHTML = errorBlock(e); }
}

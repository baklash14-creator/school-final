// Photos, guardians and printable ID cards for students and teachers
import { sb } from '../supabase.js';
import { CONFIG } from '../config.js';
import { must, lookup, clearLookups } from '../api.js';
import { showPrintable } from './shared.js';
import { $, $$, esc, icon, toast, fail, modal, setBusy, badge, tableHtml, loadingBlock, errorBlock, confirmBox, initials, LOGO, today } from '../ui.js';

/* ---------- images ---------- */
export async function squareJpeg(file, size = 400) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.');
  if (file.size > 8 * 1024 * 1024) throw new Error('That picture is larger than 8 MB. Choose a smaller one.');
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not process that picture.');
  return blob;
}

// Student photos are private (signed links); teacher photos are public.
export async function attachPhotoUrls(rows, kind) {
  if (kind === 'teacher') { rows.forEach((r) => { r._photo = r.photo_url || null; }); return rows; }
  const paths = rows.map((r) => r.photo_url).filter(Boolean);
  const map = {};
  if (paths.length) {
    const { data } = await sb.storage.from('student-photos').createSignedUrls([...new Set(paths)], 3600);
    (data || []).forEach((d) => { if (d.signedUrl) map[d.path] = d.signedUrl; });
  }
  rows.forEach((r) => { r._photo = map[r.photo_url] || null; });
  return rows;
}

export const avatarHtml = (r, size = 34) => (r._photo
  ? `<img class="avatar img" src="${esc(r._photo)}" alt="" style="width:${size}px;height:${size}px" loading="lazy">`
  : `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px">${esc(initials(r.full_name))}</span>`);

/* ---------- photo upload dialog ---------- */
export function photoDialog(kind, row, done) {
  const bucket = kind === 'teacher' ? 'staff-photos' : 'student-photos';
  const table = kind === 'teacher' ? 'teachers' : 'students';
  const m = modal({
    title: `Photo: ${row.full_name}`, size: 'sm',
    html: `<div class="photo-pick"><div id="ph-prev" class="photo-prev">${avatarHtml(row, 140)}</div>
      <label class="btn ghost" for="ph-file">${icon('upload', 16)} Choose picture</label>
      <input id="ph-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
      <p class="muted" style="font-size:13px">The picture is cropped to a square and shrunk automatically. ${kind === 'student' ? 'Student photos are private to the school and the student\'s family.' : 'Teacher photos appear on the public website when "Show on public website" is ticked.'}</p></div>`,
    footer: `${row.photo_url ? '<button class="btn ghost danger-text" id="ph-del">Remove photo</button>' : ''}<span style="flex:1"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ph-save" disabled>Save photo</button>`,
  });
  let blob = null;
  $('#ph-file', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { blob = await squareJpeg(f); $('#ph-prev', m.el).innerHTML = `<img class="avatar img" style="width:140px;height:140px" src="${URL.createObjectURL(blob)}" alt="Preview">`; $('#ph-save', m.el).disabled = false; }
    catch (err) { blob = null; $('#ph-save', m.el).disabled = true; fail(err); }
  };
  $('#ph-save', m.el).onclick = async (e) => {
    setBusy(e.currentTarget, true, 'Uploading');
    try {
      const path = kind === 'teacher' ? `${row.id}.jpg` : `${row.id}/photo.jpg`;
      const { error } = await sb.storage.from(bucket).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (error) throw error;
      const value = kind === 'teacher' ? `${sb.storage.from(bucket).getPublicUrl(path).data.publicUrl}?v=${Date.now()}` : path;
      await must(sb.from(table).update({ photo_url: value }).eq('id', row.id).select('id').single());
      toast('Photo saved'); m.close(); done?.();
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
  $('#ph-del', m.el)?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'Remove photo?', message: 'The picture will be deleted.', confirmText: 'Remove', danger: true }))) return;
    try {
      await sb.storage.from(bucket).remove([kind === 'teacher' ? `${row.id}.jpg` : `${row.id}/photo.jpg`]);
      await must(sb.from(table).update({ photo_url: null }).eq('id', row.id).select('id').single());
      toast('Photo removed'); m.close(); done?.();
    } catch (err) { fail(err); }
  });
}

/* ---------- guardians ---------- */
export async function guardiansDialog(student, done) {
  const m = modal({ title: `Parents and guardians: ${student.full_name}`, size: 'lg', html: `<div id="gd-body">${loadingBlock()}</div>` });
  async function draw() {
    const body = $('#gd-body', m.el);
    try {
      const [primary, extra, all] = await Promise.all([
        student.parent_id ? must(sb.from('parents').select('id,full_name,phone,profile_id').eq('id', student.parent_id).maybeSingle()) : null,
        must(sb.from('student_guardians').select('id,relationship,parents(id,full_name,phone,profile_id)').eq('student_id', student.id).order('created_at')),
        lookup('parents', 'full_name')(),
      ]);
      const taken = new Set([student.parent_id, ...extra.map((g) => g.parents?.id)]);
      const rows = [...(primary ? [{ id: null, primary: true, relationship: 'Primary contact', parents: primary }] : []), ...extra];
      body.innerHTML = `${tableHtml({ columns: [
        { label: 'Name', render: (g) => `<b>${esc(g.parents?.full_name)}</b>${g.primary ? ' ' + badge('primary', 'info') : ''}` },
        { label: 'Relationship', render: (g) => esc(g.relationship || '-') },
        { label: 'Phone', render: (g) => esc(g.parents?.phone || '-') },
        { label: 'Login', render: (g) => badge(g.parents?.profile_id ? 'linked' : 'none', g.parents?.profile_id ? 'ok' : 'muted') },
        { label: '', cls: 'actions', render: (g) => (g.primary ? '' : `<button class="icon-btn danger" data-rm="${g.id}" title="Remove" aria-label="Remove">${icon('trash', 16)}</button>`) }], rows, empty: 'No guardians linked', emptyText: 'Choose the primary parent on the student record, then add more here.' })}
        <h4 style="margin:18px 0 8px">Add another parent or guardian</h4>
        <div class="form-grid" style="grid-template-columns:1fr 1fr auto;align-items:end">
          <div class="field"><label for="gd-p">Parent record</label><select id="gd-p" class="input"><option value="">Select</option>${all.filter((p) => !taken.has(p.value)).map((p) => `<option value="${p.value}">${esc(p.label)}</option>`).join('')}</select></div>
          <div class="field"><label for="gd-r">Relationship</label><input id="gd-r" class="input" maxlength="40" placeholder="e.g. Mother, Uncle, Guardian"></div>
          <button class="btn primary" id="gd-add">${icon('plus', 16)} Add</button></div>
        <p class="muted" style="margin-top:10px;font-size:13px">Every linked parent with a login sees this child in their portal and receives absence, result and fee notifications. Create the parent first under Parents if they are not in the list.</p>`;
    } catch (e) { body.innerHTML = errorBlock(e); }
  }
  m.el.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { try { await must(sb.from('student_guardians').delete().eq('id', rm.dataset.rm).select('id')); clearLookups(); await draw(); done?.(); } catch (err) { fail(err); } return; }
    if (e.target.closest('#gd-add')) {
      const pid = $('#gd-p', m.el).value; if (!pid) return toast('Choose a parent', 'error');
      try { await must(sb.from('student_guardians').insert({ student_id: student.id, parent_id: pid, relationship: $('#gd-r', m.el).value.trim() || null })); await draw(); done?.(); toast('Guardian added'); } catch (err) { fail(err); }
    }
  });
  await draw();
}

/* ---------- Code 39 barcode (scannable by any phone or USB scanner) ---------- */
const C39 = { 0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn' };
export function code39Svg(text, h = 34) {
  const t = `*${String(text).toUpperCase().replace(/[^0-9A-Z\-. ]/g, '')}*`;
  let x = 0, bars = '';
  for (const ch of t) {
    const pat = C39[ch]; if (!pat) continue;
    for (let i = 0; i < 9; i++) { const w = pat[i] === 'w' ? 3 : 1; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`; x += w; }
    x += 1;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} ${h}" preserveAspectRatio="none" role="img" aria-label="Barcode ${esc(text)}" fill="#000">${bars}</svg>`;
}

/* ---------- ID cards ---------- */
export function idCardHtml(s) {
  return `<div class="idcard">
    <div class="idc-top"><span class="logo">${LOGO}</span><div><b>${esc(CONFIG.SCHOOL.name)}</b><small>${esc(CONFIG.SCHOOL.motto || 'Student identity card')}</small></div></div>
    <div class="idc-mid">${s._photo ? `<img class="idc-photo" src="${esc(s._photo)}" alt="">` : `<span class="idc-photo ph">${esc(initials(s.full_name))}</span>`}
      <div class="idc-info"><b class="idc-name">${esc(s.full_name)}</b><span>ID: <b>${esc(s.student_no)}</b></span><span>Class: ${esc(s.classes?.name || '-')}</span>${s.academic_years?.name ? `<span>Year: ${esc(s.academic_years.name)}</span>` : ''}</div></div>
    <div class="idc-bar">${code39Svg(s.student_no)}<small>${esc(s.student_no)}</small></div>
    <div class="idc-foot">${esc(CONFIG.SCHOOL.phone || '')}${CONFIG.SCHOOL.phone && CONFIG.SCHOOL.address ? ' | ' : ''}${esc(CONFIG.SCHOOL.address || '')}</div></div>`;
}
export async function printIdCards(students) {
  if (!students.length) return toast('There are no students to print', 'info');
  await attachPhotoUrls(students, 'student');
  // images must be loaded before the print dialog opens
  const m = showPrintable(`ID cards (${students.length})`, `<div class="idsheet print-area">${students.map(idCardHtml).join('')}</div>`);
  return m;
}
export async function idCardsDialog() {
  const classes = await lookup('classes', 'name')();
  const m = modal({ title: 'Print ID cards', size: 'sm',
    html: `<div class="field"><label for="id-class">Class</label><select id="id-class" class="input"><option value="">Select class</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>
      <p class="muted" style="font-size:13px">Cards are laid out ten to an A4 page. Use "Print / Save as PDF" and choose A4, margins None, to print on card stock. The barcode holds the student ID.</p>`,
    footer: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="id-go">${icon('idcard', 16)} Preview cards</button>` });
  $('#id-go', m.el).onclick = async (e) => {
    const cid = $('#id-class', m.el).value; if (!cid) return toast('Choose a class', 'error');
    setBusy(e.currentTarget, true, 'Loading');
    try {
      const rows = await must(sb.from('students').select('id,full_name,student_no,photo_url,classes(name),academic_years(name)').eq('class_id', cid).eq('status', 'active').order('full_name').limit(500));
      m.close(); await printIdCards(rows);
    } catch (err) { fail(err); setBusy(e.currentTarget, false); }
  };
}

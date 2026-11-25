// Past questions library: teachers and administrators upload papers, everyone signed in can download them.
import { sb } from '../supabase.js';
import { must, lookup } from '../api.js';
import { $, esc, icon, toast, fail, modal, confirmBox, setBusy, badge, tableHtml, loadingBlock, errorBlock, formHtml, readForm, resolveFields, debounce } from '../ui.js';

const KINDS = ['BECE', 'WASSCE', 'Mock', 'Term test', 'Other'];
const BUCKET = 'past-questions', MAX = 15 * 1024 * 1024;
const OK = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const safeName = (n) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file';

export function pastQuestions({ canUpload = false, isAdmin = false, userId = null } = {}) {
  return async (view) => {
    view.innerHTML = loadingBlock();
    try {
      const rows = await must(sb.from('past_questions').select('*, subjects(name)').order('exam_year', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1000));
      view.innerHTML = `<div class="page-head"><div><h2>Past questions</h2><p class="muted">Practise with papers from earlier years. Files open in a new tab.</p></div>
          ${canUpload ? `<div class="head-actions"><button class="btn primary" id="pq-add">${icon('upload', 16)} Upload a paper</button></div>` : ''}</div>
        <div class="toolbar"><label class="search">${icon('search', 16)}<input id="pq-q" type="search" placeholder="Search title or subject..." aria-label="Search past questions"></label>
          <select class="input sm" id="pq-kind" aria-label="Kind"><option value="">All kinds</option>${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></div>
        <div class="card flush" id="pq-list"></div>`;
      const draw = () => {
        const t = $('#pq-q', view).value.toLowerCase().trim(), k = $('#pq-kind', view).value;
        const shown = rows.filter((r) => (!k || r.kind === k) && (!t || `${r.title} ${r.subjects?.name || ''}`.toLowerCase().includes(t)));
        $('#pq-list', view).innerHTML = tableHtml({
          columns: [
            { label: 'Paper', render: (r) => `<b>${esc(r.title)}</b><span class="sub">${esc(r.subjects?.name || 'All subjects')}${r.level ? ` | ${esc(r.level)}` : ''}</span>` },
            { label: 'Kind', render: (r) => badge(r.kind, 'info') },
            { label: 'Year', render: (r) => r.exam_year || '-' },
            { label: '', cls: 'actions', render: (r) => `<button class="btn ghost sm" data-open="${r.id}">${icon('download', 15)} Open</button>${(isAdmin || r.uploaded_by === userId) ? `<button class="icon-btn" data-del="${r.id}" title="Delete" aria-label="Delete">${icon('trash', 16)}</button>` : ''}` },
          ], rows: shown, empty: t || k ? 'No matching papers' : 'No past questions yet', emptyText: canUpload ? 'Use "Upload a paper" to add the first one.' : 'Teachers will add papers here.',
        });
      };
      draw();
      $('#pq-q', view).oninput = debounce(draw, 200); $('#pq-kind', view).onchange = draw;
      $('#pq-list', view).onclick = async (e) => {
        const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
        try {
          if (o) {
            const r = rows.find((x) => x.id === o.dataset.open);
            const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(r.file_path, 120); if (error) throw error;
            window.open(data.signedUrl, '_blank', 'noopener');
          } else if (d) {
            const r = rows.find((x) => x.id === d.dataset.del);
            if (!(await confirmBox({ title: 'Delete this paper?', message: `"${r.title}" will be removed for everyone.`, confirmText: 'Delete', danger: true }))) return;
            await must(sb.from('past_questions').delete().eq('id', r.id));
            await sb.storage.from(BUCKET).remove([r.file_path]);
            toast('Paper deleted'); view.innerHTML = ''; pastQuestions({ canUpload, isAdmin, userId })(view);
          }
        } catch (err) { fail(err); }
      };
      if (canUpload) $('#pq-add', view).onclick = () => upload(() => pastQuestions({ canUpload, isAdmin, userId })(view));
    } catch (e) { view.innerHTML = errorBlock(e); }
  };
}

async function upload(done) {
  const fields = await resolveFields([
    { name: 'title', label: 'Title', required: true, full: true, maxlength: 150, placeholder: 'e.g. WASSCE Mathematics 2024 Paper 2' },
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: KINDS.map((k) => ({ value: k, label: k })) },
    { name: 'exam_year', label: 'Year', type: 'number', min: 1980, max: 2100 },
    { name: 'subject_id', label: 'Subject', type: 'select', blank: 'All subjects', options: lookup('subjects', 'name') },
    { name: 'level', label: 'Level or class', maxlength: 40, placeholder: 'e.g. SSS 3' },
  ]);
  const m = modal({
    title: 'Upload a past paper', html: `${formHtml(fields, { kind: 'WASSCE', exam_year: new Date().getFullYear() - 1 })}<div class="field full"><label for="pq-file">File (PDF, Word, JPG or PNG, up to 15 MB)</label><input type="file" id="pq-file" class="input" accept=".pdf,.docx,.jpg,.jpeg,.png"></div>`,
    footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pq-go">Upload</button>',
  });
  $('#pq-go', m.el).onclick = async (e) => {
    const { ok, values } = readForm($('form', m.el), fields); if (!ok) return;
    const file = $('#pq-file', m.el).files[0];
    if (!file) return toast('Choose a file to upload', 'error');
    if (file.size > MAX) return toast('That file is over 15 MB', 'error');
    if (!OK.includes(file.type)) return toast('Use a PDF, Word, JPG or PNG file', 'error');
    setBusy(e.currentTarget, true, 'Uploading');
    let path = null;
    try {
      const { data: u } = await sb.auth.getUser();
      path = `${u?.user?.id || 'staff'}/${Date.now()}-${safeName(file.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type }); if (up.error) throw up.error;
      await must(sb.from('past_questions').insert({ title: values.title, kind: values.kind, exam_year: values.exam_year || null, subject_id: values.subject_id || null, level: values.level || null, file_path: path, file_name: file.name }));
      toast('Paper uploaded'); m.close(); done();
    } catch (err) { if (path) sb.storage.from(BUCKET).remove([path]).catch(() => {}); fail(err); setBusy(e.currentTarget, false); }
  };
}

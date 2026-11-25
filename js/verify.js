// Public certificate check. Uses only the verify_certificate() function, which returns what is printed on the certificate.
import { sb } from './supabase.js';
import { CONFIG } from './config.js';
import { esc, fmtDate } from './ui.js';

const out = document.getElementById('vr'), input = document.getElementById('vc');
async function check(code) {
  code = code.trim();
  if (code.length < 6) { out.innerHTML = '<div class="result bad"><h2>Enter the full code</h2></div>'; return; }
  out.innerHTML = '<p class="muted">Checking...</p>';
  const { data, error } = await sb.rpc('verify_certificate', { p_code: code });
  if (error) { out.innerHTML = '<div class="result bad"><h2>Could not check right now</h2><p>Please try again in a moment.</p></div>'; return; }
  const c = data && data[0];
  if (!c) out.innerHTML = '<div class="result bad"><h2>No certificate found</h2><p>This code was not issued by the school. Check it was typed correctly.</p></div>';
  else if (!c.valid) out.innerHTML = '<div class="result bad"><h2>This certificate has been withdrawn</h2><p>The school has revoked it. It should not be accepted.</p></div>';
  else out.innerHTML = `<div class="result ok"><h2>Genuine certificate</h2><p>Issued by ${esc(CONFIG.SCHOOL.name)}.</p><dl>
    <div><dt>Awarded to</dt><dd>${esc(c.student_name)}</dd></div><div><dt>For</dt><dd>${esc(c.title)}</dd></div>
    ${c.citation ? `<div><dt>Citation</dt><dd>${esc(c.citation)}</dd></div>` : ''}<div><dt>Date</dt><dd>${esc(fmtDate(c.issued_on))}</dd></div></dl></div>`;
}
document.getElementById('vf').addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
const q = new URLSearchParams(location.search).get('c');
if (q) { input.value = q; check(q); }

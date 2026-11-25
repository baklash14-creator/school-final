// Records sign-in attempts (successful and failed) for the administrators' Login activity page.
// The database reads the IP address from the request itself; the browser only adds the device and, best effort, the place and network.
import { sb } from './supabase.js';

const GEO_KEY = 'aiass_geo';

export function describeDevice(ua = navigator.userAgent, hints = navigator.userAgentData) {
  const mobile = hints?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  let os = 'Unknown OS';
  if (/Windows/i.test(ua)) os = 'Windows 10/11';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(ua) || /FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) || /CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return `${mobile ? 'Mobile' : 'Desktop'} (${os} - ${browser})`;
}

// Look up the place and network of this connection once per tab. Failure is fine: the log then says "Unknown".
export function prefetchGeo() {
  try { const c = sessionStorage.getItem(GEO_KEY); if (c) return Promise.resolve(JSON.parse(c)); } catch { /* ignore */ }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
  return fetch('https://ipwho.is/', { signal: ctl.signal, referrerPolicy: 'no-referrer' })
    .then((r) => r.json())
    .then((j) => {
      const g = j && j.success ? { city: j.city || '', region: j.region || '', country: j.country || '', isp: j.connection?.isp || j.connection?.org || '' } : {};
      try { sessionStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch { /* ignore */ }
      return g;
    })
    .catch(() => ({}))
    .finally(() => clearTimeout(timer));
}

let geoPromise = null;
export const warmGeo = () => (geoPromise ||= prefetchGeo());

/** Never throws and never holds up sign-in for long. */
export async function recordLogin(identifier, success) {
  try {
    const g = await Promise.race([warmGeo(), new Promise((r) => setTimeout(() => r({}), 1200))]);
    await Promise.race([
      sb.rpc('log_login', { p_identifier: String(identifier || '').slice(0, 100), p_success: !!success, p_device: describeDevice(), p_city: g.city || null, p_region: g.region || null, p_country: g.country || null, p_isp: g.isp || null }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  } catch { /* the log is best effort */ }
}

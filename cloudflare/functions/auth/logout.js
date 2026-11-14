import { clearSessionCookie, page, readSession } from '../_lib.js';

// Log out: also raises your session version, so any copy of the cookie (another device, a stolen one) stops working
export async function onRequestGet({ request, env }) {
  // a link from another website must not log you out (an image or hidden link there can fire this request)
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return page('לא התנתקת', 'הבקשה הגיעה מאתר אחר, אז לא ניתקנו אותך.', { href: '/', label: 'חזרה לאתר' });
  const u = await readSession(env, request);
  if (u) await env.DB.prepare('UPDATE users SET sv = COALESCE(sv, 0) + 1 WHERE id = ?').bind(u.id).run();
  const r = page('התנתקת', 'כדי להיכנס שוב, התחבר עם דיסקורד.', { href: '/auth/login', label: 'התחברות עם דיסקורד' });
  r.headers.append('Set-Cookie', clearSessionCookie);
  return r;
}

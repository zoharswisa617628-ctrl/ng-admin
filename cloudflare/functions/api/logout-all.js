import { clearSessionCookie } from '../_lib.js';

// POST /api/logout-all → log me out of every device (raising the session version invalidates every cookie), stop notifications to my devices
export async function onRequestPost({ env, data }) {
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET sv = COALESCE(sv, 0) + 1 WHERE id = ?').bind(data.user.id),
    env.DB.prepare('DELETE FROM push_subs WHERE user = ?').bind(data.user.id),
  ]);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': clearSessionCookie } });
}

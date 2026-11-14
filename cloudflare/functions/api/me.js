import { json } from '../_lib.js';

// Who I am: name, and the profile picture hash Discord gave us at login (a public value; the page builds the picture address from it)
// Also counts this open of the site (one row per person per Israel day) for the visits card on the permissions page.
export async function onRequestGet({ env, data, waitUntil }) {
  const row = await env.DB.prepare('SELECT avatar, rank FROM users WHERE id = ?').bind(data.user.id).first();
  try {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }), now = Date.now();
    const p = env.DB.prepare(`INSERT INTO visits (day, id, n, last) VALUES (?, ?, 1, ?)
      ON CONFLICT(day, id) DO UPDATE SET n = n + 1, last = excluded.last`).bind(day, data.user.id, now).run().catch(() => {});
    if (waitUntil) waitUntil(p);
  } catch {}
  return json({ ...data.user, avatar: (row && row.avatar) || '', rank: (row && row.rank) || '' });
}

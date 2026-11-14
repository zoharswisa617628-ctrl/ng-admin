import { json, isOwner } from '../_lib.js';

// The exceptions list, for owners only: let someone in without the role, or keep someone out despite it.
export async function onRequestGet({ env, data }) {
  if (!data.user.owner) return json({ error: 'owners_only' }, 403);
  const ex = await env.DB.prepare('SELECT a.id, a.mode, a.note, a.by, a.at, u.name FROM access a LEFT JOIN users u ON u.id = a.id ORDER BY a.at DESC').all();
  const users = await env.DB.prepare('SELECT id, name, last, ok FROM users ORDER BY last DESC LIMIT 300').all();
  // visits: last 30 Israel days (per day: people and opens) and per person (days they came, opens, last time)
  const since = new Date(Date.now() - 29 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  let days = [], people = [];
  try {
    days = (await env.DB.prepare('SELECT day, COUNT(*) AS people, SUM(n) AS opens FROM visits WHERE day >= ? GROUP BY day ORDER BY day').bind(since).all()).results;
    people = (await env.DB.prepare(`SELECT v.id, u.name, COUNT(*) AS days, SUM(v.n) AS opens, MAX(v.last) AS last
      FROM visits v LEFT JOIN users u ON u.id = v.id WHERE v.day >= ? GROUP BY v.id ORDER BY opens DESC LIMIT 100`).bind(since).all()).results;
  } catch {}
  return json({ me: data.user.id, owners: (env.OWNER_IDS || '').split(/[\s,]+/).filter(Boolean), entries: ex.results, users: users.results, visits: { days, people } });
}

// PUT { id, mode: 'allow' | 'deny' | 'kick' | null, note }
//   allow / deny: add the exception · null: remove it · kick: log them out everywhere now (they can log in again if allowed)
export async function onRequestPut({ request, env, data }) {
  if (!data.user.owner) return json({ error: 'owners_only' }, 403);
  let b = {}; try { b = await request.json(); } catch {}
  const id = String(b.id || '').trim();
  if (!/^\d{17,20}$/.test(id)) return json({ error: 'bad_id' }, 400);
  if (isOwner(env, id) && b.mode !== null && b.mode !== 'allow') return json({ error: 'owner' }, 400);
  const kick = env.DB.prepare('UPDATE users SET sv = COALESCE(sv, 0) + 1 WHERE id = ?').bind(id);
  if (b.mode === 'kick') { await kick.run(); return json({ ok: true }); }
  if (b.mode == null) { await env.DB.prepare('DELETE FROM access WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  if (b.mode !== 'allow' && b.mode !== 'deny') return json({ error: 'bad_mode' }, 400);
  const put = env.DB.prepare(`INSERT INTO access (id, mode, note, by, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, note = excluded.note, by = excluded.by, at = excluded.at`)
    .bind(id, b.mode, String(b.note || '').slice(0, 120), data.user.id, new Date().toISOString());
  await env.DB.batch(b.mode === 'deny' ? [put, kick] : [put]);
  return json({ ok: true });
}

import { json, TEAM_KEYS } from '../_lib.js';

// Owners only: earlier versions of a shared document, and putting one back.
// GET  /api/history?key=ng_staff        → { versions: [{ hid, by, name, at, size }] }
// POST /api/history { key, hid }        → restores that version (the current one is kept as a backup first)
export async function onRequestGet({ request, env, data }) {
  if (!data.user.owner) return json({ error: 'owners_only' }, 403);
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!TEAM_KEYS.includes(key)) return json({ error: 'bad_key' }, 400);
  const { results } = await env.DB.prepare(`SELECT h.rowid AS hid, h.by, h.at, length(h.v) AS size, u.name FROM doc_history h
    LEFT JOIN users u ON u.id = h.by WHERE h.path = ? ORDER BY h.at DESC LIMIT 60`).bind('team/' + key).all();
  return json({ versions: results });
}
export async function onRequestPost({ request, env, data }) {
  if (!data.user.owner) return json({ error: 'owners_only' }, 403);
  let b = {}; try { b = await request.json(); } catch {}
  const key = String(b.key || ''), hid = Number(b.hid);
  if (!TEAM_KEYS.includes(key) || !Number.isInteger(hid)) return json({ error: 'bad_request' }, 400);
  const path = 'team/' + key;
  const old = await env.DB.prepare('SELECT v FROM doc_history WHERE rowid = ? AND path = ?').bind(hid, path).first();
  if (!old) return json({ error: 'not_found' }, 404);
  const at = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO doc_history (path, v, by, at) SELECT path, v, by, at FROM docs WHERE path = ?').bind(path),
    env.DB.prepare(`INSERT INTO docs (path, v, by, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET v = excluded.v, by = excluded.by, at = excluded.at`).bind(path, old.v, data.user.id, at),
  ]);
  return json({ ok: true });
}

import { json, docAllowed } from '../_lib.js';

const MAX = 1_000_000;            // 1 MB per document
const KEEP_DAYS = 14;             // backups of shared documents are kept this long

// GET /api/doc?path=team/ng_staff  → { exists, v }
export async function onRequestGet({ request, env, data }) {
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!docAllowed(path, data.user.id)) return json({ error: 'forbidden' }, 403);
  const row = await env.DB.prepare('SELECT v, at FROM docs WHERE path = ?').bind(path).first();
  return json({ exists: !!row, v: row ? JSON.parse(row.v) : null, at: row ? row.at : 0 });
}

// PUT /api/doc?path=...  body = the whole document (a JSON object)
export async function onRequestPut({ request, env, data }) {
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!docAllowed(path, data.user.id)) return json({ error: 'forbidden' }, 403);
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'bad_type' }, 415);
  const text = await request.text();
  if (text.length > MAX) return json({ error: 'too_large' }, 413);
  let body; try { body = JSON.parse(text); } catch { return json({ error: 'bad_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_json' }, 400);
  const at = Date.now();
  // staff display names are changed by the owner only; anyone else's write to that document is quietly ignored
  if ((path === 'team/ng_nick' || path === 'team/ng_list_btns') && !data.user.owner) return json({ ok: true, at, ignored: true });
  const stmts = [];
  if (path.startsWith('team/')) {
    // keep the previous version, so a mistake (or someone wiping data) can be undone from the permissions page
    stmts.push(env.DB.prepare('INSERT INTO doc_history (path, v, by, at) SELECT path, v, by, at FROM docs WHERE path = ?').bind(path));
  }
  stmts.push(env.DB.prepare(`INSERT INTO docs (path, v, by, at) VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET v = excluded.v, by = excluded.by, at = excluded.at`).bind(path, text, data.user.id, at));
  if (Math.random() < 0.05) stmts.push(env.DB.prepare('DELETE FROM doc_history WHERE at < ?').bind(at - KEEP_DAYS * 864e5));
  await env.DB.batch(stmts);
  return json({ ok: true, at });
}

import { json } from '../_lib.js';

// POST /api/digest-snap { items: [{ title, text }] } — the site keeps the server's copy of the four weekly lists fresh,
// so the Discord command /סיכום-שבועי can send them even when nobody has the site open.
export async function onRequestPost({ request, env, data }) {
  let b = {}; try { b = await request.json(); } catch {}
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 6)
    .map(x => ({ title: String((x && x.title) || '').slice(0, 120), text: String((x && x.text) || '').slice(0, 40000) })).filter(x => x.title);
  if (!items.length) return json({ error: 'empty' }, 400);
  const v = JSON.stringify({ at: Date.now(), by: data.user.id, items });
  await env.DB.prepare(`INSERT INTO docs (path, v, by, at) VALUES ('sys/digest_snap', ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET v = excluded.v, by = excluded.by, at = excluded.at`).bind(v, data.user.id, Date.now()).run();
  return json({ ok: true });
}

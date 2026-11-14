import { json } from '../_lib.js';

const FRESH_MS = 7 * 864e5;     // a fetched profile is kept this long
const MISS_MS = 864e5;          // a person Discord does not know is asked about again after a day
const MAX_FETCH = 35;           // new lookups per request

// POST /api/profiles { ids: [...] } → { id: { name, avatar } }
// People who logged in come from the users table; anyone else is looked up once in Discord (by ID, no server needed) and kept in discord_cache
export async function onRequestPost({ request, env }) {
  let body = {}; try { body = await request.json(); } catch {}
  const list = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(x => /^\d{17,20}$/.test(x)).slice(0, 64);
  if (!list.length) return json({});
  const marks = ids => ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id, name, avatar, rank, ok FROM users WHERE id IN (${marks(list)})`).bind(...list).all();
  const out = {}; results.forEach(r => { out[r.id] = { name: r.name, avatar: r.avatar || '' }; if (r.ok !== 0) { out[r.id].mgmt = 1; out[r.id].rank = r.rank || ''; } });   // logged in with the management role = management
  const rest = list.filter(id => !(id in out));
  if (rest.length && env.DISCORD_BOT_TOKEN) {
    const now = Date.now();
    const { results: cached } = await env.DB.prepare(`SELECT id, name, avatar, at FROM discord_cache WHERE id IN (${marks(rest)})`).bind(...rest).all();
    const have = {}; cached.forEach(r => { have[r.id] = r; });
    const todo = [];
    rest.forEach(id => {
      const c = have[id];
      if (c && now - c.at < (c.name ? FRESH_MS : MISS_MS)) { if (c.name) out[id] = { name: c.name, avatar: c.avatar || '' }; }
      else todo.push(id);
    });
    await Promise.all(todo.slice(0, MAX_FETCH).map(async id => {
      try {
        const r = await fetch(`https://discord.com/api/v10/users/${id}`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
        if (r.status === 429 || r.status >= 500 || r.status === 401) return;     // try again on a later request
        let name = '', avatar = '';
        if (r.ok) { const u = await r.json(); name = String(u.global_name || u.username || '').slice(0, 64); avatar = String(u.avatar || '').slice(0, 64); }
        await env.DB.prepare('INSERT INTO discord_cache (id, name, avatar, at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, at = excluded.at').bind(id, name, avatar, now).run();
        if (name) out[id] = { name, avatar };
      } catch {}
    }));
  }
  return json(out);
}

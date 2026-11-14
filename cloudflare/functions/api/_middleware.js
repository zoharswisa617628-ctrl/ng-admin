import { readSession, json, isOwner, recheck, CHECK_MS } from '../_lib.js';

// Every /api call: a valid signed session whose version still matches the DB (so "disconnect" and blocks work at once),
// not blocked, still holding the role (re-checked with Discord every few hours), and writes only from our own page.
// Generous per-user rate limit (kept in memory per server instance, so it is a soft brake, not an exact count):
// far above normal use, only stops a runaway script. Over the limit → 429, back to normal after the minute ends.
const RATE_MAX = 600, RATE_WIN = 60e3;
const rate = new Map();
function limited(id) {
  const now = Date.now();
  let r = rate.get(id);
  if (!r || now - r.t > RATE_WIN) { r = { t: now, n: 0 }; rate.set(id, r); if (rate.size > 2000) for (const [k, v] of rate) if (now - v.t > RATE_WIN) rate.delete(k); }
  return ++r.n > RATE_MAX;
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const u = await readSession(env, request);
  if (!u) return json({ error: 'login' }, 401);
  if (limited(u.id)) return json({ error: 'rate', msg: 'יותר מדי בקשות, נסה שוב בעוד דקה' }, 429);
  const row = await env.DB.prepare('SELECT u.sv AS sv, u.chk AS chk, a.mode AS mode FROM users u LEFT JOIN access a ON a.id = u.id WHERE u.id = ?').bind(u.id).first();
  if (!row || (row.sv || 0) !== (u.sv || 0)) return json({ error: 'login' }, 401);
  const owner = isOwner(env, u.id);
  if (!owner && row.mode === 'deny') return json({ error: 'denied' }, 403);

  // Background role check. One request "claims" it (so two tabs don't both refresh the Discord token at once).
  const now = Date.now(), last = row.chk || 0;
  if (now - last > CHECK_MS) {   // owners too: their picture and rank are refreshed (they are never logged out by it)
    const claim = await env.DB.prepare('UPDATE users SET chk = ? WHERE id = ? AND COALESCE(chk, 0) = ?').bind(now, u.id, last).run();
    if (claim.meta && claim.meta.changes === 1) {
      let res; try { res = await recheck(env, u.id); } catch { res = { keep: true, retry: true }; }
      if (!res.keep && !owner) {
        await env.DB.prepare('UPDATE users SET ok = 0, sv = COALESCE(sv, 0) + 1 WHERE id = ?').bind(u.id).run();
        return json({ error: 'login' }, 401);
      }
      if (res.retry) await env.DB.prepare('UPDATE users SET chk = ? WHERE id = ?').bind(now - CHECK_MS + 15 * 60e3, u.id).run();   // try again in 15 min
    }
  }

  if (request.method !== 'GET') {
    // a custom header can't be sent cross-site without a CORS preflight we never allow; Origin must be us too
    if (request.headers.get('x-ng') !== '1') return json({ error: 'bad_request' }, 400);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'bad_origin' }, 403);
  }
  ctx.data.user = { id: u.id, name: u.name, owner };
  return ctx.next();
}

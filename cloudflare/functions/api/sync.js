import { json } from '../_lib.js';

// GET /api/sync?since=<ms>  → every shared doc and your own private doc changed since then (since=0: all of them).
// The page asks every few seconds; that's how changes made by others show up.
export async function onRequestGet({ request, env, data }) {
  const since = Math.max(0, Number(new URL(request.url).searchParams.get('since')) || 0);
  const mine = `data/users/${data.user.id}/state`;
  const { results } = await env.DB.prepare(`SELECT path, v, by, at FROM docs WHERE at >= ? AND (path LIKE 'team/%' OR path = ?)`)
    .bind(since, mine).all();
  return json({ now: Date.now(), docs: results.map(r => ({ path: r.path, v: JSON.parse(r.v), by: r.by, at: r.at })) });
}

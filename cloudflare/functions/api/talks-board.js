import { json } from '../_lib.js';
import { postBoard, refreshBoard } from '../discord/interactions.js';

// POST /api/talks-board { action: 'post', wk }  → the weekly talks were just added: post the board message in its room (once per week)
// POST /api/talks-board { action: 'refresh' }    → something changed on the site: bring the board message up to date (only if it differs)
// Any signed-in management member may ask; the content always comes from the shared list, never from the request.
export async function onRequestPost({ request, env, data }) {
  if (!env.DISCORD_BOT_TOKEN) return json({ error: 'no_bot' }, 500);
  let b = {}; try { b = await request.json(); } catch {}
  const logo = new URL('/server-logo.webp', request.url).href;
  if (b.action === 'post') return json(await postBoard(env, logo, String(b.wk || '').slice(0, 20)));
  if (b.action === 'refresh') return json(await refreshBoard(env, logo));
  return json({ error: 'bad_action' }, 400);
}

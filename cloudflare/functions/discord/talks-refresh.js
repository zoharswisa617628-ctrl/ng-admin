import { refreshBoard } from './interactions.js';

// Called by the background worker (ng-admin-cron) every 30 minutes: brings the talks board message up to date, so finished talks drop off after 4 hours
// even if nobody touches the site. It takes no input and only rewrites that one message from the shared list, and it ignores calls that come too often.
export async function onRequestPost({ request, env }) {
  const row = await env.DB.prepare("SELECT at FROM docs WHERE path = 'sys/tk_cron'").first();
  if (row && Date.now() - row.at < 10 * 60000) return new Response('too soon', { status: 429 });
  await env.DB.prepare("INSERT INTO docs (path, v, by, at) VALUES ('sys/tk_cron', '{}', 'cron', ?) ON CONFLICT(path) DO UPDATE SET at = excluded.at").bind(Date.now()).run();
  const r = await refreshBoard(env, new URL('/server-logo.webp', request.url).href);
  return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
}

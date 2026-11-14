import { readSession } from './_lib.js';

// Nothing of the site (page, code, texts) is sent to someone who is not signed in: they get only a small sign-in page with one button.
// Open on purpose: the sign-in routes themselves, and the few files the browser asks for without cookies (app manifest, icons, service worker).
// /api has its own, stricter check (functions/api/_middleware.js).
const OPEN = ['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon.ico', '/server-logo.webp'];   // server-logo: Discord shows it in the weekly embeds

const LOGIN = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#0a0e16">
<meta name="robots" content="noindex"><title>New Gamers Admin</title>
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px;background:radial-gradient(60rem 28rem at 70% -10%,rgba(26,163,240,.18),transparent 60%),#0a0e16;color:#f5f7fb;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
main{width:min(24rem,100%);text-align:center;padding:2rem 1.6rem;border:1px solid #1f2a3d;border-radius:1.4rem;background:rgba(18,24,38,.82)}
img{width:84px;height:84px;border-radius:22px;display:block;margin:0 auto 1rem}
h1{margin:.1rem 0 .3rem;font-size:1.5rem;letter-spacing:-.01em}
p{margin:0 0 1.5rem;color:#9fb0c8;font-size:.95rem}
a{display:flex;align-items:center;justify-content:center;gap:.6rem;padding:.9rem 1rem;border-radius:.9rem;background:#5865f2;color:#fff;text-decoration:none;font-weight:700;font-size:1rem}
a:active{opacity:.85}
small{display:block;margin-top:1.1rem;color:#6f7f98;font-size:.78rem}
</style></head><body><main>
<img src="/icon-192.png" alt="">
<h1>New Gamers</h1><p>פאנל צוות</p>
<a href="/auth/login">התחברות עם דיסקורד</a>
<small>הכניסה להנהלה בלבד</small>
</main></body></html>`;

export async function onRequest(ctx) {
  const { request, env } = ctx, path = new URL(request.url).pathname;
  if (path.startsWith('/auth/') || path.startsWith('/api/') || path === '/discord/interactions' || (path === '/discord/talks-refresh' && request.method === 'POST') || OPEN.includes(path) || /^\/designs\/gifs\/[\w.-]+\.gif$/i.test(path)) return ctx.next();   // gif designs: Discord must reach them from a pasted link
  if (await readSession(env, request)) return ctx.next();
  const wantsPage = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
  if (wantsPage) return new Response(LOGIN, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  return new Response('login required', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

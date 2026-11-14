import { json } from '../_lib.js';
import { sendPush } from '../../shared/webpush.js';

const OK_HOST = /^https:\/\/([a-z0-9-]+\.)*(push\.services\.mozilla\.com|fcm\.googleapis\.com|android\.googleapis\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com)\//i;

// GET    /api/push           → { key } the public key the page subscribes with
// POST   /api/push { sub }   → save this device's subscription for the logged-in person
// DELETE /api/push { endpoint } → stop notifications on this device
// POST   /api/push?test=1    → send a test notification to all of my devices
// GET    /api/push?devices=1 → my devices that get notifications ({ endpoint, ua, at })
export async function onRequestGet({ env, request, data }) {
  if (new URL(request.url).searchParams.get('devices')) {
    const { results } = await env.DB.prepare('SELECT endpoint, ua, at FROM push_subs WHERE user = ? ORDER BY at DESC').bind(data.user.id).all();
    return json({ devices: results });
  }
  return json({ key: env.VAPID_PUBLIC || '' });
}

export async function onRequestPost({ request, env, data }) {
  if (new URL(request.url).searchParams.get('test')) {
    // ?test=iphones (owner only): every iPhone in the system, to check Apple delivery
    const allPhones = new URL(request.url).searchParams.get('test') === 'iphones' && data.user.owner;
    const myPhone = new URL(request.url).searchParams.get('test') === 'myiphone';   // only my own iPhone(s)
    const { results } = myPhone
      ? await env.DB.prepare("SELECT endpoint, keys FROM push_subs WHERE user = ? AND endpoint LIKE '%push.apple.com%'").bind(data.user.id).all()
      : allPhones
      ? await env.DB.prepare("SELECT endpoint, keys FROM push_subs WHERE endpoint LIKE '%push.apple.com%'").all()
      : await env.DB.prepare('SELECT endpoint, keys FROM push_subs WHERE user = ?').bind(data.user.id).all();
    let sent = 0; const detail = [];
    for (const s of results) {
      const r = await sendPush(env, { endpoint: s.endpoint, keys: JSON.parse(s.keys) },
        new URL(request.url).searchParams.get('test') === 'sync'
        ? { title: 'לעדכן מאתר הצוות', body: 'הטבלאות מתאפסות הערב. מישהו צריך ללחוץ על הסימנייה "NG עדכון" באתר הצוות.', url: '/#open=staff', tag: 'test-sync' }
        : { title: 'ההתראות פועלות ✅', body: 'מעכשיו תקבל כאן התראות על מכרזים, איפוסים ואזהרות.', url: '/', tag: 'test' });
      detail.push({ host: new URL(s.endpoint).host, status: r.status || 0, error: r.error ? r.error.slice(0, 120) : undefined });
      if (r.ok) sent++; else if (r.gone) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
    }
    return json({ sent, devices: results.length, detail });
  }
  let b = {}; try { b = await request.json(); } catch {}
  const s = b.sub || {};
  if (typeof s.endpoint !== 'string' || !OK_HOST.test(s.endpoint) || s.endpoint.length > 1000 || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: 'bad_sub' }, 400);
  const keys = JSON.stringify({ p256dh: String(s.keys.p256dh).slice(0, 200), auth: String(s.keys.auth).slice(0, 100) });
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, user, keys, ua, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, keys = excluded.keys, ua = excluded.ua, at = excluded.at`)
    .bind(s.endpoint, data.user.id, keys, String(b.ua || '').slice(0, 60), Date.now()).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, data }) {
  let b = {}; try { b = await request.json(); } catch {}
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user = ?').bind(String(b.endpoint || ''), data.user.id).run();
  return json({ ok: true });
}

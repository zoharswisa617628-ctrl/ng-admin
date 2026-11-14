import { sendPush } from './webpush.js';

// A new weekly summary went out: tell everyone who turned notifications on (every device, all management).
export async function notifyWeekly(env) {
  try {
    const { results } = await env.DB.prepare('SELECT endpoint, keys FROM push_subs').all();
    await Promise.all(results.map(async s => {
      const r = await sendPush(env, { endpoint: s.endpoint, keys: JSON.parse(s.keys) },
        { title: 'סיכום שבועי חדש', body: 'נשלח סיכום שבועי חדש לדיסקורד.', url: '/#open=lists', tag: 'weekly-digest' });
      if (r.gone) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
    }));
  } catch {}
}

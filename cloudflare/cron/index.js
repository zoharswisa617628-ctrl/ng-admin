// ng-admin-cron: every 30 minutes, look at the shared data and send phone notifications for what needs the management.
// Each alert goes out once (remembered in notif_sent). Nothing is sent at night (Israel time); it waits for the morning.
import { sendPush } from '../shared/webpush.js';

const TZ = 'Asia/Jerusalem';
const ilDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));               // YYYY-MM-DD
const ilHM = d => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const daysUntil = (d, now) => Math.round((Date.parse(ilDate(d)) - Date.parse(ilDate(now))) / 864e5);
const ilDay = d => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(d));          // Sat
const SYNC_REMIND = '20:45';   // Saturday evening, before the staff site's tables reset
const tail = id => '…' + String(id || '').slice(-4);

async function team(env) {
  const { results } = await env.DB.prepare("SELECT path, v FROM docs WHERE path IN ('team/ng_tenders','team/ng_tender_owners','team/ng_resets','team/ng_staff','team/ng_nick','team/ng_warn_ack','team/ng_reset_pending','team/ng_staff_meta')").all();
  const out = {}; results.forEach(r => { try { out[r.path.slice(5)] = JSON.parse(r.v).v; } catch {} });
  return out;
}

// The same things "היום" shows on the site
function alerts(t, now) {
  const out = [], tenders = t.ng_tenders || {}, owners = t.ng_tender_owners || {}, resets = t.ng_resets || [], staff = t.ng_staff || [], nick = t.ng_nick || {}, ack = t.ng_warn_ack || {};
  for (const [n, h] of Object.entries(tenders)) {
    if (!h || !h.end) continue;
    const left = daysUntil(h.end, now), url = '/#open=' + encodeURIComponent('tender:' + n);
    const closedByHour = left === 0 && h.closeTime && ilHM(now) >= h.closeTime;
    const ended = h.status === 'ended' || left < 0 || closedByHour;
    if (h.status !== 'cancelled' && !ended) {
      if (left === 0 && !h.told0) out.push({ key: `t0:${n}:${ilDate(h.end)}`, title: `המכרז על ${n} נסגר היום`, body: 'להודיע לשחקנים מתי בדיוק הוא נסגר.', url });
      if (left === 1 && !h.told1) out.push({ key: `t1:${n}:${ilDate(h.end)}`, title: `המכרז על ${n} נסגר מחר`, body: 'להודיע לשחקנים מתי בדיוק הוא נסגר.', url });
    }
    if (h.status !== 'cancelled' && ended && !h.winnerSet) out.push({ key: `tw:${n}:${ilDate(h.end)}`, title: `המכרז על ${n} נגמר`, body: 'צריך לרשום מי זכה.', url });
  }
  for (const [n, o] of Object.entries(owners)) {
    if (o && !o.done && o.due && daysUntil(o.due, now) <= 0)
      out.push({ key: `od:${n}:${ilDate(o.due)}`, title: `הגיע הזמן לקחת את ${n}`, body: 'עברו שלושה חודשים. לקחת את העסק ולהביא לזוכה את הדברים.', url: '/#open=' + encodeURIComponent('tender:' + n) });
  }
  for (const r of resets) {
    if (!r || r.archived) continue;
    if (r.status === 'active' && r.end && daysUntil(r.end, now) <= 0)
      out.push({ key: `rd:${r.id}`, title: 'איפוס טראסט: הגיע יום הבדיקה', body: `השחקן ${tail(r.player)} סיים את שבוע הניסיון. לבדוק אם עבר.`, url: '/#open=' + encodeURIComponent('fmt:reset') });
    if (r.status === 'failed' && !r.cooldownSent)
      out.push({ key: `rc:${r.id}`, title: 'איפוס טראסט: לשלוח קולדאון', body: `השחקן ${tail(r.player)} נכשל. צריך לשלוח פורמט קולדאון.`, url: '/#open=' + encodeURIComponent('fmt:reset') });
  }
  // Saturday evening: nobody ran the "NG עדכון" bookmark today
  const sync = (t.ng_staff_meta || {}).sync;
  if (ilDay(now) === 'Sat' && ilHM(now) >= SYNC_REMIND && !(sync && ilDate(sync) === ilDate(now)))
    out.push({ key: `sy:${ilDate(now)}`, title: 'לאפס טבלאות ולעדכן', body: 'אם הטבלאות עוד לא התאפסו, לאפס עכשיו. אחר כך ללחוץ על הסימנייה "NG עדכון" כדי לעדכן ולשלוח את הסיכום השבועי.', url: '/#open=staff' });
  // Sunday morning: last week's summary (who didn't make the minimum) is ready on the site
  // the staff site's tables look reset: only the owner is asked (he answers in "היום")
  if (t.ng_reset_pending) out.push({ key: `rp:${t.ng_reset_pending.wk}:${t.ng_reset_pending.at}`, owner: true, title: 'נראה שהטבלאות באתר הצוות התאפסו', body: 'היה איפוס? אם כן, הסיכום השבועי יישלח. לחץ כדי לענות.', url: '/' });
  if (ilDay(now) === 'Sun')
    out.push({ key: `ws:${ilDate(now)}`, title: 'הסיכום השבועי מוכן', body: 'מי לא עבר את המינימום בשבוע שעבר. לחץ כדי לראות.', url: '/' });
  for (const m of staff) {
    if (!m || m.gone) continue;
    const ws = (m.warns || []).filter(w => !w.ex || Date.parse(w.ex) > now);
    const count = ws.reduce((a, w) => a + (/כפולה/.test(w.t || '') ? 2 : 1), 0);
    // "לפני העפה" + another warning counts only when the pre-kick one came first and another one came after it
    const preAt = Math.min(...ws.filter(w => /לפני\s*העפה/.test(w.t || '')).map(w => Date.parse(w.at) || Infinity));
    const pre = isFinite(preAt) && ws.some(w => (Date.parse(w.at) || 0) > preAt);
    const sig = `${count}:${pre ? 1 : 0}:${Math.max(0, ...ws.map(w => Date.parse(w.at) || 0))}`;
    if ((count >= 3 || pre) && !(ack[m.id] && ack[m.id].sig === sig))   // someone marked it seen / no need to kick
      out.push({ key: `wa:${m.id}:${count}:${pre ? 1 : 0}`, title: `${nick[m.id] || m.name}: ${count} אזהרות${pre ? ', אחרי אזהרה לפני העפה' : ''}`, body: 'לבדוק אם להעיף.', url: '/#open=staff' });
  }
  return out;
}

// Which setting turns an alert on or off (the part of the alert key before the first ":")
const CAT = { t0: 'tender', t1: 'tender', tw: 'tender', od: 'tender', rd: 'reset', rc: 'reset', wa: 'warn', ws: 'weekly', sy: 'sync' };
const catOf = key => CAT[String(key).split(':')[0]] || 'other';
const toMin = hm => { const [h, m] = String(hm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// Quiet hours (each person's own; default 23:30 to 09:00). Alerts wait for the morning.
function inQuiet(q, hm) { if (!q.on) return false; const n = toMin(hm), f = toMin(q.from), t = toMin(q.to); return f <= t ? (n >= f && n < t) : (n >= f || n < t); }
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function run(env) {
  const now = Date.now(), hm = ilHM(now);
  const list = alerts(await team(env), now);
  if (!list.length) return { alerts: 0 };
  // everyone who may get in: logged in with access, not blocked
  const { results: subs } = await env.DB.prepare(`SELECT s.endpoint, s.keys, s.user FROM push_subs s JOIN users u ON u.id = s.user
    LEFT JOIN access a ON a.id = s.user WHERE u.ok = 1 AND COALESCE(a.mode, '') <> 'deny'`).all();
  if (!subs.length) return { alerts: list.length, devices: 0 };
  const users = [...new Set(subs.map(s => s.user))], owners = String(env.OWNER_IDS || '').split(/[\s,]+/).filter(Boolean);
  // each person's choices live in their own saved settings (ng_prefs): { n: { tender: 0|1, ... }, q: { on, from, to } }
  const prefs = {};
  for (const c of chunks(users, 90)) {
    const { results } = await env.DB.prepare(`SELECT path, v FROM docs WHERE path IN (${c.map(() => '?').join(',')})`).bind(...c.map(u => `data/users/${u}/state`)).all();
    results.forEach(r => { try { prefs[r.path.split('/')[2]] = (JSON.parse(r.v) || {}).ng_prefs || {}; } catch {} });
  }
  // what was already sent: the old shared keys and the per-person keys "<alert>@<person>"
  const sent = new Set();
  for (const c of chunks(list.flatMap(a => [a.key, ...users.map(u => `${a.key}@${u}`)]), 90)) {
    const { results } = await env.DB.prepare(`SELECT key FROM notif_sent WHERE key IN (${c.map(() => '?').join(',')})`).bind(...c).all();
    results.forEach(r => sent.add(r.key));
  }
  let delivered = 0, fresh = 0; const marks = [];
  for (const u of users) {
    const p = prefs[u] || {}, q = { on: true, from: '23:30', to: '09:00', ...(p.q || {}) };
    if (inQuiet(q, hm)) continue;                                              // wait for the morning, nothing is marked sent
    const mine = list.filter(a => (!a.owner || owners.includes(u)) && !sent.has(a.key) && !sent.has(`${a.key}@${u}`));
    for (const a of mine) {
      marks.push(env.DB.prepare('INSERT OR IGNORE INTO notif_sent (key, at) VALUES (?, ?)').bind(`${a.key}@${u}`, now));
      if ((p.n || {})[catOf(a.key)] === 0) continue;                           // this kind is switched off for them
      fresh++;
      for (const s of subs.filter(x => x.user === u)) {
        const r = await sendPush(env, { endpoint: s.endpoint, keys: JSON.parse(s.keys) }, { title: a.title, body: a.body, url: a.url, tag: a.key });
        if (r.ok) delivered++; else if (r.gone) marks.push(env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint));
      }
    }
  }
  for (const c of chunks(marks, 50)) await env.DB.batch(c);
  // forget alerts older than 60 days
  await env.DB.prepare('DELETE FROM notif_sent WHERE at < ?').bind(now - 60 * 864e5).run();
  return { alerts: list.length, people: users.length, fresh, delivered };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
    // the talks board message in Discord: bring it up to date (finished talks drop off after 4 hours even if nobody opens the site)
    ctx.waitUntil(fetch('https://YOUR-PROJECT.pages.dev/discord/talks-refresh', { method: 'POST' }).catch(() => {}));
  },
  // No public address: this worker only runs on its schedule
  async fetch() { return new Response('Not found', { status: 404 }); },
};

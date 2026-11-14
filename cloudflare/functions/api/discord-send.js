import { json } from '../_lib.js';
import { notifyWeekly } from '../../shared/notify-all.js';

// Posts the staff lists to ONE Discord channel through the bot.
// The channel is never taken from the request: it is the one the site owner saved in the shared settings (team/ng_list_btns → chan).
const LIM = 1900;            // Discord allows 2000 characters per message; keep a margin
const MAX_PARTS = 16;        // most messages one request may send
const COOLDOWN_MS = 15e3;    // a manual send can't be repeated faster than this
const SENT = 'sys/digest_sent', LAST = 'sys/digest_last';   // server-only rows (the /api/doc route refuses these paths)

// each list goes to its own room (the saved channel is only the fallback for an unknown list)
const ROOMS = { 'אזהרת צוות': '900000000000000038', 'זכאים לקידום': '900000000000000039', 'לא עברו מינימום': '900000000000000040', 'עברו מינימום': '900000000000000041' };

const getDoc =async (env, path) => { const r = await env.DB.prepare('SELECT v FROM docs WHERE path = ?').bind(path).first(); try { return r ? JSON.parse(r.v) : null; } catch { return null; } };
// shared documents are saved as { v, by, at }: the setting itself is in .v
const teamVal = d => (d && typeof d === 'object' && 'v' in d ? d.v : d) || null;
const putDoc = (env, path, v, by) => env.DB.prepare(`INSERT INTO docs (path, v, by, at) VALUES (?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET v = excluded.v, by = excluded.by, at = excluded.at`).bind(path, JSON.stringify(v), by, Date.now()).run();

// one list → messages of up to LIM characters, cut only between lines
function split(text) { return splitBy(text, LIM); }
function splitBy(text, LIM) {
  const out = []; let cur = '';
  for (const line of String(text).split('\n')) {
    const l = line.length > LIM ? line.slice(0, LIM) : line;
    if (cur && cur.length + l.length + 1 > LIM) { out.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function post(env, chan, content) {
  for (let t = 0; t < 2; t++) {
    const r = await fetch(`https://discord.com/api/v10/channels/${chan}/messages`, {
      method: 'POST', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(typeof content === 'string' ? { content } : content), allowed_mentions: { parse: [] } }),   // nobody is pinged, whatever the text says
    });
    if (r.status === 429 && t === 0) { let w = 1; try { w = Math.min(4, +(await r.json()).retry_after || 1); } catch {} await new Promise(ok => setTimeout(ok, w * 1000)); continue; }
    return r.ok ? { ok: true } : { ok: false, status: r.status };
  }
  return { ok: false, status: 429 };
}

// GET /api/discord-send → is a channel set, and what was sent last
export async function onRequestGet({ env }) {
  const set = teamVal(await getDoc(env, 'team/ng_list_btns')), last = await getDoc(env, LAST);
  return json({ chan: !!(set && /^\d{17,20}$/.test(String(set.chan || ''))), bot: !!env.DISCORD_BOT_TOKEN, last: last || null });
}

// POST /api/discord-send { items: [{ text }], auto?: bool, wk?: 'dd/mm/yy' (the week's key on the site) }
// auto = the site sent it by itself after a weekend update: it is sent once per week, however many people trigger it
export async function onRequestPost({ request, env, data, waitUntil }) {
  let b = {}; try { b = await request.json(); } catch {}
  const items = (Array.isArray(b.items) ? b.items : []).map(x => String((x && x.text) || '').trim()).filter(Boolean).slice(0, 6);
  if (!items.length) return json({ error: 'empty' }, 400);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: 'no_bot' }, 500);
  const set = teamVal(await getDoc(env, 'team/ng_list_btns')), chan = String((set && set.chan) || '');
  if (!/^\d{17,20}$/.test(chan)) return json({ error: 'no_channel' }, 400);
  // a manual send: only the owner and the people the owner ticked (the automatic weekly send is open to any update)
  if (!b.auto && !data.user.owner && !(Array.isArray(set && set.senders) && set.senders.includes(data.user.id))) return json({ error: 'not_allowed' }, 403);
  // each list → embed messages: title "סיכום שבועי • <list>", the server logo on the side, the time at the bottom
  const SHORT = [[/אזהר/, 'אזהרת צוות'], [/לא עבר/, 'לא עברו מינימום'], [/עבר/, 'עברו מינימום'], [/קידום/, 'זכאים לקידום']];
  const logo = new URL('/server-logo.webp', request.url).href;
  const weekly = !!b.auto || items.length >= 4;   // the full weekly summary; otherwise one custom list
  // who sent it (a manual send): name + picture at the bottom, like the /סיכום-שבועי command
  let footer = { text: 'עודכן לאחרונה' };
  if (b.auto) {   // sent by the site itself: signed with the owner's name and picture
    const oid = (String(env.OWNER_IDS || '').split(/[\s,]+/).filter(Boolean)[0]) || '';
    const row = oid ? await env.DB.prepare('SELECT avatar FROM users WHERE id = ?').bind(oid).first() : null;
    const av = row && /^[\w]{1,64}$/.test(row.avatar || '') ? `https://cdn.discordapp.com/avatars/${oid}/${row.avatar}.png?size=64` : '';
    footer = { text: 'Developed By OWNER_NAME • עודכן לאחרונה', ...(av ? { icon_url: av } : {}) };
  }
  if (!b.auto && data.user && data.user.name) {
    const row = await env.DB.prepare('SELECT avatar FROM users WHERE id = ?').bind(data.user.id).first();
    const av = row && /^[\w]{1,64}$/.test(row.avatar || '') ? `https://cdn.discordapp.com/avatars/${data.user.id}/${row.avatar}.png?size=64` : '';
    const nm = String(data.user.name).split('|').pop().replace(/[^\p{L}\p{N}]+$/u, '').trim() || data.user.name;   // "S.SM | OWNER_NAME" → "OWNER_NAME"
    footer = { text: `נשלח על ידי ${nm} • עודכן לאחרונה`, ...(av ? { icon_url: av } : {}) };
  }
  const parts = items.flatMap(text => {
    const lines = text.split('\n'); let head = '';
    if (/^#\s+/.test(lines[0] || '')) head = lines.shift().replace(/^#\s+/, '').trim();
    const name = (SHORT.find(([rx]) => rx.test(head)) || [0, head || 'רשימה'])[1];
    const chunks = splitBy(lines.join('\n').trim() || 'אין אף אחד ברשימה', 3900);
    const to = weekly ? (ROOMS[name] || chan) : chan;   // only the full weekly summary is split by room; a single custom list goes to the saved channel
    const ttl = weekly ? 'סיכום שבועי • ' + name : (head || 'רשימה');   // a single list is titled with its own name
    return chunks.map((d, i) => ({ to, embeds: [{ title: (ttl + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '')).slice(0, 250),
      description: d, color: 0x2ad0f5, thumbnail: { url: logo }, footer, timestamp: new Date().toISOString() }] }));
  });
  if (!parts.length || parts.length > MAX_PARTS) return json({ error: 'too_long' }, 413);

  const now = Date.now(), last = await getDoc(env, LAST);
  if (last && now - (last.at || 0) < COOLDOWN_MS) return json({ error: 'wait' }, 429);
  let prevSent = null;
  if (b.auto) {
    const wk = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(b.wk || '')) ? String(b.wk) : '';
    if (!wk) return json({ error: 'bad_week' }, 400);
    prevSent = await getDoc(env, SENT);
    if (prevSent && prevSent.wk === wk) return json({ ok: true, dup: true });   // this week was already sent
    await putDoc(env, SENT, { wk, at: now }, data.user.id);                       // claim it first, so two people can't both send
  }
  await putDoc(env, LAST, { at: now, by: data.user.id, auto: !!b.auto, n: parts.length }, data.user.id);

  let sent = 0;
  for (const p of parts) {
    const { to, ...msg } = p;
    const r = await post(env, to, msg);
    if (!r.ok) {
      if (b.auto && sent === 0) await putDoc(env, SENT, prevSent || { wk: '', at: 0 }, data.user.id);   // nothing went out: allow a retry
      return json({ error: 'discord', status: r.status, sent }, 502);
    }
    sent++;
    if (sent < parts.length) await new Promise(ok => setTimeout(ok, 350));
  }
  // one notification per full summary (all the lists together), never for a single list
  if (items.length >= 4) { if (waitUntil) waitUntil(notifyWeekly(env)); else await notifyWeekly(env); }
  return json({ ok: true, sent });
}

import { accessFor } from '../_lib.js';
import { KINDS, kindEmbeds } from '../../shared/digest-embed.js';
// Discord sends every /סיכום-שבועי use (and the "שלח" button) here.
// 1. Every request is checked with Discord's signature, so nobody else can fake one.
// 2. Only someone with the management role (or an "allow" exception / owner) gets an answer with data.
// 3. The command answers privately (only you see it) with a "שלח" button; the button posts it for everyone in that chat.
const enc = new TextEncoder();
const hex = s => Uint8Array.from(String(s).match(/../g) || [], h => parseInt(h, 16));
const reply = obj => new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } });
const privateMsg = content => reply({ type: 4, data: { flags: 64, content } });

async function verified(request, env, body) {
  const sig = request.headers.get('x-signature-ed25519'), ts = request.headers.get('x-signature-timestamp');
  if (!sig || !ts || !env.DISCORD_PUBLIC_KEY) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex(env.DISCORD_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hex(sig), enc.encode(ts + body));
  } catch { return false; }
}

// management role on the server (asked from Discord with the bot), or the site's exceptions / owners
async function allowed(env, uid) {
  let roles = [];
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${env.GUILD_ID}/members/${uid}`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (r.ok) roles = (await r.json()).roles || [];
  } catch {}
  const a = await accessFor(env, uid, roles);
  if (a.ok) return true;
  if (a.why === 'denied') return false;
  // the bot could not see the roles: someone the site already verified as management (they logged in and the role was checked) is fine too
  try { const u = await env.DB.prepare('SELECT ok FROM users WHERE id = ?').bind(uid).first(); return !!(u && u.ok === 1); } catch { return false; }
}

async function snap(env) {
  const r = await env.DB.prepare("SELECT v FROM docs WHERE path = 'sys/digest_snap'").first();
  try { return r ? JSON.parse(r.v) : null; } catch { return null; }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const body = await request.text();
  if (!(await verified(request, env, body))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return reply({ type: 1 });                                         // Discord checking the address

  const uid = (i.member && i.member.user && i.member.user.id) || (i.user && i.user.id);
  const logo = new URL('/server-logo.webp', request.url).href;

  if (i.type === 2 && i.data && i.data.type === 2) {                                     // right-click on a user → Apps → "סטטוס צוות"
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    return privateMsg(await memberStatus(env, String(i.data.target_id || ''), i));
  }

  if (i.type === 2 && i.data && i.data.name === 'שיחות') {                               // /שיחות: who still waits for a talk, and how finished ones ended
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    const t = await talksPlain(env);
    if (!t) return privateMsg('אין שיחות ברשימה. אפשר להוסיף בדף "שיחות" באתר.');
    return reply({ type: 4, data: { flags: 64, content: '-# תצוגה מקדימה, רק אתה רואה אותה\n' + t, allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [{ type: 2, style: 3, label: 'שלח', custom_id: 'tks' }, { type: 2, style: 4, label: 'אל תשלח', custom_id: 'dgx' }] }] } });
  }

  if (i.type === 2) {                                                                    // /סיכום-שבועי
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    const kind = ((i.data.options || []).find(o => o.name === 'סוג') || {}).value;
    const s = await snap(env), embeds = kindEmbeds(s, kind, logo, sender(i));
    if (!embeds) return privateMsg('עוד אין נתונים. פתח פעם אחת את האתר YOUR-PROJECT.pages.dev, והרשימות יתעדכנו.');
    const ago = Math.round((Date.now() - (s.at || 0)) / 60000);
    return reply({ type: 4, data: { flags: 64, content: `תצוגה מקדימה, רק אתה רואה אותה. הנתונים מלפני ${ago < 60 ? ago + ' דקות' : Math.round(ago / 60) + ' שעות'}.`,
      embeds, allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [{ type: 2, style: 3, label: 'שלח', custom_id: 'dgs:' + kind }, { type: 2, style: 4, label: 'אל תשלח', custom_id: 'dgx' }] }] } });
  }

  // The buttons: answer at once ("got it"), then in the background send (with @everyone) and remove the private preview
  const hook = `https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`;
  const removePreview = () => fetch(hook + '/messages/@original', { method: 'DELETE' }).catch(() => {});
  if (i.type === 3 && i.data.custom_id === 'dgx') {                                     // "אל תשלח"
    ctx.waitUntil(removePreview());
    return reply({ type: 6 });
  }
  if (i.type === 3 && i.data.custom_id === 'tkd') {                                      // someone picked who had their talk, in the posted message
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    // not finished yet: first ask (privately) what really happened, so every finished talk says how it ended
    const ids = (i.data.values || []).map(String), list = await docVal(env, 'team/ng_talks');
    const picked = (Array.isArray(list) ? list : []).filter(x => x && ids.includes(String(x.id)) && x.st !== 'done');
    if (!picked.length) return privateMsg('השיחות האלה כבר סומנו כבוצעו.');
    const f = ((i.message && i.message.embeds) || []).map(e => e.footer).filter(Boolean).pop();   // keep "נשלח על ידי" as it was
    const snd = f && /^נשלח על ידי /.test(f.text || '') ? { name: f.text.replace(/^נשלח על ידי /, ''), icon: f.icon_url || '' } : sender(i);
    const plain = !((i.message && i.message.embeds) || []).length, foot = String((i.message && i.message.content) || '').split('\n').filter(l => l.startsWith('-# הופעל על ידי')).pop() || '';   // a plain message keeps its "הופעל על ידי" line
    await setPending(env, uid, { ids: picked.map(x => String(x.id)), ch: i.channel_id, mid: i.message && i.message.id, snd, plain, foot });
    return reply({ type: 4, data: { flags: 64, content: `מה קרה בסוף עם ${picked.map(x => '**' + clip(x.n, 40) + '**').join(', ')}?`,
      allowed_mentions: { parse: [] }, components: [
        { type: 1, components: [{ type: 3, custom_id: 'tko', placeholder: 'בחר מה קרה בסוף', options: TK_OUT.map(o => ({ label: o, value: o })) }] },
        { type: 1, components: [{ type: 2, style: 2, label: 'אחר, אכתוב בעצמי', custom_id: 'tkx' }] }] } });
  }
  if (i.type === 3 && i.data.custom_id === 'tkx') {                                      // "אחר": a small window to write it
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    return reply({ type: 9, data: { custom_id: 'tkm', title: 'מה קרה בסוף?', components: [{ type: 1, components: [{ type: 4, custom_id: 'out', label: 'מה קרה בסוף', style: 1, min_length: 1, max_length: 150, required: true }] }] } });
  }
  if ((i.type === 3 && i.data.custom_id === 'tko') || (i.type === 5 && i.data.custom_id === 'tkm')) {   // the answer: a ready choice, or the written one
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    const p = await getPending(env, uid);
    if (!p) return reply({ type: 7, data: { content: 'פג תוקף הבחירה. סמן מחדש בהודעה.', components: [] } });
    const written = i.type === 5 ? String(i.data.components?.[0]?.components?.[0]?.value || '').trim() : '';
    const out = i.type === 3 ? String((i.data.values || [])[0] || '') : '', outX = written;
    if (!out && !outX) return reply({ type: 7, data: { content: 'לא נרשם מה קרה בסוף. נסה שוב.', components: [] } });
    const n = await finishTalks(env, new Set(p.ids), uid, out, outX);
    await clearPending(env, uid);
    ctx.waitUntil((async () => {                                                         // refresh the posted message: they move to "שיחות שבוצעו"
      if (p.ch && p.mid) {
        const patch = p.plain
          ? { content: ((await talksPlain(env)) || '-# אין שיחות כרגע') + (p.foot ? '\n' + p.foot : ''), embeds: [], components: await talksSelect(env), allowed_mentions: { parse: [] } }
          : { embeds: (await talksEmbeds(env, logo, p.snd || { name: 'הנהלה', icon: '' }, undefined, i.application_id)) || [], components: await talksSelect(env), allowed_mentions: { parse: [] } };
        await fetch(`https://discord.com/api/v10/channels/${p.ch}/messages/${p.mid}`, { method: 'PATCH', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
      }
      await refreshBoard(env, logo).catch(() => {});                                      // and the board message, wherever the press came from
    })());
    return reply({ type: 7, data: { content: n ? `נרשם: ${out || outX}. השיחות הועברו ל"בוצעו".` : 'השיחות האלה כבר סומנו כבוצעו.', components: [] } });
  }
  if (i.type === 3 && i.data.custom_id === 'tks') {                                      // "שלח" for /שיחות: a normal message, nobody is pinged
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    const text = await talksPlain(env);
    if (!text) return privateMsg('אין שיחות ברשימה.');
    ctx.waitUntil((async () => {
      const body = JSON.stringify({ content: `${text}\n-# הופעל על ידי <@${uid}> בפקודה /שיחות`, components: await talksSelect(env), allowed_mentions: { parse: [] } });
      let r = null;
      if (i.channel_id) { try { r = await fetch(`https://discord.com/api/v10/channels/${i.channel_id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' }, body }); } catch {} }
      if (!r || !r.ok) r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (r.ok) await removePreview();
    })());
    return reply({ type: 6 });
  }
  if (i.type === 3 && String(i.data.custom_id || '').startsWith('dgs:')) {              // "שלח"
    if (!uid || !(await allowed(env, uid))) return privateMsg('הפקודה זמינה רק להנהלת השרת.');
    const kind = i.data.custom_id.slice(4), embeds = kindEmbeds(await snap(env), kind, logo, sender(i));
    if (!embeds) return privateMsg('לא מצאתי את הרשימה. נסה שוב.');
    ctx.waitUntil((async () => {
      // "who ran it" line (shows the person's name, pings nobody except @everyone)
      const body = JSON.stringify({ content: `@everyone\n-# הופעל על ידי <@${uid}> בפקודה /סיכום-שבועי`, embeds, allowed_mentions: { parse: ['everyone'] } });
      let r = null;
      // first as a normal message by the bot (no "message could not be loaded" line above it); in a chat the bot is not in, fall back to the interaction reply
      if (i.channel_id) { try { r = await fetch(`https://discord.com/api/v10/channels/${i.channel_id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' }, body }); } catch {} }
      if (!r || !r.ok) r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (r.ok) await removePreview();
    })());
    return reply({ type: 6 });
  }
  return privateMsg('לא הבנתי את הבקשה.');
}

export { KINDS };

// Talks (the site's "שיחות" page, saved as team/ng_talks): waiting ones first, then ones finished in the last 14 days with how they really ended.
const planTxt = (p, x) => [p, x].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const shortName = full => { const s = String(full || ''); return s.split('|').pop().replace(/[^\p{L}\p{N}]+$/u, '').trim() || s; };
// A person's picture inside a line of text: the picture is uploaded once as one of the bot's own emojis (name av_<id>), and the line uses that emoji.
// The mapping and the picture it was made from are kept in docs 'sys/tk_emoji' ({ id: { h: picture hash, e: emoji id } }), so a changed picture is uploaded again.
const APP_ID = '900000000000000042';
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let k = 0; k < u.length; k += 8192) s += String.fromCharCode(...u.subarray(k, k + 8192)); return btoa(s); };
async function avatarEmojis(env, appId, ids) {
  const H = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, out = {};
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(','), hashes = {};
  try { (await env.DB.prepare(`SELECT id, avatar FROM users WHERE id IN (${marks})`).bind(...ids).all()).results.forEach(r => { if (r.avatar) hashes[r.id] = r.avatar; }); } catch {}
  try { (await env.DB.prepare(`SELECT id, avatar FROM discord_cache WHERE id IN (${marks})`).bind(...ids).all()).results.forEach(r => { if (r.avatar && !hashes[r.id]) hashes[r.id] = r.avatar; }); } catch {}
  await Promise.all(ids.filter(id => !hashes[id]).map(async id => {
    try { const r = await fetch(`https://discord.com/api/v10/users/${id}`, { headers: H }); if (r.ok) { const u = await r.json(); if (u && u.avatar) hashes[id] = String(u.avatar); } } catch {}
  }));
  const saved = (await docVal(env, 'sys/tk_emoji')) || {}; let changed = false;
  const todo = [];
  for (const id of ids) {
    const h = hashes[id] || 'default';
    if (saved[id] && saved[id].h === h) out[id] = `<:av_${id}:${saved[id].e}>`; else todo.push(id);
  }
  // new pictures are uploaded side by side (Discord wants an answer within 3 seconds); the rest are done on the next run
  await Promise.all(todo.slice(0, 8).map(async id => {
    const h = hashes[id] || 'default';
    try {
      let n = 0; try { n = Number((BigInt(id) >> 22n) % 6n); } catch {}
      const url = hashes[id] ? `https://cdn.discordapp.com/avatars/${id}/${hashes[id]}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${n}.png`;
      const img = await fetch(url); if (!img.ok) return;
      const data = 'data:image/png;base64,' + b64(await img.arrayBuffer());
      if (saved[id] && saved[id].e) await fetch(`https://discord.com/api/v10/applications/${appId}/emojis/${saved[id].e}`, { method: 'DELETE', headers: H }).catch(() => {});
      const r = await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: `av_${id}`, image: data }) });
      if (!r.ok) return; const e = await r.json(); if (!e || !e.id) return;
      saved[id] = { h, e: String(e.id) }; out[id] = `<:av_${id}:${e.id}>`; changed = true;
    } catch {}
  }));
  if (changed) { try { await env.DB.prepare("INSERT INTO docs (path, v, by, at) VALUES ('sys/tk_emoji', ?, 'bot', ?) ON CONFLICT(path) DO UPDATE SET v = excluded.v, at = excluded.at").bind(JSON.stringify(saved), Date.now()).run(); } catch {} }
  return out;
}
// Three sections (חמורים / ממתינים / שבוצעו). Each person: line one = picture, name, rank; then small lines for the reason, the plan and who added (or finished) it.
// An English name is wrapped (U+2068 ... U+2069) so it cannot jump around inside a Hebrew line.
export async function talksEmbeds(env, logo, snd, override, appId = APP_ID, withPics = false) {
  const list = override || await docVal(env, 'team/ng_talks');
  const all = Array.isArray(list) ? list : [];
  const cut = Date.now() - 4 * 36e5;                       // finished talks stay 4 hours, like on the site
  const byAdd = (a, b) => String(a.add && a.add.t).localeCompare(String(b.add && b.add.t));
  const open = all.filter(x => x && x.st !== 'done').sort(byAdd);
  const done = all.filter(x => x && x.st === 'done' && new Date((x.fin && x.fin.t) || 0).getTime() >= cut).sort((a, b) => String(b.fin && b.fin.t).localeCompare(String(a.fin && a.fin.t)));
  if (!open.length && !done.length) return null;
  const [staffList, nicks] = await Promise.all([docVal(env, 'team/ng_staff'), docVal(env, 'team/ng_nick')]);
  const staff = Array.isArray(staffList) ? staffList : [];
  const names = {};
  try { (await env.DB.prepare('SELECT id, name FROM users').all()).results.forEach(u => { names[u.id] = shortName(u.name); }); } catch {}
  // who added / finished it is written as a mention (shown as @name, pings nobody): a mention sits in the line as one block, so an English name can never jump to the other end of a Hebrew sentence
  const who = w => !w ? 'הנהלה' : w.auto ? 'אוטומטית' : /^\d{17,20}$/.test(String(w.by || '')) ? `<@${w.by}>` : /^\d{17,20}$/.test(String(w.d || '')) ? `<@${w.d}>` : (names[w.by] || 'הנהלה');
  const iso = s => /^<@/.test(s) ? s : `⁨${s}⁩`;
  const pics = override && !withPics ? {} : await avatarEmojis(env, appId, [...new Set([...open, ...done].map(x => x.sid).filter(Boolean))].slice(0, 40)).catch(() => ({}));
  // the server's own :alertspolice: emoji (found by name through the bot); a plain siren if it is not there
  let siren = '🚨';
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${env.GUILD_ID}/emojis`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (r.ok) { const e = (await r.json()).find(x => x.name === 'alertspolice'); if (e) siren = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`; }
  } catch {}
  const block = (x, mark) => {
    const isDone = x.st === 'done', m = staff.find(s => s && s.id === x.sid), rank = m ? (RANK_HE[m.rank] || m.rank || 'דרגה לא ידועה') : 'לא ברשימת הצוות';
    const head = [pics[x.sid] || mark, x.sid ? `<@${x.sid}>` : `**${clip(x.n, 60)}**`, `דרגה: ${rank}`].filter(Boolean).join(' · ').replace(/^(\S+) · /, '$1 ');
    const plan = planTxt(x.plan, x.planX), why = planTxt(x.why, x.whyX) || 'לא נכתבה', by = who(isDone ? x.fin : x.add);
    // the line with the Hebrew text never contains the adder's name: it ends with "...על ידי:" and the name sits alone on the next line, so the two can never swap places
    return isDone
      ? `${head}\n-# בסוף: ${clip(planTxt(x.out, x.outX) || 'בוצעה שיחה', 100)}${plan ? ` (תוכנן: ${clip(plan, 40)})` : ''}\n-# סיבה: ${clip(why, 90)} · סומן על ידי:\n-# ${by}`
      : `${head}\n-# סיבה: ${clip(why, 100)}${plan ? ` · מתוכנן: ${clip(plan, 50)}` : ''} · נוסף על ידי:\n-# ${by}`;
  };
  // each section is ordered by rank: helpers first, then moderators, admins, senior admins (people not on the staff list last); inside a rank, the one waiting longest first
  const RANK_ORDER = ['helper', 'mod', 'admin', 'senior'];
  const rankIdx = x => { const m = staff.find(s => s && s.id === x.sid), k = m ? RANK_ORDER.indexOf(m.rank) : -1; return k < 0 ? 99 : k; };
  const byRank = (a, b) => rankIdx(a) - rankIdx(b);   // Array.sort is stable: the time order from before is kept inside a rank
  open.sort(byRank); done.sort(byRank);
  const section = (title, items, color, mark) => {         // an embed holds 4096 characters: cut the list, say how many are left
    let text = '', n = 0;
    for (const x of items) { const b = block(x, mark) + '\n\n'; if ((text + b).length > 3700) break; text += b; n++; }
    if (n < items.length) text += `-# ועוד ${items.length - n} באתר`;
    return { title, description: text.trim(), color };
  };
  const out = [];
  if (open.some(x => x.sev)) out.push(section('חמורים 🚨', open.filter(x => x.sev), 0xed4245, siren));
  if (open.some(x => !x.sev)) out.push(section('ממתינים לשיחה', open.filter(x => !x.sev), 0xf0b232, '⏳'));
  if (done.length) out.push(section('שיחות שבוצעו', done, 0x3ba55d, '✅'));
  out[out.length - 1].footer = { text: `נשלח על ידי ${snd.name}`, ...(snd.icon ? { icon_url: snd.icon } : {}) };
  return out;
}

// The /שיחות message as plain text (not an embed): a title per rank, the regular talks numbered, then a smaller "חריגים" heading with a one-line explanation.
// Someone who already had the talk stays in his place and gets "✅ עבר שיחה" at the end of his line (for 4 hours, like everywhere). One message, so it is cut at about 1850 characters with "ועוד N באתר".
const PLAIN_RANK = { helper: 'הלפרים', mod: 'מודים', admin: 'אדמינים', senior: 'אדמינים ראשיים' };
const PLAIN_EXPLAIN = '-# שבועיים ברצף בלי מינימום ומעלה, או שתי אזהרות, או אזהרה לפני העפה';
export async function talksPlain(env, override) {
  const list = override || await docVal(env, 'team/ng_talks');
  const all = Array.isArray(list) ? list : [], cut = Date.now() - 4 * 36e5;
  const keep = all.filter(x => x && (x.st !== 'done' || new Date((x.fin && x.fin.t) || 0).getTime() >= cut)).sort((a, b) => String(a.add && a.add.t).localeCompare(String(b.add && b.add.t)));
  if (!keep.length) return null;
  const staffList = await docVal(env, 'team/ng_staff'), staff = Array.isArray(staffList) ? staffList : [];
  const rankOf = x => { const m = staff.find(s => s && s.id === x.sid); return m && PLAIN_RANK[m.rank] ? m.rank : ''; };
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })), pad = n => String(n).padStart(2, '0');
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  const lines = [];
  // one line per person: number, name, reason, and after the arrow the plan (or, once the talk is done, what really happened)
  const mk = counter => x => `**${++counter.n}.** ${x.sid ? `<@${x.sid}>` : `**${clip(x.n, 60)}**`} · ${clip(planTxt(x.why, x.whyX) || 'לא נכתבה סיבה', 140)}${(() => { const t = x.st === 'done' && planTxt(x.out, x.outX) ? planTxt(x.out, x.outX) : planTxt(x.plan, x.planX); return t ? ` ➜ **${clip(t, 60)}**` : ''; })()}`;
  const waiting = keep.filter(x => x.st !== 'done'), had = keep.filter(x => x.st === 'done');
  for (const k of ['helper', 'mod', 'admin', 'senior', '']) {
    const g = waiting.filter(x => rankOf(x) === k); if (!g.length) continue;
    const line = mk({ n: 0 });                                   // numbers restart in each rank and close up when someone moves out
    if (lines.length) lines.push('');
    lines.push(`# שיחות ${PLAIN_RANK[k] || 'ללא דרגה'} · ${date}`, ...g.filter(x => !x.sev).map(line));
    const exc = g.filter(x => x.sev);
    if (exc.length) lines.push('### 🚨 חריגים', PLAIN_EXPLAIN, ...exc.map(line));
  }
  // everyone who already had the talk moves to the end, under one heading, in rank order (helpers first), no matter their rank
  if (had.length) {
    const order = x => ['helper', 'mod', 'admin', 'senior'].indexOf(rankOf(x)), line = mk({ n: 0 });   // not on the staff list = -1
    if (lines.length) lines.push('');
    lines.push('# ✅ עברו שיחות', ...had.slice().sort((a, b) => order(b) - order(a)).map(line));   // highest rank first: senior admins, admins, mods, helpers, then the rest
  }
  let text = lines.join('\n'), cutN = 0;
  while (text.length > 1830 && lines.length > 1) { const l = lines.pop(); if (/^\*\*\d+\./.test(l)) cutN++; text = lines.join('\n'); }
  return cutN ? `${text}\n-# ועוד ${cutN} באתר` : text;
}

// The drop-down under the /שיחות message: pick who had their talk, and they move to "done" (up to 25 waiting people fit in a menu)
export async function talksSelect(env, override) {
  const list = override || await docVal(env, 'team/ng_talks');
  const open = (Array.isArray(list) ? list : []).filter(x => x && x.st !== 'done').sort((a, b) => (b.sev ? 1 : 0) - (a.sev ? 1 : 0)).slice(0, 25);
  if (!open.length) return [];
  const options = open.map(x => { const d = clip(planTxt(x.why, x.whyX), 100); return { label: clip(x.n, 100) || 'ללא שם', value: String(x.id), ...(d ? { description: d } : {}) }; });
  return [{ type: 1, components: [{ type: 3, custom_id: 'tkd', placeholder: 'סמן מי עבר שיחה', min_values: 1, max_values: 1, options }] }];   // one person at a time, so each one gets his own result
}
// ---- The talks board: one message in its own room, posted when the weekly talks are added and refreshed now and then (whoever changed something, and wherever).
// Only this message and the one somebody pressed on are updated; other /שיחות messages are left as they were. Its place is kept in docs 'sys/tk_board'.
const BOARD_CH = '900000000000000043';
const boardGet = async env => (await docVal(env, 'sys/tk_board')) || {};
const boardSave = (env, v) => env.DB.prepare("INSERT INTO docs (path, v, by, at) VALUES ('sys/tk_board', ?, 'bot', ?) ON CONFLICT(path) DO UPDATE SET v = excluded.v, at = excluded.at").bind(JSON.stringify(v), Date.now()).run();
const hashOf = s => { let h = 5381; for (let k = 0; k < s.length; k++) h = ((h << 5) + h + s.charCodeAt(k)) | 0; return String(h); };
async function boardBody(env, logo) {
  const embeds = await talksEmbeds(env, logo, { name: 'המערכת, מתעדכן אוטומטית', icon: '' });
  if (!embeds) return { content: '-# סיכום שיחות · אין שיחות כרגע', embeds: [], components: [], allowed_mentions: { parse: [] } };
  return { content: '-# סיכום שיחות · מתעדכן אוטומטית', embeds, components: await talksSelect(env), allowed_mentions: { parse: [] } };
}
const botH = env => ({ Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' });
export async function refreshBoard(env, logo, force) {                       // edit the board message to match the shared list (only if something changed)
  const st = await boardGet(env); if (!st.mid || !st.ch) return { skipped: 'no_board' };
  const body = await boardBody(env, logo), hash = hashOf(JSON.stringify(body));
  if (!force && st.hash === hash) return { skipped: 'same' };
  const r = await fetch(`https://discord.com/api/v10/channels/${st.ch}/messages/${st.mid}`, { method: 'PATCH', headers: botH(env), body: JSON.stringify(body) });
  if (r.status === 404) { await boardSave(env, { ...st, mid: '' }); return { skipped: 'message_deleted' }; }   // someone deleted it: it is posted again with the next weekly batch
  if (r.ok) await boardSave(env, { ...st, hash });
  return { ok: r.ok, status: r.status };
}
export async function postBoard(env, logo, wk) {                             // a fresh message for a new week (the old one is first brought up to date and then left alone)
  const st = await boardGet(env);
  if (wk && st.wk === wk) return { skipped: 'same_week' };
  const body = await boardBody(env, logo); if (!body.embeds.length) return { skipped: 'empty' };
  if (st.mid) await refreshBoard(env, logo, true);
  const r = await fetch(`https://discord.com/api/v10/channels/${BOARD_CH}/messages`, { method: 'POST', headers: botH(env), body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json(); await boardSave(env, { ch: BOARD_CH, mid: String(j.id), wk: wk || st.wk || '', hash: hashOf(JSON.stringify(body)) });
  return { ok: true };
}
// marks talks as done in the shared document (same format and backup as the site's own saving)
const TK_OUT = ['אזהרת צוות', 'הועף', 'הורדת דרגה', 'שיחת פעילות', 'לא נעשה כלום', 'עבר שיחה, ממשיך כרגיל'];   // same choices as the site
// what the person picked in the posted message, kept for a few minutes until they say how it ended (docs path sys/tkp/<id>)
const setPending = (env, uid, v) => env.DB.prepare('INSERT INTO docs (path, v, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET v = excluded.v, by = excluded.by, at = excluded.at')
  .bind('sys/tkp/' + uid, JSON.stringify(v), uid, Date.now()).run();
async function getPending(env, uid) {
  try { const r = await env.DB.prepare('SELECT v, at FROM docs WHERE path = ?').bind('sys/tkp/' + uid).first(); return r && Date.now() - r.at < 30 * 60000 ? JSON.parse(r.v) : null; } catch { return null; }
}
const clearPending = (env, uid) => env.DB.prepare('DELETE FROM docs WHERE path = ?').bind('sys/tkp/' + uid).run().catch(() => {});
export async function finishTalks(env, ids, uid, out = '', outX = '') {
  const row = await env.DB.prepare("SELECT v FROM docs WHERE path = 'team/ng_talks'").first(); if (!row) return 0;
  let doc; try { doc = JSON.parse(row.v); } catch { return 0; }
  const list = Array.isArray(doc && doc.v) ? doc.v : []; let n = 0; const iso = new Date().toISOString();
  list.forEach(x => { if (x && x.st !== 'done' && ids.has(String(x.id))) { x.st = 'done'; x.out = out; x.outX = outX; x.fin = { t: iso, by: uid, d: uid }; n++; } });
  if (!n) return 0;
  const at = Date.now(), text = JSON.stringify({ v: list, by: uid, at: iso });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO doc_history (path, v, by, at) SELECT path, v, by, at FROM docs WHERE path = 'team/ng_talks'"),
    env.DB.prepare("UPDATE docs SET v = ?, by = ?, at = ? WHERE path = 'team/ng_talks'").bind(text, uid, at),
  ]);
  return n;
}

const RANK_HE = { helper: 'הלפר', mod: 'מודרייטור', admin: 'אדמין', senior: 'אדמין ראשי' };
const NEXT_RANK = { helper: 'mod', mod: 'admin', admin: 'senior' };
const PROMO_DAYS = { helper: 21, mod: 30, admin: 45 };
const MIN_DEFAULT = { helper: { t: 30, r: null }, mod: { t: 25, r: 60 }, admin: { t: 20, r: 50 }, senior: { t: 15, r: 40 } };
const docVal = async (env, path) => {
  try { const r = await env.DB.prepare('SELECT v FROM docs WHERE path = ?').bind(path).first(); if (!r) return null; const j = JSON.parse(r.v); return j && j.v !== undefined ? j.v : j; } catch { return null; }
};
const dayMs = iso => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };

// the private answer for "סטטוס צוות": taken from the site's saved data (same numbers the site shows)
export async function memberStatus(env, id, i) {
  if (!id) return 'לא נבחר משתמש.';
  const [staff, mins, feed] = await Promise.all([docVal(env, 'team/ng_staff'), docVal(env, 'team/ng_mins'), docVal(env, 'team/ng_feed')]);
  const m = (Array.isArray(staff) ? staff : []).find(x => x && x.id === id);
  if (!m) return 'לא נמצא באתר. המשתמש הזה לא ברשימת הצוות.';
  const u = (i.data.resolved && i.data.resolved.users && i.data.resolved.users[id]) || {};
  const lines = [`## ${m.name || u.global_name || u.username || 'איש צוות'}`, `**דרגה:** ${RANK_HE[m.rank] || m.rank || 'לא ידוע'}`];
  const flags = [m.noSlot && 'לא סלוט', m.absent && 'בהיעדרות', m.delayed && 'קידום מעוכב', m.gone && 'עזב'].filter(Boolean);
  if (flags.length) lines.push(`**מצב:** ${flags.join(', ')}`);
  // this week's numbers vs the minimum
  const req = { ...(MIN_DEFAULT[m.rank] || {}), ...((mins || {})[m.rank] || {}) };
  const row = ((feed && feed.act && feed.act.rows) || []).find(x => x && x[0] === id);
  if (row) {
    const parts = [];
    if (req.t != null && !req.tOff) parts.push(`טיקטים ${row[1]} מתוך ${req.t}`);
    if (req.r != null && !req.rOff) parts.push(`רפורטים ${row[2]} מתוך ${req.r}`);
    if (parts.length) lines.push(`**השבוע:** ${parts.join(' • ')}`);
    else lines.push(`**השבוע:** טיקטים ${row[1]} • רפורטים ${row[2]}`);
  } else lines.push('**השבוע:** אין נתונים עדיין');
  // promotion: days in rank
  const nx = NEXT_RANK[m.rank];
  if (nx && m.rankSince) {
    const days = Math.max(0, Math.floor((dayMs(Date.now()) - dayMs(m.rankSince)) / 864e5)), need = PROMO_DAYS[m.rank];
    lines.push(days >= need ? `**ותק לקידום:** מספיק (${days} ימים בדרגה)` : `**ותק לקידום:** עוד ${need - days} ימים`);
  } else if (!nx) lines.push('**קידום:** דרגה עליונה');
  const w = (m.warns || []).filter(x => !x.ex || new Date(x.ex) > new Date());
  lines.push(w.length ? `**אזהרות פעילות:** ${w.length}` : '**אזהרות:** אין');
  const at = feed && feed.at ? Math.round((Date.now() - new Date(feed.at)) / 3600000) : null;
  if (at != null) lines.push(`-# נתונים מלפני ${at < 1 ? 'פחות משעה' : at + ' שעות'}`);
  return lines.join('\n').slice(0, 1900);
}

// who pressed: their name in the server (or Discord name) and picture, for "נשלח על ידי" at the bottom
function sender(i) {
  const u = (i.member && i.member.user) || i.user || {};
  const full = (i.member && i.member.nick) || u.global_name || u.username || '';
  const name = String(full).split('|').pop().replace(/[^\p{L}\p{N}]+$/u, '').trim() || full;   // "S.SM | OWNER_NAME" → "OWNER_NAME"
  const icon = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : '';
  return { name, icon };
}

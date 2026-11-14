// Shared helpers for the Pages Functions: sessions (signed cookie), access rules, JSON replies.
export const SESSION_HOURS = 400 * 24;          // stay logged in (400 days is the most browsers keep a cookie)
export const CHECK_MS = 6 * 3600e3;             // …but the role on Discord is re-checked in the background every 6 hours
export const COOKIE = '__Host-ng_s';            // __Host-: only over HTTPS, only this exact site, path / — can't be set by a subdomain
const enc = new TextEncoder();

// Headers on every response the functions produce
export const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};
export const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS, ...extra },
});
export const ids = s => String(s || '').split(/[\s,]+/).map(x => x.trim()).filter(x => /^\d{17,20}$/.test(x));
export const isOwner = (env, id) => ids(env.OWNER_IDS).includes(id);

export function getCookie(request, name) {
  const all = request.headers.get('cookie') || '';
  for (const part of all.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return '';
}

const b64u = bytes => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
function sameText(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// user = { id, name, sv }  — sv is the person's session version: raising it in the DB logs out every copy of their cookie
export async function makeSession(env, user) {
  const payload = b64u(enc.encode(JSON.stringify({ ...user, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  return payload + '.' + await sign(env.SESSION_SECRET, payload);
}
export async function readSession(env, request) {
  const raw = getCookie(request, COOKIE); if (!raw || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return null;
  const [payload, sig] = raw.split('.'); if (!payload || !sig) return null;
  if (!sameText(await sign(env.SESSION_SECRET, payload), sig)) return null;
  try { const u = JSON.parse(new TextDecoder().decode(unb64u(payload))); return u && u.exp > Date.now() && /^\d{17,20}$/.test(u.id) ? u : null; } catch { return null; }
}
export const sessionCookie = v => `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
export const clearSessionCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Who may get in: owners always; then the exceptions list (allow / deny); then the management role(s) on the Discord server
// Discord role → the rank shown on the site, lowest to highest. Role IDs are not secrets (anyone in the server can see them).
export const RANK_ROLES = [
  ['900000000000000044', 'הלפר'],
  ['900000000000000045', 'מודרייטור'],
  ['900000000000000046', 'אדמין'],
  ['900000000000000047', 'אדמין ראשי'],
  ['900000000000000048', 'יועץ'],
  ['900000000000000049', 'סגן אחראי צוות'],
  ['900000000000000050', 'אחראי צוות'],
  ['900000000000000051', 'סגן מנהל שרת'],
  ['900000000000000052', 'מנהל שרת'],
  ['900000000000000053', 'מפקח קהילה'],
  ['900000000000000054', 'מנהל קהילה'],
  ['900000000000000055', 'הנהלה ראשית'],
  ['900000000000000056', 'מנכ"ל קהילה'],
  ['900000000000000057', 'בעלים'],
];
export function rankOf(roles) {
  const have = new Set((roles || []).map(String));
  for (let i = RANK_ROLES.length - 1; i >= 0; i--) if (have.has(RANK_ROLES[i][0])) return RANK_ROLES[i][1];
  return '';
}
export async function accessFor(env, id, roles) {
  if (isOwner(env, id)) return { ok: true, why: 'owner' };
  const ex = await env.DB.prepare('SELECT mode FROM access WHERE id = ?').bind(id).first();
  if (ex && ex.mode === 'deny') return { ok: false, why: 'denied' };
  if (ex && ex.mode === 'allow') return { ok: true, why: 'allowed' };
  const want = ids(env.ROLE_IDS);
  return (roles || []).some(r => want.includes(r)) ? { ok: true, why: 'role' } : { ok: false, why: 'norole' };
}

// ---- Discord tokens, kept encrypted (AES-GCM, key derived from SESSION_SECRET), so the role can be re-checked later ----
async function tokKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.SESSION_SECRET + ':discord-tokens'));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function sealTokens(env, t) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokKey(env), enc.encode(JSON.stringify(t))));
  return b64u(iv) + '.' + b64u(ct);
}
export async function openTokens(env, s) {
  try { const [iv, ct] = String(s || '').split('.'); if (!iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await tokKey(env), unb64u(ct));
    return JSON.parse(new TextDecoder().decode(pt)); } catch { return null; }
}
const tokFrom = j => ({ a: j.access_token, r: j.refresh_token, ae: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 });
export async function exchangeToken(env, params) {
  const r = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, ...params }) });
  if (r.ok) return { ok: true, tok: tokFrom(await r.json()) };
  let err = ''; try { err = (await r.json()).error || ''; } catch {}
  return { ok: false, status: r.status, revoked: err === 'invalid_grant' };
}

// Re-check one person's role on Discord. Returns { keep: true } to let them stay, { keep: false } to log them out.
// Only a clear answer from Discord logs someone out; if Discord is down or slow, they stay and we try again soon.
export async function recheck(env, id) {
  const row = await env.DB.prepare('SELECT tok FROM users WHERE id = ?').bind(id).first();
  let tok = row && await openTokens(env, row.tok);
  if (!tok || !tok.r) return { keep: false };                                   // logged in before tokens were kept: log in once more
  const save = t => env.DB.prepare('UPDATE users SET tok = ? WHERE id = ?').bind(t, id).run();
  if (Date.now() > tok.ae) {
    const x = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: tok.r });
    if (!x.ok) return x.revoked ? { keep: false } : { keep: true, retry: true };
    tok = x.tok; await save(await sealTokens(env, tok));
  }
  const m = await fetch(`https://discord.com/api/users/@me/guilds/${env.GUILD_ID}/member`, { headers: { Authorization: 'Bearer ' + tok.a } });
  if (m.status === 404) return { keep: false };                                 // left the server
  if (m.status === 401) { tok.ae = 0; await save(await sealTokens(env, tok)); return { keep: true, retry: true }; }
  if (!m.ok) return { keep: true, retry: true };                                // rate limit / Discord trouble
  const member = await m.json();
  const acc = await accessFor(env, id, member.roles);
  if (member.nick) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(member.nick).slice(0, 64), id).run();
  await env.DB.prepare('UPDATE users SET rank = ? WHERE id = ?').bind(rankOf(member.roles), id).run();
  if (member.user && typeof member.user.avatar === 'string') await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(member.user.avatar.slice(0, 64), id).run();   // a new profile picture shows up within hours
  return { keep: acc.ok };
}

// A small full page (login result / errors), in the site's look. No scripts at all.
export function page(title, text, button, status = 200) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>New Gamers Admin</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e8eef9;font:16px/1.6 system-ui,"Segoe UI",sans-serif}
.c{max-width:26rem;margin:16px;padding:2rem;border-radius:20px;background:#121826;border:1px solid #1f2a3d;text-align:center}h1{font-size:1.3rem;margin:0 0 .6rem}p{color:#9fb0c8;margin:0 0 1.4rem}
a{display:inline-block;padding:.7rem 1.4rem;border-radius:12px;background:#5865f2;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(text)}</p>${button ? `<a href="${esc(button.href)}">${esc(button.label)}</a>` : ''}</div></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}

// Only these shared documents exist (the site's shared keys); anything else is refused
export const TEAM_KEYS = ['ng_resets', 'ng_tenders', 'ng_tender_owners', 'ng_tender_batch', 'ng_log', 'ng_staff', 'ng_mins', 'ng_act', 'ng_act_imp', 'ng_staff_meta', 'ng_alias', 'ng_nick', 'ng_warn_ack', 'ng_reset_pending', 'ng_claims', 'ng_calls', 'ng_pnotes', 'ng_talks', 'ng_talks_meta', 'ng_list_btns', 'ng_feed', 'ng_feed_st'];
export const docAllowed = (path, uid) => (path.startsWith('team/') && TEAM_KEYS.includes(path.slice(5))) || path === `data/users/${uid}/state`;

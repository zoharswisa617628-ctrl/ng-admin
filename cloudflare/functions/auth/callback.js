import { getCookie, accessFor, makeSession, sessionCookie, page, exchangeToken, sealTokens, rankOf } from '../_lib.js';

// Step 2: Discord sends the person back with a code. We read who they are and their roles on the server, then let them in or not.
// Their Discord tokens are kept (encrypted) so the role can be re-checked in the background later without logging in again.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) return page('האתר לא מוגדר עד הסוף', 'חסרים מפתחות בהגדרות השרת.', null, 500);
  const retry = { href: '/auth/login', label: 'נסה שוב' };
  if (url.searchParams.get('error')) return page('ההתחברות בוטלה', 'כדי להיכנס צריך לאשר בדיסקורד.', retry);
  if (!code || !state || state !== getCookie(request, 'ng_st')) return page('ההתחברות לא הצליחה', 'משהו השתבש בדרך. נסה שוב.', retry);

  const x = await exchangeToken(env, { grant_type: 'authorization_code', code, redirect_uri: url.origin + '/auth/callback' });
  if (!x.ok) return page('ההתחברות לא הצליחה', 'דיסקורד לא אישר את ההתחברות. נסה שוב.', retry);
  const H = { Authorization: 'Bearer ' + x.tok.a };
  const meRes = await fetch('https://discord.com/api/users/@me', { headers: H });
  if (!meRes.ok) return page('ההתחברות לא הצליחה', 'לא הצלחתי לקרוא את החשבון שלך בדיסקורד.', retry);
  const me = await meRes.json();
  const memRes = await fetch(`https://discord.com/api/users/@me/guilds/${env.GUILD_ID}/member`, { headers: H });
  const member = memRes.ok ? await memRes.json() : null;
  const name = (member && member.nick) || me.global_name || me.username;
  const acc = await accessFor(env, me.id, member ? member.roles : []);
  const sealed = await sealTokens(env, x.tok);

  await env.DB.prepare(`INSERT INTO users (id, name, avatar, last, ok, tok, chk, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, last = excluded.last, ok = excluded.ok, tok = excluded.tok, chk = excluded.chk, rank = excluded.rank`)
    .bind(me.id, String(name).slice(0, 64), me.avatar || '', new Date().toISOString(), acc.ok ? 1 : 0, sealed, Date.now(), rankOf(member ? member.roles : [])).run();

  if (!acc.ok) return page(`שלום ${name}`,
    !member ? 'אתה לא נמצא בשרת הדיסקורד של New Gamers, אז אין לך גישה לאתר.'
      : acc.why === 'denied' ? 'הגישה שלך לאתר נחסמה. אם זו טעות, פנה להנהלה.'
      : 'האתר פתוח רק להנהלה. אם אתה בהנהלה ובכל זאת רואה את זה, פנה למי שמנהל את האתר.',
    { href: '/auth/logout', label: 'התחברות עם חשבון אחר' });

  const sv = ((await env.DB.prepare('SELECT sv FROM users WHERE id = ?').bind(me.id).first()) || {}).sv || 0;
  const h = new Headers({ Location: '/' });
  h.append('Set-Cookie', sessionCookie(await makeSession(env, { id: me.id, name, sv })));
  h.append('Set-Cookie', 'ng_st=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return new Response(null, { status: 302, headers: h });
}

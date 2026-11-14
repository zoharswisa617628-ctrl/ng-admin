// Step 1 of "Log in with Discord": send the person to Discord's consent screen
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), state = crypto.randomUUID();
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: url.origin + '/auth/callback',
    scope: 'identify guilds.members.read', state, prompt: 'none',
  });
  const h = new Headers({ Location: 'https://discord.com/oauth2/authorize?' + q });
  h.append('Set-Cookie', `ng_st=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers: h });
}

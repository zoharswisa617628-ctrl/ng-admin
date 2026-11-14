import { json } from '../_lib.js';
import { KINDS } from '../../shared/digest-embed.js';

// Owner only: registers the /סיכום-שבועי command on the bot's application (usable from a personal install, in DMs, group DMs and servers)
// and returns the application's id and public key (public values, needed to set the interactions address).
export async function onRequestPost({ env, data }) {
  if (!data.user.owner) return json({ error: 'owners_only' }, 403);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: 'no_bot' }, 500);
  const H = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' };
  const app = await (await fetch('https://discord.com/api/v10/applications/@me', { headers: H })).json();
  if (!app || !app.id) return json({ error: 'app', detail: app }, 502);
  const cmd = {
    name: 'סיכום-שבועי', description: 'שליחת הסיכום השבועי של הצוות', type: 1,
    integration_types: [0, 1], contexts: [0, 1, 2],
    options: [{ type: 3, name: 'סוג', description: 'איזה סיכום', required: true, choices: KINDS.map(k => ({ name: k.name, value: k.value })) }],
  };
  const r = await fetch(`https://discord.com/api/v10/applications/${app.id}/commands`, { method: 'PUT', headers: H, body: JSON.stringify([cmd, { name: 'סטטוס צוות', type: 2, integration_types: [0, 1], contexts: [0, 1, 2] },
    { name: 'שיחות', description: 'מי ממתין לשיחה ואיך שיחות שבוצעו הסתיימו', type: 1, integration_types: [0, 1], contexts: [0, 1, 2] }]) });
  return json({ appId: app.id, name: app.name, verifyKey: app.verify_key, commands: r.status, detail: r.ok ? undefined : await r.text() });
}

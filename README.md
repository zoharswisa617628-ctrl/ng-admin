# New Gamers Admin

A Hebrew (RTL) staff panel for a FiveM community server: shared staff data, weekly summary to Discord, a "talks" workflow with a Discord bot, tenders, trust resets and more. It runs on the Cloudflare free plan (Pages + Functions + D1 + a cron Worker) and signs in with Discord.

> This is a sanitized copy of a private project. All secrets and real Discord IDs were removed or replaced by placeholders. Start with **[SESSION-HANDOFF.md](SESSION-HANDOFF.md)**: it explains the structure, the placeholders you must fill, how to build and deploy, and the conventions.

- `index.html`: the whole site (single source file)
- `cloudflare/`: functions (API, auth, Discord bot), database schema, cron worker, build script; `cloudflare/README.md` is the Hebrew setup guide
- `chrome-extension/`: sends the staff site's tables to the panel

No license is attached yet: add one before accepting contributions.

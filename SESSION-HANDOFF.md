# SESSION-HANDOFF: New Gamers Admin

Read this first if you are a new coding session (or a new developer) picking up this repo.

## What this is

A private staff panel for an Israeli FiveM community server ("New Gamers"). The UI is **Hebrew, right-to-left**. Only members who hold the server's management role can log in (Discord OAuth). The people who use it are the server's management; the owner writes in Hebrew and prefers short, simple answers.

It runs entirely on the **Cloudflare free plan**:

| Part | What | Where |
|---|---|---|
| Site | one big single-page app, plain JS, no framework | `index.html` (the only source of the site) |
| API + auth + Discord bot | Cloudflare Pages Functions | `cloudflare/functions/` |
| Database | Cloudflare D1 (SQLite) | `cloudflare/schema.sql`, `cloudflare/migrations/` |
| Background job (every 30 min) | Worker with a cron trigger | `cloudflare/cron/` |
| Phone notifications | Web Push (VAPID) | `cloudflare/shared/webpush.js`, `notify-all.js` |
| Browser extension | sends the staff site's tables to this site | `chrome-extension/` |

## Not in this repo (on purpose)

- All **secrets**: `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `VAPID_PRIVATE`, `DISCORD_BOT_TOKEN`, and the extension token. They live in Cloudflare (Pages secrets) and must be set with `wrangler pages secret put`.
- All real **Discord IDs** (server, roles, channels, users, the app). Every 17-20 digit ID in the code was replaced by a unique placeholder such as `900000000000000038`. Replace them with your own (see "Placeholders").
- Real domains (`YOUR-PROJECT.pages.dev`, `staff.example.com`), the owner's name (`OWNER_NAME`), the D1 database id, the Discord/VAPID public keys.
- Built output (`cloudflare/public/app.js`, `boot.js`, `img.js`, `index.html`), images, GIF/PNG designs, icons. Build output is produced by `build.ps1`.

## Setup in short

1. `cloudflare/README.md` (Hebrew) has the full first-time setup: Cloudflare account, D1, Discord app, `wrangler.toml`.
2. Fill the placeholders in `cloudflare/wrangler.toml` and `cloudflare/cron/wrangler.toml`.
3. Create the D1 database and run `schema.sql`, then the files in `migrations/` that are newer than your schema.
4. Build and deploy (PowerShell, from `cloudflare/`):
   ```
   .\build.ps1                      # builds public/ from ../index.html (keep it ASCII-only; edit only index.html)
   npx wrangler@4 pages deploy      # functions deploy with it
   cd cron; npx wrangler@4 deploy   # only when cron/ changed
   ```
5. Register the Discord commands once: an owner calls `POST /api/discord-setup` (header `x-ng: 1`). It registers `/סיכום-שבועי`, the user context menu `סטטוס צוות`, and `/שיחות`. Set the app's Interactions Endpoint URL to `https://<site>/discord/interactions`.
6. Users can also install the app on their account (integration_type=1) so the commands work in DMs and group chats.

## Placeholders to replace

All numeric placeholders look like `9000000000000000NN`. Where they live:

- `cloudflare/functions/_lib.js` — `RANK_ROLES` (management rank role ids, lowest to highest)
- `cloudflare/functions/api/discord-send.js` — `ROOMS` (the four weekly-summary rooms: warnings / promotions / did not pass / passed)
- `cloudflare/functions/discord/interactions.js` — `APP_ID` (Discord application id), `BOARD_CH` (the room of the talks board message)
- `index.html` — Discord channel links and a few ids used by the training/format pages
- `cloudflare/wrangler.toml` — `GUILD_ID`, `ROLE_IDS`, `OWNER_IDS`, `DISCORD_CLIENT_ID`, `DISCORD_PUBLIC_KEY`, `VAPID_PUBLIC`, `database_id` (named placeholders `YOUR_...`)
- `chrome-extension/background.js` — `EXT_TOKEN` must equal the Pages secret `EXT_TOKEN`

## How the data is stored

One table does most of the work: `docs(path, v, by, at)`.

- `team/<key>` = shared documents for the whole management, stored as JSON `{ v, by, at }`. A write replaces only that key. Allowed keys are listed in `TEAM_KEYS` (`functions/_lib.js`), and the same list exists as `SHARED_KEYS` / `isSyncKey` in `index.html`. **A new shared key must be added in all three places.** The previous version of each shared doc is kept 14 days in `doc_history` (restore from `access.html`).
- `sys/*` = server-only state (`sys/digest_snap`, `sys/digest_sent`, `sys/tk_emoji`, `sys/tk_board`, `sys/tk_cron`, `sys/tkp/<userId>`). These are not reachable from the browser (`docAllowed`).
- Other tables: `users`, `access` (allow/deny exceptions), `doc_history`, `discord_cache`, `visits` (site visits per person per day, shown on `access.html`), push subscriptions, `notif_sent`.
- The site keeps a local copy of the shared keys in `localStorage` and syncs them through `/api/doc`.

## Main features (where to look)

- **Auth**: `functions/auth/*`, `functions/_middleware.js` (login page for everyone else), `functions/api/_middleware.js` (session, block list, role re-check, rate limit).
- **Staff list, minimums, promotions**: in `index.html` (`staff`, `mins`, `minState`, `promoState`, `warnState`). Minimums: helper 30 tickets; mod 60 reports + 25 tickets; admin 50 reports + 20 tickets; senior 40 reports + 15 tickets. Weeks start on **Sunday**. Promotion eligibility looks at the last finished week.
- **Sync from the staff site**: the owner presses a bookmark / the extension; the page imports the tables (`syncImport`). Reset detection (`resetAnswer`, `maybeAutoDigest`) works from the tables going to zero or from the staff site's history.
- **Weekly summary**: four lists sent to four Discord rooms, once per week, after a reset is detected (`maybeAutoDigest`, `functions/api/discord-send.js`, `shared/digest-embed.js`, `shared/notify-all.js` for one push to everyone). Also available as the slash command `/סיכום-שבועי` (`functions/discord/interactions.js`).
- **Talks page ("שיחות")**: people who need a talk with management, with reason, plan and the real outcome.
  - Page: `renderTalks` and `tk*` helpers in `index.html`; shared key `ng_talks` (and `ng_talks_meta` = the week the automatic adding already ran for).
  - Automatic adding after each weekly summary: `tkAutoAdd`. Everyone who missed the minimum is added. "Serious" (חריגים/חמורים) = two weeks in a row without the minimum, or two warnings, or a "לפני העפה" warning (`tkIsSerious`, same rule server side is only used for display).
  - A finished talk stays 4 hours (`tkPrune`, server side the same cut). A waiting talk never disappears.
  - Discord: `/שיחות` sends a **plain message** (`talksPlain`): a heading per rank, regular talks numbered, a smaller "חריגים" section, and a "✅ עברו שיחות" section at the end (highest rank first). A single-select drop-down under it marks who had the talk; the user is then asked privately (select or modal) what really happened. That outcome replaces the plan on the line. Only the pressed message and the board message are edited.
  - The **board** message (`BOARD_CH`) is an **embed** (`talksEmbeds`): posted once per week when talks are added (`/api/talks-board` action `post`), refreshed on every change (`refresh`) and by the cron worker through `functions/discord/talks-refresh.js`.
- **Designs page**: images listed in `public/designs/manifest.json` (not in this repo).
- **Access page** (`public/access.html`, `functions/api/access.js`): exceptions, who logged in, backups, and the visits card. Owner only.

## Conventions and rules the owner set

- Answer the owner in Hebrew, short and simple. Ask before anything outward-facing (a real Discord send pings people).
- Keep the **dark design with the sky-blue accent**. Use the site's own classes (`.card`, `.chip`, `.inp`, `.btn`); never use native browser widgets (datalist, default popups) in new UI. Check a screenshot before deploying a new page.
- Everyone in management sees everyone's actions (every action carries who did it). Names stay as they are in Discord.
- Never write counts as digits right next to a name in RTL text (they jump around). Use words, or put them in their own element.
- `index.html` is the single source of the site. `build.ps1` splits its inline scripts into files so the strict Content-Security-Policy (`public/_headers`) works. Do not put inline event handlers (`onclick=`) in it: the build fails on them.

## Discord gotchas learned the hard way

- An interaction must be answered within **3 seconds**. Do slow work in `ctx.waitUntil` and answer first.
- Limits: 2000 characters per plain message, 4096 per embed description, 10 embeds per message, 25 options per select menu, 100 characters per `custom_id` (the code stores pending choices in `docs` instead).
- Mixed Hebrew + English names in one RTL line jump to the wrong end. Put names in mentions (`<@id>`) or on their own line.
- The bot cannot read guild members by id in this setup (the role check falls back to the `users` table). Use `GET /users/{id}` for names and avatars (cached in `discord_cache`).
- A picture inside a line of text is done with **application emojis** (`POST /applications/{id}/emojis`); see `avatarEmojis` in `interactions.js` (mapping kept in `sys/tk_emoji`).
- Discord caches a user-installed app's command list; a new command may take a few minutes (or a client restart) to appear in DMs.

## Testing approach

There is no test suite. The previous session tested by (1) running the built site against a small local mock of `/api` in a browser, and (2) driving `onRequestPost` of `functions/discord/interactions.js` in Node with a fake `env.DB` and a stubbed `crypto.subtle.verify`. Check JS syntax with `node --check` after every edit (copy a function file to `.mjs` first). Do not deploy with a syntax error: `public/app.js` is checked with `node --check public/app.js` after `build.ps1`.

## Ideas that were discussed but not built

- Updating **all** old `/שיחות` messages when something changes (only the pressed one and the board are updated).
- A button that copies the plain talks message from the site.
- Showing "who added" again on talks (it was removed from the Discord message on purpose).

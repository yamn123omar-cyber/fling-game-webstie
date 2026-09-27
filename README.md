# Fling Tournament

Tournaments for **Fling Things and People** (Roblox): log in, sign up for solo or duo tournaments, play your matches in match rooms with a chat that works as evidence, and let admins score every fight. Everything is saved: wins and losses, tournament wins, who you fought and the score, which teams you were in and which tournaments you played. Players see all of it on their profile.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

The first screen is **Log in / Create account**.

Want to click around with realistic data first?

```bash
npm run seed         # demo players, teams, bots, a finished + a live + open tournaments
npm start
```

Log in as `okok_0020` (owner), `RefRaptor` (admin) or any player such as `NoobSlinger`; the password is `flingflong`. Run `npm run seed -- --force` to wipe and reseed. Don't run the seed on your real server. Seeded data is flagged as demo data, so Discord stays off even if your `.env` has the Discord settings. Delete the `data/` folder when you're done testing.

## Roles

| Role | Can do |
|---|---|
| **Owner** | Everything. Set with `OWNER_USERNAME` (default `okok_0020`). Has the **Owner panel**: make players admin (or take it away), ban, link Roblox accounts, create and delete test bots, the Discord server, backups and export. |
| **Admin** | Creates tournaments and runs them from the **Admin panel**: takes matches and enters the scores. An admin is automatically on the admin team of every tournament they create, and more admins can be added. **Admins can't sign up for a tournament they run**, and nobody can score a match they play in. |
| **Player** | Signs up for tournaments, checks in, chats, adds friends, makes teams. |

## How it works

| Piece | What happens |
|---|---|
| **Layout** | After logging in, a sidebar shows where you are: Play (Home, Tournaments, Bracket, My matches), Friends & teams (Players & friends, My team, Chat), Stats (Leaderboard, My profile), then Admin/Owner if you have the role. There's a light and a dark theme. |
| **Bracket** | Two-sided: players are split into a left and right side (seeded by Elo, so the top two can only meet in the Final). The sides meet in the middle. **Losers bracket:** when a round has an odd number of players, the losers of that round fight for the open spot instead of someone getting a free pass. Plus a 3rd place match. The Bracket page has zoom, fullscreen and *Save image*. |
| **Match rooms** | When both sides of a match are known, a room opens with a scoreboard, rosters (with Roblox names) and a chat. Players press *Check in*; anyone not checked in by the deadline **forfeits automatically**. Chat can't be edited or deleted and every check-in and result is logged with a server timestamp. |
| **Scoring** | An admin takes the match, joins the server, counts kills live (spectators see it update) and confirms each duel. They can rule forfeits, reschedule, undo a duel or reopen a result. |
| **Solo format** | Best-of-N duels (default 3, final 5), each duel first to N kills (default 5). |
| **Duo format** | Two 1v1 duels: best vs best, second vs second (ordered by rating). At 1–1 the system randomly picks two players who haven't fought yet for a decider. |
| **Teams of 1** | Allowed in duo tournaments (toggle per tournament). The solo player fights both duels, gets 75% Elo on wins / 125% on losses, 60% ranking points, and loses 5 RP on a loss. Full teams never lose RP. |
| **Ratings** | Separate Solo and Duo Elo plus Ranking Points. No-shows cost 10 Elo and 10 RP. |
| **Profiles** | Stats, rating graph, match history, **who they've fought** (duels won–lost, kills, last score), current and past teams, tournaments with placements, badges, 3D Roblox avatar. Each part can be public, friends-only or private. |

All the numbers live in [`server/config.js`](server/config.js) and are shown on the Rules page.

## Configuration

Copy `.env.example` to `.env`.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000). |
| `DATA_DIR` | Where `db.json` is stored (default `./data`). Use a persistent disk in production. |
| `OWNER_USERNAME` | The owner's username (default `okok_0020`). That account becomes owner when it signs up or logs in. |
| `ADMIN_USERNAMES` | Optional: comma-separated usernames that start as admin. The owner can also do this in the Owner panel. |
| `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` | Turns on the Discord server database (below), backups and announcements. |
| `BACKUP_INTERVAL_MINUTES` | How often a backup goes to `#backups` (default 5). |
| `REGISTER_LIMIT_PER_HOUR` | New accounts allowed per IP per hour (default 20). |

## Discord

The Discord server works as a readable copy of the website's database. In the **Owner panel → Discord server** there is a **Delete everything & rebuild** button (you have to type `DELETE EVERYTHING`). It:

1. imports the old site's accounts (from the old `profile-…` channels) so nobody loses their login or stats,
2. deletes **every** channel and category in the server,
3. creates this layout:
   - **🏆 FTAP ARENA** (everyone can read, only the bot posts): `#announcements`, `#results`, `#hall-of-fame`, `#leaderboard`
   - **🗄️ FTAP DATABASE** (hidden from members): `#players`, `#teams`, `#tournaments`, `#matches`, `#match-chats`, `#backups`
4. fills it: one message per player, team, tournament and match, edited in place whenever something changes. Match chats are saved as a text file per match. Private messages are **not** posted to Discord; they stay in the website's database and backups.

Invite the bot with the **Administrator** permission (or at least Manage Channels, Manage Roles, View Channels, Send Messages, Attach Files, Read Message History).

### Deploying

Any Node 18+ host works (`npm start`). The database is a single JSON file:

- **With a persistent disk** (Railway volume, Render disk, a VPS): point `DATA_DIR` at it.
- **Without one** (e.g. Render free tier wipes the disk on each deploy): set up Discord. The site restores itself from the newest backup in `#backups` when it boots with an empty disk.

The owner can also download a full JSON export from **Owner panel → Data & backups**.

## Roblox integration

- **Account linking** uses the standard verification trick: the player enters their Roblox username, gets a code like `ftap-yeet-noob-4821`, pastes it into their Roblox *About* section, and presses *Verify*. Admins can also link accounts manually.
- **Avatars**: verified players get their Roblox headshot everywhere and a **3D avatar** (drag to spin) on their profile, rendered with three.js from Roblox's avatar OBJ/MTL. The server proxies Roblox's APIs because browsers can't call them directly.

## Project layout

```
server/
  index.js          Express app, static files, scheduler + backup timers
  config.js         every tunable number (ratings, points, defaults)
  db.js             in-memory store, atomic JSON persistence
  auth.js           scrypt passwords, session cookies, CSRF guard, roles
  realtime.js       Server-Sent Events hub (live chat, scores, notifications)
  bracket.js        two-sided bracket + losers bracket (also single/double elim), byes, DQs, placements (pure)
  duels.js          solo best-of-N, duo 1v1s + random decider (pure)
  rating.js         Elo + ranking points (pure)
  tournaments.js    lifecycle: registration → check-in → bracket → matches → results
  chat.js           channels (DMs, teams, match rooms, tournament lobbies)
  users.js          profiles, stats bookkeeping, badges, notifications
  roblox.js         Roblox lookups, verification, avatar/3D proxy
  discord.js        server rebuild, database mirror, backups, announcements, old-account import
  discord-render.js how each record looks as a Discord message
  legacy.js         importing accounts from the old site
  routes/           HTTP API
public/
  index.html, css/, js/   single-page app (no build step)
  js/bracket.js           bracket renderer (two-sided tree + losers bracket)
scripts/seed.js     demo data
test/               node:test unit + end-to-end API tests
```

## Tests

```bash
npm test
```

Covers bracket generation (byes, double elimination for 2–23 entrants, grand-final reset, DQs), duel logic (deciders, teams of 1, draw rules), rating maths, and a full duo tournament driven through the HTTP API: teams, a team of 1, check-ins, ref scoring, the decider, an automatic no-show forfeit and reopening results.

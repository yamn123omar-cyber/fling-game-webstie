# FTAP Arena

Competitive tournaments for **Fling Things and People** (Roblox): solo and duo brackets, match rooms with an evidence-grade chat, human referees who score every fight, Elo ratings, ranking points, friends, teams and profiles with your Roblox avatar.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

The **first account** you create becomes the admin. Alternatively set `ADMIN_USERNAMES=yourname` before signing up.

Want to click around with realistic data first?

```bash
npm run seed         # demo players, teams, a finished + a live + open tournaments
npm start
```

Log in as `arena_admin`, `RefRaptor` (referee) or any player such as `NoobSlinger`; the password is `flingflong`. Run `npm run seed -- --force` to wipe and reseed. Don't run the seed on your real server.

## How it works

| Piece | What happens |
|---|---|
| **Tournaments** | Admins create solo (1v1) or duo (2v2) tournaments, single or double elimination. Players register, check in before the start, and the bracket is generated automatically, seeded by Elo. |
| **Match rooms** | When both sides of a match are known, a room opens with a scoreboard, rosters (with Roblox names) and a chat. Players press *Check in*; anyone not checked in by the deadline **forfeits automatically**. The chat can't be edited or deleted and every check-in, no-show and result is logged with a server timestamp, so "I was there but they didn't answer" can be checked. |
| **Referees** | FTAP has no 1v1 scoreboard, so staff with the *Referee* role claim matches from the **Ref desk**, join the server, tally kills live (spectators see it update), and confirm each duel. Refs can't referee their own match. They can rule forfeits, reschedule, undo a duel; admins can reopen results. |
| **Solo format** | Best-of-N duels (default 3, final 5), each duel first to N kills (default 5). |
| **Duo format** | Two 1v1 duels: best vs best, second vs second (ordered by rating). At 1–1 the system randomly picks two players who haven't fought yet for a decider. Optionally, organizers can settle 1–1 on total kills first. |
| **Teams of 1** | Allowed in duo tournaments (toggle per tournament). The solo player fights both duels, gets 75% Elo on wins / 125% on losses, 60% ranking points, and loses 5 RP on a loss. Full teams never lose RP. |
| **Ratings** | Separate Solo and Duo Elo (start 1000, K=40 provisional → 32 → 24 above 1500) plus Ranking Points for season progress and placements. No-shows cost 10 Elo and 10 RP. |

All the numbers live in [`server/config.js`](server/config.js) and are shown on the public Rules page, so changing them there changes both.

## Configuration

Copy `.env.example` to `.env`. Everything is optional.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000). |
| `DATA_DIR` | Where `db.json` is stored (default `./data`). Use a persistent disk in production. |
| `ADMIN_USERNAMES` | Comma-separated usernames that become admins when they register. |
| `DISCORD_BOT_TOKEN` | Enables the Discord features below. |
| `DISCORD_BACKUP_CHANNEL_ID` | Compressed database backup every `BACKUP_INTERVAL_MINUTES` (default 5), and on shutdown. **On startup with an empty disk the latest backup is restored automatically.** Falls back to `DISCORD_CHANNEL_ID`. |
| `DISCORD_RESULTS_CHANNEL_ID` | Announcements: new tournaments, results, champions. |
| `DISCORD_GUILD_ID` | Lets players from the previous version of the site log in with their old password; their profile (wins, losses, bio) is imported on first login. |
| `REGISTER_LIMIT_PER_HOUR` | New accounts allowed per IP per hour (default 20). |

### Deploying

Any Node 18+ host works (`npm start`). The database is a single JSON file:

- **With a persistent disk** (Railway volume, Render disk, a VPS): point `DATA_DIR` at it. Done.
- **Without one** (e.g. Render free tier wipes the disk on each deploy): set `DISCORD_BOT_TOKEN` + `DISCORD_BACKUP_CHANNEL_ID`. The site restores itself from the newest backup when it boots with an empty disk.

Admins can also download a full JSON export from **Admin → Site**.

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
  bracket.js        single/double elimination, byes, DQs, placements (pure)
  duels.js          solo best-of-N, duo 1v1s + random decider (pure)
  rating.js         Elo + ranking points (pure)
  tournaments.js    lifecycle: registration → check-in → bracket → matches → results
  chat.js           channels (DMs, teams, match rooms, tournament lobbies)
  users.js          profiles, stats bookkeeping, badges, notifications
  roblox.js         Roblox lookups, verification, avatar/3D proxy
  discord.js        backups, announcements, legacy account import
  routes/           HTTP API
public/
  index.html, css/, js/   single-page app (no build step)
  js/hero.js              the grab-and-fling ragdoll hero on the front page
scripts/seed.js     demo data
test/               node:test unit + end-to-end API tests
```

## Tests

```bash
npm test
```

Covers bracket generation (byes, double elimination for 2–23 entrants, grand-final reset, DQs), duel logic (deciders, teams of 1, draw rules), rating maths, and a full duo tournament driven through the HTTP API: teams, a team of 1, check-ins, ref scoring, the decider, an automatic no-show forfeit and reopening results.

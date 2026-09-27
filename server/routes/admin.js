// Owner-only tools: roles, bans, bots, Roblox fixes, data export, Discord.
const express = require('express');
const db = require('../db');
const users = require('../users');
const roblox = require('../roblox');
const discord = require('../discord');
const auth = require('../auth');
const T = require('../tournaments');
const { route, bad, HttpError } = require('../errors');

const router = express.Router();
router.use('/admin', auth.requireRole('owner'));

function adminView(u) {
    return {
        ...users.summary(u),
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        banned: Boolean(u.banned),
        roblox: u.roblox,
        imported: Boolean(u.legacy && u.legacy.importedAt),
        matches: u.stats.solo.matches + u.stats.duo.matches,
        noShows: u.stats.solo.noShows + u.stats.duo.noShows,
    };
}

const activeTournamentOf = uid => Object.values(db.data.tournaments).find(t => ['registration', 'checkin', 'live'].includes(t.status) && t.entries.some(e => e.members.includes(uid)));

router.get('/admin/overview', route(() => ({
    users: Object.values(db.data.users).filter(u => !u.deleted && !u.isBot).length,
    bots: Object.values(db.data.users).filter(u => !u.deleted && u.isBot).length,
    admins: Object.values(db.data.users).filter(u => !u.deleted && ['admin', 'ref', 'owner'].includes(u.role)).map(users.summary),
    tournaments: Object.keys(db.data.tournaments).length,
    matches: Object.keys(db.data.matches).length,
    backup: { discord: discord.backupEnabled(), lastWrite: db.lastWrite ? new Date(db.lastWrite).toISOString() : null },
    discord: discord.status(),
})));

router.get('/admin/users', route(req => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const bots = req.query.bots === '1';
    const list = Object.values(db.data.users)
        .filter(u => !u.deleted && Boolean(u.isBot) === bots && (!q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)))
        .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
        .slice(0, 200)
        .map(adminView);
    return { users: list };
}));

function target(req) {
    const u = users.get(req.params.id);
    if (!u || u.deleted) throw new HttpError(404, 'Player not found');
    return u;
}

router.post('/admin/users/:id/role', route(req => {
    const u = target(req);
    const role = req.body.role;
    if (!['player', 'admin'].includes(role)) throw bad('Pick player or admin');
    if (u.role === 'owner') throw bad("The owner's role can't be changed here");
    if (u.isBot) throw bad("Bots can't be admins");
    u.role = role;
    if (role === 'player') {
        // Taking admin away also removes them from every tournament's admin team.
        for (const t of Object.values(db.data.tournaments)) {
            if ((t.staff || []).includes(u.id) && t.staff.length > 1) t.staff = t.staff.filter(x => x !== u.id);
        }
    }
    users.notify(u.id, {
        type: 'role',
        text: role === 'admin' ? "You're now an admin! You can create and run tournaments from the Admin panel." : 'Your admin role was removed',
        link: role === 'admin' ? '/admin' : null,
    });
    db.save();
    return { user: adminView(u) };
}));

router.post('/admin/users/:id/ban', route(req => {
    const u = target(req);
    if (u.role === 'owner') throw bad("You can't ban the owner");
    u.banned = Boolean(req.body.banned);
    if (u.banned) auth.destroyUserSessions(u.id);
    db.save();
    return { user: adminView(u) };
}));

router.post('/admin/users/:id/roblox', route(async req => {
    const u = target(req);
    if (req.body.remove) {
        u.roblox = null;
        db.save();
        return { user: adminView(u) };
    }
    let rbx;
    try { rbx = await roblox.resolveUsername(req.body.username); } catch { throw new HttpError(502, "Couldn't reach Roblox"); }
    if (!rbx) throw bad('No Roblox account with that username');
    u.roblox = { ...rbx, verified: true, verifiedAt: new Date().toISOString(), manual: true };
    u.robloxPending = null;
    db.save();
    return { user: adminView(u) };
}));

// ── Bots ────────────────────────────────────────────────────────────────────
router.post('/admin/bots', route(req => {
    const n = Math.max(1, Math.min(32, Number(req.body.count) || 1));
    const made = [];
    for (let i = 0; i < n; i++) made.push(T.makeBot(n === 1 ? req.body.name : null));
    if (req.body.team && made.length >= 2) {
        const [a, b] = made;
        const team = { id: db.id('tm'), name: String(req.body.team).slice(0, 24) || `${a.username} & ${b.username}`.slice(0, 24), tag: 'BOT', color: '#8a93a6', captainId: a.id, members: [a.id, b.id], createdAt: new Date().toISOString(), isBot: true, history: [] };
        db.data.teams[team.id] = team;
    }
    db.save();
    return { bots: made.map(adminView) };
}));

router.post('/admin/bots/delete-all', route(() => {
    let removed = 0, kept = 0;
    for (const u of Object.values(db.data.users)) {
        if (!u.isBot || u.deleted) continue;
        const t = activeTournamentOf(u.id);
        if (t && t.status === 'live') { kept++; continue; }
        if (t) t.entries = t.entries.filter(e => !e.members.includes(u.id));
        for (const team of Object.values(db.data.teams)) if (team.members.includes(u.id)) team.disbanded = true;
        db.unindexUser(u);
        u.deleted = true;
        u.username = `deleted_${u.id}`;
        removed++;
    }
    db.save();
    return { removed, kept };
}));

// ── Data ────────────────────────────────────────────────────────────────────
router.get('/admin/export', route((req, res) => {
    const { sessions: _omit, ...rest } = db.data; // never export session tokens
    const clean = { ...rest, users: Object.fromEntries(Object.entries(rest.users).map(([k, u]) => [k, { ...u, passwordHash: undefined, legacyHash: undefined }])) };
    res.setHeader('Content-Disposition', `attachment; filename="ftap-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(clean);
}));

router.post('/admin/backup', route(async () => {
    if (!discord.backupEnabled()) throw bad('Discord backups are not set up (DISCORD_BOT_TOKEN + DISCORD_GUILD_ID)');
    db.flush();
    await discord.uploadBackup(db.data);
    return { ok: true };
}));

// ── Discord server ──────────────────────────────────────────────────────────
router.get('/admin/discord', route(() => discord.status()));

router.post('/admin/discord/rebuild', route(req => {
    if (req.body.confirm !== 'DELETE EVERYTHING') throw bad('Type DELETE EVERYTHING to confirm');
    discord.startRebuild(req.user);
    return discord.status();
}));

router.post('/admin/discord/import', route(async () => {
    const n = await discord.importLegacyAccounts();
    return { imported: n };
}));

router.post('/admin/discord/sync', route(() => {
    discord.requestFullSync();
    return discord.status();
}));

module.exports = router;

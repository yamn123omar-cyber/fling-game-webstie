const express = require('express');
const db = require('../db');
const users = require('../users');
const roblox = require('../roblox');
const discord = require('../discord');
const auth = require('../auth');
const { route, bad, HttpError } = require('../errors');

const router = express.Router();
router.use(auth.requireRole('admin'));

function adminView(u) {
    return {
        ...users.summary(u),
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        banned: Boolean(u.banned),
        roblox: u.roblox,
        matches: u.stats.solo.matches + u.stats.duo.matches,
        noShows: u.stats.solo.noShows + u.stats.duo.noShows,
    };
}

router.get('/admin/overview', route(() => ({
    users: Object.values(db.data.users).filter(u => !u.deleted).length,
    staff: Object.values(db.data.users).filter(u => !u.deleted && u.role !== 'player').map(users.summary),
    tournaments: Object.keys(db.data.tournaments).length,
    matches: Object.keys(db.data.matches).length,
    backup: { discord: discord.backupEnabled(), lastWrite: db.lastWrite ? new Date(db.lastWrite).toISOString() : null },
})));

router.get('/admin/users', route(req => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = Object.values(db.data.users)
        .filter(u => !u.deleted && (!q || u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)))
        .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
        .slice(0, 100)
        .map(adminView);
    return { users: list };
}));

function target(req) {
    const u = users.get(req.params.id);
    if (!u || u.deleted) throw new HttpError(404, 'User not found');
    return u;
}

router.post('/admin/users/:id/role', route(req => {
    const u = target(req);
    const role = req.body.role;
    if (!['player', 'ref', 'admin'].includes(role)) throw bad('Unknown role');
    if (u.id === req.user.id && role !== 'admin') {
        const otherAdmins = Object.values(db.data.users).filter(x => x.role === 'admin' && x.id !== u.id && !x.deleted);
        if (!otherAdmins.length) throw bad("You're the last admin — promote someone else first");
    }
    u.role = role;
    users.notify(u.id, { type: 'role', text: role === 'player' ? 'Your staff role was removed' : `You are now a${role === 'admin' ? 'n admin' : ' referee'}! Check the Ref Desk.`, link: role === 'player' ? null : '/ref' });
    db.save();
    return { user: adminView(u) };
}));

router.post('/admin/users/:id/ban', route(req => {
    const u = target(req);
    if (u.id === req.user.id) throw bad("You can't ban yourself");
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

router.get('/admin/export', route((req, res) => {
    const { sessions, ...rest } = db.data;
    const clean = { ...rest, users: Object.fromEntries(Object.entries(rest.users).map(([k, u]) => [k, { ...u, passwordHash: undefined }])) };
    res.setHeader('Content-Disposition', `attachment; filename="ftap-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(clean);
}));

router.post('/admin/backup', route(async () => {
    if (!discord.backupEnabled()) throw bad('Discord backup is not configured (DISCORD_BOT_TOKEN + DISCORD_BACKUP_CHANNEL_ID)');
    db.flush();
    await discord.uploadBackup(db.data);
    return { ok: true };
}));

module.exports = router;

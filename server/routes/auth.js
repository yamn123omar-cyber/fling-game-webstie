const express = require('express');
const db = require('../db');
const auth = require('../auth');
const users = require('../users');
const chat = require('../chat');
const discord = require('../discord');
const limits = require('../limits');
const { route, bad, HttpError } = require('../errors');

const router = express.Router();
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const adminNames = () => (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// The owner account of the previous version of the site.
const LEGACY_OWNER = 'okok_0020';

function initialRole(username) {
    const name = username.toLowerCase();
    const list = adminNames();
    if (list.length) return list.includes(name) ? 'admin' : 'player';
    if (Object.values(db.data.users).some(u => u.role === 'admin' && !u.deleted)) return 'player';
    // Fresh database: the first account runs the site — unless old accounts are being
    // imported, in which case "first to log in" could be anyone, so only the old owner qualifies.
    if (discord.legacyEnabled()) return name === LEGACY_OWNER ? 'admin' : 'player';
    return 'admin';
}

function me(req) {
    const u = req.user;
    const notes = db.data.notifications[u.id] || [];
    const unreadChat = chat.channelsFor(u).reduce((a, c) => a + c.unread, 0);
    const incomingFriends = Object.values(db.data.friendRequests).filter(r => r.to === u.id).length;
    const teamInvites = Object.values(db.data.teamInvites).filter(i => i.to === u.id).length;
    return {
        user: users.privateView(u),
        counts: { notifications: notes.filter(n => !n.read).length, chat: unreadChat, friendRequests: incomingFriends, teamInvites },
    };
}

router.get('/me', route(req => {
    if (!req.user) return { user: null };
    return me(req);
}));

router.post('/auth/register', route((req, res) => {
    const ip = req.ip;
    if (!limits.allow(`reg:${ip}`, Number(process.env.REGISTER_LIMIT_PER_HOUR || 20), 3600_000)) throw new HttpError(429, 'Too many new accounts from your network — try again later');
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!USERNAME_RE.test(username)) throw bad('Username must be 3–24 characters: letters, numbers, _ . -');
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    if (password.length > 200) throw bad('Password is too long');
    if (db.userByName(username)) throw bad('That username is taken');

    const user = users.newUser({ username, passwordHash: auth.hashPassword(password), role: initialRole(username) });
    db.data.users[user.id] = user;
    db.indexUser(user);
    db.save();
    auth.createSession(res, user.id);
    req.user = user;
    return me(req);
}));

router.post('/auth/login', route(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) throw bad('Enter your username and password');
    if (!limits.allow(`login:${req.ip}:${username.toLowerCase()}`, 10, 600_000)) throw new HttpError(429, 'Too many attempts — wait a few minutes');

    let user = db.userByName(username);
    if (!user && discord.legacyEnabled()) {
        // First login since the site upgrade: bring the old account over.
        const legacy = await discord.checkLegacyLogin(username, password);
        if (legacy && !db.userByName(legacy.username)) {
            user = users.newUser({ username: legacy.username, passwordHash: auth.hashPassword(password), role: initialRole(legacy.username) });
            const s = user.stats.solo;
            const ls = legacy.stats || {};
            s.wins = ls.wins || 0;
            s.losses = ls.losses || 0;
            s.matches = s.wins + s.losses;
            s.tournaments = ls.tournamentsPlayed || 0;
            s.titles = ls.tournamentWins || ls.first || 0;
            s.podiums = (ls.first || 0) + (ls.second || 0) + (ls.third || 0);
            user.profile.bio = String(legacy.bio || '').slice(0, 300);
            user.legacy = { importedAt: new Date().toISOString(), createdAt: legacy.createdAt || null, robloxUsername: legacy.robloxUsername || null };
            if (legacy.createdAt) user.createdAt = legacy.createdAt;
            db.data.users[user.id] = user;
            db.indexUser(user);
            db.save();
        }
    }
    if (!user || user.deleted || !auth.verifyPassword(password, user.passwordHash)) throw new HttpError(401, 'Wrong username or password');
    if (user.banned) throw new HttpError(403, 'This account is banned');
    auth.createSession(res, user.id);
    req.user = user;
    return me(req);
}));

router.post('/auth/logout', route((req, res) => {
    auth.destroySession(req, res);
    return { ok: true };
}));

module.exports = router;

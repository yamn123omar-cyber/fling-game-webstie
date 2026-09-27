const express = require('express');
const db = require('../db');
const auth = require('../auth');
const users = require('../users');
const chat = require('../chat');
const discord = require('../discord');
const limits = require('../limits');
const legacy = require('../legacy');
const { route, bad, HttpError } = require('../errors');

const router = express.Router();
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
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

    const user = users.newUser({ username, passwordHash: auth.hashPassword(password), role: legacy.initialRole(username) });
    const rbx = String(req.body.robloxUsername || '').trim();
    if (/^[A-Za-z0-9_]{3,20}$/.test(rbx)) user.legacy = { robloxUsername: rbx }; // pre-fills the Roblox link form
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
        // Old account whose Discord channel still exists: import it on first login.
        const old = await discord.checkLegacyLogin(username, password);
        if (old) user = legacy.importProfile(old);
    }
    if (!user || user.deleted || user.isBot) throw new HttpError(401, 'Wrong username or password');
    if (!user.passwordHash && user.legacyHash) {
        // Imported from the old site: accept the old password once, then store it properly.
        if (legacy.djb2(password) !== user.legacyHash) throw new HttpError(401, 'Wrong username or password');
        user.passwordHash = auth.hashPassword(password);
        user.legacyHash = null;
        db.save();
    } else if (!auth.verifyPassword(password, user.passwordHash)) {
        throw new HttpError(401, 'Wrong username or password');
    }
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

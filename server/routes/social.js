// Profiles, friends, teams, notifications, chat and Roblox linking.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const users = require('../users');
const chat = require('../chat');
const rt = require('../realtime');
const roblox = require('../roblox');
const limits = require('../limits');
const T = require('../tournaments');
const duelsLib = require('../duels');
const { route, bad, HttpError } = require('../errors');

const router = express.Router();
const { requireAuth } = auth;
const TEAM_COLORS = ['#c4ff4d', '#4dd8ff', '#ff5ea8', '#ffb84d', '#9b7bff', '#3ddc97', '#ff6b4d', '#f5f5f5'];

const findUser = name => {
    const u = db.userByName(name);
    if (!u || u.deleted) throw new HttpError(404, 'Player not found');
    return u;
};
const findUserId = id => {
    const u = users.get(id);
    if (!u || u.deleted) throw new HttpError(404, 'Player not found');
    return u;
};

// ── Profiles ────────────────────────────────────────────────────────────────
function matchHistory(uid, limit = 20) {
    const out = [];
    for (const m of Object.values(db.data.matches)) {
        if (m.status !== 'done' || !m.result || !['played', 'forfeit', 'double_forfeit'].includes(m.result.type)) continue;
        const t = db.data.tournaments[m.tournamentId];
        if (!t) continue;
        const side = T.sideOfUser(t, m, uid);
        if (side < 0) continue;
        const opp = T.entryOf(t, m.slots[1 - side].entryId);
        const mine = T.entryOf(t, m.slots[side].entryId);
        const score = duelsLib.wins(m.duels || []);
        out.push({
            id: m.id, label: m.label, at: m.completedAt,
            tournament: { id: t.id, name: t.name, mode: t.mode },
            entryName: mine ? mine.name : '',
            opponent: opp ? { name: opp.name, members: opp.members.map(id => users.summary(users.get(id))) } : null,
            won: m.winnerSide === side,
            score: [score[side], score[1 - side]],
            type: m.result.type,
            change: (m.ratingChanges || {})[uid] || null,
        });
    }
    out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return out.slice(0, limit);
}

function tournamentHistory(uid) {
    const out = [];
    for (const t of Object.values(db.data.tournaments)) {
        if (!['live', 'completed'].includes(t.status)) continue;
        const e = T.entryForUser(t, uid);
        if (!e) continue;
        out.push({ id: t.id, name: t.name, mode: t.mode, status: t.status, startAt: t.startAt, place: e.place || null, entrants: t.entries.length, entryName: e.name, dq: Boolean(e.dq) });
    }
    return out.sort((a, b) => (b.startAt || '').localeCompare(a.startAt || ''));
}

function teamView(team) {
    return {
        id: team.id, name: team.name, tag: team.tag, color: team.color, captainId: team.captainId, createdAt: team.createdAt,
        members: team.members.map(id => users.summary(users.get(id))),
        invites: Object.values(db.data.teamInvites).filter(i => i.teamId === team.id).map(i => ({ id: i.id, to: users.summary(users.get(i.to)), at: i.createdAt })),
    };
}

// Everyone this player has fought in a duel, with the record against them.
function opponents(uid) {
    const map = new Map();
    for (const m of Object.values(db.data.matches)) {
        if (m.status !== 'done' || !m.result || m.result.type !== 'played') continue;
        for (const d of m.duels || []) {
            if (d.winner === null) continue;
            const s = d.players.indexOf(uid);
            if (s < 0) continue;
            const oppId = d.players[1 - s];
            const r = map.get(oppId) || { user: users.summary(users.get(oppId)), duelsWon: 0, duelsLost: 0, kills: 0, deaths: 0, last: null, lastScore: null, lastMatchId: null };
            if (d.winner === s) r.duelsWon++; else r.duelsLost++;
            r.kills += d.scores[s];
            r.deaths += d.scores[1 - s];
            const at = d.at || m.completedAt;
            if (!r.last || at > r.last) { r.last = at; r.lastScore = [d.scores[s], d.scores[1 - s]]; r.lastMatchId = m.id; }
            map.set(oppId, r);
        }
    }
    return [...map.values()].sort((a, b) => (b.duelsWon + b.duelsLost) - (a.duelsWon + a.duelsLost) || (b.last || '').localeCompare(a.last || '')).slice(0, 30);
}

function teamHistoryOf(uid) {
    return Object.values(db.data.teams)
        .filter(t => !t.members.includes(uid) || t.disbanded)
        .filter(t => (t.history || []).some(h => h.userId === uid))
        .map(t => {
            const mine = (t.history || []).filter(h => h.userId === uid);
            return { ...teamView(t), disbanded: Boolean(t.disbanded), joinedAt: mine[0] && mine[0].at, leftAt: (mine.filter(h => h.action === 'left').pop() || {}).at || null };
        });
}

router.get('/users/:username', route(req => {
    const u = findUser(req.params.username);
    const viewer = req.user;
    const relation = viewer ? {
        isMe: viewer.id === u.id,
        isFriend: viewer.friends.includes(u.id),
        requestSent: Object.values(db.data.friendRequests).find(r => r.from === viewer.id && r.to === u.id)?.id || null,
        requestReceived: Object.values(db.data.friendRequests).find(r => r.from === u.id && r.to === viewer.id)?.id || null,
    } : null;
    // Privacy: each part of a profile can be public, friends-only or private.
    const priv = u.profile.privacy || {};
    const can = lvl => !lvl || lvl === 'public' || Boolean(relation && (relation.isMe || (lvl === 'friends' && relation.isFriend))) || auth.hasRole(viewer, 'owner');
    const profile = users.profile(u);
    const showStats = can(priv.stats);
    const showHistory = can(priv.history);
    if (!can(priv.bio)) profile.profile = { ...profile.profile, bio: '' };
    if (!showStats) profile.stats = null;
    return {
        user: profile,
        relation,
        visible: { stats: showStats, history: showHistory },
        matches: showHistory ? matchHistory(u.id) : [],
        tournaments: tournamentHistory(u.id),
        teams: Object.values(db.data.teams).filter(t => !t.disbanded && t.members.includes(u.id)).map(teamView),
        pastTeams: showHistory ? teamHistoryOf(u.id) : [],
        opponents: showHistory ? opponents(u.id) : [],
    };
}));

router.get('/users', route(req => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 1) return { users: [] };
    const list = Object.values(db.data.users)
        .filter(u => !u.deleted && !u.banned && (u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)))
        .sort((a, b) => Number(!a.username.toLowerCase().startsWith(q)) - Number(!b.username.toLowerCase().startsWith(q)) || a.username.localeCompare(b.username))
        .slice(0, 12)
        .map(users.summary);
    return { users: list };
}));

router.patch('/me/profile', requireAuth, route(req => {
    const u = req.user;
    const b = req.body || {};
    if (b.displayName !== undefined) {
        const d = String(b.displayName).trim();
        if (d.length < 2 || d.length > 24) throw bad('Display name must be 2–24 characters');
        u.displayName = d;
    }
    if (b.bio !== undefined) u.profile.bio = String(b.bio).slice(0, 300);
    if (b.title !== undefined) u.profile.title = String(b.title).trim().slice(0, 32);
    if (b.accent !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(b.accent)) throw bad('Pick a valid colour');
        u.profile.accent = b.accent;
    }
    if (b.banner !== undefined) {
        if (!users.BANNERS.includes(b.banner)) throw bad('Unknown banner');
        u.profile.banner = b.banner;
    }
    if (b.favoriteMode !== undefined) u.profile.favoriteMode = b.favoriteMode === 'duo' ? 'duo' : 'solo';
    if (b.privacy && typeof b.privacy === 'object') {
        const lv = v => (['public', 'friends', 'private'].includes(v) ? v : 'public');
        u.profile.privacy = { bio: lv(b.privacy.bio), stats: lv(b.privacy.stats), history: lv(b.privacy.history) };
    }
    if (b.socials && typeof b.socials === 'object') {
        const out = {};
        for (const k of users.SOCIALS) {
            const v = String(b.socials[k] || '').trim().slice(0, 80);
            if (v) out[k] = v.replace(/[<>"]/g, '');
        }
        u.profile.socials = out;
    }
    db.save();
    return { user: users.privateView(u) };
}));

router.post('/me/password', requireAuth, route(req => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(String(current || ''), req.user.passwordHash)) throw bad('Current password is wrong');
    if (String(next || '').length < 6) throw bad('New password must be at least 6 characters');
    req.user.passwordHash = auth.hashPassword(String(next));
    db.save();
    return { ok: true };
}));

router.post('/me/delete', requireAuth, route((req, res) => {
    const u = req.user;
    if (!auth.verifyPassword(String(req.body.password || ''), u.passwordHash)) throw bad('Password is wrong');
    const busy = Object.values(db.data.tournaments).some(t => ['registration', 'checkin', 'live'].includes(t.status) && T.entryForUser(t, u.id) && !(T.entryForUser(t, u.id).dq));
    if (busy) throw bad('Withdraw from your active tournaments first');
    for (const fid of u.friends) {
        const f = users.get(fid);
        if (f) f.friends = f.friends.filter(x => x !== u.id);
    }
    for (const [k, r] of Object.entries(db.data.friendRequests)) if (r.from === u.id || r.to === u.id) delete db.data.friendRequests[k];
    for (const [k, i] of Object.entries(db.data.teamInvites)) if (i.from === u.id || i.to === u.id) delete db.data.teamInvites[k];
    for (const team of Object.values(db.data.teams)) if (team.members.includes(u.id)) leaveTeam(team, u.id);
    db.unindexUser(u);
    u.deleted = true;
    u.username = `deleted_${u.id}`;
    u.displayName = 'Deleted user';
    u.passwordHash = null;
    u.friends = [];
    u.roblox = null;
    u.profile = { ...u.profile, bio: '', socials: {}, title: '' };
    auth.destroyUserSessions(u.id);
    auth.destroySession(req, res);
    db.save();
    return { ok: true };
}));

// ── Roblox linking ──────────────────────────────────────────────────────────
router.post('/me/roblox/start', requireAuth, route(async req => {
    if (!limits.allow(`rbx:${req.user.id}`, 10, 600_000)) throw new HttpError(429, 'Slow down a little');
    let rbx;
    try {
        rbx = await roblox.resolveUsername(req.body.username);
    } catch {
        throw new HttpError(502, "Couldn't reach Roblox right now — try again in a minute");
    }
    if (!rbx) throw bad('No Roblox account with that username');
    const taken = Object.values(db.data.users).find(u => u.id !== req.user.id && u.roblox && u.roblox.verified && u.roblox.id === rbx.id);
    if (taken) throw bad('That Roblox account is already linked to another player');
    req.user.robloxPending = { ...rbx, code: roblox.verificationCode(), createdAt: new Date().toISOString() };
    db.save();
    return { user: users.privateView(req.user) };
}));

router.post('/me/roblox/verify', requireAuth, route(async req => {
    const p = req.user.robloxPending;
    if (!p) throw bad('Start linking first');
    if (!limits.allow(`rbxv:${req.user.id}`, 12, 600_000)) throw new HttpError(429, 'Slow down a little');
    let live;
    try {
        live = await roblox.getUser(p.id);
    } catch {
        throw new HttpError(502, "Couldn't reach Roblox right now — try again in a minute");
    }
    if (!live.description.toLowerCase().includes(p.code.toLowerCase())) {
        throw bad(`We couldn't find "${p.code}" in your Roblox About section yet. Save it on roblox.com, wait a few seconds, then try again.`);
    }
    const taken = Object.values(db.data.users).find(u => u.id !== req.user.id && u.roblox && u.roblox.verified && u.roblox.id === live.id);
    if (taken) throw bad('That Roblox account is already linked to another player');
    req.user.roblox = { id: live.id, name: live.name, displayName: live.displayName, verified: true, verifiedAt: new Date().toISOString() };
    req.user.robloxPending = null;
    db.save();
    return { user: users.privateView(req.user) };
}));

router.delete('/me/roblox', requireAuth, route(req => {
    req.user.roblox = null;
    req.user.robloxPending = null;
    db.save();
    return { user: users.privateView(req.user) };
}));

router.get('/roblox/avatar/:id', route(async (req, res) => {
    const id = Number(req.params.id);
    const type = req.query.type === 'full' ? 'avatar' : 'headshot';
    if (!Number.isInteger(id) || id <= 0) throw bad('Bad id');
    const url = await roblox.thumbnail(type, id);
    if (!url) throw new HttpError(404, 'No avatar');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.redirect(302, url);
}));

router.get('/roblox/3d/:id', route(async req => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw bad('Bad id');
    try {
        const model = await roblox.avatar3d(id);
        if (!model) throw new HttpError(404, '3D avatar not available');
        return { model };
    } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, '3D avatar not available');
    }
}));

router.get('/roblox/cdn/:hash', route(async (req, res) => {
    const f = await roblox.cdnFile(req.params.hash);
    if (!f) throw new HttpError(404, 'Not found');
    res.setHeader('Content-Type', f.type);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.end(f.buf);
}));

// ── Friends ─────────────────────────────────────────────────────────────────
function pushFriends(...ids) {
    for (const id of ids) rt.toUser(id, 'friends', {});
}

router.get('/friends', requireAuth, route(req => {
    const u = req.user;
    const reqs = Object.values(db.data.friendRequests);
    return {
        friends: u.friends.map(id => users.get(id)).filter(f => f && !f.deleted)
            .map(f => ({ ...users.summary(f), lastSeenAt: f.lastSeenAt }))
            .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)),
        incoming: reqs.filter(r => r.to === u.id).map(r => ({ id: r.id, user: users.summary(users.get(r.from)), at: r.createdAt })),
        outgoing: reqs.filter(r => r.from === u.id).map(r => ({ id: r.id, user: users.summary(users.get(r.to)), at: r.createdAt })),
    };
}));

function befriend(a, b) {
    if (!a.friends.includes(b.id)) a.friends.push(b.id);
    if (!b.friends.includes(a.id)) b.friends.push(a.id);
    for (const [k, r] of Object.entries(db.data.friendRequests)) {
        if ((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)) delete db.data.friendRequests[k];
    }
}

router.post('/friends/requests', requireAuth, route(req => {
    const me = req.user;
    const other = findUser(req.body.username);
    if (other.id === me.id) throw bad("You can't friend yourself");
    if (me.friends.includes(other.id)) throw bad('You are already friends');
    if (me.friends.length >= 300) throw bad('Friend list is full');
    if (!limits.allow(`fr:${me.id}`, 30, 3600_000)) throw new HttpError(429, 'Too many friend requests — try later');
    const reverse = Object.values(db.data.friendRequests).find(r => r.from === other.id && r.to === me.id);
    if (reverse) {
        befriend(me, other);
        users.notify(other.id, { type: 'friend', text: `${me.displayName} accepted your friend request`, link: `/u/${me.username}` });
        db.save();
        pushFriends(me.id, other.id);
        return { status: 'friends' };
    }
    if (Object.values(db.data.friendRequests).some(r => r.from === me.id && r.to === other.id)) throw bad('Request already sent');
    const r = { id: db.id('fr'), from: me.id, to: other.id, createdAt: new Date().toISOString() };
    db.data.friendRequests[r.id] = r;
    users.notify(other.id, { type: 'friend', text: `${me.displayName} sent you a friend request`, link: '/friends' });
    db.save();
    pushFriends(me.id, other.id);
    return { status: 'sent' };
}));

router.post('/friends/requests/:id/:action', requireAuth, route(req => {
    const r = db.data.friendRequests[req.params.id];
    if (!r) throw new HttpError(404, 'Request not found');
    const me = req.user;
    if (req.params.action === 'cancel') {
        if (r.from !== me.id) throw new HttpError(403, 'Not your request');
        delete db.data.friendRequests[r.id];
    } else {
        if (r.to !== me.id) throw new HttpError(403, 'Not your request');
        if (req.params.action === 'accept') {
            const other = findUserId(r.from);
            befriend(me, other);
            users.notify(other.id, { type: 'friend', text: `${me.displayName} accepted your friend request`, link: `/u/${me.username}` });
        } else if (req.params.action === 'decline') {
            delete db.data.friendRequests[r.id];
        } else throw bad('Unknown action');
    }
    db.save();
    pushFriends(r.from, r.to);
    return { ok: true };
}));

router.delete('/friends/:userId', requireAuth, route(req => {
    const other = users.get(req.params.userId);
    req.user.friends = req.user.friends.filter(x => x !== req.params.userId);
    if (other) other.friends = other.friends.filter(x => x !== req.user.id);
    db.save();
    pushFriends(req.user.id, req.params.userId);
    return { ok: true };
}));

// ── Teams ───────────────────────────────────────────────────────────────────
function validTeamFields(b, team) {
    const out = {};
    if (b.name !== undefined || !team) {
        const name = String(b.name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 24) throw bad('Team name must be 2–24 characters');
        const clash = Object.values(db.data.teams).find(t => !t.disbanded && t.id !== (team && team.id) && t.name.toLowerCase() === name.toLowerCase());
        if (clash) throw bad('A team with that name already exists');
        out.name = name;
    }
    if (b.tag !== undefined) {
        const tag = String(b.tag || '').trim().toUpperCase();
        if (tag && !/^[A-Z0-9]{2,4}$/.test(tag)) throw bad('Tag must be 2–4 letters or numbers');
        out.tag = tag || null;
    }
    if (b.color !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(b.color)) throw bad('Pick a team colour');
        out.color = b.color;
    }
    return out;
}

function getTeam(id) {
    const t = db.data.teams[id];
    if (!t || t.disbanded) throw new HttpError(404, 'Team not found');
    return t;
}

function pushTeam(team) {
    rt.toUsers([...team.members, ...Object.values(db.data.teamInvites).filter(i => i.teamId === team.id).map(i => i.to)], 'teams', { id: team.id });
}

function inviteToTeam(team, from, target) {
    if (team.members.length >= 2) throw bad('Teams have 2 players max');
    if (team.members.includes(target.id)) throw bad('Already on the team');
    if (Object.values(db.data.teamInvites).some(i => i.teamId === team.id && i.to === target.id)) throw bad('Already invited');
    const inv = { id: db.id('ti'), teamId: team.id, from: from.id, to: target.id, createdAt: new Date().toISOString() };
    db.data.teamInvites[inv.id] = inv;
    users.notify(target.id, { type: 'team', text: `${from.displayName} invited you to team "${team.name}"`, link: '/teams' });
    return inv;
}

function leaveTeam(team, uid) {
    team.members = team.members.filter(x => x !== uid);
    (team.history ||= []).push({ userId: uid, action: 'left', at: new Date().toISOString() });
    if (!team.members.length) {
        team.disbanded = true;
        for (const [k, i] of Object.entries(db.data.teamInvites)) if (i.teamId === team.id) delete db.data.teamInvites[k];
    } else if (team.captainId === uid) team.captainId = team.members[0];
}

router.get('/teams/mine', requireAuth, route(req => {
    const mine = Object.values(db.data.teams).filter(t => !t.disbanded && t.members.includes(req.user.id)).map(teamView);
    const invites = Object.values(db.data.teamInvites).filter(i => i.to === req.user.id).map(i => ({
        id: i.id, team: teamView(db.data.teams[i.teamId]), from: users.summary(users.get(i.from)), at: i.createdAt,
    }));
    return { teams: mine, invites };
}));

router.get('/teams/:id', route(req => {
    const team = db.data.teams[req.params.id];
    if (!team) throw new HttpError(404, 'Team not found');
    // Team record across tournaments.
    const history = [];
    let wins = 0, losses = 0;
    for (const t of Object.values(db.data.tournaments)) {
        const e = t.entries.find(x => x.teamId === team.id);
        if (!e || !['live', 'completed'].includes(t.status)) continue;
        for (const m of T.matchesOf(t)) {
            if (m.status !== 'done' || !m.result || m.result.type !== 'played') continue;
            const side = m.slots.findIndex(s => s.entryId === e.id);
            if (side < 0) continue;
            if (m.winnerSide === side) wins++; else losses++;
        }
        history.push({ id: t.id, name: t.name, status: t.status, place: e.place || null, entrants: t.entries.length, startAt: t.startAt });
    }
    return { team: { ...teamView(team), disbanded: Boolean(team.disbanded) }, record: { wins, losses }, tournaments: history };
}));

router.post('/teams', requireAuth, route(req => {
    const me = req.user;
    const active = Object.values(db.data.teams).filter(t => !t.disbanded && t.members.includes(me.id));
    if (active.length >= 6) throw bad('You can be on 6 teams at most');
    const f = validTeamFields({ color: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)], ...req.body });
    const team = { id: db.id('tm'), name: f.name, tag: f.tag || null, color: f.color, captainId: me.id, members: [me.id], createdAt: new Date().toISOString(), history: [{ userId: me.id, action: 'created', at: new Date().toISOString() }] };
    let target = null;
    if (req.body.invite) {
        target = findUser(req.body.invite);
        if (target.id === me.id) throw bad("You can't invite yourself");
    }
    db.data.teams[team.id] = team;
    if (target) inviteToTeam(team, me, target);
    db.save();
    pushTeam(team);
    return { team: teamView(team) };
}));

router.patch('/teams/:id', requireAuth, route(req => {
    const team = getTeam(req.params.id);
    if (!team.members.includes(req.user.id)) throw new HttpError(403, 'Not your team');
    Object.assign(team, validTeamFields(req.body, team));
    db.save();
    pushTeam(team);
    return { team: teamView(team) };
}));

router.post('/teams/:id/invites', requireAuth, route(req => {
    const team = getTeam(req.params.id);
    if (!team.members.includes(req.user.id)) throw new HttpError(403, 'Not your team');
    const target = findUser(req.body.username);
    inviteToTeam(team, req.user, target);
    db.save();
    pushTeam(team);
    return { team: teamView(team) };
}));

router.post('/team-invites/:id/:action', requireAuth, route(req => {
    const inv = db.data.teamInvites[req.params.id];
    if (!inv) throw new HttpError(404, 'Invite not found');
    const team = getTeam(inv.teamId);
    const me = req.user;
    if (req.params.action === 'cancel') {
        if (!team.members.includes(me.id)) throw new HttpError(403, 'Not your team');
    } else if (inv.to !== me.id) throw new HttpError(403, 'Not your invite');
    delete db.data.teamInvites[inv.id];
    if (req.params.action === 'accept') {
        if (team.members.length >= 2) throw bad('That team is already full');
        team.members.push(me.id);
        (team.history ||= []).push({ userId: me.id, action: 'joined', at: new Date().toISOString() });
        for (const [k, i] of Object.entries(db.data.teamInvites)) if (i.teamId === team.id) delete db.data.teamInvites[k];
        for (const uid of team.members) if (uid !== me.id) users.notify(uid, { type: 'team', text: `${me.displayName} joined "${team.name}"`, link: `/team/${team.id}` });
        chat.system(`team:${team.id}`, `${me.displayName} joined the team. Say hi!`);
    } else if (req.params.action === 'decline') {
        users.notify(inv.from, { type: 'team', text: `${me.displayName} declined the invite to "${team.name}"`, link: '/teams' });
    } else if (req.params.action !== 'cancel') throw bad('Unknown action');
    db.save();
    pushTeam(team);
    rt.toUser(inv.to, 'teams', {});
    return { ok: true };
}));

router.post('/teams/:id/leave', requireAuth, route(req => {
    const team = getTeam(req.params.id);
    if (!team.members.includes(req.user.id)) throw bad('You are not on this team');
    const others = team.members.filter(x => x !== req.user.id);
    leaveTeam(team, req.user.id);
    for (const uid of others) users.notify(uid, { type: 'team', text: `${req.user.displayName} left "${team.name}"`, link: `/team/${team.id}` });
    db.save();
    rt.toUsers([req.user.id, ...others], 'teams', {});
    return { ok: true };
}));

// ── Notifications ───────────────────────────────────────────────────────────
router.get('/notifications', requireAuth, route(req => {
    const list = db.data.notifications[req.user.id] || [];
    return { notifications: list.slice(0, 50), unread: list.filter(n => !n.read).length };
}));

router.post('/notifications/read', requireAuth, route(req => {
    const ids = Array.isArray(req.body.ids) ? new Set(req.body.ids) : null;
    for (const n of db.data.notifications[req.user.id] || []) if (!ids || ids.has(n.id)) n.read = true;
    db.save();
    return { ok: true };
}));

// ── Chat ────────────────────────────────────────────────────────────────────
function authorsOf(msgs) {
    const map = {};
    for (const m of msgs) if (m.userId && !map[m.userId]) map[m.userId] = users.summary(users.get(m.userId));
    return map;
}

router.get('/chat/channels', requireAuth, route(req => {
    const list = chat.channelsFor(req.user).map(c => {
        const out = { ...c };
        if (c.type === 'dm') out.other = users.summary(users.get(c.otherId));
        if (c.type === 'match') {
            const m = db.data.matches[c.matchId];
            const t = db.data.tournaments[c.tournamentId];
            if (m && t) {
                out.name = m.slots.map(s => (T.entryOf(t, s.entryId) || { name: 'TBD' }).name).join(' vs ');
                out.sub = `${t.name} · ${m.label}`;
                out.status = m.status;
            }
        }
        if (c.type === 'team') {
            const team = db.data.teams[c.teamId];
            out.color = team && team.color;
        }
        if (c.type === 'tour') {
            const t = db.data.tournaments[c.tournamentId];
            out.accent = t && t.accent;
        }
        if (out.last && out.last.userId) out.lastAuthor = users.summary(users.get(out.last.userId)).displayName;
        return out;
    });
    return { channels: list };
}));

router.get('/chat/dm/:userId', requireAuth, route(req => {
    const other = findUserId(req.params.userId);
    return { channelId: chat.dmChannel(req.user.id, other.id) };
}));

router.get('/chat/messages', requireAuth, route(req => {
    const channel = String(req.query.channel || '');
    const acc = chat.access(req.user, channel);
    if (!acc.read) throw new HttpError(403, "You can't view this chat");
    const all = db.data.messages[channel] || [];
    let end = all.length;
    if (req.query.before) {
        const i = all.findIndex(m => m.at >= req.query.before);
        if (i >= 0) end = i;
    }
    const msgs = all.slice(Math.max(0, end - 80), end);
    return { messages: msgs, users: authorsOf(msgs), canWrite: acc.write, reason: acc.reason || null, hasMore: end > 80 };
}));

router.post('/chat/messages', requireAuth, route(req => {
    const channel = String(req.body.channel || '');
    const text = String(req.body.text || '').trim();
    if (!text) throw bad('Message is empty');
    const acc = chat.access(req.user, channel);
    if (!acc.write) throw new HttpError(403, acc.reason || "You can't post here");
    if (!limits.allow(`chat:${req.user.id}`, 8, 6000)) throw new HttpError(429, "You're sending messages too fast");
    const msg = chat.post(channel, { userId: req.user.id, text });
    chat.markRead(req.user.id, channel);
    // Ping the other person on a brand new DM thread.
    if (channel.startsWith('dm:')) {
        const other = chat.parse(channel).ids.find(i => i !== req.user.id);
        const list = db.data.messages[channel];
        if (other && list.filter(m => m.userId === req.user.id).length === 1) {
            users.notify(other, { type: 'dm', text: `${req.user.displayName} sent you a message`, link: `/chat/${encodeURIComponent(channel)}` });
        }
    }
    return { message: msg, author: users.summary(req.user) };
}));

router.post('/chat/read', requireAuth, route(req => {
    const channel = String(req.body.channel || '');
    if (!chat.access(req.user, channel).read) throw new HttpError(403, 'No access');
    chat.markRead(req.user.id, channel);
    return { ok: true };
}));

module.exports = router;

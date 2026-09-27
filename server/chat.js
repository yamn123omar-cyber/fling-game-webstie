// Chat channels:
//   dm:<userA>:<userB>  – direct messages between friends / teammates
//   team:<teamId>       – team members
//   match:<matchId>     – the match room: both sides + referees. Messages here are
//                         permanent (no edit/delete) and timestamped by the server, so
//                         they double as evidence for check-ins and no-shows.
//   tour:<tournamentId> – public tournament lobby
const db = require('./db');
const cfg = require('./config');
const rt = require('./realtime');
const { hasRole } = require('./auth');

function dmChannel(a, b) {
    const [x, y] = [a, b].sort();
    return `dm:${x}:${y}`;
}

function parse(channelId) {
    const [type, ...rest] = String(channelId).split(':');
    return { type, ids: rest };
}

function matchMemberIds(m) {
    const t = db.data.tournaments[m.tournamentId];
    if (!t) return [];
    const ids = [];
    for (const slot of m.slots) {
        const e = t.entries.find(x => x.id === slot.entryId);
        if (e) ids.push(...e.members);
    }
    return ids;
}

// Who receives live pushes for this channel. null = everyone connected.
function audience(channelId) {
    const { type, ids } = parse(channelId);
    if (type === 'dm') return ids;
    if (type === 'team') {
        const team = db.data.teams[ids[0]];
        return team ? team.members : [];
    }
    if (type === 'match') {
        const m = db.data.matches[ids[0]];
        if (!m) return [];
        const staff = Object.values(db.data.users).filter(u => u.role === 'ref' || u.role === 'admin').map(u => u.id);
        return [...matchMemberIds(m), ...staff];
    }
    if (type === 'tour') return null;
    return [];
}

function areFriends(a, b) {
    const ua = db.data.users[a];
    return Boolean(ua && ua.friends.includes(b));
}

function shareTeam(a, b) {
    return Object.values(db.data.teams).some(t => !t.disbanded && t.members.includes(a) && t.members.includes(b));
}

// → { read: bool, write: bool, reason?: string }
function access(user, channelId) {
    if (!user) return { read: false, write: false };
    const { type, ids } = parse(channelId);
    const staff = hasRole(user, 'ref');
    if (type === 'dm') {
        if (ids.length !== 2 || !ids.includes(user.id)) return { read: false, write: false };
        const other = ids.find(i => i !== user.id) || user.id;
        const ok = areFriends(user.id, other) || shareTeam(user.id, other);
        return { read: true, write: ok, reason: ok ? undefined : 'You can only message friends and teammates' };
    }
    if (type === 'team') {
        const team = db.data.teams[ids[0]];
        const member = Boolean(team && !team.disbanded && team.members.includes(user.id));
        return { read: member, write: member };
    }
    if (type === 'match') {
        const m = db.data.matches[ids[0]];
        if (!m) return { read: false, write: false };
        const member = matchMemberIds(m).includes(user.id);
        return { read: member || staff, write: member || staff };
    }
    if (type === 'tour') {
        const t = db.data.tournaments[ids[0]];
        return { read: Boolean(t), write: Boolean(t) && t.status !== 'draft' };
    }
    return { read: false, write: false };
}

function history(channelId) {
    return (db.data.messages[channelId] ||= []);
}

function post(channelId, { userId = null, text, kind = 'user', meta = null }) {
    const msg = {
        id: db.id('c'),
        userId,
        kind, // 'user' | 'system'
        text: String(text).slice(0, kind === 'system' ? 2000 : cfg.chat.maxLength),
        meta,
        at: new Date().toISOString(),
    };
    const list = history(channelId);
    list.push(msg);
    const cap = channelId.startsWith('match:') ? cfg.chat.matchHistory : cfg.chat.historyPerChannel;
    if (list.length > cap) list.splice(0, list.length - cap);
    db.save();
    const author = userId ? require('./users').summary(db.data.users[userId]) : null;
    const who = audience(channelId);
    if (who === null) rt.broadcast('message', { channelId, message: msg, author });
    else rt.toUsers(who, 'message', { channelId, message: msg, author });
    return msg;
}

const system = (channelId, text, meta) => post(channelId, { text, kind: 'system', meta });

function markRead(userId, channelId) {
    (db.data.reads[userId] ||= {})[channelId] = new Date().toISOString();
    db.save();
}

function unread(userId, channelId) {
    const since = (db.data.reads[userId] || {})[channelId] || '';
    const list = db.data.messages[channelId] || [];
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.at <= since) break;
        if (m.kind === 'user' && m.userId !== userId) n++;
    }
    return n;
}

// Channels that should show up in a user's chat sidebar.
function channelsFor(user) {
    const out = [];
    const u = db.data.users[user.id];
    const seen = new Set();
    const add = (id, info) => {
        if (seen.has(id)) return;
        seen.add(id);
        const list = db.data.messages[id] || [];
        const last = list[list.length - 1] || null;
        out.push({ id, ...info, last, unread: unread(user.id, id) });
    };
    for (const fid of u.friends) add(dmChannel(user.id, fid), { type: 'dm', otherId: fid });
    // DMs with non-friends that already have history (e.g. teammates or unfriended)
    for (const key of Object.keys(db.data.messages)) {
        if (key.startsWith('dm:') && parse(key).ids.includes(user.id)) {
            const other = parse(key).ids.find(i => i !== user.id) || user.id;
            add(key, { type: 'dm', otherId: other });
        }
    }
    for (const t of Object.values(db.data.teams)) {
        if (!t.disbanded && t.members.includes(user.id)) add(`team:${t.id}`, { type: 'team', teamId: t.id, name: t.name });
    }
    const cutoff = Date.now() - 3 * 864e5;
    for (const m of Object.values(db.data.matches)) {
        if (m.status === 'pending' || (m.result && (m.result.type === 'bye' || m.result.type === 'skipped'))) continue;
        if (m.status === 'done' && new Date(m.completedAt || 0).getTime() < cutoff) continue;
        if (matchMemberIds(m).includes(user.id) || (m.refId === user.id)) {
            add(`match:${m.id}`, { type: 'match', matchId: m.id, tournamentId: m.tournamentId });
        }
    }
    for (const t of Object.values(db.data.tournaments)) {
        if (['registration', 'checkin', 'live'].includes(t.status) && t.entries.some(e => e.members.includes(user.id))) {
            add(`tour:${t.id}`, { type: 'tour', tournamentId: t.id, name: t.name });
        }
    }
    out.sort((a, b) => ((b.last && b.last.at) || '').localeCompare((a.last && a.last.at) || ''));
    return out;
}

module.exports = { dmChannel, parse, access, history, post, system, markRead, unread, channelsFor, matchMemberIds, audience };

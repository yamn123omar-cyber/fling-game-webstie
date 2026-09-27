// User records, public views, stats bookkeeping and notifications.
const db = require('./db');
const cfg = require('./config');
const rating = require('./rating');
const rt = require('./realtime');

const ACCENTS = ['#c4ff4d', '#4dd8ff', '#ff5ea8', '#ffb84d', '#9b7bff', '#3ddc97', '#ff6b4d', '#f5f5f5'];
const BANNERS = ['aurora', 'ember', 'ocean', 'toxic', 'grape', 'sunset', 'mono', 'grid'];
const SOCIALS = ['youtube', 'twitch', 'tiktok', 'discord', 'twitter'];

function modeStats() {
    return {
        elo: cfg.rating.start, peak: cfg.rating.start, rp: 0,
        matches: 0, wins: 0, losses: 0,
        duelsWon: 0, duelsLost: 0, kills: 0, deaths: 0,
        noShows: 0, forfeitWins: 0, streak: 0, bestStreak: 0,
        tournaments: 0, titles: 0, podiums: 0, bestPlace: null,
        history: [],
    };
}

function newUser({ username, passwordHash, role = 'player' }) {
    return {
        id: db.id('u'),
        username,
        displayName: username,
        passwordHash,
        role,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        banned: false,
        profile: {
            bio: '',
            accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
            banner: BANNERS[Math.floor(Math.random() * BANNERS.length)],
            title: '',
            socials: {},
            favoriteMode: 'solo',
        },
        roblox: null,
        robloxPending: null,
        stats: { solo: modeStats(), duo: modeStats() },
        friends: [],
    };
}

const get = id => (id ? db.data.users[id] || null : null);

function badges(u) {
    const s = u.stats;
    const both = k => (s.solo[k] || 0) + (s.duo[k] || 0);
    const out = [];
    if (u.role === 'admin') out.push({ id: 'admin', name: 'Organizer', desc: 'Runs the tournaments' });
    if (u.role === 'ref' || u.role === 'admin') out.push({ id: 'ref', name: 'Referee', desc: 'Watches fights and records scores' });
    if (u.roblox && u.roblox.verified) out.push({ id: 'verified', name: 'Verified', desc: 'Roblox account verified' });
    if (both('titles') > 0) out.push({ id: 'champion', name: `Champion ×${both('titles')}`, desc: 'Won a tournament' });
    if (both('podiums') > 0) out.push({ id: 'podium', name: 'Podium', desc: 'Finished top 3 in a tournament' });
    if (Math.max(s.solo.bestStreak, s.duo.bestStreak) >= 5) out.push({ id: 'streak', name: 'On Fire', desc: '5 match wins in a row' });
    if (both('kills') >= 100) out.push({ id: 'flinger', name: 'Master Flinger', desc: '100+ kills in official matches' });
    if (both('tournaments') >= 10) out.push({ id: 'veteran', name: 'Veteran', desc: 'Played 10+ tournaments' });
    if (both('matches') >= 20 && both('noShows') === 0) out.push({ id: 'reliable', name: 'Reliable', desc: '20+ matches, never a no-show' });
    return out;
}

// Small summary used everywhere a user is shown.
function summary(u) {
    if (!u) return { id: null, username: 'deleted', displayName: 'Deleted user', deleted: true };
    if (u.deleted) return { id: u.id, username: 'deleted', displayName: 'Deleted user', deleted: true, accent: '#555' };
    return {
        id: u.id,
        username: u.username,
        displayName: u.displayName || u.username,
        role: u.role,
        accent: u.profile.accent,
        robloxId: u.roblox && u.roblox.verified ? u.roblox.id : null,
        robloxName: u.roblox && u.roblox.verified ? u.roblox.name : null,
        elo: { solo: u.stats.solo.elo, duo: u.stats.duo.elo },
        online: rt.isOnline(u.id),
    };
}

function publicStats(s) {
    const { history, ...rest } = s;
    return { ...rest, tier: rating.tierFor(s.elo).name, history: history.slice(-40) };
}

function profile(u) {
    return {
        ...summary(u),
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        profile: u.profile,
        roblox: u.roblox && u.roblox.verified ? { id: u.roblox.id, name: u.roblox.name, displayName: u.roblox.displayName } : null,
        stats: { solo: publicStats(u.stats.solo), duo: publicStats(u.stats.duo) },
        badges: badges(u),
        friendCount: u.friends.length,
    };
}

function privateView(u) {
    return {
        ...profile(u),
        robloxPending: u.robloxPending ? { name: u.robloxPending.name, displayName: u.robloxPending.displayName, code: u.robloxPending.code, id: u.robloxPending.id } : null,
        friends: u.friends,
    };
}

// ── Stats bookkeeping (every change is recorded so it can be reverted) ─────
function applyDelta(userId, mode, delta, matchId) {
    const u = get(userId);
    if (!u) return null;
    const s = u.stats[mode];
    const rec = {
        userId, mode, matchId,
        elo: delta.elo || 0,
        prevStreak: s.streak, prevBestStreak: s.bestStreak, prevPeak: s.peak,
        counters: {},
    };
    s.elo += rec.elo;
    const newRp = Math.max(0, s.rp + (delta.rp || 0));
    rec.rp = newRp - s.rp;
    s.rp = newRp;
    for (const k of ['matches', 'wins', 'losses', 'duelsWon', 'duelsLost', 'kills', 'deaths', 'noShows', 'forfeitWins']) {
        if (delta[k]) { s[k] += delta[k]; rec.counters[k] = delta[k]; }
    }
    if (delta.wins) s.streak += 1;
    if (delta.losses || delta.noShows) s.streak = 0;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.peak = Math.max(s.peak, s.elo);
    if (rec.elo || delta.matches) {
        s.history.push({ t: new Date().toISOString(), elo: s.elo, m: matchId });
        if (s.history.length > 100) s.history.shift();
    }
    return rec;
}

function revertDelta(rec) {
    const u = get(rec.userId);
    if (!u) return;
    const s = u.stats[rec.mode];
    s.elo -= rec.elo;
    s.rp = Math.max(0, s.rp - rec.rp);
    for (const [k, v] of Object.entries(rec.counters)) s[k] -= v;
    s.streak = rec.prevStreak;
    s.bestStreak = rec.prevBestStreak;
    s.peak = Math.max(rec.prevPeak, s.elo);
    s.history = s.history.filter(h => h.m !== rec.matchId);
}

// ── Notifications ───────────────────────────────────────────────────────────
function notify(userId, { type, text, link = null, data = null }) {
    if (!get(userId)) return;
    const list = (db.data.notifications[userId] ||= []);
    const n = { id: db.id('n'), type, text, link, data, at: new Date().toISOString(), read: false };
    list.unshift(n);
    if (list.length > 100) list.length = 100;
    db.save();
    rt.toUser(userId, 'notification', n);
    return n;
}

function staffIds() {
    return Object.values(db.data.users).filter(u => !u.deleted && !u.banned && (u.role === 'ref' || u.role === 'admin')).map(u => u.id);
}

module.exports = { newUser, get, summary, profile, privateView, applyDelta, revertDelta, notify, modeStats, staffIds, ACCENTS, BANNERS, SOCIALS };

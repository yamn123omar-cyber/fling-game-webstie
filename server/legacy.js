// Accounts from the previous version of the site (one Discord channel per player,
// djb2 password hashes). They're imported with their old hash so people keep
// logging in with their old password; the first login upgrades it to scrypt.
const db = require('./db');
const users = require('./users');

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

const ownerName = () => (process.env.OWNER_USERNAME || 'okok_0020').toLowerCase();
const adminNames = () => (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function initialRole(username) {
    const name = username.toLowerCase();
    if (name === ownerName()) return 'owner';
    if (adminNames().includes(name)) return 'admin';
    return 'player';
}

// → the new user, or null if the profile can't be imported (bot, taken name, bad data)
function importProfile(p) {
    const username = String(p && p.username || '').trim();
    if (!username || p.isBot || !/^[A-Za-z0-9_.-]{1,32}$/.test(username)) return null;
    if (db.userByName(username)) return null;
    const user = users.newUser({ username, passwordHash: null, role: initialRole(username) });
    user.legacyHash = p.passwordHash && p.passwordHash !== 'PENDING_REREGISTER' ? String(p.passwordHash) : null;
    const s = user.stats.solo;
    const ls = p.stats || {};
    s.wins = ls.wins || 0;
    s.losses = ls.losses || 0;
    s.matches = s.wins + s.losses;
    s.tournaments = ls.tournamentsPlayed || 0;
    s.titles = ls.tournamentWins || ls.first || 0;
    s.podiums = (ls.first || 0) + (ls.second || 0) + (ls.third || 0);
    user.profile.bio = String(p.bio || '').slice(0, 300);
    const links = p.links || {};
    for (const k of ['youtube', 'twitch', 'twitter', 'discord']) if (links[k]) user.profile.socials[k] = String(links[k]).slice(0, 80);
    user.legacy = { importedAt: new Date().toISOString(), createdAt: p.createdAt || null, robloxUsername: p.robloxUsername || null };
    if (p.createdAt) user.createdAt = p.createdAt;
    db.data.users[user.id] = user;
    db.indexUser(user);
    db.save();
    return user;
}

module.exports = { djb2, importProfile, initialRole, ownerName };

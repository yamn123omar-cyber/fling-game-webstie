// Optional Discord integration:
//  • off-site backups of the database (important on hosts with ephemeral disks)
//  • announcements in a results channel
//  • one-time migration of accounts from the old Discord-channel storage
// Everything here is best-effort: the site works fine with no Discord config.

const zlib = require('zlib');
const db = require('./db');

const API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BACKUP_CHANNEL_ID = process.env.DISCORD_BACKUP_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
const RESULTS_CHANNEL_ID = process.env.DISCORD_RESULTS_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BACKUP_MARKER = 'FTAP_DB_BACKUP_V3';
const LEGACY_PROFILE_MARKER = '🗄️ PROFILE_DATA_V2';

const headers = () => ({ Authorization: `Bot ${BOT_TOKEN}` });

async function discord(method, path, body) {
    const opts = { method, headers: headers() };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
        opts.body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(API + path, opts);
        if (res.status === 429) {
            const j = await res.json().catch(() => ({}));
            await new Promise(r => setTimeout(r, Math.ceil((j.retry_after || 2) * 1000)));
            continue;
        }
        if (!res.ok) throw new Error(`Discord ${method} ${path} → ${res.status}`);
        return res.status === 204 ? null : res.json();
    }
    throw new Error('Discord rate limited');
}

// Demo databases (npm run seed) must never overwrite real backups or post in the real server.
const isDemo = () => Boolean(db.data.meta && db.data.meta.demo);

// ── Backups ─────────────────────────────────────────────────────────────────
const backupEnabled = () => Boolean(BOT_TOKEN && BACKUP_CHANNEL_ID) && !isDemo();

async function uploadBackup(dataObj) {
    if (!backupEnabled()) return false;
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dataObj)));
    const form = new FormData();
    form.append('content', `${BACKUP_MARKER} · ${new Date().toISOString()} · ${(gz.length / 1024).toFixed(1)} KB`);
    form.append('files[0]', new Blob([gz], { type: 'application/gzip' }), 'db.json.gz');
    const msg = await discord('POST', `/channels/${BACKUP_CHANNEL_ID}/messages`, form);

    // Keep the three newest backups, delete the rest.
    try {
        const msgs = await discord('GET', `/channels/${BACKUP_CHANNEL_ID}/messages?limit=50`);
        const backups = msgs.filter(m => m.content && m.content.startsWith(BACKUP_MARKER) && m.id !== msg.id);
        for (const old of backups.slice(2)) {
            await discord('DELETE', `/channels/${BACKUP_CHANNEL_ID}/messages/${old.id}`).catch(() => {});
        }
    } catch { /* pruning is optional */ }
    return true;
}

async function downloadLatestBackup() {
    if (!backupEnabled()) return null;
    const msgs = await discord('GET', `/channels/${BACKUP_CHANNEL_ID}/messages?limit=50`);
    const latest = msgs.find(m => m.content && m.content.startsWith(BACKUP_MARKER) && m.attachments && m.attachments.length);
    if (!latest) return null;
    const res = await fetch(latest.attachments[0].url);
    if (!res.ok) throw new Error('Backup download failed: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

// ── Announcements ───────────────────────────────────────────────────────────
function announce(text) {
    if (!BOT_TOKEN || !RESULTS_CHANNEL_ID || isDemo()) return;
    discord('POST', `/channels/${RESULTS_CHANNEL_ID}/messages`, { content: String(text).slice(0, 1990) })
        .catch(e => console.warn('[discord] announce failed:', e.message));
}

// ── Legacy account migration ────────────────────────────────────────────────
// The previous version stored each profile as a JSON attachment in a
// `profile-<name>` channel with a djb2 password hash. When someone logs in and
// has no account here yet, we look there, check the password and import them.
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

let channelCache = null;
let channelCacheAt = 0;

async function findLegacyProfile(username) {
    if (!BOT_TOKEN || !GUILD_ID) return null;
    if (!channelCache || Date.now() - channelCacheAt > 60_000) {
        channelCache = await discord('GET', `/guilds/${GUILD_ID}/channels`);
        channelCacheAt = Date.now();
    }
    const name = `profile-${username.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    const ch = channelCache.find(c => c.type === 0 && c.name === name);
    if (!ch) return null;
    const msgs = await discord('GET', `/channels/${ch.id}/messages?limit=50`);
    const m = msgs.find(x => x.content && x.content.startsWith(LEGACY_PROFILE_MARKER) && x.attachments && x.attachments.length);
    if (!m) return null;
    const res = await fetch(m.attachments[0].url);
    if (!res.ok) return null;
    const profile = await res.json();
    if (!profile || String(profile.username || '').toLowerCase() !== username.toLowerCase()) return null;
    return profile;
}

async function checkLegacyLogin(username, password) {
    try {
        const p = await findLegacyProfile(username);
        if (!p || p.isBot || !p.passwordHash || p.passwordHash !== djb2(password)) return null;
        return p;
    } catch (e) {
        console.warn('[discord] legacy lookup failed:', e.message);
        return null;
    }
}

module.exports = {
    backupEnabled,
    isDemo,
    uploadBackup,
    downloadLatestBackup,
    announce,
    checkLegacyLogin,
    legacyEnabled: () => Boolean(BOT_TOKEN && GUILD_ID),
};

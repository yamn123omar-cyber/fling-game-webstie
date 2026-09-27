// Discord integration. The site's own database stays the source of truth;
// Discord gets a tidy, human-readable copy plus full backups:
//
//   🏆 FTAP ARENA (public, read-only)     🗄️ FTAP DATABASE (hidden from members)
//     #announcements                        #players       one message per player
//     #results                              #teams         one message per team
//     #hall-of-fame                         #tournaments   one message per tournament
//     #leaderboard                          #matches       one message per match
//                                           #match-chats   full match-room chat logs
//                                           #backups       complete site backups
//
// The owner builds this from the Owner Panel ("Rebuild Discord server"), which
// first imports every account from the old one-channel-per-player layout,
// then deletes everything in the server and creates the structure above.
// After that a background loop keeps every message up to date.

const zlib = require('zlib');
const db = require('./db');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API = process.env.DISCORD_API_BASE || 'https://discord.com/api/v10';
const LEGACY_BACKUP_CHANNEL = process.env.DISCORD_BACKUP_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
const LEGACY_RESULTS_CHANNEL = process.env.DISCORD_RESULTS_CHANNEL_ID;
const BACKUP_MARKER = 'FTAP_DB_BACKUP_V3';
const LEGACY_PROFILE_MARKER = '🗄️ PROFILE_DATA_V2';
const PUBLIC_CATEGORY = '🏆 FTAP ARENA';
const DATABASE_CATEGORY = '🗄️ FTAP DATABASE';
const VIEW = 1 << 10, SEND = 1 << 11, ATTACH = 1 << 15, HISTORY = 1 << 16, THREADS = (1 << 35) + (1 << 36) + (1 << 38);

const LAYOUT = [
    { key: 'public', name: PUBLIC_CATEGORY, private: false, channels: [
        ['announcements', 'New tournaments, starts and champions — posted by the site'],
        ['results', 'Every finished match with scores'],
        ['hall-of-fame', 'Every tournament champion'],
        ['leaderboard', 'Live top players (updated automatically)'],
    ] },
    { key: 'database', name: DATABASE_CATEGORY, private: true, channels: [
        ['players', 'One message per player: stats, Elo, teams, tournaments, opponents. Updated automatically.'],
        ['teams', 'One message per team: members, history, record.'],
        ['tournaments', 'One message per tournament: settings, entrants, results.'],
        ['matches', 'One message per finished match: duels, scores, admin, time.'],
        ['match-chats', 'Full match-room chat log of every finished match.'],
        ['backups', 'Complete backups of the site. The site restores itself from the newest one.'],
    ] },
];

// ── HTTP ────────────────────────────────────────────────────────────────────
async function discord(method, path, body) {
    const opts = { method, headers: { Authorization: `Bot ${BOT_TOKEN}` } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
        opts.body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
    }
    for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(API + path, opts);
        if (res.status === 429) {
            const j = await res.json().catch(() => ({}));
            await sleep(Math.ceil((j.retry_after || 2) * 1000) + 100);
            continue;
        }
        if (res.status === 404) { const e = new Error(`Discord ${method} ${path} → 404`); e.status = 404; throw e; }
        if (!res.ok) { const e = new Error(`Discord ${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300)); e.status = res.status; throw e; }
        return res.status === 204 ? null : res.json();
    }
    throw new Error('Discord kept rate limiting us');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── State ───────────────────────────────────────────────────────────────────
const isDemo = () => Boolean(db.data.meta && db.data.meta.demo);
const enabled = () => Boolean(BOT_TOKEN && GUILD_ID) && !isDemo();
function state() {
    const m = db.data.meta;
    if (!m.discord) m.discord = { channels: {}, messages: {}, hashes: {}, builtAt: null };
    return m.discord;
}
const ch = key => state().channels[key] || null;
const job = { running: false, step: null, done: 0, total: 0, log: [], error: null, finishedAt: null };
const logJob = line => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`); if (job.log.length > 80) job.log.shift(); };

function status() {
    return {
        configured: Boolean(BOT_TOKEN && GUILD_ID),
        demo: isDemo(),
        built: Boolean(ch('players')),
        builtAt: state().builtAt,
        backups: backupEnabled(),
        queue: queue.size,
        lastSyncAt: lastSyncAt,
        job: { ...job, log: job.log.slice(-30) },
    };
}

// ── Backups ─────────────────────────────────────────────────────────────────
const backupChannel = () => ch('backups') || LEGACY_BACKUP_CHANNEL || null;
const backupEnabled = () => Boolean(BOT_TOKEN && backupChannel()) && !isDemo();
const canRestore = () => Boolean(BOT_TOKEN && (GUILD_ID || LEGACY_BACKUP_CHANNEL));

async function uploadBackup(dataObj) {
    if (!backupEnabled()) return false;
    const channel = backupChannel();
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dataObj)));
    const form = new FormData();
    form.append('content', `${BACKUP_MARKER} · ${new Date().toISOString()} · ${(gz.length / 1024).toFixed(1)} KB`);
    form.append('files[0]', new Blob([gz], { type: 'application/gzip' }), 'db.json.gz');
    const msg = await discord('POST', `/channels/${channel}/messages`, form);
    try {
        const msgs = await discord('GET', `/channels/${channel}/messages?limit=50`);
        const old = msgs.filter(m => m.content && m.content.startsWith(BACKUP_MARKER) && m.id !== msg.id);
        for (const m of old.slice(4)) await discord('DELETE', `/channels/${channel}/messages/${m.id}`).catch(() => {});
    } catch { /* pruning is optional */ }
    return true;
}

async function findBackupChannel() {
    if (GUILD_ID) {
        const all = await discord('GET', `/guilds/${GUILD_ID}/channels`);
        const cat = all.find(c => c.type === 4 && c.name === DATABASE_CATEGORY);
        const found = all.find(c => c.type === 0 && c.name === 'backups' && (!cat || c.parent_id === cat.id));
        if (found) return found.id;
    }
    return LEGACY_BACKUP_CHANNEL || null;
}

async function downloadLatestBackup() {
    if (!canRestore()) return null;
    const channel = await findBackupChannel();
    if (!channel) return null;
    const msgs = await discord('GET', `/channels/${channel}/messages?limit=50`);
    const latest = msgs.find(m => m.content && m.content.startsWith(BACKUP_MARKER) && m.attachments && m.attachments.length);
    if (!latest) return null;
    const res = await fetch(latest.attachments[0].url);
    if (!res.ok) throw new Error('Backup download failed: ' + res.status);
    return JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
}

// ── Announcements ───────────────────────────────────────────────────────────
// announce('results', text) · announce('announcements', text) · announce(text) → results
function announce(kind, text) {
    if (text === undefined) { text = kind; kind = 'results'; }
    if (!BOT_TOKEN || isDemo()) return;
    const channel = ch(kind) || LEGACY_RESULTS_CHANNEL;
    if (!channel) return;
    discord('POST', `/channels/${channel}/messages`, { content: String(text).slice(0, 1990), allowed_mentions: { parse: [] } })
        .catch(e => console.warn('[discord] announce failed:', e.message));
}

// ── Old accounts ────────────────────────────────────────────────────────────
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) + hash) + str.charCodeAt(i); hash = hash & hash; }
    return Math.abs(hash).toString(36);
}

async function readLegacyProfile(channelId) {
    const msgs = await discord('GET', `/channels/${channelId}/messages?limit=50`);
    const m = msgs.find(x => x.content && x.content.startsWith(LEGACY_PROFILE_MARKER) && x.attachments && x.attachments.length);
    if (!m) return null;
    const res = await fetch(m.attachments[0].url);
    return res.ok ? res.json() : null;
}

let channelCache = null, channelCacheAt = 0;
async function checkLegacyLogin(username, password) {
    try {
        if (!BOT_TOKEN || !GUILD_ID) return null;
        if (!channelCache || Date.now() - channelCacheAt > 60_000) {
            channelCache = await discord('GET', `/guilds/${GUILD_ID}/channels`);
            channelCacheAt = Date.now();
        }
        const name = `profile-${username.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
        const c = channelCache.find(x => x.type === 0 && x.name === name);
        if (!c) return null;
        const p = await readLegacyProfile(c.id);
        if (!p || String(p.username || '').toLowerCase() !== username.toLowerCase()) return null;
        if (p.isBot || !p.passwordHash || p.passwordHash !== djb2(password)) return null;
        return p;
    } catch (e) {
        console.warn('[discord] legacy lookup failed:', e.message);
        return null;
    }
}

async function importLegacyAccounts(onProgress = () => {}) {
    if (!BOT_TOKEN || !GUILD_ID) throw new Error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first');
    const legacy = require('./legacy');
    const all = await discord('GET', `/guilds/${GUILD_ID}/channels`);
    const profiles = all.filter(c => c.type === 0 && /^profile-/.test(c.name || ''));
    let imported = 0;
    for (let i = 0; i < profiles.length; i++) {
        onProgress(i, profiles.length);
        try {
            const p = await readLegacyProfile(profiles[i].id);
            if (p && legacy.importProfile(p)) imported++;
        } catch (e) { logJob(`Couldn't read #${profiles[i].name}: ${e.message}`); }
    }
    return imported;
}

// ── Rebuild the whole server ────────────────────────────────────────────────
function startRebuild(user) {
    if (!BOT_TOKEN || !GUILD_ID) throw Object.assign(new Error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first'), { status: 400 });
    if (isDemo()) throw Object.assign(new Error('This is demo data — Discord is switched off'), { status: 400 });
    if (job.running) throw Object.assign(new Error('A rebuild is already running'), { status: 400 });
    Object.assign(job, { running: true, step: 'Starting', done: 0, total: 0, log: [], error: null, finishedAt: null });
    logJob(`Rebuild started by ${user ? user.username : 'the owner'}`);
    rebuild().catch(e => {
        job.error = e.message;
        logJob(`Failed: ${e.message}`);
        console.error('[discord] rebuild failed:', e);
    }).finally(() => {
        job.running = false;
        job.finishedAt = new Date().toISOString();
    });
}

async function rebuild() {
    job.step = 'Importing old player accounts';
    const n = await importLegacyAccounts((i, total) => { job.done = i; job.total = total; });
    logJob(`Imported ${n} old account${n === 1 ? '' : 's'} (they keep their old password)`);
    db.save();

    job.step = 'Deleting everything in the server';
    const all = await discord('GET', `/guilds/${GUILD_ID}/channels`);
    const order = [...all.filter(c => c.type !== 4), ...all.filter(c => c.type === 4)];
    job.done = 0; job.total = order.length;
    for (const c of order) {
        try { await discord('DELETE', `/channels/${c.id}`); } catch (e) { logJob(`Couldn't delete #${c.name}: ${e.message}`); }
        job.done++;
    }
    logJob(`Deleted ${job.done} channels and categories`);
    channelCache = null;

    job.step = 'Creating the new layout';
    const me = await discord('GET', '/users/@me');
    const s = state();
    s.channels = {};
    s.messages = {};
    s.hashes = {};
    let position = 0;
    for (const cat of LAYOUT) {
        const overwrites = cat.private
            ? [{ id: GUILD_ID, type: 0, deny: String(VIEW), allow: '0' }, { id: me.id, type: 1, allow: String(VIEW | SEND | ATTACH | HISTORY), deny: '0' }]
            : [{ id: GUILD_ID, type: 0, allow: String(VIEW | HISTORY), deny: String(SEND | THREADS) }, { id: me.id, type: 1, allow: String(VIEW | SEND | ATTACH | HISTORY), deny: '0' }];
        const category = await discord('POST', `/guilds/${GUILD_ID}/channels`, { name: cat.name, type: 4, position: position++, permission_overwrites: overwrites });
        s.channels[`category:${cat.key}`] = category.id;
        for (const [name, topic] of cat.channels) {
            const c = await discord('POST', `/guilds/${GUILD_ID}/channels`, { name, type: 0, topic, parent_id: category.id, position: position++, permission_overwrites: overwrites });
            s.channels[name] = c.id;
        }
    }
    s.builtAt = new Date().toISOString();
    db.save();
    logJob('Created the new channels');

    job.step = 'Saving a backup';
    await uploadBackup(db.data);
    logJob('Uploaded a full backup to #backups');

    job.step = 'Writing the database';
    requestFullSync();
    await drain(true);
    job.step = 'Done';
    logJob('Everything is saved in Discord');
}

// ── Keeping the database channels up to date ────────────────────────────────
const queue = new Map(); // key → { channel, text, file? , hash }
let lastSyncAt = null;
let syncing = false;

function hashOf(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + ':' + s.length;
}

function requestFullSync() {
    state().hashes = {};
}

function planSync() {
    const render = require('./discord-render');
    const s = state();
    const add = (key, channel, text, file = null, repost = false) => {
        if (!ch(channel)) return;
        const hash = hashOf(text + (file ? file.body : ''));
        if (s.hashes[key] === hash) return;
        queue.set(key, { key, channel, text, file, hash, repost });
    };
    for (const item of render.all()) add(item.key, item.channel, item.text, item.file, item.repost);
}

async function processItem(item) {
    const s = state();
    const channel = ch(item.channel);
    const existing = s.messages[item.key];
    if (item.file) {
        // Attachments can't be edited: post a new message each time the log changes.
        const form = new FormData();
        form.append('content', item.text.slice(0, 1990));
        form.append('files[0]', new Blob([item.file.body], { type: 'text/plain' }), item.file.name);
        const msg = await discord('POST', `/channels/${channel}/messages`, form);
        s.messages[item.key] = msg.id;
    } else if (existing && !item.repost) {
        try {
            await discord('PATCH', `/channels/${channel}/messages/${existing}`, { content: item.text.slice(0, 1990), allowed_mentions: { parse: [] } });
        } catch (e) {
            if (e.status !== 404) throw e;
            const msg = await discord('POST', `/channels/${channel}/messages`, { content: item.text.slice(0, 1990), allowed_mentions: { parse: [] } });
            s.messages[item.key] = msg.id;
        }
    } else {
        const msg = await discord('POST', `/channels/${channel}/messages`, { content: item.text.slice(0, 1990), allowed_mentions: { parse: [] } });
        s.messages[item.key] = msg.id;
    }
    s.hashes[item.key] = item.hash;
}

// Push queued changes. `all` = keep going until the queue is empty.
async function drain(all = false) {
    if (syncing) return;
    syncing = true;
    try {
        planSync();
        if (all) { job.done = 0; job.total = queue.size; }
        let budget = all ? Infinity : 25;
        for (const [key, item] of queue) {
            if (budget-- <= 0) break;
            try {
                await processItem(item);
            } catch (e) {
                console.warn('[discord] sync failed for', key, e.message);
                if (all) logJob(`Couldn't write ${key}: ${e.message}`);
            }
            queue.delete(key);
            if (all) job.done++;
        }
        db.save();
        lastSyncAt = new Date().toISOString();
    } finally {
        syncing = false;
    }
}

function startSyncLoop(intervalMs = 20_000) {
    const timer = setInterval(() => {
        if (!enabled() || !ch('players') || job.running) return;
        drain().catch(e => console.warn('[discord] sync loop:', e.message));
    }, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = {
    enabled,
    isDemo,
    status,
    backupEnabled,
    canRestore,
    uploadBackup,
    downloadLatestBackup,
    announce,
    checkLegacyLogin,
    importLegacyAccounts,
    legacyEnabled: () => Boolean(BOT_TOKEN && GUILD_ID) && !isDemo(),
    startRebuild,
    requestFullSync,
    drain,
    startSyncLoop,
    _job: job,
};

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;         // raw JSON backup channel (bot-only)
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const RESULTS_CHANNEL_ID = process.env.DISCORD_RESULTS_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const PROFILES_CATEGORY_ID = process.env.DISCORD_PROFILES_CATEGORY_ID;
const DATA_CATEGORY_ID = process.env.DISCORD_DATA_CATEGORY_ID;
const TOURNAMENT_INDEX_CHANNEL_ID = process.env.DISCORD_TOURNAMENT_INDEX_CHANNEL_ID;

const DISCORD_API = 'https://discord.com/api/v10';
const DATA_MESSAGE_CONTENT = '🗄️ TOURNAMENT_DATA_V2';   // marker text on the data attachment message
const PROFILE_DATA_MARKER = '🗄️ PROFILE_DATA_V2';        // marker on profile JSON attachment
const PROFILE_CARD_MARKER = '📋 PROFILE_CARD_V2';        // marker on the human-readable card
const STATE_MSG_PREFIX    = '📊 TOURNAMENT_STATE_V2';    // marker on pinned bracket state
const REGISTRY_MARKER     = '📒 PLAYER_REGISTRY_V2';     // marker on registry summary message

// In-memory: active tournament channel ID and ID (set when a tournament starts)
let activeTournamentChannelId = null;
let activeTournamentId = null;
let activeTournamentStateMsgId = null; // message ID of the pinned state card

// Simple hash function for passwords (not crypto-secure, but good enough for this use case)
function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Post a file attachment to a channel via bot (bypasses 2000-char message limit)
async function botPostFile(channelId, markerText, filename, jsonObj) {
    const form = new FormData();
    form.append('content', markerText);
    form.append('file', Buffer.from(JSON.stringify(jsonObj), 'utf-8'), {
        filename,
        contentType: 'application/json'
    });
    return axios.post(
        `${DISCORD_API}/channels/${channelId}/messages`,
        form,
        { headers: { ...form.getHeaders(), 'Authorization': `Bot ${BOT_TOKEN}` } }
    );
}

// Edit the file attachment of an existing message (delete + repost — Discord doesn't allow editing attachments)
async function botEditFile(channelId, messageId, markerText, filename, jsonObj) {
    await axios.delete(
        `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
    ).catch(() => {});
    return botPostFile(channelId, markerText, filename, jsonObj);
}

// Post a plain text message, splitting into chunks if > 1990 chars
// Returns the FIRST message so callers can pin the marker chunk
async function botPostChunked(channelId, text) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= 1990) {
            chunks.push(remaining);
            break;
        }
        // Split at last newline before 1990
        let splitAt = remaining.lastIndexOf('\n', 1990);
        if (splitAt <= 0) splitAt = 1990;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    let firstMsg = null;
    for (const chunk of chunks) {
        const msg = await botPost(channelId, chunk);
        if (!firstMsg) firstMsg = msg;
    }
    return firstMsg;
}

// In-memory channel name → id cache to avoid hammering the guild channels API
const _channelCache = new Map();
// Per-profile message ID caches to avoid 50-msg scan on every saveProfile call
// key: username  →  { dataId: string|null, cardId: string|null }
const _profileMsgIdCache = new Map();
// Cached guild channel name set — shared between getOrCreatePlayerChannel and check-missing
let _guildChannelCache = null;
let _guildChannelCacheTs = 0;
const GUILD_CHANNEL_CACHE_TTL = 30000;

// Serial Discord request queue — all Discord API calls run one at a time with 300ms spacing
// Prevents concurrent requests from triggering Discord 429 rate limits
let _discordQueueTail = Promise.resolve();
const DISCORD_MIN_SPACING_MS = 300;

function discordRequest(method, url, opts = {}) {
    return new Promise((resolve, reject) => {
        _discordQueueTail = _discordQueueTail.then(async () => {
            const start = Date.now();
            try {
                const result = await axios({ method, url, ...opts });
                const elapsed = Date.now() - start;
                if (elapsed < DISCORD_MIN_SPACING_MS) {
                    await new Promise(r => setTimeout(r, DISCORD_MIN_SPACING_MS - elapsed));
                }
                resolve(result);
            } catch (e) {
                if (e.response?.status === 429) {
                    const retryAfter = ((e.response.data?.retry_after) || 5) * 1000;
                    console.warn(`Discord 429 — waiting ${retryAfter}ms before retry`);
                    await new Promise(r => setTimeout(r, retryAfter));
                    try {
                        resolve(await axios({ method, url, ...opts }));
                    } catch (e2) { reject(e2); }
                } else {
                    reject(e);
                }
            }
        }).catch(() => {}); // prevent unhandled rejection on the tail itself
    });
}

// Get or create a Discord channel for a player (named profile-<username>)
async function getOrCreatePlayerChannel(username) {
    if (!GUILD_ID) throw new Error('DISCORD_GUILD_ID not set in .env');
    const channelName = `profile-${username.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

    if (_channelCache.has(channelName)) return _channelCache.get(channelName);

    // Use the shared cached guild channel list (avoids duplicate GET /guilds/:id/channels calls)
    const resp = await discordRequest('get',
        `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
    );
    // Populate _channelCache for ALL profile channels we see — reduces future lookups
    resp.data.forEach(c => {
        if (c.type === 0 && c.name) _channelCache.set(c.name, c.id);
    });
    // Also refresh the shared cache
    _guildChannelCache = new Set(resp.data.map(c => c.name));
    _guildChannelCacheTs = Date.now();

    if (_channelCache.has(channelName)) return _channelCache.get(channelName);

    const body = {
        name: channelName,
        type: 0,
        topic: `Player profile for ${username} — stats, history, credentials`
    };
    // Discord caps each category at 50 channels. Pick a parent that still has room,
    // transparently spilling into "Profiles Overflow N" categories once the main one fills.
    const childCount = id => resp.data.filter(c => c.parent_id === id).length;
    let parentId = PROFILES_CATEGORY_ID || null;
    if (parentId && childCount(parentId) >= 50) {
        const overflow = resp.data
            .filter(c => c.type === 4 && /^profiles overflow/i.test(c.name || ''))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const target = overflow.find(c => childCount(c.id) < 50);
        if (target) {
            parentId = target.id;
        } else {
            try {
                const catResp = await discordRequest('post',
                    `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
                    {
                        data: { name: `Profiles Overflow ${overflow.length + 1}`, type: 4 },
                        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
                    });
                parentId = catResp.data.id;
                _channelCache.set(catResp.data.name, parentId);
                console.log('Created overflow profiles category:', catResp.data.name);
            } catch (e) {
                console.error('Overflow category create failed:', e.response?.status, JSON.stringify(e.response?.data || {}).slice(0, 200));
                parentId = null; // last resort — create at the guild root so registration still works
            }
        }
    }
    if (parentId) body.parent_id = parentId;

    let created;
    try {
        created = await discordRequest('post',
            `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { data: body, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
    } catch (e) {
        const data = e.response?.data;
        const isFull = data?.code === 50035 || /maximum number of channels/i.test(JSON.stringify(data || ''));
        console.error('Channel create failed for', channelName, '| status', e.response?.status, '| data', JSON.stringify(data || {}).slice(0, 300));
        if (isFull && body.parent_id) {
            delete body.parent_id; // category full — fall back to guild root so registration still succeeds
            created = await discordRequest('post',
                `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
                { data: body, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
        } else {
            throw e;
        }
    }
    _channelCache.set(channelName, created.data.id);
    return created.data.id;
}

// Fetch a player profile from their dedicated channel (reads JSON attachment)
async function getProfile(username) {
    try {
        const channelId = await getOrCreatePlayerChannel(username);
        const cached = _profileMsgIdCache.get(username) || {};

        // Fast path: try the cached data message ID first (fetch just that one message)
        if (cached.dataId) {
            try {
                const msgResp = await axios.get(
                    `${DISCORD_API}/channels/${channelId}/messages/${cached.dataId}`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
                );
                const msg = msgResp.data;
                if (msg.content && msg.content.startsWith(PROFILE_DATA_MARKER) && msg.attachments?.length > 0) {
                    const dl = await axios.get(msg.attachments[0].url);
                    return { ...dl.data, _channelId: channelId, _messageId: msg.id };
                }
            } catch { cached.dataId = null; } // stale — fall through to full scan
        }

        // Slow path: full 50-msg scan
        const resp = await axios.get(
            `${DISCORD_API}/channels/${channelId}/messages?limit=50`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        for (const msg of resp.data) {
            if (msg.content && msg.content.startsWith(PROFILE_DATA_MARKER) && msg.attachments?.length > 0) {
                try {
                    const dl = await axios.get(msg.attachments[0].url);
                    cached.dataId = msg.id;
                    _profileMsgIdCache.set(username, cached);
                    return { ...dl.data, _channelId: channelId, _messageId: msg.id };
                } catch {}
            }
        }
        return null;
    } catch (error) {
        console.error('Error fetching profile for', username, error.message);
        return null;
    }
}

// Build a human-readable profile card (pinned in the player's channel)
function buildProfileCard(profile) {
    const s = profile.stats || {};
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const total = wins + losses;
    const elo = s.elo || 1000;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : 'N/A';
    const tier = elo >= 1300 ? '💎 Diamond' : elo >= 1150 ? '🥇 Gold' : elo >= 1050 ? '🥈 Silver' : '🥉 Bronze';
    const typeLabel = profile.isBot ? '🤖 Bot Player' : '👤 Player';
    const registered = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-GB') : 'Unknown';

    const passwordLine = profile.isBot
        ? `Password    : bot_${profile.username}  (auto-generated)`
        : `Password    : [hashed — see login page]`;

    return [
        `${PROFILE_CARD_MARKER}`,
        ``,
        `## ${typeLabel}: ${profile.username}`,
        ``,
        `**🔑 Credentials**`,
        `\`\`\``,
        `Username    : ${profile.username}`,
        passwordLine,
        `Hash (djb2) : ${profile.passwordHash || '(none)'}`,
        `\`\`\``,
        ``,
        `**📊 Statistics**`,
        `\`\`\``,
        `ELO         : ${elo}  (${tier})`,
        `Wins        : ${wins}`,
        `Losses      : ${losses}`,
        `Win Rate    : ${winRate}`,
        `Tournaments : ${s.tournamentsPlayed || 0} played  /  ${s.tournamentWins || 0} won`,
        `Placements  : 🥇 ${s.first || 0}  🥈 ${s.second || 0}  🥉 ${s.third || 0}`,
        `\`\`\``,
        ``,
        profile.bio ? `**📝 Bio:** ${profile.bio}` : null,
        ``,
        `📅 Registered: ${registered}`,
        `🔄 _Updated: ${new Date().toLocaleString('en-GB')}_`
    ].filter(l => l !== null).join('\n');
}

// Save a player profile to their dedicated channel
// Layout: 1 pinned human-readable card (top), 1 JSON attachment message (data)
async function saveProfile(profile) {
    try {
        const channelId = await getOrCreatePlayerChannel(profile.username);
        const { _channelId, _messageId, ...profileToSave } = profile;
        const cached = _profileMsgIdCache.get(profile.username) || {};

        // 1. JSON data as file attachment — use cached ID to skip the 50-msg scan
        if (cached.dataId) {
            try {
                await botEditFile(channelId, cached.dataId, PROFILE_DATA_MARKER, 'profile.json', profileToSave);
                // botEditFile deletes + reposts — capture the new message ID
                const r = await axios.get(`${DISCORD_API}/channels/${channelId}/messages?limit=10`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
                const fresh = r.data.find(m => m.content && m.content.startsWith(PROFILE_DATA_MARKER));
                if (fresh) cached.dataId = fresh.id;
            } catch { cached.dataId = null; } // stale — fall through
        }
        if (!cached.dataId) {
            // Full scan to find or create data message
            const resp = await axios.get(`${DISCORD_API}/channels/${channelId}/messages?limit=50`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
            const existingData = resp.data.find(m => m.content && m.content.startsWith(PROFILE_DATA_MARKER));
            const existingCard = resp.data.find(m => m.content && m.content.startsWith(PROFILE_CARD_MARKER));
            if (existingData) {
                await botEditFile(channelId, existingData.id, PROFILE_DATA_MARKER, 'profile.json', profileToSave);
                const r2 = await axios.get(`${DISCORD_API}/channels/${channelId}/messages?limit=10`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
                const fresh = r2.data.find(m => m.content && m.content.startsWith(PROFILE_DATA_MARKER));
                cached.dataId = fresh?.id || null;
            } else {
                const newMsg = await botPostFile(channelId, PROFILE_DATA_MARKER, 'profile.json', profileToSave);
                cached.dataId = newMsg?.data?.id || null;
            }
            if (!cached.cardId && existingCard) cached.cardId = existingCard.id;
        }

        // 2. Human-readable card — edit if we know the ID, else scan or create
        const cardText = buildProfileCard(profile);
        if (cached.cardId) {
            try {
                await botEdit(channelId, cached.cardId, cardText);
            } catch { cached.cardId = null; }
        }
        if (!cached.cardId) {
            const resp2 = await axios.get(`${DISCORD_API}/channels/${channelId}/messages?limit=50`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
            const existingCard = resp2.data.find(m => m.content && m.content.startsWith(PROFILE_CARD_MARKER));
            if (existingCard) {
                await botEdit(channelId, existingCard.id, cardText);
                cached.cardId = existingCard.id;
            } else {
                const cardMsg = await botPost(channelId, cardText);
                cached.cardId = cardMsg?.data?.id || null;
                if (cached.cardId) await botPin(channelId, cached.cardId);
            }
        }

        _profileMsgIdCache.set(profile.username, cached);

        // Invalidate channel name cache so check-missing picks up the new channel
        invalidateGuildChannelCache();

        // 3. Update the central player-registry (non-blocking)
        updatePlayerRegistry(profile).catch(() => {});

        return true;
    } catch (error) {
        console.error('Error saving profile for', profile.username, '|', error.message,
            '| status', error.response?.status, '| data', JSON.stringify(error.response?.data || {}).slice(0, 300));
        return false;
    }
}

// ─── Player Registry ────────────────────────────────────────────────────────
// One channel with a separate pinned message per player showing a compact summary

const _registryMsgIdCache = new Map(); // username → message ID in registry channel

async function getOrCreateRegistryChannel() {
    const name = 'player-registry';
    if (_channelCache.has(name)) return _channelCache.get(name);
    if (!GUILD_ID) return null;
    try {
        const resp = await axios.get(`${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        const existing = resp.data.find(c => c.name === name && c.type === 0);
        if (existing) { _channelCache.set(name, existing.id); return existing.id; }
        const body = {
            name,
            type: 0,
            topic: 'Live registry of every registered player — updated automatically'
        };
        if (PROFILES_CATEGORY_ID) body.parent_id = PROFILES_CATEGORY_ID;
        const created = await axios.post(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, body,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
        _channelCache.set(name, created.data.id);
        return created.data.id;
    } catch (e) {
        console.error('Could not get/create player-registry channel:', e.message);
        return null;
    }
}

function buildRegistryEntry(profile) {
    const s = profile.stats || {};
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const elo = s.elo || 1000;
    const total = wins + losses;
    const wr = total > 0 ? ((wins / total) * 100).toFixed(0) + '%' : 'N/A';
    const tier = elo >= 1300 ? '💎' : elo >= 1150 ? '🥇' : elo >= 1050 ? '🥈' : '🥉';
    const badge = profile.isBot ? '🤖' : '👤';
    const registered = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-GB') : '?';
    return [
        `${REGISTRY_MARKER}:${profile.username}`,
        `${badge} **${profile.username}**  ${tier} ELO: ${elo}`,
        `\`\`\``,
        `Hash     : ${profile.passwordHash || '(bot)'}`,
        `Record   : ${wins}W / ${losses}L  (${wr} WR)`,
        `Placemnt : 🥇${s.first||0} 🥈${s.second||0} 🥉${s.third||0}`,
        `Tourneys : ${s.tournamentsPlayed||0} played / ${s.tournamentWins||0} won`,
        `Joined   : ${registered}`,
        `\`\`\``,
    ].join('\n');
}

async function updatePlayerRegistry(profile) {
    const regChannelId = await getOrCreateRegistryChannel();
    if (!regChannelId) return;

    const entryText = buildRegistryEntry(profile);
    const markerForUser = `${REGISTRY_MARKER}:${profile.username}`;

    // Check cache first, then scan channel
    let existingMsgId = _registryMsgIdCache.get(profile.username);
    if (!existingMsgId) {
        const resp = await axios.get(`${DISCORD_API}/channels/${regChannelId}/messages?limit=100`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        const found = resp.data.find(m => m.content && m.content.startsWith(markerForUser));
        if (found) existingMsgId = found.id;
    }

    if (existingMsgId) {
        await botEdit(regChannelId, existingMsgId, entryText);
        _registryMsgIdCache.set(profile.username, existingMsgId);
    } else {
        const msg = await botPost(regChannelId, entryText);
        _registryMsgIdCache.set(profile.username, msg.data.id);
    }
}

// Shared helper: post a message to a channel via Bot token
async function botPost(channelId, content) {
    return axios.post(
        `${DISCORD_API}/channels/${channelId}/messages`,
        { content: content.slice(0, 1990) },
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );
}

// Shared helper: edit an existing message
async function botEdit(channelId, messageId, content) {
    return axios.patch(
        `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
        { content: content.slice(0, 1990) },
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    );
}

// Shared helper: pin a message
async function botPin(channelId, messageId) {
    return axios.put(
        `${DISCORD_API}/channels/${channelId}/pins/${messageId}`,
        {},
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
    ).catch(() => {});
}

// Get or create the tournament index channel (cached)
async function getOrCreateTournamentIndexChannel() {
    const cacheKey = 'tournament-index';
    if (TOURNAMENT_INDEX_CHANNEL_ID) {
        _channelCache.set(cacheKey, TOURNAMENT_INDEX_CHANNEL_ID);
        return TOURNAMENT_INDEX_CHANNEL_ID;
    }
    if (_channelCache.has(cacheKey)) return _channelCache.get(cacheKey);
    if (!GUILD_ID) return null;
    try {
        const resp = await axios.get(`${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        const existing = resp.data.find(c => c.name === cacheKey && c.type === 0);
        if (existing) { _channelCache.set(cacheKey, existing.id); return existing.id; }
        const body = { name: cacheKey, type: 0, topic: 'History of every Fling tournament — auto-updated' };
        if (DATA_CATEGORY_ID) body.parent_id = DATA_CATEGORY_ID;
        const created = await axios.post(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, body,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
        _channelCache.set(cacheKey, created.data.id);
        return created.data.id;
    } catch (e) {
        console.error('Could not get/create tournament-index channel:', e.message);
        return null;
    }
}

// Create a new dedicated channel for this tournament run
async function createTournamentChannel(tournamentId, playerCount) {
    if (!GUILD_ID) return null;
    // Discord channel names: lowercase, max 100 chars, no spaces
    const name = `t-${tournamentId}`.slice(0, 100);
    try {
        const body = {
            name,
            type: 0,
            topic: `Tournament ${tournamentId} — ${playerCount} players — Started ${new Date().toLocaleDateString()}`
        };
        if (DATA_CATEGORY_ID) body.parent_id = DATA_CATEGORY_ID;
        const created = await axios.post(`${DISCORD_API}/guilds/${GUILD_ID}/channels`, body,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
        return created.data.id;
    } catch (e) {
        console.error('Could not create tournament channel:', e.message);
        return null;
    }
}

// Resolve a team member entry to a display name (handles both raw ID string and object)
function resolveMemberName(m, players) {
    const id = typeof m === 'string' ? m : (m.playerId || m.id);
    const p = players.find(pl => pl.id === id || (typeof m !== 'string' && pl.username === m.username));
    if (p) return p.username + (p.isBot ? ' 🤖' : '');
    return typeof m === 'string' ? m : (m.username || String(m));
}

// Parse round number from a match ID like 'left-r2-0' → 2, fallback to 1
function parseRoundFromMatchId(matchId) {
    const m = matchId.match(/-r(\d+)-/);
    return m ? parseInt(m[1]) : 1;
}

// Build a human-readable bracket state snapshot (may be >1990 chars — caller uses botPostChunked)
function buildBracketSnapshot(data) {
    const players  = data.players  || [];
    const teams    = data.teams    || [];
    const bracket  = data.bracket  || {};
    const matchStates = bracket.matchStates || {};
    const champion    = bracket.champion;
    const ts = new Date().toLocaleString('en-GB');

    const lines = [];
    lines.push(`${STATE_MSG_PREFIX}`);
    lines.push(`## 🏆 Tournament Live State`);
    lines.push(`_Updated: ${ts}_`);
    lines.push(``);

    if (champion) {
        lines.push(`### 🥇 CHAMPION: **${champion}** 🎉🎊`);
        lines.push(``);
    }

    // Participants
    const joined     = players.filter(p => p.joined);
    const soloJoined = joined.filter(p => !p.teamId);
    const teamList   = teams.filter(t => t.members && t.members.length > 0);
    lines.push(`### 👥 Participants (${joined.length} players, ${teamList.length} teams)`);
    if (soloJoined.length) {
        lines.push(`**Solo:** ${soloJoined.map(p => p.username + (p.isBot ? ' 🤖' : '')).join('  •  ')}`);
    }
    if (teamList.length) {
        lines.push(`**Teams:**`);
        teamList.forEach(t => {
            const members = (t.members || []).map(m => resolveMemberName(m, players)).join(' & ');
            lines.push(`  • **${t.name}** — ${members}`);
        });
    }

    // Bracket matches grouped by round — use ID-parsed round since ms.round may be undefined
    const matchIds = Object.keys(matchStates);
    if (matchIds.length) {
        lines.push(``);
        lines.push(`### ⚔️ Bracket Matches`);
        const byRound = {};
        matchIds.forEach(id => {
            const ms = matchStates[id];
            const round = ms.round ?? parseRoundFromMatchId(id);
            if (!byRound[round]) byRound[round] = [];
            byRound[round].push({ id, ms });
        });
        Object.keys(byRound).sort((a, b) => Number(a) - Number(b)).forEach(round => {
            lines.push(`**Round ${round}:**`);
            byRound[round].forEach(({ id, ms }) => {
                const p0 = ms.participants?.[0] || '?';
                const p1 = ms.participants?.[1] || '?';
                const side = id.startsWith('left') ? '[L]' : id.startsWith('right') ? '[R]' : '';

                let resultLine;
                if (ms.overallWinner === 0 || ms.winner === 0)      resultLine = `✅ **${p0}** wins`;
                else if (ms.overallWinner === 1 || ms.winner === 1) resultLine = `✅ **${p1}** wins`;
                else                                                  resultLine = `🔲 Pending`;

                lines.push(`  ${side} ${p0} vs ${p1} — ${resultLine}`);

                // Per-fight sub-match scores
                if (ms.subMatches && ms.subMatches.length > 0) {
                    ms.subMatches.forEach((sm, i) => {
                        if ((sm.player1Score || sm.player2Score) || (sm.winner !== null && sm.winner !== undefined)) {
                            const w = sm.winner === 0 ? sm.player1 : sm.winner === 1 ? sm.player2 : null;
                            const scoreStr = `${sm.player1Score ?? 0}-${sm.player2Score ?? 0}`;
                            lines.push(`      Fight ${i + 1}: ${sm.player1} ${scoreStr} ${sm.player2}${w ? ` → **${w}**` : ''}`);
                        }
                    });
                }
            });
        });
    }

    // Playoffs
    const ps = bracket.playoffState || {};
    const playoffLines = [];
    if (ps.left && ps.left.opponents) {
        playoffLines.push(`  **Left playoff:** ${ps.left.opponents[0]} vs ${ps.left.opponents[1]}`);
    }
    if (ps.right && ps.right.opponents) {
        playoffLines.push(`  **Right playoff:** ${ps.right.opponents[0]} vs ${ps.right.opponents[1]}`);
    }
    if (playoffLines.length) {
        lines.push(``);
        lines.push(`### 🔥 Playoffs`);
        playoffLines.forEach(l => lines.push(l));
    }

    // Losers pool summary
    const lp = bracket.losersPool || {};
    const lpLines = [];
    ['left', 'right'].forEach(side => {
        const rounds = lp[side] || {};
        Object.keys(rounds).forEach(r => {
            const names = rounds[r];
            if (names && names.length) lpLines.push(`  ${side[0].toUpperCase()} R${r}: ${names.join(', ')}`);
        });
    });
    if (lpLines.length) {
        lines.push(``);
        lines.push(`### 🟥 Losers Pool`);
        lpLines.forEach(l => lines.push(l));
    }

    return lines.join('\n');
}

// Update the pinned state message in the active tournament channel
async function updateTournamentStateMessage(data) {
    if (!activeTournamentChannelId) return;
    const snapshot = buildBracketSnapshot(data);
    const isLong = snapshot.length > 1990;
    try {
        if (activeTournamentStateMsgId && !isLong) {
            // Short enough to edit in-place — try to edit
            try {
                await botEdit(activeTournamentChannelId, activeTournamentStateMsgId, snapshot);
                return;
            } catch {
                // Message was deleted — fall through to repost
                activeTournamentStateMsgId = null;
            }
        }
        // Long snapshot or no existing message: post as chunks and pin the first
        if (activeTournamentStateMsgId) {
            // Delete old single-message pin before reposting multi-chunk
            await axios.delete(
                `${DISCORD_API}/channels/${activeTournamentChannelId}/messages/${activeTournamentStateMsgId}`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
            ).catch(() => {});
            activeTournamentStateMsgId = null;
        }
        const firstMsg = await botPostChunked(activeTournamentChannelId, snapshot);
        activeTournamentStateMsgId = firstMsg?.data?.id || null;
        if (activeTournamentStateMsgId) await botPin(activeTournamentChannelId, activeTournamentStateMsgId);
    } catch (e) {
        console.error('Could not update tournament state message:', e.message);
    }
}

// Fetch tournament data from Discord (reads JSON attachment from bot-data channel)
async function getTournamentData() {
    if (!CHANNEL_ID) return null;
    try {
        const response = await axios.get(
            `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=50`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        const dataMessage = response.data.find(msg =>
            msg.content && msg.content.startsWith(DATA_MESSAGE_CONTENT) && msg.author.bot
        );
        if (dataMessage && dataMessage.attachments.length > 0) {
            const dl = await axios.get(dataMessage.attachments[0].url);
            return dl.data;
        }
        return null;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        return null;
    }
}

// Cached message ID for the tournament data message — avoids 50-msg fetch on every save
let _dataMsgIdCache = null;

// Save tournament data to Discord via bot — always stays in CHANNEL_ID
async function saveTournamentData(data) {
    if (!CHANNEL_ID || !BOT_TOKEN) return { success: false, byteSize: 0 };
    try {
        const byteSize = Buffer.byteLength(JSON.stringify(data), 'utf-8');

        if (_dataMsgIdCache) {
            // Try to edit the cached message directly — O(1), no channel scan
            try {
                await botEditFile(CHANNEL_ID, _dataMsgIdCache, DATA_MESSAGE_CONTENT, 'tournament_data.json', data);
                // botEditFile deletes + reposts, so the message ID changes — capture new ID
                // Re-fetch to get new ID after edit (botEditFile posts new message)
                const fetchResp = await axios.get(
                    `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=10`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
                );
                const fresh = fetchResp.data.find(m => m.content && m.content.startsWith(DATA_MESSAGE_CONTENT) && m.author.bot);
                if (fresh) _dataMsgIdCache = fresh.id;
                return { success: true, byteSize };
            } catch {
                _dataMsgIdCache = null; // stale — fall through to full scan
            }
        }

        // Full scan to find or create the data message
        const fetchResp = await axios.get(
            `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=50`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        const existing = fetchResp.data.find(msg =>
            msg.content && msg.content.startsWith(DATA_MESSAGE_CONTENT) && msg.author.bot
        );

        if (existing) {
            await botEditFile(CHANNEL_ID, existing.id, DATA_MESSAGE_CONTENT, 'tournament_data.json', data);
            // Capture new message ID after repost
            const r2 = await axios.get(`${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=10`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
            const fresh = r2.data.find(m => m.content && m.content.startsWith(DATA_MESSAGE_CONTENT) && m.author.bot);
            if (fresh) _dataMsgIdCache = fresh.id;
        } else {
            const newMsg = await botPostFile(CHANNEL_ID, DATA_MESSAGE_CONTENT, 'tournament_data.json', data);
            _dataMsgIdCache = newMsg?.data?.id || null;
        }

        return { success: true, byteSize };
    } catch (error) {
        console.error('Error saving data:', error.message);
        return { success: false, byteSize: 0 };
    }
}


// Default tournament state
const defaultGameState = {
    players: [],
    teams: [],
    invitations: [],
    matches: [],
    tournamentStarted: false,
    bracket: {
        left: [],
        right: [],
        matchStates: {},
        losersPool: { left: {}, right: {} },
        singlePlayerMatchRef: { left: {}, right: {} },
        playoffState: { left: null, right: null },
        champion: null
    }
};

// Routes
app.get('/api/data', async (req, res) => {
    const data = await getTournamentData();
    if (data) {
        res.json({ success: true, data });
    } else {
        res.json({ success: true, data: defaultGameState });
    }
});

// Lightweight public stats for the landing page (cached 30s to avoid hammering Discord)
let _landingStatsCache = null, _landingStatsCacheTs = 0;
app.get('/api/stats', async (req, res) => {
    if (_landingStatsCache && Date.now() - _landingStatsCacheTs < 30000) {
        return res.json(_landingStatsCache);
    }
    try {
        const data = (await getTournamentData()) || defaultGameState;
        const tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
        const completed = tournaments.filter(t => t && t.status === 'completed');

        // count decided matches across every tournament bracket
        let matches = 0;
        for (const t of tournaments) {
            const ms = t && t.bracketState && t.bracketState.matchStates;
            if (ms && typeof ms === 'object') {
                for (const k of Object.keys(ms)) {
                    const st = ms[k];
                    if (st && st.winner !== null && st.winner !== undefined && st.winner !== '') matches++;
                }
            }
        }

        // registered players = number of profile-* channels in the guild
        let players = (data.players || []).filter(p => p && !p.isBot).length;
        try {
            if (GUILD_ID && BOT_TOKEN) {
                const resp = await discordRequest('get',
                    `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
                const profileChannels = resp.data.filter(c =>
                    c.type === 0 && typeof c.name === 'string' && c.name.startsWith('profile-')).length;
                if (profileChannels > players) players = profileChannels;
            }
        } catch { /* fall back to roster count */ }

        // reigning champion: latest completed tournament, else current bracket champion
        const recent = completed.slice().sort((a, b) =>
            new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0))[0];
        const champion = (recent && recent.bracketState && recent.bracketState.champion) ||
            (data.bracket && data.bracket.champion) || null;

        const payload = { success: true, players, tournaments: tournaments.length, matches, champions: completed.length, champion };
        _landingStatsCache = payload;
        _landingStatsCacheTs = Date.now();
        res.json(payload);
    } catch (e) {
        res.json({ success: false, players: 0, tournaments: 0, matches: 0, champions: 0, champion: null });
    }
});

app.post('/api/data', async (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }
    const result = await saveTournamentData(data);
    // If a tournament is active, update the human-readable state card (non-blocking)
    if (data.tournamentStarted && activeTournamentChannelId) {
        updateTournamentStateMessage(data).catch(() => {});
    }
    if (result.success) {
        res.json({ success: true, message: 'Data saved to Discord', byteSize: result.byteSize });
    } else {
        res.status(500).json({ success: false, message: 'Failed to save data' });
    }
});

// Discord DB status
app.get('/api/db-status', async (req, res) => {
    if (!CHANNEL_ID) return res.json({ success: false, message: 'Channel not configured' });
    try {
        const response = await axios.get(
            `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=50`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        const dataMsg = response.data.find(msg =>
            msg.content && msg.content.startsWith(DATA_MESSAGE_CONTENT) && msg.author.bot
        );
        if (!dataMsg) return res.json({ success: true, found: false });
        const attachment = dataMsg.attachments?.[0];
        res.json({
            success: true,
            found: true,
            lastSaved: dataMsg.timestamp,
            byteSize: attachment ? attachment.size : null,
            messageId: dataMsg.id,
            channelId: CHANNEL_ID
        });
    } catch (error) {
        console.error('db-status error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send notification message to Discord results channel via bot (no webhook dependency)
app.post('/api/notify', async (req, res) => {
    const { type, username, teamName, players } = req.body;
    const ts = new Date().toLocaleString('en-GB');

    let message = '';
    switch (type) {
        case 'new_player':
            message = `🎮 **New Player Registered**\n👤 \`${username}\`\n📅 ${ts}`;
            break;
        case 'new_team': {
            const list = (players || []).map(p => `  • ${p.username}${p.isBot ? ' 🤖' : ''}`).join('\n');
            message = `👥 **New Team Created** — \`${teamName}\`\n${list}\n📅 ${ts}`;
            break;
        }
        case 'team_updated': {
            const list = (players || []).map(p => `  • ${p.username}${p.isBot ? ' 🤖' : ''}`).join('\n');
            message = `📝 **Team Updated** — \`${teamName}\`\n${list}\n📅 ${ts}`;
            break;
        }
        case 'player_left_team':
            message = `🚪 **Player Left Team** — \`${username}\` left \`${teamName}\`\n📅 ${ts}`;
            break;
        case 'player_joined':
            message = `✅ **Player Joined Tournament** — \`${username}\`\n📅 ${ts}`;
            break;
        case 'team_joined': {
            const list = (players || []).map(p => `  • ${p.username}${p.isBot ? ' 🤖' : ''}`).join('\n');
            message = `✅ **Team Joined Tournament** — \`${teamName}\`\n${list}\n📅 ${ts}`;
            break;
        }
        default:
            message = `📢 **Event: ${type}**\n${JSON.stringify(req.body).slice(0, 300)}`;
    }

    // Post to results channel via bot (no webhook needed)
    if (!RESULTS_CHANNEL_ID || !BOT_TOKEN) {
        return res.json({ success: true, message: 'Results channel not configured, notification skipped' });
    }
    try {
        await botPost(RESULTS_CHANNEL_ID, message);
        res.json({ success: true, message: 'Notification sent' });
    } catch (error) {
        console.error('Error sending notification:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper: delete ALL messages in a channel using bulk-delete (fast) with individual fallback
async function deleteAllMessagesInChannel(channelId) {
    let totalDeleted = 0;
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

    while (true) {
        // Fetch up to 100 messages
        const response = await axios.get(
            `${DISCORD_API}/channels/${channelId}/messages?limit=100`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        const messages = response.data;
        if (!messages || messages.length === 0) break;

        // Split into bulk-deletable (< 14 days) and old messages
        const bulkIds = [];
        const oldMessages = [];
        for (const msg of messages) {
            // Snowflake timestamp: top 42 bits are ms since Discord epoch (2015-01-01)
            const msgTimestamp = Number(BigInt(msg.id) >> BigInt(22)) + 1420070400000;
            if (msgTimestamp > fourteenDaysAgo) {
                bulkIds.push(msg.id);
            } else {
                oldMessages.push(msg.id);
            }
        }

        // Bulk delete new messages (2–100 at a time)
        if (bulkIds.length >= 2) {
            try {
                await axios.post(
                    `${DISCORD_API}/channels/${channelId}/messages/bulk-delete`,
                    { messages: bulkIds },
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
                totalDeleted += bulkIds.length;
            } catch (e) {
                console.error('Bulk delete failed:', e.response?.data || e.message);
                // Fall back to individual for this batch
                oldMessages.push(...bulkIds);
            }
            await new Promise(r => setTimeout(r, 1000)); // bulk-delete has a 1s ratelimit bucket
        } else if (bulkIds.length === 1) {
            oldMessages.push(...bulkIds); // single message — just delete individually
        }

        // Individual delete for old/fallback messages (600ms spacing to respect rate limits)
        for (const id of oldMessages) {
            try {
                await axios.delete(
                    `${DISCORD_API}/channels/${channelId}/messages/${id}`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
                );
                totalDeleted++;
            } catch (e) {
                console.error(`Failed to delete msg ${id}:`, e.response?.data || e.message);
            }
            await new Promise(r => setTimeout(r, 600));
        }

        if (messages.length < 100) break;
    }
    return totalDeleted;
}

// Helper: delete a list of channels by ID with rate-limit spacing
async function deleteChannels(channelIds) {
    let deleted = 0;
    for (const id of channelIds) {
        try {
            await axios.delete(`${DISCORD_API}/channels/${id}`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
            deleted++;
        } catch (e) {
            console.error(`Failed to delete channel ${id}:`, e.response?.data?.message || e.message);
        }
        await new Promise(r => setTimeout(r, 350));
    }
    return deleted;
}

// Flush all server-side in-memory state
function flushServerCaches() {
    _channelCache.clear();
    _registryMsgIdCache.clear();
    _profileMsgIdCache.clear();
    _dataMsgIdCache = null;
    activeTournamentChannelId = null;
    activeTournamentId = null;
    activeTournamentStateMsgId = null;
}

// GET /api/guild-channels — returns all channels for the frontend status display
app.get('/api/guild-channels', async (req, res) => {
    if (!GUILD_ID || !BOT_TOKEN) return res.json({ success: false, channels: [] });
    try {
        const resp = await axios.get(`${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        res.json({ success: true, channels: resp.data.map(c => ({ id: c.id, name: c.name, type: c.type })) });
    } catch (e) {
        res.json({ success: false, channels: [] });
    }
});

// POST /api/clear — full data wipe:
//   • Clears messages in data channel, results channel, player-registry, tournament-index
//   • Deletes all profile-* channels and t-* tournament channels
//   • Flushes all in-memory caches
app.post('/api/clear', async (req, res) => {
    if (!CHANNEL_ID) return res.status(400).json({ success: false, message: 'Channel not configured' });
    try {
        let msgsDeleted = 0;
        let channelsDeleted = 0;

        // 1. Wipe fixed message-only channels (keep channels themselves)
        msgsDeleted += await deleteAllMessagesInChannel(CHANNEL_ID);
        if (RESULTS_CHANNEL_ID) msgsDeleted += await deleteAllMessagesInChannel(RESULTS_CHANNEL_ID);

        if (GUILD_ID && BOT_TOKEN) {
            const guildResp = await axios.get(
                `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
            ).catch(() => ({ data: [] }));
            const allChannels = guildResp.data;

            // 2. Wipe player-registry and tournament-index messages (keep channels)
            for (const name of ['player-registry', 'tournament-index']) {
                const ch = allChannels.find(c => c.name === name && c.type === 0);
                if (ch) msgsDeleted += await deleteAllMessagesInChannel(ch.id);
            }

            // 3. Delete profile-* and t-* channels entirely
            const toDelete = allChannels
                .filter(c => c.type === 0 && c.name &&
                    (c.name.startsWith('profile-') || c.name.startsWith('t-')))
                .map(c => c.id);
            channelsDeleted += await deleteChannels(toDelete);
        }

        flushServerCaches();

        res.json({
            success: true,
            message: `Wiped ${msgsDeleted} messages and deleted ${channelsDeleted} channels`
        });
    } catch (error) {
        console.error('Error clearing Discord:', error.message);
        res.status(500).json({ success: false, message: 'Failed to clear: ' + error.message });
    }
});

// POST /api/nuke — TOTAL RESET: deletes every channel the bot created including index/registry/bot-data
app.post('/api/nuke', async (req, res) => {
    if (!GUILD_ID || !BOT_TOKEN) return res.status(400).json({ success: false, message: 'Guild not configured' });
    try {
        let msgsDeleted = 0;
        let channelsDeleted = 0;

        const guildResp = await axios.get(
            `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        ).catch(() => ({ data: [] }));
        const allChannels = guildResp.data;

        // Bot-managed channel name patterns
        const botChannelNames = new Set(['player-registry', 'tournament-index']);
        const botChannelPrefixes = ['profile-', 't-'];

        const toDeleteChannels = allChannels.filter(c =>
            c.type === 0 && c.name && (
                botChannelNames.has(c.name) ||
                botChannelPrefixes.some(p => c.name.startsWith(p))
            )
        );

        // Keep data/results channels but wipe their messages
        if (CHANNEL_ID) msgsDeleted += await deleteAllMessagesInChannel(CHANNEL_ID);
        if (RESULTS_CHANNEL_ID) msgsDeleted += await deleteAllMessagesInChannel(RESULTS_CHANNEL_ID);

        channelsDeleted += await deleteChannels(toDeleteChannels.map(c => c.id));

        flushServerCaches();

        res.json({
            success: true,
            message: `NUKE complete: ${msgsDeleted} messages wiped, ${channelsDeleted} channels deleted`
        });
    } catch (error) {
        console.error('Error nuking Discord:', error.message);
        res.status(500).json({ success: false, message: 'Nuke failed: ' + error.message });
    }
});

// Register a bot account — identical to /api/register but with a generated password and isBot flag
app.post('/api/bot-register', async (req, res) => {
    const { username, type, points, teamName, partner } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Username required' });
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'DISCORD_GUILD_ID not set' });

    try {
        // Don't overwrite if already exists
        const existing = await getProfile(username);
        if (existing) {
            return res.json({ success: true, profile: existing, alreadyExists: true });
        }

        // Generate a stable bot password: "bot_<username>" — owner can use this to log in as the bot
        const botPassword = `bot_${username}`;
        const bioLines = [`🤖 Bot account (${type || 'solo'})`];
        if (teamName) bioLines.push(`👥 Team: ${teamName}`);
        if (partner) bioLines.push(`🤝 Partner: ${partner}`);

        const profile = {
            id: 'p-' + simpleHash(username).slice(0, 12),
            username,
            passwordHash: simpleHash(botPassword),
            isBot: true,
            createdAt: new Date().toISOString(),
            bio: bioLines.join('\n'),
            stats: { wins: 0, losses: 0, tournamentsPlayed: 0, tournamentWins: 0, first: 0, second: 0, third: 0, elo: 1000 },
            privacy: { bio: 'public', stats: 'public', elo: 'public' }
        };

        const saved = await saveProfile(profile);
        if (!saved) return res.status(500).json({ success: false, message: 'Failed to save bot profile to Discord' });

        // Notify results channel — same as when a real player registers
        if (RESULTS_CHANNEL_ID && BOT_TOKEN) {
            const ts = new Date().toLocaleString('en-GB');
            const teamNote = teamName ? ` | 👥 Team: \`${teamName}\`` : '';
            botPost(RESULTS_CHANNEL_ID,
                `🤖 **Bot Account Created**\n👤 \`${username}\`${teamNote}\n🔑 Login: \`bot_${username}\`\n📅 ${ts}`
            ).catch(() => {});
        }

        const { passwordHash, _channelId, _messageId, ...publicProfile } = profile;
        res.json({ success: true, profile: { ...publicProfile, generatedPassword: botPassword } });
    } catch (error) {
        console.error('Error registering bot:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Tournament lifecycle: start
app.post('/api/tournament/start', async (req, res) => {
    const { playerCount, players, teams } = req.body;
    try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const rand = Math.floor(Math.random() * 900) + 100;
        const tournamentId = `${dateStr}-${rand}`;

        // Create a dedicated channel for this tournament run
        const channelId = await createTournamentChannel(tournamentId, playerCount || 0);
        activeTournamentChannelId = channelId;
        activeTournamentId = tournamentId;
        activeTournamentStateMsgId = null;

        if (channelId) {
            // Build the opening roster message
            const soloPlayers = (players || []).filter(p => !p.teamId);
            const teamList = (teams || []).slice(0, 20);
            const lines = [
                `# 🏆 Tournament \`${tournamentId}\``,
                `📅 **Started:** ${new Date().toLocaleString()}`,
                `👥 **Total participants:** ${playerCount || 0}`,
                ``,
            ];
            if (teamList.length) {
                lines.push(`**Teams (${teamList.length}):**`);
                teamList.forEach(t => {
                    const memberNames = (t.members || []).map(m => {
                        const id = typeof m === 'string' ? m : (m.playerId || m.id);
                        const p = (players || []).find(pl => pl.id === id || (typeof m !== 'string' && pl.username === m.username));
                        return p ? p.username + (p.isBot ? ' 🤖' : '') : (typeof m === 'string' ? m : (m.username || String(m)));
                    }).join(' & ');
                    lines.push(`  • **${t.name}** — ${memberNames}`);
                });
                lines.push(``);
            }
            if (soloPlayers.length) {
                lines.push(`**Solo players (${soloPlayers.length}):**`);
                soloPlayers.slice(0, 30).forEach(p => {
                    lines.push(`  • ${p.username}${p.isBot ? ' 🤖' : ''}`);
                });
                lines.push(``);
            }
            lines.push(`_Match results and live bracket will appear below._`);

            const rosterMsg = await botPost(channelId, lines.join('\n'));
            await botPin(channelId, rosterMsg.data.id);
        }

        // Log to tournament-index channel
        const indexChannelId = await getOrCreateTournamentIndexChannel();
        if (indexChannelId) {
            await botPost(indexChannelId,
                `▶️ **Tournament \`${tournamentId}\` started** — ${playerCount || 0} participants — ${new Date().toLocaleString()}${channelId ? ` — <#${channelId}>` : ''}`
            ).catch(() => {});
        }

        // Increment tournamentsPlayed for every joined participant (non-blocking)
        const joinedPlayers = (players || []).filter(p => p.joined);
        Promise.all(joinedPlayers.map(async p => {
            try {
                const profile = await getProfile(p.username);
                if (!profile) return;
                profile.stats = profile.stats || {};
                profile.stats.tournamentsPlayed = (profile.stats.tournamentsPlayed || 0) + 1;
                await saveProfile(profile);
            } catch {}
        })).catch(() => {});

        res.json({ success: true, tournamentId, channelId });
    } catch (error) {
        console.error('Error starting tournament:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Tournament lifecycle: end
app.post('/api/tournament/end', async (req, res) => {
    const { champion, tournamentId } = req.body;
    try {
        const tid = tournamentId || activeTournamentId || '?';
        if (activeTournamentChannelId) {
            await botPost(activeTournamentChannelId,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎉  **TOURNAMENT OVER**\n🏆  Champion: **${champion || 'Unknown'}**\n📅  Ended: ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ).catch(() => {});
        }
        const indexChannelId = await getOrCreateTournamentIndexChannel();
        if (indexChannelId) {
            await botPost(indexChannelId,
                `⏹️ **Tournament \`${tid}\` ended** — 🏆 Champion: **${champion || '?'}** — ${new Date().toLocaleString()}`
            ).catch(() => {});
        }
        activeTournamentChannelId = null;
        activeTournamentId = null;
        activeTournamentStateMsgId = null;
        res.json({ success: true });
    } catch (error) {
        console.error('Error ending tournament:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send match result to results channel AND active tournament channel
app.post('/api/match-result', async (req, res) => {
    try {
        const { winner, loser, winnerScore, loserScore, matchType, teamName } = req.body;

        if (!winner || !loser) {
            return res.status(400).json({ success: false, message: 'winner and loser are required' });
        }

        const timestamp = new Date().toLocaleString();
        const wScore = winnerScore ?? '?';
        const lScore = loserScore ?? '?';
        let message;
        if (matchType === 'team_vs_team') {
            message = `⚔️ **Match Result** ${teamName ? `— ${teamName}` : ''}\n✅ Winner: **${winner}** (${wScore} kills)\n❌ Loser: ${loser} (${lScore} kills)\n🕐 ${timestamp}`;
        } else {
            message = `⚔️ **Match Result**\n✅ Winner: **${winner}** (${wScore} kills)\n❌ Loser: ${loser} (${lScore} kills)\n🕐 ${timestamp}`;
        }

        const postTo = new Set();
        if (RESULTS_CHANNEL_ID) postTo.add(RESULTS_CHANNEL_ID);
        if (activeTournamentChannelId) postTo.add(activeTournamentChannelId);

        for (const channelId of postTo) {
            await botPost(channelId, message)
                .catch(e => console.error(`Failed to post match result to ${channelId}:`, e.message));
        }

        // Also post to each participant's own channel (only if they have a real profile)
        const ts2 = new Date().toLocaleString('en-GB');
        const postToPlayerChannel = async (name, msgText) => {
            const profile = await getProfile(name).catch(() => null);
            if (!profile) return; // skip teams / deleted accounts
            const chId = await getOrCreatePlayerChannel(name).catch(() => null);
            if (chId) await botPost(chId, msgText).catch(() => {});
        };
        await postToPlayerChannel(winner, `🏆 **Match Won**\n  • vs: **${loser}**\n  • Score: ${wScore} - ${lScore}\n🕐 ${ts2}`);
        await postToPlayerChannel(loser, `💀 **Match Lost**\n  • vs: **${winner}**\n  • Score: ${lScore} - ${wScore}\n🕐 ${ts2}`);

        res.json({ success: true, message: 'Match result sent' });
    } catch (error) {
        console.error('Error sending match result:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send match result' });
    }
});

// Post a log event to a player's own profile channel
app.post('/api/player-log', async (req, res) => {
    const { username, event, details } = req.body;
    if (!username || !event) return res.status(400).json({ success: false, message: 'username and event required' });
    if (!GUILD_ID || !BOT_TOKEN) return res.json({ success: true }); // silently skip if Discord not configured
    try {
        // Verify a profile actually exists for this user before trying to get/create channel
        const profile = await getProfile(username).catch(() => null);
        if (!profile) return res.json({ success: true }); // no profile = no channel, skip silently
        const channelId = await getOrCreatePlayerChannel(username);
        if (!channelId) return res.json({ success: true }); // can't get channel, skip silently
        const ts = new Date().toLocaleString('en-GB');
        const detailLines = details ? Object.entries(details).map(([k, v]) => `  • **${k}:** ${v}`).join('\n') : '';
        const msg = `📝 **${event}**${detailLines ? '\n' + detailLines : ''}\n🕐 ${ts}`;
        await botPost(channelId, msg);
        res.json({ success: true });
    } catch (error) {
        console.error('Error posting player log:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Clear results channel only
app.post('/api/clear-results', async (req, res) => {
    if (!RESULTS_CHANNEL_ID) {
        return res.status(400).json({ success: false, message: 'Results channel not configured' });
    }
    try {
        const total = await deleteAllMessagesInChannel(RESULTS_CHANNEL_ID);
        res.json({ success: true, message: `Cleared ${total} messages from results channel` });
    } catch (error) {
        console.error('Error clearing results channel:', error.message);
        res.status(500).json({ success: false, message: 'Failed to clear results channel: ' + error.message });
    }
});

async function getCachedGuildChannels() {
    const now = Date.now();
    if (_guildChannelCache && (now - _guildChannelCacheTs) < GUILD_CHANNEL_CACHE_TTL) {
        return _guildChannelCache;
    }
    const resp = await discordRequest('get', `${DISCORD_API}/guilds/${GUILD_ID}/channels`,
        { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
    // Warm up _channelCache with all channel IDs while we have the data
    resp.data.forEach(c => { if (c.type === 0 && c.name) _channelCache.set(c.name, c.id); });
    _guildChannelCache = new Set(resp.data.map(c => c.name));
    _guildChannelCacheTs = now;
    return _guildChannelCache;
}

// Invalidate cache when a new channel is created (called after saveProfile)
function invalidateGuildChannelCache() {
    _guildChannelCache = null;
    _guildChannelCacheTs = 0;
}

// Check which usernames from a given list have NO Discord profile channel yet
// Used by the frontend background sync loop
app.post('/api/profile/check-missing', async (req, res) => {
    const { usernames } = req.body;
    if (!Array.isArray(usernames)) return res.status(400).json({ success: false, message: 'usernames array required' });
    if (!GUILD_ID || !BOT_TOKEN) return res.json({ success: true, missing: [] }); // skip if not configured
    try {
        const existingNames = await getCachedGuildChannels();
        const missing = usernames.filter(u => {
            const channelName = `profile-${u.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
            return !existingNames.has(channelName);
        });
        res.json({ success: true, missing });
    } catch (e) {
        console.error('check-missing error:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Ensure a player profile exists in Discord — creates channel + profile data if missing
// Used by the frontend background sync retry loop
app.post('/api/profile/ensure', async (req, res) => {
    const { username, passwordHash, stats, bio, privacy, createdAt, isBot, id } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'username required' });
    if (!GUILD_ID || !BOT_TOKEN) return res.json({ success: true, created: false, reason: 'discord not configured' });
    try {
        const existing = await getProfile(username);
        if (existing) return res.json({ success: true, created: false, reason: 'already exists' });

        // For bots: use deterministic hash. For real players with no hash: mark as pending re-register
        // (they will fix the hash when they next register or log in)
        const resolvedHash = passwordHash || (isBot ? simpleHash('bot_' + username) : 'PENDING_REREGISTER');
        const profile = {
            id: id || ('p-' + simpleHash(username).slice(0, 12)),
            username,
            passwordHash: resolvedHash,
            createdAt: createdAt || new Date().toISOString(),
            bio: bio || '',
            isBot: isBot || false,
            needsReRegister: !isBot && !passwordHash, // flag so login can detect this
            stats: stats || { wins: 0, losses: 0, tournamentsPlayed: 0, tournamentWins: 0, first: 0, second: 0, third: 0, elo: 1000 },
            privacy: privacy || { bio: 'public', stats: 'public', elo: 'public' }
        };
        const saved = await saveProfile(profile);
        res.json({ success: saved, created: saved });
    } catch (e) {
        console.error('profile/ensure error for', username, e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Register new player account
app.post('/api/register', async (req, res) => {
    const { username, password, robloxUsername } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    if (cleanUsername.length > 32) return res.status(400).json({ success: false, message: 'Username must be 32 characters or less' });
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(cleanUsername)) return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, underscores, hyphens, and dots' });
    if (password.length < 4) return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'DISCORD_GUILD_ID not set in .env — contact the admin' });

    // Check if username is already taken (channel already exists)
    const existing = await getProfile(cleanUsername);
    if (existing) {
        // If profile was pre-created by sync loop without a real password, allow re-registration to set it
        if (existing.needsReRegister && existing.passwordHash === 'PENDING_REREGISTER') {
            existing.passwordHash = simpleHash(password);
            existing.needsReRegister = false;
            const { _channelId, _messageId, ...toSave } = existing;
            const saved = await saveProfile(toSave);
            if (!saved) return res.status(500).json({ success: false, message: 'Failed to update profile' });
            const { passwordHash, ...publicProfile } = toSave;
            return res.json({ success: true, profile: publicProfile });
        }
        return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    const cleanRoblox = (robloxUsername || '').trim().slice(0, 50).replace(/[^a-zA-Z0-9_]/g, '');
    const profile = {
        id: 'p-' + simpleHash(cleanUsername).slice(0, 12),
        username: cleanUsername,
        passwordHash: simpleHash(password),
        createdAt: new Date().toISOString(),
        bio: '',
        robloxUsername: cleanRoblox,
        links: {},
        stats: { wins: 0, losses: 0, tournamentsPlayed: 0, tournamentWins: 0, first: 0, second: 0, third: 0, elo: 1000 },
        privacy: { bio: 'public', stats: 'public', elo: 'public' }
    };

    const saved = await saveProfile(profile);
    if (!saved) return res.status(500).json({ success: false, message: 'Failed to save profile to Discord' });

    const { passwordHash, _channelId, _messageId, ...publicProfile } = profile;
    res.json({ success: true, profile: publicProfile });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'DISCORD_GUILD_ID not set in .env' });

    const profile = await getProfile(username.trim());
    if (!profile) return res.status(401).json({ success: false, message: 'Username not found' });
    // Profile was created by sync loop without a real password — let user set it now
    if (profile.needsReRegister && profile.passwordHash === 'PENDING_REREGISTER') {
        profile.passwordHash = simpleHash(password);
        profile.needsReRegister = false;
        const { _channelId, _messageId, ...toSave } = profile;
        await saveProfile(toSave).catch(() => {});
    }
    if (profile.passwordHash !== simpleHash(password)) return res.status(401).json({ success: false, message: 'Incorrect password' });

    // Backfill id for profiles saved before the id field was added
    if (!profile.id) {
        profile.id = 'p-' + simpleHash(profile.username).slice(0, 12);
        const { _channelId, _messageId, ...toSave } = profile;
        saveProfile(toSave).catch(() => {}); // non-blocking backfill
    }

    const { passwordHash, _channelId, _messageId, ...publicProfile } = profile;
    res.json({ success: true, profile: publicProfile });
});

// Get a player profile by username
app.get('/api/profile/:username', async (req, res) => {
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'DISCORD_GUILD_ID not set in .env' });
    const profile = await getProfile(req.params.username);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    const { passwordHash, _channelId, _messageId, ...safe } = profile;
    res.json({ success: true, profile: safe });
});

// Update own profile (bio, privacy settings)
app.post('/api/profile/update', async (req, res) => {
    const { username, password, bio, privacy, robloxUsername, links } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Auth required' });
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'DISCORD_GUILD_ID not set in .env' });

    const profile = await getProfile(username);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    if (profile.passwordHash !== simpleHash(password)) return res.status(401).json({ success: false, message: 'Incorrect password' });

    if (bio !== undefined) profile.bio = bio.slice(0, 500);
    if (privacy) profile.privacy = { ...profile.privacy, ...privacy };
    if (robloxUsername !== undefined) profile.robloxUsername = robloxUsername.slice(0, 50).replace(/[^a-zA-Z0-9_]/g, '');
    if (links !== undefined && typeof links === 'object') {
        const allowed = ['roblox', 'youtube', 'twitch', 'twitter', 'discord'];
        profile.links = {};
        for (const k of allowed) {
            if (links[k] && typeof links[k] === 'string') profile.links[k] = links[k].slice(0, 200);
        }
    }

    const { _channelId, _messageId, ...toSave } = profile;
    await saveProfile(toSave);
    const { passwordHash, ...publicProfile } = toSave;
    res.json({ success: true, profile: publicProfile });
});

// Points awarded per round (round 1 = index 0)
const ROUND_POINTS = [5, 10, 18, 28, 40, 55, 70];
function getRoundPoints(roundNum) {
    const idx = Math.max(0, (roundNum || 1) - 1);
    return ROUND_POINTS[Math.min(idx, ROUND_POINTS.length - 1)];
}

// Update player stats (called internally after match)
app.post('/api/stats/update', async (req, res) => {
    const { username, statUpdates, roundNum, opponentElo } = req.body;
    if (!username || !statUpdates) return res.status(400).json({ success: false, message: 'Missing data' });
    if (!GUILD_ID) return res.json({ success: true }); // silently skip if not configured

    const profile = await getProfile(username);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });

    // Apply stat updates (whitelist keys to prevent injection)
    const ALLOWED_STAT_KEYS = new Set(['wins', 'losses', 'tournamentsPlayed', 'tournamentWins', 'first', 'second', 'third']);
    for (const [key, value] of Object.entries(statUpdates)) {
        if (ALLOWED_STAT_KEYS.has(key) && typeof value === 'number') {
            profile.stats[key] = (profile.stats[key] || 0) + value;
        }
    }

    // Award points for wins — scaled by round, reduced if beating a much weaker opponent
    if (statUpdates.wins) {
        let pts = getRoundPoints(roundNum || 1);
        // If opponent ELO is known and significantly lower, reduce points
        const myElo = profile.stats.elo || 0;
        const oppElo = typeof opponentElo === 'number' ? opponentElo : myElo;
        const eloDiff = myElo - oppElo; // positive = I am stronger
        if (eloDiff > 50) {
            // Scale down: the bigger the advantage, the fewer points (min 40% of base)
            const reduction = Math.min(0.6, eloDiff / 500);
            pts = Math.max(1, Math.round(pts * (1 - reduction)));
        }
        profile.stats.points = (profile.stats.points || 0) + pts;
    }

    // Recalculate ELO: points × win rate (0 base, grows with consistent wins AND tournament depth)
    const { wins, losses } = profile.stats;
    const total = wins + losses;
    const winRate = total > 0 ? wins / total : 0;
    const pts = profile.stats.points || 0;
    // ELO = points × (2 × winRate)  so 100% winrate doubles points value, 50% winrate keeps it, 0% → 0
    profile.stats.elo = Math.round(pts * Math.max(0, winRate * 2));

    const { _channelId, _messageId, ...toSave } = profile;
    await saveProfile(toSave);
    res.json({ success: true });
});

// ---------- Roblox 3D avatar proxy ----------
// Convert Roblox thumbnail hash to CDN URL (tN.rbxcdn.com)
function robloxCdnUrl(hash) {
    let i = 31;
    for (let t = 0; t < 38; t++) i ^= hash.charCodeAt(t);
    return `https://t${(i % 8).toString()}.rbxcdn.com/${hash}`;
}

app.get('/api/roblox-avatar/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || userId <= 0) return res.status(400).json({ success: false, message: 'Invalid userId' });

    try {
        // 1. Get the avatar-3d thumbnail info
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`, {
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        });
        const thumbData = thumbRes.data.data && thumbRes.data.data[0] ? thumbRes.data.data[0] : thumbRes.data;
        if (!thumbData || thumbData.state !== 'Completed' || !thumbData.imageUrl) {
            return res.status(404).json({ success: false, message: 'Avatar 3D thumbnail not ready', state: thumbData && thumbData.state });
        }

        // 2. Fetch the metadata JSON at imageUrl
        const metaRes = await axios.get(thumbData.imageUrl, { timeout: 10000 });
        const meta = metaRes.data;
        if (!meta || !meta.obj) {
            return res.status(404).json({ success: false, message: 'Avatar model metadata missing' });
        }

        // 3. Build CDN URLs
        const result = {
            success: true,
            userId,
            state: thumbData.state,
            objUrl: robloxCdnUrl(meta.obj),
            mtlUrl: meta.mtl ? robloxCdnUrl(meta.mtl) : null,
            textureUrls: (meta.textures || []).map(robloxCdnUrl),
            camera: meta.camera,
            aabb: meta.aabb
        };
        res.json(result);
    } catch (err) {
        console.error('[roblox-avatar] error', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete a player account — removes their profile channel and registry entry
app.post('/api/account/delete', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'username and password required' });
    if (!GUILD_ID) return res.status(500).json({ success: false, message: 'Discord not configured' });
    try {
        const profile = await getProfile(username);
        if (!profile) return res.status(404).json({ success: false, message: 'Account not found' });
        if (profile.passwordHash !== simpleHash(password)) return res.status(401).json({ success: false, message: 'Incorrect password' });

        const channelName = `profile-${username.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
        const channelId = profile._channelId || _channelCache.get(channelName) || null;

        // Delete the profile channel entirely (all messages + channel)
        if (channelId) {
            await axios.delete(`${DISCORD_API}/channels/${channelId}`,
                { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
            ).catch(e => console.error('Could not delete profile channel:', e.message));
        }

        // Remove registry entry for this player (delete the message)
        const regChannelId = await getOrCreateRegistryChannel().catch(() => null);
        if (regChannelId) {
            const markerForUser = `${REGISTRY_MARKER}:${username}`;
            const existingMsgId = _registryMsgIdCache.get(username);
            if (existingMsgId) {
                await axios.delete(`${DISCORD_API}/channels/${regChannelId}/messages/${existingMsgId}`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
                ).catch(() => {});
            } else {
                // scan for it
                const resp = await axios.get(`${DISCORD_API}/channels/${regChannelId}/messages?limit=100`,
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }).catch(() => ({ data: [] }));
                const found = resp.data.find(m => m.content && m.content.startsWith(markerForUser));
                if (found) {
                    await axios.delete(`${DISCORD_API}/channels/${regChannelId}/messages/${found.id}`,
                        { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
                    ).catch(() => {});
                }
            }
        }

        // Flush server-side caches for this player
        _channelCache.delete(channelName);
        _profileMsgIdCache.delete(username);
        _registryMsgIdCache.delete(username);

        res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
        console.error('Error deleting account:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// On startup: restore active tournament channel if a tournament was running
async function recoverActiveTournamentChannel() {
    if (!GUILD_ID || !BOT_TOKEN) return;
    try {
        // Check if a tournament is currently active in saved data
        const savedData = await getTournamentData();
        if (!savedData || !savedData.tournamentStarted) return;

        // Find the most recently created t-* channel (no category filter — works even without DATA_CATEGORY_ID)
        const resp = await axios.get(`${DISCORD_API}/guilds/${GUILD_ID}/channels`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        const tChannels = resp.data
            .filter(c => c.type === 0 && c.name && c.name.startsWith('t-') &&
                (!DATA_CATEGORY_ID || c.parent_id === DATA_CATEGORY_ID))
            .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

        if (!tChannels.length) return;
        const ch = tChannels[0];
        activeTournamentChannelId = ch.id;
        activeTournamentId = ch.name.replace(/^t-/, '');

        // Try to find existing state message in that channel
        const msgs = await axios.get(`${DISCORD_API}/channels/${ch.id}/messages?limit=50`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } });
        const stateMsg = msgs.data.find(m => m.content && m.content.startsWith(STATE_MSG_PREFIX) && m.author.bot);
        if (stateMsg) activeTournamentStateMsgId = stateMsg.id;

        console.log(`Recovered active tournament channel: #${ch.name} (${ch.id}), stateMsgId: ${activeTournamentStateMsgId || 'none'}`);
    } catch (e) {
        console.error('Could not recover active tournament channel:', e.message);
    }
}

app.listen(PORT, async () => {
    console.log(`Fling Tournament Backend running on port ${PORT}`);
    console.log(`Raw data channel : ${CHANNEL_ID}`);
    console.log(`Results channel  : ${RESULTS_CHANNEL_ID || 'not set'}`);
    console.log(`Data category    : ${DATA_CATEGORY_ID || 'not set'}`);
    console.log(`Profiles category: ${PROFILES_CATEGORY_ID || 'not set'}`);
    await recoverActiveTournamentChannel();
});

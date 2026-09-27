// The Discord rebuild + database mirror, run against an in-memory fake Discord.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMockDiscord } = require('./mock-discord');

const mock = createMockDiscord();
let mockServer, server, base;

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) + hash) + str.charCodeAt(i); hash = hash & hash; }
    return Math.abs(hash).toString(36);
}

function client() {
    let cookie = '';
    return async (method, url, body) => {
        const res = await fetch(base + url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ftap', ...(cookie ? { cookie } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const sc = res.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0];
        return { status: res.status, body: await res.json().catch(() => null) };
    };
}

let db, discord;
test.before(async () => {
    mockServer = mock.app.listen(0);
    await new Promise(r => mockServer.once('listening', r));
    const mockBase = `http://127.0.0.1:${mockServer.address().port}`;
    mock.setBase(mockBase);
    Object.assign(process.env, {
        DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ftap-dsync-')),
        DISCORD_API_BASE: mockBase,
        DISCORD_BOT_TOKEN: 'test-token',
        DISCORD_GUILD_ID: mock.guildId,
        OWNER_USERNAME: 'boss',
        REGISTER_LIMIT_PER_HOUR: '1000',
    });
    delete process.env.DISCORD_BACKUP_CHANNEL_ID;
    delete process.env.DISCORD_CHANNEL_ID;

    // What the old site left behind: a channel per player, tournament channels, a chat channel.
    const cat = mock.addChannel({ name: 'Profiles', type: 4 });
    const old = mock.addChannel({ name: 'profile-oldtimer', parent_id: cat.id });
    mock.addMessage(old.id, {
        content: '🗄️ PROFILE_DATA_V2',
        file: { name: 'profile.json', body: Buffer.from(JSON.stringify({ username: 'OldTimer', passwordHash: djb2('secret1'), stats: { wins: 7, losses: 2, tournamentWins: 1 }, bio: 'been here since day one' })) },
    });
    mock.addChannel({ name: 'general' });
    mock.addChannel({ name: 't-2025-01-01-123', parent_id: cat.id });
    mock.addChannel({ name: 'player-registry' });

    db = require('../server/db');
    discord = require('../server/discord');
    db.load();
    server = require('../server/index').createApp().listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); mockServer.close(); });

async function waitForJob() {
    for (let i = 0; i < 400; i++) {
        if (!discord._job.running) return;
        await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('rebuild did not finish');
}

test('owner rebuilds the Discord server into a clean database', async () => {
    const boss = client();
    const r0 = await boss('POST', '/api/auth/register', { username: 'boss', password: 'hunter22' });
    assert.strictEqual(r0.body.user.role, 'owner');
    const a = client(), b = client();
    await a('POST', '/api/auth/register', { username: 'flingA', password: 'hunter22' });
    await b('POST', '/api/auth/register', { username: 'flingB', password: 'hunter22' });

    // Play one match so there's something to archive.
    let r = await boss('POST', '/api/tournaments', { name: 'Archive Cup', mode: 'solo', maxEntrants: 4, startAt: new Date(Date.now() + 3600e3).toISOString(), publish: true, settings: { checkinMinutes: 0, bestOf: 3, finalBestOf: 3 } });
    const tid = r.body.tournament.id;
    await a('POST', `/api/tournaments/${tid}/register`);
    await b('POST', `/api/tournaments/${tid}/register`);
    r = await boss('POST', `/api/tournaments/${tid}/start`);
    const m = r.body.tournament.matches.find(x => x.status === 'scheduled');
    await a('POST', `/api/matches/${m.id}/checkin`);
    await b('POST', `/api/matches/${m.id}/checkin`);
    await a('POST', '/api/chat/messages', { channel: `match:${m.id}`, text: 'server: join me' });
    await boss('POST', `/api/matches/${m.id}/claim`);
    await boss('POST', `/api/matches/${m.id}/start`);
    await boss('POST', `/api/matches/${m.id}/duel`, { scores: [5, 2] });
    r = await boss('POST', `/api/matches/${m.id}/duel`, { scores: [5, 3] });
    assert.strictEqual(r.body.match.status, 'done');

    // Players can't touch it; the owner has to type the confirmation.
    assert.strictEqual((await a('POST', '/api/admin/discord/rebuild', { confirm: 'DELETE EVERYTHING' })).status, 403);
    assert.strictEqual((await boss('POST', '/api/admin/discord/rebuild', { confirm: 'yes' })).status, 400);
    r = await boss('POST', '/api/admin/discord/rebuild', { confirm: 'DELETE EVERYTHING' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await waitForJob();
    assert.strictEqual(discord._job.error, null, discord._job.log.join('\n'));

    // Old stuff is gone, the new layout exists, the database category is hidden.
    const names = [...mock.channels.values()].map(c => c.name);
    for (const gone of ['general', 'profile-oldtimer', 'player-registry', 'Profiles']) assert.ok(!names.includes(gone), `${gone} was deleted`);
    for (const want of ['announcements', 'results', 'hall-of-fame', 'leaderboard', 'players', 'teams', 'tournaments', 'matches', 'match-chats', 'backups']) assert.ok(names.includes(want), `#${want} exists`);
    const dbCat = mock.byName('🗄️ FTAP DATABASE');
    const everyone = dbCat.permission_overwrites.find(o => o.id === mock.guildId);
    assert.ok(Number(everyone.deny) & (1 << 10), 'members cannot see the database category');

    // One message per player (old account imported too), per match, a chat log, a backup.
    const msgs = name => mock.messages.get(mock.byName(name).id);
    assert.strictEqual(msgs('players').length, 4, 'boss, flingA, flingB and the imported OldTimer');
    assert.ok(msgs('players').some(x => x.content.includes('OldTimer') && x.content.includes('7W 2L')));
    assert.strictEqual(msgs('matches').length, 1);
    assert.match(msgs('matches')[0].content, /2 – 0/);
    assert.strictEqual(msgs('match-chats').length, 1);
    assert.strictEqual(msgs('match-chats')[0].attachments.length, 1);
    assert.strictEqual(msgs('tournaments').length, 1);
    assert.strictEqual(msgs('leaderboard').length, 1);
    assert.ok(msgs('backups').length >= 1);

    // The imported account logs in with its old password.
    const old = client();
    r = await old('POST', '/api/auth/login', { username: 'OldTimer', password: 'secret1' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.user.stats.solo.wins, 7);

    // Changes are edited into the existing message instead of posting new ones.
    await a('PATCH', '/api/me/profile', { displayName: 'Flinger Supreme' });
    await discord.drain();
    assert.strictEqual(msgs('players').length, 4);
    assert.ok(msgs('players').some(x => x.content.includes('Flinger Supreme')));

    // A wiped disk restores from #backups.
    const restored = await discord.downloadLatestBackup();
    assert.ok(restored && restored.users && Object.values(restored.users).some(u => u.username === 'flingA'));
});

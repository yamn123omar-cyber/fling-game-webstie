// End-to-end: runs the real Express app against a temp data dir and plays a
// duo tournament through the HTTP API exactly like the browser would.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ftap-test-'));
delete process.env.DISCORD_BOT_TOKEN;
process.env.REGISTER_LIMIT_PER_HOUR = '1000';

const db = require('../server/db');
const T = require('../server/tournaments');
const { createApp } = require('../server/index');

let server;
let base;

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
        const json = await res.json().catch(() => null);
        return { status: res.status, body: json };
    };
}

async function signup(name) {
    const c = client();
    const r = await c('POST', '/api/auth/register', { username: name, password: 'hunter22' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    c.id = r.body.user.id;
    c.role = r.body.user.role;
    return c;
}

test.before(async () => {
    db.load();
    server = createApp().listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('full duo tournament: teams, a team of 1, check-in, ref scoring, decider, no-show, reopen', async () => {
    const admin = await signup('organizer');
    assert.strictEqual(admin.role, 'admin', 'first account becomes admin');
    const ref = await signup('refbot');
    const [p1, p2, p3, p4, s5, outsider] = await Promise.all(['alpha', 'bravo', 'charlie', 'delta', 'lonewolf', 'nosy'].map(signup));

    // CSRF header is required for writes
    const raw = await fetch(base + '/api/auth/logout', { method: 'POST' });
    assert.strictEqual(raw.status, 403);

    // Staff roles
    let r = await admin('POST', `/api/admin/users/${ref.id}/role`, { role: 'ref' });
    assert.strictEqual(r.status, 200);
    r = await p1('POST', `/api/admin/users/${p1.id}/role`, { role: 'admin' });
    assert.strictEqual(r.status, 403, 'players cannot promote themselves');

    // Friends + teams
    r = await p1('POST', '/api/friends/requests', { username: 'bravo' });
    assert.strictEqual(r.body.status, 'sent');
    r = await p2('POST', '/api/friends/requests', { username: 'alpha' });
    assert.strictEqual(r.body.status, 'friends', 'mutual request auto-accepts');

    r = await p1('POST', '/api/teams', { name: 'Sky Throwers', tag: 'SKY', invite: 'bravo' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const team1 = r.body.team.id;
    let inv = await p2('GET', '/api/teams/mine');
    await p2('POST', `/api/team-invites/${inv.body.invites[0].id}/accept`);
    r = await p3('POST', '/api/teams', { name: 'Ragdoll Union', invite: 'delta' });
    const team2 = r.body.team.id;
    inv = await p4('GET', '/api/teams/mine');
    await p4('POST', `/api/team-invites/${inv.body.invites[0].id}/accept`);

    // Tournament
    r = await admin('POST', '/api/tournaments', {
        name: 'Test Duo Cup', mode: 'duo', format: 'single', maxEntrants: 8,
        startAt: new Date(Date.now() + 20 * 60_000).toISOString(), publish: true,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const tid = r.body.tournament.id;
    assert.strictEqual(r.body.tournament.status, 'registration');

    r = await p1('POST', `/api/tournaments/${tid}/register`, { teamId: team1 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    r = await p2('POST', `/api/tournaments/${tid}/register`, { solo: true });
    assert.strictEqual(r.status, 400, 'teammate already registered via the team');
    await p4('POST', `/api/tournaments/${tid}/register`, { teamId: team2 });
    r = await s5('POST', `/api/tournaments/${tid}/register`, { solo: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.tournament.entries.find(e => e.members[0].id === s5.id).type, 'soloTeam');

    // Check-in phase opens automatically (start is within the 30 minute window)
    T.tick();
    r = await p1('GET', `/api/tournaments/${tid}`);
    assert.strictEqual(r.body.tournament.status, 'checkin');
    for (const c of [p1, p3, s5]) assert.strictEqual((await c('POST', `/api/tournaments/${tid}/checkin`)).status, 200);

    r = await admin('POST', `/api/tournaments/${tid}/start`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const t = r.body.tournament;
    assert.strictEqual(t.status, 'live');
    const scheduled = t.matches.filter(m => m.status === 'scheduled');
    assert.strictEqual(scheduled.length, 1, 'top seed has a bye, one semifinal to play');
    const semi = scheduled[0].id;

    // Match room chat is private to the players + staff
    r = await outsider('GET', `/api/chat/messages?channel=match:${semi}`);
    assert.strictEqual(r.status, 403);
    r = await s5('POST', '/api/chat/messages', { channel: `match:${semi}`, text: 'join my server, link in bio' });
    assert.strictEqual(r.status, 200);

    // Refs can't start before check-in; players check in
    await ref('POST', `/api/matches/${semi}/claim`);
    r = await ref('POST', `/api/matches/${semi}/start`);
    assert.strictEqual(r.status, 400);
    for (const c of [p3, p4, s5]) {
        r = await c('POST', `/api/matches/${semi}/checkin`);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    }
    assert.strictEqual(r.body.match.status, 'ready');
    r = await p3('POST', `/api/matches/${semi}/duel`, { scores: [5, 0] });
    assert.strictEqual(r.status, 403, 'players cannot enter scores');

    r = await ref('POST', `/api/matches/${semi}/start`);
    assert.strictEqual(r.body.match.status, 'live');
    const m0 = r.body.match;
    const soloSide = m0.sides.findIndex(s => s.entry.type === 'soloTeam');
    // Team of 1 fights in both duels
    assert.ok(m0.duels.every(d => d.players[soloSide] === s5.id));

    const winFor = side => (side === 0 ? [5, 2] : [2, 5]);
    await ref('POST', `/api/matches/${semi}/live`, { scores: [1, 1] });
    r = await ref('POST', `/api/matches/${semi}/duel`, { scores: [3, 3] });
    assert.strictEqual(r.status, 400, 'ties are rejected');
    r = await ref('POST', `/api/matches/${semi}/duel`, { scores: winFor(soloSide) });
    r = await ref('POST', `/api/matches/${semi}/duel`, { scores: winFor(1 - soloSide) });
    const decider = r.body.match.duels[2];
    assert.ok(decider && decider.kind === 'decider', '1–1 creates a decider');
    r = await ref('POST', `/api/matches/${semi}/duel`, { scores: winFor(soloSide) });
    assert.strictEqual(r.body.match.status, 'done');
    assert.strictEqual(r.body.match.winnerSide, soloSide);
    const change = r.body.match.ratingChanges;
    assert.ok(change[s5.id].elo > 0 && change[s5.id].elo < 20, 'solo team gains reduced Elo');
    assert.strictEqual(change[p3.id].rp, 0, 'full team loses no RP');

    // Final: team1 vs the solo player. Only alpha checks in; lonewolf no-shows.
    r = await p1('GET', `/api/tournaments/${tid}`);
    const final = r.body.tournament.matches.find(m => m.isFinal);
    assert.strictEqual(final.status, 'scheduled');
    assert.strictEqual((await p1('POST', `/api/matches/${final.id}/checkin`)).status, 200);
    db.data.matches[final.id].scheduledAt = new Date(Date.now() - 60 * 60_000).toISOString();
    T.tick();
    r = await p1('GET', `/api/matches/${final.id}`);
    assert.strictEqual(r.body.match.result.type, 'forfeit');
    const log = await p1('GET', `/api/chat/messages?channel=match:${final.id}`);
    assert.ok(log.body.messages.some(m => m.meta && m.meta.event === 'noshow'), 'no-show is logged in the match room');

    r = await p1('GET', `/api/tournaments/${tid}`);
    assert.strictEqual(r.body.tournament.status, 'completed');
    assert.strictEqual(r.body.tournament.champion.name, 'Sky Throwers');
    const lone = await outsider('GET', '/api/users/lonewolf');
    assert.strictEqual(lone.body.user.stats.duo.noShows, 1);

    // Admin reopens the final: tournament goes back to live and the penalty is reverted
    r = await admin('POST', `/api/matches/${final.id}/reopen`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.match.status, 'scheduled');
    assert.strictEqual(r.body.match.tournament.status, 'live');
    const lone2 = await outsider('GET', '/api/users/lonewolf');
    assert.strictEqual(lone2.body.user.stats.duo.noShows, 0);
    const alpha = await outsider('GET', '/api/users/alpha');
    assert.strictEqual(alpha.body.user.stats.duo.titles, 0);

    // The semi can be reopened too because the final that used it hasn't been played
    r = await admin('POST', `/api/matches/${semi}/reopen`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.match.status, 'live');
    r = await ref('POST', `/api/matches/${semi}/undo`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.match.duels.length, 3);
    assert.strictEqual(r.body.match.duels[2].winner, null);

    // Leaderboard + home
    r = await outsider('GET', '/api/leaderboard?mode=duo');
    assert.ok(r.body.rows.length >= 4);
    r = await outsider('GET', '/api/home');
    assert.strictEqual(r.status, 200);
});

test('solo tournament: best of 3, refs cannot referee themselves', async () => {
    const admin = client();
    await admin('POST', '/api/auth/login', { username: 'organizer', password: 'hunter22' });
    const a = await signup('soloA');
    const b = await signup('soloB');
    let r = await admin('POST', '/api/tournaments', {
        name: 'Solo Sunday', mode: 'solo', format: 'double', maxEntrants: 4,
        startAt: new Date(Date.now() + 2 * 3600_000).toISOString(), publish: true,
        settings: { checkinMinutes: 0, bestOf: 3, finalBestOf: 3 },
    });
    const tid = r.body.tournament.id;
    await a('POST', `/api/tournaments/${tid}/register`);
    await admin('POST', `/api/tournaments/${tid}/register`);
    r = await admin('POST', `/api/tournaments/${tid}/start`);
    const m = r.body.tournament.matches.find(x => x.status === 'scheduled');
    for (const c of [a, admin]) await c('POST', `/api/matches/${m.id}/checkin`);
    r = await admin('POST', `/api/matches/${m.id}/claim`);
    assert.strictEqual(r.status, 403, 'admin is playing, so cannot referee this match');
    const ref = client();
    await ref('POST', '/api/auth/login', { username: 'refbot', password: 'hunter22' });
    await ref('POST', `/api/matches/${m.id}/claim`);
    await ref('POST', `/api/matches/${m.id}/start`);
    await ref('POST', `/api/matches/${m.id}/duel`, { scores: [5, 1] });
    r = await ref('POST', `/api/matches/${m.id}/duel`, { scores: [5, 4] });
    assert.strictEqual(r.body.match.status, 'done');
    assert.deepStrictEqual(r.body.match.score, [2, 0]);
    void b;
});

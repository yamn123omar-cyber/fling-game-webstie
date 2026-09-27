// Fills a fresh database with demo players, teams, chats and tournaments
// (one finished, one live, two open) so every page has something to show.
//   npm run seed            → only if data/db.json does not exist yet
//   npm run seed -- --force → wipe and reseed
// Demo accounts all use the password "flingflong".
const fs = require('fs');
const path = require('path');

const force = process.argv.includes('--force');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
process.env.DATA_DIR = DATA_DIR;
const FILE = path.join(DATA_DIR, 'db.json');
if (fs.existsSync(FILE) && !force) {
    console.error(`${FILE} already exists. Use "npm run seed -- --force" to wipe it and reseed.`);
    process.exit(1);
}
if (force && fs.existsSync(FILE)) fs.rmSync(FILE);
delete process.env.DISCORD_BOT_TOKEN; // never announce demo data

const db = require('../server/db');
const auth = require('../server/auth');
const users = require('../server/users');
const chat = require('../server/chat');
const T = require('../server/tournaments');

db.load();
db.data.meta.demo = true; // keeps this data out of Discord backups/announcements for good
const PASSWORD = 'flingflong';
const hash = auth.hashPassword(PASSWORD);
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };


function makeUser(username, extra = {}) {
    const u = users.newUser({ username, passwordHash: hash, role: extra.role || 'player' });
    u.displayName = extra.displayName || username;
    Object.assign(u.profile, {
        bio: extra.bio || '',
        title: extra.title || '',
        accent: extra.accent || u.profile.accent,
        banner: extra.banner || u.profile.banner,
        favoriteMode: extra.mode || 'solo',
        socials: extra.socials || {},
    });
    u.createdAt = new Date(Date.now() - (20 + rand() * 200) * 864e5).toISOString();
    db.data.users[u.id] = u;
    db.indexUser(u);
    return u;
}

const OWNER = process.env.OWNER_USERNAME || 'okok_0020';
const admin = makeUser(OWNER, { role: 'owner', displayName: 'Owner', title: 'Runs FTAP Arena', accent: '#c4ff4d', banner: 'grid', bio: 'I run the brackets. Ping me in Discord if something breaks.' });
const ref1 = makeUser('RefRaptor', { role: 'admin', title: 'Head admin', accent: '#4dd8ff', banner: 'ocean', bio: 'Counting flings since 2021.' });
const ref2 = makeUser('WhistleWendy', { role: 'admin', accent: '#9b7bff', banner: 'grape', title: 'Admin' });

const names = [
    ['NoobSlinger', 'Certified yeeter', '#c4ff4d', 'toxic', 'I will throw you into the void.'],
    ['GrabGoblin', 'Grab main', '#ff5ea8', 'grape', 'Duo with @SkyToss. Hit me up for scrims.'],
    ['SkyToss', 'Ceiling enjoyer', '#4dd8ff', 'aurora', ''],
    ['RagdollRick', '', '#ffb84d', 'ember', 'Mostly play duo. Solo sometimes.'],
    ['BlastBerry', 'Blob artist', '#ff6b4d', 'sunset', 'Blobman is a lifestyle.'],
    ['FlingKing', 'Former champion', '#ffc94d', 'ember', 'Undefeated in my dreams.'],
    ['OrbitOllie', '', '#9b7bff', 'grape', ''],
    ['TurboToast', 'Speedrunner', '#3ddc97', 'toxic', 'Fastest fling in the west.'],
    ['CactusCarl', '', '#3ddc97', 'mono', 'prickly.'],
    ['PixelPaws', 'Cat person', '#ff5ea8', 'aurora', 'meow (throws you off the map)'],
    ['MagmaMax', '', '#ff6b4d', 'ember', ''],
    ['FrostByte', 'Ice cold', '#4dd8ff', 'ocean', 'Chill until you grab me.'],
    ['CometKai', '', '#f5f5f5', 'mono', ''],
    ['YeetQueen', 'Duo queen', '#ff5ea8', 'sunset', 'Looking for a duo partner!'],
    ['StormSurge', '', '#9b7bff', 'grid', ''],
    ['BoltBuddy', 'New here', '#ffb84d', 'aurora', 'Just started playing FTAP competitively.'],
];
const players = names.map(([n, title, accent, banner, bio]) => makeUser(n, { title, accent, banner, bio, mode: rand() > 0.5 ? 'duo' : 'solo', socials: rand() > 0.6 ? { youtube: `@${n.toLowerCase()}` } : {} }));
const everyone = [admin, ref1, ref2, ...players];

// Friends
const befriend = (a, b) => { if (!a.friends.includes(b.id)) a.friends.push(b.id); if (!b.friends.includes(a.id)) b.friends.push(a.id); };
for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) if (rand() < 0.22) befriend(players[i], players[j]);
befriend(admin, ref1);
const fr = { id: db.id('fr'), from: players[15].id, to: admin.id, createdAt: new Date().toISOString() };
db.data.friendRequests[fr.id] = fr;

// Teams
const teamDefs = [
    ['Sky Throwers', 'SKY', '#4dd8ff', 1, 2], ['Ragdoll Union', 'RDU', '#ffb84d', 3, 4], ['Blob Squad', 'BLB', '#ff6b4d', 5, 10],
    ['Frostbite', 'ICE', '#4dd8ff', 11, 12], ['Grape Escape', 'GRP', '#9b7bff', 6, 14], ['Toast & Cactus', 'TNC', '#3ddc97', 7, 8],
    ['Pixel Party', 'PXL', '#ff5ea8', 9, 13],
];
const teams = teamDefs.map(([name, tag, color, a, b]) => {
    const created = new Date(Date.now() - rand() * 60 * 864e5).toISOString();
    const t = { id: db.id('tm'), name, tag, color, captainId: players[a].id, members: [players[a].id, players[b].id], createdAt: created, history: [{ userId: players[a].id, action: 'created', at: created }, { userId: players[b].id, action: 'joined', at: created }] };
    db.data.teams[t.id] = t;
    befriend(players[a], players[b]);
    chat.post(`team:${t.id}`, { userId: players[a].id, text: 'gg last night, scrims tomorrow?' });
    chat.post(`team:${t.id}`, { userId: players[b].id, text: "yeah I'm down. 8pm?" });
    return t;
});
const inv = { id: db.id('ti'), teamId: db.id('tm'), from: players[0].id, to: players[15].id, createdAt: new Date().toISOString() };
const lonely = { id: inv.teamId, name: 'Slingshots', tag: 'SLG', color: '#c4ff4d', captainId: players[0].id, members: [players[0].id], createdAt: new Date().toISOString() };
db.data.teams[lonely.id] = lonely;
db.data.teamInvites[inv.id] = inv;

// DMs
const dm = chat.dmChannel(players[0].id, players[1].id);
chat.post(dm, { userId: players[0].id, text: 'you ready for the duo cup?' });
chat.post(dm, { userId: players[1].id, text: 'born ready. bring the noobs' });

// ── Helpers to play matches through the real rules engine ───────────────
const inFuture = mins => new Date(Date.now() + mins * 60e3).toISOString();

function checkInAll(t, m) {
    for (const s of m.slots) {
        const e = t.entries.find(x => x.id === s.entryId);
        if (e) for (const uid of e.members) T.matchCheckin(m, users.get(uid));
    }
}

function playDuel(m, ref, firstTo, bias = 0.5) {
    const winA = rand() < bias;
    const loser = Math.floor(rand() * firstTo);
    const scores = winA ? [firstTo, loser] : [loser, firstTo];
    T.recordDuel(m, ref, scores);
}

function playMatch(t, m, ref, { finish = true } = {}) {
    checkInAll(t, m);
    T.claim(m, ref);
    const [a, b] = m.slots.map(s => t.entries.find(e => e.id === s.entryId));
    chat.post(`match:${m.id}`, { userId: a.members[0], text: `hosting — join me: ${users.get(a.members[0]).username}` });
    chat.post(`match:${m.id}`, { userId: b.members[0], text: 'joining now' });
    T.startMatch(m, ref);
    const bias = a.seed < b.seed ? 0.62 : 0.38;
    let guard = 0;
    while (m.status === 'live' && guard++ < 12) {
        if (!finish && m.duels.filter(d => d.winner !== null).length >= 1) break;
        playDuel(m, ref, t.settings.firstTo, bias);
    }
}

const matchesOf = t => t.matchIds.map(id => db.data.matches[id]);
const scheduled = t => matchesOf(t).filter(m => m.status === 'scheduled');

// 1) Finished solo tournament (single elimination, 8 players)
const t1 = T.createTournament({
    name: 'Friday Night Flings #1', mode: 'solo', maxEntrants: 8, prizes: { first: '500 Robux', second: '250 Robux', third: '100 Robux' }, accent: '#ff5ea8',
    startAt: inFuture(3), publish: true,
    description: 'The very first FTAP Arena cup. Eight flingers, one crown.',
    settings: { checkinMinutes: 0, bestOf: 3, finalBestOf: 3, firstTo: 5 },
}, admin);
T.setStaff(t1, [admin.id, ref1.id, ref2.id], admin);
for (const p of players.slice(0, 8)) T.register(t1, p, {});
T.startTournament(t1);
let guard = 0;
while (t1.status === 'live' && guard++ < 40) {
    for (const m of scheduled(t1)) playMatch(t1, m, rand() > 0.5 ? ref1 : ref2);
}
chat.post(`tour:${t1.id}`, { userId: players[5].id, text: 'GGs everyone, that final was insane' });
chat.post(`tour:${t1.id}`, { userId: players[2].id, text: 'rematch next week 👀' });

// 2) Live duo tournament (double elimination, 6 teams + 1 team of 1)
const t2 = T.createTournament({
    name: 'Duo Dash Cup', mode: 'duo', maxEntrants: 16, prizes: { first: '1,000 Robux', second: '400 Robux', third: '150 Robux' }, accent: '#4dd8ff',
    startAt: inFuture(3), publish: true,
    description: 'Duos on the classic two-sided bracket. Lose in an odd round and you get a second chance to fight your way back in. Teams of 1 welcome — good luck carrying.',
    rules: 'Public servers only. Host shares the server in the match room.',
    settings: { checkinMinutes: 0, firstTo: 5, allowSoloTeams: true, drawRule: 'duels' },
}, admin);
T.setStaff(t2, [admin.id, ref1.id, ref2.id], admin);
for (const tm of teams.slice(0, 6)) T.register(t2, users.get(tm.members[0]), { teamId: tm.id });
T.register(t2, players[15], { solo: true });
T.startTournament(t2);
// play winners round 1 fully, then leave a mix of states
for (const m of scheduled(t2).slice()) playMatch(t2, m, ref1);
const open2 = scheduled(t2);
if (open2[0]) playMatch(t2, open2[0], ref2, { finish: false }); // live, mid-match
if (open2[1]) checkInAll(t2, open2[1]); // ready, waiting for a ref
if (open2[2]) { const m = open2[2]; const e = t2.entries.find(x => x.id === m.slots[0].entryId); T.matchCheckin(m, users.get(e.members[0])); }
for (const m of matchesOf(t2).filter(x => x.status === 'live')) {
    const d = m.duels.find(x => x.winner === null);
    if (d) { d.scores = [3, 2]; d.live = true; }
}
chat.post(`tour:${t2.id}`, { userId: players[3].id, text: 'who is streaming this?' });
chat.post(`tour:${t2.id}`, { userId: ref1.id, text: 'Refs are on it. Check in on time please 🙏' });

// 3) + 4) Open tournaments
const t3 = T.createTournament({
    name: 'Sunday Showdown', mode: 'solo', maxEntrants: 32, accent: '#c4ff4d', prizes: { first: '300 Robux', second: '', third: '' },
    startAt: inFuture(60 * 48 + 17), publish: true,
    description: 'Solo, two-sided bracket with second chances. Best of 3 duels, best of 5 in the final.',
    settings: { bestOf: 3, finalBestOf: 5 },
}, admin);
for (const p of players.slice(2, 13)) T.register(t3, p, {});
const t4 = T.createTournament({
    name: 'Ragdoll Royale', mode: 'duo', maxEntrants: 16, prizes: { first: '2,500 Robux', second: '1,000 Robux', third: '500 Robux' }, accent: '#ffb84d',
    startAt: inFuture(60 * 24 * 5 + 3), publish: true,
    description: 'The biggest duo event of the season. Draws at 1–1 are settled on total kills first.',
    settings: { thirdPlaceMatch: true, drawRule: 'kills' },
}, admin);
for (const tm of teams.slice(1, 5)) T.register(t4, users.get(tm.members[1]), { teamId: tm.id });
T.setStaff(t3, [admin.id, ref2.id], admin);
T.addBots(t3, admin, 3);
T.createTournament({ name: 'Winter Brawl (draft)', mode: 'solo', startAt: inFuture(60 * 24 * 20) }, admin);

// Everyone was online recently
for (const u of everyone) u.lastSeenAt = new Date(Date.now() - rand() * 3 * 864e5).toISOString();
db.save();
db.flush();

console.log(`Seeded ${everyone.length} users, ${Object.keys(db.data.teams).length} teams, ${Object.keys(db.data.tournaments).length} tournaments → ${FILE}`);
console.log(`Log in as "${OWNER}" (owner), "RefRaptor" (admin) or any player (e.g. "NoobSlinger") with password "${PASSWORD}".`);


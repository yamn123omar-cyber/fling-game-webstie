// Tournament + match lifecycle. Everything that changes competitive state goes
// through here so rules are enforced in one place:
//   registration → check-in → live (bracket) → completed
//   match: pending → scheduled (room open, check-in) → ready (lineup locked)
//          → live (a referee is scoring) → done
const db = require('./db');
const cfg = require('./config');
const bracket = require('./bracket');
const duelsLib = require('./duels');
const rating = require('./rating');
const users = require('./users');
const chat = require('./chat');
const rt = require('./realtime');
const discord = require('./discord');
const { HttpError, bad } = require('./errors');
const { hasRole } = require('./auth');

const MIN = 60_000;
const VOID = bracket.VOID;
const CHAMPION_STAGE = 1e9;
const iso = t => new Date(t).toISOString();
const nowIso = () => new Date().toISOString();
const uniq = xs => [...new Set(xs)];
const tok = t => `{t:${typeof t === 'string' ? t : iso(t)}}`; // rendered as local time by the client

// ── Lookups ─────────────────────────────────────────────────────────────────
function getT(id) {
    const t = db.data.tournaments[id];
    if (!t) throw new HttpError(404, 'Tournament not found');
    return t;
}
function getM(id) {
    const m = db.data.matches[id];
    if (!m) throw new HttpError(404, 'Match not found');
    return m;
}
const matchesOf = t => t.matchIds.map(id => db.data.matches[id]).filter(Boolean);
const entryOf = (t, id) => (id && id !== VOID ? t.entries.find(e => e.id === id) || null : null);
const entryForUser = (t, uid) => t.entries.find(e => e.members.includes(uid)) || null;
const sideEntry = (t, m, side) => entryOf(t, m.slots[side].entryId);
function sideOfUser(t, m, uid) {
    for (const s of [0, 1]) {
        const e = sideEntry(t, m, s);
        if (e && e.members.includes(uid)) return s;
    }
    return -1;
}
const modeStats = (uid, mode) => {
    const u = users.get(uid);
    return u ? u.stats[mode] : users.modeStats();
};
const entryRating = (t, e) => Math.round(rating.average(e.members.map(id => modeStats(id, t.mode).elo)));
const nameOf = uid => {
    const u = users.get(uid);
    return u ? u.displayName || u.username : 'someone';
};
const entryName = e => (e ? e.name : 'TBD');
const emitT = t => rt.broadcast('tournament', { id: t.id, status: t.status });

// Tournament admins: the owner can manage everything; admins manage the
// tournaments they're on the admin team of — and can't play in those.
const isOwner = user => hasRole(user, 'owner');
const isStaffOf = (user, t) => Boolean(user) && (isOwner(user) || (t.staff || []).includes(user.id));
const staffIdsOf = t => {
    const owners = Object.values(db.data.users).filter(u => u.role === 'owner' && !u.deleted).map(u => u.id);
    return [...new Set([...(t.staff || []), ...owners])];
};
function assertManage(t, user) {
    if (!isStaffOf(user, t)) throw new HttpError(403, "Only this tournament's admins can do that");
}
const emitM = (m, extra = {}) => rt.broadcast('match', { id: m.id, tournamentId: m.tournamentId, status: m.status, ...extra });
const isDqFn = t => eid => Boolean(entryOf(t, eid) && entryOf(t, eid).dq);
const checkinOpensAt = (t, m) => new Date(m.scheduledAt).getTime() - t.settings.matchCheckinMinutes * MIN;
const deadlineAt = (t, m) => new Date(m.scheduledAt).getTime() + t.settings.noShowGraceMinutes * MIN;

// ── Tournament CRUD (admins) ────────────────────────────────────────────────
function sanitizeSettings(input = {}, base = cfg.tournamentDefaults) {
    const s = { ...cfg.tournamentDefaults, ...base };
    const int = (k, lo, hi) => {
        if (input[k] === undefined || input[k] === '') return;
        const v = Number(input[k]);
        if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${k} must be a whole number between ${lo} and ${hi}`);
        s[k] = v;
    };
    const odd = (k) => {
        int(k, 1, 9);
        if (s[k] % 2 === 0) throw bad(`${k} must be an odd number (1, 3, 5…)`);
    };
    const bool = k => { if (input[k] !== undefined) s[k] = Boolean(input[k]); };
    bool('secondChances');
    int('checkinMinutes', 0, 240);
    int('matchPrepMinutes', 1, 180);
    int('matchCheckinMinutes', 5, 180);
    int('noShowGraceMinutes', 3, 60);
    int('firstTo', 1, 50);
    odd('bestOf');
    odd('finalBestOf');
    bool('allowSoloTeams');
    bool('requireRoblox');
    bool('grandFinalReset');
    bool('thirdPlaceMatch');
    if (input.drawRule !== undefined) {
        if (!['duels', 'kills'].includes(input.drawRule)) throw bad('Unknown draw rule');
        s.drawRule = input.drawRule;
    }
    return s;
}

function applyBasics(t, input, creating) {
    const str = (k, max) => {
        if (input[k] === undefined) return;
        t[k] = String(input[k]).trim().slice(0, max);
    };
    if (creating || input.name !== undefined) {
        const name = String(input.name || '').trim();
        if (name.length < 3 || name.length > 60) throw bad('Name must be 3–60 characters');
        t.name = name;
    }
    str('description', 2000);
    str('rules', 4000);
    str('prize', 120);
    if (input.prizes !== undefined) {
        const pz = input.prizes || {};
        t.prizes = { first: String(pz.first || '').trim().slice(0, 80), second: String(pz.second || '').trim().slice(0, 80), third: String(pz.third || '').trim().slice(0, 80) };
        t.prize = t.prizes.first;
    }
    if (input.accent !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(input.accent)) throw bad('Accent must be a hex colour');
        t.accent = input.accent;
    }
    if (creating || input.mode !== undefined || input.format !== undefined) {
        const mode = input.mode ?? t.mode;
        const format = input.format ?? t.format;
        if (!['solo', 'duo'].includes(mode)) throw bad('Mode must be solo or duo');
        if (!['twosided', 'single', 'double'].includes(format)) throw bad('Unknown bracket format');
        if (!creating && t.entries.length && (mode !== t.mode)) throw bad('Cannot change mode after people registered');
        t.mode = mode;
        t.format = format;
    }
    if (creating || input.maxEntrants !== undefined) {
        const max = Number(input.maxEntrants ?? cfg.tournamentDefaults.maxEntrants);
        if (!Number.isInteger(max) || max < 2 || max > 256) throw bad('Max entrants must be 2–256');
        if (!creating && max < t.entries.length) throw bad('More teams already registered than that');
        t.maxEntrants = max;
    }
    if (creating || input.startAt !== undefined) {
        const at = new Date(input.startAt).getTime();
        if (!Number.isFinite(at)) throw bad('Pick a start date and time');
        if (at < Date.now() + MIN) throw bad('Start time must be in the future');
        if (at > Date.now() + 365 * 864e5) throw bad('Start time is too far away');
        t.startAt = iso(at);
    }
    if (input.settings) t.settings = sanitizeSettings(input.settings, t.settings || cfg.tournamentDefaults);
}

function createTournament(input, user) {
    const t = {
        id: db.id('t'),
        name: '', description: '', rules: '', prize: '',
        accent: '#c4ff4d',
        mode: 'solo', format: 'twosided',
        prizes: { first: '', second: '', third: '' },
        staff: [user.id],
        status: 'draft',
        startAt: null, maxEntrants: cfg.tournamentDefaults.maxEntrants,
        settings: { ...cfg.tournamentDefaults },
        entries: [], matchIds: [],
        createdBy: user.id, createdAt: nowIso(),
        k: null, size: null, placements: null, championEntryId: null, awards: null,
    };
    applyBasics(t, input, true);
    if (!input.settings) t.settings = sanitizeSettings({}, { ...cfg.tournamentDefaults, mode: t.mode });
    db.data.tournaments[t.id] = t;
    if (input.publish) publish(t);
    db.save();
    return t;
}

function updateTournament(t, input) {
    if (!['draft', 'registration', 'checkin'].includes(t.status)) throw bad('This tournament can no longer be edited');
    applyBasics(t, input, false);
    db.save();
    emitT(t);
    return t;
}

function publish(t) {
    if (t.status !== 'draft') throw bad('Already published');
    if (new Date(t.startAt).getTime() < Date.now() + MIN) throw bad('Start time must be in the future — edit it first');
    t.status = 'registration';
    t.publishedAt = nowIso();
    chat.system(`tour:${t.id}`, `Registration is open! The tournament starts ${tok(t.startAt)}.`);
    discord.announce(`🏆 **${t.name}** is open for registration — ${t.mode === 'duo' ? 'Duo' : 'Solo'}, starts <t:${Math.floor(new Date(t.startAt).getTime() / 1000)}:F>`);
    db.save();
    emitT(t);
}

function cancelTournament(t, reason = 'Cancelled by an organizer') {
    if (['completed', 'cancelled'].includes(t.status)) throw bad('Tournament already finished');
    t.status = 'cancelled';
    t.cancelledReason = reason;
    t.completedAt = nowIso();
    for (const e of t.entries) for (const uid of e.members) {
        users.notify(uid, { type: 'tournament', text: `${t.name} was cancelled: ${reason}`, link: `/t/${t.id}` });
    }
    chat.system(`tour:${t.id}`, `Tournament cancelled — ${reason}`);
    db.save();
    emitT(t);
}

function deleteTournament(t) {
    if (!['draft', 'cancelled', 'registration'].includes(t.status)) throw bad('Only drafts, open or cancelled tournaments can be deleted');
    for (const mid of t.matchIds) {
        delete db.data.matches[mid];
        delete db.data.messages[`match:${mid}`];
    }
    delete db.data.messages[`tour:${t.id}`];
    delete db.data.tournaments[t.id];
    db.save();
    rt.broadcast('tournament', { id: t.id, deleted: true });
}

// ── Registration ────────────────────────────────────────────────────────────
function assertRoblox(t, uid) {
    if (!t.settings.requireRoblox) return;
    const u = users.get(uid);
    if (!u.roblox || !u.roblox.verified) {
        throw bad(`${u.username} needs to link a verified Roblox account first (Settings → Roblox)`);
    }
}

function register(t, user, { teamId, solo } = {}) {
    if (!['registration', 'checkin'].includes(t.status)) throw bad('Registration is closed');
    if (t.entries.length >= t.maxEntrants) throw bad('This tournament is full');
    if (entryForUser(t, user.id)) throw bad('You are already registered');
    if ((t.staff || []).includes(user.id)) throw bad("You're an admin of this tournament, so you can't play in it");
    assertRoblox(t, user.id);

    const base = { id: db.id('e'), registeredAt: nowIso(), registeredBy: user.id, checkedIn: t.status === 'checkin', dq: false };
    let entry;
    if (t.mode === 'solo') {
        entry = { ...base, type: 'player', name: user.displayName || user.username, members: [user.id] };
    } else if (solo || !teamId) {
        if (!t.settings.allowSoloTeams) throw bad('This tournament needs full teams of 2 — pick a team');
        entry = { ...base, type: 'soloTeam', name: user.displayName || user.username, members: [user.id] };
    } else {
        const team = db.data.teams[teamId];
        if (!team || team.disbanded || !team.members.includes(user.id)) throw bad('Pick one of your teams');
        if (team.members.length !== 2) throw bad('Your team needs 2 members — invite a partner or enter alone');
        for (const uid of team.members) {
            if (entryForUser(t, uid)) throw bad(`${nameOf(uid)} is already registered with another team`);
            if ((t.staff || []).includes(uid)) throw bad(`${nameOf(uid)} is an admin of this tournament and can't play in it`);
            assertRoblox(t, uid);
        }
        entry = { ...base, type: 'team', teamId: team.id, name: team.name, tag: team.tag, color: team.color, members: [...team.members] };
    }
    t.entries.push(entry);
    for (const uid of entry.members) {
        if (uid !== user.id) {
            users.notify(uid, { type: 'tournament', text: `${nameOf(user.id)} registered your team "${entry.name}" for ${t.name}`, link: `/t/${t.id}` });
        }
    }
    chat.system(`tour:${t.id}`, `${entry.name}${entry.type === 'soloTeam' ? ' (solo)' : ''} joined the tournament.`);
    db.save();
    emitT(t);
    return entry;
}

function withdraw(t, user) {
    if (!['registration', 'checkin'].includes(t.status)) throw bad('You can only withdraw before the tournament starts');
    const e = entryForUser(t, user.id);
    if (!e) throw bad('You are not registered');
    t.entries = t.entries.filter(x => x !== e);
    for (const uid of e.members) if (uid !== user.id) {
        users.notify(uid, { type: 'tournament', text: `${nameOf(user.id)} withdrew "${e.name}" from ${t.name}`, link: `/t/${t.id}` });
    }
    chat.system(`tour:${t.id}`, `${e.name} withdrew.`);
    db.save();
    emitT(t);
}

function removeEntry(t, entryId) {
    if (!['registration', 'checkin', 'draft'].includes(t.status)) throw bad('Use disqualify once the tournament is live');
    const e = entryOf(t, entryId);
    if (!e) throw new HttpError(404, 'Entry not found');
    t.entries = t.entries.filter(x => x !== e);
    for (const uid of e.members) users.notify(uid, { type: 'tournament', text: `You were removed from ${t.name} by an organizer`, link: `/t/${t.id}` });
    db.save();
    emitT(t);
}

function checkin(t, user) {
    if (t.status !== 'checkin') throw bad('Check-in is not open');
    const e = entryForUser(t, user.id);
    if (!e) throw bad('You are not registered');
    if (e.checkedIn) return e;
    e.checkedIn = true;
    e.checkedInAt = nowIso();
    e.checkedInBy = user.id;
    db.save();
    emitT(t);
    return e;
}

function openCheckin(t) {
    t.status = 'checkin';
    for (const e of t.entries) if (e.members.every(uid => (users.get(uid) || {}).isBot)) e.checkedIn = true;
    // If the server was asleep through the window, give people a fair chance anyway.
    const minWindow = Math.min(t.settings.checkinMinutes, 10) * MIN;
    if (new Date(t.startAt).getTime() < Date.now() + minWindow) t.startAt = iso(Date.now() + minWindow);
    const closes = t.startAt;
    for (const e of t.entries) for (const uid of e.members) {
        users.notify(uid, { type: 'checkin', text: `Check-in for ${t.name} is open — check in before ${tok(closes)} or you will be removed`, link: `/t/${t.id}` });
    }
    chat.system(`tour:${t.id}`, `Check-in is open until ${tok(closes)}. Entries that don't check in are removed when the tournament starts.`);
    db.save();
    emitT(t);
}

// ── Start / bracket ─────────────────────────────────────────────────────────
function startTournament(t) {
    if (!['registration', 'checkin'].includes(t.status)) throw bad('Tournament cannot be started now');
    const usesCheckin = t.status === 'checkin';
    const kept = usesCheckin ? t.entries.filter(e => e.checkedIn) : t.entries;
    const dropped = t.entries.filter(e => !kept.includes(e));
    for (const e of dropped) for (const uid of e.members) {
        users.notify(uid, { type: 'tournament', text: `You didn't check in for ${t.name}, so your spot was released`, link: `/t/${t.id}` });
    }
    t.entries = kept;
    if (kept.length < 2) {
        cancelTournament(t, 'Not enough checked-in entrants');
        return t;
    }

    // Seed by rating so the strongest can't knock each other out early.
    kept.forEach(e => { e.rating = entryRating(t, e); });
    kept.sort((a, b) => b.rating - a.rating || a.registeredAt.localeCompare(b.registeredAt));
    kept.forEach((e, i) => { e.seed = i + 1; e.checkedIn = true; });

    const ids = kept.map(e => e.id);
    const gen = t.format === 'twosided'
        ? bracket.generateTwoSided(ids, { secondChances: t.settings.secondChances !== false, thirdPlaceMatch: t.settings.thirdPlaceMatch !== false }, () => db.id('m'))
        : bracket.generate(ids, { format: t.format, thirdPlaceMatch: t.settings.thirdPlaceMatch, grandFinalReset: t.settings.grandFinalReset }, () => db.id('m'));
    for (const m of gen.matches) {
        Object.assign(m, {
            tournamentId: t.id,
            bestOf: t.mode === 'solo' ? (m.isFinal ? t.settings.finalBestOf : t.settings.bestOf) : null,
            checkins: {}, duels: [], lineups: null, applied: [],
            refId: null, scheduledAt: null, proposal: null,
            createdAt: nowIso(),
        });
        db.data.matches[m.id] = m;
    }
    t.matchIds = gen.matches.map(m => m.id);
    t.k = gen.k;
    t.size = gen.size;
    t.status = 'live';
    t.startedAt = nowIso();

    for (const e of kept) for (const uid of e.members) {
        const s = modeStats(uid, t.mode);
        s.tournaments += 1;
        users.notify(uid, { type: 'tournament', text: `${t.name} has started! You are seed #${e.seed}.`, link: `/t/${t.id}` });
    }
    chat.system(`tour:${t.id}`, `The tournament is live with ${kept.length} ${t.mode === 'duo' ? 'teams' : 'players'}. Good luck!`);
    discord.announce(`🔴 **${t.name}** is live — ${kept.length} ${t.mode === 'duo' ? 'teams' : 'players'}`);

    const ready = bracket.resolve(matchesOf(t), isDqFn(t));
    scheduleReady(t, ready);
    db.save();
    emitT(t);
    return t;
}

function scheduleReady(t, list) {
    for (const m of list) {
        const at = Date.now() + t.settings.matchPrepMinutes * MIN;
        m.scheduledAt = iso(at);
        m.checkins = {};
        m.reminded = false;
        const [A, B] = [0, 1].map(s => sideEntry(t, m, s));
        const opens = Math.min(Date.now(), checkinOpensAt(t, m));
        chat.system(`match:${m.id}`,
            `Match room open — ${entryName(A)} vs ${entryName(B)} (${m.label}). ` +
            `Scheduled for ${tok(m.scheduledAt)}. Check in here from ${tok(opens)}; ` +
            `anyone not checked in by ${tok(deadlineAt(t, m))} forfeits. Use this chat to sort out the Roblox server — the log is kept as evidence.`);
        for (const [mine, theirs] of [[A, B], [B, A]]) {
            for (const uid of mine.members) {
                const u = users.get(uid);
                if (u && u.isBot) {
                    m.checkins[uid] = nowIso();
                    chat.system(`match:${m.id}`, `🤖 ${nameOf(uid)} (bot) checked in automatically.`, { event: 'checkin', userId: uid });
                    continue;
                }
                users.notify(uid, { type: 'match', text: `Your match vs ${theirs.name} is ready — check in before ${tok(deadlineAt(t, m))}`, link: `/m/${m.id}` });
            }
        }
        if ([A, B].every(e => e.members.every(uid => m.checkins[uid]))) lockLineups(t, m);
        emitM(m);
    }
}

// ── Match: check-in, lineups, no-shows ──────────────────────────────────────
function matchCheckin(m, user) {
    const t = getT(m.tournamentId);
    if (m.status !== 'scheduled') throw bad('Check-in is closed for this match');
    const side = sideOfUser(t, m, user.id);
    if (side < 0) throw new HttpError(403, 'You are not playing in this match');
    const now = Date.now();
    if (now < checkinOpensAt(t, m)) throw bad(`Check-in opens ${t.settings.matchCheckinMinutes} minutes before the match`);
    if (now > deadlineAt(t, m)) throw bad('Check-in deadline has passed');
    if (m.checkins[user.id]) return m;
    m.checkins[user.id] = nowIso();
    chat.system(`match:${m.id}`, `✅ ${nameOf(user.id)} checked in at ${tok(m.checkins[user.id])}.`, { event: 'checkin', userId: user.id });

    const everyone = [0, 1].every(s => sideEntry(t, m, s).members.every(uid => m.checkins[uid]));
    if (everyone) lockLineups(t, m);
    db.save();
    emitM(m);
    return m;
}

function lockLineups(t, m) {
    m.lineups = [0, 1].map(s => {
        const e = sideEntry(t, m, s);
        const present = e.members.filter(uid => m.checkins[uid]);
        // Strongest vs strongest, second vs second.
        present.sort((a, b) => modeStats(b, t.mode).elo - modeStats(a, t.mode).elo);
        return present;
    });
    m.shorthanded = [0, 1].map(s => sideEntry(t, m, s).members.length === 2 && m.lineups[s].length === 1);
    m.applied = m.applied || [];
    const notes = [];
    for (const s of [0, 1]) {
        const e = sideEntry(t, m, s);
        for (const uid of e.members.filter(id => !m.checkins[id])) {
            const rec = users.applyDelta(uid, t.mode, { ...rating.noShowDelta(), noShows: 1 }, m.id);
            if (rec) { rec.stage = 'lock'; m.applied.push(rec); }
            users.notify(uid, { type: 'match', text: `You missed check-in for your match in ${t.name} (no-show penalty)`, link: `/m/${m.id}` });
            notes.push(`${nameOf(uid)} didn't check in — ${nameOf(m.lineups[s][0])} fights both duels for ${e.name}.`);
        }
    }
    m.duels = duelsLib.initialDuels(t.mode, m.lineups);
    m.status = 'ready';
    m.readyAt = nowIso();
    const plan = m.duels.map(d => `Duel ${d.n}: ${nameOf(d.players[0])} vs ${nameOf(d.players[1])}`).join(' · ');
    chat.system(`match:${m.id}`, `Lineups locked. ${plan}. ${notes.join(' ')} Waiting for a referee to start the match.`, { event: 'ready' });
    rt.toUsers(staffIdsOf(t), 'refqueue', { matchId: m.id, tournamentId: t.id, label: `${t.name} · ${m.label}` });
}

function processMatchTimers(t, m) {
    if (m.status !== 'scheduled' || !m.scheduledAt) return;
    const now = Date.now();
    const start = new Date(m.scheduledAt).getTime();
    if (!m.reminded && now >= start - 5 * MIN && now < start) {
        m.reminded = true;
        for (const s of [0, 1]) for (const uid of sideEntry(t, m, s).members) {
            if (!m.checkins[uid]) users.notify(uid, { type: 'match', text: `Your match starts in 5 minutes — check in now!`, link: `/m/${m.id}` });
        }
        db.save();
    }
    if (now < deadlineAt(t, m)) return;

    const present = [0, 1].map(s => sideEntry(t, m, s).members.some(uid => m.checkins[uid]));
    if (present[0] && present[1]) {
        lockLineups(t, m);
        db.save();
        emitM(m);
        return;
    }
    const missing = [0, 1].filter(s => !present[s]);
    const names = missing.map(s => entryName(sideEntry(t, m, s))).join(' and ');
    chat.system(`match:${m.id}`,
        `⛔ Check-in closed at ${tok(deadlineAt(t, m))}. ${names} did not check in — ` +
        (missing.length === 2 ? 'both sides forfeit.' : 'forfeit.'), { event: 'noshow' });
    forfeitSides(t, m, missing, 'No-show');
}

function forfeitSides(t, m, loserSides, reason) {
    for (const s of loserSides) {
        const e = sideEntry(t, m, s);
        if (e) { e.dq = true; e.dqMatchId = m.id; e.dqReason = reason; }
    }
    if (loserSides.length === 2) finishMatch(t, m, null, 'double_forfeit', reason);
    else finishMatch(t, m, 1 - loserSides[0], 'forfeit', reason);
}

// ── Finishing a match ───────────────────────────────────────────────────────
function finishMatch(t, m, winnerSide, type, note) {
    bracket.complete(m, winnerSide, type);
    m.result.note = note || null;
    m.completedAt = nowIso();
    for (const d of m.duels) d.live = false;
    m.applied = m.applied || [];
    const mode = t.mode;
    const penalized = new Set(m.applied.filter(r => r.stage === 'lock').map(r => r.userId));
    const push = (uid, delta) => {
        const rec = users.applyDelta(uid, mode, delta, m.id);
        if (rec) { rec.stage = 'result'; m.applied.push(rec); }
    };

    if (type === 'played') {
        const sides = [0, 1].map(s => ({
            players: uniq(m.lineups[s]).map(id => ({ id, elo: modeStats(id, mode).elo, matches: modeStats(id, mode).matches })),
            soloTeam: sideEntry(t, m, s).type === 'soloTeam',
        }));
        const deltas = rating.playedMatchDeltas(sides, winnerSide);
        for (const s of [0, 1]) {
            for (const id of uniq(m.lineups[s])) {
                const mine = m.duels.filter(d => d.winner !== null && d.players[s] === id);
                push(id, {
                    ...deltas[id],
                    matches: 1,
                    wins: s === winnerSide ? 1 : 0,
                    losses: s === winnerSide ? 0 : 1,
                    duelsWon: mine.filter(d => d.winner === s).length,
                    duelsLost: mine.filter(d => d.winner !== s).length,
                    kills: mine.reduce((a, d) => a + d.scores[s], 0),
                    deaths: mine.reduce((a, d) => a + d.scores[1 - s], 0),
                });
            }
        }
    } else {
        for (const s of [0, 1]) {
            const e = sideEntry(t, m, s);
            if (!e) continue;
            const won = s === winnerSide;
            const present = e.members.filter(uid => m.checkins[uid]);
            for (const uid of e.members) {
                if (won) {
                    if (present.length === 0 || present.includes(uid)) push(uid, { ...rating.forfeitWinDelta(), forfeitWins: 1 });
                } else if (!penalized.has(uid)) {
                    push(uid, { ...rating.noShowDelta(), noShows: 1 });
                }
            }
        }
    }
    m.ratingChanges = {};
    for (const r of m.applied) {
        const c = (m.ratingChanges[r.userId] ||= { elo: 0, rp: 0 });
        c.elo += r.elo;
        c.rp += r.rp;
    }

    // Who got knocked out, and how far did they get?
    const info = { k: t.k, format: t.format, resetEnabled: t.settings.grandFinalReset, hasP3: matchesOf(t).some(x => x.bracket === 'P3') };
    const sidesToPlace = winnerSide === null ? [0, 1] : m.bracket === 'P3' ? [0, 1] : [1 - winnerSide];
    for (const s of sidesToPlace) {
        const e = sideEntry(t, m, s);
        if (!e) continue;
        const stage = bracket.eliminationStage(m, s, { ...info, dq: Boolean(e.dq) });
        if (stage !== null) { e.elimStage = stage; e.elimMatchId = m.id; }
    }

    const [A, B] = [0, 1].map(s => sideEntry(t, m, s));
    const score = duelsLib.wins(m.duels);
    let line;
    if (type === 'played') line = `🏁 ${entryName(winnerSide === 0 ? A : B)} wins ${Math.max(...score)}–${Math.min(...score)}${note ? ` (${note})` : ''}.`;
    else if (type === 'forfeit') line = `🏁 ${entryName(winnerSide === 0 ? A : B)} wins by forfeit${note ? ` — ${note}` : ''}.`;
    else line = `🏁 Both sides forfeited${note ? ` — ${note}` : ''}.`;
    chat.system(`match:${m.id}`, line, { event: 'result' });
    for (const s of [0, 1]) {
        const e = sideEntry(t, m, s);
        const opp = sideEntry(t, m, 1 - s);
        if (!e) continue;
        const txt = winnerSide === s ? `You beat ${entryName(opp)} in ${t.name}!` : `Your match vs ${entryName(opp)} in ${t.name} is over.`;
        for (const uid of e.members) users.notify(uid, { type: 'result', text: txt, link: `/m/${m.id}` });
    }
    if (type === 'played') {
        discord.announce(`⚔️ ${t.name} · ${m.label}: **${entryName(winnerSide === 0 ? A : B)}** beat ${entryName(winnerSide === 0 ? B : A)} ${Math.max(...score)}–${Math.min(...score)}`);
    }

    emitM(m);
    const ready = bracket.resolve(matchesOf(t), isDqFn(t));
    scheduleReady(t, ready);
    checkComplete(t);
    db.save();
    emitT(t);
}

function checkComplete(t) {
    const ms = matchesOf(t);
    if (t.status !== 'live' || ms.some(m => m.status !== 'done')) return;
    const finals = ms.filter(m => m.isFinal && m.result && m.result.type !== 'skipped');
    const last = finals.find(m => m.bracket === 'GF' && m.round === 2) || finals.find(m => m.bracket === 'GF') || finals[0];
    const champ = last ? entryOf(t, last.winnerEntryId) : null;
    if (champ) { champ.elimStage = CHAMPION_STAGE; champ.elimMatchId = null; }
    // A lone side-final loser who reached the 3rd place match on a bye still finishes 3rd.
    for (const m of ms) {
        if (m.bracket === 'P3' && m.result && m.result.type === 'bye' && m.winnerEntryId !== VOID) {
            const e = entryOf(t, m.winnerEntryId);
            if (e && !e.dq) { e.elimStage = t.k + 0.5; e.elimMatchId = m.id; }
        }
    }
    const places = bracket.placements(t.entries);
    t.placements = t.entries.map(e => ({ entryId: e.id, place: places.get(e.id) })).sort((a, b) => a.place - b.place);
    t.awards = [];
    for (const e of t.entries) {
        const place = places.get(e.id);
        e.place = place;
        if (e.dq) continue;
        for (const uid of e.members) {
            const u = users.get(uid);
            if (!u) continue;
            const s = u.stats[t.mode];
            const rp = rating.placementPoints(place, t.entries.length, e.type === 'soloTeam');
            t.awards.push({ userId: uid, rp, title: place === 1, podium: place <= 3, prevBestPlace: s.bestPlace });
            s.rp += rp;
            if (place === 1) s.titles += 1;
            if (place <= 3) s.podiums += 1;
            s.bestPlace = s.bestPlace === null ? place : Math.min(s.bestPlace, place);
            users.notify(uid, { type: 'result', text: `${t.name} is over — you placed #${place} (+${rp} RP)`, link: `/t/${t.id}` });
        }
    }
    t.status = 'completed';
    t.completedAt = nowIso();
    t.championEntryId = champ ? champ.id : null;
    chat.system(`tour:${t.id}`, champ ? `🏆 ${champ.name} are the champions of ${t.name}!` : `${t.name} is over.`);
    if (champ) discord.announce(`🏆 **${champ.name}** won **${t.name}**!`);
}

function revertCompletion(t) {
    for (const a of t.awards || []) {
        const u = users.get(a.userId);
        if (!u) continue;
        const s = u.stats[t.mode];
        s.rp = Math.max(0, s.rp - a.rp);
        if (a.title) s.titles -= 1;
        if (a.podium) s.podiums -= 1;
        s.bestPlace = a.prevBestPlace;
    }
    for (const e of t.entries) {
        delete e.place;
        if (e.elimStage === CHAMPION_STAGE) delete e.elimStage;
    }
    t.awards = null;
    t.placements = null;
    t.championEntryId = null;
    t.completedAt = null;
    t.status = 'live';
}

// ── Referee actions ─────────────────────────────────────────────────────────
function canRef(user, m) {
    const t = db.data.tournaments[m.tournamentId];
    if (!t || !isStaffOf(user, t)) return false;
    return sideOfUser(t, m, user.id) < 0; // nobody scores their own match
}

function assertRef(user, m, { mustOwn = true } = {}) {
    const t = db.data.tournaments[m.tournamentId];
    if (!canRef(user, m)) throw new HttpError(403, t && isStaffOf(user, t) ? "You can't score your own match" : "Only this tournament's admins can score matches");
    if (mustOwn && m.refId !== user.id && !isOwner(user)) throw new HttpError(403, 'Take this match first');
}

function claim(m, user) {
    assertRef(user, m, { mustOwn: false });
    if (!['scheduled', 'ready', 'live'].includes(m.status)) throw bad('This match is not active');
    if (m.refId && m.refId !== user.id && !isOwner(user)) throw bad(`${nameOf(m.refId)} is already running this match`);
    m.refId = user.id;
    chat.system(`match:${m.id}`, `🎥 ${nameOf(user.id)} (admin) is running your match. Invite them to your Roblox server so they can watch the fight.`, { event: 'ref' });
    db.save();
    emitM(m);
}

function release(m, user) {
    assertRef(user, m);
    if (m.status === 'live') throw bad('Finish or undo the match before releasing it');
    m.refId = null;
    chat.system(`match:${m.id}`, `${nameOf(user.id)} is no longer running this match.`);
    db.save();
    emitM(m);
}

function startMatch(m, user) {
    assertRef(user, m);
    if (m.status !== 'ready') throw bad(m.status === 'scheduled' ? 'Both sides must check in first' : 'Match is not ready');
    const t = getT(m.tournamentId);
    m.status = 'live';
    m.startedAt = nowIso();
    const d = m.duels.find(x => x.winner === null);
    if (d) d.live = true;
    chat.system(`match:${m.id}`, `🔴 Match is LIVE. Duel ${d.n}: ${nameOf(d.players[0])} vs ${nameOf(d.players[1])} — first to ${t.settings.firstTo} kills.`, { event: 'live' });
    db.save();
    emitM(m);
}

function currentDuel(m) {
    return m.duels.find(d => d.winner === null) || null;
}

function parseScores(scores) {
    const s = Array.isArray(scores) ? scores.map(Number) : [];
    if (s.length !== 2 || s.some(v => !Number.isInteger(v) || v < 0 || v > 99)) throw bad('Scores must be whole numbers from 0 to 99');
    return s;
}

function liveScore(m, user, scores) {
    assertRef(user, m);
    if (m.status !== 'live') throw bad('Match is not live');
    const d = currentDuel(m);
    if (!d) throw bad('No duel in progress');
    d.scores = parseScores(scores);
    d.live = true;
    db.save();
    emitM(m, { live: { n: d.n, scores: d.scores } });
}

function recordDuel(m, user, scores) {
    assertRef(user, m);
    if (m.status !== 'live') throw bad('Match is not live');
    const t = getT(m.tournamentId);
    const d = currentDuel(m);
    if (!d) throw bad('No duel in progress');
    const s = parseScores(scores);
    const err = duelsLib.validateScores(s);
    if (err) throw bad(err);
    d.scores = s;
    d.winner = s[0] > s[1] ? 0 : 1;
    d.live = false;
    d.recordedBy = user.id;
    d.at = nowIso();
    chat.system(`match:${m.id}`, `Duel ${d.n}${d.kind === 'decider' ? ' (decider)' : ''}: ${nameOf(d.players[0])} ${s[0]}–${s[1]} ${nameOf(d.players[1])} → ${nameOf(d.players[d.winner])} wins.`, { event: 'duel' });

    const ev = duelsLib.evaluate({
        mode: t.mode, duels: m.duels, lineups: m.lineups,
        bestOf: m.bestOf || t.settings.bestOf, drawRule: t.settings.drawRule,
    });
    if (ev.done) {
        finishMatch(t, m, ev.winnerSide, 'played', ev.note);
        return;
    }
    if (ev.add) {
        ev.add.live = true;
        m.duels.push(ev.add);
        if (ev.add.kind === 'decider') {
            chat.system(`match:${m.id}`, `⚖️ It's 1–1! The system randomly picked two players who haven't fought yet for the decider: ${nameOf(ev.add.players[0])} vs ${nameOf(ev.add.players[1])}. Winner takes the match.`, { event: 'decider' });
        } else {
            chat.system(`match:${m.id}`, `Next up — Duel ${ev.add.n}: ${nameOf(ev.add.players[0])} vs ${nameOf(ev.add.players[1])}.`);
        }
    } else {
        const next = currentDuel(m);
        if (next) next.live = true;
    }
    db.save();
    emitM(m);
}

function undoDuel(m, user) {
    assertRef(user, m);
    if (m.status !== 'live') throw bad('Only a live match can be corrected — ask an admin to reopen finished matches');
    const t = getT(m.tournamentId);
    let idx = -1;
    m.duels.forEach((d, i) => { if (d.winner !== null) idx = i; });
    if (idx < 0) throw bad('No duel result to undo');
    const planned = t.mode === 'duo' ? 2 : 1;
    m.duels = m.duels.filter((d, i) => i <= idx || i < planned);
    const d = m.duels[idx];
    d.winner = null;
    d.live = true;
    m.duels.forEach((x, i) => { if (i !== idx) x.live = false; });
    chat.system(`match:${m.id}`, `↩️ ${nameOf(user.id)} undid the result of Duel ${d.n}.`, { event: 'undo' });
    db.save();
    emitM(m);
}

function refForfeit(m, user, loserSide, reason) {
    assertRef(user, m);
    if (!['scheduled', 'ready', 'live'].includes(m.status)) throw bad('Match is not active');
    const t = getT(m.tournamentId);
    const sides = loserSide === 'both' ? [0, 1] : [Number(loserSide)];
    if (sides.some(s => s !== 0 && s !== 1)) throw bad('Pick who forfeits');
    const why = String(reason || 'Forfeit').slice(0, 200);
    chat.system(`match:${m.id}`, `⛔ ${nameOf(user.id)} ruled a forfeit: ${sides.map(s => entryName(sideEntry(t, m, s))).join(' and ')} — ${why}`, { event: 'forfeit' });
    forfeitSides(t, m, sides, why);
}

function reschedule(m, user, at) {
    const t = getT(m.tournamentId);
    assertManage(t, user);
    if (!['scheduled'].includes(m.status)) throw bad('Only matches waiting for check-in can be rescheduled');
    setMatchTime(t, m, at, `🗓️ ${nameOf(user.id)} rescheduled the match`);
}

function setMatchTime(t, m, at, prefix) {
    const ts = new Date(at).getTime();
    if (!Number.isFinite(ts) || ts < Date.now() + 2 * MIN || ts > Date.now() + 30 * 864e5) throw bad('Pick a time between a few minutes and 30 days from now');
    m.scheduledAt = iso(ts);
    m.checkins = {};
    m.reminded = false;
    m.proposal = null;
    chat.system(`match:${m.id}`, `${prefix} to ${tok(m.scheduledAt)}. Check-in opens ${tok(checkinOpensAt(t, m))} and closes ${tok(deadlineAt(t, m))}.`, { event: 'time' });
    for (const s of [0, 1]) for (const uid of sideEntry(t, m, s).members) {
        users.notify(uid, { type: 'match', text: `Your match in ${t.name} moved to ${tok(m.scheduledAt)}`, link: `/m/${m.id}` });
    }
    db.save();
    emitM(m);
}

// Players can agree on a different time together — both sides have to accept.
function proposeTime(m, user, at) {
    const t = getT(m.tournamentId);
    const side = sideOfUser(t, m, user.id);
    if (side < 0) throw new HttpError(403, 'You are not playing in this match');
    if (m.status !== 'scheduled') throw bad('The match time can only change before it starts');
    const ts = new Date(at).getTime();
    if (!Number.isFinite(ts) || ts < Date.now() + 5 * MIN || ts > Date.now() + 14 * 864e5) throw bad('Pick a time between 5 minutes and 14 days from now');
    m.proposal = { by: user.id, side, at: iso(ts), createdAt: nowIso() };
    chat.system(`match:${m.id}`, `🕒 ${nameOf(user.id)} proposed moving the match to ${tok(m.proposal.at)}. The other side can accept or decline.`, { event: 'proposal' });
    for (const uid of sideEntry(t, m, 1 - side).members) {
        users.notify(uid, { type: 'match', text: `${nameOf(user.id)} wants to move your match to ${tok(m.proposal.at)}`, link: `/m/${m.id}` });
    }
    db.save();
    emitM(m);
}

function answerProposal(m, user, accept) {
    const t = getT(m.tournamentId);
    const side = sideOfUser(t, m, user.id);
    if (!m.proposal) throw bad('There is no pending time proposal');
    if (side < 0 || side === m.proposal.side) throw new HttpError(403, 'Only the other side can answer');
    if (!accept) {
        chat.system(`match:${m.id}`, `${nameOf(user.id)} declined the new time. The match stays at ${tok(m.scheduledAt)}.`);
        m.proposal = null;
        db.save();
        emitM(m);
        return;
    }
    if (m.status !== 'scheduled') throw bad('Too late to move this match');
    setMatchTime(t, m, m.proposal.at, `🤝 Both sides agreed — match moved`);
}

function callRef(m, user) {
    const t = getT(m.tournamentId);
    if (sideOfUser(t, m, user.id) < 0) throw new HttpError(403, 'You are not playing in this match');
    if (m.lastRefCall && Date.now() - new Date(m.lastRefCall).getTime() < 2 * MIN) throw bad('A referee was just called — give them a moment');
    m.lastRefCall = nowIso();
    chat.system(`match:${m.id}`, `🔔 ${nameOf(user.id)} called for an admin.`, { event: 'callref' });
    const staff = m.refId ? [m.refId] : staffIdsOf(t);
    for (const uid of staff) users.notify(uid, { type: 'ref', text: `${nameOf(user.id)} needs an admin in ${t.name} · ${m.label}`, link: `/m/${m.id}` });
    db.save();
}

// ── Admin: disqualify / reopen ──────────────────────────────────────────────
function disqualify(t, entryId, user, reason) {
    if (t.status !== 'live') throw bad('Tournament is not live');
    const e = entryOf(t, entryId);
    if (!e) throw new HttpError(404, 'Entry not found');
    if (e.dq) throw bad('Already disqualified');
    const active = matchesOf(t).find(m => ['scheduled', 'ready', 'live'].includes(m.status) && m.slots.some(s => s.entryId === e.id));
    const why = String(reason || 'Disqualified by an organizer').slice(0, 200);
    if (active) {
        const side = active.slots.findIndex(s => s.entryId === e.id);
        chat.system(`match:${active.id}`, `⛔ ${e.name} was disqualified by ${nameOf(user.id)} — ${why}`);
        forfeitSides(t, active, [side], why);
    } else {
        e.dq = true;
        e.dqReason = why;
        const ready = bracket.resolve(matchesOf(t), isDqFn(t));
        scheduleReady(t, ready);
        checkComplete(t);
    }
    for (const uid of e.members) users.notify(uid, { type: 'tournament', text: `You were disqualified from ${t.name}: ${why}`, link: `/t/${t.id}` });
    db.save();
    emitT(t);
}

function reopenMatch(m, user) {
    const t = getT(m.tournamentId);
    if (!m.result || !['played', 'forfeit', 'double_forfeit'].includes(m.result.type)) throw bad('Only finished matches can be reopened');
    if (!['live', 'completed'].includes(t.status)) throw bad('Tournament is not running');
    const ms = matchesOf(t);
    const deps = new Set();
    const collect = match => {
        for (const d of bracket.dependents(ms, match)) {
            if (d.status === 'live' || (d.status === 'done' && !['bye', 'skipped'].includes(d.result.type))) {
                throw bad(`Reopen "${d.label}" first — it already used this result`);
            }
            if (d.status === 'done') collect(d);
            deps.add(d);
        }
    };
    collect(m);
    if (t.status === 'completed') revertCompletion(t);

    for (const d of deps) {
        for (const r of (d.applied || []).slice().reverse()) users.revertDelta(r);
        for (const e of t.entries) if (e.elimMatchId === d.id) { delete e.elimStage; delete e.elimMatchId; }
        if (d.status !== 'pending') chat.system(`match:${d.id}`, 'This match was reset because an earlier result was reopened. It will be rescheduled.');
        for (const slot of d.slots) if (slot.source.type !== 'seed') slot.entryId = null;
        Object.assign(d, {
            status: 'pending', result: null, winnerSide: null, winnerEntryId: null, loserEntryId: null,
            scheduledAt: null, checkins: {}, lineups: null, shorthanded: null, duels: [], refId: null,
            applied: [], ratingChanges: null, proposal: null, completedAt: null, readyAt: null, startedAt: null, reminded: false,
        });
        emitM(d);
    }

    const wasPlayed = m.result.type === 'played';
    const keep = [];
    for (const r of (m.applied || []).slice().reverse()) {
        if (wasPlayed && r.stage === 'lock') keep.unshift(r);
        else users.revertDelta(r);
    }
    m.applied = keep;
    m.ratingChanges = null;
    for (const e of t.entries) {
        if (e.elimMatchId === m.id) { delete e.elimStage; delete e.elimMatchId; }
        if (e.dqMatchId === m.id) { e.dq = false; delete e.dqMatchId; delete e.dqReason; }
    }
    Object.assign(m, { result: null, winnerSide: null, winnerEntryId: null, loserEntryId: null, completedAt: null });
    if (wasPlayed) {
        m.status = 'live';
    } else {
        m.status = 'scheduled';
        m.scheduledAt = iso(Date.now() + t.settings.matchPrepMinutes * MIN);
        m.lineups = null;
        m.duels = [];
        m.reminded = false;
    }
    chat.system(`match:${m.id}`, `↩️ ${nameOf(user.id)} reopened this match${wasPlayed ? ' — the referee can now correct the duels' : ` — new check-in deadline ${tok(deadlineAt(t, m))}`}.`, { event: 'reopen' });
    const ready = bracket.resolve(ms, isDqFn(t));
    scheduleReady(t, ready);
    db.save();
    emitM(m);
    emitT(t);
}

// ── Admin team of a tournament ──────────────────────────────────────────────
function setStaff(t, userIds, by) {
    assertManage(t, by);
    const ids = [...new Set((userIds || []).map(String))];
    for (const uid of ids) {
        const u = users.get(uid);
        if (!u || u.deleted) throw bad('Unknown player');
        if (!hasRole(u, 'admin')) throw bad(`${u.displayName} isn't an admin yet — the owner can make them one`);
        if (entryForUser(t, uid)) throw bad(`${u.displayName} is playing in this tournament, so they can't be one of its admins`);
    }
    if (!ids.length) throw bad('A tournament needs at least one admin');
    const added = ids.filter(id => !(t.staff || []).includes(id));
    t.staff = ids;
    for (const uid of added) users.notify(uid, { type: 'role', text: `You're now an admin of ${t.name}`, link: `/t/${t.id}` });
    db.save();
    emitT(t);
}

// ── Force join (admins add players, teams or bots) ─────────────────────────
function forceJoin(t, by, { userId, teamId }) {
    assertManage(t, by);
    if (!['registration', 'checkin'].includes(t.status)) throw bad('You can only add people before the tournament starts');
    const u = users.get(userId || (teamId && db.data.teams[teamId] && db.data.teams[teamId].members[0]));
    if (!u) throw bad('Pick a player or team');
    const entry = register(t, u, teamId ? { teamId } : { solo: true });
    entry.checkedIn = true;
    entry.addedBy = by.id;
    db.save();
    return entry;
}

const BOT_NAMES = ['Blaze', 'Nova', 'Turbo', 'Pixel', 'Rocket', 'Comet', 'Cactus', 'Magma', 'Frost', 'Orbit', 'Storm', 'Yeet', 'Ragdoll', 'Noodle', 'Bolt', 'Toast'];
function makeBot(name) {
    let base = name && String(name).trim() ? String(name).trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 20) : '';
    if (!base) base = `Bot${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]}`;
    let username = base;
    for (let i = 2; db.userByName(username); i++) username = `${base}${i}`;
    const u = users.newUser({ username, passwordHash: null });
    u.isBot = true;
    u.displayName = username;
    u.profile.bio = 'Practice bot — controlled by the tournament admins.';
    db.data.users[u.id] = u;
    db.indexUser(u);
    return u;
}

function addBots(t, by, count) {
    assertManage(t, by);
    if (!['registration', 'checkin'].includes(t.status)) throw bad('Add bots before the tournament starts');
    const n = Math.max(1, Math.min(64, Number(count) || 1));
    const room = t.maxEntrants - t.entries.length;
    if (room <= 0) throw bad('The tournament is full');
    const made = [];
    for (let i = 0; i < Math.min(n, room); i++) {
        const a = makeBot();
        if (t.mode === 'duo') {
            const b = makeBot();
            const team = { id: db.id('tm'), name: `${a.username} & ${b.username}`.slice(0, 24), tag: 'BOT', color: '#8a93a6', captainId: a.id, members: [a.id, b.id], createdAt: nowIso(), isBot: true, history: [] };
            db.data.teams[team.id] = team;
            made.push(forceJoin(t, by, { teamId: team.id }));
        } else {
            made.push(forceJoin(t, by, { userId: a.id }));
        }
    }
    db.save();
    emitT(t);
    return made;
}

// ── Scheduler tick ──────────────────────────────────────────────────────────
function tick() {
    const now = Date.now();
    for (const t of Object.values(db.data.tournaments)) {
        try {
            const start = new Date(t.startAt).getTime();
            if (t.status === 'registration') {
                if (t.settings.checkinMinutes > 0 && now >= start - t.settings.checkinMinutes * MIN) openCheckin(t);
                else if (t.settings.checkinMinutes === 0 && now >= start) startTournament(t);
            }
            if (t.status === 'checkin' && now >= start) startTournament(t);
            if (t.status === 'live') for (const m of matchesOf(t)) processMatchTimers(t, m);
        } catch (e) {
            console.error('[scheduler]', t.id, e);
        }
    }
}

// ── Views ───────────────────────────────────────────────────────────────────
function entryView(t, e) {
    return {
        id: e.id, type: e.type, name: e.name, tag: e.tag || null, color: e.color || null, teamId: e.teamId || null,
        seed: e.seed || null, checkedIn: Boolean(e.checkedIn), dq: Boolean(e.dq), dqReason: e.dqReason || null,
        place: e.place || null, registeredAt: e.registeredAt,
        rating: e.rating || entryRating(t, e),
        members: e.members.map(id => users.summary(users.get(id))),
    };
}

function matchCompact(m) {
    return {
        id: m.id, bracket: m.bracket, round: m.round, index: m.index, label: m.label,
        status: m.status, scheduledAt: m.scheduledAt, isFinal: Boolean(m.isFinal), resetOf: m.resetOf || null,
        slots: m.slots.map(s => ({
            entryId: s.entryId,
            source: s.source.type === 'seed' ? { type: 'seed', seed: s.source.seed } : { type: s.source.type, matchId: s.source.matchId },
        })),
        winnerSide: m.winnerSide ?? null,
        result: m.result ? { type: m.result.type, note: m.result.note || null } : null,
        score: duelsLib.wins(m.duels || []),
        refId: m.refId || null,
        liveDuel: m.status === 'live' ? (currentDuel(m) || null) : null,
        waiting: Boolean(m.waiting), secondChance: Boolean(m.secondChance), sideFinal: Boolean(m.sideFinal), xRound: m.xRound || null,
    };
}

function summary(t) {
    const champ = t.championEntryId ? entryOf(t, t.championEntryId) : null;
    return {
        id: t.id, name: t.name, mode: t.mode, format: t.format, status: t.status,
        startAt: t.startAt, maxEntrants: t.maxEntrants, entrantCount: t.entries.length,
        prize: t.prize, prizes: t.prizes || { first: t.prize || '', second: '', third: '' }, accent: t.accent, createdAt: t.createdAt, startedAt: t.startedAt || null, completedAt: t.completedAt || null,
        settings: t.settings,
        champion: champ ? { name: champ.name, members: champ.members.map(id => users.summary(users.get(id))) } : null,
        liveMatches: t.status === 'live' ? matchesOf(t).filter(m => m.status === 'live').length : 0,
        cancelledReason: t.cancelledReason || null,
    };
}

function detail(t, viewer) {
    const mine = viewer ? entryForUser(t, viewer.id) : null;
    const isAdmin = isStaffOf(viewer, t);
    if (t.status === 'draft' && !isAdmin) throw new HttpError(404, 'Tournament not found');
    const isStaffMember = Boolean(viewer) && (t.staff || []).includes(viewer.id);
    return {
        ...summary(t),
        description: t.description, rules: t.rules,
        entries: t.entries.map(e => entryView(t, e)),
        matches: matchesOf(t).map(matchCompact),
        placements: t.placements,
        k: t.k,
        myEntryId: mine ? mine.id : null,
        staff: (t.staff || []).map(id => users.summary(users.get(id))),
        viewer: {
            isStaffMember,
            isOwner: isOwner(viewer),
            canRegister: Boolean(viewer) && !mine && !isStaffMember && ['registration', 'checkin'].includes(t.status) && t.entries.length < t.maxEntrants,
            canWithdraw: Boolean(mine) && ['registration', 'checkin'].includes(t.status),
            canCheckin: Boolean(mine) && t.status === 'checkin' && !mine.checkedIn,
            isAdmin,
        },
    };
}

function matchDetail(m, viewer) {
    const t = getT(m.tournamentId);
    const side = viewer ? sideOfUser(t, m, viewer.id) : -1;
    const staff = isStaffOf(viewer, t);
    const sides = [0, 1].map(s => {
        const e = sideEntry(t, m, s);
        if (!e) return null;
        return {
            entry: entryView(t, e),
            members: e.members.map(id => ({ ...users.summary(users.get(id)), checkedInAt: (m.checkins || {})[id] || null })),
        };
    });
    const now = Date.now();
    return {
        id: m.id, bracket: m.bracket, round: m.round, label: m.label, status: m.status,
        mode: t.mode, bestOf: m.bestOf, firstTo: t.settings.firstTo, drawRule: t.settings.drawRule,
        tournament: summary(t),
        scheduledAt: m.scheduledAt,
        checkinOpensAt: m.scheduledAt ? iso(checkinOpensAt(t, m)) : null,
        deadlineAt: m.scheduledAt ? iso(deadlineAt(t, m)) : null,
        readyAt: m.readyAt || null, startedAt: m.startedAt || null, completedAt: m.completedAt || null,
        sides,
        lineups: m.lineups, shorthanded: m.shorthanded || null,
        duels: m.duels || [],
        score: duelsLib.wins(m.duels || []),
        winnerSide: m.winnerSide ?? null,
        result: m.result || null,
        ref: m.refId ? users.summary(users.get(m.refId)) : null,
        proposal: m.proposal || null,
        ratingChanges: m.ratingChanges || null,
        slots: m.slots.map(s => ({ entryId: s.entryId, source: s.source })),
        viewer: {
            side,
            isParticipant: side >= 0,
            isStaff: staff,
            isAdmin: staff,
            isOwner: isOwner(viewer),
            isRef: Boolean(viewer) && m.refId === (viewer && viewer.id),
            canRef: Boolean(viewer) && canRef(viewer, m),
            canChat: Boolean(viewer) && (side >= 0 || staff),
            checkedIn: Boolean(viewer && m.checkins && m.checkins[viewer.id]),
            canCheckin: side >= 0 && m.status === 'scheduled' && !(m.checkins || {})[viewer.id] &&
                now >= checkinOpensAt(t, m) && now <= deadlineAt(t, m),
        },
    };
}

function matchesForUser(uid, { includeDone = false } = {}) {
    const out = [];
    for (const t of Object.values(db.data.tournaments)) {
        if (!['live', 'completed'].includes(t.status)) continue;
        const e = entryForUser(t, uid);
        if (!e) continue;
        for (const m of matchesOf(t)) {
            if (!m.slots.some(s => s.entryId === e.id)) continue;
            if (m.result && ['bye', 'skipped'].includes(m.result.type)) continue;
            if (m.status === 'pending') continue;
            if (!includeDone && m.status === 'done') continue;
            out.push({ ...matchCompact(m), deadlineAt: m.scheduledAt ? iso(deadlineAt(t, m)) : null, checkedIn: Boolean((m.checkins || {})[uid]), tournament: { id: t.id, name: t.name, mode: t.mode, accent: t.accent }, mySide: m.slots.findIndex(s => s.entryId === e.id), entries: m.slots.map(s => (entryOf(t, s.entryId) ? entryView(t, entryOf(t, s.entryId)) : null)) });
        }
    }
    out.sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
    return out;
}

function refQueue(user) {
    const out = [];
    for (const t of Object.values(db.data.tournaments)) {
        if (t.status !== 'live' || !isStaffOf(user, t)) continue;
        for (const m of matchesOf(t)) {
            if (!['scheduled', 'ready', 'live'].includes(m.status)) continue;
            out.push({
                ...matchCompact(m),
                tournament: { id: t.id, name: t.name, mode: t.mode, accent: t.accent },
                entries: m.slots.map(s => (entryOf(t, s.entryId) ? entryView(t, entryOf(t, s.entryId)) : null)),
                ref: m.refId ? users.summary(users.get(m.refId)) : null,
                deadlineAt: m.scheduledAt ? iso(deadlineAt(t, m)) : null,
                checkins: Object.keys(m.checkins || {}).length,
            });
        }
    }
    const order = { live: 0, ready: 1, scheduled: 2 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
    return out;
}

module.exports = {
    isStaffOf, isOwner, assertManage, setStaff, forceJoin, addBots, makeBot,
    getT, getM, matchesOf, entryOf, entryForUser, sideOfUser,
    createTournament, updateTournament, publish, cancelTournament, deleteTournament,
    register, withdraw, removeEntry, checkin, openCheckin, startTournament,
    matchCheckin, claim, release, startMatch, liveScore, recordDuel, undoDuel, refForfeit,
    reschedule, proposeTime, answerProposal, callRef, disqualify, reopenMatch,
    tick, summary, detail, matchDetail, matchCompact, entryView, matchesForUser, refQueue, sanitizeSettings,
};

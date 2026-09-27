// Tournaments, matches, referee desk, leaderboard and landing-page data.
const express = require('express');
const db = require('../db');
const cfg = require('../config');
const users = require('../users');
const rating = require('../rating');
const rt = require('../realtime');
const T = require('../tournaments');
const { requireAuth, requireRole, hasRole } = require('../auth');
const { route, HttpError } = require('../errors');

const router = express.Router();

const STATUS_ORDER = { live: 0, checkin: 1, registration: 2, draft: 3, completed: 4, cancelled: 5 };
function sortTournaments(list) {
    return list.sort((a, b) => {
        const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (d) return d;
        if (a.status === 'completed' || a.status === 'cancelled') return (b.completedAt || '').localeCompare(a.completedAt || '');
        return (a.startAt || '').localeCompare(b.startAt || '');
    });
}

router.get('/config', route(() => ({
    rating: cfg.rating, points: cfg.points, tiers: cfg.tiers, tournamentDefaults: cfg.tournamentDefaults,
})));

// ── Tournaments ─────────────────────────────────────────────────────────────
router.get('/tournaments', route(req => {
    const admin = hasRole(req.user, 'admin');
    const list = Object.values(db.data.tournaments).filter(t => admin || t.status !== 'draft').map(t => {
        const s = T.summary(t);
        if (req.user) {
            const e = T.entryForUser(t, req.user.id);
            s.myEntry = e ? { id: e.id, name: e.name, checkedIn: Boolean(e.checkedIn), place: e.place || null } : null;
        }
        return s;
    });
    return { tournaments: sortTournaments(list) };
}));

router.get('/tournaments/:id', route(req => ({ tournament: T.detail(T.getT(req.params.id), req.user) })));

router.post('/tournaments', requireRole('admin'), route(req => ({ tournament: T.detail(T.createTournament(req.body || {}, req.user), req.user) })));

router.patch('/tournaments/:id', requireRole('admin'), route(req => ({ tournament: T.detail(T.updateTournament(T.getT(req.params.id), req.body || {}), req.user) })));

router.delete('/tournaments/:id', requireRole('admin'), route(req => {
    T.deleteTournament(T.getT(req.params.id));
    return { ok: true };
}));

router.post('/tournaments/:id/:action', requireAuth, route(req => {
    const t = T.getT(req.params.id);
    const admin = hasRole(req.user, 'admin');
    const b = req.body || {};
    switch (req.params.action) {
        case 'register': T.register(t, req.user, { teamId: b.teamId, solo: Boolean(b.solo) }); break;
        case 'withdraw': T.withdraw(t, req.user); break;
        case 'checkin': T.checkin(t, req.user); break;
        case 'publish': if (!admin) throw new HttpError(403, 'Admins only'); T.publish(t); break;
        case 'start': if (!admin) throw new HttpError(403, 'Admins only'); T.startTournament(t); break;
        case 'cancel': if (!admin) throw new HttpError(403, 'Admins only'); T.cancelTournament(t, String(b.reason || 'Cancelled by an organizer').slice(0, 200)); break;
        default: throw new HttpError(404, 'Unknown action');
    }
    return { tournament: T.detail(t, req.user) };
}));

router.post('/tournaments/:id/entries/:entryId/:action', requireRole('admin'), route(req => {
    const t = T.getT(req.params.id);
    if (req.params.action === 'remove') T.removeEntry(t, req.params.entryId);
    else if (req.params.action === 'dq') T.disqualify(t, req.params.entryId, req.user, req.body && req.body.reason);
    else throw new HttpError(404, 'Unknown action');
    return { tournament: T.detail(t, req.user) };
}));

// ── Matches ─────────────────────────────────────────────────────────────────
router.get('/matches/:id', route(req => ({ match: T.matchDetail(T.getM(req.params.id), req.user) })));

router.post('/matches/:id/:action', requireAuth, route(req => {
    const m = T.getM(req.params.id);
    const b = req.body || {};
    const u = req.user;
    switch (req.params.action) {
        case 'checkin': T.matchCheckin(m, u); break;
        case 'call-ref': T.callRef(m, u); break;
        case 'propose': T.proposeTime(m, u, b.at); break;
        case 'proposal': T.answerProposal(m, u, Boolean(b.accept)); break;
        case 'claim': T.claim(m, u); break;
        case 'release': T.release(m, u); break;
        case 'start': T.startMatch(m, u); break;
        case 'live': T.liveScore(m, u, b.scores); return { ok: true };
        case 'duel': T.recordDuel(m, u, b.scores); break;
        case 'undo': T.undoDuel(m, u); break;
        case 'forfeit': T.refForfeit(m, u, b.side, b.reason); break;
        case 'reschedule': T.reschedule(m, u, b.at); break;
        case 'reopen':
            if (!hasRole(u, 'admin') && m.refId !== u.id) throw new HttpError(403, 'Only admins or the match referee can reopen a result');
            T.reopenMatch(m, u);
            break;
        default: throw new HttpError(404, 'Unknown action');
    }
    return { match: T.matchDetail(m, u) };
}));

router.get('/me/matches', requireAuth, route(req => ({ matches: T.matchesForUser(req.user.id) })));

router.get('/ref/queue', requireRole('ref'), route(req => ({
    matches: T.refQueue().map(m => ({ ...m, canRef: T.sideOfUser(db.data.tournaments[m.tournament.id], db.data.matches[m.id], req.user.id) < 0 })),
})));

// ── Leaderboard ─────────────────────────────────────────────────────────────
function leaderboard(mode, sort, limit = 100) {
    const rows = Object.values(db.data.users)
        .filter(u => !u.deleted && !u.banned)
        .map(u => ({ u, s: u.stats[mode] }))
        .filter(({ s }) => s.matches > 0 || s.rp > 0 || s.tournaments > 0)
        .sort((a, b) => sort === 'rp'
            ? b.s.rp - a.s.rp || b.s.elo - a.s.elo
            : b.s.elo - a.s.elo || b.s.rp - a.s.rp)
        .slice(0, limit);
    return rows.map(({ u, s }, i) => ({
        rank: i + 1,
        user: users.summary(u),
        elo: s.elo, peak: s.peak, rp: s.rp, tier: rating.tierFor(s.elo).name,
        matches: s.matches, wins: s.wins, losses: s.losses,
        winRate: s.matches ? s.wins / s.matches : 0,
        kills: s.kills, deaths: s.deaths, titles: s.titles, streak: s.streak,
        provisional: s.matches < cfg.rating.provisionalMatches,
        trend: s.history.slice(-10).map(h => h.elo),
    }));
}

router.get('/leaderboard', route(req => {
    const mode = req.query.mode === 'duo' ? 'duo' : 'solo';
    const sort = req.query.sort === 'rp' ? 'rp' : 'elo';
    return { mode, sort, rows: leaderboard(mode, sort) };
}));

// ── Landing page ────────────────────────────────────────────────────────────
router.get('/home', route(() => {
    const ts = Object.values(db.data.tournaments).filter(t => t.status !== 'draft');
    const allMatches = Object.values(db.data.matches);
    const played = allMatches.filter(m => m.status === 'done' && m.result && m.result.type === 'played');
    const liveMatches = [];
    for (const t of ts.filter(x => x.status === 'live')) {
        for (const m of T.matchesOf(t)) {
            if (!['live', 'ready'].includes(m.status)) continue;
            liveMatches.push({
                ...T.matchCompact(m),
                tournament: { id: t.id, name: t.name, mode: t.mode, accent: t.accent },
                entries: m.slots.map(s => (T.entryOf(t, s.entryId) ? T.entryView(t, T.entryOf(t, s.entryId)) : null)),
            });
        }
    }
    const recent = played.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 8).map(m => {
        const t = db.data.tournaments[m.tournamentId];
        return {
            ...T.matchCompact(m),
            completedAt: m.completedAt,
            tournament: { id: t.id, name: t.name, mode: t.mode, accent: t.accent },
            entries: m.slots.map(s => (T.entryOf(t, s.entryId) ? T.entryView(t, T.entryOf(t, s.entryId)) : null)),
        };
    });
    const kills = played.reduce((a, m) => a + (m.duels || []).reduce((x, d) => x + (d.winner !== null ? d.scores[0] + d.scores[1] : 0), 0), 0);
    return {
        stats: {
            players: Object.values(db.data.users).filter(u => !u.deleted).length,
            tournaments: ts.length,
            matches: played.length,
            kills,
            online: rt.onlineCount(),
        },
        upcoming: sortTournaments(ts.filter(t => ['live', 'checkin', 'registration'].includes(t.status)).map(T.summary)).slice(0, 6),
        champions: ts.filter(t => t.status === 'completed' && t.championEntryId)
            .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 4).map(T.summary),
        live: liveMatches.slice(0, 6),
        recent,
        top: { solo: leaderboard('solo', 'elo', 5), duo: leaderboard('duo', 'elo', 5) },
    };
}));

module.exports = router;

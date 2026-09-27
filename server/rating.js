// Pure rating maths: Elo for skill, Ranking Points (RP) for progression.
const cfg = require('./config');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function expected(ra, rb) {
    return 1 / (1 + 10 ** ((rb - ra) / 400));
}

function kFactor(player) {
    const r = cfg.rating;
    if ((player.matches || 0) < r.provisionalMatches) return r.kProvisional;
    return player.elo >= r.kHighThreshold ? r.kHigh : r.k;
}

function tierFor(elo) {
    let tier = cfg.tiers[0];
    for (const t of cfg.tiers) if (elo >= t.min) tier = t;
    return tier;
}

const average = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : cfg.rating.start);

/**
 * Rating changes for a match that was actually played.
 * sides: [{ players: [{ id, elo, matches }], soloTeam: boolean }, …] (exactly 2)
 * winnerSide: 0 | 1
 * → { [userId]: { elo, rp } }
 */
function playedMatchDeltas(sides, winnerSide) {
    const r = cfg.rating;
    const p = cfg.points;
    const ratings = sides.map(s => average(s.players.map(pl => pl.elo)));
    const out = {};
    sides.forEach((side, i) => {
        const won = i === winnerSide;
        const E = expected(ratings[i], ratings[1 - i]);
        for (const pl of side.players) {
            let d = kFactor(pl) * ((won ? 1 : 0) - E);
            if (side.soloTeam) d *= d > 0 ? r.soloTeamWinMult : r.soloTeamLossMult;
            let rp;
            if (won) {
                const strength = clamp(1 + (ratings[1 - i] - ratings[i]) / 400, p.strengthMin, p.strengthMax);
                rp = Math.round(p.matchWin * strength * (side.soloTeam ? p.soloTeamWinMult : 1));
            } else {
                rp = side.soloTeam ? p.soloTeamLoss : 0;
            }
            // Merge in case the same player appears twice (a team of 1 plays both duels).
            if (!out[pl.id]) out[pl.id] = { elo: Math.round(d), rp };
        }
    });
    return out;
}

function forfeitWinDelta() {
    return { elo: 0, rp: cfg.points.forfeitWin };
}

function noShowDelta() {
    return { elo: -cfg.rating.noShowPenalty, rp: cfg.points.noShow };
}

function placementPoints(place, entrantCount, soloTeam) {
    const table = Object.entries(cfg.points.placement).map(([top, pts]) => [Number(top), pts]).sort((a, b) => a[0] - b[0]);
    let base = 0;
    for (const [top, pts] of table) {
        if (place <= top) { base = pts; break; }
    }
    const size = clamp(entrantCount / 8, cfg.points.placementSizeMin, cfg.points.placementSizeMax);
    return Math.round(base * size * (soloTeam ? cfg.points.soloTeamWinMult : 1)) + cfg.points.participation;
}

module.exports = { expected, kFactor, tierFor, playedMatchDeltas, forfeitWinDelta, noShowDelta, placementPoints, average };

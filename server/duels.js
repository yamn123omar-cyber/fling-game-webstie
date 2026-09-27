// Pure logic for the fights inside a match.
//  Solo: best-of-N duels between the two players.
//  Duo:  Duel 1 = A1 vs B1, Duel 2 = A2 vs B2 (a team of 1 fights both).
//        1–1 → a decider between two players who have NOT fought each other yet,
//        picked at random by the system (if everyone has fought, any pair).

const crypto = require('crypto');

const uniq = xs => [...new Set(xs)];

function initialDuels(mode, lineups) {
    const [A, B] = lineups;
    if (mode === 'solo') return [duel(1, 'main', A[0], B[0])];
    return [
        duel(1, 'main', A[0], B[0]),
        duel(2, 'main', A[1] || A[0], B[1] || B[0]),
    ];
}

function duel(n, kind, a, b) {
    return { n, kind, players: [a, b], scores: [0, 0], winner: null, live: false };
}

function wins(duels) {
    const w = [0, 0];
    for (const d of duels) if (d.winner === 0 || d.winner === 1) w[d.winner]++;
    return w;
}

function kills(duels) {
    const k = [0, 0];
    for (const d of duels) if (d.winner !== null) { k[0] += d.scores[0]; k[1] += d.scores[1]; }
    return k;
}

function pickDecider(lineups, duels, randomInt = crypto.randomInt) {
    const A = uniq(lineups[0]);
    const B = uniq(lineups[1]);
    const fought = new Set(duels.map(d => `${d.players[0]}|${d.players[1]}`));
    const all = [];
    for (const a of A) for (const b of B) all.push([a, b]);
    const fresh = all.filter(([a, b]) => !fought.has(`${a}|${b}`));
    const pool = fresh.length ? fresh : all;
    return pool[randomInt(pool.length)];
}

/**
 * Decide what happens after a duel result.
 * → { done: true, winnerSide, note? } | { done: false, add?: duel, note? }
 */
function evaluate({ mode, duels, lineups, bestOf, drawRule }, randomInt) {
    if (duels.some(d => d.winner === null)) return { done: false };
    const w = wins(duels);

    if (mode === 'solo') {
        const need = Math.ceil(bestOf / 2);
        if (w[0] >= need) return { done: true, winnerSide: 0 };
        if (w[1] >= need) return { done: true, winnerSide: 1 };
        const last = duels[duels.length - 1];
        return { done: false, add: duel(duels.length + 1, 'main', last.players[0], last.players[1]) };
    }

    const decider = duels.find(d => d.kind === 'decider');
    if (decider) return { done: true, winnerSide: decider.winner, note: 'Won the decider duel' };
    if (w[0] === 2) return { done: true, winnerSide: 0 };
    if (w[1] === 2) return { done: true, winnerSide: 1 };

    if (drawRule === 'kills') {
        const k = kills(duels);
        if (k[0] !== k[1]) {
            const side = k[0] > k[1] ? 0 : 1;
            return { done: true, winnerSide: side, note: `1–1 in duels, won on total kills ${k[side]}–${k[1 - side]}` };
        }
    }
    const [a, b] = pickDecider(lineups, duels, randomInt);
    return { done: false, add: duel(duels.length + 1, 'decider', a, b), note: 'decider' };
}

function validateScores(scores) {
    if (!Array.isArray(scores) || scores.length !== 2) return 'Two scores are required';
    for (const s of scores) if (!Number.isInteger(s) || s < 0 || s > 99) return 'Scores must be whole numbers from 0 to 99';
    if (scores[0] === scores[1]) return 'A duel cannot end in a tie — keep fighting until someone gets the next kill';
    return null;
}

module.exports = { initialDuels, evaluate, pickDecider, wins, kills, validateScores };

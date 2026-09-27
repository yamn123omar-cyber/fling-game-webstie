// Pure bracket logic: generation, advancing winners/losers, byes, placements.
// A match has two slots; each slot knows where its entrant comes from
// (a seed, or the winner/loser of another match). `resolve()` fills slots as
// results come in. VOID marks "nobody will ever arrive here" (a bye).

const VOID = 'VOID';

function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

// Standard seeding so 1 and 2 can only meet in the final: [1,8,4,5,2,7,3,6] for 8.
function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
        const n = order.length * 2;
        order = order.flatMap(s => [s, n + 1 - s]);
    }
    return order;
}

function roundName(bracket, round, k, format) {
    if (bracket === 'GF') return round === 1 ? 'Grand Final' : 'Grand Final Reset';
    if (bracket === 'P3') return '3rd Place Match';
    if (bracket === 'L') return round === 2 * (k - 1) ? 'Losers Final' : `Losers Round ${round}`;
    const fromEnd = k - round;
    if (format === 'double') return fromEnd === 0 ? 'Winners Final' : fromEnd === 1 && k > 2 ? 'Winners Semifinals' : `Winners Round ${round}`;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return `Round ${round}`;
}

/**
 * @param {string[]} entryIds  ordered by seed (index 0 = top seed)
 * @param {{format:'single'|'double', thirdPlaceMatch?:boolean, grandFinalReset?:boolean}} opts
 * @param {() => string} newId
 */
function generate(entryIds, opts, newId) {
    const n = entryIds.length;
    if (n < 2) throw new Error('Need at least 2 entrants');
    const size = nextPow2(n);
    const k = Math.log2(size);
    const format = opts.format === 'double' ? 'double' : 'single';
    const matches = [];

    const mk = (bracket, round, index, sources, extra = {}) => {
        const m = {
            id: newId(),
            bracket,
            round,
            index,
            label: roundName(bracket, round, k, format),
            slots: sources.map(source => ({ source, entryId: null })),
            status: 'pending',
            ...extra,
        };
        matches.push(m);
        return m;
    };
    const seed = s => ({ type: 'seed', seed: s, entryId: s <= n ? entryIds[s - 1] : VOID });
    const win = m => ({ type: 'winner', matchId: m.id });
    const lose = m => ({ type: 'loser', matchId: m.id });

    const order = seedOrder(size);
    const wb = [];
    wb[1] = [];
    for (let i = 0; i < size / 2; i++) wb[1].push(mk('W', 1, i, [seed(order[2 * i]), seed(order[2 * i + 1])]));
    for (let r = 2; r <= k; r++) {
        wb[r] = [];
        for (let i = 0; i < size / 2 ** r; i++) wb[r].push(mk('W', r, i, [win(wb[r - 1][2 * i]), win(wb[r - 1][2 * i + 1])]));
    }
    wb[k][0].isFinal = format === 'single';

    if (format === 'single') {
        if (opts.thirdPlaceMatch && k >= 2) mk('P3', 1, 0, [lose(wb[k - 1][0]), lose(wb[k - 1][1])]);
        return { matches, size, k, format };
    }

    let gf;
    if (k === 1) {
        gf = mk('GF', 1, 0, [win(wb[1][0]), lose(wb[1][0])]);
    } else {
        const lb = [];
        lb[1] = [];
        for (let i = 0; i < size / 4; i++) lb[1].push(mk('L', 1, i, [lose(wb[1][2 * i]), lose(wb[1][2 * i + 1])]));
        for (let j = 1; j <= k - 1; j++) {
            const cnt = size / 2 ** (j + 1);
            lb[2 * j] = [];
            for (let i = 0; i < cnt; i++) {
                // Alternate the drop-in order so people don't instantly rematch.
                const wbIdx = j % 2 === 1 ? cnt - 1 - i : i;
                lb[2 * j].push(mk('L', 2 * j, i, [win(lb[2 * j - 1][i]), lose(wb[j + 1][wbIdx])]));
            }
            if (j < k - 1) {
                lb[2 * j + 1] = [];
                for (let i = 0; i < cnt / 2; i++) lb[2 * j + 1].push(mk('L', 2 * j + 1, i, [win(lb[2 * j][2 * i]), win(lb[2 * j][2 * i + 1])]));
            }
        }
        gf = mk('GF', 1, 0, [win(wb[k][0]), win(lb[2 * (k - 1)][0])]);
    }
    gf.isFinal = true;
    if (opts.grandFinalReset !== false) {
        // Only played if the losers-bracket side wins the first grand final.
        mk('GF', 2, 0, [lose(gf), win(gf)], { resetOf: gf.id, isFinal: true });
    }
    return { matches, size, k, format };
}

// ── Classic FTAP format: two sides that meet in the middle ─────────────────
// Entrants are split into a left and a right side (seed 1 left, seed 2 right,
// then snake so both sides are equally strong). Each side plays down to a side
// champion; the two side champions play the Final in the middle.
//
// Second chances ("losers bracket"): when a round on a side has an odd number
// of players, one player is left without an opponent. Instead of a free pass,
// everyone who lost in that round plays a small knockout, and its winner comes
// back into the bracket to face the waiting player. Round 1 still uses a bye.

function sideLabel(side) { return side === 'L' ? 'Left' : 'Right'; }

// Order matches so the strongest ones are far apart in the tree.
function spreadOrder(count) {
    return seedOrder(nextPow2(count)).filter(s => s <= count).map(s => s - 1);
}

function generateTwoSided(entryIds, opts, newId) {
    const n = entryIds.length;
    if (n < 2) throw new Error('Need at least 2 entrants');
    const secondChances = opts.secondChances !== false;
    const matches = [];
    const win = m => ({ type: 'winner', matchId: m.id });
    const lose = m => ({ type: 'loser', matchId: m.id });
    const seedSrc = i => ({ type: 'seed', seed: i + 1, entryId: entryIds[i] });
    const voidSrc = { type: 'seed', seed: null, entryId: VOID };
    const mk = (fields, sources) => {
        const m = { id: newId(), slots: sources.map(source => ({ source, entryId: null })), status: 'pending', ...fields };
        matches.push(m);
        return m;
    };

    // Snake split: 1→L, 2→R, 3→R, 4→L, 5→L, 6→R …
    const sides = { L: [], R: [] };
    entryIds.forEach((_, i) => {
        const block = Math.floor(i / 2);
        const first = i % 2 === 0;
        const side = (block % 2 === 0) === first ? 'L' : 'R';
        sides[side].push(i);
    });

    const sideInfo = {};
    for (const side of ['L', 'R']) {
        const seeds = sides[side];
        const rounds = [];
        if (seeds.length === 1) {
            sideInfo[side] = { champion: seedSrc(seeds[0]), finalMatch: null, rounds };
            continue;
        }
        // Round 1: top seed gets the bye when odd; the rest play best vs worst.
        const pairs = [];
        let rest = seeds.slice();
        if (rest.length % 2 === 1) { pairs.push([seedSrc(rest[0]), voidSrc]); rest = rest.slice(1); }
        for (let i = 0; i < rest.length / 2; i++) pairs.push([seedSrc(rest[i]), seedSrc(rest[rest.length - 1 - i])]);
        const order = spreadOrder(pairs.length);
        let prev = order.map((pi, idx) => mk({ bracket: side, round: 1, index: idx, label: `${sideLabel(side)} · Round 1` }, pairs[pi]));
        rounds.push(prev);

        let r = 2;
        while (prev.length > 1) {
            const count = Math.ceil(prev.length / 2);
            const odd = prev.length % 2 === 1;
            const round = [];
            for (let i = 0; i < count; i++) {
                const a = prev[2 * i];
                const b = prev[2 * i + 1];
                const fields = { bracket: side, round: r, index: i, label: `${sideLabel(side)} · Round ${r}` };
                if (b) round.push(mk(fields, [win(a), win(b)]));
                else round.push(mk({ ...fields, waiting: true }, [win(a), null])); // second slot filled below
            }
            if (odd) {
                const waitingMatch = round[round.length - 1];
                const full = round.filter(m => !m.waiting);
                let comeback = voidSrc;
                if (secondChances && full.length) {
                    // Everyone who loses a full match this round plays for the comeback spot.
                    let pool = full.map(lose);
                    let xr = 1;
                    while (pool.length > 1) {
                        const next = [];
                        if (pool.length % 2 === 1) next.push(pool.shift()); // best-placed loser waits a round
                        for (let i = 0; i < pool.length; i += 2) {
                            const x = mk({
                                bracket: `X${side}`, round: r, index: next.length, xRound: xr,
                                label: `${sideLabel(side)} · Second chance (Round ${r})`,
                            }, [pool[i], pool[i + 1]]);
                            next.push(win(x));
                        }
                        pool = next;
                        xr++;
                    }
                    comeback = pool[0];
                    for (const m of full) m.secondChance = true;
                }
                waitingMatch.slots[1] = { source: comeback, entryId: null };
            }
            rounds.push(round);
            prev = round;
            r++;
        }
        const finalMatch = prev[0];
        finalMatch.sideFinal = true;
        finalMatch.label = `${sideLabel(side)} side final`;
        sideInfo[side] = { champion: win(finalMatch), finalMatch, rounds };
    }

    const top = Math.max(sideInfo.L.rounds.length, sideInfo.R.rounds.length, 1);
    const final = mk({ bracket: 'F', round: top + 1, index: 0, label: 'Final', isFinal: true }, [sideInfo.L.champion, sideInfo.R.champion]);
    if (opts.thirdPlaceMatch !== false && sideInfo.L.finalMatch && sideInfo.R.finalMatch) {
        mk({ bracket: 'P3', round: top + 1, index: 0, label: '3rd place match' }, [lose(sideInfo.L.finalMatch), lose(sideInfo.R.finalMatch)]);
    }
    void final;
    return { matches, format: 'twosided', k: top, size: n };
}

/**
 * Fill in slots whose source match has finished and auto-complete byes.
 * @param {object[]} matches   all matches of one tournament (mutated)
 * @param {(entryId:string)=>boolean} isDq
 * @returns {object[]} matches that just became playable (status → 'scheduled')
 */
function resolve(matches, isDq = () => false) {
    const byId = new Map(matches.map(m => [m.id, m]));
    const ready = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const m of matches) {
            if (m.status !== 'pending') continue;

            if (m.resetOf) {
                const gf = byId.get(m.resetOf);
                if (gf.status !== 'done') continue;
                if (gf.winnerSide !== 1 || gf.result.type !== 'played') {
                    m.status = 'done';
                    m.result = { type: 'skipped' };
                    m.winnerSide = null;
                    m.winnerEntryId = VOID;
                    m.loserEntryId = VOID;
                    changed = true;
                    continue;
                }
            }

            for (const slot of m.slots) {
                if (slot.entryId !== null) continue;
                const src = slot.source;
                let eid = null;
                if (src.type === 'seed') eid = src.entryId;
                else {
                    const from = byId.get(src.matchId);
                    if (from && from.status === 'done') eid = src.type === 'winner' ? from.winnerEntryId : from.loserEntryId;
                }
                if (eid === null || eid === undefined) continue;
                slot.entryId = eid !== VOID && isDq(eid) ? VOID : eid;
                changed = true;
            }

            const [a, b] = m.slots.map(s => s.entryId);
            if (a === null || b === null) continue;
            if (a === VOID || b === VOID) {
                m.status = 'done';
                m.result = { type: 'bye' };
                m.winnerSide = a === VOID && b === VOID ? null : a === VOID ? 1 : 0;
                m.winnerEntryId = m.winnerSide === null ? VOID : m.slots[m.winnerSide].entryId;
                m.loserEntryId = VOID;
            } else {
                m.status = 'scheduled';
                ready.push(m);
            }
            changed = true;
        }
    }
    return ready;
}

// Record a finished match. winnerSide: 0 | 1 | null (null = both lost, e.g. double no-show).
function complete(m, winnerSide, type) {
    m.status = 'done';
    m.winnerSide = winnerSide;
    m.result = { ...(m.result || {}), type };
    if (winnerSide === null) {
        m.winnerEntryId = VOID;
        m.loserEntryId = VOID;
    } else {
        m.winnerEntryId = m.slots[winnerSide].entryId;
        m.loserEntryId = m.slots[1 - winnerSide].entryId;
    }
}

/**
 * How far did the losing side of this match get? Higher = better placement.
 * Returns null if this loss does not knock them out (double-elim winners bracket).
 */
function eliminationStage(m, side, info) {
    const { k, format, dq } = info;
    if (format === 'twosided') {
        if (dq) return 0;
        if (m.bracket === 'F') return k + 1;                          // runner-up
        if (m.bracket === 'P3') return side === m.winnerSide ? k + 0.5 : k;
        if (m.bracket === 'L' || m.bracket === 'R') {
            if (m.sideFinal) return info.hasP3 ? null : k;             // plays for 3rd
            if (m.secondChance) return null;                           // drops to the losers bracket
            return m.round;
        }
        return m.round;                                                // lost in the losers bracket
    }
    const topStage = format === 'double' ? Math.max(1, 2 * (k - 1)) + 1 : k;
    if (m.bracket === 'W') {
        if (format === 'single') return m.round;
        return dq ? 0 : null;
    }
    if (m.bracket === 'P3') return side === m.winnerSide ? k - 0.5 : k - 1;
    if (m.bracket === 'L') return m.round;
    if (m.bracket === 'GF') {
        if (m.round === 2) return topStage;
        // First grand final: the winners-bracket side (slot 0) gets a second life if reset is on.
        if (side === 0 && info.resetEnabled && !dq) return null;
        return topStage;
    }
    return 0;
}

// entries: [{ id, elimStage }] → Map(entryId → place)
function placements(entries) {
    const places = new Map();
    const stages = entries.map(e => (e.elimStage === undefined || e.elimStage === null ? -Infinity : e.elimStage));
    entries.forEach((e, i) => {
        const better = stages.filter(s => s > stages[i]).length;
        places.set(e.id, better + 1);
    });
    return places;
}

// Matches that feed from match `m` (used when an admin reopens a result).
function dependents(matches, m) {
    return matches.filter(x => x.resetOf === m.id || x.slots.some(s => s.source.type !== 'seed' && s.source.matchId === m.id));
}

module.exports = { VOID, generate, generateTwoSided, resolve, complete, eliminationStage, placements, dependents, seedOrder, nextPow2, roundName };

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

module.exports = { VOID, generate, resolve, complete, eliminationStage, placements, dependents, seedOrder, nextPow2, roundName };

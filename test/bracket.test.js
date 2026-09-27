const test = require('node:test');
const assert = require('node:assert');
const bracket = require('../server/bracket');

let n = 0;
const newId = () => `m${++n}`;
const ids = count => Array.from({ length: count }, (_, i) => `e${i + 1}`);

// Play a whole bracket where the lower seed number (better seed) always wins.
function playOut(gen, pickWinner = (m) => (Number(m.slots[0].entryId.slice(1)) < Number(m.slots[1].entryId.slice(1)) ? 0 : 1)) {
    const elim = {};
    bracket.resolve(gen.matches);
    let ready = gen.matches.filter(m => m.status === 'scheduled');
    let guard = 0;
    while (ready.length && guard++ < 500) {
        for (const m of ready) {
            const w = pickWinner(m);
            bracket.complete(m, w, 'played');
            const stage = bracket.eliminationStage(m, 1 - w, { k: gen.k, format: gen.format, resetEnabled: true });
            if (stage !== null) elim[m.slots[1 - w].entryId] = stage;
            if (m.bracket === 'P3') elim[m.slots[w].entryId] = bracket.eliminationStage(m, w, { k: gen.k, format: gen.format });
        }
        bracket.resolve(gen.matches);
        ready = gen.matches.filter(m => m.status === 'scheduled');
    }
    return elim;
}

test('seed order keeps top seeds apart', () => {
    assert.deepStrictEqual(bracket.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    assert.deepStrictEqual(bracket.seedOrder(4), [1, 4, 2, 3]);
});

test('single elimination with byes: 5 entrants', () => {
    const gen = bracket.generate(ids(5), { format: 'single' }, newId);
    assert.strictEqual(gen.size, 8);
    assert.strictEqual(gen.matches.length, 7);
    const ready = bracket.resolve(gen.matches);
    // seeds 1,2,3 get byes: 4v5 plays round 1, and 2v3 (both through on byes) can already play round 2
    assert.deepStrictEqual(ready.map(m => m.slots.map(s => s.entryId)), [['e4', 'e5'], ['e2', 'e3']]);
    const byes = gen.matches.filter(m => m.result && m.result.type === 'bye');
    assert.strictEqual(byes.length, 3);
    const elim = playOut(gen);
    const final = gen.matches.find(m => m.isFinal);
    assert.strictEqual(final.winnerEntryId, 'e1');
    assert.strictEqual(elim.e2, 3); // lost the final (k=3)
});

test('single elimination third place match', () => {
    const gen = bracket.generate(ids(4), { format: 'single', thirdPlaceMatch: true }, newId);
    const elim = playOut(gen);
    const p3 = gen.matches.find(m => m.bracket === 'P3');
    assert.strictEqual(p3.status, 'done');
    const places = bracket.placements([{ id: 'e1', elimStage: 1e9 }, ...['e2', 'e3', 'e4'].map(id => ({ id, elimStage: elim[id] }))]);
    assert.deepStrictEqual([...places.entries()].sort(), [['e1', 1], ['e2', 2], ['e3', 3], ['e4', 4]]);
});

for (const count of [2, 3, 4, 5, 6, 7, 8, 11, 16, 23]) {
    test(`double elimination completes with ${count} entrants and everyone gets two lives`, () => {
        const gen = bracket.generate(ids(count), { format: 'double', grandFinalReset: true }, newId);
        const losses = {};
        let ready = bracket.resolve(gen.matches);
        let guard = 0;
        // Random-ish winners to exercise every path, including the grand final reset.
        let flip = 0;
        while (ready.length && guard++ < 1000) {
            for (const m of ready) {
                const w = (flip++ % 3 === 0) ? 1 : 0;
                bracket.complete(m, w, 'played');
                const loser = m.slots[1 - w].entryId;
                losses[loser] = (losses[loser] || 0) + 1;
            }
            ready = bracket.resolve(gen.matches);
        }
        assert.ok(gen.matches.every(m => m.status === 'done'), 'all matches finished');
        const gf = gen.matches.find(m => m.bracket === 'GF' && m.round === 1);
        const reset = gen.matches.find(m => m.bracket === 'GF' && m.round === 2);
        const final = reset.result.type === 'skipped' ? gf : reset;
        const champ = final.winnerEntryId;
        for (const e of ids(count)) {
            if (e === champ) assert.ok((losses[e] || 0) <= 1, 'champion lost at most once');
            else assert.strictEqual(losses[e], 2, `${e} was eliminated after exactly two losses`);
        }
    });
}

test('grand final reset only happens when the losers side wins', () => {
    const gen = bracket.generate(ids(4), { format: 'double', grandFinalReset: true }, newId);
    playOut(gen); // top seed wins everything → no reset
    const reset = gen.matches.find(m => m.resetOf);
    assert.strictEqual(reset.result.type, 'skipped');
});

test('disqualified entries turn into byes downstream', () => {
    const gen = bracket.generate(ids(4), { format: 'double' }, newId);
    const dq = new Set();
    let ready = bracket.resolve(gen.matches, id => dq.has(id));
    const first = ready[0];
    dq.add(first.slots[1].entryId);
    bracket.complete(first, 0, 'forfeit');
    ready = bracket.resolve(gen.matches, id => dq.has(id));
    const lb1 = gen.matches.find(m => m.bracket === 'L' && m.round === 1);
    assert.ok(lb1.slots.some(s => s.entryId === bracket.VOID), 'DQ loser does not drop into losers bracket');
});

test('dependents finds the matches fed by a result', () => {
    const gen = bracket.generate(ids(4), { format: 'double' }, newId);
    const wb1 = gen.matches.find(m => m.bracket === 'W' && m.round === 1);
    const deps = bracket.dependents(gen.matches, wb1);
    assert.strictEqual(deps.length, 2); // winners round 2 + losers round 1
});

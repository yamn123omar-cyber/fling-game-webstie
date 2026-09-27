const test = require('node:test');
const assert = require('node:assert');
const duels = require('../server/duels');
const rating = require('../server/rating');

const finish = (d, a, b) => Object.assign(d, { scores: [a, b], winner: a > b ? 0 : 1 });

test('solo best of 3 ends at 2 wins', () => {
    const list = duels.initialDuels('solo', [['a'], ['b']]);
    finish(list[0], 5, 2);
    let ev = duels.evaluate({ mode: 'solo', duels: list, lineups: [['a'], ['b']], bestOf: 3 });
    assert.strictEqual(ev.done, false);
    list.push(ev.add);
    finish(list[1], 5, 4);
    ev = duels.evaluate({ mode: 'solo', duels: list, lineups: [['a'], ['b']], bestOf: 3 });
    assert.deepStrictEqual(ev, { done: true, winnerSide: 0 });
});

test('duo plan: A1 vs B1 and A2 vs B2; 2-0 wins outright', () => {
    const L = [['a1', 'a2'], ['b1', 'b2']];
    const list = duels.initialDuels('duo', L);
    assert.deepStrictEqual(list.map(d => d.players), [['a1', 'b1'], ['a2', 'b2']]);
    finish(list[0], 5, 1);
    finish(list[1], 5, 3);
    assert.deepStrictEqual(duels.evaluate({ mode: 'duo', duels: list, lineups: L, drawRule: 'duels' }), { done: true, winnerSide: 0 });
});

test('duo 1-1 goes to a decider between two players who have not fought', () => {
    const L = [['a1', 'a2'], ['b1', 'b2']];
    for (let pick = 0; pick < 2; pick++) {
        const list = duels.initialDuels('duo', L);
        finish(list[0], 5, 1);
        finish(list[1], 2, 5);
        const ev = duels.evaluate({ mode: 'duo', duels: list, lineups: L, drawRule: 'duels' }, () => pick);
        assert.strictEqual(ev.done, false);
        assert.strictEqual(ev.add.kind, 'decider');
        const pair = ev.add.players.join('|');
        assert.ok(['a1|b2', 'a2|b1'].includes(pair), `fresh pairing, got ${pair}`);
        list.push(ev.add);
        finish(list[2], 1, 5);
        const end = duels.evaluate({ mode: 'duo', duels: list, lineups: L, drawRule: 'duels' });
        assert.strictEqual(end.done, true);
        assert.strictEqual(end.winnerSide, 1);
    }
});

test('team of 1 fights both duels; decider is a rematch', () => {
    const L = [['solo'], ['b1', 'b2']];
    const list = duels.initialDuels('duo', L);
    assert.deepStrictEqual(list.map(d => d.players), [['solo', 'b1'], ['solo', 'b2']]);
    finish(list[0], 5, 3);
    finish(list[1], 4, 5);
    const ev = duels.evaluate({ mode: 'duo', duels: list, lineups: L, drawRule: 'duels' }, () => 1);
    assert.deepStrictEqual(ev.add.players, ['solo', 'b2']);
});

test('draw rule "kills" settles 1-1 on total kills first', () => {
    const L = [['a1', 'a2'], ['b1', 'b2']];
    const list = duels.initialDuels('duo', L);
    finish(list[0], 5, 0);
    finish(list[1], 4, 5);
    const ev = duels.evaluate({ mode: 'duo', duels: list, lineups: L, drawRule: 'kills' });
    assert.strictEqual(ev.done, true);
    assert.strictEqual(ev.winnerSide, 0);
});

test('duel scores cannot tie', () => {
    assert.ok(duels.validateScores([3, 3]));
    assert.strictEqual(duels.validateScores([5, 3]), null);
    assert.ok(duels.validateScores([-1, 3]));
});

test('rating: winners gain, full-team losers lose Elo but never RP', () => {
    const d = rating.playedMatchDeltas([
        { players: [{ id: 'a', elo: 1000, matches: 20 }, { id: 'b', elo: 1000, matches: 20 }], soloTeam: false },
        { players: [{ id: 'c', elo: 1000, matches: 20 }, { id: 'd', elo: 1000, matches: 20 }], soloTeam: false },
    ], 0);
    assert.strictEqual(d.a.elo, 16);
    assert.strictEqual(d.c.elo, -16);
    assert.strictEqual(d.a.rp, 10);
    assert.strictEqual(d.c.rp, 0);
});

test('rating: a team of 1 gains less and loses more (Elo and RP)', () => {
    const vsTeam = (winnerSide) => rating.playedMatchDeltas([
        { players: [{ id: 's', elo: 1000, matches: 20 }], soloTeam: true },
        { players: [{ id: 'c', elo: 1000, matches: 20 }, { id: 'd', elo: 1000, matches: 20 }], soloTeam: false },
    ], winnerSide);
    const win = vsTeam(0).s;
    const loss = vsTeam(1).s;
    assert.strictEqual(win.elo, 12);   // 16 × 0.75
    assert.strictEqual(loss.elo, -20); // 16 × 1.25
    assert.strictEqual(win.rp, 6);     // 10 × 0.6
    assert.strictEqual(loss.rp, -5);
});

test('rating: upsets are worth more RP', () => {
    const d = rating.playedMatchDeltas([
        { players: [{ id: 'low', elo: 1000, matches: 20 }], soloTeam: false },
        { players: [{ id: 'high', elo: 1400, matches: 20 }], soloTeam: false },
    ], 0);
    assert.strictEqual(d.low.rp, 20);
    assert.ok(d.low.elo > 25);
});

test('placement points scale with bracket size and punish solo teams', () => {
    assert.ok(rating.placementPoints(1, 16, false) > rating.placementPoints(1, 4, false));
    assert.ok(rating.placementPoints(1, 8, true) < rating.placementPoints(1, 8, false));
    assert.strictEqual(rating.placementPoints(9, 16, false), 2); // participation only
});

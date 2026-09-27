// Bracket view: columns per round, SVG connector lines, hover highlighting.
import { html, $$, time } from './lib.js';
import { icon } from './icons.js';

const VOID = 'VOID';

export function matchCode(m) {
    if (m.bracket === 'F') return 'FINAL';
    if (m.bracket === 'XL' || m.bracket === 'XR') return `LB-${m.bracket[1]}${m.round}${m.xRound > 1 ? `.${m.xRound}` : ''}-${m.index + 1}`;
    if (m.bracket === 'GF') return m.round === 1 ? 'GF' : 'GF2';
    if (m.bracket === 'P3') return '3RD';
    return `${m.bracket}${m.round}-${m.index + 1}`;
}

function sections(t) {
    const byB = b => t.matches.filter(m => m.bracket === b);
    const rounds = list => {
        const map = new Map();
        for (const m of list) {
            if (!map.has(m.round)) map.set(m.round, []);
            map.get(m.round).push(m);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms.sort((a, b) => a.index - b.index));
    };
    const out = [];
    if (t.format === 'double') {
        out.push({ key: 'W', title: 'Winners bracket', rounds: rounds(byB('W')) });
        if (byB('L').length) out.push({ key: 'L', title: 'Losers bracket', rounds: rounds(byB('L')) });
        out.push({ key: 'GF', title: 'Grand final', rounds: byB('GF').sort((a, b) => a.round - b.round).map(m => [m]) });
    } else {
        out.push({ key: 'W', title: 'Bracket', rounds: rounds(byB('W')) });
        if (byB('P3').length) out.push({ key: 'P3', title: 'Third place', rounds: [byB('P3')] });
    }
    return out;
}

export function renderBracket(t, { myEntryId = null } = {}) {
    if (!t.matches.length) return '';
    const entries = new Map(t.entries.map(e => [e.id, e]));
    const codes = new Map(t.matches.map(m => [m.id, matchCode(m)]));
    const byId = new Map(t.matches.map(m => [m.id, m]));

    const slot = (m, i) => {
        const s = m.slots[i];
        const done = m.status === 'done';
        const score = (done || m.status === 'live') && !(m.result && m.result.type === 'bye') ? m.score[i] : '';
        if (s.entryId === VOID) return html`<div class="b-slot bye"><span class="seed"></span><span class="nm">${m.result && m.result.type === 'skipped' ? '—' : 'BYE'}</span></div>`;
        if (!s.entryId) {
            const src = s.source;
            const from = src.matchId && byId.get(src.matchId);
            const hint = src.type === 'seed' ? `Seed ${src.seed}`
                : from && from.bracket[0] === 'X' && m.bracket[0] !== 'X' ? 'Losers bracket winner'
                : `${src.type === 'winner' ? 'Winner' : 'Loser'} of ${codes.get(src.matchId) || '?'}`;
            return html`<div class="b-slot tbd"><span class="seed"></span><span class="nm">${hint}</span></div>`;
        }
        const e = entries.get(s.entryId);
        const win = done && m.winnerSide === i;
        const lose = done && m.winnerSide !== null && m.winnerSide !== i;
        return html`<div class="b-slot ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${s.entryId === myEntryId ? 'mine' : ''}" data-entry="${s.entryId}">
            <span class="seed mono">${e ? e.seed : ''}</span>
            <span class="nm">${e ? html`${e.tag ? html`<b class="tag" style="color:${e.color || 'var(--accent)'}">${e.tag}</b>` : ''}${e.name}${e.dq ? html` <em class="dq">DQ</em>` : ''}` : '?'}</span>
            <span class="sc mono">${m.result && ['forfeit', 'double_forfeit'].includes(m.result.type) && done ? (win ? 'W' : 'FF') : score}</span>
        </div>`;
    };

    const card = m => {
        const ghost = m.result && ['bye', 'skipped'].includes(m.result.type);
        const mine = myEntryId && m.slots.some(s => s.entryId === myEntryId);
        const top = m.status === 'live' ? html`<span class="b-live">LIVE</span>`
            : m.status === 'ready' ? html`<span class="b-ready">READY</span>`
            : m.status === 'scheduled' && m.scheduledAt ? html`<span class="b-time">${time(m.scheduledAt, 'countdown')}</span>` : '';
        return html`<a class="b-match ${ghost ? 'ghost' : ''} ${mine ? 'mine' : ''} st-${m.status}" data-id="${m.id}" href="${ghost ? '#' : `/m/${m.id}`}" ${ghost ? html`tabindex="-1"` : ''}>
            <div class="b-top"><span class="b-code mono">${matchCode(m)}</span>${m.waiting ? html`<span class="b-flag" title="The second spot goes to the winner of the losers bracket">comeback</span>` : ''}${top}</div>
            ${slot(m, 0)}${slot(m, 1)}
        </a>`;
    };

    if (t.format === 'twosided') return twoSided(t, card);

    return html`<div class="bracket-wrap">${sections(t).map(sec => {
        const tallest = Math.max(...sec.rounds.map(r => r.length));
        return html`<section class="b-section" data-sec="${sec.key}">
            <div class="b-title">${sec.key === 'GF' ? icon('crown') : sec.key === 'L' ? icon('refresh') : icon('trophy')}${sec.title}</div>
            <div class="b-scroll" data-drag>
                <div class="b-cols" style="--rows:${tallest}">
                    <svg class="b-lines" aria-hidden="true"></svg>
                    ${sec.rounds.map(r => html`<div class="b-col">
                        <div class="b-col-head">${r[0].label}</div>
                        <div class="b-col-body">${r.map(card)}</div>
                    </div>`)}
                </div>
            </div>
        </section>`;
    })}</div>`;
}

function byRound(list) {
    const map = new Map();
    for (const m of list) {
        if (!map.has(m.round)) map.set(m.round, []);
        map.get(m.round).push(m);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms.sort((a, b) => a.index - b.index));
}

// Two-sided tree: left side → Final in the middle ← right side, with each
// side's losers bracket (second chances) underneath.
function twoSided(t, card) {
    const of = b => t.matches.filter(m => m.bracket === b);
    const L = byRound(of('L')), R = byRound(of('R'));
    const final = of('F')[0];
    const third = of('P3')[0];
    const tallest = Math.max(1, ...L.map(r => r.length), ...R.map(r => r.length));
    const colHead = r => (r[0].sideFinal ? 'Side final' : `Round ${r[0].round}`);
    const col = r => html`<div class="b-col"><div class="b-col-head">${colHead(r)}</div><div class="b-col-body">${r.map(card)}</div></div>`;
    const champ = t.champion;

    const comebacks = side => {
        const xs = of(`X${side}`);
        if (!xs.length) return '';
        const sideMatches = side === 'L' ? L.flat() : R.flat();
        const rounds = byRound(xs);
        return html`<section class="b-section lb">
            <div class="b-title">${icon('refresh')}Losers bracket · ${side === 'L' ? 'left' : 'right'}</div>
            ${rounds.map(list => {
                const r = list[0].round;
                const target = sideMatches.find(m => m.round === r && m.waiting);
                const cols = new Map();
                for (const m of list) { if (!cols.has(m.xRound)) cols.set(m.xRound, []); cols.get(m.xRound).push(m); }
                return html`<div class="lb-round">
                    <div class="lb-head"><b>Round ${r} losers</b>${target ? html`<span class="dim">winner → <span class="mono accent">${matchCode(target)}</span></span>` : ''}</div>
                    <div class="b-scroll" data-drag><div class="lb-cols">${[...cols.values()].map(ms => html`<div class="b-col"><div class="b-col-body">${ms.sort((a, b) => a.index - b.index).map(card)}</div></div>`)}</div></div>
                </div>`;
            })}
        </section>`;
    };

    return html`<div class="bracket-wrap ts">
        <section class="b-section ts-main">
            <div class="b-scroll ts-scroll" data-drag>
                <div class="ts-board" style="--rows:${tallest}">
                    <svg class="b-lines ts-lines" aria-hidden="true"></svg>
                    <div class="ts-side left">${L.map(col)}</div>
                    <div class="ts-center">
                        <div class="ts-trophy ${champ ? 'won' : ''}">${icon('trophy')}<span>${champ ? 'Champion' : 'Final'}</span>${champ ? html`<b class="display">${champ.name}</b>` : ''}</div>
                        ${final ? html`<div class="ts-final">${card(final)}</div>` : ''}
                        ${third ? html`<div class="ts-third"><div class="b-col-head">3rd place</div>${card(third)}</div>` : ''}
                    </div>
                    <div class="ts-side right">${R.slice().reverse().map(col)}</div>
                </div>
            </div>
        </section>
        ${t.matches.some(m => m.bracket[0] === 'X') ? html`<div class="grid grid-2 lb-grid">${comebacks('L')}${comebacks('R')}</div>` : ''}
    </div>`;
}

// Connectors for the two-sided board: lines run towards the middle.
function drawTwoSided(root) {
    for (const board of $$('.ts-board', root)) {
        const svg = board.querySelector('.ts-lines');
        const z = Number(board.dataset.z || 1);
        const base = board.getBoundingClientRect();
        svg.setAttribute('width', board.scrollWidth);
        svg.setAttribute('height', board.scrollHeight);
        const cards = new Map($$('.b-match', board).map(el => [el.dataset.id, el]));
        let d = '', dHi = '';
        for (const el of cards.values()) {
            const m = el._m;
            if (!m) continue;
            m.slots.forEach((s, i) => {
                if (!s.source || s.source.type !== 'winner') return;
                const src = cards.get(s.source.matchId);
                if (!src) return;
                const a = src.getBoundingClientRect();
                const rows = el.querySelectorAll('.b-slot');
                const b = (rows[i] || el).getBoundingClientRect();
                const rightward = a.left + a.width / 2 < b.left + b.width / 2;
                const x1 = ((rightward ? a.right : a.left) - base.left) / z;
                const x2 = ((rightward ? b.left : b.right) - base.left) / z;
                const y1 = (a.top + a.height / 2 - base.top) / z + 8;
                const y2 = (b.top + b.height / 2 - base.top) / z;
                const xm = x1 + (x2 - x1) / 2;
                const path = `M${x1} ${y1}H${xm}V${y2}H${x2}`;
                if (src.classList.contains('mine') && el.classList.contains('mine')) dHi += path; else d += path;
            });
        }
        svg.innerHTML = `<path d="${d}" class="ln"/><path d="${dHi}" class="ln hi"/>`;
    }
}

// Draw elbow connectors between matches in the same section.
export function drawLines(root) {
    drawTwoSided(root);
    for (const sec of $$('.b-section', root)) {
        const cols = sec.querySelector('.b-cols');
        const svg = sec.querySelector('.b-lines');
        if (!cols || !svg) continue;
        const base = cols.getBoundingClientRect();
        svg.setAttribute('width', cols.scrollWidth);
        svg.setAttribute('height', cols.scrollHeight);
        const cards = new Map($$('.b-match', sec).map(el => [el.dataset.id, el]));
        let d = '';
        let dHi = '';
        for (const el of cards.values()) {
            const m = el._m;
            if (!m) continue;
            m.slots.forEach((s, i) => {
                if (s.source.type !== 'winner') return;
                const src = cards.get(s.source.matchId);
                if (!src) return;
                const a = src.getBoundingClientRect();
                const rows = el.querySelectorAll('.b-slot');
                const b = (rows[i] || el).getBoundingClientRect();
                const x1 = a.right - base.left;
                const y1 = a.top + a.height / 2 - base.top + 8;
                const x2 = b.left - base.left;
                const y2 = b.top + b.height / 2 - base.top;
                const xm = x1 + (x2 - x1) / 2;
                const path = `M${x1} ${y1}H${xm}V${y2}H${x2}`;
                const hot = src.classList.contains('mine') && el.classList.contains('mine');
                if (hot) dHi += path; else d += path;
            });
        }
        svg.innerHTML = `<path d="${d}" class="ln"/><path d="${dHi}" class="ln hi"/>`;
    }
}

export function mountBracket(root, t) {
    const byId = new Map(t.matches.map(m => [m.id, m]));
    for (const el of $$('.b-match', root)) el._m = byId.get(el.dataset.id);
    const redraw = () => requestAnimationFrame(() => drawLines(root));
    redraw();
    window.addEventListener('resize', redraw);
    document.fonts && document.fonts.ready.then(redraw);
    const ro = new ResizeObserver(redraw);
    for (const c of $$('.b-cols, .ts-board', root)) ro.observe(c);

    // Highlight an entrant's path on hover.
    const over = e => {
        const slot = e.target.closest('[data-entry]');
        const id = slot ? slot.dataset.entry : null;
        for (const el of $$('.b-slot.hl', root)) el.classList.remove('hl');
        if (id) for (const el of $$(`.b-slot[data-entry="${CSS.escape(id)}"]`, root)) el.classList.add('hl');
    };
    root.addEventListener('mouseover', over);

    // Drag to pan wide brackets.
    const drags = $$('[data-drag]', root).map(sc => {
        let sx = 0, sl = 0, down = false, moved = false;
        const md = e => { if (e.button !== 0) return; down = true; moved = false; sx = e.clientX; sl = sc.scrollLeft; };
        const mm = e => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; sc.classList.add('dragging'); } sc.scrollLeft = sl - dx; };
        const mu = () => { down = false; sc.classList.remove('dragging'); };
        const click = e => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
        sc.addEventListener('mousedown', md);
        window.addEventListener('mousemove', mm);
        window.addEventListener('mouseup', mu);
        sc.addEventListener('click', click, true);
        return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    });
    root.addEventListener('click', e => { const a = e.target.closest('a.b-match.ghost'); if (a) e.preventDefault(); });

    return () => { ro.disconnect(); window.removeEventListener('resize', redraw); root.removeEventListener('mouseover', over); drags.forEach(f => f()); };
}

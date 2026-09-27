// Bracket, drawn like the old site: left and right sides meet at a golden
// Final in the middle, inside a pan/zoom viewport ("drag to move · scroll to
// zoom"). Losers-bracket matches sit underneath as the Second-Chance Playoff.
import { html, $$ } from './lib.js';

const VOID = 'VOID';

function byRound(list) {
    const map = new Map();
    for (const m of list) {
        if (!map.has(m.round)) map.set(m.round, []);
        map.get(m.round).push(m);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms.sort((a, b) => a.index - b.index));
}

function makeCard(t, myEntryId) {
    const entries = new Map(t.entries.map(e => [e.id, e]));
    const played = m => ['done', 'live'].includes(m.status) && !(m.result && ['bye', 'skipped', 'forfeit', 'double_forfeit'].includes(m.result.type));

    const opp = (m, i) => {
        const s = m.slots[i];
        if (!s || s.entryId === VOID) return html`<div class="opp empty">${m.result && m.result.type === 'skipped' ? '—' : 'BYE'}</div>`;
        if (!s.entryId) return html`<div class="opp empty">TBD</div>`;
        const e = entries.get(s.entryId);
        const done = m.status === 'done';
        const cls = [
            done && m.winnerSide === i ? 'winner' : '',
            done && m.winnerSide !== null && m.winnerSide !== i ? 'loser' : '',
            s.entryId === myEntryId ? 'mine' : '',
        ].join(' ');
        return html`<div class="opp ${cls}" data-entry="${s.entryId}"><span class="nm">${e ? e.name : '?'}</span>${played(m) ? html`<span class="sc">${m.score[i]}</span>` : ''}</div>`;
    };

    return (m, extra = '') => {
        const ghost = m.result && ['bye', 'skipped'].includes(m.result.type);
        return html`<a class="bm ${extra} ${ghost ? 'ghost' : ''} ${m.status === 'live' ? 'live' : ''}" href="${ghost ? '#' : `/m/${m.id}`}" data-id="${m.id}">${opp(m, 0)}${opp(m, 1)}</a>`;
    };
}

const column = (title, list, card) => html`<div class="bround"><div class="bround-title">${title}</div><div class="bmatches">${list.map(m => card(m))}</div></div>`;

function viewport(inner) {
    return html`<div class="bview" data-bview>
        <div class="bview-tools">
            <button type="button" data-z="in" title="Zoom in">＋</button>
            <button type="button" data-z="out" title="Zoom out">－</button>
            <button type="button" data-z="fit" title="Reset view">⟲</button>
        </div>
        <div class="bview-hint">drag to move · scroll to zoom</div>
        <div class="bwrap">${inner}</div>
    </div>`;
}

function finalBlock(final, third, card) {
    return html`<div class="bfinal">
        <div class="bfinal-title">Final</div>
        ${final ? card(final, 'final') : html`<div class="bm final"><div class="opp empty">TBD</div><div class="opp empty">TBD</div></div>`}
        ${third ? html`<div class="bthird-title">3rd place</div>${card(third)}` : ''}
    </div>`;
}

function extrasBlock(sides, card) {
    const withMatches = sides.filter(s => s.matches.length);
    if (!withMatches.length) return '';
    return html`<div class="bextras">
        <div class="bextras-head"><span class="bextras-badge">⚔️ Second-Chance Playoff</span></div>
        <div class="bextras-grid">${withMatches.map(s => html`<div class="bextras-side">
            <div class="bextras-title">${s.title}</div>
            ${byRound(s.matches).map(list => html`<div class="bextras-round">Round ${list[0].round}</div>${list.map(m => card(m, 'playoff'))}`)}
        </div>`)}</div>
    </div>`;
}

export function renderBracket(t, { myEntryId = null } = {}) {
    if (!t.matches.length) return '';
    const card = makeCard(t, myEntryId);
    const of = b => t.matches.filter(m => m.bracket === b);
    const champ = t.status === 'completed' && t.champion ? html`<div class="bchamp"><h2>🎉 CHAMPION 🎉</h2><p>${t.champion.name}</p></div>` : '';

    if (t.format === 'twosided') {
        const L = byRound(of('L')), R = byRound(of('R'));
        const title = r => (r[0].sideFinal ? 'Semi-final' : `Round ${r[0].round}`);
        return html`<div class="bracket-wrap">
            ${viewport(html`
                <div class="bside left">${L.map(r => column(title(r), r, card))}</div>
                ${finalBlock(of('F')[0], of('P3')[0], card)}
                <div class="bside right">${R.map(r => column(title(r), r, card))}</div>`)}
            ${champ}
            ${extrasBlock([{ title: 'Left Bracket', matches: of('XL') }, { title: 'Right Bracket', matches: of('XR') }], card)}
        </div>`;
    }

    // Older single / double elimination tournaments: one side into the final.
    const W = byRound(of('W'));
    const gf = of('GF').sort((a, b) => a.round - b.round);
    return html`<div class="bracket-wrap">
        ${viewport(html`
            <div class="bside left">${(gf.length ? W : W.slice(0, -1)).map(r => column(`Round ${r[0].round}`, r, card))}</div>
            ${finalBlock(gf.length ? gf[gf.length - 1] : (W[W.length - 1] || [])[0], of('P3')[0], card)}`)}
        ${champ}
        ${extrasBlock([{ title: 'Losers Bracket', matches: of('L') }], card)}
    </div>`;
}

// Pan + zoom, like the old "bracket space".
function mountViewport(vp) {
    const wrap = vp.querySelector('.bwrap');
    let z = 1, x = 0, y = 0, touched = false;
    const MIN = 0.3, MAX = 2.8;
    const apply = () => { wrap.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${z})`; };
    const fit = () => {
        wrap.style.transform = 'translate(-50%, -50%) scale(1)';
        const s = Math.min((vp.clientWidth - 40) / (wrap.scrollWidth || 1), (vp.clientHeight - 40) / (wrap.scrollHeight || 1));
        z = Math.max(MIN, Math.min(1.4, s));
        x = 0; y = 0;
        apply();
    };
    const zoomAt = (nz, cx, cy) => {
        nz = Math.max(MIN, Math.min(MAX, nz));
        const r = vp.getBoundingClientRect();
        const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
        x = ox - (ox - x) * (nz / z);
        y = oy - (oy - y) * (nz / z);
        z = nz;
        touched = true;
        apply();
    };
    fit();

    let drag = null, moved = 0;
    const down = e => {
        if (e.button !== 0 || e.target.closest('.bview-tools')) return;
        drag = { sx: e.clientX, sy: e.clientY, x, y };
        moved = 0;
    };
    const move = e => {
        if (!drag) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (moved > 4) { vp.classList.add('grabbing'); x = drag.x + dx; y = drag.y + dy; touched = true; apply(); }
    };
    const up = () => { drag = null; vp.classList.remove('grabbing'); };
    const click = e => {
        if (moved > 4) { e.preventDefault(); e.stopPropagation(); moved = 0; return; }
        const a = e.target.closest('a.bm.ghost');
        if (a) e.preventDefault();
    };
    const wheel = e => { e.preventDefault(); zoomAt(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); };
    const tools = e => {
        const b = e.target.closest('[data-z]');
        if (!b) return;
        const r = vp.getBoundingClientRect();
        if (b.dataset.z === 'fit') { touched = false; fit(); } else zoomAt(z * (b.dataset.z === 'in' ? 1.2 : 1 / 1.2), r.left + r.width / 2, r.top + r.height / 2);
    };
    // Touch: one finger pans, two fingers pinch-zoom.
    let pinch = null;
    const tstart = e => {
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z };
            drag = null;
        } else if (e.touches.length === 1) {
            drag = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, x, y };
            moved = 0;
        }
    };
    const tmove = e => {
        if (pinch && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = e.touches;
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            zoomAt(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        } else if (drag && e.touches.length === 1) {
            e.preventDefault();
            move({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
        }
    };
    const tend = () => { pinch = null; up(); };

    vp.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    vp.addEventListener('click', click, true);
    vp.addEventListener('wheel', wheel, { passive: false });
    vp.addEventListener('click', tools);
    vp.addEventListener('touchstart', tstart, { passive: true });
    vp.addEventListener('touchmove', tmove, { passive: false });
    vp.addEventListener('touchend', tend);
    const ro = new ResizeObserver(() => { if (!touched) fit(); });
    ro.observe(vp);
    document.fonts && document.fonts.ready.then(() => { if (!touched) fit(); });
    return () => {
        ro.disconnect();
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
    };
}

export function mountBracket(root) {
    const stops = $$('[data-bview]', root).map(mountViewport);
    // Hover a player to light up their path.
    const over = e => {
        const el = e.target.closest('[data-entry]');
        const id = el ? el.dataset.entry : null;
        for (const x of $$('.opp.hl', root)) x.classList.remove('hl');
        if (id) for (const x of $$(`.opp[data-entry="${CSS.escape(id)}"]`, root)) x.classList.add('hl');
    };
    root.addEventListener('mouseover', over);
    return () => { stops.forEach(f => f()); root.removeEventListener('mouseover', over); };
}

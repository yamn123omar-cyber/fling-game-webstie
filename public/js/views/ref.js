import { html, on, time } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { entryChip, empty, mStatus, withBusy, toast, userChip } from '../ui.js';

function card(m) {
    const [a, b] = m.entries;
    const mine = m.ref && store.me && m.ref.id === store.me.id;
    return html`<div class="card ref-q ${m.status}" style="--ta:${m.tournament.accent}">
        <div class="row" style="gap:8px">${mStatus(m.status)}<span class="dim ellipsis" style="flex:1">${m.tournament.name} · ${m.label}</span>${m.tournament.mode === 'duo' ? html`<span class="chip blue">Duo</span>` : html`<span class="chip pink">Solo</span>`}</div>
        <div class="ref-vs">${entryChip(a)}<span class="vs">VS</span>${entryChip(b)}</div>
        <div class="row wrap-ok" style="gap:10px;font-size:13px">
            ${m.status === 'scheduled' ? html`<span class="dim">${icon('clock')} ${m.checkins} checked in · deadline ${time(m.deadlineAt, 'countdown')}</span>` : ''}
            ${m.status === 'live' ? html`<span class="dim">Score ${m.score[0]}–${m.score[1]}${m.liveDuel ? ` · duel ${m.liveDuel.n}: ${m.liveDuel.scores[0]}–${m.liveDuel.scores[1]}` : ''}</span>` : ''}
            <span class="spacer"></span>
            ${m.ref ? userChip(m.ref, { size: 'xs', link: false }) : ''}
        </div>
        <div class="row" style="gap:8px">
            ${!m.canRef ? html`<span class="chip">You're playing</span>` : !m.ref ? html`<button class="btn primary sm" data-claim="${m.id}">${icon('whistle')}Claim</button>` : ''}
            <a class="btn sm ${mine ? 'primary' : ''}" href="/m/${m.id}">${mine ? 'Open console' : 'View'} ${icon('arrowRight')}</a>
        </div>
    </div>`;
}

export default {
    title: 'Ref desk',
    auth: 'ref',
    load: () => get('/ref/queue'),
    render(d) {
        const me = store.me.id;
        const mine = d.matches.filter(m => m.ref && m.ref.id === me);
        const needs = d.matches.filter(m => !m.ref && m.status === 'ready');
        const upcoming = d.matches.filter(m => !m.ref && m.status === 'scheduled');
        const others = d.matches.filter(m => m.ref && m.ref.id !== me);
        const col = (title, list, hint) => html`<div class="ref-col"><div class="section-title">${title}<span class="chip">${list.length}</span></div>
            ${list.length ? html`<div class="col">${list.map(card)}</div>` : html`<div class="card dim" style="font-size:14px">${hint}</div>`}</div>`;
        return html`<div class="wrap page">
            <div class="page-head">
                <div><span class="eyebrow">Staff</span><h1>Ref desk</h1>
                <p>Claim a match, join the players' Roblox server, watch every duel and record the kills. You can't referee a match you're playing in.</p></div>
            </div>
            <div class="ref-steps">
                ${[['whistle', 'Claim', 'Take a match that needs a ref.'], ['gamepad', 'Join', 'Players share their server in the match chat.'], ['target', 'Count', 'Tap + for each kill, confirm each duel.'], ['flag', 'Rule', 'Forfeits, reschedules and corrections if needed.']]
                    .map(([ic, t, p]) => html`<div>${icon(ic)}<b>${t}</b><span>${p}</span></div>`)}
            </div>
            ${!d.matches.length ? html`<div class="card" style="margin-top:20px">${empty('whistle', 'No active matches', 'When a tournament is live, matches show up here.')}</div>` : html`
            <div class="ref-board">
                ${col('Your matches', mine, 'Claim a match to start refereeing.')}
                ${col('Needs a referee', needs, 'Every ready match has a ref. Nice!')}
                ${col('Waiting for check-in', upcoming, 'No matches waiting for check-in.')}
            </div>
            ${others.length ? html`<div class="section-title" style="margin-top:26px">Handled by other refs</div><div class="grid grid-3">${others.map(card)}</div>` : ''}`}
        </div>`;
    },
    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-claim]', async (e, b) => {
            if (await withBusy(b, () => post(`/matches/${b.dataset.claim}/claim`))) {
                toast('Match claimed.');
                navigate(`/m/${b.dataset.claim}`);
            }
        });
        ctx.listen('match', () => ctx.reload());
        ctx.listen('refqueue', () => ctx.reload());
        return () => off();
    },
};

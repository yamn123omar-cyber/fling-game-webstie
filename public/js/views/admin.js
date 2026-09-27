// Admin panel: the tournaments you run and the matches waiting for a score.
import { html, on, time } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { userChip, entryChip, empty, tStatus, mStatus, modeChip, withBusy, toast } from '../ui.js';

function scoreCard(m) {
    const [a, b] = m.entries;
    const mine = m.ref && m.ref.id === store.me.id;
    return html`<div class="card ref-q ${m.status}" style="--ta:${m.tournament.accent}">
        <div class="row" style="gap:8px">${mStatus(m.status)}<span class="dim ellipsis" style="flex:1">${m.tournament.name} · ${m.label}</span>${modeChip(m.tournament.mode)}</div>
        <div class="ref-vs">${entryChip(a)}<span class="vs">VS</span>${entryChip(b)}</div>
        <div class="row wrap-ok" style="gap:10px;font-size:13px">
            ${m.status === 'scheduled' ? html`<span class="dim">${icon('clock')} ${m.checkins} checked in · deadline ${time(m.deadlineAt, 'countdown')}</span>` : ''}
            ${m.status === 'live' ? html`<span class="dim">Score ${m.score[0]}–${m.score[1]}${m.liveDuel ? ` · duel ${m.liveDuel.n}: ${m.liveDuel.scores[0]}–${m.liveDuel.scores[1]}` : ''}</span>` : ''}
            <span class="spacer"></span>
            ${m.ref ? userChip(m.ref, { size: 'xs', link: false }) : ''}
        </div>
        <div class="row" style="gap:8px">
            ${!m.canRef ? html`<span class="chip">You're playing</span>` : !m.ref ? html`<button class="btn primary sm" data-claim="${m.id}">${icon('whistle')}Take this match</button>` : ''}
            <a class="btn sm ${mine ? 'primary' : ''}" href="/m/${m.id}">${mine ? 'Score it' : 'View'} ${icon('arrowRight')}</a>
        </div>
    </div>`;
}

export default {
    title: 'Admin panel',
    async load() {
        if (!store.isStaff()) { const e = new Error('Admins only.'); e.status = 403; throw e; }
        const [ts, q] = await Promise.all([get('/tournaments'), get('/ref/queue')]);
        return { tournaments: ts.tournaments.filter(t => t.iAmAdmin || store.isOwner()), matches: q.matches };
    },
    render(d) {
        const me = store.me.id;
        const running = d.tournaments.filter(t => !['completed', 'cancelled'].includes(t.status));
        const past = d.tournaments.filter(t => ['completed', 'cancelled'].includes(t.status));
        const mine = d.matches.filter(m => m.ref && m.ref.id === me);
        const needs = d.matches.filter(m => !m.ref && m.status === 'ready');
        const waiting = d.matches.filter(m => !m.ref && m.status === 'scheduled');
        const col = (title, list, hint) => html`<div class="ref-col"><div class="section-title">${title}<span class="chip">${list.length}</span></div>
            ${list.length ? html`<div class="col">${list.map(scoreCard)}</div>` : html`<div class="card dim" style="font-size:14px">${hint}</div>`}</div>`;
        const row = t => html`<tr>
            <td><a href="/t/${t.id}"><b>${t.name}</b></a></td><td>${tStatus(t.status)}</td><td>${modeChip(t.mode)}</td>
            <td class="dim nowrap">${time(t.startAt)}</td><td class="num">${t.entrantCount}/${t.maxEntrants}</td>
            <td class="num nowrap">${['draft', 'registration', 'checkin'].includes(t.status) ? html`<a class="btn sm" href="/admin/tournaments/${t.id}">${icon('edit')}Edit</a>` : ''} <a class="btn sm ghost" href="/t/${t.id}">Manage</a></td>
        </tr>`;
        return html`<div class="wrap page">
            <div class="page-head row wrap-ok"><div style="flex:1;min-width:240px"><h1>Admin panel</h1></div>
                <a class="btn primary" href="/admin/tournaments/new">${icon('plus')}New tournament</a></div>

            <div class="section-title">Matches to score</div>
            ${!d.matches.length ? html`<div class="card">${empty('whistle', 'Nothing to score')}</div>` : html`
            <div class="ref-board">
                ${col('Yours', mine, 'None')}
                ${col('Ready', needs, 'None')}
                ${col('Check-in', waiting, 'None')}
            </div>`}

            <div class="section-title" style="margin-top:32px">Tournaments you run</div>
            ${running.length ? html`<div class="card flush"><div class="table-scroll"><table class="table">
                <thead><tr><th>Tournament</th><th>Status</th><th>Mode</th><th>Start</th><th class="num">Entrants</th><th></th></tr></thead>
                <tbody>${running.map(row)}</tbody></table></div></div>`
                : html`<div class="card">${empty('trophy', 'None yet', '', html`<a class="btn primary" href="/admin/tournaments/new">${icon('plus')}New tournament</a>`)}</div>`}
            ${past.length ? html`<details class="card flush past-t" style="margin-top:16px"><summary>Finished (${past.length})</summary><div class="table-scroll"><table class="table"><tbody>${past.map(row)}</tbody></table></div></details>` : ''}
        </div>`;
    },
    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-claim]', async (e, b) => {
            if (await withBusy(b, () => post(`/matches/${b.dataset.claim}/claim`))) {
                toast('Match is yours.');
                navigate(`/m/${b.dataset.claim}`);
            }
        });
        ctx.listen('match', () => ctx.reload());
        ctx.listen('refqueue', () => ctx.reload());
        ctx.listen('tournament', () => ctx.reload());
        return () => off();
    },
};

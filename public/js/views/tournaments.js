import { html, on, time } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { setQuery } from '../router.js';
import { icon } from '../icons.js';
import { empty, tStatus, modeChip, formatLabel } from '../ui.js';
import { tournamentCard } from '../cards.js';

const TABS = [
    ['open', 'Upcoming', t => ['registration', 'checkin'].includes(t.status)],
    ['live', 'Live', t => t.status === 'live'],
    ['past', 'Finished', t => ['completed', 'cancelled'].includes(t.status)],
    ['draft', 'Drafts', t => t.status === 'draft'],
];

export default {
    title: 'Tournaments',
    load: () => get('/tournaments'),
    render(d, ctx) {
        const all = d.tournaments;
        const tabs = TABS.filter(([k]) => k !== 'draft' || store.isAdmin());
        const counts = Object.fromEntries(tabs.map(([k, , f]) => [k, all.filter(f).length]));
        let tab = ctx.query.tab;
        if (!tab || !counts.hasOwnProperty(tab)) tab = counts.live ? 'live' : 'open';
        const mode = ['solo', 'duo'].includes(ctx.query.mode) ? ctx.query.mode : 'all';
        const filter = tabs.find(t => t[0] === tab)[2];
        const list = all.filter(filter).filter(t => mode === 'all' || t.mode === mode);
        const featured = all.find(t => t.status === 'live') || all.find(t => t.status === 'checkin') || all.find(t => t.status === 'registration');

        return html`<div class="wrap page">
            <div class="page-head">
                <div><span class="eyebrow">Compete</span><h1>Tournaments</h1><p>Sign up solo or with your duo. Check-in opens before the start — miss it and your spot goes to someone else.</p></div>
                <span class="spacer"></span>
                ${store.isAdmin() ? html`<a class="btn primary" href="/admin/tournaments/new">${icon('plus')}New tournament</a>` : ''}
            </div>

            ${featured ? html`<a class="featured" href="/t/${featured.id}" style="--ta:${featured.accent}">
                <div class="featured-glow"></div>
                <div class="featured-body">
                    <div class="row wrap-ok">${tStatus(featured.status)}${modeChip(featured.mode)}<span class="chip">${formatLabel(featured.format)}</span></div>
                    <h2 class="display">${featured.name}</h2>
                    <div class="row wrap-ok dim" style="gap:18px">
                        <span class="row" style="gap:6px">${icon('calendar')}${time(featured.startAt)}</span>
                        <span class="row" style="gap:6px">${icon('users')}${featured.entrantCount}/${featured.maxEntrants}</span>
                        ${featured.prize ? html`<span class="row" style="gap:6px;color:var(--gold)">${icon('trophy')}${featured.prize}</span>` : ''}
                    </div>
                </div>
                <div class="featured-side">
                    ${featured.status === 'live' ? html`<span class="big-count display">LIVE</span><span class="dim">Watch the bracket</span>`
                        : html`<span class="dim">Starts in</span><span class="big-count display mono">${time(featured.startAt, 'countdown')}</span>`}
                    <span class="btn primary">${featured.myEntry ? 'View' : featured.status === 'live' ? 'Open bracket' : 'Register'} ${icon('arrowRight')}</span>
                </div>
            </a>` : ''}

            <div class="row wrap-ok" style="justify-content:space-between;margin-top:26px">
                <div class="tabs" style="margin:0;border:0">
                    ${tabs.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label}<span class="count">${counts[k]}</span></button>`)}
                </div>
                <div class="seg" data-mode>
                    ${['all', 'solo', 'duo'].map(m => html`<button class="${m === mode ? 'on' : ''}" data-v="${m}">${m === 'all' ? 'All' : m === 'solo' ? 'Solo' : 'Duo'}</button>`)}
                </div>
            </div>
            <hr class="divider" style="margin-top:0">
            ${list.length ? html`<div class="grid grid-3">${list.map(tournamentCard)}</div>`
                : html`<div class="card">${empty('trophy', tab === 'past' ? 'No finished tournaments yet' : tab === 'live' ? 'Nothing live right now' : 'No upcoming tournaments', 'New tournaments get announced here and on Discord.')}</div>`}
        </div>`;
    },
    mount(root, d, ctx) {
        const offs = [
            on(root, 'click', '[data-tab]', (e, b) => { ctx.query.tab = b.dataset.tab; setQuery('tab', b.dataset.tab); ctx.reload(); }),
            on(root, 'click', '[data-mode] button', (e, b) => { ctx.query.mode = b.dataset.v; setQuery('mode', b.dataset.v === 'all' ? null : b.dataset.v); ctx.reload(); }),
        ];
        ctx.listen('tournament', () => ctx.reload());
        return () => offs.forEach(f => f());
    },
};

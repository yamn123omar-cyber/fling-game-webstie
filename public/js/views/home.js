// Home: your next match and the tournaments you can join. Nothing else.
import { html, time } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { empty } from '../ui.js';
import { tournamentCard, matchLine } from '../cards.js';

function nextMatch(m) {
    if (!m) return '';
    const opp = m.entries[1 - m.mySide];
    const soon = m.status === 'scheduled' && Date.now() < new Date(m.scheduledAt).getTime();
    const when = m.status === 'live' ? html`<span class="status live">Live</span>`
        : soon ? html`<span class="mono">${time(m.scheduledAt, 'countdown')}</span>`
        : m.status === 'scheduled' && !m.checkedIn ? html`<b class="accent">Check in now</b>` : html`<span class="dim">Ready</span>`;
    return html`<a class="card link next-card" href="/m/${m.id}">
        <span class="eyebrow">Next match</span>
        <h2 class="display">vs ${opp ? opp.name : 'TBD'}</h2>
        <div class="next-when">${when}</div>
        <span class="btn primary">${icon('swords')}Open</span>
    </a>`;
}

export default {
    title: 'Home',
    load: () => get('/home'),
    render(d) {
        const me = store.me;
        const next = store.myMatches.find(x => ['live', 'ready', 'scheduled'].includes(x.status));
        const list = [...d.upcoming.filter(t => t.myEntry), ...d.upcoming.filter(t => !t.myEntry)].slice(0, 4);
        return html`<div class="wrap page home">
            <h1 class="hello display">Hey, ${me.displayName}</h1>
            ${nextMatch(next)}
            ${d.live.length ? html`<section class="home-block">
                <div class="section-title"><span class="status live">Live</span></div>
                <div class="m-lines">${d.live.slice(0, 3).map(m => matchLine(m))}</div>
            </section>` : ''}
            <section class="home-block">
                <div class="section-title">Tournaments<span class="spacer"></span><a class="more" href="/tournaments">All →</a></div>
                ${list.length ? html`<div class="grid grid-2">${list.map(tournamentCard)}</div>`
                    : html`<div class="card">${empty('calendar', 'No tournaments yet')}</div>`}
            </section>
        </div>`;
    },
    mount(root, d, ctx) {
        ctx.listen('match', () => ctx.reload());
        ctx.listen('tournament', () => ctx.reload());
        ctx.listen('mymatches', () => ctx.reload());
    },
};

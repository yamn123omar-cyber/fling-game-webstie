// My matches: every match room you're in — what's next, then your history.
import { html } from '../lib.js';
import { get } from '../api.js';
import { icon } from '../icons.js';
import { empty } from '../ui.js';
import { matchLine } from '../cards.js';

export default {
    title: 'My matches',
    load: () => get('/me/matches?all=1'),
    render(d) {
        const active = d.matches.filter(m => m.status !== 'done');
        const done = d.matches.filter(m => m.status === 'done').sort((a, b) => (b.completedAt || b.scheduledAt || '').localeCompare(a.completedAt || a.scheduledAt || ''));
        return html`<div class="wrap page">
            <div class="page-head"><h1>My matches</h1></div>
            <section class="home-sec">
                <div class="section-title">Coming up<span class="spacer"></span></div>
                ${active.length ? html`<div class="m-lines">${active.map(m => matchLine(m))}</div>`
                    : html`<div class="card">${empty('swords', 'No matches', '', html`<a class="btn primary" href="/tournaments">${icon('trophy')}Tournaments</a>`)}</div>`}
            </section>
            <section class="home-sec">
                <div class="section-title">Played<span class="spacer"></span></div>
                ${done.length ? html`<div class="m-lines compact">${done.map(m => matchLine(m))}</div>`
                    : html`<div class="card">${empty('clock', 'Nothing yet')}</div>`}
            </section>
        </div>`;
    },
    mount(root, d, ctx) {
        ctx.listen('match', () => ctx.reload());
    },
};

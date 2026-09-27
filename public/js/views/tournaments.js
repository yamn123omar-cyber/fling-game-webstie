// Tournaments: Live / Upcoming / Finished sections with simple cards, like the old site.
import { html, on, time } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { toast, withBusy, confirm } from '../ui.js';
import { registerFlow } from './tournament.js';

const STATUS = { draft: 'Draft', registration: 'Open', checkin: 'Check-in', live: 'Live', completed: 'Finished', cancelled: 'Cancelled' };

function card(t) {
    const joined = Boolean(t.myEntry);
    const canJoin = !joined && !t.iAmAdmin && ['registration', 'checkin'].includes(t.status) && t.entrantCount < t.maxEntrants;
    const pz = t.prizes || {};
    return html`<div class="old-card">
        <div class="old-card-top">
            <a class="old-card-name" href="/t/${t.id}">${t.name}</a>
            <span class="tag tag-${t.status}">${STATUS[t.status] || t.status}</span>
            <span class="tag">${t.mode === 'duo' ? 'Duo' : 'Solo'}</span>
            <span class="spacer"></span>
            ${canJoin ? html`<button class="btn sm go" data-join="${t.id}">Join</button>` : ''}
            ${joined && t.status !== 'completed' ? html`<span class="tag tag-joined">✓ Joined</span>` : ''}
            ${['live', 'completed'].includes(t.status) ? html`<a class="btn sm" href="/bracket/${t.id}">Bracket</a>` : ''}
            ${t.iAmAdmin || store.isOwner() ? html`<a class="btn sm" href="/t/${t.id}">Manage</a>` : ''}
        </div>
        <div class="old-card-meta">${t.status === 'completed' && t.champion ? html`🏆 <b>${t.champion.name}</b>` : html`📅 ${time(t.startAt)}`} · 👥 ${t.entrantCount}/${t.maxEntrants}</div>
        ${pz.first || pz.second || pz.third ? html`<div class="prizes3">
            <div class="p1">🥇<small>1st</small><b>${pz.first || '—'}</b></div>
            <div class="p2">🥈<small>2nd</small><b>${pz.second || '—'}</b></div>
            <div class="p3">🥉<small>3rd</small><b>${pz.third || '—'}</b></div>
        </div>` : ''}
    </div>`;
}

export default {
    title: 'Tournaments',
    load: () => get('/tournaments'),
    render(d) {
        const all = d.tournaments;
        const groups = [
            ['🔴 Live', all.filter(t => t.status === 'live')],
            ['📅 Upcoming', all.filter(t => ['registration', 'checkin', 'draft'].includes(t.status))],
            ['🏁 Finished', all.filter(t => ['completed', 'cancelled'].includes(t.status)).slice(0, 10)],
        ].filter(g => g[1].length);
        return html`<div class="wrap page">
            <h1 class="view-title">Tournaments</h1>
            ${store.isStaff() ? html`<a class="btn primary" style="margin-bottom:22px" href="/admin/tournaments/new">+ New Tournament</a>` : ''}
            ${groups.length ? groups.map(([title, list]) => html`<div class="old-section">${title}</div>${list.map(card)}`)
                : html`<div class="bracket-status">No tournaments yet</div>`}
        </div>`;
    },
    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-join]', async (e, b) => {
            const res = await withBusy(b, async () => {
                const { tournament } = await get(`/tournaments/${b.dataset.join}`);
                if (tournament.mode === 'solo' && !(await confirm(`Join ${tournament.name}?`, '', { yes: 'Join' }))) return null;
                return registerFlow(tournament);
            });
            if (res) { toast("You're in!"); ctx.reload(); store.refreshMe(); }
        });
        ctx.listen('tournament', () => ctx.reload());
        return () => off();
    },
};

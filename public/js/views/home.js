// My Stats — the first page after logging in, like the old site.
import { html, time } from '../lib.js';
import { store } from '../store.js';
import { tierName } from '../ui.js';

const TIER_ICON = { Bronze: '🥉', Silver: '🥈', Gold: '🥇', Platinum: '💠', Diamond: '💎', Champion: '👑' };

function nextMatch(m) {
    if (!m) return '';
    const opp = m.entries[1 - m.mySide];
    const soon = m.status === 'scheduled' && Date.now() < new Date(m.scheduledAt).getTime();
    const when = m.status === 'live' ? 'LIVE now'
        : soon ? html`in <b class="mono">${time(m.scheduledAt, 'countdown')}</b>`
        : m.status === 'scheduled' && !m.checkedIn ? html`<b>Check in now!</b>` : 'Ready';
    return html`<a class="next-strip" href="/m/${m.id}">⚔️ <span>Next match vs <b>${opp ? opp.name : 'TBD'}</b> — ${when}</span><span class="go">Open →</span></a>`;
}

export default {
    title: 'My Stats',
    render() {
        const s = store.me.stats;
        const wins = s.solo.wins + s.duo.wins, losses = s.solo.losses + s.duo.losses;
        const rate = wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : '—';
        const elo = s.solo.elo;
        const tier = tierName(elo);
        const next = store.myMatches.find(x => ['live', 'ready', 'scheduled'].includes(x.status));
        return html`<div class="wrap page">
            <h1 class="view-title">My Stats</h1>
            ${nextMatch(next)}
            <div class="old-stats">
                <div class="old-stat"><span>Wins</span><b>${wins}</b></div>
                <div class="old-stat"><span>Losses</span><b>${losses}</b></div>
                <div class="old-stat"><span>Win rate</span><b>${rate}</b></div>
                <div class="old-stat"><span>Elo</span><b class="sm">${elo}</b></div>
                <div class="old-stat"><span>Tournament wins</span><b class="sm">${s.solo.titles + s.duo.titles}</b></div>
                <div class="old-stat wide"><span>Tier</span><b class="sm">${TIER_ICON[tier] || ''} ${tier}</b></div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        ctx.listen('mymatches', () => ctx.reload());
        ctx.listen('me', () => ctx.reload());
    },
};

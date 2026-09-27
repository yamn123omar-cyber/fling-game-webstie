// Leaderboard: one simple table, like the old site.
import { html, on, pct, fmtInt } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { setQuery } from '../router.js';

const MEDAL = ['🥇', '🥈', '🥉'];

export default {
    title: 'Leaderboard',
    load: ctx => get(`/leaderboard?mode=${ctx.query.mode === 'duo' ? 'duo' : 'solo'}&sort=elo`),
    render(d) {
        const meId = store.me && store.me.id;
        return html`<div class="wrap page">
            <div class="bracket-head">
                <h1>🏆 Leaderboard</h1><span class="spacer"></span>
                <div class="seg" data-q="mode">${[['solo', 'Solo'], ['duo', 'Duo']].map(([k, l]) => html`<button class="${d.mode === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div>
            </div>
            ${!d.rows.length ? html`<div class="bracket-status">Nobody on the board yet</div>` : html`
            <div class="table-scroll"><table class="old-table">
                <thead><tr><th>Rank</th><th>Player</th><th>Elo</th><th>W / L</th><th>Win Rate</th><th>Pts</th></tr></thead>
                <tbody>${d.rows.map((r, i) => html`<tr class="${r.user.id === meId ? 'me' : ''}">
                    <td class="rank">${i < 3 ? MEDAL[i] : `#${i + 1}`}</td>
                    <td><a href="/u/${encodeURIComponent(r.user.username)}"><b>${r.user.displayName}</b></a></td>
                    <td class="elo">${r.elo}</td>
                    <td>${r.wins}W / ${r.losses}L</td>
                    <td class="${r.winRate >= 0.5 ? 'good' : ''}">${r.wins + r.losses ? pct(r.winRate) : '—'}</td>
                    <td>${fmtInt(r.rp)}</td>
                </tr>`)}</tbody></table></div>`}
        </div>`;
    },
    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-q] button', (e, b) => {
            ctx.query.mode = b.dataset.v;
            setQuery('mode', b.dataset.v);
            ctx.reload();
        });
        return () => off();
    },
};

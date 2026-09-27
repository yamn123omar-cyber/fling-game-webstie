import { html, on, pct, kd, fmtInt } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { setQuery } from '../router.js';
import { icon } from '../icons.js';
import { avatar, tier, empty, sparkline, userChip } from '../ui.js';

export default {
    title: 'Leaderboard',
    load: ctx => get(`/leaderboard?mode=${ctx.query.mode === 'duo' ? 'duo' : 'solo'}&sort=${ctx.query.sort === 'rp' ? 'rp' : 'elo'}`),
    render(d) {
        const rows = d.rows;
        const top = rows.slice(0, 3);
        const rest = rows.slice(3);
        const meId = store.me && store.me.id;
        const val = r => (d.sort === 'rp' ? `${fmtInt(r.rp)} RP` : r.elo);
        return html`<div class="wrap page">
            <div class="page-head">
                <div><h1>Leaderboard</h1></div>
                <span class="spacer"></span>
                <div class="col" style="gap:8px;align-items:flex-end">
                    <div class="seg big" data-q="mode">${[['solo', 'Solo 1v1'], ['duo', 'Duo 2v2']].map(([k, l]) => html`<button class="${d.mode === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div>
                    <div class="seg" data-q="sort">${[['elo', 'By Elo'], ['rp', 'By ranking points']].map(([k, l]) => html`<button class="${d.sort === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div>
                </div>
            </div>
            ${!rows.length ? html`<div class="card">${empty('chart', 'Nobody on the board yet', 'Play a tournament match to get ranked.', html`<a class="btn primary" href="/tournaments">Find a tournament</a>`)}</div>` : html`
            <div class="lb-podium">${[1, 0, 2].map(i => top[i] ? html`<a class="lb-pod p${i + 1}" href="/u/${encodeURIComponent(top[i].user.username)}">
                <span class="lb-place display">${i + 1}</span>
                ${avatar(top[i].user, 'lg')}
                <b class="ellipsis">${top[i].user.displayName}</b>
                ${tier(top[i].elo)}
                <span class="lb-val display">${val(top[i])}</span>
                <span class="dim" style="font-size:13px">${top[i].wins}W · ${top[i].losses}L${top[i].titles ? html` · ${icon('crown')}${top[i].titles}` : ''}</span>
            </a>` : html`<div></div>`)}</div>
            ${rest.length ? html`<div class="card flush" style="margin-top:20px"><div class="table-scroll"><table class="table lb-table">
                <thead><tr><th>#</th><th>Player</th><th>Rank</th><th class="num">Elo</th><th class="num">RP</th><th class="num">W–L</th><th class="num">Win %</th><th class="num">K/D</th><th class="num">Titles</th><th>Form</th></tr></thead>
                <tbody>${rest.map(r => html`<tr class="${r.user.id === meId ? 'mine-row' : ''}">
                    <td class="mono dim">${r.rank}</td>
                    <td>${userChip(r.user, { sub: r.provisional ? 'Provisional' : null })}</td>
                    <td>${tier(r.elo)}</td>
                    <td class="num"><b>${r.elo}</b></td>
                    <td class="num">${fmtInt(r.rp)}</td>
                    <td class="num">${r.wins}–${r.losses}</td>
                    <td class="num">${pct(r.winRate)}</td>
                    <td class="num">${kd(r.kills, r.deaths)}</td>
                    <td class="num">${r.titles || ''}</td>
                    <td>${sparkline(r.trend, { w: 90, h: 26, fill: false })}${r.streak >= 3 ? html`<span class="streak" title="${r.streak} wins in a row">${icon('fire')}${r.streak}</span>` : ''}</td>
                </tr>`)}</tbody></table></div></div>` : ''}`}
        </div>`;
    },
    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-q] button', (e, b) => {
            const k = b.closest('[data-q]').dataset.q;
            ctx.query[k] = b.dataset.v;
            setQuery(k, b.dataset.v);
            ctx.reload();
        });
        return () => off();
    },
};

import { html, $, on, ordinal, shortDate, time } from '../lib.js';
import { get, patch } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { userChip, empty, toast, withBusy, tier } from '../ui.js';
import { mountChat } from '../chat.js';

export default {
    title: d => d.team.name,
    load: ctx => get(`/teams/${ctx.params.id}`),
    render(d) {
        const t = d.team;
        const member = store.me && t.members.some(m => m.id === store.me.id);
        const avg = t.members.length ? Math.round(t.members.reduce((a, m) => a + m.elo.duo, 0) / t.members.length) : 1000;
        const total = d.record.wins + d.record.losses;
        return html`<div class="wrap page" style="--c:${t.color}">
            <div class="team-hero">
                <span class="team-badge xl display" style="--c:${t.color}">${t.tag || t.name.slice(0, 2).toUpperCase()}</span>
                <div>
                    <span class="eyebrow">${t.disbanded ? 'Disbanded team' : 'Duo team'}</span>
                    <h1 class="display">${t.name}</h1>
                    <div class="row wrap-ok dim" style="gap:14px;margin-top:6px">${tier(avg, true)}<span>Formed ${shortDate(t.createdAt)}</span></div>
                </div>
                <span class="spacer"></span>
                <div class="team-record">
                    <div class="stat"><b>${d.record.wins}–${d.record.losses}</b><span>Record</span></div>
                    <div class="stat"><b>${total ? Math.round((d.record.wins / total) * 100) : 0}%</b><span>Win rate</span></div>
                    <div class="stat"><b>${d.tournaments.length}</b><span>Events</span></div>
                </div>
            </div>
            <div class="split" style="margin-top:24px">
                <div class="col" style="gap:18px">
                    <div class="card"><div class="card-head"><h3>Roster</h3></div>
                        <div class="list">${t.members.map(m => html`<div class="list-item">${userChip(m, { size: 'md', sub: m.id === t.captainId ? 'Captain' : 'Member' })}<span class="spacer"></span>${tier(m.elo.duo, true)}</div>`)}</div>
                        ${member ? html`<form class="row wrap-ok" data-form="edit" style="margin-top:16px;gap:8px">
                            <input class="input" name="name" value="${t.name}" maxlength="24" style="flex:2;min-width:160px">
                            <input class="input" name="tag" value="${t.tag || ''}" maxlength="4" placeholder="TAG" style="flex:1;min-width:80px;text-transform:uppercase">
                            <button class="btn" type="submit">Save</button></form>` : ''}
                    </div>
                    <div class="card"><div class="card-head"><h3>Tournament history</h3></div>
                        ${d.tournaments.length ? html`<div class="list">${d.tournaments.map(x => html`<a class="list-item" href="/t/${x.id}">
                            <span class="place ${x.place && x.place <= 3 ? `p${x.place}` : ''}">${x.place ? ordinal(x.place) : x.status === 'live' ? 'LIVE' : '—'}</span>
                            <b class="ellipsis" style="flex:1">${x.name}</b><span class="dim">${x.entrants} teams · ${time(x.startAt, 'ago')}</span></a>`)}</div>`
                            : empty('trophy', 'No tournaments yet', member ? 'Register this team for a duo tournament.' : '')}
                    </div>
                </div>
                <div>${member ? html`<div class="chat-slot" data-keep="teamchat-${t.id}"></div>` : html`<div class="card">${empty('lock', 'Team chat is private', 'Only team members can see it.')}</div>`}</div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        const t = d.team;
        const chat = mountChat($('.chat-slot', root), `team:${t.id}`, { height: '520px', title: html`${icon('users')}<b>Team chat</b>` });
        const off = on(root, 'submit', '[data-form=edit]', async (e, f) => {
            e.preventDefault();
            if (await withBusy($('button', f), () => patch(`/teams/${t.id}`, { name: f.name.value, tag: f.tag.value }))) { toast('Team updated.'); ctx.reload(); }
        });
        return ({ leaving }) => { off(); if (leaving && chat) chat.destroy(); };
    },
};

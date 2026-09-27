import { html, $, on, time } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { avatar, userChip, empty, toast, withBusy, confirm, modal } from '../ui.js';

const COLORS = ['#c4ff4d', '#4dd8ff', '#ff5ea8', '#ffb84d', '#9b7bff', '#3ddc97', '#ff6b4d', '#f5f5f5'];

function teamCard(t) {
    const full = t.members.length >= 2;
    return html`<div class="card team-card" style="--c:${t.color}">
        <div class="team-card-top">
            <span class="team-badge display" style="--c:${t.color}">${t.tag || t.name.slice(0, 2).toUpperCase()}</span>
            <div class="ellipsis" style="flex:1"><a href="/team/${t.id}"><h3 class="ellipsis">${t.name}</h3></a><span class="dim" style="font-size:13px">${full ? 'Ready for duo tournaments' : 'Needs one more player'}</span></div>
            ${full ? html`<span class="chip green">${icon('check')}Full</span>` : html`<span class="chip gold">1/2</span>`}
        </div>
        <div class="list">
            ${t.members.map(m => html`<div class="list-item">${userChip(m, { sub: m.id === t.captainId ? 'Captain' : 'Member' })}</div>`)}
            ${t.invites.map(i => html`<div class="list-item">${userChip(i.to, { sub: 'Invited' })}<span class="spacer"></span><button class="btn ghost sm" data-act="uninvite" data-id="${i.id}">Cancel</button></div>`)}
        </div>
        ${!full && !t.invites.length ? html`<form class="input-group" data-form="invite" data-team="${t.id}" style="margin-top:12px">
            <input class="input" name="username" placeholder="Invite by username" list="friend-list" autocomplete="off"><button class="btn primary" type="submit">${icon('userPlus')}Invite</button></form>` : ''}
        <div class="row" style="margin-top:14px">
            <a class="btn sm" href="/team/${t.id}">${icon('eye')}View</a>
            <a class="btn sm" href="/chat/team%3A${t.id}">${icon('chat')}Team chat</a>
            <span class="spacer"></span>
            <button class="btn ghost sm" data-act="leave" data-id="${t.id}" data-name="${t.name}">Leave</button>
        </div>
    </div>`;
}

export default {
    title: 'Teams',
    auth: true,
    async load() {
        const [mine, friends] = await Promise.all([get('/teams/mine'), get('/friends')]);
        return { ...mine, friends: friends.friends };
    },
    render(d) {
        return html`<div class="wrap page">
            <div class="page-head">
                <div><span class="eyebrow">Duo play</span><h1>Your teams</h1><p>A team is two players. Make one with a friend and register it for any duo tournament. You can be on several teams.</p></div>
                <span class="spacer"></span>
                <button class="btn primary" data-act="create">${icon('plus')}New team</button>
            </div>
            <datalist id="friend-list">${d.friends.map(f => html`<option value="${f.username}">${f.displayName}</option>`)}</datalist>
            ${d.invites.length ? html`<div class="section-title">Invites for you</div>
                <div class="grid grid-2" style="margin-bottom:26px">${d.invites.map(i => html`<div class="card invite-card" style="--c:${i.team.color}">
                    <span class="team-badge display" style="--c:${i.team.color}">${i.team.tag || i.team.name.slice(0, 2).toUpperCase()}</span>
                    <div style="flex:1;min-width:0"><b class="ellipsis">${i.team.name}</b><div class="dim" style="font-size:13px">${i.from.displayName} invited you ${time(i.at, 'ago')}</div></div>
                    <button class="btn primary sm" data-act="accept" data-id="${i.id}">Join</button>
                    <button class="btn ghost sm" data-act="decline" data-id="${i.id}">Decline</button>
                </div>`)}</div>` : ''}
            ${d.teams.length ? html`<div class="grid grid-3">${d.teams.map(teamCard)}</div>`
                : html`<div class="card">${empty('users', 'No teams yet', 'Create a team, invite a friend, and you are ready for duo tournaments.', html`<button class="btn primary" data-act="create">${icon('plus')}Create a team</button>`)}</div>`}
            ${d.friends.length ? html`<div class="section-title" style="margin-top:34px">Quick team-up with a friend</div>
                <div class="friend-strip">${d.friends.slice(0, 12).map(f => html`<button class="friend-pill" data-act="quick" data-user="${f.username}" data-name="${f.displayName}">${avatar(f, 'sm', { online: true })}<span>${f.displayName}</span>${icon('plus')}</button>`)}</div>` : ''}
        </div>`;
    },
    mount(root, d, ctx) {
        const createModal = (invite = '', name = '') => modal({
            title: 'Create a team',
            text: 'Duo tournaments need two players. You can invite your partner now or later.',
            body: html`<div class="form-grid">
                <label class="field full"><span>Team name</span><input class="input" name="name" maxlength="24" value="${name}" placeholder="e.g. Ragdoll Rangers"></label>
                <label class="field"><span>Tag <small>(2–4 letters, optional)</small></span><input class="input" name="tag" maxlength="4" placeholder="RGR" style="text-transform:uppercase"></label>
                <label class="field"><span>Invite partner</span><input class="input" name="invite" value="${invite}" placeholder="Username (optional)" list="friend-list"></label>
                <div class="field full"><span>Colour</span><div class="swatches">${COLORS.map((c, i) => html`<label><input type="radio" name="color" value="${c}" ${i === 0 ? 'checked' : ''} hidden><span class="swatch" style="background:${c};display:block"></span></label>`)}</div></div>
            </div><div class="form-error"></div>`,
            onMount(el) {
                el.addEventListener('change', e => {
                    if (e.target.name === 'color') el.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.previousElementSibling.checked));
                });
                el.querySelector('.swatch').classList.add('on');
            },
            actions: [{ label: 'Cancel', cls: 'ghost', value: null }, {
                label: 'Create team', cls: 'primary', handler: async el => {
                    const f = n => el.querySelector(`[name=${n}]`);
                    return post('/teams', { name: f('name').value, tag: f('tag').value, color: el.querySelector('[name=color]:checked').value, invite: f('invite').value.trim() || undefined });
                },
            }],
        });
        const offs = [
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                if (a === 'create' && await createModal()) { toast('Team created!'); ctx.reload(); }
                if (a === 'quick') {
                    const nm = `${store.me.displayName} & ${el.dataset.name}`.slice(0, 24);
                    if (await createModal(el.dataset.user, nm)) { toast(`Invite sent to ${el.dataset.name}`); ctx.reload(); }
                }
                if (a === 'accept' && await withBusy(el, () => post(`/team-invites/${el.dataset.id}/accept`))) { toast('Welcome to the team!'); ctx.reload(); }
                if (a === 'decline' && await withBusy(el, () => post(`/team-invites/${el.dataset.id}/decline`))) ctx.reload();
                if (a === 'uninvite' && await withBusy(el, () => post(`/team-invites/${el.dataset.id}/cancel`))) ctx.reload();
                if (a === 'leave' && await confirm(`Leave ${el.dataset.name}?`, 'If you are the last member the team is disbanded. Tournament entries you already made stay.', { yes: 'Leave team', danger: true })) {
                    if (await withBusy(el, () => post(`/teams/${el.dataset.id}/leave`))) ctx.reload();
                }
            }),
            on(root, 'submit', '[data-form=invite]', async (e, f) => {
                e.preventDefault();
                const res = await withBusy($('button', f), () => post(`/teams/${f.dataset.team}/invites`, { username: f.username.value.trim() }));
                if (res) { toast('Invite sent.'); ctx.reload(); }
            }),
        ];
        ctx.listen('teams', () => ctx.reload());
        return () => offs.forEach(f => f());
    },
};

// Players & friends: everyone on the site, your friends, and friend requests.
import { html, on, ago, debounce } from '../lib.js';
import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { navigate, setQuery } from '../router.js';
import { avatar, roleTag, toast, withBusy, confirm } from '../ui.js';

const isOnline = u => u.online || store.online.has(u.id);

function action(u) {
    if (u.friend) return html`<button class="btn sm" data-act="dm" data-id="${u.id}">Message</button>`;
    if (u.requestReceived) return html`<button class="btn sm go" data-act="accept" data-id="${u.requestReceived}">Accept</button>`;
    if (u.requestSent) return html`<button class="btn sm ghost" data-act="cancel" data-id="${u.requestSent}">Requested</button>`;
    return html`<button class="btn sm" data-act="add" data-user="${u.username}">+ Add</button>`;
}

function playerCard(u, extra = '') {
    return html`<div class="old-player">
        <a class="op-top" href="/u/${encodeURIComponent(u.username)}">${avatar(u, 'md', { online: true })}<span class="op-name"><b>${u.displayName}</b>${roleTag(u)}</span></a>
        <div class="op-sub">${isOnline(u) ? html`<span class="on">● Online</span>` : u.lastSeenAt ? `Seen ${ago(u.lastSeenAt)}` : ''}</div>
        <div class="op-actions">${extra || action(u)}</div>
    </div>`;
}

export default {
    title: 'Players',
    async load(ctx) {
        const [players, friends] = await Promise.all([get(`/players?q=${encodeURIComponent(ctx.query.q || '')}`), get('/friends')]);
        return { ...friends, players: players.players };
    },
    render(d, ctx) {
        const tab = ['all', 'friends', 'requests'].includes(ctx.query.tab) ? ctx.query.tab : 'all';
        const friends = d.friends.map(f => ({ ...f, friend: true }));
        return html`<div class="wrap page">
            <h1 class="view-title">Players</h1>
            <div class="pill-tabs">
                <button class="${tab === 'all' ? 'on' : ''}" data-tab="all">All Players</button>
                <button class="${tab === 'friends' ? 'on' : ''}" data-tab="friends">Friends</button>
                <button class="${tab === 'requests' ? 'on' : ''}" data-tab="requests">Requests${d.incoming.length ? html` <span class="badge-dot">${d.incoming.length}</span>` : ''}</button>
            </div>
            ${tab === 'all' ? html`<input class="input old-search" data-search value="${ctx.query.q || ''}" placeholder="Search players..." autocomplete="off">
                ${d.players.length ? html`<div class="player-grid">${d.players.map(u => playerCard(u))}</div>` : html`<div class="bracket-status">No players found</div>`}` : ''}
            ${tab === 'friends' ? (friends.length ? html`<div class="player-grid">${friends.map(f => playerCard(f, html`<button class="btn sm" data-act="dm" data-id="${f.id}">Message</button><button class="btn sm" data-act="team" data-user="${f.username}" data-name="${f.displayName}">Team up</button><button class="btn sm ghost" data-act="remove" data-id="${f.id}" data-name="${f.displayName}" title="Remove">✕</button>`))}</div>`
                : html`<div class="bracket-status">No friends yet</div>`) : ''}
            ${tab === 'requests' ? html`
                ${d.incoming.length ? html`<div class="player-grid">${d.incoming.map(r => playerCard(r.user, html`<button class="btn sm go" data-act="accept" data-id="${r.id}">Accept</button><button class="btn sm ghost" data-act="decline" data-id="${r.id}">Decline</button>`))}</div>` : html`<div class="bracket-status">No requests</div>`}
                ${d.outgoing.length ? html`<div class="old-section" style="margin-top:26px">Sent</div><div class="player-grid">${d.outgoing.map(r => playerCard(r.user, html`<button class="btn sm ghost" data-act="cancel" data-id="${r.id}">Cancel</button>`))}</div>` : ''}` : ''}
        </div>`;
    },
    mount(root, d, ctx) {
        const search = debounce(q => { setQuery('q', q || null); ctx.query.q = q; ctx.reload(); }, 250);
        const offs = [
            on(root, 'click', '[data-tab]', (e, b) => { setQuery('tab', b.dataset.tab === 'all' ? null : b.dataset.tab); ctx.query.tab = b.dataset.tab; ctx.reload(); }),
            on(root, 'input', '[data-search]', (e, i) => search(i.value.trim())),
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                const id = el.dataset.id;
                if (a === 'add') {
                    const res = await withBusy(el, () => post('/friends/requests', { username: el.dataset.user }));
                    if (res) toast(res.status === 'friends' ? `You're now friends with ${el.dataset.user}!` : `Friend request sent to ${el.dataset.user}.`);
                }
                if (a === 'accept' && await withBusy(el, () => post(`/friends/requests/${id}/accept`))) toast('Friend added!');
                if (a === 'decline') await withBusy(el, () => post(`/friends/requests/${id}/decline`));
                if (a === 'cancel') await withBusy(el, () => post(`/friends/requests/${id}/cancel`));
                if (a === 'remove') {
                    if (!(await confirm(`Remove ${el.dataset.name} as a friend?`, '', { yes: 'Remove', danger: true }))) return;
                    await withBusy(el, () => del(`/friends/${id}`));
                }
                if (a === 'dm') { const r = await withBusy(el, () => get(`/chat/dm/${id}`)); if (r) navigate(`/chat/${encodeURIComponent(r.channelId)}`); return; }
                if (a === 'team') {
                    const nm = `${store.me.displayName} & ${el.dataset.name}`.slice(0, 24);
                    const r = await withBusy(el, () => post('/teams', { name: nm, invite: el.dataset.user }));
                    if (r) toast(`Team "${r.team.name}" created — invite sent!`, { link: '/teams', linkText: 'My team' });
                    return;
                }
                ctx.reload();
                store.refreshMe();
            }),
        ];
        // Keep the cursor in the search box across live re-renders.
        const input = root.querySelector('[data-search]');
        if (input && ctx.query.q) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        ctx.listen('friends', () => ctx.reload());
        return () => offs.forEach(f => f());
    },
};

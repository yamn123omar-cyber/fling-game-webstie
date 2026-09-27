// Players & friends: everyone on the site, your friends, and friend requests.
import { html, on, time, ago, debounce } from '../lib.js';
import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { navigate, setQuery } from '../router.js';
import { icon } from '../icons.js';
import { userChip, empty, toast, withBusy, confirm, tier } from '../ui.js';

const isOnline = u => u.online || store.online.has(u.id);

function relationButtons(u) {
    if (u.friend) return html`<button class="btn sm" data-act="dm" data-id="${u.id}">${icon('chat')}<span class="hide-sm">Message</span></button>`;
    if (u.requestReceived) return html`<button class="btn primary sm" data-act="accept" data-id="${u.requestReceived}">${icon('userCheck')}Accept</button>`;
    if (u.requestSent) return html`<button class="btn ghost sm" data-act="cancel" data-id="${u.requestSent}">Requested · cancel</button>`;
    return html`<button class="btn sm" data-act="add" data-user="${u.username}">${icon('userPlus')}<span class="hide-sm">Add friend</span></button>`;
}

export default {
    title: 'Players',
    async load(ctx) {
        const [players, friends] = await Promise.all([get(`/players?q=${encodeURIComponent(ctx.query.q || '')}`), get('/friends')]);
        return { ...friends, players: players.players };
    },
    render(d, ctx) {
        const tab = ['all', 'friends', 'requests'].includes(ctx.query.tab) ? ctx.query.tab : 'all';
        const onlineFriends = d.friends.filter(isOnline).length;
        return html`<div class="wrap page">
            <div class="page-head"><h1>Players & friends</h1></div>
            <div class="tabs" role="tablist">
                <button class="${tab === 'all' ? 'on' : ''}" data-tab="all">${icon('users')}All players<span class="count">${d.players.length}</span></button>
                <button class="${tab === 'friends' ? 'on' : ''}" data-tab="friends">${icon('userCheck')}Friends<span class="count">${d.friends.length}</span></button>
                <button class="${tab === 'requests' ? 'on' : ''}" data-tab="requests">${icon('bell')}Requests${d.incoming.length ? html`<span class="badge-dot">${d.incoming.length}</span>` : ''}</button>
            </div>

            ${tab === 'all' ? html`<div class="card">
                <div class="search-row">${icon('search')}<input class="input" data-search value="${ctx.query.q || ''}" placeholder="Search by username…" autocomplete="off" aria-label="Search players"></div>
                ${d.players.length ? html`<div class="list">${d.players.map(u => html`<div class="list-item friend-row">
                    ${userChip(u, { size: 'md', sub: isOnline(u) ? 'Online' : u.lastSeenAt ? `Seen ${ago(u.lastSeenAt)}` : '' })}
                    <span class="spacer"></span>
                    <span class="hide-sm">${tier(u.elo.solo)}</span>
                    ${u.friend ? html`<span class="chip green hide-sm">${icon('check')}Friend</span>` : ''}
                    ${relationButtons(u)}
                </div>`)}</div>` : empty('search', 'No players found')}
            </div>` : ''}

            ${tab === 'friends' ? html`<div class="card">
                <div class="card-head"><h3>Your friends</h3><span class="spacer"></span>${onlineFriends ? html`<span class="chip green">${onlineFriends} online</span>` : ''}</div>
                ${d.friends.length ? html`<div class="list">${d.friends.map(f => html`<div class="list-item friend-row">
                    ${userChip(f, { size: 'md', sub: isOnline(f) ? 'Online' : `Seen ${ago(f.lastSeenAt)}` })}
                    <span class="spacer"></span>
                    <span class="hide-sm">${tier(f.elo.solo)}</span>
                    <button class="btn sm" data-act="dm" data-id="${f.id}">${icon('chat')}<span class="hide-sm">Message</span></button>
                    <button class="btn sm" data-act="team" data-user="${f.username}" data-name="${f.displayName}">${icon('users')}<span class="hide-sm">Team up</span></button>
                    <button class="btn ghost icon sm" data-act="remove" data-id="${f.id}" data-name="${f.displayName}" title="Remove friend">${icon('x')}</button>
                </div>`)}</div>` : empty('users', 'No friends yet', '', html`<button class="btn primary" data-tab="all">${icon('search')}Find players</button>`)}
            </div>` : ''}

            ${tab === 'requests' ? html`<div class="grid grid-2">
                <div class="card"><div class="card-head"><h3>Received</h3></div>
                    ${d.incoming.length ? html`<div class="list">${d.incoming.map(r => html`<div class="list-item">${userChip(r.user, { sub: time(r.at, 'ago') })}<span class="spacer"></span>
                        <button class="btn primary sm" data-act="accept" data-id="${r.id}">Accept</button><button class="btn ghost sm" data-act="decline" data-id="${r.id}" title="Decline">${icon('x')}</button></div>`)}</div>`
                        : empty('bell', 'No requests')}
                </div>
                <div class="card"><div class="card-head"><h3>Sent</h3></div>
                    ${d.outgoing.length ? html`<div class="list">${d.outgoing.map(r => html`<div class="list-item">${userChip(r.user)}<span class="spacer"></span><button class="btn ghost sm" data-act="cancel" data-id="${r.id}">Cancel</button></div>`)}</div>`
                        : html`<p class="dim">Nothing pending.</p>`}
                </div>
            </div>` : ''}
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

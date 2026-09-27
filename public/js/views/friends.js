import { html, $, on, time, ago, debounce } from '../lib.js';
import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { avatar, userChip, empty, toast, withBusy, confirm, tier } from '../ui.js';

export default {
    title: 'Friends',
    auth: true,
    load: () => get('/friends'),
    render(d) {
        const online = d.friends.filter(f => f.online || store.online.has(f.id));
        return html`<div class="wrap page">
            <div class="page-head"><div><span class="eyebrow">Social</span><h1>Friends</h1><p>Add the people you play with. Friends can message you and team up in one click.</p></div></div>
            <div class="split">
                <div class="col" style="gap:18px">
                    <div class="card">
                        <form class="add-friend" data-form="add" autocomplete="off">
                            ${icon('search')}
                            <input class="input" name="username" placeholder="Find players by username…" autocomplete="off">
                            <button class="btn primary" type="submit">${icon('userPlus')}Add</button>
                            <div class="suggest hidden"></div>
                        </form>
                    </div>
                    <div class="card">
                        <div class="card-head"><h3>All friends</h3><span class="chip">${d.friends.length}</span><span class="spacer"></span>${online.length ? html`<span class="chip green">${online.length} online</span>` : ''}</div>
                        ${d.friends.length ? html`<div class="list">${d.friends.map(f => html`<div class="list-item friend-row">
                            ${userChip(f, { size: 'md', sub: f.online || store.online.has(f.id) ? 'Online' : `Seen ${ago(f.lastSeenAt)}` })}
                            <span class="spacer"></span>
                            <span class="hide-sm">${tier(f.elo.solo)}</span>
                            <button class="btn sm" data-act="dm" data-id="${f.id}">${icon('chat')}<span class="hide-sm">Message</span></button>
                            <button class="btn sm" data-act="team" data-user="${f.username}" data-name="${f.displayName}">${icon('users')}<span class="hide-sm">Team up</span></button>
                            <button class="btn ghost icon sm" data-act="remove" data-id="${f.id}" data-name="${f.displayName}" title="Remove friend">${icon('x')}</button>
                        </div>`)}</div>` : empty('users', 'No friends yet', 'Search for your mates above, or add people you meet in tournaments from their profile.')}
                    </div>
                </div>
                <div class="col" style="gap:18px">
                    <div class="card"><div class="card-head"><h3>Requests</h3>${d.incoming.length ? html`<span class="badge-dot">${d.incoming.length}</span>` : ''}</div>
                        ${d.incoming.length ? html`<div class="list">${d.incoming.map(r => html`<div class="list-item">${userChip(r.user, { sub: time(r.at, 'ago') })}<span class="spacer"></span>
                            <button class="btn primary sm" data-act="accept" data-id="${r.id}">Accept</button><button class="btn ghost sm" data-act="decline" data-id="${r.id}">${icon('x')}</button></div>`)}</div>`
                            : html`<p class="dim">No pending requests.</p>`}
                    </div>
                    ${d.outgoing.length ? html`<div class="card"><div class="card-head"><h3>Sent</h3></div>
                        <div class="list">${d.outgoing.map(r => html`<div class="list-item">${userChip(r.user, { sub: 'Pending' })}<span class="spacer"></span><button class="btn ghost sm" data-act="cancel" data-id="${r.id}">Cancel</button></div>`)}</div></div>` : ''}
                </div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        const form = $('[data-form=add]', root);
        const box = $('.suggest', form);
        const search = debounce(async q => {
            if (q.length < 2) { box.classList.add('hidden'); return; }
            try {
                const res = await get(`/users?q=${encodeURIComponent(q)}`);
                const list = res.users.filter(u => u.id !== store.me.id);
                box.innerHTML = String(list.length ? html`${list.map(u => html`<button type="button" class="sug" data-pick="${u.username}">${avatar(u, 'sm')}<b>${u.displayName}</b><span class="dim">@${u.username}</span></button>`)}` : html`<div class="dim" style="padding:10px 12px">No players found</div>`);
                box.classList.remove('hidden');
            } catch { box.classList.add('hidden'); }
        }, 200);
        const send = async (username, btn) => {
            const res = await withBusy(btn, () => post('/friends/requests', { username }));
            if (res) { toast(res.status === 'friends' ? `You're now friends with ${username}!` : `Friend request sent to ${username}.`); ctx.reload(); }
        };
        const offs = [
            on(form, 'input', '[name=username]', (e, i) => search(i.value.trim())),
            on(form, 'click', '[data-pick]', (e, b) => { form.username.value = b.dataset.pick; box.classList.add('hidden'); send(b.dataset.pick, $('button[type=submit]', form)); }),
            on(root, 'submit', '[data-form=add]', (e, f) => { e.preventDefault(); const v = f.username.value.trim(); if (v) send(v, $('button[type=submit]', f)); }),
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                const id = el.dataset.id;
                if (a === 'accept' && await withBusy(el, () => post(`/friends/requests/${id}/accept`))) toast('Friend added!');
                if (a === 'decline') await withBusy(el, () => post(`/friends/requests/${id}/decline`));
                if (a === 'cancel') await withBusy(el, () => post(`/friends/requests/${id}/cancel`));
                if (a === 'remove' && !(await confirm(`Remove ${el.dataset.name}?`, '', { yes: 'Remove', danger: true }))) return;
                if (a === 'remove') await withBusy(el, () => del(`/friends/${id}`));
                if (a === 'dm') { const r = await withBusy(el, () => get(`/chat/dm/${id}`)); if (r) navigate(`/chat/${encodeURIComponent(r.channelId)}`); return; }
                if (a === 'team') {
                    const nm = `${store.me.displayName} & ${el.dataset.name}`.slice(0, 24);
                    const r = await withBusy(el, () => post('/teams', { name: nm, invite: el.dataset.user }));
                    if (r) toast(`Team "${r.team.name}" created — invite sent!`, { link: '/teams', linkText: 'Teams' });
                    return;
                }
                ctx.reload();
            }),
        ];
        const away = e => { if (!form.contains(e.target)) box.classList.add('hidden'); };
        document.addEventListener('click', away);
        ctx.listen('friends', () => ctx.reload());
        ctx.listen('presence', () => ctx.reload());
        return () => { offs.forEach(f => f()); document.removeEventListener('click', away); };
    },
};

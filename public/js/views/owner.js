// Owner panel: players & roles, test bots, the Discord server and data.
import { html, on, time, ago } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { setQuery } from '../router.js';
import { icon } from '../icons.js';
import { userChip, empty, toast, withBusy, confirm, modal } from '../ui.js';

const TABS = [['players', 'Players & roles', 'users'], ['bots', 'Test bots', 'robot'], ['discord', 'Discord server', 'discord'], ['data', 'Data & backups', 'download']];

function discordCard(s) {
    const job = s.job || {};
    const state = s.demo ? html`<span class="chip">Demo mode — Discord is off</span>`
        : !s.configured ? html`<span class="chip red">${icon('alert')}Not connected</span>`
        : job.running ? html`<span class="chip accent">${icon('refresh')}Rebuilding… ${job.done}/${job.total || '?'}</span>`
        : s.built ? html`<span class="chip green">${icon('check')}Connected & synced</span>`
        : html`<span class="chip gold">Connected — not rebuilt yet</span>`;
    return html`<div class="card col" data-discord>
        <div class="card-head"><h3>Status</h3><span class="spacer"></span>${state}</div>
        <div class="stat-grid">
            <div class="stat-box stat"><b>${s.built ? 'Yes' : 'No'}</b><span>New layout</span></div>
            <div class="stat-box stat"><b>${s.queue || 0}</b><span>Waiting to sync</span></div>
            <div class="stat-box stat"><b>${s.lastSyncAt ? ago(s.lastSyncAt) : '—'}</b><span>Last sync</span></div>
            <div class="stat-box stat"><b>${s.backups ? 'On' : 'Off'}</b><span>Backups</span></div>
        </div>
        ${job.error ? html`<div class="form-error">${icon('alert')} Last rebuild failed: ${job.error}</div>` : ''}
        ${(job.log || []).length ? html`<pre class="job-log">${job.log.join('\n')}</pre>` : ''}
    </div>`;
}

export default {
    title: 'Owner panel',
    async load(ctx) {
        if (!store.isOwner()) { const e = new Error('Only the owner can open this page'); e.status = 403; throw e; }
        const tab = TABS.some(t => t[0] === ctx.query.tab) ? ctx.query.tab : 'players';
        const q = ctx.query.q || '';
        const [overview, list] = await Promise.all([
            get('/admin/overview'),
            tab === 'players' ? get(`/admin/users?q=${encodeURIComponent(q)}`) : tab === 'bots' ? get('/admin/users?bots=1') : Promise.resolve({ users: [] }),
        ]);
        return { tab, q, overview, users: list.users };
    },
    render(d) {
        const o = d.overview;
        const tab = d.tab;
        return html`<div class="wrap page">
            <div class="page-head"><h1>Owner panel</h1></div>
            <div class="grid grid-4" style="margin-bottom:22px">
                ${[['Players', o.users, 'users'], ['Admins', o.admins.length, 'shield'], ['Tournaments', o.tournaments, 'trophy'], ['Bots', o.bots, 'robot']].map(([k, v, ic]) => html`<div class="card tight kpi">${icon(ic)}<div class="stat"><b>${v}</b><span>${k}</span></div></div>`)}
            </div>
            <div class="tabs">${TABS.map(([k, l, ic]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${icon(ic)}${l}</button>`)}</div>

            ${tab === 'players' ? html`<div class="card">
                <form class="input-group" data-form="search" style="margin-bottom:12px"><input class="input" name="q" value="${d.q}" placeholder="Search players…"><button class="btn" type="submit">${icon('search')}Search</button></form>
                ${d.users.length ? html`<div class="table-scroll"><table class="table">
                <thead><tr><th>Player</th><th>Role</th><th>Roblox</th><th class="num">Matches</th><th class="num">No-shows</th><th>Last seen</th><th></th></tr></thead>
                <tbody>${d.users.map(u => html`<tr class="${u.banned ? 'banned-row' : ''}">
                    <td>${userChip(u, { sub: u.imported ? 'Imported from old site' : null })}</td>
                    <td>${u.role === 'owner' ? html`<span class="chip gold">${icon('crown')}Owner</span>`
                        : u.role === 'admin' ? html`<button class="btn sm" data-act="role" data-id="${u.id}" data-role="player" data-name="${u.displayName}">${icon('shield')}Admin · remove</button>`
                        : html`<button class="btn sm ghost" data-act="role" data-id="${u.id}" data-role="admin" data-name="${u.displayName}">${icon('plus')}Make admin</button>`}</td>
                    <td>${u.roblox && u.roblox.verified ? html`<span class="chip green">${u.roblox.name}</span>` : html`<button class="btn sm ghost" data-act="rbx" data-id="${u.id}">Set</button>`}</td>
                    <td class="num">${u.matches}</td><td class="num">${u.noShows}</td>
                    <td class="dim nowrap">${u.lastSeenAt ? ago(u.lastSeenAt) : '—'}</td>
                    <td class="num">${u.role !== 'owner' ? html`<button class="btn sm ${u.banned ? '' : 'danger'}" data-act="ban" data-id="${u.id}" data-banned="${u.banned ? '1' : ''}">${u.banned ? 'Unban' : 'Ban'}</button>` : ''}</td>
                </tr>`)}</tbody></table></div>` : empty('search', 'No players found')}
            </div>` : ''}

            ${tab === 'bots' ? html`<div class="split">
                <div class="card">
                    <div class="card-head"><h3>Bots</h3><span class="chip">${d.users.length}</span><span class="spacer"></span>
                        ${d.users.length ? html`<button class="btn sm danger" data-act="delbots">${icon('trash')}Delete all bots</button>` : ''}</div>
                    ${d.users.length ? html`<div class="list">${d.users.map(u => html`<div class="list-item">${userChip(u, { sub: `Created ${ago(u.createdAt)}` })}</div>`)}</div>`
                        : empty('robot', 'No bots')}
                </div>
                <div class="col" style="gap:18px">
                    <form class="card col" data-form="bots">
                        <h3>Create bots</h3>
                                                <label class="field"><span>How many</span><input class="input" name="count" type="number" min="1" max="32" value="4"></label>
                        <label class="check"><input type="checkbox" name="team"><span><b>Pair the first two as a duo team</b><small>For testing duo tournaments</small></span></label>
                        <button class="btn primary" type="submit">${icon('robot')}Create</button>
                    </form>
                </div>
            </div>` : ''}

            ${tab === 'discord' ? html`<div class="split">
                ${discordCard(o.discord)}
                <div class="col" style="gap:18px">
                    <div class="card col"><h3>Keep in sync</h3>
                        <div class="row wrap-ok">
                            <button class="btn" data-act="sync" ${o.discord.configured && o.discord.built ? '' : 'disabled'}>${icon('refresh')}Sync everything now</button>
                            <button class="btn" data-act="import" ${o.discord.configured ? '' : 'disabled'}>${icon('download')}Import old accounts</button>
                        </div>
                    </div>
                    <div class="card col danger-zone"><h3>${icon('alert')}Rebuild the server</h3>
                        <p class="dim" style="font-size:13.5px">Deletes every channel, then builds the new layout. Can't be undone.</p>
                        <button class="btn danger" data-act="rebuild" ${o.discord.configured && !o.discord.job.running ? '' : 'disabled'}>${icon('trash')}Delete everything & rebuild</button>
                    </div>
                </div>
            </div>` : ''}

            ${tab === 'data' ? html`<div class="grid grid-2">
                <div class="card col"><h3>Backups</h3>
                    <p class="dim">Last saved ${o.backup.lastWrite ? time(o.backup.lastWrite, 'ago') : 'not yet'}.</p>
                    <div class="row wrap-ok"><a class="btn" href="/api/admin/export" download data-export>${icon('download')}Download everything (JSON)</a>${o.backup.discord ? html`<button class="btn" data-act="backup">${icon('upload')}Back up now</button>` : ''}</div>
                </div>
                <div class="card col"><h3>Admins</h3>
                    <div class="list">${o.admins.map(u => html`<div class="list-item">${userChip(u, { sub: u.role === 'owner' ? 'Owner' : 'Admin' })}</div>`)}</div>
                </div>
            </div>` : ''}
        </div>`;
    },
    mount(root, d, ctx) {
        let poll = null;
        const refreshDiscord = async () => {
            try {
                const s = await get('/admin/discord');
                const el = root.querySelector('[data-discord]');
                if (el) el.outerHTML = String(discordCard(s));
                if (!s.job.running) { clearInterval(poll); poll = null; if (s.job.finishedAt) ctx.reload(); }
            } catch { /* keep polling */ }
        };
        if (d.tab === 'discord' && d.overview.discord.job.running) poll = setInterval(refreshDiscord, 1500);

        const offs = [
            on(root, 'click', '[data-tab]', (e, b) => { ctx.query.tab = b.dataset.tab; setQuery('tab', b.dataset.tab); ctx.reload(); }),
            on(root, 'submit', '[data-form=search]', (e, f) => { e.preventDefault(); ctx.query.q = f.q.value; setQuery('q', f.q.value); ctx.reload(); }),
            on(root, 'submit', '[data-form=bots]', async (e, f) => {
                e.preventDefault();
                const res = await withBusy(f.querySelector('[type=submit]'), () => post('/admin/bots', { count: Number(f.count.value), team: f.team.checked ? 'Bot Squad' : '' }));
                if (res) { toast(`${res.bots.length} bot${res.bots.length > 1 ? 's' : ''} created.`); ctx.reload(); }
            }),
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                if (a === 'role') {
                    const toAdmin = el.dataset.role === 'admin';
                    if (!(await confirm(toAdmin ? `Make ${el.dataset.name} an admin?` : `Remove admin from ${el.dataset.name}?`,
                        '', { yes: toAdmin ? 'Make admin' : 'Remove admin', danger: !toAdmin }))) return;
                    if (await withBusy(el, () => post(`/admin/users/${el.dataset.id}/role`, { role: el.dataset.role }))) { toast(toAdmin ? 'Admin added.' : 'Admin removed.'); ctx.reload(); }
                }
                if (a === 'ban') {
                    const banning = !el.dataset.banned;
                    if (banning && !(await confirm('Ban this player?', '', { yes: 'Ban', danger: true }))) return;
                    if (await withBusy(el, () => post(`/admin/users/${el.dataset.id}/ban`, { banned: banning }))) ctx.reload();
                }
                if (a === 'rbx') {
                    const ok = await modal({
                        title: 'Set Roblox account',                         body: html`<label class="field"><span>Roblox username</span><input class="input"></label><div class="form-error"></div>`,
                        actions: [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Link', cls: 'primary', handler: m => post(`/admin/users/${el.dataset.id}/roblox`, { username: m.querySelector('input').value.trim() }) }],
                    });
                    if (ok) ctx.reload();
                }
                if (a === 'delbots' && await confirm('Delete all bots?', '', { yes: 'Delete', danger: true })) {
                    const r = await withBusy(el, () => post('/admin/bots/delete-all'));
                    if (r) { toast(`${r.removed} bots deleted${r.kept ? `, ${r.kept} kept (in a live tournament)` : ''}.`); ctx.reload(); }
                }
                if (a === 'backup' && await withBusy(el, () => post('/admin/backup'))) toast('Backup uploaded to Discord.');
                if (a === 'sync' && await withBusy(el, () => post('/admin/discord/sync'))) toast('Syncing everything to Discord…');
                if (a === 'import') {
                    const r = await withBusy(el, () => post('/admin/discord/import'));
                    if (r) toast(`${r.imported} old account${r.imported === 1 ? '' : 's'} imported.`);
                }
                if (a === 'rebuild') {
                    const ok = await modal({
                        title: 'Delete everything in the Discord server?',
                        text: 'Type DELETE EVERYTHING to confirm.',
                        body: html`<input class="input" placeholder="DELETE EVERYTHING" autocomplete="off"><div class="form-error"></div>`,
                        actions: [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Delete & rebuild', cls: 'danger', handler: m => post('/admin/discord/rebuild', { confirm: m.querySelector('input').value.trim() }) }],
                    });
                    if (ok) {
                        toast('Rebuild started — this takes a minute or two.');
                        await refreshDiscord();
                        if (!poll) poll = setInterval(refreshDiscord, 1500);
                    }
                }
            }),
        ];
        return () => { offs.forEach(f => f()); clearInterval(poll); };
    },
};

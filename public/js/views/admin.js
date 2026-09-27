import { html, on, time, ago } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { setQuery } from '../router.js';
import { icon } from '../icons.js';
import { userChip, empty, tStatus, modeChip, toast, withBusy, confirm, modal } from '../ui.js';

export default {
    title: 'Admin',
    auth: 'admin',
    async load(ctx) {
        const q = ctx.query.q || '';
        const [overview, tournaments, users] = await Promise.all([get('/admin/overview'), get('/tournaments'), get(`/admin/users?q=${encodeURIComponent(q)}`)]);
        return { overview, tournaments: tournaments.tournaments, users: users.users, q };
    },
    render(d, ctx) {
        const tab = ['tournaments', 'users', 'site'].includes(ctx.query.tab) ? ctx.query.tab : 'tournaments';
        const o = d.overview;
        return html`<div class="wrap page">
            <div class="page-head"><div><span class="eyebrow">Organizer</span><h1>Admin</h1><p>Run tournaments, manage referees and keep the arena clean.</p></div>
                <span class="spacer"></span><a class="btn primary" href="/admin/tournaments/new">${icon('plus')}New tournament</a></div>
            <div class="grid grid-4" style="margin-bottom:22px">
                ${[['Players', o.users, 'users'], ['Tournaments', o.tournaments, 'trophy'], ['Matches', o.matches, 'swords'], ['Staff', o.staff.length, 'whistle']].map(([k, v, ic]) => html`<div class="card tight kpi">${icon(ic)}<div class="stat"><b>${v}</b><span>${k}</span></div></div>`)}
            </div>
            <div class="tabs">${[['tournaments', 'Tournaments'], ['users', 'Players & staff'], ['site', 'Site']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>

            ${tab === 'tournaments' ? (d.tournaments.length ? html`<div class="card flush"><div class="table-scroll"><table class="table">
                <thead><tr><th>Tournament</th><th>Status</th><th>Mode</th><th>Start</th><th class="num">Entrants</th><th></th></tr></thead>
                <tbody>${d.tournaments.map(t => html`<tr>
                    <td><a href="/t/${t.id}"><b>${t.name}</b></a></td><td>${tStatus(t.status)}</td><td>${modeChip(t.mode)}</td>
                    <td class="dim nowrap">${time(t.startAt)}</td><td class="num">${t.entrantCount}/${t.maxEntrants}</td>
                    <td class="num nowrap">${['draft', 'registration', 'checkin'].includes(t.status) ? html`<a class="btn sm" href="/admin/tournaments/${t.id}">${icon('edit')}Edit</a>` : ''} <a class="btn sm ghost" href="/t/${t.id}">Open</a></td>
                </tr>`)}</tbody></table></div></div>` : html`<div class="card">${empty('trophy', 'No tournaments yet', 'Create your first one — it takes a minute.', html`<a class="btn primary" href="/admin/tournaments/new">${icon('plus')}New tournament</a>`)}</div>`) : ''}

            ${tab === 'users' ? html`<div class="card">
                <form class="input-group" data-form="search" style="margin-bottom:12px"><input class="input" name="q" value="${d.q}" placeholder="Search players…"><button class="btn" type="submit">${icon('search')}Search</button></form>
                <div class="table-scroll"><table class="table">
                <thead><tr><th>Player</th><th>Role</th><th>Roblox</th><th class="num">Matches</th><th class="num">No-shows</th><th>Last seen</th><th></th></tr></thead>
                <tbody>${d.users.map(u => html`<tr class="${u.banned ? 'banned-row' : ''}">
                    <td>${userChip(u)}</td>
                    <td><select class="select sm-select" data-role="${u.id}" ${u.id === store.me.id ? 'title="Careful — this is you"' : ''}>
                        ${['player', 'ref', 'admin'].map(r => html`<option value="${r}" ${u.role === r ? 'selected' : ''}>${r === 'ref' ? 'Referee' : r === 'admin' ? 'Admin' : 'Player'}</option>`)}</select></td>
                    <td>${u.roblox ? html`<span class="chip green">${u.roblox.name}</span>` : html`<button class="btn sm ghost" data-act="rbx" data-id="${u.id}">Set</button>`}</td>
                    <td class="num">${u.matches}</td><td class="num">${u.noShows}</td>
                    <td class="dim nowrap">${u.lastSeenAt ? ago(u.lastSeenAt) : '—'}</td>
                    <td class="num">${u.id !== store.me.id ? html`<button class="btn sm ${u.banned ? '' : 'danger'}" data-act="ban" data-id="${u.id}" data-banned="${u.banned ? '1' : ''}">${u.banned ? 'Unban' : 'Ban'}</button>` : ''}</td>
                </tr>`)}</tbody></table></div></div>` : ''}

            ${tab === 'site' ? html`<div class="grid grid-2">
                <div class="card col"><h3>Data & backups</h3>
                    <p class="dim">Everything is stored in <code>data/db.json</code> on the server. ${o.backup.discord ? 'Off-site backups to Discord are ON.' : 'Off-site Discord backups are OFF — set DISCORD_BOT_TOKEN and DISCORD_BACKUP_CHANNEL_ID to enable them (strongly recommended on hosts that wipe the disk on redeploy).'}</p>
                    <p class="dim">Last saved ${o.backup.lastWrite ? time(o.backup.lastWrite, 'ago') : 'not yet'}.</p>
                    <div class="row wrap-ok"><a class="btn" href="/api/admin/export" download>${icon('download')}Export JSON</a>${o.backup.discord ? html`<button class="btn" data-act="backup">${icon('upload')}Back up now</button>` : ''}</div>
                </div>
                <div class="card col"><h3>Staff</h3>
                    <div class="list">${o.staff.map(u => html`<div class="list-item">${userChip(u, { sub: u.role === 'admin' ? 'Admin' : 'Referee' })}</div>`)}</div>
                    <p class="dim" style="font-size:13px">Promote trusted players to Referee in the Players tab. Refs get the Ref desk and can score matches they aren't playing in.</p>
                </div>
            </div>` : ''}
        </div>`;
    },
    mount(root, d, ctx) {
        const offs = [
            on(root, 'click', '[data-tab]', (e, b) => { ctx.query.tab = b.dataset.tab; setQuery('tab', b.dataset.tab); ctx.reload(); }),
            on(root, 'submit', '[data-form=search]', (e, f) => { e.preventDefault(); ctx.query.q = f.q.value; ctx.query.tab = 'users'; setQuery('q', f.q.value); ctx.reload(); }),
            on(root, 'change', '[data-role]', async (e, s) => {
                const res = await withBusy(null, () => post(`/admin/users/${s.dataset.role}/role`, { role: s.value }));
                if (res) toast(`Role updated to ${s.value}.`); else ctx.reload();
            }),
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                if (a === 'ban') {
                    const banning = !el.dataset.banned;
                    if (banning && !(await confirm('Ban this player?', 'They are logged out and cannot log back in.', { yes: 'Ban', danger: true }))) return;
                    if (await withBusy(el, () => post(`/admin/users/${el.dataset.id}/ban`, { banned: banning }))) ctx.reload();
                }
                if (a === 'rbx') {
                    const ok = await modal({
                        title: 'Set Roblox account', text: 'Manually links and verifies a Roblox account for this player.',
                        body: html`<label class="field"><span>Roblox username</span><input class="input"></label><div class="form-error"></div>`,
                        actions: [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Link', cls: 'primary', handler: el2 => post(`/admin/users/${el.dataset.id}/roblox`, { username: el2.querySelector('input').value.trim() }) }],
                    });
                    if (ok) ctx.reload();
                }
                if (a === 'backup' && await withBusy(el, () => post('/admin/backup'))) toast('Backup uploaded to Discord.');
            }),
        ];
        return () => offs.forEach(f => f());
    },
};

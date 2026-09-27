import { html, raw, $, on, time, ordinal, esc } from '../lib.js';
import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { navigate, setQuery } from '../router.js';
import { icon } from '../icons.js';
import { tStatus, modeChip, formatLabel, entryChip, empty, modal, confirm, toast, toastError, withBusy, tier } from '../ui.js';
import { renderBracket, mountBracket } from '../bracket.js';
import { mountChat } from '../chat.js';
import { matchLine } from '../cards.js';

const paragraphs = text => raw(String(text || '').split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));

function heroAction(t) {
    const me = store.me;
    const my = t.entries.find(e => e.id === t.myEntryId);
    const v = t.viewer;
    if (t.status === 'completed') {
        return t.champion ? html`<div class="t-cta champ">${icon('crown')}<div><span class="dim">Champion</span><b class="display">${t.champion.name}</b></div></div>` : '';
    }
    if (t.status === 'cancelled') return html`<div class="t-cta"><b>Cancelled</b><span class="dim">${t.cancelledReason || ''}</span></div>`;
    if (!me && ['registration', 'checkin'].includes(t.status)) {
        return html`<div class="t-cta"><a class="btn primary lg block" href="/login?next=/t/${t.id}">Log in to register</a><span class="dim center">${t.entrantCount}/${t.maxEntrants} spots taken</span></div>`;
    }
    if (my) {
        const next = store.myMatches.find(m => m.tournament.id === t.id && ['scheduled', 'ready', 'live'].includes(m.status));
        return html`<div class="t-cta">
            <span class="dim">You're entered as</span>
            <div class="t-my">${entryChip(my, { size: 'md' })}</div>
            ${t.status === 'checkin' ? (my.checkedIn
                ? html`<div class="chip green big">${icon('checkCircle')}Checked in — see you at ${time(t.startAt, 'clock')}</div>`
                : html`<button class="btn primary lg block pulse" data-act="checkin">${icon('check')}Check in now</button><span class="dim center">Closes in <b class="mono">${time(t.startAt, 'countdown')}</b></span>`) : ''}
            ${t.status === 'registration' ? html`<span class="dim center">Check-in opens ${time(new Date(new Date(t.startAt) - t.settings.checkinMinutes * 60e3).toISOString())}</span>` : ''}
            ${next ? html`<a class="btn primary lg block" href="/m/${next.id}">${icon('swords')}Go to your match</a>` : ''}
            ${t.status === 'live' && !next && my.dq ? html`<span class="chip red">Disqualified</span>` : ''}
            ${t.status === 'live' && !next && !my.dq ? html`<span class="dim center">Waiting for your next opponent…</span>` : ''}
            ${v.canWithdraw ? html`<button class="btn ghost sm" data-act="withdraw">Withdraw</button>` : ''}
        </div>`;
    }
    if (v.canRegister) {
        return html`<div class="t-cta">
            <button class="btn primary lg block" data-act="register">${icon('plus')}Register${t.mode === 'duo' ? ' your duo' : ''}</button>
            <span class="dim center">${t.maxEntrants - t.entrantCount} of ${t.maxEntrants} spots left</span>
        </div>`;
    }
    if (['registration', 'checkin'].includes(t.status)) return html`<div class="t-cta"><b>Tournament full</b><span class="dim">${t.entrantCount}/${t.maxEntrants}</span></div>`;
    if (t.status === 'live') {
        const real = t.matches.filter(m => !(m.result && ['bye', 'skipped'].includes(m.result.type)));
        const live = real.filter(m => m.status === 'live').length;
        const left = real.filter(m => m.status !== 'done').length;
        return html`<div class="t-cta">
            <span class="status live" style="align-self:flex-start">Live now</span>
            <b class="display" style="font-size:24px">${live ? `${live} match${live > 1 ? 'es' : ''} live` : 'Between rounds'}</b>
            <span class="dim">${left} match${left === 1 ? '' : 'es'} left until a champion is crowned</span>
            <button class="btn primary block" data-tab="matches">${icon('eye')}Watch the matches</button>
        </div>`;
    }
    return '';
}

function adminBar(t) {
    if (!t.viewer.isAdmin) return '';
    return html`<div class="admin-bar">
        <span class="chip">${icon('shield')}Organizer tools</span>
        ${['draft', 'registration', 'checkin'].includes(t.status) ? html`<a class="btn sm" href="/admin/tournaments/${t.id}">${icon('edit')}Edit</a>` : ''}
        ${t.status === 'draft' ? html`<button class="btn sm primary" data-act="publish">${icon('upload')}Publish</button>` : ''}
        ${['registration', 'checkin'].includes(t.status) ? html`<button class="btn sm" data-act="start">${icon('play')}Start now</button>` : ''}
        ${['draft', 'registration', 'checkin', 'live'].includes(t.status) ? html`<button class="btn sm danger" data-act="cancel">${icon('x')}Cancel</button>` : ''}
        ${['draft', 'registration', 'cancelled'].includes(t.status) ? html`<button class="btn sm danger" data-act="delete">${icon('trash')}Delete</button>` : ''}
    </div>`;
}

function overview(t) {
    const s = t.settings;
    const checkinAt = new Date(new Date(t.startAt) - s.checkinMinutes * 60e3).toISOString();
    const podium = (t.placements || []).filter(p => p.place <= 3).map(p => ({ ...p, entry: t.entries.find(e => e.id === p.entryId) }));
    return html`<div class="split">
        <div class="col" style="gap:18px">
            ${podium.length ? html`<div class="card podium">${[2, 1, 3].map(place => {
                const p = podium.filter(x => x.place === place);
                return html`<div class="pod p${place}">${p.map(x => html`<div class="pod-entry">${entryChip(x.entry, { size: 'md' })}</div>`)}<div class="pod-block display">${ordinal(place)}</div></div>`;
            })}</div>` : ''}
            <div class="card prose">
                <h3>About this tournament</h3>
                ${t.description ? paragraphs(t.description) : html`<p class="dim">A ${t.mode === 'duo' ? 'duo' : 'solo'} FTAP tournament. Register, check in on time and may the best flinger win.</p>`}
                ${t.rules ? html`<h3>Tournament rules</h3>${paragraphs(t.rules)}` : ''}
            </div>
            <div class="card">
                <h3 style="margin-bottom:14px">How matches work here</h3>
                <div class="rule-grid">
                    <div>${icon('target')}<b>First to ${s.firstTo} kills</b><span>wins a duel. Duels can't end in a tie.</span></div>
                    ${t.mode === 'solo' ? html`<div>${icon('swords')}<b>Best of ${s.bestOf}</b><span>duels per match${s.finalBestOf !== s.bestOf ? `, best of ${s.finalBestOf} in the final` : ''}.</span></div>`
                        : html`<div>${icon('users')}<b>Two 1v1 duels</b><span>Best vs best, second vs second. Win both to take the match.</span></div>
                               <div>${icon('dice')}<b>${s.drawRule === 'kills' ? 'Kills, then decider' : 'Decider on 1–1'}</b><span>${s.drawRule === 'kills' ? 'At 1–1 the side with more total kills wins; if that is tied too, a random decider duel.' : 'The system randomly picks two players who haven\'t fought yet. Winner takes the match.'}</span></div>
                               <div>${icon('user')}<b>${s.allowSoloTeams ? 'Teams of 1 allowed' : 'Full teams only'}</b><span>${s.allowSoloTeams ? 'Solo entries fight both duels, gain less and lose more.' : 'Both teammates must be registered.'}</span></div>`}
                    <div>${icon('clock')}<b>Check in or forfeit</b><span>Match check-in opens ${s.matchCheckinMinutes} min before; after ${s.noShowGraceMinutes} min late you forfeit.</span></div>
                    <div>${icon('whistle')}<b>Referee scored</b><span>A ref watches in-game and records every duel. Players can't enter scores.</span></div>
                    ${s.requireRoblox ? html`<div>${icon('lock')}<b>Verified Roblox required</b><span>Link your Roblox in Settings before registering.</span></div>` : ''}
                </div>
                <a class="more-link" href="/rules">Full rules & scoring →</a>
            </div>
        </div>
        <div class="col" style="gap:18px">
            <div class="card">
                <h3 style="margin-bottom:14px">Schedule</h3>
                <ol class="timeline">
                    <li class="${['registration', 'checkin', 'live', 'completed'].includes(t.status) ? 'done' : ''}"><b>Registration</b><span>Open now until the start</span></li>
                    <li class="${['checkin', 'live', 'completed'].includes(t.status) ? 'done' : ''}"><b>Check-in opens</b><span>${s.checkinMinutes ? time(checkinAt) : 'No tournament check-in'}</span></li>
                    <li class="${['live', 'completed'].includes(t.status) ? 'done' : ''}"><b>Bracket starts</b><span>${time(t.startAt)}</span></li>
                    <li class="${t.status === 'completed' ? 'done' : ''}"><b>Champion crowned</b><span>${t.completedAt ? time(t.completedAt) : 'When the final ends'}</span></li>
                </ol>
            </div>
            <div class="card">
                <h3 style="margin-bottom:12px">Details</h3>
                <dl class="facts">
                    <dt>Mode</dt><dd>${t.mode === 'duo' ? 'Duo (2v2 as two 1v1s)' : 'Solo 1v1'}</dd>
                    <dt>Format</dt><dd>${formatLabel(t.format)}${t.format === 'double' && s.grandFinalReset ? ' · final reset' : ''}${t.format === 'single' && s.thirdPlaceMatch ? ' · 3rd place match' : ''}</dd>
                    <dt>Seeding</dt><dd>By Elo rating</dd>
                    <dt>Entrants</dt><dd>${t.entrantCount} / ${t.maxEntrants}</dd>
                    ${t.prize ? html`<dt>Prize</dt><dd style="color:var(--gold)">${t.prize}</dd>` : ''}
                </dl>
            </div>
        </div>
    </div>`;
}

function entrants(t) {
    if (!t.entries.length) return html`<div class="card">${empty('users', 'No one has registered yet', 'Be the first to sign up!')}</div>`;
    const admin = t.viewer.isAdmin;
    const list = [...t.entries].sort((a, b) => (a.place || 999) - (b.place || 999) || (a.seed || 999) - (b.seed || 999) || b.rating - a.rating);
    return html`<div class="card flush"><div class="table-scroll"><table class="table">
        <thead><tr><th>${t.status === 'completed' ? 'Place' : 'Seed'}</th><th>${t.mode === 'duo' ? 'Team' : 'Player'}</th><th>Rating</th><th>Status</th>${admin ? html`<th></th>` : ''}</tr></thead>
        <tbody>${list.map(e => html`<tr class="${e.id === t.myEntryId ? 'mine-row' : ''}">
            <td class="mono dim">${e.place ? ordinal(e.place) : e.seed || '—'}</td>
            <td>${entryChip(e)}</td>
            <td>${tier(e.rating, true)}</td>
            <td>${e.dq ? html`<span class="chip red" title="${e.dqReason || ''}">DQ</span>`
                : t.status === 'checkin' ? (e.checkedIn ? html`<span class="chip green">${icon('check')}Checked in</span>` : html`<span class="chip">Not checked in</span>`)
                : e.type === 'soloTeam' ? html`<span class="chip">Team of 1</span>` : html`<span class="dim">Registered ${time(e.registeredAt, 'ago')}</span>`}</td>
            ${admin ? html`<td class="num">${['registration', 'checkin', 'draft'].includes(t.status) ? html`<button class="btn sm ghost" data-act="remove" data-entry="${e.id}">Remove</button>`
                : t.status === 'live' && !e.dq ? html`<button class="btn sm ghost" data-act="dq" data-entry="${e.id}">Disqualify</button>` : ''}</td>` : ''}
        </tr>`)}</tbody></table></div></div>`;
}

function matchesTab(t) {
    const byEntry = new Map(t.entries.map(e => [e.id, e]));
    const real = t.matches.filter(m => !(m.result && ['bye', 'skipped'].includes(m.result.type)) && m.status !== 'pending')
        .map(m => ({ ...m, entries: m.slots.map(s => byEntry.get(s.entryId) || null) }));
    if (!real.length) return html`<div class="card">${empty('swords', 'No matches yet', t.status === 'live' ? 'Matches appear as soon as both sides are known.' : 'The bracket is generated when the tournament starts.')}</div>`;
    const groups = [
        ['Live', real.filter(m => m.status === 'live')],
        ['Waiting for a referee', real.filter(m => m.status === 'ready')],
        ['Check-in', real.filter(m => m.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))],
        ['Finished', real.filter(m => m.status === 'done').reverse()],
    ].filter(g => g[1].length);
    return html`${groups.map(([title, list]) => html`<div class="section-title" style="margin-top:8px">${title}<span class="count chip">${list.length}</span></div>
        <div class="m-lines" style="margin-bottom:22px">${list.map(m => matchLine(m, { showTournament: false }))}</div>`)}`;
}

async function registerFlow(t) {
    if (t.mode === 'solo') {
        return post(`/tournaments/${t.id}/register`);
    }
    const { teams } = await get('/teams/mine');
    const full = teams.filter(tm => tm.members.length === 2);
    const half = teams.filter(tm => tm.members.length < 2);
    const cfg = await get('/config');
    const rp = cfg.points;
    const r = cfg.rating;
    return modal({
        title: `Register for ${t.name}`,
        text: 'Pick the team you want to play with, or go it alone.',
        wide: true,
        body: html`<div class="pick-list">
            ${full.map((tm, i) => html`<label class="pick"><input type="radio" name="pick" value="${tm.id}" ${i === 0 ? 'checked' : ''}>
                <span class="pick-body"><span class="av-stack">${tm.members.map(m => raw(`<span class="av sm" style="--c:${esc(m.accent)}">${esc((m.displayName || '?').slice(0, 2).toUpperCase())}</span>`))}</span>
                <span><b>${tm.name}</b><small>${tm.members.map(m => m.displayName).join(' & ')}</small></span></span></label>`)}
            ${half.map(tm => html`<div class="pick disabled"><span class="pick-body"><span><b>${tm.name}</b><small>Needs a second player — <a class="accent" href="/teams">invite a partner</a></small></span></span></div>`)}
            ${!teams.length ? html`<div class="inset dim">You're not on a team yet. <a class="accent" href="/teams">Create one and invite a friend</a> — it takes a few seconds.</div>` : ''}
            ${t.settings.allowSoloTeams ? html`<label class="pick solo"><input type="radio" name="pick" value="solo" ${!full.length ? 'checked' : ''}>
                <span class="pick-body"><span class="pick-ico">${icon('user')}</span><span><b>Enter as a team of 1</b>
                <small>You fight <b>both</b> duels yourself. To keep it fair: ${Math.round(r.soloTeamWinMult * 100)}% Elo on wins, ${Math.round(r.soloTeamLossMult * 100)}% Elo on losses, ${Math.round(rp.soloTeamWinMult * 100)}% ranking points and ${rp.soloTeamLoss} RP when you lose (full teams never lose RP).</small></span></span></label>` : ''}
        </div><div class="form-error"></div>`,
        actions: [
            { label: 'Cancel', cls: 'ghost', value: null },
            {
                label: 'Register', cls: 'primary', handler: async el => {
                    const v = (el.querySelector('input[name=pick]:checked') || {}).value;
                    if (!v) throw new Error('Pick a team or enter solo');
                    return post(`/tournaments/${t.id}/register`, v === 'solo' ? { solo: true } : { teamId: v });
                },
            },
        ],
    });
}

export default {
    title: d => d.tournament.name,
    load: ctx => get(`/tournaments/${ctx.params.id}`),
    render(d, ctx) {
        const t = d.tournament;
        const hasBracket = t.matches.length > 0;
        const tabs = [['overview', 'Overview'], ['bracket', 'Bracket'], ['entrants', t.mode === 'duo' ? 'Teams' : 'Players'], ['matches', 'Matches'], ['chat', 'Lobby chat']];
        let tab = ctx.query.tab || (t.status === 'live' ? 'bracket' : 'overview');
        if (!tabs.some(x => x[0] === tab)) tab = 'overview';
        const counts = { entrants: t.entries.length, matches: t.matches.filter(m => m.status === 'live').length || '' };

        return html`<div class="t-page" style="--ta:${t.accent || '#c4ff4d'}">
            <section class="t-hero">
                <div class="t-hero-bg"></div>
                <div class="wrap t-hero-inner">
                    <div class="t-hero-main">
                        <a class="crumb" href="/tournaments">${icon('left')}Tournaments</a>
                        <div class="row wrap-ok" style="gap:8px">${tStatus(t.status)}${modeChip(t.mode)}<span class="chip">${formatLabel(t.format)}</span>${t.prize ? html`<span class="chip gold">${icon('trophy')}${t.prize}</span>` : ''}</div>
                        <h1 class="display">${t.name}</h1>
                        <div class="t-facts">
                            <div>${icon('calendar')}<span><small>Start</small><b>${time(t.startAt)}</b></span></div>
                            ${['registration', 'checkin'].includes(t.status) ? html`<div>${icon('clock')}<span><small>Starts in</small><b class="mono">${time(t.startAt, 'countdown')}</b></span></div>` : ''}
                            <div>${icon('users')}<span><small>${t.mode === 'duo' ? 'Teams' : 'Players'}</small><b>${t.entrantCount} / ${t.maxEntrants}</b></span></div>
                            <div>${icon('target')}<span><small>Duels</small><b>First to ${t.settings.firstTo}</b></span></div>
                        </div>
                    </div>
                    ${heroAction(t)}
                </div>
            </section>
            <div class="wrap">
                ${adminBar(t)}
                <div class="tabs" role="tablist">
                    ${tabs.map(([k, label]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}" ${k === 'bracket' && !hasBracket ? raw('title="Generated when the tournament starts"') : ''}>${label}${counts[k] ? html`<span class="count">${counts[k]}</span>` : ''}</button>`)}
                </div>
                <div class="t-tab">
                    ${tab === 'overview' ? overview(t) : ''}
                    ${tab === 'bracket' ? (hasBracket ? renderBracket(t, { myEntryId: t.myEntryId })
                        : html`<div class="card">${empty('trophy', 'Bracket not generated yet', `It's created automatically at ${new Date(t.startAt).toLocaleString()} and seeded by rating.`)}</div>`) : ''}
                    ${tab === 'entrants' ? entrants(t) : ''}
                    ${tab === 'matches' ? matchesTab(t) : ''}
                    ${tab === 'chat' ? html`<div class="chat-slot" data-keep="tchat-${t.id}"></div>` : ''}
                </div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        const t = d.tournament;
        const tab = ctx.query.tab || (t.status === 'live' ? 'bracket' : 'overview');
        let stopBracket = null;
        if (tab === 'bracket' && t.matches.length) stopBracket = mountBracket($('.t-tab', root), t);
        let chat = null;
        if (tab === 'chat') {
            chat = mountChat($('.chat-slot', root), `tour:${t.id}`, { height: '560px', placeholder: store.me ? 'Talk to other players…' : 'Log in to chat', title: html`${icon('hash')}<b>${t.name}</b><span class="dim">lobby</span>` });
        }

        const act = async (e, el) => {
            const a = el.dataset.act;
            if (a === 'register') {
                const res = await withBusy(el, () => registerFlow(t));
                if (res) { toast("You're registered! We'll notify you when check-in opens."); ctx.reload(); store.refreshMe(); }
            }
            if (a === 'withdraw' && await confirm('Withdraw from this tournament?', 'Your spot will be released.', { yes: 'Withdraw', danger: true })) {
                if (await withBusy(el, () => post(`/tournaments/${t.id}/withdraw`))) { toast('Withdrawn.'); ctx.reload(); }
            }
            if (a === 'checkin') {
                if (await withBusy(el, () => post(`/tournaments/${t.id}/checkin`))) { toast("Checked in — you're good to go!"); ctx.reload(); }
            }
            if (a === 'publish' && await withBusy(el, () => post(`/tournaments/${t.id}/publish`))) { toast('Published — registration is open.'); ctx.reload(); }
            if (a === 'start' && await confirm('Start the tournament now?', t.status === 'checkin' ? 'Entries that have not checked in will be removed.' : 'Every registered entry will be placed in the bracket.', { yes: 'Start now' })) {
                if (await withBusy(el, () => post(`/tournaments/${t.id}/start`))) { toast('Bracket generated. Let the flinging begin!'); ctx.reload(); }
            }
            if (a === 'cancel') {
                const reason = await modal({
                    title: 'Cancel tournament', text: 'Everyone registered gets notified.',
                    body: html`<label class="field"><span>Reason</span><input class="input" name="reason" maxlength="200" placeholder="e.g. not enough players"></label>`,
                    actions: [{ label: 'Keep it', cls: 'ghost', value: null }, { label: 'Cancel tournament', cls: 'danger', handler: el2 => el2.querySelector('input').value || 'Cancelled by an organizer' }],
                });
                if (reason && await withBusy(el, () => post(`/tournaments/${t.id}/cancel`, { reason }))) ctx.reload();
            }
            if (a === 'delete' && await confirm('Delete this tournament?', 'This removes it for good.', { yes: 'Delete', danger: true })) {
                if (await withBusy(el, () => del(`/tournaments/${t.id}`))) { toast('Deleted.'); navigate('/tournaments'); }
            }
            if (a === 'remove' && await confirm('Remove this entry?', '', { yes: 'Remove', danger: true })) {
                if (await withBusy(el, () => post(`/tournaments/${t.id}/entries/${el.dataset.entry}/remove`))) ctx.reload();
            }
            if (a === 'dq') {
                const reason = await modal({
                    title: 'Disqualify entry', text: 'Their current match is forfeited and they are out of the tournament.',
                    body: html`<label class="field"><span>Reason (shown to players)</span><input class="input" maxlength="200" placeholder="e.g. cheating, toxic behaviour"></label>`,
                    actions: [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Disqualify', cls: 'danger', handler: el2 => el2.querySelector('input').value || 'Disqualified by an organizer' }],
                });
                if (reason && await withBusy(el, () => post(`/tournaments/${t.id}/entries/${el.dataset.entry}/dq`, { reason }))) ctx.reload();
            }
        };
        const offs = [
            on(root, 'click', '[data-act]', (e, el) => act(e, el).catch(toastError)),
            on(root, 'click', '[data-tab]', (e, b) => { ctx.query.tab = b.dataset.tab; setQuery('tab', b.dataset.tab); ctx.reload(); }),
        ];
        ctx.listen('tournament', ev => { if (ev.id === t.id) ctx.reload(); });
        ctx.listen('match', ev => { if (ev.tournamentId === t.id) ctx.reload(); });
        ctx.listen('mymatches', () => ctx.reload());
        return ({ leaving }) => {
            offs.forEach(f => f());
            if (stopBracket) stopBracket();
            if (leaving && chat) chat.destroy();
        };
    },
};

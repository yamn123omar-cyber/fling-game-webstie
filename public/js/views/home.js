// Home dashboard: the first thing you see after logging in.
import { html, on, time, fmtInt } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { empty, tier, mStatus } from '../ui.js';
import { tournamentCard, matchLine, leaderRow } from '../cards.js';
import { setQuery } from '../router.js';

function nextMatchCard(m) {
    const opp = m.entries[1 - m.mySide];
    let line;
    if (m.status === 'live') line = html`<span class="status live">Live</span> Your match is being played right now`;
    else if (m.status === 'ready') line = html`${mStatus('ready')} Both checked in — waiting for an admin to start it`;
    else if (Date.now() < new Date(m.scheduledAt).getTime()) line = html`Starts in <b class="mono">${time(m.scheduledAt, 'countdown')}</b> · ${time(m.scheduledAt)}`;
    else line = m.checkedIn ? html`You're checked in — waiting for your opponent` : html`<b class="accent">Check in now</b> — deadline in <b class="mono">${time(m.deadlineAt, 'countdown')}</b>`;
    return html`<a class="card link next-card" href="/m/${m.id}">
        <span class="eyebrow">${icon('swords')} Your next match</span>
        <h2 class="display">vs ${opp ? opp.name : 'TBD'}</h2>
        <p class="dim">${m.tournament ? m.tournament.name : ''} · ${m.label}</p>
        <p class="next-when">${line}</p>
        <span class="btn primary">${icon('arrowRight')}Open match room</span>
    </a>`;
}

function checklist(me, hasTeam) {
    const steps = [
        { done: Boolean(me.robloxId), label: 'Link your Roblox account', sub: 'Shows your skin and lets admins find you in-game', href: '/settings?tab=roblox' },
        { done: (me.friends || []).length > 0, label: 'Add a friend', sub: 'Chat and team up with people you know', href: '/players' },
        { done: hasTeam, label: 'Make a team', sub: 'For duo tournaments (you can also enter as a team of 1)', href: '/teams' },
        { done: me.stats.solo.tournaments + me.stats.duo.tournaments > 0, label: 'Join a tournament', sub: 'Solo or duo — sign up from the Tournaments page', href: '/tournaments' },
    ];
    const left = steps.filter(s => !s.done).length;
    if (!left) return '';
    return html`<div class="card">
        <div class="card-head"><h3>Getting started</h3><span class="spacer"></span><span class="chip accent">${steps.length - left}/${steps.length}</span></div>
        <div class="check-list">${steps.map(s => html`<a class="check-row ${s.done ? 'done' : ''}" href="${s.href}">
            <span class="tick">${s.done ? icon('check') : ''}</span>
            <span class="ellipsis"><b>${s.label}</b><small>${s.sub}</small></span>${s.done ? '' : icon('right', 'muted')}</a>`)}
        </div>
    </div>`;
}

export default {
    title: 'Home',
    async load() {
        const [home, teams] = await Promise.all([get('/home'), get('/teams/mine').catch(() => ({ teams: [] }))]);
        return { ...home, hasTeam: (teams.teams || []).length > 0 };
    },

    render(d, ctx) {
        const me = store.me;
        const board = ctx.query.board === 'duo' ? 'duo' : 'solo';
        const s = me.stats;
        const next = store.myMatches.find(x => ['live', 'ready', 'scheduled'].includes(x.status));
        const mine = d.upcoming.filter(t => t.myEntry);
        const open = d.upcoming.filter(t => !t.myEntry && t.status === 'registration');
        const hour = new Date().getHours();
        const hello = hour < 5 ? 'Late night flinging' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        return html`<div class="wrap page home">
            <div class="page-head dash-head">
                <div>
                    <span class="eyebrow">${hello}</span>
                    <h1>${me.displayName}</h1>
                    <p>${tier(s.solo.elo, true)} <span class="muted">solo</span> · ${tier(s.duo.elo, true)} <span class="muted">duo</span></p>
                </div>
                <div class="dash-stats">
                    <div class="stat-box stat"><b>${s.solo.wins + s.duo.wins}<span class="muted">–${s.solo.losses + s.duo.losses}</span></b><span>Wins – losses</span></div>
                    <div class="stat-box stat"><b>${s.solo.titles + s.duo.titles}</b><span>Tournament wins</span></div>
                    <div class="stat-box stat"><b>${fmtInt(s.solo.kills + s.duo.kills)}</b><span>Kills</span></div>
                </div>
            </div>

            <div class="split">
                <div class="col" style="gap:22px">
                    ${next ? nextMatchCard(next) : html`<div class="card next-card idle">
                        <span class="eyebrow">${icon('swords')} Your next match</span>
                        <h2 class="display">Nothing scheduled</h2>
                        <p class="dim">Sign up for a tournament and your matches will show up here, with a countdown and a button to check in.</p>
                        <a class="btn primary" href="/tournaments">${icon('trophy')}Browse tournaments</a>
                    </div>`}

                    ${d.live.length ? html`<section>
                        <div class="section-title"><span class="status live">Live now</span><span class="spacer"></span><a class="more" href="/bracket">Bracket →</a></div>
                        <div class="m-lines">${d.live.slice(0, 4).map(m => matchLine(m))}</div>
                    </section>` : ''}

                    ${mine.length ? html`<section>
                        <div class="section-title">Your tournaments<span class="spacer"></span></div>
                        <div class="grid grid-2">${mine.map(tournamentCard)}</div>
                    </section>` : ''}

                    <section>
                        <div class="section-title">Open for sign-up<span class="spacer"></span><a class="more" href="/tournaments">See all →</a></div>
                        ${open.length ? html`<div class="grid grid-2">${open.map(tournamentCard)}</div>`
                            : html`<div class="card">${empty('calendar', 'Nothing open right now', 'New tournaments show up here — you get a notification too.', store.isStaff() ? html`<a class="btn primary" href="/admin/tournaments/new">${icon('plus')}Create one</a>` : '')}</div>`}
                    </section>

                    <section>
                        <div class="section-title">Recent results</div>
                        <div class="card">${d.recent.length ? html`<div class="m-lines compact">${d.recent.slice(0, 5).map(m => matchLine(m))}</div>`
                            : empty('swords', 'No matches played yet', 'Results appear the moment an admin records them.')}</div>
                    </section>
                </div>

                <div class="col" style="gap:22px">
                    ${checklist(me, d.hasTeam)}
                    <div class="card">
                        <div class="card-head"><h3>Top players</h3><span class="spacer"></span>
                            <div class="seg" data-board>
                                <button class="${board === 'solo' ? 'on' : ''}" data-v="solo">Solo</button>
                                <button class="${board === 'duo' ? 'on' : ''}" data-v="duo">Duo</button>
                            </div>
                        </div>
                        ${d.top[board].length ? html`<div class="list">${d.top[board].map(leaderRow)}</div>`
                            : empty('chart', 'No ranked players yet', 'Play a match to get on the board.')}
                        <a class="btn ghost block" style="margin-top:10px" href="/leaderboard?mode=${board}">Full leaderboard ${icon('arrowRight')}</a>
                    </div>
                    ${d.champions.length ? html`<div class="card">
                        <div class="card-head"><h3>Latest champions</h3></div>
                        <div class="list">${d.champions.map(t => html`<a class="list-item" href="/t/${t.id}">
                            <span class="champ-ico">${icon('crown')}</span>
                            <span class="ellipsis" style="flex:1"><b>${t.champion.name}</b><br><small class="muted">${t.name}</small></span></a>`)}</div>
                    </div>` : ''}
                    <div class="card site-stats">
                        <div class="stat"><b>${fmtInt(d.stats.players)}</b><span>Players</span></div>
                        <div class="stat"><b>${fmtInt(d.stats.tournaments)}</b><span>Tournaments</span></div>
                        <div class="stat"><b>${fmtInt(d.stats.matches)}</b><span>Matches</span></div>
                        <div class="stat"><b>${fmtInt(d.stats.online)}</b><span>Online</span></div>
                    </div>
                </div>
            </div>
        </div>`;
    },

    mount(root, d, ctx) {
        const off = on(root, 'click', '[data-board] button', (e, b) => {
            setQuery('board', b.dataset.v);
            ctx.query.board = b.dataset.v;
            ctx.reload();
        });
        ctx.listen('match', () => ctx.reload());
        ctx.listen('tournament', () => ctx.reload());
        ctx.listen('mymatches', () => ctx.reload());
        return () => off();
    },
};

import { html, raw, $, on, time, pct, kd, signed, ordinal, fmtInt, copy, shortDate, ago } from '../lib.js';
import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { navigate, setQuery } from '../router.js';
import { icon } from '../icons.js';
import { avatar, userChip, tier, tierName, empty, bannerClass, toast, withBusy, confirm, popover, modal } from '../ui.js';
import { mountAvatar3d } from '../avatar3d.js';

const SOCIAL = {
    youtube: ['YouTube', v => (/^https?:/.test(v) ? v : `https://youtube.com/@${v.replace(/^@/, '')}`)],
    twitch: ['Twitch', v => (/^https?:/.test(v) ? v : `https://twitch.tv/${v}`)],
    tiktok: ['TikTok', v => (/^https?:/.test(v) ? v : `https://tiktok.com/@${v.replace(/^@/, '')}`)],
    twitter: ['X', v => (/^https?:/.test(v) ? v : `https://x.com/${v.replace(/^@/, '')}`)],
    discord: ['Discord', null],
};
const BADGE_ICON = { admin: 'shield', ref: 'whistle', verified: 'checkCircle', champion: 'crown', podium: 'medal', streak: 'fire', flinger: 'grab', veteran: 'star', reliable: 'clock' };

function eloChart(history) {
    const vals = history.map(h => h.elo);
    if (vals.length < 2) return html`<div class="chart-empty dim">Play a few matches to see your rating graph.</div>`;
    const W = 600, H = 140;
    const min = Math.min(...vals) - 10, max = Math.max(...vals) + 10;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - ((v - min) / (max - min)) * (H - 16) - 8]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return raw(`<div class="elo-wrap"><svg class="elo-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elo history">
        <defs><linearGradient id="eg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#818cf8" stop-opacity=".25"/><stop offset="1" stop-color="#818cf8" stop-opacity="0"/></linearGradient></defs>
        <path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#eg)"/>
        <path d="${d}" fill="none" stroke="#818cf8" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg><span class="ax ax-max mono">${Math.round(max - 10)}</span><span class="ax ax-min mono">${Math.round(min + 10)}</span></div>`);
}

function relationButtons(d) {
    const r = d.relation;
    const u = d.user;
    if (!store.me) return html`<a class="btn primary" href="/login?next=/u/${encodeURIComponent(u.username)}">${icon('userPlus')}Add friend</a>`;
    if (r.isMe) return html`<a class="btn" href="/settings">${icon('edit')}Edit profile</a>`;
    if (r.isFriend) {
        return html`<button class="btn primary" data-act="dm">${icon('chat')}Message</button>
            <button class="btn" data-act="teamup">${icon('users')}Team up</button>
            <button class="btn icon" data-act="more" aria-label="More">${icon('dots')}</button>`;
    }
    if (r.requestReceived) return html`<button class="btn primary" data-act="accept" data-id="${r.requestReceived}">${icon('userCheck')}Accept friend request</button><button class="btn ghost" data-act="decline" data-id="${r.requestReceived}">Decline</button>`;
    if (r.requestSent) return html`<button class="btn" data-act="cancel" data-id="${r.requestSent}">${icon('clock')}Request sent</button>`;
    return html`<button class="btn primary" data-act="add">${icon('userPlus')}Add friend</button>`;
}

export default {
    title: d => d.user.displayName,
    load: ctx => get(`/users/${encodeURIComponent(ctx.params.username)}`),
    render(d, ctx) {
        const u = d.user;
        const modes = ['solo', 'duo'];
        const vis = d.visible || { stats: true, history: true };
        const auto = u.stats && u.stats.duo.matches > u.stats.solo.matches ? 'duo' : u.profile.favoriteMode || 'solo';
        const mode = modes.includes(ctx.query.mode) ? ctx.query.mode : auto;
        const s = u.stats ? u.stats[mode] : null;
        const hidden = (what) => html`<div class="card">${empty('lock', `${u.displayName} keeps their ${what} private`, '')}</div>`;
        const isMe = d.relation && d.relation.isMe;
        const socials = Object.entries(u.profile.socials || {}).filter(([k, v]) => v && SOCIAL[k]);
        return html`<div class="profile" style="--pa:${u.accent}">
            <div class="${bannerClass(u.profile.banner)} p-banner"><div class="p-banner-fade"></div></div>
            <div class="wrap">
                <div class="p-head">
                    <div class="p-avatar">${avatar(u, 'xl', { online: true })}</div>
                    <div class="p-id">
                        <div class="row wrap-ok" style="gap:10px">
                            <h1 class="display">${u.displayName}</h1>
                            ${u.role === 'owner' ? html`<span class="chip gold">${icon('crown')}Owner</span>` : u.role === 'admin' || u.role === 'ref' ? html`<span class="chip accent">${icon('shield')}Admin</span>` : ''}
                            ${u.isBot ? html`<span class="chip">${icon('robot')}Bot</span>` : ''}
                        </div>
                        <div class="row wrap-ok dim" style="gap:14px;margin-top:6px">
                            <span>@${u.username}</span>
                            ${u.profile.title ? html`<span class="p-title">${u.profile.title}</span>` : ''}
                            ${u.roblox ? html`<a class="rbx-link" href="https://www.roblox.com/users/${u.roblox.id}/profile" target="_blank" rel="noopener">${icon('gamepad')}${u.roblox.name}${icon('checkCircle', 'ok')}</a>` : ''}
                            <span>${u.online ? html`<b style="color:var(--green)">● Online</b>` : html`Seen ${ago(u.lastSeenAt)}`}</span>
                        </div>
                    </div>
                    <span class="spacer"></span>
                    <div class="row wrap-ok p-actions">${relationButtons(d)}</div>
                </div>

                <div class="split-l" style="margin-top:26px">
                    <aside class="col" style="gap:18px">
                        <div class="card avatar-card">
                            ${u.roblox ? html`<div class="avatar3d" data-keep="av3d-${u.roblox.id}"><div class="spinner"></div></div><span class="hint center">Drag to spin</span>`
                                : html`<div class="avatar-none big"></div>
                                    ${isMe ? html`<a class="btn primary block" href="/settings?tab=roblox">${icon('link')}Link your Roblox avatar</a>` : html`<p class="dim center">No Roblox account linked yet.</p>`}`}
                        </div>
                        ${u.profile.bio || socials.length ? html`<div class="card">
                            ${u.profile.bio ? html`<p class="bio">${u.profile.bio}</p>` : ''}
                            ${socials.length ? html`<div class="socials">${socials.map(([k, v]) => SOCIAL[k][1]
                                ? html`<a class="chip" href="${SOCIAL[k][1](v)}" target="_blank" rel="noopener nofollow">${SOCIAL[k][0]}</a>`
                                : html`<button class="chip" data-copy="${v}" title="Copy">${SOCIAL[k][0]}: ${v}</button>`)}</div>` : ''}
                        </div>` : ''}
                        ${u.badges.length ? html`<div class="card"><div class="card-head"><h3>Badges</h3></div>
                            <div class="badges">${u.badges.map(b => html`<div class="badge-item b-${b.id}" title="${b.desc}">${icon(BADGE_ICON[b.id] || 'star')}<span>${b.name}</span></div>`)}</div></div>` : ''}
                        ${d.teams.length ? html`<div class="card"><div class="card-head"><h3>Teams</h3></div>
                            <div class="list">${d.teams.map(t => html`<a class="list-item" href="/team/${t.id}"><span class="team-dot" style="--c:${t.color}"></span><b class="ellipsis" style="flex:1">${t.name}</b><span class="av-stack">${t.members.map(m => avatar(m, 'xs'))}</span></a>`)}</div></div>` : ''}
                        ${(d.pastTeams || []).length ? html`<div class="card"><div class="card-head"><h3>Past teams</h3></div>
                            <div class="list">${d.pastTeams.map(t => html`<a class="list-item" href="/team/${t.id}"><span class="team-dot" style="--c:${t.color}"></span>
                                <span class="ellipsis" style="flex:1"><b>${t.name}</b><br><small class="muted">${t.joinedAt ? shortDate(t.joinedAt) : ''}${t.leftAt ? ` – ${shortDate(t.leftAt)}` : t.disbanded ? ' · disbanded' : ''}</small></span></a>`)}</div></div>` : ''}
                        <div class="dim center" style="font-size:13px">Member since ${shortDate(u.createdAt)} · ${u.friendCount} friend${u.friendCount === 1 ? '' : 's'}</div>
                    </aside>

                    <div class="col" style="gap:18px">
                        ${!s ? hidden('stats') : html`<div class="card rank-card">
                            <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
                                <div class="seg big" data-mode>${modes.map(k => html`<button class="${k === mode ? 'on' : ''}" data-v="${k}">${k === 'solo' ? 'Solo 1v1' : 'Duo 2v2'}</button>`)}</div>

                            </div>
                            <div class="rank-row">
                                <div class="emblem tier-${tierName(s.elo)}"><i></i><span class="display">${s.elo}</span></div>
                                <div class="col" style="gap:4px">
                                    ${tier(s.elo)}
                                    <span class="dim">Peak <b class="mono">${s.peak}</b></span>
                                    ${s.streak >= 2 ? html`<span class="streak big">${icon('fire')}${s.streak} win streak</span>` : ''}
                                </div>
                            </div>
                            ${eloChart(s.history)}
                        </div>
                        <div class="stat-grid">
                            ${[
                                ['Wins – losses', `${s.wins}–${s.losses}`], ['Win rate', pct(s.matches ? s.wins / s.matches : 0)], ['Tournament wins', s.titles],
                                ['Kills', fmtInt(s.kills)], ['K/D', kd(s.kills, s.deaths)], ['Best finish', s.bestPlace ? ordinal(s.bestPlace) : '—'],
                            ].map(([k, v]) => html`<div class="stat-box stat"><b>${v}</b><span>${k}</span></div>`)}
                        </div>`}
                        ${!vis.history ? hidden('match history') : ''}
                        ${vis.history && d.opponents.length ? html`<div class="card flush">
                            <div class="card-head" style="padding:18px 18px 0"><h3>Opponents</h3></div>
                            <div class="table-scroll"><table class="table">
                                <thead><tr><th>Opponent</th><th class="num">Duels</th><th class="num">Kills</th><th class="num">Last</th><th></th></tr></thead>
                                <tbody>${d.opponents.map(o => html`<tr>
                                    <td>${userChip(o.user)}</td>
                                    <td class="num"><b class="${o.duelsWon > o.duelsLost ? 'up' : o.duelsWon < o.duelsLost ? 'down' : ''}">${o.duelsWon}–${o.duelsLost}</b></td>
                                    <td class="num">${o.kills}–${o.deaths}</td>
                                    <td class="num">${o.lastScore ? html`<a href="/m/${o.lastMatchId}">${o.lastScore[0]}–${o.lastScore[1]}</a>` : '—'}</td>
                                    <td class="dim nowrap">${o.last ? time(o.last, 'ago') : ''}</td>
                                </tr>`)}</tbody></table></div>
                        </div>` : ''}
                        ${vis.history ? html`<div class="card">
                            <div class="card-head"><h3>Recent matches</h3></div>
                            ${d.matches.length ? html`<div class="list">${d.matches.map(m => html`<a class="list-item hist ${m.won ? 'won' : 'lost'}" href="/m/${m.id}">
                                <span class="res">${m.won ? 'W' : 'L'}</span>
                                <div class="ellipsis" style="flex:1"><b>vs ${m.opponent ? m.opponent.name : '—'}</b><div class="dim ellipsis" style="font-size:13px">${m.tournament.name} · ${m.label}${m.type !== 'played' ? ' · forfeit' : ''}</div></div>
                                <span class="mono">${m.score[0]}–${m.score[1]}</span>
                                ${m.change ? html`<span class="delta mono ${m.change.elo > 0 ? 'up' : m.change.elo < 0 ? 'down' : ''}">${signed(m.change.elo)}</span>` : ''}
                                <span class="dim nowrap" style="font-size:12.5px">${time(m.at, 'ago')}</span>
                            </a>`)}</div>` : empty('swords', 'No matches yet')}
                        </div>` : ''}
                        ${d.tournaments.length ? html`<div class="card"><div class="card-head"><h3>Tournaments</h3></div>
                            <div class="list">${d.tournaments.map(t => html`<a class="list-item" href="/t/${t.id}">
                                <span class="place ${t.place && t.place <= 3 ? `p${t.place}` : ''}">${t.place ? ordinal(t.place) : t.status === 'live' ? 'LIVE' : '—'}</span>
                                <div class="ellipsis" style="flex:1"><b>${t.name}</b><div class="dim" style="font-size:13px">${t.mode === 'duo' ? `Duo as ${t.entryName}` : 'Solo'} · ${t.entrants} entrants${t.dq ? ' · DQ' : ''}</div></div>
                                <span class="dim nowrap" style="font-size:12.5px">${shortDate(t.startAt)}</span>
                            </a>`)}</div></div>` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        const u = d.user;
        const box = $('.avatar3d', root);
        if (box && !box._mounted) {
            box._mounted = true;
            mountAvatar3d(box, u.roblox.id).then(f => { box._stop = f; });
        }

        const act = async (e, el) => {
            const a = el.dataset.act;
            if (a === 'add' && await withBusy(el, () => post('/friends/requests', { username: u.username }))) toast('Friend request sent.');
            if (a === 'accept' && await withBusy(el, () => post(`/friends/requests/${el.dataset.id}/accept`))) toast(`You and ${u.displayName} are now friends!`);
            if (a === 'decline') await withBusy(el, () => post(`/friends/requests/${el.dataset.id}/decline`));
            if (a === 'cancel' && await confirm('Cancel friend request?', '', { yes: 'Cancel request' })) await withBusy(el, () => post(`/friends/requests/${el.dataset.id}/cancel`));
            if (a === 'dm') {
                const r = await withBusy(el, () => get(`/chat/dm/${u.id}`));
                if (r) navigate(`/chat/${encodeURIComponent(r.channelId)}`);
                return;
            }
            if (a === 'teamup') {
                const name = await modal({
                    title: `Team up with ${u.displayName}`,
                    text: "We'll create the team and send them an invite.",
                    body: html`<label class="field"><span>Team name</span><input class="input" maxlength="24" value="${`${store.me.displayName} & ${u.displayName}`.slice(0, 24)}"></label><div class="form-error"></div>`,
                    actions: [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Create team', cls: 'primary', handler: async el2 => post('/teams', { name: el2.querySelector('input').value, invite: u.username }) }],
                });
                if (name) { toast('Team created — invite sent!', { link: '/teams', linkText: 'Teams' }); }
                return;
            }
            if (a === 'more') {
                popover(el, html`<button data-act="unfriend" data-close>${icon('x')}Remove friend</button>`);
                return;
            }
            ctx.reload();
        };
        const offs = [
            on(root, 'click', '[data-act]', (e, el) => act(e, el)),
            on(document.body, 'click', '[data-act="unfriend"]', async () => {
                if (await confirm(`Remove ${u.displayName} from friends?`, '', { yes: 'Remove', danger: true })) {
                    await withBusy(null, () => del(`/friends/${u.id}`));
                    ctx.reload();
                }
            }),
            on(root, 'click', '[data-mode] button', (e, b) => { ctx.query.mode = b.dataset.v; setQuery('mode', b.dataset.v); ctx.reload(); }),
            on(root, 'click', '[data-copy]', (e, el) => copy(el.dataset.copy).then(() => toast('Copied'))),
        ];
        ctx.listen('friends', () => ctx.reload());
        return ({ leaving }) => { offs.forEach(f => f()); if (leaving && box && box._stop) box._stop(); };
    },
};

import { html, $, on, time, clock, signed, copy, toLocalInput, debounce } from '../lib.js';
import { get, post } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { avatar, mStatus, modal, confirm, toast, withBusy, empty } from '../ui.js';
import { mountChat } from '../chat.js';

const SIDE = ['a', 'b'];

function nameOf(m, uid) {
    for (const s of m.sides) if (s) for (const u of s.members) if (u.id === uid) return u;
    return { displayName: '?', username: '', id: uid };
}

function sideBlock(m, i) {
    const s = m.sides[i];
    if (!s) return html`<div class="sb-side ${SIDE[i]}"><div class="sb-name muted">TBD</div></div>`;
    const e = s.entry;
    const won = m.status === 'done' && m.winnerSide === i;
    const lost = m.status === 'done' && m.winnerSide !== null && m.winnerSide !== i;
    const showCheck = ['scheduled', 'ready', 'live'].includes(m.status) || (m.status === 'done' && m.result && m.result.type !== 'played');
    return html`<div class="sb-side ${SIDE[i]} ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${m.viewer.side === i ? 'mine' : ''}">
        <div class="sb-label">${i === 0 ? 'Side A' : 'Side B'}${e.seed ? html` · Seed ${e.seed}` : ''}${m.viewer.side === i ? html` · <b>You</b>` : ''}</div>
        <div class="sb-name display">${e.tag ? html`<span class="sb-tag mono" style="color:${e.color || 'inherit'}">${e.tag}</span>` : ''}${e.name}</div>
        ${e.type === 'soloTeam' ? html`<span class="chip">Team of 1</span>` : ''}
        ${m.shorthanded && m.shorthanded[i] ? html`<span class="chip red">Short-handed</span>` : ''}
        ${won ? html`<span class="chip accent">${icon('crown')}Winner</span>` : ''}
        <div class="sb-members">${s.members.map(u => html`<div class="sb-member">
            <a href="/u/${encodeURIComponent(u.username)}">${avatar(u, 'md', { online: true })}</a>
            <div class="sb-mi">
                <a href="/u/${encodeURIComponent(u.username)}"><b>${u.displayName}</b></a>
                ${u.robloxName ? html`<span class="rbx"><a href="https://www.roblox.com/users/${u.robloxId}/profile" target="_blank" rel="noopener">${icon('gamepad')}${u.robloxName}</a><button class="copy" data-copy="${u.robloxName}" title="Copy Roblox username">${icon('copy')}</button></span>`
                    : html`<span class="rbx muted">No Roblox linked</span>`}
                ${showCheck ? (u.checkedInAt ? html`<span class="ck on">${icon('check')}Checked in ${clock(u.checkedInAt, true)}</span>` : html`<span class="ck">${icon('clock')}Not checked in</span>`) : ''}
            </div>
        </div>`)}</div>
    </div>`;
}

function centerBlock(m) {
    const now = Date.now();
    let sub = '';
    if (m.status === 'pending') sub = html`<span>Waiting for both sides to be decided</span>`;
    if (m.status === 'scheduled') {
        const opens = new Date(m.checkinOpensAt).getTime();
        sub = now < opens
            ? html`<span>Check-in opens in</span><b class="mono big">${time(m.checkinOpensAt, 'countdown')}</b>`
            : html`<span>Check-in closes in</span><b class="mono big">${time(m.deadlineAt, 'countdown')}</b>`;
    }
    if (m.status === 'ready') sub = html`<span>${m.ref ? html`${m.ref.displayName} will start the match` : 'Lineups locked — waiting for a referee'}</span>`;
    const live = m.duels.find(d => d.winner === null && d.live);
    if (m.status === 'live' && live) sub = html`<span>${live.kind === 'decider' ? 'Decider' : `Duel ${live.n}`} · first to ${m.firstTo}</span><b class="mono big live-duel">${live.scores[0]} – ${live.scores[1]}</b>`;
    if (m.status === 'done') {
        const t = m.result && m.result.type;
        sub = html`<span>${t === 'forfeit' ? 'Won by forfeit' : t === 'double_forfeit' ? 'Both sides forfeited' : m.result && m.result.note ? m.result.note : 'Final'}</span>`;
    }
    return html`<div class="sb-center">
        ${mStatus(m.status)}
        <div class="sb-score display">${['pending', 'scheduled', 'ready'].includes(m.status) ? html`<span class="vs">VS</span>` : html`<b class="${m.winnerSide === 0 ? 'w' : ''}">${m.score[0]}</b><i>:</i><b class="${m.winnerSide === 1 ? 'w' : ''}">${m.score[1]}</b>`}</div>
        <div class="sb-sub">${sub}</div>
        ${m.scheduledAt && m.status !== 'done' ? html`<div class="sb-when">${icon('calendar')}${time(m.scheduledAt)}</div>` : ''}
    </div>`;
}

function duelList(m) {
    if (!m.duels.length) {
        const plan = m.mode === 'duo' ? `2 duels, first to ${m.firstTo} kills` : `Best of ${m.bestOf}, first to ${m.firstTo} kills`;
        return html`<div class="card"><div class="card-head"><h3>Duels</h3></div><p class="dim">${plan}</p></div>`;
    }
    return html`<div class="card"><div class="card-head"><h3>Duels</h3><span class="spacer"></span><span class="chip">${icon('target')}First to ${m.firstTo}</span></div>
        <div class="duels">${m.duels.map(d => {
            const a = nameOf(m, d.players[0]);
            const b = nameOf(m, d.players[1]);
            const done = d.winner !== null;
            return html`<div class="duel ${d.live && !done ? 'is-live' : ''} ${d.kind === 'decider' ? 'decider' : ''}">
                <div class="duel-n">${d.kind === 'decider' ? html`${icon('dice')}Decider` : `Duel ${d.n}`}${d.live && !done ? html`<span class="status live">Live</span>` : ''}</div>
                <div class="duel-row">
                    <div class="dp a ${done && d.winner === 0 ? 'w' : ''} ${done && d.winner === 1 ? 'l' : ''}">${avatar(a, 'sm')}<span class="ellipsis">${a.displayName}</span></div>
                    <div class="dscore mono">${done || d.live ? html`<b>${d.scores[0]}</b><span>–</span><b>${d.scores[1]}</b>` : html`<span class="muted">vs</span>`}</div>
                    <div class="dp b ${done && d.winner === 1 ? 'w' : ''} ${done && d.winner === 0 ? 'l' : ''}"><span class="ellipsis">${b.displayName}</span>${avatar(b, 'sm')}</div>
                </div>
            </div>`;
        })}</div>
        ${m.mode === 'duo' && m.duels.length === 2 && m.status !== 'done' ? html`<p class="hint" style="margin-top:12px">${icon('dice')} If it's 1–1${m.drawRule === 'kills' ? ' and total kills are tied' : ''}, the system randomly picks two players who haven't fought for a decider.</p>` : ''}
    </div>`;
}

function refConsole(m) {
    const v = m.viewer;
    if (!v.isStaff) return '';
    if (!v.canRef) return html`<div class="card ref-card"><div class="card-head">${icon('whistle')}<h3>Admin</h3></div><p class="dim">You're playing in this one.</p></div>`;
    const mine = v.isRef || v.isAdmin;
    const active = ['scheduled', 'ready', 'live'].includes(m.status);
    const cur = m.duels.find(d => d.winner === null);
    const key = `ref-${m.status}-${cur ? cur.n : 'x'}-${m.ref ? m.ref.id : 'none'}`;
    return html`<div class="card ref-card" data-keep="${key}">
        <div class="card-head">${icon('whistle')}<h3>Score this match</h3><span class="spacer"></span>
            ${m.ref ? html`<span class="chip blue">${m.ref.displayName}${v.isRef ? ' (you)' : ''}</span>` : html`<span class="chip">Unclaimed</span>`}</div>
        ${active && !m.ref ? html`
            <button class="btn primary block" data-act="claim">${icon('whistle')}Take this match</button>` : ''}
        ${active && m.ref && !mine ? html`<p class="dim">${m.ref.displayName} is scoring this.</p>` : ''}
        ${mine && m.status === 'scheduled' ? html`<div class="inset dim">Waiting for check-ins · ${time(m.deadlineAt, 'clock')}</div>` : ''}
        ${mine && m.status === 'ready' ? html`<button class="btn primary lg block" data-act="start">${icon('play')}Start match</button>
            ` : ''}
        ${mine && m.status === 'live' && cur ? html`<div class="tally" data-n="${cur.n}">
            <div class="tally-head">${cur.kind === 'decider' ? 'Decider' : `Duel ${cur.n}`} · first to ${m.firstTo}</div>
            <div class="tally-row">
                ${[0, 1].map(i => html`<div class="tally-side ${SIDE[i]}">
                    <span class="ellipsis">${nameOf(m, cur.players[i]).displayName}</span>
                    <b class="display" data-score="${i}">${cur.scores[i]}</b>
                    <div class="row"><button class="btn icon" data-tally="${i}" data-d="-1" aria-label="minus">${icon('minus')}</button><button class="btn icon primary" data-tally="${i}" data-d="1" aria-label="plus">${icon('plus')}</button></div>
                </div>`)}
            </div>
            <button class="btn primary block lg" data-act="duel">${icon('check')}Confirm duel result</button>
        </div>` : ''}
        ${mine && m.status === 'live' && !cur ? html`<div class="inset dim">All duels done.</div>` : ''}
        ${mine && m.status === 'live' && m.duels.some(d => d.winner !== null) ? html`<button class="btn ghost sm" data-act="undo" style="margin-top:10px">${icon('undo')}Undo last duel</button>` : ''}
        ${mine && active ? html`<details class="ref-more"><summary>More actions</summary>
            <div class="col" style="margin-top:12px">
                ${m.status === 'scheduled' ? html`<div class="field"><span>Reschedule</span><div class="input-group"><input class="input" type="datetime-local" name="resched" value="${toLocalInput(m.scheduledAt)}"><button class="btn" data-act="reschedule">Move</button></div></div>` : ''}
                <div class="field"><span>Rule a forfeit</span>
                    <div class="input-group"><select class="select" name="ffside"><option value="0">Side A forfeits</option><option value="1">Side B forfeits</option><option value="both">Both forfeit</option></select></div>
                    <input class="input" name="ffreason" maxlength="200" placeholder="Reason (e.g. left the server, didn't show)">
                    <button class="btn danger" data-act="forfeit">${icon('flag')}Record forfeit</button>
                </div>
                ${m.ref && m.status !== 'live' ? html`<button class="btn ghost sm" data-act="release">Stop refereeing</button>` : ''}
            </div></details>` : ''}
        ${m.status === 'done' && (v.isAdmin || v.isRef) && m.result && ['played', 'forfeit', 'double_forfeit'].includes(m.result.type) ? html`<button class="btn sm" data-act="reopen">${icon('undo')}Reopen result</button>
            ` : ''}
    </div>`;
}

function playerActions(m) {
    const v = m.viewer;
    if (!v.isParticipant) return '';
    const out = [];
    if (m.proposal) {
        const theirs = m.proposal.side !== v.side;
        out.push(html`<div class="banner-note">${icon('calendar')}<span>${theirs ? 'Your opponent proposed' : 'You proposed'} moving the match to <b>${time(m.proposal.at)}</b>.</span>
            ${theirs ? html`<button class="btn sm primary" data-act="accept">Accept</button><button class="btn sm ghost" data-act="decline">Decline</button>` : html`<span class="dim">Waiting for them to accept…</span>`}</div>`);
    }
    if (m.status === 'scheduled') {
        const opens = new Date(m.checkinOpensAt).getTime();
        out.push(html`<div class="m-actions">
            ${v.checkedIn ? html`<div class="checked">${icon('checkCircle')}<div><b>Checked in</b></div></div>`
                : Date.now() < opens ? html`<button class="btn lg" disabled>${icon('clock')}Check-in opens ${time(m.checkinOpensAt, 'clock')}</button>`
                : html`<button class="btn primary xl pulse" data-act="checkin">${icon('check')}Check in</button>`}
            <span class="spacer"></span>
            <button class="btn" data-act="propose">${icon('calendar')}New time</button>
            <button class="btn" data-act="callref">${icon('bell')}Call an admin</button>
        </div>`);
    }
    if (['ready', 'live'].includes(m.status)) {
        out.push(html`<div class="m-actions"><div class="checked">${icon(m.status === 'live' ? 'swords' : 'whistle')}<div><b>${m.status === 'live' ? 'Match in progress' : m.ref ? `${m.ref.displayName} is scoring` : 'Waiting for an admin'}</b>
            ${m.ref && m.ref.robloxName ? html`<span>Roblox: <b>${m.ref.robloxName}</b></span>` : ''}</div></div>
            <span class="spacer"></span><button class="btn" data-act="callref">${icon('bell')}Call an admin</button></div>`);
    }
    return html`${out}`;
}

function resultCard(m) {
    if (m.status !== 'done' || !m.ratingChanges) return '';
    const rows = Object.entries(m.ratingChanges);
    if (!rows.length) return '';
    return html`<div class="card"><div class="card-head"><h3>Rating changes</h3><span class="spacer"></span><span class="chip">${m.mode === 'duo' ? 'Duo' : 'Solo'} ladder</span></div>
        <div class="list">${rows.map(([uid, c]) => {
            const u = nameOf(m, uid);
            return html`<div class="list-item">${avatar(u, 'sm')}<b class="ellipsis" style="flex:1">${u.displayName}</b>
                <span class="delta mono ${c.elo > 0 ? 'up' : c.elo < 0 ? 'down' : ''}">${signed(c.elo)} Elo</span>
                <span class="delta mono ${c.rp > 0 ? 'up' : c.rp < 0 ? 'down' : ''}">${signed(c.rp)} RP</span></div>`;
        })}</div></div>`;
}

export default {
    title: d => `${(d.match.sides[0] && d.match.sides[0].entry.name) || 'TBD'} vs ${(d.match.sides[1] && d.match.sides[1].entry.name) || 'TBD'}`,
    load: ctx => get(`/matches/${ctx.params.id}`),
    render(d) {
        const m = d.match;
        return html`<div class="wrap page m-page">
            <a class="crumb" href="/t/${m.tournament.id}?tab=bracket">${icon('left')}${m.tournament.name}<span class="dim">· ${m.label}</span></a>
            <section class="scoreboard st-${m.status}">
                ${sideBlock(m, 0)}
                ${centerBlock(m)}
                ${sideBlock(m, 1)}
            </section>
            ${playerActions(m)}
            <div class="split" style="margin-top:20px">
                <div class="col" style="gap:18px">
                    ${refConsole(m)}
                    ${duelList(m)}
                    ${resultCard(m)}
                </div>
                <div class="col" style="gap:18px">
                    ${m.viewer.canChat ? html`<div class="chat-slot" data-keep="mchat-${m.id}"></div>`
                        : html`<div class="card">${empty('lock', 'Match room is private', store.me ? 'Only the players and admins can see this chat.' : 'Log in if you are playing in this match.')}</div>`}
                </div>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        const m = d.match;
        let chat = null;
        if (m.viewer.canChat) {
            chat = mountChat($('.chat-slot', root), `match:${m.id}`, {
                evidence: true,
                height: 'min(720px, 78vh)',
                title: html`${icon('chat')}<b>Match room</b><span class="dim">${m.label}</span>`,
                notice: 'Messages here are permanent and timestamped by the server. Check-ins, no-shows and results are logged automatically — this is the record refs use.',
                placeholder: m.viewer.isParticipant ? 'Share your server / say you\'re ready…' : 'Message the players…',
            });
        }

        // Referee tally: local counter, synced to spectators live.
        const tally = $('.tally', root);
        let scores = null;
        const pushLive = debounce(() => post(`/matches/${m.id}/live`, { scores }).catch(() => {}), 250);
        if (tally && !tally._init) {
            tally._init = true;
            const cur = m.duels.find(x => x.winner === null);
            scores = cur ? [...cur.scores] : [0, 0];
            tally._scores = scores;
        } else if (tally) scores = tally._scores;

        const act = async (e, el) => {
            const a = el.dataset.act;
            const call = (path, body) => withBusy(el, () => post(`/matches/${m.id}/${path}`, body));
            if (a === 'checkin' && await call('checkin')) toast("Checked in! Your check-in time is logged in the match room.");
            if (a === 'callref' && await call('call-ref')) toast('The admins have been pinged.');
            if (a === 'claim' && await call('claim')) toast('This match is yours. Join their server and start when ready.');
            if (a === 'release' && await call('release')) toast('Released.');
            if (a === 'start' && await call('start')) toast('Match is live!');
            if (a === 'undo' && await confirm('Undo the last duel result?', 'The duel goes back to in-progress so you can correct it.', { yes: 'Undo' })) await call('undo');
            if (a === 'duel') {
                const s = tally._scores;
                const cur = m.duels.find(x => x.winner === null);
                const w = s[0] > s[1] ? 0 : 1;
                if (s[0] === s[1]) { toast('A duel cannot end tied — keep going until someone gets the next kill.', { type: 'error' }); return; }
                const ok = await confirm('Confirm duel result', `${nameOf(m, cur.players[0]).displayName} ${s[0]} – ${s[1]} ${nameOf(m, cur.players[1]).displayName}. ${nameOf(m, cur.players[w]).displayName} wins this duel.`, { yes: 'Confirm' });
                if (ok) await call('duel', { scores: s });
            }
            if (a === 'forfeit') {
                const side = root.querySelector('[name=ffside]').value;
                const reason = root.querySelector('[name=ffreason]').value.trim();
                const who = side === 'both' ? 'Both sides' : m.sides[Number(side)].entry.name;
                if (await confirm(`${who} forfeit${side === 'both' ? '' : 's'}?`, 'Forfeiting sides are knocked out and get a no-show penalty. This is logged in the match room.', { yes: 'Record forfeit', danger: true })) {
                    await call('forfeit', { side, reason: reason || 'Forfeit' });
                }
            }
            if (a === 'reschedule') {
                const v = root.querySelector('[name=resched]').value;
                if (v) await call('reschedule', { at: new Date(v).toISOString() });
            }
            if (a === 'reopen' && await confirm('Reopen this result?', 'Rating changes are reverted and the match goes back to the admin.', { yes: 'Reopen', danger: true })) await call('reopen');
            if (a === 'propose') {
                const at = await modal({
                    title: 'Propose a new time',
                    text: 'Your opponent has to accept. Times are in your local timezone.',
                    body: html`<label class="field"><span>New match time</span><input class="input" type="datetime-local" value="${toLocalInput(new Date(Date.now() + 3600e3).toISOString())}"></label><div class="form-error"></div>`,
                    actions: [{ label: 'Cancel', cls: 'ghost', value: null }, {
                        label: 'Send proposal', cls: 'primary', handler: async el2 => {
                            const v = el2.querySelector('input').value;
                            if (!v) throw new Error('Pick a time');
                            await post(`/matches/${m.id}/propose`, { at: new Date(v).toISOString() });
                            return true;
                        },
                    }],
                });
                if (at) toast('Proposal sent.');
            }
            if (a === 'accept') await call('proposal', { accept: true });
            if (a === 'decline') await call('proposal', { accept: false });
            ctx.reload();
        };

        const offs = [
            on(root, 'click', '[data-act]', (e, el) => { e.preventDefault(); act(e, el); }),
            on(root, 'click', '[data-copy]', (e, el) => { copy(el.dataset.copy).then(() => toast(`Copied ${el.dataset.copy}`)); }),
            on(root, 'click', '[data-tally]', (e, el) => {
                const i = Number(el.dataset.tally);
                const s = tally._scores;
                s[i] = Math.max(0, Math.min(99, s[i] + Number(el.dataset.d)));
                const b = $(`[data-score="${i}"]`, tally);
                b.textContent = s[i];
                b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
                scores = s;
                pushLive();
            }),
        ];
        ctx.listen('match', ev => { if (ev.id === m.id) ctx.reload(); });
        ctx.listen('reconnect', () => ctx.reload());
        // Countdown-driven states (check-in opening) need a refresh when the clock crosses them.
        const timers = [m.checkinOpensAt, m.deadlineAt].filter(Boolean).map(ts => new Date(ts).getTime() - Date.now()).filter(ms => ms > 0 && ms < 864e5)
            .map(ms => setTimeout(() => ctx.reload(), ms + 1500));
        return ({ leaving }) => {
            offs.forEach(f => f());
            timers.forEach(clearTimeout);
            if (leaving && chat) chat.destroy();
        };
    },
};


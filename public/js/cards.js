// Cards reused across pages.
import { html, time, fmtInt } from './lib.js';
import { icon } from './icons.js';
import { tStatus, modeChip, entryChip, avatar, mStatus } from './ui.js';

export function tournamentCard(t) {
    const pctFull = Math.min(100, Math.round((t.entrantCount / t.maxEntrants) * 100));
    let when;
    if (t.status === 'live') when = html`<span class="dim">${t.liveMatches ? `${t.liveMatches} match${t.liveMatches > 1 ? 'es' : ''} live` : 'In progress'}</span>`;
    else if (t.status === 'completed') when = t.champion ? html`<span class="dim">${icon('crown')} ${t.champion.name}</span>` : html`<span class="dim">Finished</span>`;
    else if (t.status === 'cancelled') when = html`<span class="dim">Cancelled</span>`;
    else when = html`<span class="dim">Starts in <b class="mono">${time(t.startAt, 'countdown')}</b></span>`;
    return html`<a class="card link t-card" href="/t/${t.id}" style="--ta:${t.accent || '#818cf8'}">
        <div class="t-card-top">
            ${tStatus(t.status)}
            ${t.myEntry ? html`<span class="chip accent">${icon('check')}${t.myEntry.checkedIn || t.status === 'live' ? 'In' : 'Joined'}</span>` : ''}
        </div>
        <h3>${t.name}</h3>
        <div class="row wrap-ok" style="gap:6px">${modeChip(t.mode)}${t.prize ? html`<span class="chip gold">${icon('trophy')}${t.prize}</span>` : ''}</div>
        <div class="t-card-foot">
            <div class="t-meta">${icon('users')}<span><b>${t.entrantCount}</b>/${t.maxEntrants} ${t.mode === 'duo' ? 'teams' : 'players'}</span></div>
            <div class="fill"><i style="width:${pctFull}%"></i></div>
            <div class="row" style="justify-content:space-between;font-size:13px">${when}${icon('arrowRight', 'go')}</div>
        </div>
    </a>`;
}

// Compact horizontal match line: [A] 2 – 1 [B]
export function matchLine(m, { showTournament = true } = {}) {
    const [a, b] = m.entries || [];
    const w = m.winnerSide;
    const live = m.status === 'live';
    const duel = m.liveDuel;
    return html`<a class="m-line ${live ? 'is-live' : ''}" href="/m/${m.id}">
        <div class="m-side ${w === 0 ? 'win' : w === 1 ? 'lose' : ''}">${entryChip(a)}</div>
        <div class="m-score mono">
            ${m.status === 'done' || live ? html`<b>${m.score[0]}</b><span>–</span><b>${m.score[1]}</b>` : html`<span class="vs">VS</span>`}
            ${live && duel ? html`<small>Duel ${duel.n}: ${duel.scores[0]}–${duel.scores[1]}</small>` : ''}
        </div>
        <div class="m-side right ${w === 1 ? 'win' : w === 0 ? 'lose' : ''}">${entryChip(b)}</div>
        ${showTournament ? html`<div class="m-meta"><span class="ellipsis">${m.tournament ? m.tournament.name : ''} · ${m.label}</span>${m.status === 'done' && m.completedAt ? time(m.completedAt, 'ago') : mStatus(m.status)}</div>` : ''}
    </a>`;
}

export function statTiles(stats) {
    return html`<div class="hero-stats">
        <div><b class="display">${fmtInt(stats.players)}</b><span>Players</span></div>
        <div><b class="display">${fmtInt(stats.tournaments)}</b><span>Tournaments</span></div>
        <div><b class="display">${fmtInt(stats.matches)}</b><span>Matches</span></div>
        <div><b class="display">${fmtInt(stats.kills)}</b><span>Kills counted</span></div>
    </div>`;
}

export function leaderRow(r, i) {
    return html`<a class="lb-mini" href="/u/${encodeURIComponent(r.user.username)}">
        <span class="rank r${i + 1}">${r.rank}</span>
        ${avatar(r.user, 'sm')}
        <span class="ellipsis" style="flex:1"><b>${r.user.displayName}</b></span>
        <span class="mono dim">${r.elo}</span>
    </a>`;
}

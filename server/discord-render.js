// Turns the site's data into Discord messages (Discord markdown, ≤ 2000 chars).
// Every message ends with the record's id so it's easy to find and edit.
const db = require('./db');
const rating = require('./rating');
const duelsLib = require('./duels');

const day = iso => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
const when = iso => (iso ? `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>` : '—');
const user = id => db.data.users[id];
const nameOf = id => { const u = user(id); return u ? (u.deleted ? 'deleted user' : u.displayName || u.username) : 'unknown'; };
const clip = (s, n = 1990) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const entryOf = (t, id) => t.entries.find(e => e.id === id);
const PLACE = { 1: '🥇', 2: '🥈', 3: '🥉' };

function modeLine(label, s) {
    if (!s.matches && !s.tournaments && !s.rp) return `**${label}** — no matches yet`;
    return `**${label}** — Elo **${s.elo}** (${rating.tierFor(s.elo).name}, peak ${s.peak}) · ${s.rp} RP · **${s.wins}W ${s.losses}L** · duels ${s.duelsWon}–${s.duelsLost} · kills ${s.kills}/${s.deaths} · 🏆 ${s.titles} · podiums ${s.podiums} · no-shows ${s.noShows}`;
}

function playerMatches(uid) {
    const out = [];
    for (const m of Object.values(db.data.matches)) {
        if (m.status !== 'done' || !m.result || !['played', 'forfeit', 'double_forfeit'].includes(m.result.type)) continue;
        const t = db.data.tournaments[m.tournamentId];
        if (!t) continue;
        const side = m.slots.findIndex(s => { const e = entryOf(t, s.entryId); return e && e.members.includes(uid); });
        if (side < 0) continue;
        const opp = entryOf(t, m.slots[1 - side].entryId);
        const sc = duelsLib.wins(m.duels || []);
        out.push({ at: m.completedAt, won: m.winnerSide === side, text: `${m.winnerSide === side ? 'W' : 'L'} vs ${opp ? opp.name : '—'} ${sc[side]}–${sc[1 - side]}${m.result.type !== 'played' ? ' (forfeit)' : ''} · ${t.name}` });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

function player(u) {
    const teams = Object.values(db.data.teams).filter(t => (t.history || []).some(h => h.userId === u.id) || t.members.includes(u.id));
    const tours = Object.values(db.data.tournaments).filter(t => ['live', 'completed'].includes(t.status) && t.entries.some(e => e.members.includes(u.id)))
        .sort((a, b) => (b.startAt || '').localeCompare(a.startAt || ''));
    const recent = playerMatches(u.id).slice(0, 6);
    const lines = [
        `**👤 ${u.displayName || u.username}** (@${u.username})${u.role === 'owner' ? ' · 👑 owner' : u.role === 'admin' || u.role === 'ref' ? ' · 🛡️ admin' : ''}${u.banned ? ' · ⛔ banned' : ''}`,
        `Roblox: ${u.roblox && u.roblox.verified ? `${u.roblox.name} (${u.roblox.id}) ✅` : u.legacy && u.legacy.robloxUsername ? `${u.legacy.robloxUsername} (not verified)` : '—'} · Joined ${day(u.createdAt)} · Last seen ${day(u.lastSeenAt)}`,
        modeLine('Solo', u.stats.solo),
        modeLine('Duo', u.stats.duo),
        `**Teams:** ${teams.length ? teams.map(t => `${t.name}${t.members.includes(u.id) && !t.disbanded ? '' : ' (past)'}`).join(', ') : '—'}`,
        `**Tournaments:** ${tours.length ? tours.slice(0, 8).map(t => { const e = t.entries.find(x => x.members.includes(u.id)); return `${t.name}${e && e.place ? ` — ${PLACE[e.place] || ordinal(e.place)}` : t.status === 'live' ? ' — live' : ''}`; }).join(' · ') : '—'}`,
        `**Recent matches:**${recent.length ? '\n' + recent.map(r => `• ${r.text}`).join('\n') : ' —'}`,
        `-# id ${u.id}`,
    ];
    return clip(lines.join('\n'));
}

function team(t) {
    let wins = 0, losses = 0;
    const tours = [];
    for (const tt of Object.values(db.data.tournaments)) {
        const e = tt.entries.find(x => x.teamId === t.id);
        if (!e || !['live', 'completed'].includes(tt.status)) continue;
        tours.push(`${tt.name}${e.place ? ` — ${PLACE[e.place] || ordinal(e.place)}` : ''}`);
        for (const mid of tt.matchIds) {
            const m = db.data.matches[mid];
            if (!m || m.status !== 'done' || !m.result || m.result.type !== 'played') continue;
            const side = m.slots.findIndex(s => s.entryId === e.id);
            if (side < 0) continue;
            if (m.winnerSide === side) wins++; else losses++;
        }
    }
    const hist = (t.history || []).map(h => `${nameOf(h.userId)} ${h.action} ${day(h.at)}`);
    return clip([
        `**👥 ${t.name}**${t.tag ? ` [${t.tag}]` : ''}${t.disbanded ? ' · disbanded' : ''}`,
        `Members: ${t.members.length ? t.members.map(nameOf).join(' & ') : '—'} · Created ${day(t.createdAt)}`,
        `Record: **${wins}W ${losses}L**`,
        `Tournaments: ${tours.join(' · ') || '—'}`,
        `History: ${hist.join(' · ') || '—'}`,
        `-# id ${t.id}`,
    ].join('\n'));
}

function tournament(t) {
    const pz = t.prizes || {};
    const placements = (t.placements || []).filter(p => p.place <= 8).map(p => `${PLACE[p.place] || ordinal(p.place)} ${(entryOf(t, p.entryId) || {}).name || '?'}`);
    return clip([
        `**🏆 ${t.name}** · ${t.mode === 'duo' ? 'Duo' : 'Solo'} · ${t.format === 'twosided' ? 'two-sided bracket' : t.format} · **${t.status}**`,
        `Start ${when(t.startAt)}${t.completedAt ? ` · ended ${when(t.completedAt)}` : ''}`,
        `Prizes: 🥇 ${pz.first || t.prize || '—'} · 🥈 ${pz.second || '—'} · 🥉 ${pz.third || '—'}`,
        `Admins: ${(t.staff || []).map(nameOf).join(', ') || '—'}`,
        `Entrants (${t.entries.length}/${t.maxEntrants}): ${t.entries.map(e => e.name + (e.dq ? ' (DQ)' : '')).join(', ') || '—'}`,
        placements.length ? `**Results:** ${placements.join(' · ')}` : null,
        t.cancelledReason ? `Cancelled: ${t.cancelledReason}` : null,
        `-# id ${t.id}`,
    ].filter(Boolean).join('\n'));
}

function match(m) {
    const t = db.data.tournaments[m.tournamentId];
    const [a, b] = m.slots.map(s => entryOf(t, s.entryId));
    const sc = duelsLib.wins(m.duels || []);
    const winner = m.winnerSide === 0 ? a : m.winnerSide === 1 ? b : null;
    const duels = (m.duels || []).filter(d => d.winner !== null).map(d => `${d.kind === 'decider' ? 'Decider' : `Duel ${d.n}`}: ${nameOf(d.players[0])} ${d.scores[0]}–${d.scores[1]} ${nameOf(d.players[1])}`);
    return clip([
        `**⚔️ ${t.name} — ${m.label}** · ${when(m.completedAt)}`,
        `${a ? a.name : '—'} **${sc[0]} – ${sc[1]}** ${b ? b.name : '—'} → ${winner ? `**${winner.name}** wins` : 'no winner'}${m.result.type !== 'played' ? ` (${m.result.type.replace('_', ' ')}${m.result.note ? `: ${m.result.note}` : ''})` : m.result.note ? ` (${m.result.note})` : ''}`,
        duels.length ? duels.join('\n') : null,
        `Admin: ${m.refId ? nameOf(m.refId) : '—'} · checked in: ${Object.entries(m.checkins || {}).map(([uid, at]) => `${nameOf(uid)} ${new Date(at).toISOString().slice(11, 19)}`).join(', ') || '—'}`,
        `-# id ${m.id}`,
    ].filter(Boolean).join('\n'));
}

function transcript(m) {
    const t = db.data.tournaments[m.tournamentId];
    const list = db.data.messages[`match:${m.id}`] || [];
    const body = list.map(x => `[${x.at.replace('T', ' ').slice(0, 19)} UTC] ${x.kind === 'system' ? 'SYSTEM' : nameOf(x.userId)}: ${x.text.replace(/\{t:([^}]+)\}/g, (_, iso) => iso.replace('T', ' ').slice(0, 19) + ' UTC')}`).join('\n');
    return { text: `💬 Match room log — **${t.name} · ${m.label}** (${list.length} messages) · -# id ${m.id}`, file: { name: `match-${m.id}.txt`, body: body || '(no messages)' } };
}

function leaderboard() {
    const top = mode => Object.values(db.data.users)
        .filter(u => !u.deleted && !u.banned && !u.isBot && (u.stats[mode].matches || u.stats[mode].rp))
        .sort((a, b) => b.stats[mode].elo - a.stats[mode].elo).slice(0, 15)
        .map((u, i) => `${i + 1}. **${u.displayName}** — ${u.stats[mode].elo} (${rating.tierFor(u.stats[mode].elo).name}) · ${u.stats[mode].wins}W ${u.stats[mode].losses}L`);
    return clip([
        '**📊 FTAP Arena leaderboard**',
        '__Solo__', ...(top('solo').length ? top('solo') : ['—']),
        '', '__Duo__', ...(top('duo').length ? top('duo') : ['—']),
        `-# updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ].join('\n'));
}

// Everything that should exist in Discord right now. `key` identifies the message.
function all() {
    const out = [];
    for (const u of Object.values(db.data.users)) if (!u.deleted && !u.isBot) out.push({ key: `player:${u.id}`, channel: 'players', text: player(u) });
    for (const t of Object.values(db.data.teams)) if (!t.isBot && (t.members.length || (t.history || []).length)) out.push({ key: `team:${t.id}`, channel: 'teams', text: team(t) });
    for (const t of Object.values(db.data.tournaments)) {
        if (t.status === 'draft') continue;
        out.push({ key: `tournament:${t.id}`, channel: 'tournaments', text: tournament(t) });
        if (t.status === 'completed' && t.championEntryId) {
            const c = entryOf(t, t.championEntryId);
            out.push({ key: `hof:${t.id}`, channel: 'hall-of-fame', text: `👑 **${c ? c.name : '?'}** won **${t.name}** (${t.mode === 'duo' ? 'duo' : 'solo'}, ${t.entries.length} entrants) · ${when(t.completedAt)}${(t.prizes || {}).first ? ` · prize: ${t.prizes.first}` : ''}` });
        }
    }
    for (const m of Object.values(db.data.matches)) {
        if (m.status !== 'done' || !m.result || !['played', 'forfeit', 'double_forfeit'].includes(m.result.type)) continue;
        if (!db.data.tournaments[m.tournamentId]) continue;
        out.push({ key: `match:${m.id}`, channel: 'matches', text: match(m) });
        const tr = transcript(m);
        out.push({ key: `chat:${m.id}`, channel: 'match-chats', text: tr.text, file: tr.file });
    }
    out.push({ key: 'leaderboard', channel: 'leaderboard', text: leaderboard().replace(/-# updated .*$/, '') + `-# updated automatically` });
    return out;
}

module.exports = { all, player, team, tournament, match, transcript, leaderboard };

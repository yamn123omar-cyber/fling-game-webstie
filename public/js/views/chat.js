import { html, $, ago } from '../lib.js';
import { get } from '../api.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { avatar, empty, mStatus } from '../ui.js';
import { mountChat } from '../chat.js';

const GROUPS = [['match', 'Match rooms'], ['dm', 'Direct messages'], ['team', 'Teams'], ['tour', 'Tournaments']];

function chName(c) {
    if (c.type === 'dm') return c.other ? c.other.displayName : 'Unknown';
    return c.name || 'Chat';
}

function chIcon(c) {
    if (c.type === 'dm') return avatar(c.other, 'md', { online: true });
    if (c.type === 'team') return html`<span class="ch-ico" style="--c:${c.color || '#888'}">${icon('users')}</span>`;
    if (c.type === 'match') return html`<span class="ch-ico match">${icon('swords')}</span>`;
    return html`<span class="ch-ico tour" style="--c:${c.accent || '#818cf8'}">${icon('trophy')}</span>`;
}

function preview(c) {
    if (!c.last) return c.type === 'dm' ? 'Say hi 👋' : c.sub || '';
    const who = c.last.kind === 'system' ? '' : c.last.userId === store.me.id ? 'You: ' : c.lastAuthor ? `${c.lastAuthor}: ` : '';
    return who + c.last.text.replace(/\{t:[^}]+\}/g, '…');
}

export default {
    title: 'Chat',
    auth: true,
    load: () => get('/chat/channels'),
    render(d, ctx) {
        const active = ctx.params.channel || null;
        const cur = d.channels.find(c => c.id === active);
        return html`<div class="wrap page chat-page ${active ? 'has-active' : ''}">
            <aside class="ch-list card flush">
                <div class="ch-list-head"><h2>Chat</h2><a class="btn sm" href="/players?tab=friends">${icon('userPlus')}Friends</a></div>
                ${d.channels.length ? GROUPS.map(([type, label]) => {
                    const list = d.channels.filter(c => c.type === type);
                    if (!list.length) return '';
                    return html`<div class="ch-group"><div class="ch-group-title">${label}</div>${list.map(c => html`<a class="ch ${c.id === active ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="/chat/${encodeURIComponent(c.id)}">
                        ${chIcon(c)}
                        <div class="ch-body"><div class="row" style="gap:6px"><b class="ellipsis">${chName(c)}</b>${c.type === 'match' && c.status && c.status !== 'done' ? mStatus(c.status) : ''}</div>
                            <span class="ellipsis">${preview(c)}</span></div>
                        <div class="ch-side">${c.last ? html`<time>${ago(c.last.at)}</time>` : ''}${c.unread ? html`<span class="badge-dot">${c.unread}</span>` : ''}</div>
                    </a>`)}</div>`;
                }) : empty('chat', 'No conversations yet', 'Add friends to message them. Match rooms show up here when you play.')}
            </aside>
            <section class="ch-main">
                ${active ? html`
                    <div class="ch-main-head">
                        <a class="btn ghost icon sm back" href="/chat" aria-label="Back">${icon('left')}</a>
                        ${cur ? chIcon(cur) : ''}
                        <div class="ellipsis" style="flex:1"><b>${cur ? chName(cur) : 'Conversation'}</b>${cur && cur.sub ? html`<div class="dim ellipsis" style="font-size:13px">${cur.sub}</div>` : ''}</div>
                        ${cur && cur.type === 'match' ? html`<a class="btn sm" href="/m/${cur.matchId}">Open match ${icon('arrowRight')}</a>` : ''}
                        ${cur && cur.type === 'dm' && cur.other ? html`<a class="btn sm" href="/u/${encodeURIComponent(cur.other.username)}">Profile</a>` : ''}
                        ${cur && cur.type === 'team' ? html`<a class="btn sm" href="/team/${cur.teamId}">Team</a>` : ''}
                        ${cur && cur.type === 'tour' ? html`<a class="btn sm" href="/t/${cur.tournamentId}">Tournament</a>` : ''}
                    </div>
                    <div class="chat-slot" data-keep="chatpage-${active}"></div>`
                    : html`<div class="card ch-empty">${empty('chat', 'Pick a conversation', 'Your match rooms, DMs, team and tournament chats all live here.')}</div>`}
            </section>
        </div>`;
    },
    mount(root, d, ctx) {
        const active = ctx.params.channel;
        let chat = null;
        if (active) {
            chat = mountChat($('.chat-slot', root), active, {
                evidence: active.startsWith('match:'),
                notice: active.startsWith('match:') ? 'Match room messages are permanent and timestamped.' : null,
            });
            if (chat && window.innerWidth > 800) chat.focus();
        }
        ctx.listen('message', () => ctx.reload());
        ctx.listen('friends', () => ctx.reload());
        return ({ leaving }) => { if (leaving && chat) chat.destroy(); };
    },
};

// Live chat panel used by the chat page, match rooms, team and tournament pages.
import { html, h, $, esc, clock, renderTokens, linkify } from './lib.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { avatar, roleTag, toastError } from './ui.js';

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(iso) {
    const now = new Date();
    if (sameDay(iso, now)) return 'Today';
    if (sameDay(iso, new Date(now.getTime() - 864e5))) return 'Yesterday';
    return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function chatPanel(channel, { title = null, notice = null, placeholder = 'Message…', height = null, evidence = false } = {}) {
    const el = h(String(html`<div class="chat ${evidence ? 'evidence' : ''}" ${height ? html`style="height:${height}"` : ''}>
        ${title ? html`<div class="chat-head">${title}</div>` : ''}
        ${notice ? html`<div class="chat-notice">${icon('lock')}<span>${notice}</span></div>` : ''}
        <div class="chat-log" role="log" aria-live="polite"><div class="chat-loading"><div class="spinner"></div></div></div>
        <form class="chat-form">
            <input class="input" name="text" maxlength="500" autocomplete="off" placeholder="${placeholder}" disabled>
            <button class="btn primary icon" type="submit" aria-label="Send" disabled>${icon('send')}</button>
        </form>
    </div>`));
    const log = $('.chat-log', el);
    const form = $('.chat-form', el);
    const input = form.text;
    const users = {};
    let messages = [];
    let hasMore = false;
    let loadingOlder = false;
    let alive = true;

    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const toBottom = () => { log.scrollTop = log.scrollHeight; };

    function msgHtml(m, prev) {
        const day = !prev || !sameDay(prev.at, m.at) ? html`<div class="chat-day"><span>${dayLabel(m.at)}</span></div>` : '';
        if (m.kind === 'system') {
            return html`${day}<div class="msg sys ${m.meta && m.meta.event ? `ev-${m.meta.event}` : ''}"><span class="sys-dot"></span><div><p>${renderTokens(m.text)}</p><time title="${new Date(m.at).toLocaleString()}">${clock(m.at, true)}</time></div></div>`;
        }
        const u = users[m.userId] || { displayName: 'Unknown', username: '' };
        const mine = store.me && m.userId === store.me.id;
        const grouped = prev && prev.kind !== 'system' && prev.userId === m.userId && new Date(m.at) - new Date(prev.at) < 5 * 60e3 && !day.s;
        return html`${day}<div class="msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">
            ${grouped ? html`<span class="msg-av"></span>` : html`<a class="msg-av" href="/u/${encodeURIComponent(u.username)}">${avatar(u, 'sm')}</a>`}
            <div class="msg-body">
                ${grouped ? '' : html`<div class="msg-meta"><a href="/u/${encodeURIComponent(u.username)}"><b>${u.displayName}</b></a>${roleTag(u)}<time title="${new Date(m.at).toLocaleString()}">${clock(m.at, evidence)}</time></div>`}
                <p>${linkify(m.text)}</p>
            </div>
        </div>`;
    }

    function renderAll() {
        log.innerHTML = String(html`${hasMore ? html`<button class="btn ghost sm chat-more" type="button">Load older messages</button>` : ''}${messages.length ? messages.map((m, i) => msgHtml(m, messages[i - 1])) : html`<div class="chat-empty">${icon('chat')}<span>No messages yet. Say hi!</span></div>`}`);
    }

    async function load() {
        try {
            const res = await get(`/chat/messages?channel=${encodeURIComponent(channel)}`);
            Object.assign(users, res.users);
            messages = res.messages;
            hasMore = res.hasMore;
            renderAll();
            toBottom();
            if (res.canWrite) {
                input.disabled = false;
                form.querySelector('button').disabled = false;
            } else {
                input.placeholder = res.reason || 'Read only';
            }
            post('/chat/read', { channel }).then(() => store.refreshMe()).catch(() => {});
        } catch (e) {
            log.innerHTML = String(html`<div class="chat-empty">${icon('lock')}<span>${e.message}</span></div>`);
        }
    }

    async function older() {
        if (loadingOlder || !messages.length) return;
        loadingOlder = true;
        try {
            const res = await get(`/chat/messages?channel=${encodeURIComponent(channel)}&before=${encodeURIComponent(messages[0].at)}`);
            Object.assign(users, res.users);
            const h0 = log.scrollHeight;
            messages = [...res.messages, ...messages];
            hasMore = res.hasMore;
            renderAll();
            log.scrollTop = log.scrollHeight - h0;
        } finally { loadingOlder = false; }
    }

    function append(m, author) {
        if (messages.some(x => x.id === m.id)) return;
        if (author) users[author.id] = author;
        const stick = atBottom() || (store.me && m.userId === store.me.id);
        const prev = messages[messages.length - 1];
        messages.push(m);
        if (messages.length === 1) renderAll();
        else log.insertAdjacentHTML('beforeend', String(msgHtml(m, prev)));
        if (stick) toBottom();
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        try {
            const res = await post('/chat/messages', { channel, text });
            append(res.message, res.author);
        } catch (err) {
            input.value = text;
            toastError(err);
        }
    });
    log.addEventListener('click', e => { if (e.target.closest('.chat-more')) older(); });

    const off = store.on('message', ev => {
        if (!alive) return;
        if (!el.isConnected) return;
        if (ev.channelId !== channel) return;
        append(ev.message, ev.author);
        if (document.visibilityState === 'visible') post('/chat/read', { channel }).catch(() => {});
    });
    const offRe = store.on('reconnect', () => { if (alive) load(); });

    load();
    el.chat = {
        destroy() { alive = false; off(); offRe(); },
        focus() { input.focus(); },
        channel,
    };
    return el;
}

export function mountChat(slot, channel, opts) {
    if (!slot) return null;
    if (slot.classList.contains('chat')) return slot.chat; // kept from previous render
    const panel = chatPanel(channel, opts);
    slot.replaceWith(panel);
    panel.dataset.keep = slot.dataset.keep || `chat:${channel}`;
    return panel.chat;
}

export { esc };

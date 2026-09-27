import { html, $, on, h, renderTokens, time, ago } from './lib.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { route, start, navigate, currentPath } from './router.js';
import { icon, logoMark } from './icons.js';
import { avatar, popover, closePopover, toast, toastError, empty } from './ui.js';

route('/', () => import('./views/home.js'));
route('/login', () => import('./views/auth.js'));
route('/register', () => import('./views/auth.js'));
route('/tournaments', () => import('./views/tournaments.js'));
route('/t/:id', () => import('./views/tournament.js'));
route('/m/:id', () => import('./views/match.js'));
route('/leaderboard', () => import('./views/leaderboard.js'));
route('/u/:username', () => import('./views/profile.js'));
route('/settings', () => import('./views/settings.js'));
route('/teams', () => import('./views/teams.js'));
route('/team/:id', () => import('./views/team.js'));
route('/friends', () => import('./views/friends.js'));
route('/chat', () => import('./views/chat.js'));
route('/chat/:channel', () => import('./views/chat.js'));
route('/ref', () => import('./views/ref.js'));
route('/admin', () => import('./views/admin.js'));
route('/admin/tournaments/new', () => import('./views/tournament-edit.js'));
route('/admin/tournaments/:id', () => import('./views/tournament-edit.js'));
route('/rules', () => import('./views/rules.js'));

// ── Shell ───────────────────────────────────────────────────────────────
const LINKS = [
    { href: '/tournaments', label: 'Tournaments', icon: 'trophy' },
    { href: '/leaderboard', label: 'Leaderboard', icon: 'chart' },
    { href: '/teams', label: 'Teams', icon: 'users', auth: true },
    { href: '/chat', label: 'Chat', icon: 'chat', auth: true, count: 'chat' },
    { href: '/rules', label: 'How it works', icon: 'book' },
];

function isOn(href) {
    const p = currentPath();
    if (href === '/tournaments') return p.startsWith('/tournaments') || p.startsWith('/t/') || p.startsWith('/m/');
    if (href === '/teams') return p.startsWith('/team');
    return p === href || p.startsWith(href + '/');
}

function nextMatchPill() {
    const m = store.myMatches.find(x => ['live', 'ready', 'scheduled'].includes(x.status));
    if (!m) return '';
    const opp = m.entries[1 - m.mySide];
    if (m.status === 'live') return html`<a class="next-match live" href="/m/${m.id}">${icon('swords')}<span class="txt">LIVE vs ${opp ? opp.name : 'TBD'}</span></a>`;
    if (m.status === 'ready') return html`<a class="next-match" href="/m/${m.id}">${icon('swords')}<span class="txt">Match ready</span></a>`;
    if (Date.now() < new Date(m.scheduledAt).getTime()) {
        return html`<a class="next-match" href="/m/${m.id}" title="Your next match">${icon('clock')}<span class="txt">Match ${time(m.scheduledAt, 'countdown')}</span></a>`;
    }
    return m.checkedIn
        ? html`<a class="next-match" href="/m/${m.id}">${icon('swords')}<span class="txt">Match now</span></a>`
        : html`<a class="next-match live" href="/m/${m.id}" title="Check in before the deadline or you forfeit">${icon('alert')}<span class="txt">Check in! ${time(m.deadlineAt, 'countdown')}</span></a>`;
}

function renderNav() {
    const me = store.me;
    const c = store.counts;
    const nav = $('#nav');
    const social = c.friendRequests + c.teamInvites;
    nav.innerHTML = String(html`<div class="wrap">
        <a class="logo" href="/" aria-label="FTAP Arena home">${logoMark}<span>FTAP <em>ARENA</em></span></a>
        <nav class="nav-links">
            ${LINKS.filter(l => !l.auth || me).map(l => html`<a href="${l.href}" class="${isOn(l.href) ? 'on' : ''}">${l.label}${l.count && c[l.count] ? html`<span class="badge-dot">${c[l.count]}</span>` : ''}</a>`)}
        </nav>
        <div class="nav-right">
            ${me ? html`
                ${nextMatchPill()}
                <a class="icon-btn" href="/friends" title="Friends">${icon('userPlus')}${social ? html`<span class="badge-dot">${social}</span>` : ''}</a>
                <button class="icon-btn" data-act="notifs" title="Notifications">${icon('bell')}${c.notifications ? html`<span class="badge-dot red">${c.notifications > 99 ? '99+' : c.notifications}</span>` : ''}</button>
                <button class="me-btn" data-act="me" aria-label="Account menu">${avatar(me, 'sm')}${icon('down', 'muted')}</button>
            ` : html`
                <a class="btn ghost" href="/login">Log in</a>
                <a class="btn primary" href="/register">Sign up</a>
            `}
            <button class="icon-btn burger" data-act="burger" aria-label="Menu">${icon('menu')}</button>
        </div>
    </div>`);
    const s = store.connected === false && store._everConnected;
    document.body.classList.toggle('offline', Boolean(s));
}

function meMenu(anchor) {
    const me = store.me;
    popover(anchor, html`
        <div class="menu-head">${avatar(me, 'md')}<div style="margin-top:8px"><b>${me.displayName}</b><div class="muted" style="font-size:13px">@${me.username}</div></div></div>
        <hr>
        <a href="/u/${encodeURIComponent(me.username)}">${icon('user')}My profile</a>
        <a href="/teams">${icon('users')}My teams</a>
        <a href="/friends">${icon('userPlus')}Friends</a>
        <a href="/settings">${icon('cog')}Settings</a>
        ${store.isStaff() ? html`<hr><a href="/ref">${icon('whistle')}Ref desk</a>` : ''}
        ${store.isAdmin() ? html`<a href="/admin">${icon('shield')}Admin</a>` : ''}
        <hr>
        <button data-act="logout" data-close>${icon('logout')}Log out</button>
    `);
}

const NOTIF_ICON = { friend: 'userPlus', team: 'users', match: 'swords', result: 'trophy', tournament: 'trophy', checkin: 'clock', ref: 'whistle', dm: 'chat', role: 'shield' };

async function notifMenu(anchor) {
    const el = popover(anchor, html`<div class="empty" style="padding:30px"><div class="spinner"></div></div>`, { cls: 'notif-panel' });
    try {
        const res = await get('/notifications');
        el.innerHTML = String(html`<header>Notifications<span class="spacer"></span>${res.unread ? html`<span class="chip accent">${res.unread} new</span>` : ''}</header>
            ${res.notifications.length ? res.notifications.map(n => html`<a class="notif ${n.read ? '' : 'unread'}" href="${n.link || '#'}">
                <span class="ico">${icon(NOTIF_ICON[n.type] || 'bell')}</span>
                <span>${renderTokens(n.text)}<time>${ago(n.at)}</time></span></a>`) : empty('bell', 'All quiet', 'Match calls, invites and results show up here.')}`);
        if (res.unread) {
            await post('/notifications/read');
            store.counts.notifications = 0;
            store.emit('counts', store.counts);
        }
    } catch (e) {
        el.innerHTML = String(empty('alert', 'Could not load notifications'));
    }
}

function drawer() {
    const existing = $('.drawer');
    if (existing) { existing.remove(); return; }
    const me = store.me;
    const el = h(String(html`<div class="drawer">
        <a href="/" class="${currentPath() === '/' ? 'on' : ''}">${icon('home')}Home</a>
        ${LINKS.filter(l => !l.auth || me).map(l => html`<a href="${l.href}" class="${isOn(l.href) ? 'on' : ''}">${icon(l.icon)}${l.label}</a>`)}
        ${me ? html`<a href="/friends">${icon('userPlus')}Friends</a><a href="/settings">${icon('cog')}Settings</a>` : ''}
        ${store.isStaff() ? html`<a href="/ref">${icon('whistle')}Ref desk</a>` : ''}
        ${store.isAdmin() ? html`<a href="/admin">${icon('shield')}Admin</a>` : ''}
        ${!me ? html`<a href="/login">${icon('user')}Log in</a><a href="/register">${icon('userPlus')}Sign up</a>` : ''}
    </div>`));
    el.addEventListener('click', e => { if (e.target.closest('a')) el.remove(); });
    document.body.append(el);
}

function renderFooter() {
    $('#footer').innerHTML = String(html`<div class="wrap">
        <a class="logo" href="/">${logoMark}<span>FTAP <em>ARENA</em></span></a>
        <nav><a href="/tournaments">Tournaments</a><a href="/leaderboard">Leaderboard</a><a href="/rules">Rules & scoring</a><a href="https://www.roblox.com/search/universes?keyword=fling%20things%20and%20people" target="_blank" rel="noopener">Play FTAP</a></nav>
        <span class="spacer"></span>
        <span>Fan-made community site · not affiliated with Roblox</span>
    </div>`);
}

async function boot() {
    const nav = $('#nav');
    on(nav, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'me') meMenu(el);
        if (act === 'notifs') notifMenu(el);
        if (act === 'burger') drawer();
    });
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act="logout"]');
        if (!btn) return;
        closePopover();
        try {
            await post('/auth/logout');
            store.setSession(null);
            navigate('/');
            toast('Logged out. See you in the arena!');
        } catch (err) { toastError(err); }
    });

    store.on('me', renderNav);
    store.on('counts', renderNav);
    store.on('route', () => { renderNav(); closePopover(); $('.drawer')?.remove(); });
    store.on('mymatches', renderNav);
    store.on('connection', renderNav);
    store.on('notification', n => {
        const t = n.type === 'dm' && currentPath().startsWith('/chat') ? null : n;
        if (t) toast(renderTokens(t.text), { type: 'info', link: t.link, linkText: 'View' });
    });
    store.on('refqueue', ev => {
        if (store.isStaff()) toast(`Match ready for a referee: ${ev.label}`, { type: 'info', link: `/m/${ev.matchId}`, linkText: 'Ref it' });
    });

    renderFooter();
    setInterval(() => { if (store.myMatches.length) renderNav(); }, 20000); // pill text changes as times pass
    try {
        store.setSession(await get('/me'));
    } catch {
        store.setSession(null);
    }
    renderNav();
    start();
}

boot();

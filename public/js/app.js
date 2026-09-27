import { html, $, on, renderTokens, time, ago } from './lib.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { route, start, navigate, currentPath } from './router.js';
import { icon } from './icons.js';
import { avatar, popover, closePopover, toast, toastError, empty } from './ui.js';

route('/', () => import('./views/home.js'));
route('/login', () => import('./views/auth.js'));
route('/register', () => import('./views/auth.js'));
route('/tournaments', () => import('./views/tournaments.js'));
route('/t/:id', () => import('./views/tournament.js'));
route('/bracket', () => import('./views/bracket.js'));
route('/bracket/:id', () => import('./views/bracket.js'));
route('/matches', () => import('./views/matches.js'));
route('/m/:id', () => import('./views/match.js'));
route('/players', () => import('./views/players.js'));
route('/teams', () => import('./views/teams.js'));
route('/team/:id', () => import('./views/team.js'));
route('/chat', () => import('./views/chat.js'));
route('/chat/:channel', () => import('./views/chat.js'));
route('/leaderboard', () => import('./views/leaderboard.js'));
route('/u/:username', () => import('./views/profile.js'));
route('/settings', () => import('./views/settings.js'));
route('/admin', () => import('./views/admin.js'));
route('/admin/tournaments/new', () => import('./views/tournament-edit.js'));
route('/admin/tournaments/:id', () => import('./views/tournament-edit.js'));
route('/owner', () => import('./views/owner.js'));
route('/rules', () => import('./views/rules.js'));

// ── Theme ───────────────────────────────────────────────────────────────
function getTheme() {
    try { return localStorage.getItem('ft-theme') || 'dark'; } catch { return 'dark'; }
}
function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('ft-theme', t); } catch { /* private mode */ }
}
setTheme(getTheme());

// ── Sidebar ─────────────────────────────────────────────────────────────
const actionable = () => store.myMatches.filter(m => m.status === 'live' || m.status === 'ready' || (m.status === 'scheduled' && !m.checkedIn)).length;

function navItems() {
    const c = store.counts;
    const items = [
        { href: '/', label: 'My Stats', on: p => p === '/' },
        { href: '/players', label: 'Players', count: c.friendRequests, on: p => p.startsWith('/players') || p.startsWith('/u/') },
        { href: '/teams', label: 'My Team', count: c.teamInvites, on: p => p.startsWith('/team') },
        { href: '/tournaments', label: 'Tournaments', on: p => p.startsWith('/tournaments') || p.startsWith('/t/') },
        { href: '/matches', label: 'My Matches', count: actionable(), on: p => p.startsWith('/matches') || p.startsWith('/m/') },
        { href: '/leaderboard', label: 'Leaderboard', on: p => p.startsWith('/leaderboard') },
        { href: '/bracket', label: 'Bracket', on: p => p.startsWith('/bracket') },
        { href: '/chat', label: 'Chat', count: c.chat, on: p => p.startsWith('/chat') },
    ];
    if (store.isStaff()) items.push({ href: '/admin', label: 'Admin Panel', on: p => p.startsWith('/admin') });
    if (store.isOwner()) items.push({ href: '/owner', label: 'Owner Panel', on: p => p.startsWith('/owner') });
    return items;
}

function renderSidebar() {
    const el = $('#sidebar');
    if (!store.me) { el.innerHTML = ''; return; }
    const p = currentPath();
    el.innerHTML = String(html`<nav class="side-nav" aria-label="Main">
        ${navItems().map(i => html`<a href="${i.href}" class="side-item ${i.on(p) ? 'on' : ''}" ${i.on(p) ? html`aria-current="page"` : ''}>${i.label}${i.count ? html`<span class="badge-dot">${i.count}</span>` : ''}</a>`)}
    </nav>`);
}

// ── Top bar ─────────────────────────────────────────────────────────────
function nextMatchPill() {
    const m = store.myMatches.find(x => ['live', 'ready', 'scheduled'].includes(x.status));
    if (!m) return '';
    const opp = m.entries[1 - m.mySide];
    if (m.status === 'live') return html`<a class="next-match live" href="/m/${m.id}">${icon('swords')}<span class="txt">LIVE vs ${opp ? opp.name : 'TBD'}</span></a>`;
    if (m.status === 'ready') return html`<a class="next-match" href="/m/${m.id}">${icon('swords')}<span class="txt">Match ready</span></a>`;
    if (Date.now() < new Date(m.scheduledAt).getTime()) {
        return html`<a class="next-match" href="/m/${m.id}" title="Your next match">${icon('clock')}<span class="txt">Match in ${time(m.scheduledAt, 'countdown')}</span></a>`;
    }
    return m.checkedIn
        ? html`<a class="next-match" href="/m/${m.id}">${icon('swords')}<span class="txt">Match now</span></a>`
        : html`<a class="next-match live" href="/m/${m.id}" title="Check in before the deadline or you forfeit">${icon('alert')}<span class="txt">Check in! ${time(m.deadlineAt, 'countdown')}</span></a>`;
}

function renderTopbar() {
    const me = store.me;
    const c = store.counts;
    const nav = $('#nav');
    document.body.classList.toggle('authed', Boolean(me));
    if (!me) { nav.innerHTML = ''; return; }
    const live = store.connected !== false || !store._everConnected;
    nav.innerHTML = String(html`
        <button class="icon-btn burger" data-act="burger" aria-label="Open menu">${icon('menu')}</button>
        <a class="logo" href="/"><span class="bolt">⚡</span><span>FLING TOURNAMENT</span></a>
        <div class="top-right">
            ${live ? '' : html`<span class="pill off">● Offline</span>`}
            ${nextMatchPill()}
            <button class="top-btn" data-act="theme" title="Light / dark">${getTheme() === 'light' ? '🌙' : '☀️'}</button>
            <button class="top-btn" data-act="notifs" title="Notifications">🔔${c.notifications ? html`<span class="badge-dot red">${c.notifications > 99 ? '99+' : c.notifications}</span>` : ''}</button>
            <button class="user-pill" data-act="me">${me.displayName}</button>
            <button class="logout-btn" data-act="logout">Logout</button>
        </div>`);
}

function renderAll() { renderTopbar(); renderSidebar(); }

function meMenu(anchor) {
    const me = store.me;
    popover(anchor, html`
        <div class="menu-head">${avatar(me, 'md')}<div style="margin-top:8px"><b>${me.displayName}</b><div class="muted" style="font-size:13px">@${me.username} · ${me.role === 'owner' ? 'Owner' : me.role === 'admin' ? 'Admin' : 'Player'}</div></div></div>
        <hr>
        <a href="/u/${encodeURIComponent(me.username)}">${icon('user')}My profile</a>
        <a href="/settings">${icon('cog')}Settings</a>
        <a href="/rules">${icon('book')}Rules</a>
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
    } catch {
        el.innerHTML = String(empty('alert', 'Could not load notifications'));
    }
}

async function boot() {
    on(document.body, 'click', '[data-act]', async (e, el) => {
        const act = el.dataset.act;
        if (act === 'me') meMenu(el);
        if (act === 'notifs') notifMenu(el);
        if (act === 'burger') document.body.classList.toggle('side-open');
        if (act === 'theme') { setTheme(getTheme() === 'light' ? 'dark' : 'light'); renderTopbar(); }
        if (act === 'logout') {
            closePopover();
            try {
                await post('/auth/logout');
                store.setSession(null);
                navigate('/login', { replace: true });
                toast('Logged out. See you in the arena!');
            } catch (err) { toastError(err); }
        }
    });
    // Close the mobile menu when a link is chosen or the dimmed area is tapped.
    document.addEventListener('click', e => {
        if (!document.body.classList.contains('side-open')) return;
        if (e.target.closest('#sidebar a') || e.target.id === 'side-scrim') document.body.classList.remove('side-open');
    });

    store.on('me', renderAll);
    store.on('counts', renderAll);
    store.on('route', () => { renderAll(); closePopover(); });
    store.on('mymatches', renderAll);
    store.on('connection', renderTopbar);
    store.on('notification', n => {
        if (n.type === 'dm' && currentPath().startsWith('/chat')) return;
        toast(renderTokens(n.text), { type: 'info', link: n.link, linkText: 'View' });
    });
    store.on('refqueue', ev => {
        if (store.isStaff()) toast(`A match is ready to be scored: ${ev.label}`, { type: 'info', link: `/m/${ev.matchId}`, linkText: 'Open' });
    });
    setInterval(() => { if (store.myMatches.length) renderTopbar(); }, 20000);

    try {
        store.setSession(await get('/me'));
    } catch {
        store.setSession(null);
    }
    renderAll();
    start();
}

boot();


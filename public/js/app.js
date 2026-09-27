import { html, $, on, renderTokens, time, ago } from './lib.js';
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

function navGroups() {
    const me = store.me;
    const c = store.counts;
    const groups = [
        { title: 'Play', items: [
            { href: '/', label: 'Home', icon: 'home', on: p => p === '/' },
            { href: '/tournaments', label: 'Tournaments', icon: 'trophy', on: p => p.startsWith('/tournaments') || p.startsWith('/t/') },
            { href: '/bracket', label: 'Bracket', icon: 'bracket', on: p => p.startsWith('/bracket') },
            { href: '/matches', label: 'My matches', icon: 'swords', count: actionable(), on: p => p.startsWith('/matches') || p.startsWith('/m/') },
        ] },
        { title: 'Friends & teams', items: [
            { href: '/players', label: 'Players & friends', icon: 'users', count: c.friendRequests, on: p => p.startsWith('/players') },
            { href: '/teams', label: 'My team', icon: 'shield', count: c.teamInvites, on: p => p.startsWith('/team') },
            { href: '/chat', label: 'Chat', icon: 'chat', count: c.chat, on: p => p.startsWith('/chat') },
        ] },
        { title: 'Stats', items: [
            { href: '/leaderboard', label: 'Leaderboard', icon: 'chart', on: p => p.startsWith('/leaderboard') },
            { href: `/u/${encodeURIComponent(me.username)}`, label: 'My profile', icon: 'user', on: p => p === `/u/${encodeURIComponent(me.username)}` },
        ] },
    ];
    if (store.isStaff()) groups.push({ title: 'Admin', items: [{ href: '/admin', label: 'Admin panel', icon: 'whistle', on: p => p.startsWith('/admin') }] });
    if (store.isOwner()) groups.push({ title: 'Owner', items: [{ href: '/owner', label: 'Owner panel', icon: 'crown', on: p => p.startsWith('/owner') }] });
    return groups;
}

function renderSidebar() {
    const el = $('#sidebar');
    if (!store.me) { el.innerHTML = ''; return; }
    const p = currentPath();
    el.innerHTML = String(html`<nav class="side-nav" aria-label="Main">
        ${navGroups().map(g => html`<div class="side-group">
            <div class="side-title">${g.title}</div>
            ${g.items.map(i => html`<a href="${i.href}" class="side-item ${i.on(p) ? 'on' : ''}" ${i.on(p) ? html`aria-current="page"` : ''}>
                ${icon(i.icon)}<span>${i.label}</span>${i.count ? html`<span class="badge-dot">${i.count}</span>` : ''}</a>`)}
        </div>`)}
        <div class="side-foot">
            <a href="/settings" class="side-item ${p.startsWith('/settings') ? 'on' : ''}">${icon('cog')}<span>Settings</span></a>
            <a href="/rules" class="side-item ${p.startsWith('/rules') ? 'on' : ''}">${icon('book')}<span>How it works</span></a>
            <button class="side-item" data-act="logout">${icon('logout')}<span>Log out</span></button>
        </div>
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
        <a class="logo" href="/" aria-label="Fling Tournament home">${logoMark}<span>FLING <em>TOURNAMENT</em></span></a>
        <span class="sync ${live ? 'ok' : 'off'}" title="${live ? 'Live — updates appear instantly' : 'Reconnecting…'}"><i></i><span>${live ? 'Live' : 'Reconnecting'}</span></span>
        <div class="top-right">
            ${nextMatchPill()}
            <button class="icon-btn" data-act="theme" title="Switch light / dark">${icon(getTheme() === 'light' ? 'moon' : 'sun')}</button>
            <button class="icon-btn" data-act="notifs" title="Notifications">${icon('bell')}${c.notifications ? html`<span class="badge-dot red">${c.notifications > 99 ? '99+' : c.notifications}</span>` : ''}</button>
            <button class="me-btn" data-act="me" aria-label="Account menu">${avatar(me, 'sm')}<span class="me-name">${me.displayName}</span>${icon('down', 'muted')}</button>
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


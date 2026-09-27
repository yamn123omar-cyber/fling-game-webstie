// Shared UI components.
import { html, raw, esc, h, $, on } from './lib.js';
import { icon } from './icons.js';
import { store } from './store.js';

const TIERS = [
    { name: 'Bronze', min: 0 }, { name: 'Silver', min: 1050 }, { name: 'Gold', min: 1150 },
    { name: 'Platinum', min: 1250 }, { name: 'Diamond', min: 1350 }, { name: 'Champion', min: 1500 },
];
export function tierName(elo) {
    let t = TIERS[0];
    for (const x of TIERS) if (elo >= x.min) t = x;
    return t.name;
}
export const tier = (elo, withElo = false) =>
    html`<span class="tier tier-${tierName(elo)}"><i></i>${tierName(elo)}${withElo ? html` <span class="mono dim">${elo}</span>` : ''}</span>`;

const initials = u => (u.displayName || u.username || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';

// Avatar: Roblox headshot when verified, otherwise initials on the player's colour.
export function avatar(u, size = '', { online = false } = {}) {
    if (!u) return html`<span class="av ${size}" style="--c:#2a3040"></span>`;
    const c = u.accent || '#6b7280';
    const isOnline = online && (u.online || store.online.has(u.id));
    const dot = isOnline ? raw('<span class="on-dot"></span>') : '';
    if (u.robloxId) {
        return html`<span class="av ${size}" style="--c:${c}" data-initials="${initials(u)}"><img src="/api/roblox/avatar/${u.robloxId}" alt="" loading="lazy" data-fallback>${dot}</span>`;
    }
    return html`<span class="av ${size}" style="--c:${c}">${initials(u)}${dot}</span>`;
}

// Broken Roblox image → initials.
document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.hasAttribute('data-fallback')) {
        const box = img.parentElement;
        img.remove();
        box.prepend(document.createTextNode(box.dataset.initials || '?'));
    }
}, true);

export function roleTag(u) {
    if (!u) return '';
    if (u.isBot) return html`<span class="role-tag bot" title="Test bot">BOT</span>`;
    if (u.role === 'owner') return html`<span class="role-tag" title="Owner">OWNER</span>`;
    if (u.role === 'admin' || u.role === 'ref') return html`<span class="role-tag ref" title="Admin">ADMIN</span>`;
    return '';
}

export function userChip(u, { size = 'sm', sub = null, link = true, online = true } = {}) {
    if (!u || u.deleted) return html`<span class="user-chip">${avatar(null, size)}<span class="names"><b class="muted">Deleted user</b></span></span>`;
    const inner = html`${avatar(u, size, { online })}<span class="names"><b>${u.displayName || u.username}${roleTag(u)}</b>${sub !== null ? html`<small>${sub}</small>` : ''}</span>`;
    return link ? html`<a class="user-chip" href="/u/${encodeURIComponent(u.username)}">${inner}</a>` : html`<span class="user-chip">${inner}</span>`;
}

export function entryChip(entry, { size = 'sm', mode } = {}) {
    if (!entry) return html`<span class="user-chip muted">TBD</span>`;
    if (entry.members.length === 1) {
        const u = entry.members[0];
        return html`<span class="user-chip">${avatar(u, size)}<span class="names"><b>${entry.name}</b>${entry.type === 'soloTeam' ? html`<small>Team of 1</small>` : ''}</span></span>`;
    }
    return html`<span class="user-chip"><span class="av-stack">${entry.members.map(m => avatar(m, size))}</span><span class="names"><b>${entry.tag ? html`<span class="mono" style="color:${entry.color || 'var(--accent)'}">${entry.tag}</span> ` : ''}${entry.name}</b><small>${entry.members.map(m => m.displayName).join(' & ')}</small></span></span>`;
}

export const TOURNAMENT_STATUS = {
    draft: ['Draft', ''],
    registration: ['Registration open', 'open'],
    checkin: ['Check-in open', 'checkin'],
    live: ['Live', 'live'],
    completed: ['Finished', 'done'],
    cancelled: ['Cancelled', 'done'],
};
export const tStatus = s => {
    const [label, cls] = TOURNAMENT_STATUS[s] || [s, ''];
    return html`<span class="status ${cls}">${label}</span>`;
};

export const MATCH_STATUS = {
    pending: ['Waiting', ''],
    scheduled: ['Check-in', 'checkin'],
    ready: ['Needs admin', 'ready'],
    live: ['Live', 'live'],
    done: ['Final', 'done'],
};
export const mStatus = s => {
    const [label, cls] = MATCH_STATUS[s] || [s, ''];
    return html`<span class="status ${cls}">${label}</span>`;
};

export const modeChip = mode => (mode === 'duo'
    ? html`<span class="chip blue">${icon('users')}Duo 2v2</span>`
    : html`<span class="chip pink">${icon('user')}Solo 1v1</span>`);
export const formatLabel = f => (f === 'twosided' ? 'Two-sided bracket' : f === 'double' ? 'Double elimination' : 'Single elimination');

// Empty states are just an icon, a title and maybe a button — no explanations.
export function empty(iconName, title, _text = '', action = '') {
    return html`<div class="empty">${icon(iconName)}<b>${title}</b>${action}</div>`;
}

export function skeleton() {
    return html`<div class="wrap page"><div class="loading-page">
        <div class="skel" style="height:42px;width:40%"></div>
        <div class="skel" style="height:18px;width:60%"></div>
        <div class="grid grid-3" style="margin-top:12px">${[1, 2, 3].map(() => html`<div class="skel" style="height:170px"></div>`)}</div>
        <div class="skel" style="height:260px"></div>
    </div></div>`;
}

// ── Toasts ──────────────────────────────────────────────────────────────
let toastBox;
export function toast(message, { type = 'ok', link = null, linkText = 'Open', ms = 4200 } = {}) {
    if (!toastBox) { toastBox = h('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(toastBox); }
    const el = h(String(html`<div class="toast ${type}"><span class="ico">${icon(type === 'error' ? 'alert' : type === 'info' ? 'bell' : 'check')}</span><span>${message}</span>${link ? html`<a href="${link}">${linkText}</a>` : ''}</div>`));
    toastBox.append(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    setTimeout(close, ms);
    el.addEventListener('click', e => { if (!e.target.closest('a')) close(); });
}
export const toastError = err => toast(err && err.message ? err.message : String(err), { type: 'error', ms: 5500 });

// ── Modals ──────────────────────────────────────────────────────────────
// modal({ title, text, body, actions:[{label, cls, value}] , wide }) → Promise<value|null>
export function modal({ title, text = '', body = '', actions = [{ label: 'OK', cls: 'primary', value: true }], wide = false, onMount = null }) {
    return new Promise(resolve => {
        const el = h(String(html`<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
            <header><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</header>
            ${body ? html`<div class="body">${body}</div>` : ''}
            <footer>${actions.map((a, i) => html`<button class="btn ${a.cls || ''}" data-i="${i}" ${a.submit ? raw('type="submit"') : ''}>${a.label}</button>`)}</footer>
        </div></div>`));
        const done = v => {
            el.remove();
            document.removeEventListener('keydown', key);
            resolve(v);
        };
        const key = e => { if (e.key === 'Escape') done(null); };
        document.addEventListener('keydown', key);
        el.addEventListener('mousedown', e => { if (e.target === el) done(null); });
        on(el, 'click', '[data-i]', async (e, btn) => {
            const a = actions[Number(btn.dataset.i)];
            if (a.handler) {
                btn.classList.add('loading');
                try {
                    const v = await a.handler(el);
                    if (v !== false) done(v === undefined ? a.value : v);
                } catch (err) {
                    const errEl = $('.form-error', el);
                    if (errEl) errEl.textContent = err.message; else toastError(err);
                } finally { btn.classList.remove('loading'); }
            } else done(a.value);
        });
        document.body.append(el);
        const first = $('input, textarea, select', el);
        if (first) setTimeout(() => first.focus(), 30);
        if (onMount) onMount(el, done);
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                const primary = el.querySelector('footer .btn.primary, footer .btn.danger');
                if (primary) { e.preventDefault(); primary.click(); }
            }
        });
    });
}

export const confirm = (title, text, { yes = 'Confirm', danger = false } = {}) =>
    modal({ title, text, actions: [{ label: 'Cancel', cls: 'ghost', value: false }, { label: yes, cls: danger ? 'danger' : 'primary', value: true }] });

// ── Popover menus ───────────────────────────────────────────────────────
let openMenu = null;
export function popover(anchor, content, { align = 'right', cls = '' } = {}) {
    closePopover();
    const el = h(`<div class="menu ${cls}"></div>`);
    el.innerHTML = String(content);
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${r.bottom + 8 + window.scrollY}px`;
    const away = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
    setTimeout(() => document.addEventListener('mousedown', away), 0);
    el.addEventListener('click', e => { if (e.target.closest('a,[data-close]')) closePopover(); });
    openMenu = { el, away };
    return el;
}
export function closePopover() {
    if (!openMenu) return;
    document.removeEventListener('mousedown', openMenu.away);
    openMenu.el.remove();
    openMenu = null;
}

export function bannerClass(name) {
    return `banner banner-${esc(name || 'aurora')}`;
}

export async function withBusy(btn, fn) {
    if (btn) btn.classList.add('loading');
    try {
        return await fn();
    } catch (e) {
        toastError(e);
        return undefined;
    } finally {
        if (btn) btn.classList.remove('loading');
    }
}

// Sparkline for Elo history.
export function sparkline(values, { w = 120, h: hh = 32, stroke = 'var(--accent)', fill = true } = {}) {
    if (!values || values.length < 2) return raw(`<svg width="${w}" height="${hh}" class="spark"></svg>`);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, hh - 3 - ((v - min) / span) * (hh - 6)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${d} L${pts[pts.length - 1][0].toFixed(1)} ${hh} L${pts[0][0].toFixed(1)} ${hh} Z`;
    const id = `g${Math.random().toString(36).slice(2, 8)}`;
    return raw(`<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" class="spark" aria-hidden="true">
        ${fill ? `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".28"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/>` : ''}
        <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.8" fill="${stroke}"/></svg>`);
}

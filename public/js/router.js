// History-API router with view lifecycle:
//   view = { title, auth, load(ctx), render(data, ctx), mount(root, data, ctx) → cleanup }
// Elements marked data-keep="key" survive re-renders (chat panels keep their
// scroll position and half-typed messages when live data refreshes the page).
import { html, h, $$, tickTimes } from './lib.js';
import { store } from './store.js';
import { skeleton, empty } from './ui.js';
import { icon } from './icons.js';

const routes = [];
let current = null;
let navToken = 0;
const progress = h('<div class="progress-bar" style="width:0;opacity:0"></div>');
document.body.append(progress);

export function route(pattern, loader) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ re, keys, loader });
}

function match(path) {
    for (const r of routes) {
        const m = path.match(r.re);
        if (m) {
            const params = {};
            r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
            return { r, params };
        }
    }
    return null;
}

// Embedded previews run in sandboxed frames that may not allow touching the
// address bar, so they set window.__FTAP_MEMORY_ROUTER__ and keep the URL in memory.
const memoryMode = Boolean(window.__FTAP_MEMORY_ROUTER__);
let memoryUrl = new URL('/', 'https://preview.local');

export function currentUrl() {
    return memoryMode ? new URL(memoryUrl.href) : new URL(location.href);
}

function writeUrl(url, replace) {
    if (memoryMode) memoryUrl = new URL(url, memoryUrl);
    else if (replace) history.replaceState({}, '', url);
    else history.pushState({}, '', url);
}

export function navigate(url, { replace = false } = {}) {
    writeUrl(url, replace);
    render();
}

export function setQuery(key, value) {
    const u = currentUrl();
    if (value === null || value === undefined || value === '') u.searchParams.delete(key);
    else u.searchParams.set(key, value);
    writeUrl(u.pathname + u.search, true);
}

function startProgress() {
    progress.style.transition = 'none';
    progress.style.width = '0';
    progress.style.opacity = '1';
    requestAnimationFrame(() => {
        progress.style.transition = 'width 2s cubic-bezier(.1,.7,.2,1), opacity .3s';
        progress.style.width = '75%';
    });
}
function endProgress() {
    progress.style.transition = 'width .2s ease, opacity .4s ease .2s';
    progress.style.width = '100%';
    progress.style.opacity = '0';
}

const root = () => document.getElementById('view');

async function render() {
    const token = ++navToken;
    const url = currentUrl();
    const found = match(url.pathname);
    if (current && current.cleanup) { try { current.cleanup({ leaving: true }); } catch (e) { console.error(e); } }
    if (current) for (const off of current.offs) off();
    current = null;

    const ctx = {
        params: found ? found.params : {},
        query: Object.fromEntries(url.searchParams),
        path: url.pathname,
        offs: [],
        listen(event, fn) { this.offs.push(store.on(event, fn)); },
        reload: null,
    };

    if (!found) return show404();
    startProgress();
    let view;
    try {
        view = (await found.r.loader()).default;
    } catch (e) {
        console.error(e);
        endProgress();
        return showError('This page failed to load. Try refreshing.');
    }
    if (token !== navToken) return;

    if (view.auth !== false && !store.me) {
        endProgress();
        navigate(url.pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(url.pathname + url.search)}`, { replace: true });
        return;
    }
    if ((view.auth === 'ref' && !store.isStaff()) || (view.auth === 'admin' && !store.isAdmin())) {
        endProgress();
        return showError('This area is for staff only.');
    }

    const el = root();
    const slow = setTimeout(() => { if (token === navToken) el.innerHTML = String(skeleton()); }, 160);
    let data;
    try {
        data = view.load ? await view.load(ctx) : null;
    } catch (e) {
        clearTimeout(slow);
        endProgress();
        if (token !== navToken) return;
        if (e.status === 404) return show404(e.message);
        if (e.status === 401) { navigate(`/login?next=${encodeURIComponent(url.pathname)}`, { replace: true }); return; }
        return showError(e.message);
    }
    clearTimeout(slow);
    if (token !== navToken) return;
    endProgress();

    current = { view, ctx, cleanup: null, offs: ctx.offs, data };
    // Live events can arrive in bursts (e.g. a ref tapping kills); coalesce reloads.
    let pending = null;
    ctx.reload = () => {
        if (pending) return pending;
        pending = new Promise(resolve => setTimeout(async () => {
            pending = null;
            if (current && current.ctx === ctx) {
                try {
                    const fresh = view.load ? await view.load(ctx) : null;
                    if (current && current.ctx === ctx) {
                        current.data = fresh;
                        paint(view, fresh, ctx, false);
                    }
                } catch (e) { console.warn('[reload]', e.message); }
            }
            resolve();
        }, 120));
        return pending;
    };
    document.title = `${typeof view.title === 'function' ? view.title(data, ctx) : view.title || 'FTAP Arena'} · FTAP Arena`;
    paint(view, data, ctx, true);
    if (!url.hash) window.scrollTo({ top: 0, behavior: 'instant' });
    store.emit('route', url.pathname);
}

function paint(view, data, ctx, first) {
    const el = root();
    const kept = new Map();
    const scrolls = [];
    if (!first) {
        for (const k of $$('[data-keep]', el)) {
            kept.set(k.dataset.keep, k);
            for (const n of [k, ...k.querySelectorAll('*')]) if (n.scrollTop) scrolls.push([n, n.scrollTop]);
        }
    }
    const scroll = window.scrollY;
    if (current.cleanup) { try { current.cleanup({ leaving: false }); } catch (e) { console.error(e); } current.cleanup = null; }
    // Listeners registered by the previous mount() are dropped; mount() adds fresh ones.
    for (const off of ctx.offs) off();
    ctx.offs.length = 0;
    el.innerHTML = String(view.render(data, ctx));
    for (const slot of $$('[data-keep]', el)) {
        const old = kept.get(slot.dataset.keep);
        if (old) slot.replaceWith(old);
    }
    // Moving a node in the DOM resets its scroll offsets; put them back.
    for (const [node, top] of scrolls) if (node.isConnected) node.scrollTop = top;
    if (first) {
        el.firstElementChild && el.firstElementChild.classList.add('view-enter');
    } else {
        window.scrollTo({ top: scroll, behavior: 'instant' });
    }
    tickTimes(el);
    if (view.mount) {
        const mine = current;
        const c = view.mount(el, data, ctx, { first });
        // mount() may have navigated away already (e.g. /login while logged in).
        if (current === mine) current.cleanup = typeof c === 'function' ? c : null;
        else if (typeof c === 'function') c({ leaving: true });
    }
}

function show404(msg) {
    root().innerHTML = String(html`<div class="wrap page">${empty('flag', 'Page not found', msg || "This page got flung into the void.", html`<a class="btn primary" href="/">Back home</a>`)}</div>`);
    document.title = 'Not found · FTAP Arena';
}
function showError(msg) {
    root().innerHTML = String(html`<div class="wrap page">${empty('alert', 'Something went wrong', msg, html`<a class="btn" href="${currentUrl().pathname}">Try again</a>`)}</div>`);
}

export function start() {
    document.addEventListener('click', e => {
        const a = e.target.closest('a[href]');
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const href = a.getAttribute('href');
        if (!href || !href.startsWith('/') || href.startsWith('//') || a.target === '_blank' || a.hasAttribute('download') || href.startsWith('/api/')) return;
        e.preventDefault();
        const here = currentUrl();
        if (href === here.pathname + here.search) { current && current.ctx.reload && current.ctx.reload(); return; }
        navigate(href);
    });
    // Jumping to #anchors fires popstate too; only re-render when the page itself changed.
    if (!memoryMode) {
        let lastPage = location.pathname + location.search;
        window.addEventListener('popstate', () => {
            const page = location.pathname + location.search;
            if (page === lastPage && location.hash) return;
            lastPage = page;
            render();
        });
        store.on('route', () => { lastPage = location.pathname + location.search; });
    }
    setInterval(() => tickTimes(document), 1000);
    render();
}

export const currentPath = () => currentUrl().pathname;
export const refresh = () => render();
export { icon };

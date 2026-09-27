// Tiny rendering + formatting helpers shared by every view.

export class Safe {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

function toHtml(v) {
    if (v === null || v === undefined || v === false || v === true) return '';
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(toHtml).join('');
    return esc(v);
}

// html`<b>${userText}</b>` escapes interpolations; nest html`` or raw() for markup.
export function html(strings, ...values) {
    let out = '';
    strings.forEach((str, i) => {
        out += str;
        if (i < values.length) out += toHtml(values[i]);
    });
    return new Safe(out);
}
export const raw = s => new Safe(String(s));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(markup) {
    const t = document.createElement('template');
    t.innerHTML = String(markup).trim();
    return t.content.firstElementChild;
}

// Delegated event helper: on(root, 'click', '[data-act=x]', fn)
export function on(root, type, selector, fn) {
    const handler = e => {
        const el = e.target.closest(selector);
        if (el && root.contains(el)) fn(e, el);
    };
    root.addEventListener(type, handler);
    return () => root.removeEventListener(type, handler);
}

export const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// ── Time ────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function clock(iso, seconds = false) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

export function dateTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 864e5);
    const yesterday = new Date(now.getTime() - 864e5);
    const time = clock(iso);
    if (sameDay(d, now)) return `Today ${time}`;
    if (sameDay(d, tomorrow)) return `Tomorrow ${time}`;
    if (sameDay(d, yesterday)) return `Yesterday ${time}`;
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return `${d.toLocaleDateString([], opts)} · ${time}`;
}

export function shortDate(iso) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ago(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    return shortDate(iso);
}

export function countdown(iso) {
    let s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const past = s < 0;
    s = Math.abs(s);
    const d = Math.floor(s / 86400);
    const hh = Math.floor((s % 86400) / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    let txt;
    if (d > 0) txt = `${d}d ${hh}h`;
    else if (hh > 0) txt = `${hh}h ${pad(mm)}m`;
    else txt = `${pad(mm)}:${pad(ss)}`;
    return past ? `-${txt}` : txt;
}

// <time data-ts data-fmt="ago|countdown|datetime|clock"> auto-updates every second.
export function time(iso, fmt = 'datetime', cls = '') {
    if (!iso) return '';
    const txt = fmt === 'ago' ? ago(iso) : fmt === 'countdown' ? countdown(iso) : fmt === 'clock' ? clock(iso, true) : dateTime(iso);
    return html`<time class="${cls}" datetime="${iso}" data-ts="${iso}" data-fmt="${fmt}" title="${new Date(iso).toLocaleString()}">${txt}</time>`;
}

export function tickTimes(root = document) {
    for (const el of root.querySelectorAll('time[data-ts]')) {
        const f = el.dataset.fmt;
        if (f === 'datetime') continue;
        const v = f === 'ago' ? ago(el.dataset.ts) : f === 'countdown' ? countdown(el.dataset.ts) : f === 'clock' ? clock(el.dataset.ts, true) : null;
        if (v !== null && el.textContent !== v) el.textContent = v;
    }
}

// System chat messages carry {t:ISO} tokens so each reader sees their own timezone.
export function renderTokens(text) {
    const parts = String(text).split(/(\{t:[^}]+\})/g);
    return new Safe(parts.map(p => {
        const m = p.match(/^\{t:([^}]+)\}$/);
        if (!m) return esc(p);
        const d = new Date(m[1]);
        const s = sameDay(d, new Date()) ? clock(m[1], true) : dateTime(m[1]);
        return `<b class="ts" title="${esc(d.toLocaleString())}">${esc(s)}</b>`;
    }).join(''));
}

export function linkify(text) {
    return new Safe(esc(text).replace(/\bhttps?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`));
}

// ── Numbers ─────────────────────────────────────────────────────────────
export const fmtInt = n => Number(n || 0).toLocaleString();
export const pct = x => `${Math.round((x || 0) * 100)}%`;
export const signed = n => (n > 0 ? `+${n}` : `${n}`);
export const ordinal = n => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const kd = (k, d) => (d ? (k / d).toFixed(2) : k ? k.toFixed(2) : '0.00');

export function copy(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
}

export function toLocalInput(iso) {
    const d = iso ? new Date(iso) : new Date(Date.now() + 864e5);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

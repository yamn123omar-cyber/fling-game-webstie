// Bracket page: pick a tournament, see its two-sided tree full size.
import { html, $, on } from '../lib.js';
import { get } from '../api.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { empty, tStatus, toast, toastError } from '../ui.js';
import { renderBracket, mountBracket } from '../bracket.js';

const zoomKey = 'ft-bracket-zoom';
const readZoom = () => { try { return Number(localStorage.getItem(zoomKey)) || 1; } catch { return 1; } };

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load the image exporter'));
        document.head.appendChild(s);
    });
}

function confetti(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#fbbf24', '#60a5fa'];
    for (let i = 0; i < 70; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.random() * 100}%`;
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = `${Math.random() * 0.8}s`;
        p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        box.appendChild(p);
    }
    root.appendChild(box);
    setTimeout(() => box.remove(), 4500);
}

export default {
    title: 'Bracket',
    async load(ctx) {
        const { tournaments } = await get('/tournaments');
        const withBracket = tournaments.filter(t => ['live', 'completed'].includes(t.status));
        // Default: a live tournament I'm in, then any live one, then the latest finished one.
        const id = ctx.params.id || (withBracket.find(t => t.status === 'live' && t.myEntry)
            || withBracket.find(t => t.status === 'live') || withBracket[0] || {}).id;
        const detail = id ? (await get(`/tournaments/${id}`)).tournament : null;
        return { list: tournaments.filter(t => t.status !== 'draft'), t: detail };
    },
    render(d) {
        const t = d.t;
        const z = readZoom();
        return html`<div class="wrap page bracket-page">
            <div class="page-head">
                <h1>Bracket</h1>
                <p>Left and right sides fight their way to the Final in the middle. Lost a match? The losers bracket underneath gives you a second chance.</p>
            </div>
            <div class="bracket-tools">
                <select class="select" data-pick aria-label="Tournament">
                    ${!t ? html`<option value="">Pick a tournament</option>` : ''}
                    ${d.list.map(x => html`<option value="${x.id}" ${t && x.id === t.id ? 'selected' : ''}>${x.name} — ${x.status === 'live' ? 'LIVE' : x.status === 'completed' ? 'finished' : 'not started'}</option>`)}
                </select>
                ${t ? html`${tStatus(t.status)}
                    <span class="spacer"></span>
                    <div class="seg">
                        <button data-zoom="-1" title="Zoom out">${icon('zoomOut')}</button>
                        <button data-zoom="0" title="Reset zoom"><span class="mono" data-zl>${Math.round(z * 100)}%</span></button>
                        <button data-zoom="1" title="Zoom in">${icon('zoomIn')}</button>
                    </div>
                    <button class="btn sm" data-act="full">${icon('expand')}Fullscreen</button>
                    <button class="btn sm" data-act="png">${icon('image')}Save image</button>
                    <a class="btn sm ghost" href="/t/${t.id}">${icon('arrowRight')}Tournament page</a>` : ''}
            </div>
            ${!t ? html`<div class="card">${empty('bracket', 'No bracket yet', 'Brackets appear here as soon as a tournament starts.', html`<a class="btn primary" href="/tournaments">${icon('trophy')}Tournaments</a>`)}</div>`
                : t.matches.length ? html`<div class="bracket-host">${renderBracket(t, { myEntryId: t.myEntryId })}</div>`
                : html`<div class="card">${empty('bracket', 'Not started yet', `The bracket is drawn when ${t.name} starts, seeded by rating.`)}</div>`}
        </div>`;
    },
    mount(root, d, ctx) {
        const t = d.t;
        const offs = [on(root, 'change', '[data-pick]', (e, el) => { if (el.value) navigate(`/bracket/${el.value}`); })];
        if (!t || !t.matches.length) return () => offs.forEach(f => f());

        const host = $('.bracket-host', root);
        const stop = mountBracket(host, t);
        const board = $('.ts-board', host);
        let z = readZoom();
        const applyZoom = () => {
            if (board) { board.style.zoom = z; board.dataset.z = z; }
            const zl = $('[data-zl]', root);
            if (zl) zl.textContent = `${Math.round(z * 100)}%`;
            try { localStorage.setItem(zoomKey, String(z)); } catch { /* private mode */ }
            window.dispatchEvent(new Event('resize'));
        };
        applyZoom();
        // Centre the Final on first view.
        const sc = $('.ts-scroll', host);
        if (sc) sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;

        offs.push(on(root, 'click', '[data-zoom]', (e, b) => {
            const k = Number(b.dataset.zoom);
            z = k === 0 ? 1 : Math.max(0.4, Math.min(1.6, Math.round((z + k * 0.1) * 10) / 10));
            applyZoom();
        }));
        offs.push(on(root, 'click', '[data-act]', async (e, b) => {
            if (b.dataset.act === 'full') {
                const page = $('.bracket-page', root);
                if (document.fullscreenElement) document.exitFullscreen();
                else if (page.requestFullscreen) page.requestFullscreen().catch(() => toast('Fullscreen is not available here', { type: 'error' }));
            }
            if (b.dataset.act === 'png') {
                b.classList.add('loading');
                try {
                    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
                    const target = $('.bracket-wrap', host);
                    const canvas = await window.html2canvas(target, {
                        backgroundColor: getComputedStyle(document.body).backgroundColor,
                        scale: 2, width: target.scrollWidth, windowWidth: target.scrollWidth + 80,
                        onclone: doc => { for (const s of doc.querySelectorAll('.b-scroll')) { s.style.overflow = 'visible'; } },
                    });
                    const a = document.createElement('a');
                    a.download = `${t.name.replace(/[^\w-]+/g, '-')}-bracket.png`;
                    a.href = canvas.toDataURL('image/png');
                    a.click();
                } catch (err) { toastError(err); }
                b.classList.remove('loading');
            }
        }));
        if (t.status === 'completed' && t.champion && !sessionStorage.getItem(`ft-cf-${t.id}`)) {
            try { sessionStorage.setItem(`ft-cf-${t.id}`, '1'); } catch { /* ignore */ }
            confetti(document.body);
        }
        ctx.listen('match', ev => { if (!ev || !ev.tournamentId || ev.tournamentId === t.id) ctx.reload(); });
        ctx.listen('tournament', ev => { if (!ev || !ev.id || ev.id === t.id) ctx.reload(); });
        return () => { stop(); offs.forEach(f => f()); };
    },
};

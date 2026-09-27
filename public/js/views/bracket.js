// Bracket page: the old-site two-sided tree for one tournament.
import { html, $, on } from '../lib.js';
import { get } from '../api.js';
import { navigate } from '../router.js';
import { toast, toastError } from '../ui.js';
import { renderBracket, mountBracket } from '../bracket.js';

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

export default {
    title: 'Bracket',
    async load(ctx) {
        const { tournaments } = await get('/tournaments');
        const started = tournaments.filter(t => ['live', 'completed'].includes(t.status));
        const id = ctx.params.id || (started.find(t => t.status === 'live' && t.myEntry) || started.find(t => t.status === 'live') || started[0] || {}).id;
        const detail = id ? (await get(`/tournaments/${id}`)).tournament : null;
        return { list: started, t: detail };
    },
    render(d) {
        const t = d.t;
        return html`<div class="wrap page bracket-page">
            <div class="bracket-head">
                <h1>Bracket</h1>${t ? html`<span class="muted">— ${t.name}</span>` : ''}
                <span class="spacer"></span>
                ${d.list.length > 1 ? html`<select class="select sm-select" data-pick aria-label="Switch tournament">
                    ${d.list.map(x => html`<option value="${x.id}" ${t && x.id === t.id ? 'selected' : ''}>${x.status === 'live' ? '🔴 ' : ''}${x.name}</option>`)}</select>` : ''}
                ${t && t.matches.length ? html`<button class="btn sm" data-act="full" title="Full screen">⛶</button><button class="btn sm" data-act="png" title="Save as image">📸</button>` : ''}
            </div>
            ${!t ? html`<div class="bracket-status">🎮 No tournaments have started yet</div>`
                : t.matches.length ? html`<div class="bracket-host">${renderBracket(t, { myEntryId: t.myEntryId })}</div>`
                : html`<div class="bracket-status">⏳ Starts ${new Date(t.startAt).toLocaleString()}</div>`}
        </div>`;
    },
    mount(root, d, ctx) {
        const t = d.t;
        const offs = [on(root, 'change', '[data-pick]', (e, el) => navigate(`/bracket/${el.value}`))];
        if (!t || !t.matches.length) return () => offs.forEach(f => f());
        const host = $('.bracket-host', root);
        const stop = mountBracket(host);
        offs.push(on(root, 'click', '[data-act]', async (e, b) => {
            if (b.dataset.act === 'full') {
                const page = $('.bracket-page', root);
                if (document.fullscreenElement) document.exitFullscreen();
                else if (page.requestFullscreen) page.requestFullscreen().catch(() => toast('Full screen is not available here', { type: 'error' }));
            }
            if (b.dataset.act === 'png') {
                b.classList.add('loading');
                try {
                    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
                    const canvas = await window.html2canvas($('.bview', host), { backgroundColor: '#05070f', scale: 2 });
                    const a = document.createElement('a');
                    a.download = `${t.name.replace(/[^\w-]+/g, '-')}-bracket.png`;
                    a.href = canvas.toDataURL('image/png');
                    a.click();
                } catch (err) { toastError(err); }
                b.classList.remove('loading');
            }
        }));
        ctx.listen('match', ev => { if (!ev || ev.tournamentId === t.id) ctx.reload(); });
        ctx.listen('tournament', ev => { if (!ev || ev.id === t.id) ctx.reload(); });
        return () => { stop(); offs.forEach(f => f()); };
    },
};

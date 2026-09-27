import { html, $, $$, on, toLocalInput } from '../lib.js';
import { get, post, patch } from '../api.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { store } from '../store.js';

const ACCENTS = ['#818cf8', '#4dd8ff', '#ff5ea8', '#ffb84d', '#9b7bff', '#3ddc97', '#ff6b4d', '#f5f5f5'];

export default {
    title: (d) => (d.t ? `Edit ${d.t.name}` : 'New tournament'),
    async load(ctx) {
        if (!store.isStaff()) { const e = new Error('Only admins can create tournaments'); e.status = 403; throw e; }
        const cfg = await get('/config');
        if (!ctx.params.id) return { t: null, defaults: cfg.tournamentDefaults };
        const res = await get(`/tournaments/${ctx.params.id}`);
        return { t: res.tournament, defaults: cfg.tournamentDefaults };
    },
    render(d) {
        const t = d.t;
        const s = t ? t.settings : d.defaults;
        const mode = t ? t.mode : 'solo';
        const format = t ? t.format : 'twosided';
        const prizes = (t && t.prizes) || { first: '', second: '', third: '' };
        const start = t ? t.startAt : new Date(Math.ceil((Date.now() + 2 * 864e5) / 36e5) * 36e5).toISOString();
        const accent = t ? t.accent : ACCENTS[0];
        const locked = t && t.entries.length > 0;
        const num = (name, label, min, max, hint = '') => html`<label class="field"><span>${label}</span><input class="input" type="number" name="${name}" min="${min}" max="${max}" value="${s[name]}">${hint ? html`<small>${hint}</small>` : ''}</label>`;
        const chk = (name, label, hint) => html`<label class="check"><input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`;
        return html`<div class="wrap page" style="max-width:980px">
            <a class="crumb" href="${t ? `/t/${t.id}` : '/admin'}">${icon('left')}${t ? t.name : 'Admin'}</a>
            <div class="page-head"><div><span class="eyebrow">${t ? 'Edit' : 'Create'}</span><h1>${t ? 'Edit tournament' : 'New tournament'}</h1></div></div>
            <form class="col" data-form="t" style="gap:20px">
                <div class="card col">
                    <h3>Basics</h3>
                    <div class="form-grid">
                        <label class="field full"><span>Name</span><input class="input" name="name" required maxlength="60" value="${t ? t.name : ''}" placeholder="e.g. Friday Night Flings #1"></label>
                        <div class="field"><span>Mode</span>
                            <div class="seg big" data-seg="mode">${[['solo', 'Solo 1v1'], ['duo', 'Duo 2v2']].map(([k, l]) => html`<button type="button" class="${mode === k ? 'on' : ''}" data-v="${k}" ${locked && k !== mode ? 'disabled' : ''}>${l}</button>`)}</div>
                            <input type="hidden" name="mode" value="${mode}">${locked ? html`<small>Locked — people already registered.</small>` : ''}</div>
                        <div class="field"><span>Bracket</span>
                            <div class="inset" style="font-size:13.5px">${icon('bracket')} <b>Two-sided</b> — left and right halves meet in the Final.</div>
                            <input type="hidden" name="format" value="${format}"></div>
                        <label class="field"><span>Start time <small>(your local time)</small></span><input class="input" type="datetime-local" name="startAt" required value="${toLocalInput(start)}"></label>
                        <label class="field"><span>Max ${mode === 'duo' ? 'teams' : 'players'}</span><input class="input" type="number" name="maxEntrants" min="2" max="256" value="${t ? t.maxEntrants : d.defaults.maxEntrants}"></label>
                        <label class="field"><span>1st place prize <small>(optional)</small></span><input class="input" name="prize1" maxlength="80" value="${prizes.first}" placeholder="e.g. 1,000 Robux"></label>
                        <label class="field"><span>2nd place prize</span><input class="input" name="prize2" maxlength="80" value="${prizes.second}" placeholder="optional"></label>
                        <label class="field"><span>3rd place prize</span><input class="input" name="prize3" maxlength="80" value="${prizes.third}" placeholder="optional"></label>
                        <div class="field"><span>Accent colour</span><div class="swatches">${ACCENTS.map(c => html`<button type="button" class="swatch ${accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}"></button>`)}</div><input type="hidden" name="accent" value="${accent}"></div>
                        <label class="field full"><span>Description</span><textarea class="textarea" name="description" maxlength="2000" placeholder="What is this tournament about? Any theme or special map?">${t ? t.description : ''}</textarea></label>
                        <label class="field full"><span>Extra rules <small>(optional — the standard rules always apply)</small></span><textarea class="textarea" name="rules" maxlength="4000" placeholder="e.g. No items. Server: public. Must stream to Discord.">${t ? t.rules : ''}</textarea></label>
                    </div>
                </div>

                <div class="card col">
                    <h3>Match rules</h3>
                    <div class="form-grid">
                        ${num('firstTo', 'Kills to win a duel', 1, 50, 'First to this many kills wins the duel.')}
                        <div class="solo-only ${mode === 'duo' ? 'hidden' : ''}" style="display:contents">
                            ${num('bestOf', 'Duels per match (best of)', 1, 9, 'Odd number. 3 = first to 2 duel wins.')}
                            ${num('finalBestOf', 'Duels in the final (best of)', 1, 9, 'Make the final longer, e.g. 5.')}
                        </div>
                        <div class="field duo-only ${mode === 'solo' ? 'hidden' : ''}"><span>If it's 1–1 in duels</span>
                            <select class="select" name="drawRule">
                                <option value="duels" ${s.drawRule === 'duels' ? 'selected' : ''}>Always play a random decider duel</option>
                                <option value="kills" ${s.drawRule === 'kills' ? 'selected' : ''}>More total kills wins; decider only if kills are tied</option>
                            </select></div>
                    </div>
                    <div class="grid grid-2" style="gap:10px">
                        <div class="duo-only ${mode === 'solo' ? 'hidden' : ''}">${chk('allowSoloTeams', 'Allow teams of 1', 'Players without a partner can enter alone. They fight both duels and have rating penalties.')}</div>
                        ${chk('requireRoblox', 'Require verified Roblox', 'Only players who verified their Roblox account can register.')}
                        ${chk('secondChances', 'Losers bracket (second chances)', 'When a round has an odd number of players, the losers of that round fight for the open spot instead of someone getting a free pass.')}
                        ${chk('thirdPlaceMatch', 'Third place match', 'The two side-final losers play for 3rd place.')}
                    </div>
                </div>

                <div class="card col">
                    <h3>Timing</h3>
                    <div class="form-grid">
                        ${num('checkinMinutes', 'Tournament check-in (minutes before start)', 0, 240, '0 = no check-in; everyone registered plays.')}
                        ${num('matchPrepMinutes', 'Minutes between a match being ready and its start', 1, 180, 'Gives players time to get into a server.')}
                        ${num('matchCheckinMinutes', 'Match check-in opens (minutes before)', 5, 180)}
                        ${num('noShowGraceMinutes', 'No-show grace (minutes late allowed)', 3, 60, 'After this, anyone not checked in forfeits automatically.')}
                    </div>
                </div>

                <div class="form-error"></div>
                <div class="row wrap-ok">
                    ${t ? html`<button class="btn primary lg" type="submit" data-publish="0">${icon('check')}Save changes</button>`
                        : html`<button class="btn primary lg" type="submit" data-publish="1">${icon('upload')}Publish & open registration</button>
                               <button class="btn lg" type="submit" data-publish="0">Save as draft</button>`}
                    <a class="btn ghost lg" href="${t ? `/t/${t.id}` : '/admin'}">Cancel</a>
                </div>
            </form>
        </div>`;
    },
    mount(root, d) {
        const form = $('[data-form=t]', root);
        let publish = false;
        const offs = [
            on(root, 'click', '[data-seg] button', (e, b) => {
                const seg = b.closest('[data-seg]');
                $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
                form[seg.dataset.seg].value = b.dataset.v;
                const mode = form.mode.value;
                $$('.solo-only', root).forEach(x => x.classList.toggle('hidden', mode !== 'solo'));
                $$('.duo-only', root).forEach(x => x.classList.toggle('hidden', mode !== 'duo'));
            }),
            on(root, 'click', '[data-accent]', (e, b) => { $$('[data-accent]', root).forEach(x => x.classList.toggle('on', x === b)); form.accent.value = b.dataset.accent; }),
            on(root, 'click', '[data-publish]', (e, b) => { publish = b.dataset.publish === '1'; }),
            on(root, 'submit', '[data-form=t]', async e => {
                e.preventDefault();
                const err = $('.form-error', form);
                err.textContent = '';
                const f = form;
                const settings = {};
                for (const k of ['firstTo', 'bestOf', 'finalBestOf', 'checkinMinutes', 'matchPrepMinutes', 'matchCheckinMinutes', 'noShowGraceMinutes']) settings[k] = Number(f[k].value);
                for (const k of ['allowSoloTeams', 'requireRoblox', 'secondChances', 'thirdPlaceMatch']) settings[k] = f[k].checked;
                settings.drawRule = f.drawRule.value;
                const body = {
                    name: f.name.value, mode: f.mode.value, format: f.format.value,
                    startAt: f.startAt.value ? new Date(f.startAt.value).toISOString() : null,
                    maxEntrants: Number(f.maxEntrants.value), accent: f.accent.value,
                    prizes: { first: f.prize1.value, second: f.prize2.value, third: f.prize3.value },
                    description: f.description.value, rules: f.rules.value, settings,
                };
                const btns = $$('button[type=submit]', f);
                btns.forEach(b => b.classList.add('loading'));
                try {
                    const res = d.t ? await patch(`/tournaments/${d.t.id}`, body) : await post('/tournaments', { ...body, publish });
                    toast(d.t ? 'Saved.' : publish ? 'Tournament published — registration is open!' : 'Draft saved.');
                    navigate(`/t/${res.tournament.id}`);
                } catch (ex) {
                    err.textContent = ex.message;
                    err.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } finally { btns.forEach(b => b.classList.remove('loading')); }
            }),
        ];
        return () => offs.forEach(f => f());
    },
};

import { html, $, $$, on, copy } from '../lib.js';
import { get, post, patch, del } from '../api.js';
import { store } from '../store.js';
import { navigate, setQuery } from '../router.js';
import { icon } from '../icons.js';
import { avatar, toast, withBusy, confirm, modal, bannerClass } from '../ui.js';

const ACCENTS = ['#c4ff4d', '#4dd8ff', '#ff5ea8', '#ffb84d', '#9b7bff', '#3ddc97', '#ff6b4d', '#f5f5f5'];
const BANNERS = ['aurora', 'ember', 'ocean', 'toxic', 'grape', 'sunset', 'mono', 'grid'];
const SOCIALS = [['youtube', 'YouTube', '@channel or link'], ['twitch', 'Twitch', 'username'], ['tiktok', 'TikTok', '@handle'], ['twitter', 'X / Twitter', '@handle'], ['discord', 'Discord', 'username']];

function profileTab(u) {
    return html`<div class="split">
        <form class="card col" data-form="profile" style="gap:18px">
            <div class="form-grid">
                <label class="field"><span>Display name</span><input class="input" name="displayName" maxlength="24" value="${u.displayName}"></label>
                <label class="field"><span>Title <small>(shown under your name)</small></span><input class="input" name="title" maxlength="32" value="${u.profile.title}" placeholder="e.g. Certified yeeter"></label>
                <label class="field full"><span>Bio</span><textarea class="textarea" name="bio" maxlength="300" placeholder="Main? Playstyle? Favourite map?">${u.profile.bio}</textarea></label>
            </div>
            <div class="field"><span>Accent colour</span>
                <div class="swatches">${ACCENTS.map(c => html`<button type="button" class="swatch ${u.profile.accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}" aria-label="${c}"></button>`)}
                    <label class="swatch custom" title="Custom colour" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"><input type="color" name="accentCustom" value="${u.profile.accent}" style="opacity:0;width:0;height:0"></label>
                </div><input type="hidden" name="accent" value="${u.profile.accent}"></div>
            <div class="field"><span>Profile banner</span>
                <div class="banner-picker">${BANNERS.map(b => html`<button type="button" class="${bannerClass(b)} bp ${u.profile.banner === b ? 'on' : ''}" data-banner="${b}" aria-label="${b}"><span>${b}</span></button>`)}</div>
                <input type="hidden" name="banner" value="${u.profile.banner}"></div>
            <div class="field"><span>Main mode</span>
                <div class="seg" data-fav>${[['solo', 'Solo 1v1'], ['duo', 'Duo 2v2']].map(([k, l]) => html`<button type="button" class="${u.profile.favoriteMode === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div>
                <input type="hidden" name="favoriteMode" value="${u.profile.favoriteMode}"></div>
            <div class="field"><span>Socials</span>
                <div class="form-grid">${SOCIALS.map(([k, l, ph]) => html`<label class="field"><small>${l}</small><input class="input" name="s_${k}" maxlength="80" placeholder="${ph}" value="${(u.profile.socials || {})[k] || ''}"></label>`)}</div></div>
            <div class="form-error"></div>
            <div class="row"><button class="btn primary lg" type="submit">${icon('check')}Save profile</button><a class="btn ghost" href="/u/${encodeURIComponent(u.username)}">View profile</a></div>
        </form>
        <div class="col" style="gap:14px;position:sticky;top:84px">
            <span class="label">Preview</span>
            <div class="card flush preview-card" style="--pa:${u.profile.accent}">
                <div class="${bannerClass(u.profile.banner)} pv-banner"></div>
                <div class="pv-body">
                    <div class="pv-av">${avatar({ ...u, accent: u.profile.accent }, 'lg')}</div>
                    <b class="display pv-name">${u.displayName}</b>
                    <span class="dim pv-title">${u.profile.title || '@' + u.username}</span>
                    <p class="pv-bio dim">${u.profile.bio}</p>
                </div>
            </div>
        </div>
    </div>`;
}

function robloxTab(u, ctx) {
    const welcome = ctx.query.welcome ? html`<div class="banner-note accent-note">${icon('bolt')}<span><b>Welcome to FTAP Arena!</b> Linking Roblox is optional, but refs need your in-game name and your avatar shows up on your profile. You can do this later.</span><a class="btn sm" href="/tournaments">Skip for now</a></div>` : '';
    if (u.roblox) {
        return html`${welcome}<div class="card rbx-linked">
            <img class="rbx-head" src="/api/roblox/avatar/${u.roblox.id}" alt="">
            <div><span class="chip green">${icon('checkCircle')}Verified</span><h2 class="display" style="margin-top:8px">${u.roblox.displayName}</h2><span class="dim">@${u.roblox.name} · ID ${u.roblox.id}</span></div>
            <span class="spacer"></span>
            <a class="btn" href="https://www.roblox.com/users/${u.roblox.id}/profile" target="_blank" rel="noopener">${icon('external')}Roblox profile</a>
            <button class="btn danger" data-act="unlink">Unlink</button>
        </div>
        <p class="dim" style="margin-top:14px">You can remove the verification code from your Roblox About section now.</p>`;
    }
    const p = u.robloxPending;
    return html`${welcome}<div class="split">
        <div class="card">
            <ol class="rbx-steps">
                <li class="${p ? 'done' : 'on'}"><b>Find your Roblox account</b>
                    ${p ? html`<div class="rbx-found"><img src="/api/roblox/avatar/${p.id}" alt="" class="rbx-head sm"><span><b>${p.displayName}</b> <span class="dim">@${p.name}</span></span><button class="btn ghost sm" data-act="restart">Change</button></div>`
                        : html`<form class="input-group" data-form="rbx-start" style="margin-top:10px"><input class="input" name="username" placeholder="Roblox username" maxlength="20" value="${(u.legacy && u.legacy.robloxUsername) || ''}" autocapitalize="off" spellcheck="false"><button class="btn primary" type="submit">Find</button></form>`}
                </li>
                <li class="${p ? 'on' : ''}"><b>Paste this code into your Roblox About section</b>
                    ${p ? html`<div class="code-box"><code class="mono">${p.code}</code><button class="btn sm" data-act="copy" data-v="${p.code}">${icon('copy')}Copy</button></div>
                        <span class="dim">On roblox.com open <a class="accent" href="https://www.roblox.com/users/${p.id}/profile" target="_blank" rel="noopener">your profile</a> → edit About → paste the code anywhere → Save.</span>` : html`<span class="dim">We'll give you a short code.</span>`}
                </li>
                <li class="${p ? 'on' : ''}"><b>Verify</b>
                    ${p ? html`<div class="row" style="margin-top:10px"><button class="btn primary lg" data-act="verify">${icon('checkCircle')}Verify now</button></div>` : html`<span class="dim">We check your profile and link the account.</span>`}
                </li>
            </ol>
            <div class="form-error" style="margin-top:10px"></div>
        </div>
        <div class="card col">
            <h3>Why link Roblox?</h3>
            <ul class="ticks">
                <li>Refs and opponents see your in-game name in the match room, so they can find you in the server.</li>
                <li>Your Roblox avatar becomes your profile picture and shows up in 3D on your profile.</li>
                <li>Some tournaments only accept verified players.</li>
                <li>Verification proves the account is yours — nobody can pretend to be you.</li>
            </ul>
        </div>
    </div>`;
}

function accountTab(u) {
    return html`<div class="grid grid-2">
        <form class="card col" data-form="password">
            <h3>Change password</h3>
            <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password"></label>
            <label class="field"><span>New password</span><input class="input" type="password" name="next" minlength="6" autocomplete="new-password"></label>
            <div class="form-error"></div>
            <div><button class="btn primary" type="submit">Update password</button></div>
        </form>
        <div class="card col">
            <h3>Session</h3>
            <p class="dim">Signed in as <b>@${u.username}</b>.</p>
            <div><button class="btn" data-act="logout">${icon('logout')}Log out</button></div>
            <hr class="divider">
            <h3 style="color:#ff8a95">Danger zone</h3>
            <p class="dim">Deleting your account removes your profile, friends and teams. Match history stays (shown as "Deleted user") so brackets stay correct.</p>
            <div><button class="btn danger" data-act="delete">${icon('trash')}Delete account</button></div>
        </div>
    </div>`;
}

export default {
    title: 'Settings',
    auth: true,
    load: () => get('/me'),
    render(d, ctx) {
        const u = d.user;
        const tab = ['profile', 'roblox', 'account'].includes(ctx.query.tab) ? ctx.query.tab : 'profile';
        return html`<div class="wrap page">
            <div class="page-head"><div><span class="eyebrow">Your account</span><h1>Settings</h1></div></div>
            <div class="tabs">${[['profile', 'Profile', 'user'], ['roblox', 'Roblox', 'gamepad'], ['account', 'Account', 'lock']].map(([k, l, ic]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${icon(ic)}${l}${k === 'roblox' && !u.roblox ? html`<span class="badge-dot" style="width:8px;min-width:8px;height:8px;padding:0"></span>` : ''}</button>`)}</div>
            ${tab === 'profile' ? profileTab(u) : tab === 'roblox' ? robloxTab(u, ctx) : accountTab(u)}
        </div>`;
    },
    mount(root, d, ctx) {
        const u = d.user;
        const form = $('[data-form=profile]', root);
        const preview = $('.preview-card', root);
        const syncPreview = () => {
            if (!form || !preview) return;
            const accent = form.accent.value;
            preview.style.setProperty('--pa', accent);
            $('.pv-banner', preview).className = `${bannerClass(form.banner.value)} pv-banner`;
            $('.pv-name', preview).textContent = form.displayName.value || u.username;
            $('.pv-title', preview).textContent = form.title.value || '@' + u.username;
            $('.pv-bio', preview).textContent = form.bio.value;
            const av = $('.pv-av .av', preview);
            if (av) av.style.setProperty('--c', accent);
        };
        const offs = [
            on(root, 'click', '[data-tab]', (e, b) => { ctx.query.tab = b.dataset.tab; setQuery('tab', b.dataset.tab); setQuery('welcome', null); delete ctx.query.welcome; ctx.reload(); }),
            on(root, 'click', '[data-accent]', (e, b) => { $$('[data-accent]', root).forEach(x => x.classList.toggle('on', x === b)); form.accent.value = b.dataset.accent; syncPreview(); }),
            on(root, 'input', '[name=accentCustom]', (e, i) => { $$('[data-accent]', root).forEach(x => x.classList.remove('on')); form.accent.value = i.value; syncPreview(); }),
            on(root, 'click', '[data-banner]', (e, b) => { $$('[data-banner]', root).forEach(x => x.classList.toggle('on', x === b)); form.banner.value = b.dataset.banner; syncPreview(); }),
            on(root, 'click', '[data-fav] button', (e, b) => { $$('[data-fav] button', root).forEach(x => x.classList.toggle('on', x === b)); form.favoriteMode.value = b.dataset.v; }),
            on(root, 'input', '[data-form=profile] input, [data-form=profile] textarea', syncPreview),
            on(root, 'submit', '[data-form]', async (e, f) => {
                e.preventDefault();
                const err = $('.form-error', f);
                if (err) err.textContent = '';
                const btn = $('button[type=submit]', f);
                try {
                    btn && btn.classList.add('loading');
                    if (f.dataset.form === 'profile') {
                        const socials = Object.fromEntries(SOCIALS.map(([k]) => [k, f[`s_${k}`].value.trim()]));
                        const res = await patch('/me/profile', { displayName: f.displayName.value.trim(), title: f.title.value, bio: f.bio.value, accent: f.accent.value, banner: f.banner.value, favoriteMode: f.favoriteMode.value, socials });
                        store.me = res.user; store.emit('me', res.user);
                        toast('Profile saved.');
                    }
                    if (f.dataset.form === 'password') {
                        await post('/me/password', { current: f.current.value, next: f.next.value });
                        f.reset();
                        toast('Password updated.');
                    }
                    if (f.dataset.form === 'rbx-start') {
                        await post('/me/roblox/start', { username: f.username.value.trim() });
                        ctx.reload();
                    }
                } catch (ex) {
                    if (err) err.textContent = ex.message; else toast(ex.message, { type: 'error' });
                    $('.form-error', root) && ($('.form-error', root).textContent = ex.message);
                } finally { btn && btn.classList.remove('loading'); }
            }),
            on(root, 'click', '[data-act]', async (e, el) => {
                const a = el.dataset.act;
                if (a === 'copy') copy(el.dataset.v).then(() => toast('Code copied — paste it into your Roblox About section'));
                if (a === 'verify') {
                    const err = $('.form-error', root);
                    err.textContent = '';
                    el.classList.add('loading');
                    try {
                        const res = await post('/me/roblox/verify');
                        store.me = res.user; store.emit('me', res.user);
                        toast('Roblox account verified!');
                        ctx.reload();
                    } catch (ex) { err.textContent = ex.message; } finally { el.classList.remove('loading'); }
                }
                if (a === 'restart' || a === 'unlink') {
                    if (a === 'unlink' && !(await confirm('Unlink your Roblox account?', 'Your avatar and verified badge will be removed.', { yes: 'Unlink', danger: true }))) return;
                    const res = await withBusy(el, () => del('/me/roblox'));
                    if (res) { store.me = res.user; store.emit('me', res.user); ctx.reload(); }
                }
                if (a === 'delete') {
                    const ok = await modal({
                        title: 'Delete your account?', text: 'This cannot be undone. Type your password to confirm.',
                        body: html`<label class="field"><span>Password</span><input class="input" type="password"></label><div class="form-error"></div>`,
                        actions: [{ label: 'Keep my account', cls: 'ghost', value: null }, { label: 'Delete forever', cls: 'danger', handler: async el2 => post('/me/delete', { password: el2.querySelector('input').value }) }],
                    });
                    if (ok) { store.setSession(null); navigate('/'); toast('Account deleted.'); }
                }
            }),
        ];
        return () => offs.forEach(f => f());
    },
};

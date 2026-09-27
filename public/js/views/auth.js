import { html, $ } from '../lib.js';
import { post } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { icon, logoMark } from '../icons.js';
import { toast } from '../ui.js';

export default {
    title: (d, ctx) => (ctx.path === '/register' ? 'Sign up' : 'Log in'),
    render(d, ctx) {
        const reg = ctx.path === '/register';
        const next = ctx.query.next || '';
        return html`<div class="auth-page">
            <div class="auth-art">
                <div class="auth-art-inner">
                    <span class="hero-badge">${icon('bolt')} FTAP Arena</span>
                    <h2 class="display">${reg ? html`Your first fling<br>starts <span>here.</span>` : html`Welcome back,<br><span>flinger.</span>`}</h2>
                    <ul class="auth-points">
                        <li>${icon('trophy')}Solo & duo tournaments with real brackets</li>
                        <li>${icon('whistle')}Referees count every kill — no arguing</li>
                        <li>${icon('chart')}Elo rating, ranks and a season ladder</li>
                        <li>${icon('users')}Friends, teams and chat built in</li>
                    </ul>
                </div>
                <div class="auth-dolls" aria-hidden="true">${[0, 1, 2].map(i => html`<span class="doll d${i}"><i class="h"></i><i class="t"></i><i class="l"></i><i class="r"></i></span>`)}</div>
            </div>
            <div class="auth-form-wrap">
                <form class="auth-form" novalidate>
                    <a class="logo" href="/">${logoMark}<span>FTAP <em>ARENA</em></span></a>
                    <h1>${reg ? 'Create your account' : 'Log in'}</h1>
                    <p class="dim">${reg ? 'Takes ten seconds. You can link your Roblox account after.' : 'Old account from the previous site? Just log in with your old password — it carries over.'}</p>
                    <label class="field"><span>Username</span>
                        <input class="input" name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="${reg ? 'Pick a username' : 'Your username'}" autocapitalize="off" spellcheck="false"></label>
                    <label class="field"><span>Password</span>
                        <input class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 6 : 1}" placeholder="${reg ? 'At least 6 characters' : 'Your password'}"></label>
                    ${reg ? html`<small class="hint">Tip: use your Roblox username so people can find you.</small>` : ''}
                    <div class="form-error" role="alert"></div>
                    <button class="btn primary lg block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
                    <p class="dim center">${reg ? html`Already have an account? <a class="accent" href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Log in</a>`
                        : html`New here? <a class="accent" href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}">Create an account</a>`}</p>
                </form>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        if (store.me) { navigate(ctx.query.next || '/', { replace: true }); return; }
        const form = $('form', root);
        const err = $('.form-error', form);
        const reg = ctx.path === '/register';
        $('input', form).focus();
        form.addEventListener('submit', async e => {
            e.preventDefault();
            err.textContent = '';
            const btn = $('button[type=submit]', form);
            const body = { username: form.username.value.trim(), password: form.password.value };
            if (!body.username || !body.password) { err.textContent = 'Fill in both fields'; return; }
            btn.classList.add('loading');
            try {
                const res = await post(reg ? '/auth/register' : '/auth/login', body);
                store.setSession(res);
                toast(reg ? `Welcome to the arena, ${res.user.displayName}!` : `Welcome back, ${res.user.displayName}!`);
                const next = ctx.query.next && ctx.query.next.startsWith('/') ? ctx.query.next : (reg ? '/settings?tab=roblox&welcome=1' : '/');
                navigate(next, { replace: true });
            } catch (ex) {
                err.textContent = ex.message;
                btn.classList.remove('loading');
            }
        });
    },
};

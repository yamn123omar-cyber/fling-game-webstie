// Login / create account — the front door, over a slow moving glow.
import { html, $ } from '../lib.js';
import { post } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { logoMark } from '../icons.js';
import { toast } from '../ui.js';

export default {
    auth: false,
    title: (d, ctx) => (ctx.path === '/register' ? 'Create account' : 'Log in'),
    render(d, ctx) {
        const reg = ctx.path === '/register';
        const next = ctx.query.next ? `?next=${encodeURIComponent(ctx.query.next)}` : '';
        return html`<div class="gate">
            <div class="glow" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="gate-card">
                <a class="logo" href="/login">${logoMark}<span>FLING <em>TOURNAMENT</em></span></a>
                <div class="seg big gate-tabs" role="tablist">
                    <a href="/login${next}" role="tab" class="${reg ? '' : 'on'}" aria-selected="${reg ? 'false' : 'true'}">Log in</a>
                    <a href="/register${next}" role="tab" class="${reg ? 'on' : ''}" aria-selected="${reg ? 'true' : 'false'}">Create account</a>
                </div>
                <form class="auth-form" novalidate>
                    <label class="field"><span>Username</span>
                        <input class="input" name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="${reg ? 'Pick a username' : 'Your username'}" autocapitalize="off" spellcheck="false"></label>
                    ${reg ? html`<label class="field"><span>Roblox username <small class="muted">(optional)</small></span>
                        <input class="input" name="roblox" maxlength="20" autocapitalize="off" spellcheck="false"></label>` : ''}
                    <label class="field"><span>Password</span>
                        <input class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required placeholder="${reg ? 'At least 6 characters' : 'Your password'}"></label>
                    ${reg ? html`<label class="field"><span>Confirm password</span>
                        <input class="input" name="confirm" type="password" autocomplete="new-password" required placeholder="Type it again"></label>` : ''}
                    <div class="form-error" role="alert"></div>
                    <button class="btn primary lg block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
                </form>
            </div>
        </div>`;
    },
    mount(root, d, ctx) {
        if (store.me) { navigate(ctx.query.next || '/', { replace: true }); return; }
        const reg = ctx.path === '/register';
        const form = $('form', root);
        const err = $('.form-error', form);
        if (matchMedia('(min-width: 700px)').matches) $('input', form).focus();

        form.addEventListener('submit', async e => {
            e.preventDefault();
            err.textContent = '';
            const btn = $('button[type=submit]', form);
            const body = { username: form.username.value.trim(), password: form.password.value };
            if (!body.username || !body.password) { err.textContent = 'Fill in your username and password'; return; }
            if (reg) {
                if (body.password.length < 6) { err.textContent = 'Password needs at least 6 characters'; return; }
                if (body.password !== form.confirm.value) { err.textContent = "Passwords don't match"; return; }
                const rbx = form.roblox.value.trim();
                if (rbx) body.robloxUsername = rbx;
            }
            btn.classList.add('loading');
            try {
                const res = await post(reg ? '/auth/register' : '/auth/login', body);
                store.setSession(res);
                toast(reg ? `Welcome, ${res.user.displayName}! Let's get you set up.` : `Welcome back, ${res.user.displayName}!`);
                const next = ctx.query.next && ctx.query.next.startsWith('/') && !ctx.query.next.startsWith('//') ? ctx.query.next : '/';
                navigate(next, { replace: true });
            } catch (ex) {
                err.textContent = ex.message;
                btn.classList.remove('loading');
            }
        });
    },
};

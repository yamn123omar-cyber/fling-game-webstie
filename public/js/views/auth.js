// Login / create account — the front door, over a slow moving glow.
import { html, $ } from '../lib.js';
import { post } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
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
                <div class="gate-brand"><div class="gate-bolt">⚡</div><h1>FLING TOURNAMENT</h1><span>ENTER THE ARENA</span></div>
                <div class="seg big gate-tabs" role="tablist">
                    <a href="/login${next}" role="tab" class="${reg ? '' : 'on'}" aria-selected="${reg ? 'false' : 'true'}">Login</a>
                    <a href="/register${next}" role="tab" class="${reg ? 'on' : ''}" aria-selected="${reg ? 'true' : 'false'}">Register</a>
                </div>
                <h2 class="gate-hi">${reg ? 'Create account' : 'Welcome back'}</h2>
                <form class="auth-form" novalidate>
                    <label class="field"><span>Username</span>
                        <input class="input" name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="Enter username" autocapitalize="off" spellcheck="false"></label>
                    ${reg ? html`<label class="field"><span>Roblox username <small class="muted">(optional)</small></span>
                        <input class="input" name="roblox" maxlength="20" autocapitalize="off" spellcheck="false"></label>` : ''}
                    <label class="field"><span>Password</span>
                        <input class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required placeholder="Enter password"></label>
                    ${reg ? html`<label class="field"><span>Confirm password</span>
                        <input class="input" name="confirm" type="password" autocomplete="new-password" required placeholder="Type it again"></label>` : ''}
                    <div class="form-error" role="alert"></div>
                    <button class="btn lg block gate-go" type="submit">${reg ? 'Create Account' : 'Login'}</button>
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

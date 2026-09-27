/* ============================================================
   SITE-WIDE MOUSE INTERACTIVITY (lightweight, no WebGL)
   - cursor spotlight on cards/panels via --mx/--my
   - gentle 3D tilt on stat cards and the login panel
   - click ripple on buttons
   - scroll-reveal as cards enter viewport
   ============================================================ */
(function () {
    'use strict';

    function initSiteFX() {
        const SPOT = '.match, .stat-card, .tournament-card, .player-card, .team-card, .login-container, .extras-side, .bracket-action-bar';
        const TILT = '.stat-card';
        let raf = 0, last = null;
        document.addEventListener('pointermove', function (e) {
            last = e;
            if (raf) return;
            raf = requestAnimationFrame(function () {
                raf = 0; const ev = last; if (!ev || !ev.target || !ev.target.closest) return;
                const el = ev.target.closest(SPOT);
                if (!el) return;
                const r = el.getBoundingClientRect();
                el.style.setProperty('--mx', (((ev.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
                el.style.setProperty('--my', (((ev.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
                if (el.matches(TILT)) {
                    el.style.setProperty('--ry', (((ev.clientX - r.left) / r.width - 0.5) * 12).toFixed(2) + 'deg');
                    el.style.setProperty('--rx', ((0.5 - (ev.clientY - r.top) / r.height) * 9).toFixed(2) + 'deg');
                    el.classList.add('fx-tilt');
                }
            });
        }, { passive: true });
        document.addEventListener('pointerout', function (e) {
            if (!e.target || !e.target.closest) return;
            const el = e.target.closest(TILT);
            if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) {
                el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
            }
        }, { passive: true });

        // Login panel: lean toward the cursor from anywhere in the window
        let loginRaf = 0, loginEv = null;
        document.addEventListener('pointermove', function (e) {
            loginEv = e;
            if (loginRaf) return;
            loginRaf = requestAnimationFrame(function () {
                loginRaf = 0;
                const panel = document.querySelector('.login-container');
                if (!panel) return;
                const r = panel.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return;
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                const dx = Math.max(-1, Math.min(1, (loginEv.clientX - cx) / (window.innerWidth / 2)));
                const dy = Math.max(-1, Math.min(1, (loginEv.clientY - cy) / (window.innerHeight / 2)));
                panel.style.setProperty('--mx', (((loginEv.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
                panel.style.setProperty('--my', (((loginEv.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
                panel.style.setProperty('--ry', (dx * 11).toFixed(2) + 'deg');
                panel.style.setProperty('--rx', (-dy * 8).toFixed(2) + 'deg');
                panel.classList.add('fx-tilt');
            });
        }, { passive: true });

        // Button ripple
        document.addEventListener('pointerdown', function (e) {
            if (!e.target || !e.target.closest) return;
            const b = e.target.closest('button, .btn-large, .login-btn');
            if (!b) return;
            const r = b.getBoundingClientRect();
            const sp = document.createElement('span');
            sp.className = 'fx-ripple';
            const size = Math.max(r.width, r.height);
            sp.style.width = sp.style.height = size + 'px';
            sp.style.left = (e.clientX - r.left - size / 2) + 'px';
            sp.style.top = (e.clientY - r.top - size / 2) + 'px';
            const cs = getComputedStyle(b);
            if (cs.position === 'static') b.style.position = 'relative';
            if (cs.overflow !== 'hidden') b.style.overflow = 'hidden';
            b.appendChild(sp);
            setTimeout(function () { sp.remove(); }, 600);
        }, { passive: true });

        // Scroll reveal
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(function (es) {
                es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('fx-in'); io.unobserve(en.target); } });
            }, { threshold: 0.06 });
            const scan = function () {
                const vh = window.innerHeight || 800;
                document.querySelectorAll('.stat-card, .tournament-card, .player-card, .team-card').forEach(function (el) {
                    if (el._fx) return;
                    el._fx = 1;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || (r.top < vh && r.bottom > 0)) { el.classList.add('fx-in'); return; }
                    el.classList.add('fx-reveal'); io.observe(el);
                });
            };
            scan();
            let st;
            new MutationObserver(function () { clearTimeout(st); st = setTimeout(scan, 150); }).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSiteFX);
    else initSiteFX();
})();

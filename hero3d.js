/* ============================================================
   HERO 3D — "Reactor Core" centrepiece (Three.js r128) · v4
   A deliberate, premium scene (NOT random):
     - a faceted crystal core with glowing edges + inner light
     - a slow geodesic energy shell
     - orbiting glowing satellites (click to add more)
     - colour that slowly cycles through the spectrum forever
   Interaction:
     - move the mouse toward any edge of the stage to spin it
       that way; the further out, the faster — it never runs
       out, so you can rotate as much as you want, any direction
     - click the stage to fire a shockwave + launch a new orbiter
   Optimised: InstancedMesh orbiters (1 draw call), event-driven
   visibility, capped pixel-ratio + adaptive downgrade, pauses
   when off-screen.
   ============================================================ */
(function () {
    'use strict';

    function boot() {
        const sub = document.querySelector('.landing-subtitle');
        if (sub) sub.textContent = 'FTAP Tournament \u2014 Climb the ranks, win Robux';

        // Black hole mount takes over the hero; do not start the reactor core.
        if (document.querySelector('.experience')) return;

        if (typeof THREE === 'undefined') { console.warn('[hero3d] THREE missing'); return; }
        const canvas = document.getElementById('heroCanvas');
        if (!canvas) return;

        // ---------- screen tilt driven by rotating the core ----------
        // While you drag to spin the object, the whole landing view leans toward the
        // drag (like the old mouse parallax). Stop moving or release and it springs
        // back to flat. tiltCur* are eased every frame in the render loop below.
        const landingContent = document.querySelector('.landing-content');
        const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        let tiltCurY = 0, tiltCurX = 0;
        function applyScreenTilt(ry, rx) {
            const active = Math.abs(ry) > 0.04 || Math.abs(rx) > 0.04;
            if (landingContent) {
                if (active) {
                    // override the idle heroFloat animation so our transform takes hold
                    landingContent.style.animation = 'none';
                    landingContent.style.transform = 'rotateY(' + ry.toFixed(2) + 'deg) rotateX(' + rx.toFixed(2) + 'deg) translateZ(0)';
                } else if (landingContent.style.transform) {
                    landingContent.style.transform = '';
                    landingContent.style.animation = '';
                }
            }
            // gentle lean on the 3D stage itself so the whole screen tilts, not just the text
            canvas.style.transform = active
                ? 'rotateY(' + (ry * 0.45).toFixed(2) + 'deg) rotateX(' + (rx * 0.45).toFixed(2) + 'deg)'
                : '';
        }

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
        let dprCap = 1.5;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x05060f, 0.06);
        const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
        camera.position.set(0, 0.25, 6.6);

        // ---------- colour engine (slow spectrum cycle) ----------
        const cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color();
        function updateColors(t) {
            const h = (t * 0.018) % 1;            // full cycle ~55s
            cA.setHSL(h, 0.9, 0.55);
            cB.setHSL((h + 0.5) % 1, 0.85, 0.6);
            cC.setHSL((h + 0.33) % 1, 0.9, 0.62);
        }
        updateColors(0);

        // ---------- lights ----------
        scene.add(new THREE.AmbientLight(0x223044, 0.75));
        const dir = new THREE.DirectionalLight(0xffffff, 0.5);
        dir.position.set(2, 4, 5); scene.add(dir);
        const L1 = new THREE.PointLight(0xffffff, 2.0, 30);
        const L2 = new THREE.PointLight(0xffffff, 1.7, 30);
        scene.add(L1, L2);
        const innerLight = new THREE.PointLight(0xffffff, 1.4, 8);
        scene.add(innerLight);

        function glowTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const g = c.getContext('2d');
            const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
            grd.addColorStop(0, 'rgba(255,255,255,0.95)');
            grd.addColorStop(0.4, 'rgba(255,255,255,0.32)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }
        const GLOW = glowTex();

        // ---------- spin group (the part the user rotates) ----------
        const spin = new THREE.Group();
        scene.add(spin);

        // crystal core
        const coreGeo = new THREE.IcosahedronGeometry(1.25, 1);
        const coreMat = new THREE.MeshPhongMaterial({ color: 0x0b1a2a, emissive: 0x113355, specular: 0xffffff, shininess: 110, flatShading: true });
        const core = new THREE.Mesh(coreGeo, coreMat);
        spin.add(core);

        // glowing edges
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.9 }));
        core.add(edges);

        // inner glow sprite
        const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        innerGlow.scale.set(3.2, 3.2, 1);
        spin.add(innerGlow);

        // geodesic energy shell
        const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.15, 1),
            new THREE.MeshBasicMaterial({ color: 0x66f0ff, wireframe: true, transparent: true, opacity: 0.22 }));
        spin.add(shell);

        // big background halo
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        halo.scale.set(7, 7, 1); halo.position.set(0, 0.1, -2);
        scene.add(halo);

        // ---------- orbiting satellites (InstancedMesh = 1 draw call) ----------
        const MAXSAT = 18;
        const satMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({}), MAXSAT);
        satMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(satMesh);
        const dummy = new THREE.Object3D();
        const sats = [];
        function makeSat(active, hueSpread) {
            const r = 1.9 + Math.random() * 1.8;
            const incX = Math.random() * Math.PI, incZ = Math.random() * Math.PI;
            return {
                active, r, speed: (0.4 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1),
                phase: Math.random() * 6.28, size: 0.6 + Math.random() * 0.9,
                cx: Math.cos(incX), sx: Math.sin(incX), cz: Math.cos(incZ), sz: Math.sin(incZ),
                hue: hueSpread, col: new THREE.Color()
            };
        }
        for (let i = 0; i < MAXSAT; i++) sats.push(makeSat(i < 5, Math.random()));
        let satCount = 5;

        // ---------- dust ----------
        const PC = 320;
        const pPos = new Float32Array(PC * 3), pVel = new Float32Array(PC * 3);
        for (let i = 0; i < PC; i++) { pPos[i * 3] = (Math.random() - .5) * 17; pPos[i * 3 + 1] = Math.random() * 9 - 2; pPos[i * 3 + 2] = (Math.random() - .5) * 10 - 2; }
        const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x8fe9ff, size: 0.03, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(points);

        // ---------- grid ----------
        const grid = new THREE.GridHelper(46, 46, 0x22d3ee, 0xff2d95);
        grid.material.transparent = true; grid.material.opacity = 0.18; grid.position.y = -2.5;
        scene.add(grid);

        // ---------- shockwave pool ----------
        const waves = [];
        for (let i = 0; i < 3; i++) {
            const w = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 10, 64), new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
            w.rotation.x = Math.PI / 2; w.visible = false; w.userData = { life: 0 }; scene.add(w); waves.push(w);
        }

        // ---------- interaction ----------
        let rect = { left: 0, top: 0, width: 1, height: 1 };
        let overStage = false, mx = 0, my = 0;       // mouse rel to stage centre (-1..1)
        let velY = 0, velX = 0, tVelY = 0, tVelX = 0; // angular velocities
        let kick = 0;
        const MAXSPIN = 3.2, IDLE = 0.16, DZ = 0.12;
        const cursor3D = new THREE.Vector3(), _v = new THREE.Vector3();
        const pulse = { o: new THREE.Vector3(), s: 0 };

        function dz(v) { const a = Math.abs(v); return a < DZ ? 0 : Math.sign(v) * (a - DZ) / (1 - DZ); }

        // ---- Direct "grab & orbit" interaction -------------------------------
        // Press-drag anywhere on the hero to rotate the object in ANY direction.
        // Release with motion and it keeps spinning (momentum), easing back to a
        // slow idle spin. A quick click (no real drag) fires a shockwave + orbiter.
        const ROT_SENS = 0.0085;          // radians rotated per pixel dragged
        let dragging = false, dragDX = 0, dragDY = 0, lastPX = 0, lastPY = 0;
        let downT = 0, movedDist = 0;

        function heroBottom() {
            const r = canvas.getBoundingClientRect();
            return r.top + r.height;
        }
        function onMove(e) {
            mx = (e.clientX / window.innerWidth) * 2 - 1;
            my = (e.clientY / window.innerHeight) * 2 - 1;
            if (dragging) {
                dragDX += e.clientX - lastPX;
                dragDY += e.clientY - lastPY;
                movedDist += Math.abs(e.clientX - lastPX) + Math.abs(e.clientY - lastPY);
                lastPX = e.clientX; lastPY = e.clientY;
            }
        }
        function spawnWave(at) {
            const w = waves.find(x => !x.visible) || waves[0];
            w.position.copy(at); w.scale.setScalar(0.3); w.material.opacity = 0.9; w.visible = true; w.userData.life = 1;
            w.material.color.copy(cA);
        }
        function onDown(e) {
            if (!inView || e.pointerType === 'touch') return;     // leave touch free to scroll the page
            const tg = e.target;
            if (tg && tg.closest && tg.closest('button, a, input, select, textarea, label')) return; // don't hijack controls
            if (e.clientY > heroBottom()) return;                  // only grab inside the hero area
            dragging = true; movedDist = 0;
            lastPX = e.clientX; lastPY = e.clientY; downT = performance.now();
            velY = 0; velX = 0;                                    // stop existing momentum on grab
            document.body.classList.add('hero-dragging');
        }
        function onUp() {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('hero-dragging');
            // a quick, near-stationary press counts as a click -> shockwave + orbiter
            if (movedDist < 6 && performance.now() - downT < 350) {
                updateCursor3D();
                pulse.o.copy(cursor3D); pulse.s = 1; spawnWave(cursor3D); kick = 2.4;
                if (satCount < MAXSAT) { const s = makeSat(true, Math.random()); sats[satCount] = s; satCount++; }
            }
        }
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerdown', onDown, { passive: true });
        window.addEventListener('pointerup', onUp, { passive: true });
        window.addEventListener('pointercancel', onUp, { passive: true });

        function updateCursor3D() {
            _v.set(mx, -my, 0.5).unproject(camera); _v.sub(camera.position).normalize();
            const d = -camera.position.z / _v.z; cursor3D.copy(camera.position).add(_v.multiplyScalar(d));
        }

        function resize() {
            const w = canvas.clientWidth || window.innerWidth;
            const h = canvas.clientHeight || Math.min(window.innerHeight * 0.6, 560);
            renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        }
        window.addEventListener('resize', resize);
        resize();

        let inView = true;
        if ('IntersectionObserver' in window) new IntersectionObserver(es => { inView = es[0].isIntersecting; }, { threshold: 0.01 }).observe(canvas);

        let frames = 0, accum = 0, downgraded = false;
        const clock = new THREE.Clock();
        let running = true;

        function frame() {
            if (!running) return;
            requestAnimationFrame(frame);
            if (!inView || document.hidden) { clock.getDelta(); return; }
            const t = clock.getElapsedTime();
            const dt = Math.min(clock.getDelta(), 0.05);
            updateColors(t);
            updateCursor3D();

            // adaptive quality
            frames++; accum += dt;
            if (frames >= 90) { const fps = frames / accum; if (!downgraded && fps < 42) { downgraded = true; dprCap = 1; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1)); resize(); points.material.opacity = 0.45; } frames = 0; accum = 0; }

            // colours
            coreMat.emissive.copy(cA).multiplyScalar(0.55);
            coreMat.color.copy(cA).multiplyScalar(0.18);
            edges.material.color.copy(cA).lerp(new THREE.Color(0xffffff), 0.35);
            shell.material.color.copy(cB);
            L1.color.copy(cA); L2.color.copy(cB); innerLight.color.copy(cA);
            innerGlow.material.color.copy(cA); halo.material.color.copy(cA);

            // rotation: direct 1:1 grab while dragging, momentum + idle spin otherwise
            let _ddx = 0, _ddy = 0;          // this frame's drag delta (for the screen tilt)
            if (dragging) {
                _ddx = dragDX; _ddy = dragDY;
                spin.rotation.y += dragDX * ROT_SENS;
                spin.rotation.x += dragDY * ROT_SENS;
                velY = dragDX * ROT_SENS;   // remember last delta for release momentum
                velX = dragDY * ROT_SENS;
                dragDX = 0; dragDY = 0;
            } else {
                spin.rotation.y += velY + (IDLE + kick) * dt;
                spin.rotation.x += velX;
                velY *= 0.95; velX *= 0.90; // momentum decays back to idle
            }
            spin.rotation.x = Math.max(-1.2, Math.min(1.2, spin.rotation.x)); // keep it tasteful
            kick *= 0.93;

            // screen tilt: lean toward the drag while you're actively rotating the
            // core, then ease back to flat the instant you stop moving or let go
            if (!reducedMotion) {
                const tTY = dragging ? Math.max(-9, Math.min(9, _ddx * 0.55)) : 0;
                const tTX = dragging ? Math.max(-7, Math.min(7, -_ddy * 0.5)) : 0;
                tiltCurY += (tTY - tiltCurY) * 0.14;
                tiltCurX += (tTX - tiltCurX) * 0.14;
                applyScreenTilt(tiltCurY, tiltCurX);
            }

            // core breathing + shell counter-spin
            const breathe = 1 + Math.sin(t * 1.4) * 0.04;
            core.scale.setScalar(breathe);
            shell.rotation.y -= dt * 0.25; shell.rotation.x += dt * 0.06;
            shell.scale.setScalar(1 + Math.sin(t * 1.1) * 0.03);
            innerGlow.scale.setScalar(2.8 + Math.sin(t * 3) * 0.5 + kick * 0.5);
            halo.scale.setScalar(6.5 + Math.sin(t * 1.6) * 0.6);

            // lights orbit
            L1.position.set(Math.cos(t * 0.6) * 4, Math.sin(t * 0.4) * 2.5, Math.sin(t * 0.6) * 4);
            L2.position.set(Math.sin(t * 0.5) * 4, Math.cos(t * 0.7) * 2.5, Math.cos(t * 0.5) * 4);

            // satellites
            for (let i = 0; i < MAXSAT; i++) {
                const s = sats[i];
                if (!s.active) { dummy.scale.setScalar(0); dummy.position.set(0, -999, 0); dummy.updateMatrix(); satMesh.setMatrixAt(i, dummy.matrix); continue; }
                const a = t * s.speed + s.phase;
                let x = Math.cos(a) * s.r, y = 0, z = Math.sin(a) * s.r;
                let y2 = y * s.cx - z * s.sx, z2 = y * s.sx + z * s.cx; y = y2; z = z2;
                let x2 = x * s.cz - y * s.sz, y3 = x * s.sz + y * s.cz; x = x2; y = y3;
                dummy.position.set(x, y, z); dummy.scale.setScalar(s.size); dummy.rotation.set(a, a * 0.7, 0); dummy.updateMatrix();
                satMesh.setMatrixAt(i, dummy.matrix);
                s.col.setHSL((s.hue + t * 0.05) % 1, 0.9, 0.62); satMesh.setColorAt(i, s.col);
            }
            satMesh.instanceMatrix.needsUpdate = true;
            if (satMesh.instanceColor) satMesh.instanceColor.needsUpdate = true;

            // dust: drift + cursor repel + pulse
            const arr = pGeo.attributes.position.array;
            for (let i = 0; i < PC; i++) {
                const ix = i * 3;
                pPos[ix + 1] += dt * 0.24;
                const dx = arr[ix] - cursor3D.x, dy = arr[ix + 1] - cursor3D.y, dzz = arr[ix + 2] - cursor3D.z;
                const d2 = dx * dx + dy * dy + dzz * dzz;
                if (d2 < 4) { const f = (1 - d2 / 4) * dt * 2.2; pVel[ix] += dx * f; pVel[ix + 1] += dy * f; pVel[ix + 2] += dzz * f; }
                if (pulse.s > 0.01) { const ex = arr[ix] - pulse.o.x, ey = arr[ix + 1] - pulse.o.y, ez = arr[ix + 2] - pulse.o.z; const e2 = ex * ex + ey * ey + ez * ez; if (e2 < 16 && e2 > 0.01) { const g = pulse.s * dt * 3 / Math.sqrt(e2); pVel[ix] += ex * g; pVel[ix + 1] += ey * g; pVel[ix + 2] += ez * g; } }
                pVel[ix] *= 0.92; pVel[ix + 1] *= 0.92; pVel[ix + 2] *= 0.92;
                arr[ix] += pVel[ix]; arr[ix + 1] += pVel[ix + 1]; arr[ix + 2] += pVel[ix + 2];
                if (arr[ix + 1] > 7) arr[ix + 1] = -2;
            }
            pGeo.attributes.position.needsUpdate = true; pulse.s *= 0.92;

            for (const w of waves) { if (!w.visible) continue; w.userData.life -= dt * 1.5; const sc = (1 - w.userData.life) * 6 + 0.3; w.scale.set(sc, sc, sc); w.material.opacity = Math.max(0, w.userData.life) * 0.8; w.material.color.copy(cA); if (w.userData.life <= 0) w.visible = false; }

            grid.material.opacity = 0.12 + (Math.sin(t * 1.1) * 0.5 + 0.5) * 0.12;

            // gentle camera life (object rotation is the star)
            camera.position.x += (Math.sin(t * 0.25) * 0.25 - camera.position.x) * 0.04;
            camera.position.y += (0.25 + Math.sin(t * 0.4) * 0.1 - camera.position.y) * 0.04;
            camera.lookAt(0, 0, 0);

            renderer.render(scene, camera);
        }
        frame();

        window.HeroScene = { stop() { running = false; }, start() { if (!running) { running = true; clock.start(); frame(); } } };
        document.addEventListener('visibilitychange', () => { if (!document.hidden && running) clock.start(); });
    }

    /* ===========================================================
       SITE-WIDE MOUSE INTERACTIVITY (runs even without WebGL):
       - cursor spotlight that follows the pointer across cards
       - gentle 3D tilt on stat cards + the auth panel
       - click ripple on every button
       - scroll-reveal as cards enter the viewport
       =========================================================== */
    function initSiteFX() {
        const SPOT = '.match, .stat-card, .tournament-card, .player-card, .team-card, .login-container, .extras-side, .bracket-action-bar';
        const TILT = '.stat-card';   // login panel is tilted separately, from anywhere on the page
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

        // ---- Login panel: lean toward the cursor from ANYWHERE in the window ----
        // (not just while hovering the panel). Tracks the mouse globally and maps
        // its position relative to the panel centre into a 3D tilt.
        let loginRaf = 0, loginEv = null;
        document.addEventListener('pointermove', function (e) {
            loginEv = e;
            if (loginRaf) return;
            loginRaf = requestAnimationFrame(function () {
                loginRaf = 0;
                const panel = document.querySelector('.login-container');
                if (!panel) return;
                const r = panel.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return;   // hidden (not on the login page)
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
                    // already visible (or not laid out yet) -> show instantly, never flash on re-render
                    if (r.width === 0 || (r.top < vh && r.bottom > 0)) { el.classList.add('fx-in'); return; }
                    el.classList.add('fx-reveal'); io.observe(el);
                });
            };
            scan();
            let st;
            new MutationObserver(function () { clearTimeout(st); st = setTimeout(scan, 150); }).observe(document.body, { childList: true, subtree: true });
        }
    }

    function bootAll() { try { initSiteFX(); } catch (e) { /* fx is non-critical */ } boot(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
    else bootAll();
})();

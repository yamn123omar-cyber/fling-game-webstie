/* ============================================================
   BLACK HOLE — adaptive loader + controller (slim)
   - Picks a quality tier and sets pixel ratio / supersampling.
   - Waits for the WebGL bundle, then tweaks the camera.
   - Landing text tilts while the user drags the black hole.
   - Low-FPS watchdog downscales the pixel ratio if needed.
   ============================================================ */
(function () {
    'use strict';

    function start() {
        var exp = document.querySelector('.experience');
        if (!exp) return;

        var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

        function gpuInfo() {
            try {
                var c = document.createElement('canvas');
                var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
                if (!gl) return { gl: false };
                var dbg = gl.getExtension('WEBGL_debug_renderer_info');
                var r = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
                return { gl: true, renderer: ('' + r) };
            } catch (e) { return { gl: false }; }
        }

        function detectTier() {
            var g = gpuInfo();
            if (!g.gl) return 'none';
            if (/SwiftShader|llvmpipe|Software|Microsoft Basic Render|ANGLE \(Google, Vulkan 1\.[0-9]+\.[0-9]+\(SwiftShader/i.test(g.renderer)) return 'none';
            if (reduced) return 'none';

            var ua = navigator.userAgent || '';
            var mobile = /Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(ua);
            var mem = navigator.deviceMemory || 4;
            var cores = navigator.hardwareConcurrency || 4;
            var smallScreen = Math.min(window.innerWidth, window.innerHeight) < 480;

            if (mem <= 2 || cores <= 2 || smallScreen) return 'low';
            if (mobile || mem <= 4 || cores <= 4) return 'medium';
            return 'high';
        }

        var tier = detectTier();

        if (tier === 'high') {
            window.__bhPixelRatio = function () { return Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5); };
            window.__bhSS = 1;
        } else {
            window.__bhPixelRatio = function () { return Math.min(window.devicePixelRatio || 1, 1); };
            window.__bhSS = 1;
        }

        if (tier === 'none') return;

        onBundle();

        function onBundle() {
            var tries = 0;
            (function waitReady() {
                var e = window.__bhExp;
                if (e && e.camera && e.camera.modes && e.camera.modes.debug && e.camera.modes.debug.orbitControls) {
                    configure(e);
                } else if (tries++ < 300) {
                    requestAnimationFrame(waitReady);
                }
            })();
        }

        function configure(e) {
            var oc = null;
            try {
                e.camera.mode = 'debug';
                oc = e.camera.modes.debug.orbitControls;
                oc.enabled = true;
                oc.enableRotate = true;
                oc.enableDamping = false;
                oc.dampingFactor = 1.0;
                oc.rotateSpeed = 2.2;
                oc.autoRotate = true;
                oc.autoRotateSpeed = 1.0;
                if (oc.update) oc.update();
            } catch (err) {}

            // pause auto-spin while dragging, resume after release
            var resumeT;
            exp.addEventListener('pointerdown', function () {
                if (oc) oc.autoRotate = false;
                clearTimeout(resumeT);
            }, { passive: true });
            window.addEventListener('pointerup', function () {
                clearTimeout(resumeT);
                resumeT = setTimeout(function () { if (oc) oc.autoRotate = true; }, 2500);
            }, { passive: true });

            // landing text tilt while dragging the black hole
            var landingContent = document.querySelector('.landing-content');
            var landingTiltActive = false;
            var landingMouseX = 0, landingMouseY = 0;
            var landingMaxTilt = 7;
            var landingRaf = null;

            function applyLandingTilt() {
                if (!landingContent || !landingTiltActive) return;
                if (landingRaf) cancelAnimationFrame(landingRaf);
                landingRaf = requestAnimationFrame(function () {
                    var rect = landingContent.getBoundingClientRect();
                    var cx = rect.left + rect.width / 2;
                    var cy = rect.top + rect.height / 2;
                    var dx = (landingMouseX - cx) / (rect.width / 2);
                    var dy = (landingMouseY - cy) / (rect.height / 2);
                    var tiltY = dx * landingMaxTilt;
                    var tiltX = -dy * landingMaxTilt;
                    landingContent.style.animation = 'none';
                    landingContent.style.transform = 'perspective(900px) rotateX(' + tiltX.toFixed(2) + 'deg) rotateY(' + tiltY.toFixed(2) + 'deg) translateZ(6px)';
                });
            }

            function resetLandingTilt() {
                if (landingRaf) cancelAnimationFrame(landingRaf);
                if (landingContent) {
                    landingContent.style.transform = '';
                    landingContent.style.animation = '';
                }
            }

            if (!reduced) {
                document.addEventListener('pointerdown', function (ev) {
                    if (!exp.contains(ev.target)) return;
                    landingTiltActive = true;
                    landingMouseX = ev.clientX;
                    landingMouseY = ev.clientY;
                    applyLandingTilt();
                }, { passive: true, capture: true });

                document.addEventListener('mousemove', function (ev) {
                    landingMouseX = ev.clientX;
                    landingMouseY = ev.clientY;
                    if (landingTiltActive) applyLandingTilt();
                }, { passive: true });

                document.addEventListener('pointerup', function () {
                    landingTiltActive = false;
                    resetLandingTilt();
                }, { passive: true, capture: true });
                document.addEventListener('pointercancel', function () {
                    landingTiltActive = false;
                    resetLandingTilt();
                }, { passive: true, capture: true });
            }

            startAdaptiveFPS(e);
        }

        function startAdaptiveFPS(e) {
            var renderer = e.renderer && e.renderer.instance;
            if (!renderer || !renderer.setPixelRatio) return;
            var cur = (window.__bhPixelRatio ? window.__bhPixelRatio() : Math.min(window.devicePixelRatio || 1, 2));
            var floor = 0.5;
            var frames = 0, t0 = performance.now(), lowStreak = 0;
            (function tick(now) {
                frames++;
                var dt = now - t0;
                if (dt >= 500) {
                    var fps = frames * 1000 / dt;
                    frames = 0; t0 = now;
                    if (fps < 45) {
                        if (++lowStreak >= 2 && cur > floor) {
                            cur = Math.max(floor, cur - 0.2);
                            try { renderer.setPixelRatio(cur); renderer.setSize(e.config.width, e.config.height); } catch (x) {}
                        }
                    } else { lowStreak = 0; }
                }
                requestAnimationFrame(tick);
            })(performance.now());
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();

// "Fling arena" hero: blocky R6-style ragdolls on a verlet physics sim.
// Grab one with the mouse / finger and throw it — just like in FTAP.
// Hard hits spark and count as flings. When nobody plays, a ghost hand
// occasionally flings someone so the scene never sits still.

const SKINS = [
    { head: '#f5cd30', torso: '#0d69ac', arms: '#f5cd30', legs: '#a4bd47' }, // classic noob
    { head: '#f2d2a9', torso: '#c4ff4d', arms: '#f2d2a9', legs: '#1b1f2a' },
    { head: '#eab892', torso: '#e5484d', arms: '#e5484d', legs: '#2b2f3a' },
    { head: '#8d5524', torso: '#4d8dff', arms: '#8d5524', legs: '#e6e6e6' },
    { head: '#ffe0bd', torso: '#ff4d8d', arms: '#ff4d8d', legs: '#3a2e5a' },
    { head: '#c68642', torso: '#23262f', arms: '#23262f', legs: '#23262f' },
    { head: '#f5cd30', torso: '#f2f4f8', arms: '#f5cd30', legs: '#555c6e' },
    { head: '#f1c27d', torso: '#ff9f43', arms: '#f1c27d', legs: '#2e5aac' },
];

const BODY = [
    [0, -2.75], // 0 head
    [-1, -2], [1, -2], [1, 0], [-1, 0], // 1-4 torso TL TR BR BL
    [-1.5, 0], [1.5, 0], // 5-6 hands
    [-0.5, 2], [0.5, 2], // 7-8 feet
];
const STICKS = [[1, 2], [2, 3], [3, 4], [4, 1], [1, 3], [2, 4], [0, 1], [0, 2], [1, 5], [2, 6], [4, 7], [3, 8]];
const RADIUS = [0.75, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.5, 0.5];
const WORDS = ['FLUNG!', 'YEET!', 'SENT IT!', 'BYE!', 'OOF', 'SPLAT!', 'FLING!'];

export function mountHero(canvas, { onFling = () => {}, hint = null } = {}) {
    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1, u = 12, floor = 0;
    let dolls = [];
    const sparks = [];
    const texts = [];
    let grab = null; // { doll, i, x, y, lx, ly, hist: [] }
    const pointer = { x: -999, y: -999, over: false };
    let lastInteract = 0;
    let nextGhost = performance.now() + 2500;
    let ghost = null;
    let running = true;
    let visible = true;
    let raf = 0;
    let flings = 0;
    let shake = 0;

    function resize() {
        const r = canvas.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = r.width;
        H = r.height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        u = Math.max(9, Math.min(24, W / 62));
        floor = H - Math.max(28, H * 0.075);
        for (const d of dolls) d.u = u;
    }

    function makeDoll(x, y, skin) {
        const pts = BODY.map(([bx, by], i) => ({ x: x + bx * u, y: y + by * u, px: x + bx * u, py: y + by * u, r: RADIUS[i] }));
        const sticks = STICKS.map(([a, b]) => ({ a, b, len: Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) / u }));
        return { pts, sticks, skin, u, lastFling: 0, stand: 0, calmAt: 0, standing: false, phase: Math.random() * 6 };
    }

    function spawn() {
        dolls = [];
        const n = W < 640 ? 3 : W < 1000 ? 4 : 5;
        // On wide screens keep them to the right of the headline.
        const [from, span] = W > 1000 ? [0.5, 0.46] : [0.06, 0.88];
        for (let i = 0; i < n; i++) {
            const x = W * (from + span * (i + 0.5) / n) + (Math.random() - 0.5) * u;
            const y = floor - 3.2 * u - Math.random() * u * 3;
            dolls.push(makeDoll(x, y, SKINS[i % SKINS.length]));
        }
    }

    // ── Physics ─────────────────────────────────────────────────────────
    const G = 2200; // px/s²
    const SUB = 3;
    const DT = 1 / 60 / SUB;

    function step(t) {
        for (let s = 0; s < SUB; s++) {
            const frac = (s + 1) / SUB;
            for (const d of dolls) {
                const damp = d.standing ? 0.9 : 0.996;
                for (const p of d.pts) {
                    const vx = (p.x - p.px) * damp;
                    const vy = (p.y - p.py) * damp;
                    p.px = p.x; p.py = p.y;
                    p.x += vx;
                    p.y += vy + G * DT * DT;
                }
                muscles(d, t);
            }
            if (grab) {
                const p = grab.doll.pts[grab.i];
                const tx = grab.lx + (pointer.x - grab.lx) * frac;
                const ty = grab.ly + (pointer.y - grab.ly) * frac;
                p.x += (tx - p.x) * 0.85;
                p.y += (ty - p.y) * 0.85;
            }
            for (let it = 0; it < 5; it++) {
                for (const d of dolls) {
                    for (const st of d.sticks) {
                        const a = d.pts[st.a], b = d.pts[st.b];
                        const dx = b.x - a.x, dy = b.y - a.y;
                        const dist = Math.hypot(dx, dy) || 0.001;
                        const diff = (dist - st.len * u) / dist * 0.5;
                        const ox = dx * diff, oy = dy * diff;
                        const ga = grab && grab.doll === d && grab.i === st.a;
                        const gb = grab && grab.doll === d && grab.i === st.b;
                        if (ga) { b.x -= ox * 2; b.y -= oy * 2; }
                        else if (gb) { a.x += ox * 2; a.y += oy * 2; }
                        else { a.x += ox; a.y += oy; b.x -= ox; b.y -= oy; }
                    }
                }
                collideDolls();
                for (const d of dolls) for (const p of d.pts) bounds(d, p, t);
            }
        }
        if (grab) { grab.lx = pointer.x; grab.ly = pointer.y; }
    }

    // "Muscles": once a ragdoll has settled on the ground it slowly pulls
    // itself back into a standing pose (and sways a little), like a Roblox
    // character getting up after being flung.
    function muscles(d, t) {
        const held = grab && grab.doll === d;
        if (held) { d.stand = 0; d.standing = false; return; }
        if (t < d.calmAt) { d.standing = false; return; }
        const P = d.pts;
        const onGround = Math.max(P[7].y, P[8].y) > floor - u * 1.3;
        if (!onGround) { d.standing = false; return; }
        d.stand = Math.min(1, d.stand + 0.008);
        d.standing = d.stand > 0.35;
        const k = 0.035 * d.stand * d.stand;
        const fx = (P[7].x + P[8].x) / 2;
        const fy = floor - 0.5 * u;
        const sway = reduced ? 0 : Math.sin(t / 650 + d.phase) * 0.25 * u;
        for (let i = 0; i < 9; i++) {
            const tx = fx + BODY[i][0] * u + (i <= 2 ? sway : 0);
            const ty = fy + (BODY[i][1] - 2) * u;
            const w = i >= 7 ? 0.4 : 1;
            P[i].x += (tx - P[i].x) * k * w;
            P[i].y += (ty - P[i].y) * k * w;
        }
    }
    const knock = (d, t, ms = 900) => { d.stand = 0; d.standing = false; d.calmAt = t + ms; };

    function bounds(d, p, t) {
        const r = p.r * u;
        const vx = p.x - p.px, vy = p.y - p.py;
        let hit = 0, hx = p.x, hy = p.y;
        if (p.y > floor - r) {
            p.y = floor - r;
            hit = Math.abs(vy);
            p.py = p.y + vy * 0.35;
            p.px = p.x - vx * 0.82; // friction
            hy = floor;
        }
        if (p.x < r) { p.x = r; hit = Math.max(hit, Math.abs(vx)); p.px = p.x + vx * 0.45; hx = 0; }
        if (p.x > W - r) { p.x = W - r; hit = Math.max(hit, Math.abs(vx)); p.px = p.x + vx * 0.45; hx = W; }
        if (p.y < -H * 0.6) { p.y = -H * 0.6; p.py = p.y + vy * 0.3; }
        const speed = hit * 60 * SUB; // px/s
        if (speed > 700) impact(d, hx, hy, speed, t);
    }

    function collideDolls() {
        for (let i = 0; i < dolls.length; i++) {
            for (let j = i + 1; j < dolls.length; j++) {
                for (const a of dolls[i].pts) {
                    for (const b of dolls[j].pts) {
                        const dx = b.x - a.x, dy = b.y - a.y;
                        const min = (a.r + b.r) * u;
                        const d2 = dx * dx + dy * dy;
                        if (d2 > min * min || d2 === 0) continue;
                        const d = Math.sqrt(d2);
                        const push = (min - d) / d * 0.5;
                        a.x -= dx * push; a.y -= dy * push;
                        b.x += dx * push; b.y += dy * push;
                    }
                }
            }
        }
    }

    function impact(d, x, y, speed, t) {
        if (speed > 1100) knock(d, t);
        const n = Math.min(18, Math.floor(speed / 160));
        for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            const v = 80 + Math.random() * speed * 0.25;
            sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1, c: Math.random() < 0.5 ? '#c4ff4d' : '#ffffff' });
        }
        if (speed > 1500 && t - d.lastFling > 700 && !(grab && grab.doll === d)) {
            d.lastFling = t;
            flings++;
            onFling(flings);
            if (!reduced) shake = Math.min(10, speed / 350);
            texts.push({ x: Math.max(60, Math.min(W - 60, x)), y: Math.min(y, floor - 30), text: WORDS[Math.floor(Math.random() * WORDS.length)], life: 1 });
        }
    }

    // ── Input ───────────────────────────────────────────────────────────
    function local(e) {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function nearest(x, y, maxDist) {
        let best = null, bd = maxDist * maxDist;
        for (const d of dolls) d.pts.forEach((p, i) => {
            const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (dd < bd) { bd = dd; best = { doll: d, i }; }
        });
        return best;
    }
    function down(e) {
        const { x, y } = local(e);
        const n = nearest(x, y, Math.max(34, u * 3.2));
        if (!n) return;
        e.preventDefault();
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        pointer.x = x; pointer.y = y;
        grab = { ...n, lx: x, ly: y, hist: [{ x, y, t: performance.now() }] };
        lastInteract = performance.now();
        ghost = null;
        canvas.style.cursor = 'grabbing';
        if (hint) hint.classList.add('gone');
    }
    function move(e) {
        const { x, y } = local(e);
        pointer.x = x; pointer.y = y;
        if (grab) {
            grab.hist.push({ x, y, t: performance.now() });
            if (grab.hist.length > 8) grab.hist.shift();
            lastInteract = performance.now();
        } else {
            canvas.style.cursor = nearest(x, y, Math.max(34, u * 3.2)) ? 'grab' : 'default';
        }
    }
    function up() {
        if (!grab) return;
        const h = grab.hist;
        const now = performance.now();
        const recent = h.filter(s => now - s.t < 90);
        if (recent.length >= 2) {
            const a = recent[0], b = recent[recent.length - 1];
            const dt = Math.max(16, b.t - a.t) / 1000;
            let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
            const sp = Math.hypot(vx, vy);
            const max = 5200;
            if (sp > max) { vx *= max / sp; vy *= max / sp; }
            const step = 1 / 60 / SUB;
            for (const [i, p] of grab.doll.pts.entries()) {
                const k = i === grab.i ? 1.25 : 0.75;
                p.px = p.x - vx * step * k;
                p.py = p.y - vy * step * k;
            }
        }
        knock(grab.doll, performance.now(), 700);
        grab = null;
        canvas.style.cursor = 'grab';
    }

    function ghostFling(t) {
        if (reduced || grab || t < nextGhost || t - lastInteract < 7000) return;
        nextGhost = t + 3200 + Math.random() * 2600;
        const d = dolls[Math.floor(Math.random() * dolls.length)];
        const i = 0;
        knock(d, t, 1200);
        const dir = d.pts[0].x < W / 2 ? 1 : -1;
        const vx = dir * (1600 + Math.random() * 1600);
        const vy = -(1400 + Math.random() * 900);
        const step = 1 / 60 / SUB;
        for (const [k, p] of d.pts.entries()) {
            const m = k === i ? 1.2 : 0.8;
            p.px = p.x - vx * step * m;
            p.py = p.y - vy * step * m;
        }
        ghost = { doll: d, i, t, x: d.pts[0].x - dir * 140, y: d.pts[0].y - 110 };
    }

    // ── Drawing ─────────────────────────────────────────────────────────
    function limb(ax, ay, bx, by, w, color) {
        const len = Math.hypot(bx - ax, by - ay);
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        roundRect(-w * 0.1, -w / 2, len + w * 0.35, w, w * 0.22);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function drawDoll(d) {
        const P = d.pts;
        const ax = P[2].x - P[1].x, ay = P[2].y - P[1].y;
        const al = Math.hypot(ax, ay) || 1;
        const nx = ax / al, ny = ay / al; // torso right axis
        ctx.lineWidth = Math.max(1, u * 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.38)';
        ctx.lineJoin = 'round';
        const w = u * 0.98;
        // legs
        limb(P[4].x + nx * u * 0.5, P[4].y + ny * u * 0.5, P[7].x, P[7].y, w, d.skin.legs);
        limb(P[3].x - nx * u * 0.5, P[3].y - ny * u * 0.5, P[8].x, P[8].y, w, d.skin.legs);
        // arms
        limb(P[1].x - nx * u * 0.5, P[1].y - ny * u * 0.5, P[5].x, P[5].y, w, d.skin.arms);
        limb(P[2].x + nx * u * 0.5, P[2].y + ny * u * 0.5, P[6].x, P[6].y, w, d.skin.arms);
        // torso
        ctx.beginPath();
        ctx.moveTo(P[1].x, P[1].y);
        ctx.lineTo(P[2].x, P[2].y);
        ctx.lineTo(P[3].x, P[3].y);
        ctx.lineTo(P[4].x, P[4].y);
        ctx.closePath();
        ctx.fillStyle = d.skin.torso;
        ctx.fill();
        ctx.stroke();
        // head (upright relative to torso)
        const ang = Math.atan2(ny, nx);
        ctx.save();
        ctx.translate(P[0].x, P[0].y);
        ctx.rotate(ang);
        const hs = u * 1.25;
        roundRect(-hs / 2, -hs / 2, hs, hs * 0.95, hs * 0.28);
        ctx.fillStyle = d.skin.head;
        ctx.fill();
        ctx.stroke();
        // face — scared when flying fast
        const v = Math.hypot(P[0].x - P[0].px, P[0].y - P[0].py);
        ctx.fillStyle = '#111';
        const ex = hs * 0.18, ey = -hs * 0.08, er = Math.max(1, hs * 0.07);
        ctx.beginPath(); ctx.arc(-ex, ey, er, 0, 7); ctx.arc(ex, ey, er, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, hs * 0.07);
        ctx.strokeStyle = '#111';
        if (v > 9) { ctx.arc(0, hs * 0.2, hs * 0.1, 0, 7); }
        else { ctx.arc(0, hs * 0.08, hs * 0.2, 0.2 * Math.PI, 0.8 * Math.PI); }
        ctx.stroke();
        ctx.restore();
    }

    function draw(t) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (shake > 0.2) {
            ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
            shake *= 0.86;
        }
        // floor
        const g = ctx.createLinearGradient(0, floor, 0, H);
        g.addColorStop(0, 'rgba(196,255,77,0.10)');
        g.addColorStop(1, 'rgba(196,255,77,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, floor, W, H - floor);
        ctx.fillStyle = 'rgba(196,255,77,0.55)';
        ctx.fillRect(0, floor, W, 1.5);
        // shadows
        for (const d of dolls) {
            const cx = (d.pts[3].x + d.pts[4].x) / 2;
            const hgt = Math.max(0, floor - Math.max(d.pts[7].y, d.pts[8].y));
            const k = Math.max(0, 1 - hgt / (H * 0.6));
            ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`;
            ctx.beginPath();
            ctx.ellipse(cx, floor + 2, u * 2.2 * (0.5 + k * 0.5), u * 0.35, 0, 0, 7);
            ctx.fill();
        }
        for (const d of dolls) drawDoll(d);

        // grab beam
        const beam = (x1, y1, x2, y2, alpha) => {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = '#c4ff4d';
            ctx.shadowColor = '#c4ff4d';
            ctx.shadowBlur = 14;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([7, 6]);
            ctx.lineDashOffset = -t / 20;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#c4ff4d';
            ctx.beginPath(); ctx.arc(x2, y2, 4.5, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.arc(x1, y1, 7, 0, 7); ctx.globalAlpha = alpha * 0.35; ctx.fill();
            ctx.restore();
        };
        if (grab) {
            const p = grab.doll.pts[grab.i];
            beam(pointer.x, pointer.y, p.x, p.y, 1);
        } else if (ghost && t - ghost.t < 260) {
            const p = ghost.doll.pts[ghost.i];
            beam(ghost.x, ghost.y, p.x, p.y, 1 - (t - ghost.t) / 260);
        }

        // sparks
        for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i];
            s.vy += 1400 / 60; s.x += s.vx / 60; s.y += s.vy / 60; s.life -= 0.035;
            if (s.life <= 0) { sparks.splice(i, 1); continue; }
            ctx.globalAlpha = s.life;
            ctx.fillStyle = s.c;
            ctx.fillRect(s.x, s.y, 3, 3);
        }
        ctx.globalAlpha = 1;
        // floating words
        for (let i = texts.length - 1; i >= 0; i--) {
            const f = texts[i];
            f.y -= 0.9; f.life -= 0.013;
            if (f.life <= 0) { texts.splice(i, 1); continue; }
            ctx.save();
            ctx.globalAlpha = Math.min(1, f.life * 1.6);
            ctx.font = `800 ${Math.round(u * 1.9)}px Unbounded, Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(7,8,12,0.9)';
            ctx.strokeText(f.text, f.x, f.y);
            ctx.fillStyle = '#c4ff4d';
            ctx.fillText(f.text, f.x, f.y);
            ctx.restore();
        }
    }

    function frame(t) {
        raf = 0;
        if (!running || !visible) return;
        ghostFling(t);
        step(t);
        draw(t);
        raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && running && visible) raf = requestAnimationFrame(frame); };

    const ro = new ResizeObserver(() => {
        const oldW = W;
        resize();
        if (!dolls.length || Math.abs(oldW - W) > 200) spawn();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; kick(); });
    io.observe(canvas);
    const vis = () => { visible = !document.hidden; kick(); };
    document.addEventListener('visibilitychange', vis);
    // On touch screens only block scrolling when the finger lands on a ragdoll.
    const touchStart = e => {
        const t = e.touches[0];
        const r = canvas.getBoundingClientRect();
        if (nearest(t.clientX - r.left, t.clientY - r.top, Math.max(34, u * 3.2))) e.preventDefault();
    };
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    resize();
    spawn();
    kick();

    return () => {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        document.removeEventListener('visibilitychange', vis);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('touchstart', touchStart);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
    };
}

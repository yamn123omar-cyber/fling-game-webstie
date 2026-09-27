// 3D Roblox avatar viewer. Roblox serves avatars as OBJ + MTL + PNG textures;
// our server proxies them (Roblox blocks browser CORS). Three.js is loaded on
// demand from cdnjs; the OBJ/MTL parsing below is tiny and dependency-free.
// Falls back to the 2D full-body render, then to a silhouette.

let threePromise = null;
function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!threePromise) {
        threePromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            s.async = true;
            s.onload = () => resolve(window.THREE);
            s.onerror = () => { threePromise = null; reject(new Error('three.js failed to load')); };
            document.head.append(s);
        });
    }
    return threePromise;
}

export function parseMTL(text) {
    const mats = {};
    let cur = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const [key, ...rest] = line.split(/\s+/);
        const val = rest.join(' ');
        if (key === 'newmtl') { cur = mats[val] = { name: val, Kd: [0.8, 0.8, 0.8], d: 1 }; continue; }
        if (!cur) continue;
        if (key === 'Kd') cur.Kd = rest.map(Number);
        else if (key === 'd') cur.d = Number(rest[0]);
        else if (key === 'map_Kd') cur.map_Kd = val;
        else if (key === 'map_d') cur.map_d = val;
    }
    return mats;
}

// → [{ material, position: Float32Array, normal: Float32Array|null, uv: Float32Array|null }]
export function parseOBJ(text) {
    const v = [], vt = [], vn = [];
    const groups = [];
    let g = null;
    const start = mat => { g = { material: mat, p: [], t: [], n: [] }; groups.push(g); };
    start(null);
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const parts = line.split(/\s+/);
        const k = parts[0];
        if (k === 'v') v.push(+parts[1], +parts[2], +parts[3]);
        else if (k === 'vt') vt.push(+parts[1], +parts[2]);
        else if (k === 'vn') vn.push(+parts[1], +parts[2], +parts[3]);
        else if (k === 'usemtl') start(parts.slice(1).join(' '));
        else if (k === 'f') {
            const idx = parts.slice(1).map(s => s.split('/').map(x => (x ? parseInt(x, 10) : 0)));
            for (let i = 1; i < idx.length - 1; i++) {
                for (const c of [idx[0], idx[i], idx[i + 1]]) {
                    const [pi, ti, ni] = c;
                    const P = (pi < 0 ? v.length / 3 + pi : pi - 1) * 3;
                    g.p.push(v[P], v[P + 1], v[P + 2]);
                    if (ti) { const T = (ti < 0 ? vt.length / 2 + ti : ti - 1) * 2; g.t.push(vt[T], vt[T + 1]); }
                    if (ni) { const N = (ni < 0 ? vn.length / 3 + ni : ni - 1) * 3; g.n.push(vn[N], vn[N + 1], vn[N + 2]); }
                }
            }
        }
    }
    return groups.filter(x => x.p.length).map(x => ({
        material: x.material,
        position: new Float32Array(x.p),
        uv: x.t.length === x.p.length / 3 * 2 ? new Float32Array(x.t) : null,
        normal: x.n.length === x.p.length ? new Float32Array(x.n) : null,
    }));
}

function fallback(el, robloxId) {
    el.classList.add('flat');
    el.innerHTML = `<img src="/api/roblox/avatar/${robloxId}?type=full" alt="Roblox avatar" class="avatar-2d">`;
    el.querySelector('img').addEventListener('error', () => { el.innerHTML = '<div class="avatar-none"></div>'; });
}

export async function mountAvatar3d(el, robloxId) {
    let stopped = false;
    let cleanup = () => { stopped = true; };
    try {
        const [THREE, info] = await Promise.all([
            loadThree(),
            fetch(`/api/roblox/3d/${robloxId}`).then(r => (r.ok ? r.json() : Promise.reject(new Error('no model')))),
        ]);
        if (stopped) return cleanup;
        const model = info.model;
        const [objText, mtlText] = await Promise.all([
            fetch(model.obj).then(r => r.text()),
            model.mtl ? fetch(model.mtl).then(r => r.text()) : Promise.resolve(''),
        ]);
        const mats = parseMTL(mtlText);
        const groups = parseOBJ(objText);
        if (!groups.length) throw new Error('empty model');

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.outputEncoding = THREE.sRGBEncoding;
        el.innerHTML = '';
        el.append(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3040, 0.95));
        const key = new THREE.DirectionalLight(0xffffff, 0.75);
        key.position.set(3, 6, 8);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x818cf8, 0.55);
        rim.position.set(-6, 3, -6);
        scene.add(rim);

        const loader = new THREE.TextureLoader();
        const texUrl = name => (name && model.textures[name]) || null;
        const root = new THREE.Group();
        for (const g of groups) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
            if (g.uv) geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
            if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
            else geo.computeVertexNormals();
            const m = mats[g.material] || {};
            const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(...(m.Kd || [0.8, 0.8, 0.8])) });
            const map = texUrl(m.map_Kd);
            if (map) {
                mat.map = loader.load(map);
                mat.map.encoding = THREE.sRGBEncoding;
                mat.color.set(0xffffff);
            }
            if (m.map_d || (m.d !== undefined && m.d < 1)) { mat.transparent = true; mat.alphaTest = 0.1; }
            root.add(new THREE.Mesh(geo, mat));
        }
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        root.position.sub(center);
        const pivot = new THREE.Group();
        pivot.add(root);
        scene.add(pivot);
        const dist = (Math.max(size.y, size.x * 1.2) / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.15;
        camera.position.set(0, size.y * 0.05, dist);
        camera.lookAt(0, 0, 0);

        let rotY = -0.35, vel = 0.004, dragging = false, lastX = 0;
        const resize = () => {
            const w = el.clientWidth, h = el.clientHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / Math.max(1, h);
            camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();
        const down = e => { dragging = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); };
        const move = e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; rotY += dx * 0.01; vel = dx * 0.0015; };
        const up = () => { dragging = false; };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        let raf = 0;
        const loop = () => {
            if (stopped || !el.isConnected) return;
            if (!dragging) { rotY += vel; vel += (0.004 - vel) * 0.02; }
            pivot.rotation.y = rotY;
            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
        };
        loop();
        el.classList.add('ready');
        cleanup = () => {
            stopped = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            renderer.dispose();
        };
    } catch (e) {
        if (!stopped) fallback(el, robloxId);
    }
    return cleanup;
}

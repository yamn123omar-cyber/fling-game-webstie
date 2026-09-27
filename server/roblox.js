// Roblox lookups: username → user, profile description (for verification),
// avatar thumbnails and the 3D avatar model. Roblox APIs don't allow browser
// CORS, so the site proxies them and caches results in memory.
const crypto = require('crypto');

const TTL = 60 * 60 * 1000;
const cache = new Map(); // key -> { at, value }

async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return value;
}

async function getJson(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Roblox ${res.status} for ${url}`);
    return res.json();
}

async function resolveUsername(name) {
    const clean = String(name || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) return null;
    return cached(`name:${clean.toLowerCase()}`, 10 * 60 * 1000, async () => {
        const j = await getJson('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [clean], excludeBannedUsers: true }),
        });
        const u = j.data && j.data[0];
        return u ? { id: u.id, name: u.name, displayName: u.displayName } : null;
    });
}

async function getUser(id) {
    // Never cached: used to check the verification code right now.
    const u = await getJson(`https://users.roblox.com/v1/users/${Number(id)}`);
    return { id: u.id, name: u.name, displayName: u.displayName, description: u.description || '' };
}

const WORDS = ['fling', 'grab', 'toss', 'yeet', 'noob', 'ragdoll', 'blast', 'orbit', 'rocket', 'pixel', 'turbo', 'magma', 'frost', 'storm', 'comet', 'cactus'];
function verificationCode() {
    const w = () => WORDS[crypto.randomInt(WORDS.length)];
    return `ftap-${w()}-${w()}-${crypto.randomInt(1000, 9999)}`;
}

// ── Thumbnails (batched) ────────────────────────────────────────────────────
const pending = { headshot: new Map(), avatar: new Map() };
let flushTimer = null;

function thumbnail(type, userId) {
    const key = `thumb:${type}:${userId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
    return new Promise((resolve) => {
        const list = pending[type];
        if (!list.has(userId)) list.set(userId, []);
        list.get(userId).push(resolve);
        if (!flushTimer) flushTimer = setTimeout(flushThumbs, 40);
    });
}

async function flushThumbs() {
    flushTimer = null;
    for (const type of ['headshot', 'avatar']) {
        const list = pending[type];
        if (!list.size) continue;
        const batch = new Map(list);
        list.clear();
        const ids = [...batch.keys()];
        for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            const size = type === 'headshot' ? '150x150' : '720x720';
            const path = type === 'headshot' ? 'avatar-headshot' : 'avatar';
            let results = {};
            try {
                const j = await getJson(`https://thumbnails.roblox.com/v1/users/${path}?userIds=${chunk.join(',')}&size=${size}&format=Png&isCircular=false`);
                for (const d of j.data || []) if (d.state === 'Completed' && d.imageUrl) results[d.targetId] = d.imageUrl;
            } catch (e) {
                console.warn('[roblox] thumbnails failed:', e.message);
            }
            for (const id of chunk) {
                const url = results[id] || null;
                if (url) cache.set(`thumb:${type}:${id}`, { at: Date.now(), value: url });
                for (const r of batch.get(id)) r(url);
            }
        }
    }
}

// ── 3D avatar ───────────────────────────────────────────────────────────────
function cdnHost(hash) {
    let i = 31;
    for (let t = 0; t < 38; t++) i ^= hash.charCodeAt(t) || 0;
    return `https://t${i % 8}.rbxcdn.com/${hash}`;
}

async function avatar3d(userId) {
    return cached(`3d:${userId}`, 15 * 60 * 1000, async () => {
        let info;
        for (let attempt = 0; attempt < 4; attempt++) {
            const j = await getJson(`https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`);
            info = j.data ? j.data[0] : j;
            if (info && info.state === 'Completed') break;
            await new Promise(r => setTimeout(r, 800));
        }
        if (!info || info.state !== 'Completed' || !info.imageUrl) return null;
        const meta = await getJson(info.imageUrl);
        if (!meta || !meta.obj) return null;
        const url = h => `/api/roblox/cdn/${encodeURIComponent(h)}`;
        return {
            obj: url(meta.obj),
            mtl: meta.mtl ? url(meta.mtl) : null,
            textures: Object.fromEntries((meta.textures || []).map(h => [h, url(h)])),
            aabb: meta.aabb || null,
            camera: meta.camera || null,
        };
    });
}

// Fetch a file from Roblox's CDN (small LRU so repeat views are instant).
const fileCache = new Map();
let fileCacheBytes = 0;
async function cdnFile(hash) {
    if (!/^[A-Za-z0-9_\-]{16,160}$/.test(hash)) return null;
    if (fileCache.has(hash)) {
        const v = fileCache.get(hash);
        fileCache.delete(hash);
        fileCache.set(hash, v);
        return v;
    }
    const candidates = [cdnHost(hash), `https://tr.rbxcdn.com/${hash}`];
    for (const u of candidates) {
        try {
            const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            let type = res.headers.get('content-type') || 'application/octet-stream';
            if (buf.slice(0, 4).toString('hex') === '89504e47') type = 'image/png';
            const v = { buf, type };
            fileCache.set(hash, v);
            fileCacheBytes += buf.length;
            while (fileCacheBytes > 40 * 1024 * 1024 && fileCache.size) {
                const [k, old] = fileCache.entries().next().value;
                fileCache.delete(k);
                fileCacheBytes -= old.buf.length;
            }
            return v;
        } catch { /* try next host */ }
    }
    return null;
}

module.exports = { resolveUsername, getUser, verificationCode, thumbnail, avatar3d, cdnFile };

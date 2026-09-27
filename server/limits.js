// Tiny in-memory sliding-window rate limiter.
const hits = new Map();

function allow(key, max, windowMs) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) {
        hits.set(key, list);
        return false;
    }
    list.push(now);
    hits.set(key, list);
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 3600_000) hits.delete(k);
}, 600_000).unref();

module.exports = { allow };

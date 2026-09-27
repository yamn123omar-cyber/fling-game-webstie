// Server-Sent Events hub. One long-lived GET /api/stream per open tab.
// We push small events ("message", "match", "tournament", "notification",
// "presence") and the client decides what to refetch or render.

const clients = new Map(); // userId -> Set<res>
const anonymous = new Set();
const presenceListeners = new Set();

function write(res, event, payload) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch { /* connection already gone */ }
}

function connect(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const userId = req.user ? req.user.id : null;
    let set = anonymous;
    if (userId) {
        if (!clients.has(userId)) clients.set(userId, new Set());
        set = clients.get(userId);
    }
    const wasOnline = userId && set.size > 0;
    set.add(res);
    if (userId && !wasOnline) for (const fn of presenceListeners) fn(userId, true);

    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
        clearInterval(ping);
        set.delete(res);
        if (userId && set.size === 0) {
            clients.delete(userId);
            for (const fn of presenceListeners) fn(userId, false);
        }
    });
}

function toUser(userId, event, payload) {
    const set = clients.get(userId);
    if (set) for (const res of set) write(res, event, payload);
}

function toUsers(userIds, event, payload) {
    for (const id of new Set(userIds)) toUser(id, event, payload);
}

function broadcast(event, payload) {
    for (const set of clients.values()) for (const res of set) write(res, event, payload);
    for (const res of anonymous) write(res, event, payload);
}

module.exports = {
    connect,
    toUser,
    toUsers,
    broadcast,
    isOnline: userId => clients.has(userId),
    onlineCount: () => clients.size,
    onPresence: fn => presenceListeners.add(fn),
};

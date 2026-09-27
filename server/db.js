// A small in-memory document store persisted to a JSON file.
// Every write goes through `db.save()` which debounces an atomic flush to disk
// (write to a temp file, then rename). The whole dataset for a community
// tournament site comfortably fits in memory and this keeps hosting simple:
// no database server, no native modules.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const SCHEMA_VERSION = 1;

function empty() {
    return {
        version: SCHEMA_VERSION,
        users: {},
        sessions: {},
        friendRequests: {},
        teams: {},
        teamInvites: {},
        tournaments: {},
        matches: {},
        messages: {},       // channelId -> [message]
        notifications: {},  // userId -> [notification]
        reads: {},          // userId -> { channelId: isoTimestamp }
        meta: { createdAt: new Date().toISOString() },
    };
}

let data = empty();
let dirty = false;
let timer = null;
let lastWrite = 0;
const listeners = new Set();

// username (lowercase) -> userId
const usernameIndex = new Map();

function reindex() {
    usernameIndex.clear();
    for (const u of Object.values(data.users)) usernameIndex.set(u.username.toLowerCase(), u.id);
}

function normalize(d) {
    const base = empty();
    for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
    return d;
}

function loadFromObject(obj) {
    data = normalize(obj);
    reindex();
}

function load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
        loadFromObject(JSON.parse(fs.readFileSync(FILE, 'utf8')));
        return true;
    }
    loadFromObject(empty());
    return false;
}

function flush() {
    if (!dirty) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
    dirty = false;
    lastWrite = Date.now();
    for (const fn of listeners) fn();
}

function save() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        try { flush(); } catch (e) { console.error('[db] flush failed:', e.message); }
    }, 400);
}

function id(prefix) {
    return `${prefix}_${crypto.randomBytes(6).toString('base64url')}`;
}

function userByName(name) {
    const uid = usernameIndex.get(String(name || '').toLowerCase());
    return uid ? data.users[uid] : null;
}

module.exports = {
    get data() { return data; },
    load,
    loadFromObject,
    flush,
    save,
    id,
    userByName,
    indexUser(user) { usernameIndex.set(user.username.toLowerCase(), user.id); },
    unindexUser(user) { usernameIndex.delete(user.username.toLowerCase()); },
    onFlush(fn) { listeners.add(fn); },
    get lastWrite() { return lastWrite; },
    get isDirty() { return dirty; },
    FILE,
    DATA_DIR,
};

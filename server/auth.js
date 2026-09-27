const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'ftap_session';
const SESSION_DAYS = 30;
const ROLE_RANK = { player: 0, ref: 1, admin: 2 };

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
    if (!stored || !stored.startsWith('scrypt$')) return false;
    const [, saltB64, hashB64] = stored.split('$');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
}

const tokenKey = token => crypto.createHash('sha256').update(token).digest('base64url');

function createSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.data.sessions[tokenKey(token)] = {
        userId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_DAYS * 864e5).toISOString(),
    };
    db.save();
    res.setHeader('Set-Cookie', cookieString(token, SESSION_DAYS * 86400, res.req));
}

function destroySession(req, res) {
    const token = readCookie(req);
    if (token) {
        delete db.data.sessions[tokenKey(token)];
        db.save();
    }
    res.setHeader('Set-Cookie', cookieString('', 0, req));
}

function destroyUserSessions(userId) {
    for (const [k, s] of Object.entries(db.data.sessions)) if (s.userId === userId) delete db.data.sessions[k];
    db.save();
}

function cookieString(value, maxAge, req) {
    const secure = req && (req.secure || req.headers['x-forwarded-proto'] === 'https');
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function readCookie(req) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === COOKIE) return v.join('=');
    }
    return null;
}

function userFromRequest(req) {
    const token = readCookie(req);
    if (!token) return null;
    const key = tokenKey(token);
    const s = db.data.sessions[key];
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
        delete db.data.sessions[key];
        db.save();
        return null;
    }
    const user = db.data.users[s.userId];
    if (!user || user.banned || user.deleted) return null;
    return user;
}

// Express middleware: attaches req.user (or null).
function attachUser(req, res, next) {
    req.user = userFromRequest(req);
    if (req.user) {
        const now = Date.now();
        if (!req.user.lastSeenAt || now - new Date(req.user.lastSeenAt).getTime() > 60_000) {
            req.user.lastSeenAt = new Date(now).toISOString();
            db.save();
        }
    }
    next();
}

// Mutating requests must be JSON with our header: browsers can't send that
// cross-site without a CORS preflight, which we never approve. That is our CSRF guard.
function csrfGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.headers['x-requested-with'] !== 'ftap') {
        return res.status(403).json({ error: 'Missing request header' });
    }
    next();
}

function hasRole(user, role) {
    return Boolean(user) && (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK[role];
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please log in first' });
    next();
}

const requireRole = role => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in first' });
    if (!hasRole(req.user, role)) return res.status(403).json({ error: 'You do not have permission for that' });
    next();
};

module.exports = {
    hashPassword,
    verifyPassword,
    createSession,
    destroySession,
    destroyUserSessions,
    userFromRequest,
    attachUser,
    csrfGuard,
    hasRole,
    requireAuth,
    requireRole,
};

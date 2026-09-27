require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const rt = require('./realtime');
const discord = require('./discord');
const T = require('./tournaments');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        next();
    });

    app.use('/api', express.json({ limit: '100kb' }), auth.attachUser, auth.csrfGuard);
    app.get('/api/stream', (req, res) => rt.connect(req, res));
    app.use('/api', require('./routes/auth'));
    app.use('/api', require('./routes/social'));
    app.use('/api', require('./routes/competition'));
    app.use('/api', require('./routes/admin'));
    app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
    app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

    app.use(express.static(PUBLIC, {
        setHeaders(res, file) {
            // HTML always fresh; assets can be cached briefly (they are small and change on deploy).
            res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
        },
    }));
    // Single-page app: every other path renders the shell.
    app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
    return app;
}

// Let friends know when someone comes online / goes offline.
rt.onPresence((userId, online) => {
    const u = db.data.users[userId];
    if (u) rt.toUsers(u.friends, 'presence', { userId, online });
});

async function boot() {
    const hadLocal = db.load();
    if (!hadLocal && discord.backupEnabled()) {
        try {
            const restored = await discord.downloadLatestBackup();
            if (restored) {
                db.loadFromObject(restored);
                db.save();
                console.log('[boot] restored database from Discord backup');
            }
        } catch (e) {
            console.error('[boot] could not restore Discord backup:', e.message);
        }
    }

    if (discord.isDemo()) console.log('[boot] demo database — Discord backups and announcements are switched off');
    const app = createApp();
    const server = app.listen(PORT, () => console.log(`FTAP Arena running on http://localhost:${PORT}`));

    setInterval(() => T.tick(), 5000).unref();
    T.tick();

    // Off-site backup every few minutes when something changed.
    let changedSinceBackup = false;
    db.onFlush(() => { changedSinceBackup = true; });
    const backupEvery = Number(process.env.BACKUP_INTERVAL_MINUTES || 5) * 60_000;
    if (discord.backupEnabled()) {
        setInterval(async () => {
            if (!changedSinceBackup) return;
            changedSinceBackup = false;
            try { await discord.uploadBackup(db.data); } catch (e) { changedSinceBackup = true; console.error('[backup]', e.message); }
        }, backupEvery).unref();
    }

    let closing = false;
    const shutdown = async signal => {
        if (closing) return;
        closing = true;
        console.log(`[shutdown] ${signal}`);
        try { db.flush(); } catch (e) { console.error(e); }
        if (discord.backupEnabled() && changedSinceBackup) {
            await Promise.race([discord.uploadBackup(db.data).catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
        }
        server.close();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) boot();

module.exports = { createApp, boot };

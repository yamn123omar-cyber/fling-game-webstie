const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ftap-discord-'));
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_BACKUP_CHANNEL_ID = '123';
process.env.DISCORD_RESULTS_CHANNEL_ID = '456';

const db = require('../server/db');
const discord = require('../server/discord');

test('demo databases never touch Discord', async () => {
    db.load();
    let calls = 0;
    const realFetch = global.fetch;
    global.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
    try {
        assert.strictEqual(discord.backupEnabled(), true, 'real data is backed up');
        db.data.meta.demo = true;
        assert.strictEqual(discord.backupEnabled(), false);
        assert.strictEqual(await discord.uploadBackup(db.data), false);
        discord.announce('should not be sent');
        await new Promise(r => setTimeout(r, 10));
        assert.strictEqual(calls, 0);
    } finally {
        global.fetch = realFetch;
    }
});

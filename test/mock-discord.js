// A tiny in-memory stand-in for the parts of Discord's REST API the site uses.
const express = require('express');

function createMockDiscord() {
    const app = express();
    const guildId = 'g1';
    const botId = 'bot1';
    let seq = 100;
    const nid = () => String(++seq);
    const channels = new Map(); // id → channel
    const messages = new Map(); // channelId → [message]
    const files = new Map();    // id → Buffer
    let base = '';

    function addChannel(fields) {
        const c = { id: nid(), guild_id: guildId, type: 0, parent_id: null, permission_overwrites: [], ...fields };
        channels.set(c.id, c);
        messages.set(c.id, []);
        return c;
    }
    function addMessage(channelId, { content = '', file = null }) {
        const m = { id: nid(), channel_id: channelId, content, author: { id: botId, bot: true }, attachments: [], timestamp: new Date().toISOString() };
        if (file) {
            const fid = nid();
            files.set(fid, file.body);
            m.attachments.push({ id: fid, filename: file.name, size: file.body.length, url: `${base}/files/${fid}` });
        }
        messages.get(channelId).unshift(m); // Discord returns newest first
        return m;
    }

    app.use((req, res, next) => {
        if (!req.path.startsWith('/files/') && req.headers.authorization !== 'Bot test-token') return res.status(401).json({ message: 'Unauthorized' });
        next();
    });
    app.use(express.json());
    app.use((req, res, next) => {
        if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
            const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData();
            req.form = form;
            next();
        });
    });

    app.get('/users/@me', (req, res) => res.json({ id: botId, username: 'FTAP Bot', bot: true }));
    app.get('/guilds/:g/channels', (req, res) => res.json([...channels.values()]));
    app.post('/guilds/:g/channels', (req, res) => res.json(addChannel(req.body)));
    app.delete('/channels/:id', (req, res) => {
        if (!channels.has(req.params.id)) return res.status(404).json({ message: 'Unknown Channel' });
        channels.delete(req.params.id);
        messages.delete(req.params.id);
        res.json({});
    });
    app.get('/channels/:id/messages', (req, res) => {
        if (!messages.has(req.params.id)) return res.status(404).json({ message: 'Unknown Channel' });
        res.json(messages.get(req.params.id).slice(0, Number(req.query.limit || 50)));
    });
    app.post('/channels/:id/messages', async (req, res) => {
        if (!messages.has(req.params.id)) return res.status(404).json({ message: 'Unknown Channel' });
        if (req.form) {
            const f = req.form.get('files[0]');
            const file = f ? { name: f.name, body: Buffer.from(await f.arrayBuffer()) } : null;
            return res.json(addMessage(req.params.id, { content: req.form.get('content') || '', file }));
        }
        res.json(addMessage(req.params.id, { content: req.body.content }));
    });
    app.patch('/channels/:id/messages/:mid', (req, res) => {
        const m = (messages.get(req.params.id) || []).find(x => x.id === req.params.mid);
        if (!m) return res.status(404).json({ message: 'Unknown Message' });
        m.content = req.body.content;
        res.json(m);
    });
    app.delete('/channels/:id/messages/:mid', (req, res) => {
        const list = messages.get(req.params.id) || [];
        const i = list.findIndex(x => x.id === req.params.mid);
        if (i >= 0) list.splice(i, 1);
        res.status(204).end();
    });
    app.get('/files/:id', (req, res) => {
        const f = files.get(req.params.id);
        if (!f) return res.status(404).end();
        res.end(f);
    });

    return {
        app, guildId, botId, channels, messages, addChannel, addMessage,
        setBase(url) { base = url; },
        byName: name => [...channels.values()].find(c => c.name === name),
    };
}

module.exports = { createMockDiscord };

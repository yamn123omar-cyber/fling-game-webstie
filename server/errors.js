class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Wrap an async route so thrown HttpErrors become JSON responses.
const route = fn => async (req, res) => {
    try {
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
        if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
        console.error('[api]', req.method, req.originalUrl, e);
        res.status(500).json({ error: 'Something went wrong on our side' });
    }
};

const bad = msg => new HttpError(400, msg);

module.exports = { HttpError, route, bad };

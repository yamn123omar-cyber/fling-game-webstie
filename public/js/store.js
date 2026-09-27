// Session state + the live event stream.
import { get } from './api.js';

const listeners = new Map(); // event -> Set(fn)

export const store = {
    me: null,
    counts: { notifications: 0, chat: 0, friendRequests: 0, teamInvites: 0 },
    myMatches: [],
    online: new Set(),
    connected: false,

    on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event).delete(fn);
    },
    emit(event, data) {
        for (const fn of listeners.get(event) || []) {
            try { fn(data); } catch (e) { console.error(e); }
        }
    },

    setSession(res) {
        const was = this.me && this.me.id;
        this.me = res && res.user ? res.user : null;
        this.counts = (res && res.counts) || { notifications: 0, chat: 0, friendRequests: 0, teamInvites: 0 };
        const changed = (this.me && this.me.id) !== was || !this._init;
        this._init = true;
        this.emit('me', this.me);
        this.emit('counts', this.counts);
        if (changed) {
            this.emit('session', this.me);
            connectStream();
            this.refreshMatches();
        }
    },

    async refreshMe() {
        try {
            const res = await get('/me');
            this.setSession(res);
        } catch { /* offline; keep old state */ }
    },

    async refreshMatches() {
        if (!this.me) { this.myMatches = []; this.emit('mymatches', []); return; }
        try {
            const res = await get('/me/matches');
            this.myMatches = res.matches;
            this.emit('mymatches', res.matches);
        } catch { /* ignore */ }
    },

    isStaff() { return Boolean(this.me && (this.me.role === 'ref' || this.me.role === 'admin')); },
    isAdmin() { return Boolean(this.me && this.me.role === 'admin'); },
};

let source = null;
let countsTimer = null;
const refreshCounts = () => {
    clearTimeout(countsTimer);
    countsTimer = setTimeout(() => store.refreshMe(), 400);
};

function connectStream() {
    if (source) source.close();
    source = new EventSource('/api/stream');
    source.onopen = () => {
        const reconnected = store.connected === false && store._everConnected;
        store.connected = true;
        store._everConnected = true;
        store.emit('connection', true);
        if (reconnected) store.emit('reconnect', true);
    };
    source.onerror = () => {
        store.connected = false;
        store.emit('connection', false);
    };
    for (const ev of ['message', 'match', 'tournament', 'notification', 'presence', 'friends', 'teams', 'refqueue']) {
        source.addEventListener(ev, e => {
            let data = null;
            try { data = JSON.parse(e.data); } catch { return; }
            if (ev === 'presence') {
                if (data.online) store.online.add(data.userId); else store.online.delete(data.userId);
            }
            if (ev === 'notification') {
                store.counts.notifications += 1;
                store.emit('counts', store.counts);
            }
            if (ev === 'message' && store.me && data.message.userId !== store.me.id) refreshCounts();
            if (ev === 'friends' || ev === 'teams') refreshCounts();
            if (ev === 'match' && store.me) {
                clearTimeout(store._mt);
                store._mt = setTimeout(() => store.refreshMatches(), 500);
            }
            store.emit(ev, data);
        });
    }
}

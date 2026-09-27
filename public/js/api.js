export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'X-Requested-With': 'ftap' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
        res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    } catch {
        throw new ApiError("Can't reach the server — check your connection", 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
    return data;
}

export const get = path => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
export const del = (path, body) => api(path, { method: 'DELETE', body });

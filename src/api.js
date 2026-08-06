const AK = 'nv_actor_id';

export const actorId = () => localStorage.getItem(AK) || '';
export const setActor = (id) => id ? localStorage.setItem(AK, id) : localStorage.removeItem(AK);

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Actor-Id': actorId() },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || ('Lỗi máy chủ (' + res.status + ')'));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });

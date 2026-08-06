import { get, post, setActor, actorId } from './api.js';

export const state = {
  me: null,
  users: [],
  config: {},
  unread: 0,
};

export async function boot() {
  const d = await get('/bootstrap');
  state.users = d.users || [];
  state.me = d.me || null;
  state.config = d.config || {};
  state.unread = d.unread || 0;
  return state;
}

export async function login(userId) {
  const d = await post('/session', { userId });
  setActor(d.me.id);
  state.me = d.me;
  await boot();
  return state.me;
}

export function logout() {
  setActor('');
  state.me = null;
}

export const isLead = () => !!state.me && (state.me.role === 'manager' || state.me.role === 'admin');
export const isAdmin = () => state.me?.role === 'admin';
export const userName = (id) => (state.users.find(u => u.id === id) || {}).name || '—';
export const salesUsers = () => state.users.filter(u => u.role === 'sales');
export { actorId };

import { state } from './state.js';

/**
 * Phân quyền phía giao diện — chỉ để ẨN những gì tài khoản không được dùng. Máy chủ mới là nơi chặn
 * thật (server/lib/perm.js); dữ liệu ở đây lấy từ /bootstrap (state.settings.perm).
 */
const ROUTE_FEAT = {
  pipeline: 'pipeline', crm: 'crm', prospect: 'prospect', plans: 'plans', saleskit: 'saleskit', tasks: 'tasks',
  training: 'training', 'lo-trinh': 'training', reports: 'reports', kpi: 'kpi', ai: 'ai', admin: 'accounts',
};
const OP_INDEX = { view: 0, add: 1, edit: 2, del: 3, download: 4 };

/** Route này có hiện trong menu của tài khoản đang đăng nhập không. */
export function featAllowed(route) {
  const me = state.me;
  if (!me || me.role === 'admin') return true;
  if (route === 'ai' && state.settings.ai && state.settings.ai.on === false) return false;
  const f = ROUTE_FEAT[route];
  if (!f) return true;
  const p = state.settings.perm;
  if (!p) return true;
  return p.feat?.[f] !== false && (p.ops?.[f]?.[0] ?? 1) !== 0;
}

/** Thao tác (view | add | edit | del | download) trên tính năng `f` có được phép không. */
export function canOp(f, op) {
  const me = state.me;
  if (!me || me.role === 'admin') return true;
  const p = state.settings.perm;
  if (!p) return true;
  if (p.feat?.[f] === false) return false;
  const ops = p.ops?.[f];
  return !ops || (!!ops[0] && !!ops[OP_INDEX[op] ?? 0]);
}

import { migrate } from './server/lib/db.js';
import { json, HttpError } from './server/lib/util.js';
import { coreRoutes } from './server/routes/core.js';
import { crmRoutes } from './server/routes/crm.js';
import { dealRoutes } from './server/routes/deals.js';
import { workRoutes } from './server/routes/work.js';
import { miscRoutes } from './server/routes/misc.js';
import { documentRoutes } from './server/routes/documents.js';
import { resolveActor } from './server/lib/auth.js';

const ROUTERS = [coreRoutes, crmRoutes, dealRoutes, workRoutes, miscRoutes, documentRoutes];
export const SCHEMA_NS = 'nv_'; // bảng của app dùng tiền tố nv_ (tách khỏi schema cũ)

export async function handle(request, env) {
  await migrate(env);
  const url = new URL(request.url);
  const ctx = { request, env, url, me: await resolveActor(request, env) };
  try {
    for (const r of ROUTERS) {
      const res = await r(ctx);
      if (res) return res;
    }
    return json({ error: 'Không tìm thấy API: ' + url.pathname }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('API error', url.pathname, e && e.stack ? e.stack : e);
    return json({ error: 'Đã có lỗi xảy ra, vui lòng thử lại' }, 500);
  }
}

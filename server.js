import { migrate } from './server/lib/db.js';
import { json, HttpError } from './server/lib/util.js';
import { coreRoutes } from './server/routes/core.js';
import { crmRoutes } from './server/routes/crm.js';
import { dealRoutes } from './server/routes/deals.js';
import { workRoutes } from './server/routes/work.js';
import { miscRoutes } from './server/routes/misc.js';
import { documentRoutes } from './server/routes/documents.js';
import { planRoutes } from './server/routes/plans.js';
import { gatewayRoutes, apiKeyRoutes } from './server/routes/gateway.js';
import { resolveActor } from './server/lib/auth.js';

const ROUTERS = [coreRoutes, crmRoutes, dealRoutes, workRoutes, miscRoutes, documentRoutes, planRoutes, apiKeyRoutes];
export const SCHEMA_NS = 'nv_'; // bảng của app dùng tiền tố nv_ (tách khỏi schema cũ)

/** Chạy lần lượt các router cho tới khi có router trả Response. Tách hàm để cổng API (/api/v1/*)
 * dùng lại được ĐÚNG bộ router này sau khi đã viết lại đường dẫn và danh tính. */
async function runRouters(ctx) {
  for (const r of ROUTERS) {
    const res = await r(ctx);
    if (res) return res;
  }
  return null;
}

export async function handle(request, env) {
  await migrate(env);
  const url = new URL(request.url);
  const ctx = { request, env, url, me: await resolveActor(request, env) };
  try {
    // Cổng API chạy TRƯỚC: /api/v1/* xác thực bằng khoá API chứ không bằng phiên đăng nhập, nên
    // không được để các router thường nhìn thấy request đó với me=null rồi trả 401 sai lý do.
    const viaKey = await gatewayRoutes(ctx, runRouters);
    if (viaKey) return viaKey;
    const res = await runRouters(ctx);
    if (res) return res;
    return json({ error: 'Không tìm thấy API: ' + url.pathname }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('API error', url.pathname, e && e.stack ? e.stack : e);
    return json({ error: 'Đã có lỗi xảy ra, vui lòng thử lại' }, 500);
  }
}

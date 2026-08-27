import { json, match, need, uid, now, readBody, scope, audit, str } from '../lib/util.js';
import { askAI } from '../lib/ai.js';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB — đủ cho PDF/ảnh báo giá & hợp đồng, tránh payload JSON (base64) quá lớn
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/** Tra báo giá/hợp đồng theo đúng quyền xem của actor (không tin id client gửi lên) — dùng chung
 * cho cả POST (kiểm tra trước khi upload) lẫn GET (liệt kê tài liệu của đúng bản ghi đó). */
async function findParent(ctx, quoteId, contractId) {
  const s = scope(ctx, 'owner_id');
  if (quoteId) return { col: 'quote_id', id: quoteId, row: await ctx.env.DB.prepare(`SELECT id,title FROM nv_quotes WHERE id=?${s.sql}`).bind(String(quoteId), ...s.args).first() };
  return { col: 'contract_id', id: contractId, row: await ctx.env.DB.prepare(`SELECT id,title FROM nv_contracts WHERE id=?${s.sql}`).bind(String(contractId), ...s.args).first() };
}

export async function documentRoutes(ctx) {
  const { env, url } = ctx;
  let p;

  /* ================= Tài liệu đính kèm (báo giá/hợp đồng) — upload + AI đọc & phân tích ================= */
  if ((p = match(ctx, 'GET', '/api/documents'))) {
    need(ctx);
    const quoteId = url.searchParams.get('quoteId');
    const contractId = url.searchParams.get('contractId');
    if (!quoteId && !contractId) return json({ error: 'Thiếu quoteId hoặc contractId' }, 400);
    const { col, id, row } = await findParent(ctx, quoteId, contractId);
    if (!row) return json({ error: col === 'quote_id' ? 'Không tìm thấy báo giá' : 'Không tìm thấy hợp đồng' }, 404);
    const { results } = await env.DB.prepare(
      `SELECT id,filename,mime,size,ai_summary,ai_provider,ai_model,status,created_at FROM nv_documents WHERE ${col}=? ORDER BY created_at DESC`)
      .bind(id).all();
    return json({ items: results || [] });
  }

  if ((p = match(ctx, 'POST', '/api/documents'))) {
    need(ctx);
    const b = await readBody(ctx.request);
    if (!b.quoteId && !b.contractId) return json({ error: 'Thiếu báo giá hoặc hợp đồng để đính kèm' }, 400);
    const mime = str(b.mime, 100) || '';
    if (!ALLOWED_MIME.includes(mime)) return json({ error: 'Chỉ hỗ trợ file PDF hoặc ảnh (PNG/JPG/WEBP)' }, 400);
    const filename = str(b.filename, 200) || 'tai-lieu';
    const base64 = String(b.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return json({ error: 'Thiếu nội dung file' }, 400);
    let bytes;
    try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch (e) { return json({ error: 'Nội dung file không hợp lệ' }, 400); }
    if (bytes.byteLength > MAX_BYTES) return json({ error: 'File vượt quá 8MB' }, 400);

    const { col, id: parentId, row: parent } = await findParent(ctx, b.quoteId, b.contractId);
    if (!parent) return json({ error: col === 'quote_id' ? 'Không tìm thấy báo giá' : 'Không tìm thấy hợp đồng' }, 404);

    const id = uid('doc');
    const key = `documents/${id}`;
    await env.DOCS.put(key, bytes, { httpMetadata: { contentType: mime } });

    const { results: products } = await env.DB.prepare(
      'SELECT id,name,line,unit,price,commission_rate,max_discount,description FROM nv_products WHERE active=1').all();
    const res = await askAI(env, {
      kind: 'document', prompt: str(b.note, 500) || '',
      context: { products: products || [], userName: ctx.me.name, customerName: null, extra: parent.title },
      provider: b.provider,
      document: { mime, data: base64 },
    });

    const t = now();
    await env.DB.prepare(
      `INSERT INTO nv_documents (id,quote_id,contract_id,owner_id,filename,mime,size,r2_key,ai_summary,ai_provider,ai_model,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, b.quoteId ? String(b.quoteId) : null, b.contractId ? String(b.contractId) : null, ctx.me.id,
        filename, mime, bytes.byteLength, key, res.text.slice(0, 4000), res.provider, res.model, res.mock ? 'mock' : 'done', t).run();

    await audit(env, ctx.me.id, 'upload_document', col === 'quote_id' ? 'quote' : 'contract', String(parentId), { filename });
    return json({ id, filename, aiText: res.text, provider: res.provider, providerLabel: res.providerLabel, model: res.model, notice: res.notice });
  }

  if ((p = match(ctx, 'GET', '/api/documents/:id/file'))) {
    need(ctx);
    const s = scope(ctx, 'owner_id');
    const doc = await env.DB.prepare(`SELECT * FROM nv_documents WHERE id=?${s.sql}`).bind(p.id, ...s.args).first();
    if (!doc) return json({ error: 'Không tìm thấy tài liệu' }, 404);
    const obj = await env.DOCS.get(doc.r2_key);
    if (!obj) return json({ error: 'File không còn tồn tại trên kho lưu trữ' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': doc.mime, 'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"` } });
  }

  return null;
}

// Gom front-end tĩnh vào ./public để Wrangler phục vụ.
// Dùng symlink nên sửa file trong src/ hoặc styles/ là refresh trình duyệt thấy ngay,
// không cần chạy lại lệnh này.
import { mkdir, rm, symlink, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

// wrangler dev CHỈ đọc biến môi trường từ file .dev.vars, không tự nhận biến
// `KEY=value npm run dev` đặt trên shell. Đồng bộ hộ vài biến hay dùng để test nhanh
// (đổi APP_MODE / tài khoản admin khởi tạo) mà không phải tự tay sửa .dev.vars mỗi lần —
// chỉ ghi đè đúng những khoá có mặt trong process.env, giữ nguyên các dòng khác (vd API key).
await syncDevVars(['APP_MODE', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD']);

async function syncDevVars(whitelist) {
  const toSync = whitelist.filter((k) => process.env[k] !== undefined);
  if (!toSync.length) return;
  const devVarsPath = join(root, '.dev.vars');
  let content = '';
  try { content = await readFile(devVarsPath, 'utf8'); } catch (e) { /* chưa có .dev.vars — tạo mới */ }
  for (const key of toSync) {
    const line = `${key}=${process.env[key]}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, line) : content.replace(/\n?$/, '\n') + line + '\n';
  }
  await writeFile(devVarsPath, content, 'utf8');
  console.log(`[sync-assets] Đã đồng bộ vào .dev.vars: ${toSync.join(', ')}`);
}

await rm(pub, { recursive: true, force: true });
await mkdir(pub, { recursive: true });

// index.html copy (file lẻ, ít khi sửa)
await copyFile(join(root, 'index.html'), join(pub, 'index.html'));

// Local: symlink để sửa file trong src/ hoặc styles/ là refresh trình duyệt thấy ngay.
// CI: COPY thật. Symlink sinh ra ở đây là đường dẫn TUYỆT ĐỐI (vd /opt/buildhome/repo/src),
// chỉ đúng trong đúng container đã tạo ra nó — copy thì artifact tự đứng được, không phụ
// thuộc việc Cloudflare build và deploy có chạy chung một container hay không.
const useCopy = process.argv.includes('--copy') || process.env.CI === 'true';
for (const dir of ['src', 'styles']) {
  const target = join(root, dir);
  if (!existsSync(target)) {
    console.error(`[sync-assets] thiếu thư mục ${dir}/ — bỏ qua`);
    continue;
  }
  if (useCopy) await cp(target, join(pub, dir), { recursive: true });
  else await symlink(target, join(pub, dir), 'dir');
}

console.log(`[sync-assets] public/ sẵn sàng (index.html + src/ + styles/) — chế độ ${useCopy ? 'copy' : 'symlink'}`);

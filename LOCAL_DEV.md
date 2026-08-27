# Chạy NetViet Sales OS ở local

Repo gốc chỉ chứa source cho nền tảng **Nexrall (Cloudflare Worker)** — không có
`package.json`, nên `npm install` / `npm run dev` sẽ báo lỗi khi vừa clone về.
Thư mục này bổ sung lớp cấu hình để chạy được trên máy.

## Chạy

```bash
npm install
npm run dev
```

Mở http://localhost:8787 → chọn 1 tài khoản demo để đăng nhập.

Lần chạy đầu, D1 tự tạo 21 bảng `nv_*` và nạp dữ liệu mẫu.

## Các lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Sync assets rồi chạy Wrangler ở `localhost:8787` |
| `npm run assets` | Dựng lại `public/` (chỉ cần khi thêm/xoá file trong `src/`, `styles/`) |
| `npm run reset-db` | Xoá D1 local, lần chạy sau seed lại từ đầu |
| `npm run clean` | Xoá `public/` và `.wrangler/` |

Sửa file trong `src/` hoặc `styles/` thì chỉ cần **refresh trình duyệt** —
`public/` trỏ symlink về thư mục gốc nên không phải chạy lại `npm run assets`.

## Cấu trúc thêm vào (không đụng code app)

| File | Vai trò |
|---|---|
| `package.json` | Scripts + `wrangler` (devDependency) |
| `wrangler.toml` | Khai báo binding `DB` (D1) và `SHARED_KV` (KV) ở chế độ local |
| `local/entry.js` | Vỏ bọc: Worker cần `export default { fetch }`, còn `server.js` chỉ export `handle(request, env)` |
| `local/sync-assets.mjs` | Gom `index.html` + `src/` + `styles/` vào `public/` cho Wrangler phục vụ |
| `.dev.vars.example` | Mẫu khai báo API key |
| `.vscode/` | Task chạy dev server, cấu hình debug Chrome |

`server.js` và toàn bộ `server/`, `src/`, `styles/` **giữ nguyên** như trên GitHub,
nên bản local chạy đúng như bản deploy trên Nexrall.

## API key cho AI (tuỳ chọn)

```bash
cp .dev.vars.example .dev.vars
```

Điền `GEMINI_API_KEY` và/hoặc `ANTHROPIC_API_KEY` rồi chạy lại `npm run dev`.
Không có key thì app vẫn chạy đầy đủ bằng AI mẫu offline.

## APP_MODE — demo vs production

`APP_MODE` quyết định CSDL lần chạy đầu (khi `nv_users` rỗng) được nạp dữ liệu **demo** đầy đủ
hay chỉ khởi tạo **đúng 1 tài khoản admin** cho production. Không khai báo → mặc định
`production` (an toàn: quên cấu hình thì không tự sinh dữ liệu giả).

Cách đặt ở local — 2 lựa chọn tương đương:

1. Sửa `APP_MODE=` trong `.dev.vars` (bền, giữ nguyên cho các lần `npm run dev` sau).
2. Đặt biến môi trường ngay trên lệnh chạy — `npm run assets` (chạy trước `wrangler dev` trong
   `npm run dev`) sẽ tự đồng bộ các biến `APP_MODE` / `BOOTSTRAP_ADMIN_EMAIL` /
   `BOOTSTRAP_ADMIN_PASSWORD` có mặt trong shell vào `.dev.vars` — vì bản thân `wrangler dev`
   chỉ đọc được biến từ file `.dev.vars`, không tự nhận biến đặt trước lệnh:

```bash
# Chạy như production thật, tự khởi tạo 1 tài khoản admin từ secret
npm run reset-db
APP_MODE=production BOOTSTRAP_ADMIN_EMAIL=admin@vidu.vn BOOTSTRAP_ADMIN_PASSWORD='MatKhauManh123!' npm run dev

# Quay lại demo đầy đủ dữ liệu mẫu
npm run reset-db
APP_MODE=demo npm run dev
```

Lưu ý: cách 2 GHI ĐÈ vào `.dev.vars` (chỉ đè đúng các khoá được truyền, giữ nguyên `GEMINI_API_KEY`…
nếu có) — lần `npm run dev` kế tiếp không truyền biến sẽ giữ nguyên giá trị đã ghi lần trước, không
tự quay về mặc định. Muốn chắc chắn về `production`, xoá dòng `APP_MODE` khỏi `.dev.vars` hoặc đặt
lại `APP_MODE=production` tường minh.

## Deploy thật (Nexrall)

Nexrall không đọc `.dev.vars` — khai báo qua mục **Secrets** của app:

| Bản deploy | Secrets cần đặt |
|---|---|
| Demo (giới thiệu/dùng thử) | `APP_MODE=demo` |
| Production (dữ liệu KPI/hoa hồng thật) | `APP_MODE=production`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (chỉ có tác dụng ở lần chạy đầu khi `nv_users` rỗng — sau khi tài khoản admin đã được tạo, xoá 2 secret này khỏi Nexrall để mật khẩu khởi tạo không còn lưu lại nơi nào ngoài trí nhớ người vận hành) |

Sau khi admin đầu tiên đăng nhập lần đầu, hệ thống buộc đổi mật khẩu ngay (không cho dùng tiếp
mật khẩu khởi tạo) rồi mới cấp tài khoản khác qua mục Quản trị → Người dùng.

## VS Code

```bash
code /Users/phamhoanganh/nexrall-netviet-sales-os
```

- `Cmd+Shift+B` → chạy dev server
- Tab **Run and Debug** → *Mở app trong Chrome (localhost:8787)* — tự chạy server rồi mở trình duyệt kèm debugger

## Lưu ý

Local dùng D1 mô phỏng trong `.wrangler/state`, không cần tài khoản Cloudflare
và không đụng tới dữ liệu thật trên Nexrall.

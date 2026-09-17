# NetViet Sales OS

App quản lý hoạt động & kết quả kinh doanh hàng ngày của đội Sales NetViet (TVC/Video AI · Booking Gameshow · Xây kênh triệu view).

## Chạy app
App chạy trên Cloudflare Worker của Nexrall — không cần cài đặt: mở link app là dùng ngay.

Hành vi lần chạy đầu (CSDL rỗng) phụ thuộc secret **`APP_MODE`**:

| `APP_MODE` | Lần chạy đầu |
|---|---|
| `demo` | Tự nạp 5 tài khoản demo + dữ liệu mẫu (khách hàng, deal, hoa hồng, báo cáo…) |
| `production` (hoặc không đặt — mặc định an toàn) | KHÔNG nạp dữ liệu giả. Chỉ khởi tạo đúng 1 tài khoản admin từ secret `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` (thiếu 1 trong 2 thì không tạo gì, màn đăng nhập báo "Hệ thống chưa được khởi tạo"). Tài khoản admin này bị buộc đổi mật khẩu ngay lần đăng nhập đầu tiên. |

**Bản dùng thật để chấm KPI/hoa hồng luôn phải đặt `APP_MODE=production`** — dữ liệu demo không
được phép lẫn vào doanh thu, leaderboard hay báo cáo thật. Xem thêm [LOCAL_DEV.md](LOCAL_DEV.md#deploy-thật-nexrall).

## Cài lên màn hình chính điện thoại (PWA)
App là một **Progressive Web App**: cài được thẳng từ trình duyệt, **không cần App Store /
Google Play**, không có bản mobile riêng — vẫn đúng một front-end, một backend, một CSDL.

**iPhone (Safari):** mở link app → nút **Chia sẻ** → **Thêm vào MH chính** → tên hiện sẵn là
**NetViet Sales** → **Thêm**. (Trong app, mục **Thêm → Tài khoản** cũng có hướng dẫn này; trên Android
mục đó có nút **Cài ứng dụng** — cả hai tự ẩn khi app đã chạy ở chế độ cài đặt.) Chạm icon để mở app ở chế độ toàn màn hình (không có thanh
địa chỉ Safari). *Lưu ý: phải là Safari — Chrome/Firefox trên iOS không có mục này.*

**Android (Chrome):** menu ⋮ → **Cài đặt ứng dụng / Thêm vào màn hình chính**.

Đăng nhập, phân quyền và dữ liệu **giống hệt bản web**: sửa ở máy tính thì mở app trên điện
thoại thấy ngay và ngược lại. Mất mạng thì app vẫn mở được vỏ giao diện nhưng **không hiển thị
dữ liệu cũ** — báo "Không thể kết nối máy chủ" để không ai đọc nhầm số liệu lỗi thời.

Tài nguyên PWA nằm ở [static/](static/): `manifest.webmanifest`, `sw.js` (service worker) và
`icons/`. Icon sinh từ logo chính thức bằng `node local/gen-pwa-icons.mjs` — chỉ chạy lại khi
logo đổi. `npm run build` tự copy `static/` ra `public/`.

## Thông báo đẩy Web Push

Người dùng tự bật/tắt thông báo tại **Tài khoản**; iPhone/iPad phải mở bản PWA đã cài lên Màn hình
chính. Cần đặt ba biến môi trường trước khi bật tính năng:

| Biến | Nơi đặt | Mô tả |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `.dev.vars` và Worker secret/biến môi trường | Khoá công khai base64url P-256, được gửi cho trình duyệt. |
| `VAPID_PRIVATE_KEY` | Chỉ `.dev.vars` local hoặc Worker secret | Khoá riêng base64url P-256 tương ứng; không commit hoặc đưa vào frontend. |
| `VAPID_SUBJECT` | `.dev.vars` và Worker secret/biến môi trường | `mailto:...` hoặc URL HTTPS của đơn vị vận hành. |

Tạo cặp khoá (Node 20+, không cần cài thêm gói; lệnh in ra 2 dòng — chỉ dán vào secrets, không commit):

```bash
node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(async k=>{console.log('VAPID_PUBLIC_KEY='+Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+(await crypto.subtle.exportKey('jwk',k.privateKey)).d)})"
```

Đặt lên Worker production (chạy trên đúng tài khoản Cloudflare đang chứa Worker):

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Máy chủ kiểm tra cả định dạng khoá: khoá công khai phải là P-256 raw 65 byte, khoá riêng 32 byte, đều
base64url. Sai định dạng thì `GET /api/push/status` trả `configured: false` kèm `configError` nêu biến
bị sai (không bao giờ chứa giá trị khoá). Không thay cặp khoá sau khi người dùng đã đăng ký nếu chưa có
kế hoạch yêu cầu họ đăng ký lại (thiết bị tự đăng ký lại bằng khoá mới khi bấm "Bật thông báo").

Máy chủ tự loại subscription hết hạn (HTTP 404/410); một người dùng có thể có nhiều thiết bị cùng nhận
thông báo. Đăng xuất sẽ gỡ đăng ký của chính thiết bị đó. Kiểm tra nhanh sau khi đăng nhập: Tài khoản →
Thông báo đẩy → **Bật thông báo** → **Gửi thử** (gọi `POST /api/push/test`, chỉ gửi tới thiết bị của
chính tài khoản đang đăng nhập).

## Tài khoản trên bản đang chạy tại Nexrall
CSDL của bản deploy này đã có sẵn 5 tài khoản (nhân sự + dữ liệu nghiệp vụ mẫu đầy đủ). Mật khẩu
tạm cho cả 5: **`NetViet@2026`** — app **buộc đổi mật khẩu ngay lần đăng nhập đầu tiên**.

| Vai trò | Đăng nhập bằng email |
|---|---|
| Admin/BGĐ | `admin@netviet.vn` |
| Trưởng phòng | `tpkd@netviet.vn` |
| Sales | `tuan.le@netviet.vn` · `anh.pham@netviet.vn` · `nam.vo@netviet.vn` |

Cấp/đặt lại mật khẩu cho người khác: Admin vào **Quản trị → Người dùng → Tạo liên kết đặt mật khẩu**
(link dùng 1 lần, hết hạn theo `SETUP_TOKEN_TTL`), gửi qua kênh nội bộ.

## Tài khoản demo (chỉ sinh ra ở CSDL RỖNG với `APP_MODE=demo`)
| Vai trò | Tài khoản (nhân vật hư cấu) |
|---|---|
| Admin/BGĐ | Nguyễn Văn A |
| Trưởng phòng | Trần Thị B |
| Sales | Lê Văn C · Phạm Thị D · Hoàng Văn E |

Sales → shell mobile (điều hướng dưới). TP/Admin → dashboard web (điều hướng bên).

## Kết nối AI thật (Gemini / Claude)
Chỉ cần nhập API key vào mục **Secrets** của app, không phải sửa code:

| Secret | Nhà cung cấp | Lấy key tại |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini | aistudio.google.com/apikey |
| `ANTHROPIC_API_KEY` | Anthropic Claude | console.anthropic.com → API Keys |
| `GEMINI_MODEL` (tuỳ chọn) | cố định model Gemini | mặc định `gemini-2.0-flash`, tự dò model khả dụng |
| `CLAUDE_MODEL` (tuỳ chọn) | cố định model Claude | mặc định `claude-sonnet-4-5`, tự dò model khả dụng |

- Ở mọi tính năng AI (Trợ lý AI, soạn email trong CRM, phân tích cơ hội thầu, research lead, soạn proposal trong Sales Kit) đều có **bộ chọn nhà cung cấp**: Tự động / Gemini / Claude / AI mẫu offline.
- Quản trị → tab **Kết nối AI**: xem trạng thái key, **Test kết nối** thật, chọn nhà cung cấp mặc định.
- Chưa nhập key → app vẫn chạy đầy đủ bằng AI mẫu (offline). Gọi API lỗi (sai key/hết quota/timeout) → tự rơi về nội dung mẫu và báo rõ lý do.

## Các tích hợp còn ở chế độ mock (chừa sẵn chỗ cắm API thật)
- Quét cơ hội đấu thầu (`/api/tenders/scan`) — dữ liệu mẫu.
- Đồng bộ call log tổng đài (`/api/activities/sync-calls`).
- Gửi Zalo/email, e-signature, kế toán — chưa nối, dùng thông báo nội bộ.

## Giới hạn của tính năng chống chụp màn hình
Trình duyệt **không** chặn được chụp màn ở tầng hệ điều hành. App chỉ có thể: che nội dung khi mất focus/chuyển tab (`visibilitychange`/`blur`), chặn menu ngữ cảnh và phím PrintScreen ở các màn nhạy cảm (bảng giá, proposal, dữ liệu khách, KPI, bài giảng, console TP), và ghi audit log mỗi lần nghi ngờ. Muốn chặn thật cần đóng gói native và bật `FLAG_SECURE` (Android) / cờ bảo vệ màn hình (iOS).

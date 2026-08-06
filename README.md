# NetViet Sales OS

App quản lý hoạt động & kết quả kinh doanh hàng ngày của đội Sales NetViet (TVC/Video AI · Booking Gameshow · Xây kênh triệu view).

## Chạy app
App chạy trên Cloudflare Worker của Nexrall — không cần cài đặt: mở link app là dùng ngay. Dữ liệu mẫu (seed) được nạp tự động ở lần chạy đầu.

## Tài khoản demo (chọn ở màn đăng nhập)
| Vai trò | Tài khoản |
|---|---|
| Admin/BGĐ | Nguyễn Quốc Bảo |
| Trưởng phòng | Trần Thu Hà |
| Sales | Lê Minh Tuấn · Phạm Ngọc Anh · Võ Hoàng Nam |

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

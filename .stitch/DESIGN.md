# Design System: NetViet Sales OS

Tài liệu trích xuất toàn bộ quy chuẩn giao diện, tokens, typography, layout và component patterns từ mã nguồn `src/` và `styles/main.css` của **NetViet Sales OS**.

---

## 1. Triết lý thiết kế & Bản sắc thị giác (Visual Identity)

* **Phong cách tổng thể**: Dark Mode nguyên bản (Zinc/Charcoal palette), độ tương phản cao, tối ưu cho cường độ làm việc liên tục của đội ngũ kinh doanh.
* **Màu sắc chủ đạo**: Đỏ thắm NetViet kết hợp Hổ phách (Amber/Gold gradient) thể hiện năng lượng, thành công và tốc độ.
* **Dual-Shell Navigation**:
  * **Sales (Mobile First)**: Thanh điều hướng đáy (`.bottom-nav`, chiều cao `64px`, kính mờ `backdrop-filter: blur(10px)`).
  * **Trưởng phòng / Admin (Desktop First)**: Sidebar trái cố định `216px`, phân chia nhóm nghiệp vụ rõ ràng (Điều hành, Kinh doanh, Đo lường, Khác).
* **Nguyên tắc "Ghi 1 lần, tự động tính"**: Mọi thẻ đo lường (KPI, Quota, Báo cáo, SLA) đều có phản hồi trực quan realtime qua Ring progress, Bar gradient và Stat cards.

---

## 2. Tokens màu sắc (Color Tokens)

Trích xuất trực tiếp từ `:root` trong [`styles/main.css`](file:///Users/phamhoanganh/nexrall-netviet-sales-os-v2/styles/main.css):

```css
:root {
  /* Nền & Viền (Surfaces & Borders) */
  --bg:      #18181B; /* Nền ứng dụng chính (Zinc 900) */
  --bg2:     #212126; /* Nền Card, Modal, Stat, Account item */
  --bg3:     #2A2A31; /* Nền Button phụ, Input, Icon badge (.dot-i) */
  --line:    #35353E; /* Viền phân cách (Borders & Dividers) */

  /* Chữ & Độ mờ (Typography & Muted) */
  --txt:     #F4F4F5; /* Chữ chính (Zinc 100 - High contrast) */
  --mut:     #A1A1AA; /* Chữ phụ, ghi chú, nhãn meta (Zinc 400) */

  /* Màu thương hiệu & Điểm nhấn (Brand Accents) */
  --red:     #B91C1C; /* Đỏ thương hiệu NetViet (Brand Primary) */
  --orange:  #F59E0B; /* Hổ phách / Vàng cam (Brand Secondary / Accent) */
  --blue:    #1D4ED8; /* Xanh dương thông tin & Pipeline stage */

  /* Màu ngữ thái (Status & Feedback) */
  --ok:      #16A34A; /* Thành công / Hoàn thành (Green) */
  --warn:    #F59E0B; /* Cảnh báo / Chờ duyệt (Amber) */
  --danger:  #DC2626; /* Nguy hiểm / Quá hạn SLA (Danger Red) */

  /* Kích thước layout cố định */
  --nav-h:   64px;    /* Chiều cao Bottom Navigation */
}
```

### Gradients thương hiệu chuẩn
* **Logo & Brand Badge**: `linear-gradient(135deg, var(--red), var(--orange))`
* **Header Topbar**: `linear-gradient(120deg, #18181B 0%, #241416 60%, #2a1a10 100%)`
* **Active Sidebar Item**: `linear-gradient(90deg, rgba(185,28,28, 0.28), rgba(245,158,11, 0.12))`
* **Primary Button**: `linear-gradient(135deg, var(--red), #DC2626)`
* **Amber / Action Button**: `linear-gradient(135deg, #D97706, var(--orange))`
* **Blue / Info Button**: `linear-gradient(135deg, var(--blue), #2563EB)`
* **Avatar Gradient**: `linear-gradient(135deg, var(--blue), #4F46E5)`
* **Login Hero Background**:
  * `radial-gradient(1000px 500px at 10% -10%, rgba(185,28,28, 0.35), transparent)`
  * `radial-gradient(800px 400px at 110% 10%, rgba(245,158,11, 0.22), transparent)`

---

## 3. Typography & Thang chữ (Type Scale)

* **Font Family**: `'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`
* **Base Line Height**: `1.45`

| Cấp bậc | Kích thước | Trọng số (Weight) | Màu sắc | Sử dụng thực tế |
|---|---|---|---|---|
| **Hero Title** | `26px` | Bold (`700` - `800`) | `var(--txt)` | Tiêu đề màn hình đăng nhập |
| **Login Card / H1** | `21px` | Bold (`800`) | `var(--txt)` | Tiêu đề khối đăng nhập |
| **Page Heading / H2** | `19px` | Bold (`700`) | `var(--txt)` | Tiêu đề view (`.page-head h2`) |
| **Stat Metric (Value)**| `19px` | Extra Bold (`800`) | `var(--txt)` | Số liệu nổi bật trong `.stat .v` |
| **Ring Metric** | `17px` | Bold (`700`) | `var(--txt)` | Điểm số trung tâm `.ring .lbl b` |
| **Modal Title / H3** | `16px` | SemiBold (`600`) | `var(--txt)` | Tiêu đề popup modal |
| **Base Body** | `15px` | Regular (`400`) | `var(--txt)` | Văn bản chung, form inputs |
| **Button / Row Title** | `13.5px` - `14px`| Bold (`700`) | `var(--txt)` | `.btn`, `.item .t`, `.kcard .n` |
| **Card Text / Bubble** | `13px` - `13.5px`| Regular (`400`) | `var(--txt)` | `.ai-bubble`, `.toast`, `.err-box` |
| **Section Title** | `12.5px` | Bold (`700`) | `var(--mut)` | `.sec-title` (uppercase, letter-spacing `0.6px`) |
| **Subtext / Meta** | `12px` | Regular (`400`) | `var(--mut)` | `.sm`, `.page-head p`, `.item .d` |
| **Chips / Badges / KPI** | `11px` | Bold (`700`) | Tùy tone | `.chip`, `.stat .l`, `.tbl th` |
| **Sidebar Section** | `10.5px` | SemiBold (`600`) | `var(--mut)` | `.sidebar .sec` (uppercase, `0.7px`) |
| **Bottom Nav Label** | `10.5px` | SemiBold (`600`) | `var(--mut)` / `var(--orange)` | Nhãn tab điều hướng Sales |
| **Ring Label** | `9.5px` | Regular (`400`) | `var(--mut)` | Nhãn dưới số trong `.ring .lbl small` |

---

## 4. Bố cục & Lưới khoảng cách (Layout & Grid System)

### Cấu trúc Shell
* **Khung chứa tối đa**: `max-width: 1240px; margin: 0 auto; width: 100%`
* **Padding nội dung**:
  * Mobile: `padding: 14px 14px calc(var(--nav-h) + 26px)`
  * Desktop (≥900px): `padding: 14px 14px 30px`
* **Sidebar**: Chiều rộng `216px`, sticky full height `100vh`, border phải `1px solid var(--line)`.
* **Breakpoint Responsive**:
  * `< 900px`: Sidebar chuyển sang cơ chế Drawer (`transform: translateX(-100%)`, z-index `50`), hiển thị overlay mờ `.side-scrim`, bật `.menu-btn`.
  * `≥ 900px`: Sidebar hiển thị cố định bên trái, ẩn `.bottom-nav` trên desktop.

### Hệ thống lưới (Grid Utilities)
* `.grid`: `display: grid; gap: 10px`
* `.g2`: `grid-template-columns: repeat(2, 1fr)`
* `.g3`: `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`
* `.g4`: `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`

### Tiện ích Flexbox & Spacing
* `.row`: `display: flex; align-items: center; gap: 8px`
* `.row.wrap`: `flex-wrap: wrap`
* `.grow`: `flex: 1`
* `.right`: `text-align: right`
* `.mt`: `margin-top: 10px`
* `.mb`: `margin-bottom: 10px`

---

## 5. Danh mục thành phần chuẩn (Component Catalog)

### 5.1. Thẻ & Khối chứa (Cards & Containers)
* **Card chuẩn (`.card`)**:
  ```css
  .card {
    background: var(--bg2);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 13px;
  }
  .card + .card { margin-top: 10px; }
  ```
* **Stat Box (`.stat`)**:
  * Cấu trúc: `.stat > .l (Label) + .v (Value) + .s (Subtext)`
  * Biến thể viền: `.stat.red` (`#7f1d1d`), `.stat.blue` (`#1e3a8a`), `.stat.amber` (`#78350f`).

### 5.2. Huy hiệu & Chip (Chips & Badges)
Được tạo qua helper `chip(text, tone)` trong [`src/ui.js`](file:///Users/phamhoanganh/nexrall-netviet-sales-os-v2/src/ui.js):
```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.chip.red   { background: rgba(185, 28, 28, 0.2);  color: #fca5a5; }
.chip.amber { background: rgba(245, 158, 11, 0.18); color: #fcd34d; }
.chip.blue  { background: rgba(29, 78, 216, 0.22);  color: #93c5fd; }
.chip.green { background: rgba(22, 163, 74, 0.2);  color: #86efac; }
.chip.grey  { background: #33333b;                  color: #a1a1aa; }
```

### 5.3. Nút bấm (Buttons)
* **Quy chuẩn chung (`.btn`)**:
  * `padding: 9px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 700; cursor: pointer;`
  * Hiệu ứng nhấn: `transform: scale(0.98)`
* **Biến thể màu sắc**:
  * `.btn.primary`: Gradient đỏ (`var(--red)` → `#DC2626`), border `#7F1D1D`.
  * `.btn.amber`: Gradient vàng hổ phách (`#D97706` → `var(--orange)`), chữ tối `#1C1917`.
  * `.btn.blue`: Gradient xanh dương (`var(--blue)` → `#2563EB`), border `#1E3A8A`.
  * `.btn.ghost`: Nền trong suốt.
* **Kích thước & Trạng thái**:
  * `.btn.sm`: `padding: 6px 10px; font-size: 12px; border-radius: 9px;`
  * `.btn.block`: `width: 100%;`
  * `[disabled]`: `opacity: 0.5; pointer-events: none;`

### 5.4. Form & Nhập liệu (Form Controls)
* **Nhãn trường (`label.f`)**: `display: block; margin-bottom: 9px;`
  * Nhãn text: `font-size: 11.5px; color: var(--mut); font-weight: 600; margin-bottom: 4px;`
* **Input, Select, Textarea**:
  * `background: #1a1a1f; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; color: var(--txt); outline: none;`
  * Focus state: `border-color: var(--orange);`
* **Trường mật khẩu (`.pw-wrap`)**: Tích hợp nút ẩn/hiện mắt (`.pw-toggle`) đặt tuyệt đối bên phải.
* **Segmented Tabs (`.seg`)**: Thanh trượt ngang chứa các pill button:
  * Nút thường: `background: var(--bg3); border: 1px solid var(--line); border-radius: 999px;`
  * Nút đang chọn (`.on`): `background: var(--red); border-color: var(--red); color: #FFF;`

### 5.5. Trực quan hóa tiến độ (Progress Metrics)
* **Thanh tiến độ (`.bar`)**:
  * Chiều cao `7px`, bo tròn `999px`, nền `#3F3F46`.
  * Mặc định: Gradient đỏ-cam (`linear-gradient(90deg, var(--red), var(--orange))`).
  * Biến thể `.bar.blue`: Gradient xanh (`var(--blue)` → `#60A5FA`).
  * Biến thể `.bar.green`: Gradient xanh lá (`#15803D` → `#4ADE80`).
* **Vòng tiến độ SVG (`.ring`)**:
  * Kích thước `84x84px`, bán kính `r=32`, đường kính viền `8px`.
  * Gradient SVG ID `#g1` chuyển màu mượt mà từ `#B91C1C` sang `#F59E0B`.
  * Tâm vòng chứa số liệu đạt được + nhãn chỉ tiêu.

### 5.6. Hàng danh sách (List Items)
* **Cấu trúc `.item`**:
  * `display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line)`
  * Icon container `.dot-i`: `30x30px`, bo tròn `9px`, nền `var(--bg3)`, căn giữa icon/emoji.
  * Nội dung `.grow`: `.t` (Tiêu đề đậm `13.7px`) và `.d` (Chi tiết nhỏ `12px` màu muted).

### 5.7. Phễu kinh doanh (Kanban Board)
* **Khung cuộn ngang (`.kanban`)**: `display: flex; gap: 10px; overflow-x: auto`
* **Cột trạng thái (`.kcol`)**: `min-width: 230px; max-width: 250px; background: #1D1D22; border-radius: 13px; padding: 9px`
* **Thẻ cơ hội (`.kcard`)**:
  * Nền `var(--bg2)`, viền trái `3px solid var(--blue)` phân biệt.
  * **Cảnh báo vượt SLA (`.kcard.breach`)**: Viền trái tự đổi sang màu đỏ nguy hiểm `var(--danger)`.

### 5.8. Dòng thời gian tương tác (Activity Timeline)
* **Container (`.tl`)**: `position: relative; padding-left: 20px;`
* **Đường gióng trục**: Thanh dọc `2px` màu `var(--line)` chạy dọc bên trái.
* **Nút sự kiện (`.tl .ev:before`)**: Điểm tròn `9x9px` màu `var(--orange)`, viền `2px solid var(--bg)`.

### 5.9. Hộp thoại & Thông báo (Modals, Toasts & Overlay)
* **Modal (`.modal-scrim` & `.modal`)**:
  * Mobile: Trượt từ dưới lên (Bottom Sheet) với `border-radius: 18px 18px 0 0` và padding an toàn `env(safe-area-inset-bottom)`.
  * Desktop (≥640px): Căn giữa màn hình, bo góc toàn phần `18px`, chiều rộng tối đa `560px` (hoặc `680px` với `wide: true`).
* **Toast (`#toast-root` & `.toast`)**:
  * Nổi cố định ở giữa đáy màn hình (`bottom: calc(var(--nav-h) + 16px)`).
  * Viền trái trạng thái: `.toast.ok` (xanh lá), `.toast.err` (đỏ nguy hiểm). Tự biến mất sau 3.2s.
* **Màn chắn bảo mật (`#guard-overlay`)**:
  * Nền đen tuyệt đối `#0B0B0D` che phủ toàn màn hình khi người dùng chuyển tab hoặc mất focus tại các màn hình nhạy cảm (`SENSITIVE`).
  * Hiển thị biểu tượng khóa 🔒, tiêu đề *"Nội dung được bảo vệ"* và ghi audit log thao tác.

### 5.10. Khối tương tác AI (AI Bubbles)
* **Phản hồi từ AI (`.ai-bubble`)**: Nền `#1F1F25`, viền `var(--line)`, `border-radius: 13px; font-size: 13.3px; line-height: 1.5; white-space: pre-wrap;`
* **Tin nhắn của Sales (`.ai-bubble.me`)**: Nền `rgba(29,78,216, 0.18)`, viền `#1E3A8A`.

---

## 6. Iconography & Mapping thực tế

Trích xuất trực tiếp từ [`src/const.js`](file:///Users/phamhoanganh/nexrall-netviet-sales-os-v2/src/const.js) & [`src/app.js`](file:///Users/phamhoanganh/nexrall-netviet-sales-os-v2/src/app.js):

| Danh mục | Khóa | Icon | Tên hiển thị chuẩn |
|---|---|---|---|
| **Pipeline Stage** | `lead_moi` | 🌱 | Lead mới |
| | `tiep_can` | 📞 | Tiếp cận |
| | `nhu_cau` | 🔍 | Xác định nhu cầu |
| | `bao_gia` | 📄 | Báo giá / Proposal |
| | `dam_phan` | 🤝 | Đàm phán |
| | `chot` | ✍️ | Chốt hợp đồng |
| | `trien_khai` | 🚀 | Triển khai & Tái ký |
| **Loại hoạt động** | `call` | 📞 | Cuộc gọi |
| | `email` | ✉️ | Email |
| | `meeting` | 🤝 | Gặp mặt |
| | `demo` | 🎬 | Demo/Thuyết trình |
| | `zalo` | 💬 | Zalo/Chat |
| | `other` | 📌 | Khác |
| **Dịch vụ** | `TVC/Video` | 🎥 | TVC/Video AI |
| | `Gameshow` | 🎬 | Booking Gameshow |
| | `Xây kênh` | 📈 | Xây kênh triệu view |
| **Mức ưu tiên việc** | `high` | 🔴 | Cao |
| | `medium` | 🟠 | Vừa |
| | `low` | ⚪ | Thấp |
| **Trạng thái việc** | `todo` | ⏳ | Chờ làm |
| | `in_progress` | 🔵 | Đang làm |
| | `done` | ✅ | Hoàn thành |
| **Cảnh báo thông minh**| `danger` | 🚨 / 🔴 | Nguy hiểm / Cần chăm ngay |
| | `warn` | ⚠️ / 🟠 | Cảnh báo / Quá hạn nhẹ |
| | `ok` | ✅ / 🟢 | Hoàn thành / Đạt chuẩn |
| | `info` | ℹ️ / 🔵 | Thông tin |
| **Điều hướng Sidebar** | `console` | 🎛️ | Console đội |
| | `cockpit` | 🏠 | Cockpit cá nhân |
| | `tasks` | 📥 | Giao việc & SLA |
| | `pipeline` | 📊 | Pipeline đội |
| | `crm` | 🗂️ | CRM 360° |
| | `prospect` | 🔎 | Tìm khách & Thầu |
| | `saleskit` | 📄 | Sales Kit & Báo giá |
| | `reports` | 📝 | Báo cáo |
| | `kpi` | 🏆 | KPI · Hoa hồng · PIP |
| | `activities`| 🗓️ | Hoạt động |
| | `training` | 🎓 | Đào tạo |
| | `ai` | 🤖 | AI Trợ lý |
| | `admin` | ⚙️ | Quản trị |

---

## 7. Các tiện ích định dạng dữ liệu (UI Helpers)

Trích xuất từ [`src/ui.js`](file:///Users/phamhoanganh/nexrall-netviet-sales-os-v2/src/ui.js):

* **`vnd(n)`**: Định dạng đầy đủ tiền tệ Việt Nam (VD: `400.000.000 đ`).
* **`money(n)`**: Rút gọn đơn vị tài chính thông minh cho Sales:
  * `>= 1e12`: X.X `nghìn tỷ`
  * `>= 1e9`: X.XX `tỷ`
  * `>= 1e6`: X `tr`
  * Nhỏ hơn: Format số nguyên có dấu chấm phân cách hàng nghìn.
* **`pct(a, b)`**: Tính tỷ lệ phần trăm (0 - 999%), làm tròn số nguyên.
* **`rel(ts)`**: Tính mốc thời gian tương đối (`vừa xong`, `X phút trước`, `X giờ trước`, `X ngày trước`, hoặc ngày/tháng/năm).
* **`initials(name)`**: Lấy 2 chữ cái đầu của 2 từ cuối trong tên (VD: `Lê Anh Tuấn` → `AT`).

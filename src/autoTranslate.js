/** Lớp dịch tự động cho giao diện EN — "lưới an toàn" chạy SAU khi view đã vẽ xong.
 *
 * t()/tf() trong từng view chỉ dịch được chữ CỐ ĐỊNH của giao diện. Còn lại 2 loại chữ tiếng Việt
 * vẫn lọt ra màn hình EN:
 *   1. Chữ do SERVER sinh sẵn: thông báo, cảnh báo, câu nhắc, lỗi, nhãn KPI… (có chèn tên/số) →
 *      dịch bằng từ điển SERVER_EN + mẫu câu SERVER_PATTERNS bên dưới, ngay lập tức, không tốn gì.
 *   2. DỮ LIỆU NGƯỜI DÙNG NHẬP: tên deal, tên khách, ghi chú, mô tả gói… → không từ điển nào dịch
 *      được, nên gửi lên POST /api/i18n/translate (AI dịch + lưu bảng nv_translations), nhớ thêm ở
 *      localStorage để lần sau hiện tiếng Anh ngay, không nháy chữ Việt.
 *
 * Chỉ đụng tới NÚT CHỮ đang hiển thị (và placeholder/title/aria-label) — không bao giờ sửa giá trị
 * trong ô nhập, nên biểu mẫu sửa dữ liệu vẫn điền và lưu đúng chữ gốc trong CSDL. Giao diện VI: không
 * làm gì cả. Chưa cấu hình API key AI nào: loại (1) vẫn dịch đủ, loại (2) giữ nguyên chữ gốc.
 */
import { isEn, t, VI_CHARS, personName, stripVi } from './i18n.js';
import { api } from './api.js';
import { state } from './state.js';
import { stageName } from './const.js';

const CACHE_KEY = 'nv.tx.v1';
const CACHE_MAX = 3000;
const SKIP = 'script,style,textarea,input,code,pre,[contenteditable],[data-no-tx]';
const ATTRS = ['placeholder', 'title', 'aria-label'];

let cache = loadCache();
const pending = new Set();
const inflight = new Set();
let timer = null;
// Đoạn server đã trả lời là không dịch được (chưa có AI key, AI lỗi) → không hỏi lại trong phiên này.
// Ghi nhớ TỪNG đoạn chứ không tắt hẳn: đoạn mới vẫn được tra bảng nv_translations dù chưa có AI.
const missed = new Set();
const ORIG = new WeakMap(); // nút chữ → chữ tiếng Việt gốc (để dịch lại được sau khi có bản dịch AI)

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveCache() {
  try {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach((k) => delete cache[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) { /* hết dung lượng / chế độ ẩn danh: vẫn chạy, chỉ không nhớ qua lần tải sau */ }
}

/* ------------------------- Chữ cố định do server sinh ------------------------- */

const SERVER_EN = {
  // Lời chào, câu nhắc (routes/core.js)
  'Chào buổi sáng': 'Good morning', 'Chào buổi trưa': 'Good afternoon', 'Chào buổi chiều': 'Good afternoon', 'Chào buổi tối': 'Good evening',
  'Chưa nộp báo cáo cuối ngày (EOD).': 'End-of-day report (EOD) not submitted yet.',
  'Bạn đang bám sát kế hoạch. Giữ nhịp nhé!': "You're on track with your plan. Keep it up!",
  'Vui lòng cập nhật trạng thái.': 'Please update the status.',
  '🔴 Báo cáo EOD đã trễ hạn': '🔴 EOD report is overdue',
  '📝 Sắp đến hạn nộp báo cáo EOD': '📝 EOD report due soon',
  '📌 Mốc PIP sắp đến hạn': '📌 PIP milestone due soon',
  // Deal, báo giá, hợp đồng (routes/deals.js)
  'Cập nhật pipeline': 'Pipeline update',
  '🎉 Chúc mừng chốt deal!': '🎉 Congratulations on closing the deal!',
  'Báo giá NetViet': 'NetViet quote',
  '✏️ TPKD yêu cầu điều chỉnh báo giá': '✏️ Sales Manager requested changes to the quote',
  '✅ Báo giá đã được duyệt': '✅ Quote approved',
  '✏️ Admin/BGĐ yêu cầu điều chỉnh báo giá': '✏️ Admin/Board requested changes to the quote',
  '✏️ TPKD yêu cầu điều chỉnh hợp đồng': '✏️ Sales Manager requested changes to the contract',
  '✅ Hợp đồng đã ký': '✅ Contract signed',
  '✏️ HCNS yêu cầu điều chỉnh hợp đồng': '✏️ HR requested changes to the contract',
  'Admin/BGĐ lập — duyệt thẳng, không qua vòng nào.': 'Created by Admin/Board — approved directly, no review rounds.',
  'TPKD lập — bỏ vòng 1 vì người lập chính là người duyệt vòng này.': 'Created by the Sales Manager — round 1 skipped because the creator is that round’s approver.',
  'Tiếp cận gói thầu': 'Tender outreach',
  'Khối nhà nước / Tập đoàn': 'State sector / Corporation',
  'Tập đoàn': 'Corporation',
  'Ghi nhận từ thao tác thủ công.': 'Logged from a manual action.',
  'Ghi nhận từ tổng đài (mock call log).': 'Logged from the call center (mock call log).',
  'Cuộc gọi đồng bộ từ tổng đài': 'Call synced from the call center',
  'Bản ghi mock từ PBX (chưa cắm API thật)': 'Mock PBX record (real API not connected yet)',
  'Đã kết nối': 'Connected',
  'AI chấm điểm tự động.': 'Scored automatically by AI.',
  'Tiếp cận từ danh sách lead': 'Outreach from the lead list',
  'Đã liên hệ': 'Contacted',
  // Khách hàng (routes/crm.js)
  'Danh sách nhập từ Excel — ĐKKH tính từ hôm nay.': 'Imported from Excel — customer registration starts today.',
  'Khách hàng đã chuyển sang sale khác': 'Customer moved to another sales rep',
  'Đã hơn 14 ngày không tương tác — gửi bản tin case-study để hâm nóng.': 'No interaction for over 14 days — send a case-study newsletter to re-engage.',
  'Khách này đang thuộc về bạn.': 'This customer already belongs to you.',
  'Khách đã ký hợp đồng — quyền chăm sóc được giữ vĩnh viễn, không cần gia hạn.': 'The customer has signed a contract — ownership is permanent, no renewal needed.',
  'Khách đã ký hợp đồng — không thể nhận từ sale khác.': 'The customer has signed a contract — it cannot be taken from another sales rep.',
  // Phương án, việc, báo cáo, KPI, đào tạo
  'Phản hồi mới trên phương án': 'New reply on the business plan',
  'Kinh doanh phản hồi phương án': 'Sales replied on the business plan',
  'Hệ thống đã tự tổng hợp và nộp lúc 18h vì báo cáo chưa được nộp trước 17h.': 'The system compiled and submitted the report at 6 PM because it was not submitted before 5 PM.',
  '📌 Bạn được giao việc mới': '📌 You have a new assigned task',
  '✅ Việc đã hoàn thành': '✅ Task completed',
  '🗑️ Việc được giao đã bị huỷ': '🗑️ Assigned task was cancelled',
  '💰 Hoa hồng đã được chi': '💰 Commission paid',
  '🎓 Bạn được giao khoá học bắt buộc': '🎓 You have been assigned a mandatory course',
  'Vào mục Đào tạo để hoàn thành.': 'Go to Training to complete it.',
  'Bạn có thông báo mới trong NetViet Sales OS.': 'You have a new notification in NetViet Sales OS.',
  'Bạn có một thông báo mới cần xử lý.': 'You have a new notification to handle.',
  'Push Notification đang hoạt động.': 'Push notifications are working.',
  'Tốt': 'Good', 'Đạt': 'Satisfactory', 'Dưới chuẩn': 'Below standard',
  'Vượt chuẩn – đề xuất khen thưởng': 'Above standard – recommend a reward',
  'Hoàn thành tốt mục tiêu': 'Met targets well',
  'Đạt yêu cầu': 'Meets requirements',
  'Dưới chuẩn – cần kèm cặp': 'Below standard – needs coaching',
  'Kém – xem xét đưa vào PIP': 'Poor – consider a PIP',
  'Hiệu suất': 'Performance', 'Doanh thu ký mới': 'New signed revenue', 'Số deal chốt': 'Deals closed',
  'Giá trị pipeline kỳ vọng': 'Expected pipeline value', 'Báo cáo đúng hạn': 'On-time reports',
  'Tuân thủ SLA deal': 'Deal SLA compliance', 'Ngày có hoạt động': 'Active days',
  'Hoàn thành đào tạo': 'Training completed', 'Dùng AI hỗ trợ': 'AI assistant usage',
  // Lỗi (server/lib/util.js, validate.js, routes/*)
  'Chưa đăng nhập': 'Not signed in',
  'Bạn không có quyền thực hiện thao tác này': 'You do not have permission to do this',
  'Tài khoản Admin của bạn không có quyền quản lý tài khoản nhân sự khác': 'Your Admin account is not allowed to manage other staff accounts',
  'Email/Mã nhân viên hoặc mật khẩu không đúng': 'Incorrect email/employee ID or password',
  'Ảnh không hợp lệ. Chỉ nhận ảnh JPG, PNG hoặc WEBP.': 'Invalid image. Only JPG, PNG or WEBP images are accepted.',
  'Ảnh đại diện vượt quá 512KB sau khi xử lý. Hãy chọn ảnh khác.': 'The profile photo exceeds 512KB after processing. Please choose another image.',
  'Không có quyền chạy tác vụ nền': 'Not allowed to run background jobs',
  'File không có dòng khách hàng nào': 'The file has no customer rows',
  'Dữ liệu không hợp lệ': 'Invalid data',
  'Không tìm thấy khách hàng': 'Customer not found',
  'Thiếu khách hàng hoặc tên người liên hệ': 'Missing customer or contact name',
  'Loại hoạt động không hợp lệ': 'Invalid activity type',
  'Không tìm thấy partner': 'Partner not found',
  'Không tìm thấy lead': 'Lead not found',
  'Không tìm thấy cơ hội': 'Deal not found',
  'Deal đã chốt không thể quay lại giai đoạn trước. Nếu hợp đồng bị huỷ, hãy đánh dấu "Thất bại" kèm lý do.': 'A closed deal cannot go back to an earlier stage. If the contract was cancelled, mark it as "Lost" with a reason.',
  'Deal đã chi hoa hồng, không thể xoá. Hãy đánh dấu "Thất bại" thay vì xoá.': 'Commission has been paid on this deal, so it cannot be deleted. Mark it as "Lost" instead.',
  'Thiếu tên gói': 'Missing package name',
  'Không tìm thấy gói dịch vụ': 'Service package not found',
  'Không có gì để cập nhật': 'Nothing to update',
  'Chưa chọn gói dịch vụ nào': 'No service package selected',
  'Không tìm thấy báo giá': 'Quote not found',
  'Không tìm thấy hợp đồng': 'Contract not found',
  'Kết quả duyệt không hợp lệ': 'Invalid approval result',
  'Chỉ Trưởng phòng kinh doanh (hoặc Admin) mới duyệt được vòng 1': 'Only the Sales Manager (or Admin) can approve round 1',
  'Chỉ Admin/BGĐ mới duyệt được vòng 2': 'Only Admin/Board can approve round 2',
  'Chỉ Hành chính nhân sự (hoặc Admin) mới duyệt được vòng 2': 'Only HR (or Admin) can approve round 2',
  'Báo giá không ở trạng thái chờ duyệt': 'The quote is not awaiting approval',
  'Báo giá chưa bị yêu cầu điều chỉnh, không cần trình lại': 'No changes were requested on this quote, so it does not need resubmitting',
  'Hợp đồng không ở trạng thái chờ duyệt': 'The contract is not awaiting approval',
  'Hợp đồng chưa bị yêu cầu điều chỉnh, không cần trình lại': 'No changes were requested on this contract, so it does not need resubmitting',
  'Thiếu dữ liệu cập nhật': 'Missing update data',
  'Không tìm thấy cơ hội thầu': 'Tender opportunity not found',
  'Không tìm thấy': 'Not found',
  'Thiếu quoteId hoặc contractId': 'Missing quoteId or contractId',
  'Thiếu báo giá hoặc hợp đồng để đính kèm': 'Missing a quote or contract to attach to',
  'Chỉ hỗ trợ file PDF hoặc ảnh (PNG/JPG/WEBP)': 'Only PDF files or images (PNG/JPG/WEBP) are supported',
  'Thiếu nội dung file': 'Missing file content',
  'Nội dung file không hợp lệ': 'Invalid file content',
  'Không tìm thấy tài liệu': 'Document not found',
  'File không còn tồn tại trên kho lưu trữ': 'The file no longer exists in storage',
  'Thiếu khoá API. Gửi header: Authorization: Bearer <khoá>': 'Missing API key. Send the header: Authorization: Bearer <key>',
  'Khoá API không hợp lệ hoặc đã bị thu hồi': 'The API key is invalid or has been revoked',
  'Không tìm thấy nhân sự để gán khoá': 'Staff member for the key not found',
  'Không tìm thấy khoá': 'Key not found',
  'Thiếu bài học': 'Missing lesson',
  'Thiếu nhân sự hoặc bài học': 'Missing staff member or lesson',
  'Không tìm thấy nhân sự': 'Staff member not found',
  'Thiếu tiêu đề hoặc link video': 'Missing title or video link',
  'Vui lòng nhập nội dung': 'Please enter some content',
  'Subscription Push không hợp lệ': 'Invalid push subscription',
  'Thiếu subscription Push': 'Missing push subscription',
  'Không tìm thấy thiết bị đã đăng ký thông báo': 'No device registered for notifications was found',
  'Push chưa được cấu hình trên máy chủ': 'Push is not configured on the server',
  'Tài khoản này chưa có thiết bị nào bật thông báo': 'This account has no device with notifications enabled',
  'Đăng ký thông báo trên thiết bị đã hết hạn và đã được gỡ; hãy bật lại thông báo': 'The device’s notification subscription expired and was removed; please turn notifications on again',
  'Dịch vụ push không nhận thông báo cho các thiết bị đã đăng ký': 'The push service did not accept notifications for the registered devices',
  'Thiếu khoá cấu hình': 'Missing config key',
  'Không tìm thấy người dùng': 'User not found',
  'Liên kết không hợp lệ hoặc đã hết hạn': 'The link is invalid or has expired',
  'Không tìm thấy phương án': 'Business plan not found',
  'Không tìm thấy hạng mục': 'Item not found',
  'Hạng mục này không ở trạng thái chờ duyệt.': 'This item is not awaiting approval.',
  'Quyết định không hợp lệ': 'Invalid decision',
  'Vui lòng nêu rõ cần điều chỉnh gì để kinh doanh sửa đúng.': 'Please state clearly what needs changing so sales can fix it correctly.',
  'Chỉ người phụ trách mới trình được hạng mục này.': 'Only the owner can submit this item.',
  'Hạng mục đang chờ duyệt.': 'The item is awaiting approval.',
  'Hạng mục đã được duyệt.': 'The item has been approved.',
  'Bạn không có quyền trao đổi trong phương án này.': 'You are not allowed to comment on this business plan.',
  'Không tìm thấy công việc': 'Task not found',
  'Chỉ nhân sự được giao mới xác nhận nhận việc.': 'Only the assigned staff member can accept the task.',
  'Việc do cấp trên giao — bạn không thể xoá. Hãy nêu lý do hoàn trả.': 'This task was assigned by your manager — you cannot delete it. Give a reason for returning it.',
  'Không có quyền xem báo cáo của nhân sự này': 'Not allowed to view this staff member’s reports',
  'Trạng thái hoa hồng không hợp lệ': 'Invalid commission status',
  'Không tìm thấy bản ghi hoa hồng': 'Commission record not found',
  'Hoa hồng đã chi không thể đổi trạng thái.': 'A paid commission cannot change status.',
  'Chỉ duyệt/chi hoa hồng cho deal đã chốt.': 'Commission can only be approved/paid for closed deals.',
  'Thiếu mục tiêu': 'Missing goal',
  'Không tìm thấy bản ghi PIP': 'PIP record not found',
  'Kỳ báo cáo không hợp lệ': 'Invalid report period',
  'Đã có lỗi xảy ra, vui lòng thử lại': 'Something went wrong, please try again',
  'Lỗi không xác định': 'Unknown error',
  // Nhãn trường mà server chèn vào câu lỗi kiểm tra dữ liệu (validate.js)
  'Giá trị': 'Value', 'Số lượng': 'Quantity', 'Tỉ lệ': 'Rate', 'Mật khẩu': 'Password', 'Mật khẩu mới': 'New password',
  'Số điện thoại': 'Phone number', 'Thời điểm': 'Time', 'Hạn': 'Due date', 'Ngày': 'Date', 'Họ và tên': 'Full name',
  'Ngày sinh': 'Date of birth', 'Số CCCD': 'ID card number', 'Hạn CCCD': 'ID card expiry', 'Địa chỉ liên hệ': 'Contact address',
  'Trường học': 'School', 'Liên hệ khẩn cấp': 'Emergency contact', 'Tên khách hàng': 'Customer name', 'Nguồn khách hàng': 'Customer source',
  'Tên doanh nghiệp': 'Company name', 'Tên người liên hệ': 'Contact name', 'Thời điểm hoạt động': 'Activity time', 'Thời lượng': 'Duration',
  'Tên liên hệ': 'Contact name', 'Tên partner': 'Partner name', 'Tên lead': 'Lead name', 'Đơn giá': 'Unit price', 'Tên cơ hội': 'Deal name',
  'Giá trị hợp đồng': 'Contract value', 'Phương án hợp tác': 'Cooperation scheme', 'Nguồn thực hiện': 'Execution source',
  'Ngày dự kiến chốt': 'Expected close date', 'Tên gói': 'Package name', 'Giá gói': 'Package price', 'Tỉ lệ hoa hồng': 'Commission rate',
  'Chiết khấu tối đa': 'Maximum discount', 'Chiết khấu': 'Discount', 'Tên hợp đồng': 'Contract name', 'Tên gói thầu': 'Tender name',
  'Quan hệ trực tiếp': 'Direct relationship', 'Giá trị ước tính': 'Estimated value', 'Hạn nộp': 'Submission deadline', 'Tên app': 'App name',
  'Tên nhân sự': 'Staff name', 'Hồ sơ nhân sự': 'Profile', 'Tên phương án': 'Plan name', 'Quyết định': 'Decision',
  'Nội dung hạng mục': 'Item content', 'Người duyệt': 'Approver', 'Nội dung trao đổi': 'Message', 'Tên công việc': 'Task name',
  'SLA nhận việc': 'Acceptance SLA', 'Hạn xử lý': 'Due date', 'Kỹ năng': 'Skills',
  // Hạng mục phương án, người duyệt (routes/plans.js)
  'Nghiệm thu': 'Acceptance', 'Thanh lý': 'Liquidation', 'Giám đốc': 'Director', 'Trưởng phòng KD': 'Sales Manager',
};

const KIND_EN = { 'Báo giá': 'Quote', 'Hợp đồng': 'Contract', 'Nghiệm thu': 'Acceptance', 'Thanh lý': 'Liquidation' };
const KIND = '(Báo giá|Hợp đồng|Nghiệm thu|Thanh lý)';
const REPORT_EN = { EOD: 'EOD report', 'báo cáo tuần': 'weekly report', 'tổng hợp tháng': 'monthly summary' };
const CHANGED_EN = { 'mô tả': 'description', 'ưu tiên': 'priority', 'hạn': 'due date' };
const ROUND_EN = { 'V1 (TPKD)': 'V1 (Sales Manager)', 'V2 (Giám đốc)': 'V2 (Director)', 'V2 (HCNS)': 'V2 (HR)' };

const n = (x) => personName(x);
const vnd = (s) => String(s).replace(/(\d[\d.,]*)\s?đ(?![\p{L}])/gu, (m, x) => (/^\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, ',') : x) + ' VND');
function overCap(s) {
  const m = /^ Vượt trần riêng: (.+)\.$/.exec(s || '');
  if (!m) return s ? ' ' + d(s.trim()) : '';
  return ' Exceeds package caps: ' + m[1].split('; ').map((x) => {
    const k = /^(.+) \(trần ([\d.]+)%, chênh \+([\d.]+)%\)$/.exec(x);
    return k ? `${d(k[1])} (cap ${k[2]}%, +${k[3]}% over)` : d(x);
  }).join('; ') + '.';
}

/** Mẫu câu có chèn tên/số do server sinh (thông báo, cảnh báo, lỗi). `d()` dịch phần dữ liệu người
 * dùng bên trong (tên deal, tên khách…) qua đúng đường từ điển → bộ nhớ → AI như mọi chữ khác. */
const SERVER_PATTERNS = [
  // Dữ liệu có khuôn cố định: gói thầu máy quét gắn "#mã", phương án đặt tên "Phương án <khách>"
  [/^Gói thầu: (.+)$/, (m) => `Tender: ${d(m[1])}`],
  [/^(.+?) (#\d+)$/, (m) => `${d(m[1])} ${m[2]}`],
  [/^Phương án (.+)$/, (m) => `${d(m[1])} Business Plan`],
  // Câu lệnh AI do app soạn sẵn (lưu trong lịch sử AI Assistant)
  [/^Phân tích cơ hội thầu "(.+)" của (.+): nên theo hay bỏ, chiến lược làm hồ sơ và các bước trong 7 ngày tới\.$/,
    (m) => `Analyze the tender "${d(m[1])}" from ${d(m[2])}: pursue or skip, bid preparation strategy and the steps for the next 7 days.`],
  [/^Soạn proposal cho (.+) theo phương án "(.+)"\.$/, (m) => `Draft a proposal for ${d(m[1])} based on the plan "${d(m[2])}".`],
  // routes/core.js — câu nhắc Trang chủ & tác vụ nền SLA
  [/^Còn thiếu (\d+) liên hệ mới để đạt định mức hôm nay\.$/, (m) => `${m[1]} more new contacts needed to hit today's quota.`],
  [/^(\d+) deal vượt SLA – nguy cơ nguội, cần chăm ngay\.$/, (m) => `${m[1]} deals past SLA – at risk of going cold, follow up now.`],
  [/^(\d+) việc được giao chưa xác nhận nhận việc \(SLA (\d+) phút\)\.$/, (m) => `${m[1]} assigned tasks not yet accepted (SLA ${m[2]} min).`],
  [/^🔴 Deal quá SLA: (.+)$/, (m) => `🔴 Deal past SLA: ${d(m[1])}`],
  [/^Đã (\d+) ngày không có hoạt động \(SLA (\d+) ngày\)\.$/, (m) => `No activity for ${m[1]} days (SLA ${m[2]} days).`],
  [/^⚠️ Leo thang SLA: (.+)$/, (m) => `⚠️ SLA escalation: ${d(m[1])}`],
  [/^(.+) để deal nguội (\d+) ngày \(gấp đôi SLA (\d+) ngày\)\.$/, (m) => `${n(m[1])} let the deal go cold for ${m[2]} days (double the ${m[3]}-day SLA).`],
  [/^⏰ Việc quá hạn: (.+)$/, (m) => `⏰ Overdue task: ${d(m[1])}`],
  [/^⚠️ Chưa nhận việc: (.+)$/, (m) => `⚠️ Task not accepted: ${d(m[1])}`],
  [/^(.+) chưa xác nhận tiếp nhận quá SLA\.$/, (m) => `${n(m[1])} has not accepted the task within the SLA.`],
  [/^Hạn nộp (\d+)h(\d\d)\.$/, (m) => `Due at ${m[1]}:${m[2]}.`],
  [/^📑 Hạn nộp thầu còn (\d+) ngày$/, (m) => `📑 Tender deadline in ${m[1]} days`],
  [/^Mốc PIP của (.+) sắp đến hạn$/, (m) => `${n(m[1])}'s PIP milestone is due soon`],
  [/^🔴 Báo giá chờ duyệt (V\d) quá hạn$/, (m) => `🔴 Quote awaiting ${m[1]} approval is overdue`],
  [/^🔴 Hợp đồng chờ duyệt (V\d) quá hạn$/, (m) => `🔴 Contract awaiting ${m[1]} approval is overdue`],
  [/^(.+) – đã (\d+) ngày làm việc chưa xử lý\.$/, (m) => `${d(m[1])} – ${m[2]} working days without action.`],
  [/^⚠️ Leo thang duyệt báo giá (V\d): (.+)$/, (m) => `⚠️ Quote approval ${m[1]} escalated: ${d(m[2])}`],
  [/^⚠️ Leo thang duyệt hợp đồng (V\d): (.+)$/, (m) => `⚠️ Contract approval ${m[1]} escalated: ${d(m[2])}`],
  [/^Chờ duyệt (V\d) đã (\d+) ngày làm việc \(gấp đôi ngưỡng\)\.$/, (m) => `Awaiting ${m[1]} approval for ${m[2]} working days (double the threshold).`],
  // routes/deals.js
  [/^Chuyển giai đoạn: (\S+) → (\S+)$/, (m) => `Stage change: ${stageName(m[1])} → ${stageName(m[2])}`],
  [/^(.+) – hoa hồng dự kiến đã được ghi nhận\.$/, (m) => `${d(m[1])} – expected commission has been recorded.`],
  [/^Chờ duyệt báo giá \((V\d)\) — chiết khấu ([\d.,]+)%$/, (m) => `Quote awaiting approval (${m[1]}) — ${m[2]}% discount`],
  [/^Chờ duyệt báo giá \((V\d)\): (.+)$/, (m) => `Quote awaiting approval (${m[1]}): ${d(m[2])}`],
  [/^Chờ duyệt hợp đồng \((V\d)\): (.+)$/, (m) => `Contract awaiting approval (${m[1]}): ${d(m[2])}`],
  [/^(.+?) gửi báo giá vượt ngưỡng ([\d.,]+)%\.([^·]*)$/, (m) => `${n(m[1])} submitted a quote above the ${m[2]}% threshold.${overCap(m[3])}`],
  [/^(.+?) \(TPKD\) tự lập, đã bỏ vòng 1\.([^·]*)$/, (m) => `${n(m[1])} (Sales Manager) created it, round 1 skipped.${overCap(m[2])}`],
  [/^(.+?) \(TPKD\) tự lập (.+), đã bỏ vòng 1\.$/, (m) => `${n(m[1])} (Sales Manager) created a contract worth ${vnd(m[2])}, round 1 skipped.`],
  [/^(.+?) đã lập hợp đồng (.+)\.$/, (m) => `${n(m[1])} created a contract worth ${vnd(m[2])}.`],
  [/^(.+) đã duyệt vòng 1\.$/, (m) => `${n(m[1])} approved round 1.`],
  [/^Báo giá đã sửa, chờ duyệt lại: (.+)$/, (m) => `Quote revised, awaiting re-approval: ${d(m[1])}`],
  [/^Hợp đồng đã sửa, chờ duyệt lại: (.+)$/, (m) => `Contract revised, awaiting re-approval: ${d(m[1])}`],
  [/^(.+) đã cập nhật theo yêu cầu điều chỉnh\.$/, (m) => `${n(m[1])} updated it as requested.`],
  [/^Chiết khấu ([\d.]+)% vượt trần cho phép ([\d.]+)%\.([^·]*)$/, (m) => `A ${m[1]}% discount exceeds the allowed cap of ${m[2]}%.` + (m[3].trim() ? ' Please adjust it or request a special arrangement from the Board.' : '')],
  [/^Cơ hội thầu "(.+)" đã được chuyển thành deal trước đó\.$/, (m) => `Tender "${d(m[1])}" has already been converted into a deal.`],
  [/^Nguồn: (.*?) – (.*)$/, (m) => `Source: ${d(m[1])} – ${m[2]}`],
  [/^AI tóm tắt \(mock\): gói thầu phù hợp mảng (.+), quy mô (\d+) triệu\. Cần hồ sơ năng lực \+ 3 dự án tương tự\.$/,
    (m) => `AI summary (mock): the tender fits the ${d(m[1])} line, budget ${m[2]} million VND. Requires a capability profile + 3 similar projects.`],
  [/^AI tóm tắt: quy mô (\d+) triệu, phù hợp năng lực NetViet mảng (.+)\. Yêu cầu hồ sơ năng lực 3 dự án tương tự\.$/,
    (m) => `AI summary: budget ${m[1]} million VND, fits NetViet's ${d(m[2])} capability. Requires a capability profile with 3 similar projects.`],
  // routes/crm.js
  [/^(.+) đã giao (\d+) khách hàng cho bạn$/, (m) => `${n(m[1])} assigned ${m[2]} customers to you`],
  [/^"(.+)" hết hạn ĐKKH và chưa ký hợp đồng — (.+) đã nhận chăm sóc\.$/, (m) => `"${d(m[1])}" registration expired without a signed contract — ${n(m[2])} has taken over.`],
  [/^Khách chưa dùng mảng (.+) — đề xuất gói (.+) để mở rộng giá trị hợp đồng\.$/, (m) => `The customer doesn't use ${d(m[1])} yet — suggest the ${d(m[2])} package to grow contract value.`],
  [/^Hợp đồng "(.+)" đã hơn 2 tháng — thời điểm tốt để chào tái ký\/gia hạn\.$/, (m) => `Contract "${d(m[1])}" is over 2 months old — a good time to pitch a renewal/extension.`],
  [/^Khách "(.+)" đã có trong danh sách của bạn\.$/, (m) => `Customer "${d(m[1])}" is already in your list.`],
  [/^Khách "(.+)" đã được (.+) đăng ký\. Vui lòng trao đổi trước khi tiếp cận \(deal registration\)\.$/, (m) => `Customer "${d(m[1])}" is already registered by ${m[2] === 'sales khác' ? 'another sales rep' : n(m[2])}. Please coordinate before reaching out (deal registration).`],
  [/^Mỗi lần chỉ nhập được tối đa (\d+) khách hàng — chia file nhỏ hơn rồi nhập lần lượt\.$/, (m) => `You can import at most ${m[1]} customers at a time — split the file and import in batches.`],
  [/^Khách hàng còn (\d+) cơ hội gắn kèm\. Hãy xử lý các deal trước khi xoá\.$/, (m) => `The customer still has ${m[1]} linked deals. Handle those deals before deleting.`],
  [/^Khách vẫn còn hạn ĐKKH \(còn (\d+) ngày\)\. Chỉ nhận được sau khi hết hạn\.$/, (m) => `The customer registration is still valid (${m[1]} days left). You can only take it after it expires.`],
  [/^Bạn đã ghi nhận liên hệ "(.+)" trong hôm nay\. Không tính trùng vào định mức\.$/, (m) => `You already logged contact "${d(m[1])}" today. It won't count twice toward the quota.`],
  [/^Lead "(.+)" đã được tiếp cận trước đó — không tính thêm vào định mức khách mới\.$/, (m) => `Lead "${d(m[1])}" was already contacted — it won't count again toward the new-customer quota.`],
  [/^Chuyển từ lead: (.+)$/, (m) => `Converted from lead: ${d(m[1])}`],
  [/^Tiếp cận lead (.+)$/, (m) => `Lead outreach: ${d(m[1])}`],
  // routes/plans.js
  [new RegExp(`^Đã duyệt ${KIND}(?:: (.+))?$`), (m) => `${KIND_EN[m[1]]} approved${m[2] ? ': ' + d(m[2]) : ''}`],
  [new RegExp(`^(?:Yêu cầu điều chỉnh|Cần chỉnh sửa) ${KIND}(?:: (.+))?$`), (m) => `Changes requested: ${KIND_EN[m[1]]}${m[2] ? ': ' + d(m[2]) : ''}`],
  [new RegExp(`^Đã trình ${KIND} lên (.+?): (.+)$`), (m) => `Submitted the ${KIND_EN[m[1]].toLowerCase()} to ${d(m[2])}: ${d(m[3])}`],
  [new RegExp(`^${KIND} chờ bạn duyệt$`), (m) => `${KIND_EN[m[1]]} awaiting your approval`],
  [new RegExp(`^${KIND} nay lập trực tiếp trong phương án bằng chứng từ thật — không trình bằng ô nhập tay\\.$`), (m) => `${KIND_EN[m[1]]} is now created directly in the plan as a real document — it can't be submitted as free text.`],
  [/^Hạng mục này đang trình (.+) duyệt\.$/, (m) => `This item is currently submitted to ${d(m[1])} for approval.`],
  [/^(.+) — (.+) vừa trình\.$/, (m) => `${d(m[1])} — just submitted by ${n(m[2])}.`],
  [/^Đã tạo phương án kinh doanh: (.+)$/, (m) => `Business plan created: ${d(m[1])}`],
  // routes/work.js
  [/^Hệ thống tự tổng hợp và tự nộp (EOD|báo cáo tuần|tổng hợp tháng) lúc 18h do chưa nộp trước hạn 17h\.$/, (m) => `The system compiled and auto-submitted the ${REPORT_EN[m[1]]} at 6 PM because it wasn't submitted before the 5 PM deadline.`],
  [/^🤖 Đã tự nộp (EOD|báo cáo tuần|tổng hợp tháng)$/, (m) => `🤖 ${REPORT_EN[m[1]].replace(/^./, (c) => c.toUpperCase())} auto-submitted`],
  [/^✅ (.+) đã đánh dấu hoàn thành$/, (m) => `✅ ${n(m[1])} marked the task as done`],
  [/^👌 (.+) đã nhận việc$/, (m) => `👌 ${n(m[1])} accepted the task`],
  [/^🔄 Việc chuyển sang "(.+)"$/, (m) => `🔄 Task moved to "${t(m[1])}"`],
  [/^✏️ Việc được cập nhật (.+)$/, (m) => `✏️ Task updated: ${m[1].split(', ').map((x) => CHANGED_EN[x] || x).join(', ')}`],
  [/^TP đã chấm KPI kỳ (.+)$/, (m) => `Your manager scored your KPI for ${m[1]}`],
  [/^Tổng điểm ([\d.]+) – xếp loại (.+)$/, (m) => `Total score ${m[1]} – grade ${t(m[2])}`],
  [/^Số tiền (.+)$/, (m) => `Amount ${vnd(m[1])}`],
  [/^Bạn được đưa vào chương trình cải thiện (\d+) ngày$/, (m) => `You have been placed on a ${m[1]}-day performance improvement plan (PIP)`],
  [/^Deal "(.+)" \((.+)\) đã (\d+) ngày không hoạt động\.$/, (m) => `Deal "${d(m[1])}" (${n(m[2])}) has had no activity for ${m[3]} days.`],
  [/^Báo giá "(.+)" chiết khấu ([\d.]+)% chờ duyệt (V1 \(TPKD\)|V2 \(Giám đốc\)) \((.+)\)\.$/, (m) => `Quote "${d(m[1])}" with a ${m[2]}% discount awaiting ${ROUND_EN[m[3]]} approval (${n(m[4])}).`],
  [/^Hợp đồng "(.+)" chờ duyệt (V1 \(TPKD\)|V2 \(HCNS\)) \((.+)\)\.$/, (m) => `Contract "${d(m[1])}" awaiting ${ROUND_EN[m[2]]} approval (${n(m[3])}).`],
  [/^(.+) chưa nhận việc "(.+)" quá SLA — cần leo thang\.$/, (m) => `${n(m[1])} has not accepted "${d(m[2])}" within the SLA — escalate.`],
  [/^(.+) chỉ đạt (\d+)% định mức liên hệ mới trong (\d+) ngày \((\d+)\/(\d+)\) — dưới ngưỡng (\d+)%, cần kích hoạt PIP\.$/,
    (m) => `${n(m[1])} reached only ${m[2]}% of the new-contact quota in ${m[3]} days (${m[4]}/${m[5]}) — below the ${m[6]}% threshold, start a PIP.`],
  [/^Chưa nộp báo cáo hôm qua: (.+)$/, (m) => `Yesterday's report not submitted: ${m[1].split(', ').map(n).join(', ')}`],
  // Lỗi có tham số (routes/core.js, misc.js, gateway.js, server.js, lib/validate.js)
  [/^Bạn đã nhập sai quá nhiều lần\. Vui lòng thử lại sau khoảng (\d+) phút\.$/, (m) => `Too many failed attempts. Please try again in about ${m[1]} minutes.`],
  [/^Email (.+) đã được dùng cho tài khoản khác\.$/, (m) => `The email ${m[1]} is already used by another account.`],
  [/^Khoá API không được phép gọi (\S+) (\S+)$/, (m) => `This API key is not allowed to call ${m[1]} ${m[2]}`],
  [/^Không tìm thấy API: (.+)$/, (m) => `API not found: ${m[1]}`],
  [/^Vui lòng nhập (.+)$/, (m) => `Please enter ${label(m[1]).toLowerCase()}`],
  [/^(.+) phải là số$/, (m) => `${label(m[1])} must be a number`],
  [/^(.+) không được âm$/, (m) => `${label(m[1])} cannot be negative`],
  [/^(.+) vượt mức cho phép \(tối đa (.+)\)$/, (m) => `${label(m[1])} exceeds the allowed limit (max ${vnd(m[2])})`],
  [/^(.+) không được vượt ([\d.]+)%$/, (m) => `${label(m[1])} cannot exceed ${m[2]}%`],
  [/^(.+) không đúng định dạng \(ví dụ: ten@congty\.vn\)$/, (m) => `${label(m[1])} is not in a valid format (e.g. name@company.com)`],
  [/^(.+) phải có ít nhất (\d+) ký tự$/, (m) => `${label(m[1])} must be at least ${m[2]} characters`],
  [/^(.+) chỉ được chứa chữ số \(8–20 ký tự\)$/, (m) => `${label(m[1])} may only contain digits (8–20 characters)`],
  [/^(.+) quá dài$/, (m) => `${label(m[1])} is too long`],
  [/^(.+) quá ngắn$/, (m) => `${label(m[1])} is too short`],
  [/^(.+) không được ở tương lai$/, (m) => `${label(m[1])} cannot be in the future`],
  [/^(.+) quá xa trong quá khứ$/, (m) => `${label(m[1])} is too far in the past`],
  [/^(.+) quá xa trong tương lai$/, (m) => `${label(m[1])} is too far in the future`],
  [/^(.+) không đúng định dạng$/, (m) => `${label(m[1])} is not in a valid format`],
  [/^(.+) không hợp lệ$/, (m) => `${label(m[1])} is invalid`],
];

/** Nhãn trường mà server chèn vào câu lỗi (có thể đã viết thường). */
function label(s) {
  const k = String(s).trim();
  const cap = k.charAt(0).toUpperCase() + k.slice(1);
  return dict(k) || dict(cap) || d(k);
}

/* ------------------- Dữ liệu danh mục có sẵn của hệ thống ------------------- */
/* Gói dịch vụ (Sales Kit), khoá đào tạo, gói thầu do máy quét tạo, cơ quan/tổ chức hay gặp — là dữ
 * liệu hệ thống dựng sẵn chứ không phải chữ người dùng gõ tự do, nên dịch cố định ngay tại đây (không
 * cần AI). Gói/khoá học do Admin thêm mới sau này đi đường AI như mọi dữ liệu khác. */
const CATALOG_EN = {
  // Sales Kit — tên & mô tả gói, đơn vị, viết tắt
  'TVC quảng cáo 30s (quay thực tế)': '30s advertising TVC (live-action shoot)',
  'TVC AI 15s (AI Generative)': '15s AI TVC (AI Generative)',
  'Chuỗi Video AI viral (10 video)': 'Viral AI video series (10 videos)',
  'Booking Gameshow – Talkshow chuyên đề': 'Gameshow booking – Themed talk show',
  'Booking Gameshow – Tài trợ mùa': 'Gameshow booking – Season sponsorship',
  'Xây kênh TikTok triệu view – 3 tháng': 'Million-view TikTok channel building – 3 months',
  'Xây kênh YouTube – 6 tháng': 'YouTube channel building – 6 months',
  'Livestream bán hàng cùng KOL': 'Sales livestream with KOLs',
  'Kịch bản + quay 2 ngày + hậu kỳ + 3 phiên bản cắt.': 'Script + 2-day shoot + post-production + 3 cut versions.',
  'Sản xuất bằng AI: storyboard, dựng cảnh, lồng tiếng AI. Giao trong 5 ngày.': 'AI-produced: storyboard, scene building, AI voice-over. Delivered in 5 days.',
  '10 video ngắn 30-45s tối ưu TikTok/Reels, sản xuất bằng AI.': '10 short 30-45s videos optimized for TikTok/Reels, produced with AI.',
  'Xuất hiện thương hiệu trong 1 số talkshow phát sóng đa nền tảng.': 'Brand appearance in 1 talk show episode broadcast across multiple platforms.',
  'Nhà tài trợ chính 1 mùa (12 số): logo, PPL, MC đọc, hậu trường.': 'Main sponsor for 1 season (12 episodes): logo, PPL, host mentions, behind the scenes.',
  '12 video/tháng, chiến lược nội dung, seeding, báo cáo tuần.': '12 videos/month, content strategy, seeding, weekly reports.',
  '4 video dài + 12 shorts/tháng, tối ưu SEO, quản trị cộng đồng.': '4 long videos + 12 shorts/month, SEO optimization, community management.',
  'Kịch bản, KOL, setup studio, vận hành 1 phiên 3 giờ.': 'Script, KOLs, studio setup, running one 3-hour session.',
  'HH': 'Comm.',
  // Đào tạo
  'Nhập môn dịch vụ NetViet: TVC, Gameshow, Xây kênh': 'Introduction to NetViet services: TVC, Gameshow, Channel building',
  'Kịch bản gọi điện 30 giây chốt lịch hẹn': '30-second call script to book a meeting',
  'Xử lý từ chối: "Giá cao quá"': 'Handling objections: "The price is too high"',
  'Quy trình pipeline 7 giai đoạn & SLA': '7-stage pipeline process & SLA',
  'Đọc hiểu hồ sơ mời thầu truyền thông': 'Reading media tender invitation documents',
  'Coaching đội sales & vận hành PIP': 'Coaching the sales team & running PIPs',
  'Bài giảng nội bộ NetViet Academy.': 'NetViet Academy internal lecture.',
  // Gói thầu (máy quét thầu & dữ liệu mẫu)
  'Sản xuất phim tư liệu 20 năm thành lập': 'Documentary film production for the 20th founding anniversary',
  'Truyền thông số & xây kênh TikTok chương trình OCOP': 'Digital communications & TikTok channel building for the OCOP program',
  'Tài trợ sản xuất gameshow "Nông dân số"': 'Production sponsorship for the "Digital Farmers" gameshow',
  'Sản xuất TVC quảng bá du lịch tỉnh': 'Provincial tourism promotion TVC production',
  'Chuỗi video AI đào tạo nội bộ': 'AI video series for internal training',
  'Quản trị kênh YouTube thương hiệu quốc gia': 'National brand YouTube channel management',
  'Tài trợ chương trình truyền hình thực tế mùa 2': 'Sponsorship of a reality TV show, season 2',
  'Sản xuất video truyền thông chương trình chuyển đổi số': 'Communication video production for the digital transformation program',
  'Thuê đơn vị vận hành kênh TikTok/YouTube quảng bá nông sản': 'Hiring an operator for TikTok/YouTube channels promoting agricultural products',
  // Cơ quan, tổ chức
  'Tổng công ty Điện lực Miền Nam': 'Southern Power Corporation',
  'Cục Xúc tiến Thương mại': 'Vietnam Trade Promotion Agency',
  'Bộ NN&PTNT': 'Ministry of Agriculture and Rural Development',
  'Bộ Công Thương': 'Ministry of Industry and Trade',
  'Sở Công Thương TP.HCM': 'Ho Chi Minh City Department of Industry and Trade',
  // Ngành
  'Xăng Dầu': 'Petroleum', 'Xăng dầu': 'Petroleum', 'FMCG': 'FMCG', 'SME': 'SME',
};

/* Tên công ty / tổ chức: dịch phần loại hình theo quy tắc, phần tên riêng viết không dấu.
 * "Công ty CP Sữa Việt Xanh" → "Viet Xanh Dairy JSC"; "UBND tỉnh Bình Dương" → "Binh Duong Provincial
 * People's Committee"; "Công ty An Khang Group 01" → "An Khang Group 01". */
const ORG_RULES = [
  [/^Tổng công ty (.+)$/i, (x) => `${x} Corporation`],
  [/^Công ty (?:CP|Cổ phần) (.+)$/i, (x) => `${x} JSC`],
  [/^Công ty TNHH (?:MTV )?(.+)$/i, (x) => `${x} Co., Ltd.`],
  [/^Công ty (.+)$/i, (x) => (/\b(Group|Holdings|Corporation|Corp|Media|Solutions|JSC|Company|Co\.|Ltd|Inc)\b/i.test(x) ? x : `${x} Company`)],
  [/^Tập đoàn (.+)$/i, (x) => `${x} Group`],
  [/^Ngân hàng TMCP (.+)$/i, (x) => `${x} Commercial Joint Stock Bank`],
  [/^Ngân hàng (.+)$/i, (x) => `${x} Bank`],
  [/^Siêu thị (.+)$/i, (x) => `${x} Supermarket`],
  [/^Chuỗi cà phê (.+)$/i, (x) => `${x} Coffee Chain`],
  [/^Dược phẩm (.+)$/i, (x) => `${x} Pharmaceuticals`],
  [/^Mỹ phẩm (.+)$/i, (x) => `${x} Cosmetics`],
  [/^Nội thất (.+)$/i, (x) => `${x} Furniture`],
  [/^Ô tô (.+)$/i, (x) => `${x} Automotive`],
  [/^Công nghệ (.+)$/i, (x) => `${x} Technology`],
  [/^Hệ thống Anh ngữ (.+)$/i, (x) => `${x} English Centers`],
  [/^Bệnh viện (.+)$/i, (x) => `${x} Hospital`],
  [/^UBND (?:tỉnh )?(.+)$/i, (x) => `${x} Provincial People's Committee`],
  [/^Sở Du lịch (.+)$/i, (x) => `${x} Department of Tourism`],
  [/^Sở Công Thương (.+)$/i, (x) => `${x} Department of Industry and Trade`],
  [/^Sở Giáo dục (?:và|&) Đào tạo (.+)$/i, (x) => `${x} Department of Education and Training`],
  [/^Sở Y tế (.+)$/i, (x) => `${x} Department of Health`],
  [/^Đài PT-TH (.+)$/i, (x) => `${x} Radio & Television`],
  [/^Đài Truyền hình (.+)$/i, (x) => `${x} Television`],
];
// Từ chỉ ngành đứng đầu phần tên riêng → đưa ra sau tên: "BĐS An Phát" → "An Phat Real Estate"
const ORG_WORDS = [['BĐS', 'Real Estate'], ['Bất động sản', 'Real Estate'], ['Nông nghiệp', 'Agriculture'], ['Sữa', 'Dairy'],
  ['Xây dựng', 'Construction'], ['Thực phẩm', 'Food'], ['Du lịch', 'Tourism'], ['Vận tải', 'Transport'], ['Thương mại', 'Trading'],
  ['Đầu tư', 'Investment'], ['Dịch vụ', 'Services'], ['Truyền thông', 'Media'], ['Giáo dục', 'Education'], ['Xăng dầu', 'Petroleum']];
function properPart(x) {
  let rest = x.trim();
  const generic = [];
  for (let hit = true; hit;) {
    hit = false;
    for (const [vi, en] of ORG_WORDS) {
      if (rest.toLowerCase().startsWith(vi.toLowerCase() + ' ')) { generic.push(en); rest = rest.slice(vi.length).trim(); hit = true; }
    }
  }
  // Phần còn lại phải là tên riêng (viết hoa đầu) — tránh bắt nhầm câu thường "Công ty đang cần…"
  if (!/^[\p{Lu}\d]/u.test(rest)) return null;
  return [stripVi(rest), ...generic].join(' ');
}
function orgName(s) {
  if (s.split(/\s+/).length > 8) return null;
  for (const [re, fn] of ORG_RULES) {
    const m = re.exec(s);
    const proper = m && properPart(m[1]);
    if (proper) return fn(proper);
  }
  // Cụm ngắn toàn chữ viết hoa đầu từ (tên riêng: "Tây Nam Station") → viết không dấu
  const words = s.split(/\s+/);
  if (words.length <= 6 && words.every((w) => /^[\p{Lu}\d&#(".-]/u.test(w))) return stripVi(s);
  return null;
}

/* ------------------------------ Tra cứu & hàng đợi ------------------------------ */

function dict(s) {
  const a = t(s);
  if (a !== s) return a;
  return SERVER_EN[s] || CATALOG_EN[s] || null;
}

/** Dịch một đoạn dữ liệu: từ điển → mẫu câu → bộ nhớ bản dịch AI → xếp hàng gửi AI (trả tạm chữ gốc). */
function d(s) {
  const k = String(s == null ? '' : s).trim();
  if (!k || !VI_CHARS.test(k)) return s;
  const hit = dict(k);
  if (hit) return hit;
  for (const [re, fn] of SERVER_PATTERNS) {
    const m = re.exec(k);
    if (m) return fn(m);
  }
  const org = orgName(k);
  if (org) return org;
  if (cache[k] != null) return cache[k];
  if (!missed.has(k) && state.me) { pending.add(k); schedule(); }
  return k;
}

/** Dịch một chuỗi hiển thị: thử nguyên câu trước, rồi tách theo dấu phân cách " · " / " → " mà các
 * view dùng để ghép nhiều mẩu (vd "Tên khách · 16:23 08-09 · Tên sale"), và bỏ ký hiệu đầu dòng. */
export function translateText(s) {
  if (!s || !VI_CHARS.test(s)) return s;
  const lead = s.match(/^\s*/)[0];
  const tail = s.match(/\s*$/)[0];
  const core = s.trim();
  const whole = dict(core) || matchPattern(core);
  if (whole) return lead + whole + tail;
  const out = core.split(/(\s[·→|]\s)/).map((seg) => {
    if (!VI_CHARS.test(seg)) return seg;
    const m = /^([•\-–—:\s]*)(.*?)([\s:]*)$/s.exec(seg);
    return m[1] + d(m[2]) + m[3];
  }).join('');
  return lead + out + tail;
}
function matchPattern(s) {
  for (const [re, fn] of SERVER_PATTERNS) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return null;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, 120);
}

async function flush() {
  timer = null;
  const batch = [...pending].filter((s) => !inflight.has(s)).slice(0, 60);
  batch.forEach((s) => { pending.delete(s); inflight.add(s); });
  if (!batch.length) return;
  try {
    const r = await api('/i18n/translate', { method: 'POST', body: { texts: batch } });
    const got = r.translations || {};
    Object.assign(cache, got);
    batch.forEach((s) => { if (got[s] == null) missed.add(s); });
    saveCache();
  } catch (e) {
    batch.forEach((s) => missed.add(s));
  } finally {
    batch.forEach((s) => inflight.delete(s));
  }
  if (isEn()) apply(document.body);
  if (pending.size) schedule();
}

/* --------------------------------- Áp vào DOM --------------------------------- */

// Giao diện EN dùng gạch nối "-" thay cho gạch dài "—" ở mọi chữ hiển thị (theo yêu cầu người vận hành).
const dashes = (s) => (s && s.includes('—') ? s.replace(/—/g, '-') : s);

function translateNode(node) {
  const orig = ORIG.has(node) ? ORIG.get(node) : node.nodeValue;
  if (!orig || !(VI_CHARS.test(orig) || orig.includes('—'))) return;
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  ORIG.set(node, orig);
  const next = dashes(translateText(orig));
  if (next !== node.nodeValue) node.nodeValue = next;
}

function translateAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && VI_CHARS.test(v)) {
      const hit = dict(v.trim()) || matchPattern(v.trim());
      if (hit) el.setAttribute(a, dashes(hit));
    } else if (v && v.includes('—')) el.setAttribute(a, dashes(v));
  }
}

function apply(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateNode(root); return; }
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) translateNode(w.currentNode);
  translateAttrs(root);
  root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(translateAttrs);
}

let started = false;
/** Gọi 1 lần lúc khởi động app. Mỗi lần view vẽ lại (innerHTML mới), nút mới được dịch ngay trong
 * cùng lượt microtask — trước khi trình duyệt vẽ khung hình, nên không thấy chữ Việt nháy lên. */
export function initAutoTranslate() {
  if (started || typeof MutationObserver === 'undefined') return;
  started = true;
  new MutationObserver((muts) => {
    if (!isEn()) return;
    for (const m of muts) m.addedNodes.forEach(apply);
  }).observe(document.body, { childList: true, subtree: true });
  if (isEn()) apply(document.body);
}

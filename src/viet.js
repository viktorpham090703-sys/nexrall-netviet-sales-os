/* Việt hoá toàn bộ chữ hiển thị khi giao diện đang ở tiếng Việt — cặp với autoTranslate.js (chiều EN).
 * Mã nguồn còn dùng nhiều thuật ngữ tiếng Anh làm nhãn (Pipeline, Deal, SLA, EOD, PIP…) và đó cũng là
 * KHOÁ của từ điển EN trong i18n.js, nên không đổi thẳng trong mã mà thay khi hiển thị.
 * Chạy trên NÚT CHỮ đang hiển thị (và placeholder / title / aria-label), kể cả chữ do máy chủ sinh
 * (cảnh báo, thông báo). Không đụng giá trị trong ô nhập, không đụng email / mã / đường dẫn.
 * Giữ nguyên: tên riêng & dữ liệu (tên khách, tên sản phẩm TVC / Gameshow / TikTok…), thương hiệu
 * (Zalo, Chrome, iPhone…) và các từ viết tắt không có từ Việt tương đương dùng phổ biến: KPI, AI, API,
 * Email, video, logo. */
import { isEn } from './i18n.js';

// [mẫu, thay thế] — theo thứ tự, cụm dài / cụ thể trước. Chữ hoa đầu câu được giữ.
const RULES = [
  ['Settings → System → Notifications', 'Cài đặt → Hệ thống → Thông báo'], ['email/proposal', 'email/đề xuất'], ['tiềm năng/deal/việc', 'tiềm năng/cơ hội/việc'], ['lead/deal/việc', 'khách tiềm năng/cơ hội/việc'],
  ['Bấm tab', 'Bấm thẻ'], ['Gắn link', 'Gắn đường dẫn'], ['Dán link', 'Dán đường dẫn'], ['liên kết', 'liên kết'], ['link', 'đường dẫn'], ['Link', 'Đường dẫn'],
  // Bảng điều hành
  ['Console Trưởng phòng', 'Bảng điều hành Trưởng phòng'], ['Console HCNS', 'Bảng điều hành HCNS'],
  ['Console đội', 'Bảng điều hành đội'], ['Console', 'Bảng điều hành'],
  // Khách hàng / tài liệu
  ['CRM 360° Khách hàng', 'Hồ sơ khách hàng 360°'], ['Khách hàng (CRM)', 'Hồ sơ khách hàng'], ['CRM 360°', 'Hồ sơ khách hàng 360°'], ['CRM', 'hồ sơ khách hàng'],
  ['Sales Kit', 'Bộ tài liệu bán hàng'], ['Sales Admin', 'Trợ lý kinh doanh'],
  // Phễu
  ['Pipeline đội', 'Phễu bán hàng của đội'], ['Pipeline kỳ vọng', 'Giá trị phễu kỳ vọng'], ['pipeline kỳ vọng', 'giá trị phễu kỳ vọng'],
  ['Pipeline KV', 'Phễu kỳ vọng'], ['Giá trị pipeline kỳ vọng', 'Giá trị phễu kỳ vọng'], ['Pipeline', 'Phễu bán hàng'], ['pipeline', 'phễu bán hàng'],
  // Hạn xử lý (SLA)
  ['Deal cần chăm gấp \\(SLA\\)', 'Cơ hội cần chăm sóc gấp'], ['Deal quá hạn SLA', 'Cơ hội quá hạn chăm sóc'], ['Deal quá SLA', 'Cơ hội quá hạn chăm sóc'],
  ['deal quá SLA', 'cơ hội quá hạn chăm sóc'], ['deal vượt SLA', 'cơ hội quá hạn chăm sóc'], ['Leo thang SLA', 'Leo thang quá hạn'], ['Quá SLA nhận việc', 'Quá hạn nhận việc'],
  ['quá SLA nhận việc', 'quá hạn nhận việc'], ['SLA nhận việc', 'hạn nhận việc'], ['Sạch SLA', 'Không có cơ hội quá hạn'], ['Cảnh báo SLA deal', 'Cảnh báo quá hạn chăm sóc'],
  ['SLA deal', 'Hạn chăm sóc cơ hội'], ['Giao việc & SLA', 'Giao việc & hạn xử lý'], ['Tuân thủ SLA deal', 'Tuân thủ hạn chăm sóc cơ hội'], ['vượt SLA', 'quá hạn'], ['quá SLA', 'quá hạn'],
  ['\\(SLA (\\d+)', '(hạn $1'], ['SLA', 'hạn xử lý'], ['sla', 'hạn xử lý'],
  // Cơ hội (deal)
  ['Deal', 'Cơ hội'], ['deal', 'cơ hội'], ['Deals', 'Cơ hội'], ['deals', 'cơ hội'],
  ['Lead mới', 'Khách tiềm năng mới'], ['Lead', 'Khách tiềm năng'], ['lead', 'khách tiềm năng'],
  // Báo cáo cuối ngày
  ['Báo cáo EOD & Tuần', 'Báo cáo cuối ngày & tuần'], ['báo cáo cuối ngày \\(EOD\\)', 'báo cáo cuối ngày'], ['Báo cáo EOD', 'Báo cáo cuối ngày'], ['báo cáo EOD', 'báo cáo cuối ngày'],
  ['nộp EOD', 'nộp báo cáo cuối ngày'], ['\\(EOD\\)', ''], ['EOD', 'báo cáo cuối ngày'],
  // Cải thiện hiệu suất (PIP)
  ['KPI · Hoa hồng · PIP', 'KPI · Hoa hồng · Cải thiện hiệu suất'], ['KPI & PIP', 'KPI & cải thiện hiệu suất'], ['Mốc PIP', 'Mốc cải thiện hiệu suất'],
  ['chương trình cải thiện hiệu suất \\(PIP\\)', 'chương trình cải thiện hiệu suất'], ['kế hoạch cải thiện hiệu suất \\(PIP\\)', 'kế hoạch cải thiện hiệu suất'], ['PIP', 'cải thiện hiệu suất'], ['pip', 'cải thiện hiệu suất'],
  // Vai trò
  ['Admin / Executive Board', 'Quản trị / BGĐ'], ['Admin / BGĐ', 'Quản trị / BGĐ'], ['Admin/BGĐ', 'Quản trị/BGĐ'], ['Admin/TGĐ', 'Quản trị/TGĐ'], ['Admin', 'Quản trị viên'],
  ['Nhân viên Sales', 'Nhân viên kinh doanh'], ['đội sales', 'đội kinh doanh'], ['Kinh nghiệm sale', 'Kinh nghiệm bán hàng'], ['Sale khác', 'Nhân viên kinh doanh khác'],
  ['Sales', 'Kinh doanh'], ['sales', 'kinh doanh'], ['Sale', 'Nhân viên kinh doanh'], ['sale', 'nhân viên kinh doanh'], ['Manager', 'Trưởng phòng'], ['manager', 'quản lý'], ['BOD', 'BGĐ'],
  ['Partner', 'Đối tác'], ['partner', 'đối tác'],
  // Trình diễn
  ['Demo/Thuyết trình', 'Trình diễn/Thuyết trình'], ['Gặp/Demo', 'Gặp/Trình diễn'], ['gặp/demo', 'gặp/trình diễn'], ['Demo', 'Trình diễn'], ['demo', 'trình diễn'],
  // Kênh nguồn khách (hiển thị)
  ['Game Viral', 'Trò chơi lan toả'], ['CTV/KOL', 'Cộng tác viên / Người có ảnh hưởng'], ['KOL', 'người có ảnh hưởng'], ['MGM', 'Khách giới thiệu khách'], ['Review', 'Đánh giá'],
  // Đào tạo
  ['Bài giảng & Test', 'Bài giảng & Bài kiểm tra'], ['Lộ trình & Bài test', 'Lộ trình & Bài kiểm tra'], ['Test', 'Bài kiểm tra'], ['test', 'bài kiểm tra'],
  ['NetViet Academy', 'Học viện NetViet'], ['Coaching', 'Kèm cặp'], ['coaching', 'kèm cặp'],
  // Trợ lý AI & cấu hình
  ['API key', 'khoá API'], ['Keys', 'Khoá'], ['key', 'khoá'], ['Secrets', 'biến bí mật'], ['offline', 'ngoại tuyến'], ['rule-based', 'theo quy tắc'],
  ['Research thầu', 'Tìm hiểu thầu'], ['Research', 'Tìm hiểu'], ['research', 'tìm hiểu'], ['AI soạn proposal', 'AI soạn đề xuất'],
  ['AI score', 'Điểm AI'], ['Score', 'Điểm'], ['score', 'điểm'], ['realtime', 'tức thời'],
  ['call log', 'nhật ký cuộc gọi'], ['\\(mock\\)', '(mô phỏng)'], ['mock', 'mô phỏng'], ['Kanban', 'Dạng cột'], ['follow-up', 'chăm sóc lại'],
  // Ứng dụng
  ['PWA / Web Push', 'ứng dụng web'], ['Web Push', 'thông báo đẩy'], ['PWA', 'ứng dụng web'], ['e-sign', 'ký điện tử'],
  ['app', 'ứng dụng'], ['App', 'Ứng dụng'], ['menu', 'thanh điều hướng'], ['icon', 'biểu tượng'], ['vs', 'so với'], ['All', 'Tất cả'],
  // Mô tả sản phẩm
  ['triệu view', 'triệu lượt xem'], ['setup studio', 'dựng trường quay'], ['seeding', 'lan toả nội dung'], ['shorts', 'video ngắn'],
  ['storyboard', 'kịch bản phân cảnh'], ['\\(AI Generative\\)', '(AI tạo sinh)'], ['Profile công ty', 'Hồ sơ năng lực công ty'], ['(báo giá, )profile', '$1hồ sơ năng lực'],
  // Khoá cấu hình KPI
  ['quota_daily_contacts', 'Định mức liên hệ mới/ngày'], ['quota_calls', 'Định mức cuộc gọi/ngày'], ['quota_meetings', 'Định mức gặp/ngày'],
  ['target_revenue', 'Mục tiêu doanh thu/tháng'], ['target_deals', 'Mục tiêu số cơ hội chốt/tháng'], ['target_pipeline', 'Mục tiêu giá trị phễu'],
  ['discount_threshold', 'Ngưỡng chiết khấu cần duyệt (%)'], ['report_deadline_hour', 'Giờ hạn nộp báo cáo'], ['sla_days', 'Hạn chăm sóc theo giai đoạn (ngày)'],
  ['task_accept_sla_min', 'Hạn nhận việc (phút)'], ['daily_contacts', 'liên hệ mới/ngày'], ['report_on_time', 'báo cáo đúng hạn'],
];
// Chỉ khớp nguyên cả nút chữ (nhãn loại cảnh báo…).
const EXACT = { assignment: 'Giao việc', approval: 'Chờ duyệt', task: 'Công việc', report: 'Báo cáo', tender: 'Đấu thầu', kpi: 'KPI', meeting: 'Lịch hẹn', sales_alert: 'Chỉ số kinh doanh' };

const W = 'A-Za-z0-9_À-ỹ';
const COMPILED = RULES.map(([p, r]) => {
  const src = p.replace(/\s+/g, '\\s+');
  return [new RegExp(`(?<![${W}@./\\-])(${src})(?![${W}@\\-]|\\.[${W}])`, 'g'), r];
});
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

// Tên thương hiệu — không bao giờ đổi.
const PROTECT = ['NetViet Sales OS', 'NetViet Sales', 'Sales OS', 'Google Gemini', 'Anthropic Claude'];
export function viet(s) {
  if (!s || !/[A-Za-z]/.test(s)) return s;
  const ex = EXACT[s.trim()];
  if (ex) return s.replace(s.trim(), ex);
  let out = s;
  const held = [];
  PROTECT.forEach((w) => { if (out.includes(w)) { out = out.split(w).join('\u0000' + held.length + '\u0000'); held.push(w); } });
  for (const [re, rep] of COMPILED) {
    out = out.replace(re, (...m) => {
      const whole = m[0], off = m[m.length - 2], str = m[m.length - 1];
      let r = rep.replace(/\$(\d)/g, (_, i) => m[+i + 1] || '');
      const atStart = !str.slice(0, off).trim() || /[.!?:·—→]\s*$/.test(str.slice(0, off));
      if (atStart || /^[A-Z][a-zà-ỹ]/.test(whole)) r = cap(r);
      return r;
    });
  }
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => held[+i]);
  return out.replace(/ {2,}/g, ' ');
}

const SKIP = 'script,style,textarea,input,code,pre,[data-no-vi],[contenteditable]';
const ATTRS = ['placeholder', 'title', 'aria-label'];
function walk(root) {
  if (isEn() || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.closest && root.closest(SKIP)) { if (root.matches('input,textarea')) for (const a of ATTRS) { const v = root.getAttribute(a); if (v) { const nv = viet(v); if (nv !== v) root.setAttribute(a, nv); } } return; }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n = root;
  do { if (n.nodeType === 3) fixText(n); } while ((n = tw.nextNode()));
  // thuộc tính chữ (kể cả của ô nhập — chỉ nhãn, không đụng giá trị)
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')] : [];
  for (const e of els) {
    if (!e.getAttribute || (e.closest && e.closest('[data-no-vi]'))) continue;
    for (const a of ATTRS) { const v = e.getAttribute(a); if (v) { const nv = viet(v); if (nv !== v) e.setAttribute(a, nv); } }
  }
}
function fixText(t) {
  const p = t.parentElement;
  if (!p || p.closest(SKIP)) return;
  // option: chỉ đổi chữ hiển thị, value giữ nguyên
  const v = t.nodeValue, nv = viet(v);
  if (nv === v) return;
  // option không có value: giữ nguyên giá trị gửi đi bằng chữ gốc
  if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.textContent);
  t.nodeValue = nv;
}

let busy = false;
const mo = new MutationObserver((list) => {
  if (busy || isEn()) return;
  busy = true;
  try {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') walk(m.target);
      else m.addedNodes.forEach(walk);
    }
  } finally { busy = false; }
});
/** Chặn trình duyệt tự dịch (Safari/Chrome từng dịch nhãn thành "Admin / Executive Board") và bắt đầu Việt hoá. */
export function startViet() {
  document.documentElement.setAttribute('translate', 'no');
  const meta = document.createElement('meta'); meta.name = 'google'; meta.content = 'notranslate'; document.head.appendChild(meta);
  walk(document.body);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

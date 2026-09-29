/**
 * Bài kiểm tra sau mỗi video đào tạo — 5 câu, đạt từ 80% (4/5) mới ghi hoàn thành và mở bài sau.
 * Đáp án chỉ nằm ở máy chủ: trình duyệt nhận câu hỏi + lựa chọn, gửi lại lựa chọn, máy chủ chấm.
 * Bộ câu theo NHÓM bài giảng (cột category của nv_trainings); nhóm chưa có bộ riêng dùng bộ chung.
 */
export const PASS_PCT = 80;

const BANK = {
  'Sản phẩm': [
    ['Gói TVC AI 15s giao trong bao lâu?', ['2 ngày', '5 ngày', '14 ngày', '30 ngày'], 1],
    ['Chuỗi Video AI viral gồm bao nhiêu video?', ['5', '10', '12', '20'], 1],
    ['Gói Tài trợ mùa Gameshow gồm bao nhiêu số phát sóng?', ['4', '8', '12', '24'], 2],
    ['Xây kênh TikTok triệu lượt xem sản xuất bao nhiêu video mỗi tháng?', ['4', '8', '12', '30'], 2],
    ['Một phiên Livestream bán hàng cùng người có ảnh hưởng kéo dài bao lâu?', ['1 giờ', '2 giờ', '3 giờ', '5 giờ'], 2]],
  'Quy trình': [
    ['Báo cáo cuối ngày phải nộp trước mấy giờ?', ['16:00', '17:00', '18:00', '20:00'], 1],
    ['Báo giá từ ngưỡng duyệt trở lên phải chờ ai duyệt vòng 2?', ['Trưởng phòng KD', 'Giám đốc / BGĐ', 'HCNS', 'Không cần duyệt'], 1],
    ['Hợp đồng vòng 2 do ai duyệt?', ['Trưởng phòng KD', 'Kế toán', 'HCNS', 'Nhân viên kinh doanh'], 2],
    ['Hạn mặc định để xác nhận nhận việc được giao là bao lâu?', ['30 phút', '60 phút', '120 phút', '1 ngày'], 2],
    ['Cơ hội ở giai đoạn Đàm phán quá bao nhiêu ngày không hoạt động thì bị cảnh báo?', ['2 ngày', '5 ngày', '10 ngày', '30 ngày'], 1]],
  'Quản lý': [
    ['Báo giá có giá trị dưới bao nhiêu thì Trưởng phòng duyệt là xong?', ['10 triệu', '20 triệu', '50 triệu', '100 triệu'], 1],
    ['Nhân viên KPI dưới bao nhiêu điểm thì xem xét kế hoạch cải thiện hiệu suất?', ['40', '60', '80', '90'], 1],
    ['Việc giao chưa được nhận quá hạn thì hệ thống…', ['Tự huỷ việc', 'Cảnh báo và leo thang lên quản lý', 'Tự giao cho người khác', 'Không làm gì'], 1],
    ['Trưởng phòng được xem dữ liệu của…', ['Toàn công ty', 'Nhân viên dưới quyền', 'Chỉ của mình', 'Phòng khác'], 1],
    ['Chấm KPI tháng cho nhân viên ở đâu?', ['Cài đặt', 'Báo cáo › KPI · Hoa hồng', 'Bộ tài liệu bán hàng', 'Hồ sơ nhân sự'], 1]],
  _default: [
    ['Bước đầu tiên khi tiếp cận khách hàng mới là gì?', ['Gửi báo giá ngay', 'Khai thác nhu cầu', 'Giảm giá để giữ khách', 'Gửi hợp đồng'], 1],
    ['Khi khách nói "giá cao", nên xử lý thế nào?', ['Giảm giá ngay', 'Làm rõ giá trị và đề xuất gói phù hợp', 'Bỏ qua khách', 'Chuyển khách cho người khác'], 1],
    ['Mỗi hoạt động với khách nên được ghi ở đâu?', ['Nhớ trong đầu', 'Ghi 1 lần vào Sales OS', 'Nhắn Zalo cho Trưởng phòng', 'Sổ tay cá nhân'], 1],
    ['Cơ hội đã quá hạn chăm sóc nên làm gì?', ['Chờ khách liên hệ lại', 'Liên hệ lại ngay và ghi hoạt động', 'Xoá cơ hội', 'Chuyển sang thua'], 1],
    ['Nhân viên kinh doanh được xem dữ liệu của ai?', ['Toàn công ty', 'Cả phòng', 'Chỉ của chính mình', 'Cả nhóm'], 2]],
};

const bankFor = (category) => BANK[category] || BANK._default;

/** Câu hỏi KHÔNG kèm đáp án — để gửi xuống trình duyệt. */
export const publicQuiz = (category) => bankFor(category).map(([q, opts]) => ({ q, opts }));

/** Chấm điểm: answers là mảng chỉ số lựa chọn theo thứ tự câu. Trả % (0-100). */
export function gradeQuiz(category, answers) {
  const Q = bankFor(category);
  const a = Array.isArray(answers) ? answers : [];
  const right = Q.filter(([, , ok], i) => Number(a[i]) === ok).length;
  return Math.round(right / Q.length * 100);
}

/**
 * Danh sách bài giảng THEO THỨ TỰ HỌC của một người — dùng chung cho màn Lộ trình và cho việc kiểm
 * tra mở khoá ở máy chủ, để thứ tự hai bên luôn khớp. Cấp quản lý học bài quản lý + bài bắt buộc
 * của nhân viên; còn lại học bài của nhân viên.
 */
export function orderLessons(all, role) {
  const target = ['manager', 'admin'].includes(role) ? 'manager' : 'sales';
  return (all || [])
    .filter(t => t.role_target === target || (target === 'manager' && t.role_target === 'sales' && t.required))
    .sort((a, b) => (b.required - a.required) || String(a.category || '').localeCompare(String(b.category || ''))
      || (a.created_at - b.created_at) || String(a.id).localeCompare(String(b.id)));
}

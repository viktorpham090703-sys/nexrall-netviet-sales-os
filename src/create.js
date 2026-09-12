import { sheet } from './ui.js';
import { quickContact } from './views/cockpit.js';
import { logActivity, newCustomer } from './views/crm.js';
import { newDeal } from './views/pipeline.js';
import { newTask } from './views/tasks.js';

/* Sheet "Tạo mới" — nút giữa thanh điều hướng dưới (điện thoại). Không có form riêng: mỗi mục gọi
 * đúng modal đang dùng ở các trang (Cockpit, CRM, Pipeline, Việc, Hoạt động), nên nghiệp vụ và
 * kiểm tra dữ liệu chỉ có một chỗ. */

/** Vẽ lại view hiện tại sau khi tạo xong (Cockpit cập nhật định mức, CRM có khách mới…) — dùng đúng
 * cơ chế hashchange → render() của app.js, không cần view nào phải lộ hàm render ra ngoài. */
const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export function openCreateSheet() {
  sheet({
    title: 'Tạo mới',
    subtitle: 'Bạn muốn tạo gì?',
    items: [
      { key: 'contact', icon: 'userPlus', tone: 'amber', title: 'Liên hệ mới', desc: 'Thêm lead / khách hàng tiềm năng', onSelect: () => quickContact(refresh) },
      { key: 'customer', icon: 'briefcase', tone: 'blue', title: 'Khách hàng', desc: 'Tạo doanh nghiệp / khách hàng', onSelect: () => newCustomer(refresh) },
      { key: 'deal', icon: 'trendingUp', tone: 'red', title: 'Deal mới', desc: 'Tạo cơ hội bán hàng', onSelect: () => newDeal(refresh) },
      { key: 'task', icon: 'listChecks', tone: 'green', title: 'Công việc', desc: 'Tạo task / lịch hẹn', onSelect: () => newTask(refresh) },
      { key: 'activity', icon: 'phone', tone: 'grey', title: 'Ghi nhận hoạt động', desc: 'Ghi cuộc gọi, demo, gặp mặt…', onSelect: () => logActivity({}, refresh) },
    ],
  });
}

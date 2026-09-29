/* Hệ thống › Thiết lập AI trợ lý (Admin / BGĐ): bật/tắt, phạm vi dữ liệu AI được đọc, mô hình AI
 * mặc định, câu hỏi gợi ý cho nhân viên. Lưu ở /api/settings/ai; máy chủ áp dụng khi xử lý
 * /api/ai/chat (server/routes/misc.js). Trạng thái nhà cung cấp AI lấy từ /api/ai/tasks. */
import { get, put } from '../api.js';
import { state } from '../state.js';
import { esc, mount, chip, toast, modal } from '../ui.js';
import { icon } from '../icons.js';
import { t as tr } from '../i18n.js';

const TOGGLES = [
  ['on', 'Bật AI trợ lý cho toàn công ty', 'Tắt thì mục AI Trợ lý biến khỏi menu của mọi người (trừ Admin) và máy chủ từ chối yêu cầu AI'],
  ['readCrm', 'Cho AI đọc dữ liệu khách hàng', 'Luôn theo đúng phạm vi dữ liệu của người hỏi (nhân viên chỉ đọc được khách của mình)'],
  ['readKit', 'Cho AI đọc bảng giá & gói dịch vụ', 'Để AI soạn báo giá, email chào giá đúng giá niêm yết của công ty'],
  ['history', 'Lưu nội dung hỏi đáp', 'Để Trưởng phòng xem lại khi kèm cặp. Tắt thì chỉ ghi số lần dùng (vẫn tính KPI "Dùng AI hỗ trợ")'],
];

export async function render(el) {
  if (state.me.role !== 'admin') {
    el.innerHTML = `<div class="card" style="text-align:center;padding:28px">${icon('lock', 36)}<div class="b mt">${tr('Chỉ Admin / Ban Giám đốc')}</div></div>`;
    return;
  }
  const load = async () => {
    const [ai, s] = await Promise.all([get('/ai/tasks'), get('/settings')]);
    return { ai, s: s.ai || {} };
  };
  const draw = ({ ai, s }) => `<div class="page-head"><div class="grow"><h2>${tr('Thiết lập AI trợ lý')}</h2>
        <p>${tr('Bật/tắt, phạm vi dữ liệu AI được đọc, mô hình AI và câu hỏi gợi ý cho nhân viên')}</p></div>
        <a class="btn sm" href="#/ai">${icon('bot', 14)} ${tr('Mở AI Trợ lý')}</a></div>
      <div class="grid g2 dm-grid">
        <div class="card"><b>${tr('Quyền & phạm vi')}</b>
          ${TOGGLES.map(([k, t, h]) => `<div class="ai-row"><div class="grow"><div class="b sm">${esc(tr(t))}</div><div class="xs mut">${esc(tr(h))}</div></div>
            <label class="ai-tg"><input type="checkbox" data-tg="${k}" ${s[k] ? 'checked' : ''} aria-label="${esc(tr(t))}"><span></span></label></div>`).join('')}
        </div>
        <div class="card"><b>${tr('Mô hình AI mặc định')}</b>
          <div class="xs mut mb">${tr('Khoá API do quản trị kỹ thuật cấu hình trên máy chủ, không nhập trên giao diện.')}</div>
          ${(ai.providers || []).map(p => `<label class="ai-prov"><input type="radio" name="prov" value="${esc(p.key)}" ${s.provider === p.key ? 'checked' : ''}>
            <span class="grow"><span class="b sm">${esc(p.icon || '')} ${esc(p.label)}</span><br><span class="xs mut">${esc(p.model || '')}</span></span>
            ${p.configured ? chip('Sẵn sàng', 'green') : chip('Chưa có khoá API', 'grey')}</label>`).join('')}
          <label class="ai-prov"><input type="radio" name="prov" value="auto" ${!s.provider || s.provider === 'auto' ? 'checked' : ''}><span class="grow"><span class="b sm">${tr('Tự động')}</span><br><span class="xs mut">${tr('Dùng mô hình đang sẵn sàng — hiện tại:')} ${esc(ai.active || 'mock')}</span></span></label>
          <div class="sec-title">${tr('Tác vụ AI đang có')}</div>
          <div class="row wrap" style="gap:6px">${(ai.tasks || []).map(t => chip(t.label, 'blue')).join('')}</div>
        </div>
      </div>
      <div class="card mt"><div class="row"><b>${tr('Câu hỏi gợi ý hiện cho nhân viên')}</b><span class="grow"></span><button type="button" class="btn sm" data-p-add>+ ${tr('Thêm câu gợi ý')}</button></div>
        <div class="tk-files mt">${(s.prompts || []).map((q, i) => `<div class="tk-file">${icon('sparkles', 14)}<span class="grow">${esc(q)}</span><button type="button" class="btn sm" data-p-del="${i}">${tr('Gỡ')}</button></div>`).join('')
          || `<div class="sm mut">${tr('Chưa có câu gợi ý nào.')}</div>`}</div></div>`;

  const save = async (patchObj, msg) => {
    try {
      await put('/settings/ai', patchObj);
      state.settings.ai = { ...(state.settings.ai || {}), ...patchObj };
      toast(msg, 'ok');
      return true;
    } catch (e) { toast(e.message, 'err'); return false; }
  };

  const bind = ({ s }) => {
    el.querySelectorAll('[data-tg]').forEach(c => c.onchange = async () => {
      if (!(await save({ [c.dataset.tg]: c.checked }, tr('Đã lưu thiết lập AI')))) c.checked = !c.checked;
    });
    el.querySelectorAll('input[name=prov]').forEach(r => r.onchange = () => save({ provider: r.value }, tr('Đã chọn mô hình AI mặc định')));
    el.querySelectorAll('[data-p-del]').forEach(b => b.onclick = async () => {
      const prompts = (s.prompts || []).filter((_, i) => i !== +b.dataset.pDel);
      if (await save({ prompts }, tr('Đã gỡ câu gợi ý'))) render(el);
    });
    el.querySelector('[data-p-add]').onclick = () => modal({
      title: 'Thêm câu gợi ý', fields: [{ name: 'q', label: 'Câu hỏi', required: true }],
      onSubmit: async (v) => { if (!(await save({ prompts: [...(s.prompts || []), v.q.trim()] }, tr('Đã thêm câu gợi ý')))) return false; render(el); },
    });
  };
  await mount(el, load, draw, bind);
}

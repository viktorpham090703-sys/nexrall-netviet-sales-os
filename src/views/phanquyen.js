/* Hệ thống › Phân quyền: theo CẤP · theo TÍNH NĂNG (từng tài khoản) · theo THAO TÁC (Xem / Thêm /
 * Sửa / Xoá / Tải tài liệu) · NGƯỠNG DUYỆT báo giá (dưới ngưỡng Trưởng phòng duyệt là xong, từ ngưỡng
 * trở lên phải qua Giám đốc chuyên môn = Admin/BGĐ). Mô hình quyền do máy chủ trả (/api/permissions)
 * và máy chủ cũng là nơi chặn thật (server/lib/perm.js). */
import { get, put } from '../api.js';
import { state, isLead, boot } from '../state.js';
import { esc, mount, chip, toast, money, empty } from '../ui.js';
import { icon } from '../icons.js';
import { t as tr, personName } from '../i18n.js';
import { roleLabel } from '../const.js';

let tab = null, opsLevel = null, simAmt = 35000000, simType = 'Báo giá';

export async function render(el) {
  const load = async () => {
    const [m, team] = await Promise.all([get('/permissions'), isLead() ? get('/team').catch(() => ({})) : {}]);
    return { m, team };
  };

  const draw = ({ m, team }) => {
    const manage = m.canEdit || isLead();
    if (!tab) tab = manage ? 'level' : 'mine';
    if (!opsLevel) opsLevel = m.myLevel;
    return `<div class="page-head"><div class="grow"><h2>${manage ? tr('Phân quyền & Ngưỡng duyệt') : tr('Quyền của tôi')}</h2>
        <p>${tr('Phân quyền theo cấp · theo tính năng · theo thao tác · ngưỡng duyệt chiết khấu, báo giá')}</p></div></div>
      <div class="st-tabs" role="tablist">
        ${!manage ? `<button type="button" data-tab="mine" class="${tab === 'mine' ? 'on' : ''}">${icon('user', 15)} ${tr('Quyền của tôi')}</button>` : ''}
        <button type="button" data-tab="level" class="${tab === 'level' ? 'on' : ''}">${icon('usersRound', 15)} ${tr('Theo cấp')}</button>
        ${manage ? `<button type="button" data-tab="feat" class="${tab === 'feat' ? 'on' : ''}">${icon('slidersHorizontal', 15)} ${tr('Theo tính năng')}</button>
        <button type="button" data-tab="ops" class="${tab === 'ops' ? 'on' : ''}">${icon('listChecks', 15)} ${tr('Theo thao tác')}</button>` : ''}
        <button type="button" data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">${icon('shieldCheck', 15)} ${tr('Ngưỡng duyệt')}</button>
      </div>
      ${tab === 'mine' ? mineView(m) : tab === 'level' ? levelView(m) : tab === 'feat' ? featView(m) : tab === 'ops' ? opsView(m) : approveView(m, team)}`;
  };

  const levelView = (m) => `<div class="xs mut mb">${tr('Chuỗi cấp: Admin › BOD › Giám đốc bộ phận › Trưởng phòng › Trưởng nhóm › Nhân viên › Thực tập. Cấp trên xem được dữ liệu của cấp dưới trong phạm vi của mình.')}</div>
    <div class="tbl-wrap"><table><thead><tr><th>${tr('Cấp')}</th><th>${tr('Phạm vi dữ liệu')}</th><th>${tr('Quyền chính')}</th><th>${tr('Tài khoản')}</th></tr></thead><tbody>
    ${m.levels.map(L => { const mine = m.myLevel === L.k || (L.k === 'bod' && m.myLevel === 'admin'); return `<tr class="${mine ? 'pq-me' : ''}">
      <td><b>${esc(L.n)}</b>${mine ? ' ' + chip('Bạn', 'blue') : ''}</td><td class="sm">${esc(L.scope)}</td><td class="sm">${esc(L.rights)}</td>
      <td class="sm">${L.k === 'bod' ? `<span class="mut">${tr('Dùng chung vai trò Admin')}</span>` : !L.role ? `<span class="mut">— ${tr('cấp mới, chưa có tài khoản')}</span>`
        : L.users.length ? L.users.map(u => esc(personName(u.name))).join(', ') : '<span class="mut">—</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>`;

  const featView = (m) => `<div class="row mb"><span class="sm grow">${m.canEdit
      ? tr('Tích / bỏ tích để cấp hoặc thu hồi tính năng cho từng tài khoản. Bỏ tích là tính năng biến mất khỏi menu và bị chặn mọi thao tác ghi.')
      : tr('Bạn chỉ xem được. Admin / HCNS mới cấp quyền theo tính năng.')}</span>
      ${m.canEdit ? `<button type="button" class="btn sm primary" data-save-feat>${tr('Lưu phân quyền')}</button>` : ''}</div>
    <div class="tbl-wrap pq-mx"><table><thead><tr><th>${tr('Tài khoản')}</th>${m.features.map(([, n]) => `<th class="c">${esc(n)}</th>`).join('')}</tr></thead><tbody>
      ${(m.users || []).map(u => {
        const locked = !m.canEdit || u.role === 'admin' || (state.me.role !== 'admin' && u.id === state.me.id);
        return `<tr><td><b>${esc(personName(u.name))}</b><div class="xs mut">${esc(roleLabel(u))}</div></td>
        ${m.features.map(([k, n]) => `<td class="c"><input type="checkbox" data-f="${esc(u.id)}|${k}" ${u.feat[k] ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(personName(u.name))} · ${esc(n)}"></td>`).join('')}</tr>`; }).join('')}
    </tbody></table></div>
    <div class="xs mut mt">${tr('Tài khoản Admin luôn có toàn quyền. Mọi thay đổi được ghi nhật ký kiểm toán.')}</div>`;

  const opsView = (m) => {
    const lockedLv = !m.canEdit || opsLevel === 'admin' || opsLevel === 'bod' || (state.me.role !== 'admin' && opsLevel === 'hcns');
    return `<div class="row mb" style="gap:10px;flex-wrap:wrap"><label class="sm row" style="gap:6px">${tr('Cấp')}
        <select data-ops-level class="pq-sel">${m.levels.map(L => `<option value="${L.k}" ${L.k === opsLevel ? 'selected' : ''}>${esc(L.n)}</option>`).join('')}</select></label>
        <span class="grow xs mut">${opsLevel === 'admin' || opsLevel === 'bod' ? tr('Admin / BGĐ luôn toàn quyền.') : ''}</span>
        ${m.canEdit && !lockedLv ? `<button type="button" class="btn sm primary" data-save-ops>${tr('Lưu quyền thao tác')}</button>` : ''}</div>
      <div class="tbl-wrap pq-mx"><table><thead><tr><th>${tr('Tính năng')}</th>${m.ops.map(o => `<th class="c">${esc(o)}</th>`).join('')}</tr></thead><tbody>
        ${m.features.map(([k, n]) => `<tr><td>${esc(n)}</td>${((m.opsMatrix[opsLevel] || {})[k] || [0, 0, 0, 0, 0]).map((x, i) => `<td class="c"><input type="checkbox" data-op="${k}|${i}" ${x ? 'checked' : ''} ${lockedLv ? 'disabled' : ''} aria-label="${esc(n)} ${esc(m.ops[i])}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="xs mut mt">${tr('Máy chủ chặn thật theo bảng này: Thêm = tạo mới, Sửa = cập nhật / duyệt, Xoá = xoá, Tải tài liệu = tải tệp gốc về máy. Quyền chỉ thu hẹp được so với vai trò, không mở rộng.')}</div>`;
  };

  const approveView = (m, team) => {
    const thr = m.threshold, hi = simAmt >= thr;
    const route = (v) => v >= thr ? tr('Giám đốc chuyên môn (BGĐ)') : tr('Trưởng phòng');
    const pend = (team.pendingQuotes || []).map(q => ({ title: q.title, owner: q.owner_name, value: q.total || 0, disc: q.discount_pct || 0, status: q.status }));
    return `<div class="grid g2 dm-grid mb">
      <div class="card"><b>${tr('Quy tắc duyệt báo giá')}</b>
        <div class="tbl-wrap mt"><table><thead><tr><th>${tr('Giá trị báo giá')}</th><th>${tr('Người duyệt cuối')}</th></tr></thead><tbody>
          <tr><td>${tr('Dưới')} ${money(thr)}</td><td><b>${tr('Trưởng phòng')}</b></td></tr>
          <tr><td>${tr('Từ')} ${money(thr)} ${tr('trở lên')}</td><td><b>${tr('Trưởng phòng')} → ${tr('Giám đốc chuyên môn (BGĐ)')}</b></td></tr></tbody></table></div>
        <div class="xs mut mt">${tr('Áp dụng cho báo giá có chiết khấu vượt ngưỡng cần duyệt. Hợp đồng vẫn duyệt Trưởng phòng → HCNS như hiện tại.')}</div>
        ${m.canEditThreshold ? `<div class="row mt" style="gap:8px;flex-wrap:wrap"><label class="sm row" style="gap:6px">${tr('Ngưỡng')} <input data-thr type="number" min="1" step="1" value="${thr / 1e6}" class="pq-sel" style="width:90px"> ${tr('triệu')}</label><button type="button" class="btn sm" data-save-thr>${tr('Lưu ngưỡng')}</button></div>` : ''}
      </div>
      <div class="card"><b>${tr('Thử luồng duyệt')}</b>
        <div class="grid g2 mt"><label class="f"><span>${tr('Loại hồ sơ')}</span><select data-sim-type>${['Chiết khấu khách', 'Báo giá'].map(x => `<option value="${x}" ${x === simType ? 'selected' : ''}>${tr(x)}</option>`).join('')}</select></label>
          <label class="f"><span>${tr('Giá trị (triệu đồng)')}</span><input data-sim-amt type="number" min="0" value="${simAmt / 1e6}"></label></div>
        <div class="pq-route"><span class="pq-st">${tr('Nhân viên gửi')} ${esc(tr(simType).toLowerCase())} ${money(simAmt)}</span><span class="mut">→</span>
          <span class="pq-st ${hi ? '' : 'hit'}">${tr('Trưởng phòng duyệt')}${hi ? ' ' + tr('vòng 1') : ''}</span>${hi ? `<span class="mut">→</span><span class="pq-st hit">${tr('Giám đốc chuyên môn duyệt vòng 2')}</span>` : ''}</div>
      </div></div>
    ${isLead() ? `<div class="sec-title">${tr('Báo giá đang chờ duyệt')}</div>
      ${pend.length ? `<div class="tbl-wrap"><table><thead><tr><th>${tr('Báo giá')}</th><th>${tr('Người gửi')}</th><th class="num">${tr('Giá trị')}</th><th>${tr('Người duyệt cuối')}</th></tr></thead><tbody>
        ${pend.map(p => `<tr><td><b>${esc(p.title || '')}</b><div class="xs mut">${tr('chiết khấu')} ${p.disc}% · ${p.status === 'pending_v2' ? tr('chờ vòng 2') : tr('chờ vòng 1')}</div></td><td>${esc(personName(p.owner || ''))}</td><td class="num">${money(p.value)}</td>
          <td>${chip(route(p.value), p.value >= thr ? 'red' : 'blue')}</td></tr>`).join('')}</tbody></table></div>` : empty('circleCheck', 'Không có báo giá nào đang chờ duyệt.')}` : ''}`;
  };

  const mineView = (m) => {
    const L = m.levels.find(x => x.k === m.myLevel) || m.levels[0];
    const ops = m.opsMatrix[m.myLevel] || {};
    return `<div class="card mb"><div class="row"><b>${esc(L.n)}</b> ${chip('Cấp của bạn', 'blue')}</div>
        <div class="sm mt"><b>${tr('Phạm vi dữ liệu:')}</b> ${esc(L.scope)}</div><div class="sm"><b>${tr('Quyền chính:')}</b> ${esc(L.rights)}</div></div>
      <div class="tbl-wrap"><table><thead><tr><th>${tr('Tính năng')}</th>${m.ops.map(o => `<th class="c">${esc(o)}</th>`).join('')}</tr></thead><tbody>
        ${m.features.filter(([k]) => m.myFeat[k]).map(([k, n]) => `<tr><td>${esc(n)}</td>${(ops[k] || []).map(x => `<td class="c">${x ? icon('circleCheck', 15, { style: 'color:var(--ok)' }) : '<span class="mut">—</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  };

  // Lưu xong thì nạp lại bootstrap để menu của chính người đang sửa (nếu bị ảnh hưởng) cập nhật theo.
  const saved = async (msg) => { toast(msg, 'ok'); try { await boot(); } catch (e) { /* menu cập nhật ở lần tải sau */ } render(el); };

  const bind = ({ m }) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    const sf = el.querySelector('[data-save-feat]');
    if (sf) sf.onclick = async () => {
      const feat = {};
      el.querySelectorAll('[data-f]:not(:disabled)').forEach(c => { const [uid, k] = c.dataset.f.split('|'); (feat[uid] = feat[uid] || {})[k] = c.checked; });
      try { await put('/permissions', { feat }); saved(tr('Đã lưu phân quyền theo tính năng')); } catch (e) { toast(e.message, 'err'); }
    };
    const ol = el.querySelector('[data-ops-level]'); if (ol) ol.onchange = () => { opsLevel = ol.value; render(el); };
    const so = el.querySelector('[data-save-ops]');
    if (so) so.onclick = async () => {
      const row = Object.fromEntries(m.features.map(([k]) => [k, m.ops.map((_, i) => (el.querySelector(`[data-op="${k}|${i}"]`).checked ? 1 : 0))]));
      try { await put('/permissions', { ops: { [opsLevel]: row } }); saved(tr('Đã lưu quyền thao tác cho cấp') + ' ' + (m.levels.find(x => x.k === opsLevel) || {}).n); }
      catch (e) { toast(e.message, 'err'); }
    };
    const st = el.querySelector('[data-sim-type]'); if (st) st.onchange = () => { simType = st.value; render(el); };
    const sa = el.querySelector('[data-sim-amt]'); if (sa) sa.onchange = () => { simAmt = Math.max(0, Number(sa.value) || 0) * 1e6; render(el); };
    const thr = el.querySelector('[data-save-thr]');
    if (thr) thr.onclick = async () => {
      const n = Number(el.querySelector('[data-thr]').value);
      if (!(n >= 1)) { toast(tr('Ngưỡng phải từ 1 triệu trở lên'), 'err'); return; }
      try { await put('/permissions', { threshold: Math.round(n * 1e6) }); saved(tr('Đã lưu ngưỡng duyệt') + ' ' + n + ' ' + tr('triệu')); } catch (e) { toast(e.message, 'err'); }
    };
  };

  await mount(el, load, draw, bind);
}

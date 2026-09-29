import { get, post, patch, del } from '../api.js';
import { isLead, isAdmin } from '../state.js';
import { esc, money, vnd, mount, chip, stat, modal, toast, bindTabs, confirmDialog, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { t as tr, tf } from '../i18n.js';

/**
 * Sales Kit — thư viện tra cứu của phòng kinh doanh: bảng gói dịch vụ và cơ chế hoa hồng Partner.
 *
 * Báo giá, hợp đồng và AI soạn proposal đã chuyển sang "Phương án kinh doanh" (views/plans.js) để
 * mỗi thương vụ chỉ còn MỘT luồng trình duyệt. Những gì ở lại đây đều là dữ liệu tra cứu — dùng
 * được cả khi chưa có thương vụ nào — nên trang này không còn tạo bản ghi gì.
 */

let tab = 'catalog';
/* Mục con trong "Quản lý sản phẩm/dịch vụ": 'list' = Gói dịch vụ · 'manage' = Quản lý (chỉ BGĐ). */
let sub = 'list';

export async function render(el) {
  const load = async () => {
    const [p, cus, d, pt, ln, us, au] = await Promise.all([
      get('/products' + (isAdmin() ? '?includeInactive=1' : '')),
      get('/customers'), get('/deals'), get('/partners'), get('/product-lines'),
      isAdmin() ? get('/products/usage') : { usage: {} },
      isAdmin() ? get('/audit').catch(() => ({ items: [] })) : { items: [] },
    ]);
    if (tab === 'manage') { tab = 'catalog'; sub = 'manage'; }
    if (!isAdmin()) sub = 'list';
    return {
      lines: ln.items || [], usage: us.usage || {},
      history: (au.items || []).filter(a => a.entity === 'product' || a.entity === 'product_line').slice(0, 12),
      products: p.items || [], threshold: p.discountThreshold, partnerScheme: p.partnerScheme || {},
      customers: cus.items || [], deals: d.items || [], partners: pt.items || [],
    };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Sales Kit</h2><p>${tr('Bảng gói dịch vụ · công cụ nhẩm giá &amp; hoa hồng · cơ chế chia hoa hồng Partner')}</p></div>
  </div>

  <div class="seg mb">
    <button data-tab="catalog" class="${tab === 'catalog' ? 'on' : ''}">Quản lý sản phẩm/dịch vụ</button>
    <button data-tab="partnerComm" class="${tab === 'partnerComm' ? 'on' : ''}">${tr('Hoa hồng Partner')}</button>
  </div>

  ${tab === 'catalog' ? `${isAdmin() ? `<div class="sk-sub mb" role="tablist">
      <button type="button" role="tab" data-sub="list" class="${sub === 'list' ? 'on' : ''}" aria-selected="${sub === 'list'}">${icon('package', 15)} ${tr('Gói dịch vụ')}</button>
      <button type="button" role="tab" data-sub="manage" class="${sub === 'manage' ? 'on' : ''}" aria-selected="${sub === 'manage'}">${icon('slidersHorizontal', 15)} Quản lý</button>
    </div>` : ''}${sub === 'manage' ? manageTab(d) : catalogTab(d)}` : ''}

  ${tab === 'partnerComm' ? partnerCommissionTab(d) : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-calc]').forEach(b => b.onclick = () => estimateModal(d, b.dataset.calc));
    el.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => rateModal(
      b.dataset.rate, Number(b.dataset.partner) || 0, Number(b.dataset.sale) || 0, () => render(el)));

    el.querySelectorAll('[data-addproduct]').forEach(b => b.onclick = () => productModal(d, null, () => render(el)));
    el.querySelectorAll('[data-dupproduct]').forEach(b => b.onclick = () => productModal(
      d, d.products.find(x => x.id === b.dataset.dupproduct), () => render(el), true));
    el.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { sub = b.dataset.sub; render(el); });
    el.querySelectorAll('[data-propose]').forEach(b => b.onclick = () => proposeModal(d));
    el.querySelectorAll('[data-delproduct]').forEach(b => b.onclick = () => {
      const pr = d.products.find(x => x.id === b.dataset.delproduct);
      confirmDialog('Xoá hẳn sản phẩm / dịch vụ',
        `"${pr.name}" sẽ bị xoá khỏi danh mục và không khôi phục được. Chỉ nên xoá gói tạo nhầm; gói đã từng bán thì dùng "Ngừng bán".`,
        async () => {
          try { await del('/products/' + pr.id + '?hard=1'); toast('Đã xoá ' + pr.name, 'ok'); render(el); }
          catch (e) { toast(e.message, 'err'); return false; }
        });
    });
    el.querySelectorAll('[data-addline]').forEach(b => b.onclick = () => modal({
      title: 'Thêm sản phẩm, dịch vụ mới',
      html: '<div class="note mb">Sản phẩm, dịch vụ là nhóm lớn công ty cung cấp, ví dụ: TVC/Video, Gameshow, Xây kênh, Tổ chức sự kiện… Sau khi thêm, tạo các gói dịch vụ bên trong ở phần 2.</div>',
      fields: [{ name: 'name', label: 'Tên sản phẩm, dịch vụ', required: true, placeholder: 'VD: Tổ chức sự kiện' }],
      submitText: 'Thêm sản phẩm, dịch vụ',
      onSubmit: async (v) => {
        try { await post('/product-lines', { name: v.name.trim() }); toast('Đã thêm sản phẩm, dịch vụ: ' + v.name.trim(), 'ok'); render(el); }
        catch (e) { toast(e.message, 'err'); return false; }
      },
    }));
    el.querySelectorAll('[data-renameline]').forEach(b => b.onclick = () => modal({
      title: 'Đổi tên sản phẩm, dịch vụ',
      fields: [{ name: 'to', label: 'Tên mới', required: true, value: b.dataset.renameline }],
      html: '<div class="xs mut">Mọi gói dịch vụ bên trong được chuyển theo tên mới.</div>',
      onSubmit: async (v) => {
        try { await patch('/product-lines', { from: b.dataset.renameline, to: v.to.trim() }); toast('Đã đổi tên sản phẩm, dịch vụ', 'ok'); render(el); }
        catch (e) { toast(e.message, 'err'); return false; }
      },
    }));
    el.querySelectorAll('[data-delline]').forEach(b => b.onclick = () => {
      const ln = d.lines.find(x => x.name === b.dataset.delline);
      const others = d.lines.filter(x => x.name !== ln.name);
      if (!ln.total) return confirmDialog('Xoá sản phẩm, dịch vụ', `Xoá "${ln.name}"? Bên trong không còn gói dịch vụ nào.`, async () => {
        try { await del('/product-lines?name=' + encodeURIComponent(ln.name)); toast('Đã xoá ' + ln.name, 'ok'); render(el); }
        catch (e) { toast(e.message, 'err'); return false; }
      });
      modal({
        title: 'Xoá sản phẩm, dịch vụ: ' + ln.name,
        html: `<div class="note mb">"${esc(ln.name)}" còn <b>${ln.total} gói dịch vụ</b>. Chọn nơi chuyển các gói sang trước khi xoá — báo giá cũ không bị ảnh hưởng.</div>`,
        fields: [{ name: 'moveTo', label: 'Chuyển các gói dịch vụ sang', type: 'select', options: others.map(x => ({ v: x.name, n: x.name })) }],
        submitText: 'Chuyển gói & xoá',
        onSubmit: async (v) => {
          try { await del('/product-lines?name=' + encodeURIComponent(ln.name) + '&moveTo=' + encodeURIComponent(v.moveTo)); toast(`Đã chuyển ${ln.total} gói sang ${v.moveTo} và xoá ${ln.name}`, 'ok'); render(el); }
          catch (e) { toast(e.message, 'err'); return false; }
        },
      });
    });
    // Lọc danh mục tại chỗ (ẩn/hiện hàng) để ô tìm kiếm không mất con trỏ khi gõ.
    const mg = el.querySelector('[data-mg]');
    if (mg) {
      const apply = () => {
        const q = (mg.querySelector('[data-mg-q]').value || '').trim().toLowerCase();
        const ln = mg.querySelector('[data-mg-line]').value, st = mg.querySelector('[data-mg-st]').value;
        let n = 0;
        mg.querySelectorAll('[data-mg-row]').forEach(r => {
          const ok = (!q || r.dataset.q.includes(q)) && (!ln || r.dataset.line === ln) && (st === 'all' || r.dataset.st === st);
          r.hidden = !ok; if (ok) n++;
        });
        mg.querySelector('[data-mg-n]').textContent = n;
        mg.querySelector('[data-mg-empty]').hidden = !!n;
      };
      mg.querySelectorAll('input,select').forEach(i => i.addEventListener('input', apply));
    }
    el.querySelectorAll('[data-editproduct]').forEach(b => b.onclick = () => productModal(
      d, d.products.find(x => x.id === b.dataset.editproduct), () => render(el)));
    el.querySelectorAll('[data-stopproduct]').forEach(b => b.onclick = () => {
      const pr = d.products.find(x => x.id === b.dataset.stopproduct);
      confirmDialog('Ngừng bán gói dịch vụ',
        tf(() => `"${pr.name}" sẽ không còn xuất hiện khi lập báo giá. Báo giá và hoa hồng đã ghi nhận giữ nguyên, và bạn bán lại được bất cứ lúc nào.`,
          () => `"${pr.name}" will no longer appear when creating quotes. Existing quotes and recorded commissions stay unchanged, and you can resume selling it anytime.`),
        async () => {
          try { await del('/products/' + pr.id); toast(tf(() => 'Đã ngừng bán ' + pr.name, () => 'Stopped selling ' + pr.name), 'ok'); render(el); }
          catch (e) { toast(e.message, 'err'); return false; }
        });
    });
    el.querySelectorAll('[data-resellproduct]').forEach(b => b.onclick = async () => {
      try { await patch('/products/' + b.dataset.resellproduct, { active: 1 }); toast('Đã bán lại gói này', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
  };

  await mount(el, load, draw, bind);
}

/* Ba dòng dịch vụ chuẩn của công ty, giữ đúng thứ tự này khi hiển thị. KHÔNG dùng làm danh sách
 * đóng: catalogTab() gom thêm mọi dòng lạ có trong dữ liệu và xếp sau, để một gói đặt sai dòng
 * không âm thầm biến mất khỏi bảng giá — trước đây bảng chỉ lặp đúng 3 tên cứng nên gói thuộc
 * dòng khác thì không hiện ở đâu cả. */
const BASE_LINES = ['TVC/Video', 'Gameshow', 'Xây kênh'];
const lineIcon = (line) => line === 'Gameshow' ? 'clapperboard' : line === 'Xây kênh' ? 'trendingUp'
  : line === 'TVC/Video' ? 'video' : 'files';

/** Bảng gói dịch vụ. Admin thêm/sửa/ngừng bán ngay tại đây; vai trò khác chỉ tra cứu và nhẩm giá. */
function catalogTab(d) {
  const admin = isAdmin();
  const LINES = d.lines.length ? d.lines.map(x => x.name) : BASE_LINES;
  const known = new Set(LINES);
  const extra = [...new Set(d.products.map(p => p.line).filter(l => l && !known.has(l)))].sort();
  const groups = [...LINES, ...extra, ...(d.products.some(p => !p.line) ? [''] : [])];

  const row = (p) => `<div class="item"${p.active ? '' : ' style="opacity:.55"'}>
    <div class="dot-i">${icon(lineIcon(p.line))}</div>
    <div class="grow"><div class="t">${esc(p.name)} ${p.active ? '' : chip('Ngừng bán', 'grey')}</div>
      <div class="d">${esc(p.description || '')}</div>
      <div class="row wrap mt" style="gap:6px">${chip(vnd(p.price) + '/' + esc(tr(p.unit || 'gói')), 'blue')}
        ${chip(tr('HH') + ' ' + p.commission_rate + '%', 'green')}${chip(tr('CK tối đa') + ' ' + p.max_discount + '%', 'amber')}</div></div>
    <div class="right">
      ${p.active ? `<button class="btn sm" data-calc="${esc(p.id)}">${tr('Tính giá')}</button>` : ''}
      ${admin ? `<div class="mt"><button class="btn sm" data-editproduct="${esc(p.id)}">${tr('Sửa')}</button></div>
        <div class="mt">${p.active
          ? `<button class="btn sm" data-stopproduct="${esc(p.id)}">${tr('Ngừng bán')}</button>`
          : `<button class="btn sm amber" data-resellproduct="${esc(p.id)}">${tr('Bán lại')}</button>`}</div>` : ''}
    </div></div>`;

  return `${admin
    ? `<button class="btn primary mb" data-addproduct>+ ${tr('Thêm gói dịch vụ')}</button>`
    : `<div class="note mb row wrap" style="gap:8px"><span class="grow">${tr('Bảng giá do Ban Giám đốc quản lý. Cần thêm hoặc sửa gói, đề nghị Admin/BGĐ cập nhật tại đây.')}</span>
        <button class="btn sm" data-propose>${icon('lightbulb', 14)} Đề xuất sản phẩm / dịch vụ mới</button></div>`}
  ${groups.map(line => {
    const arr = d.products.filter(p => (p.line || '') === line);
    if (!arr.length) return '';
    return `<div class="sec-title">${esc(tr(line || 'Chưa phân dòng'))}</div>
      <div class="card">${arr.map(row).join('')}</div>`;
  }).join('')}
  ${d.products.length ? '' : `<div class="note">${tr('Chưa có gói dịch vụ nào trong bảng giá.')}</div>`}`;
}

/**
 * Thêm mới hoặc sửa 1 gói dịch vụ. `product` null = thêm mới.
 * Đổi giá KHÔNG hồi tố — báo giá đã lập lưu đơn giá vào chính nó tại thời điểm tạo, nên bảng giá
 * đổi hôm nay không làm lệch báo giá cũ hay hoa hồng đã ghi nhận. Nói rõ trong modal để người sửa
 * không ngại đụng vào giá.
 */
function productModal(d, product, after, dup = false) {
  const edit = !!product && !dup;
  const lines = [...new Set([...d.lines.map(x => x.name), ...BASE_LINES, ...d.products.map(p => p.line).filter(Boolean)])];
  modal({
    title: dup ? 'Nhân bản gói: ' + product.name : edit ? tf(() => 'Sửa gói: ' + product.name, () => 'Edit package: ' + product.name) : 'Thêm gói dịch vụ',
    wide: true,
    html: `<div class="note mb">${edit
      ? tr('Đổi giá chỉ áp dụng cho báo giá lập <b>từ giờ trở đi</b> — báo giá cũ giữ nguyên đơn giá và hoa hồng đã chốt.')
      : tr('Gói mới xuất hiện ngay trong công cụ tính giá và khi lập báo giá ở Phương án kinh doanh.')}</div>`,
    fields: [
      { name: 'name', label: 'Tên gói', required: true, value: dup ? product.name + ' (bản sao)' : product?.name || '' },
      { name: 'line', label: 'Thuộc sản phẩm, dịch vụ', type: 'select', value: product?.line || lines[0], options: lines.map(l => ({ v: l, n: l })),
        hint: 'Chưa có trong danh sách? Ban Giám đốc thêm sản phẩm, dịch vụ mới ở mục Quản lý.' },
      { name: 'unit', label: 'Đơn vị tính', value: product?.unit || 'gói', placeholder: 'gói · số · mùa · video' },
      { name: 'price', label: 'Đơn giá (đ)', type: 'number', required: true, value: product?.price ?? 0 },
      { name: 'commissionRate', label: 'Tỉ lệ hoa hồng (%)', type: 'number', value: product?.commission_rate ?? 5, hint: 'Tối đa 50%' },
      { name: 'maxDiscount', label: 'Chiết khấu tối đa (%)', type: 'number', value: product?.max_discount ?? 10, hint: 'Vượt mức này sẽ được nêu rõ cho người duyệt báo giá' },
      { name: 'description', label: 'Mô tả', type: 'textarea', rows: 2, value: product?.description || '' },
    ],
    submitText: edit ? 'Lưu thay đổi' : 'Thêm gói',
    onSubmit: async (v) => {
      const body = {
        name: v.name, line: v.line, unit: v.unit, description: v.description,
        price: Number(v.price) || 0,
        commissionRate: Number(v.commissionRate) || 0,
        maxDiscount: Number(v.maxDiscount) || 0,
      };
      try {
        if (edit) await patch('/products/' + product.id, body);
        else await post('/products', body);
        toast(edit ? 'Đã cập nhật gói dịch vụ' : 'Đã thêm gói dịch vụ', 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}

/** TP / Sales đề xuất sản phẩm, dịch vụ mới cho BGĐ (thông báo + đẩy về điện thoại Admin). */
function proposeModal(d) {
  modal({
    title: 'Đề xuất sản phẩm / dịch vụ mới',
    html: '<div class="note mb">Đề xuất được gửi tới Ban Giám đốc. Khi được duyệt, BGĐ thêm vào danh mục và mọi người thấy ngay trong bảng giá.</div>',
    fields: [
      { name: 'name', label: 'Tên sản phẩm / dịch vụ', required: true, placeholder: 'VD: Livestream bán hàng 3 giờ' },
      { name: 'line', label: 'Thuộc sản phẩm, dịch vụ', type: 'select', options: [...d.lines.map(x => ({ v: x.name, n: x.name })), { v: 'Sản phẩm, dịch vụ mới', n: 'Sản phẩm, dịch vụ mới (chưa có)' }] },
      { name: 'price', label: 'Giá dự kiến (đ)', type: 'number', placeholder: 'Không bắt buộc' },
      { name: 'reason', label: 'Lý do / nhu cầu khách hàng', type: 'textarea', rows: 3, placeholder: 'VD: 3 khách hỏi trong tháng này, đối thủ đang bán giá…' },
    ],
    submitText: 'Gửi đề xuất',
    onSubmit: async (v) => {
      try { const r = await post('/products/propose', v); toast(`Đã gửi đề xuất tới ${r.sent} người trong Ban Giám đốc`, 'ok'); }
      catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}

const HIST_ACTION = { create: 'Thêm', update: 'Sửa', deactivate: 'Ngừng bán', delete: 'Xoá', rename: 'Đổi tên', propose: 'Đề xuất' };
function histText(a) {
  let m = {}; try { m = JSON.parse(a.meta || '{}'); } catch (e) { /* bỏ qua */ }
  const FIELD = { name: 'tên', line: 'sản phẩm/dịch vụ', unit: 'đơn vị', price: 'giá', commission_rate: 'hoa hồng', max_discount: 'chiết khấu tối đa', description: 'mô tả', active: 'trạng thái' };
  if (a.entity === 'product_line') return a.action === 'rename' ? `Sản phẩm/dịch vụ "${m.from}" → "${m.to}"` : `Sản phẩm/dịch vụ "${m.name || a.entity_id}"${m.moved ? ` (chuyển ${m.moved} gói sang ${m.moveTo})` : ''}`;
  if (a.action === 'update') return `— ${(m.fields || []).map(f => FIELD[f] || f).join(', ')}`;
  return `"${m.name || ''}"${m.price ? ' · ' + money(m.price) : ''}`;
}

/** Thêm / bớt sản phẩm, dịch vụ (Admin / BGĐ): (1) sản phẩm, dịch vụ · (2) gói dịch vụ bên trong. */
function manageTab(d) {
  const active = d.products.filter(p => p.active).length;
  const pName = Object.fromEntries(d.products.map(p => [p.id, p.name]));
  const row = (p) => {
    const used = d.usage[p.id] || 0;
    return `<tr data-mg-row data-q="${esc((p.name + ' ' + (p.description || '') + ' ' + (p.line || '')).toLowerCase())}" data-line="${esc(p.line || '')}" data-st="${p.active ? 'on' : 'off'}"${p.active ? '' : ' class="mg-off"'}>
      <td><div class="b">${esc(p.name)}</div><div class="xs mut mg-desc">${esc(p.description || '')}</div></td>
      <td class="sm">${esc(p.line || 'Chưa phân dòng')}</td>
      <td class="b nowrap">${money(p.price)}<div class="xs mut">/${esc(p.unit || 'gói')}</div></td>
      <td class="nowrap">${p.commission_rate}%</td><td class="nowrap">${p.max_discount}%</td>
      <td class="nowrap">${used ? `${used} báo giá` : '<span class="mut">Chưa dùng</span>'}</td>
      <td>${p.active ? chip('Đang bán', 'green') : chip('Ngừng bán', 'grey')}</td>
      <td><div class="mg-acts">
        <button class="btn sm" data-editproduct="${esc(p.id)}">${icon('pencil', 13)} Sửa</button>
        <button class="btn sm" data-dupproduct="${esc(p.id)}" title="Tạo gói mới từ gói này">${icon('copy', 13)} Nhân bản</button>
        ${p.active ? `<button class="btn sm" data-stopproduct="${esc(p.id)}">${icon('pause', 13)} Ngừng bán</button>`
          : `<button class="btn sm amber" data-resellproduct="${esc(p.id)}">${icon('play', 13)} Bán lại</button>`}
        ${used ? '' : `<button class="btn sm red-o" data-delproduct="${esc(p.id)}">${icon('trash2', 13)} Xoá</button>`}
      </div></td></tr>`;
  };
  const hist = `<div class="card mt">
      <div class="row"><b>${icon('history', 16)} Lịch sử thay đổi</b></div>
      <div class="mt">${d.history.length ? d.history.map(a => `<div class="mg-h">
          <span class="chip ${a.action === 'delete' || a.action === 'deactivate' ? 'grey' : a.action === 'create' ? 'green' : 'blue'}">${HIST_ACTION[a.action] || a.action}</span>
          <span class="grow sm">${esc(a.entity === 'product' && a.action === 'update' ? `Gói "${pName[a.entity_id] || 'đã xoá'}" ${histText(a)}` : (a.entity === 'product' ? 'Gói ' : '') + histText(a))}
            <span class="xs mut"><br>${esc(a.user_name || 'Hệ thống')} · ${fmtDate(a.created_at)}</span></span></div>`).join('')
        : '<div class="sm mut">Chưa có thay đổi nào. Mọi thao tác thêm, sửa, ngừng bán, xoá đều được ghi lại ở đây.</div>'}</div>
    </div>`;
  return `<div class="grid g3 mb mg-stats">
      ${stat('Sản phẩm, dịch vụ', d.lines.length, 'Nhóm lớn công ty cung cấp', 'blue')}
      ${stat('Gói đang bán', active, 'Hiện trong bảng giá & báo giá', 'green')}
      ${stat('Gói ngừng bán', d.products.length - active, 'Ẩn khỏi báo giá, giữ lịch sử', 'amber')}
    </div>

    <div class="mg-part">
      <div class="mg-part-h"><span class="mg-no">1</span><div class="grow"><div class="b">Sản phẩm, dịch vụ</div>
        <div class="xs mut">Nhóm lớn công ty cung cấp (TVC/Video, Gameshow, Xây kênh…). Gói dịch vụ nào cũng phải thuộc một sản phẩm, dịch vụ ở đây.</div></div>
        <button class="btn primary sm" data-addline>+ Thêm sản phẩm, dịch vụ mới</button></div>
      <div class="card">${d.lines.map(l => `<div class="item mg-line">
        <div class="dot-i">${icon(lineIcon(l.name))}</div>
        <div class="grow"><div class="t">${esc(l.name)}</div><div class="d">${l.active} gói đang bán${l.total - l.active ? ` · ${l.total - l.active} ngừng bán` : ''}</div></div>
        <button class="btn sm" data-renameline="${esc(l.name)}" aria-label="Đổi tên">${icon('pencil', 13)} <span class="mg-bl">Đổi tên</span></button>
        <button class="btn sm red-o" data-delline="${esc(l.name)}" aria-label="Xoá">${icon('trash2', 13)} <span class="mg-bl">Xoá</span></button></div>`).join('')
        || '<div class="sm mut">Chưa có sản phẩm, dịch vụ nào.</div>'}</div>
    </div>

    <div class="mg-part" data-mg>
      <div class="mg-part-h"><span class="mg-no">2</span><div class="grow"><div class="b">Gói dịch vụ (<span data-mg-n>${d.products.length}</span>)</div>
        <div class="xs mut"><b>Thêm</b> gói mới · <b>Bớt</b> bằng "Ngừng bán" (gói đã từng báo giá — giữ đúng hoa hồng cũ) hoặc "Xoá" (chỉ gói chưa từng dùng, ví dụ tạo nhầm).</div></div>
        <button class="btn primary sm" data-addproduct>+ Thêm gói dịch vụ</button></div>
      <div class="card">
        <div class="row wrap mg-filter" style="gap:8px">
          <input data-mg-q type="search" placeholder="Tìm theo tên, mô tả…" aria-label="Tìm gói dịch vụ">
          <select data-mg-line aria-label="Lọc theo sản phẩm, dịch vụ"><option value="">Mọi sản phẩm, dịch vụ</option>${d.lines.map(l => `<option value="${esc(l.name)}">${esc(l.name)}</option>`).join('')}</select>
          <select data-mg-st aria-label="Lọc theo trạng thái"><option value="all">Mọi trạng thái</option><option value="on">Đang bán</option><option value="off">Ngừng bán</option></select>
        </div>
        <div class="tbl-wrap mt mg-tbl"><table>
          <thead><tr><th>Gói dịch vụ</th><th>Sản phẩm, dịch vụ</th><th>Đơn giá</th><th>Hoa hồng</th><th>CK tối đa</th><th>Đã dùng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>${d.products.map(row).join('')}</tbody></table>
          <div class="sm mut" data-mg-empty hidden style="padding:14px">Không có gói nào khớp bộ lọc.</div></div>
      </div>
    </div>
    ${hist}`;
}

/**
 * Công cụ NHẨM giá — không tạo bản ghi nào, không gọi API. Dùng để trả lời khách ngay trong cuộc
 * gọi; muốn có báo giá thật (có số hiệu, có luồng duyệt) thì lập ở Phương án kinh doanh.
 * Công thức chép đúng computeQuotePricing() ở server/routes/deals.js để con số ở đây không lệch
 * với báo giá thật cùng gói & cùng chiết khấu: chiết khấu áp lên CẢ thành tiền lẫn hoa hồng.
 */
function estimateModal(d, presetProduct) {
  // Chỉ gói ĐANG BÁN — Admin nạp cả gói đã ngừng bán để quản bảng giá, nhưng không được nhẩm giá
  // (rồi chào khách) bằng một gói công ty đã dừng.
  const opts = d.products.filter(p => p.active).map(p => ({ v: p.id, n: p.name + ' — ' + money(p.price) }));
  const { root } = modal({
    title: 'Nhẩm giá & hoa hồng',
    wide: true,
    fields: [
      { name: 'productId', label: 'Gói dịch vụ', type: 'select', value: presetProduct || '', options: opts },
      { name: 'qty', label: 'Số lượng', type: 'number', value: 1 },
      { name: 'productId2', label: 'Gói thứ hai (tuỳ chọn)', type: 'select', options: [{ v: '', n: '— không —' }, ...opts] },
      { name: 'discountPct', label: 'Chiết khấu (%)', type: 'number', value: 0 },
    ],
    html: '<div data-est></div>',
    submitText: 'Đóng',
    onSubmit: () => true,
  });

  const form = root.querySelector('[data-form]');
  const out = root.querySelector('[data-est]');

  const calc = () => {
    const v = Object.fromEntries(new FormData(form).entries());
    const disc = Math.min(Math.max(Number(v.discountPct) || 0, 0), 100);
    const lines = [
      { p: d.products.find(x => x.id === v.productId), qty: Number(v.qty) || 1 },
      { p: d.products.find(x => x.id === v.productId2), qty: 1 },
    ].filter(l => l.p);

    let subtotal = 0, commission = 0;
    for (const l of lines) {
      subtotal += l.p.price * l.qty;
      commission += l.p.price * l.qty * (l.p.commission_rate || 5) / 100;
    }
    const total = subtotal * (1 - disc / 100);
    commission = Math.round(commission * (1 - disc / 100));

    const overCap = lines.filter(l => disc > Number(l.p.max_discount ?? 100));
    out.innerHTML = `<div class="card mt">
      <div class="sm">${tr('Tạm tính:')} <b>${vnd(subtotal)}</b></div>
      <div class="sm">${tr('Chiết khấu:')} <b>${disc}%</b> (−${vnd(subtotal - total)})</div>
      <div class="sm">${tr('Thành tiền:')} <b style="color:#F59E0B">${vnd(total)}</b></div>
      <div class="sm">${tr('Hoa hồng dự kiến:')} <b>${vnd(commission)}</b></div>
    </div>
    ${overCap.length ? `<div class="note red mt">${tf(() => 'Vượt trần chiết khấu riêng của gói: ' + overCap.map(l => `${esc(l.p.name)} (trần ${l.p.max_discount}%)`).join('; ') + '.',
      () => "Exceeds the package's own discount cap: " + overCap.map(l => `${esc(l.p.name)} (cap ${l.p.max_discount}%)`).join('; ') + '.')}</div>` : ''}
    ${disc > d.threshold ? `<div class="note mt">${tf(() => `Chiết khấu vượt ngưỡng ${d.threshold}% — báo giá thật sẽ phải qua TPKD duyệt (vòng 1). Lập tại`, () => `Discount exceeds the ${d.threshold}% threshold — a real quote will require Sales Manager approval (round 1). Create one at`)} <a href="#/plans">${tr('Phương án kinh doanh')}</a>.</div>` : ''}
    <div class="xs mut mt">${tr('Đây chỉ là ước tính tại chỗ, không tạo báo giá và không lưu lại.')}</div>`;
  };

  form.addEventListener('input', calc);
  form.addEventListener('change', calc);
  calc();
}

/**
 * Điều chỉnh tỉ lệ hoa hồng của một cơ chế hợp tác.
 *
 * Ghi thẳng vào CÙNG hai khoá cấu hình mà Quản trị → Ngưỡng & SLA đang dùng
 * (partner_pa1_partner_rate…), không tạo bản sao riêng cho màn hình này — nếu không sẽ có hai chỗ
 * cùng khai một tỉ lệ và không biết chỗ nào là thật. POST /api/config đóng hiệu lực bản cũ rồi
 * thêm bản mới thay vì ghi đè, nên deal đã chốt vẫn giữ đúng tỉ lệ tại thời điểm chốt.
 *
 * Hai khoá phải gửi làm HAI lần gọi (API nhận mỗi lần một khoá). Gọi tuần tự chứ không song song:
 * cả hai cùng xoá cache cfg:global, chạy song song thì lần đọc kế tiếp có thể bắt được trạng thái
 * mới một nửa.
 */
function rateModal(key, partnerRate, saleRate, after) {
  const prefix = `partner_${key.toLowerCase()}_`;
  const { root } = modal({
    title: tf(() => 'Điều chỉnh hoa hồng — ' + SCHEME_NAME[key], () => 'Adjust commission — ' + SCHEME_NAME[key]),
    fields: [
      { name: 'partnerRate', label: 'Partner nhận (%)', type: 'number', value: partnerRate, required: true },
      { name: 'saleRate', label: 'Sale nhận (%)', type: 'number', value: saleRate, required: true },
    ],
    html: '<div data-total></div>',
    submitText: 'Lưu tỉ lệ',
    onSubmit: async (v) => {
      const pr = Number(v.partnerRate), sr = Number(v.saleRate);
      if (![pr, sr].every(n => Number.isFinite(n) && n >= 0)) { toast('Tỉ lệ phải là số không âm.', 'err'); return false; }
      if (pr + sr > 100) { toast('Tổng chi hoa hồng vượt 100% giá trị hợp đồng.', 'err'); return false; }
      try {
        await post('/config', { key: prefix + 'partner_rate', value: pr });
        await post('/config', { key: prefix + 'sale_rate', value: sr });
        toast(tf(() => `Đã cập nhật ${SCHEME_NAME[key]}: partner ${pr}% · sale ${sr}%`, () => `Updated ${SCHEME_NAME[key]}: partner ${pr}% · sale ${sr}%`), 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });

  // Tổng chi hiện ngay khi gõ — đây là con số người duyệt tỉ lệ thực sự quan tâm, để không phải
  // cộng nhẩm rồi mới phát hiện đã cho đi quá nhiều.
  const form = root.querySelector('[data-form]');
  const out = root.querySelector('[data-total]');
  const calc = () => {
    const v = Object.fromEntries(new FormData(form).entries());
    const pr = Number(v.partnerRate) || 0, sr = Number(v.saleRate) || 0;
    const sample = 500000000;
    out.innerHTML = `<div class="card mt">
      <div class="sm">${tr('Tổng chi hoa hồng:')} <b${pr + sr > 100 ? ' style="color:var(--red)"' : ''}>${(pr + sr).toFixed(1)}%</b></div>
      <div class="sm mut">${tr('Trên hợp đồng mẫu')} ${vnd(sample)}: partner ${money(sample * pr / 100)} · sale ${money(sample * sr / 100)}
        · ${tr('còn lại cho công ty')} <b>${money(sample * (100 - pr - sr) / 100)}</b></div>
    </div>
    <div class="xs mut mt">${tr('Áp dụng cho deal chốt từ lúc lưu trở đi. Cùng giá trị với Quản trị → Ngưỡng &amp; SLA')}
      (<code>${esc(prefix)}partner_rate</code>, <code>${esc(prefix)}sale_rate</code>).</div>`;
  };
  form.addEventListener('input', calc);
  calc();
}

/* Tên hiển thị của hai cơ chế hợp tác. Mã PA1/PA2 vẫn là khoá dữ liệu (nv_deals.phuong_an_hop_tac,
 * cấu hình partnerScheme của máy chủ) nhưng KHÔNG hiện ra ở màn hình này — người đọc bảng hoa hồng
 * cần biết ai làm gì và ăn bao nhiêu, mã nội bộ chỉ thêm một lớp phải dịch. Pipeline vẫn hiện mã
 * khi gắn phương án cho deal (src/const.js PA_OPTIONS) vì ở đó đang chọn đúng trường dữ liệu.
 */
const SCHEME_NAME = { get PA1() { return tr('Partner giới thiệu'); }, get PA2() { return tr('Partner tự chốt'); } };

/**
 * Hoa hồng khách hàng đến từ Partner — hai cơ chế chia tiền khác hẳn nhau, nên trình bày cạnh
 * nhau trên cùng một giá trị hợp đồng để người đọc thấy ngay khác biệt thay vì phải tự nhẩm:
 *   Partner giới thiệu — kinh doanh chốt: sale làm toàn bộ nên hưởng đủ, partner hưởng phí giới thiệu.
 *   Partner tự chốt: partner hưởng phần lớn, sale chỉ hưởng phần hỗ trợ hồ sơ & quy trình duyệt.
 * Tỉ lệ lấy từ cấu hình server (Quản trị → Ngưỡng & SLA), không cứng trong giao diện.
 */
function partnerCommissionTab(d) {
  const sc = d.partnerScheme || {};
  const pa1 = sc.PA1 || { partnerRate: 0, saleRate: 0 };
  const pa2 = sc.PA2 || { partnerRate: 0, saleRate: 0 };
  // Deal đang gắn phương án hợp tác — chỉ những deal này áp cơ chế partner khi chốt.
  const paDeals = d.deals.filter(x => x.phuong_an_hop_tac === 'PA1' || x.phuong_an_hop_tac === 'PA2');
  const partnerCustomers = d.customers.filter(c => c.partner_id);
  const partnerName = (id) => (d.partners.find(p => p.id === id) || {}).name || '—';

  const schemeCard = (key, s, who) => `<div class="card">
    <div class="row wrap"><div class="grow b">${esc(SCHEME_NAME[key])}</div>
      ${isLead() ? `<button class="btn sm" data-rate="${esc(key)}"
        data-partner="${s.partnerRate}" data-sale="${s.saleRate}">${icon('slidersHorizontal', 14)} ${tr('Điều chỉnh')}</button>` : ''}</div>
    <div class="sm mut">${esc(who)}</div>
    <div class="grid g2 mt">
      ${stat('Partner nhận', s.partnerRate + '%', 'Trên giá trị hợp đồng', 'amber')}
      ${stat('Sale nhận', s.saleRate + '%', 'Trên giá trị hợp đồng', 'green')}
    </div>
    <div class="sm mut mt">${tr('Tổng chi hoa hồng:')} <b>${(s.partnerRate + s.saleRate).toFixed(1)}%</b></div>
  </div>`;

  // Bảng ví dụ trên một giá trị tròn để so sánh nhanh — không phải số của deal cụ thể nào.
  const sample = 500000000;
  return `<div class="note mb">${tr('Cơ chế áp dụng khi')} <b>${tr('deal được gắn phương án hợp tác')}</b> ${tr('ở Pipeline và khách hàng có gắn Partner trong CRM.')}
    ${tr('Khi deal chuyển sang "đã chốt", hệ thống ghi hoa hồng theo đúng cơ chế tương ứng thay vì tỉ lệ theo gói dịch vụ.')}
    ${isLead()
      ? tr('Đổi tỉ lệ bằng nút <b>Điều chỉnh</b> trên từng cơ chế — áp dụng cho các deal chốt <b>từ lúc đổi trở đi</b>, deal đã chốt giữ nguyên tỉ lệ tại thời điểm chốt.')
      : tr('Tỉ lệ do Trưởng phòng KD / Ban Giám đốc đặt.')}</div>

  <div class="grid g2">
    ${schemeCard('PA1', pa1, tr('Kinh doanh làm toàn bộ công đoạn bán hàng; partner hưởng phí giới thiệu.'))}
    ${schemeCard('PA2', pa2, tr('Partner tự chăm sóc và chốt; sale hỗ trợ hồ sơ và đưa qua quy trình duyệt nội bộ.'))}
  </div>

  <div class="sec-title">${tr('So sánh trên hợp đồng mẫu')} ${vnd(sample)}</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>${tr('Phương án')}</th><th>${tr('Ai làm phần lớn')}</th><th>${tr('Partner nhận')}</th><th>${tr('Sale nhận')}</th><th>${tr('Tổng chi')}</th><th>${tr('Còn lại cho công ty')}</th></tr></thead>
      <tbody>
        ${[['PA1', pa1, tr('Kinh doanh')], ['PA2', pa2, 'Partner']].map(([k, s, who]) => {
          const pAmt = sample * s.partnerRate / 100, sAmt = sample * s.saleRate / 100;
          return `<tr>
            <td><b>${esc(SCHEME_NAME[k])}</b></td><td class="sm">${esc(who)}</td>
            <td class="b">${money(pAmt)}</td><td class="b">${money(sAmt)}</td>
            <td>${money(pAmt + sAmt)}</td><td>${money(sample - pAmt - sAmt)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="sec-title">${tr('Deal đang áp cơ chế Partner')} (${paDeals.length})</div>
  <div class="card">${paDeals.length ? paDeals.map(x => {
    const s = x.phuong_an_hop_tac === 'PA1' ? pa1 : pa2;
    return `<div class="item">
      <div class="dot-i">${icon('handshake')}</div>
      <div class="grow"><div class="t">${esc(x.title)} ${chip(SCHEME_NAME[x.phuong_an_hop_tac], x.phuong_an_hop_tac === 'PA1' ? 'blue' : 'amber')}</div>
        <div class="d">${esc(x.customer_name || '—')} · ${esc(x.owner_name || '')} · ${money(x.value)}</div>
        <div class="d xs">Partner ${s.partnerRate}% = ${money(x.value * s.partnerRate / 100)} · sale ${s.saleRate}% = ${money(x.value * s.saleRate / 100)}</div></div>
      ${chip(x.status === 'won' ? 'Đã chốt' : 'Đang mở', x.status === 'won' ? 'green' : 'grey')}
    </div>`;
  }).join('') : `<div class="sm mut">${tr('Chưa có deal nào gắn phương án hợp tác nào.')}</div>`}</div>

  <div class="sec-title">${tr('Khách hàng gắn Partner')} (${partnerCustomers.length})</div>
  <div class="card">${partnerCustomers.length ? partnerCustomers.map(c => `<a class="item" href="#/crm/${esc(c.id)}">
      <div class="dot-i">${icon('folderOpen')}</div>
      <div class="grow"><div class="t">${esc(c.name)}</div>
        <div class="d">${esc(partnerName(c.partner_id))} · ${esc(c.owner_name || '')}</div></div>
    </a>`).join('') : `<div class="sm mut">${tr('Chưa có khách hàng nào gắn Partner trong CRM.')}</div>`}</div>`;
}

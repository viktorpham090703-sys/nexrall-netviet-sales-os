import { get, post, patch, del } from '../api.js';
import { isLead, isAdmin } from '../state.js';
import { esc, money, vnd, mount, chip, stat, modal, toast, bindTabs, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

/**
 * Sales Kit — thư viện tra cứu của phòng kinh doanh: bảng gói dịch vụ và cơ chế hoa hồng Partner.
 *
 * Báo giá, hợp đồng và AI soạn proposal đã chuyển sang "Phương án kinh doanh" (views/plans.js) để
 * mỗi thương vụ chỉ còn MỘT luồng trình duyệt. Những gì ở lại đây đều là dữ liệu tra cứu — dùng
 * được cả khi chưa có thương vụ nào — nên trang này không còn tạo bản ghi gì.
 */

let tab = 'catalog';

export async function render(el) {
  const load = async () => {
    const [p, cus, d, pt] = await Promise.all([
      get('/products' + (isAdmin() ? '?includeInactive=1' : '')),
      get('/customers'), get('/deals'), get('/partners'),
    ]);
    return {
      products: p.items || [], threshold: p.discountThreshold, partnerScheme: p.partnerScheme || {},
      customers: cus.items || [], deals: d.items || [], partners: pt.items || [],
    };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Sales Kit</h2><p>Bảng gói dịch vụ · công cụ nhẩm giá &amp; hoa hồng · cơ chế chia hoa hồng Partner</p></div>
  </div>

  <div class="seg mb">
    <button data-tab="catalog" class="${tab === 'catalog' ? 'on' : ''}">Gói dịch vụ</button>
    <button data-tab="partnerComm" class="${tab === 'partnerComm' ? 'on' : ''}">Hoa hồng Partner</button>
  </div>

  ${tab === 'catalog' ? catalogTab(d) : ''}

  ${tab === 'partnerComm' ? partnerCommissionTab(d) : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-calc]').forEach(b => b.onclick = () => estimateModal(d, b.dataset.calc));
    el.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => rateModal(
      b.dataset.rate, Number(b.dataset.partner) || 0, Number(b.dataset.sale) || 0, () => render(el)));

    const addBtn = el.querySelector('[data-addproduct]');
    if (addBtn) addBtn.onclick = () => productModal(d, null, () => render(el));
    el.querySelectorAll('[data-editproduct]').forEach(b => b.onclick = () => productModal(
      d, d.products.find(x => x.id === b.dataset.editproduct), () => render(el)));
    el.querySelectorAll('[data-stopproduct]').forEach(b => b.onclick = () => {
      const pr = d.products.find(x => x.id === b.dataset.stopproduct);
      confirmDialog('Ngừng bán gói dịch vụ',
        `"${pr.name}" sẽ không còn xuất hiện khi lập báo giá. Báo giá và hoa hồng đã ghi nhận giữ nguyên, và bạn bán lại được bất cứ lúc nào.`,
        async () => {
          try { await del('/products/' + pr.id); toast('Đã ngừng bán ' + pr.name, 'ok'); render(el); }
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
const LINES = ['TVC/Video', 'Gameshow', 'Xây kênh'];
const lineIcon = (line) => line === 'Gameshow' ? 'clapperboard' : line === 'Xây kênh' ? 'trendingUp'
  : line === 'TVC/Video' ? 'video' : 'files';

/** Bảng gói dịch vụ. Admin thêm/sửa/ngừng bán ngay tại đây; vai trò khác chỉ tra cứu và nhẩm giá. */
function catalogTab(d) {
  const admin = isAdmin();
  const known = new Set(LINES);
  const extra = [...new Set(d.products.map(p => p.line).filter(l => l && !known.has(l)))].sort();
  const groups = [...LINES, ...extra, ...(d.products.some(p => !p.line) ? [''] : [])];

  const row = (p) => `<div class="item"${p.active ? '' : ' style="opacity:.55"'}>
    <div class="dot-i">${icon(lineIcon(p.line))}</div>
    <div class="grow"><div class="t">${esc(p.name)} ${p.active ? '' : chip('Ngừng bán', 'grey')}</div>
      <div class="d">${esc(p.description || '')}</div>
      <div class="row wrap mt" style="gap:6px">${chip(vnd(p.price) + '/' + esc(p.unit || 'gói'), 'blue')}
        ${chip('HH ' + p.commission_rate + '%', 'green')}${chip('CK tối đa ' + p.max_discount + '%', 'amber')}</div></div>
    <div class="right">
      ${p.active ? `<button class="btn sm" data-calc="${esc(p.id)}">Tính giá</button>` : ''}
      ${admin ? `<div class="mt"><button class="btn sm" data-editproduct="${esc(p.id)}">Sửa</button></div>
        <div class="mt">${p.active
          ? `<button class="btn sm" data-stopproduct="${esc(p.id)}">Ngừng bán</button>`
          : `<button class="btn sm amber" data-resellproduct="${esc(p.id)}">Bán lại</button>`}</div>` : ''}
    </div></div>`;

  return `${admin
    ? '<button class="btn block mb" data-addproduct>+ Thêm gói dịch vụ</button>'
    : '<div class="note mb">Bảng giá do Ban Giám đốc quản lý. Cần thêm hoặc sửa gói, đề nghị Admin/BGĐ cập nhật tại đây.</div>'}
  ${groups.map(line => {
    const arr = d.products.filter(p => (p.line || '') === line);
    if (!arr.length) return '';
    return `<div class="sec-title">${esc(line || 'Chưa phân dòng')}</div>
      <div class="card">${arr.map(row).join('')}</div>`;
  }).join('')}
  ${d.products.length ? '' : '<div class="note">Chưa có gói dịch vụ nào trong bảng giá.</div>'}`;
}

/**
 * Thêm mới hoặc sửa 1 gói dịch vụ. `product` null = thêm mới.
 * Đổi giá KHÔNG hồi tố — báo giá đã lập lưu đơn giá vào chính nó tại thời điểm tạo, nên bảng giá
 * đổi hôm nay không làm lệch báo giá cũ hay hoa hồng đã ghi nhận. Nói rõ trong modal để người sửa
 * không ngại đụng vào giá.
 */
function productModal(d, product, after) {
  const edit = !!product;
  const lines = [...new Set([...LINES, ...d.products.map(p => p.line).filter(Boolean)])];
  modal({
    title: edit ? 'Sửa gói: ' + product.name : 'Thêm gói dịch vụ',
    wide: true,
    html: `<div class="note mb">${edit
      ? 'Đổi giá chỉ áp dụng cho báo giá lập <b>từ giờ trở đi</b> — báo giá cũ giữ nguyên đơn giá và hoa hồng đã chốt.'
      : 'Gói mới xuất hiện ngay trong công cụ tính giá và khi lập báo giá ở Phương án kinh doanh.'}</div>`,
    fields: [
      { name: 'name', label: 'Tên gói', required: true, value: product?.name || '' },
      { name: 'line', label: 'Dòng dịch vụ', type: 'select', value: product?.line || LINES[0], options: lines.map(l => ({ v: l, n: l })) },
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
      <div class="sm">Tạm tính: <b>${vnd(subtotal)}</b></div>
      <div class="sm">Chiết khấu: <b>${disc}%</b> (−${vnd(subtotal - total)})</div>
      <div class="sm">Thành tiền: <b style="color:#F59E0B">${vnd(total)}</b></div>
      <div class="sm">Hoa hồng dự kiến: <b>${vnd(commission)}</b></div>
    </div>
    ${overCap.length ? `<div class="note red mt">Vượt trần chiết khấu riêng của gói: ${overCap.map(l => `${esc(l.p.name)} (trần ${l.p.max_discount}%)`).join('; ')}.</div>` : ''}
    ${disc > d.threshold ? `<div class="note mt">Chiết khấu vượt ngưỡng ${d.threshold}% — báo giá thật sẽ phải qua TPKD duyệt (vòng 1). Lập tại <a href="#/plans">Phương án kinh doanh</a>.</div>` : ''}
    <div class="xs mut mt">Đây chỉ là ước tính tại chỗ, không tạo báo giá và không lưu lại.</div>`;
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
    title: 'Điều chỉnh hoa hồng — ' + SCHEME_NAME[key],
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
        toast(`Đã cập nhật ${SCHEME_NAME[key]}: partner ${pr}% · sale ${sr}%`, 'ok');
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
      <div class="sm">Tổng chi hoa hồng: <b${pr + sr > 100 ? ' style="color:var(--red)"' : ''}>${(pr + sr).toFixed(1)}%</b></div>
      <div class="sm mut">Trên hợp đồng mẫu ${vnd(sample)}: partner ${money(sample * pr / 100)} · sale ${money(sample * sr / 100)}
        · còn lại cho công ty <b>${money(sample * (100 - pr - sr) / 100)}</b></div>
    </div>
    <div class="xs mut mt">Áp dụng cho deal chốt từ lúc lưu trở đi. Cùng giá trị với Quản trị → Ngưỡng &amp; SLA
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
const SCHEME_NAME = { PA1: 'Partner giới thiệu', PA2: 'Partner tự chốt' };

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
        data-partner="${s.partnerRate}" data-sale="${s.saleRate}">${icon('slidersHorizontal', 14)} Điều chỉnh</button>` : ''}</div>
    <div class="sm mut">${esc(who)}</div>
    <div class="grid g2 mt">
      ${stat('Partner nhận', s.partnerRate + '%', 'Trên giá trị hợp đồng', 'amber')}
      ${stat('Sale nhận', s.saleRate + '%', 'Trên giá trị hợp đồng', 'green')}
    </div>
    <div class="sm mut mt">Tổng chi hoa hồng: <b>${(s.partnerRate + s.saleRate).toFixed(1)}%</b></div>
  </div>`;

  // Bảng ví dụ trên một giá trị tròn để so sánh nhanh — không phải số của deal cụ thể nào.
  const sample = 500000000;
  return `<div class="note mb">Cơ chế áp dụng khi <b>deal được gắn phương án hợp tác</b> ở Pipeline và khách hàng có gắn Partner trong CRM.
    Khi deal chuyển sang "đã chốt", hệ thống ghi hoa hồng theo đúng cơ chế tương ứng thay vì tỉ lệ theo gói dịch vụ.
    ${isLead()
      ? 'Đổi tỉ lệ bằng nút <b>Điều chỉnh</b> trên từng cơ chế — áp dụng cho các deal chốt <b>từ lúc đổi trở đi</b>, deal đã chốt giữ nguyên tỉ lệ tại thời điểm chốt.'
      : 'Tỉ lệ do Trưởng phòng KD / Ban Giám đốc đặt.'}</div>

  <div class="grid g2">
    ${schemeCard('PA1', pa1, 'Kinh doanh làm toàn bộ công đoạn bán hàng; partner hưởng phí giới thiệu.')}
    ${schemeCard('PA2', pa2, 'Partner tự chăm sóc và chốt; sale hỗ trợ hồ sơ và đưa qua quy trình duyệt nội bộ.')}
  </div>

  <div class="sec-title">So sánh trên hợp đồng mẫu ${vnd(sample)}</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Phương án</th><th>Ai làm phần lớn</th><th>Partner nhận</th><th>Sale nhận</th><th>Tổng chi</th><th>Còn lại cho công ty</th></tr></thead>
      <tbody>
        ${[['PA1', pa1, 'Kinh doanh'], ['PA2', pa2, 'Partner']].map(([k, s, who]) => {
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

  <div class="sec-title">Deal đang áp cơ chế Partner (${paDeals.length})</div>
  <div class="card">${paDeals.length ? paDeals.map(x => {
    const s = x.phuong_an_hop_tac === 'PA1' ? pa1 : pa2;
    return `<div class="item">
      <div class="dot-i">${icon('handshake')}</div>
      <div class="grow"><div class="t">${esc(x.title)} ${chip(SCHEME_NAME[x.phuong_an_hop_tac], x.phuong_an_hop_tac === 'PA1' ? 'blue' : 'amber')}</div>
        <div class="d">${esc(x.customer_name || '—')} · ${esc(x.owner_name || '')} · ${money(x.value)}</div>
        <div class="d xs">Partner ${s.partnerRate}% = ${money(x.value * s.partnerRate / 100)} · sale ${s.saleRate}% = ${money(x.value * s.saleRate / 100)}</div></div>
      ${chip(x.status === 'won' ? 'Đã chốt' : 'Đang mở', x.status === 'won' ? 'green' : 'grey')}
    </div>`;
  }).join('') : '<div class="sm mut">Chưa có deal nào gắn phương án hợp tác nào.</div>'}</div>

  <div class="sec-title">Khách hàng gắn Partner (${partnerCustomers.length})</div>
  <div class="card">${partnerCustomers.length ? partnerCustomers.map(c => `<a class="item" href="#/crm/${esc(c.id)}">
      <div class="dot-i">${icon('folderOpen')}</div>
      <div class="grow"><div class="t">${esc(c.name)}</div>
        <div class="d">${esc(partnerName(c.partner_id))} · ${esc(c.owner_name || '')}</div></div>
    </a>`).join('') : '<div class="sm mut">Chưa có khách hàng nào gắn Partner trong CRM.</div>'}</div>`;
}

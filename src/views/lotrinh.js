/* Đào tạo › Lộ trình: lộ trình theo cấp/chức vụ · bài giảng + bài kiểm tra tuần tự (đạt ≥ 80% mới mở
 * bài sau) · kết quả học tập (cá nhân; cấp quản lý xem thêm từng người và tổng nhóm).
 * Bài giảng là danh sách thật ở Thư viện bài giảng (/api/trainings). Máy chủ giữ đáp án, chấm điểm và
 * tự kiểm tra thứ tự mở khoá (/api/trainings/:id/quiz) — trình duyệt chỉ hiển thị. */
import { get, post, put } from '../api.js';
import { state, isLead } from '../state.js';
import { esc, mount, chip, toast, stat, empty } from '../ui.js';
import { icon } from '../icons.js';
import { t as tr, personName } from '../i18n.js';

let tab = 'road', cur = null, step = null, answers = {}, graded = null, quiz = null;
/* Admin xem & tải ảnh lộ trình cho từng vai trò; người khác luôn xem lộ trình của chính mình. */
let viewRole = null;

const ROADS = {
  sales: { name: 'Chuyên viên kinh doanh', steps: [
    ['Hội nhập', 'Tuần 1', 'Văn hoá NetViet, nội quy, cách dùng Sales OS: đăng nhập, ghi hoạt động, nộp báo cáo EOD trước 17:00, nhận việc trong SLA.'],
    ['Sản phẩm', 'Tuần 2', 'Toàn bộ gói dịch vụ: TVC quay thực tế, TVC AI, Video AI viral, Booking Gameshow, Xây kênh TikTok/YouTube, Livestream KOL — giá niêm yết, chiết khấu tối đa, điểm khác biệt.'],
    ['Quy trình bán hàng', 'Tuần 3', 'Lead → tiếp cận → chào hàng → báo giá (duyệt theo ngưỡng) → đàm phán → hợp đồng → sản xuất → bàn giao. SLA chăm sóc từng giai đoạn.'],
    ['Kỹ năng tư vấn', 'Tuần 4–5', 'Khai thác nhu cầu, xử lý từ chối về giá, demo sản phẩm, viết email chào giá cùng AI trợ lý.'],
    ['Chốt & hợp đồng', 'Tuần 6', 'Mẫu hợp đồng, điều khoản thanh toán, bàn giao cho sản xuất, theo dõi hoa hồng.'],
    ['Đánh giá cuối lộ trình', 'Tuần 8', 'Hoàn thành toàn bộ bài kiểm tra ≥ 80% và đạt tối thiểu 60 điểm KPI tháng để lên nhân viên chính thức.']] },
  manager: { name: 'Trưởng phòng / Trưởng nhóm', steps: [
    ['Vai trò quản lý', 'Tháng 1', 'Phạm vi dữ liệu được xem (nhân viên dưới quyền), giao chỉ tiêu kinh doanh trên Sales OS.'],
    ['Giao việc & SLA', 'Tháng 1', 'Giao việc theo mức độ, theo dõi SLA nhận việc, xử lý việc quá hạn và leo thang.'],
    ['Đọc báo cáo đội', 'Tháng 2', 'Báo cáo EOD, tuần, KPI đội; nhận diện nhân viên chậm tiến độ qua vạch "đúng tiến độ".'],
    ['Duyệt & ngưỡng', 'Tháng 2', 'Duyệt chiết khấu, báo giá dưới ngưỡng duyệt; từ ngưỡng trở lên chuyển Giám đốc chuyên môn.'],
    ['Coaching & PIP', 'Tháng 3', 'Kèm cặp 1-1, chấm KPI tháng, lập kế hoạch cải thiện hiệu suất (PIP).']] },
  admin: { name: 'Ban Giám đốc', steps: [
    ['Tổng quan hệ thống', 'Tuần 1', 'Cấu trúc 6 phân hệ, phân quyền theo cấp / tính năng / thao tác.'],
    ['Điều hành bằng số liệu', 'Tuần 1', 'Đọc Console đội, KPI tới ngày, cảnh báo nghiêm trọng, phễu kinh doanh.'],
    ['Duyệt cấp cao', 'Tuần 2', 'Duyệt báo giá / hợp đồng vượt ngưỡng, phương án kinh doanh.'],
    ['Quản trị nhân sự', 'Tuần 2', 'Tạo tài khoản, tạm dừng công việc, nghỉ việc và bàn giao dữ liệu.']] },
  hr: { name: 'Hành chính nhân sự', steps: [
    ['Hồ sơ nhân sự', 'Tuần 1', 'Quản lý hồ sơ: định danh, CCCD, học vấn, chức vụ & kinh nghiệm.'],
    ['Tài khoản & quyền', 'Tuần 1', 'Tạo tài khoản, cấp liên kết đặt mật khẩu, phân quyền theo tính năng.'],
    ['Duyệt hồ sơ', 'Tuần 2', 'Duyệt hợp đồng vòng 2, hồ sơ dự thầu.']] },
};
const ownRoad = () => (ROADS[state.me.role] ? state.me.role : 'sales');
const roadKey = () => (state.me.role === 'admin' && viewRole) || ownRoad();

/** Thu nhỏ & nén ảnh lộ trình trước khi gửi (≤ 1600px, JPEG) để vừa giới hạn lưu trữ. */
function shrinkImage(file, maxW = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = URL.createObjectURL(file);
  });
}

export async function render(el, { id } = {}) {
  // #/lo-trinh/<id> (từ Thư viện bài giảng) → mở thẳng bài đó ở tab Bài giảng.
  if (id && id !== cur) { cur = id; tab = 'learn'; answers = {}; graded = null; quiz = null; }

  const load = async () => {
    const [d, road] = await Promise.all([get('/trainings/path'), get('/settings/road/' + roadKey()).catch(() => ({}))]);
    const L = d.items || [];
    const pick = L.find(x => x.id === cur && x.unlocked) || L.find(x => x.unlocked && !x.passed) || L[0];
    if (pick && pick.id !== cur) { cur = pick.id; answers = {}; graded = null; quiz = null; }
    if (tab === 'learn' && pick && !quiz && (pick.watched_at || pick.passed)) {
      try { quiz = await get(`/trainings/${pick.id}/quiz`); } catch (e) { quiz = null; }
    }
    return { lessons: L, team: d.team || [], passPct: d.passPct || 80, roadImg: road.image || null };
  };

  const draw = (d) => {
    const L = d.lessons;
    const done = L.filter(x => x.passed).length;
    const road = ROADS[roadKey()];
    const curStep = Math.min(Math.floor(done / Math.max(1, L.length) * road.steps.length), road.steps.length - 1);
    return `<div class="page-head"><div class="grow"><h2>${tr('Lộ trình đào tạo')}</h2>
        <p>${tr('Lộ trình theo cấp bậc, chức vụ · học tuần tự, bài kiểm tra đạt từ 80% mới mở bài tiếp theo · kết quả cá nhân và nhóm')}</p></div></div>
      <div class="st-tabs" role="tablist">
        <button type="button" data-tab="road" class="${tab === 'road' ? 'on' : ''}">${icon('route', 15)} ${tr('Lộ trình của tôi')}</button>
        <button type="button" data-tab="learn" class="${tab === 'learn' ? 'on' : ''}">${icon('playCircle', 15)} ${tr('Bài giảng & Test')}</button>
        <button type="button" data-tab="result" class="${tab === 'result' ? 'on' : ''}">${icon('trophy', 15)} ${tr('Kết quả học tập')}</button>
      </div>
      ${tab === 'road' ? roadView(d, road, curStep, done, L.length) : tab === 'learn' ? learnView(d) : resultView(d)}`;
  };

  const roadView = (d, road, cs, done, total) => {
    const si = step == null ? cs : step, st = road.steps[si];
    return `<div class="card">
      <div class="row"><b>${esc(road.name)}</b><span class="grow"></span>${chip(done + '/' + total + ' ' + tr('bài đạt'), done === total && total ? 'green' : 'amber')}</div>
      <div class="xs mut">${tr('Hiển thị theo chức vụ của tài khoản đang đăng nhập · bấm vào từng chặng để xem nội dung chi tiết')}</div>
      ${d.roadImg ? `<img class="lt-img mt" src="${esc(d.roadImg)}" alt="${esc(tr('Ảnh lộ trình'))} ${esc(road.name)}">` : ''}
      <div class="lt-road">${road.steps.map(([n, w], i) => `<button type="button" class="lt-stop ${i < cs ? 'done' : i === cs ? 'cur' : ''} ${step === i ? 'sel' : ''}" data-step="${i}">
        <span class="lt-pin">${i < cs ? icon('circleCheck', 18) : i + 1}</span><span class="lt-nm">${esc(n)}</span><span class="lt-wk">${esc(w)}</span></button>`).join('')}</div>
      <div class="lt-detail"><b>${tr('Chặng')} ${si + 1} · ${esc(st[0])}</b> <span class="mut">(${esc(st[1])})</span><div class="mt sm">${esc(st[2])}</div></div>
      ${state.me.role === 'admin' ? `<div class="row wrap mt" style="gap:8px">
        <select data-road-role class="pq-sel" aria-label="${esc(tr('Lộ trình của vai trò'))}">${Object.entries(ROADS).map(([k, r]) => `<option value="${k}" ${k === roadKey() ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <label class="btn sm" for="lt-img">${icon('upload', 13)} ${tr('Tải ảnh lộ trình cho cấp này')}</label><input id="lt-img" type="file" accept="image/*" hidden>
        ${d.roadImg ? `<button type="button" class="btn sm" data-img-rm>${tr('Gỡ ảnh')}</button>` : ''}<span class="xs mut">${tr('Ảnh hiện cho mọi tài khoản cùng vai trò')} (${esc(road.name)})</span></div>` : ''}
    </div>`;
  };

  const learnView = (d) => {
    const L = d.lessons;
    if (!L.length) return empty('graduationCap', 'Chưa có bài giảng nào cho vai trò này.');
    const i = Math.max(0, L.findIndex(x => x.id === cur)), t = L[i];
    const watched = !!t.watched_at || t.passed;
    const Q = quiz ? quiz.questions : [];
    return `<div class="lt-learn">
      <div class="card lt-list">${L.map((x, k) => `<button type="button" class="lt-les ${x.id === t.id ? 'on' : ''} ${x.unlocked ? '' : 'locked'}" ${x.unlocked ? `data-les="${esc(x.id)}"` : 'disabled'}>
          <span class="lt-idx">${x.unlocked ? (x.passed ? icon('circleCheck', 14) : k + 1) : icon('lock', 13)}</span>
          <span class="grow"><span class="lt-ti">${esc(x.title)}</span><span class="xs mut">${x.duration_min} ${tr('phút')} · ${esc(x.category || '')} · ${x.passed
            ? tr('Đã đạt') + (x.best_score != null ? ' ' + x.best_score + '%' : '')
            : x.unlocked ? (x.last_score != null ? tr('Lần trước') + ' ' + x.last_score + '%' : tr('Chưa làm bài kiểm tra')) : tr('Khoá — cần đạt bài trước')}</span></span></button>`).join('')}</div>
      <div class="card">
        <div class="lt-player"><a href="${esc(t.url)}" target="_blank" rel="noopener" class="lt-play" data-watch aria-label="${esc(tr('Mở video'))}">${icon('play', 26, { filled: true })}</a>
          <span class="lt-cap">Video ${i + 1} · ${esc(t.title)}</span></div>
        <div class="row mt"><span class="sm grow">${esc(t.description || '')}</span>
          ${watched ? chip(tr('Đã xem video'), 'green') : `<button type="button" class="btn sm" data-watched>${tr('Tôi đã xem xong video')}</button>`}</div>
        <div class="sec-title">${tr('Bài kiểm tra video')} ${i + 1} <span class="xs mut" style="text-transform:none;letter-spacing:0">· ${Q.length || 5} ${tr('câu')} · ${tr('cần')} ≥ ${d.passPct}%</span></div>
        ${!watched ? `<div class="err-box" style="background:#FFFBEB;border-color:#FDE68A;color:#92400E">${icon('lock', 14)} ${tr('Xem hết video rồi bấm "Tôi đã xem xong video" để mở bài kiểm tra.')}</div>` : !Q.length ? empty('circleAlert', 'Không tải được bài kiểm tra.') : `
        <form data-quiz>${Q.map((x, qi) => `<div class="lt-q"><div class="lt-qt">${qi + 1}. ${esc(x.q)}</div>
          ${x.opts.map((o, oi) => `<label class="lt-opt"><input type="radio" name="q${qi}" value="${oi}" ${String(answers[qi]) === String(oi) ? 'checked' : ''} ${graded ? 'disabled' : ''}> ${esc(o)}</label>`).join('')}</div>`).join('')}
          ${graded ? `<div class="lt-score ${graded.passed ? 'pass' : 'fail'}"><span class="lt-big">${graded.pct}%</span><span>${graded.passed
            ? (graded.nextId ? tr('Đạt. Đã ghi hoàn thành khoá học và mở khoá video') + ' ' + (i + 2) + '.' : tr('Đạt. Bạn đã hoàn thành toàn bộ lộ trình bài giảng.'))
            : tr('Chưa đạt') + ` ${d.passPct}%. ` + (i + 1 < L.length ? tr('Video tiếp theo vẫn khoá — xem lại video và làm lại bài kiểm tra.') : tr('Xem lại video và làm lại bài kiểm tra.'))}</span></div>` : ''}
          <div class="row mt">${graded ? `<button type="button" class="btn" data-retry>${tr('Làm lại')}</button>${graded.passed && graded.nextId ? `<button type="button" class="btn primary" data-next="${esc(graded.nextId)}">${tr('Sang video')} ${i + 2} →</button>` : ''}`
            : `<button type="submit" class="btn primary">${tr('Nộp bài')}</button>`}</div></form>`}
      </div></div>`;
  };

  const resultView = (d) => {
    const L = d.lessons;
    const scored = L.map(t => t.best_score).filter(x => x != null);
    const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
    const done = L.filter(x => x.passed).length;
    const T = d.team.reduce((s, m) => s + (m.total || 0), 0), D = d.team.reduce((s, m) => s + (m.done || 0), 0), tp = T ? Math.round(D / T * 100) : 0;
    return `<div class="grid g3 mb">
        ${stat('Bài đã đạt', done + '/' + L.length, done === L.length && L.length ? tr('Hoàn thành lộ trình') : tr('Còn') + ' ' + (L.length - done) + ' ' + tr('bài'), 'blue')}
        ${stat('Điểm kiểm tra trung bình', avg == null ? '—' : avg + '%', scored.length + ' ' + tr('bài đã làm kiểm tra'), avg != null && avg >= d.passPct ? 'green' : 'amber')}
        ${stat('Đóng góp KPI', tr('Chủ động'), tr('Hoàn thành đào tạo được tính vào KPI tháng'), 'red')}
      </div>
      <div class="sec-title">${tr('Kết quả của bạn')}</div>
      <div class="tbl-wrap mb"><table><thead><tr><th>${tr('Bài giảng')}</th><th>${tr('Nhóm')}</th><th class="num">${tr('Điểm cao nhất')}</th><th>${tr('Trạng thái')}</th></tr></thead><tbody>
        ${L.map((t, k) => `<tr><td>${k + 1}. ${esc(t.title)}</td><td>${esc(t.category || '')}</td><td class="num">${t.best_score == null ? '—' : t.best_score + '%'}</td>
          <td>${t.passed ? chip('Đạt', 'green') : t.best_score != null ? chip('Chưa đạt', 'red') : chip('Chưa học', 'grey')}</td></tr>`).join('')}
      </tbody></table></div>
      ${isLead() && d.team.length ? `<div class="sec-title">${tr('Kết quả nhóm')} <span class="xs mut" style="text-transform:none;letter-spacing:0">· ${tr('chỉ cấp quản lý thấy')}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>${tr('Thành viên')}</th><th class="num">${tr('Bài đạt')}</th><th style="width:34%">${tr('Tiến độ')}</th><th class="num">%</th><th class="num">${tr('Điểm TB')}</th></tr></thead><tbody>
        ${d.team.map(m => { const p = m.total ? Math.round((m.done || 0) / m.total * 100) : 0; return `<tr><td><b>${esc(personName(m.name))}</b></td><td class="num">${m.done || 0}/${m.total || 0}</td>
          <td><div class="kp-bar"><i style="width:${p}%;background:${p >= 80 ? 'var(--ok)' : 'var(--blue)'}"></i></div></td><td class="num">${p}%</td><td class="num">${m.avg == null ? '—' : m.avg + '%'}</td></tr>`; }).join('')}
        <tr class="lt-total"><td><b>${tr('Tổng nhóm')}</b></td><td class="num"><b>${D}/${T}</b></td><td><div class="kp-bar"><i style="width:${tp}%;background:#0B2342"></i></div></td><td class="num"><b>${tp}%</b></td><td></td></tr>
      </tbody></table></div>` : ''}`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { step = +b.dataset.step; render(el); });
    el.querySelectorAll('[data-les]').forEach(b => b.onclick = () => { cur = b.dataset.les; answers = {}; graded = null; quiz = null; render(el); });
    const markWatched = async () => {
      try { await post(`/trainings/${cur}/watched`, {}); quiz = null; render(el); } catch (e) { toast(e.message, 'err'); }
    };
    const w = el.querySelector('[data-watched]');
    if (w) w.onclick = markWatched;
    const f = el.querySelector('[data-quiz]');
    if (f) {
      f.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { answers[+r.name.slice(1)] = +r.value; });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const n = quiz.questions.length;
        if (Object.keys(answers).length < n) { toast(tr('Hãy trả lời đủ') + ' ' + n + ' ' + tr('câu'), 'err'); return; }
        try {
          graded = await post(`/trainings/${cur}/quiz`, { answers: Array.from({ length: n }, (_, i) => answers[i]) });
          toast(graded.passed ? `${tr('Đạt')} ${graded.pct}% — ${tr('đã ghi hoàn thành khoá học')}` : `${tr('Chưa đạt')}: ${graded.pct}% (${tr('cần')} ≥ ${d.passPct}%)`, graded.passed ? 'ok' : 'err');
          render(el);
        } catch (err) { toast(err.message, 'err'); }
      };
    }
    const rt = el.querySelector('[data-retry]'); if (rt) rt.onclick = () => { answers = {}; graded = null; render(el); };
    const nx = el.querySelector('[data-next]'); if (nx) nx.onclick = () => { cur = nx.dataset.next; answers = {}; graded = null; quiz = null; render(el); };
    const rr = el.querySelector('[data-road-role]');
    if (rr) rr.onchange = () => { viewRole = rr.value; step = null; render(el); };
    const img = el.querySelector('#lt-img');
    if (img) img.onchange = async () => {
      const file = img.files[0]; if (!file) return;
      try { await put('/settings/road_' + roadKey(), { image: await shrinkImage(file) }); toast(tr('Đã tải ảnh lộ trình'), 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    };
    const rm = el.querySelector('[data-img-rm]');
    if (rm) rm.onclick = async () => { try { await put('/settings/road_' + roadKey(), { image: null }); render(el); } catch (e) { toast(e.message, 'err'); } };
  };

  await mount(el, load, draw, bind);
}

/**
 * Lớp dịch vụ AI của NetViet Sales OS.
 * Hỗ trợ 3 nhà cung cấp:
 *   - gemini : Google Gemini  (secret GEMINI_API_KEY, tuỳ chọn GEMINI_MODEL)
 *   - claude : Anthropic Claude (secret ANTHROPIC_API_KEY, tuỳ chọn CLAUDE_MODEL)
 *   - mock   : nội dung mẫu offline (luôn dùng được, không cần API key)
 * Chỉ cần nhập API key vào Secrets là dùng được ngay — không phải sửa code.
 * Nếu gọi API thật lỗi (hết quota/sai key/timeout) → tự động rơi về mock và báo lý do.
 */

const money = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0)) + ' đ';

export const AI_TASKS = [
  { key: 'email', label: 'Soạn email tiếp cận', hint: 'Nhập tên khách + dịch vụ' },
  { key: 'proposal', label: 'Dàn ý proposal', hint: 'Nhập ngành + ngân sách' },
  { key: 'objection', label: 'Xử lý từ chối', hint: 'Nhập lời từ chối của khách' },
  { key: 'pricing', label: 'Tra giá & hoa hồng', hint: 'Nhập tên gói dịch vụ' },
  { key: 'research', label: 'Research khách hàng', hint: 'Nhập tên công ty' },
  { key: 'coach', label: 'Cố vấn deal', hint: 'Mô tả tình huống deal' },
];

export const PROVIDERS = [
  { key: 'gemini', label: 'Google Gemini', icon: '✨', secret: 'GEMINI_API_KEY', help: 'Lấy key tại aistudio.google.com/apikey' },
  { key: 'claude', label: 'Anthropic Claude', icon: '🟣', secret: 'ANTHROPIC_API_KEY', help: 'Lấy key tại console.anthropic.com → API Keys' },
  { key: 'mock', label: 'AI mẫu (offline)', icon: '🧪', secret: null, help: 'Nội dung mẫu, không cần API key' },
];

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const CLAUDE_MODELS = ['claude-sonnet-4-5', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'];

export function providerStatus(env) {
  return PROVIDERS.map((p) => ({
    key: p.key,
    label: p.label,
    icon: p.icon,
    help: p.help,
    secret: p.secret,
    configured: p.key === 'mock' ? true : !!(env && env[p.secret]),
    model: p.key === 'gemini' ? (env?.GEMINI_MODEL || GEMINI_MODELS[0])
      : p.key === 'claude' ? (env?.CLAUDE_MODEL || CLAUDE_MODELS[0]) : 'rule-based',
  }));
}

/** Chọn nhà cung cấp thực tế sẽ dùng. Trả về { key, notice } */
export function pickProvider(env, wanted) {
  const has = (k) => k === 'gemini' ? !!env?.GEMINI_API_KEY : k === 'claude' ? !!env?.ANTHROPIC_API_KEY : true;
  const w = String(wanted || 'auto');
  if (w !== 'auto' && PROVIDERS.some((p) => p.key === w)) {
    if (has(w)) return { key: w, notice: null };
    const p = PROVIDERS.find((x) => x.key === w);
    return { key: has('gemini') ? 'gemini' : has('claude') ? 'claude' : 'mock', notice: `Chưa cấu hình ${p.label} (thiếu ${p.secret}) — đang dùng nhà cung cấp khác.` };
  }
  if (has('gemini')) return { key: 'gemini', notice: null };
  if (has('claude')) return { key: 'claude', notice: null };
  return { key: 'mock', notice: null };
}

/* ------------------------------ Prompt ------------------------------ */

const TASK_GUIDE = {
  email: 'Viết 1 email tiếp cận bán hàng bằng tiếng Việt: tiêu đề hấp dẫn, mở đầu cá nhân hoá, 2 hướng giải pháp cụ thể, 1 lời kêu gọi hành động xin 15 phút trao đổi. Ngắn gọn, không sáo rỗng.',
  proposal: 'Lập dàn ý proposal chuyên nghiệp theo cấu trúc đánh số: bối cảnh, mục tiêu & KPI, giải pháp NetViet, ý tưởng sáng tạo, kế hoạch triển khai, 3 mức ngân sách, cam kết chỉ số, hồ sơ năng lực.',
  objection: 'Đưa kịch bản xử lý từ chối theo 5 bước (đồng cảm → làm rõ → tái định khung giá trị → phương án thay thế → chốt bước tiếp theo), có câu thoại mẫu.',
  pricing: 'Tra bảng giá dưới đây và trả lời: giá niêm yết, chiết khấu tối đa được phép, giá sàn, hoa hồng sales ước tính, và gợi ý chốt deal mà không phải giảm giá. Tính toán chính xác theo số liệu bảng giá.',
  research: 'Phác hồ sơ nhanh về khách hàng: quy mô, hoạt động truyền thông, người ra quyết định, điểm đau, góc tiếp cận đề xuất, cảnh báo rủi ro. Nêu rõ phần nào là suy đoán.',
  coach: 'Phân tích tình huống deal và đưa hành động cụ thể trong 24h tới: kiểm tra 3 điều kiện chốt (đúng người quyết định – đủ ngân sách – có deadline) và cách xử lý phần còn thiếu.',
  document: 'Đọc kỹ nội dung file đính kèm (báo giá/hợp đồng) và liệt kê thông tin chính theo gạch đầu dòng: bên liên quan/khách hàng, hạng mục & số lượng, đơn giá & tổng giá trị, chiết khấu/điều khoản thanh toán, thời hạn hiệu lực, điều khoản phạt (nếu có), và điểm cần lưu ý hoặc thiếu sót so với quy trình NetViet. Chỉ dùng thông tin có trong file, không suy đoán thêm.',
};

function buildSystem(kind, ctx) {
  const products = (ctx.products || []).slice(0, 20);
  const price = products.length
    ? products.map((p) => `- ${p.name} (${p.line}): ${money(p.price)}/${p.unit}, hoa hồng ${p.commission_rate}%, chiết khấu tối đa ${p.max_discount}%${p.description ? ' — ' + p.description : ''}`).join('\n')
    : '(chưa có bảng giá)';
  return [
    'Bạn là trợ lý bán hàng của NetViet — công ty cung cấp 3 dịch vụ: sản xuất TVC/Video AI, Booking Gameshow, Xây kênh triệu view.',
    'Luôn trả lời bằng tiếng Việt, giọng chuyên nghiệp, ngắn gọn, đi thẳng vào hành động bán hàng. Dùng gạch đầu dòng khi phù hợp, tối đa ~350 từ.',
    'Không bịa số liệu giá — chỉ dùng bảng giá được cung cấp.',
    '',
    'BẢNG GIÁ NETVIET:', price,
    '',
    `Nhân viên sales đang hỏi: ${ctx.userName || 'nhân viên kinh doanh'}.`,
    ctx.customerName ? `Khách hàng liên quan: ${ctx.customerName}.` : '',
    '',
    'NHIỆM VỤ: ' + (TASK_GUIDE[kind] || TASK_GUIDE.coach),
  ].filter(Boolean).join('\n');
}

/* --------------------------- Gọi API thật --------------------------- */

const shortErr = (t) => {
  try {
    const d = JSON.parse(t);
    return String(d.error?.message || d.error?.type || d.message || t).slice(0, 200);
  } catch (e) { return String(t || '').slice(0, 200); }
};

async function kvGet(env, k) { try { return await env.SHARED_KV?.get(k); } catch (e) { return null; } }
async function kvPut(env, k, v) { try { await env.SHARED_KV?.put(k, v, { expirationTtl: 21600 }); } catch (e) { /* noop */ } }

async function geminiOnce(env, model, system, user, maxTokens, document) {
  const parts = document ? [{ inline_data: { mime_type: document.mime, data: document.data } }, { text: user }] : [{ text: user }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens || 1400 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const e = new Error(shortErr(await r.text()));
    e.status = r.status;
    throw e;
  }
  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts || []).map((x) => x.text).filter(Boolean).join('\n').trim();
  if (!text) { const e = new Error('Gemini trả về nội dung rỗng'); e.status = 502; throw e; }
  return text;
}

async function claudeOnce(env, model, system, user, maxTokens, document) {
  const content = document
    ? [{ type: document.mime.startsWith('image/') ? 'image' : 'document', source: { type: 'base64', media_type: document.mime, data: document.data } }, { type: 'text', text: user }]
    : user;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 1400,
      temperature: 0.7,
      system,
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const e = new Error(shortErr(await r.text()));
    e.status = r.status;
    throw e;
  }
  const d = await r.json();
  const text = (d.content || []).map((c) => c.text).filter(Boolean).join('\n').trim();
  if (!text) { const e = new Error('Claude trả về nội dung rỗng'); e.status = 502; throw e; }
  return text;
}

/** Gọi provider thật, tự thử lần lượt vài model nếu model mặc định không tồn tại. */
async function callProvider(env, provider, system, user, maxTokens, document) {
  const isG = provider === 'gemini';
  const envModel = isG ? env.GEMINI_MODEL : env.CLAUDE_MODEL;
  const cached = await kvGet(env, 'ai:model:' + provider);
  const list = [envModel, cached, ...(isG ? GEMINI_MODELS : CLAUDE_MODELS)].filter(Boolean);
  const models = [...new Set(list)];
  let last = null;
  for (const m of models) {
    try {
      const text = await (isG ? geminiOnce(env, m, system, user, maxTokens, document) : claudeOnce(env, m, system, user, maxTokens, document));
      if (m !== cached) await kvPut(env, 'ai:model:' + provider, m);
      return { text, model: m };
    } catch (e) {
      last = e;
      // Sai key / hết quyền / hết quota → dừng ngay, thử model khác cũng vô ích
      if ([401, 403, 429].includes(e.status)) break;
      if (e.name === 'TimeoutError') break;
    }
  }
  const err = new Error(last?.name === 'TimeoutError' ? 'Hết thời gian chờ phản hồi từ AI (30s)' : (last?.message || 'Không gọi được AI'));
  err.status = last?.status || 502;
  throw err;
}

/* ------------------------------ Entry ------------------------------- */

function detect(kind, prompt) {
  if (kind && kind !== 'chat') return kind;
  const p = (prompt || '').toLowerCase();
  if (/giá|báo giá|hoa hồng|chiết khấu|bao nhiêu tiền/.test(p)) return 'pricing';
  if (/email|thư|mail/.test(p)) return 'email';
  if (/proposal|đề xuất|hồ sơ/.test(p)) return 'proposal';
  if (/từ chối|đắt|giá cao|không có nhu cầu|chê/.test(p)) return 'objection';
  if (/research|tìm hiểu|thông tin về|profile/.test(p)) return 'research';
  return 'coach';
}

export async function askAI(env, { kind, prompt, context, provider, document }) {
  const k = detect(kind, prompt);
  const ctx = context || {};
  const p = (prompt || '').trim();
  const sel = pickProvider(env, provider);
  const providerLabel = (key) => (PROVIDERS.find((x) => x.key === key) || {}).label || key;

  if (sel.key === 'mock') {
    const m = mockAnswer(k, p, ctx, document);
    return { ...m, provider: 'mock', providerLabel: 'AI mẫu (offline)', model: 'rule-based', notice: sel.notice };
  }

  const system = buildSystem(k, ctx);
  const userMsg = [
    p ? `Yêu cầu của sales: ${p}` : `Thực hiện tác vụ "${k}" cho tình huống hiện tại.`,
    ctx.customerName ? `Khách hàng: ${ctx.customerName}` : '',
    ctx.extra ? `Thông tin bổ sung: ${ctx.extra}` : '',
  ].filter(Boolean).join('\n');

  try {
    const r = await callProvider(env, sel.key, system, userMsg, 1400, document);
    return {
      kind: k, text: r.text, mock: false,
      provider: sel.key, providerLabel: providerLabel(sel.key), model: r.model, notice: sel.notice,
    };
  } catch (e) {
    console.error('AI provider error', sel.key, e.message);
    const m = mockAnswer(k, p, ctx, document);
    return {
      kind: k, text: m.text, mock: true, provider: 'mock', providerLabel: 'AI mẫu (offline)', model: 'rule-based',
      fallbackFrom: sel.key,
      notice: `Không gọi được ${providerLabel(sel.key)}: ${e.message}. Đang hiển thị nội dung mẫu.`,
    };
  }
}

/** Kiểm tra kết nối nhanh tới 1 nhà cung cấp — dùng cho nút "Test kết nối" ở màn Quản trị. */
export async function testProvider(env, provider) {
  if (provider === 'mock') return { ok: true, provider: 'mock', model: 'rule-based', text: 'AI mẫu luôn sẵn sàng.' };
  const meta = PROVIDERS.find((x) => x.key === provider);
  if (!meta) return { ok: false, error: 'Nhà cung cấp không hợp lệ' };
  if (!env[meta.secret]) return { ok: false, missingSecret: meta.secret, error: `Chưa nhập ${meta.secret} trong Secrets của app` };
  try {
    const r = await callProvider(env, provider, 'Bạn là trợ lý kiểm tra kết nối. Trả lời đúng một câu ngắn bằng tiếng Việt.', 'Trả lời: "Kết nối thành công".', 64);
    return { ok: true, provider, model: r.model, text: r.text.slice(0, 200) };
  } catch (e) {
    return { ok: false, provider, error: e.message };
  }
}

/* ---------------------- Nội dung mẫu (offline) ---------------------- */

/** Bỏ dấu tiếng Việt + hạ chữ thường + tách từ — để so khớp được cả câu hỏi có dấu lẫn không dấu. */
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Tìm gói dịch vụ khớp câu hỏi bằng cách CHẤM ĐIỂM trùng từ khoá (số từ trong tên gói xuất hiện
 * trong câu hỏi), không so khớp chuỗi con theo chiều ngược (bug cũ: cắt 12 ký tự đầu câu hỏi rồi
 * tìm trong tên gói — gần như không bao giờ khớp, luôn rơi về gói đầu tiên trong danh sách).
 * Không có gói nào đạt điểm tối thiểu → trả về null (không đoán bừa), kèm vài gói gần đúng nhất.
 */
function matchProduct(query, products) {
  const qTokens = new Set(tokenize(query));
  if (!qTokens.size || !products.length) return { product: null, candidates: products.slice(0, 5) };
  const scored = products
    .map((pr) => ({ pr, score: tokenize(pr.name).filter((t, i, arr) => arr.indexOf(t) === i).filter((t) => qTokens.has(t)).length }))
    .sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score < 1) return { product: null, candidates: products.slice(0, 5) };
  return { product: scored[0].pr, candidates: scored.slice(0, 3).map((s) => s.pr) };
}

function mockAnswer(k, p, ctx, document) {
  const products = ctx.products || [];

  if (k === 'document') {
    return {
      kind: k, mock: true,
      text: [
        `_Chưa đọc được nội dung file${document ? ' (' + document.mime + ')' : ''} — AI mẫu (offline) không xử lý được file đính kèm._`,
        '',
        'Vào Secrets của app nhập `GEMINI_API_KEY` hoặc `ANTHROPIC_API_KEY` rồi tải lại tài liệu — AI thật sẽ đọc file và liệt kê: khách hàng, hạng mục & giá trị, điều khoản thanh toán, thời hạn hiệu lực, và các điểm cần lưu ý.',
      ].join('\n'),
    };
  }

  if (k === 'pricing') {
    if (!products.length) return { kind: k, mock: true, text: 'Chưa có gói dịch vụ nào trong bảng giá. Vào Sales Kit để bổ sung.' };
    const { product: pr, candidates } = matchProduct(p, products);
    if (!pr) {
      // Đặc tả M5: không bịa số liệu, không đoán bừa gói — liệt kê gợi ý để người dùng tự chọn đúng.
      return {
        kind: k, mock: true,
        text: [
          `Chưa xác định được chính xác gói dịch vụ bạn hỏi ("${p || ''}").`,
          'Vui lòng chọn đúng 1 trong các gói sau (hoặc hỏi lại rõ tên gói hơn):',
          ...(candidates.length ? candidates : products).map((x) => `• ${x.name}`),
        ].join('\n'),
      };
    }
    const disc = 10;
    return {
      kind: k, mock: true,
      text: [
        `**${pr.name}** (${pr.line})`,
        `• Giá niêm yết: **${money(pr.price)}** / ${pr.unit}`,
        `• Chiết khấu tối đa được phép: **${pr.max_discount}%** → giá sàn ${money(pr.price * (1 - pr.max_discount / 100))}`,
        `• Hoa hồng sales: **${pr.commission_rate}%** → ước tính ${money(pr.price * pr.commission_rate / 100)} (giá gốc)`,
        `• Nếu giảm ${disc}%: doanh thu ${money(pr.price * 0.9)}, hoa hồng ${money(pr.price * 0.9 * pr.commission_rate / 100)}`,
        '',
        `Gợi ý chốt: nhấn mạnh trọn gói (${pr.description || 'sản xuất + hậu kỳ + báo cáo hiệu quả'}) thay vì giảm giá.`,
      ].join('\n'),
    };
  }
  if (k === 'email') {
    const name = p || ctx.customerName || 'Quý khách';
    return {
      kind: k, mock: true,
      text: [
        `Tiêu đề: NetViet – Giải pháp video AI giúp ${name} giảm 60% chi phí sản xuất`, '',
        `Kính gửi Anh/Chị phụ trách Marketing ${name},`, '',
        'Tôi là ' + (ctx.userName || 'chuyên viên kinh doanh') + ' – NetViet, đơn vị đang đồng hành cùng hơn 120 thương hiệu ở 3 mảng: sản xuất TVC/Video AI, Booking Gameshow và Xây kênh triệu view.',
        '',
        `Với ngành hàng của ${name}, chúng tôi đề xuất 2 hướng:`,
        '1) TVC AI 15s – lên sóng trong 5 ngày, chi phí chỉ bằng ~30% quay thực tế.',
        '2) Chuỗi 10 video AI viral – tối ưu TikTok/Reels, cam kết chỉ số hiển thị.',
        '',
        'Anh/Chị dành 15 phút online trong tuần này để tôi gửi 2 case-study cùng ngành nhé?',
        '', 'Trân trọng,', (ctx.userName || 'NetViet Sales') + ' – NetViet',
      ].join('\n'),
    };
  }
  if (k === 'proposal') {
    return {
      kind: k, mock: true,
      text: [
        '**Dàn ý Proposal NetViet**',
        '1. Bối cảnh & thách thức truyền thông của khách hàng',
        '2. Mục tiêu chiến dịch (nhận biết / cân nhắc / chuyển đổi) + KPI đề xuất',
        '3. Giải pháp NetViet: TVC AI → chuỗi video viral → booking gameshow khuếch đại',
        '4. Kịch bản & moodboard tham khảo (3 hướng sáng tạo)',
        '5. Kế hoạch triển khai 8 tuần + nhân sự phụ trách',
        '6. Ngân sách 3 mức (Cơ bản / Tiêu chuẩn / Tối ưu) và điểm hòa vốn truyền thông',
        '7. Cam kết chỉ số & cơ chế báo cáo tuần',
        '8. Hồ sơ năng lực + 3 case cùng ngành',
        '', 'Lưu ý: chèn số liệu thật từ CRM (ngân sách năm ngoái, kênh đang chạy) trước khi gửi.',
      ].join('\n'),
    };
  }
  if (k === 'objection') {
    return {
      kind: k, mock: true,
      text: [
        `**Tình huống:** ${p || 'Khách nói giá cao'}`, '',
        '**Bước 1 – Đồng cảm:** "Em hiểu, ngân sách truyền thông năm nay đều bị siết ạ."',
        '**Bước 2 – Làm rõ:** "Anh/chị đang so sánh với mức nào, hay do chưa rõ phần nào trong báo giá?"',
        '**Bước 3 – Tái định khung giá trị:** quy về chi phí trên 1.000 lượt xem: TVC AI ~ 12.000đ/1k view so với quay thực tế ~ 40.000đ/1k view.',
        '**Bước 4 – Phương án thay thế:** giảm phạm vi (5 video thay vì 10) thay vì giảm đơn giá; hoặc chia 2 đợt thanh toán.',
        '**Bước 5 – Chốt bước tiếp theo:** "Em gửi bản rút gọn trong hôm nay, mai 10h anh/chị phản hồi giúp em nhé?"',
      ].join('\n'),
    };
  }
  if (k === 'research') {
    const nm = p || ctx.customerName || 'khách hàng';
    return {
      kind: k, mock: true,
      text: [
        `**Hồ sơ nhanh: ${nm}** _(dữ liệu mẫu – nhập API key Gemini/Claude để có phân tích thật)_`,
        '• Quy mô ước tính: 200–500 nhân sự, doanh thu ~500 tỷ/năm',
        '• Hoạt động truyền thông: chạy Facebook Ads đều, TikTok mới lập, chưa có TVC mới trong 18 tháng',
        '• Người ra quyết định: Giám đốc Marketing (ngân sách), CEO (duyệt >500tr)',
        '• Điểm đau: nhận diện thương hiệu thấp ở nhóm 18–25, chi phí sản xuất cao',
        '• Góc tiếp cận đề xuất: TVC AI chi phí thấp + chuỗi video viral để test thông điệp',
        '• Cảnh báo: mùa cao điểm ngân sách rơi vào Q4, nên chốt trước tháng 10',
      ].join('\n'),
    };
  }
  return {
    kind: 'coach', mock: true,
    text: [
      `**Phân tích tình huống:** ${p || 'deal đang chững'}`, '',
      '• Kiểm tra 3 điều kiện chốt: đúng người quyết định – đủ ngân sách – có deadline.',
      '• Nếu thiếu deadline: tạo lý do khẩn (slot sản xuất tháng này còn 2 chỗ).',
      '• Nếu thiếu người quyết định: xin họp 20 phút có mặt cấp trên, mang theo 1 case cùng ngành.',
      '• Hành động 24h tới: gửi bản tóm tắt 1 trang + 3 lựa chọn ngân sách, hẹn giờ phản hồi cụ thể.',
      '', '_Nội dung mẫu — nhập GEMINI_API_KEY hoặc ANTHROPIC_API_KEY để dùng AI thật._',
    ].join('\n'),
  };
}

/** Chấm điểm lead (heuristic — chạy được cả khi chưa có API key) */
export function scoreLead({ channel, need, company }) {
  let s = 40;
  // Trọng số theo 7 kênh nguồn khách của NetViet (FR-M2-1) + nguồn đấu thầu
  const ch = {
    'MGM': 25,            // khách cũ giới thiệu — tỉ lệ chốt cao nhất
    'Liên minh': 22,
    'CTV/KOL': 18,
    'Đấu thầu': 18,
    'Review': 15,
    'Tài trợ': 12,
    'Kênh cá nhân': 10,
    'Game Viral': 6,
  };
  s += ch[channel] || 6;
  if (/tvc|video|gameshow|kênh|tiktok|youtube/i.test(need || '')) s += 15;
  if (/tập đoàn|group|corp|tổng công ty/i.test(company || '')) s += 12;
  return Math.max(5, Math.min(99, s));
}

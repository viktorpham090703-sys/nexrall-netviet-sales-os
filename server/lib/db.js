import { now, uid, DAY } from './util.js';

let _migrated = false;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS nv_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT NOT NULL, title TEXT, phone TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_customers (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, industry TEXT, scale TEXT, phone TEXT, email TEXT, address TEXT, temp TEXT NOT NULL DEFAULT 'warm', source TEXT, note TEXT, services TEXT DEFAULT '[]', last_touch_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_contacts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT, phone TEXT, email TEXT, is_primary INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_leads (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, company TEXT, channel TEXT, phone TEXT, email TEXT, need TEXT, score INTEGER DEFAULT 50, status TEXT DEFAULT 'new', note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_tender_leads (id TEXT PRIMARY KEY, title TEXT NOT NULL, org TEXT, source TEXT, url TEXT, value REAL DEFAULT 0, service_tag TEXT, deadline_at INTEGER, score INTEGER DEFAULT 50, status TEXT DEFAULT 'new', assigned_to TEXT, summary TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_deals (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT NOT NULL, service TEXT, value REAL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'lead_moi', probability INTEGER DEFAULT 10, status TEXT NOT NULL DEFAULT 'open', source TEXT, expected_close_at INTEGER, last_activity_at INTEGER, stage_changed_at INTEGER, won_at INTEGER, lost_reason TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, line TEXT, unit TEXT, price REAL NOT NULL DEFAULT 0, commission_rate REAL DEFAULT 5, max_discount REAL DEFAULT 10, description TEXT, active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS nv_quotes (id TEXT PRIMARY KEY, deal_id TEXT, owner_id TEXT NOT NULL, customer_id TEXT, title TEXT, items TEXT DEFAULT '[]', subtotal REAL DEFAULT 0, discount_pct REAL DEFAULT 0, total REAL DEFAULT 0, commission REAL DEFAULT 0, status TEXT DEFAULT 'draft', approver_id TEXT, approve_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_activities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT, deal_id TEXT, type TEXT NOT NULL, subject TEXT, note TEXT, outcome TEXT, duration INTEGER DEFAULT 0, happened_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_daily_contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, company TEXT, channel TEXT, phone TEXT, customer_id TEXT, note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assigner_id TEXT, title TEXT NOT NULL, detail TEXT, type TEXT DEFAULT 'task', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', deal_id TEXT, customer_id TEXT, due_at INTEGER, accept_sla_min INTEGER DEFAULT 120, accepted_at INTEGER, done_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_daily_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT DEFAULT 'day', period TEXT NOT NULL, calls INTEGER DEFAULT 0, meetings INTEGER DEFAULT 0, new_contacts INTEGER DEFAULT 0, deals_moved INTEGER DEFAULT 0, revenue REAL DEFAULT 0, highlight TEXT, blocker TEXT, plan TEXT, late INTEGER DEFAULT 0, submitted_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_kpi_config (id TEXT PRIMARY KEY, user_id TEXT, ckey TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_kpi_scores (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, period TEXT NOT NULL, performance REAL, discipline REAL, proactive REAL, total REAL, grade TEXT, manager_note TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_commissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, deal_id TEXT, period TEXT, base REAL, rate REAL, amount REAL, status TEXT DEFAULT 'du_kien', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_pip_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, manager_id TEXT, phase TEXT, goal TEXT, metric TEXT, start_at INTEGER, end_at INTEGER, status TEXT DEFAULT 'dang_chay', result_note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_trainings (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, url TEXT, duration_min INTEGER DEFAULT 10, role_target TEXT DEFAULT 'sales', required INTEGER DEFAULT 0, description TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_training_progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, training_id TEXT NOT NULL, status TEXT DEFAULT 'assigned', progress INTEGER DEFAULT 0, assigned_by TEXT, completed_at INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT, title TEXT NOT NULL, body TEXT, link TEXT, level TEXT DEFAULT 'info', read INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_ai_interactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT, prompt TEXT, response TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nv_audit_logs (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, meta TEXT, created_at INTEGER NOT NULL)`,
];

export async function migrate(env) {
  if (_migrated) return;
  _migrated = true;
  // PRAGMA user_version bị chặn trên runtime này → lưu phiên bản schema trong bảng nv_meta.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS nv_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`); } catch (e) { /* đã có */ }
  let cur = 0;
  try {
    cur = Number(await env.DB.prepare('SELECT v FROM nv_meta WHERE k=?').bind('schema_version').first('v')) || 0;
  } catch (e) { cur = 0; }
  for (let i = cur; i < MIGRATIONS.length; i++) {
    try { await env.DB.exec(MIGRATIONS[i]); } catch (e) { console.error('migration ' + i, e.message); }
  }
  if (MIGRATIONS.length > cur) {
    try {
      await env.DB.prepare('INSERT INTO nv_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
        .bind('schema_version', String(MIGRATIONS.length)).run();
    } catch (e) { console.error('meta', e.message); }
  }
  await seed(env);
}

const pick = (arr, i) => arr[i % arr.length];

async function seed(env) {
  const c = Number(await env.DB.prepare('SELECT COUNT(*) n FROM nv_users').first('n')) || 0;
  if (c > 0) return;
  const T = now();
  const S = [];
  const P = (sql, ...b) => S.push(env.DB.prepare(sql).bind(...b));

  /* ---------- Users ---------- */
  const users = [
    ['u_admin', 'Nguyễn Quốc Bảo', 'admin@netviet.vn', 'admin', 'Giám đốc điều hành', '0901000001'],
    ['u_tp', 'Trần Thu Hà', 'tpkd@netviet.vn', 'manager', 'Trưởng phòng Kinh doanh', '0901000002'],
    ['u_s1', 'Lê Minh Tuấn', 'tuan.le@netviet.vn', 'sales', 'Chuyên viên Kinh doanh', '0901000003'],
    ['u_s2', 'Phạm Ngọc Anh', 'anh.pham@netviet.vn', 'sales', 'Chuyên viên Kinh doanh', '0901000004'],
    ['u_s3', 'Võ Hoàng Nam', 'nam.vo@netviet.vn', 'sales', 'Chuyên viên Kinh doanh', '0901000005'],
  ];
  users.forEach(u => P('INSERT INTO nv_users (id,name,email,role,title,phone,active,created_at) VALUES (?,?,?,?,?,?,1,?)', ...u, T - 200 * DAY));
  const SALES = ['u_s1', 'u_s2', 'u_s3'];

  /* ---------- Cấu hình KPI / định mức ---------- */
  const cfg = [
    ['quota_daily_contacts', '8'], ['quota_calls', '25'], ['quota_meetings', '2'],
    ['target_revenue', '400000000'], ['target_deals', '3'], ['target_pipeline', '1200000000'],
    ['discount_threshold', '15'], ['report_deadline_hour', '18'],
    ['sla_days', '{"lead_moi":2,"tiep_can":3,"nhu_cau":5,"bao_gia":4,"dam_phan":5,"chot":3,"trien_khai":14}'],
    ['task_accept_sla_min', '120'],
  ];
  cfg.forEach(([k, v]) => P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,NULL,?,?,?)', uid('cfg'), k, v, T));
  // ngưỡng linh hoạt theo từng sales
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s1', 'target_revenue', '600000000', T);
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s1', 'quota_daily_contacts', '10', T);
  P('INSERT INTO nv_kpi_config (id,user_id,ckey,value,updated_at) VALUES (?,?,?,?,?)', uid('cfg'), 'u_s3', 'target_revenue', '300000000', T);

  /* ---------- Bảng gói dịch vụ ---------- */
  const products = [
    ['pr_tvc30', 'TVC quảng cáo 30s (quay thực tế)', 'TVC/Video', 'gói', 150000000, 5, 10, 'Kịch bản + quay 2 ngày + hậu kỳ + 3 phiên bản cắt.'],
    ['pr_tvcai', 'TVC AI 15s (AI Generative)', 'TVC/Video', 'gói', 45000000, 6, 12, 'Sản xuất bằng AI: storyboard, dựng cảnh, lồng tiếng AI. Giao trong 5 ngày.'],
    ['pr_vidai', 'Chuỗi Video AI viral (10 video)', 'TVC/Video', 'gói', 80000000, 6, 12, '10 video ngắn 30-45s tối ưu TikTok/Reels, sản xuất bằng AI.'],
    ['pr_gs_talk', 'Booking Gameshow – Talkshow chuyên đề', 'Gameshow', 'số', 250000000, 4, 8, 'Xuất hiện thương hiệu trong 1 số talkshow phát sóng đa nền tảng.'],
    ['pr_gs_season', 'Booking Gameshow – Tài trợ mùa', 'Gameshow', 'mùa', 900000000, 3, 6, 'Nhà tài trợ chính 1 mùa (12 số): logo, PPL, MC đọc, hậu trường.'],
    ['pr_tiktok', 'Xây kênh TikTok triệu view – 3 tháng', 'Xây kênh', 'gói', 120000000, 7, 12, '12 video/tháng, chiến lược nội dung, seeding, báo cáo tuần.'],
    ['pr_yt', 'Xây kênh YouTube – 6 tháng', 'Xây kênh', 'gói', 220000000, 6, 10, '4 video dài + 12 shorts/tháng, tối ưu SEO, quản trị cộng đồng.'],
    ['pr_live', 'Livestream bán hàng cùng KOL', 'Xây kênh', 'phiên', 60000000, 8, 15, 'Kịch bản, KOL, setup studio, vận hành 1 phiên 3 giờ.'],
  ];
  products.forEach(p => P('INSERT INTO nv_products (id,name,line,unit,price,commission_rate,max_discount,description,active) VALUES (?,?,?,?,?,?,?,?,1)', ...p));

  /* ---------- Khách hàng + liên hệ ---------- */
  const inds = ['FMCG', 'Bất động sản', 'Ngân hàng', 'Giáo dục', 'Dược phẩm', 'Ô tô', 'Bán lẻ', 'Công nghệ'];
  const customers = [
    ['cs_01', 'u_s1', 'Công ty CP Sữa Việt Xanh', 'FMCG', 'hot', 'Website'],
    ['cs_02', 'u_s1', 'Tập đoàn BĐS An Phát', 'Bất động sản', 'hot', 'Giới thiệu'],
    ['cs_03', 'u_s1', 'Ngân hàng TMCP Đông Đô', 'Ngân hàng', 'warm', 'Sự kiện'],
    ['cs_04', 'u_s1', 'Chuỗi cà phê Nâu Việt', 'Bán lẻ', 'warm', 'Cold call'],
    ['cs_05', 'u_s2', 'Dược phẩm Minh Long', 'Dược phẩm', 'hot', 'LinkedIn'],
    ['cs_06', 'u_s2', 'Hệ thống Anh ngữ SmartKid', 'Giáo dục', 'warm', 'Facebook Ads'],
    ['cs_07', 'u_s2', 'Ô tô Trường Phát', 'Ô tô', 'cold', 'Hội chợ'],
    ['cs_08', 'u_s2', 'Siêu thị GreenMart', 'Bán lẻ', 'warm', 'Đối tác'],
    ['cs_09', 'u_s3', 'Công nghệ VinaSoft', 'Công nghệ', 'warm', 'Website'],
    ['cs_10', 'u_s3', 'Mỹ phẩm Hạ Vy', 'FMCG', 'hot', 'TikTok'],
    ['cs_11', 'u_s3', 'Nội thất Nhà Mới', 'Bán lẻ', 'cold', 'Cold call'],
    ['cs_12', 'u_s3', 'Tập đoàn Nông nghiệp Đại Lộc', 'FMCG', 'warm', 'Giới thiệu'],
  ];
  customers.forEach((c, i) => {
    P('INSERT INTO nv_customers (id,owner_id,name,industry,scale,phone,email,address,temp,source,note,services,last_touch_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c[0], c[1], c[2], c[3], pick(['SME', 'Doanh nghiệp lớn', 'Tập đoàn'], i), '028' + (3800000 + i * 137),
      'contact' + (i + 1) + '@' + c[0] + '.vn', pick(['TP.HCM', 'Hà Nội', 'Đà Nẵng'], i), c[4], c[5],
      'Khách quan tâm mảng ' + pick(['TVC AI', 'Gameshow', 'Xây kênh'], i) + '.',
      JSON.stringify([pick(['TVC/Video', 'Gameshow', 'Xây kênh'], i)]),
      T - (i % 9) * DAY, T - (60 - i) * DAY, T - (i % 9) * DAY);
    P('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,1,?)',
      uid('ct'), c[0], pick(['Chị Lan', 'Anh Hùng', 'Chị Mai', 'Anh Dũng', 'Chị Thảo'], i),
      pick(['Giám đốc Marketing', 'Trưởng phòng Truyền thông', 'CEO', 'Brand Manager'], i),
      '09' + (12000000 + i * 4321), 'mkt' + i + '@netviet-demo.vn', T - 50 * DAY);
    if (i % 3 === 0) P('INSERT INTO nv_contacts (id,customer_id,name,title,phone,email,is_primary,created_at) VALUES (?,?,?,?,?,?,0,?)',
      uid('ct'), c[0], pick(['Anh Khoa', 'Chị Vy'], i), 'Chuyên viên Truyền thông', '09' + (33000000 + i * 771), 'staff' + i + '@netviet-demo.vn', T - 40 * DAY);
  });

  /* ---------- Deals: đủ 7 giai đoạn ---------- */
  const stages = ['lead_moi', 'tiep_can', 'nhu_cau', 'bao_gia', 'dam_phan', 'chot', 'trien_khai'];
  const prob = { lead_moi: 10, tiep_can: 20, nhu_cau: 40, bao_gia: 60, dam_phan: 75, chot: 100, trien_khai: 100 };
  const dealSeeds = [
    ['dl_01', 'u_s1', 'cs_01', 'TVC AI ra mắt sữa hạt Việt Xanh', 'TVC/Video', 45000000, 'lead_moi', 1],
    ['dl_02', 'u_s1', 'cs_02', 'Chuỗi Video AI dự án An Phát Riverside', 'TVC/Video', 80000000, 'tiep_can', 6],
    ['dl_03', 'u_s1', 'cs_03', 'Tài trợ mùa Gameshow "Tài chính thông minh"', 'Gameshow', 900000000, 'dam_phan', 2],
    ['dl_04', 'u_s1', 'cs_04', 'Xây kênh TikTok Nâu Việt 3 tháng', 'Xây kênh', 120000000, 'bao_gia', 9],
    ['dl_05', 'u_s2', 'cs_05', 'TVC 30s dòng thuốc bổ Minh Long', 'TVC/Video', 150000000, 'nhu_cau', 3],
    ['dl_06', 'u_s2', 'cs_06', 'Booking talkshow giáo dục SmartKid', 'Gameshow', 250000000, 'bao_gia', 5],
    ['dl_07', 'u_s2', 'cs_07', 'Video AI ra mắt mẫu xe mới', 'TVC/Video', 80000000, 'tiep_can', 11],
    ['dl_08', 'u_s2', 'cs_08', 'Livestream bán hàng GreenMart Tết', 'Xây kênh', 60000000, 'chot', 4],
    ['dl_09', 'u_s3', 'cs_09', 'Xây kênh YouTube VinaSoft 6 tháng', 'Xây kênh', 220000000, 'nhu_cau', 8],
    ['dl_10', 'u_s3', 'cs_10', 'TVC AI + chuỗi viral Hạ Vy', 'TVC/Video', 125000000, 'dam_phan', 1],
    ['dl_11', 'u_s3', 'cs_11', 'TVC AI 15s Nội thất Nhà Mới', 'TVC/Video', 45000000, 'lead_moi', 5],
    ['dl_12', 'u_s3', 'cs_12', 'Tài trợ Gameshow nông nghiệp Đại Lộc', 'Gameshow', 250000000, 'trien_khai', 12],
    ['dl_13', 'u_s1', 'cs_01', 'Gói xây kênh TikTok Việt Xanh', 'Xây kênh', 120000000, 'chot', 20],
    ['dl_14', 'u_s2', 'cs_05', 'Chuỗi Video AI dược mỹ phẩm', 'TVC/Video', 80000000, 'trien_khai', 26],
  ];
  dealSeeds.forEach((d, i) => {
    const [id, owner, cus, title, service, value, stage, idleDays] = d;
    const won = (stage === 'chot' || stage === 'trien_khai');
    P('INSERT INTO nv_deals (id,owner_id,customer_id,title,service,value,stage,probability,status,source,expected_close_at,last_activity_at,stage_changed_at,won_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, owner, cus, title, service, value, stage, prob[stage], won ? 'won' : 'open',
      pick(['Inbound', 'Cold call', 'Giới thiệu', 'Đấu thầu'], i),
      T + (10 + i * 2) * DAY, T - idleDays * DAY, T - idleDays * DAY, won ? T - idleDays * DAY : null,
      'Deal demo phục vụ trình diễn pipeline.', T - (40 - i) * DAY, T - idleDays * DAY);
    if (won) {
      const rate = service === 'Gameshow' ? 4 : service === 'Xây kênh' ? 7 : 6;
      P('INSERT INTO nv_commissions (id,user_id,deal_id,period,base,rate,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        uid('cm'), owner, id, new Date((T - idleDays * DAY) * 1000).toISOString().slice(0, 7),
        value, rate, Math.round(value * rate / 100), idleDays > 20 ? 'da_duyet' : 'du_kien', T - idleDays * DAY);
    }
  });

  /* ---------- Hoạt động ---------- */
  const actTypes = ['call', 'email', 'meeting', 'demo', 'zalo'];
  let ai = 0;
  for (let d = 0; d < 14; d++) {
    for (const u of SALES) {
      const cnt = 2 + ((d + u.length) % 4);
      for (let k = 0; k < cnt; k++) {
        ai++;
        const cus = customers.filter(c => c[1] === u)[(k + d) % 4];
        const type = pick(actTypes, ai);
        P('INSERT INTO nv_activities (id,user_id,customer_id,deal_id,type,subject,note,outcome,duration,happened_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          uid('ac'), u, cus[0], null, type,
          pick(['Gọi chào dịch vụ TVC AI', 'Gửi hồ sơ năng lực', 'Họp tìm hiểu nhu cầu', 'Demo mẫu video AI', 'Nhắn Zalo theo dõi báo giá'], ai),
          'Ghi nhận từ ' + (type === 'call' ? 'tổng đài (mock call log)' : 'thao tác thủ công') + '.',
          pick(['Tích cực', 'Cần theo dõi', 'Chưa có nhu cầu', 'Hẹn gặp lại'], ai),
          type === 'call' ? 3 + (ai % 12) : type === 'meeting' ? 45 : 0,
          T - d * DAY - (ai % 8) * 3600, T - d * DAY);
      }
    }
  }

  /* ---------- Liên hệ mới trong ngày ---------- */
  for (let d = 0; d < 10; d++) {
    for (const u of SALES) {
      const cnt = u === 'u_s1' ? 7 : u === 'u_s2' ? 5 : 3;
      for (let k = 0; k < cnt; k++) {
        P('INSERT INTO nv_daily_contacts (id,user_id,name,company,channel,phone,customer_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          uid('dc'), u, 'Liên hệ mới ' + (d * 10 + k + 1), pick(inds, d + k) + ' Corp',
          pick(['Cold call', 'LinkedIn', 'Facebook', 'Zalo OA', 'Giới thiệu', 'Sự kiện', 'Website'], d + k),
          '09' + (70000000 + d * 1000 + k), null, 'Tiếp cận lần đầu', T - d * DAY - k * 1800);
      }
    }
  }

  /* ---------- Việc & việc được giao ---------- */
  const tasks = [
    ['u_s1', 'u_tp', 'Chăm sóc deal An Phát – gửi kịch bản v2', 'Khách yêu cầu chỉnh mood cinematic hơn.', 'assignment', 'high', 'todo', 'dl_02', 0.5],
    ['u_s1', null, 'Gọi lại chị Lan – Việt Xanh', 'Chốt lịch demo tuần này.', 'task', 'high', 'todo', 'dl_01', 0.2],
    ['u_s1', 'u_tp', 'Chuẩn bị hồ sơ thầu Gameshow Đông Đô', 'Hạn nộp còn 5 ngày.', 'assignment', 'high', 'in_progress', 'dl_03', -1],
    ['u_s2', 'u_tp', 'Nhận lead Dược Minh Long (phân bổ)', 'Liên hệ trong 24h.', 'assignment', 'medium', 'todo', 'dl_05', 0.8],
    ['u_s2', null, 'Gửi proposal SmartKid', 'Kèm bảng giá talkshow.', 'task', 'medium', 'todo', 'dl_06', 1.2],
    ['u_s2', 'u_tp', 'Cập nhật CRM khách Ô tô Trường Phát', 'Deal đã 11 ngày không hoạt động.', 'assignment', 'high', 'todo', 'dl_07', -0.3],
    ['u_s3', 'u_tp', 'Trình bày phương án YouTube VinaSoft', 'Họp 14h thứ 5.', 'assignment', 'high', 'in_progress', 'dl_09', 2],
    ['u_s3', null, 'Theo dõi hợp đồng Hạ Vy', 'Chờ phản hồi phòng pháp chế.', 'task', 'medium', 'todo', 'dl_10', 1],
    ['u_s3', 'u_tp', 'Hoàn tất nghiệm thu Đại Lộc', 'Gửi báo cáo hiệu quả tháng 1.', 'assignment', 'low', 'done', 'dl_12', -2],
  ];
  tasks.forEach((t, i) => {
    P('INSERT INTO nv_tasks (id,user_id,assigner_id,title,detail,type,priority,status,deal_id,customer_id,due_at,accept_sla_min,accepted_at,done_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('tk'), t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], null,
      Math.round(T + t[8] * DAY), 120,
      (t[6] === 'todo' && t[1]) ? null : T - DAY, t[6] === 'done' ? T - DAY : null, T - (i % 4 + 1) * DAY);
  });

  /* ---------- Báo cáo ngày ---------- */
  for (let d = 1; d <= 8; d++) {
    for (const u of SALES) {
      if (u === 'u_s3' && d % 3 === 0) continue; // thiếu báo cáo -> ảnh hưởng KPI kỷ luật
      const date = new Date((T - d * DAY) * 1000).toISOString().slice(0, 10);
      P('INSERT INTO nv_daily_reports (id,user_id,kind,period,calls,meetings,new_contacts,deals_moved,revenue,highlight,blocker,plan,late,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid('rp'), u, 'day', date, 12 + (d * 3 + u.length) % 15, d % 3, u === 'u_s1' ? 7 : u === 'u_s2' ? 5 : 3,
        d % 2, d === 2 && u === 'u_s1' ? 120000000 : 0,
        'Khách phản hồi tốt với mẫu video AI demo.', d % 4 === 0 ? 'Chờ bảng giá gameshow mùa mới.' : '',
        'Tiếp tục follow 3 deal đang báo giá.', u === 'u_s3' && d % 2 === 0 ? 1 : 0, T - d * DAY + 64800);
    }
  }

  /* ---------- Cơ hội đấu thầu (mock) ---------- */
  const tenders = [
    ['Gói thầu: Sản xuất phim tư liệu 20 năm thành lập', 'Tổng công ty Điện lực Miền Nam', 'muasamcong.mpi.gov.vn', 1200000000, 'TVC/Video', 12, 88],
    ['Truyền thông số & xây kênh TikTok chương trình OCOP', 'Sở Công Thương TP.HCM', 'muasamcong.mpi.gov.vn', 450000000, 'Xây kênh', 6, 76],
    ['Tài trợ sản xuất gameshow "Nông dân số"', 'Đài PT-TH Vĩnh Long', 'thvl.vn/thongbao', 900000000, 'Gameshow', 20, 71],
    ['Sản xuất TVC quảng bá du lịch tỉnh', 'Sở Du lịch Khánh Hòa', 'muasamcong.mpi.gov.vn', 680000000, 'TVC/Video', 3, 64],
    ['Chuỗi video AI đào tạo nội bộ', 'Tập đoàn Bảo Việt', 'baoviet.com.vn/dauthau', 320000000, 'TVC/Video', 15, 58],
    ['Quản trị kênh YouTube thương hiệu quốc gia', 'Cục Xúc tiến Thương mại', 'muasamcong.mpi.gov.vn', 540000000, 'Xây kênh', 9, 69],
  ];
  tenders.forEach((t, i) => P('INSERT INTO nv_tender_leads (id,title,org,source,url,value,service_tag,deadline_at,score,status,assigned_to,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid('td'), t[0], t[1], t[2], 'https://' + t[2], t[3], t[4], T + t[5] * DAY, t[6],
    i === 5 ? 'ignored' : 'new', null,
    'AI tóm tắt: quy mô ' + Math.round(t[3] / 1e6) + ' triệu, phù hợp năng lực NetViet mảng ' + t[4] + '. Yêu cầu hồ sơ năng lực 3 dự án tương tự.',
    T - (i % 5) * DAY));

  /* ---------- Lead theo 7 kênh ---------- */
  const channels = ['Cold call', 'LinkedIn', 'Facebook Ads', 'Giới thiệu', 'Sự kiện/Hội chợ', 'Inbound Website', 'Đấu thầu'];
  for (let i = 0; i < 12; i++) {
    P('INSERT INTO nv_leads (id,owner_id,name,company,channel,phone,email,need,score,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('ld'), SALES[i % 3], pick(['Anh Trung', 'Chị Hồng', 'Anh Phúc', 'Chị Yến', 'Anh Sơn'], i),
      pick(inds, i) + ' Group ' + (i + 1), pick(channels, i), '09' + (55000000 + i * 913),
      'lead' + i + '@demo.vn', pick(['Cần TVC ra mắt sản phẩm', 'Muốn xây kênh TikTok', 'Tìm hiểu booking gameshow'], i),
      45 + (i * 7) % 50, i % 4 === 0 ? 'contacted' : 'new',
      'AI chấm điểm dựa trên ngành, quy mô & tín hiệu quan tâm.', T - (i % 7) * DAY);
  }

  /* ---------- Báo giá ---------- */
  P('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,approver_id,approve_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'qt_01', 'dl_04', 'u_s1', 'cs_04', 'Báo giá xây kênh TikTok Nâu Việt',
    JSON.stringify([{ productId: 'pr_tiktok', name: 'Xây kênh TikTok triệu view – 3 tháng', qty: 1, price: 120000000 }]),
    120000000, 18, 98400000, 6888000, 'pending', null, null, T - 2 * DAY, T - 2 * DAY);
  P('INSERT INTO nv_quotes (id,deal_id,owner_id,customer_id,title,items,subtotal,discount_pct,total,commission,status,approver_id,approve_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'qt_02', 'dl_06', 'u_s2', 'cs_06', 'Báo giá booking talkshow SmartKid',
    JSON.stringify([{ productId: 'pr_gs_talk', name: 'Booking Gameshow – Talkshow chuyên đề', qty: 1, price: 250000000 }]),
    250000000, 5, 237500000, 9500000, 'approved', 'u_tp', 'Duyệt trong ngưỡng chiết khấu.', T - 6 * DAY, T - 5 * DAY);

  /* ---------- PIP ---------- */
  P('INSERT INTO nv_pip_records (id,user_id,manager_id,phase,goal,metric,start_at,end_at,status,result_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    uid('pip'), 'u_s3', 'u_tp', '30', 'Đạt tối thiểu 8 liên hệ mới/ngày và nộp báo cáo đúng hạn 100%.',
    'daily_contacts>=8; report_on_time=100%', T - 12 * DAY, T + 18 * DAY, 'dang_chay', null, T - 12 * DAY);

  /* ---------- Đào tạo ---------- */
  const trainings = [
    ['Nhập môn dịch vụ NetViet: TVC, Gameshow, Xây kênh', 'Sản phẩm', 'https://www.youtube.com/watch?v=ysz5S6PUM-U', 25, 'sales', 1],
    ['Kịch bản gọi điện 30 giây chốt lịch hẹn', 'Kỹ năng', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 18, 'sales', 1],
    ['Xử lý từ chối: "Giá cao quá"', 'Kỹ năng', 'https://www.youtube.com/watch?v=ScMzIvxBSi4', 15, 'sales', 1],
    ['Quy trình pipeline 7 giai đoạn & SLA', 'Quy trình', 'https://www.youtube.com/watch?v=ysz5S6PUM-U', 20, 'sales', 1],
    ['Đọc hiểu hồ sơ mời thầu truyền thông', 'Chuyên sâu', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 30, 'sales', 0],
    ['Coaching đội sales & vận hành PIP', 'Quản lý', 'https://www.youtube.com/watch?v=ScMzIvxBSi4', 35, 'manager', 1],
  ];
  const tIds = [];
  trainings.forEach((t, i) => {
    const id = 'tr_' + (i + 1); tIds.push([id, t[5], t[4]]);
    P('INSERT INTO nv_trainings (id,title,category,url,duration_min,role_target,required,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, t[0], t[1], t[2], t[3], t[4], t[5], 'Bài giảng nội bộ NetViet Academy.', T - 30 * DAY);
  });
  SALES.forEach((u, ui) => tIds.filter(t => t[2] === 'sales').forEach(([id], i) => {
    const done = i < (ui === 0 ? 4 : ui === 1 ? 3 : 1);
    P('INSERT INTO nv_training_progress (id,user_id,training_id,status,progress,assigned_by,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      uid('tp'), u, id, done ? 'completed' : (i === 4 ? 'in_progress' : 'assigned'), done ? 100 : (i === 4 ? 40 : 0),
      'u_tp', done ? T - (i + 2) * DAY : null, T - DAY);
  }));

  /* ---------- Thông báo ---------- */
  const notis = [
    ['u_s1', 'sla', 'Deal quá hạn SLA', 'Deal "Xây kênh TikTok Nâu Việt" đã 9 ngày không có hoạt động.', '#/pipeline', 'warn'],
    ['u_s1', 'assignment', 'Bạn được giao 1 việc mới', 'TP giao: Chăm sóc deal An Phát – gửi kịch bản v2', '#/tasks', 'info'],
    ['u_s2', 'sla', 'Deal nguội cần xử lý', 'Deal "Video AI ra mắt mẫu xe mới" 11 ngày không hoạt động.', '#/pipeline', 'danger'],
    ['u_s3', 'report', 'Chưa nộp báo cáo hôm qua', 'Vui lòng nộp báo cáo EOD để không bị trừ điểm kỷ luật.', '#/reports', 'warn'],
    ['u_tp', 'approval', 'Chờ duyệt chiết khấu 18%', 'Báo giá Nâu Việt vượt ngưỡng 15%.', '#/saleskit', 'danger'],
    ['u_tp', 'tender', 'Cơ hội thầu mới điểm cao', '3 gói thầu mới phù hợp năng lực NetViet.', '#/prospect', 'info'],
  ];
  notis.forEach((n, i) => P('INSERT INTO nv_notifications (id,user_id,type,title,body,link,level,read,created_at) VALUES (?,?,?,?,?,?,?,0,?)',
    uid('nt'), n[0], n[1], n[2], n[3], n[4], n[5], T - i * 3600));

  for (let i = 0; i < S.length; i += 50) await env.DB.batch(S.slice(i, i + 50));
}

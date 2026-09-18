require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const path = require('node:path');
const { customAlphabet } = require('nanoid');
const db = require('./db');
const storage = require('./storage');
const { normalizeMediaMetadata } = require('./media-metadata');
const { insert, find, filter, update, remove } = db;

const SECRET = process.env.JWT_SECRET || 'daka-dev-secret';
const PORT = process.env.PORT || 3000;
const code6 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

if (storage.mode === 'disk') {
  app.use('/uploads', (req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch (_) {
      return res.status(404).json({ err: 'not found' });
    }
    const filename = path.basename(pathname).toLowerCase();
    if (/^(?:export_|admin_export_).*\.(?:md|tsv)$/.test(filename)) {
      return res.status(404).json({ err: 'not found' });
    }
    next();
  });
  app.use('/uploads', express.static(storage.dir));
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/media/:key', async (req, res) => {
  try {
    const media = await storage.get(req.params.key, req.headers.range);
    res.status(media.status || 200);
    for (const [name, value] of Object.entries(media.headers || {})) {
      if (value !== undefined) res.setHeader(name, value);
    }
    if (!media.stream) return res.end();
    media.stream.pipe(res);
  } catch (e) {
    console.error('[media]', e && e.message || e);
    res.status(404).json({ err: 'not found' });
  }
});

const sign = (u) => jwt.sign({ id: u.id, openid: u.openid }, SECRET, { expiresIn: '30d' });
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ err: 'unauthorized' }); }
};

// ---------- 微信内容安全检查 ----------
// 获取 access_token（带缓存，2小时刷新一次）
let accessToken = { token: '', expiresAt: 0 };
const getAccessToken = async () => {
  const now = Date.now();
  if (accessToken.token && accessToken.expiresAt > now + 60000) {
    return accessToken.token;
  }
  try {
    const res = await axios.get(
      `http://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${process.env.WX_APPID}&secret=${process.env.WX_SECRET}`
    );
    const data = res.data;
    if (data.access_token) {
      accessToken.token = data.access_token;
      accessToken.expiresAt = now + (data.expires_in || 7200) * 1000;
      return data.access_token;
    }
  } catch (e) {
    console.error('[微信] 获取access_token失败:', e.message);
  }
  return null;
};

// 文本内容安全检测（msgSecCheck）
const checkText = async (text) => {
  // 未配置微信密钥时跳过检查（开发模式）
  if (!process.env.WX_APPID || !process.env.WX_SECRET) {
    console.log('[内容安全] 未配置WX_APPID，跳过文本检查');
    return { safe: true };
  }
  try {
    const token = await getAccessToken();
    if (!token) return { safe: true, reason: '获取token失败，跳过检查' };
    
    const res = await axios.post(
      `http://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`,
      { content: text },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const data = res.data;
    // errcode: 0 = 安全, 87014 = 含有违法违规内容
    if (data.errcode === 87014) {
      return { safe: false, reason: '内容可能含有违规信息，请修改后重试' };
    }
    return { safe: true };
  } catch (e) {
    console.error('[内容安全] 文本检查失败:', e.message);
    return { safe: true, reason: '检查服务异常，跳过' };
  }
};

// 图片内容安全检测（imgSecCheck）
const checkImage = async (buffer, mimetype) => {
  if (!process.env.WX_APPID || !process.env.WX_SECRET) {
    console.log('[内容安全] 未配置WX_APPID，跳过图片检查');
    return { safe: true };
  }
  try {
    const token = await getAccessToken();
    if (!token) return { safe: true };
    
    const res = await axios.post(
      `http://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`,
      buffer,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    const data = res.data;
    if (data.errcode === 87014) {
      return { safe: false, reason: '图片可能含有违规信息，请更换图片' };
    }
    return { safe: true };
  } catch (e) {
    console.error('[内容安全] 图片检查失败:', e.message);
    return { safe: true };
  }
};

// 音视频内容安全检测（mediaCheckAsync，异步检测）
const checkMediaAsync = async (mediaUrl, mediaType) => {
  // mediaType: 1=音频, 2=视频
  if (!process.env.WX_APPID || !process.env.WX_SECRET) {
    console.log('[内容安全] 未配置WX_APPID，跳过媒体检查');
    return { safe: true };
  }
  try {
    const token = await getAccessToken();
    if (!token) return { safe: true };
    
    const res = await axios.post(
      `http://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`,
      { media_url: mediaUrl, media_type: mediaType },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const data = res.data;
    if (data.errcode === 0) {
      console.log(`[内容安全] 媒体异步检测已提交，trace_id: ${data.trace_id}`);
    }
    return { safe: true, trace_id: data.trace_id };
  } catch (e) {
    console.error('[内容安全] 媒体检查失败:', e.message);
    return { safe: true };
  }
};

const absoluteUrl = (req, url) => {
  if (!url || /^https?:\/\//i.test(url)) return url;
  const pathPart = url.startsWith('/') ? url : `/${url}`;
  return `${req.protocol}://${req.get('host')}${pathPart}`;
};

const isCreator = (tid, uid) => { const t = find('tasks', t => t.id === tid); return !!t && t.admin_id === uid; };
const isAdmin = (tid, uid) => {
  if (isCreator(tid, uid)) return true;
  const m = find('task_members', m => m.task_id === tid && m.user_id === uid);
  return !!m && m.role === 'admin';
};
const isMember = (tid, uid) => !!find('task_members', m => m.task_id === tid && m.user_id === uid);
const guardMember = (tid, uid, res) => isMember(tid, uid) || (res.status(403).json({ err: 'not member' }), false);

const taskItems = tid =>
  filter('checkin_items', i => i.task_id === tid)
    .sort((a, b) => b.created_at - a.created_at || b.id - a.id);

const submittedRecords = (tid, items = taskItems(tid)) => {
  const ids = new Set(items.map(i => i.id));
  return filter('checkin_records', r => r.submitted_at > 0 && ids.has(r.item_id));
};

const recordView = (record, itemById) => {
  const item = itemById.get(record.item_id) || {};
  return {
    id: record.id,
    item_id: record.item_id,
    item_title: item.title || '',
    note: record.note,
    watched_at: record.watched_at,
    submitted_at: record.submitted_at
  };
};

const tsvCell = value => {
  const cleaned = String(value == null ? '' : value).replace(/[\t\r\n]/g, ' ');
  return /^[=+\-@]/.test(cleaned.trimStart()) ? `'${cleaned}` : cleaned;
};

const memberAdminView = (tid, member, currentItem, records) => {
  const user = find('users', u => u.id === member.user_id) || {};
  return {
    user_id: member.user_id,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    real_name: member.real_name,
    role: member.role || (isCreator(tid, member.user_id) ? 'creator' : 'member'),
    completed_count: records.length,
    current_done: !!(currentItem && records.some(r => r.item_id === currentItem.id))
  };
};

// ---------- 用户 ----------
// 静默登录：仅凭 wx.login 拿到的 code 完成登录。
// 账号一致性：优先用 unionid 复用账号，其次用 openid，确保同一微信用户一定对应同一个小程序账号。
// 资料同步：新建账号时使用客户端可选传入的 nickname/avatar 作为初始资料；
//           已有账号一律不在登录接口覆盖，资料更新走 PUT /api/me/profile。
app.post('/api/login', async (req, res) => {
  const { code, nickname, avatar } = req.body || {};
  if (!code) return res.status(400).json({ err: 'code required' });
  let openid = '', unionid = '';
  if (process.env.WX_APPID && process.env.WX_SECRET) {
    try {
      const r = await axios.get(`http://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WX_APPID}&secret=${process.env.WX_SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`);
      const data = r.data;
      if (!data.openid) return res.status(401).json({ err: data.errmsg || '微信登录失败' });
      openid = data.openid;
      unionid = data.unionid || '';
    } catch (e) {
      const errDetail = e.response ? `status=${e.response.status} data=${JSON.stringify(e.response.data)}` : (e.message || e);
      console.error('[login] jscode2session failed:', errDetail, '| stack:', e && e.stack);
      return res.status(500).json({ err: 'wx api error' });
    }
  } else {
    openid = 'wx_' + code; // 开发期回退：未配置 secret 时按 code 生成
  }
  let user = (unionid && find('users', u => u.unionid === unionid)) || find('users', u => u.openid === openid);
  if (!user) {
    user = insert('users', {
      openid,
      unionid,
      nickname: (nickname && String(nickname).trim()) || '微信用户',
      avatar: avatar || ''
    });
  } else {
    const patch = {};
    if (unionid && user.unionid !== unionid) patch.unionid = unionid;
    if (openid && user.openid !== openid) patch.openid = openid;
    if (Object.keys(patch).length) user = update('users', u => u.id === user.id, patch);
  }
  res.json({ token: sign(user), user: { id: user.id, nickname: user.nickname, avatar: user.avatar } });
});

app.get('/api/me', auth, (req, res) => {
  const u = find('users', u => u.id === req.user.id);
  if (!u) return res.status(404).json({ err: 'not found' });
  res.json({ id: u.id, nickname: u.nickname, avatar: u.avatar });
});

// 资料同步入口：用户在“我的”里通过微信头像选择器或 nickname 输入更新资料后调用。
app.put('/api/me/profile', auth, (req, res) => {
  const { nickname, avatar } = req.body || {};
  const patch = {};
  if (typeof nickname === 'string' && nickname.trim()) patch.nickname = nickname.trim().slice(0, 32);
  if (typeof avatar === 'string' && avatar) patch.avatar = avatar;
  if (!Object.keys(patch).length) return res.status(400).json({ err: 'nothing to update' });
  const u = update('users', u => u.id === req.user.id, patch);
  if (!u) return res.status(404).json({ err: 'not found' });
  res.json({ id: u.id, nickname: u.nickname, avatar: u.avatar });
});

// ---------- 内容安全预检 ----------
// 客户端在发帖/评论/提交心得前调用此接口做一次预检，提早提示用户。
// 真正提交时各业务接口仍会再做一次 checkText，避免客户端绕过校验。
app.post('/api/sec-check', auth, async (req, res) => {
  const { content } = req.body || {};
  if (!content || !String(content).trim()) return res.json({ safe: true });
  const r = await checkText(String(content));
  res.json({ safe: r.safe !== false, reason: r.reason || '' });
});

// ---------- 上传 ----------
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ err: 'no file' });
  const mediaMetadata = normalizeMediaMetadata(
    req.body.original_name || req.file.originalname,
    req.file.mimetype
  );
  
  // 图片内容安全检查
  const mime = mediaMetadata.mime;
  if (mime.startsWith('image/')) {
    const check = await checkImage(req.file.buffer, mime);
    if (!check.safe) return res.status(400).json({ err: check.reason });
  }
  
  try {
    const url = await storage.put(req.file.buffer, mediaMetadata.originalName, mediaMetadata.mime);
    res.json({ url });
  } catch (e) {
    console.error('[upload]', e && e.message || e);
    res.status(500).json({ err: 'upload failed' });
  }
});

// ---------- 任务 ----------
app.post('/api/tasks', auth, (req, res) => {
  const { name, start_date = '', end_date = '' } = req.body;
  if (!name) return res.status(400).json({ err: 'name required' });
  const t = insert('tasks', { name, start_date, end_date, admin_id: req.user.id, invite_code: code6() });
  insert('task_members', { task_id: t.id, user_id: req.user.id, real_name: '创建者', gender: '', age: 0, role: 'creator' });
  res.json(t);
});

app.get('/api/tasks', auth, (req, res) => {
  const mySubmittedRecords = filter('checkin_records', r =>
    r.user_id === req.user.id && r.submitted_at > 0);
  const completedItemIds = new Set(mySubmittedRecords.map(r => r.item_id));
  const itemsByTask = new Map();
  for (const item of filter('checkin_items', () => true)) {
    const items = itemsByTask.get(item.task_id) || [];
    items.push(item);
    itemsByTask.set(item.task_id, items);
  }
  for (const items of itemsByTask.values()) {
    items.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  }
  const list = filter('task_members', m => m.user_id === req.user.id)
    .map(m => {
      const task = find('tasks', t => t.id === m.task_id);
      if (!task) return null;
      const items = itemsByTask.get(task.id) || [];
      const myCompletedCount = items.filter(i => completedItemIds.has(i.id)).length;
      const currentItem = items.slice().reverse().find(i => !completedItemIds.has(i.id)) || null;
      return {
        ...task,
        role: isAdmin(task.id, req.user.id) ? 'admin' : 'member',
        my_completed_count: myCompletedCount,
        item_count: items.length,
        current_item: currentItem
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.created_at - a.created_at);
  res.json(list);
});

app.get('/api/tasks/:id', auth, (req, res) => {
  const id = +req.params.id;
  const t = find('tasks', t => t.id === id);
  if (!t) return res.status(404).json({ err: 'not found' });
  if (!guardMember(id, req.user.id, res)) return;
  const taskItemList = taskItems(id);
  const taskSubmittedRecords = submittedRecords(id, taskItemList);
  const myCompletedItemIds = new Set(
    taskSubmittedRecords.filter(r => r.user_id === req.user.id).map(r => r.item_id)
  );
  const items = taskItemList.map(i => ({ ...i, done: myCompletedItemIds.has(i.id) }));
  const payload = {
    ...t,
    items,
    is_admin: isAdmin(id, req.user.id),
    is_creator: isCreator(id, req.user.id)
  };
  if (payload.is_admin) {
    const latestItem = items[0] || null;
    const recordsByUser = new Map();
    for (const record of taskSubmittedRecords) {
      const records = recordsByUser.get(record.user_id) || [];
      records.push(record);
      recordsByUser.set(record.user_id, records);
    }
    const members = filter('task_members', m => m.task_id === id)
      .map(m => memberAdminView(id, m, latestItem, recordsByUser.get(m.user_id) || []));
    const completedCount = members.filter(m => m.current_done).length;
    payload.members = members;
    payload.admin_summary = {
      member_count: members.length,
      completed_count: completedCount,
      incomplete_count: members.length - completedCount,
      completion_rate: members.length ? Math.round(completedCount / members.length * 100) : 0
    };
  }
  res.json(payload);
});

app.get('/api/tasks/:id/members/:uid/records', auth, (req, res) => {
  const tid = +req.params.id;
  const uid = +req.params.uid;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  if (!isMember(tid, uid)) return res.status(404).json({ err: 'not member' });
  const items = taskItems(tid);
  const itemById = new Map(items.map(i => [i.id, i]));
  const records = filter('checkin_records', r =>
    r.user_id === uid && r.submitted_at > 0 && itemById.has(r.item_id))
    .sort((a, b) => b.submitted_at - a.submitted_at)
    .map(r => recordView(r, itemById));
  res.json(records);
});

// ---------- 多管理员管理（仅创建者 / 管理员） ----------
app.post('/api/tasks/:id/members/:uid/role', auth, (req, res) => {
  const tid = +req.params.id, uid = +req.params.uid, { role } = req.body;
  if (!isCreator(tid, req.user.id)) return res.status(403).json({ err: 'creator only' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ err: 'role invalid' });
  const m = find('task_members', m => m.task_id === tid && m.user_id === uid);
  if (!m) return res.status(404).json({ err: 'not member' });
  if (m.role === 'creator') return res.status(400).json({ err: 'cannot change creator' });
  if (role === 'admin' && m.role !== 'admin') {
    const cnt = filter('task_members', mm => mm.task_id === tid && (mm.role === 'creator' || mm.role === 'admin')).length;
    if (cnt >= 5) return res.status(400).json({ err: '管理员上限 5 人' });
  }
  update('task_members', mm => mm.id === m.id, { role });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id/members/:uid', auth, (req, res) => {
  const tid = +req.params.id, uid = +req.params.uid;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  const m = find('task_members', m => m.task_id === tid && m.user_id === uid);
  if (!m) return res.status(404).json({ err: 'not found' });
  if (m.role !== 'member') return res.status(400).json({ err: '只能移除普通成员' });
  remove('task_members', mm => mm.id === m.id);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const tid = +req.params.id;
  if (!isCreator(tid, req.user.id)) return res.status(403).json({ err: 'creator only' });
  const itemIds = new Set(filter('checkin_items', i => i.task_id === tid).map(i => i.id));
  remove('tasks', t => t.id === tid);
  remove('task_members', m => m.task_id === tid);
  remove('checkin_items', i => i.task_id === tid);
  remove('checkin_records', r => itemIds.has(r.item_id));
  res.json({ ok: true });
});

app.get('/api/tasks/by-code/:code', auth, (req, res) => {
  const t = find('tasks', t => t.invite_code === req.params.code.toUpperCase());
  if (!t) return res.status(404).json({ err: 'invalid code' });
  res.json({ id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date, joined: isMember(t.id, req.user.id) });
});

app.post('/api/tasks/join', auth, (req, res) => {
  const { invite_code, real_name, gender = '', age = 0 } = req.body;
  if (!real_name) return res.status(400).json({ err: 'real_name required' });
  const t = find('tasks', t => t.invite_code === (invite_code || '').toUpperCase());
  if (!t) return res.status(404).json({ err: 'invalid code' });
  if (!isMember(t.id, req.user.id))
    insert('task_members', { task_id: t.id, user_id: req.user.id, real_name, gender, age: +age || 0, role: 'member' });
  res.json({ task_id: t.id });
});

// ---------- 打卡内容（管理员发布） ----------
app.post('/api/tasks/:id/items', auth, async (req, res) => {
  const tid = +req.params.id;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  const { title, media_type, media_url } = req.body;
  if (!title || !media_url || !['audio', 'video'].includes(media_type))
    return res.status(400).json({ err: 'fields required' });
  
  // 内容安全检查：标题文本 + 音视频异步检测
  const titleCheck = await checkText(title);
  if (!titleCheck.safe) return res.status(400).json({ err: titleCheck.reason });
  
  // 音视频异步检测（media_type: 1=音频, 2=视频）
  const mediaCheckType = media_type === 'audio' ? 1 : 2;
  checkMediaAsync(absoluteUrl(req, media_url), mediaCheckType); // 异步执行，不阻塞返回
  
  res.json(insert('checkin_items', { task_id: tid, title, media_type, media_url }));
});

app.get('/api/items/:id', auth, (req, res) => {
  const item = find('checkin_items', i => i.id === +req.params.id);
  if (!item) return res.status(404).json({ err: 'not found' });
  if (!guardMember(item.task_id, req.user.id, res)) return;
  const my = find('checkin_records', r => r.item_id === item.id && r.user_id === req.user.id);
  res.json({ ...item, my_record: my || null });
});

app.post('/api/items/:id/watched', auth, (req, res) => {
  const id = +req.params.id;
  const item = find('checkin_items', i => i.id === id);
  if (!item) return res.status(404).json({ err: 'not found' });
  if (!guardMember(item.task_id, req.user.id, res)) return;
  let rec = find('checkin_records', r => r.item_id === id && r.user_id === req.user.id);
  if (!rec) rec = insert('checkin_records', { item_id: id, user_id: req.user.id, note: '', watched_at: Date.now(), submitted_at: 0 });
  else if (!rec.watched_at) update('checkin_records', r => r.id === rec.id, { watched_at: Date.now() });
  res.json({ ok: true });
});

app.post('/api/items/:id/submit', auth, async (req, res) => {
  const id = +req.params.id;
  const { note } = req.body;
  const item = find('checkin_items', i => i.id === id);
  if (!item) return res.status(404).json({ err: 'not found' });
  if (!guardMember(item.task_id, req.user.id, res)) return;
  if (!note) return res.status(400).json({ err: 'note required' });
  
  // 内容安全检查
  const check = await checkText(note);
  if (!check.safe) return res.status(400).json({ err: check.reason });
  
  const rec = find('checkin_records', r => r.item_id === id && r.user_id === req.user.id);
  if (!rec || !rec.watched_at) return res.status(400).json({ err: 'must watch first' });
  if (rec.submitted_at) return res.status(409).json({ err: 'already submitted' });
  update('checkin_records', r => r.id === rec.id, { note, submitted_at: Date.now() });
  res.json({ ok: true });
});

// ---------- 个人中心（任务内） ----------
app.get('/api/tasks/:id/my-records', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const items = taskItems(tid);
  const itemById = new Map(items.map(i => [i.id, i]));
  const list = filter('checkin_records', r =>
    r.user_id === req.user.id && r.submitted_at > 0 && itemById.has(r.item_id))
    .sort((a, b) => b.submitted_at - a.submitted_at)
    .map(r => recordView(r, itemById));
  res.json(list);
});

app.post('/api/tasks/:id/admin-export', auth, (req, res) => {
  const tid = +req.params.id;
  const task = find('tasks', t => t.id === tid);
  if (!task) return res.status(404).json({ err: 'not found' });
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });

  const items = taskItems(tid);
  const itemById = new Map(items.map(i => [i.id, i]));
  const recordsByUser = new Map();
  for (const record of submittedRecords(tid, items)) {
    const records = recordsByUser.get(record.user_id) || [];
    records.push(record);
    recordsByUser.set(record.user_id, records);
  }
  const rows = filter('task_members', m => m.task_id === tid).flatMap(member => {
    const user = find('users', u => u.id === member.user_id) || {};
    const name = member.real_name || user.nickname || member.user_id;
    return (recordsByUser.get(member.user_id) || []).map(record => {
      const item = itemById.get(record.item_id) || {};
      return [
        task.name || '',
        name,
        item.title || '',
        new Date(record.submitted_at).toLocaleString('zh-CN'),
        record.note
      ].map(tsvCell).join('\t');
    });
  });
  if (!rows.length) return res.status(400).json({ err: 'no records' });

  const filename = `admin_export_t${tid}_${Date.now()}.tsv`;
  const header = ['任务', '成员', '打卡内容', '打卡日期', '打卡心得'].map(tsvCell).join('\t');
  const payloadBuffer = Buffer.from(`${header}\n${rows.join('\n')}`, 'utf8');
  res.json({
    filename,
    mime_type: 'text/tab-separated-values; charset=utf-8',
    content_base64: payloadBuffer.toString('base64')
  });
});

app.post('/api/tasks/:id/export', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const { record_ids = [] } = req.body || {};
  const items = filter('checkin_items', i => i.task_id === tid);
  const ids = new Set(items.map(i => i.id));
  const recs = filter('checkin_records', r => r.user_id === req.user.id && r.submitted_at > 0 && ids.has(r.item_id))
    .filter(r => !record_ids.length || record_ids.includes(r.id))
    .sort((a, b) => a.submitted_at - b.submitted_at);
  if (!recs.length) return res.status(400).json({ err: 'no records' });
  const task = find('tasks', t => t.id === tid);
  const filename = `export_t${tid}_u${req.user.id}_${Date.now()}.md`;
  const copyBody = recs.map(r => {
    const item = items.find(i => i.id === r.item_id) || {};
    const itemTitle = item.title || '';
    return [
      `## 打卡内容名称：${itemTitle}`,
      '',
      `打卡日期：${new Date(r.submitted_at).toLocaleString('zh-CN')}`,
      `打卡任务名称：${task.name || ''}`,
      `打卡内容名称：${itemTitle}`,
      '',
      '打卡心得：',
      r.note || ''
    ].join('\n');
  }).join('\n\n---\n\n');
  const payloadBuffer = Buffer.from(`# ${task.name || ''} - 我的打卡导出\n\n${copyBody}`, 'utf8');
  res.json({
    filename,
    mime_type: 'text/markdown; charset=utf-8',
    content_base64: payloadBuffer.toString('base64')
  });
});

app.get('/', (_req, res) => res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>为一自在</title></head>
<body style="margin:0;font-family:sans-serif;background:#f5f5f5;">
  <div style="text-align:center;padding:60px 20px;">
    <h2>为一自在</h2>
    <p>服务运行中</p>
  </div>
  <footer style="text-align:center;padding:20px;color:#999;font-size:12px;">
    <a href="https://beian.miit.gov.cn/" target="_blank" style="color:#999;text-decoration:none;">粤ICP备2026056836号</a>
  </footer>
</body>
</html>`));

(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error('[db.init] failed:', e && e.message || e);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`API on http://localhost:${PORT}`);
    console.log(`WX config appid=${process.env.WX_APPID || ''}, secretLength=${(process.env.WX_SECRET || '').length}`);
  });
})();

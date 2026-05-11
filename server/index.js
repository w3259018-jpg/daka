require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { customAlphabet } = require('nanoid');
const db = require('./db');
const storage = require('./storage');
const { insert, find, filter, update, remove } = db;

const SECRET = process.env.JWT_SECRET || 'daka-dev-secret';
const PORT = process.env.PORT || 3000;
const code6 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

if (storage.mode === 'disk') {
  app.use('/uploads', express.static(storage.dir));
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const sign = (u) => jwt.sign({ id: u.id, openid: u.openid }, SECRET, { expiresIn: '30d' });
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ err: 'unauthorized' }); }
};

const isCreator = (tid, uid) => { const t = find('tasks', t => t.id === tid); return !!t && t.admin_id === uid; };
const isAdmin = (tid, uid) => {
  if (isCreator(tid, uid)) return true;
  const m = find('task_members', m => m.task_id === tid && m.user_id === uid);
  return !!m && m.role === 'admin';
};
const isMember = (tid, uid) => !!find('task_members', m => m.task_id === tid && m.user_id === uid);
const guardMember = (tid, uid, res) => isMember(tid, uid) || (res.status(403).json({ err: 'not member' }), false);

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
      const r = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WX_APPID}&secret=${process.env.WX_SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`);
      const data = await r.json();
      if (!data.openid) return res.status(401).json({ err: data.errmsg || '微信登录失败' });
      openid = data.openid;
      unionid = data.unionid || '';
    } catch (e) { return res.status(500).json({ err: 'wx api error' }); }
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

// ---------- 上传 ----------
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ err: 'no file' });
  try {
    const url = await storage.put(req.file.buffer, req.file.originalname, req.file.mimetype);
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
  const list = filter('task_members', m => m.user_id === req.user.id)
    .map(m => { const t = find('tasks', t => t.id === m.task_id); return t && { ...t, role: t.admin_id === req.user.id ? 'admin' : 'member' }; })
    .filter(Boolean).sort((a, b) => b.created_at - a.created_at);
  res.json(list);
});

app.get('/api/tasks/:id', auth, (req, res) => {
  const id = +req.params.id;
  const t = find('tasks', t => t.id === id);
  if (!t) return res.status(404).json({ err: 'not found' });
  if (!guardMember(id, req.user.id, res)) return;
  const members = filter('task_members', m => m.task_id === id).map(m => {
    const u = find('users', u => u.id === m.user_id) || {};
    const role = m.role || (m.user_id === t.admin_id ? 'creator' : 'member');
    return { user_id: m.user_id, nickname: u.nickname, avatar: u.avatar, real_name: m.real_name, gender: m.gender, age: m.age, role };
  });
  const items = filter('checkin_items', i => i.task_id === id).sort((a, b) => b.created_at - a.created_at).map(i => {
    const my = find('checkin_records', r => r.item_id === i.id && r.user_id === req.user.id);
    return { ...i, done: !!(my && my.submitted_at) };
  });
  res.json({ ...t, members, items, is_admin: isAdmin(id, req.user.id), is_creator: t.admin_id === req.user.id });
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
  const postIds = new Set(filter('posts', p => p.task_id === tid).map(p => p.id));
  remove('tasks', t => t.id === tid);
  remove('task_members', m => m.task_id === tid);
  remove('checkin_items', i => i.task_id === tid);
  remove('checkin_records', r => itemIds.has(r.item_id));
  remove('posts', p => p.task_id === tid);
  remove('post_comments', c => postIds.has(c.post_id));
  remove('post_likes', l => postIds.has(l.post_id));
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
app.post('/api/tasks/:id/items', auth, (req, res) => {
  const tid = +req.params.id;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  const { title, media_type, media_url } = req.body;
  if (!title || !media_url || !['audio', 'video'].includes(media_type))
    return res.status(400).json({ err: 'fields required' });
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

app.post('/api/items/:id/submit', auth, (req, res) => {
  const id = +req.params.id;
  const { note } = req.body;
  const item = find('checkin_items', i => i.id === id);
  if (!item) return res.status(404).json({ err: 'not found' });
  if (!guardMember(item.task_id, req.user.id, res)) return;
  if (!note) return res.status(400).json({ err: 'note required' });
  const rec = find('checkin_records', r => r.item_id === id && r.user_id === req.user.id);
  if (!rec || !rec.watched_at) return res.status(400).json({ err: 'must watch first' });
  if (rec.submitted_at) return res.status(409).json({ err: 'already submitted' });
  update('checkin_records', r => r.id === rec.id, { note, submitted_at: Date.now() });
  insert('posts', { task_id: item.task_id, user_id: req.user.id, content: note, source: 'checkin', checkin_record_id: rec.id });
  res.json({ ok: true });
});

// ---------- 排行榜 ----------
app.get('/api/tasks/:id/rank', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const itemIds = new Set(filter('checkin_items', i => i.task_id === tid).map(i => i.id));
  const list = filter('task_members', m => m.task_id === tid).map(m => {
    const u = find('users', u => u.id === m.user_id) || {};
    const cnt = filter('checkin_records', r => r.user_id === m.user_id && r.submitted_at > 0 && itemIds.has(r.item_id)).length;
    return { user_id: m.user_id, nickname: u.nickname || m.real_name, avatar: u.avatar, real_name: m.real_name, cnt };
  }).sort((a, b) => b.cnt - a.cnt);
  res.json(list);
});

// ---------- 论坛 ----------
const decoratePost = (p, uid) => {
  const u = find('users', u => u.id === p.user_id) || {};
  return {
    ...p, nickname: u.nickname, avatar: u.avatar,
    likes: filter('post_likes', l => l.post_id === p.id).length,
    comments: filter('post_comments', c => c.post_id === p.id).length,
    liked: !!find('post_likes', l => l.post_id === p.id && l.user_id === uid)
  };
};

app.get('/api/tasks/:id/posts', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const list = filter('posts', p => p.task_id === tid).sort((a, b) => b.created_at - a.created_at).map(p => decoratePost(p, req.user.id));
  res.json(list);
});

app.post('/api/tasks/:id/posts', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const { content } = req.body;
  if (!content) return res.status(400).json({ err: 'content required' });
  res.json(insert('posts', { task_id: tid, user_id: req.user.id, content, source: 'manual', checkin_record_id: 0 }));
});

app.get('/api/posts/:id', auth, (req, res) => {
  const p = find('posts', p => p.id === +req.params.id);
  if (!p) return res.status(404).json({ err: 'not found' });
  if (!guardMember(p.task_id, req.user.id, res)) return;
  const comments = filter('post_comments', c => c.post_id === p.id).sort((a, b) => a.created_at - b.created_at).map(c => {
    const u = find('users', u => u.id === c.user_id) || {};
    return { ...c, nickname: u.nickname, avatar: u.avatar };
  });
  res.json({ ...decoratePost(p, req.user.id), commentList: comments });
});

app.post('/api/posts/:id/comment', auth, (req, res) => {
  const id = +req.params.id;
  const { content, parent_id = 0 } = req.body;
  const p = find('posts', p => p.id === id);
  if (!p) return res.status(404).json({ err: 'not found' });
  if (!guardMember(p.task_id, req.user.id, res)) return;
  if (!content) return res.status(400).json({ err: 'content required' });
  res.json(insert('post_comments', { post_id: id, user_id: req.user.id, parent_id: +parent_id || 0, content }));
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const id = +req.params.id;
  const p = find('posts', p => p.id === id);
  if (!p) return res.status(404).json({ err: 'not found' });
  if (!guardMember(p.task_id, req.user.id, res)) return;
  const ex = find('post_likes', l => l.post_id === id && l.user_id === req.user.id);
  if (ex) remove('post_likes', l => l.id === ex.id);
  else insert('post_likes', { post_id: id, user_id: req.user.id });
  res.json({ liked: !ex });
});

// ---------- 个人中心（任务内） ----------
app.get('/api/tasks/:id/my-records', auth, (req, res) => {
  const tid = +req.params.id;
  if (!guardMember(tid, req.user.id, res)) return;
  const items = filter('checkin_items', i => i.task_id === tid);
  const ids = new Set(items.map(i => i.id));
  const list = filter('checkin_records', r => r.user_id === req.user.id && r.submitted_at > 0 && ids.has(r.item_id))
    .sort((a, b) => b.submitted_at - a.submitted_at).map(r => {
      const item = items.find(i => i.id === r.item_id);
      const post = find('posts', p => p.checkin_record_id === r.id);
      return {
        ...r, item_title: item && item.title, post_id: post && post.id,
        likes: post ? filter('post_likes', l => l.post_id === post.id).length : 0,
        comments: post ? filter('post_comments', c => c.post_id === post.id).length : 0
      };
    });
  res.json(list);
});

app.post('/api/tasks/:id/export', auth, async (req, res) => {
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
  const body = recs.map(r => {
    const item = items.find(i => i.id === r.item_id) || {};
    return `## ${item.title || ''}\n时间：${new Date(r.submitted_at).toLocaleString('zh-CN')}\n\n${r.note}\n`;
  }).join('\n---\n\n');
  const filename = `export_t${tid}_u${req.user.id}_${Date.now()}.md`;
  const buf = Buffer.from(`# ${task.name} · 我的打卡心得\n\n${body}`, 'utf8');
  try {
    const url = await storage.put(buf, filename, 'text/markdown; charset=utf-8', filename);
    res.json({ url, filename });
  } catch (e) {
    console.error('[export]', e && e.message || e);
    res.status(500).json({ err: 'export failed' });
  }
});

app.get('/', (_req, res) => res.json({ ok: true, name: '打卡监督 API' }));

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

# 微信小程序社交功能移除与界面改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有打卡小程序改造成无用户间互动的封闭式任务工具，并实现已审批的“温暖米橙成员端 + 高效管理员看板”界面。

**Architecture:** 服务端先建立角色隔离的响应结构和管理员专用接口，成员接口只返回本人数据；打卡提交只写 `checkin_records`，所有社交路由和页面彻底移除。前端使用四项导航“今天、计划、记录、我的”，任务详情根据 `is_admin` 分支展示成员私密视图或管理员控制台。

**Tech Stack:** 微信小程序原生 WXML/WXSS/JavaScript、Node.js、Express、JSON/MySQL 双存储、现有 Node smoke test 与静态检查脚本。

---

## 实施约束

- 当前工作区已有大量未提交修改。执行每个提交前必须运行 `git diff -- <本任务文件>`，只暂存本任务明确列出的文件，禁止使用 `git add .`。
- 不回退现有用户修改；若目标文件中存在与计划冲突的修改，先保留并围绕它实现。
- “今天待办”定义为每个任务当前最早未完成的打卡项；不新增每日任务或截止时间数据表。
- 管理员看板的“当前完成情况”定义为任务最新发布打卡项的成员完成状态。
- 历史社交数据采用先归档后停用。生产环境执行归档脚本并确认备份后，才允许删除 MySQL 社交表。

## 文件结构与职责

### 新增文件

- `server/archive-social-data.js`：归档 JSON/MySQL 中的帖子、评论和点赞数据，可显式执行清理。
- `miniprogram/pages/records/records.js`：加载、筛选、选择和导出当前用户本人记录。
- `miniprogram/pages/records/records.wxml`：本人记录列表和隐私提示。
- `miniprogram/pages/records/records.wxss`：记录页局部样式。
- `miniprogram/pages/records/records.json`：记录页标题配置。

### 核心修改文件

- `server/index.js`：权限隔离、管理员完成情况、本人记录、管理员导出、删除社交 API。
- `server/smoke-test.js`：端到端验证成员隔离、管理员权限和社交 API 下线。
- `server/db.json.js`、`server/db.mysql.js`：停止加载和创建社交表。
- `miniprogram/app.json`、`miniprogram/custom-tab-bar/*`：四项导航并移除社交页面。
- `miniprogram/app.wxss`：审批后的米橙设计令牌和通用组件。
- `miniprogram/pages/tasks/*`：成员“今天”首页。
- `miniprogram/pages/taskboard/*`：参与/管理任务列表。
- `miniprogram/pages/task/*`：成员任务详情与管理员控制台。
- `miniprogram/pages/item/*`：私密打卡提交。
- `miniprogram/pages/profile/*`：仅保留账号和设置。
- `miniprogram/pages/join/*`：加入任务隐私说明。
- `miniprogram/pages/privacy/privacy.wxml`、`miniprogram/pages/agreement/agreement.wxml`、`README.md`：删除社交描述并记录新权限边界。
- `check-miniprogram.js`：增加禁止社交页面、路由和文案引用的静态检查。

### 删除文件

- `miniprogram/pages/forum/*`
- `miniprogram/pages/post/*`
- `miniprogram/pages/rank/*`

---

### Task 1: 用端到端测试锁定新的隐私与权限边界

**Files:**
- Modify: `server/smoke-test.js`

- [ ] **Step 1: 将现有社交测试改成新的失败测试**

保留登录、创建任务、加入、发布、观看、提交、角色管理和解散测试。删除帖子、评论、点赞、排行榜成功路径，并加入以下断言：

```js
const memberDetail = await req('GET', `/api/tasks/${tid}`, null, tB);
ok(memberDetail.status === 200, '成员可查看参与任务');
ok(!('members' in memberDetail.data), '成员任务详情不返回成员列表');
ok(!('admin_summary' in memberDetail.data), '成员任务详情不返回管理员统计');

const adminDetail = await req('GET', `/api/tasks/${tid}`, null, tA);
ok(adminDetail.status === 200 && Array.isArray(adminDetail.data.members), '管理员可查看成员状态');
ok(adminDetail.data.admin_summary.member_count === 2, '管理员统计包含成员总数');

const adminRecords = await req('GET', `/api/tasks/${tid}/members/${b.data.user.id}/records`, null, tA);
ok(adminRecords.status === 200 && adminRecords.data.length === 1, '管理员可查看本任务成员记录');

const memberDenied = await req('GET', `/api/tasks/${tid}/members/${a.data.user.id}/records`, null, tB);
ok(memberDenied.status === 403, '普通成员不可查看其他成员记录');

const my = await req('GET', `/api/tasks/${tid}/my-records`, null, tB);
ok(my.status === 200 && my.data.length === 1, '成员可查看本人记录');
ok(!('post_id' in my.data[0]) && !('likes' in my.data[0]) && !('comments' in my.data[0]), '本人记录不包含社交字段');

for (const [method, url, body] of [
  ['GET', `/api/tasks/${tid}/rank`],
  ['GET', `/api/tasks/${tid}/posts`],
  ['POST', `/api/tasks/${tid}/posts`, { content: '不可发布' }],
  ['GET', '/api/posts/1'],
  ['POST', '/api/posts/1/comment', { content: '不可评论' }],
  ['POST', '/api/posts/1/like', {}]
]) {
  const r = await req(method, url, body, tA);
  ok(r.status === 404, `社交接口已下线: ${method} ${url}`);
}
```

- [ ] **Step 2: 运行测试并确认隐私断言失败**

Run:

```powershell
node --check server\smoke-test.js
```

Expected: exit `0`。

启动服务端后运行：

```powershell
Set-Location server
node smoke-test.js
```

Expected: 在“成员任务详情不返回成员列表”或管理员记录接口处失败，证明测试覆盖现有泄露行为。

- [ ] **Step 3: 提交测试**

```powershell
git add -- server/smoke-test.js
git commit -m "test: define private task access boundaries"
```

---

### Task 2: 建立服务端任务摘要和管理员专用数据接口

**Files:**
- Modify: `server/index.js`
- Test: `server/smoke-test.js`

- [ ] **Step 1: 添加统一记录装饰与任务统计辅助函数**

在 `guardMember` 后添加：

```js
const taskItems = tid =>
  filter('checkin_items', i => i.task_id === tid).sort((a, b) => b.created_at - a.created_at);

const submittedRecords = tid => {
  const ids = new Set(taskItems(tid).map(i => i.id));
  return filter('checkin_records', r => r.submitted_at > 0 && ids.has(r.item_id));
};

const recordView = (record, items) => {
  const item = items.find(i => i.id === record.item_id) || {};
  return {
    id: record.id,
    item_id: record.item_id,
    item_title: item.title || '',
    note: record.note,
    watched_at: record.watched_at,
    submitted_at: record.submitted_at
  };
};

const memberAdminView = (tid, member, currentItem) => {
  const user = find('users', u => u.id === member.user_id) || {};
  const records = submittedRecords(tid).filter(r => r.user_id === member.user_id);
  return {
    user_id: member.user_id,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    real_name: member.real_name,
    role: member.role,
    completed_count: records.length,
    current_done: !!(currentItem && records.some(r => r.item_id === currentItem.id))
  };
};
```

- [ ] **Step 2: 丰富任务列表中的本人摘要**

将 `GET /api/tasks` 返回项扩展为：

```js
const list = filter('task_members', m => m.user_id === req.user.id)
  .map(m => {
    const task = find('tasks', t => t.id === m.task_id);
    if (!task) return null;
    const items = taskItems(task.id);
    const mine = filter('checkin_records', r =>
      r.user_id === req.user.id && r.submitted_at > 0 && items.some(i => i.id === r.item_id));
    const currentItem = items.slice().reverse().find(i => !mine.some(r => r.item_id === i.id)) || null;
    return {
      ...task,
      role: isAdmin(task.id, req.user.id) ? 'admin' : 'member',
      my_completed_count: mine.length,
      item_count: items.length,
      current_item: currentItem
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.created_at - a.created_at);
```

- [ ] **Step 3: 将任务详情改成角色隔离响应**

`GET /api/tasks/:id` 的公共响应只包含任务、打卡项和本人完成情况。仅管理员附加成员与统计：

```js
const items = taskItems(id).map(item => {
  const mine = find('checkin_records', r => r.item_id === item.id && r.user_id === req.user.id);
  return { ...item, done: !!(mine && mine.submitted_at) };
});
const payload = {
  ...t,
  items,
  is_admin: isAdmin(id, req.user.id),
  is_creator: isCreator(id, req.user.id)
};
if (payload.is_admin) {
  const latestItem = items[0] || null;
  const members = filter('task_members', m => m.task_id === id)
    .map(m => memberAdminView(id, m, latestItem));
  payload.members = members;
  payload.admin_summary = {
    member_count: members.length,
    completed_count: members.filter(m => m.current_done).length,
    incomplete_count: members.filter(m => !m.current_done).length,
    completion_rate: members.length
      ? Math.round(members.filter(m => m.current_done).length / members.length * 100)
      : 0
  };
}
res.json(payload);
```

- [ ] **Step 4: 添加管理员查看成员记录接口**

```js
app.get('/api/tasks/:id/members/:uid/records', auth, (req, res) => {
  const tid = +req.params.id;
  const uid = +req.params.uid;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  if (!isMember(tid, uid)) return res.status(404).json({ err: 'not member' });
  const items = taskItems(tid);
  const ids = new Set(items.map(i => i.id));
  const records = filter('checkin_records', r =>
    r.user_id === uid && r.submitted_at > 0 && ids.has(r.item_id))
    .sort((a, b) => b.submitted_at - a.submitted_at)
    .map(r => recordView(r, items));
  res.json(records);
});
```

- [ ] **Step 5: 运行 smoke test 验证角色隔离**

Run: `node server\smoke-test.js`，服务端需已运行。

Expected: 成员详情隔离、管理员成员记录和非管理员 `403` 断言通过；测试仍会在社交 API 下线断言处失败。

- [ ] **Step 6: 提交服务端权限隔离**

```powershell
git add -- server/index.js server/smoke-test.js
git commit -m "feat: isolate member and admin task data"
```

---

### Task 3: 移除社交 API 和打卡同步帖子行为

**Files:**
- Modify: `server/index.js`
- Modify: `server/smoke-test.js`

- [ ] **Step 1: 停止打卡提交创建帖子**

将提交成功逻辑改为：

```js
update('checkin_records', r => r.id === rec.id, { note, submitted_at: Date.now() });
res.json({ ok: true });
```

- [ ] **Step 2: 删除社交路由和辅助函数**

从 `server/index.js` 删除：

```text
GET  /api/tasks/:id/rank
GET  /api/tasks/:id/posts
POST /api/tasks/:id/posts
GET  /api/posts/:id
POST /api/posts/:id/comment
POST /api/posts/:id/like
decoratePost()
```

同时从任务解散逻辑中删除 `posts`、`post_comments` 和 `post_likes` 的级联处理，仅删除任务、成员、打卡项和打卡记录。

- [ ] **Step 3: 让本人记录只返回私密字段**

将 `GET /api/tasks/:id/my-records` 的映射改成：

```js
const list = filter('checkin_records', r =>
  r.user_id === req.user.id && r.submitted_at > 0 && ids.has(r.item_id))
  .sort((a, b) => b.submitted_at - a.submitted_at)
  .map(r => recordView(r, items));
res.json(list);
```

- [ ] **Step 4: 添加管理员任务导出接口**

新增 `POST /api/tasks/:id/admin-export`，只允许任务管理员调用，导出该任务成员的完成记录：

```js
app.post('/api/tasks/:id/admin-export', auth, async (req, res) => {
  const tid = +req.params.id;
  if (!isAdmin(tid, req.user.id)) return res.status(403).json({ err: 'admin only' });
  const task = find('tasks', t => t.id === tid);
  if (!task) return res.status(404).json({ err: 'not found' });
  const items = taskItems(tid);
  const members = filter('task_members', m => m.task_id === tid);
  const rows = members.flatMap(member =>
    submittedRecords(tid)
      .filter(r => r.user_id === member.user_id)
      .map(r => {
        const item = items.find(i => i.id === r.item_id) || {};
        return `${member.real_name || member.user_id}\t${item.title || ''}\t${new Date(r.submitted_at).toLocaleString('zh-CN')}\t${r.note}`;
      }));
  if (!rows.length) return res.status(400).json({ err: 'no records' });
  const filename = `admin_export_t${tid}_${Date.now()}.tsv`;
  const buffer = Buffer.from(`成员\t任务\t提交时间\t心得\n${rows.join('\n')}`, 'utf8');
  const url = await storage.put(buffer, filename, 'text/tab-separated-values; charset=utf-8', filename);
  res.json({ url, filename });
});
```

- [ ] **Step 5: 扩充 smoke test 验证管理员导出权限**

```js
const adminExport = await req('POST', `/api/tasks/${tid}/admin-export`, {}, tA);
ok(adminExport.status === 200, '管理员可导出任务完成数据');
const deniedExport = await req('POST', `/api/tasks/${tid}/admin-export`, {}, tB);
ok(deniedExport.status === 403, '普通成员不可导出任务完成数据');
```

- [ ] **Step 6: 运行端到端测试**

Run: `node server\smoke-test.js`，服务端需已运行。

Expected: 全部断言通过，包括六个社交接口返回 `404`。

- [ ] **Step 7: 提交社交服务下线**

```powershell
git add -- server/index.js server/smoke-test.js
git commit -m "feat: remove social APIs and private checkin sync"
```

---

### Task 4: 归档并停用社交数据表

**Files:**
- Create: `server/archive-social-data.js`
- Modify: `server/db.json.js`
- Modify: `server/db.mysql.js`
- Modify: `.gitignore`
- Modify: `server/package.json`

- [ ] **Step 1: 创建显式归档脚本**

脚本行为：

- 默认将三张社交表导出至 `server/backups/social-<timestamp>.json`。
- 只有传入 `--purge` 时才清空 JSON 数组或执行 MySQL `DROP TABLE IF EXISTS post_likes, post_comments, posts`。
- 输出每张表的归档数量和备份绝对路径。

核心入口：

```js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OUT_DIR = path.join(__dirname, 'backups');
const purge = process.argv.includes('--purge');

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(OUT_DIR, `social-${stamp}.json`);
  if ((process.env.STORAGE || 'json').toLowerCase() === 'mysql') {
    await archiveMysql(out, purge);
  } else {
    archiveJson(out, purge);
  }
  console.log(`social backup: ${out}`);
};

run().catch(err => { console.error(err); process.exit(1); });
```

`archiveJson()` 必须先写备份，再在 `--purge` 时删除 `posts`、`post_comments`、`post_likes` 键和对应 `seq` 键。`archiveMysql()` 使用现有 MySQL 环境变量连接，先 `SELECT *` 写备份，再按 `post_likes → post_comments → posts` 顺序删除表。

- [ ] **Step 2: 加入脚本命令和备份忽略规则**

`server/package.json`：

```json
"archive-social": "node archive-social-data.js"
```

`.gitignore`：

```gitignore
server/backups/
```

- [ ] **Step 3: 停止 JSON/MySQL 数据层加载社交表**

两种存储的 `TABLES` 仅保留：

```js
const TABLES = ['users', 'tasks', 'task_members', 'checkin_items', 'checkin_records'];
```

从 `server/db.mysql.js` 的 `SCHEMA`、`COLUMNS` 和 `DEFAULTS` 删除社交表定义。

- [ ] **Step 4: 在本地 JSON 数据上验证归档但不清理**

Run:

```powershell
Set-Location server
npm run archive-social
```

Expected: 输出备份路径和三张表数量；`server/data.json` 未改变；备份文件被 `.gitignore` 忽略。

- [ ] **Step 5: 验证服务端不再引用社交表**

Run:

```powershell
Select-String -Path server\index.js,server\db.json.js,server\db.mysql.js -Pattern "posts|post_comments|post_likes"
```

Expected: 无输出。

- [ ] **Step 6: 提交数据层停用**

```powershell
git add -- .gitignore server/archive-social-data.js server/package.json server/db.json.js server/db.mysql.js
git commit -m "chore: archive and retire social data tables"
```

---

### Task 5: 改造静态检查并移除社交页面与导航

**Files:**
- Modify: `check-miniprogram.js`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/custom-tab-bar/index.js`
- Modify: `miniprogram/custom-tab-bar/index.wxml`
- Modify: `miniprogram/custom-tab-bar/index.wxss`
- Delete: `miniprogram/pages/forum/*`
- Delete: `miniprogram/pages/post/*`
- Delete: `miniprogram/pages/rank/*`

- [ ] **Step 1: 先添加会失败的禁止引用静态检查**

在 `check-miniprogram.js` 添加：

```js
const banned = [
  /pages\/forum\/forum/,
  /pages\/post\/post/,
  /pages\/rank\/rank/,
  /\/api\/tasks\/[^'"`]+\/posts/,
  /\/api\/posts\//,
  /\/rank/
];

for (const f of [...walk(ROOT, '.js'), ...walk(ROOT, '.wxml'), path.join(ROOT, 'app.json')]) {
  const text = fs.readFileSync(f, 'utf8');
  for (const pattern of banned) {
    if (pattern.test(text)) ng(`banned social reference: ${path.relative(ROOT, f)} ${pattern}`);
  }
}
```

- [ ] **Step 2: 运行静态检查确认失败**

Run: `node check-miniprogram.js`

Expected: 社区、帖子和排行榜页面与导航引用导致失败。

- [ ] **Step 3: 将 app.json 改为四项导航**

页面顺序以 tab 页开头：

```json
{
  "pages": [
    "pages/tasks/tasks",
    "pages/taskboard/taskboard",
    "pages/records/records",
    "pages/profile/profile",
    "pages/create/create",
    "pages/task/task",
    "pages/item/item",
    "pages/join/join",
    "pages/privacy/privacy",
    "pages/agreement/agreement"
  ],
  "tabBar": {
    "custom": true,
    "list": [
      { "pagePath": "pages/tasks/tasks", "text": "今天" },
      { "pagePath": "pages/taskboard/taskboard", "text": "计划" },
      { "pagePath": "pages/records/records", "text": "记录" },
      { "pagePath": "pages/profile/profile", "text": "我的" }
    ]
  }
}
```

保留现有 `window`、`sitemapLocation`、`lazyCodeLoading`、`usingComponents` 和隐私配置。

- [ ] **Step 4: 简化自定义底部导航**

`index.js` 使用四项平铺数组，索引为 `0..3`：

```js
tabs: [
  { path: '/pages/tasks/tasks', text: '今天', icon: '⌂', i: 0 },
  { path: '/pages/taskboard/taskboard', text: '计划', icon: '□', i: 1 },
  { path: '/pages/records/records', text: '记录', icon: '◎', i: 2 },
  { path: '/pages/profile/profile', text: '我的', icon: '○', i: 3 }
]
```

删除中央加号和 `openCreate()`，WXML 仅循环 `tabs`。

- [ ] **Step 5: 删除社交页面目录**

删除 `forum`、`post` 和 `rank` 三个页面目录中的全部文件。

- [ ] **Step 6: 再次运行静态检查**

Run: `node check-miniprogram.js`

Expected: 可能因 `records` 页面尚未创建而报告缺失，但不再报告社交页面或路由引用。

- [ ] **Step 7: 提交导航与页面删除**

```powershell
git add -- check-miniprogram.js miniprogram/app.json miniprogram/custom-tab-bar miniprogram/pages/forum miniprogram/pages/post miniprogram/pages/rank
git commit -m "feat: remove social pages and navigation"
```

---

### Task 6: 应用温暖米橙视觉系统

**Files:**
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/custom-tab-bar/index.wxss`
- Modify: `miniprogram/pages/item/item.wxss`
- Modify: `miniprogram/pages/profile/profile.wxss`
- Reference: `design-previews/selected-combined-concept.png`

- [ ] **Step 1: 替换全局色彩和组件令牌**

将绿色视觉替换为审批色值：

```css
page {
  background: linear-gradient(180deg, #FCFAF6 0%, #FFFDF9 100%);
  color: #30261E;
}
.card {
  background: #FFFDF9;
  border-color: #F0E7DC;
  box-shadow: 0 16rpx 42rpx rgba(89, 61, 37, .06);
}
.hero-card, .btn {
  background: linear-gradient(135deg, #F2B36D 0%, #E98243 100%);
}
.btn-line, .input, .tag, .pill, .stat-item {
  background: #FBEFE4;
  color: #E27434;
  border-color: #F3D7BF;
}
.muted { color: #988878; }
.title, .section-title, .hello { color: #30261E; }
.divider { background: #F0E7DC; }
```

- [ ] **Step 2: 更新底部导航**

使用白色/米白背景、暖橙选中态，移除中央按钮相关样式。

- [ ] **Step 3: 保留打卡成功动画并换为暖橙色**

将遮罩、文字阴影和粒子颜色调整为 `#E98243`、`#F2B36D`、`#FFD7A8`，不改变动画行为。

- [ ] **Step 4: 运行静态检查**

Run: `node check-miniprogram.js`

Expected: 除尚未创建的 `records` 页面外，无新增语法或引用错误。

- [ ] **Step 5: 提交视觉系统**

```powershell
git add -- miniprogram/app.wxss miniprogram/custom-tab-bar/index.wxss miniprogram/pages/item/item.wxss miniprogram/pages/profile/profile.wxss
git commit -m "style: apply warm orange visual system"
```

---

### Task 7: 实现“今天”和“计划”页面

**Files:**
- Modify: `miniprogram/pages/tasks/tasks.js`
- Modify: `miniprogram/pages/tasks/tasks.wxml`
- Modify: `miniprogram/pages/tasks/tasks.wxss`
- Modify: `miniprogram/pages/tasks/tasks.json`
- Modify: `miniprogram/pages/taskboard/taskboard.js`
- Modify: `miniprogram/pages/taskboard/taskboard.wxml`
- Modify: `miniprogram/pages/taskboard/taskboard.json`

- [ ] **Step 1: 将首页数据整理为今日待办与管理摘要**

`tasks.js` 加载 `/api/tasks` 后分组：

```js
const managed = tasks.filter(t => t.role === 'admin');
const pending = tasks.filter(t => t.current_item);
const completed = tasks.filter(t => t.item_count > 0 && t.my_completed_count === t.item_count);
this.setData({
  user,
  tasks,
  managed,
  pending,
  completedCount: completed.length,
  remainingCount: pending.length
});
```

保留加入邀请码和新建任务入口，但从主视觉中降级为次要操作。

- [ ] **Step 2: 按审批稿重写今天页 WXML**

页面必须包含：

- “今天，完成一件小事”标题。
- 今日剩余数量和继续打卡主按钮。
- 正在进行任务卡。
- 本周节奏展示，仅使用本人完成数据。
- 管理员可见“我管理的任务”摘要。
- 不出现成员头像、排行榜、社区或整体成员数据。

- [ ] **Step 3: 将计划页按角色分组**

`taskboard.js`：

```js
const tasks = await safe(request('/api/tasks'), []);
this.setData({
  participating: tasks.filter(t => t.role !== 'admin'),
  managed: tasks.filter(t => t.role === 'admin')
});
```

WXML 提供“我参与的计划”“我管理的计划”、创建任务和邀请码加入入口。

- [ ] **Step 4: 设置 tab 索引和页面标题**

- `tasks.js` 选中索引 `0`，标题“今天”。
- `taskboard.js` 选中索引 `1`，标题“计划”。

- [ ] **Step 5: 运行静态检查**

Run: `node check-miniprogram.js`

Expected: 无 tasks/taskboard 语法或引用错误。

- [ ] **Step 6: 提交今天与计划页面**

```powershell
git add -- miniprogram/pages/tasks miniprogram/pages/taskboard
git commit -m "feat: build today and plans pages"
```

---

### Task 8: 实现角色化任务详情、管理员看板和私密打卡

**Files:**
- Modify: `miniprogram/pages/task/task.js`
- Modify: `miniprogram/pages/task/task.wxml`
- Modify: `miniprogram/pages/task/task.wxss`
- Modify: `miniprogram/pages/item/item.wxml`
- Modify: `miniprogram/pages/item/item.js`
- Modify: `miniprogram/pages/join/join.wxml`

- [ ] **Step 1: 调整任务详情视图模型**

`buildViewData(task)` 必须只从管理员响应读取成员统计：

```js
const items = task.items || [];
const done = items.filter(i => i.done).length;
return {
  task,
  currentItem: items.slice().reverse().find(i => !i.done) || items[0] || null,
  myStats: { completed: done, total: items.length },
  adminSummary: task.is_admin ? task.admin_summary : null,
  members: task.is_admin ? (task.members || []) : []
};
```

删除 `goRank()`、`goForum()` 和旧 `goProfile()` 社交跳转。

- [ ] **Step 2: 添加管理员成员记录查看和导出动作**

```js
async openMemberRecords(e) {
  const uid = e.currentTarget.dataset.uid;
  const records = await request(`/api/tasks/${this.data.id}/members/${uid}/records`);
  this.setData({ memberRecords: records, showMemberRecords: true });
},

async exportAdminData() {
  const result = await request(`/api/tasks/${this.data.id}/admin-export`, { method: 'POST' });
  wx.setClipboardData({ data: fullUrl(result.url) });
}
```

管理员记录使用当前页弹层展示，不创建成员公开主页。

- [ ] **Step 3: 按角色重写任务详情**

成员视图必须包含本人进度、本人日历、当前打卡项和“仅本人记录”提示，不渲染 `members` 或 `admin_summary`。

管理员视图必须包含：

- 当前完成率、成员总数、已完成、未完成。
- 成员状态列表和筛选。
- 发布打卡、分享邀请、导出、角色管理和移除成员。
- 成员记录私密弹层。

- [ ] **Step 4: 更新打卡提交页隐私说明**

在心得输入区下方加入：

```xml
<view class="privacy-note">
  本次心得不会向其他成员展示，仅你本人和本任务管理员可查看。
</view>
```

保留播放后提交、内容安全检查和成功动画。

- [ ] **Step 5: 更新加入任务说明**

加入页明确显示：

```xml
<view class="privacy-note">
  加入后，任务管理员可查看你在本任务中的完成状态和打卡记录；其他成员不可查看。
</view>
```

- [ ] **Step 6: 运行服务端和小程序检查**

Run:

```powershell
node server\smoke-test.js
node check-miniprogram.js
```

Expected: 服务端隐私测试通过；小程序静态检查除 records 页面未完成外无错误。

- [ ] **Step 7: 提交任务和打卡页面**

```powershell
git add -- miniprogram/pages/task miniprogram/pages/item miniprogram/pages/join
git commit -m "feat: add private member tasks and admin dashboard"
```

---

### Task 9: 拆分“记录”和“我的”

**Files:**
- Create: `miniprogram/pages/records/records.js`
- Create: `miniprogram/pages/records/records.wxml`
- Create: `miniprogram/pages/records/records.wxss`
- Create: `miniprogram/pages/records/records.json`
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`
- Modify: `miniprogram/pages/profile/profile.json`

- [ ] **Step 1: 将本人记录逻辑移动到 records 页面**

从现有 `profile.js` 移动任务筛选、日期筛选、记录选择、本人导出和 `handleExport()`。移除 `goPost()`。

`records.js` 选中 tab 索引 `2`，记录映射只使用：

```js
{
  id,
  item_id,
  item_title,
  note,
  watched_at,
  submitted_at,
  date
}
```

- [ ] **Step 2: 实现审批稿中的私密记录界面**

记录页必须包含：

- 本人累计完成统计。
- 按任务和日期筛选。
- 私人心得卡片。
- 导出选中记录。
- “不展示点赞、评论和其他成员动态”提示。

- [ ] **Step 3: 将 profile 页面缩减为账号和设置**

`profile.js` 仅加载 `/api/me`、`/api/tasks`，保留头像、昵称更新和设置跳转。

`profile.wxml` 仅显示：

- 头像和昵称。
- 本人参与任务数、本人累计完成次数摘要。
- 隐私政策和用户协议。
- 不显示记录列表、社交统计或成员主页入口。

- [ ] **Step 4: 设置页面配置**

```json
// pages/records/records.json
{ "navigationBarTitleText": "记录" }

// pages/profile/profile.json
{ "navigationBarTitleText": "我的" }
```

- [ ] **Step 5: 运行静态检查**

Run: `node check-miniprogram.js`

Expected: 全部小程序页面存在，JSON/JS/WXML 检查通过，禁止社交引用检查通过。

- [ ] **Step 6: 提交记录与我的页面**

```powershell
git add -- miniprogram/pages/records miniprogram/pages/profile
git commit -m "feat: separate private records and profile"
```

---

### Task 10: 更新协议、隐私政策和项目文档

**Files:**
- Modify: `miniprogram/pages/privacy/privacy.wxml`
- Modify: `miniprogram/pages/agreement/agreement.wxml`
- Modify: `README.md`

- [ ] **Step 1: 删除社交功能描述**

删除所有论坛、社区、帖子、点赞、评论、排行榜和成员互动描述。

- [ ] **Step 2: 写明新的数据可见范围**

隐私政策必须明确：

```text
您的打卡记录仅向您本人和对应任务管理员展示。
同一任务中的其他成员无法查看您的昵称、头像、完成状态、心得或个人记录。
任务管理员仅可查看其所管理任务内的成员完成情况和记录。
```

用户协议必须明确：

```text
本服务不提供成员之间的社区、评论、点赞、关注、私信或个人动态浏览功能。
```

- [ ] **Step 3: 更新 README**

更新功能说明、页面结构、数据表、API 一览、自测流程和体验版验收清单，移除全部社交功能说明，加入管理员成员记录与管理员导出接口。

- [ ] **Step 4: 扫描社交描述**

Run:

```powershell
Select-String -Path README.md,miniprogram\pages\privacy\privacy.wxml,miniprogram\pages\agreement\agreement.wxml -Pattern "论坛|社区|帖子|评论|点赞|关注|私信|排行榜"
```

Expected: 只允许出现“本服务不提供……”这类明确否定描述；不得出现功能宣传或使用说明。

- [ ] **Step 5: 提交文档更新**

```powershell
git add -- README.md miniprogram/pages/privacy/privacy.wxml miniprogram/pages/agreement/agreement.wxml
git commit -m "docs: document private task-only product"
```

---

### Task 11: 全量验证与微信开发者工具验收

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: 运行服务端语法检查**

```powershell
node --check server\index.js
node --check server\smoke-test.js
node --check server\archive-social-data.js
```

Expected: 全部 exit `0`。

- [ ] **Step 2: 运行端到端 API 测试**

终端 A：

```powershell
Set-Location server
node index.js
```

终端 B：

```powershell
Set-Location server
node smoke-test.js
```

Expected: 所有断言通过，社交 API 全部 `404`，成员越权全部被拒绝。

- [ ] **Step 3: 运行小程序静态检查**

```powershell
node check-miniprogram.js
```

Expected: `0 failed`，且无禁止社交引用。

- [ ] **Step 4: 运行全仓社交残留扫描**

```powershell
Select-String -Path miniprogram\**\*.js,miniprogram\**\*.wxml,miniprogram\app.json,server\index.js,server\db.json.js,server\db.mysql.js -Pattern "pages/forum|pages/post|pages/rank|/api/posts|/posts|/rank|post_comments|post_likes"
```

Expected: 无输出。

- [ ] **Step 5: 在微信开发者工具进行双角色手工验收**

成员账号：

1. 加入任务。
2. 查看“今天”和“计划”。
3. 确认看不到成员名单、完成率和其他成员记录。
4. 播放并提交打卡。
5. 在“记录”中查看和导出本人记录。
6. 确认不存在社区、排行榜、点赞和评论入口。

管理员账号：

1. 创建任务并邀请成员。
2. 发布音频和视频打卡。
3. 查看当前成员完成情况。
4. 查看某成员在该任务中的记录。
5. 导出任务数据。
6. 确认无法通过界面进行评论、点赞或私信。

- [ ] **Step 6: 对照审批设计图检查视觉**

对照 `design-previews/selected-combined-concept.png` 检查：

- 成员端为米白背景、暖橙主色和陪伴式文案。
- 管理员控制台保持高信息密度。
- 底部导航为“今天、计划、记录、我的”。
- 隐私边界提示清晰。
- 中文无乱码、无截断、无溢出。

- [ ] **Step 7: 检查提交范围**

```powershell
git status --short
git diff --stat
```

Expected: 仅出现计划范围内修改；任何实施前已有的无关修改仍被保留且未被暂存。

- [ ] **Step 8: 提交最终修复**

仅当验证阶段产生必要修复时：

```powershell
git add -- <本阶段实际修复文件>
git commit -m "fix: complete private task redesign verification"
```

---

## 生产发布顺序

1. 在生产配置下运行 `npm run archive-social`，下载并离线保存备份。
2. 部署移除社交 API、但尚未执行 `--purge` 的服务端版本。
3. 验证旧社交 API 为 `404`，核心任务和打卡流程正常。
4. 发布新版小程序并完成管理员/成员双角色验收。
5. 保留备份至少一个发布观察周期。
6. 明确批准后，在生产配置下运行 `npm run archive-social -- --purge` 删除历史社交表。

## 完成标准

- 成员无法从接口或界面获取任何其他成员信息和记录。
- 管理员只能查看自己管理任务内的成员完成状态与记录。
- 打卡提交不创建帖子。
- 社区、帖子、点赞、评论、排行榜和直接互动功能在前后端均不存在。
- 新四项导航和审批视觉实现完成。
- 服务端 smoke test、小程序静态检查和手工双角色验收全部通过。

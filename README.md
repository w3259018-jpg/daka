# 打卡监督小程序

> 任务制打卡：管理员发布音/视频内容 → 成员观看并提交心得 → 自动同步论坛 → 排行榜 + 个人导出。

## 角色与功能

- **管理员**：创建任务、生成邀请码、发布打卡内容（音频/视频）、查看成员
- **普通成员**：通过分享/邀请码加入、观看媒体、写心得打卡、参与论坛、查看导出自己的记录

## 目录结构

```
daka/
├── server/                       # 后端 Node.js + Express
│   ├── index.js                  # 全部 REST API
│   ├── db.js / db.json.js / db.mysql.js  # 数据层（按 STORAGE 切换）
│   ├── storage.js                # 文件层（按 STORAGE_DRIVER 切换 disk/COS）
│   ├── migrate-to-mysql.js       # data.json → MySQL 迁移脚本
│   ├── smoke-test.js             # 端到端自测脚本
│   ├── Dockerfile                # 微信云托管镜像
│   ├── .env.example              # 环境变量样板
│   └── package.json
├── miniprogram/                  # 微信小程序
│   ├── app.js / app.json / app.wxss
│   ├── utils/api.js              # 请求 / 登录 / 上传封装
│   ├── utils/config.js           # apiBase 按 develop/trial/release 切换
│   └── pages/...
└── check-miniprogram.js          # 小程序静态校验脚本
```

## 启动后端

```bash
cd server
npm install
npm start          # http://localhost:3000
```

## 自测（必跑）

```bash
# 终端 A：启动服务
cd server && node index.js

# 终端 B：运行端到端测试（覆盖 18 条核心断言）
cd server && node smoke-test.js

# 静态校验小程序（JSON / JS 语法 / 引用文件）
node check-miniprogram.js
```

## 运行小程序

1. 用「微信开发者工具」打开 `miniprogram/` 目录。
2. 详情 → 本地设置 → 勾选「不校验合法域名…」（仅开发期）。
3. 真机/局域网联调：把 `miniprogram/utils/config.js` 里的 `DEV_API_BASE` 换成你电脑的局域网 IP。
4. 体验版/正式版：把 `PROD_API_BASE` 改为云托管的公网 HTTPS 域名（见下文）。

## 核心数据表

| 表 | 关键字段 |
|---|---|
| `users` | id / openid / nickname / avatar |
| `tasks` | id / name / start_date / end_date / admin_id / invite_code |
| `task_members` | id / task_id / user_id / real_name / gender / age |
| `checkin_items` | id / task_id / title / media_type(audio\|video) / media_url |
| `checkin_records` | id / item_id / user_id / note / watched_at / submitted_at |
| `posts` | id / task_id / user_id / content / source(manual\|checkin) / checkin_record_id |
| `post_comments` | id / post_id / user_id / parent_id / content |
| `post_likes` | id / post_id / user_id |

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | code → token（演示用 code 模拟 openid） |
| GET  | `/api/me` | 当前用户 |
| POST | `/api/upload` | 通用文件上传（≤50MB） |
| POST | `/api/tasks` | 创建任务（自动成为管理员） |
| GET  | `/api/tasks` | 我加入的任务列表 |
| GET  | `/api/tasks/:id` | 任务详情（成员 + 打卡内容 + 是否管理员） |
| GET  | `/api/tasks/by-code/:code` | 用邀请码预览任务 |
| POST | `/api/tasks/join` | 入组（real_name/gender/age） |
| POST | `/api/tasks/:id/items` | 管理员发布打卡（title + media） |
| GET  | `/api/items/:id` | 打卡详情 + 我的记录 |
| POST | `/api/items/:id/watched` | 标记已观看（前端 `play` 时调用） |
| POST | `/api/items/:id/submit` | 提交心得（须先观看，每人一次） |
| GET  | `/api/tasks/:id/rank` | 任务内排行榜 |
| GET/POST | `/api/tasks/:id/posts` | 帖子列表 / 发帖 |
| GET  | `/api/posts/:id` | 帖子详情（含评论树） |
| POST | `/api/posts/:id/comment` | 评论（`parent_id` 支持二级回复） |
| POST | `/api/posts/:id/like` | 点赞切换 |
| GET  | `/api/tasks/:id/my-records` | 我的打卡记录（含 likes/comments） |
| POST | `/api/tasks/:id/export` | 生成 Markdown，返回临时 URL |

## 关键实现要点

- **观看确认**：媒体 `play` 事件触发 `/watched`，未观看时 `/submit` 返回 400。
- **打卡完成动效**：纯前端 CSS 动画撒星星粒子 + 文案，2 秒后自动消失。
- **心得→论坛同步**：`/submit` 成功时同步插入 `source=checkin` 的帖子。
- **导出**：后端拼装 Markdown 写入 `uploads/`，前端调 `wx.downloadFile + wx.saveFile`，或复制链接到微信笔记。
- **分享**：`task.js` 的 `onShareAppMessage` 生成 `pages/join/join?code=...`，新人直达入组页。

## 部署到微信云托管（推荐）

> 微信云托管不需要域名/ICP 备案/HTTPS 证书，开服送 HTTPS 公网地址，可绑微信云数据库 MySQL 和云对象存储。

### 1. 开通服务

1. 微信公众平台 → 开发管理 → 微信云托管 → 开通。
2. 控制台新建一个**环境**（建议 选「按量付费」，不用先充值）。
3. 在该环境内新建**服务**，选「Dockerfile 部署」，上传仓库 / 本地 zip。
   - 服务监听端口填 **80**（与 `Dockerfile` 中 `ENV PORT=80` 对齐）。

### 2. 创建 MySQL

1. 云托管控制台 → 数据库 → 新建 MySQL（最低规格够用）。
2. 进控制台手动执行：`CREATE DATABASE daka DEFAULT CHARSET utf8mb4;`
3. 记下 **内网地址、端口、账号、密码**。

### 3. 创建 COS（对象存储，存放音/视频/导出 md）

1. [腾讯云 COS 控制台](https://console.cloud.tencent.com/cos) 新建桶：地域选与云托管同一地域、权限「公有读私有写」。
2. [访问管理 CAM](https://console.cloud.tencent.com/cam/capi) 拿一对 SecretId / SecretKey（建议建一个只能写这个桶的子账号密钥）。

### 4. 在「云托管 → 服务 → 配置 → 环境变量」里填

```
WX_APPID=wxf739388435fa87ee
WX_SECRET=（公众平台里看）
JWT_SECRET=（随便一个长随机串，泄露后所有 token 失效，要换就改这个）
PORT=80

STORAGE=mysql
MYSQL_HOST=（云数据库内网地址）
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=daka

STORAGE_DRIVER=cos
COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=daka-prod-13xxxxxxxx
COS_REGION=ap-shanghai
```

### 5. （可选）把开发期数据带过去

```bash
cd server
cp .env.example .env   # 填好 MYSQL_*
npm run migrate        # 把本地 data.json 写进云数据库
```

### 6. 配置小程序的合法域名

公众平台 → 开发 → 开发管理 → 服务器域名，把云托管分配的域名分别加到：

- `request 合法域名`
- `uploadFile 合法域名`
- `downloadFile 合法域名`（媒体播放和导出文件下载需要）

COS 公共访问域名也要加到 `downloadFile`（如 `https://daka-prod-xxx.cos.ap-shanghai.myqcloud.com`）。

### 7. 修改小程序里生产域名

`miniprogram/utils/config.js`：

```js
const PROD_API_BASE = 'https://你的云托管域名';
```

## 上传前自检清单

按顺序勾掉：

- [ ] `server/.env` 不在 git 里（已在 `.gitignore`），生产环境变量直接配在云托管控制台
- [ ] `JWT_SECRET` 改成新的随机串（不要用样板 `daka-prod-secret`）
- [ ] `WX_SECRET` 在云托管环境变量里配，**不要硬编码进代码**
- [ ] `miniprogram/utils/config.js` 的 `PROD_API_BASE` 已改为云托管 HTTPS 域名
- [ ] 公众平台「服务器域名」三类都加好，包括 COS 域名
- [ ] 关闭微信开发者工具的「不校验合法域名」开关后，本地能联通线上后端
- [ ] 跑过 `cd server && node smoke-test.js`（在本机用 JSON 模式即可）跑完全绿
- [ ] 跑过 `node check-miniprogram.js`，55 条全过
- [ ] 体验版扫码 → 走一遍：登录 / 创建任务 / 邀请加入 / 上传媒体 / 打卡 / 论坛 / 排行 / 导出
- [ ] 微信开发者工具：上传 → 填版本号 → 公众平台「版本管理」提交审核

## 数据/文件兼容性提示

- 旧 `/uploads/...` 路径在切到 COS 后仍能访问：客户端的 `fullUrl()` 会把相对路径加上 `apiBase`，老链接需要后端开着才能播。建议**切换 COS 时同步把存量文件传到 COS**，并写脚本把 `data.json` 里的 `media_url` 替换为 COS 域名。
- `STORAGE` 和 `STORAGE_DRIVER` 是两个独立开关，可以单独切换：先上 MySQL、再上 COS，分两步上线降低风险。

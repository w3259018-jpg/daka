# 打卡监督小程序

封闭式任务打卡工具：管理员发布打卡任务并邀请成员，成员只查看和提交本人打卡记录，管理员只查看其管理任务内的成员完成情况。

## 功能边界

保留功能：

- 管理员创建任务、生成邀请码、发布音频或视频打卡内容。
- 管理员查看任务内成员完成情况、查看成员在该任务内的打卡记录、导出任务数据。
- 成员接受邀请加入任务、观看打卡内容、提交本人心得。
- 成员仅查看和导出本人打卡记录。

不提供功能：

- 不提供论坛、社区、帖子、评论、点赞、关注、私信、排行榜或个人动态浏览。
- 成员之间不可查看彼此的完成状态、心得、头像、昵称或个人记录。

## 目录结构

```text
daka/
├─ server/                       # Node.js + Express 后端
│  ├─ index.js                   # REST API
│  ├─ db.js / db.json.js / db.mysql.js
│  ├─ storage.js                 # disk/COS 文件存储
│  ├─ archive-social-data.js     # 历史社交数据归档脚本
│  ├─ smoke-test.js              # 端到端接口自测
│  └─ package.json
├─ miniprogram/                  # 微信小程序
│  ├─ app.json / app.wxss
│  ├─ custom-tab-bar/
│  ├─ utils/api.js
│  └─ pages/
│     ├─ tasks/                  # 今天
│     ├─ taskboard/              # 计划
│     ├─ records/                # 本人记录
│     ├─ profile/                # 我的
│     ├─ task/                   # 任务详情与管理员看板
│     ├─ item/                   # 私有打卡提交
│     └─ join/                   # 邀请加入
└─ check-miniprogram.js          # 小程序静态校验
```

## 启动后端

```bash
cd server
npm install
npm start
```

本地默认地址：`http://localhost:3000`。

## 自测

```bash
node --check server/index.js
node --check server/smoke-test.js
node --check server/archive-social-data.js

# 终端 A：从项目根目录启动，避免加载生产 .env
node server/index.js

# 终端 B
cd server
node smoke-test.js

# 小程序静态校验
node check-miniprogram.js
```

## 核心数据表

| 表 | 说明 |
|---|---|
| `users` | 用户账号、昵称、头像 |
| `tasks` | 任务、日期、创建者、邀请码 |
| `task_members` | 任务成员、角色、入组资料 |
| `checkin_items` | 管理员发布的音频或视频打卡项 |
| `checkin_records` | 成员观看、提交时间和本人心得 |

历史社交数据如存在，应先运行 `npm run archive-social` 归档；确认备份后再按发布流程执行清理。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/login` | 微信登录换取 token |
| `GET` | `/api/me` | 当前用户 |
| `PUT` | `/api/me/profile` | 更新昵称或头像 |
| `POST` | `/api/upload` | 上传音视频或头像 |
| `POST` | `/api/tasks` | 创建任务 |
| `GET` | `/api/tasks` | 我的任务列表，包含本人摘要字段 |
| `GET` | `/api/tasks/:id` | 任务详情；成员响应不含成员列表，管理员响应含看板数据 |
| `GET` | `/api/tasks/by-code/:code` | 邀请码预览 |
| `POST` | `/api/tasks/join` | 加入任务 |
| `POST` | `/api/tasks/:id/items` | 管理员发布打卡内容 |
| `GET` | `/api/items/:id` | 打卡内容和我的记录 |
| `POST` | `/api/items/:id/watched` | 标记已观看 |
| `POST` | `/api/items/:id/submit` | 提交本人心得 |
| `GET` | `/api/tasks/:id/my-records` | 本人私有打卡记录 |
| `POST` | `/api/tasks/:id/export` | 本人记录内联导出 |
| `GET` | `/api/tasks/:id/members/:uid/records` | 管理员查看任务内成员记录 |
| `POST` | `/api/tasks/:id/admin-export` | 管理员任务数据内联导出 |

## 小程序页面

- `今天`：展示本人今日待办、本人节奏和我管理的任务入口。
- `计划`：按“我参与的计划”和“我管理的计划”分组。
- `记录`：筛选、查看和导出本人打卡记录。
- `我的`：账号资料、本人任务摘要、隐私政策和用户协议。
- `任务详情`：成员看本人进度；管理员看任务内完成情况、成员记录和导出入口。

## 发布检查清单

- [ ] 运行 `node check-miniprogram.js`，结果为 `0 failed`。
- [ ] 运行服务端语法检查和 `server/smoke-test.js`。
- [ ] 确认小程序没有论坛、社区、帖子、评论、点赞、关注、私信、排行榜或个人动态入口。
- [ ] 成员账号无法从接口或界面查看其他成员数据。
- [ ] 管理员账号只能查看自己管理任务内的数据。
- [ ] 生产环境执行 `npm run archive-social` 并离线保存备份。
- [ ] 确认备份后，如需清理历史社交表，再执行带确认参数的 purge 流程。

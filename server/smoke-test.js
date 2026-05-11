// 端到端 API 自测脚本（任务版）
const BASE = 'http://localhost:3000';

const req = async (method, url, body, token) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } else console.log('OK  :', msg); };

(async () => {
  // 1. 两位用户静默登录：仅凭 code，账号由后端按 openid 自动绑定
  const a  = await req('POST', '/api/login', { code: 'alice' });
  const b  = await req('POST', '/api/login', { code: 'bob' });
  ok(a.status === 200 && b.status === 200, '双用户登录');
  const tA = a.data.token, tB = b.data.token;

  // 1.1 同一个 code 再登录一次 → 必须复用同一个账号（账号一致性）
  const aAgain = await req('POST', '/api/login', { code: 'alice' });
  ok(aAgain.status === 200 && aAgain.data.user.id === a.data.user.id, '同一微信用户复用同一个账号');

  // 1.2 资料同步：通过 PUT /api/me/profile 更新昵称和头像
  const prof = await req('PUT', '/api/me/profile', { nickname: 'Alice', avatar: '/uploads/a.png' }, tA);
  ok(prof.status === 200 && prof.data.nickname === 'Alice' && prof.data.avatar === '/uploads/a.png', '资料同步成功');

  // 1.3 已有账号再次登录不会被覆盖资料
  const aKeep = await req('POST', '/api/login', { code: 'alice', nickname: '不该覆盖' });
  const me    = await req('GET', '/api/me', null, aKeep.data.token);
  ok(me.data.nickname === 'Alice', '登录接口不覆盖已有资料');

  // 后续接口仍以 B 为非管理员，给 B 也设置一下展示昵称
  await req('PUT', '/api/me/profile', { nickname: 'Bob' }, tB);

  // 2. A 创建任务
  const t = await req('POST', '/api/tasks', { name: '英语晨读', start_date: '2026-05-01', end_date: '2026-06-01' }, tA);
  ok(t.status === 200 && t.data.invite_code, '创建任务，邀请码=' + t.data.invite_code);
  const tid = t.data.id, code = t.data.invite_code;

  // 3. B 通过邀请码查询并加入（带入组信息）
  const peek = await req('GET', '/api/tasks/by-code/' + code, null, tB);
  ok(peek.status === 200 && peek.data.id === tid, 'B 预览邀请任务');
  const join = await req('POST', '/api/tasks/join', { invite_code: code, real_name: '小明', gender: '男', age: 24 }, tB);
  ok(join.status === 200, 'B 加入任务');

  // 4. A 发布一条视频打卡
  const item = await req('POST', `/api/tasks/${tid}/items`, { title: 'Day1 朗读', media_type: 'video', media_url: '/uploads/demo.mp4' }, tA);
  ok(item.status === 200, 'A 发布打卡内容');
  const iid = item.data.id;

  // 5. B 未观看直接提交 → 失败
  const earlySubmit = await req('POST', `/api/items/${iid}/submit`, { note: '太早了' }, tB);
  ok(earlySubmit.status === 400, '未观看不能提交');

  // 6. B 标记观看 → 提交心得
  const watched = await req('POST', `/api/items/${iid}/watched`, {}, tB);
  ok(watched.status === 200, 'B 已观看');
  const submit = await req('POST', `/api/items/${iid}/submit`, { note: '今天读得很流畅' }, tB);
  ok(submit.status === 200, 'B 提交心得');

  // 7. 重复提交 → 失败
  const dup = await req('POST', `/api/items/${iid}/submit`, { note: '重提' }, tB);
  ok(dup.status === 409, '重复提交被拒');

  // 8. 论坛应自动同步一条 source=checkin
  const posts = await req('GET', `/api/tasks/${tid}/posts`, null, tA);
  ok(posts.status === 200 && posts.data.some(p => p.source === 'checkin'), '心得自动同步到论坛');

  // 9. A 给帖子点赞 + 评论 + 嵌套回复
  const pid = posts.data[0].id;
  const like = await req('POST', `/api/posts/${pid}/like`, {}, tA);
  ok(like.status === 200 && like.data.liked, 'A 点赞');
  const c1 = await req('POST', `/api/posts/${pid}/comment`, { content: '继续加油！' }, tA);
  ok(c1.status === 200, 'A 一级评论');
  const c2 = await req('POST', `/api/posts/${pid}/comment`, { content: '谢谢老师', parent_id: c1.data.id }, tB);
  ok(c2.status === 200, 'B 二级回复');
  const post = await req('GET', `/api/posts/${pid}`, null, tA);
  ok(post.data.commentList.length === 2 && post.data.likes === 1, '帖子聚合 likes/comments');

  // 10. 排行榜：B 完成 1 次 / A 完成 0 次
  const rank = await req('GET', `/api/tasks/${tid}/rank`, null, tA);
  ok(rank.status === 200 && rank.data[0].cnt === 1, '排行榜首位 1 次');

  // 11. B 的个人记录
  const my = await req('GET', `/api/tasks/${tid}/my-records`, null, tB);
  ok(my.status === 200 && my.data.length === 1 && my.data[0].comments === 2, '个人记录含心得+评论数');

  // 12. 导出心得
  const exp = await req('POST', `/api/tasks/${tid}/export`, {}, tB);
  ok(exp.status === 200 && exp.data.url.startsWith('/uploads/'), '导出 markdown 文件');

  // 13. 任务详情含成员、items、is_admin/is_creator + role
  const detail = await req('GET', `/api/tasks/${tid}`, null, tA);
  ok(detail.data.members.length === 2 && detail.data.items.length === 1 && detail.data.is_creator && detail.data.is_admin, '任务详情完整(含 is_creator)');
  ok(detail.data.members.find(m => m.user_id === b.data.user.id).role === 'member', 'B 初始为普通成员');

  // 14. 多管理员：A 提升 B 为管理员 → B 也能发布打卡
  const promote = await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'admin' }, tA);
  ok(promote.status === 200, 'A 提升 B 为管理员');
  const item2 = await req('POST', `/api/tasks/${tid}/items`, { title: 'Day2 朗读', media_type: 'audio', media_url: '/uploads/d.mp3' }, tB);
  ok(item2.status === 200, '管理员 B 也能发布打卡');

  // 15. 普通管理员不能改其他人角色
  const c = await req('POST', '/api/login', { code: 'carol' });
  await req('PUT', '/api/me/profile', { nickname: 'Carol' }, c.data.token);
  await req('POST', '/api/tasks/join', { invite_code: code, real_name: '小红', gender: '女', age: 22 }, c.data.token);
  const denied = await req('POST', `/api/tasks/${tid}/members/${c.data.user.id}/role`, { role: 'admin' }, tB);
  ok(denied.status === 403, '普通管理员无权设角色');

  // 16. 创建者撤销 B 的管理员
  const demote = await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'member' }, tA);
  ok(demote.status === 200, 'A 撤销 B 的管理员');

  // 17. 上限 5 人：模拟已有 5 人时再设第 6 人会被拒
  // 当前 creator(A) 共 1 人。先把 B/C 都设为 admin，再多加 3 人加任务，前 3 个设 admin 应成功，第 4 个失败
  await req('POST', `/api/tasks/${tid}/members/${b.data.user.id}/role`, { role: 'admin' }, tA);
  await req('POST', `/api/tasks/${tid}/members/${c.data.user.id}/role`, { role: 'admin' }, tA);
  const extras = [];
  for (let i = 0; i < 3; i++) {
    const u = await req('POST', '/api/login', { code: 'extra' + i });
    await req('PUT', '/api/me/profile', { nickname: 'E' + i }, u.data.token);
    await req('POST', '/api/tasks/join', { invite_code: code, real_name: 'E' + i, age: 20 }, u.data.token);
    extras.push(u.data.user.id);
  }
  const r1 = await req('POST', `/api/tasks/${tid}/members/${extras[0]}/role`, { role: 'admin' }, tA);
  const r2 = await req('POST', `/api/tasks/${tid}/members/${extras[1]}/role`, { role: 'admin' }, tA);
  const r3 = await req('POST', `/api/tasks/${tid}/members/${extras[2]}/role`, { role: 'admin' }, tA);
  ok(r1.status === 200 && r2.status === 200 && r3.status === 400, '管理员上限 5 人生效');

  // 18. 管理员可移除普通成员，不能移除管理员
  const kickAdmin = await req('DELETE', `/api/tasks/${tid}/members/${b.data.user.id}`, null, tA);
  ok(kickAdmin.status === 400, '不能直接移除管理员');
  const kickMember = await req('DELETE', `/api/tasks/${tid}/members/${extras[2]}`, null, tA);
  ok(kickMember.status === 200, '可移除普通成员');

  // 19. 仅创建者能解散任务
  const denyDel = await req('DELETE', `/api/tasks/${tid}`, null, tB);
  ok(denyDel.status === 403, '非创建者不能解散');
  const del = await req('DELETE', `/api/tasks/${tid}`, null, tA);
  ok(del.status === 200, '创建者解散任务');
  const gone = await req('GET', `/api/tasks/${tid}`, null, tA);
  ok(gone.status === 404, '任务及其数据已删除');

  console.log('\n全部接口自测通过 ✅');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
